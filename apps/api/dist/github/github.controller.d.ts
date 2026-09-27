import { Request, Response } from 'express';
import { GithubService } from './github.service';
import { AppsService } from '../apps/apps.service';
import { PreviewsService } from '../apps/previews.service';
import { GithubPullRequestService } from './github-pr.service';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class GithubController {
    private readonly githubService;
    private readonly appsService;
    private readonly previewsService;
    private readonly pullRequests;
    constructor(githubService: GithubService, appsService: AppsService, previewsService: PreviewsService, pullRequests: GithubPullRequestService);
    authorize(user: AuthUser): Promise<{
        url: string;
    }>;
    callback(code: string, state: string, res: Response): Promise<void>;
    status(user: AuthUser): Promise<{
        connected: boolean;
        login?: string;
    }>;
    repos(user: AuthUser): Promise<{
        repos: import("./github.service").GithubRepo[];
    }>;
    branches(user: AuthUser, owner: string, repo: string): Promise<{
        branches: string[];
        defaultBranch: string;
    }>;
    remoteBranches(user: AuthUser, repoUrl: string): Promise<{
        branches: string[];
    }>;
    disconnect(user: AuthUser): Promise<{
        ok: boolean;
    }>;
    webhook(appId: string, req: Request & {
        rawBody?: Buffer;
    }, event: string, signature: string): Promise<Record<string, unknown>>;
}
export {};
