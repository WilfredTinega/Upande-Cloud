import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { LogStoreService } from '../deploy/log-store.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserPurgeService } from '../common/user-purge.service';
import { AiService } from './ai.service';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateGithubSettingsDto } from './dto/update-github-settings.dto';
import { GithubConfigService } from '../github/github-config.service';
import { UpdateNetworkSettingsDto } from './dto/update-network-settings.dto';
import { PlatformNetworkService } from '../dns/platform-network.service';
export declare class AdminService {
    private readonly prisma;
    private readonly deployService;
    private readonly logStore;
    private readonly auditService;
    private readonly notifications;
    private readonly ai;
    private readonly jwtService;
    private readonly config;
    private readonly userPurge;
    private readonly ghConfig;
    private readonly network;
    constructor(prisma: PrismaService, deployService: DeployService, logStore: LogStoreService, auditService: AuditService, notifications: NotificationsService, ai: AiService, jwtService: JwtService, config: ConfigService, userPurge: UserPurgeService, ghConfig: GithubConfigService, network: PlatformNetworkService);
    impersonateUser(actor: {
        id: string;
        email: string;
        role: string;
    }, userId: string, password: string, reason: string): Promise<{
        token: string;
        user: {
            id: string;
            email: string;
            role: "user" | "admin";
            status: "active";
            organizationId: string;
        };
        dashboardUrl: string;
    }>;
    aiStatus(): Promise<{
        enabled: boolean;
    }>;
    getSettings(): Promise<{
        agentApiUrl: string;
        agentTokenSet: boolean;
        agentId: string;
    }>;
    updateSettings(actorId: string, dto: UpdateSettingsDto): Promise<{
        agentApiUrl: string;
        agentTokenSet: boolean;
        agentId: string;
    }>;
    getAgentToken(): Promise<string | null>;
    getGithubSettings(): Promise<{
        configured: boolean;
        clientId: string;
        clientIdSource: import("../github/github-config.service").GithubConfigSource;
        clientSecretSet: boolean;
        clientSecretSource: import("../github/github-config.service").GithubConfigSource;
        stateSecretSource: import("../github/github-config.service").GithubConfigSource;
        homepageUrl: string;
        callbackUrl: string;
    }>;
    updateGithubSettings(actorId: string, dto: UpdateGithubSettingsDto): Promise<{
        configured: boolean;
        clientId: string;
        clientIdSource: import("../github/github-config.service").GithubConfigSource;
        clientSecretSet: boolean;
        clientSecretSource: import("../github/github-config.service").GithubConfigSource;
        stateSecretSource: import("../github/github-config.service").GithubConfigSource;
        homepageUrl: string;
        callbackUrl: string;
    }>;
    testGithubSettings(): Promise<{
        ok: boolean;
        message: string;
    }>;
    getNetworkSettings(): Promise<{
        publicIpv4: string;
        publicIpv4Source: import("../dns/platform-network.service").NetworkConfigSource;
        publicIpv6: string;
        publicIpv6Source: import("../dns/platform-network.service").NetworkConfigSource;
        effectiveIp: string | null;
    }>;
    updateNetworkSettings(actorId: string, dto: UpdateNetworkSettingsDto): Promise<{
        publicIpv4: string;
        publicIpv4Source: import("../dns/platform-network.service").NetworkConfigSource;
        publicIpv6: string;
        publicIpv6Source: import("../dns/platform-network.service").NetworkConfigSource;
        effectiveIp: string | null;
    }>;
    detectPublicIp(): Promise<{
        ipv4: string | null;
        ipv6: string | null;
        errors: string[];
    }>;
    listAgentTokens(): Promise<{
        tokens: {
            id: string;
            createdAt: Date;
            name: string;
            lastUsedAt: Date | null;
        }[];
    }>;
    createAgentToken(actor: {
        id: string;
        organizationId: string;
        role: string;
    }, name: string): Promise<{
        token: string;
        id: string;
        createdAt: Date;
        name: string;
    }>;
    revokeAgentToken(actorId: string, id: string): Promise<{
        ok: boolean;
    }>;
    generateMcpConfig(actor: {
        id: string;
        organizationId: string;
        role: string;
    }, mcpEntryPath: string): Promise<{
        mcpServers: {
            'upande-cloud': {
                command: string;
                args: string[];
                env: {
                    UPANDE_API_URL: string;
                    UPANDE_AGENT_TOKEN: string;
                };
            };
        };
    }>;
    adminDeployApp(actorId: string, appId: string, ref?: string): Promise<{
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
    bulkMigrateAllSites(actor: {
        id: string;
        email: string;
    }, options?: {
        type?: string;
    }): Promise<{
        total: number;
        queued: number;
        skipped: number;
        failed: number;
        deployments: {
            appId: string;
            name: string;
            deploymentId: string;
        }[];
        skippedSites: {
            appId: string;
            name: string;
            status: import(".prisma/client").$Enums.AppStatus;
            reason: string;
        }[];
        failures: {
            appId: string;
            name: string;
            error: string;
        }[];
    }>;
    analyzeLatestForApp(actorId: string, appId: string): Promise<{
        deploymentId: string;
        status: import(".prisma/client").$Enums.DeploymentStatus;
        analysis: string;
    }>;
    listDeploymentErrors(): Promise<{
        notifications: ({
            user: {
                email: string;
            };
        } & {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.NotificationType;
            organizationId: string | null;
            message: string;
            metadata: Prisma.JsonValue | null;
            readAt: Date | null;
            userId: string;
        })[];
    }>;
    listAppDeployments(appId: string, take?: number): Promise<{
        deployments: {
            id: string;
            ref: string | null;
            status: import(".prisma/client").$Enums.DeploymentStatus;
            trigger: import(".prisma/client").$Enums.DeploymentTrigger | null;
            triggerDetail: string | null;
            triggeredBy: string | null;
            commitSha: string | null;
            commitMessage: string | null;
            forceClean: boolean;
            createdAt: Date;
            startedAt: Date | null;
            finishedAt: Date | null;
            durationMs: number | null;
            errorReason: string | null;
        }[];
    }>;
    getDeploymentLog(deploymentId: string): Promise<{
        deploymentId: string;
        appName: string;
        status: import(".prisma/client").$Enums.DeploymentStatus;
        ref: string | null;
        createdAt: Date;
        lines: string[];
    }>;
    analyzeDeployment(actorId: string, deploymentId: string, errorReason?: string): Promise<{
        deploymentId: string;
        status: import(".prisma/client").$Enums.DeploymentStatus;
        analysis: string;
    }>;
    listUsers(): Promise<{
        users: {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.UserStatus;
            organizationId: string;
            username: string;
            email: string;
            role: import(".prisma/client").$Enums.UserRole;
        }[];
    }>;
    suspendUser(actorId: string, userId: string): Promise<{
        user: {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.UserStatus;
            organizationId: string;
            username: string;
            email: string;
            role: import(".prisma/client").$Enums.UserRole;
        };
    }>;
    unsuspendUser(actorId: string, userId: string): Promise<{
        user: {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.UserStatus;
            organizationId: string;
            username: string;
            email: string;
            role: import(".prisma/client").$Enums.UserRole;
        };
    }>;
    deleteUser(actorId: string, userId: string): Promise<{
        ok: boolean;
    }>;
    updateUser(actorId: string, userId: string, dto: UpdateUserDto): Promise<{
        user: {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.UserStatus;
            organizationId: string;
            username: string;
            email: string;
            role: import(".prisma/client").$Enums.UserRole;
        };
    }>;
    updateRole(actorId: string, userId: string, dto: UpdateRoleDto): Promise<{
        user: {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.UserStatus;
            organizationId: string;
            username: string;
            email: string;
            role: import(".prisma/client").$Enums.UserRole;
        };
    }>;
    listOrganizations(): Promise<{
        organizations: {
            counts: {
                users: number;
                projects: number;
                apps: number;
            };
            quota: {
                id: string;
                organizationId: string;
                maxApps: number;
                cpu: string;
                memory: string;
                disk: string;
                buildMinutes: number;
                maxConcurrentDeploys: number;
                maxDnsZones: number;
            } | null;
            _count: {
                projects: number;
                users: number;
            };
            id: string;
            createdAt: Date;
            name: string;
            status: import(".prisma/client").$Enums.OrganizationStatus;
            slug: string;
            plan: import(".prisma/client").$Enums.OrganizationPlan;
            subscriptionExpiresAt: Date | null;
            lastActiveAt: Date | null;
        }[];
    }>;
    createOrganization(actorId: string, dto: CreateOrganizationDto): Promise<{
        organization: {
            id: string;
            createdAt: Date;
            name: string;
            status: import(".prisma/client").$Enums.OrganizationStatus;
            slug: string;
            plan: import(".prisma/client").$Enums.OrganizationPlan;
            subscriptionExpiresAt: Date | null;
            lastActiveAt: Date | null;
        };
    }>;
    updateQuota(actorId: string, organizationId: string, dto: UpdateQuotaDto): Promise<{
        quota: {
            id: string;
            organizationId: string;
            maxApps: number;
            cpu: string;
            memory: string;
            disk: string;
            buildMinutes: number;
            maxConcurrentDeploys: number;
            maxDnsZones: number;
        };
    }>;
    listAllApps(): Promise<{
        apps: ({
            project: {
                user: {
                    username: string;
                    email: string;
                };
                name: string;
                organizationId: string;
                userId: string;
            };
        } & {
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
        })[];
    }>;
    adminStopApp(actorId: string, appId: string): Promise<{
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
    getMetrics(): Promise<{
        users: number;
        organizations: number;
        apps: number;
        deployments: number;
        queueDepth: number;
    }>;
    getSystem(): Promise<{
        hostname: string;
        cores: number;
        loadAvg: number[];
        memory: {
            total: number;
            free: number;
            used: number;
        };
        disk: {
            total: number;
            free: number;
            used: number;
        } | null;
        users: {
            active: number;
            total: number;
        };
        uptimeSeconds: number;
    }>;
    getPerformance(filter?: {
        organizationId?: string;
        appId?: string;
    }, window?: {
        minutes?: number;
        days?: number;
    }): Promise<{
        windowDays: number;
        windowMinutes: number;
        bucket: "minute" | "day";
        stepMinutes: number;
        since: string;
        scope: {
            organizationId: string | null;
            appId: string | null;
            sites: number;
        };
        totals: {
            deployments: number;
            live: number;
            failed: number;
            queued: number;
            building: number;
            successRate: number | null;
        };
        series: {
            date: string;
            total: number;
            live: number;
            failed: number;
        }[];
        deploymentStatus: {
            queued: number;
            building: number;
            live: number;
            failed: number;
        };
        appStatus: Record<string, number>;
        topSites: {
            appId: string;
            name: string;
            deployments: number;
        }[];
    }>;
    getAuditLogs(): Promise<{
        logs: {
            actorEmail: string | null;
            id: string;
            createdAt: Date;
            metadata: Prisma.JsonValue | null;
            action: string;
            target: string;
            ip: string | null;
            actorUserId: string | null;
        }[];
    }>;
    getResourceUsage(filter?: {
        organizationId?: string;
        appId?: string;
    }): Promise<{
        generatedAt: string;
        scope: {
            organizationId: string | null;
            appId: string | null;
            sites: number;
        };
        totals: {
            sites: number;
            sitesUp: number;
            cpuPct: number;
            memBytes: number;
        };
        sites: {
            appId: string;
            name: string;
            subdomain: string;
            organizationId: string;
            customer: string;
            status: import(".prisma/client").$Enums.AppStatus;
            up: boolean;
            cpuPct: number | null;
            memBytes: number | null;
            memLimitBytes: number | null;
            uptimeSeconds: number | null;
            latencyMs: number | null;
            quota: {
                cpu: string;
                memory: string;
                disk: string;
            } | null;
        }[];
        byCustomer: {
            organizationId: string;
            customer: string;
            sites: number;
            sitesUp: number;
            cpuPct: number;
            memBytes: number;
            avgLatencyMs: number | null;
        }[];
        fastest: {
            appId: string;
            name: string;
            subdomain: string;
            organizationId: string;
            customer: string;
            status: import(".prisma/client").$Enums.AppStatus;
            up: boolean;
            cpuPct: number | null;
            memBytes: number | null;
            memLimitBytes: number | null;
            uptimeSeconds: number | null;
            latencyMs: number | null;
            quota: {
                cpu: string;
                memory: string;
                disk: string;
            } | null;
        }[];
        slowest: {
            appId: string;
            name: string;
            subdomain: string;
            organizationId: string;
            customer: string;
            status: import(".prisma/client").$Enums.AppStatus;
            up: boolean;
            cpuPct: number | null;
            memBytes: number | null;
            memLimitBytes: number | null;
            uptimeSeconds: number | null;
            latencyMs: number | null;
            quota: {
                cpu: string;
                memory: string;
                disk: string;
            } | null;
        }[];
    }>;
    private readContainerStats;
    private probeLatency;
    private stopContainer;
}
