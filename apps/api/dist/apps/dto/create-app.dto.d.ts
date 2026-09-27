export declare class CreateAppDto {
    name: string;
    source: 'git' | 'upload';
    type?: 'static' | 'node' | 'fullstack' | 'nodered';
    repoUrl?: string;
    branch?: string;
    buildCmd?: string;
    outputDir?: string;
    projectId?: string;
    githubRepoFullName?: string;
}
