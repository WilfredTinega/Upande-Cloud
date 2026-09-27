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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const user_purge_service_1 = require("../common/user-purge.service");
const mail_service_1 = require("./mail.service");
const slug_util_1 = require("../common/slug.util");
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
function safeUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        organizationId: user.organizationId,
        mustChangePassword: user.mustChangePassword,
        theme: user.theme ?? null,
        createdAt: user.createdAt,
    };
}
let AuthService = class AuthService {
    constructor(prisma, jwtService, mailService, config, userPurge) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.mailService = mailService;
        this.config = config;
        this.userPurge = userPurge;
    }
    async deleteAccount(userId, dto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account not found' });
        }
        if (user.role === 'superadmin') {
            throw new common_1.ForbiddenException({
                code: 'SUPERADMIN_LOCKED',
                message: 'The superadmin account is managed from the CLI and cannot be deleted here.',
            });
        }
        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Password is incorrect' });
        }
        await this.userPurge.purge(userId);
        return { message: 'Your account and all associated data have been deleted.' };
    }
    async forgotPassword(dto) {
        const email = dto.email.trim().toLowerCase();
        const user = await this.prisma.user.findUnique({ where: { email } });
        const generic = { message: 'If that account exists, a reset link has been sent.' };
        if (!user || user.role === 'superadmin') {
            return generic;
        }
        await this.prisma.passwordResetToken.deleteMany({
            where: { userId: user.id, usedAt: null },
        });
        const token = crypto.randomBytes(32).toString('hex');
        await this.prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash: hashToken(token),
                expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
            },
        });
        const base = this.config.get('DASHBOARD_URL') ?? 'http://localhost:5173';
        const resetUrl = `${base.replace(/\/$/, '')}/reset-password?token=${token}`;
        await this.mailService.sendPasswordReset(email, resetUrl);
        if (!this.mailService.enabled && process.env.NODE_ENV !== 'production') {
            return { ...generic, devResetToken: token, devResetUrl: resetUrl };
        }
        return generic;
    }
    async resetPassword(dto) {
        const record = await this.prisma.passwordResetToken.findUnique({
            where: { tokenHash: hashToken(dto.token) },
        });
        if (!record || record.usedAt || record.expiresAt < new Date()) {
            throw new common_1.BadRequestException({
                code: 'INVALID_TOKEN',
                message: 'This reset link is invalid or has expired. Request a new one.',
            });
        }
        const passwordHash = await bcrypt.hash(dto.password, 10);
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: record.userId },
                data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
            }),
            this.prisma.passwordResetToken.update({
                where: { id: record.id },
                data: { usedAt: new Date() },
            }),
            this.prisma.passwordResetToken.deleteMany({
                where: { userId: record.userId, usedAt: null },
            }),
        ]);
        return { message: 'Password updated. You can now sign in with your new password.' };
    }
    async register(dto) {
        const organization = await this.prisma.organization.findUnique({
            where: { slug: (0, slug_util_1.slugify)(dto.organizationSlug) },
        });
        if (!organization) {
            throw new common_1.BadRequestException({
                code: 'ORG_NOT_FOUND',
                message: 'No organization with that slug. Check the slug or ask your admin to create it.',
            });
        }
        if (organization.status === 'suspended') {
            throw new common_1.ForbiddenException({
                code: 'ORG_SUSPENDED',
                message: 'This organization is suspended and cannot accept new members.',
            });
        }
        const emailTaken = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (emailTaken) {
            throw new common_1.ConflictException({ code: 'CONFLICT', message: 'Email already in use' });
        }
        const usernameTaken = await this.prisma.user.findUnique({
            where: { username: dto.username },
        });
        if (usernameTaken) {
            throw new common_1.ConflictException({ code: 'CONFLICT', message: 'Username already taken' });
        }
        const role = 'user';
        const passwordHash = await bcrypt.hash(dto.password, 10);
        const user = await this.prisma.user.create({
            data: {
                organizationId: organization.id,
                username: dto.username,
                email: dto.email,
                passwordHash,
                role,
                status: 'active',
            },
        });
        const token = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            orgId: user.organizationId,
            tv: user.tokenVersion,
        });
        return { token, user: safeUser(user) };
    }
    async login(dto) {
        const identifier = dto.email.trim().toLowerCase();
        const user = await this.prisma.user.findFirst({
            where: { OR: [{ email: identifier }, { username: identifier }] },
        });
        if (!user) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
        }
        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
        }
        if (user.status === 'suspended') {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account suspended' });
        }
        const token = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            orgId: user.organizationId,
            tv: user.tokenVersion,
        });
        return { token, user: safeUser(user) };
    }
    async me(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                status: true,
                organizationId: true,
                mustChangePassword: true,
                theme: true,
                createdAt: true,
            },
        });
        return { user };
    }
    async streamTicket(user) {
        const rec = await this.prisma.user.findUnique({ where: { id: user.id }, select: { tokenVersion: true } });
        const ticket = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            orgId: user.organizationId,
            tv: rec?.tokenVersion ?? 0,
            typ: 'stream',
            ...(user.imp ? { imp: user.imp } : {}),
        }, { expiresIn: '60s' });
        return { ticket, expiresIn: 60 };
    }
    async updatePreferences(userId, dto) {
        await this.prisma.user.update({ where: { id: userId }, data: { theme: dto.theme } });
        return { theme: dto.theme };
    }
    async changePassword(userId, dto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new common_1.UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account not found' });
        }
        const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
        if (!valid) {
            throw new common_1.UnauthorizedException({
                code: 'UNAUTHORIZED',
                message: 'Current password is incorrect',
            });
        }
        if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
            throw new common_1.BadRequestException({
                code: 'SAME_PASSWORD',
                message: 'The new password must be different from the current one.',
            });
        }
        const passwordHash = await bcrypt.hash(dto.newPassword, 10);
        const updated = await this.prisma.user.update({
            where: { id: userId },
            data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
        });
        const token = this.jwtService.sign({
            sub: updated.id,
            email: updated.email,
            role: updated.role,
            orgId: updated.organizationId,
            tv: updated.tokenVersion,
        });
        return { token, user: safeUser(updated) };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        mail_service_1.MailService,
        config_1.ConfigService,
        user_purge_service_1.UserPurgeService])
], AuthService);
//# sourceMappingURL=auth.service.js.map