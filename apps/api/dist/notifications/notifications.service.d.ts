import { Prisma, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export declare class NotificationsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(params: {
        userId: string;
        organizationId?: string | null;
        type: NotificationType;
        message: string;
        metadata?: Prisma.InputJsonValue;
    }): Promise<{
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        organizationId: string | null;
        message: string;
        metadata: Prisma.JsonValue | null;
        readAt: Date | null;
        userId: string;
    }>;
    listDeploymentFailures(organizationId?: string, limit?: number): Promise<{
        notifications: ({
            user: {
                email: string;
            };
        } & {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: Prisma.JsonValue | null;
            readAt: Date | null;
            userId: string;
        })[];
    }>;
    listUnread(userId: string): Promise<{
        notifications: {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: Prisma.JsonValue | null;
            readAt: Date | null;
            userId: string;
        }[];
    }>;
    listRecent(userId: string, limit?: number): Promise<{
        notifications: {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: Prisma.JsonValue | null;
            readAt: Date | null;
            userId: string;
        }[];
        unreadCount: number;
    }>;
    listUserDeploymentFailures(userId: string, limit?: number): Promise<{
        notifications: {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: Prisma.JsonValue | null;
            readAt: Date | null;
            userId: string;
        }[];
    }>;
    getOne(userId: string, id: string): Promise<{
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        organizationId: string | null;
        message: string;
        metadata: Prisma.JsonValue | null;
        readAt: Date | null;
        userId: string;
    } | null>;
    markRead(userId: string, id: string): Promise<{
        cleared: number;
    }>;
    markAllRead(userId: string): Promise<{
        cleared: number;
    }>;
}
