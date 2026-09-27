import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DeployService } from './deploy.service';
import { DeployProcessor } from './deploy.processor';
import { StaleDeploySweeper } from './stale-deploy.sweeper';
import { LogStoreService } from './log-store.service';
import { DbProvisionService } from '../database/db-provision.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { DEPLOY_QUEUE } from './deploy.constants';
import { BuildCacheService } from './build-cache.service';
import { GithubConfigModule } from '../github/github-config.module';
import { GithubReporterService } from '../github/github-reporter.service';
import { BuildCacheProcessor, BUILD_CACHE_QUEUE } from './build-cache.processor';
import { REDIS_TOKEN } from '../common/inject-redis.decorator';
import Redis from 'ioredis';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        },
      }),
    }),
    BullModule.registerQueue({
      name: DEPLOY_QUEUE,
    }),
    BullModule.registerQueue({ name: BUILD_CACHE_QUEUE }),
    NotificationsModule,
    GithubConfigModule,
  ],
  providers: [
    DeployService,
    DeployProcessor,
    StaleDeploySweeper,
    LogStoreService,
    DbProvisionService,
    BuildCacheService,
    BuildCacheProcessor,
    GithubReporterService,
    {
      provide: REDIS_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Redis({
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        });
      },
    },
  ],
  exports: [DeployService, LogStoreService, DbProvisionService, BuildCacheService, GithubReporterService],
})
export class DeployModule {}
