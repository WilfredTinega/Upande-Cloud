"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadContext = loadContext;
exports.composeFiles = composeFiles;
exports.isDomainMode = isDomainMode;
/**
 * Shared command context: data-dir paths + a configured Docker instance +
 * the compose-file flags every lifecycle command needs.
 */
const node_fs_1 = require("node:fs");
const docker_1 = require("./docker");
const paths_1 = require("./paths");
const env_1 = require("./env");
const ui_1 = require("./ui");
/**
 * Resolve the data dir and docker once. If requireDocker is true, exit with a
 * helpful message when the daemon is not reachable. If requireInstalled is
 * true, exit when the data dir has no materialized compose file yet.
 */
function loadContext(opts = {}) {
    const paths = (0, paths_1.resolvePaths)();
    if (opts.requireInstalled && !(0, node_fs_1.existsSync)(paths.composeBase)) {
        (0, ui_1.die)(`Upande Cloud is not installed in ${paths.dataDir} ` +
            `(no docker-compose.yml). Run "zone install" first, ` +
            `or set UPANDE_DATA_DIR to the right location.`);
    }
    const info = (0, docker_1.detectDocker)();
    if (opts.requireDocker) {
        if (!info.installed) {
            (0, ui_1.die)('Docker is not installed. Run "zone install" to set it up, or install Docker first.');
        }
        if (!info.reachable) {
            (0, ui_1.die)('Docker is installed but the daemon is not reachable. Start it with ' +
                '"sudo systemctl start docker", or add your user to the docker group ' +
                '("sudo usermod -aG docker $USER" then re-login).');
        }
        if (!info.composeKind) {
            (0, ui_1.die)('Docker Compose is not available (neither the "docker compose" plugin nor "docker-compose").');
        }
    }
    return { paths, docker: new docker_1.Docker(info) };
}
/**
 * The -f flags for compose. Always includes the base file; includes the VPS
 * overlay (TLS / Let's Encrypt / :443) when present and the deployment is in
 * domain mode — detected by DOMAIN being set in .env. Reading .env here keeps
 * every lifecycle command consistent with how the stack was brought up.
 */
function composeFiles(paths) {
    const flags = ['-f', paths.composeBase];
    // The prod overlay defines the prebuilt-image app services (api/dashboard/
    // admin). Without it the base compose's commented-out stubs leave `api` with
    // no image/build context — so include it whenever it's present.
    if ((0, node_fs_1.existsSync)(paths.composeProd)) {
        flags.push('-f', paths.composeProd);
    }
    if ((0, node_fs_1.existsSync)(paths.composeVps) && isDomainMode(paths)) {
        flags.push('-f', paths.composeVps);
    }
    return flags;
}
/** True when .env has a non-empty DOMAIN (a real VPS deployment). */
function isDomainMode(paths) {
    const env = (0, env_1.readEnvFile)(paths.envFile);
    return !!(env.DOMAIN && env.DOMAIN.trim().length > 0);
}
