export declare const SUBJECT_MAX = 200;
export declare const BODY_MAX = 5000;
export declare const SUPPORT_CATEGORIES: readonly ["issue", "inquiry", "faqs", "custom"];
export type SupportCategoryValue = (typeof SUPPORT_CATEGORIES)[number];
export declare class CreateConversationDto {
    category: SupportCategoryValue;
    title?: string;
    body: string;
}
export declare class SendMessageDto {
    body: string;
}
export declare class AnswerResolutionDto {
    solved: boolean;
}
export declare class ListConversationsQueryDto {
    status?: 'open' | 'closed';
}
export declare class AdminListConversationsQueryDto extends ListConversationsQueryDto {
    unread?: string;
    organizationId?: string;
    category?: SupportCategoryValue;
    q?: string;
}
