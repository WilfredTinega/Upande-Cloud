export declare const PREVIEW_AUTH_LABEL = "upande.preview-auth";
export declare function previewAuthMiddleware(previewSubdomain: string): string;
export declare function previewAuthLabels(previewSubdomain: string, protection: {
    username: string;
    passwordHash: string;
} | null | undefined): Record<string, string>;
export declare function withoutPreviewAuthLabels(labels: Record<string, string>, previewSubdomain: string): Record<string, string>;
export declare function applyPreviewAuth(labels: Record<string, string>, previewSubdomain: string, protection: {
    username: string;
    passwordHash: string;
} | null | undefined): Record<string, string>;
export declare function withRetryMiddleware(labels: Record<string, string>, name: string): Record<string, string>;
