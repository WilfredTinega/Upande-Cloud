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
exports.RequestContextInterceptor = void 0;
const common_1 = require("@nestjs/common");
const request_context_1 = require("./request-context");
let RequestContextInterceptor = class RequestContextInterceptor {
    constructor(ctx) {
        this.ctx = ctx;
    }
    intercept(context, next) {
        const req = context.switchToHttp().getRequest();
        const store = {
            ip: clientIp(req),
            userId: req?.user?.id,
        };
        return this.ctx.run(store, () => next.handle());
    }
};
exports.RequestContextInterceptor = RequestContextInterceptor;
exports.RequestContextInterceptor = RequestContextInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [request_context_1.RequestContextService])
], RequestContextInterceptor);
function clientIp(req) {
    const fwd = req?.headers?.['x-forwarded-for'];
    if (fwd) {
        const first = (Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0]?.trim();
        if (first)
            return normalizeIp(first);
    }
    return normalizeIp(req?.ip ?? req?.socket?.remoteAddress);
}
function normalizeIp(ip) {
    if (!ip)
        return ip;
    if (ip === '::1')
        return '127.0.0.1';
    const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    return mapped ? mapped[1] : ip;
}
//# sourceMappingURL=request-context.interceptor.js.map