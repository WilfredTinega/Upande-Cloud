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
exports.JwtStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
let JwtStrategy = class JwtStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy) {
    constructor(config, prisma) {
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromExtractors([
                passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
                passport_jwt_1.ExtractJwt.fromUrlQueryParameter('token'),
            ]),
            ignoreExpiration: false,
            secretOrKey: config.get('JWT_SECRET') ?? 'change-me',
            passReqToCallback: true,
        });
        this.config = config;
        this.prisma = prisma;
    }
    async validate(req, payload) {
        const fromHeader = /^Bearer\s/i.test(req.headers?.authorization ?? '');
        if (payload.typ === 'stream') {
            if (fromHeader || req.method !== 'GET') {
                throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Stream tickets only open event streams' });
            }
        }
        else if (!fromHeader) {
            throw new common_1.UnauthorizedException({
                code: 'UNAUTHORIZED',
                message: 'Session tokens are not accepted in URLs — use a stream ticket',
            });
        }
        const record = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                status: true,
                organizationId: true,
                tokenVersion: true,
            },
        });
        if (!record) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User not found' });
        }
        if (record.status === 'suspended') {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account suspended' });
        }
        if ((payload.tv ?? 0) !== record.tokenVersion) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session expired — sign in again' });
        }
        const { tokenVersion: _tv, ...rest } = record;
        const user = { ...rest, orgId: record.organizationId };
        return payload.imp ? { ...user, imp: payload.imp } : user;
    }
};
exports.JwtStrategy = JwtStrategy;
exports.JwtStrategy = JwtStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], JwtStrategy);
//# sourceMappingURL=jwt.strategy.js.map