import { Module, forwardRef } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { PreviewsService } from './previews.service';
import { PreviewsController } from './previews.controller';
import { EnvVarsService } from './env-vars.service';
import { EnvVarsController } from './env-vars.controller';
import { PromoteService } from './promote.service';
import { PromoteController } from './promote.controller';
import { PreviewProtectionService } from './preview-protection.service';
import { PreviewProtectionController } from './preview-protection.controller';
import { FrameworkService } from './framework.service';
import { FrameworkController } from './framework.controller';
import { DeployModule } from '../deploy/deploy.module';
import { DeployTokenGuard } from './deploy-token.guard';
import { AuditService } from '../common/audit.service';
import { AuthModule } from '../auth/auth.module';
import { GithubModule } from '../github/github.module';
import { DnsModule } from '../dns/dns.module';

@Module({
  imports: [DeployModule, AuthModule, forwardRef(() => GithubModule), DnsModule],
  controllers: [AppsController, PreviewsController, EnvVarsController, PromoteController, PreviewProtectionController, FrameworkController],
  providers: [
    AppsService,
    PreviewsService,
    EnvVarsService,
    PromoteService,
    PreviewProtectionService,
    FrameworkService,
    DeployTokenGuard,
    AuditService,
  ],
  exports: [AppsService, PreviewsService],
})
export class AppsModule {}
