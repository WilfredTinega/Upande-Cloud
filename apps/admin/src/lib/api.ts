import type {
  AdminApp,
  AdminOrganization,
  App,
  AppType,
  AuditLog,
  BulkMigrateResult,
  DeploymentError,
  DeploymentLog,
  AdminDeployment,
  Metrics,
  Organization,
  Performance,
  PerformanceFilters,
  Quota,
  ResourceUsage,
  SystemInfo,
  User,
  UserRole,
  AdminSupportConversation,
  AdminSupportMessage,
  OwnNotification,
  SupportCategory,
  SupportStatus,
} from "../types";

// API base resolution order:
//   1. window.__UPANDE_CONFIG__.apiUrl — injected at container runtime by
//      nginx's entrypoint from the UPANDE_API_URL env var, so ONE prebuilt
//      image serves any domain (set by the operator / upandectl).
//   2. VITE_API_URL — baked at build time (local dev / source builds).
//   3. localhost fallback for `npm run dev`.
declare global {
  interface Window {
    __UPANDE_CONFIG__?: { apiUrl?: string; dashboardUrl?: string };
  }
}

const BASE =
  (typeof window !== "undefined" && window.__UPANDE_CONFIG__?.apiUrl) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "http://localhost:4000";

// Public URL of the user-facing dashboard app. Same resolution order as the
// API base: runtime config (window.__UPANDE_CONFIG__.dashboardUrl) → build-time
// VITE_DASHBOARD_URL → localhost dev default.
export function getDashboardUrl(): string {
  return (
    (typeof window !== "undefined" && window.__UPANDE_CONFIG__?.dashboardUrl) ||
    (import.meta.env.VITE_DASHBOARD_URL as string | undefined) ||
    "http://localhost:5173"
  );
}

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
      ...options.headers,
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

export const authApi = {
  login(email: string, password: string): Promise<{ token: string; user: User }> {
    return request("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  me(): Promise<{ user: User }> {
    return request("/v1/auth/me");
  },

  // Save the signed-in user's theme to their account.
  updatePreferences(prefs: { theme: "light" | "dark" }): Promise<{ theme: "light" | "dark" }> {
    return request("/v1/auth/me/preferences", {
      method: "PATCH",
      body: JSON.stringify(prefs),
    });
  },

  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ token: string; user: User }> {
    return request("/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
};

export type GithubConfigSource = "database" | "environment" | "none";

export interface GithubSettings {
  configured: boolean;
  clientId: string;
  clientIdSource: GithubConfigSource;
  clientSecretSet: boolean;
  clientSecretSource: GithubConfigSource;
  stateSecretSource: GithubConfigSource;
  homepageUrl: string;
  callbackUrl: string;
}

export interface NetworkSettings {
  publicIpv4: string;
  publicIpv4Source: GithubConfigSource;
  publicIpv6: string;
  publicIpv6Source: GithubConfigSource;
  // What platform A/AAAA records for custom domains point at (IPv4 preferred).
  effectiveIp: string | null;
}

export const adminApi = {
  getUsers(): Promise<{ users: User[] }> {
    return request("/v1/admin/users");
  },

  suspendUser(id: string): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/suspend`, { method: "POST" });
  },

  unsuspendUser(id: string): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/unsuspend`, { method: "POST" });
  },

  updateUser(
    id: string,
    payload: { username?: string; email?: string; organizationId?: string; password?: string },
  ): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  deleteUser(id: string): Promise<{ ok: boolean }> {
    return request(`/v1/admin/users/${id}`, { method: "DELETE" });
  },

  setUserRole(id: string, role: UserRole): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  },

  // Mint a short-lived session to log in to the dashboard AS this user.
  // `password` is the admin's own password, re-entered to confirm. `reason` is
  // shown to the user in their notification and recorded in the audit log.
  impersonateUser(
    id: string,
    password: string,
    reason: string,
  ): Promise<{ token: string; user: User; dashboardUrl: string }> {
    return request(`/v1/admin/users/${id}/impersonate`, {
      method: "POST",
      body: JSON.stringify({ password, reason }),
    });
  },

  getOrganizations(): Promise<{ organizations: AdminOrganization[] }> {
    return request("/v1/admin/organizations");
  },

  createOrganization(payload: {
    name: string;
    slug?: string;
  }): Promise<{ organization: Organization }> {
    return request("/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  setOrganizationQuota(id: string, quota: Partial<Quota>): Promise<{ quota: Quota }> {
    return request(`/v1/admin/organizations/${id}/quota`, {
      method: "POST",
      body: JSON.stringify(quota),
    });
  },

  getApps(): Promise<{ apps: AdminApp[] }> {
    return request("/v1/admin/apps");
  },

  stopApp(id: string): Promise<{ app: App }> {
    return request(`/v1/admin/apps/${id}/stop`, { method: "POST" });
  },

  // Platform-wide security patch + migrate: force a clean rebuild ("migrate") of
  // every deployable site. Optionally scope to a single app type. Superadmin-only.
  bulkMigrate(type?: AppType): Promise<BulkMigrateResult> {
    return request(`/v1/admin/apps/bulk-migrate`, {
      method: "POST",
      body: JSON.stringify(type ? { type } : {}),
    });
  },

  getMetrics(): Promise<Metrics> {
    return request("/v1/admin/metrics");
  },

  // Deployment performance for the charts. Defaults to all sites; pass organizationId
  // (customer) and/or appId (site) to scope it, and days for the window.
  getPerformance(filters: PerformanceFilters = {}): Promise<Performance> {
    const qs = new URLSearchParams();
    if (filters.organizationId) qs.set("organizationId", filters.organizationId);
    if (filters.appId) qs.set("appId", filters.appId);
    if (filters.minutes) qs.set("minutes", String(filters.minutes));
    else if (filters.days) qs.set("days", String(filters.days));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/v1/admin/performance${suffix}`);
  },

  // Host capacity: CPU cores, memory, disk, active users.
  getSystem(): Promise<SystemInfo> {
    return request("/v1/admin/system");
  },

  // Live resource usage, uptime and responsiveness per site and per customer.
  getResources(filters: { organizationId?: string; appId?: string } = {}): Promise<ResourceUsage> {
    const qs = new URLSearchParams();
    if (filters.organizationId) qs.set("organizationId", filters.organizationId);
    if (filters.appId) qs.set("appId", filters.appId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/v1/admin/resources${suffix}`);
  },

  getAuditLogs(): Promise<{ logs: AuditLog[] }> {
    return request("/v1/admin/audit");
  },

  aiStatus(): Promise<{ enabled: boolean }> {
    return request("/v1/admin/ai/status");
  },

  getSettings(): Promise<{ agentApiUrl: string; agentTokenSet: boolean; agentId: string }> {
    return request("/v1/admin/settings");
  },

  updateSettings(payload: {
    agentApiUrl?: string;
    agentToken?: string;
    agentId?: string;
  }): Promise<{ agentApiUrl: string; agentTokenSet: boolean; agentId: string }> {
    return request("/v1/admin/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // GitHub OAuth App (superadmin). Secrets are write-only — never returned.
  getGithubSettings(): Promise<GithubSettings> {
    return request("/v1/admin/settings/github");
  },

  updateGithubSettings(payload: {
    clientId?: string;
    clientSecret?: string;
    clearClientSecret?: boolean;
    stateSecret?: string;
    clearStateSecret?: boolean;
  }): Promise<GithubSettings> {
    return request("/v1/admin/settings/github", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  testGithubSettings(): Promise<{ ok: boolean; message: string }> {
    return request("/v1/admin/settings/github/test", { method: "POST" });
  },

  // Networking (superadmin): the server's public IP used for custom-domain records.
  getNetworkSettings(): Promise<NetworkSettings> {
    return request("/v1/admin/settings/network");
  },

  updateNetworkSettings(payload: { publicIpv4?: string; publicIpv6?: string }): Promise<NetworkSettings> {
    return request("/v1/admin/settings/network", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Asks a public "what is my IP" service from the API server. Never saves.
  detectPublicIp(): Promise<{ ipv4: string | null; ipv6: string | null; errors: string[] }> {
    return request("/v1/admin/settings/network/detect", { method: "POST" });
  },

  listAgentTokens(): Promise<{
    tokens: Array<{ id: string; name: string; lastUsedAt: string | null; createdAt: string }>;
  }> {
    return request("/v1/admin/agent-tokens");
  },

  createAgentToken(name: string): Promise<{ id: string; name: string; token: string }> {
    return request("/v1/admin/agent-tokens", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  revokeAgentToken(id: string): Promise<{ ok: boolean }> {
    return request(`/v1/admin/agent-tokens/${id}`, { method: "DELETE" });
  },

  generateMcpConfig(): Promise<Record<string, unknown>> {
    return request("/v1/admin/mcp-config", { method: "POST" });
  },

  analyzeApp(
    id: string,
  ): Promise<{ deploymentId: string; status: string; analysis: string }> {
    return request(`/v1/admin/apps/${id}/analyze`, { method: "POST" });
  },

  // Deployment failures across all orgs (cross-tenant), for the Errors page.
  getDeploymentErrors(): Promise<{ notifications: DeploymentError[] }> {
    return request("/v1/admin/errors");
  },

  // Deploy history of one app (cross-tenant).
  getAppDeployments(appId: string): Promise<{ deployments: AdminDeployment[] }> {
    return request(`/v1/admin/apps/${appId}/deployments`);
  },

  getDeploymentLog(deploymentId: string): Promise<DeploymentLog> {
    return request(`/v1/admin/deployments/${deploymentId}/log`);
  },

  // Run the AI analysis over a deployment's log.
  analyzeDeployment(
    deploymentId: string,
    errorReason?: string,
  ): Promise<{ deploymentId: string; status: string; analysis: string }> {
    return request(`/v1/admin/deployments/${deploymentId}/analyze`, {
      method: "POST",
      body: JSON.stringify({ errorReason }),
    });
  },

  // ---- Platform ops (zone CLI) ----
  listOpsCommands(): Promise<{ commands: OpsCommand[] }> {
    return request("/v1/admin/ops/commands");
  },

  runOpsCommand(key: string): Promise<OpsResult> {
    return request(`/v1/admin/ops/run/${encodeURIComponent(key)}`, {
      method: "POST",
    });
  },

  // ---- DNS (cross-tenant) ----
  listDnsZones(): Promise<AdminDnsZone[]> {
    return request("/v1/admin/dns/zones");
  },

  listDnsRecords(zone: string): Promise<DnsRecord[]> {
    return request(`/v1/admin/dns/zones/${encodeURIComponent(zone)}/records`);
  },

  deleteDnsZone(zone: string): Promise<{ deleted: boolean }> {
    return request(`/v1/admin/dns/zones/${encodeURIComponent(zone)}`, {
      method: "DELETE",
    });
  },
};

// ---- Platform ops (zone CLI) types ----
export interface OpsCommand {
  key: string;
  label: string;
  mutating: boolean;
  description: string;
}

export interface OpsResult {
  command: string;
  output: string;
  exitCode: number;
}

// ---- DNS types (admin / cross-tenant) ----
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

export interface AdminDnsZone {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  organizationId: string;
  organizationName: string;
  nameservers: string[];
}

export interface DnsRecord {
  name: string;
  type: DnsRecordType;
  ttl: number;
  records: string[];
  managed?: boolean;
}

// The signed-in admin's own notifications (support messages from users).
export const ownNotificationsApi = {
  listRecent(): Promise<{ notifications: OwnNotification[]; unreadCount: number }> {
    return request("/v1/notifications");
  },
  markRead(id: string): Promise<{ cleared: number }> {
    return request(`/v1/notifications/${id}/read`, { method: "POST" });
  },
};

// Cross-tenant support inbox.
export const supportAdminApi = {
  list(
    filters: {
      status?: SupportStatus;
      unread?: boolean;
      organizationId?: string;
      category?: SupportCategory;
      // Reference ("ISSUE-0003", "issue-3") or title search.
      q?: string;
    } = {},
  ): Promise<{ conversations: AdminSupportConversation[]; unreadTotal: number }> {
    const q = new URLSearchParams();
    if (filters.category) q.set("category", filters.category);
    if (filters.q) q.set("q", filters.q);
    if (filters.status) q.set("status", filters.status);
    if (filters.unread) q.set("unread", "true");
    if (filters.organizationId) q.set("organizationId", filters.organizationId);
    const qs = q.toString();
    return request(`/v1/admin/support/conversations${qs ? `?${qs}` : ""}`);
  },

  get(id: string): Promise<{ conversation: AdminSupportConversation; messages: AdminSupportMessage[] }> {
    return request(`/v1/admin/support/conversations/${id}`);
  },

  reply(id: string, body: string): Promise<{ conversation: AdminSupportConversation; message: AdminSupportMessage }> {
    return request(`/v1/admin/support/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  },

  askResolution(id: string): Promise<{ conversation: AdminSupportConversation; message: AdminSupportMessage }> {
    return request(`/v1/admin/support/conversations/${id}/ask-resolution`, { method: "POST" });
  },

  markRead(id: string): Promise<{ conversation: AdminSupportConversation }> {
    return request(`/v1/admin/support/conversations/${id}/read`, { method: "POST" });
  },

  setStatus(id: string, status: SupportStatus): Promise<{ conversation: AdminSupportConversation }> {
    return request(`/v1/admin/support/conversations/${id}/${status === "closed" ? "close" : "reopen"}`, {
      method: "POST",
    });
  },

  // Live updates (EventSource can't send headers → short-lived stream ticket).
  async stream(): Promise<EventSource> {
    return new EventSource(await streamUrl("/v1/admin/support/stream"));
  },
};
