export declare const ENV_SCOPES: readonly ["all", "production", "preview"];
export type EnvScope = (typeof ENV_SCOPES)[number];
export type EnvTarget = 'production' | 'preview';
export declare function isEnvScope(v: unknown): v is EnvScope;
export declare function effectiveEnvVars<T extends {
    key: string;
    scope?: string | null;
}>(vars: T[], target: EnvTarget): T[];
