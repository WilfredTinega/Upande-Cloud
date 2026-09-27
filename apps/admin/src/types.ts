export type AppStatus = "idle" | "building" | "live" | "failed" | "stopped";
export type DeploymentStatus = "queued" | "building" | "live" | "failed";
export type UserRole = "user" | "admin" | "superadmin";
export type UserStatus = "active" | "suspended";
export type OrganizationStatus = "active" | "suspended";
export type AppSource = "git" | "upload";
export type AppType = "static" | "node" | "fullstack" | "nodered";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro";
  status: OrganizationStatus;
  createdAt: string;
  // When the subscription lapses (ISO string). Null/absent = no expiry.
  subscriptionExpiresAt?: string | null;
  // Last observed activity (ISO string). Null/absent = never seen active.
  lastActiveAt?: string | null;
}

// Organization as returned by the admin list, enriched with its quota and
// member/resource counts for the detail pane.
export interface AdminOrganization extends Organization {
  quota?: Quota | null;
  counts?: { users: number; projects: number; apps: number };
}

export interface User {
  id: string;
  organizationId: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  // When true, the user must set a new password before using the panel
  // (default seeded admin, or an admin-reset password).
  mustChangePassword?: boolean;
  // Saved light/dark preference; null = not chosen (falls back to the OS).
  theme?: "light" | "dark" | null;
  createdAt: string;
}

export interface Quota {
  id: string;
  organizationId: string;
  maxApps: number;
  // cpu/memory/disk are resource strings (e.g. "1", "512m", "2g") per the API contract
  cpu: string;
  memory: string;
  disk: string;
  buildMinutes: number;
  maxConcurrentDeploys: number;
  // Managed-DNS add-on: zones the org may host (0 = add-on disabled).
  maxDnsZones: number;
}

export interface App {
  id: string;
  projectId: string;
  name: string;
  type: AppType;
  source: AppSource;
  repoUrl?: string;
  branch?: string;
  subdomain: string;
  buildCmd?: string;
  outputDir?: string;
  status: AppStatus;
  createdAt?: string;
}

export interface Deployment {
  id: string;
  appId: string;
  ref?: string;
  status: DeploymentStatus;
  imageRef?: string;
  logsRef?: string;
  createdAt: string;
}

export interface DeployToken {
  id: string;
  appId: string;
  name: string;
  lastUsedAt?: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  createdAt: string;
}

// A deployment-failure notification, shown on the admin Errors page. Includes
// the recipient's email (admin is cross-tenant) and the metadata captured at
// failure time (step, reason, appId, deploymentId).
export interface DeploymentError {
  id: string;
  userId: string;
  organizationId: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  user?: { email: string } | null;
}

// One row of an app's deploy history (GET /v1/admin/apps/:id/deployments).
export interface AdminDeployment {
  id: string;
  ref: string | null;
  status: "queued" | "building" | "live" | "failed";
  trigger: "user" | "webhook" | "rollback" | "api_token" | "admin" | "promote" | null;
  triggerDetail: string | null;
  triggeredBy: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  forceClean: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorReason: string | null;
}

export interface DeploymentLog {
  deploymentId: string;
  appName: string;
  status: string;
  ref: string | null;
  createdAt: string;
  lines: string[];
}

export interface Metrics {
  users: number;
  organizations: number;
  apps: number;
  deployments: number;
  queueDepth: number;
}

// App as returned by the admin /apps list, which includes the owning project
// so the UI can group/filter sites by customer (organization).
export interface AdminApp extends App {
  project?: {
    organizationId: string;
    name: string;
    userId: string;
    user?: { email: string; username: string };
  };
}

// One bucket in the deployment time series. `date` is an ISO date (YYYY-MM-DD)
// for day buckets, or a full ISO timestamp for minute buckets — see Performance.bucket.
export interface PerformancePoint {
  date: string;
  total: number;
  live: number;
  failed: number;
}

// Aggregated deployment performance for the admin charts.
export interface Performance {
  windowDays: number;
  windowMinutes: number;
  bucket: "minute" | "day";
  stepMinutes: number;
  since: string;
  scope: { organizationId: string | null; appId: string | null; sites: number };
  totals: {
    deployments: number;
    live: number;
    failed: number;
    queued: number;
    building: number;
    successRate: number | null;
  };
  series: PerformancePoint[];
  deploymentStatus: Record<DeploymentStatus, number>;
  appStatus: Partial<Record<AppStatus, number>>;
  topSites: { appId: string; name: string; deployments: number }[];
}

export interface PerformanceFilters {
  organizationId?: string;
  appId?: string;
  days?: number;
  minutes?: number;
}

// Host-level capacity + platform user counts.
export interface SystemInfo {
  hostname: string;
  cores: number;
  loadAvg: number[];
  memory: { total: number; free: number; used: number };
  disk: { total: number; free: number; used: number } | null;
  users: { active: number; total: number };
  uptimeSeconds: number;
}

// Live resource usage / uptime / responsiveness per site.
export interface ResourceSite {
  appId: string;
  name: string;
  subdomain: string;
  organizationId: string | null;
  customer: string | null;
  status: AppStatus;
  up: boolean;
  cpuPct: number | null;
  memBytes: number | null;
  memLimitBytes: number | null;
  uptimeSeconds: number | null;
  latencyMs: number | null;
  quota: { cpu: string; memory: string; disk: string } | null;
}

export interface ResourceCustomer {
  organizationId: string;
  customer: string;
  sites: number;
  sitesUp: number;
  cpuPct: number;
  memBytes: number;
  avgLatencyMs: number | null;
}

export interface ResourceUsage {
  generatedAt: string;
  scope: { organizationId: string | null; appId: string | null; sites: number };
  totals: { sites: number; sitesUp: number; cpuPct: number; memBytes: number };
  sites: ResourceSite[];
  byCustomer: ResourceCustomer[];
  fastest: ResourceSite[];
  slowest: ResourceSite[];
}

// Result of a platform-wide security-patch + migrate wave (forced clean rebuild
// of every deployable site, optionally scoped to one app type).
export interface BulkMigrateResult {
  total: number;
  queued: number;
  skipped: number;
  failed: number;
  deployments: Array<{ appId: string; name: string; deploymentId: string }>;
  skippedSites: Array<{ appId: string; name: string; status: AppStatus; reason: string }>;
  failures: Array<{ appId: string; name: string; error: string }>;
}

// ---- Support chat inbox (/v1/admin/support) ----
export type SupportStatus = "open" | "closed";
export type SupportCategory = "issue" | "inquiry" | "faqs" | "custom";
export type SupportMessageKind = "text" | "resolution_request" | "resolution_answer";
// pending = "Is this solved?" awaiting an answer; solved / unsolved = last answer.
export type SupportResolution = "pending" | "solved" | "unsolved";

export interface AdminSupportConversation {
  id: string;
  // Immutable "ISSUE-0001"-style reference.
  reference: string;
  category: SupportCategory;
  // "Issue" / "Inquiry" / "FAQs", or the user's own title for Custom.
  title: string;
  subject: string;
  status: SupportStatus;
  createdAt: string;
  lastMessageAt: string;
  closedAt: string | null;
  resolution: SupportResolution | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; username: string } | null;
  // Messages from the org the admins haven't read yet.
  unreadCount: number;
  // Admin replies the org hasn't read yet.
  userUnreadCount: number;
  organization: { id: string; name: string; slug: string };
  createdBy: { id: string; username: string; email: string; role: UserRole; status: UserStatus } | null;
  lastMessage: {
    preview: string;
    kind?: SupportMessageKind;
    authorRole: "user" | "admin";
    authorName: string;
    createdAt: string;
  } | null;
}

export interface AdminSupportMessage {
  id: string;
  conversationId: string;
  body: string;
  kind: SupportMessageKind;
  // resolution_answer only: true = solved.
  answer: boolean | null;
  createdAt: string;
  authorRole: "user" | "admin";
  // Real username (admins see who replied; users only ever see "Upande Support").
  authorName: string;
  authorEmail: string | null;
  authorUserId: string | null;
  mine: boolean;
  byMe: boolean;
}

export interface AdminSupportStreamEvent {
  kind: "message" | "conversation" | "ping";
  conversationId?: string;
  conversation?: AdminSupportConversation;
  message?: AdminSupportMessage;
}

// The admin's OWN notifications (GET /v1/notifications) — support messages.
export interface OwnNotification {
  id: string;
  type: "account_impersonated" | "deployment_failed" | "support_message";
  message: string;
  metadata?: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
}
