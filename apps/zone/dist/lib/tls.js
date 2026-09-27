"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTraefikProd = renderTraefikProd;
exports.looksLikeEmail = looksLikeEmail;
/**
 * TLS / Let's Encrypt setup for VPS deployments.
 *
 * Traefik's static config does not interpolate environment variables, so the
 * ACME email is baked in by rendering traefik.prod.yml in the data dir from the
 * bundled traefik.prod.yml.template. Called by `install --domain ...` and by
 * `zone tls`.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const templates_1 = require("./templates");
const PLACEHOLDER = '__ACME_EMAIL__';
/**
 * Render traefik.prod.yml into the data dir with the given ACME email.
 * Returns the path written.
 */
function renderTraefikProd(paths, acmeEmail) {
    const tpl = (0, templates_1.readTemplate)(paths, 'traefik.prod.yml.template');
    const rendered = tpl.split(PLACEHOLDER).join(acmeEmail);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(paths.traefikProd), { recursive: true });
    (0, node_fs_1.writeFileSync)(paths.traefikProd, rendered);
    return paths.traefikProd;
}
/** Basic email shape check (good enough to catch typos before ACME fails). */
function looksLikeEmail(value) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
