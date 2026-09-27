import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../common/encrypt.util';
import { buildAppUrl } from '../common/app-url.util';
import { GithubConfigService } from './github-config.service';

export type CommitState = 'pending' | 'success' | 'failure' | 'error';

// A line for the deploy log (warnings when GitHub can't be reached).
type LogFn = (line: string) => Promise<void> | void;

const REQUEST_TIMEOUT_MS = 10_000;
export const STATUS_CONTEXT_PRODUCTION = 'Upande Cloud — production';
export const STATUS_CONTEXT_PREVIEW = 'Upande Cloud — preview';

// Failure reasons can quote a clone URL — never let credentials reach GitHub.
function redact(text?: string): string | undefined {
  return text
    ?.replace(/\/\/[^/@\s]+@/g, '//***@')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, '***');
}

class GithubHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Reports deploys back to GitHub for GitHub-connected apps (Vercel-bot style):
//  - a commit status on the deployed SHA (pending → success/failure/error);
//  - for previews, ONE comment on the branch's open pull request, edited in
//    place on every later deploy (comment id stored on the Preview row).
// Uses the app owner's GitHub OAuth token (scope `repo`). Every call is
// best-effort: a GitHub failure/outage never fails a deploy — it becomes a
// warning line in the deploy log. Tokens are never logged.
@Injectable()
export class GithubReporterService {
  private readonly logger = new Logger(GithubReporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ghConfig: GithubConfigService,
  ) {}

  private dashboardUrl(): string {
    return this.ghConfig.dashboardUrl().replace(/\/+$/, '');
  }

  deploymentUrl(appId: string, deploymentId: string): string {
    return `${this.dashboardUrl()}/apps/${appId}?deployment=${deploymentId}`;
  }

  private async request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const base = await this.ghConfig.apiUrl();
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'upande-cloud',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const e = err as Error;
      throw new GithubHttpError(0, e.name === 'TimeoutError' ? 'timed out' : e.message || 'network error');
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 160);
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { message?: string };
        if (j.message) msg += ` ${j.message}`;
      } catch {
        /* not JSON */
      }
      throw new GithubHttpError(res.status, msg);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async tokenFor(userId: string): Promise<string | null> {
    const acct = await this.prisma.githubAccount.findUnique({
      where: { userId },
      select: { accessToken: true },
    });
    if (!acct) return null;
    try {
      return decrypt(acct.accessToken);
    } catch {
      return null;
    }
  }

  // Deploy lifecycle hook, called by the deploy processor. Never throws.
  async reportDeployment(
    deploymentId: string,
    state: CommitState,
    opts: { reason?: string; log?: LogFn } = {},
  ): Promise<void> {
    opts = { ...opts, reason: redact(opts.reason) };
    const warn = async (what: string, err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const line = `Warning: GitHub ${what} failed (${msg}) — the deploy is not affected`;
      this.logger.warn(`[${deploymentId}] ${line}`);
      try {
        await opts.log?.(line);
      } catch {
        /* ignore */
      }
    };
    try {
      const dep = await this.prisma.deployment.findUnique({
        where: { id: deploymentId },
        select: {
          id: true,
          commitSha: true,
          previewId: true,
          app: {
            select: {
              id: true,
              name: true,
              subdomain: true,
              source: true,
              githubRepoFullName: true,
              githubCommitStatus: true,
              githubPrComments: true,
              project: { select: { userId: true } },
            },
          },
          preview: true,
        },
      });
      if (!dep?.commitSha || !dep.app?.githubRepoFullName || dep.app.source !== 'git') return;
      const app = dep.app;
      const preview = dep.preview;
      if (!app.githubCommitStatus && !(preview && app.githubPrComments)) return;
      const token = await this.tokenFor(app.project.userId);
      if (!token) return; // owner's GitHub not connected (anymore)

      const repo = app.githubRepoFullName!;
      const sha = dep.commitSha;
      const liveUrl = buildAppUrl(preview ? preview.subdomain : app.subdomain);
      const targetUrl = this.deploymentUrl(app.id, dep.id);

      if (app.githubCommitStatus) {
        const description = (() => {
          switch (state) {
            case 'pending':
              return preview ? `Building preview of ${preview.branch}…` : 'Building and deploying…';
            case 'success':
              return `Deployed — ${liveUrl}`;
            default:
              return `Deploy failed${opts.reason ? `: ${opts.reason}` : ''}`;
          }
        })();
        try {
          await this.request(token, 'POST', `/repos/${repo}/statuses/${sha}`, {
            state,
            target_url: targetUrl,
            description: description.replace(/\s+/g, ' ').slice(0, 140),
            context: preview ? STATUS_CONTEXT_PREVIEW : STATUS_CONTEXT_PRODUCTION,
          });
        } catch (err) {
          await warn('commit status', err);
        }
      }

      if (preview && app.githubPrComments) {
        try {
          await this.upsertPreviewComment(token, repo, {
            appId: app.id,
            appName: app.name,
            previewId: preview.id,
            branch: preview.branch,
            prNumber: preview.githubPrNumber,
            commentId: preview.githubCommentId,
            state,
            sha,
            url: liveUrl,
            logUrl: targetUrl,
            reason: opts.reason,
          });
        } catch (err) {
          await warn('pull request comment', err);
        }
      }
    } catch (err) {
      await warn('reporting', err);
    }
  }

  // The open PR whose head is `branch` in `repo` (same-repo PRs only).
  async findOpenPr(token: string, repo: string, branch: string): Promise<number | null> {
    const owner = repo.split('/')[0];
    const prs = await this.request<Array<{ number: number }>>(
      token,
      'GET',
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`,
    );
    return prs?.[0]?.number ?? null;
  }

  private commentBody(p: {
    appId: string;
    appName: string;
    previewId: string;
    branch: string;
    state: CommitState | 'removed';
    sha?: string;
    url?: string;
    logUrl?: string;
    reason?: string;
  }): string {
    const status = {
      pending: 'Building',
      success: 'Ready',
      failure: 'Failed',
      error: 'Error',
      removed: 'Preview removed',
    }[p.state];
    const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const lines = [
      `<!-- upande-cloud:preview:${p.appId} -->`,
      `**Upande Cloud** preview of \`${p.branch}\` for **${p.appName}**`,
      '',
    ];
    if (p.state === 'removed') {
      lines.push('The preview deployment for this pull request was removed.');
    } else {
      lines.push(
        '| Status | Preview | Commit | Deploy log |',
        '| :-- | :-- | :-- | :-- |',
        `| **${status}**${p.state !== 'success' && p.state !== 'pending' && p.reason ? ` — ${p.reason.replace(/[|\n\r]/g, ' ').slice(0, 200)}` : ''} | ${
          p.state === 'success' ? `[${p.url}](${p.url})` : p.url ? `${p.url}` : '—'
        } | \`${(p.sha ?? '').slice(0, 7)}\` | [View log](${p.logUrl}) |`,
      );
    }
    lines.push('', `<sub>Updated ${when}</sub>`);
    return lines.join('\n');
  }

  // Post the preview comment once, then edit that same comment afterwards.
  private async upsertPreviewComment(
    token: string,
    repo: string,
    p: {
      appId: string;
      appName: string;
      previewId: string;
      branch: string;
      prNumber: number | null;
      commentId: string | null;
      state: CommitState;
      sha: string;
      url: string;
      logUrl: string;
      reason?: string;
    },
  ): Promise<void> {
    let prNumber = p.prNumber;
    if (!prNumber) {
      prNumber = await this.findOpenPr(token, repo, p.branch);
      if (!prNumber) return; // no open PR for this branch — nothing to comment on
      await this.prisma.preview.updateMany({ where: { id: p.previewId }, data: { githubPrNumber: prNumber } });
    }
    const body = this.commentBody(p);
    if (p.commentId) {
      try {
        await this.request(token, 'PATCH', `/repos/${repo}/issues/comments/${p.commentId}`, { body });
        return;
      } catch (err) {
        // Comment deleted on GitHub → post a fresh one below.
        if (!(err instanceof GithubHttpError && err.status === 404)) throw err;
      }
    }
    const created = await this.request<{ id: number }>(
      token,
      'POST',
      `/repos/${repo}/issues/${prNumber}/comments`,
      { body },
    );
    await this.prisma.preview.updateMany({
      where: { id: p.previewId },
      data: { githubCommentId: String(created.id) },
    });
  }

  // PR closed → the preview was deleted; turn its comment into "Preview removed".
  async markPreviewRemoved(p: {
    appId: string;
    appName: string;
    ownerUserId: string;
    repo: string;
    previewId: string;
    branch: string;
    commentId: string | null;
    enabled: boolean;
  }): Promise<void> {
    if (!p.commentId || !p.enabled) return;
    try {
      const token = await this.tokenFor(p.ownerUserId);
      if (!token) return;
      await this.request(token, 'PATCH', `/repos/${p.repo}/issues/comments/${p.commentId}`, {
        body: this.commentBody({ ...p, state: 'removed' }),
      });
    } catch (err) {
      this.logger.warn(`GitHub comment update (preview removed) failed: ${(err as Error).message}`);
    }
  }
}
