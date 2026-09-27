export interface AppBuildCacheUsage {
    scope: string;
    buildkit: boolean;
    layerBytes: number;
    mountBytes: number;
    totalBytes: number;
    entries: number;
}
export declare class BuildCacheService {
    private readonly logger;
    private readonly docker;
    private buildkitCache;
    buildkitAvailable(): Promise<boolean>;
    private buildkitRecords;
    private static mountScopeOf;
    private pruneBuildkitIds;
    private labelledImages;
    private layerBytes;
    private removeImages;
    usageForApp(appId: string): Promise<AppBuildCacheUsage>;
    clearForApp(appId: string): Promise<{
        removedEntries: number;
        reclaimedBytes: number;
    }>;
    enforceLimits(): Promise<{
        removed: number;
        totalBytes: number;
    }>;
}
