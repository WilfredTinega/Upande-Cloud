import { Module, forwardRef } from '@nestjs/common';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { GithubAuthController } from './github-auth.controller';
import { GithubAuthService } from './github-auth.service';
import { AuthModule } from '../auth/auth.module';
import { AppsModule } from '../apps/apps.module';
import { AuditService } from '../common/audit.service';
import { GithubConfigModule } from './github-config.module';
import { DeployModule } from '../deploy/deploy.module';
import { GithubPullRequestService } from './github-pr.service';

@Module({
  imports: [AuthModule, GithubConfigModule, DeployModule, forwardRef(() => AppsModule)],
  controllers: [GithubController, GithubAuthController],
  providers: [GithubService, GithubAuthService, AuditService, GithubPullRequestService],
  exports: [GithubService],
})
export class GithubModule {}
