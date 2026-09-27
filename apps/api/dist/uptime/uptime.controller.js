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
exports.AdminUptimeController = exports.AppUptimeController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const agent_or_jwt_guard_1 = require("../auth/agent-or-jwt.guard");
const roles_guard_1 = require("../common/roles.guard");
const roles_decorator_1 = require("../common/roles.decorator");
const current_user_decorator_1 = require("../common/current-user.decorator");
const uptime_service_1 = require("./uptime.service");
const uptime_constants_1 = require("./uptime.constants");
let AppUptimeController = class AppUptimeController {
    constructor(uptime) {
        this.uptime = uptime;
    }
    getUptime(user, id, range) {
        return this.uptime.getAppUptime(id, user.organizationId, (0, uptime_constants_1.parseUptimeRange)(range));
    }
};
exports.AppUptimeController = AppUptimeController;
__decorate([
    (0, common_1.Get)(':id/uptime'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('range')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AppUptimeController.prototype, "getUptime", null);
exports.AppUptimeController = AppUptimeController = __decorate([
    (0, common_1.Controller)('apps'),
    __metadata("design:paramtypes", [uptime_service_1.UptimeService])
], AppUptimeController);
let AdminUptimeController = class AdminUptimeController {
    constructor(uptime) {
        this.uptime = uptime;
    }
    getUptime(range) {
        return this.uptime.getPlatformUptime((0, uptime_constants_1.parseUptimeRange)(range));
    }
    getAppAnalysis(id, range) {
        return this.uptime.getAppAnalysisAdmin(id, (0, uptime_constants_1.parseUptimeRange)(range));
    }
};
exports.AdminUptimeController = AdminUptimeController;
__decorate([
    (0, common_1.Get)('uptime'),
    __param(0, (0, common_1.Query)('range')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminUptimeController.prototype, "getUptime", null);
__decorate([
    (0, common_1.Get)('uptime/apps/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('range')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminUptimeController.prototype, "getAppAnalysis", null);
exports.AdminUptimeController = AdminUptimeController = __decorate([
    (0, common_1.Controller)('admin'),
    (0, common_1.UseGuards)(agent_or_jwt_guard_1.AgentOrJwtGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('admin', 'superadmin'),
    __metadata("design:paramtypes", [uptime_service_1.UptimeService])
], AdminUptimeController);
//# sourceMappingURL=uptime.controller.js.map