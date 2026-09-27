import { Module } from '@nestjs/common';
import { PlatformNetworkService } from './platform-network.service';

// Standalone so AppsModule (via DnsModule) and AdminModule share ONE instance,
// and therefore one cache that the admin save invalidates.
@Module({
  providers: [PlatformNetworkService],
  exports: [PlatformNetworkService],
})
export class PlatformNetworkModule {}
