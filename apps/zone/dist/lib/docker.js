"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Docker = void 0;
exports.detectDocker = detectDocker;
/**
 * Docker and Docker Compose abstraction.
 *
 * Handles two real-world wrinkles observed on Upande Cloud servers:
 *   1. `docker compose` (v2 plugin) vs legacy `docker-compose` (v1 binary).
 *   2. The invoking user may not be in the `docker` group, so direct `docker`
 *      calls fail with a socket-permission error. When that happens and the
 *      user can `sg docker`, we transparently wrap commands in
 *      `sg docker -c "..."`.
 *
 * detectDocker() resolves the right invocation once; callers use the returned
 * Docker instance for everything else.
 */
const exec_1 = require("./exec");
/**
 * Quote and join argv into a single shell string for `sg docker -c`.
 */
function shellJoin(args) {
    return args
        .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
        .join(' ');
}
class Docker {
    constructor(info) {
        this.info = info;
    }
    get needsSg() {
        return this.info.needsSg;
    }
    get composeKind() {
        return this.info.composeKind;
    }
    /** Build the argv for a compose command, applying compose-kind + sg wrapper. */
    composeArgv(args) {
        const base = this.info.composeKind === 'standalone'
            ? { bin: 'docker-compose', prefix: [] }
            : { bin: 'docker', prefix: ['compose'] };
        const full = [...base.prefix, ...args];
        if (this.info.needsSg) {
            return {
                cmd: 'sg',
                argv: ['docker', '-c', `${base.bin} ${shellJoin(full)}`],
            };
        }
        return { cmd: base.bin, argv: full };
    }
    compose(args, opts = {}) {
        const { cmd, argv } = this.composeArgv(args);
        return (0, exec_1.run)(cmd, argv, opts);
    }
    composeStream(args, opts = {}) {
        const { cmd, argv } = this.composeArgv(args);
        return (0, exec_1.runStream)(cmd, argv, opts);
    }
}
exports.Docker = Docker;
/**
 * Probe the environment and decide how to invoke docker / compose.
 */
function detectDocker() {
    const info = {
        installed: false,
        reachable: false,
        needsSg: false,
        composeKind: null,
    };
    info.installed = (0, exec_1.commandExists)('docker');
    if (!info.installed)
        return info;
    // Can we reach the daemon directly?
    let probe = (0, exec_1.run)('docker', ['version', '--format', '{{.Server.Version}}'], {
        allowFailure: true, alwaysRun: true,
    });
    if (probe.code === 0 && probe.stdout.trim()) {
        info.reachable = true;
        info.version = probe.stdout.trim();
    }
    else if ((0, exec_1.commandExists)('sg')) {
        // Try via sg docker (user not in docker group but can sg into it).
        const sg = (0, exec_1.run)('sg', ['docker', '-c', 'docker version --format "{{.Server.Version}}"'], { allowFailure: true, alwaysRun: true });
        if (sg.code === 0 && sg.stdout.trim()) {
            info.reachable = true;
            info.needsSg = true;
            info.version = sg.stdout.trim();
        }
    }
    if (!info.reachable)
        return info;
    // Detect compose flavor (respecting sg if needed).
    const exec = (s) => info.needsSg
        ? (0, exec_1.run)('sg', ['docker', '-c', s], { allowFailure: true, alwaysRun: true })
        : (0, exec_1.run)('sh', ['-c', s], { allowFailure: true, alwaysRun: true });
    const plugin = exec('docker compose version --short');
    if (plugin.code === 0 && plugin.stdout.trim()) {
        info.composeKind = 'plugin';
        info.composeVersion = plugin.stdout.trim();
    }
    else if ((0, exec_1.commandExists)('docker-compose')) {
        const standalone = exec('docker-compose version --short');
        if (standalone.code === 0) {
            info.composeKind = 'standalone';
            info.composeVersion = standalone.stdout.trim();
        }
    }
    return info;
}
