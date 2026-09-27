"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto = require("crypto");
const simple_git_1 = require("simple-git");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../common/audit.service");
const encrypt_util_1 = require("../common/encrypt.util");
const github_config_service_1 = require("./github-config.service");
let GithubService = class GithubService {
    constructor(prisma, config, auditService, ghConfig) {
        this.prisma = prisma;
        this.config = config;
        this.auditService = auditService;
        this.ghConfig = ghConfig;
    }
    isConfigured() {
        return this.ghConfig.isConfigured();
    }
    async clientId() {
        const { clientId } = await this.ghConfig.get();
        if (!clientId) {
            throw new common_1.BadRequestException({
                code: 'GITHUB_NOT_CONFIGURED',
                message: 'GitHub OAuth is not configured on this server',
            });
        }
        return clientId;
    }
    async clientSecret() {
        const { clientSecret } = await this.ghConfig.get();
        if (!clientSecret) {
            throw new common_1.BadRequestException({
                code: 'GITHUB_NOT_CONFIGURED',
                message: 'GitHub OAuth is not configured on this server',
            });
        }
        return clientSecret;
    }
    apiBaseUrl() {
        return this.ghConfig.apiBaseUrl();
    }
    oauthUrl() {
        return this.ghConfig.oauthUrl();
    }
    dashboardUrl() {
        return this.ghConfig.dashboardUrl();
    }
    callbackUrl() {
        return this.ghConfig.callbackUrl();
    }
    async buildAuthorizeUrl(userId) {
        const state = await this.signState(userId);
        const params = new URLSearchParams({
            client_id: await this.clientId(),
            redirect_uri: this.callbackUrl(),
            scope: 'repo read:user',
            state,
            allow_signup: 'false',
        });
        return { url: `${await this.ghConfig.oauthUrl()}/authorize?${params.toString()}` };
    }
    async stateSecret() {
        return (await this.ghConfig.get()).stateSecret;
    }
    async signState(userId) {
        const payload = `${userId}.${Date.now()}`;
        const sig = crypto
            .createHmac('sha256', await this.stateSecret())
            .update(payload)
            .digest('hex');
        return Buffer.from(`${payload}.${sig}`).toString('base64url');
    }
    async verifyState(state) {
        let decoded;
        try {
            decoded = Buffer.from(state, 'base64url').toString('utf8');
        }
        catch {
            throw new common_1.BadRequestException({ code: 'BAD_STATE', message: 'Invalid state' });
        }
        const parts = decoded.split('.');
        if (parts.length !== 3) {
            throw new common_1.BadRequestException({ code: 'BAD_STATE', message: 'Invalid state' });
        }
        const [userId, ts, sig] = parts;
        const expected = crypto
            .createHmac('sha256', await this.stateSecret())
            .update(`${userId}.${ts}`)
            .digest('hex');
        if (sig.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            throw new common_1.BadRequestException({ code: 'BAD_STATE', message: 'State signature mismatch' });
        }
        if (Date.now() - Number(ts) > 10 * 60 * 1000) {
            throw new common_1.BadRequestException({ code: 'BAD_STATE', message: 'State expired' });
        }
        return userId;
    }
    async handleCallback(code, state) {
        const userId = await this.verifyState(state);
        const { accessToken, scope } = await this.exchangeCode(code, this.callbackUrl());
        const ghUser = await this.githubFetch(accessToken, '/user');
        await this.prisma.githubAccount.upsert({
            where: { userId },
            create: {
                userId,
                githubId: String(ghUser.id),
                login: ghUser.login,
                accessToken: (0, encrypt_util_1.encrypt)(accessToken),
                scope,
            },
            update: {
                githubId: String(ghUser.id),
                login: ghUser.login,
                accessToken: (0, encrypt_util_1.encrypt)(accessToken),
                scope,
            },
        });
        await this.prisma.user
            .updateMany({
            where: { id: userId, githubId: null },
            data: { githubId: String(ghUser.id) },
        })
            .catch(() => undefined);
        await this.auditService.log({
            actorUserId: userId,
            action: 'github.connect',
            target: userId,
            metadata: { login: ghUser.login },
        });
        return { redirectTo: `${this.dashboardUrl()}/apps/new?github=connected` };
    }
    async exchangeCode(code, redirectUri) {
        if (!code) {
            throw new common_1.BadRequestException({
                code: 'GITHUB_OAUTH_FAILED',
                message: 'GitHub did not return an authorization code',
            });
        }
        const tokenRes = await fetch(`${await this.ghConfig.oauthUrl()}/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_id: await this.clientId(),
                client_secret: await this.clientSecret(),
                code,
                redirect_uri: redirectUri,
            }),
        });
        const tokenJson = (await tokenRes.json());
        if (!tokenJson.access_token) {
            throw new common_1.BadRequestException({
                code: 'GITHUB_OAUTH_FAILED',
                message: tokenJson.error_description ?? 'Failed to obtain GitHub token',
            });
        }
        return { accessToken: tokenJson.access_token, scope: tokenJson.scope ?? null };
    }
    async getStatus(userId) {
        const account = await this.prisma.githubAccount.findUnique({
            where: { userId },
            select: { login: true },
        });
        return account ? { connected: true, login: account.login } : { connected: false };
    }
    async disconnect(userId) {
        await this.prisma.githubAccount.deleteMany({ where: { userId } });
        await this.auditService.log({
            actorUserId: userId,
            action: 'github.disconnect',
            target: userId,
        });
        return { ok: true };
    }
    async listRepos(userId) {
        const token = await this.getToken(userId);
        const raw = await this.githubFetch(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
        const repos = raw.map((r) => ({
            id: r.id,
            fullName: r.full_name,
            name: r.name,
            private: r.private,
            defaultBranch: r.default_branch,
            htmlUrl: r.html_url,
            cloneUrl: r.clone_url,
        }));
        return { repos };
    }
    async listBranches(userId, owner, repo) {
        const token = await this.getToken(userId);
        const repoInfo = await this.githubFetch(token, `/repos/${owner}/${repo}`);
        const raw = await this.githubFetch(token, `/repos/${owner}/${repo}/branches?per_page=100`);
        const names = raw.map((b) => b.name);
        const defaultBranch = repoInfo.default_branch;
        const branches = [
            ...(names.includes(defaultBranch) ? [defaultBranch] : []),
            ...names.filter((n) => n !== defaultBranch),
        ];
        return { branches, defaultBranch };
    }
    async listRemoteBranches(userId, repoUrl) {
        const trimmed = repoUrl.trim();
        if (!/^https?:\/\//i.test(trimmed)) {
            throw new common_1.BadRequestException({
                code: 'BAD_REPO_URL',
                message: 'Repository URL must start with http(s)://',
            });
        }
        let authedUrl = trimmed;
        if (/^https:\/\/github\.com\//i.test(trimmed)) {
            const token = await this.getTokenIfConnected(userId);
            if (token) {
                authedUrl = trimmed.replace(/^https:\/\//i, `https://x-access-token:${token}@`);
            }
        }
        let raw;
        try {
            raw = await (0, simple_git_1.default)().listRemote(['--heads', authedUrl]);
        }
        catch {
            throw new common_1.BadRequestException({
                code: 'GIT_LS_REMOTE_FAILED',
                message: 'Could not read branches from that repository. Check the URL and access.',
            });
        }
        const branches = raw
            .split('\n')
            .map((line) => line.split('\t')[1])
            .filter((ref) => Boolean(ref) && ref.startsWith('refs/heads/'))
            .map((ref) => ref.replace('refs/heads/', ''));
        const preferred = ['main', 'master'];
        branches.sort((a, b) => {
            const ai = preferred.indexOf(a);
            const bi = preferred.indexOf(b);
            if (ai !== -1 || bi !== -1)
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            return a.localeCompare(b);
        });
        return { branches };
    }
    async getToken(userId) {
        const account = await this.prisma.githubAccount.findUnique({
            where: { userId },
            select: { accessToken: true },
        });
        if (!account) {
            throw new common_1.ForbiddenException({
                code: 'GITHUB_NOT_CONNECTED',
                message: 'GitHub account not connected',
            });
        }
        return (0, encrypt_util_1.decrypt)(account.accessToken);
    }
    async getTokenIfConnected(userId) {
        const account = await this.prisma.githubAccount.findUnique({
            where: { userId },
            select: { accessToken: true },
        });
        return account ? (0, encrypt_util_1.decrypt)(account.accessToken) : null;
    }
    async createWebhook(userId, repoFullName, appId) {
        const token = await this.getToken(userId);
        const secret = crypto.randomBytes(32).toString('hex');
        const webhookUrl = `${this.apiBaseUrl()}/v1/github/webhook/${appId}`;
        const hook = await this.githubFetch(token, `/repos/${repoFullName}/hooks`, {
            method: 'POST',
            body: JSON.stringify({
                name: 'web',
                active: true,
                events: ['push', 'pull_request'],
                config: {
                    url: webhookUrl,
                    content_type: 'json',
                    secret,
                    insecure_ssl: '0',
                },
            }),
        });
        return { hookId: String(hook.id), secret };
    }
    async deleteWebhook(userId, repoFullName, hookId) {
        const token = await this.getTokenIfConnected(userId);
        if (!token)
            return;
        try {
            await this.githubFetch(token, `/repos/${repoFullName}/hooks/${hookId}`, {
                method: 'DELETE',
            });
        }
        catch {
        }
    }
    verifySignature(secret, payload, signatureHeader) {
        if (!signatureHeader)
            return false;
        const expected = 'sha256=' +
            crypto.createHmac('sha256', secret).update(payload).digest('hex');
        const a = Buffer.from(signatureHeader);
        const b = Buffer.from(expected);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    async resolveWebhookDeploy(appId, event, payload, signature) {
        const app = await this.prisma.app.findUnique({
            where: { id: appId },
            select: { id: true, webhookSecret: true, branch: true, githubRepoFullName: true },
        });
        if (!app || !app.webhookSecret) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
        }
        if (!this.verifySignature(app.webhookSecret, payload, signature)) {
            throw new common_1.UnauthorizedException({
                code: 'BAD_SIGNATURE',
                message: 'Webhook signature verification failed',
            });
        }
        if (event === 'ping')
            return null;
        if (event === 'pull_request') {
            const pr = JSON.parse(payload.toString('utf8'));
            const p = pr.pull_request;
            if (!pr.action || !p?.head?.ref)
                return null;
            const headRepo = p.head.repo?.full_name?.toLowerCase();
            const baseRepo = (p.base?.repo?.full_name ?? app.githubRepoFullName ?? '').toLowerCase();
            return {
                kind: 'pull_request',
                appId: app.id,
                action: pr.action,
                number: p.number ?? pr.number ?? 0,
                headRef: p.head.ref,
                headSha: p.head.sha,
                title: p.title,
                merged: p.merged === true,
                sameRepo: !!headRepo && headRepo === baseRepo,
                sender: pr.sender?.login,
            };
        }
        if (event !== 'push')
            return null;
        const parsed = JSON.parse(payload.toString('utf8'));
        if (parsed.ref && !parsed.ref.startsWith('refs/heads/'))
            return null;
        const pushedBranch = parsed.ref?.replace('refs/heads/', '');
        const trackedBranch = app.branch ?? 'main';
        return {
            appId: app.id,
            ref: pushedBranch ?? trackedBranch,
            isTrackedBranch: !pushedBranch || pushedBranch === trackedBranch,
            deleted: parsed.deleted === true,
            commitSha: parsed.head_commit?.id,
            commitMessage: parsed.head_commit?.message,
            pusher: parsed.sender?.login ?? parsed.pusher?.name,
        };
    }
    async githubFetch(token, path, init = {}) {
        const res = await fetch(`${await this.ghConfig.apiUrl()}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'upande-cloud',
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...init.headers,
            },
        });
        if (res.status === 401) {
            throw new common_1.ForbiddenException({
                code: 'GITHUB_TOKEN_INVALID',
                message: 'GitHub token rejected — please reconnect',
            });
        }
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new common_1.BadRequestException({
                code: 'GITHUB_API_ERROR',
                message: `GitHub API error (${res.status}): ${text.slice(0, 200)}`,
            });
        }
        if (res.status === 204)
            return undefined;
        return (await res.json());
    }
};
exports.GithubService = GithubService;
exports.GithubService = GithubService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        audit_service_1.AuditService,
        github_config_service_1.GithubConfigService])
], GithubService);
//# sourceMappingURL=github.service.js.map