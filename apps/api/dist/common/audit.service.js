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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const request_context_1 = require("./request-context");
let AuditService = class AuditService {
    constructor(prisma, requestContext) {
        this.prisma = prisma;
        this.requestContext = requestContext;
    }
    async log(entry) {
        const ip = entry.ip ?? this.requestContext.ip ?? null;
        const actorUserId = entry.actorUserId ?? this.requestContext.userId ?? null;
        await this.prisma.auditLog.create({
            data: {
                actorUserId,
                action: entry.action,
                target: entry.target,
                metadata: (entry.metadata ?? client_1.Prisma.JsonNull),
                ip,
            },
        });
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        request_context_1.RequestContextService])
], AuditService);
//# sourceMappingURL=audit.service.js.map