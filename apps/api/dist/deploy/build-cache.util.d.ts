export declare const BUILD_CACHE_LABEL = "upande.build-cache";
export declare function buildCacheScope(appId: string): string;
export type PackageManager = 'npm' | 'yarn' | 'yarn-berry' | 'pnpm';
export interface NodeBuildPlan {
    pm: PackageManager;
    lockfile: string | null;
    depFiles: string[];
    isolatedInstall: boolean;
    isolatedReason: string;
    installCmd: string;
    defaultBuildCmd: string;
    pmCacheDir: string;
}
export declare function detectNodeBuild(workDir: string): NodeBuildPlan;
export declare function nodeBuilderStage(plan: NodeBuildPlan, opts: {
    scope: string;
    buildkit: boolean;
    buildCmd?: string | null;
}): string[];
export interface CacheStats {
    steps: number;
    cached: number;
    depsCached: boolean;
}
export declare class BuildOutputCacheCounter {
    private readonly installMarker;
    private legacySteps;
    private legacyCached;
    private legacyCurrent;
    private bkSteps;
    private bkCached;
    private depsCached;
    constructor(installMarker: string);
    feed(raw: string): void;
    tracksInstall(): boolean;
    stats(): CacheStats;
}
export declare function formatBytes(n: number): string;
export declare const buildCacheMaxBytes: () => number;
export declare const buildCacheMaxAgeDays: () => number;
export declare const buildCachePruneIntervalMin: () => number;
export declare const buildCacheEnabled: () => boolean;
