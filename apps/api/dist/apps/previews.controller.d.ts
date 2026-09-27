import { PreviewsService } from './previews.service';
import { DeployPreviewDto } from './dto/preview.dto';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class PreviewsController {
    private readonly previews;
    constructor(previews: PreviewsService);
    list(user: AuthUser, id: string): Promise<{
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
    deploy(user: AuthUser, id: string, dto: DeployPreviewDto): Promise<{
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
    remove(user: AuthUser, id: string, previewId: string): Promise<{
        ok: boolean;
    }>;
}
export {};
