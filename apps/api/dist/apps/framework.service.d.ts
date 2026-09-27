import { PrismaService } from '../prisma/prisma.service';
import { GithubService } from '../github/github.service';
import { FrameworkDetection } from '../common/framework-detect.util';
export declare class FrameworkService {
    private readonly prisma;
    private readonly github;
    constructor(prisma: PrismaService, github: GithubService);
    private nixpacks;
    private finish;
    private assertPublicRepoUrl;
    detectFromUrl(userId: string, repoUrl: string, branch?: string): Promise<{
        detection: FrameworkDetection;
    }>;
    detectForApp(userId: string, organizationId: string, appId: string): Promise<{
        detection: FrameworkDetection;
        current: {
            type: "static" | "node" | "fullstack";
            buildCmd: string | null;
            outputDir: string | null;
        };
        warnings: string[];
    }>;
    private detectGit;
    private detectDir;
}
