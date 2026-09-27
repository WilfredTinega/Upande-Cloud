import { Request, Response } from 'express';
import { GithubAuthService } from './github-auth.service';
export declare class GithubAuthController {
    private readonly githubAuth;
    constructor(githubAuth: GithubAuthService);
    config(): Promise<{
        enabled: boolean;
    }>;
    start(mode: string | undefined, org: string | undefined, redirect: string | undefined, res: Response): Promise<void>;
    callback(code: string | undefined, state: string | undefined, error: string | undefined, req: Request, res: Response): Promise<void>;
}
