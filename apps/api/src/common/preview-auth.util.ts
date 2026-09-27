import * as crypto from 'crypto';

// Password-protected previews: Traefik basicAuth middleware on the preview's
// own router (pv-<subdomain>). The label carries only the bcrypt hash stored
// in PreviewProtection — never the password. Production routers never get it.

export const PREVIEW_AUTH_LABEL = 'upande.preview-auth';

export function previewAuthMiddleware(previewSubdomain: string): string {
  return `pv-${previewSubdomain}-auth`;
}

// Traefik router/middleware labels for a protected preview ({} = unprotected).
export function previewAuthLabels(
  previewSubdomain: string,
  protection: { username: string; passwordHash: string } | null | undefined,
): Record<string, string> {
  if (!protection) return {};
  const r = `pv-${previewSubdomain}`;
  const mw = previewAuthMiddleware(previewSubdomain);
  return {
    [`traefik.http.middlewares.${mw}.basicauth.users`]: `${protection.username}:${protection.passwordHash}`,
    [`traefik.http.middlewares.${mw}.basicauth.realm`]: 'Preview',
    [`traefik.http.routers.${r}.middlewares`]: mw,
    // Which hash is applied (fingerprint only), to tell stale containers apart.
    [PREVIEW_AUTH_LABEL]: crypto.createHash('sha256').update(protection.passwordHash).digest('hex').slice(0, 12),
  };
}

// Drop every preview-auth label (before applying new ones / unprotecting).
// Other middlewares on the router (e.g. retry) are kept.
export function withoutPreviewAuthLabels(
  labels: Record<string, string>,
  previewSubdomain: string,
): Record<string, string> {
  const mw = previewAuthMiddleware(previewSubdomain);
  const routerMw = `traefik.http.routers.pv-${previewSubdomain}.middlewares`;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (k === PREVIEW_AUTH_LABEL) continue;
    if (k.startsWith(`traefik.http.middlewares.${mw}.`)) continue;
    if (k === routerMw) {
      const rest = v.split(',').map((s) => s.trim()).filter((s) => s && s !== mw);
      if (rest.length) out[k] = rest.join(',');
      continue;
    }
    out[k] = v;
  }
  return out;
}

// Labels with preview auth applied (or removed when protection is null):
// auth runs first, before any other router middleware.
export function applyPreviewAuth(
  labels: Record<string, string>,
  previewSubdomain: string,
  protection: { username: string; passwordHash: string } | null | undefined,
): Record<string, string> {
  const base = withoutPreviewAuthLabels(labels, previewSubdomain);
  if (!protection) return base;
  const routerMw = `traefik.http.routers.pv-${previewSubdomain}.middlewares`;
  const auth = previewAuthLabels(previewSubdomain, protection);
  const others = base[routerMw];
  return { ...base, ...auth, [routerMw]: others ? `${auth[routerMw]},${others}` : auth[routerMw] };
}

// Traefik retry middleware on every router of a container: during the
// zero-downtime overlap, a request that hits the still-booting new container
// (connection refused) is re-sent to the other one. Deterministic name so the
// old and new containers' labels stay identical.
export function withRetryMiddleware(labels: Record<string, string>, name: string): Record<string, string> {
  const mw = `${name}-retry`;
  const out: Record<string, string> = { ...labels };
  out[`traefik.http.middlewares.${mw}.retry.attempts`] = '3';
  out[`traefik.http.middlewares.${mw}.retry.initialinterval`] = '100ms';
  for (const k of Object.keys(labels)) {
    const m = /^traefik\.http\.routers\.([^.]+)\.rule$/.exec(k);
    if (!m) continue;
    const key = `traefik.http.routers.${m[1]}.middlewares`;
    const list = (out[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.includes(mw)) list.push(mw);
    out[key] = list.join(',');
  }
  return out;
}
