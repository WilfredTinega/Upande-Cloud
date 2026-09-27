import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UptimeService } from './uptime.service';
import { UptimeProcessor } from './uptime.processor';
import { AppUptimeController, AdminUptimeController } from './uptime.controller';
import { UPTIME_QUEUE } from './uptime.constants';
import { AuthModule } from '../auth/auth.module';

// The BullMQ connection is configured once by BullModule.forRootAsync in
// DeployModule (global), so only the queue is registered here.
@Module({
  imports: [BullModule.registerQueue({ name: UPTIME_QUEUE }), AuthModule],
  controllers: [AppUptimeController, AdminUptimeController],
  providers: [UptimeService, UptimeProcessor],
  exports: [UptimeService],
})
export class UptimeModule {}
