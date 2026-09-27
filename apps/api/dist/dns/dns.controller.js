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
exports.DnsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const dns_service_1 = require("./dns.service");
const create_zone_dto_1 = require("./dto/create-zone.dto");
const record_dto_1 = require("./dto/record.dto");
let DnsController = class DnsController {
    constructor(dns) {
        this.dns = dns;
    }
    quota(user) {
        return this.dns.quota(user.organizationId);
    }
    listZones(user) {
        return this.dns.listZones(user.organizationId);
    }
    createZone(user, dto) {
        return this.dns.createZone(user.id, user.organizationId, dto);
    }
    deleteZone(user, name) {
        return this.dns.deleteZone(user.id, user.organizationId, name);
    }
    listRecords(user, name) {
        return this.dns.listRecords(user.organizationId, name);
    }
    upsertRecord(user, name, dto) {
        return this.dns.upsertRecord(user.id, user.organizationId, name, dto);
    }
    deleteRecord(user, name, dto) {
        return this.dns.deleteRecord(user.id, user.organizationId, name, dto);
    }
};
exports.DnsController = DnsController;
__decorate([
    (0, common_1.Get)('quota'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DnsController.prototype, "quota", null);
__decorate([
    (0, common_1.Get)('zones'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DnsController.prototype, "listZones", null);
__decorate([
    (0, common_1.Post)('zones'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_zone_dto_1.CreateZoneDto]),
    __metadata("design:returntype", void 0)
], DnsController.prototype, "createZone", null);
__decorate([
    (0, common_1.Delete)('zones/:name'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DnsController.prototype, "deleteZone", null);
__decorate([
    (0, common_1.Get)('zones/:name/records'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DnsController.prototype, "listRecords", null);
__decorate([
    (0, common_1.Put)('zones/:name/records'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('name')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, record_dto_1.UpsertRecordDto]),
    __metadata("design:returntype", void 0)
], DnsController.prototype, "upsertRecord", null);
__decorate([
    (0, common_1.Delete)('zones/:name/records'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('name')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, record_dto_1.DeleteRecordDto]),
    __metadata("design:returntype", void 0)
], DnsController.prototype, "deleteRecord", null);
exports.DnsController = DnsController = __decorate([
    (0, common_1.Controller)('dns'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [dns_service_1.DnsService])
], DnsController);
//# sourceMappingURL=dns.controller.js.map