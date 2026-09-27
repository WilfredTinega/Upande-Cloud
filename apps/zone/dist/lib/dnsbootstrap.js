"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapDns = bootstrapDns;
exports.freePort53 = freePort53;
/**
 * Automatic managed-DNS (PowerDNS) bootstrap, run as part of `zone install` /
 * `zone up` so the operator never touches the VPS by hand.
 *
 * Two things must be true before the `pdns` container can run:
 *   1. A dedicated `pdns` database with the PowerDNS gpgsql schema exists in the
 *      shared Postgres server.  (created here, idempotently)
 *   2. Host port 53 is free.  systemd-resolved usually holds it, so we disable
 *      its stub listener.  (freePort53)
 *
 * Both steps are safe to re-run and no-op when already satisfied.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const context_1 = require("./context");
const env_1 = require("./env");
const exec_1 = require("./exec");
const ui_1 = require("./ui");
const ENV = { COMPOSE_PROJECT_NAME: 'upande' };
/**
 * Ensure the `pdns` database exists and has the PowerDNS schema loaded.
 * Requires the `postgres` service to be up. Idempotent.
 */
function bootstrapDns(ctx) {
    const env = (0, env_1.readEnvFile)(ctx.paths.envFile);
    const pgUser = env.POSTGRES_USER || 'upande';
    const pgDb = env.POSTGRES_DB || 'upande';
    const pdnsDb = env.PDNS_DB || 'pdns';
    const schemaPath = (0, node_path_1.join)(ctx.paths.dataDir, 'services', 'dns', 'schema.sql');
    if (!(0, node_fs_1.existsSync)(schemaPath)) {
        ui_1.ui.skip(`DNS schema not found at ${schemaPath} — skipping DNS bootstrap.`);
        return false;
    }
    const compose = (args, opts = {}) => ctx.docker.compose([...(0, context_1.composeFiles)(ctx.paths), ...args], {
        cwd: ctx.paths.dataDir,
        env: ENV,
        ...opts,
    });
    // 1. Create the database if missing (gexec runs CREATE DATABASE only when absent).
    ui_1.ui.step(`Ensuring PowerDNS database '${pdnsDb}' exists...`);
    const createSql = `SELECT 'CREATE DATABASE "${pdnsDb}" OWNER "${pgUser}"'\n` +
        ` WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${pdnsDb}')\\gexec\n`;
    const created = compose(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', pgUser, '-d', pgDb], { input: createSql, allowFailure: true, alwaysRun: true });
    if (created.code !== 0) {
        ui_1.ui.skip(`Could not ensure DNS database (is postgres up?): ${created.stderr.trim()}`);
        return false;
    }
    // 2. Load the schema (CREATE TABLE IF NOT EXISTS — safe to re-run).
    ui_1.ui.step(`Loading PowerDNS schema into '${pdnsDb}'...`);
    const schema = (0, node_fs_1.readFileSync)(schemaPath, 'utf8');
    const loaded = compose(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', pgUser, '-d', pdnsDb], { input: schema, allowFailure: true, alwaysRun: true });
    if (loaded.code !== 0) {
        ui_1.ui.skip(`Could not load DNS schema: ${loaded.stderr.trim()}`);
        return false;
    }
    ui_1.ui.ok('Managed DNS backend ready (database + schema).');
    return true;
}
/**
 * Free host port 53 so the pdns container can bind it. On most Linux servers
 * systemd-resolved holds 53; disable its stub listener. No-op when not present
 * or already disabled. Needs root (install already runs privileged steps).
 */
function freePort53() {
    // Only act when systemd-resolved is actually active.
    const active = (0, exec_1.run)('systemctl', ['is-active', 'systemd-resolved'], {
        allowFailure: true,
        alwaysRun: true,
    });
    if (active.stdout.trim() !== 'active') {
        return; // nothing holding 53 via resolved
    }
    const conf = '/etc/systemd/resolved.conf';
    if (!(0, node_fs_1.existsSync)(conf))
        return;
    const current = (0, node_fs_1.readFileSync)(conf, 'utf8');
    if (/^\s*DNSStubListener\s*=\s*no\s*$/m.test(current)) {
        return; // already disabled
    }
    ui_1.ui.step('Freeing host port 53 (disabling systemd-resolved stub listener)...');
    // Use sed via sh so it works whether the line is present, commented, or absent.
    const sed = (0, exec_1.run)('sh', [
        '-c',
        "sed -i 's/#\\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf " +
            '&& grep -q "^DNSStubListener=no" /etc/systemd/resolved.conf ' +
            '|| echo "DNSStubListener=no" >> /etc/systemd/resolved.conf',
    ], { allowFailure: true, alwaysRun: true });
    if (sed.code !== 0) {
        ui_1.ui.skip('Could not edit /etc/systemd/resolved.conf (need root). If pdns fails to bind :53, run:\n' +
            "  sudo sed -i 's/#\\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf && sudo systemctl restart systemd-resolved");
        return;
    }
    (0, exec_1.run)('systemctl', ['restart', 'systemd-resolved'], { allowFailure: true, alwaysRun: true });
    ui_1.ui.ok('Host port 53 freed for managed DNS.');
}
