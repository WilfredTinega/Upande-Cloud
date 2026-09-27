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
exports.FrameworkController = exports.DetectFrameworkDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const framework_service_1 = require("./framework.service");
class DetectFrameworkDto {
}
exports.DetectFrameworkDto = DetectFrameworkDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], DetectFrameworkDto.prototype, "repoUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], DetectFrameworkDto.prototype, "branch", void 0);
let FrameworkController = class FrameworkController {
    constructor(frameworks) {
        this.frameworks = frameworks;
    }
    detect(user, dto) {
        return this.frameworks.detectFromUrl(user.id, dto.repoUrl, dto.branch || undefined);
    }
    forApp(user, id) {
        return this.frameworks.detectForApp(user.id, user.organizationId, id);
    }
};
exports.FrameworkController = FrameworkController;
__decorate([
    (0, common_1.Post)('frameworks/detect'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, DetectFrameworkDto]),
    __metadata("design:returntype", void 0)
], FrameworkController.prototype, "detect", null);
__decorate([
    (0, common_1.Get)('apps/:id/framework'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FrameworkController.prototype, "forApp", null);
exports.FrameworkController = FrameworkController = __decorate([
    (0, common_1.Controller)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [framework_service_1.FrameworkService])
], FrameworkController);
//# sourceMappingURL=framework.controller.js.map