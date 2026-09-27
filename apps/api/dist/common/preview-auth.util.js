"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREVIEW_AUTH_LABEL = void 0;
exports.previewAuthMiddleware = previewAuthMiddleware;
exports.previewAuthLabels = previewAuthLabels;
exports.withoutPreviewAuthLabels = withoutPreviewAuthLabels;
exports.applyPreviewAuth = applyPreviewAuth;
exports.withRetryMiddleware = withRetryMiddleware;
const crypto = require("crypto");
exports.PREVIEW_AUTH_LABEL = 'upande.preview-auth';
function previewAuthMiddleware(previewSubdomain) {
    return `pv-${previewSubdomain}-auth`;
}
function previewAuthLabels(previewSubdomain, protection) {
    if (!protection)
        return {};
    const r = `pv-${previewSubdomain}`;
    const mw = previewAuthMiddleware(previewSubdomain);
    return {
        [`traefik.http.middlewares.${mw}.basicauth.users`]: `${protection.username}:${protection.passwordHash}`,
        [`traefik.http.middlewares.${mw}.basicauth.realm`]: 'Preview',
        [`traefik.http.routers.${r}.middlewares`]: mw,
        [exports.PREVIEW_AUTH_LABEL]: crypto.createHash('sha256').update(protection.passwordHash).digest('hex').slice(0, 12),
    };
}
function withoutPreviewAuthLabels(labels, previewSubdomain) {
    const mw = previewAuthMiddleware(previewSubdomain);
    const routerMw = `traefik.http.routers.pv-${previewSubdomain}.middlewares`;
    const out = {};
    for (const [k, v] of Object.entries(labels)) {
        if (k === exports.PREVIEW_AUTH_LABEL)
            continue;
        if (k.startsWith(`traefik.http.middlewares.${mw}.`))
            continue;
        if (k === routerMw) {
            const rest = v.split(',').map((s) => s.trim()).filter((s) => s && s !== mw);
            if (rest.length)
                out[k] = rest.join(',');
            continue;
        }
        out[k] = v;
    }
    return out;
}
function applyPreviewAuth(labels, previewSubdomain, protection) {
    const base = withoutPreviewAuthLabels(labels, previewSubdomain);
    if (!protection)
        return base;
    const routerMw = `traefik.http.routers.pv-${previewSubdomain}.middlewares`;
    const auth = previewAuthLabels(previewSubdomain, protection);
    const others = base[routerMw];
    return { ...base, ...auth, [routerMw]: others ? `${auth[routerMw]},${others}` : auth[routerMw] };
}
function withRetryMiddleware(labels, name) {
    const mw = `${name}-retry`;
    const out = { ...labels };
    out[`traefik.http.middlewares.${mw}.retry.attempts`] = '3';
    out[`traefik.http.middlewares.${mw}.retry.initialinterval`] = '100ms';
    for (const k of Object.keys(labels)) {
        const m = /^traefik\.http\.routers\.([^.]+)\.rule$/.exec(k);
        if (!m)
            continue;
        const key = `traefik.http.routers.${m[1]}.middlewares`;
        const list = (out[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!list.includes(mw))
            list.push(mw);
        out[key] = list.join(',');
    }
    return out;
}
//# sourceMappingURL=preview-auth.util.js.map