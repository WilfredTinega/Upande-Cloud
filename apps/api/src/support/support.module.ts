import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { AdminSupportController } from './admin-support.controller';
import { SupportService } from './support.service';
import { SupportEventsService } from './support-events.service';
import { AuditService } from '../common/audit.service';

// Support chat between organization members and platform admins.
@Module({
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, SupportEventsService, AuditService],
})
export class SupportModule {}
