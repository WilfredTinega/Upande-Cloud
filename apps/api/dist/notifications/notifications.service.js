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
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let NotificationsService = class NotificationsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(params) {
        return this.prisma.notification.create({
            data: {
                userId: params.userId,
                organizationId: params.organizationId ?? null,
                type: params.type,
                message: params.message,
                metadata: params.metadata ?? client_1.Prisma.JsonNull,
            },
        });
    }
    async listDeploymentFailures(organizationId, limit = 100) {
        const notifications = await this.prisma.notification.findMany({
            where: {
                type: 'deployment_failed',
                ...(organizationId ? { organizationId } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                user: { select: { email: true } },
            },
        });
        return { notifications };
    }
    async listUnread(userId) {
        const notifications = await this.prisma.notification.findMany({
            where: { userId, readAt: null },
            orderBy: { createdAt: 'desc' },
        });
        return { notifications };
    }
    async listRecent(userId, limit = 50) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const todayWhere = { userId, createdAt: { gte: startOfToday } };
        const [notifications, unreadCount] = await Promise.all([
            this.prisma.notification.findMany({
                where: todayWhere,
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
            this.prisma.notification.count({
                where: { ...todayWhere, readAt: null },
            }),
        ]);
        return { notifications, unreadCount };
    }
    async listUserDeploymentFailures(userId, limit = 100) {
        const notifications = await this.prisma.notification.findMany({
            where: { userId, type: 'deployment_failed' },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return { notifications };
    }
    async getOne(userId, id) {
        return this.prisma.notification.findFirst({
            where: { id, userId },
        });
    }
    async markRead(userId, id) {
        const res = await this.prisma.notification.updateMany({
            where: { id, userId, readAt: null },
            data: { readAt: new Date() },
        });
        return { cleared: res.count };
    }
    async markAllRead(userId) {
        const res = await this.prisma.notification.updateMany({
            where: { userId, readAt: null },
            data: { readAt: new Date() },
        });
        return { cleared: res.count };
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map