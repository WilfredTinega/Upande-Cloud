"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDataDir = resolveDataDir;
exports.templatesDir = templatesDir;
exports.resolvePaths = resolvePaths;
exports.ensureDataDir = ensureDataDir;
/**
 * Filesystem layout for a registry-based deployment.
 *
 * The CLI is installed standalone (npm i -g @upande-cloud/zone) and does NOT need
 * the platform source on the server. Instead it owns a DATA DIRECTORY where it
 * writes the compose files (materialized from templates bundled in the
 * package), the rendered Traefik config, .env, and backups.
 *
 * Data dir resolution: UPANDE_DATA_DIR env, else /opt/upande-cloud when writable
 * (or root), else ~/.upande-cloud. The chosen dir is created on demand.
 *
 * The bundled templates live next to the compiled code, at <pkg>/templates.
 */
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const SYSTEM_DIR = '/opt/upande-cloud';
function canWriteParent(dir) {
    const parent = (0, node_path_1.resolve)(dir, '..');
    try {
        (0, node_fs_1.accessSync)(parent, node_fs_1.constants.W_OK);
        return true;
    }
    catch {
        return false;
    }
}
/** Decide where the data dir should be (does not create it). */
function resolveDataDir() {
    if (process.env.UPANDE_DATA_DIR)
        return (0, node_path_1.resolve)(process.env.UPANDE_DATA_DIR);
    // Prefer the system location when we can create/own it (root or writable /opt).
    if (process.getuid && process.getuid() === 0)
        return SYSTEM_DIR;
    if ((0, node_fs_1.existsSync)(SYSTEM_DIR)) {
        try {
            (0, node_fs_1.accessSync)(SYSTEM_DIR, node_fs_1.constants.W_OK);
            return SYSTEM_DIR;
        }
        catch {
            /* fall through to home */
        }
    }
    else if (canWriteParent(SYSTEM_DIR)) {
        return SYSTEM_DIR;
    }
    return (0, node_path_1.join)((0, node_os_1.homedir)(), '.upande-cloud');
}
/** Locate the bundled templates dir (sibling of dist/, inside the package). */
function templatesDir() {
    // Compiled file lives at <pkg>/dist/lib/paths.js → templates at <pkg>/templates.
    const candidates = [
        (0, node_path_1.resolve)(__dirname, '..', '..', 'templates'), // from dist/lib
        (0, node_path_1.resolve)(__dirname, '..', 'templates'), // from dist (if flattened)
    ];
    for (const c of candidates) {
        if ((0, node_fs_1.existsSync)(c))
            return c;
    }
    // Last resort: assume the first candidate; callers will error clearly if missing.
    return candidates[0];
}
function resolvePaths() {
    const dataDir = resolveDataDir();
    return {
        dataDir,
        templatesDir: templatesDir(),
        composeBase: (0, node_path_1.join)(dataDir, 'docker-compose.yml'),
        composeProd: (0, node_path_1.join)(dataDir, 'docker-compose.prod.yml'),
        composeVps: (0, node_path_1.join)(dataDir, 'docker-compose.vps.yml'),
        // Compose mounts ./services/proxy/traefik.prod.yml, so the rendered prod
        // config must live there (not flat in the data dir).
        traefikProd: (0, node_path_1.join)(dataDir, 'services', 'proxy', 'traefik.prod.yml'),
        envFile: (0, node_path_1.join)(dataDir, '.env'),
        backupsDir: (0, node_path_1.join)(dataDir, 'backups'),
    };
}
/** Create the data dir if needed; returns whether it already existed. */
function ensureDataDir(paths) {
    const existed = (0, node_fs_1.existsSync)(paths.dataDir);
    if (!existed)
        (0, node_fs_1.mkdirSync)(paths.dataDir, { recursive: true });
    return existed;
}
