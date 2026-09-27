import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AgentOrJwtGuard } from '../auth/agent-or-jwt.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateGithubSettingsDto } from './dto/update-github-settings.dto';
import { UpdateNetworkSettingsDto } from './dto/update-network-settings.dto';
import { CreateAgentTokenDto } from './dto/create-agent-token.dto';
import { DnsService } from '../dns/dns.service';
import { OpsService, ZoneCommandKey } from './ops.service';
import { BulkMigrateDto } from './dto/bulk-migrate.dto';
import { ImpersonateUserDto } from './dto/impersonate-user.dto';
import * as path from 'path';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
  email: string;
}

@Controller('admin')
@UseGuards(AgentOrJwtGuard, RolesGuard)
@Roles('admin', 'superadmin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly dns: DnsService,
    private readonly ops: OpsService,
  ) {}

  // ---- Platform ops (zone CLI) — superadmin only -------------------------

  @Get('ops/commands')
  @Roles('superadmin')
  listOpsCommands() {
    return { commands: this.ops.listCommands() };
  }

  @Post('ops/run/:key')
  @Roles('superadmin')
  runOpsCommand(
    @CurrentUser() actor: AuthUser,
    @Param('key') key: ZoneCommandKey,
  ) {
    return this.ops.runCommand(actor.id, key);
  }

  // ---- DNS (cross-tenant) ------------------------------------------------

  @Get('dns/zones')
  listAllDnsZones() {
    return this.dns.listAllZones();
  }

  @Get('dns/zones/:name/records')
  listDnsRecords(@Param('name') name: string) {
    return this.dns.listRecordsAdmin(name);
  }

  @Delete('dns/zones/:name')
  deleteDnsZone(@CurrentUser() actor: AuthUser, @Param('name') name: string) {
    return this.dns.deleteZoneAdmin(actor.id, name);
  }

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Post('users/:id/suspend')
  suspendUser(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.suspendUser(actor.id, id);
  }

  @Post('users/:id/unsuspend')
  unsuspendUser(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.unsuspendUser(actor.id, id);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(actor.id, id, dto);
  }

  @Delete('users/:id')
  deleteUser(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.deleteUser(actor.id, id);
  }

  @Post('users/:id/role')
  updateRole(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.adminService.updateRole(actor.id, id, dto);
  }

  // Mint a short-lived dashboard session as this user (impersonation / "log in as").
  @Post('users/:id/impersonate')
  impersonateUser(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: ImpersonateUserDto,
  ) {
    return this.adminService.impersonateUser(actor, id, dto.password, dto.reason);
  }

  @Get('organizations')
  listOrganizations() {
    return this.adminService.listOrganizations();
  }

  @Post('organizations')
  createOrganization(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.adminService.createOrganization(actor.id, dto);
  }

  @Post('organizations/:id/quota')
  updateQuota(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotaDto,
  ) {
    return this.adminService.updateQuota(actor.id, id, dto);
  }

  @Get('apps')
  listAllApps() {
    return this.adminService.listAllApps();
  }

  // Platform-wide security patch + migrate: force a clean rebuild ("migrate") of
  // every deployable site (optionally scoped to one app type). Superadmin-only —
  // it's a destructive, cross-tenant maintenance action. Declared BEFORE the
  // `apps/:id/*` routes so the static `bulk-migrate` segment isn't captured as
  // an :id.
  @Post('apps/bulk-migrate')
  @Roles('superadmin')
  bulkMigrateAllSites(@CurrentUser() actor: AuthUser, @Body() body: BulkMigrateDto) {
    return this.adminService.bulkMigrateAllSites(
      { id: actor.id, email: actor.email },
      { type: body?.type },
    );
  }

  @Post('apps/:id/stop')
  adminStopApp(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.adminStopApp(actor.id, id);
  }

  @Post('apps/:id/deploy')
  adminDeployApp(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { ref?: string },
  ) {
    return this.adminService.adminDeployApp(actor.id, id, body?.ref);
  }

  @Get('metrics')
  getMetrics() {
    return this.adminService.getMetrics();
  }

  // Deployment performance charts, default across all sites; optional
  // ?organizationId= (customer) and ?appId= (site) filters and ?days= window.
  @Get('performance')
  getPerformance(
    @Query('organizationId') organizationId?: string,
    @Query('appId') appId?: string,
    @Query('days') days?: string,
    @Query('minutes') minutes?: string,
  ) {
    return this.adminService.getPerformance(
      { organizationId: organizationId || undefined, appId: appId || undefined },
      {
        minutes: minutes ? Number(minutes) : undefined,
        days: days ? Number(days) : undefined,
      },
    );
  }

  // Host capacity: CPU cores, memory, disk, and active users.
  @Get('system')
  getSystem() {
    return this.adminService.getSystem();
  }

  // Live resource usage, uptime and responsiveness per site and per customer.
  @Get('resources')
  getResources(@Query('organizationId') organizationId?: string, @Query('appId') appId?: string) {
    return this.adminService.getResourceUsage({
      organizationId: organizationId || undefined,
      appId: appId || undefined,
    });
  }

  @Get('audit')
  getAuditLogs() {
    return this.adminService.getAuditLogs();
  }

  // ---- Errors (deployment failures across orgs) ----

  @Get('errors')
  listDeploymentErrors() {
    return this.adminService.listDeploymentErrors();
  }

  @Get('deployments/:id/log')
  deploymentLog(@Param('id') id: string) {
    return this.adminService.getDeploymentLog(id);
  }

  // Deploy history of one app (cross-tenant): trigger, commit, timing, status.
  @Get('apps/:id/deployments')
  appDeployments(@Param('id') id: string, @Query('take') take?: string) {
    return this.adminService.listAppDeployments(id, take ? Number(take) : undefined);
  }

  // ---- AI ----

  @Get('ai/status')
  aiStatus() {
    return this.adminService.aiStatus();
  }

  @Post('deployments/:id/analyze')
  analyzeDeployment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { errorReason?: string },
  ) {
    return this.adminService.analyzeDeployment(actor.id, id, body?.errorReason);
  }

  @Post('apps/:id/analyze')
  analyzeApp(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.analyzeLatestForApp(actor.id, id);
  }

  // ---- Settings (agent / MCP connection) ----

  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Post('settings')
  updateSettings(@CurrentUser() actor: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.adminService.updateSettings(actor.id, dto);
  }

  // ---- Settings (GitHub OAuth App) — superadmin only ----

  @Get('settings/github')
  @Roles('superadmin')
  getGithubSettings() {
    return this.adminService.getGithubSettings();
  }

  @Post('settings/github')
  @Roles('superadmin')
  updateGithubSettings(@CurrentUser() actor: AuthUser, @Body() dto: UpdateGithubSettingsDto) {
    return this.adminService.updateGithubSettings(actor.id, dto);
  }

  @Post('settings/github/test')
  @Roles('superadmin')
  testGithubSettings() {
    return this.adminService.testGithubSettings();
  }

  // ---- Settings (Networking: server public IP) — superadmin only ----

  @Get('settings/network')
  @Roles('superadmin')
  getNetworkSettings() {
    return this.adminService.getNetworkSettings();
  }

  @Post('settings/network')
  @Roles('superadmin')
  updateNetworkSettings(@CurrentUser() actor: AuthUser, @Body() dto: UpdateNetworkSettingsDto) {
    return this.adminService.updateNetworkSettings(actor.id, dto);
  }

  // Suggest the server's public IP (via a public echo service). Never saves.
  @Post('settings/network/detect')
  @Roles('superadmin')
  detectPublicIp() {
    return this.adminService.detectPublicIp();
  }

  // ---- Permanent agent tokens + MCP config ----

  @Get('agent-tokens')
  listAgentTokens() {
    return this.adminService.listAgentTokens();
  }

  @Post('agent-tokens')
  createAgentToken(@CurrentUser() actor: AuthUser, @Body() dto: CreateAgentTokenDto) {
    return this.adminService.createAgentToken(actor, dto.name ?? 'mcp-agent');
  }

  @Delete('agent-tokens/:id')
  revokeAgentToken(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.revokeAgentToken(actor.id, id);
  }

  // Returns a ready-to-use .mcp.json (mints a fresh agent token, embeds it).
  @Post('mcp-config')
  generateMcpConfig(@CurrentUser() actor: AuthUser) {
    // Absolute path to the built MCP server entry point in this monorepo.
    const mcpEntry = path.resolve(process.cwd(), '../../packages/mcp/dist/index.js');
    return this.adminService.generateMcpConfig(actor, mcpEntry);
  }
}
