"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppsModule = void 0;
const common_1 = require("@nestjs/common");
const apps_controller_1 = require("./apps.controller");
const apps_service_1 = require("./apps.service");
const previews_service_1 = require("./previews.service");
const previews_controller_1 = require("./previews.controller");
const env_vars_service_1 = require("./env-vars.service");
const env_vars_controller_1 = require("./env-vars.controller");
const promote_service_1 = require("./promote.service");
const promote_controller_1 = require("./promote.controller");
const preview_protection_service_1 = require("./preview-protection.service");
const preview_protection_controller_1 = require("./preview-protection.controller");
const framework_service_1 = require("./framework.service");
const framework_controller_1 = require("./framework.controller");
const deploy_module_1 = require("../deploy/deploy.module");
const deploy_token_guard_1 = require("./deploy-token.guard");
const audit_service_1 = require("../common/audit.service");
const auth_module_1 = require("../auth/auth.module");
const github_module_1 = require("../github/github.module");
const dns_module_1 = require("../dns/dns.module");
let AppsModule = class AppsModule {
};
exports.AppsModule = AppsModule;
exports.AppsModule = AppsModule = __decorate([
    (0, common_1.Module)({
        imports: [deploy_module_1.DeployModule, auth_module_1.AuthModule, (0, common_1.forwardRef)(() => github_module_1.GithubModule), dns_module_1.DnsModule],
        controllers: [apps_controller_1.AppsController, previews_controller_1.PreviewsController, env_vars_controller_1.EnvVarsController, promote_controller_1.PromoteController, preview_protection_controller_1.PreviewProtectionController, framework_controller_1.FrameworkController],
        providers: [
            apps_service_1.AppsService,
            previews_service_1.PreviewsService,
            env_vars_service_1.EnvVarsService,
            promote_service_1.PromoteService,
            preview_protection_service_1.PreviewProtectionService,
            framework_service_1.FrameworkService,
            deploy_token_guard_1.DeployTokenGuard,
            audit_service_1.AuditService,
        ],
        exports: [apps_service_1.AppsService, previews_service_1.PreviewsService],
    })
], AppsModule);
//# sourceMappingURL=apps.module.js.map