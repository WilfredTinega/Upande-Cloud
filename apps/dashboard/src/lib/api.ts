import type {
  App,
  ContainerStatus,
  Deployment,
  DeploymentHistoryItem,
  EnvScope,
  EnvVarItem,
  PreviewItem,
  PreviewList,
  PromoteCheck,
  FrameworkDetection,
  PreviewProtection,
  User,
  Notification,
  SupportCategory,
  SupportConversation,
  SupportMessage,
  SupportStatus,
} from "../types";

// API base resolution order:
//   1. window.__UPANDE_CONFIG__.apiUrl — injected at container runtime by
//      nginx's entrypoint from the UPANDE_API_URL env var. This lets ONE
//      prebuilt image serve any domain (set by the operator / upandectl).
//   2. VITE_API_URL — baked at build time (used in local dev / source builds).
//   3. localhost fallback for `npm run dev`.
declare global {
  interface Window {
    __UPANDE_CONFIG__?: { apiUrl?: string };
  }
}

const BASE =
  (typeof window !== "undefined" && window.__UPANDE_CONFIG__?.apiUrl) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "http://localhost:4000";

export function getToken(): string | null {
  return localStorage.getItem("upande-token");
}

export function setToken(token: string): void {
  localStorage.setItem("upande-token", token);
}

export function clearToken(): void {
  localStorage.removeItem("upande-token");
}

// Fired when an authenticated request gets 401 (session ended).
export const UNAUTHORIZED_EVENT = "upande:unauthorized";

// EventSource can't send an Authorization header, so SSE URLs carry a
// short-lived (60s) stream ticket — never the session token.
export async function streamUrl(path: string): Promise<string> {
  const url = new URL(`${BASE}${path}`);
  if (getToken()) {
    const { ticket } = await request<{ ticket: string }>("/v1/auth/stream-ticket", { method: "POST" });
    url.searchParams.set("token", ticket);
  }
  return url.toString();
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    // Session revoked/expired (e.g. password changed elsewhere): drop the token
    // and let the AuthProvider send the user to /login (not for the login call
    // itself, which answers 401 for a wrong password).
    if (res.status === 401 && token && !path.startsWith("/v1/auth/login")) {
      clearToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const err = await res.json().catch(() => ({ error: { code: "UNKNOWN", message: res.statusText } }));
    // Carry the HTTP status so callers can tell e.g. "not found" from other failures.
    throw Object.assign(
      new Error((err as { error?: { message?: string } })?.error?.message ?? res.statusText),
      { status: res.status },
    );
  }
  return res.json() as Promise<T>;
}

// Auth API

// "Sign in / Sign up with GitHub". The flow is a full-page navigation to the
// API (which sets a nonce cookie and redirects to github.com), not an XHR.
export const githubAuthApi = {
  config(): Promise<{ enabled: boolean }> {
    return request<{ enabled: boolean }>("/v1/auth/github/config");
  },

  startUrl(
    mode: "login" | "signup",
    opts: { organizationSlug?: string; redirect?: string } = {},
  ): string {
    const params = new URLSearchParams({ mode });
    if (opts.organizationSlug) params.set("org", opts.organizationSlug);
    if (opts.redirect) params.set("redirect", opts.redirect);
    return `${BASE}/v1/auth/github/start?${params.toString()}`;
  },
};

interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  organizationSlug: string;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

export const authApi = {
  register(payload: RegisterPayload): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  login(payload: LoginPayload): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  me(): Promise<{ user: User; impersonatedBy?: string }> {
    return request<{ user: User; impersonatedBy?: string }>("/v1/auth/me");
  },

  // Save the signed-in user's theme to their account.
  updatePreferences(prefs: { theme: "light" | "dark" }): Promise<{ theme: "light" | "dark" }> {
    return request("/v1/auth/me/preferences", {
      method: "PATCH",
      body: JSON.stringify(prefs),
    });
  },

  forgotPassword(
    email: string,
  ): Promise<{ message: string; devResetUrl?: string; devResetToken?: string }> {
    return request("/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(token: string, password: string): Promise<{ message: string }> {
    return request("/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  },

  // Permanently delete the signed-in user's own account (re-confirm password).
  deleteAccount(password: string): Promise<{ message: string }> {
    return request("/v1/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
  },
};

// Apps API

interface CreateAppPayload {
  name: string;
  source: "git" | "upload";
  type?: "static" | "node" | "fullstack" | "nodered";
  repoUrl?: string;
  branch?: string;
  githubRepoFullName?: string;
  outputDir?: string;
}

export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
}

interface GithubStatus {
  connected: boolean;
  login?: string;
}

interface UpdateAppPayload {
  type?: "static" | "node" | "fullstack";
  name?: string;
  repoUrl?: string;
  branch?: string;
  buildCmd?: string;
  outputDir?: string;
  healthCheckPath?: string | null;
  healthCheckTimeout?: number;
  healthCheckRetries?: number;
  githubCommitStatus?: boolean;
  githubPrComments?: boolean;
}

interface DeployPayload {
  ref?: string;
  // Drop this app's build cache and rebuild clean.
  clearCache?: boolean;
}

interface AppResponse {
  app: App;
  // Set only when creating a Node-RED app: the seeded admin account's password,
  // returned exactly once (stored hashed thereafter).
  noderedAdminPassword?: string;
  // Set by update: the change (e.g. app type) only applies after a redeploy.
  redeployRequired?: boolean;
}

// A Node-RED editor account (type = nodered). Never includes the password hash.
export interface NodeRedUser {
  id: string;
  username: string;
  // "*" = full access, "read" = read-only.
  permission: "*" | "read";
  createdAt: string;
}

interface AppsResponse {
  apps: App[];
}

interface AppDetailResponse {
  app: App;
  deployments: Deployment[];
}

interface DeploymentResponse {
  deployment: Deployment;
}

export type AdminLoginResponse = { mode: "redirect"; redirectUrl: string };

interface TokenCreateResponse {
  token: string;
}

interface TokensResponse {
  tokens: Array<{ id: string; name: string; lastUsedAt?: string }>;
}

export const appsApi = {
  list(): Promise<AppsResponse> {
    return request<AppsResponse>("/v1/apps");
  },

  create(payload: CreateAppPayload): Promise<AppResponse> {
    return request<AppResponse>("/v1/apps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Upload a source folder for an upload-type app. Sends each file plus a
  // parallel "paths" array of relative paths so the server rebuilds the tree.
  // Bypasses the JSON `request` helper because this is multipart/form-data.
  async uploadSource(id: string, files: File[]): Promise<{ ok: boolean; files: number }> {
    const form = new FormData();
    const paths = files.map((f) => (f.webkitRelativePath || f.name));
    for (const file of files) form.append("files", file);
    form.append("paths", JSON.stringify(paths));

    const token = getToken();
    const res = await fetch(`${BASE}/v1/apps/${id}/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: { message: res.statusText } }));
      throw new Error(
        (err as { error?: { message?: string } })?.error?.message ?? res.statusText,
      );
    }
    return res.json() as Promise<{ ok: boolean; files: number }>;
  },

  get(id: string): Promise<AppDetailResponse> {
    return request<AppDetailResponse>(`/v1/apps/${id}`);
  },

  // Where to send the user to sign into the deployed app as its administrator.
  adminLogin(id: string): Promise<AdminLoginResponse> {
    return request<AdminLoginResponse>(`/v1/apps/${id}/admin-login`);
  },

  update(id: string, payload: UpdateAppPayload): Promise<AppResponse> {
    return request<AppResponse>(`/v1/apps/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  remove(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/apps/${id}`, {
      method: "DELETE",
    });
  },

  deploy(id: string, payload?: DeployPayload): Promise<DeploymentResponse> {
    return request<DeploymentResponse>(`/v1/apps/${id}/deploy`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  },

  buildCache(id: string): Promise<{ buildkit: boolean; sizeBytes: number; entries: number }> {
    return request(`/v1/apps/${id}/build-cache`);
  },

  // Migrate = forced clean rebuild + rollback-safe redeploy. If the new build
  // fails, the backend restores the previous container so the site stays up.
  migrate(id: string, payload?: DeployPayload): Promise<DeploymentResponse> {
    return request<DeploymentResponse>(`/v1/apps/${id}/migrate`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  },

  stop(id: string): Promise<AppResponse> {
    return request<AppResponse>(`/v1/apps/${id}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  // Cancel an in-progress build (stuck or unwanted). Stops the retrying deploy
  // job, tears down the build containers, and resets the app to "stopped".
  cancel(id: string): Promise<AppResponse> {
    return request<AppResponse>(`/v1/apps/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  // Restart the running container in place (no rebuild). For Node-RED this
  // reloads settings.js + flows from the persistent volume.
  restart(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/apps/${id}/restart`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  // Snapshot of the running container's recent stdout/stderr (the live app's
  // own runtime logs). Poll this to refresh.
  runtimeLogs(id: string): Promise<{ running: boolean; lines: string[] }> {
    return request<{ running: boolean; lines: string[] }>(
      `/v1/apps/${id}/runtime-logs`,
    );
  },

  async getLogs(id: string): Promise<EventSource> {
    return new EventSource(await streamUrl(`/v1/apps/${encodeURIComponent(id)}/logs`));
  },

  // Full stored log for one specific (e.g. failed) deployment — for the
  // error-analysis page. Distinct from getLogs(), which streams the latest.
  getDeploymentLog(
    id: string,
    deploymentId: string,
  ): Promise<{ status: string; ref: string | null; createdAt: string; lines: string[] }> {
    return request(`/v1/apps/${id}/deployments/${deploymentId}/log`);
  },

  // Runtime state of the app container (running / crashed / restart count).
  containerStatus(id: string): Promise<ContainerStatus> {
    return request<ContainerStatus>(`/v1/apps/${id}/container-status`);
  },

  // Rollback: redeploy an earlier successful deployment's version. Reuses its
  // kept image (instant) or rebuilds its exact commit.
  rollback(
    id: string,
    deploymentId: string,
  ): Promise<{ deployment: Deployment; reuseImage: boolean }> {
    return request(`/v1/apps/${id}/deployments/${deploymentId}/rollback`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  // Env vars with an environment scope (all / production / preview). Secret
  // values are write-only (value = null in the list).
  listEnvVars(id: string, scope?: EnvScope): Promise<{ envVars: EnvVarItem[] }> {
    return request(`/v1/apps/${id}/env${scope ? `?scope=${scope}` : ""}`);
  },

  createEnvVar(
    id: string,
    body: { key: string; value: string; isSecret?: boolean; scope?: EnvScope },
  ): Promise<{ envVar: EnvVarItem }> {
    return request(`/v1/apps/${id}/env`, { method: "POST", body: JSON.stringify(body) });
  },

  updateEnvVar(
    id: string,
    envId: string,
    body: { value?: string; isSecret?: boolean; scope?: EnvScope },
  ): Promise<{ envVar: EnvVarItem }> {
    return request(`/v1/apps/${id}/env/${envId}`, { method: "PATCH", body: JSON.stringify(body) });
  },

  deleteEnvVar(id: string, envId: string): Promise<{ ok: boolean }> {
    return request(`/v1/apps/${id}/env/${envId}`, { method: "DELETE" });
  },

  // Preview deploys per branch: list / deploy (create or redeploy) / delete.
  listPreviews(id: string): Promise<PreviewList> {
    return request<PreviewList>(`/v1/apps/${id}/previews`);
  },

  deployPreview(
    id: string,
    branch: string,
  ): Promise<{ preview: PreviewItem; deploymentId: string; created: boolean }> {
    return request(`/v1/apps/${id}/previews`, {
      method: "POST",
      body: JSON.stringify({ branch }),
    });
  },

  // Framework detection before a deploy: a repo URL (New App form) or an app.
  detectFramework(repoUrl: string, branch?: string): Promise<{ detection: FrameworkDetection }> {
    return request(`/v1/frameworks/detect`, {
      method: "POST",
      body: JSON.stringify({ repoUrl, ...(branch ? { branch } : {}) }),
    });
  },

  detectAppFramework(id: string): Promise<{
    detection: FrameworkDetection;
    current: { type: string; buildCmd: string | null; outputDir: string | null };
    warnings: string[];
  }> {
    return request(`/v1/apps/${id}/framework`);
  },

  // Promote a live preview to production (reuses its image with production
  // env; `rebuild` builds its commit instead).
  promoteCheck(id: string, previewId: string): Promise<PromoteCheck> {
    return request(`/v1/apps/${id}/previews/${previewId}/promote`);
  },

  promotePreview(
    id: string,
    previewId: string,
    rebuild = false,
  ): Promise<{ deployment: Deployment; reuseImage: boolean }> {
    return request(`/v1/apps/${id}/previews/${previewId}/promote`, {
      method: "POST",
      body: JSON.stringify({ rebuild }),
    });
  },

  // Password-protected previews (basic auth on every preview URL).
  getPreviewProtection(id: string): Promise<PreviewProtection> {
    return request(`/v1/apps/${id}/preview-protection`);
  },

  setPreviewProtection(
    id: string,
    body: { username?: string; password?: string },
  ): Promise<PreviewProtection> {
    return request(`/v1/apps/${id}/preview-protection`, { method: "PUT", body: JSON.stringify(body) });
  },

  disablePreviewProtection(id: string): Promise<PreviewProtection> {
    return request(`/v1/apps/${id}/preview-protection`, { method: "DELETE" });
  },

  deletePreview(id: string, previewId: string): Promise<{ ok: boolean }> {
    return request(`/v1/apps/${id}/previews/${previewId}`, { method: "DELETE" });
  },

  // Deploy history, newest first. Pass the previous page's nextCursor as
  // `before` to load older deployments.
  listDeployments(
    id: string,
    opts: { take?: number; before?: string } = {},
  ): Promise<{ deployments: DeploymentHistoryItem[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (opts.take) params.set("take", String(opts.take));
    if (opts.before) params.set("before", opts.before);
    const qs = params.toString();
    return request(`/v1/apps/${id}/deployments${qs ? `?${qs}` : ""}`);
  },

  createToken(id: string, name: string): Promise<TokenCreateResponse> {
    return request<TokenCreateResponse>(`/v1/apps/${id}/tokens`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  listTokens(id: string): Promise<TokensResponse> {
    return request<TokensResponse>(`/v1/apps/${id}/tokens`);
  },

  listDomains(id: string): Promise<{ domains: CustomDomain[] }> {
    return request<{ domains: CustomDomain[] }>(`/v1/apps/${id}/domains`);
  },

  addDomain(
    id: string,
    domain: string,
  ): Promise<{ domain: CustomDomain; verified?: boolean; message?: string }> {
    return request<{ domain: CustomDomain; verified?: boolean; message?: string }>(`/v1/apps/${id}/domains`, {
      method: "POST",
      body: JSON.stringify({ domain }),
    });
  },

  verifyDomain(
    id: string,
    domainId: string,
  ): Promise<{ domain: CustomDomain; verified: boolean; message: string }> {
    return request(`/v1/apps/${id}/domains/${domainId}/verify`, { method: "POST" });
  },

  removeDomain(
    id: string,
    domainId: string,
  ): Promise<{ ok: boolean; recordRemoved?: boolean; message?: string }> {
    return request(`/v1/apps/${id}/domains/${domainId}`, { method: "DELETE" });
  },

  // Live DNS status: public resolver vs platform DNS vs NS delegation (cached briefly server-side).
  domainStatus(id: string, domainId: string, refresh = false): Promise<DomainStatus> {
    return request(`/v1/apps/${id}/domains/${domainId}/status${refresh ? "?refresh=1" : ""}`);
  },

  // Hosted zones only: point the domain at the platform or at custom A/AAAA IPs.
  setDomainTarget(
    id: string,
    domainId: string,
    payload: DomainTargetPayload,
  ): Promise<DomainTargetResult> {
    return request(`/v1/apps/${id}/domains/${domainId}/target`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  // ---- Node-RED editor accounts (type = nodered) ----

  listNodeRedUsers(id: string): Promise<{ users: NodeRedUser[] }> {
    return request(`/v1/apps/${id}/nodered-users`);
  },

  addNodeRedUser(
    id: string,
    payload: { username: string; password: string; permission?: "*" | "read" },
  ): Promise<{ user: NodeRedUser; applied: { restarted: boolean } }> {
    return request(`/v1/apps/${id}/nodered-users`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateNodeRedUser(
    id: string,
    nodeRedUserId: string,
    payload: { password?: string; permission?: "*" | "read" },
  ): Promise<{ user: NodeRedUser; applied: { restarted: boolean } }> {
    return request(`/v1/apps/${id}/nodered-users/${nodeRedUserId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  removeNodeRedUser(
    id: string,
    nodeRedUserId: string,
  ): Promise<{ ok: boolean; applied: { restarted: boolean } }> {
    return request(`/v1/apps/${id}/nodered-users/${nodeRedUserId}`, {
      method: "DELETE",
    });
  },
};

// Managed DNS API

export const DNS_RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SRV",
  "CAA",
] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsZone {
  id: string;
  organizationId: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  nameservers: string[];
}

export interface DnsRecord {
  name: string; // "@" for apex
  type: DnsRecordType;
  ttl: number;
  records: string[];
  // True for platform-managed RRsets (apex NS) — shown read-only.
  managed?: boolean;
}

export interface DnsQuota {
  used: number;
  max: number;
  enabled: boolean;
  remaining: number;
}

export const dnsApi = {
  quota(): Promise<DnsQuota> {
    return request<DnsQuota>("/v1/dns/quota");
  },

  listZones(): Promise<DnsZone[]> {
    return request<DnsZone[]>("/v1/dns/zones");
  },

  createZone(name: string): Promise<DnsZone> {
    return request<DnsZone>("/v1/dns/zones", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  deleteZone(name: string): Promise<{ deleted: boolean }> {
    return request(`/v1/dns/zones/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  listRecords(zone: string): Promise<DnsRecord[]> {
    return request<DnsRecord[]>(
      `/v1/dns/zones/${encodeURIComponent(zone)}/records`,
    );
  },

  upsertRecord(
    zone: string,
    payload: { name: string; type: DnsRecordType; ttl?: number; records: string[] },
  ): Promise<DnsRecord> {
    return request(`/v1/dns/zones/${encodeURIComponent(zone)}/records`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deleteRecord(
    zone: string,
    payload: { name: string; type: DnsRecordType },
  ): Promise<{ deleted: boolean }> {
    return request(`/v1/dns/zones/${encodeURIComponent(zone)}/records`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
  },
};

export interface CustomDomain {
  id: string;
  domain: string;
  status: "pending" | "verified" | "failed";
  verifiedAt: string | null;
  createdAt: string;
  // "platform-dns": the domain's zone is hosted here by your org (no TXT needed).
  ownershipMethod: "platform-dns" | "txt";
  hostedZone: string | null;
  // Verified via the hosted zone; autoRecord is the routing record we created.
  autoConfigured: boolean;
  // value is comma-separated when the platform manages several IPs; see values.
  autoRecord: { host: string; type: string; value: string; values: string[] } | null;
  lastCheck: CustomDomainCheck | null;
  // The server's public IP (admin Settings -> Networking, else PUBLIC_IP).
  serverIp: string | null;
  instructions: {
    txtRecord: { host: string; type: string; value: string };
    routeRecord: {
      host: string;
      type: string;
      // null when the server's public IP isn't configured (see note).
      value: string | null;
      apex: boolean;
      note: string | null;
    };
  };
}

export interface DomainRRSet {
  type: string;
  ttl: number;
  records: string[];
}

export interface DomainStatus {
  domainId: string;
  domain: string;
  checkedAt: string;
  cached: boolean;
  state: "live" | "not_delegated" | "points_elsewhere" | "not_resolving" | "no_record" | "error";
  message: string;
  pointsAtPlatform: boolean;
  targetMode: "platform" | "custom" | "other" | "none";
  serverIp: string | null;
  expected: { type: string; value: string | null; apex: boolean; note: string | null };
  public: { a: string[]; aaaa: string[]; cname: string[]; error: string | null };
  platform: { zone: string; rrsets: (DomainRRSet & { managed: boolean })[]; error: string | null } | null;
  delegation: { ok: boolean; zone: string; expected: string[]; found: string[] } | null;
}

export type DomainTargetPayload =
  | { mode: "platform"; ttl?: number; confirmReplace?: boolean }
  | { mode: "custom"; type: "A" | "AAAA"; values: string[]; ttl?: number; confirmReplace?: boolean };

export type DomainTargetResult =
  | { ok: true; message: string; domain: CustomDomain }
  | { ok: false; confirmRequired: true; existing: DomainRRSet[]; message: string };

export interface CustomDomainCheck {
  checkedAt: string;
  ownership: {
    method: "platform-dns" | "txt";
    ok: boolean;
    zone?: string;
    host?: string;
    expected?: string;
    found?: string[];
    error?: string | null;
    message: string;
  };
  routing: {
    ok: boolean;
    host: string;
    expectedType: string;
    expectedValue: string | null;
    foundA: string[];
    foundCname: string[];
    error: string | null;
    message: string;
  };
  autoRecord?: {
    status: "created" | "exists" | "conflict" | "skipped" | "error";
    type?: string;
    value?: string;
    message: string;
  };
  delegation?: { ok: boolean; zone: string; expected: string[]; found: string[]; message: string };
  warnings: string[];
}

// GitHub API

export const githubApi = {
  status(): Promise<GithubStatus> {
    return request<GithubStatus>("/v1/github/status");
  },

  // Returns the GitHub consent URL to send the browser to.
  authorize(): Promise<{ url: string }> {
    return request<{ url: string }>("/v1/github/authorize");
  },

  listRepos(): Promise<{ repos: GithubRepo[] }> {
    return request<{ repos: GithubRepo[] }>("/v1/github/repos");
  },

  // Branches for a repo, default branch first. `fullName` is "owner/repo".
  listBranches(fullName: string): Promise<{ branches: string[]; defaultBranch: string }> {
    return request<{ branches: string[]; defaultBranch: string }>(
      `/v1/github/repos/${fullName}/branches`,
    );
  },

  // Branches for an arbitrary repo URL (Repository URL mode), via ls-remote.
  listRemoteBranches(repoUrl: string): Promise<{ branches: string[] }> {
    return request<{ branches: string[] }>(
      `/v1/github/remote-branches?repoUrl=${encodeURIComponent(repoUrl)}`,
    );
  },

  disconnect(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/v1/github/disconnect", {
      method: "DELETE",
    });
  },
};

// Notifications API

export const notificationsApi = {
  // Recent notifications (read + unread) plus the live unread count for the
  // bell badge. The badge tracks unreadCount, not the list length, so opening
  // the panel doesn't reset the counter.
  listRecent(): Promise<{ notifications: Notification[]; unreadCount: number }> {
    return request<{ notifications: Notification[]; unreadCount: number }>(
      "/v1/notifications",
    );
  },

  // The user's full deployment-failure history for the Errors page (not limited
  // to today, unlike the bell feed).
  listDeploymentFailures(): Promise<{ notifications: Notification[] }> {
    return request<{ notifications: Notification[] }>("/v1/notifications/errors");
  },

  getOne(id: string): Promise<{ notification: Notification }> {
    return request<{ notification: Notification }>(`/v1/notifications/${id}`);
  },

  markRead(id: string): Promise<{ cleared: number }> {
    return request<{ cleared: number }>(`/v1/notifications/${id}/read`, {
      method: "POST",
    });
  },

  markAllRead(): Promise<{ cleared: number }> {
    return request<{ cleared: number }>("/v1/notifications/read-all", {
      method: "POST",
    });
  },
};

// Support chat with the platform team. Scoped server-side to the caller's
// organization — every member of the org shares its conversations.
export const supportApi = {
  list(status?: SupportStatus): Promise<{ conversations: SupportConversation[]; unreadTotal: number }> {
    return request(`/v1/support/conversations${status ? `?status=${status}` : ""}`);
  },

  unread(): Promise<{ unreadCount: number }> {
    return request("/v1/support/unread");
  },

  create(
    category: SupportCategory,
    title: string | undefined,
    body: string,
  ): Promise<{ conversation: SupportConversation }> {
    return request("/v1/support/conversations", {
      method: "POST",
      body: JSON.stringify(category === "custom" ? { category, title, body } : { category, body }),
    });
  },

  get(id: string): Promise<{ conversation: SupportConversation; messages: SupportMessage[] }> {
    return request(`/v1/support/conversations/${id}`);
  },

  send(id: string, body: string): Promise<{ conversation: SupportConversation; message: SupportMessage }> {
    return request(`/v1/support/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  },

  // Yes / No to the pending "Is this solved?" question (Yes closes it).
  answerResolution(
    id: string,
    solved: boolean,
  ): Promise<{ conversation: SupportConversation; message: SupportMessage }> {
    return request(`/v1/support/conversations/${id}/resolution`, {
      method: "POST",
      body: JSON.stringify({ solved }),
    });
  },

  markRead(id: string): Promise<{ conversation: SupportConversation }> {
    return request(`/v1/support/conversations/${id}/read`, { method: "POST" });
  },

  setStatus(id: string, status: SupportStatus): Promise<{ conversation: SupportConversation }> {
    return request(`/v1/support/conversations/${id}/${status === "closed" ? "close" : "reopen"}`, {
      method: "POST",
    });
  },

  // Live updates (EventSource can't send headers → short-lived stream ticket).
  async stream(): Promise<EventSource> {
    return new EventSource(await streamUrl("/v1/support/stream"));
  },
};
