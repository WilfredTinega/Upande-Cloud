import { PromoteService } from './promote.service';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class PromotePreviewDto {
    rebuild?: boolean;
}
export declare class PromoteController {
    private readonly promoteService;
    constructor(promoteService: PromoteService);
    check(user: AuthUser, id: string, previewId: string): Promise<{
        canPromote: boolean;
        reason: string | null;
        branch: string;
        commitSha: string | null;
        imageAvailable: boolean;
        compatible: boolean;
        buildTimeKeys: string[];
        canRebuild: boolean;
    }>;
    promote(user: AuthUser, id: string, previewId: string, dto: PromotePreviewDto): Promise<{
        deployment: {
            id: string;
            appId: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.DeploymentStatus;
            imageRef: string | null;
            commitSha: string | null;
            ref: string | null;
            logsRef: string | null;
            trigger: import(".prisma/client").$Enums.DeploymentTrigger | null;
            triggeredByUserId: string | null;
            deployTokenId: string | null;
            triggerDetail: string | null;
            commitMessage: string | null;
            forceClean: boolean;
            startedAt: Date | null;
            finishedAt: Date | null;
            errorReason: string | null;
            rollbackOfId: string | null;
            previewId: string | null;
        };
        reuseImage: boolean;
    }>;
}
export {};
