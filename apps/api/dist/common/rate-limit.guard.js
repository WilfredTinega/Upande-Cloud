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
exports.RateLimitGuard = exports.RateLimit = exports.RATE_LIMIT_KEY = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
exports.RATE_LIMIT_KEY = 'upande:rate-limit';
const RateLimit = (opts) => (0, common_1.SetMetadata)(exports.RATE_LIMIT_KEY, opts);
exports.RateLimit = RateLimit;
const buckets = new Map();
let lastSweep = Date.now();
function hit(key, limit, windowMs) {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
        for (const [k, b] of buckets)
            if (b.resetAt <= now)
                buckets.delete(k);
        lastSweep = now;
    }
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return null;
    }
    b.count += 1;
    return b.count > limit ? Math.ceil((b.resetAt - now) / 1000) : null;
}
let RateLimitGuard = class RateLimitGuard {
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(ctx) {
        if ((process.env.RATE_LIMIT_DISABLED ?? '').toLowerCase() === 'true')
            return true;
        const opts = this.reflector.getAllAndOverride(exports.RATE_LIMIT_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        if (!opts)
            return true;
        const req = ctx.switchToHttp().getRequest();
        const route = `${req.method} ${req.route?.path ?? req.path}`;
        const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
        const windowMs = opts.windowSec * 1000;
        const keys = [`${route}|ip:${ip}`];
        if (opts.byBody) {
            const v = req.body?.[opts.byBody];
            if (typeof v === 'string' && v)
                keys.push(`${route}|${opts.byBody}:${v.trim().toLowerCase()}`);
        }
        for (const key of keys) {
            const retryAfter = hit(key, opts.limit, windowMs);
            if (retryAfter !== null) {
                const res = ctx.switchToHttp().getResponse();
                res.setHeader?.('Retry-After', String(retryAfter));
                throw new common_1.HttpException({ code: 'RATE_LIMITED', message: `Too many attempts. Try again in ${retryAfter}s.` }, common_1.HttpStatus.TOO_MANY_REQUESTS);
            }
        }
        return true;
    }
};
exports.RateLimitGuard = RateLimitGuard;
exports.RateLimitGuard = RateLimitGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector])
], RateLimitGuard);
//# sourceMappingURL=rate-limit.guard.js.map