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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubAuthController = void 0;
const common_1 = require("@nestjs/common");
const github_auth_service_1 = require("./github-auth.service");
const NONCE_COOKIE_PATH = '/v1/github/callback/login';
function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header)
        return undefined;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1)
            continue;
        if (part.slice(0, idx).trim() === name) {
            return decodeURIComponent(part.slice(idx + 1).trim());
        }
    }
    return undefined;
}
let GithubAuthController = class GithubAuthController {
    constructor(githubAuth) {
        this.githubAuth = githubAuth;
    }
    async config() {
        return { enabled: await this.githubAuth.isEnabled() };
    }
    async start(mode, org, redirect, res) {
        try {
            const { url, nonce } = await this.githubAuth.start(mode, org, redirect);
            res.cookie(github_auth_service_1.GITHUB_LOGIN_NONCE_COOKIE, nonce, {
                httpOnly: true,
                sameSite: 'lax',
                secure: this.githubAuth.isSecureCookie(),
                path: NONCE_COOKIE_PATH,
                maxAge: 10 * 60 * 1000,
            });
            res.redirect(url);
        }
        catch (err) {
            const m = mode === 'signup' ? 'signup' : 'login';
            res.redirect(this.githubAuth.errorRedirect(err, m));
        }
    }
    async callback(code, state, error, req, res) {
        const nonce = readCookie(req, github_auth_service_1.GITHUB_LOGIN_NONCE_COOKIE);
        res.clearCookie(github_auth_service_1.GITHUB_LOGIN_NONCE_COOKIE, { path: NONCE_COOKIE_PATH });
        try {
            res.redirect(await this.githubAuth.callback(code, state, nonce, error));
        }
        catch (err) {
            res.redirect(this.githubAuth.errorRedirect(err));
        }
    }
};
exports.GithubAuthController = GithubAuthController;
__decorate([
    (0, common_1.Get)('auth/github/config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GithubAuthController.prototype, "config", null);
__decorate([
    (0, common_1.Get)('auth/github/start'),
    __param(0, (0, common_1.Query)('mode')),
    __param(1, (0, common_1.Query)('org')),
    __param(2, (0, common_1.Query)('redirect')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], GithubAuthController.prototype, "start", null);
__decorate([
    (0, common_1.Get)('github/callback/login'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Query)('error')),
    __param(3, (0, common_1.Req)()),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], GithubAuthController.prototype, "callback", null);
exports.GithubAuthController = GithubAuthController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [github_auth_service_1.GithubAuthService])
], GithubAuthController);
//# sourceMappingURL=github-auth.controller.js.map