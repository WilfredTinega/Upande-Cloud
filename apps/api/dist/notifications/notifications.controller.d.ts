import { NotificationsService } from './notifications.service';
interface AuthUser {
    id: string;
    imp?: {
        by: string;
        email: string;
    };
}
export declare class NotificationsController {
    private readonly notifications;
    constructor(notifications: NotificationsService);
    private assertNotImpersonating;
    list(user: AuthUser): Promise<{
        notifications: {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            readAt: Date | null;
            userId: string;
        }[];
        unreadCount: number;
    }>;
    listDeploymentFailures(user: AuthUser): Promise<{
        notifications: {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            readAt: Date | null;
            userId: string;
        }[];
    }>;
    getOne(user: AuthUser, id: string): Promise<{
        notification: {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            readAt: Date | null;
            userId: string;
        };
    }>;
    markRead(user: AuthUser, id: string): Promise<{
        cleared: number;
    }>;
    markAllRead(user: AuthUser): Promise<{
        cleared: number;
    }>;
}
export {};
