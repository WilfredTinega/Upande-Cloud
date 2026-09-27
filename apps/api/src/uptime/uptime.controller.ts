import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AgentOrJwtGuard } from '../auth/agent-or-jwt.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { UptimeService } from './uptime.service';
import { parseUptimeRange } from './uptime.constants';

@Controller('apps')
export class AppUptimeController {
  constructor(private readonly uptime: UptimeService) {}

  // GET /v1/apps/:id/uptime?range=30m|1h|24h|7d|30d (org-scoped; default 30m).
  @Get(':id/uptime')
  @UseGuards(JwtAuthGuard)
  getUptime(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Query('range') range?: string,
  ) {
    return this.uptime.getAppUptime(id, user.organizationId, parseUptimeRange(range));
  }
}

@Controller('admin')
@UseGuards(AgentOrJwtGuard, RolesGuard)
@Roles('admin', 'superadmin')
export class AdminUptimeController {
  constructor(private readonly uptime: UptimeService) {}

  // GET /v1/admin/uptime?range=30m|1h|24h|7d|30d — every app plus a platform series.
  @Get('uptime')
  getUptime(@Query('range') range?: string) {
    return this.uptime.getPlatformUptime(parseUptimeRange(range));
  }

  // GET /v1/admin/uptime/apps/:id?range=… — one site's analysis: uptime,
  // latency distribution + series, status codes, down reasons, incidents.
  @Get('uptime/apps/:id')
  getAppAnalysis(@Param('id') id: string, @Query('range') range?: string) {
    return this.uptime.getAppAnalysisAdmin(id, parseUptimeRange(range));
  }
}
