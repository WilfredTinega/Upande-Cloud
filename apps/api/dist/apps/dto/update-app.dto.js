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
exports.UpdateAppDto = void 0;
const class_validator_1 = require("class-validator");
const class_validator_2 = require("class-validator");
const repo_url_util_1 = require("../../common/repo-url.util");
class UpdateAppDto {
}
exports.UpdateAppDto = UpdateAppDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], UpdateAppDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['static', 'node', 'fullstack'], {
        message: 'type must be one of: static, node, fullstack',
    }),
    __metadata("design:type", String)
], UpdateAppDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.ValidateIf)((_, v) => v !== ''),
    (0, class_validator_1.Matches)(repo_url_util_1.REPO_URL_RE, { message: repo_url_util_1.REPO_URL_MESSAGE }),
    __metadata("design:type", String)
], UpdateAppDto.prototype, "repoUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAppDto.prototype, "branch", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAppDto.prototype, "buildCmd", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateAppDto.prototype, "outputDir", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, v) => v !== null && v !== ''),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\/[\x21-\x7e]{0,255}$/, {
        message: 'healthCheckPath must start with "/" and contain no spaces',
    }),
    __metadata("design:type", Object)
], UpdateAppDto.prototype, "healthCheckPath", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(60),
    __metadata("design:type", Number)
], UpdateAppDto.prototype, "healthCheckTimeout", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(60),
    __metadata("design:type", Number)
], UpdateAppDto.prototype, "healthCheckRetries", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_2.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateAppDto.prototype, "githubCommitStatus", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_2.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateAppDto.prototype, "githubPrComments", void 0);
//# sourceMappingURL=update-app.dto.js.map