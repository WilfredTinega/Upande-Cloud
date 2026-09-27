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
var GithubPullRequestService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubPullRequestService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const previews_service_1 = require("../apps/previews.service");
const github_reporter_service_1 = require("./github-reporter.service");
let GithubPullRequestService = GithubPullRequestService_1 = class GithubPullRequestService {
    constructor(prisma, previews, reporter) {
        this.prisma = prisma;
        this.previews = previews;
        this.reporter = reporter;
        this.logger = new common_1.Logger(GithubPullRequestService_1.name);
    }
    async handle(ev) {
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
        if (!app)
            return { handled: false, reason: 'app not found' };
        if (!ev.sameRepo)
            return { handled: false, reason: 'fork pull requests are not previewed' };
        if (ev.headRef === (app.branch ?? 'main')) {
            return { handled: false, reason: 'head is the production branch' };
        }
        const existing = await this.prisma.preview.findUnique({
            where: { appId_branch: { appId: app.id, branch: ev.headRef } },
        });
        if (ev.action === 'closed') {
            if (!existing)
                return { handled: true, preview: { removed: false } };
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
                if (existing.githubPrNumber !== ev.number || !existing.githubCommentId) {
                    const state = last.status === 'live' ? 'success' : last.status === 'queued' || last.status === 'building' ? 'pending' : null;
                    if (state)
                        await this.reporter.reportDeployment(last.id, state);
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
        }
        else {
            this.logger.log(`PR #${ev.number} (${ev.headRef}): preview not deployed — ${result.skipped}`);
        }
        return { handled: true, deployed: 'previewId' in result, preview: result };
    }
};
exports.GithubPullRequestService = GithubPullRequestService;
exports.GithubPullRequestService = GithubPullRequestService = GithubPullRequestService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        previews_service_1.PreviewsService,
        github_reporter_service_1.GithubReporterService])
], GithubPullRequestService);
//# sourceMappingURL=github-pr.service.js.map