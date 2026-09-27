import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { BuildCacheService } from '../deploy/build-cache.service';
import { DbProvisionService } from '../database/db-provision.service';
import { LogStoreService } from '../deploy/log-store.service';
import { AuditService } from '../common/audit.service';
import { PreviewsService } from './previews.service';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { DeployDto } from './dto/deploy.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { AddDomainDto } from './dto/add-domain.dto';
import { DnsService, RoutingRRSet } from '../dns/dns.service';
import { PlatformNetworkService } from '../dns/platform-network.service';
import { SetDomainTargetDto } from './dto/set-domain-target.dto';
import { AddNodeRedUserDto, UpdateNodeRedUserDto } from './dto/nodered-user.dto';
import { Observable } from 'rxjs';
export interface DeploySource {
    trigger: 'api_token' | 'webhook';
    deployTokenId?: string;
    detail?: string;
    commitSha?: string;
    commitMessage?: string;
}
export declare class AppsService {
    private readonly prisma;
    private readonly deployService;
    private readonly logStore;
    private readonly auditService;
    private readonly dnsService;
    private readonly network;
    private readonly previews;
    private readonly buildCache;
    private readonly dbProvision;
    constructor(prisma: PrismaService, deployService: DeployService, logStore: LogStoreService, auditService: AuditService, dnsService: DnsService, network: PlatformNetworkService, previews: PreviewsService, buildCache: BuildCacheService, dbProvision: DbProvisionService);
    listApps(userId: string, organizationId: string): Promise<{
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
    createApp(userId: string, organizationId: string, dto: CreateAppDto): Promise<{
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
    }>;
    getApp(userId: string, organizationId: string, appId: string): Promise<{
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
    getAdminLogin(userId: string, organizationId: string, appId: string): Promise<{
        mode: "redirect";
        redirectUrl: string;
    }>;
    private noderedAccessToken;
    private findNodeRedApp;
    listNodeRedUsers(organizationId: string, appId: string): Promise<{
        users: {
            id: string;
            createdAt: Date;
            username: string;
            permission: string;
        }[];
    }>;
    addNodeRedUser(userId: string, organizationId: string, appId: string, dto: AddNodeRedUserDto): Promise<{
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
    updateNodeRedUser(userId: string, organizationId: string, appId: string, nodeRedUserId: string, dto: UpdateNodeRedUserDto): Promise<{
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
    removeNodeRedUser(userId: string, organizationId: string, appId: string, nodeRedUserId: string): Promise<{
        ok: boolean;
        applied: {
            restarted: boolean;
        };
    }>;
    private applyNodeRedAccounts;
    private writeNodeRedSettings;
    uploadSource(userId: string, organizationId: string, appId: string, files: Array<{
        relPath: string;
        buffer: Buffer;
    }>): Promise<{
        ok: boolean;
        files: number;
    }>;
    updateApp(userId: string, organizationId: string, appId: string, dto: UpdateAppDto): Promise<{
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
    getBuildCache(organizationId: string, appId: string): Promise<{
        buildkit: boolean;
        sizeBytes: number;
        entries: number;
    }>;
    deleteApp(userId: string, organizationId: string, appId: string): Promise<{
        ok: boolean;
        githubRepoFullName: string | null;
        githubWebhookId: string | null;
    }>;
    attachWebhook(appId: string, organizationId: string, repoFullName: string, webhookId: string, webhookSecret: string): Promise<{
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
    }>;
    deploy(userId: string, organizationId: string, appId: string, dto: DeployDto): Promise<{
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
    migrate(userId: string, organizationId: string, appId: string, dto: DeployDto): Promise<{
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
    deployByToken(appId: string, dto: DeployDto, source?: DeploySource): Promise<{
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
    listDeployments(organizationId: string, appId: string, opts?: {
        take?: number;
        before?: string;
    }): Promise<{
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
    private localImageTags;
    rollback(userId: string, organizationId: string, appId: string, deploymentId: string): Promise<{
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
    private deploymentView;
    streamLogs(organizationId: string, appId: string): Observable<{
        data: string;
    }>;
    getDeploymentLog(organizationId: string, appId: string, deploymentId: string): Promise<{
        status: string;
        ref: string | null;
        createdAt: Date;
        lines: string[];
    }>;
    stopApp(userId: string, organizationId: string, appId: string): Promise<{
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
    cancelApp(userId: string, organizationId: string, appId: string): Promise<{
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
    restartApp(userId: string, organizationId: string, appId: string): Promise<{
        ok: boolean;
    }>;
    getContainerStatus(organizationId: string, appId: string): Promise<{
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
    getRuntimeLogs(organizationId: string, appId: string, tail?: number): Promise<{
        running: boolean;
        lines: string[];
    }>;
    createToken(userId: string, organizationId: string, appId: string, dto: CreateTokenDto): Promise<{
        token: string;
        id: string;
        name: string;
    }>;
    listTokens(userId: string, organizationId: string, appId: string): Promise<{
        tokens: {
            id: string;
            name: string;
            lastUsedAt: Date | null;
        }[];
    }>;
    listDomains(organizationId: string, appId: string): Promise<{
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
            lastCheck: DomainCheck | null;
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
    addDomain(userId: string, organizationId: string, appId: string, dto: AddDomainDto): Promise<{
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
            lastCheck: DomainCheck | null;
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
            lastCheck: DomainCheck | null;
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
    verifyDomain(userId: string, organizationId: string, appId: string, domainId: string): Promise<{
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
            lastCheck: DomainCheck | null;
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
    removeDomain(userId: string, organizationId: string, appId: string, domainId: string): Promise<{
        message?: string | undefined;
        ok: boolean;
        recordRemoved: boolean;
    }>;
    private readonly statusCache;
    private static readonly STATUS_TTL_MS;
    private static readonly STATUS_MIN_REFRESH_MS;
    setDomainTarget(userId: string, organizationId: string, appId: string, domainId: string, dto: SetDomainTargetDto): Promise<{
        ok: boolean;
        confirmRequired: boolean;
        existing: RoutingRRSet[];
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
            lastCheck: DomainCheck | null;
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
    domainStatus(organizationId: string, appId: string, domainId: string, refresh?: boolean): Promise<DomainStatus>;
    private managedRecordInPlace;
    private hostedZoneFor;
    private checkDomain;
    private configureRoutingRecord;
    private checkRouting;
    private checkDelegation;
    private domainView;
    private findAppForOrg;
    private stopContainer;
    private removeVolume;
    private removeAppImages;
    private startMaintenanceContainer;
    private ensureImage;
}
export interface DomainStatus {
    domainId: string;
    domain: string;
    checkedAt: string;
    cached: boolean;
    state: 'live' | 'not_delegated' | 'points_elsewhere' | 'not_resolving' | 'no_record' | 'error';
    message: string;
    pointsAtPlatform: boolean;
    targetMode: 'platform' | 'custom' | 'other' | 'none';
    serverIp: string | null;
    expected: {
        type: string;
        value: string | null;
        apex: boolean;
        note: string | null;
    };
    public: {
        a: string[];
        aaaa: string[];
        cname: string[];
        error: string | null;
    };
    platform: {
        zone: string;
        rrsets: (RoutingRRSet & {
            managed: boolean;
        })[];
        error: string | null;
    } | null;
    delegation: {
        ok: boolean;
        zone: string;
        expected: string[];
        found: string[];
    } | null;
}
export type CustomDomainRow = {
    id: string;
    domain: string;
    status: string;
    verifyToken: string;
    verifiedAt: Date | null;
    createdAt: Date;
    dnsZoneName: string | null;
    autoRecordType: string | null;
    autoRecordValue: string | null;
    lastCheck: unknown;
};
export interface DomainCheck {
    checkedAt: string;
    ownership: {
        method: 'platform-dns' | 'txt';
        ok: boolean;
        zone?: string;
        host?: string;
        expected?: string;
        found?: string[];
        error?: string | null;
        message: string;
    };
    routing: {
        ok: boolean;
        host: string;
        expectedType: string;
        expectedValue: string | null;
        foundA: string[];
        foundCname: string[];
        error: string | null;
        message: string;
    };
    autoRecord?: {
        status: 'created' | 'exists' | 'conflict' | 'skipped' | 'error';
        type?: string;
        value?: string;
        existing?: {
            type: string;
            records: string[];
        }[];
        message: string;
    };
    delegation?: {
        ok: boolean;
        zone: string;
        expected: string[];
        found: string[];
        message: string;
    };
    warnings: string[];
}
