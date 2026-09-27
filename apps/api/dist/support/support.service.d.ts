import { SupportCategory, SupportConversationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { SupportEventsService } from './support-events.service';
export declare const SUPPORT_DISPLAY_NAME = "Upande Support";
export declare const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string>;
export declare const RESOLUTION_QUESTION: Record<SupportCategory, string>;
export type SupportSide = 'user' | 'admin';
export interface SupportActor {
    id: string;
    username?: string;
    organizationId: string;
}
export declare class SupportService {
    private readonly prisma;
    private readonly audit;
    private readonly events;
    private readonly logger;
    private readonly sendLog;
    constructor(prisma: PrismaService, audit: AuditService, events: SupportEventsService);
    private userMessage;
    private adminMessage;
    private userConversation;
    private adminConversation;
    private rateLimit;
    private notFound;
    private load;
    private publishConversation;
    private publishMessage;
    private notifyOtherSide;
    private clearNotifications;
    private addMessage;
    listForOrg(organizationId: string, status?: SupportConversationStatus): Promise<{
        conversations: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            unreadCount: number;
            createdBy: {
                id: string;
                username: string;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        }[];
        unreadTotal: number;
    }>;
    unreadForOrg(organizationId: string): Promise<{
        unreadCount: number;
    }>;
    createForUser(actor: SupportActor, category: SupportCategory, title: string | undefined, body: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            unreadCount: number;
            createdBy: {
                id: string;
                username: string;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
    }>;
    getForUser(actor: SupportActor, id: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            unreadCount: number;
            createdBy: {
                id: string;
                username: string;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
        messages: {
            id: string;
            conversationId: string;
            body: string;
            kind: import(".prisma/client").$Enums.SupportMessageKind;
            answer: boolean | null;
            createdAt: Date;
            authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
            authorName: string;
            authorUserId: string | null;
            mine: boolean;
        }[];
    }>;
    sendAsUser(actor: SupportActor, id: string, body: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            unreadCount: number;
            createdBy: {
                id: string;
                username: string;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
        message: {
            id: string;
            conversationId: string;
            body: string;
            kind: import(".prisma/client").$Enums.SupportMessageKind;
            answer: boolean | null;
            createdAt: Date;
            authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
            authorName: string;
            authorUserId: string | null;
            mine: boolean;
        };
    }>;
    markReadAsUser(actor: SupportActor, id: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            unreadCount: number;
            createdBy: {
                id: string;
                username: string;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
    }>;
    setStatusAsUser(actor: SupportActor, id: string, status: SupportConversationStatus): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            unreadCount: number;
            createdBy: {
                id: string;
                username: string;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
    }>;
    answerResolutionAsUser(actor: SupportActor, id: string, solved: boolean): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            unreadCount: number;
            createdBy: {
                id: string;
                username: string;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
        message: {
            id: string;
            conversationId: string;
            body: string;
            kind: import(".prisma/client").$Enums.SupportMessageKind;
            answer: boolean | null;
            createdAt: Date;
            authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
            authorName: string;
            authorUserId: string | null;
            mine: boolean;
        };
    }>;
    askResolutionAsAdmin(actor: SupportActor, id: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            resolvedBy: {
                id: string;
                username: string;
            } | null;
            unreadCount: number;
            userUnreadCount: number;
            organization: {
                id: string;
                name: string;
                slug: string;
            };
            createdBy: {
                id: string;
                username: string;
                email: string;
                role: import(".prisma/client").$Enums.UserRole;
                status: import(".prisma/client").$Enums.UserStatus;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
        message: {
            id: string;
            conversationId: string;
            body: string;
            kind: import(".prisma/client").$Enums.SupportMessageKind;
            answer: boolean | null;
            createdAt: Date;
            authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
            authorName: string;
            authorEmail: string | null;
            authorUserId: string | null;
            mine: boolean;
            byMe: boolean;
        };
    }>;
    listForAdmin(filters: {
        status?: SupportConversationStatus;
        unread?: boolean;
        organizationId?: string;
        category?: SupportCategory;
        q?: string;
    }): Promise<{
        conversations: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            resolvedBy: {
                id: string;
                username: string;
            } | null;
            unreadCount: number;
            userUnreadCount: number;
            organization: {
                id: string;
                name: string;
                slug: string;
            };
            createdBy: {
                id: string;
                username: string;
                email: string;
                role: import(".prisma/client").$Enums.UserRole;
                status: import(".prisma/client").$Enums.UserStatus;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        }[];
        unreadTotal: number;
    }>;
    unreadForAdmin(): Promise<{
        unreadCount: number;
    }>;
    getForAdmin(actor: SupportActor, id: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            resolvedBy: {
                id: string;
                username: string;
            } | null;
            unreadCount: number;
            userUnreadCount: number;
            organization: {
                id: string;
                name: string;
                slug: string;
            };
            createdBy: {
                id: string;
                username: string;
                email: string;
                role: import(".prisma/client").$Enums.UserRole;
                status: import(".prisma/client").$Enums.UserStatus;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
        messages: {
            id: string;
            conversationId: string;
            body: string;
            kind: import(".prisma/client").$Enums.SupportMessageKind;
            answer: boolean | null;
            createdAt: Date;
            authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
            authorName: string;
            authorEmail: string | null;
            authorUserId: string | null;
            mine: boolean;
            byMe: boolean;
        }[];
    }>;
    replyAsAdmin(actor: SupportActor, id: string, body: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            resolvedBy: {
                id: string;
                username: string;
            } | null;
            unreadCount: number;
            userUnreadCount: number;
            organization: {
                id: string;
                name: string;
                slug: string;
            };
            createdBy: {
                id: string;
                username: string;
                email: string;
                role: import(".prisma/client").$Enums.UserRole;
                status: import(".prisma/client").$Enums.UserStatus;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
        message: {
            id: string;
            conversationId: string;
            body: string;
            kind: import(".prisma/client").$Enums.SupportMessageKind;
            answer: boolean | null;
            createdAt: Date;
            authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
            authorName: string;
            authorEmail: string | null;
            authorUserId: string | null;
            mine: boolean;
            byMe: boolean;
        };
    }>;
    markReadAsAdmin(actor: SupportActor, id: string): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            resolvedBy: {
                id: string;
                username: string;
            } | null;
            unreadCount: number;
            userUnreadCount: number;
            organization: {
                id: string;
                name: string;
                slug: string;
            };
            createdBy: {
                id: string;
                username: string;
                email: string;
                role: import(".prisma/client").$Enums.UserRole;
                status: import(".prisma/client").$Enums.UserStatus;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
    }>;
    setStatusAsAdmin(actor: SupportActor, id: string, status: SupportConversationStatus): Promise<{
        conversation: {
            id: string;
            reference: string;
            category: import(".prisma/client").$Enums.SupportCategory;
            title: string;
            subject: string;
            status: import(".prisma/client").$Enums.SupportConversationStatus;
            createdAt: Date;
            lastMessageAt: Date;
            closedAt: Date | null;
            resolution: import(".prisma/client").$Enums.SupportResolution | null;
            resolvedAt: Date | null;
            resolvedBy: {
                id: string;
                username: string;
            } | null;
            unreadCount: number;
            userUnreadCount: number;
            organization: {
                id: string;
                name: string;
                slug: string;
            };
            createdBy: {
                id: string;
                username: string;
                email: string;
                role: import(".prisma/client").$Enums.UserRole;
                status: import(".prisma/client").$Enums.UserStatus;
            } | null;
            lastMessage: {
                preview: string;
                kind: import(".prisma/client").$Enums.SupportMessageKind;
                authorRole: import(".prisma/client").$Enums.SupportAuthorRole;
                authorName: string;
                createdAt: Date;
            } | null;
        };
    }>;
    private setStatus;
}
