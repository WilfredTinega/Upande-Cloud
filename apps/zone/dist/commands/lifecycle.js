"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLifecycle = registerLifecycle;
/**
 * Lifecycle commands: up, down, restart, status, logs, migrate, superadmin.
 * These all operate on an already-installed stack.
 */
const prompts_1 = __importDefault(require("prompts"));
const context_1 = require("../lib/context");
const stack_1 = require("../lib/stack");
const ui_1 = require("../lib/ui");
function registerLifecycle(program) {
    program
        .command('up')
        .description('Start the Upande Cloud stack')
        .option('--pull', 'pull the latest images before starting', false)
        .action(async (opts) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        const code = await (0, stack_1.up)(ctx, opts.pull === true);
        process.exit(code);
    });
    program
        .command('down')
        .description('Stop and remove the Upande Cloud containers')
        .option('--volumes', 'also remove named volumes (DESTROYS the database)', false)
        .option('-y, --yes', 'skip the confirmation prompt', false)
        .action(async (opts) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        if (opts.volumes && !opts.yes) {
            const ans = await (0, prompts_1.default)({
                type: 'confirm',
                name: 'go',
                message: 'This will DELETE the database and Redis volumes. Continue?',
                initial: false,
            });
            if (!ans.go)
                (0, ui_1.die)('Aborted.');
        }
        const code = await (0, stack_1.down)(ctx, opts.volumes === true);
        process.exit(code);
    });
    program
        .command('restart [service]')
        .description('Restart all services, or a single one (api, dashboard, admin, postgres, redis, traefik)')
        .action(async (service) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        const code = await (0, stack_1.restart)(ctx, service);
        process.exit(code);
    });
    program
        .command('logs [service]')
        .description('Show container logs (optionally for one service)')
        .option('-f, --follow', 'follow log output', false)
        .option('-n, --tail <lines>', 'number of lines to show from the end', '200')
        .action(async (service, opts) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        const code = await (0, stack_1.logs)(ctx, service, opts.follow === true, opts.tail);
        process.exit(code);
    });
    program
        .command('status')
        .description('Show container status, migrations note, and API health')
        .action(async () => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        ui_1.ui.heading('Services');
        const services = (0, stack_1.psStatus)(ctx);
        if (services.length === 0) {
            ui_1.ui.warn('No Upande Cloud containers found. Run "zone install" or "zone up".');
        }
        else {
            for (const s of services) {
                const detail = s.health ? `${s.state} (${s.health})` : s.state;
                const running = /up|running/i.test(s.state);
                if (running && (!s.health || /healthy/i.test(s.health)))
                    ui_1.ui.ok(`${s.name}: ${detail}`);
                else if (running)
                    ui_1.ui.warn(`${s.name}: ${detail}`);
                else
                    ui_1.ui.fail(`${s.name}: ${detail}`);
            }
        }
        ui_1.ui.heading('API');
        const probe = (0, stack_1.probeApi)(ctx);
        if (probe.up)
            ui_1.ui.ok(`responding (HTTP ${probe.status})`);
        else
            ui_1.ui.fail('not responding (try "zone logs api")');
    });
    program
        .command('migrate')
        .description('Apply pending Prisma migrations (prisma migrate deploy)')
        .action(async () => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        const code = await (0, stack_1.runMigrations)(ctx);
        if (code === 0)
            ui_1.ui.ok('Migrations applied.');
        process.exit(code);
    });
    program
        .command('superadmin [email] [password] [orgName]')
        .description('Create or promote the platform superadmin')
        .action(async (email, password, orgName) => {
        const ctx = (0, context_1.loadContext)({ requireDocker: true, requireInstalled: true });
        if (!email || !password) {
            const ans = await (0, prompts_1.default)([
                {
                    type: email ? null : 'text',
                    name: 'email',
                    message: 'Superadmin email',
                    validate: (v) => (/.+@.+\..+/.test(v) ? true : 'Enter a valid email'),
                },
                {
                    type: password ? null : 'password',
                    name: 'password',
                    message: 'Superadmin password (min 8 chars)',
                    validate: (v) => (v.length >= 8 ? true : 'At least 8 characters'),
                },
            ]);
            email = email ?? ans.email;
            password = password ?? ans.password;
        }
        if (!email || !password)
            (0, ui_1.die)('Email and password are required.');
        if (password.length < 8)
            (0, ui_1.die)('Password must be at least 8 characters.');
        const code = await (0, stack_1.createSuperadmin)(ctx, email.toLowerCase(), password, orgName || 'Administrator');
        process.exit(code);
    });
}
