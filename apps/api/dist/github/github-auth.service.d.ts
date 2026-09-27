import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { GithubService } from './github.service';
export declare const GITHUB_LOGIN_NONCE_COOKIE = "upc_gh_login";
export type GithubLoginMode = 'login' | 'signup';
export declare class GithubLoginError extends Error {
    readonly code: string;
    readonly mode: GithubLoginMode;
    constructor(code: string, message: string, mode?: GithubLoginMode);
}
export declare class GithubAuthService {
    private readonly prisma;
    private readonly jwtService;
    private readonly github;
    private readonly auditService;
    constructor(prisma: PrismaService, jwtService: JwtService, github: GithubService, auditService: AuditService);
    isEnabled(): Promise<boolean>;
    callbackUrl(): string;
    dashboardUrl(): string;
    isSecureCookie(): boolean;
    errorRedirect(err: unknown, mode?: GithubLoginMode): string;
    start(modeRaw: string | undefined, orgRaw: string | undefined, redirectRaw: string | undefined): Promise<{
        url: string;
        nonce: string;
    }>;
    callback(code: string | undefined, stateRaw: string | undefined, cookieNonce: string | undefined, githubError: string | undefined): Promise<string>;
    private resolveUser;
    private pickUsername;
    private assertOrgJoinable;
    private safeRedirect;
    private hmac;
    private signState;
    private verifyState;
}
