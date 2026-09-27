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
exports.EnvVarsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const env_vars_service_1 = require("./env-vars.service");
const env_var_dto_1 = require("./dto/env-var.dto");
let EnvVarsController = class EnvVarsController {
    constructor(envVars) {
        this.envVars = envVars;
    }
    list(user, id, scope) {
        return this.envVars.list(user.organizationId, id, scope);
    }
    create(user, id, dto) {
        return this.envVars.create(user.id, user.organizationId, id, dto);
    }
    update(user, id, envId, dto) {
        return this.envVars.update(user.id, user.organizationId, id, envId, dto);
    }
    remove(user, id, envId) {
        return this.envVars.remove(user.id, user.organizationId, id, envId);
    }
};
exports.EnvVarsController = EnvVarsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('scope')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], EnvVarsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, env_var_dto_1.CreateEnvVarDto]),
    __metadata("design:returntype", void 0)
], EnvVarsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':envId'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('envId')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, env_var_dto_1.UpdateEnvVarDto]),
    __metadata("design:returntype", void 0)
], EnvVarsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':envId'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('envId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], EnvVarsController.prototype, "remove", null);
exports.EnvVarsController = EnvVarsController = __decorate([
    (0, common_1.Controller)('apps/:id/env'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [env_vars_service_1.EnvVarsService])
], EnvVarsController);
//# sourceMappingURL=env-vars.controller.js.map