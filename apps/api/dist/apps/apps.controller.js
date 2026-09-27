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
exports.AppsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const apps_service_1 = require("./apps.service");
const github_service_1 = require("../github/github.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const agent_or_jwt_guard_1 = require("../auth/agent-or-jwt.guard");
const deploy_token_guard_1 = require("./deploy-token.guard");
const rate_limit_guard_1 = require("../common/rate-limit.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const create_app_dto_1 = require("./dto/create-app.dto");
const update_app_dto_1 = require("./dto/update-app.dto");
const deploy_dto_1 = require("./dto/deploy.dto");
const create_token_dto_1 = require("./dto/create-token.dto");
const add_domain_dto_1 = require("./dto/add-domain.dto");
const set_domain_target_dto_1 = require("./dto/set-domain-target.dto");
const deployments_dto_1 = require("./dto/deployments.dto");
const nodered_user_dto_1 = require("./dto/nodered-user.dto");
let AppsController = class AppsController {
    constructor(appsService, githubService) {
        this.appsService = appsService;
        this.githubService = githubService;
    }
    listApps(user) {
        return this.appsService.listApps(user.id, user.organizationId);
    }
    async createApp(user, dto) {
        const { app, noderedAdminPassword } = await this.appsService.createApp(user.id, user.organizationId, dto);
        if (dto.githubRepoFullName) {
            try {
                const { hookId, secret } = await this.githubService.createWebhook(user.id, dto.githubRepoFullName, app.id);
                const updated = await this.appsService.attachWebhook(app.id, user.organizationId, dto.githubRepoFullName, hookId, secret);
                return { app: updated, webhook: { installed: true } };
            }
            catch (err) {
                return {
                    app,
                    webhook: {
                        installed: false,
                        error: err instanceof Error ? err.message : 'Webhook install failed',
                    },
                };
            }
        }
        return { app, noderedAdminPassword };
    }
    getApp(user, id) {
        return this.appsService.getApp(user.id, user.organizationId, id);
    }
    adminLogin(user, id) {
        return this.appsService.getAdminLogin(user.id, user.organizationId, id);
    }
    updateApp(user, id, dto) {
        return this.appsService.updateApp(user.id, user.organizationId, id, dto);
    }
    async deleteApp(user, id) {
        const result = await this.appsService.deleteApp(user.id, user.organizationId, id);
        if (result.githubRepoFullName && result.githubWebhookId) {
            await this.githubService.deleteWebhook(user.id, result.githubRepoFullName, result.githubWebhookId);
        }
        return { ok: result.ok };
    }
    uploadSource(user, id, files, pathsJson) {
        let paths;
        try {
            paths = JSON.parse(pathsJson ?? '[]');
        }
        catch {
            throw new common_1.BadRequestException({ code: 'BAD_PATHS', message: 'Invalid paths field' });
        }
        const items = (files ?? []).map((f, i) => ({
            relPath: paths[i] ?? f.originalname,
            buffer: f.buffer,
        }));
        return this.appsService.uploadSource(user.id, user.organizationId, id, items);
    }
    async deploy(req, id, dto) {
        const user = req.user;
        if (req.deployTokenApp) {
            return this.appsService.deployByToken(id, dto, {
                trigger: 'api_token',
                deployTokenId: req.deployTokenId,
            });
        }
        return this.appsService.deploy(user.id, user.organizationId, id, dto);
    }
    buildCache(user, id) {
        return this.appsService.getBuildCache(user.organizationId, id);
    }
    migrate(user, id, dto) {
        return this.appsService.migrate(user.id, user.organizationId, id, dto);
    }
    streamLogs(user, id) {
        return this.appsService.streamLogs(user.organizationId, id).pipe((0, operators_1.map)((event) => ({
            data: event.data,
        })));
    }
    listDeployments(user, id, query) {
        return this.appsService.listDeployments(user.organizationId, id, query);
    }
    rollback(user, id, deploymentId) {
        return this.appsService.rollback(user.id, user.organizationId, id, deploymentId);
    }
    deploymentLog(user, id, deploymentId) {
        return this.appsService.getDeploymentLog(user.organizationId, id, deploymentId);
    }
    stopApp(user, id) {
        return this.appsService.stopApp(user.id, user.organizationId, id);
    }
    cancelApp(user, id) {
        return this.appsService.cancelApp(user.id, user.organizationId, id);
    }
    restartApp(user, id) {
        return this.appsService.restartApp(user.id, user.organizationId, id);
    }
    containerStatus(user, id) {
        return this.appsService.getContainerStatus(user.organizationId, id);
    }
    runtimeLogs(user, id) {
        return this.appsService.getRuntimeLogs(user.organizationId, id);
    }
    createToken(user, id, dto) {
        return this.appsService.createToken(user.id, user.organizationId, id, dto);
    }
    listTokens(user, id) {
        return this.appsService.listTokens(user.id, user.organizationId, id);
    }
    listDomains(user, id) {
        return this.appsService.listDomains(user.organizationId, id);
    }
    addDomain(user, id, dto) {
        return this.appsService.addDomain(user.id, user.organizationId, id, dto);
    }
    verifyDomain(user, id, domainId) {
        return this.appsService.verifyDomain(user.id, user.organizationId, id, domainId);
    }
    removeDomain(user, id, domainId) {
        return this.appsService.removeDomain(user.id, user.organizationId, id, domainId);
    }
    setDomainTarget(user, id, domainId, dto) {
        return this.appsService.setDomainTarget(user.id, user.organizationId, id, domainId, dto);
    }
    domainStatus(user, id, domainId, refresh) {
        return this.appsService.domainStatus(user.organizationId, id, domainId, refresh === '1' || refresh === 'true');
    }
    listNodeRedUsers(user, id) {
        return this.appsService.listNodeRedUsers(user.organizationId, id);
    }
    addNodeRedUser(user, id, dto) {
        return this.appsService.addNodeRedUser(user.id, user.organizationId, id, dto);
    }
    updateNodeRedUser(user, id, nodeRedUserId, dto) {
        return this.appsService.updateNodeRedUser(user.id, user.organizationId, id, nodeRedUserId, dto);
    }
    removeNodeRedUser(user, id, nodeRedUserId) {
        return this.appsService.removeNodeRedUser(user.id, user.organizationId, id, nodeRedUserId);
    }
};
exports.AppsController = AppsController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "listApps", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_app_dto_1.CreateAppDto]),
    __metadata("design:returntype", Promise)
], AppsController.prototype, "createApp", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.UseGuards)(agent_or_jwt_guard_1.AgentOrJwtGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "getApp", null);
__decorate([
    (0, common_1.Get)(':id/admin-login'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "adminLogin", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_app_dto_1.UpdateAppDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "updateApp", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AppsController.prototype, "deleteApp", null);
__decorate([
    (0, common_1.Post)(':id/upload'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', 5000, { limits: { fileSize: 100 * 1024 * 1024 } })),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.UploadedFiles)()),
    __param(3, (0, common_1.Body)('paths')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Array, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "uploadSource", null);
__decorate([
    (0, common_1.Post)(':id/deploy'),
    (0, common_1.UseGuards)(rate_limit_guard_1.RateLimitGuard, deploy_token_guard_1.DeployTokenGuard),
    (0, rate_limit_guard_1.RateLimit)({ limit: 30, windowSec: 60 }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, deploy_dto_1.DeployDto]),
    __metadata("design:returntype", Promise)
], AppsController.prototype, "deploy", null);
__decorate([
    (0, common_1.Get)(':id/build-cache'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "buildCache", null);
__decorate([
    (0, common_1.Post)(':id/migrate'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, deploy_dto_1.DeployDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "migrate", null);
__decorate([
    (0, common_1.Sse)(':id/logs'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", rxjs_1.Observable)
], AppsController.prototype, "streamLogs", null);
__decorate([
    (0, common_1.Get)(':id/deployments'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, deployments_dto_1.ListDeploymentsQueryDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "listDeployments", null);
__decorate([
    (0, common_1.Post)(':id/deployments/:deploymentId/rollback'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('deploymentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "rollback", null);
__decorate([
    (0, common_1.Get)(':id/deployments/:deploymentId/log'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('deploymentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "deploymentLog", null);
__decorate([
    (0, common_1.Post)(':id/stop'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "stopApp", null);
__decorate([
    (0, common_1.Post)(':id/cancel'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "cancelApp", null);
__decorate([
    (0, common_1.Post)(':id/restart'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "restartApp", null);
__decorate([
    (0, common_1.Get)(':id/container-status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "containerStatus", null);
__decorate([
    (0, common_1.Get)(':id/runtime-logs'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "runtimeLogs", null);
__decorate([
    (0, common_1.Post)(':id/tokens'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, create_token_dto_1.CreateTokenDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "createToken", null);
__decorate([
    (0, common_1.Get)(':id/tokens'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "listTokens", null);
__decorate([
    (0, common_1.Get)(':id/domains'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "listDomains", null);
__decorate([
    (0, common_1.Post)(':id/domains'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, add_domain_dto_1.AddDomainDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "addDomain", null);
__decorate([
    (0, common_1.Post)(':id/domains/:domainId/verify'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('domainId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "verifyDomain", null);
__decorate([
    (0, common_1.Delete)(':id/domains/:domainId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('domainId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "removeDomain", null);
__decorate([
    (0, common_1.Put)(':id/domains/:domainId/target'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('domainId')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, set_domain_target_dto_1.SetDomainTargetDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "setDomainTarget", null);
__decorate([
    (0, common_1.Get)(':id/domains/:domainId/status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('domainId')),
    __param(3, (0, common_1.Query)('refresh')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "domainStatus", null);
__decorate([
    (0, common_1.Get)(':id/nodered-users'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "listNodeRedUsers", null);
__decorate([
    (0, common_1.Post)(':id/nodered-users'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, nodered_user_dto_1.AddNodeRedUserDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "addNodeRedUser", null);
__decorate([
    (0, common_1.Patch)(':id/nodered-users/:nodeRedUserId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('nodeRedUserId')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, nodered_user_dto_1.UpdateNodeRedUserDto]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "updateNodeRedUser", null);
__decorate([
    (0, common_1.Delete)(':id/nodered-users/:nodeRedUserId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('nodeRedUserId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AppsController.prototype, "removeNodeRedUser", null);
exports.AppsController = AppsController = __decorate([
    (0, common_1.Controller)('apps'),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => github_service_1.GithubService))),
    __metadata("design:paramtypes", [apps_service_1.AppsService,
        github_service_1.GithubService])
], AppsController);
//# sourceMappingURL=apps.controller.js.map