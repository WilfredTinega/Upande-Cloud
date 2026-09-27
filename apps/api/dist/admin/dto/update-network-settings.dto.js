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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateNetworkSettingsDto = void 0;
const class_validator_1 = require("class-validator");
class UpdateNetworkSettingsDto {
}
exports.UpdateNetworkSettingsDto = UpdateNetworkSettingsDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.ValidateIf)((o) => typeof o.publicIpv4 === 'string' && o.publicIpv4.trim() !== ''),
    (0, class_validator_1.IsIP)('4', { message: 'Enter a valid IPv4 address, e.g. 203.0.113.10' }),
    __metadata("design:type", String)
], UpdateNetworkSettingsDto.prototype, "publicIpv4", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.ValidateIf)((o) => typeof o.publicIpv6 === 'string' && o.publicIpv6.trim() !== ''),
    (0, class_validator_1.IsIP)('6', { message: 'Enter a valid IPv6 address, e.g. 2001:db8::10' }),
    __metadata("design:type", String)
], UpdateNetworkSettingsDto.prototype, "publicIpv6", void 0);
//# sourceMappingURL=update-network-settings.dto.js.map