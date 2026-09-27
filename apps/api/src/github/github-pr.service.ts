import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PreviewsService } from '../apps/previews.service';
import { GithubReporterService } from './github-reporter.service';
import { WebhookPullRequest } from './github.service';

// `pull_request` webhook events → branch preview lifecycle:
//   opened / reopened / synchronize → ensure the head branch has a preview on
//     the PR's head commit (skipped when the push event already deployed that
//     commit), and remember the PR number on the Preview row;
//   closed → delete the preview and turn the PR comment into "Preview removed".
// The PR comment itself is posted/edited by GithubReporterService from the
// deploy lifecycle.
@Injectable()
export class GithubPullRequestService {
  private readonly logger = new Logger(GithubPullRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly previews: PreviewsService,
    private readonly reporter: GithubReporterService,
  ) {}

  async handle(ev: WebhookPullRequest): Promise<Record<string, unknown>> {
    const app = await this.prisma.app.findUnique({
      where: { id: ev.appId },
      select: {
        id: true,
        name: true,
        branch: true,
        githubRepoFullName: true,
        githubPrComments: true,
        project: { select: { userId: true } },
      },
    });
    if (!app) return { handled: false, reason: 'app not found' };
    if (!ev.sameRepo) return { handled: false, reason: 'fork pull requests are not previewed' };
    if (ev.headRef === (app.branch ?? 'main')) {
      return { handled: false, reason: 'head is the production branch' };
    }

    const existing = await this.prisma.preview.findUnique({
      where: { appId_branch: { appId: app.id, branch: ev.headRef } },
    });

    if (ev.action === 'closed') {
      if (!existing) return { handled: true, preview: { removed: false } };
      const removed = await this.previews.removeForBranch(app.id, ev.headRef);
      if (removed && app.githubRepoFullName) {
        await this.reporter.markPreviewRemoved({
          appId: app.id,
          appName: app.name,
          ownerUserId: app.project.userId,
          repo: app.githubRepoFullName,
          previewId: existing.id,
          branch: ev.headRef,
          commentId: existing.githubCommentId,
          enabled: app.githubPrComments,
        });
      }
      return { handled: true, preview: { removed } };
    }

    if (!['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(ev.action)) {
      return { handled: false, reason: `action ${ev.action} ignored` };
    }

    // Already deployed (or deploying) this exact commit — typically the push
    // event for the same commit arrived first. Just link the PR.
    if (existing) {
      if (existing.githubPrNumber !== ev.number) {
        await this.prisma.preview.update({
          where: { id: existing.id },
          data: { githubPrNumber: ev.number, githubCommentId: null },
        });
      }
      const last = existing.lastDeploymentId
        ? await this.prisma.deployment.findUnique({
            where: { id: existing.lastDeploymentId },
            select: { id: true, commitSha: true, status: true },
          })
        : null;
      if (last && ev.headSha && last.commitSha === ev.headSha && last.status !== 'failed') {
        // Make sure the PR shows the current state (posts the comment once).
        if (existing.githubPrNumber !== ev.number || !existing.githubCommentId) {
          const state =
            last.status === 'live' ? 'success' : last.status === 'queued' || last.status === 'building' ? 'pending' : null;
          if (state) await this.reporter.reportDeployment(last.id, state);
        }
        return { handled: true, deployed: false, reason: 'commit already deployed' };
      }
    }

    const result = await this.previews.deployFromWebhook(app.id, ev.headRef, {
      detail: `PR #${ev.number} ${ev.action}${ev.sender ? ` by ${ev.sender}` : ''}`,
      commitSha: ev.headSha,
      commitMessage: ev.title,
    });
    if ('previewId' in result) {
      await this.prisma.preview.updateMany({
        where: { id: result.previewId, githubPrNumber: null },
        data: { githubPrNumber: ev.number },
      });
    } else {
      this.logger.log(`PR #${ev.number} (${ev.headRef}): preview not deployed — ${result.skipped}`);
    }
    return { handled: true, deployed: 'previewId' in result, preview: result };
  }
}
