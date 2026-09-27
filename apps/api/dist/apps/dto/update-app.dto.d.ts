export declare class UpdateAppDto {
    name?: string;
    type?: 'static' | 'node' | 'fullstack';
    repoUrl?: string;
    branch?: string;
    buildCmd?: string;
    outputDir?: string;
    healthCheckPath?: string | null;
    healthCheckTimeout?: number;
    healthCheckRetries?: number;
    githubCommitStatus?: boolean;
    githubPrComments?: boolean;
}
