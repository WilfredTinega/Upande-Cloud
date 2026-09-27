import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AppsService } from './apps.service';
import { GithubService } from '../github/github.service';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { DeployDto } from './dto/deploy.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { AddDomainDto } from './dto/add-domain.dto';
import { SetDomainTargetDto } from './dto/set-domain-target.dto';
import { ListDeploymentsQueryDto } from './dto/deployments.dto';
import { AddNodeRedUserDto, UpdateNodeRedUserDto } from './dto/nodered-user.dto';
import { Request } from 'express';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class AppsController {
    private readonly appsService;
    private readonly githubService;
    constructor(appsService: AppsService, githubService: GithubService);
    listApps(user: AuthUser): Promise<{
        apps: {
            url: string;
            project: {
                id: string;
                name: string;
                slug: string;
            };
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        }[];
    }>;
    createApp(user: AuthUser, dto: CreateAppDto): Promise<{
        app: {
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        };
        webhook: {
            installed: boolean;
            error?: undefined;
        };
        noderedAdminPassword?: undefined;
    } | {
        app: {
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        };
        webhook: {
            installed: boolean;
            error: string;
        };
        noderedAdminPassword?: undefined;
    } | {
        app: {
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        };
        noderedAdminPassword: string | undefined;
        webhook?: undefined;
    }>;
    getApp(user: AuthUser, id: string): Promise<{
        app: {
            url: string;
            createdBy: string | null;
            project: {
                organizationId: string;
            };
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        };
        deployments: {
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
        }[];
    }>;
    adminLogin(user: AuthUser, id: string): Promise<{
        mode: "redirect";
        redirectUrl: string;
    }>;
    updateApp(user: AuthUser, id: string, dto: UpdateAppDto): Promise<{
        app: {
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        };
        redeployRequired: boolean;
    }>;
    deleteApp(user: AuthUser, id: string): Promise<{
        ok: boolean;
    }>;
    uploadSource(user: AuthUser, id: string, files: Array<{
        originalname: string;
        buffer: Buffer;
    }>, pathsJson: string): Promise<{
        ok: boolean;
        files: number;
    }>;
    deploy(req: Request & {
        user: AuthUser;
        deployTokenApp?: string;
        deployTokenId?: string;
    }, id: string, dto: DeployDto): Promise<{
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
    }>;
    buildCache(user: AuthUser, id: string): Promise<{
        buildkit: boolean;
        sizeBytes: number;
        entries: number;
    }>;
    migrate(user: AuthUser, id: string, dto: DeployDto): Promise<{
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
    }>;
    streamLogs(user: AuthUser, id: string): Observable<MessageEvent>;
    listDeployments(user: AuthUser, id: string, query: ListDeploymentsQueryDto): Promise<{
        deployments: {
            rollbackOf: {
                id: string;
                commitSha: string | null;
            } | null;
            isCurrent: boolean;
            imageAvailable: boolean;
            canRollback: boolean;
            id: string;
            appId: string;
            ref: string | null;
            branch: string | null;
            status: string;
            imageRef: string | null;
            createdAt: Date;
            trigger: string | null;
            triggerDetail: string | null;
            deployTokenId: string | null;
            triggeredBy: {
                id: string;
                username: string;
                email: string;
            } | null;
            commitSha: string | null;
            commitMessage: string | null;
            forceClean: boolean;
            startedAt: Date | null;
            finishedAt: Date | null;
            durationMs: number | null;
            errorReason: string | null;
            logPersisted: boolean;
            logTruncated: boolean;
        }[];
        nextCursor: string | null;
    }>;
    rollback(user: AuthUser, id: string, deploymentId: string): Promise<{
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
    deploymentLog(user: AuthUser, id: string, deploymentId: string): Promise<{
        status: string;
        ref: string | null;
        createdAt: Date;
        lines: string[];
    }>;
    stopApp(user: AuthUser, id: string): Promise<{
        app: {
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        };
    }>;
    cancelApp(user: AuthUser, id: string): Promise<{
        app: {
            id: string;
            createdAt: Date;
            name: string;
            subdomain: string;
            branch: string | null;
            status: import(".prisma/client").$Enums.AppStatus;
            type: import(".prisma/client").$Enums.AppType;
            projectId: string;
            source: import(".prisma/client").$Enums.AppSource;
            repoUrl: string | null;
            buildCmd: string | null;
            outputDir: string | null;
            githubRepoFullName: string | null;
            githubWebhookId: string | null;
            webhookSecret: string | null;
            noderedVolumeName: string | null;
            noderedPort: number | null;
            noderedAdminPasswordEnc: string | null;
            healthCheckPath: string | null;
            healthCheckTimeout: number;
            healthCheckRetries: number;
            githubCommitStatus: boolean;
            githubPrComments: boolean;
        };
    }>;
    restartApp(user: AuthUser, id: string): Promise<{
        ok: boolean;
    }>;
    containerStatus(user: AuthUser, id: string): Promise<{
        exists: false;
        state?: undefined;
        running?: undefined;
        restarting?: undefined;
        crashed?: undefined;
        restartCount?: undefined;
        exitCode?: undefined;
        oomKilled?: undefined;
        error?: undefined;
        startedAt?: undefined;
        finishedAt?: undefined;
        restartPolicy?: undefined;
        maxRetries?: undefined;
        restartsExhausted?: undefined;
        placeholder?: undefined;
    } | {
        exists: true;
        state: string;
        running: boolean;
        restarting: boolean;
        crashed: boolean;
        restartCount: number;
        exitCode: number;
        oomKilled: boolean;
        error: string | null;
        startedAt: string;
        finishedAt: string | null;
        restartPolicy: string | null;
        maxRetries: number | null;
        restartsExhausted: boolean;
        placeholder: boolean;
    }>;
    runtimeLogs(user: AuthUser, id: string): Promise<{
        running: boolean;
        lines: string[];
    }>;
    createToken(user: AuthUser, id: string, dto: CreateTokenDto): Promise<{
        token: string;
        id: string;
        name: string;
    }>;
    listTokens(user: AuthUser, id: string): Promise<{
        tokens: {
            id: string;
            name: string;
            lastUsedAt: Date | null;
        }[];
    }>;
    listDomains(user: AuthUser, id: string): Promise<{
        domains: {
            id: string;
            domain: string;
            status: string;
            verifiedAt: Date | null;
            createdAt: Date;
            ownershipMethod: "platform-dns" | "txt";
            hostedZone: string | null;
            autoConfigured: boolean;
            autoRecord: {
                host: string;
                type: string;
                value: string;
                values: string[];
            } | null;
            serverIp: string | null;
            lastCheck: import("./apps.service").DomainCheck | null;
            instructions: {
                txtRecord: {
                    host: string;
                    type: string;
                    value: string;
                };
                routeRecord: {
                    host: string;
                    type: "A" | "AAAA" | "CNAME";
                    value: string | null;
                    apex: boolean;
                    note: string | null;
                };
            };
        }[];
    }>;
    addDomain(user: AuthUser, id: string, dto: AddDomainDto): Promise<{
        domain: {
            id: string;
            domain: string;
            status: string;
            verifiedAt: Date | null;
            createdAt: Date;
            ownershipMethod: "platform-dns" | "txt";
            hostedZone: string | null;
            autoConfigured: boolean;
            autoRecord: {
                host: string;
                type: string;
                value: string;
                values: string[];
            } | null;
            serverIp: string | null;
            lastCheck: import("./apps.service").DomainCheck | null;
            instructions: {
                txtRecord: {
                    host: string;
                    type: string;
                    value: string;
                };
                routeRecord: {
                    host: string;
                    type: "A" | "AAAA" | "CNAME";
                    value: string | null;
                    apex: boolean;
                    note: string | null;
                };
            };
        };
        verified: boolean;
        message: string;
    } | {
        domain: {
            id: string;
            domain: string;
            status: string;
            verifiedAt: Date | null;
            createdAt: Date;
            ownershipMethod: "platform-dns" | "txt";
            hostedZone: string | null;
            autoConfigured: boolean;
            autoRecord: {
                host: string;
                type: string;
                value: string;
                values: string[];
            } | null;
            serverIp: string | null;
            lastCheck: import("./apps.service").DomainCheck | null;
            instructions: {
                txtRecord: {
                    host: string;
                    type: string;
                    value: string;
                };
                routeRecord: {
                    host: string;
                    type: "A" | "AAAA" | "CNAME";
                    value: string | null;
                    apex: boolean;
                    note: string | null;
                };
            };
        };
        verified?: undefined;
        message?: undefined;
    }>;
    verifyDomain(user: AuthUser, id: string, domainId: string): Promise<{
        domain: {
            id: string;
            domain: string;
            status: string;
            verifiedAt: Date | null;
            createdAt: Date;
            ownershipMethod: "platform-dns" | "txt";
            hostedZone: string | null;
            autoConfigured: boolean;
            autoRecord: {
                host: string;
                type: string;
                value: string;
                values: string[];
            } | null;
            serverIp: string | null;
            lastCheck: import("./apps.service").DomainCheck | null;
            instructions: {
                txtRecord: {
                    host: string;
                    type: string;
                    value: string;
                };
                routeRecord: {
                    host: string;
                    type: "A" | "AAAA" | "CNAME";
                    value: string | null;
                    apex: boolean;
                    note: string | null;
                };
            };
        };
        verified: boolean;
        message: string;
    }>;
    removeDomain(user: AuthUser, id: string, domainId: string): Promise<{
        message?: string | undefined;
        ok: boolean;
        recordRemoved: boolean;
    }>;
    setDomainTarget(user: AuthUser, id: string, domainId: string, dto: SetDomainTargetDto): Promise<{
        ok: boolean;
        confirmRequired: boolean;
        existing: import("../dns/dns.service").RoutingRRSet[];
        message: string;
        domain?: undefined;
    } | {
        ok: boolean;
        message: string;
        domain: {
            id: string;
            domain: string;
            status: string;
            verifiedAt: Date | null;
            createdAt: Date;
            ownershipMethod: "platform-dns" | "txt";
            hostedZone: string | null;
            autoConfigured: boolean;
            autoRecord: {
                host: string;
                type: string;
                value: string;
                values: string[];
            } | null;
            serverIp: string | null;
            lastCheck: import("./apps.service").DomainCheck | null;
            instructions: {
                txtRecord: {
                    host: string;
                    type: string;
                    value: string;
                };
                routeRecord: {
                    host: string;
                    type: "A" | "AAAA" | "CNAME";
                    value: string | null;
                    apex: boolean;
                    note: string | null;
                };
            };
        };
        confirmRequired?: undefined;
        existing?: undefined;
    }>;
    domainStatus(user: AuthUser, id: string, domainId: string, refresh?: string): Promise<import("./apps.service").DomainStatus>;
    listNodeRedUsers(user: AuthUser, id: string): Promise<{
        users: {
            id: string;
            createdAt: Date;
            username: string;
            permission: string;
        }[];
    }>;
    addNodeRedUser(user: AuthUser, id: string, dto: AddNodeRedUserDto): Promise<{
        user: {
            id: string;
            createdAt: Date;
            username: string;
            permission: string;
        };
        applied: {
            restarted: boolean;
        };
    }>;
    updateNodeRedUser(user: AuthUser, id: string, nodeRedUserId: string, dto: UpdateNodeRedUserDto): Promise<{
        user: {
            id: string;
            createdAt: Date;
            username: string;
            permission: string;
        };
        applied: {
            restarted: boolean;
        };
    }>;
    removeNodeRedUser(user: AuthUser, id: string, nodeRedUserId: string): Promise<{
        ok: boolean;
        applied: {
            restarted: boolean;
        };
    }>;
}
export {};
