import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';
import { LogStoreService } from './log-store.service';
import { DbProvisionService } from '../database/db-provision.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BuildCacheService } from './build-cache.service';
import { GithubReporterService } from '../github/github-reporter.service';
export interface DeployJobData {
    deploymentId: string;
    appId: string;
    ref?: string;
    forceClean?: boolean;
    clearCache?: boolean;
    rollbackImage?: string;
    commitSha?: string;
    previewId?: string;
    promoteFrom?: string;
}
export declare class DeployAbortError extends Error {
}
export declare class DeployCancelledError extends DeployAbortError {
}
export declare function imageRetentionCount(): number;
export declare class DeployProcessor extends WorkerHost {
    private readonly prisma;
    private readonly logStore;
    private readonly dbProvision;
    private readonly notifications;
    private readonly buildCache;
    private readonly githubReporter;
    private docker;
    constructor(prisma: PrismaService, logStore: LogStoreService, dbProvision: DbProvisionService, notifications: NotificationsService, buildCache: BuildCacheService, githubReporter: GithubReporterService);
    process(job: Job<DeployJobData>): Promise<void>;
    private assertStillWanted;
    private healthConfig;
    private checkCandidate;
    private waitHealthy;
    private probe;
    private copyContainerLogs;
    private isAppContainerServing;
    private imageExists;
    private checkoutCommit;
    private pruneOldImages;
    private recordCommit;
    private authenticatedCloneUrl;
    private buildTraefikLabels;
    private buildPreviewLabels;
    private prunePreviewImages;
    private buildImage;
    private checkNixpacks;
    private generateDockerfile;
    private tailNodeRedStartup;
    private ensureImage;
    private writeNodeRedSettings;
    private runDockerBuild;
    private reportBuildCache;
    private runCommand;
    private clearCaches;
    private runCommandSafe;
    private logSync;
    private log;
    private info;
    private stageStart;
    private stageOk;
    private stageFail;
    private debug;
    private elapsed;
    private listDir;
    private markFailed;
    private stopContainerIfExists;
    private snapshotContainer;
    private restoreContainer;
}
export type { HealthConfig } from '../common/health-probe.util';
export declare function demuxDockerLogs(buf: Buffer): string;
export declare const DEFAULT_APP_RESTART_POLICY = "on-failure:5";
export declare function appRestartPolicy(): Docker.HostRestartPolicy;
