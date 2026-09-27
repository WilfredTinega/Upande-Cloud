import { PrismaService } from '../prisma/prisma.service';
import { UptimeRange } from './uptime.constants';
interface ProbeOutcome {
    up: boolean;
    statusCode: number | null;
    latencyMs: number | null;
    error: string | null;
}
export interface UptimeBucket {
    t: string;
    checks: number;
    up: number;
    upRatio: number | null;
    avgLatencyMs: number | null;
}
export declare class UptimeService {
    private readonly prisma;
    private readonly logger;
    private readonly docker;
    constructor(prisma: PrismaService);
    runChecks(): Promise<{
        checked: number;
        down: number;
    }>;
    checkApp(app: {
        type: string;
        subdomain: string;
        healthCheckPath: string | null;
        healthCheckTimeout: number;
        healthCheckRetries: number;
    }): Promise<ProbeOutcome>;
    pruneOld(): Promise<number>;
    private window;
    private bucketRows;
    getAppUptime(appId: string, organizationId: string, range: UptimeRange): Promise<{
        range: UptimeRange;
        bucketSeconds: number;
        intervalSeconds: number;
        uptimePct: number | null;
        checks: number;
        avgLatencyMs: number | null;
        current: {
            state: string;
            appStatus: string;
            checkedAt: Date | null;
            statusCode: number | null;
            latencyMs: number | null;
            error: string | null;
        };
        latency: {
            p50: number | null;
            p95: number | null;
            max: number | null;
            min: number | null;
        };
        statusCodes: {
            code: number | null;
            count: number;
        }[];
        errors: {
            error: string;
            count: number;
            lastSeenAt: Date;
        }[];
        series: UptimeBucket[];
        incidents: {
            start: Date;
            end: Date | null;
            ongoing: boolean;
            durationSeconds: number;
            checks: number;
            reason: string | null;
        }[];
    }>;
    buildAppUptime(appId: string, appStatus: string, range: UptimeRange): Promise<{
        range: UptimeRange;
        bucketSeconds: number;
        intervalSeconds: number;
        uptimePct: number | null;
        checks: number;
        avgLatencyMs: number | null;
        current: {
            state: string;
            appStatus: string;
            checkedAt: Date | null;
            statusCode: number | null;
            latencyMs: number | null;
            error: string | null;
        };
        latency: {
            p50: number | null;
            p95: number | null;
            max: number | null;
            min: number | null;
        };
        statusCodes: {
            code: number | null;
            count: number;
        }[];
        errors: {
            error: string;
            count: number;
            lastSeenAt: Date;
        }[];
        series: UptimeBucket[];
        incidents: {
            start: Date;
            end: Date | null;
            ongoing: boolean;
            durationSeconds: number;
            checks: number;
            reason: string | null;
        }[];
    }>;
    private latencyStats;
    getAppAnalysisAdmin(appId: string, range: UptimeRange): Promise<{
        range: UptimeRange;
        bucketSeconds: number;
        intervalSeconds: number;
        uptimePct: number | null;
        checks: number;
        avgLatencyMs: number | null;
        current: {
            state: string;
            appStatus: string;
            checkedAt: Date | null;
            statusCode: number | null;
            latencyMs: number | null;
            error: string | null;
        };
        latency: {
            p50: number | null;
            p95: number | null;
            max: number | null;
            min: number | null;
        };
        statusCodes: {
            code: number | null;
            count: number;
        }[];
        errors: {
            error: string;
            count: number;
            lastSeenAt: Date;
        }[];
        series: UptimeBucket[];
        incidents: {
            start: Date;
            end: Date | null;
            ongoing: boolean;
            durationSeconds: number;
            checks: number;
            reason: string | null;
        }[];
        app: {
            id: string;
            name: string;
            subdomain: string;
            type: import(".prisma/client").$Enums.AppType;
            status: import(".prisma/client").$Enums.AppStatus;
            organizationId: string;
            organizationName: string;
        };
    }>;
    private incidents;
    getPlatformUptime(range: UptimeRange): Promise<{
        range: UptimeRange;
        bucketSeconds: number;
        uptimePct: number | null;
        checks: number;
        monitored: number;
        downNow: number;
        series: UptimeBucket[];
        latencyBySite: {
            t: string;
            latency: Record<string, number>;
        }[];
        apps: {
            appId: string;
            name: string;
            subdomain: string;
            type: import(".prisma/client").$Enums.AppType;
            appStatus: import(".prisma/client").$Enums.AppStatus;
            organizationId: string;
            organizationName: string;
            checks: number;
            downChecks: number;
            uptimePct: number | null;
            avgLatencyMs: number | null;
            latency: {
                p50: number | null;
                p95: number | null;
                max: number | null;
            };
            lastLatencyMs: number | null;
            state: string;
            lastCheckedAt: Date | null;
            lastError: string | null;
        }[];
    }>;
}
export {};
