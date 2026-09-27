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
exports.DeployTokenGuard = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const bcrypt = require("bcrypt");
const prisma_service_1 = require("../prisma/prisma.service");
let DeployTokenGuard = class DeployTokenGuard {
    constructor(jwtService, config, prisma) {
        this.jwtService = jwtService;
        this.config = config;
        this.prisma = prisma;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers['authorization'] ?? '';
        if (!authHeader.startsWith('Bearer ')) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Missing Bearer token' });
        }
        const token = authHeader.substring(7);
        const appId = request.params.id;
        try {
            const secret = this.config.get('JWT_SECRET') ?? 'change-me';
            const payload = this.jwtService.verify(token, { secret });
            const user = await this.prisma.user.findUnique({
                where: { id: payload.sub },
                select: { id: true, email: true, role: true, status: true, organizationId: true, tokenVersion: true },
            });
            if (user &&
                user.status !== 'suspended' &&
                (payload.tv ?? 0) === user.tokenVersion &&
                payload.typ !== 'stream') {
                request.user = user;
                return true;
            }
        }
        catch {
        }
        const deployTokens = await this.prisma.deployToken.findMany({
            where: { appId },
        });
        for (const dt of deployTokens) {
            const match = await bcrypt.compare(token, dt.hashedToken);
            if (match) {
                await this.prisma.deployToken.update({
                    where: { id: dt.id },
                    data: { lastUsedAt: new Date() },
                });
                request.user = { id: null, role: 'deploy-token', organizationId: null };
                request.deployTokenApp = appId;
                request.deployTokenId = dt.id;
                return true;
            }
        }
        throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid token' });
    }
};
exports.DeployTokenGuard = DeployTokenGuard;
exports.DeployTokenGuard = DeployTokenGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        config_1.ConfigService,
        prisma_service_1.PrismaService])
], DeployTokenGuard);
//# sourceMappingURL=deploy-token.guard.js.map