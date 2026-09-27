"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPreflight = runPreflight;
exports.registerPreflight = registerPreflight;
/**
 * `zone preflight` — read-only environment readiness report.
 *
 * Exits non-zero if any check is a hard failure, so it can gate CI / install.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const docker_1 = require("../lib/docker");
const paths_1 = require("../lib/paths");
const checks_1 = require("../lib/checks");
const ui_1 = require("../lib/ui");
function emit(r) {
    const line = `${r.name}: ${r.detail}`;
    if (r.level === 'ok')
        ui_1.ui.ok(line);
    else if (r.level === 'warn')
        ui_1.ui.warn(line);
    else
        ui_1.ui.fail(line);
}
async function runPreflight(opts = {}) {
    const results = [];
    ui_1.ui.heading('System');
    const paths = (0, paths_1.resolvePaths)();
    // Check disk where the data dir lives (or its parent if not yet created).
    const diskTarget = (0, node_fs_1.existsSync)(paths.dataDir) ? paths.dataDir : (0, node_path_1.resolve)(paths.dataDir, '..');
    ui_1.ui.ok(`Data dir: ${paths.dataDir}${(0, node_fs_1.existsSync)(paths.dataDir) ? '' : ' (will be created)'}`);
    [(0, checks_1.checkOS)(), (0, checks_1.checkMemory)(), (0, checks_1.checkDisk)(diskTarget)].forEach((r) => {
        results.push(r);
        emit(r);
    });
    ui_1.ui.heading('Docker');
    const dockerResults = (0, checks_1.checkDocker)((0, docker_1.detectDocker)());
    dockerResults.forEach((r) => {
        results.push(r);
        emit(r);
    });
    if (opts.ports !== false) {
        ui_1.ui.heading('Ports');
        const portResults = await (0, checks_1.checkPorts)();
        portResults.forEach((r) => {
            results.push(r);
            emit(r);
        });
    }
    const failed = results.filter((r) => r.level === 'fail').length;
    const warned = results.filter((r) => r.level === 'warn').length;
    ui_1.ui.heading('Summary');
    if (failed === 0 && warned === 0)
        ui_1.ui.ok('All checks passed.');
    else
        ui_1.ui.info(`${failed} failed, ${warned} warning(s).`);
    return { failed, warned };
}
function registerPreflight(program) {
    program
        .command('preflight')
        .description('Check that this server is ready to run Upande Cloud (read-only)')
        .option('--no-ports', 'skip TCP port availability checks')
        .action(async (opts) => {
        const { failed } = await runPreflight(opts);
        process.exit(failed > 0 ? 1 : 0);
    });
}
