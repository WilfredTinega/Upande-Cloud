import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { AuditService } from '../common/audit.service';
export declare class PromoteService {
    private readonly prisma;
    private readonly deployService;
    private readonly audit;
    private readonly docker;
    constructor(prisma: PrismaService, deployService: DeployService, audit: AuditService);
    private load;
    private imageExists;
    private containerHealthy;
    private buildTimeDiff;
    check(organizationId: string, appId: string, previewId: string): Promise<{
        canPromote: boolean;
        reason: string | null;
        branch: string;
        commitSha: string | null;
        imageAvailable: boolean;
        compatible: boolean;
        buildTimeKeys: string[];
        canRebuild: boolean;
    }>;
    private blockReason;
    promote(userId: string, organizationId: string, appId: string, previewId: string, opts: {
        rebuild?: boolean;
    }): Promise<{
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
