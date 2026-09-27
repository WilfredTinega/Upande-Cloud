#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * zone — operator CLI for installing and maintaining Upande Cloud on a
 * Linux server.
 *
 *   zone preflight      check server readiness
 *   zone install        bootstrap the full stack
 *   zone up|down|restart|status|logs
 *   zone migrate        apply DB migrations
 *   zone superadmin     create/promote the platform admin
 *   zone upgrade        pull, rebuild, migrate, restart
 *   zone backup|restore database snapshots
 *   zone secrets rotate rotate JWT / DB secrets
 */
const commander_1 = require("commander");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const exec_1 = require("./lib/exec");
// Read the real version from package.json (dist/index.js → ../package.json) so
// it never drifts from what's published/installed.
function pkgVersion() {
    try {
        const pkg = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, '..', 'package.json'), 'utf8'));
        return pkg.version || '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
const ui_1 = require("./lib/ui");
const preflight_1 = require("./commands/preflight");
const install_1 = require("./commands/install");
const lifecycle_1 = require("./commands/lifecycle");
const maintenance_1 = require("./commands/maintenance");
const program = new commander_1.Command();
program
    .name('zone')
    .description('Operator CLI to install, run, and maintain Upande Cloud on Linux servers')
    .version(pkgVersion())
    .option('--dry-run', 'print commands instead of executing them', false)
    .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().dryRun) {
        (0, exec_1.setDryRun)(true);
        ui_1.ui.warn('dry-run: no changes will be made.');
    }
});
(0, preflight_1.registerPreflight)(program);
(0, install_1.registerInstall)(program);
(0, lifecycle_1.registerLifecycle)(program);
(0, maintenance_1.registerMaintenance)(program);
program.parseAsync(process.argv).catch((err) => {
    ui_1.ui.fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
