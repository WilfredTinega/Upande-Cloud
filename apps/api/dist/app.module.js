"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const common_module_1 = require("./common/common.module");
const request_context_interceptor_1 = require("./common/request-context.interceptor");
const prisma_module_1 = require("./prisma/prisma.module");
const auth_module_1 = require("./auth/auth.module");
const apps_module_1 = require("./apps/apps.module");
const admin_module_1 = require("./admin/admin.module");
const deploy_module_1 = require("./deploy/deploy.module");
const github_module_1 = require("./github/github.module");
const notifications_module_1 = require("./notifications/notifications.module");
const dns_module_1 = require("./dns/dns.module");
const support_module_1 = require("./support/support.module");
const uptime_module_1 = require("./uptime/uptime.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            common_module_1.CommonModule,
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            apps_module_1.AppsModule,
            admin_module_1.AdminModule,
            deploy_module_1.DeployModule,
            github_module_1.GithubModule,
            notifications_module_1.NotificationsModule,
            dns_module_1.DnsModule,
            support_module_1.SupportModule,
            uptime_module_1.UptimeModule,
        ],
        providers: [
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: request_context_interceptor_1.RequestContextInterceptor,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map