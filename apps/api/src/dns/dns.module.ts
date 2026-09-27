import { Module } from '@nestjs/common';
import { DnsController } from './dns.controller';
import { DnsService } from './dns.service';
import { PowerDnsClient } from './powerdns.client';
import { AuditService } from '../common/audit.service';
import { AuthModule } from '../auth/auth.module';
import { PlatformNetworkModule } from './platform-network.module';

/**
 * Managed DNS hosting product. Customers create zones and records that the
 * platform's PowerDNS nameservers serve authoritatively. AuthModule is imported
 * for the JWT strategy used by JwtAuthGuard; RequestContextService (needed by
 * AuditService) comes from the global CommonModule.
 */
@Module({
  imports: [AuthModule, PlatformNetworkModule],
  controllers: [DnsController],
  providers: [DnsService, PowerDnsClient, AuditService],
  // PlatformNetworkModule is re-exported so importers (apps, admin) get the same instance.
  exports: [DnsService, PlatformNetworkModule],
})
export class DnsModule {}
