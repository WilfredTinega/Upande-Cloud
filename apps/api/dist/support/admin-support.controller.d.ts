import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SupportService } from './support.service';
import { SupportEventsService } from './support-events.service';
import { AdminListConversationsQueryDto, SendMessageDto } from './dto/support.dto';
interface AuthUser {
    id: string;
    username?: string;
    organizationId: string;
    role: string;
}
export declare class AdminSupportController {
    private readonly support;
    private readonly events;
    constructor(support: SupportService, events: SupportEventsService);
    private actor;
    stream(): Observable<MessageEvent>;
    unread(): Promise<{
        unreadCount: number;
    }>;
    list(query: AdminListConversationsQueryDto): Promise<{
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
    get(user: AuthUser, id: string): Promise<{
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
    reply(user: AuthUser, id: string, dto: SendMessageDto): Promise<{
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
    askResolution(user: AuthUser, id: string): Promise<{
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
    markRead(user: AuthUser, id: string): Promise<{
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
    close(user: AuthUser, id: string): Promise<{
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
    reopen(user: AuthUser, id: string): Promise<{
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
}
export {};
