import { AdminService } from './admin.service';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateGithubSettingsDto } from './dto/update-github-settings.dto';
import { UpdateNetworkSettingsDto } from './dto/update-network-settings.dto';
import { CreateAgentTokenDto } from './dto/create-agent-token.dto';
import { DnsService } from '../dns/dns.service';
import { OpsService, ZoneCommandKey } from './ops.service';
import { BulkMigrateDto } from './dto/bulk-migrate.dto';
import { ImpersonateUserDto } from './dto/impersonate-user.dto';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
    email: string;
}
export declare class AdminController {
    private readonly adminService;
    private readonly dns;
    private readonly ops;
    constructor(adminService: AdminService, dns: DnsService, ops: OpsService);
    listOpsCommands(): {
        commands: {
            key: ZoneCommandKey;
            label: string;
            mutating: boolean;
            description: string;
        }[];
    };
    runOpsCommand(actor: AuthUser, key: ZoneCommandKey): Promise<{
        command: string;
        output: string;
        exitCode: number;
    }>;
    listAllDnsZones(): Promise<{
        id: string;
        name: string;
        status: import(".prisma/client").$Enums.DnsZoneStatus;
        createdAt: Date;
        organizationId: string;
        organizationName: string;
        nameservers: string[];
    }[]>;
    listDnsRecords(name: string): Promise<{
        name: string;
        type: string;
        ttl: number;
        records: string[];
        managed: boolean;
    }[]>;
    deleteDnsZone(actor: AuthUser, name: string): Promise<{
        deleted: boolean;
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
    suspendUser(actor: AuthUser, id: string): Promise<{
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
    unsuspendUser(actor: AuthUser, id: string): Promise<{
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
    updateUser(actor: AuthUser, id: string, dto: UpdateUserDto): Promise<{
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
    deleteUser(actor: AuthUser, id: string): Promise<{
        ok: boolean;
    }>;
    updateRole(actor: AuthUser, id: string, dto: UpdateRoleDto): Promise<{
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
    impersonateUser(actor: AuthUser, id: string, dto: ImpersonateUserDto): Promise<{
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
    createOrganization(actor: AuthUser, dto: CreateOrganizationDto): Promise<{
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
    updateQuota(actor: AuthUser, id: string, dto: UpdateQuotaDto): Promise<{
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
    bulkMigrateAllSites(actor: AuthUser, body: BulkMigrateDto): Promise<{
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
    adminStopApp(actor: AuthUser, id: string): Promise<{
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
    adminDeployApp(actor: AuthUser, id: string, body: {
        ref?: string;
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
    }>;
    getMetrics(): Promise<{
        users: number;
        organizations: number;
        apps: number;
        deployments: number;
        queueDepth: number;
    }>;
    getPerformance(organizationId?: string, appId?: string, days?: string, minutes?: string): Promise<{
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
    getResources(organizationId?: string, appId?: string): Promise<{
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
    getAuditLogs(): Promise<{
        logs: {
            actorEmail: string | null;
            id: string;
            createdAt: Date;
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            action: string;
            target: string;
            ip: string | null;
            actorUserId: string | null;
        }[];
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
            metadata: import("@prisma/client/runtime/library").JsonValue | null;
            readAt: Date | null;
            userId: string;
        })[];
    }>;
    deploymentLog(id: string): Promise<{
        deploymentId: string;
        appName: string;
        status: import(".prisma/client").$Enums.DeploymentStatus;
        ref: string | null;
        createdAt: Date;
        lines: string[];
    }>;
    appDeployments(id: string, take?: string): Promise<{
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
    aiStatus(): Promise<{
        enabled: boolean;
    }>;
    analyzeDeployment(actor: AuthUser, id: string, body: {
        errorReason?: string;
    }): Promise<{
        deploymentId: string;
        status: import(".prisma/client").$Enums.DeploymentStatus;
        analysis: string;
    }>;
    analyzeApp(actor: AuthUser, id: string): Promise<{
        deploymentId: string;
        status: import(".prisma/client").$Enums.DeploymentStatus;
        analysis: string;
    }>;
    getSettings(): Promise<{
        agentApiUrl: string;
        agentTokenSet: boolean;
        agentId: string;
    }>;
    updateSettings(actor: AuthUser, dto: UpdateSettingsDto): Promise<{
        agentApiUrl: string;
        agentTokenSet: boolean;
        agentId: string;
    }>;
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
    updateGithubSettings(actor: AuthUser, dto: UpdateGithubSettingsDto): Promise<{
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
    updateNetworkSettings(actor: AuthUser, dto: UpdateNetworkSettingsDto): Promise<{
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
    createAgentToken(actor: AuthUser, dto: CreateAgentTokenDto): Promise<{
        token: string;
        id: string;
        createdAt: Date;
        name: string;
    }>;
    revokeAgentToken(actor: AuthUser, id: string): Promise<{
        ok: boolean;
    }>;
    generateMcpConfig(actor: AuthUser): Promise<{
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
}
export {};
