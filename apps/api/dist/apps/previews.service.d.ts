import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { AuditService } from '../common/audit.service';
import { DbProvisionService } from '../database/db-provision.service';
export declare function previewMaxPerApp(): number;
export declare function previewMaxPerOrg(): number;
export declare function previewAutoDeploy(): boolean;
export interface PreviewSource {
    userId?: string;
    trigger: 'user' | 'webhook';
    detail?: string;
    commitSha?: string;
    commitMessage?: string;
}
export declare class PreviewsService {
    private readonly prisma;
    private readonly deployService;
    private readonly auditService;
    private readonly dbProvision;
    private readonly logger;
    private readonly docker;
    constructor(prisma: PrismaService, deployService: DeployService, auditService: AuditService, dbProvision: DbProvisionService);
    private findAppForOrg;
    private unsupportedReason;
    private view;
    list(organizationId: string, appId: string): Promise<{
        supported: boolean;
        unsupportedReason: string | null;
        productionBranch: string;
        usesThrowawayDb: boolean;
        autoDeployOnPush: boolean;
        limits: {
            perApp: number;
            perOrg: number;
            orgUsed: number;
        };
        previews: {
            id: string;
            branch: string;
            subdomain: string;
            url: string;
            status: string;
            commitSha: string | null;
            lastDeployedAt: Date | null;
            createdAt: Date;
            hasDatabase: boolean;
            lastDeployment: {
                id: string;
                status: string;
                errorReason: string | null;
                createdAt: Date;
                commitMessage: string | null;
            } | null;
        }[];
    }>;
    deploy(userId: string, organizationId: string, appId: string, branch: string): Promise<{
        preview: {
            id: string;
            branch: string;
            subdomain: string;
            url: string;
            status: string;
            commitSha: string | null;
            lastDeployedAt: Date | null;
            createdAt: Date;
            hasDatabase: boolean;
            lastDeployment: {
                id: string;
                status: string;
                errorReason: string | null;
                createdAt: Date;
                commitMessage: string | null;
            } | null;
        };
        deploymentId: string;
        created: boolean;
    }>;
    deployFromWebhook(appId: string, branch: string, src: Omit<PreviewSource, 'trigger' | 'userId'>): Promise<{
        previewId: string;
        url: string;
    } | {
        skipped: string;
    }>;
    private deployBranch;
    private allocateSubdomain;
    remove(userId: string, organizationId: string, appId: string, previewId: string): Promise<{
        ok: boolean;
    }>;
    removeForBranch(appId: string, branch: string): Promise<boolean>;
    removeAllForApp(appId: string): Promise<void>;
    private teardown;
}
