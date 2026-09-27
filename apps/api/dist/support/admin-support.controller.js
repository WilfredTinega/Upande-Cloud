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
exports.AdminSupportController = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const agent_or_jwt_guard_1 = require("../auth/agent-or-jwt.guard");
const roles_guard_1 = require("../common/roles.guard");
const roles_decorator_1 = require("../common/roles.decorator");
const current_user_decorator_1 = require("../common/current-user.decorator");
const support_service_1 = require("./support.service");
const support_events_service_1 = require("./support-events.service");
const support_dto_1 = require("./dto/support.dto");
let AdminSupportController = class AdminSupportController {
    constructor(support, events) {
        this.support = support;
        this.events = events;
    }
    actor(user) {
        return { id: user.id, username: user.username, organizationId: user.organizationId };
    }
    stream() {
        return this.events.adminStream();
    }
    unread() {
        return this.support.unreadForAdmin();
    }
    list(query) {
        return this.support.listForAdmin({
            status: query.status,
            unread: query.unread === 'true',
            organizationId: query.organizationId,
            category: query.category,
            q: query.q,
        });
    }
    get(user, id) {
        return this.support.getForAdmin(this.actor(user), id);
    }
    reply(user, id, dto) {
        return this.support.replyAsAdmin(this.actor(user), id, dto.body);
    }
    askResolution(user, id) {
        return this.support.askResolutionAsAdmin(this.actor(user), id);
    }
    markRead(user, id) {
        return this.support.markReadAsAdmin(this.actor(user), id);
    }
    close(user, id) {
        return this.support.setStatusAsAdmin(this.actor(user), id, 'closed');
    }
    reopen(user, id) {
        return this.support.setStatusAsAdmin(this.actor(user), id, 'open');
    }
};
exports.AdminSupportController = AdminSupportController;
__decorate([
    (0, common_1.Sse)('stream'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", rxjs_1.Observable)
], AdminSupportController.prototype, "stream", null);
__decorate([
    (0, common_1.Get)('unread'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "unread", null);
__decorate([
    (0, common_1.Get)('conversations'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [support_dto_1.AdminListConversationsQueryDto]),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('conversations/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('conversations/:id/messages'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, support_dto_1.SendMessageDto]),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "reply", null);
__decorate([
    (0, common_1.Post)('conversations/:id/ask-resolution'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "askResolution", null);
__decorate([
    (0, common_1.Post)('conversations/:id/read'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "markRead", null);
__decorate([
    (0, common_1.Post)('conversations/:id/close'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "close", null);
__decorate([
    (0, common_1.Post)('conversations/:id/reopen'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AdminSupportController.prototype, "reopen", null);
exports.AdminSupportController = AdminSupportController = __decorate([
    (0, common_1.Controller)('admin/support'),
    (0, common_1.UseGuards)(agent_or_jwt_guard_1.AgentOrJwtGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('admin', 'superadmin'),
    __metadata("design:paramtypes", [support_service_1.SupportService,
        support_events_service_1.SupportEventsService])
], AdminSupportController);
//# sourceMappingURL=admin-support.controller.js.map