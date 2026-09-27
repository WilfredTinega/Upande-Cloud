"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DnsModule = void 0;
const common_1 = require("@nestjs/common");
const dns_controller_1 = require("./dns.controller");
const dns_service_1 = require("./dns.service");
const powerdns_client_1 = require("./powerdns.client");
const audit_service_1 = require("../common/audit.service");
const auth_module_1 = require("../auth/auth.module");
const platform_network_module_1 = require("./platform-network.module");
let DnsModule = class DnsModule {
};
exports.DnsModule = DnsModule;
exports.DnsModule = DnsModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, platform_network_module_1.PlatformNetworkModule],
        controllers: [dns_controller_1.DnsController],
        providers: [dns_service_1.DnsService, powerdns_client_1.PowerDnsClient, audit_service_1.AuditService],
        exports: [dns_service_1.DnsService, platform_network_module_1.PlatformNetworkModule],
    })
], DnsModule);
//# sourceMappingURL=dns.module.js.map