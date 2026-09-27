"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSource = resolveSource;
exports.registerInstall = registerInstall;
/**
 * `zone install` — bootstrap Upande Cloud on this server.
 *
 * Registry deployment: the platform runs as PREBUILT images pulled from a
 * registry — no source checkout on the server. The CLI materializes the
 * compose files (bundled in the package) into a data dir, generates .env, then
 * pulls + starts.
 *
 * Orchestrates the full bring-up, idempotently:
 *   1. preflight (abort on hard failures unless --force)
 *   2. ensure Docker is installed + reachable (offer get.docker.com)
 *   3. materialize compose templates into the data dir
 *   4. generate .env with strong secrets (preserve existing on re-run)
 *   5. pull images + bring the stack up
 *   6. apply Prisma migrations
 *   7. create the first superadmin (prompted, unless already present / flags)
 *   8. wait for the API to answer, print access URLs
 *
 * Designed to be safe to re-run: existing secrets are kept, and migrate/up are
 * idempotent. Use --non-interactive for unattended/CI installs.
 */
const prompts_1 = __importDefault(require("prompts"));
const context_1 = require("../lib/context");
const docker_1 = require("../lib/docker");
const exec_1 = require("../lib/exec");
const env_1 = require("../lib/env");
const stack_1 = require("../lib/stack");
const dnsbootstrap_1 = require("../lib/dnsbootstrap");
const templates_1 = require("../lib/templates");
const tls_1 = require("../lib/tls");
const preflight_1 = require("./preflight");
const ui_1 = require("../lib/ui");
const sources_1 = require("../lib/sources");
/** Install Docker via the official convenience script (requires root/sudo). */
async function ensureDocker(opts) {
    let info = (0, docker_1.detectDocker)();
    if (info.reachable && info.composeKind) {
        ui_1.ui.ok(`Docker ${info.version} with compose (${info.composeKind}) present.`);
        return;
    }
    if (!info.installed) {
        if (opts.nonInteractive && !opts.installDocker) {
            (0, ui_1.die)('Docker is not installed. Re-run with --install-docker to install it automatically, or install Docker first.');
        }
        let proceed = opts.installDocker === true;
        if (!proceed && !opts.nonInteractive) {
            const ans = await (0, prompts_1.default)({
                type: 'confirm',
                name: 'go',
                message: 'Docker is not installed. Install it now via https://get.docker.com (needs sudo)?',
                initial: true,
            });
            proceed = ans.go === true;
        }
        if (!proceed)
            (0, ui_1.die)('Docker is required. Aborting.');
        ui_1.ui.step('Installing Docker via get.docker.com (this can take a few minutes)...');
        const code = await (0, exec_1.runStream)('sh', [
            '-c',
            'curl -fsSL https://get.docker.com | sudo sh',
        ]);
        if (code !== 0)
            (0, ui_1.die)('Docker installation failed. Install Docker manually and re-run.');
        ui_1.ui.ok('Docker installed.');
        ui_1.ui.info('If you want to run docker without sudo, add your user to the docker group:');
        ui_1.ui.info('  sudo usermod -aG docker "$USER"   (then log out and back in)');
    }
    info = (0, docker_1.detectDocker)();
    if (!info.reachable) {
        (0, ui_1.die)('Docker is installed but the daemon is not reachable for this user. ' +
            'Start it (sudo systemctl start docker) and/or add your user to the docker group, then re-run.');
    }
    if (!info.composeKind) {
        (0, ui_1.die)('Docker Compose plugin is missing. Install the docker-compose-plugin package and re-run.');
    }
}
/**
 * Decide where images are pulled from. Preference order:
 *   --registry → --source → prompt (interactive) → existing .env → default.
 */
async function resolveSource(ctx, opts) {
    const known = (registry) => ({ registry, mirror: (0, sources_1.mirrorOf)(registry) });
    if (opts.registry) {
        return (0, sources_1.sourceByRegistry)(opts.registry) ? known(opts.registry) : { registry: opts.registry };
    }
    if (opts.source) {
        const src = (0, sources_1.sourceById)(opts.source);
        if (!src)
            (0, ui_1.die)(`Unknown --source "${opts.source}". Choose one of: ${sources_1.IMAGE_SOURCES.map((s) => s.id).join(', ')}.`);
        return known(src.registry);
    }
    const current = (0, env_1.readEnvFile)(ctx.paths.envFile).UPANDE_REGISTRY;
    if (opts.nonInteractive)
        return { registry: current || sources_1.DEFAULT_SOURCE.registry };
    const choices = sources_1.IMAGE_SOURCES.map((s) => ({ title: s.label, description: s.registry, value: s.registry }));
    if (current && !(0, sources_1.sourceByRegistry)(current)) {
        choices.push({ title: 'Keep current', description: current, value: current });
    }
    const initial = Math.max(0, choices.findIndex((c) => c.value === (current || sources_1.DEFAULT_SOURCE.registry)));
    const ans = await (0, prompts_1.default)({
        type: 'select',
        name: 'registry',
        message: 'Pull platform images from',
        choices,
        initial,
    });
    if (!ans.registry)
        (0, ui_1.die)('No image source chosen. Aborting.');
    return (0, sources_1.sourceByRegistry)(ans.registry) ? known(ans.registry) : { registry: ans.registry };
}
/**
 * Resolve/generate the .env, preserving any existing secrets. In domain mode
 * this also persists ACME_EMAIL and renders the Traefik production (TLS)
 * config so Let's Encrypt can issue certificates.
 */
function ensureEnv(ctx, opts, source, acmeEmail) {
    const existing = (0, env_1.readEnvFile)(ctx.paths.envFile);
    const hadEnv = Object.keys(existing).length > 0;
    const env = (0, env_1.buildEnv)({
        domain: opts.domain,
        existing,
        mailAdminEmail: acmeEmail || opts.adminEmail,
    });
    // Registry image source (used by the bundled compose's image: tags).
    env.UPANDE_REGISTRY = source.registry;
    if (source.mirror)
        env.MIRROR_REGISTRY = source.mirror;
    env.UPANDE_TAG = opts.tag || existing.UPANDE_TAG || 'latest';
    // Host data dir — the API mounts this into the one-shot helper that runs
    // `zone upgrade` triggered from the admin UI.
    env.UPANDE_DATA_DIR = ctx.paths.dataDir;
    const domainMode = !!env.DOMAIN;
    if (domainMode) {
        const email = acmeEmail || existing.ACME_EMAIL;
        if (!email)
            (0, ui_1.die)('A domain was given but no ACME email is available. Pass --acme-email or set a superadmin email.');
        if (!(0, tls_1.looksLikeEmail)(email))
            (0, ui_1.die)(`ACME email looks invalid: ${email}`);
        env.ACME_EMAIL = email;
    }
    (0, env_1.writeEnvFile)(ctx.paths.envFile, env);
    if (hadEnv)
        ui_1.ui.ok(`.env updated (existing secrets preserved): ${ctx.paths.envFile}`);
    else
        ui_1.ui.ok(`.env generated with fresh secrets (0600): ${ctx.paths.envFile}`);
    ui_1.ui.detail('DOMAIN', env.DOMAIN || '(localhost mode)');
    ui_1.ui.detail('Source', (0, sources_1.sourceByRegistry)(env.UPANDE_REGISTRY)?.label || 'Custom registry');
    ui_1.ui.detail('Images', `${env.UPANDE_REGISTRY}/{api,dashboard,admin}:${env.UPANDE_TAG}`);
    ui_1.ui.detail('Base images', env.MIRROR_REGISTRY);
    ui_1.ui.detail('API host', env.API_HOST);
    ui_1.ui.detail('Dashboard host', env.DASHBOARD_HOST);
    ui_1.ui.detail('Admin host', env.ADMIN_HOST);
    if (domainMode) {
        const path = (0, tls_1.renderTraefikProd)(ctx.paths, env.ACME_EMAIL);
        ui_1.ui.ok(`TLS enabled — rendered Traefik production config: ${path}`);
        ui_1.ui.detail('ACME email', env.ACME_EMAIL);
    }
    return env;
}
/** Prompt for / validate superadmin credentials. */
async function resolveAdminCreds(opts) {
    if (opts.adminEmail && opts.adminPassword) {
        if (opts.adminPassword.length < 8)
            (0, ui_1.die)('Superadmin password must be at least 8 characters.');
        return { email: opts.adminEmail.toLowerCase(), password: opts.adminPassword };
    }
    if (opts.nonInteractive) {
        ui_1.ui.skip('No --admin-email/--admin-password given in non-interactive mode; skipping superadmin creation.');
        ui_1.ui.info('Create one later with: zone superadmin <email> <password>');
        return null;
    }
    const ans = await (0, prompts_1.default)([
        {
            type: 'text',
            name: 'email',
            message: 'Superadmin email',
            validate: (v) => (/.+@.+\..+/.test(v) ? true : 'Enter a valid email'),
        },
        {
            type: 'password',
            name: 'password',
            message: 'Superadmin password (min 8 chars)',
            validate: (v) => (v.length >= 8 ? true : 'At least 8 characters'),
        },
        {
            type: 'password',
            name: 'confirm',
            message: 'Confirm password',
        },
    ]);
    if (!ans.email || !ans.password) {
        ui_1.ui.skip('Superadmin creation skipped.');
        return null;
    }
    if (ans.password !== ans.confirm)
        (0, ui_1.die)('Passwords did not match.');
    return { email: String(ans.email).toLowerCase(), password: ans.password };
}
/**
 * Resolve the email Let's Encrypt should register. Preference order:
 *   --acme-email → --admin-email → existing ACME_EMAIL in .env → prompt.
 */
async function resolveAcmeEmail(ctx, opts) {
    const fromFlag = opts.acmeEmail || opts.adminEmail;
    if (fromFlag)
        return fromFlag.toLowerCase();
    const existing = (0, env_1.readEnvFile)(ctx.paths.envFile).ACME_EMAIL;
    if (existing)
        return existing;
    if (opts.nonInteractive) {
        (0, ui_1.die)('Domain mode needs an ACME email. Pass --acme-email or --admin-email in non-interactive mode.');
    }
    const ans = await (0, prompts_1.default)({
        type: 'text',
        name: 'email',
        message: "Email for Let's Encrypt (renewal + expiry notices)",
        validate: (v) => (/.+@.+\..+/.test(v) ? true : 'Enter a valid email'),
    });
    if (!ans.email)
        (0, ui_1.die)('An ACME email is required for TLS.');
    return String(ans.email).toLowerCase();
}
function registerInstall(program) {
    program
        .command('install')
        .description('Install and bring up the full Upande Cloud stack on this server')
        .option('--domain <domain>', 'public domain (e.g. example.com); omit for localhost mode')
        .option('--acme-email <email>', "email for Let's Encrypt (defaults to the superadmin email)")
        .option('--source <id>', `image source: ${sources_1.IMAGE_SOURCES.map((s) => s.id).join(' | ')} (prompts if omitted)`)
        .option('--registry <url>', 'custom image registry (overrides --source)')
        .option('--tag <tag>', 'image tag to deploy (default: latest)')
        .option('--admin-email <email>', 'superadmin email (non-interactive)')
        .option('--admin-password <password>', 'superadmin password (non-interactive)')
        .option('--non-interactive', 'never prompt; use flags/defaults only', false)
        .option('--force', 'continue even if preflight reports failures', false)
        .option('--install-docker', 'install Docker automatically if missing', false)
        .action(async (opts) => {
        ui_1.ui.heading('Upande Cloud install');
        // 1. preflight. Port checks are included but only ever WARN (never fail),
        // since on a re-install our own running containers legitimately hold
        // 80/443/4000/5432/6379 — those warnings are expected, not blocking.
        const { failed } = await (0, preflight_1.runPreflight)({ ports: true });
        if (failed > 0 && !opts.force) {
            (0, ui_1.die)(`Preflight reported ${failed} failure(s). Fix them, or re-run with --force to proceed anyway.`);
        }
        // 2. Docker
        ui_1.ui.heading('Docker');
        await ensureDocker(opts);
        // Now that docker is guaranteed, load the context.
        const ctx = (0, context_1.loadContext)({ requireDocker: true });
        // 3. materialize the bundled compose + Traefik files into the data dir.
        ui_1.ui.heading('Deployment files');
        const mat = (0, templates_1.materializeTemplates)(ctx.paths);
        ui_1.ui.ok(`${mat.existed ? 'Refreshed' : 'Created'} data dir: ${mat.dataDir}`);
        ui_1.ui.detail('files', mat.copied.join(', '));
        // 4. env (+ TLS in domain mode)
        ui_1.ui.heading('Configuration');
        const acmeEmail = opts.domain ? await resolveAcmeEmail(ctx, opts) : undefined;
        const source = await resolveSource(ctx, opts);
        const env = ensureEnv(ctx, opts, source, acmeEmail);
        if (env.DOMAIN) {
            ui_1.ui.newline();
            ui_1.ui.info('Before Let\'s Encrypt can issue certificates, these DNS A/AAAA records');
            ui_1.ui.info('must point at THIS server\'s public IP and ports 80 + 443 must be reachable:');
            ui_1.ui.detail('record', env.API_HOST);
            ui_1.ui.detail('record', env.DASHBOARD_HOST);
            ui_1.ui.detail('record', env.ADMIN_HOST);
            ui_1.ui.info('A wildcard *.' + env.DOMAIN + ' record covers all three.');
        }
        // 5. Managed DNS prep — free host port 53 so pdns can bind it. Safe/no-op
        // when systemd-resolved isn't holding it.
        ui_1.ui.heading('Managed DNS');
        (0, dnsbootstrap_1.freePort53)();
        // 6. pull, then start Postgres first and bootstrap the DNS backend BEFORE
        // the rest comes up — so pdns finds its database on first boot (no error,
        // no restart needed).
        ui_1.ui.heading('Pulling images and starting the stack');
        const pullCode = await (0, stack_1.pull)(ctx);
        if (pullCode !== 0) {
            (0, ui_1.die)('docker compose pull failed. Check the registry/tag and that images are published (or that you are logged in for a private registry).');
        }
        await (0, stack_1.upService)(ctx, 'postgres');
        (0, dnsbootstrap_1.bootstrapDns)(ctx);
        const upCode = await (0, stack_1.up)(ctx, false);
        if (upCode !== 0)
            (0, ui_1.die)('docker compose up failed. See output above.');
        ui_1.ui.ok('Containers are up.');
        // 7. migrations
        ui_1.ui.heading('Database migrations');
        const migCode = await (0, stack_1.runMigrations)(ctx);
        if (migCode !== 0)
            (0, ui_1.die)('Prisma migrate deploy failed. See output above.');
        ui_1.ui.ok('Migrations applied.');
        // 6. superadmin
        ui_1.ui.heading('Superadmin');
        const creds = await resolveAdminCreds(opts);
        if (creds) {
            const code = await (0, stack_1.createSuperadmin)(ctx, creds.email, creds.password);
            if (code !== 0)
                ui_1.ui.warn('Superadmin creation reported an error (see above). You can retry with "zone superadmin".');
            else
                ui_1.ui.ok(`Superadmin ready: ${creds.email}`);
        }
        // 7. health
        ui_1.ui.heading('Health');
        ui_1.ui.step('Waiting for the API container to respond...');
        const apiUp = await (0, stack_1.waitForApi)(ctx, 90_000);
        if (apiUp)
            ui_1.ui.ok('API is responding.');
        else
            ui_1.ui.warn('API did not respond within 90s. Check "zone logs api".');
        // Done — print access info.
        const scheme = env.DOMAIN ? 'https' : 'http';
        ui_1.ui.heading('Upande Cloud is installed');
        ui_1.ui.detail('Dashboard', `${scheme}://${env.DASHBOARD_HOST}`);
        ui_1.ui.detail('Admin', `${scheme}://${env.ADMIN_HOST}`);
        ui_1.ui.detail('API', `${scheme}://${env.API_HOST}/v1`);
        ui_1.ui.detail('Mail (Stalwart)', env.MAIL_URL);
        ui_1.ui.detail('Mail admin login', env.MAIL_ADMIN_USER);
        ui_1.ui.detail('Mail admin password', env.MAIL_ADMIN_PASSWORD);
        ui_1.ui.newline();
        ui_1.ui.info(`Managed DNS nameservers: ${env.DNS_NAMESERVERS}`);
        ui_1.ui.info('Customers delegate their domains to these; grant a DNS quota in Admin → Organizations.');
        if (env.DOMAIN) {
            ui_1.ui.newline();
            ui_1.ui.info('TLS: Let\'s Encrypt issues certificates on first request to each host.');
            ui_1.ui.info('The first HTTPS hit may take a few seconds while the cert is obtained.');
            ui_1.ui.info('If certs do not appear, check DNS, that ports 80+443 are open, then "zone logs traefik".');
        }
        else {
            ui_1.ui.newline();
            ui_1.ui.info('Localhost mode: *.localhost resolves automatically on most systems.');
            ui_1.ui.info('On a remote server, map these hostnames to the server IP in your DNS or /etc/hosts.');
        }
        ui_1.ui.newline();
        ui_1.ui.info('Manage the stack with: zone status | logs | restart | down | upgrade');
    });
}
