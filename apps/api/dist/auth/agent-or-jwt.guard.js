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
exports.AgentOrJwtGuard = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const AGENT_TOKEN_PREFIX = 'ztk_';
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
let AgentOrJwtGuard = class AgentOrJwtGuard extends (0, passport_1.AuthGuard)('jwt') {
    constructor(prisma) {
        super();
        this.prisma = prisma;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const auth = req.headers['authorization'];
        const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (bearer && bearer.startsWith(AGENT_TOKEN_PREFIX)) {
            const record = await this.prisma.agentToken.findUnique({
                where: { tokenHash: hashToken(bearer) },
            });
            if (!record || record.revokedAt) {
                throw new common_1.UnauthorizedException({
                    code: 'INVALID_AGENT_TOKEN',
                    message: 'Agent token is invalid or revoked.',
                });
            }
            this.prisma.agentToken
                .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
                .catch(() => undefined);
            req.user = {
                id: record.userId,
                organizationId: record.organizationId,
                role: record.role,
                email: 'agent@upande',
                status: 'active',
                isAgent: true,
            };
            return true;
        }
        return super.canActivate(context);
    }
};
exports.AgentOrJwtGuard = AgentOrJwtGuard;
exports.AgentOrJwtGuard = AgentOrJwtGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AgentOrJwtGuard);
//# sourceMappingURL=agent-or-jwt.guard.js.map