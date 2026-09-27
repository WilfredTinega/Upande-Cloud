"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubModule = void 0;
const common_1 = require("@nestjs/common");
const github_controller_1 = require("./github.controller");
const github_service_1 = require("./github.service");
const github_auth_controller_1 = require("./github-auth.controller");
const github_auth_service_1 = require("./github-auth.service");
const auth_module_1 = require("../auth/auth.module");
const apps_module_1 = require("../apps/apps.module");
const audit_service_1 = require("../common/audit.service");
const github_config_module_1 = require("./github-config.module");
const deploy_module_1 = require("../deploy/deploy.module");
const github_pr_service_1 = require("./github-pr.service");
let GithubModule = class GithubModule {
};
exports.GithubModule = GithubModule;
exports.GithubModule = GithubModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, github_config_module_1.GithubConfigModule, deploy_module_1.DeployModule, (0, common_1.forwardRef)(() => apps_module_1.AppsModule)],
        controllers: [github_controller_1.GithubController, github_auth_controller_1.GithubAuthController],
        providers: [github_service_1.GithubService, github_auth_service_1.GithubAuthService, audit_service_1.AuditService, github_pr_service_1.GithubPullRequestService],
        exports: [github_service_1.GithubService],
    })
], GithubModule);
//# sourceMappingURL=github.module.js.map