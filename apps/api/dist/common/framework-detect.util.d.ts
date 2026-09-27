export type SiteType = 'static' | 'node' | 'fullstack';
export interface FrameworkDetection {
    framework: {
        id: string;
        name: string;
    };
    type: SiteType;
    buildCmd: string | null;
    outputDir: string | null;
    startCmd: string | null;
    packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | null;
    nodeVersion: string | null;
    buildTimeEnvPrefix: string | null;
    hasDockerfile: boolean;
    usesDatabase: boolean;
    notes: string[];
}
export declare function detectFramework(files: string[], read: (path: string) => string | null): FrameworkDetection;
