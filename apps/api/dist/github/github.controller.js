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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubController = void 0;
const common_1 = require("@nestjs/common");
const github_service_1 = require("./github.service");
const apps_service_1 = require("../apps/apps.service");
const previews_service_1 = require("../apps/previews.service");
const github_pr_service_1 = require("./github-pr.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
let GithubController = class GithubController {
    constructor(githubService, appsService, previewsService, pullRequests) {
        this.githubService = githubService;
        this.appsService = appsService;
        this.previewsService = previewsService;
        this.pullRequests = pullRequests;
    }
    authorize(user) {
        return this.githubService.buildAuthorizeUrl(user.id);
    }
    async callback(code, state, res) {
        try {
            const { redirectTo } = await this.githubService.handleCallback(code, state);
            res.redirect(redirectTo);
        }
        catch {
            res.redirect(`${this.githubService.dashboardUrl()}/apps/new?github=error`);
        }
    }
    status(user) {
        return this.githubService.getStatus(user.id);
    }
    repos(user) {
        return this.githubService.listRepos(user.id);
    }
    branches(user, owner, repo) {
        return this.githubService.listBranches(user.id, owner, repo);
    }
    remoteBranches(user, repoUrl) {
        return this.githubService.listRemoteBranches(user.id, repoUrl);
    }
    disconnect(user) {
        return this.githubService.disconnect(user.id);
    }
    async webhook(appId, req, event, signature) {
        const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
        const result = await this.githubService.resolveWebhookDeploy(appId, event, raw, signature);
        if (result?.kind === 'pull_request') {
            return this.pullRequests.handle(result);
        }
        if (result && result.isTrackedBranch && !result.deleted) {
            await this.appsService.deployByToken(result.appId, { ref: result.ref }, {
                trigger: 'webhook',
                detail: result.pusher ? `push by ${result.pusher}` : 'push',
                commitSha: result.commitSha,
                commitMessage: result.commitMessage,
            });
            return { deployed: true, ref: result.ref };
        }
        if (result && !result.isTrackedBranch) {
            if (result.deleted) {
                const removed = await this.previewsService.removeForBranch(result.appId, result.ref);
                return { deployed: false, preview: { removed } };
            }
            const preview = await this.previewsService.deployFromWebhook(result.appId, result.ref, {
                detail: result.pusher ? `push by ${result.pusher}` : 'push',
                commitSha: result.commitSha,
                commitMessage: result.commitMessage,
            });
            return { deployed: 'previewId' in preview, ref: result.ref, preview };
        }
        return { deployed: false };
    }
};
exports.GithubController = GithubController;
__decorate([
    (0, common_1.Get)('authorize'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "authorize", null);
__decorate([
    (0, common_1.Get)('callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], GithubController.prototype, "callback", null);
__decorate([
    (0, common_1.Get)('status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "status", null);
__decorate([
    (0, common_1.Get)('repos'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "repos", null);
__decorate([
    (0, common_1.Get)('repos/:owner/:repo/branches'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('owner')),
    __param(2, (0, common_1.Param)('repo')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "branches", null);
__decorate([
    (0, common_1.Get)('remote-branches'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('repoUrl')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "remoteBranches", null);
__decorate([
    (0, common_1.Delete)('disconnect'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GithubController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Post)('webhook/:appId'),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Param)('appId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Headers)('x-github-event')),
    __param(3, (0, common_1.Headers)('x-hub-signature-256')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, String]),
    __metadata("design:returntype", Promise)
], GithubController.prototype, "webhook", null);
exports.GithubController = GithubController = __decorate([
    (0, common_1.Controller)('github'),
    __metadata("design:paramtypes", [github_service_1.GithubService,
        apps_service_1.AppsService,
        previews_service_1.PreviewsService,
        github_pr_service_1.GithubPullRequestService])
], GithubController);
//# sourceMappingURL=github.controller.js.map