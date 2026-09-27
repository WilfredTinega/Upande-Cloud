"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const config_1 = require("@nestjs/config");
const deploy_service_1 = require("./deploy.service");
const deploy_processor_1 = require("./deploy.processor");
const stale_deploy_sweeper_1 = require("./stale-deploy.sweeper");
const log_store_service_1 = require("./log-store.service");
const db_provision_service_1 = require("../database/db-provision.service");
const notifications_module_1 = require("../notifications/notifications.module");
const deploy_constants_1 = require("./deploy.constants");
const build_cache_service_1 = require("./build-cache.service");
const github_config_module_1 = require("../github/github-config.module");
const github_reporter_service_1 = require("../github/github-reporter.service");
const build_cache_processor_1 = require("./build-cache.processor");
const inject_redis_decorator_1 = require("../common/inject-redis.decorator");
const ioredis_1 = require("ioredis");
let DeployModule = class DeployModule {
};
exports.DeployModule = DeployModule;
exports.DeployModule = DeployModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bullmq_1.BullModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    connection: {
                        host: config.get('REDIS_HOST') ?? 'localhost',
                        port: config.get('REDIS_PORT') ?? 6379,
                    },
                }),
            }),
            bullmq_1.BullModule.registerQueue({
                name: deploy_constants_1.DEPLOY_QUEUE,
            }),
            bullmq_1.BullModule.registerQueue({ name: build_cache_processor_1.BUILD_CACHE_QUEUE }),
            notifications_module_1.NotificationsModule,
            github_config_module_1.GithubConfigModule,
        ],
        providers: [
            deploy_service_1.DeployService,
            deploy_processor_1.DeployProcessor,
            stale_deploy_sweeper_1.StaleDeploySweeper,
            log_store_service_1.LogStoreService,
            db_provision_service_1.DbProvisionService,
            build_cache_service_1.BuildCacheService,
            build_cache_processor_1.BuildCacheProcessor,
            github_reporter_service_1.GithubReporterService,
            {
                provide: inject_redis_decorator_1.REDIS_TOKEN,
                inject: [config_1.ConfigService],
                useFactory: (config) => {
                    return new ioredis_1.default({
                        host: config.get('REDIS_HOST') ?? 'localhost',
                        port: config.get('REDIS_PORT') ?? 6379,
                    });
                },
            },
        ],
        exports: [deploy_service_1.DeployService, log_store_service_1.LogStoreService, db_provision_service_1.DbProvisionService, build_cache_service_1.BuildCacheService, github_reporter_service_1.GithubReporterService],
    })
], DeployModule);
//# sourceMappingURL=deploy.module.js.map