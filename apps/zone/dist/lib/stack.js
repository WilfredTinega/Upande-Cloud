"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
exports.createSuperadmin = createSuperadmin;
exports.pull = pull;
exports.up = up;
exports.upService = upService;
exports.down = down;
exports.restart = restart;
exports.logs = logs;
exports.psStatus = psStatus;
exports.probeApi = probeApi;
exports.waitForApi = waitForApi;
/**
 * Higher-level operations on the running Upande Cloud stack: migrations,
 * superadmin creation, health probing, and service status — all expressed in
 * terms of compose commands against the api container.
 *
 * Migrations and the superadmin script live inside the api image (it has
 * Prisma + scripts/create-superadmin.ts), so we run them with
 * `compose run --rm api ...` (one-shot) or `compose exec api ...` (live).
 */
const context_1 = require("./context");
const ui_1 = require("./ui");
const ENV = { COMPOSE_PROJECT_NAME: 'upande' };
/** compose argv prefixed with the right -f files + project name env. */
function composeArgs(ctx, rest) {
    return [...(0, context_1.composeFiles)(ctx.paths), ...rest];
}
/** Apply pending Prisma migrations inside a one-shot api container. */
async function runMigrations(ctx) {
    return ctx.docker.composeStream(composeArgs(ctx, [
        'run',
        '--rm',
        '--no-deps',
        'api',
        'npx',
        'prisma',
        'migrate',
        'deploy',
    ]), { cwd: ctx.paths.dataDir, env: ENV });
}
/**
 * Create or promote the platform superadmin via the in-image script. Runs in a
 * one-shot api container so it works before the long-running api is up.
 */
async function createSuperadmin(ctx, email, password, orgName = 'Administrator') {
    return ctx.docker.composeStream(composeArgs(ctx, [
        'run',
        '--rm',
        '--no-deps',
        'api',
        'node',
        // Compiled by the API Dockerfile (scripts/ is excluded from nest build).
        'dist/scripts/create-superadmin.js',
        email,
        password,
        orgName,
    ]), { cwd: ctx.paths.dataDir, env: ENV });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Pull the latest platform images from the registry.
 *
 * Docker Hub anonymous pulls are rate-limited and its token endpoint sometimes
 * returns a transient 404 mid-pull, which aborts a single bulk `compose pull`.
 * So we retry the bulk pull a few times (already-pulled layers are cached, so
 * retries are cheap), with a short backoff to let a transient limit reset.
 */
async function pull(ctx, attempts = 3) {
    let code = 0;
    for (let i = 1; i <= attempts; i++) {
        code = await ctx.docker.composeStream(composeArgs(ctx, ['pull']), {
            cwd: ctx.paths.dataDir,
            env: ENV,
        });
        if (code === 0)
            return 0;
        if (i < attempts) {
            ui_1.ui.warn(`Image pull failed (attempt ${i}/${attempts}) — retrying in 15s. ` +
                `If this persists, run "docker login" on the server to lift Docker Hub rate limits.`);
            await sleep(15_000);
        }
    }
    return code;
}
/**
 * Bring the whole stack up. In a registry deployment images are pulled, not
 * built — pass pullFirst to refresh them before starting.
 */
async function up(ctx, pullFirst = false) {
    if (pullFirst) {
        const code = await pull(ctx);
        if (code !== 0)
            return code;
    }
    return ctx.docker.composeStream(composeArgs(ctx, ['up', '-d']), {
        cwd: ctx.paths.dataDir,
        env: ENV,
    });
}
/**
 * Bring up a single service (and its dependencies), waiting until it is
 * healthy/running. Used to start postgres before the DNS bootstrap so pdns can
 * connect on its first boot.
 */
async function upService(ctx, service) {
    return ctx.docker.composeStream(composeArgs(ctx, ['up', '-d', '--wait', service]), { cwd: ctx.paths.dataDir, env: ENV });
}
async function down(ctx, volumes = false) {
    const args = ['down'];
    if (volumes)
        args.push('--volumes');
    return ctx.docker.composeStream(composeArgs(ctx, args), {
        cwd: ctx.paths.dataDir,
        env: ENV,
    });
}
async function restart(ctx, service) {
    const args = ['restart'];
    if (service)
        args.push(service);
    return ctx.docker.composeStream(composeArgs(ctx, args), {
        cwd: ctx.paths.dataDir,
        env: ENV,
    });
}
async function logs(ctx, service, follow, tail) {
    const args = ['logs', '--tail', tail];
    if (follow)
        args.push('-f');
    if (service)
        args.push(service);
    return ctx.docker.composeStream(composeArgs(ctx, args), {
        cwd: ctx.paths.dataDir,
        env: ENV,
    });
}
/** Parse `compose ps` JSON into a normalized service list. */
function psStatus(ctx) {
    const res = ctx.docker.compose(composeArgs(ctx, ['ps', '--all', '--format', 'json']), { cwd: ctx.paths.dataDir, env: ENV, allowFailure: true });
    if (res.code !== 0 || !res.stdout.trim())
        return [];
    // compose emits either a JSON array or newline-delimited JSON objects.
    const text = res.stdout.trim();
    const rows = [];
    if (text.startsWith('[')) {
        try {
            rows.push(...JSON.parse(text));
        }
        catch {
            /* ignore */
        }
    }
    else {
        for (const line of text.split('\n')) {
            const t = line.trim();
            if (!t)
                continue;
            try {
                rows.push(JSON.parse(t));
            }
            catch {
                /* ignore */
            }
        }
    }
    return rows.map((r) => ({
        name: r.Service ?? r.Name ?? '?',
        state: r.State ?? r.Status ?? '?',
        health: r.Health || undefined,
    }));
}
/**
 * Probe the API from INSIDE its container (the api image ships curl). The API
 * has no dedicated /health route, but any HTTP response — even 404 — proves the
 * server is accepting connections. Returns up=false if the container isn't
 * running or curl can't connect yet.
 */
function probeApi(ctx) {
    const res = ctx.docker.compose(composeArgs(ctx, [
        'exec',
        '-T',
        'api',
        'curl',
        '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        'http://localhost:4000/v1',
    ]), { cwd: ctx.paths.dataDir, env: ENV, allowFailure: true });
    const code = parseInt(res.stdout.trim(), 10);
    if (res.code === 0 && Number.isFinite(code) && code > 0) {
        return { up: true, status: code };
    }
    return { up: false };
}
/** Poll probeApi until it succeeds or the deadline passes. */
async function waitForApi(ctx, deadlineMs = 90_000) {
    const start = Date.now();
    for (;;) {
        if (probeApi(ctx).up)
            return true;
        if (Date.now() - start > deadlineMs)
            return false;
        await new Promise((r) => setTimeout(r, 2000));
    }
}
