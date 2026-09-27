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
exports.UpdateNodeRedUserDto = exports.AddNodeRedUserDto = void 0;
const class_validator_1 = require("class-validator");
class AddNodeRedUserDto {
}
exports.AddNodeRedUserDto = AddNodeRedUserDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^[a-zA-Z0-9._-]{1,32}$/, {
        message: 'Username must be 1-32 chars of letters, numbers, dot, underscore or hyphen',
    }),
    __metadata("design:type", String)
], AddNodeRedUserDto.prototype, "username", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(6, { message: 'Password must be at least 6 characters' }),
    __metadata("design:type", String)
], AddNodeRedUserDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['*', 'read']),
    __metadata("design:type", String)
], AddNodeRedUserDto.prototype, "permission", void 0);
class UpdateNodeRedUserDto {
}
exports.UpdateNodeRedUserDto = UpdateNodeRedUserDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(6, { message: 'Password must be at least 6 characters' }),
    __metadata("design:type", String)
], UpdateNodeRedUserDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['*', 'read']),
    __metadata("design:type", String)
], UpdateNodeRedUserDto.prototype, "permission", void 0);
//# sourceMappingURL=nodered-user.dto.js.map