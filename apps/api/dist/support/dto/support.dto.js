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
exports.AdminListConversationsQueryDto = exports.ListConversationsQueryDto = exports.AnswerResolutionDto = exports.SendMessageDto = exports.CreateConversationDto = exports.SUPPORT_CATEGORIES = exports.BODY_MAX = exports.SUBJECT_MAX = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
exports.SUBJECT_MAX = 200;
exports.BODY_MAX = 5000;
const trim = ({ value }) => typeof value === 'string' ? value.trim() : value;
exports.SUPPORT_CATEGORIES = ['issue', 'inquiry', 'faqs', 'custom'];
class CreateConversationDto {
}
exports.CreateConversationDto = CreateConversationDto;
__decorate([
    (0, class_validator_1.IsIn)(exports.SUPPORT_CATEGORIES, { message: 'Category must be issue, inquiry, faqs or custom' }),
    __metadata("design:type", String)
], CreateConversationDto.prototype, "category", void 0);
__decorate([
    (0, class_validator_1.ValidateIf)((o) => o.category === 'custom'),
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Title is required' }),
    (0, class_validator_1.MaxLength)(exports.SUBJECT_MAX, { message: `Title must be at most ${exports.SUBJECT_MAX} characters` }),
    __metadata("design:type", String)
], CreateConversationDto.prototype, "title", void 0);
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Message is required' }),
    (0, class_validator_1.MaxLength)(exports.BODY_MAX, { message: `Message must be at most ${exports.BODY_MAX} characters` }),
    __metadata("design:type", String)
], CreateConversationDto.prototype, "body", void 0);
class SendMessageDto {
}
exports.SendMessageDto = SendMessageDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Message is required' }),
    (0, class_validator_1.MaxLength)(exports.BODY_MAX, { message: `Message must be at most ${exports.BODY_MAX} characters` }),
    __metadata("design:type", String)
], SendMessageDto.prototype, "body", void 0);
class AnswerResolutionDto {
}
exports.AnswerResolutionDto = AnswerResolutionDto;
__decorate([
    (0, class_validator_1.IsBoolean)({ message: 'solved must be true or false' }),
    __metadata("design:type", Boolean)
], AnswerResolutionDto.prototype, "solved", void 0);
class ListConversationsQueryDto {
}
exports.ListConversationsQueryDto = ListConversationsQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['open', 'closed']),
    __metadata("design:type", String)
], ListConversationsQueryDto.prototype, "status", void 0);
class AdminListConversationsQueryDto extends ListConversationsQueryDto {
}
exports.AdminListConversationsQueryDto = AdminListConversationsQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBooleanString)(),
    __metadata("design:type", String)
], AdminListConversationsQueryDto.prototype, "unread", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], AdminListConversationsQueryDto.prototype, "organizationId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.SUPPORT_CATEGORIES),
    __metadata("design:type", String)
], AdminListConversationsQueryDto.prototype, "category", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], AdminListConversationsQueryDto.prototype, "q", void 0);
//# sourceMappingURL=support.dto.js.map