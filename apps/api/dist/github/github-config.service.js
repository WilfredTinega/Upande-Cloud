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
exports.GithubConfigService = exports.SETTING_GITHUB_OAUTH_URL = exports.SETTING_GITHUB_API_URL = exports.SETTING_GITHUB_STATE_SECRET = exports.SETTING_GITHUB_CLIENT_SECRET = exports.SETTING_GITHUB_CLIENT_ID = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const encrypt_util_1 = require("../common/encrypt.util");
exports.SETTING_GITHUB_CLIENT_ID = 'github_client_id';
exports.SETTING_GITHUB_CLIENT_SECRET = 'github_client_secret';
exports.SETTING_GITHUB_STATE_SECRET = 'github_state_secret';
exports.SETTING_GITHUB_API_URL = 'github_api_url';
exports.SETTING_GITHUB_OAUTH_URL = 'github_oauth_url';
const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
const DEFAULT_GITHUB_OAUTH_URL = 'https://github.com/login/oauth';
const CACHE_TTL_MS = 30_000;
let GithubConfigService = class GithubConfigService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.cache = null;
        this.urlCache = null;
    }
    invalidate() {
        this.cache = null;
        this.urlCache = null;
    }
    async urls() {
        if (this.urlCache && Date.now() - this.urlCache.at < CACHE_TTL_MS)
            return this.urlCache;
        let rows = [];
        try {
            rows = await this.prisma.setting.findMany({
                where: { key: { in: [exports.SETTING_GITHUB_API_URL, exports.SETTING_GITHUB_OAUTH_URL] } },
                select: { key: true, value: true },
            });
        }
        catch {
        }
        const db = (k) => rows.find((r) => r.key === k)?.value?.trim() || undefined;
        const clean = (u) => u.replace(/\/+$/, '');
        const value = {
            api: clean(db(exports.SETTING_GITHUB_API_URL) || this.config.get('GITHUB_API_URL') || DEFAULT_GITHUB_API_URL),
            oauth: clean(db(exports.SETTING_GITHUB_OAUTH_URL) || this.config.get('GITHUB_OAUTH_URL') || DEFAULT_GITHUB_OAUTH_URL),
        };
        this.urlCache = { ...value, at: Date.now() };
        return value;
    }
    async apiUrl() {
        return (await this.urls()).api;
    }
    async oauthUrl() {
        return (await this.urls()).oauth;
    }
    async get() {
        if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS)
            return this.cache.value;
        const value = await this.load();
        this.cache = { value, at: Date.now() };
        return value;
    }
    async isConfigured() {
        const cfg = await this.get();
        return Boolean(cfg.clientId && cfg.clientSecret);
    }
    apiBaseUrl() {
        return (this.config.get('API_PUBLIC_URL') ?? 'http://localhost:4000').replace(/\/+$/, '');
    }
    dashboardUrl() {
        return this.config.get('DASHBOARD_URL') ?? 'http://localhost:5173';
    }
    callbackUrl() {
        return `${this.apiBaseUrl()}/v1/github/callback`;
    }
    async update(dto) {
        const apply = async (key, value, secret) => {
            if (value === undefined)
                return;
            const v = (value ?? '').trim();
            if (!v) {
                await this.prisma.setting.deleteMany({ where: { key } });
                return;
            }
            const stored = secret ? (0, encrypt_util_1.encrypt)(v) : v;
            await this.prisma.setting.upsert({
                where: { key },
                create: { key, value: stored, encrypted: secret },
                update: { value: stored, encrypted: secret },
            });
        };
        try {
            await apply(exports.SETTING_GITHUB_CLIENT_ID, dto.clientId, false);
            await apply(exports.SETTING_GITHUB_CLIENT_SECRET, dto.clientSecret, true);
            await apply(exports.SETTING_GITHUB_STATE_SECRET, dto.stateSecret, true);
        }
        finally {
            this.invalidate();
        }
    }
    async load() {
        const rows = await this.prisma.setting.findMany({
            where: {
                key: {
                    in: [exports.SETTING_GITHUB_CLIENT_ID, exports.SETTING_GITHUB_CLIENT_SECRET, exports.SETTING_GITHUB_STATE_SECRET],
                },
            },
        });
        const db = new Map();
        for (const r of rows) {
            if (!r.value)
                continue;
            try {
                db.set(r.key, r.encrypted ? (0, encrypt_util_1.decrypt)(r.value) : r.value);
            }
            catch {
            }
        }
        const pick = (key, env) => {
            const fromDb = db.get(key);
            if (fromDb)
                return [fromDb, 'database'];
            const fromEnv = this.config.get(env);
            if (fromEnv)
                return [fromEnv, 'environment'];
            return [null, 'none'];
        };
        const [clientId, idSrc] = pick(exports.SETTING_GITHUB_CLIENT_ID, 'GITHUB_CLIENT_ID');
        const [clientSecret, secretSrc] = pick(exports.SETTING_GITHUB_CLIENT_SECRET, 'GITHUB_CLIENT_SECRET');
        const [stateExplicit, stateSrc] = pick(exports.SETTING_GITHUB_STATE_SECRET, 'GITHUB_STATE_SECRET');
        const stateSecret = stateExplicit || this.config.get('JWT_SECRET') || 'change-me';
        return {
            clientId,
            clientSecret,
            stateSecret,
            sources: { clientId: idSrc, clientSecret: secretSrc, stateSecret: stateSrc },
        };
    }
};
exports.GithubConfigService = GithubConfigService;
exports.GithubConfigService = GithubConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], GithubConfigService);
//# sourceMappingURL=github-config.service.js.map