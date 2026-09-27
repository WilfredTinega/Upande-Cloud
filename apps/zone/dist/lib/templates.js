"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializeTemplates = materializeTemplates;
exports.readTemplate = readTemplate;
/**
 * Materialize bundled templates into the server data dir.
 *
 * On install the CLI copies its packaged compose + Traefik files into the data
 * dir so `docker compose` can run there. Existing files are overwritten so an
 * upgrade picks up new template versions — but .env and rendered secrets are
 * never templates and are left untouched.
 *
 * The compose files mount service config from a `services/` subtree relative to
 * the data dir (e.g. `./services/dns/pdns.conf`, `./services/proxy/...`), so the
 * whole `services/` tree is shipped in the package and copied recursively too.
 * Without this, `docker compose up` for pdns / traefik / fallback would mount
 * non-existent paths and fail.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const paths_1 = require("./paths");
const TEMPLATE_FILES = [
    'docker-compose.yml',
    'docker-compose.prod.yml',
    'docker-compose.vps.yml',
    'traefik.yml',
    'traefik.prod.yml.template',
];
// Directory subtrees copied verbatim into the data dir (preserving structure).
const TEMPLATE_DIRS = ['services'];
/** Recursively copy a directory tree, overwriting existing files. */
function copyTree(srcDir, destDir, copied, rel = '') {
    (0, node_fs_1.mkdirSync)(destDir, { recursive: true });
    for (const entry of (0, node_fs_1.readdirSync)(srcDir)) {
        const src = (0, node_path_1.join)(srcDir, entry);
        const dest = (0, node_path_1.join)(destDir, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        if ((0, node_fs_1.statSync)(src).isDirectory()) {
            copyTree(src, dest, copied, relPath);
        }
        else {
            (0, node_fs_1.copyFileSync)(src, dest);
            copied.push(relPath);
        }
    }
}
/** Copy all bundled templates into the data dir. */
function materializeTemplates(paths) {
    const existed = (0, paths_1.ensureDataDir)(paths);
    const copied = [];
    for (const name of TEMPLATE_FILES) {
        const src = (0, node_path_1.join)(paths.templatesDir, name);
        if (!(0, node_fs_1.existsSync)(src)) {
            throw new Error(`Bundled template missing: ${src}. The CLI package may be corrupt; reinstall @upande-cloud/zone.`);
        }
        (0, node_fs_1.copyFileSync)(src, (0, node_path_1.join)(paths.dataDir, name));
        copied.push(name);
    }
    for (const dir of TEMPLATE_DIRS) {
        const src = (0, node_path_1.join)(paths.templatesDir, dir);
        if (!(0, node_fs_1.existsSync)(src)) {
            throw new Error(`Bundled template dir missing: ${src}. The CLI package may be corrupt; reinstall @upande-cloud/zone.`);
        }
        copyTree(src, (0, node_path_1.join)(paths.dataDir, dir), copied, dir);
    }
    return { dataDir: paths.dataDir, existed, copied };
}
/** Read a bundled template's contents (e.g. the Traefik prod template). */
function readTemplate(paths, name) {
    const src = (0, node_path_1.join)(paths.templatesDir, name);
    if (!(0, node_fs_1.existsSync)(src)) {
        throw new Error(`Bundled template missing: ${src}.`);
    }
    return (0, node_fs_1.readFileSync)(src, 'utf8');
}
