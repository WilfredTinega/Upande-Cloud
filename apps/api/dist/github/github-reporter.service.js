"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var GithubReporterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubReporterService = exports.STATUS_CONTEXT_PREVIEW = exports.STATUS_CONTEXT_PRODUCTION = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const encrypt_util_1 = require("../common/encrypt.util");
const app_url_util_1 = require("../common/app-url.util");
const github_config_service_1 = require("./github-config.service");
const REQUEST_TIMEOUT_MS = 10_000;
exports.STATUS_CONTEXT_PRODUCTION = 'Upande Cloud — production';
exports.STATUS_CONTEXT_PREVIEW = 'Upande Cloud — preview';
function redact(text) {
    return text
        ?.replace(/\/\/[^/@\s]+@/g, '//***@')
        .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, '***');
}
class GithubHttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
let GithubReporterService = GithubReporterService_1 = class GithubReporterService {
    constructor(prisma, ghConfig) {
        this.prisma = prisma;
        this.ghConfig = ghConfig;
        this.logger = new common_1.Logger(GithubReporterService_1.name);
    }
    dashboardUrl() {
        return this.ghConfig.dashboardUrl().replace(/\/+$/, '');
    }
    deploymentUrl(appId, deploymentId) {
        return `${this.dashboardUrl()}/apps/${appId}?deployment=${deploymentId}`;
    }
    async request(token, method, path, body) {
        const base = await this.ghConfig.apiUrl();
        let res;
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
        }
        catch (err) {
            const e = err;
            throw new GithubHttpError(0, e.name === 'TimeoutError' ? 'timed out' : e.message || 'network error');
        }
        if (!res.ok) {
            const text = (await res.text().catch(() => '')).slice(0, 160);
            let msg = `HTTP ${res.status}`;
            try {
                const j = JSON.parse(text);
                if (j.message)
                    msg += ` ${j.message}`;
            }
            catch {
            }
            throw new GithubHttpError(res.status, msg);
        }
        if (res.status === 204)
            return undefined;
        return (await res.json());
    }
    async tokenFor(userId) {
        const acct = await this.prisma.githubAccount.findUnique({
            where: { userId },
            select: { accessToken: true },
        });
        if (!acct)
            return null;
        try {
            return (0, encrypt_util_1.decrypt)(acct.accessToken);
        }
        catch {
            return null;
        }
    }
    async reportDeployment(deploymentId, state, opts = {}) {
        opts = { ...opts, reason: redact(opts.reason) };
        const warn = async (what, err) => {
            const msg = err instanceof Error ? err.message : String(err);
            const line = `Warning: GitHub ${what} failed (${msg}) — the deploy is not affected`;
            this.logger.warn(`[${deploymentId}] ${line}`);
            try {
                await opts.log?.(line);
            }
            catch {
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
            if (!dep?.commitSha || !dep.app?.githubRepoFullName || dep.app.source !== 'git')
                return;
            const app = dep.app;
            const preview = dep.preview;
            if (!app.githubCommitStatus && !(preview && app.githubPrComments))
                return;
            const token = await this.tokenFor(app.project.userId);
            if (!token)
                return;
            const repo = app.githubRepoFullName;
            const sha = dep.commitSha;
            const liveUrl = (0, app_url_util_1.buildAppUrl)(preview ? preview.subdomain : app.subdomain);
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
                        context: preview ? exports.STATUS_CONTEXT_PREVIEW : exports.STATUS_CONTEXT_PRODUCTION,
                    });
                }
                catch (err) {
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
                }
                catch (err) {
                    await warn('pull request comment', err);
                }
            }
        }
        catch (err) {
            await warn('reporting', err);
        }
    }
    async findOpenPr(token, repo, branch) {
        const owner = repo.split('/')[0];
        const prs = await this.request(token, 'GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`);
        return prs?.[0]?.number ?? null;
    }
    commentBody(p) {
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
        }
        else {
            lines.push('| Status | Preview | Commit | Deploy log |', '| :-- | :-- | :-- | :-- |', `| **${status}**${p.state !== 'success' && p.state !== 'pending' && p.reason ? ` — ${p.reason.replace(/[|\n\r]/g, ' ').slice(0, 200)}` : ''} | ${p.state === 'success' ? `[${p.url}](${p.url})` : p.url ? `${p.url}` : '—'} | \`${(p.sha ?? '').slice(0, 7)}\` | [View log](${p.logUrl}) |`);
        }
        lines.push('', `<sub>Updated ${when}</sub>`);
        return lines.join('\n');
    }
    async upsertPreviewComment(token, repo, p) {
        let prNumber = p.prNumber;
        if (!prNumber) {
            prNumber = await this.findOpenPr(token, repo, p.branch);
            if (!prNumber)
                return;
            await this.prisma.preview.updateMany({ where: { id: p.previewId }, data: { githubPrNumber: prNumber } });
        }
        const body = this.commentBody(p);
        if (p.commentId) {
            try {
                await this.request(token, 'PATCH', `/repos/${repo}/issues/comments/${p.commentId}`, { body });
                return;
            }
            catch (err) {
                if (!(err instanceof GithubHttpError && err.status === 404))
                    throw err;
            }
        }
        const created = await this.request(token, 'POST', `/repos/${repo}/issues/${prNumber}/comments`, { body });
        await this.prisma.preview.updateMany({
            where: { id: p.previewId },
            data: { githubCommentId: String(created.id) },
        });
    }
    async markPreviewRemoved(p) {
        if (!p.commentId || !p.enabled)
            return;
        try {
            const token = await this.tokenFor(p.ownerUserId);
            if (!token)
                return;
            await this.request(token, 'PATCH', `/repos/${p.repo}/issues/comments/${p.commentId}`, {
                body: this.commentBody({ ...p, state: 'removed' }),
            });
        }
        catch (err) {
            this.logger.warn(`GitHub comment update (preview removed) failed: ${err.message}`);
        }
    }
};
exports.GithubReporterService = GithubReporterService;
exports.GithubReporterService = GithubReporterService = GithubReporterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        github_config_service_1.GithubConfigService])
], GithubReporterService);
//# sourceMappingURL=github-reporter.service.js.map