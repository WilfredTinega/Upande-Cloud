// Environment-scoped env vars (like Vercel's Production / Preview).
//   all        → every deploy (default; rows created before scopes existed)
//   production → production deploys only
//   preview    → preview deploys only
// The same key may exist once per scope. For a deploy target the scoped value
// beats the `all` one.

export const ENV_SCOPES = ['all', 'production', 'preview'] as const;
export type EnvScope = (typeof ENV_SCOPES)[number];
export type EnvTarget = 'production' | 'preview';

export function isEnvScope(v: unknown): v is EnvScope {
  return typeof v === 'string' && (ENV_SCOPES as readonly string[]).includes(v);
}

// The env vars a deploy of `target` receives: all + <target>, scoped wins.
export function effectiveEnvVars<T extends { key: string; scope?: string | null }>(
  vars: T[],
  target: EnvTarget,
): T[] {
  const byKey = new Map<string, T>();
  for (const v of vars) if ((v.scope ?? 'all') === 'all') byKey.set(v.key, v);
  for (const v of vars) if (v.scope === target) byKey.set(v.key, v);
  return [...byKey.values()];
}
