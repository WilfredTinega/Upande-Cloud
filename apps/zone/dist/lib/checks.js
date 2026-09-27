"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_PORTS = void 0;
exports.portFree = portFree;
exports.checkOS = checkOS;
exports.checkMemory = checkMemory;
exports.checkDisk = checkDisk;
exports.checkDocker = checkDocker;
exports.checkPorts = checkPorts;
/**
 * System preflight checks for a Upande Cloud server install.
 *
 * Each check returns a status so the install flow can decide whether to
 * proceed. Checks are intentionally read-only and side-effect free.
 */
const node_net_1 = require("node:net");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const exec_1 = require("./exec");
/** Ports the platform needs free (or owned by our own containers). */
exports.REQUIRED_PORTS = [
    { port: 80, what: 'Traefik HTTP entrypoint' },
    { port: 443, what: 'Traefik HTTPS entrypoint (domain mode)' },
    { port: 4000, what: 'API' },
    { port: 5432, what: 'Postgres' },
    { port: 6379, what: 'Redis' },
];
/** Check if a TCP port can be bound on 0.0.0.0 right now. */
function portFree(port) {
    return new Promise((resolve) => {
        const srv = (0, node_net_1.createServer)();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        srv.listen(port, '0.0.0.0');
    });
}
function checkOS() {
    if (process.platform !== 'linux') {
        return {
            name: 'Operating system',
            level: 'warn',
            detail: `${process.platform} — Upande Cloud is designed for Linux servers; Docker behavior may differ.`,
        };
    }
    let pretty = 'Linux';
    const res = (0, exec_1.run)('sh', ['-c', '. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"'], {
        allowFailure: true,
    });
    if (res.code === 0 && res.stdout.trim())
        pretty = res.stdout.trim();
    return { name: 'Operating system', level: 'ok', detail: pretty };
}
function checkMemory(minGb = 2) {
    const gb = (0, node_os_1.totalmem)() / 1024 ** 3;
    const detail = `${gb.toFixed(1)} GiB total RAM`;
    if (gb < minGb) {
        return {
            name: 'Memory',
            level: 'warn',
            detail: `${detail} (recommended >= ${minGb} GiB; builds may fail under memory pressure)`,
        };
    }
    return { name: 'Memory', level: 'ok', detail };
}
function checkDisk(path, minGb = 10) {
    try {
        const s = (0, node_fs_1.statfsSync)(path);
        const freeGb = (s.bavail * s.bsize) / 1024 ** 3;
        const detail = `${freeGb.toFixed(1)} GiB free at ${path}`;
        if (freeGb < minGb) {
            return {
                name: 'Disk space',
                level: 'warn',
                detail: `${detail} (recommended >= ${minGb} GiB for images + volumes)`,
            };
        }
        return { name: 'Disk space', level: 'ok', detail };
    }
    catch (err) {
        return {
            name: 'Disk space',
            level: 'warn',
            detail: `could not determine free space: ${err instanceof Error ? err.message : err}`,
        };
    }
}
function checkDocker(info) {
    const out = [];
    if (!info.installed) {
        out.push({
            name: 'Docker',
            level: 'fail',
            detail: 'not installed (zone install can set it up via get.docker.com)',
        });
        return out;
    }
    if (!info.reachable) {
        out.push({
            name: 'Docker daemon',
            level: 'fail',
            detail: 'installed but not reachable (daemon stopped, or user lacks docker-group access)',
        });
        return out;
    }
    out.push({
        name: 'Docker',
        level: 'ok',
        detail: `engine ${info.version}${info.needsSg ? ' (via sg docker)' : ''}`,
    });
    if (!info.composeKind) {
        out.push({ name: 'Docker Compose', level: 'fail', detail: 'not available' });
    }
    else {
        out.push({
            name: 'Docker Compose',
            level: 'ok',
            detail: `${info.composeVersion ?? '?'} (${info.composeKind})`,
        });
    }
    return out;
}
async function checkPorts(ports = exports.REQUIRED_PORTS) {
    const results = [];
    for (const { port, what } of ports) {
        const free = await portFree(port);
        results.push({
            name: `Port ${port}`,
            level: free ? 'ok' : 'warn',
            detail: free
                ? `free (${what})`
                : `in use — ${what}. If it is held by an existing Upande Cloud container this is fine; otherwise free it.`,
        });
    }
    return results;
}
