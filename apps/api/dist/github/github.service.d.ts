import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { GithubConfigService } from './github-config.service';
export interface WebhookPush {
    kind?: 'push';
    appId: string;
    ref: string;
    isTrackedBranch: boolean;
    deleted: boolean;
    commitSha?: string;
    commitMessage?: string;
    pusher?: string;
}
export interface WebhookPullRequest {
    kind: 'pull_request';
    appId: string;
    action: string;
    number: number;
    headRef: string;
    headSha?: string;
    title?: string;
    merged: boolean;
    sameRepo: boolean;
    sender?: string;
}
export interface GithubRepo {
    id: number;
    fullName: string;
    name: string;
    private: boolean;
    defaultBranch: string;
    htmlUrl: string;
    cloneUrl: string;
}
export declare class GithubService {
    private readonly prisma;
    private readonly config;
    private readonly auditService;
    private readonly ghConfig;
    constructor(prisma: PrismaService, config: ConfigService, auditService: AuditService, ghConfig: GithubConfigService);
    isConfigured(): Promise<boolean>;
    clientId(): Promise<string>;
    clientSecret(): Promise<string>;
    apiBaseUrl(): string;
    oauthUrl(): Promise<string>;
    dashboardUrl(): string;
    private callbackUrl;
    buildAuthorizeUrl(userId: string): Promise<{
        url: string;
    }>;
    stateSecret(): Promise<string>;
    private signState;
    private verifyState;
    handleCallback(code: string, state: string): Promise<{
        redirectTo: string;
    }>;
    exchangeCode(code: string, redirectUri: string): Promise<{
        accessToken: string;
        scope: string | null;
    }>;
    getStatus(userId: string): Promise<{
        connected: boolean;
        login?: string;
    }>;
    disconnect(userId: string): Promise<{
        ok: boolean;
    }>;
    listRepos(userId: string): Promise<{
        repos: GithubRepo[];
    }>;
    listBranches(userId: string, owner: string, repo: string): Promise<{
        branches: string[];
        defaultBranch: string;
    }>;
    listRemoteBranches(userId: string, repoUrl: string): Promise<{
        branches: string[];
    }>;
    getToken(userId: string): Promise<string>;
    getTokenIfConnected(userId: string): Promise<string | null>;
    createWebhook(userId: string, repoFullName: string, appId: string): Promise<{
        hookId: string;
        secret: string;
    }>;
    deleteWebhook(userId: string, repoFullName: string, hookId: string): Promise<void>;
    verifySignature(secret: string, payload: Buffer, signatureHeader?: string): boolean;
    resolveWebhookDeploy(appId: string, event: string | undefined, payload: Buffer, signature: string | undefined): Promise<WebhookPush | WebhookPullRequest | null>;
    githubFetch<T>(token: string, path: string, init?: RequestInit): Promise<T>;
}
