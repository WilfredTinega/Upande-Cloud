"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ui = void 0;
exports.die = die;
/**
 * Terminal UX helpers for zone.
 *
 * No emojis (project rule). Uses ASCII status markers and picocolors for color.
 * Color is disabled automatically when stdout is not a TTY or NO_COLOR is set.
 */
const picocolors_1 = __importDefault(require("picocolors"));
const isTTY = process.stdout.isTTY === true && !process.env.NO_COLOR;
function paint(fn, s) {
    return isTTY ? fn(s) : s;
}
exports.ui = {
    /** Section heading. */
    heading(text) {
        process.stdout.write('\n' + paint(picocolors_1.default.bold, text) + '\n');
    },
    /** Informational line. */
    info(text) {
        process.stdout.write('  ' + text + '\n');
    },
    /** A step that is starting (no newline status yet). */
    step(text) {
        process.stdout.write('  ' + paint(picocolors_1.default.cyan, '> ') + text + '\n');
    },
    ok(text) {
        process.stdout.write('  ' + paint(picocolors_1.default.green, 'OK   ') + text + '\n');
    },
    warn(text) {
        process.stdout.write('  ' + paint(picocolors_1.default.yellow, 'WARN ') + text + '\n');
    },
    fail(text) {
        process.stderr.write('  ' + paint(picocolors_1.default.red, 'FAIL ') + text + '\n');
    },
    /** Skipped / not-applicable. */
    skip(text) {
        process.stdout.write('  ' + paint(picocolors_1.default.dim, 'SKIP ') + text + '\n');
    },
    /** A key: value detail line. */
    detail(key, value) {
        process.stdout.write('    ' + paint(picocolors_1.default.dim, key + ':') + ' ' + value + '\n');
    },
    dim(text) {
        return paint(picocolors_1.default.dim, text);
    },
    bold(text) {
        return paint(picocolors_1.default.bold, text);
    },
    newline() {
        process.stdout.write('\n');
    },
};
/** Print an error and exit. */
function die(message, code = 1) {
    exports.ui.fail(message);
    process.exit(code);
}
