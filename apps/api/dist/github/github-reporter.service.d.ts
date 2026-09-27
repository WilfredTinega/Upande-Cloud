import { PrismaService } from '../prisma/prisma.service';
import { GithubConfigService } from './github-config.service';
export type CommitState = 'pending' | 'success' | 'failure' | 'error';
type LogFn = (line: string) => Promise<void> | void;
export declare const STATUS_CONTEXT_PRODUCTION = "Upande Cloud \u2014 production";
export declare const STATUS_CONTEXT_PREVIEW = "Upande Cloud \u2014 preview";
export declare class GithubReporterService {
    private readonly prisma;
    private readonly ghConfig;
    private readonly logger;
    constructor(prisma: PrismaService, ghConfig: GithubConfigService);
    private dashboardUrl;
    deploymentUrl(appId: string, deploymentId: string): string;
    private request;
    private tokenFor;
    reportDeployment(deploymentId: string, state: CommitState, opts?: {
        reason?: string;
        log?: LogFn;
    }): Promise<void>;
    findOpenPr(token: string, repo: string, branch: string): Promise<number | null>;
    private commentBody;
    private upsertPreviewComment;
    markPreviewRemoved(p: {
        appId: string;
        appName: string;
        ownerUserId: string;
        repo: string;
        previewId: string;
        branch: string;
        commentId: string | null;
        enabled: boolean;
    }): Promise<void>;
}
export {};
