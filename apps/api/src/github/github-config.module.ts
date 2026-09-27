import { Module } from '@nestjs/common';
import { GithubConfigService } from './github-config.service';

// Standalone so both GithubModule and AdminModule share ONE instance (and
// therefore one cache that the admin save invalidates).
@Module({
  providers: [GithubConfigService],
  exports: [GithubConfigService],
})
export class GithubConfigModule {}
