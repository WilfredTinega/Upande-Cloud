import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare const SETTING_GITHUB_CLIENT_ID = "github_client_id";
export declare const SETTING_GITHUB_CLIENT_SECRET = "github_client_secret";
export declare const SETTING_GITHUB_STATE_SECRET = "github_state_secret";
export declare const SETTING_GITHUB_API_URL = "github_api_url";
export declare const SETTING_GITHUB_OAUTH_URL = "github_oauth_url";
export type GithubConfigSource = 'database' | 'environment' | 'none';
export interface GithubOAuthConfig {
    clientId: string | null;
    clientSecret: string | null;
    stateSecret: string;
    sources: {
        clientId: GithubConfigSource;
        clientSecret: GithubConfigSource;
        stateSecret: GithubConfigSource;
    };
}
export interface GithubConfigUpdate {
    clientId?: string | null;
    clientSecret?: string | null;
    stateSecret?: string | null;
}
export declare class GithubConfigService {
    private readonly prisma;
    private readonly config;
    private cache;
    private urlCache;
    constructor(prisma: PrismaService, config: ConfigService);
    invalidate(): void;
    private urls;
    apiUrl(): Promise<string>;
    oauthUrl(): Promise<string>;
    get(): Promise<GithubOAuthConfig>;
    isConfigured(): Promise<boolean>;
    apiBaseUrl(): string;
    dashboardUrl(): string;
    callbackUrl(): string;
    update(dto: GithubConfigUpdate): Promise<void>;
    private load;
}
