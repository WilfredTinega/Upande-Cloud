import { UptimeService } from './uptime.service';
export declare class AppUptimeController {
    private readonly uptime;
    constructor(uptime: UptimeService);
    getUptime(user: {
        organizationId: string;
    }, id: string, range?: string): Promise<{
        range: import("./uptime.constants").UptimeRange;
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
        series: import("./uptime.service").UptimeBucket[];
        incidents: {
            start: Date;
            end: Date | null;
            ongoing: boolean;
            durationSeconds: number;
            checks: number;
            reason: string | null;
        }[];
    }>;
}
export declare class AdminUptimeController {
    private readonly uptime;
    constructor(uptime: UptimeService);
    getUptime(range?: string): Promise<{
        range: import("./uptime.constants").UptimeRange;
        bucketSeconds: number;
        uptimePct: number | null;
        checks: number;
        monitored: number;
        downNow: number;
        series: import("./uptime.service").UptimeBucket[];
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
    getAppAnalysis(id: string, range?: string): Promise<{
        range: import("./uptime.constants").UptimeRange;
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
        series: import("./uptime.service").UptimeBucket[];
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
}
