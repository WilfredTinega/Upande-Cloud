"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const admin_service_1 = require("./admin.service");
const agent_or_jwt_guard_1 = require("../auth/agent-or-jwt.guard");
const roles_guard_1 = require("../common/roles.guard");
const roles_decorator_1 = require("../common/roles.decorator");
const current_user_decorator_1 = require("../common/current-user.decorator");
const update_quota_dto_1 = require("./dto/update-quota.dto");
const create_organization_dto_1 = require("./dto/create-organization.dto");
const update_role_dto_1 = require("./dto/update-role.dto");
const update_user_dto_1 = require("./dto/update-user.dto");
const update_settings_dto_1 = require("./dto/update-settings.dto");
const update_github_settings_dto_1 = require("./dto/update-github-settings.dto");
const update_network_settings_dto_1 = require("./dto/update-network-settings.dto");
const create_agent_token_dto_1 = require("./dto/create-agent-token.dto");
const dns_service_1 = require("../dns/dns.service");
const ops_service_1 = require("./ops.service");
const bulk_migrate_dto_1 = require("./dto/bulk-migrate.dto");
const impersonate_user_dto_1 = require("./dto/impersonate-user.dto");
const path = require("path");
let AdminController = class AdminController {
    constructor(adminService, dns, ops) {
        this.adminService = adminService;
        this.dns = dns;
        this.ops = ops;
    }
    listOpsCommands() {
        return { commands: this.ops.listCommands() };
    }
    runOpsCommand(actor, key) {
        return this.ops.runCommand(actor.id, key);
    }
    listAllDnsZones() {
        return this.dns.listAllZones();
    }
    listDnsRecords(name) {
        return this.dns.listRecordsAdmin(name);
    }
    deleteDnsZone(actor, name) {
        return this.dns.deleteZoneAdmin(actor.id, name);
    }
    listUsers() {
        return this.adminService.listUsers();
    }
    suspendUser(actor, id) {
        return this.adminService.suspendUser(actor.id, id);
    }
    unsuspendUser(actor, id) {
        return this.adminService.unsuspendUser(actor.id, id);
    }
    updateUser(actor, id, dto) {
        return this.adminService.updateUser(actor.id, id, dto);
    }
    deleteUser(actor, id) {
        return this.adminService.deleteUser(actor.id, id);
    }
    updateRole(actor, id, dto) {
        return this.adminService.updateRole(actor.id, id, dto);
    }
    impersonateUser(actor, id, dto) {
        return this.adminService.impersonateUser(actor, id, dto.password, dto.reason);
    }
    listOrganizations() {
        return this.adminService.listOrganizations();
    }
    createOrganization(actor, dto) {
        return this.adminService.createOrganization(actor.id, dto);
    }
    updateQuota(actor, id, dto) {
        return this.adminService.updateQuota(actor.id, id, dto);
    }
    listAllApps() {
        return this.adminService.listAllApps();
    }
    bulkMigrateAllSites(actor, body) {
        return this.adminService.bulkMigrateAllSites({ id: actor.id, email: actor.email }, { type: body?.type });
    }
    adminStopApp(actor, id) {
        return this.adminService.adminStopApp(actor.id, id);
    }
    adminDeployApp(actor, id, body) {
        return this.adminService.adminDeployApp(actor.id, id, body?.ref);
    }
    getMetrics() {
        return this.adminService.getMetrics();
    }
    getPerformance(organizationId, appId, days, minutes) {
        return this.adminService.getPerformance({ organizationId: organizationId || undefined, appId: appId || undefined }, {
            minutes: minutes ? Number(minutes) : undefined,
            days: days ? Number(days) : undefined,
        });
    }
    getSystem() {
        return this.adminService.getSystem();
    }
    getResources(organizationId, appId) {
        return this.adminService.getResourceUsage({
            organizationId: organizationId || undefined,
            appId: appId || undefined,
        });
    }
    getAuditLogs() {
        return this.adminService.getAuditLogs();
    }
    listDeploymentErrors() {
        return this.adminService.listDeploymentErrors();
    }
    deploymentLog(id) {
        return this.adminService.getDeploymentLog(id);
    }
    appDeployments(id, take) {
        return this.adminService.listAppDeployments(id, take ? Number(take) : undefined);
    }
    aiStatus() {
        return this.adminService.aiStatus();
    }
    analyzeDeployment(actor, id, body) {
        return this.adminService.analyzeDeployment(actor.id, id, body?.errorReason);
    }
    analyzeApp(actor, id) {
        return this.adminService.analyzeLatestForApp(actor.id, id);
    }
    getSettings() {
        return this.adminService.getSettings();
    }
    updateSettings(actor, dto) {
        return this.adminService.updateSettings(actor.id, dto);
    }
    getGithubSettings() {
        return this.adminService.getGithubSettings();
    }
    updateGithubSettings(actor, dto) {
        return this.adminService.updateGithubSettings(actor.id, dto);
    }
    testGithubSettings() {
        return this.adminService.testGithubSettings();
    }
    getNetworkSettings() {
        return this.adminService.getNetworkSettings();
    }
    updateNetworkSettings(actor, dto) {
        return this.adminService.updateNetworkSettings(actor.id, dto);
    }
    detectPublicIp() {
        return this.adminService.detectPublicIp();
    }
    listAgentTokens() {
        return this.adminService.listAgentTokens();
    }
    createAgentToken(actor, dto) {
        return this.adminService.createAgentToken(actor, dto.name ?? 'mcp-agent');
    }
    revokeAgentToken(actor, id) {
        return this.adminService.revokeAgentToken(actor.id, id);
    }
    generateMcpConfig(actor) {
        const mcpEntry = path.resolve(process.cwd(), '../../packages/mcp/dist/index.js');
        return this.adminService.generateMcpConfig(actor, mcpEntry);
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('ops/commands'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listOpsCommands", null);
__decorate([
    (0, common_1.Post)('ops/run/:key'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "runOpsCommand", null);
__decorate([
    (0, common_1.Get)('dns/zones'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listAllDnsZones", null);
__decorate([
    (0, common_1.Get)('dns/zones/:name/records'),
    __param(0, (0, common_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listDnsRecords", null);
__decorate([
    (0, common_1.Delete)('dns/zones/:name'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "deleteDnsZone", null);
__decorate([
    (0, common_1.Get)('users'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listUsers", null);
__decorate([
    (0, common_1.Post)('users/:id/suspend'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "suspendUser", null);
__decorate([
    (0, common_1.Post)('users/:id/unsuspend'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "unsuspendUser", null);
__decorate([
    (0, common_1.Patch)('users/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_user_dto_1.UpdateUserDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "updateUser", null);
__decorate([
    (0, common_1.Delete)('users/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "deleteUser", null);
__decorate([
    (0, common_1.Post)('users/:id/role'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_role_dto_1.UpdateRoleDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "updateRole", null);
__decorate([
    (0, common_1.Post)('users/:id/impersonate'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, impersonate_user_dto_1.ImpersonateUserDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "impersonateUser", null);
__decorate([
    (0, common_1.Get)('organizations'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listOrganizations", null);
__decorate([
    (0, common_1.Post)('organizations'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_organization_dto_1.CreateOrganizationDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "createOrganization", null);
__decorate([
    (0, common_1.Post)('organizations/:id/quota'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_quota_dto_1.UpdateQuotaDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "updateQuota", null);
__decorate([
    (0, common_1.Get)('apps'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listAllApps", null);
__decorate([
    (0, common_1.Post)('apps/bulk-migrate'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, bulk_migrate_dto_1.BulkMigrateDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "bulkMigrateAllSites", null);
__decorate([
    (0, common_1.Post)('apps/:id/stop'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "adminStopApp", null);
__decorate([
    (0, common_1.Post)('apps/:id/deploy'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "adminDeployApp", null);
__decorate([
    (0, common_1.Get)('metrics'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getMetrics", null);
__decorate([
    (0, common_1.Get)('performance'),
    __param(0, (0, common_1.Query)('organizationId')),
    __param(1, (0, common_1.Query)('appId')),
    __param(2, (0, common_1.Query)('days')),
    __param(3, (0, common_1.Query)('minutes')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getPerformance", null);
__decorate([
    (0, common_1.Get)('system'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getSystem", null);
__decorate([
    (0, common_1.Get)('resources'),
    __param(0, (0, common_1.Query)('organizationId')),
    __param(1, (0, common_1.Query)('appId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getResources", null);
__decorate([
    (0, common_1.Get)('audit'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getAuditLogs", null);
__decorate([
    (0, common_1.Get)('errors'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listDeploymentErrors", null);
__decorate([
    (0, common_1.Get)('deployments/:id/log'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "deploymentLog", null);
__decorate([
    (0, common_1.Get)('apps/:id/deployments'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "appDeployments", null);
__decorate([
    (0, common_1.Get)('ai/status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "aiStatus", null);
__decorate([
    (0, common_1.Post)('deployments/:id/analyze'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "analyzeDeployment", null);
__decorate([
    (0, common_1.Post)('apps/:id/analyze'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "analyzeApp", null);
__decorate([
    (0, common_1.Get)('settings'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getSettings", null);
__decorate([
    (0, common_1.Post)('settings'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_settings_dto_1.UpdateSettingsDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "updateSettings", null);
__decorate([
    (0, common_1.Get)('settings/github'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getGithubSettings", null);
__decorate([
    (0, common_1.Post)('settings/github'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_github_settings_dto_1.UpdateGithubSettingsDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "updateGithubSettings", null);
__decorate([
    (0, common_1.Post)('settings/github/test'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "testGithubSettings", null);
__decorate([
    (0, common_1.Get)('settings/network'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "getNetworkSettings", null);
__decorate([
    (0, common_1.Post)('settings/network'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_network_settings_dto_1.UpdateNetworkSettingsDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "updateNetworkSettings", null);
__decorate([
    (0, common_1.Post)('settings/network/detect'),
    (0, roles_decorator_1.Roles)('superadmin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "detectPublicIp", null);
__decorate([
    (0, common_1.Get)('agent-tokens'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "listAgentTokens", null);
__decorate([
    (0, common_1.Post)('agent-tokens'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_agent_token_dto_1.CreateAgentTokenDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "createAgentToken", null);
__decorate([
    (0, common_1.Delete)('agent-tokens/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "revokeAgentToken", null);
__decorate([
    (0, common_1.Post)('mcp-config'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "generateMcpConfig", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)('admin'),
    (0, common_1.UseGuards)(agent_or_jwt_guard_1.AgentOrJwtGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('admin', 'superadmin'),
    __metadata("design:paramtypes", [admin_service_1.AdminService,
        dns_service_1.DnsService,
        ops_service_1.OpsService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map