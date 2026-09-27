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
exports.SupportController = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const support_service_1 = require("./support.service");
const support_events_service_1 = require("./support-events.service");
const support_dto_1 = require("./dto/support.dto");
let SupportController = class SupportController {
    constructor(support, events) {
        this.support = support;
        this.events = events;
    }
    assertNotImpersonating(user) {
        if (user.imp) {
            throw new common_1.ForbiddenException({
                code: 'IMPERSONATION_FORBIDDEN',
                message: 'Support chat is read-only during an impersonation session.',
            });
        }
    }
    actor(user) {
        return { id: user.id, username: user.username, organizationId: user.organizationId };
    }
    stream(user) {
        return this.events.userStream(user.organizationId);
    }
    unread(user) {
        return this.support.unreadForOrg(user.organizationId);
    }
    list(user, query) {
        return this.support.listForOrg(user.organizationId, query.status);
    }
    create(user, dto) {
        this.assertNotImpersonating(user);
        return this.support.createForUser(this.actor(user), dto.category, dto.title, dto.body);
    }
    get(user, id) {
        return this.support.getForUser(this.actor(user), id);
    }
    send(user, id, dto) {
        this.assertNotImpersonating(user);
        return this.support.sendAsUser(this.actor(user), id, dto.body);
    }
    markRead(user, id) {
        this.assertNotImpersonating(user);
        return this.support.markReadAsUser(this.actor(user), id);
    }
    close(user, id) {
        this.assertNotImpersonating(user);
        return this.support.setStatusAsUser(this.actor(user), id, 'closed');
    }
    resolution(user, id, dto) {
        this.assertNotImpersonating(user);
        return this.support.answerResolutionAsUser(this.actor(user), id, dto.solved);
    }
    reopen(user, id) {
        this.assertNotImpersonating(user);
        return this.support.setStatusAsUser(this.actor(user), id, 'open');
    }
};
exports.SupportController = SupportController;
__decorate([
    (0, common_1.Sse)('stream'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", rxjs_1.Observable)
], SupportController.prototype, "stream", null);
__decorate([
    (0, common_1.Get)('unread'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "unread", null);
__decorate([
    (0, common_1.Get)('conversations'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, support_dto_1.ListConversationsQueryDto]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('conversations'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, support_dto_1.CreateConversationDto]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('conversations/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('conversations/:id/messages'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, support_dto_1.SendMessageDto]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "send", null);
__decorate([
    (0, common_1.Post)('conversations/:id/read'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "markRead", null);
__decorate([
    (0, common_1.Post)('conversations/:id/close'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "close", null);
__decorate([
    (0, common_1.Post)('conversations/:id/resolution'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, support_dto_1.AnswerResolutionDto]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "resolution", null);
__decorate([
    (0, common_1.Post)('conversations/:id/reopen'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SupportController.prototype, "reopen", null);
exports.SupportController = SupportController = __decorate([
    (0, common_1.Controller)('support'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [support_service_1.SupportService,
        support_events_service_1.SupportEventsService])
], SupportController);
//# sourceMappingURL=support.controller.js.map