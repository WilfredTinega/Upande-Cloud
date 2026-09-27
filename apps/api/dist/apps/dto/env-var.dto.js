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
exports.UpdateEnvVarDto = exports.CreateEnvVarDto = void 0;
const class_validator_1 = require("class-validator");
const env_scope_util_1 = require("../../common/env-scope.util");
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
class CreateEnvVarDto {
}
exports.CreateEnvVarDto = CreateEnvVarDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(128),
    (0, class_validator_1.Matches)(KEY_RE, { message: 'key must be letters, digits and _ (not starting with a digit)' }),
    __metadata("design:type", String)
], CreateEnvVarDto.prototype, "key", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(32768),
    __metadata("design:type", String)
], CreateEnvVarDto.prototype, "value", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateEnvVarDto.prototype, "isSecret", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(env_scope_util_1.ENV_SCOPES),
    __metadata("design:type", String)
], CreateEnvVarDto.prototype, "scope", void 0);
class UpdateEnvVarDto {
}
exports.UpdateEnvVarDto = UpdateEnvVarDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(32768),
    __metadata("design:type", String)
], UpdateEnvVarDto.prototype, "value", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateEnvVarDto.prototype, "isSecret", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(env_scope_util_1.ENV_SCOPES),
    __metadata("design:type", String)
], UpdateEnvVarDto.prototype, "scope", void 0);
//# sourceMappingURL=env-var.dto.js.map