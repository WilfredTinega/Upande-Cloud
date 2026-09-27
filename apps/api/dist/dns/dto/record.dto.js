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
exports.DeleteRecordDto = exports.UpsertRecordDto = exports.SUPPORTED_RECORD_TYPES = void 0;
const class_validator_1 = require("class-validator");
exports.SUPPORTED_RECORD_TYPES = [
    'A',
    'AAAA',
    'CNAME',
    'MX',
    'TXT',
    'NS',
    'SRV',
    'CAA',
];
class UpsertRecordDto {
    constructor() {
        this.ttl = 3600;
    }
}
exports.UpsertRecordDto = UpsertRecordDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(@|\*|(\*\.)?([a-z0-9_-]{1,63})(\.[a-z0-9_-]{1,63})*)$/i, {
        message: 'Invalid record name',
    }),
    __metadata("design:type", String)
], UpsertRecordDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsIn)(exports.SUPPORTED_RECORD_TYPES, {
        message: `type must be one of: ${exports.SUPPORTED_RECORD_TYPES.join(', ')}`,
    }),
    __metadata("design:type", String)
], UpsertRecordDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(60),
    (0, class_validator_1.Max)(604800),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpsertRecordDto.prototype, "ttl", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UpsertRecordDto.prototype, "records", void 0);
class DeleteRecordDto {
}
exports.DeleteRecordDto = DeleteRecordDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DeleteRecordDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsIn)(exports.SUPPORTED_RECORD_TYPES),
    __metadata("design:type", String)
], DeleteRecordDto.prototype, "type", void 0);
//# sourceMappingURL=record.dto.js.map