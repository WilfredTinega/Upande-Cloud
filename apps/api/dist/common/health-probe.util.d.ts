export interface HealthConfig {
    path: string;
    strict: boolean;
    timeoutMs: number;
    retries: number;
    intervalMs: number;
}
export declare function healthConfigFor(app: {
    type: string;
    healthCheckPath: string | null;
    healthCheckTimeout: number;
    healthCheckRetries: number;
}): HealthConfig;
export type ProbeResult = {
    ok: true;
    status: number;
    latencyMs: number;
} | {
    ok: false;
    status: number | null;
    latencyMs: number | null;
    reason: string;
};
export declare function probeHttp(url: string, health: Pick<HealthConfig, 'strict' | 'timeoutMs'>): Promise<ProbeResult>;
