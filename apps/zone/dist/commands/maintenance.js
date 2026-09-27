"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMaintenance = registerMaintenance;
/**
 * Maintenance commands: upgrade, backup, restore, secrets.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const prompts_1 = __importDefault(require("prompts"));
const context_1 = require("../lib/context");
const exec_1 = require("../lib/exec");
const env_1 = require("../lib/env");
const stack_1 = require("../lib/stack");
const dnsbootstrap_1 = require("../lib/dnsbootstrap");
const templates_1 = require("../lib/templates");
const tls_1 = require("../lib/tls");
const ui_1 = require("../lib/ui");
const ENV = { COMPOSE_PROJECT_NAME: 'upande' };
function composeArgs(ctx, rest) {
    return [...(0, context_1.composeFiles)(ctx.paths), ...rest];
}
/** Default timestamped backup path. A timestamp is passed in (no Date.now in libs). */
function defaultBackupPath(ctx, stamp) {
    const dir = ctx.paths.backupsDir;
    if (!(0, node_fs_1.existsSync)(dir))
        (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    return (0, node_path_1.join)(dir, `upande-db-${stamp}.sql.gz`);
}
function registerMaintenance(program) {
    // ---- upgrade ----
    program
        .command('upgrade')
        .description('Refresh deployment files, pull new images, migrate, and restart')
        .option('--tag <tag>', 'upgrade to a specific image tag (default: keep current)')
        .option('--no-backup', 'skip the pre-upgrade database backup')
        .action(async (opts) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        if (opts.backup !== false) {
            ui_1.ui.heading('Pre-upgrade backup');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const out = defaultBackupPath(ctx, stamp);
            const ok = await doBackup(ctx, out);
            if (!ok) {
                const ans = await (0, prompts_1.default)({
                    type: 'confirm',
                    name: 'go',
                    message: 'Backup failed. Continue with the upgrade anyway?',
                    initial: false,
                });
                if (!ans.go)
                    (0, ui_1.die)('Upgrade aborted.');
            }
        }
        // Refresh the bundled compose/Traefik files (the installed CLI may be
        // newer than what was last materialized), and bump the tag if requested.
        ui_1.ui.heading('Refreshing deployment files');
        const mat = (0, templates_1.materializeTemplates)(ctx.paths);
        ui_1.ui.ok(`Updated: ${mat.copied.join(', ')}`);
        // Backfill any new env keys (e.g. PDNS_*, MAIL_*) introduced by a newer
        // CLI, preserving existing secrets/values. Also re-render TLS so the
        // traefik prod config lands at its (possibly relocated) path.
        ui_1.ui.heading('Refreshing configuration');
        const existing = (0, env_1.readEnvFile)(ctx.paths.envFile);
        if (opts.tag)
            existing.UPANDE_TAG = opts.tag;
        const env = (0, env_1.buildEnv)({ existing });
        env.UPANDE_REGISTRY = existing.UPANDE_REGISTRY || env.UPANDE_REGISTRY;
        env.UPANDE_TAG = existing.UPANDE_TAG || env.UPANDE_TAG;
        (0, env_1.writeEnvFile)(ctx.paths.envFile, env);
        ui_1.ui.ok('Environment refreshed (existing secrets preserved; new keys added).');
        if (env.DOMAIN && env.ACME_EMAIL && (0, tls_1.looksLikeEmail)(env.ACME_EMAIL)) {
            (0, tls_1.renderTraefikProd)(ctx.paths, env.ACME_EMAIL);
            ui_1.ui.ok('Re-rendered Traefik production config.');
        }
        if (opts.tag)
            ui_1.ui.ok(`Image tag set to ${opts.tag}`);
        // Free host port 53 so the managed-DNS container can bind it.
        ui_1.ui.heading('Managed DNS');
        (0, dnsbootstrap_1.freePort53)();
        ui_1.ui.heading('Pulling images and restarting');
        const pullCode = await (0, stack_1.pull)(ctx);
        if (pullCode !== 0)
            (0, ui_1.die)('Pull failed. See output above.');
        // Start Postgres and bootstrap the DNS backend BEFORE the rest, so pdns
        // finds its database on first boot (no error, no restart needed).
        await (0, stack_1.upService)(ctx, 'postgres');
        (0, dnsbootstrap_1.bootstrapDns)(ctx);
        const upCode = await (0, stack_1.up)(ctx, false);
        if (upCode !== 0)
            (0, ui_1.die)('Up failed. See output above.');
        ui_1.ui.heading('Migrations');
        const mig = await (0, stack_1.runMigrations)(ctx);
        if (mig !== 0)
            (0, ui_1.die)('Migrations failed after upgrade. The stack is up but the schema may be stale.');
        ui_1.ui.ok('Upgrade complete.');
    });
    // ---- backup ----
    program
        .command('backup [outfile]')
        .description('Dump the Postgres database to a gzip file (default: ./backups/)')
        .action(async (outfile) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const target = outfile
            ? (0, node_path_1.isAbsolute)(outfile)
                ? outfile
                : (0, node_path_1.resolve)(process.cwd(), outfile)
            : defaultBackupPath(ctx, stamp);
        const ok = await doBackup(ctx, target);
        process.exit(ok ? 0 : 1);
    });
    // ---- restore ----
    program
        .command('restore <infile>')
        .description('Restore the Postgres database from a backup file (gzip or plain SQL)')
        .option('-y, --yes', 'skip the confirmation prompt', false)
        .action(async (infile, opts) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        const path = (0, node_path_1.isAbsolute)(infile) ? infile : (0, node_path_1.resolve)(process.cwd(), infile);
        if (!(0, node_fs_1.existsSync)(path))
            (0, ui_1.die)(`Backup file not found: ${path}`);
        if (!opts.yes) {
            const ans = await (0, prompts_1.default)({
                type: 'confirm',
                name: 'go',
                message: 'Restoring will OVERWRITE the current database. Continue?',
                initial: false,
            });
            if (!ans.go)
                (0, ui_1.die)('Aborted.');
        }
        const ok = await doRestore(ctx, path);
        process.exit(ok ? 0 : 1);
    });
    // ---- secrets rotate ----
    const secrets = program.command('secrets').description('Manage platform secrets');
    secrets
        .command('rotate')
        .description('Rotate JWT_SECRET (invalidates all sessions) and restart the API')
        .option('--db', 'also rotate the Postgres password (advanced; requires DB user update)', false)
        .option('-y, --yes', 'skip confirmation', false)
        .action(async (opts) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        if (!opts.yes) {
            const ans = await (0, prompts_1.default)({
                type: 'confirm',
                name: 'go',
                message: opts.db
                    ? 'Rotate JWT and Postgres password? All users must log in again; the DB password will be changed in-place.'
                    : 'Rotate JWT secret? All users will be logged out.',
                initial: false,
            });
            if (!ans.go)
                (0, ui_1.die)('Aborted.');
        }
        const existing = (0, env_1.readEnvFile)(ctx.paths.envFile);
        if (Object.keys(existing).length === 0)
            (0, ui_1.die)('No .env found. Run "zone install" first.');
        const oldPgPass = existing.POSTGRES_PASSWORD;
        // Build a fresh env with rotated secrets, preserving non-secret values.
        const rotated = (0, env_1.buildEnv)({ domain: existing.DOMAIN, existing, rotateSecrets: true });
        if (opts.db) {
            // We must authenticate the ALTER USER with the CURRENT password. If we
            // don't have it, we cannot change the DB password — and writing a new
            // POSTGRES_PASSWORD/DATABASE_URL to .env anyway would lock the API out
            // of the database. Refuse instead of silently breaking the deployment.
            if (!oldPgPass) {
                (0, ui_1.die)('Cannot rotate the Postgres password: no current POSTGRES_PASSWORD in .env to authenticate the change. Rotate the JWT only (omit --db), or set the current password in .env first.');
            }
            ui_1.ui.heading('Rotating Postgres password');
            const sql = `ALTER USER ${existing.POSTGRES_USER} WITH PASSWORD '${rotated.POSTGRES_PASSWORD.replace(/'/g, "''")}';`;
            const code = await ctx.docker.composeStream(composeArgs(ctx, [
                'exec',
                '-T',
                '-e',
                `PGPASSWORD=${oldPgPass}`,
                'postgres',
                'psql',
                '-v',
                'ON_ERROR_STOP=1',
                '-U',
                existing.POSTGRES_USER,
                '-d',
                existing.POSTGRES_DB,
                '-c',
                sql,
            ]), { cwd: ctx.paths.dataDir, env: ENV });
            if (code !== 0)
                (0, ui_1.die)('Failed to change the Postgres password in the database. .env was NOT modified.');
            ui_1.ui.ok('Postgres password changed in the database.');
        }
        else {
            // JWT-only rotation: keep the existing DB password/URL untouched so the
            // API still authenticates against the unchanged database.
            rotated.POSTGRES_PASSWORD = oldPgPass;
            rotated.DATABASE_URL = existing.DATABASE_URL;
        }
        (0, env_1.writeEnvFile)(ctx.paths.envFile, rotated);
        ui_1.ui.ok('.env updated with rotated secrets.');
        ui_1.ui.heading('Restarting to apply');
        // A full down/up cycle is required so containers pick up new env values.
        await (0, stack_1.down)(ctx, false);
        const code = await (0, stack_1.up)(ctx, false);
        if (code !== 0)
            (0, ui_1.die)('Restart failed after rotation. Check "zone status".');
        ui_1.ui.ok('Secrets rotated and stack restarted.');
    });
    // ---- tls (enable / update HTTPS on an existing install) ----
    program
        .command('tls')
        .description('Enable or update HTTPS (Let\'s Encrypt) for a domain on an existing install')
        .option('--domain <domain>', 'public domain to switch to (e.g. example.com)')
        .option('--acme-email <email>', "email for Let's Encrypt registration/renewal")
        .action(async (opts) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        const existing = (0, env_1.readEnvFile)(ctx.paths.envFile);
        if (Object.keys(existing).length === 0)
            (0, ui_1.die)('No .env found. Run "zone install" first.');
        const domain = opts.domain || existing.DOMAIN;
        if (!domain)
            (0, ui_1.die)('No domain configured. Pass --domain to switch from localhost mode to TLS.');
        const acmeEmail = (opts.acmeEmail || existing.ACME_EMAIL || '').toLowerCase();
        if (!acmeEmail)
            (0, ui_1.die)('No ACME email. Pass --acme-email.');
        if (!(0, tls_1.looksLikeEmail)(acmeEmail))
            (0, ui_1.die)(`ACME email looks invalid: ${acmeEmail}`);
        // Rebuild env in domain mode (recomputes hosts/CORS/VITE_API_URL for the
        // domain), preserving secrets, and persist the ACME email.
        const env = (0, env_1.buildEnv)({ domain, existing });
        env.ACME_EMAIL = acmeEmail;
        (0, env_1.writeEnvFile)(ctx.paths.envFile, env);
        const path = (0, tls_1.renderTraefikProd)(ctx.paths, acmeEmail);
        ui_1.ui.ok(`Domain set to ${domain}; TLS config rendered: ${path}`);
        ui_1.ui.info('DNS for these hosts must point at this server (ports 80+443 open):');
        ui_1.ui.detail('record', env.API_HOST);
        ui_1.ui.detail('record', env.DASHBOARD_HOST);
        ui_1.ui.detail('record', env.ADMIN_HOST);
        ui_1.ui.heading('Rebuilding and restarting with TLS');
        // The dashboard/admin bake VITE_API_URL at build time, so a rebuild is
        // needed when the API host changes (localhost -> domain).
        await (0, stack_1.down)(ctx, false);
        const code = await (0, stack_1.up)(ctx, true);
        if (code !== 0)
            (0, ui_1.die)('Restart failed. Check "zone status" and "zone logs traefik".');
        ui_1.ui.ok('HTTPS enabled. Certificates are issued on first request to each host.');
    });
}
/** pg_dump the database into a gzip file on the host. */
async function doBackup(ctx, outfile) {
    const env = (0, env_1.readEnvFile)(ctx.paths.envFile);
    const user = env.POSTGRES_USER || 'upande';
    const db = env.POSTGRES_DB || 'upande';
    ui_1.ui.step(`Dumping database "${db}" to ${outfile}`);
    // Stream pg_dump | gzip out of the container to a host file via redirection.
    // `set -o pipefail` makes the pipeline fail if pg_dump fails (not just gzip),
    // so a backup error is never reported as success. Requires bash.
    const composeFlags = (0, context_1.composeFiles)(ctx.paths)
        .map((f) => `'${f}'`)
        .join(' ');
    const composeBin = ctx.docker.composeKind === 'standalone' ? 'docker-compose' : 'docker compose';
    const inner = `set -o pipefail; ${composeBin} ${composeFlags} exec -T postgres ` +
        `pg_dump -U '${user}' -d '${db}' | gzip > '${outfile.replace(/'/g, `'\\''`)}'`;
    const cmd = ctx.docker.needsSg ? ['sg', ['docker', '-c', inner]] : ['bash', ['-c', inner]];
    const code = await (0, exec_1.runStream)(cmd[0], cmd[1], {
        cwd: ctx.paths.dataDir,
        env: ENV,
    });
    if (code === 0) {
        ui_1.ui.ok(`Backup written: ${outfile}`);
        return true;
    }
    // A partial/empty file would be misleading — remove it so a failed backup
    // can't be mistaken for a good one later.
    try {
        if ((0, node_fs_1.existsSync)(outfile))
            (0, node_fs_1.unlinkSync)(outfile);
    }
    catch {
        /* best effort */
    }
    ui_1.ui.fail('Backup failed (incomplete file removed).');
    return false;
}
/** Restore from a gzip or plain-SQL dump. */
async function doRestore(ctx, infile) {
    const env = (0, env_1.readEnvFile)(ctx.paths.envFile);
    const user = env.POSTGRES_USER || 'upande';
    const db = env.POSTGRES_DB || 'upande';
    ui_1.ui.step(`Restoring database "${db}" from ${infile}`);
    const composeFlags = (0, context_1.composeFiles)(ctx.paths)
        .map((f) => `'${f}'`)
        .join(' ');
    const composeBin = ctx.docker.composeKind === 'standalone' ? 'docker-compose' : 'docker compose';
    const decompress = infile.endsWith('.gz') ? 'gunzip -c' : 'cat';
    // pipefail: a truncated/corrupt archive (gunzip failure) fails the whole
    // pipeline instead of psql swallowing partial input and exiting 0.
    // ON_ERROR_STOP=1: psql aborts (non-zero) on the first SQL error rather than
    // plowing through and reporting success on a half-applied restore. Requires bash.
    const inner = `set -o pipefail; ${decompress} '${infile.replace(/'/g, `'\\''`)}' | ` +
        `${composeBin} ${composeFlags} exec -T postgres psql -v ON_ERROR_STOP=1 -U '${user}' -d '${db}'`;
    const cmd = ctx.docker.needsSg ? ['sg', ['docker', '-c', inner]] : ['bash', ['-c', inner]];
    const code = await (0, exec_1.runStream)(cmd[0], cmd[1], {
        cwd: ctx.paths.dataDir,
        env: ENV,
    });
    if (code === 0) {
        ui_1.ui.ok('Restore complete.');
        return true;
    }
    ui_1.ui.fail('Restore failed — the database may be partially restored; check "zone logs postgres".');
    return false;
}
