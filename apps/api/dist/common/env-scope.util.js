"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV_SCOPES = void 0;
exports.isEnvScope = isEnvScope;
exports.effectiveEnvVars = effectiveEnvVars;
exports.ENV_SCOPES = ['all', 'production', 'preview'];
function isEnvScope(v) {
    return typeof v === 'string' && exports.ENV_SCOPES.includes(v);
}
function effectiveEnvVars(vars, target) {
    const byKey = new Map();
    for (const v of vars)
        if ((v.scope ?? 'all') === 'all')
            byKey.set(v.key, v);
    for (const v of vars)
        if (v.scope === target)
            byKey.set(v.key, v);
    return [...byKey.values()];
}
//# sourceMappingURL=env-scope.util.js.map