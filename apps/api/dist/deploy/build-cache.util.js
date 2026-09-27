"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCacheEnabled = exports.buildCachePruneIntervalMin = exports.buildCacheMaxAgeDays = exports.buildCacheMaxBytes = exports.BuildOutputCacheCounter = exports.BUILD_CACHE_LABEL = void 0;
exports.buildCacheScope = buildCacheScope;
exports.detectNodeBuild = detectNodeBuild;
exports.nodeBuilderStage = nodeBuilderStage;
exports.formatBytes = formatBytes;
const fs = require("fs");
const path = require("path");
exports.BUILD_CACHE_LABEL = 'upande.build-cache';
function buildCacheScope(appId) {
    return `ubc-${appId.replace(/[^a-zA-Z0-9]/g, '')}`;
}
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
function detectNodeBuild(workDir) {
    const has = (f) => fs.existsSync(path.join(workDir, f));
    const pkg = readJson(path.join(workDir, 'package.json')) ?? {};
    const pmField = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
    let pm = 'npm';
    let lockfile = null;
    if (has('pnpm-lock.yaml') || pmField.startsWith('pnpm@')) {
        pm = 'pnpm';
        lockfile = has('pnpm-lock.yaml') ? 'pnpm-lock.yaml' : null;
    }
    else if (has('yarn.lock') || pmField.startsWith('yarn@')) {
        const berry = has('.yarnrc.yml') || /^yarn@([2-9]|\d{2,})/.test(pmField);
        pm = berry ? 'yarn-berry' : 'yarn';
        lockfile = has('yarn.lock') ? 'yarn.lock' : null;
    }
    else if (has('package-lock.json')) {
        lockfile = 'package-lock.json';
    }
    else if (has('npm-shrinkwrap.json')) {
        lockfile = 'npm-shrinkwrap.json';
    }
    const depFiles = ['package.json'];
    if (lockfile)
        depFiles.push(lockfile);
    for (const f of ['.npmrc', '.yarnrc'])
        if (has(f))
            depFiles.push(f);
    const scripts = (pkg.scripts ?? {});
    const hooks = ['preinstall', 'install', 'postinstall', 'prepare'].filter((h) => h in scripts);
    let isolatedInstall = true;
    let isolatedReason = 'dependencies installed in a cached layer (reused while the lockfile is unchanged)';
    if (pkg.workspaces || has('pnpm-workspace.yaml')) {
        isolatedInstall = false;
        isolatedReason = 'monorepo workspaces — installing with the full source';
    }
    else if (hooks.length > 0) {
        isolatedInstall = false;
        isolatedReason = `package.json has ${hooks.join('/')} scripts — installing with the full source`;
    }
    else if (pm === 'yarn-berry') {
        isolatedInstall = false;
        isolatedReason = 'Yarn Berry (.yarn/ config) — installing with the full source';
    }
    const pmVersion = (name, fallback) => {
        const m = pmField.match(new RegExp(`^${name}@(\\d+(?:\\.\\d+){0,2})`));
        return m ? m[1] : fallback;
    };
    let installCmd;
    let defaultBuildCmd;
    let pmCacheDir;
    switch (pm) {
        case 'pnpm':
            installCmd =
                `npm install -g pnpm@${pmVersion('pnpm', '9')} --no-audit --no-fund && ` +
                    (lockfile
                        ? '(pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile)'
                        : 'pnpm install');
            defaultBuildCmd = 'pnpm run build';
            pmCacheDir = '/root/.local/share/pnpm/store';
            break;
        case 'yarn':
            installCmd = lockfile
                ? '(yarn install --frozen-lockfile --non-interactive || yarn install --non-interactive)'
                : 'yarn install --non-interactive';
            defaultBuildCmd = 'yarn build';
            pmCacheDir = '/usr/local/share/.cache/yarn';
            break;
        case 'yarn-berry':
            installCmd = 'corepack enable && (yarn install --immutable || yarn install)';
            defaultBuildCmd = 'yarn build';
            pmCacheDir = '/root/.yarn/berry/cache';
            break;
        default:
            installCmd = lockfile
                ? '(npm ci --legacy-peer-deps --no-audit --no-fund || npm install --legacy-peer-deps --no-audit --no-fund)'
                : 'npm install --legacy-peer-deps --no-audit --no-fund';
            defaultBuildCmd = 'npm run build';
            pmCacheDir = '/root/.npm';
    }
    return {
        pm,
        lockfile,
        depFiles,
        isolatedInstall,
        isolatedReason,
        installCmd,
        defaultBuildCmd,
        pmCacheDir,
    };
}
const FRAMEWORK_CACHE_DIRS = [
    { name: 'next', target: '/app/.next/cache' },
    { name: 'vite', target: '/app/node_modules/.vite' },
    { name: 'nodecache', target: '/app/node_modules/.cache' },
];
function mount(scope, name, target) {
    return `--mount=type=cache,id=${scope}-${name},target=${target},sharing=locked`;
}
function nodeBuilderStage(plan, opts) {
    const buildCmd = opts.buildCmd?.trim() || plan.defaultBuildCmd;
    const pmMounts = opts.buildkit
        ? [
            mount(opts.scope, plan.pm, plan.pmCacheDir),
            ...(plan.pm === 'pnpm' ? [mount(opts.scope, 'npm', '/root/.npm')] : []),
        ].join(' ') + ' '
        : '';
    const buildMounts = opts.buildkit
        ? FRAMEWORK_CACHE_DIRS.map((c) => mount(opts.scope, c.name, c.target)).join(' ') + ' '
        : '';
    const lines = [
        'FROM node:20-alpine AS builder',
        `ARG UPANDE_CACHE_SCOPE=${opts.scope}`,
        `LABEL ${exports.BUILD_CACHE_LABEL}=${opts.scope}`,
        'WORKDIR /app',
    ];
    if (plan.isolatedInstall) {
        lines.push(`COPY ${plan.depFiles.join(' ')} ./`, `RUN ${pmMounts}${plan.installCmd}`, 'COPY . .');
    }
    else {
        lines.push('COPY . .', `RUN ${pmMounts}${plan.installCmd}`);
    }
    lines.push(`RUN ${buildMounts}${buildCmd}`);
    return lines;
}
class BuildOutputCacheCounter {
    constructor(installMarker) {
        this.installMarker = installMarker;
        this.legacySteps = 0;
        this.legacyCached = 0;
        this.legacyCurrent = '';
        this.bkSteps = new Map();
        this.bkCached = new Set();
        this.depsCached = false;
    }
    feed(raw) {
        const line = raw.replace(/^\[stderr\] /, '');
        const step = line.match(/^Step \d+\/\d+ : (.*)$/);
        if (step) {
            this.legacySteps += 1;
            this.legacyCurrent = step[1];
            return;
        }
        if (/^\s*---> Using cache/.test(line)) {
            this.legacyCached += 1;
            if (this.installMarker && this.legacyCurrent.includes(this.installMarker))
                this.depsCached = true;
            return;
        }
        const bk = line.match(/^#(\d+) \[[^\]]*\d+\/\d+\] (.*)$/);
        if (bk) {
            if (!this.bkSteps.has(bk[1]))
                this.bkSteps.set(bk[1], bk[2]);
            return;
        }
        const bkc = line.match(/^#(\d+) CACHED/);
        if (bkc && this.bkSteps.has(bkc[1])) {
            this.bkCached.add(bkc[1]);
            if (this.installMarker && (this.bkSteps.get(bkc[1]) ?? '').includes(this.installMarker)) {
                this.depsCached = true;
            }
        }
    }
    tracksInstall() {
        return this.installMarker.length > 0;
    }
    stats() {
        if (this.bkSteps.size > 0) {
            return { steps: this.bkSteps.size, cached: this.bkCached.size, depsCached: this.depsCached };
        }
        return { steps: this.legacySteps, cached: this.legacyCached, depsCached: this.depsCached };
    }
}
exports.BuildOutputCacheCounter = BuildOutputCacheCounter;
function formatBytes(n) {
    if (n >= 1024 ** 3)
        return `${(n / 1024 ** 3).toFixed(1)} GB`;
    if (n >= 1024 ** 2)
        return `${Math.round(n / 1024 ** 2)} MB`;
    if (n >= 1024)
        return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
}
function envNum(key, def, min, max) {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && process.env[key] !== '' && process.env[key] !== undefined
        ? Math.min(max, Math.max(min, n))
        : def;
}
const buildCacheMaxBytes = () => envNum('BUILD_CACHE_MAX_GB', 10, 0.01, 10_000) * 1024 ** 3;
exports.buildCacheMaxBytes = buildCacheMaxBytes;
const buildCacheMaxAgeDays = () => envNum('BUILD_CACHE_MAX_AGE_DAYS', 14, 1, 3650);
exports.buildCacheMaxAgeDays = buildCacheMaxAgeDays;
const buildCachePruneIntervalMin = () => envNum('BUILD_CACHE_PRUNE_INTERVAL_MINUTES', 60, 5, 7 * 24 * 60);
exports.buildCachePruneIntervalMin = buildCachePruneIntervalMin;
const buildCacheEnabled = () => process.env.BUILD_CACHE_ENABLED !== 'false';
exports.buildCacheEnabled = buildCacheEnabled;
//# sourceMappingURL=build-cache.util.js.map