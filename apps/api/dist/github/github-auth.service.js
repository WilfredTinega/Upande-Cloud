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
exports.GithubAuthService = exports.GithubLoginError = exports.GITHUB_LOGIN_NONCE_COOKIE = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const client_1 = require("@prisma/client");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../common/audit.service");
const slug_util_1 = require("../common/slug.util");
const github_service_1 = require("./github.service");
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_PURPOSE = 'gh-login';
exports.GITHUB_LOGIN_NONCE_COOKIE = 'upc_gh_login';
class GithubLoginError extends Error {
    constructor(code, message, mode = 'login') {
        super(message);
        this.code = code;
        this.mode = mode;
    }
}
exports.GithubLoginError = GithubLoginError;
let GithubAuthService = class GithubAuthService {
    constructor(prisma, jwtService, github, auditService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.github = github;
        this.auditService = auditService;
    }
    isEnabled() {
        return this.github.isConfigured();
    }
    callbackUrl() {
        return `${this.github.apiBaseUrl()}/v1/github/callback/login`;
    }
    dashboardUrl() {
        return this.github.dashboardUrl().replace(/\/$/, '');
    }
    isSecureCookie() {
        return this.github.apiBaseUrl().startsWith('https://');
    }
    errorRedirect(err, mode = 'login') {
        let code = 'GITHUB_LOGIN_FAILED';
        let message = 'GitHub sign-in failed. Please try again.';
        if (err instanceof GithubLoginError) {
            code = err.code;
            message = err.message;
            mode = err.mode;
        }
        else if (err instanceof common_1.BadRequestException) {
            const body = err.getResponse();
            code = body.code ?? code;
            message = body.message ?? message;
        }
        const page = mode === 'signup' ? 'register' : 'login';
        const params = new URLSearchParams({ github_error: message, github_error_code: code });
        return `${this.dashboardUrl()}/${page}?${params.toString()}`;
    }
    async start(modeRaw, orgRaw, redirectRaw) {
        const mode = modeRaw === 'signup' ? 'signup' : 'login';
        if (!(await this.github.isConfigured())) {
            throw new GithubLoginError('GITHUB_NOT_CONFIGURED', 'GitHub sign-in is not configured on this server.', mode);
        }
        let orgSlug = null;
        if (mode === 'signup') {
            orgSlug = (0, slug_util_1.slugify)(orgRaw ?? '');
            if (orgSlug.length < 2) {
                throw new GithubLoginError('ORG_REQUIRED', 'Enter your organization slug before signing up with GitHub.', mode);
            }
            await this.assertOrgJoinable(orgSlug, mode);
        }
        const nonce = crypto.randomBytes(16).toString('hex');
        const state = await this.signState({
            m: mode,
            o: orgSlug,
            r: this.safeRedirect(redirectRaw),
            n: nonce,
            t: Date.now(),
        });
        const params = new URLSearchParams({
            client_id: await this.github.clientId(),
            redirect_uri: this.callbackUrl(),
            scope: 'read:user user:email',
            state,
            allow_signup: 'true',
        });
        return { url: `${await this.github.oauthUrl()}/authorize?${params.toString()}`, nonce };
    }
    async callback(code, stateRaw, cookieNonce, githubError) {
        const state = await this.verifyState(stateRaw, cookieNonce);
        if (githubError) {
            throw new GithubLoginError('GITHUB_ACCESS_DENIED', githubError === 'access_denied'
                ? 'GitHub sign-in was cancelled.'
                : 'GitHub sign-in failed. Please try again.', state.m);
        }
        const { accessToken } = await this.github.exchangeCode(code ?? '', this.callbackUrl());
        const ghUser = await this.github.githubFetch(accessToken, '/user');
        const emails = await this.github
            .githubFetch(accessToken, '/user/emails')
            .catch(() => []);
        const verified = emails
            .filter((e) => e.verified)
            .sort((a, b) => Number(b.primary) - Number(a.primary))
            .map((e) => e.email.trim().toLowerCase());
        const githubId = String(ghUser.id);
        const { user, created, linked } = await this.resolveUser(state, githubId, ghUser, verified);
        if (user.role === 'superadmin') {
            throw new GithubLoginError('SUPERADMIN_PASSWORD_ONLY', 'The superadmin account must sign in with its password.', state.m);
        }
        if (user.status === 'suspended') {
            throw new GithubLoginError('UNAUTHORIZED', 'Account suspended', state.m);
        }
        await this.auditService.log({
            actorUserId: user.id,
            action: created ? 'auth.github_signup' : 'auth.github_login',
            target: user.id,
            metadata: { githubLogin: ghUser.login, githubId, linked },
        });
        const token = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            orgId: user.organizationId,
            tv: user.tokenVersion,
        });
        const fragment = new URLSearchParams({ token, redirect: state.r });
        return `${this.dashboardUrl()}/auth/github#${fragment.toString()}`;
    }
    async resolveUser(state, githubId, ghUser, verifiedEmails) {
        const linkedUser = await this.prisma.user.findUnique({ where: { githubId } });
        if (linkedUser)
            return { user: linkedUser, created: false, linked: false };
        if (verifiedEmails.length) {
            const byEmail = await this.prisma.user.findFirst({
                where: {
                    OR: verifiedEmails.map((email) => ({
                        email: { equals: email, mode: client_1.Prisma.QueryMode.insensitive },
                    })),
                },
            });
            if (byEmail) {
                if (byEmail.githubId && byEmail.githubId !== githubId) {
                    throw new GithubLoginError('GITHUB_LINK_CONFLICT', 'This account is already linked to a different GitHub account.', state.m);
                }
                if (byEmail.role === 'superadmin') {
                    return { user: byEmail, created: false, linked: false };
                }
                const user = await this.prisma.user.update({
                    where: { id: byEmail.id },
                    data: { githubId },
                });
                return { user, created: false, linked: true };
            }
        }
        if (state.m !== 'signup' || !state.o) {
            throw new GithubLoginError('GITHUB_NO_ACCOUNT', 'No Upande Cloud account is linked to this GitHub account. Sign up with GitHub (you will need your organization slug), or sign in with your password first.', 'signup');
        }
        const email = verifiedEmails[0];
        if (!email) {
            throw new GithubLoginError('GITHUB_NO_VERIFIED_EMAIL', 'Your GitHub account has no verified email address. Verify one on GitHub and try again.', state.m);
        }
        const organization = await this.assertOrgJoinable(state.o, state.m);
        const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        for (let attempt = 0; attempt < 5; attempt++) {
            const username = await this.pickUsername(ghUser.login, attempt);
            try {
                const user = await this.prisma.user.create({
                    data: {
                        organizationId: organization.id,
                        username,
                        email,
                        passwordHash,
                        role: 'user',
                        status: 'active',
                        githubId,
                    },
                });
                return { user, created: true, linked: true };
            }
            catch (e) {
                const target = e.meta?.target;
                const isUnique = e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
                if (isUnique && String(target).includes('username'))
                    continue;
                if (isUnique) {
                    throw new GithubLoginError('CONFLICT', 'An account with this email or GitHub account already exists. Try signing in.', state.m);
                }
                throw e;
            }
        }
        throw new GithubLoginError('CONFLICT', 'Could not allocate a username. Try again.', state.m);
    }
    async pickUsername(login, attempt) {
        let base = login.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
        if (base.length < 3)
            base = `${base || 'user'}-gh`;
        base = base.slice(0, 30);
        if (attempt === 0) {
            const taken = await this.prisma.user.findUnique({ where: { username: base } });
            if (!taken)
                return base;
        }
        const suffix = `-${crypto.randomBytes(2).toString('hex')}`;
        return `${base.slice(0, 30 - suffix.length)}${suffix}`;
    }
    async assertOrgJoinable(slug, mode) {
        const organization = await this.prisma.organization.findUnique({ where: { slug } });
        if (!organization) {
            throw new GithubLoginError('ORG_NOT_FOUND', 'No organization with that slug. Check the slug or ask your admin to create it.', mode);
        }
        if (organization.status === 'suspended') {
            throw new GithubLoginError('ORG_SUSPENDED', 'This organization is suspended and cannot accept new members.', mode);
        }
        return organization;
    }
    safeRedirect(raw) {
        if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) {
            return raw.slice(0, 500);
        }
        return '/apps';
    }
    async hmac(payload) {
        return crypto
            .createHmac('sha256', await this.github.stateSecret())
            .update(`${STATE_PURPOSE}:${payload}`)
            .digest('hex');
    }
    async signState(state) {
        const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
        return `${payload}.${await this.hmac(payload)}`;
    }
    async verifyState(raw, cookieNonce) {
        const bad = (message) => new GithubLoginError('BAD_STATE', `${message}. Please start GitHub sign-in again.`);
        const parts = (raw ?? '').split('.');
        if (parts.length !== 2)
            throw bad('Invalid sign-in state');
        const [payload, sig] = parts;
        const expected = await this.hmac(payload);
        if (sig.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            throw bad('Sign-in state signature mismatch');
        }
        let state;
        try {
            state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        }
        catch {
            throw bad('Invalid sign-in state');
        }
        const mode = state.m === 'signup' ? 'signup' : 'login';
        if (typeof state.t !== 'number' || Date.now() - state.t > STATE_TTL_MS) {
            throw new GithubLoginError('BAD_STATE', 'GitHub sign-in expired. Please try again.', mode);
        }
        if (!cookieNonce ||
            typeof state.n !== 'string' ||
            cookieNonce.length !== state.n.length ||
            !crypto.timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(state.n))) {
            throw new GithubLoginError('BAD_STATE', 'GitHub sign-in must be finished in the same browser it was started in. Please try again.', mode);
        }
        return { ...state, m: mode, r: this.safeRedirect(state.r) };
    }
};
exports.GithubAuthService = GithubAuthService;
exports.GithubAuthService = GithubAuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        github_service_1.GithubService,
        audit_service_1.AuditService])
], GithubAuthService);
//# sourceMappingURL=github-auth.service.js.map