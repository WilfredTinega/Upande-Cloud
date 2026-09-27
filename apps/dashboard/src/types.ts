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
}

export interface User {
  id: string;
  organizationId: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  // Saved light/dark preference; null = not chosen (falls back to the OS).
  theme?: "light" | "dark" | null;
  createdAt: string;
}

export interface Quota {
  id: string;
  organizationId: string;
  maxApps: number;
  cpu: number;
  memory: number;
  disk: number;
  buildMinutes: number;
  maxConcurrentDeploys: number;
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
  // Public URL the deployed app is reachable at (built by the API from the
  // subdomain + BASE_DOMAIN + APP_HTTP_PORT).
  url?: string;
  createdAt?: string;
  // Email (or username) of the app's creator. Only populated by the detail
  // endpoint (getApp), not the list.
  createdBy?: string | null;
  // For Node-RED apps: the host port this instance is published on (container
  // :1880 mapped to this port on the Docker host).
  noderedPort?: number | null;
  // Deploy health check (see HealthCheckSection). null path = web-server check.
  healthCheckPath?: string | null;
  healthCheckTimeout?: number;
  healthCheckRetries?: number;
  // GitHub connection + PR integration toggles (see GithubIntegrationSection).
  githubRepoFullName?: string | null;
  githubCommitStatus?: boolean;
  githubPrComments?: boolean;
}

// GET /v1/apps/:id/container-status
export type ContainerStatus =
  | { exists: false }
  | {
      exists: true;
      state: string;
      running: boolean;
      restarting: boolean;
      crashed: boolean;
      restartCount: number;
      exitCode: number;
      oomKilled: boolean;
      error: string | null;
      startedAt: string;
      finishedAt: string | null;
      restartPolicy: string | null;
      // on-failure:<max> — Docker gives up after this many restarts.
      maxRetries: number | null;
      // The retries are used up: the app crashed and is no longer restarted.
      restartsExhausted: boolean;
      placeholder: boolean;
    };

export interface Deployment {
  id: string;
  appId: string;
  ref?: string;
  status: DeploymentStatus;
  imageRef?: string;
  logsRef?: string;
  createdAt: string;
}

export type DeploymentTrigger = "user" | "webhook" | "rollback" | "api_token" | "admin" | "promote";

// A row of the deploy history (GET /v1/apps/:id/deployments).
export interface DeploymentHistoryItem {
  id: string;
  appId: string;
  ref: string | null;
  branch: string | null;
  status: DeploymentStatus;
  imageRef: string | null;
  createdAt: string;
  // null for deployments created before triggers were recorded.
  trigger: DeploymentTrigger | null;
  triggerDetail: string | null;
  deployTokenId: string | null;
  triggeredBy: { id: string; username: string; email: string } | null;
  commitSha: string | null;
  commitMessage: string | null;
  forceClean: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorReason: string | null;
  logPersisted: boolean;
  logTruncated: boolean;
  // Rollback: the deployment this one redeployed.
  rollbackOf: { id: string; commitSha: string | null } | null;
  // The newest successful deployment (the version currently serving).
  isCurrent: boolean;
  // The built image is still kept locally (instant rollback, no rebuild).
  imageAvailable: boolean;
  // "Redeploy this version" is possible (successful + image kept or commit known).
  canRollback: boolean;
}

export interface DeployToken {
  id: string;
  appId: string;
  name: string;
  lastUsedAt?: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface Metrics {
  users: number;
  organizations: number;
  apps: number;
  deployments: number;
  queueDepth: number;
}

export type NotificationType = "account_impersonated" | "deployment_failed" | "support_message";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  metadata?: Record<string, unknown>;
  // null/absent = unread; an ISO timestamp once the user has cleared it.
  readAt?: string | null;
  createdAt: string;
}

// ---- Preview deploys per branch (GET /v1/apps/:id/previews) ----
export type EnvScope = "all" | "production" | "preview";

export interface EnvVarItem {
  id: string;
  key: string;
  // null for secrets (write-only).
  value: string | null;
  isSecret: boolean;
  scope: EnvScope;
}

export interface PreviewItem {
  id: string;
  branch: string;
  subdomain: string;
  url: string;
  status: DeploymentStatus;
  commitSha: string | null;
  lastDeployedAt: string | null;
  createdAt: string;
  // A throwaway database was provisioned for this preview.
  hasDatabase: boolean;
  lastDeployment: {
    id: string;
    status: DeploymentStatus;
    errorReason: string | null;
    createdAt: string;
    commitMessage: string | null;
  } | null;
}

export interface PreviewProtection {
  enabled: boolean;
  username: string | null;
  // Set/remove responses: previews relabeled / that failed to relabel.
  updated?: number;
  failed?: string[];
}

export interface FrameworkDetection {
  framework: { id: string; name: string };
  type: "static" | "node" | "fullstack";
  buildCmd: string | null;
  outputDir: string | null;
  startCmd: string | null;
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | null;
  nodeVersion: string | null;
  buildTimeEnvPrefix: string | null;
  hasDockerfile: boolean;
  usesDatabase: boolean;
  notes: string[];
}

export interface PromoteCheck {
  canPromote: boolean;
  reason: string | null;
  branch: string;
  commitSha: string | null;
  imageAvailable: boolean;
  // false → build-time vars (VITE_, NEXT_PUBLIC_, ...) differ from production.
  compatible: boolean;
  buildTimeKeys: string[];
  canRebuild: boolean;
}

export interface PreviewList {
  supported: boolean;
  unsupportedReason: string | null;
  productionBranch: string;
  usesThrowawayDb: boolean;
  autoDeployOnPush: boolean;
  limits: { perApp: number; perOrg: number; orgUsed: number };
  previews: PreviewItem[];
}

// ---- Support chat (/v1/support) ----
export type SupportStatus = "open" | "closed";
export type SupportCategory = "issue" | "inquiry" | "faqs" | "custom";
export type SupportMessageKind = "text" | "resolution_request" | "resolution_answer";
// pending = "Is this solved?" awaiting an answer; solved / unsolved = last answer.
export type SupportResolution = "pending" | "solved" | "unsolved";

export interface SupportConversation {
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
  // Messages from Upande Support the org hasn't read yet.
  unreadCount: number;
  createdBy: { id: string; username: string } | null;
  lastMessage: {
    preview: string;
    kind?: SupportMessageKind;
    authorRole: "user" | "admin";
    authorName: string;
    createdAt: string;
  } | null;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  body: string;
  kind: SupportMessageKind;
  // resolution_answer only: true = solved.
  answer: boolean | null;
  createdAt: string;
  authorRole: "user" | "admin";
  // "Upande Support" for admin replies (individual admins are never exposed).
  authorName: string;
  authorUserId: string | null;
  mine: boolean;
}

export interface SupportStreamEvent {
  kind: "message" | "conversation" | "ping";
  conversationId?: string;
  conversation?: SupportConversation;
  message?: SupportMessage;
}
