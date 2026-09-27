import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SupportService } from './support.service';
import { SupportEventsService } from './support-events.service';
import { AnswerResolutionDto, CreateConversationDto, ListConversationsQueryDto, SendMessageDto } from './dto/support.dto';
interface AuthUser {
    id: string;
    username: string;
    organizationId: string;
    role: string;
    imp?: {
        by: string;
        email: string;
    };
}
export declare class SupportController {
    private readonly support;
    private readonly events;
    constructor(support: SupportService, events: SupportEventsService);
    private assertNotImpersonating;
    private actor;
    stream(user: AuthUser): Observable<MessageEvent>;
    unread(user: AuthUser): Promise<{
        unreadCount: number;
    }>;
    list(user: AuthUser, query: ListConversationsQueryDto): Promise<{
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
    create(user: AuthUser, dto: CreateConversationDto): Promise<{
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
    send(user: AuthUser, id: string, dto: SendMessageDto): Promise<{
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
    resolution(user: AuthUser, id: string, dto: AnswerResolutionDto): Promise<{
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
}
export {};
