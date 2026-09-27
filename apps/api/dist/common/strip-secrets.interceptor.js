"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripSecretsInterceptor = void 0;
exports.stripSecrets = stripSecrets;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
const SECRET_KEYS = new Set([
    'webhookSecret',
    'noderedAdminPasswordEnc',
    'passwordHash',
    'dbPasswordEnc',
    'passwordEnc',
    'tokenHash',
]);
function isPlain(v) {
    if (v === null || typeof v !== 'object')
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}
function stripSecrets(value, depth = 0) {
    if (depth > 12)
        return value;
    if (Array.isArray(value))
        return value.map((v) => stripSecrets(v, depth + 1));
    if (!isPlain(value))
        return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEYS.has(k))
            continue;
        out[k] = stripSecrets(v, depth + 1);
    }
    return out;
}
let StripSecretsInterceptor = class StripSecretsInterceptor {
    intercept(_ctx, next) {
        return next.handle().pipe((0, operators_1.map)((data) => stripSecrets(data)));
    }
};
exports.StripSecretsInterceptor = StripSecretsInterceptor;
exports.StripSecretsInterceptor = StripSecretsInterceptor = __decorate([
    (0, common_1.Injectable)()
], StripSecretsInterceptor);
//# sourceMappingURL=strip-secrets.interceptor.js.map