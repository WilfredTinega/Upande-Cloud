"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDryRun = setDryRun;
exports.isDryRun = isDryRun;
exports.run = run;
exports.runStream = runStream;
exports.commandExists = commandExists;
/**
 * Process execution helpers.
 *
 * All shelling-out goes through here so behavior (streaming, capture, dry-run)
 * is consistent. Commands are run with argv arrays (no shell) wherever possible
 * to avoid injection and quoting bugs.
 */
const node_child_process_1 = require("node:child_process");
let dryRun = false;
function setDryRun(value) {
    dryRun = value;
}
function isDryRun() {
    return dryRun;
}
function fmt(cmd, args) {
    return [cmd, ...args]
        .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
        .join(' ');
}
/** Run a command and capture output. Throws on non-zero unless allowFailure. */
function run(cmd, args, opts = {}) {
    if (dryRun && !opts.alwaysRun) {
        process.stdout.write('  [dry-run] ' + fmt(cmd, args) + '\n');
        return { code: 0, stdout: '', stderr: '' };
    }
    const res = (0, node_child_process_1.spawnSync)(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        input: opts.input,
        encoding: 'utf8',
        stdio: opts.inherit ? 'inherit' : 'pipe',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) {
        if (opts.allowFailure) {
            return { code: 127, stdout: '', stderr: String(res.error.message) };
        }
        throw new Error(`Failed to run "${fmt(cmd, args)}": ${res.error.message}`);
    }
    const result = {
        code: res.status ?? 1,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
    };
    if (result.code !== 0 && !opts.allowFailure) {
        const detail = (result.stderr || result.stdout || '').trim();
        throw new Error(`Command failed (exit ${result.code}): ${fmt(cmd, args)}` +
            (detail ? `\n${detail}` : ''));
    }
    return result;
}
/** Run a command, streaming output live. Resolves with the exit code. */
function runStream(cmd, args, opts = {}) {
    if (dryRun) {
        process.stdout.write('  [dry-run] ' + fmt(cmd, args) + '\n');
        return Promise.resolve(0);
    }
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(cmd, args, {
            cwd: opts.cwd,
            env: opts.env ? { ...process.env, ...opts.env } : process.env,
            stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
    });
}
/** True if a command exists on PATH. */
function commandExists(cmd) {
    const res = (0, node_child_process_1.spawnSync)('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
    return res.status === 0 && res.stdout.trim().length > 0;
}
