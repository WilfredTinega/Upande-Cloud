import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import * as Docker from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { BuildCacheService } from '../deploy/build-cache.service';
import { DbProvisionService } from '../database/db-provision.service';
import { LogStoreService } from '../deploy/log-store.service';
import { AuditService } from '../common/audit.service';
import { PreviewsService } from './previews.service';
import {
  maintenanceContainerCmd,
  MAINTENANCE_IMAGE,
} from './maintenance-page';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { DeployDto } from './dto/deploy.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { AddDomainDto } from './dto/add-domain.dto';
import { DnsService, RoutingRRSet } from '../dns/dns.service';
import { PlatformNetworkService } from '../dns/platform-network.service';
import { isIP } from 'net';
import { Prisma } from '@prisma/client';
import {
  routeTarget,
  resolvePublic,
  sameHost,
  sameValueSet,
  splitManagedValues,
  recordKey,
  RouteTarget,
} from './custom-domain.util';
import { SetDomainTargetDto } from './dto/set-domain-target.dto';
import { AddNodeRedUserDto, UpdateNodeRedUserDto } from './dto/nodered-user.dto';
import { buildAppUrl, buildSubdomainRouterLabels } from '../common/app-url.util';
import { appUploadDir } from '../common/upload-path.util';
import { encrypt, decrypt } from '../common/encrypt.util';
import {
  noderedVolumeName,
  renderNodeRedSettings,
  hashNodeRedPassword,
  NODERED_DATA_DIR,
  NODERED_UID,
  NODERED_GID,
  NODERED_IMAGE,
} from './nodered';
import { Observable, Subject } from 'rxjs';

// What started a deploy that has no user session (deploy history).
export interface DeploySource {
  trigger: 'api_token' | 'webhook';
  deployTokenId?: string;
  detail?: string;
  commitSha?: string;
  commitMessage?: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40);
}

@Injectable()
export class AppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployService: DeployService,
    private readonly logStore: LogStoreService,
    private readonly auditService: AuditService,
    private readonly dnsService: DnsService,
    private readonly network: PlatformNetworkService,
    private readonly previews: PreviewsService,
    private readonly buildCache: BuildCacheService,
    private readonly dbProvision: DbProvisionService,
  ) {}

  async listApps(userId: string, organizationId: string) {
    // Find all projects in the org, then all apps in those projects
    const apps = await this.prisma.app.findMany({
      where: {
        project: {
          organizationId,
        },
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { project: { name: 'asc' } },
    });
    return {
      apps: apps.map((a) => ({
        ...a,
        // Every app type — Node-RED included — is routed by Traefik on its
        // subdomain, so the public URL is the clean subdomain (no host port).
        url: buildAppUrl(a.subdomain),
      })),
    };
  }

  async createApp(userId: string, organizationId: string, dto: CreateAppDto) {
    // Get or create a default project for the org/user
    let project = await this.prisma.project.findFirst({
      where: { organizationId, userId },
    });

    if (dto.projectId) {
      project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
      if (!project || project.organizationId !== organizationId) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
      }
    }

    if (!project) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { organization: true } });
      const orgSlug = user?.organization?.slug ?? 'default';
      let projectSlug = `${orgSlug}-default`;

      const existing = await this.prisma.project.findUnique({ where: { slug: projectSlug } });
      if (existing) projectSlug = `${projectSlug}-${Date.now()}`;

      project = await this.prisma.project.create({
        data: {
          organizationId,
          userId,
          name: 'Default',
          slug: projectSlug,
        },
      });
    }

    // Generate unique subdomain
    const baseSlug = slugify(dto.name);
    let subdomain = baseSlug;
    const existing = await this.prisma.app.findUnique({ where: { subdomain } });
    // A branch preview's host (<app>-<branch>) also reserves its subdomain.
    const previewHit = existing
      ? null
      : await this.prisma.preview.findUnique({ where: { subdomain }, select: { id: true } });
    if (existing || previewHit) subdomain = `${baseSlug}-${uuidv4().substring(0, 6)}`;

    const isNodeRed = dto.type === 'nodered';
    // Node-RED apps: a default "admin" editor account is seeded so the instance
    // is locked from the first deploy. We generate the password once, hash it
    // for storage, and return the plaintext to the caller so it can be shown to
    // the user a single time (it is never recoverable afterward).
    const noderedAdminPassword = isNodeRed
      ? crypto.randomBytes(12).toString('base64url')
      : null;

    // Node-RED is reached publicly through Traefik on its subdomain (like every
    // other app type) and over the Docker network by container name internally,
    // so no host port is published — noderedPort stays null.
    const noderedPort = null;

    const app = await this.prisma.app.create({
      data: {
        projectId: project.id,
        name: dto.name,
        type: dto.type ?? 'static',
        source: dto.source,
        repoUrl: dto.repoUrl ?? null,
        branch: dto.branch ?? 'main',
        subdomain,
        buildCmd: dto.buildCmd ?? null,
        outputDir: dto.outputDir ?? 'dist',
        status: 'idle',
        githubRepoFullName: dto.githubRepoFullName ?? null,
        noderedVolumeName: isNodeRed ? noderedVolumeName(subdomain) : null,
        noderedPort,
        // Store the seeded admin password encrypted so "Login as administrator"
        // can sign the user into the editor without them re-entering it.
        noderedAdminPasswordEnc:
          isNodeRed && noderedAdminPassword
            ? encrypt(noderedAdminPassword)
            : null,
      },
    });

    // Seed the default Node-RED admin editor account.
    if (isNodeRed && noderedAdminPassword) {
      await this.prisma.nodeRedUser.create({
        data: {
          appId: app.id,
          username: 'admin',
          passwordHash: hashNodeRedPassword(noderedAdminPassword),
          permission: '*',
        },
      });
    }

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.create',
      target: app.id,
      metadata: { name: app.name, source: app.source, type: app.type },
    });

    // Stand up a maintenance placeholder so the app's URL shows a friendly
    // "being set up" page instead of a 404 / default nginx welcome until the
    // first real deploy swaps this container out. Best-effort: a failure here
    // must not block app creation.
    await this.startMaintenanceContainer(app.subdomain);

    // Surface the seeded Node-RED admin password to the caller exactly once —
    // it is only stored hashed and cannot be recovered later.
    return { app, noderedAdminPassword: noderedAdminPassword ?? undefined };
  }

  async getApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    // The creator-identity lookup and the deployment history are independent, so
    // run them concurrently rather than serially (one less round-trip of latency).
    const [project, deployments] = await Promise.all([
      // The app's creator is the owner of its project; surface their identity for
      // the dashboard's "created by" line.
      this.prisma.project.findUnique({
        where: { id: app.projectId },
        select: { user: { select: { email: true, username: true } } },
      }),
      this.prisma.deployment.findMany({
        where: { appId, previewId: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      app: {
        ...app,
        // Routed by Traefik on the subdomain for all types (Node-RED included).
        url: buildAppUrl(app.subdomain),
        createdBy: project?.user?.email ?? project?.user?.username ?? null,
      },
      deployments,
    };
  }

  // Builds the data the controller needs to log the dashboard user into the
  // deployed app as its administrator.
  //
  // For Node-RED we hold the seeded admin password (encrypted) and sign the user
  // into the editor. Other app types have no stored credentials, so this
  // degrades to a plain redirect to the app's conventional admin/login path.
  async getAdminLogin(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    // All app types — Node-RED included — are routed by Traefik on the
    // subdomain, so the base URL is the clean subdomain (no host port).
    const base = buildAppUrl(app.subdomain).replace(/\/$/, '');

    // Node-RED: exchange the stored admin credentials for an editor access token
    // (server-side), then hand the browser a URL with ?access_token=… — the
    // editor reads it, stores it in localStorage and lands signed in as
    // administrator. The password never travels to the browser.
    if (app.type === 'nodered' && app.noderedAdminPasswordEnc) {
      const token = await this.noderedAccessToken(
        app.subdomain,
        'admin',
        decrypt(app.noderedAdminPasswordEnc),
      );
      await this.auditService.log({
        action: 'app.admin_login',
        target: app.id,
        metadata: { subdomain: app.subdomain },
      });
      return {
        mode: 'redirect' as const,
        redirectUrl: `${base}/?access_token=${encodeURIComponent(token)}`,
      };
    }

    // No managed credentials — send the user to the app's login surface. For
    // Node-RED the editor is served at the root and presents its own adminAuth
    // login form, so the bare base URL is the right target.
    const path = app.type === 'fullstack' ? '/login' : '/';
    return { mode: 'redirect' as const, redirectUrl: `${base}${path}` };
  }

  // Exchange Node-RED editor credentials for an access token via the instance's
  // /auth/token endpoint. Node-RED is no longer published on a host port — it's
  // routed by Traefik on its subdomain — and the API runs on the Docker HOST,
  // so it cannot resolve the container name (upande_net-internal DNS). We reach
  // the instance the same way the browser does: through Traefik.
  //
  // The HTTP request goes to the Traefik HTTP entrypoint (NODERED_TRAEFIK_ORIGIN,
  // default http://127.0.0.1 — Traefik owns :80 on this host) with the Host
  // header set to the app's public hostname so Traefik routes it to the right
  // instance. Throws a friendly error if unreachable or the credentials are stale.
  private async noderedAccessToken(
    subdomain: string,
    username: string,
    password: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: 'node-red-editor',
      grant_type: 'password',
      scope: '*',
      username,
      password,
    }).toString();

    // Public URL Traefik routes to this instance (e.g. http://nodered.localhost
    // [:port]). Its hostname becomes the Host header; the origin Traefik listens
    // on is NODERED_TRAEFIK_ORIGIN (defaults to the public URL itself, which is
    // correct whenever Traefik's entrypoint host:port match the public URL).
    const publicUrl = new URL(buildAppUrl(subdomain));
    const origin = (
      process.env.NODERED_TRAEFIK_ORIGIN ?? publicUrl.origin
    ).replace(/\/$/, '');

    let res: Response;
    try {
      res = await fetch(`${origin}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Route by the app's public hostname even when hitting Traefik by IP.
          Host: publicUrl.host,
        },
        body,
      });
    } catch {
      throw new BadRequestException({
        code: 'NODERED_UNREACHABLE',
        message:
          'Could not reach the Node-RED instance. Make sure it is deployed and running, then try again.',
      });
    }
    if (!res.ok) {
      throw new BadRequestException({
        code: 'NODERED_AUTH_FAILED',
        message:
          'Could not sign in to Node-RED with the stored admin credentials. Reset the admin password and try again.',
      });
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new BadRequestException({
        code: 'NODERED_AUTH_FAILED',
        message: 'Node-RED did not return an access token.',
      });
    }
    return data.access_token;
  }

  // ---- Node-RED editor accounts (type = nodered) ----

  // Guard: the app exists, belongs to the org, and is a Node-RED app.
  private async findNodeRedApp(organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.type !== 'nodered') {
      throw new BadRequestException({
        code: 'NOT_NODERED_APP',
        message: 'This app is not a Node-RED app',
      });
    }
    return app;
  }

  // List the editor accounts for a Node-RED app (never returns hashes).
  async listNodeRedUsers(organizationId: string, appId: string) {
    await this.findNodeRedApp(organizationId, appId);
    const users = await this.prisma.nodeRedUser.findMany({
      where: { appId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        permission: true,
        createdAt: true,
      },
    });
    return { users };
  }

  // Add an editor account. The password is hashed for storage and the accounts
  // are applied to the running instance (settings.js rewrite + restart) so the
  // change takes effect immediately.
  async addNodeRedUser(
    userId: string,
    organizationId: string,
    appId: string,
    dto: AddNodeRedUserDto,
  ) {
    const app = await this.findNodeRedApp(organizationId, appId);

    const existing = await this.prisma.nodeRedUser.findUnique({
      where: { appId_username: { appId, username: dto.username } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'USER_EXISTS',
        message: `An account named "${dto.username}" already exists`,
      });
    }

    const user = await this.prisma.nodeRedUser.create({
      data: {
        appId,
        username: dto.username,
        passwordHash: hashNodeRedPassword(dto.password),
        permission: dto.permission ?? '*',
      },
      select: { id: true, username: true, permission: true, createdAt: true },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'nodered.user.add',
      target: appId,
      metadata: { username: user.username, permission: user.permission },
    });

    const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
    return { user, applied };
  }

  // Update an account's password and/or permission, then re-apply.
  async updateNodeRedUser(
    userId: string,
    organizationId: string,
    appId: string,
    nodeRedUserId: string,
    dto: UpdateNodeRedUserDto,
  ) {
    const app = await this.findNodeRedApp(organizationId, appId);

    const record = await this.prisma.nodeRedUser.findFirst({
      where: { id: nodeRedUserId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    }

    const data: { passwordHash?: string; permission?: string } = {};
    if (dto.password !== undefined) {
      data.passwordHash = hashNodeRedPassword(dto.password);
    }
    if (dto.permission !== undefined) data.permission = dto.permission;

    const user = await this.prisma.nodeRedUser.update({
      where: { id: record.id },
      data,
      select: { id: true, username: true, permission: true, createdAt: true },
    });

    // Keep the encrypted admin password in sync so "Login as administrator"
    // stays valid: when the "admin" account's password is changed, re-store it
    // encrypted (it backs the auto-login token exchange).
    if (dto.password !== undefined && record.username === 'admin') {
      await this.prisma.app.update({
        where: { id: appId },
        data: { noderedAdminPasswordEnc: encrypt(dto.password) },
      });
    }

    await this.auditService.log({
      actorUserId: userId,
      action: 'nodered.user.update',
      target: appId,
      metadata: { username: user.username, fields: Object.keys(data) },
    });

    const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
    return { user, applied };
  }

  // Remove an account, then re-apply. The last remaining account cannot be
  // removed — an unprotected editor would be left wide open.
  async removeNodeRedUser(
    userId: string,
    organizationId: string,
    appId: string,
    nodeRedUserId: string,
  ) {
    const app = await this.findNodeRedApp(organizationId, appId);

    const record = await this.prisma.nodeRedUser.findFirst({
      where: { id: nodeRedUserId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    }

    const count = await this.prisma.nodeRedUser.count({ where: { appId } });
    if (count <= 1) {
      throw new BadRequestException({
        code: 'LAST_USER',
        message:
          'Cannot remove the last account — at least one editor account is required',
      });
    }

    await this.prisma.nodeRedUser.delete({ where: { id: record.id } });

    await this.auditService.log({
      actorUserId: userId,
      action: 'nodered.user.remove',
      target: appId,
      metadata: { username: record.username },
    });

    const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
    return { ok: true, applied };
  }

  // Regenerate settings.js from the app's current accounts and restart the
  // running container so the new auth takes effect. Best-effort: returns
  // { restarted: false } if the container isn't running yet (e.g. the app has
  // not been deployed). The accounts are persisted regardless and will be
  // rendered into settings.js on the next deploy.
  private async applyNodeRedAccounts(
    subdomain: string,
    appId: string,
  ): Promise<{ restarted: boolean }> {
    const users = await this.prisma.nodeRedUser.findMany({
      where: { appId },
      orderBy: { createdAt: 'asc' },
      select: { username: true, passwordHash: true, permission: true },
    });
    const settings = renderNodeRedSettings(users);

    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const containerName = `upande-${subdomain}`;

      // The container must already exist (i.e. the app was deployed) for a live
      // apply. If not, skip — the deploy pipeline will render settings.js.
      try {
        await docker.getContainer(containerName).inspect();
      } catch {
        return { restarted: false };
      }

      // settings.js lives in the persistent volume, not on the host FS, so write
      // it via a one-shot container that mounts the same volume.
      await this.writeNodeRedSettings(docker, noderedVolumeName(subdomain), settings);

      // Restart so Node-RED reloads settings.js (adminAuth is read at startup).
      await docker.getContainer(containerName).restart({ t: 5 });
      return { restarted: true };
    } catch (err) {
      console.warn(
        `[apps] applying Node-RED accounts for ${subdomain} failed:`,
        err instanceof Error ? err.message : err,
      );
      return { restarted: false };
    }
  }

  // Write settings.js into the Node-RED data volume via a short-lived helper
  // container (busybox) that mounts the volume. The content is passed base64 to
  // avoid any shell-quoting issues, then decoded into /data/settings.js.
  private async writeNodeRedSettings(
    docker: Docker,
    volumeName: string,
    settings: string,
  ): Promise<void> {
    await this.ensureImage(docker, 'busybox:1.36');
    const b64 = Buffer.from(settings, 'utf8').toString('base64');
    // Write settings.js and keep /data owned by the Node-RED user (1000:1000) —
    // the image runs as that non-root user and fails with EACCES on a root-owned
    // volume. See NODERED_UID in apps/nodered.ts.
    const script =
      `echo ${b64} | base64 -d > ${NODERED_DATA_DIR}/settings.js && ` +
      `chown -R ${NODERED_UID}:${NODERED_GID} ${NODERED_DATA_DIR}`;
    const container = await docker.createContainer({
      Image: 'busybox:1.36',
      Cmd: ['sh', '-c', script],
      HostConfig: {
        Binds: [`${volumeName}:${NODERED_DATA_DIR}`],
        AutoRemove: true,
      },
    });
    await container.start();
    // Wait for the one-shot to finish so the restart below sees the new file.
    await container.wait();
  }

  // Store an uploaded source folder for an app. Each file carries a relative
  // path (the browser's webkitRelativePath). We clear the app's previous upload
  // and rewrite the tree, so an upload fully replaces what was there before.
  // The app must be source=upload. Files build on the next manual Deploy.
  async uploadSource(
    userId: string,
    organizationId: string,
    appId: string,
    files: Array<{ relPath: string; buffer: Buffer }>,
  ) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.source !== 'upload') {
      throw new BadRequestException({
        code: 'NOT_UPLOAD_APP',
        message: 'This app is not configured for uploads',
      });
    }
    if (files.length === 0) {
      throw new BadRequestException({
        code: 'NO_FILES',
        message: 'No files were uploaded',
      });
    }

    const dir = appUploadDir(appId);
    // Replace any prior upload.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    // Many folder pickers nest everything under a single top-level dir (the
    // chosen folder's name). Strip that common prefix so the app's files sit at
    // the upload root, where the build expects them (package.json, etc.).
    const commonPrefix = stripCommonTopDir(files.map((f) => f.relPath));

    let written = 0;
    for (const file of files) {
      const safeRel = sanitizeRelPath(
        commonPrefix ? file.relPath.slice(commonPrefix.length) : file.relPath,
      );
      if (!safeRel) continue;
      const dest = path.join(dir, safeRel);
      // Guard against path traversal escaping the upload dir.
      if (!dest.startsWith(dir + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.buffer);
      written += 1;
    }

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.upload',
      target: appId,
      metadata: { files: written },
    });

    return { ok: true, files: written };
  }

  async updateApp(
    userId: string,
    organizationId: string,
    appId: string,
    dto: UpdateAppDto,
  ) {
    const current = await this.findAppForOrg(appId, organizationId);

    const data: {
      type?: 'static' | 'node' | 'fullstack';
      name?: string;
      repoUrl?: string | null;
      branch?: string;
      buildCmd?: string | null;
      outputDir?: string | null;
      healthCheckPath?: string | null;
      healthCheckTimeout?: number;
      healthCheckRetries?: number;
      githubCommitStatus?: boolean;
      githubPrComments?: boolean;
    } = {};
    if (dto.healthCheckPath !== undefined) data.healthCheckPath = dto.healthCheckPath || null;
    if (dto.healthCheckTimeout !== undefined) data.healthCheckTimeout = dto.healthCheckTimeout;
    if (dto.healthCheckRetries !== undefined) data.healthCheckRetries = dto.healthCheckRetries;
    if (dto.githubCommitStatus !== undefined) data.githubCommitStatus = dto.githubCommitStatus;
    if (dto.githubPrComments !== undefined) data.githubPrComments = dto.githubPrComments;
    if (dto.type !== undefined && dto.type !== current.type) {
      if (current.type === 'nodered') {
        throw new BadRequestException({
          code: 'TYPE_CHANGE_UNSUPPORTED',
          message: "Node-RED apps can't be switched to another type.",
        });
      }
      if (current.status === 'building') {
        throw new ConflictException({
          code: 'APP_BUILDING',
          message: 'Wait for the current build to finish before changing the app type.',
        });
      }
      data.type = dto.type;
    }
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.repoUrl !== undefined) data.repoUrl = dto.repoUrl || null;
    if (dto.branch !== undefined) data.branch = dto.branch || undefined;
    if (dto.buildCmd !== undefined) data.buildCmd = dto.buildCmd || null;
    if (dto.outputDir !== undefined) data.outputDir = dto.outputDir || null;

    const app = await this.prisma.app.update({
      where: { id: appId },
      data,
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.update',
      target: appId,
      metadata: {
        fields: Object.keys(data),
        ...(data.type ? { typeFrom: current.type, typeTo: data.type } : {}),
      },
    });

    // A type change only takes effect on the next deploy (it changes how the
    // image is built and whether a managed database is provisioned).
    return { app, redeployRequired: !!data.type };
  }

  // Size of the app's build cache (dashboard "Build cache" line).
  async getBuildCache(organizationId: string, appId: string) {
    await this.findAppForOrg(appId, organizationId);
    const u = await this.buildCache.usageForApp(appId);
    return { buildkit: u.buildkit, sizeBytes: u.totalBytes, entries: u.entries };
  }

  async deleteApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);

    // Stop queued / retrying deploy jobs first so none recreates the container.
    await this.deployService.cancelForApp(appId).catch(() => 0);

    // Tear down the running container (best-effort), plus any health-check
    // candidate left behind by an interrupted deploy.
    await this.stopContainer(app.subdomain);
    await this.stopContainer(`${app.subdomain}-candidate`);

    // Branch previews: containers, routers, images, throwaway DBs, rows.
    await this.previews.removeAllForApp(appId);

    // Remove every image this app ever built (one per deploy) — biggest disk
    // leak otherwise. Safe now that the container is gone. Best-effort.
    await this.removeAppImages(app.subdomain);

    // Drop the app's build cache (dependency layers + cache mounts).
    await this.buildCache.clearForApp(appId);

    // Node-RED apps: drop the persistent data volume (flows, installed nodes,
    // settings.js). Best-effort — must not block deletion. The NodeRedUser
    // records cascade on App delete.
    if (app.type === 'nodered' && app.noderedVolumeName) {
      await this.removeVolume(app.noderedVolumeName);
    }

    // Remove any uploaded source files (best-effort).
    fs.rmSync(appUploadDir(appId), { recursive: true, force: true });

    // Drop the managed production database + role (full-stack apps), so a
    // future app with this subdomain can never inherit the data.
    try {
      await this.dbProvision.dropForApp(appId);
    } catch (err) {
      new Logger(AppsService.name).warn(`dropping database of app ${appId} failed: ${String(err)}`);
    }

    // Remove child records first — schema has no cascade configured for these.
    await this.prisma.$transaction([
      this.prisma.deployToken.deleteMany({ where: { appId } }),
      this.prisma.envVar.deleteMany({ where: { appId } }),
      this.prisma.deployment.deleteMany({ where: { appId } }),
      this.prisma.app.delete({ where: { id: appId } }),
    ]);

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.delete',
      target: appId,
      metadata: { name: app.name },
    });

    return { ok: true, githubRepoFullName: app.githubRepoFullName, githubWebhookId: app.githubWebhookId };
  }

  // Persist webhook details after the GitHub service installs the hook.
  async attachWebhook(
    appId: string,
    organizationId: string,
    repoFullName: string,
    webhookId: string,
    webhookSecret: string,
  ) {
    await this.findAppForOrg(appId, organizationId);
    return this.prisma.app.update({
      where: { id: appId },
      data: {
        githubRepoFullName: repoFullName,
        githubWebhookId: webhookId,
        webhookSecret,
      },
    });
  }

  async deploy(userId: string, organizationId: string, appId: string, dto: DeployDto) {
    const app = await this.findAppForOrg(appId, organizationId);
    // "Clear build cache & redeploy" = a forceClean deploy (per-app cache
    // dropped, --no-cache build, rollback-safe swap).
    if (dto.clearCache) dto = { ...dto, forceClean: true };

    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: dto.ref ?? app.branch ?? 'main',
        status: 'queued',
        trigger: 'user',
        triggeredByUserId: userId ?? null,
        forceClean: dto.forceClean === true,
        triggerDetail: dto.clearCache ? 'clear-cache' : dto.forceClean ? 'migrate' : null,
      },
    });

    await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'building' },
    });

    await this.deployService.enqueue({
      deploymentId: deployment.id,
      appId,
      ref: dto.ref,
      forceClean: dto.forceClean,
      clearCache: dto.clearCache === true,
    });

    await this.auditService.log({
      actorUserId: userId ?? undefined,
      action: dto.clearCache ? 'app.deploy.clear_cache' : dto.forceClean ? 'app.migrate' : 'app.deploy',
      target: appId,
      metadata: { deploymentId: deployment.id, ref: dto.ref, forceClean: dto.forceClean },
    });

    return { deployment };
  }

  // Migrate = forced clean rebuild + rollback-safe redeploy. Same pipeline as
  // deploy, but builds with no cache and restores the previous container if the
  // swap fails, so the site never goes down. Implemented as deploy({forceClean}).
  async migrate(userId: string, organizationId: string, appId: string, dto: DeployDto) {
    return this.deploy(userId, organizationId, appId, { ...dto, forceClean: true });
  }

  // Deploy without a user session: a per-app deploy token (CI) or the GitHub
  // push webhook. `source` records which one for the deploy history.
  async deployByToken(
    appId: string,
    dto: DeployDto,
    source: DeploySource = { trigger: 'api_token' },
  ) {
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    let triggerDetail = source.detail ?? null;
    if (source.trigger === 'api_token' && source.deployTokenId && !triggerDetail) {
      const token = await this.prisma.deployToken.findUnique({
        where: { id: source.deployTokenId },
        select: { name: true },
      });
      triggerDetail = token ? `token "${token.name}"` : null;
    }

    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: dto.ref ?? app.branch ?? 'main',
        status: 'queued',
        trigger: source.trigger,
        deployTokenId: source.deployTokenId ?? null,
        triggerDetail,
        commitSha: source.commitSha ?? null,
        commitMessage: source.commitMessage?.slice(0, 500) ?? null,
        forceClean: dto.forceClean === true,
      },
    });

    await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'building' },
    });

    await this.deployService.enqueue({
      deploymentId: deployment.id,
      appId,
      ref: dto.ref,
      forceClean: dto.forceClean,
    });

    await this.auditService.log({
      action: source.trigger === 'webhook' ? 'app.deploy.webhook' : 'app.deploy.token',
      target: appId,
      metadata: {
        deploymentId: deployment.id,
        ref: deployment.ref,
        deployTokenId: source.deployTokenId,
        commitSha: source.commitSha,
      },
    });

    return { deployment };
  }

  // ---- Deploy history ----

  // Every deployment of an app, newest first, with who/what triggered it, the
  // commit, timing and whether a persisted log exists. Cursor-paginated by id
  // (`before` = the last id of the previous page).
  async listDeployments(
    organizationId: string,
    appId: string,
    opts: { take?: number; before?: string } = {},
  ) {
    const app = await this.findAppForOrg(appId, organizationId);
    const take = Math.min(Math.max(Number(opts.take) || 30, 1), 100);
    const [rows, images, current] = await Promise.all([
      this.prisma.deployment.findMany({
        where: { appId, previewId: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
        include: {
          triggeredBy: { select: { id: true, username: true, email: true } },
          log: { select: { lineCount: true, truncated: true } },
          rollbackOf: { select: { id: true, commitSha: true } },
        },
      }),
      this.localImageTags(app.subdomain),
      this.prisma.deployment.findFirst({
        where: { appId, status: 'live', previewId: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    ]);
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    return {
      deployments: page.map((d) => {
        const imageAvailable = !!d.imageRef && images.has(d.imageRef);
        return {
          ...this.deploymentView(d),
          rollbackOf: d.rollbackOf
            ? { id: d.rollbackOf.id, commitSha: d.rollbackOf.commitSha }
            : null,
          isCurrent: d.id === current?.id,
          imageAvailable,
          // Rollback = redeploy a previous SUCCESSFUL version: instantly from
          // its kept image, else by rebuilding its exact commit.
          canRollback:
            d.status === 'live' &&
            app.type !== 'nodered' &&
            (imageAvailable || (app.source === 'git' && !!d.commitSha)),
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Tags of the images still on disk for an app (`upande-app-<subdomain>:*`).
  private async localImageTags(subdomain: string): Promise<Set<string>> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const repo = `upande-app-${subdomain}`;
      const images = await docker.listImages({ filters: { reference: [`${repo}:*`] } });
      return new Set(images.flatMap((i) => i.RepoTags ?? []));
    } catch {
      return new Set();
    }
  }

  // "Redeploy this version": roll the app back to an earlier successful
  // deployment. Recorded as a NEW deployment (trigger = rollback) linked to
  // the source via rollbackOfId. Reuses the source's image when it is still
  // kept (instant, no rebuild — see IMAGE_RETENTION_COUNT); otherwise rebuilds
  // the exact commit. The app's CURRENT env vars / settings are applied.
  async rollback(
    userId: string,
    organizationId: string,
    appId: string,
    deploymentId: string,
  ) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.type === 'nodered') {
      throw new BadRequestException({
        code: 'ROLLBACK_UNSUPPORTED',
        message: 'Node-RED apps run the official image — use Deploy instead of a rollback.',
      });
    }
    if (app.status === 'building') {
      throw new ConflictException({
        code: 'DEPLOY_IN_PROGRESS',
        message: 'A deployment is already in progress. Wait for it to finish (or cancel it) first.',
      });
    }
    const source = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, appId, previewId: null },
    });
    if (!source) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deployment not found' });
    }
    if (source.status !== 'live') {
      throw new BadRequestException({
        code: 'ROLLBACK_NOT_SUCCESSFUL',
        message: 'Only a previously successful deployment can be redeployed.',
      });
    }
    const images = await this.localImageTags(app.subdomain);
    const imageAvailable = !!source.imageRef && images.has(source.imageRef);
    if (!imageAvailable && !(app.source === 'git' && source.commitSha)) {
      throw new BadRequestException({
        code: 'ROLLBACK_UNAVAILABLE',
        message:
          app.source === 'upload'
            ? "That version's image has been pruned and uploaded sources aren't versioned, so it can't be redeployed."
            : "That version's image has been pruned and its commit wasn't recorded, so it can't be rebuilt exactly.",
      });
    }

    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: source.ref,
        status: 'queued',
        trigger: 'rollback',
        triggeredByUserId: userId,
        rollbackOfId: source.id,
        commitSha: source.commitSha,
        commitMessage: source.commitMessage,
        triggerDetail: `redeploy of ${source.id.slice(0, 8)}${imageAvailable ? '' : ' (rebuild)'}`,
      },
    });
    await this.prisma.app.update({ where: { id: appId }, data: { status: 'building' } });
    await this.deployService.enqueue({
      deploymentId: deployment.id,
      appId,
      ref: source.ref ?? undefined,
      rollbackImage: source.imageRef ?? undefined,
      commitSha: source.commitSha ?? undefined,
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.rollback',
      target: appId,
      metadata: {
        deploymentId: deployment.id,
        rollbackOfId: source.id,
        commitSha: source.commitSha,
        reuseImage: imageAvailable,
      },
    });

    return { deployment, reuseImage: imageAvailable };
  }

  private deploymentView(d: {
    id: string;
    appId: string;
    ref: string | null;
    status: string;
    imageRef: string | null;
    createdAt: Date;
    trigger: string | null;
    triggerDetail: string | null;
    deployTokenId: string | null;
    commitSha: string | null;
    commitMessage: string | null;
    forceClean: boolean;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorReason: string | null;
    triggeredBy?: { id: string; username: string; email: string } | null;
    log?: { lineCount: number; truncated: boolean } | null;
  }) {
    return {
      id: d.id,
      appId: d.appId,
      ref: d.ref,
      branch: d.ref,
      status: d.status,
      imageRef: d.imageRef,
      createdAt: d.createdAt,
      trigger: d.trigger,
      triggerDetail: d.triggerDetail,
      deployTokenId: d.deployTokenId,
      triggeredBy: d.triggeredBy
        ? { id: d.triggeredBy.id, username: d.triggeredBy.username, email: d.triggeredBy.email }
        : null,
      commitSha: d.commitSha,
      commitMessage: d.commitMessage,
      forceClean: d.forceClean,
      startedAt: d.startedAt,
      finishedAt: d.finishedAt,
      durationMs:
        d.startedAt && d.finishedAt ? d.finishedAt.getTime() - d.startedAt.getTime() : null,
      errorReason: d.errorReason,
      logPersisted: !!d.log,
      logTruncated: d.log?.truncated ?? false,
    };
  }

  streamLogs(organizationId: string, appId: string): Observable<{ data: string }> {
    const subject = new Subject<{ data: string }>();

    // Emit logs asynchronously. Each Redis log line is sent as its OWN SSE
    // event (never joined with "\n", which SSE would mangle). We tail until the
    // deployment reaches a terminal state, flush any final lines written at the
    // finish, then signal end-of-stream with a sentinel so the client knows to
    // stop reconnecting.
    (async () => {
      try {
        // Enforce org ownership before streaming any logs (prevents cross-tenant
        // log access by app id). Throws NotFound if the app is not in this org.
        await this.findAppForOrg(appId, organizationId);

        const latest = await this.prisma.deployment.findFirst({
          where: { appId, previewId: null },
          orderBy: { createdAt: 'desc' },
        });

        if (!latest) {
          subject.next({ data: 'No deployments found for this app' });
          subject.next({ data: '@end' });
          subject.complete();
          return;
        }

        const terminal = (s: string) =>
          s === 'live' || s === 'failed' || s === 'stopped';

        let cursor = 0;
        const flushNew = async () => {
          const lines = await this.logStore.getFrom(latest.id, cursor);
          for (const line of lines) {
            subject.next({ data: line });
          }
          cursor += lines.length;
        };

        // Initial backlog.
        await flushNew();

        // If still in flight, poll for new lines + the deployment status until
        // it finishes. Re-reading status each tick is what fixes the "stuck on
        // Building" freeze: once it goes live/failed/stopped we flush the tail
        // and end cleanly.
        let status = latest.status as string;
        const startedAt = Date.now();
        const MAX_MS = 15 * 60 * 1000; // safety cap: 15 min
        while (!terminal(status) && Date.now() - startedAt < MAX_MS) {
          await new Promise((r) => setTimeout(r, 500));
          await flushNew();
          const fresh = await this.prisma.deployment.findUnique({
            where: { id: latest.id },
            select: { status: true },
          });
          status = fresh?.status ?? status;
        }

        // Final flush to catch lines written right as it finished.
        await flushNew();

        subject.next({ data: '@end' });
        subject.complete();
      } catch (err) {
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  // Fetch the full stored log for ONE specific deployment (not just the latest),
  // org-scoped, for the error-analysis page. Logs live in Redis with a TTL, so
  // an old deployment's log may have expired — we return what's there plus the
  // deployment's terminal status so the UI can explain an empty log.
  async getDeploymentLog(
    organizationId: string,
    appId: string,
    deploymentId: string,
  ): Promise<{ status: string; ref: string | null; createdAt: Date; lines: string[] }> {
    await this.findAppForOrg(appId, organizationId);
    const deployment = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, appId },
      select: { status: true, ref: true, createdAt: true },
    });
    if (!deployment) {
      throw new NotFoundException('Deployment not found');
    }
    const lines = await this.logStore.getAll(deploymentId);
    return {
      status: deployment.status,
      ref: deployment.ref,
      createdAt: deployment.createdAt,
      lines,
    };
  }

  async stopApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    await this.stopContainer(app.subdomain);

    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'stopped' },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.stop',
      target: appId,
    });

    return { app: updated };
  }

  // Cancel an in-progress build. The deploy runs as a retrying BullMQ job, so a
  // stuck or unwanted build keeps re-running and leaves the app pinned in
  // 'building' with no UI escape hatch. This:
  //   1. removes the app's deploy jobs from the queue (stops further retries),
  //   2. tears down any in-flight build containers + the app container so the
  //      current attempt's work is killed, and
  //   3. marks the latest building deployment + the app as 'stopped', and ends
  //      the live log stream so the dashboard returns to a terminal state.
  async cancelApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);

    // 1. Stop the job from retrying.
    const removed = await this.deployService.cancelForApp(appId);

    // 2. Remove only the deploy's own helper containers (health-check
    // candidate / overlap "next"). The LIVE container keeps serving — the
    // running job sees the cancellation before its swap and stops there
    // (deploy.processor assertStillWanted). No global builder prune: that
    // would wipe every app's build cache.
    await this.stopContainer(`${app.subdomain}-candidate`);
    await this.stopContainer(`${app.subdomain}-next`);

    // 3. Reset the latest in-flight deployment + the app to a terminal state.
    const building = await this.prisma.deployment.findFirst({
      where: { appId, status: { in: ['building', 'queued'] }, previewId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (building) {
      await this.prisma.deployment.update({
        where: { id: building.id },
        data: { status: 'failed' },
      });
      // End the live log stream so the dashboard's LogViewer stops "Live".
      await this.logStore.append(building.id, '@fail Build|Cancelled by user');
      await this.prisma.deployment.update({
        where: { id: building.id },
        data: { finishedAt: new Date(), errorReason: 'Cancelled by user' },
      });
      await this.logStore.persist(building.id);
    }

    // The previous version is still up → the app stays live.
    const serving = await new Docker({ socketPath: '/var/run/docker.sock' })
      .getContainer(`upande-${app.subdomain}`)
      .inspect()
      .then((i) => !!i.State?.Running)
      .catch(() => false);
    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { status: serving ? 'live' : 'stopped' },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.cancel',
      target: appId,
      metadata: { subdomain: app.subdomain, jobsRemoved: removed },
    });

    return { app: updated };
  }

  // Restart the running container in place (docker restart). Unlike a redeploy
  // this keeps the same image/container, so a Node-RED instance reloads its
  // settings.js + flows from the persistent volume without a rebuild. Throws if
  // there is no container yet (the app hasn't been deployed) so the UI can tell
  // the user to deploy first.
  async restartApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);

    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const containerName = `upande-${app.subdomain}`;
    try {
      await docker.getContainer(containerName).inspect();
    } catch {
      throw new BadRequestException({
        code: 'NOT_RUNNING',
        message: 'No running instance to restart — deploy the app first.',
      });
    }

    await docker.getContainer(containerName).restart({ t: 5 });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.restart',
      target: appId,
      metadata: { subdomain: app.subdomain },
    });

    return { ok: true };
  }

  // Runtime state of the app's container for the app page: running /
  // restarting (crash loop) / exited, Docker's restart count since the last
  // deploy, last exit code and OOM kills. Containers auto-restart via their
  // restart policy (APP_RESTART_POLICY, default on-failure:5), so a crash shows
  // up as a climbing restart count / "restarting" state, and — once the retries
  // are used up — as crashed with restartsExhausted.
  async getContainerStatus(organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    let info: Docker.ContainerInspectInfo;
    try {
      info = await docker.getContainer(`upande-${app.subdomain}`).inspect();
    } catch {
      return { exists: false as const };
    }
    const st = info.State;
    const image = info.Config?.Image ?? '';
    const crashed = st.Restarting || (!st.Running && st.Status !== 'created' && st.ExitCode !== 0);
    const policy = info.HostConfig?.RestartPolicy;
    const maxRetries =
      policy?.Name === 'on-failure' && policy.MaximumRetryCount ? policy.MaximumRetryCount : null;
    // on-failure:<max> gave up: Docker stopped restarting the crashed app.
    const restartsExhausted =
      crashed && !st.Running && !st.Restarting && maxRetries !== null &&
      (info.RestartCount ?? 0) >= maxRetries;
    return {
      exists: true as const,
      state: st.Status, // running | restarting | exited | paused | created | dead
      running: st.Running,
      restarting: st.Restarting,
      crashed,
      restartCount: info.RestartCount ?? 0,
      exitCode: st.ExitCode,
      oomKilled: st.OOMKilled,
      error: st.Error || null,
      startedAt: st.StartedAt,
      finishedAt: st.FinishedAt && !st.FinishedAt.startsWith('0001') ? st.FinishedAt : null,
      restartPolicy: policy?.Name
        ? `${policy.Name}${maxRetries !== null ? `:${maxRetries}` : ''}`
        : null,
      maxRetries,
      restartsExhausted,
      // The "being set up" placeholder, not a real deploy yet.
      placeholder: !image.startsWith('upande-app-') && image !== NODERED_IMAGE,
    };
  }

  // Snapshot of the running container's recent stdout/stderr (the live app's
  // own logs — e.g. Node-RED's runtime output: started flows, node installs,
  // errors). Non-following: returns the last `tail` lines and exits, so the UI
  // can poll/refresh. Returns running:false (and no lines) when the app has no
  // container yet, so the UI can prompt the user to deploy.
  async getRuntimeLogs(
    organizationId: string,
    appId: string,
    tail = 200,
  ): Promise<{ running: boolean; lines: string[] }> {
    const app = await this.findAppForOrg(appId, organizationId);

    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const container = docker.getContainer(`upande-${app.subdomain}`);
    try {
      await container.inspect();
    } catch {
      return { running: false, lines: [] };
    }

    // Clamp tail to a sane window so a huge value can't be abused.
    const safeTail = Math.min(Math.max(Math.floor(tail) || 0, 1), 1000);
    const buf = (await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail: safeTail,
      timestamps: false,
    })) as unknown as Buffer;

    // Docker multiplexes stdout/stderr with an 8-byte header per frame; strip
    // the control bytes and split into clean lines.
    const text = buf
      .toString('utf8')
      .replace(/[\x00-\x08]/g, '')
      .replace(/[\x0e-\x1f]/g, '');
    const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    return { running: true, lines };
  }

  async createToken(userId: string, organizationId: string, appId: string, dto: CreateTokenDto) {
    await this.findAppForOrg(appId, organizationId);

    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(plainToken, 10);

    const deployToken = await this.prisma.deployToken.create({
      data: {
        appId,
        name: dto.name,
        hashedToken,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'token.create',
      target: appId,
      metadata: { tokenId: deployToken.id, name: dto.name },
    });

    return {
      token: plainToken,
      id: deployToken.id,
      name: deployToken.name,
    };
  }

  async listTokens(userId: string, organizationId: string, appId: string) {
    await this.findAppForOrg(appId, organizationId);

    const tokens = await this.prisma.deployToken.findMany({
      where: { appId },
      select: { id: true, name: true, lastUsedAt: true },
      orderBy: { name: 'asc' },
    });

    return { tokens };
  }

  // ---- Custom domains ----
  //
  // Two ways to prove ownership:
  //  - platform-hosted: the domain (or its closest parent) is a DnsZone owned by
  //    the same org -> verified immediately, and the routing record is created
  //    in PowerDNS for the user (never overwriting a different existing record).
  //  - external: a TXT record at _upande-challenge.<domain> with the verify token.
  // Either way the routing record (A to the server's public IP at an apex —
  // PlatformNetworkService: admin Settings -> Networking, else PUBLIC_IP — CNAME
  // to the app's <slug>.<BASE_DOMAIN> host otherwise) is checked and reported as
  // a warning. In hosted zones the user can repoint the domain (default target
  // or custom A/AAAA IPs) with setDomainTarget; domainStatus shows what public
  // DNS, PowerDNS and the NS delegation currently say.
  // Verified domains become Traefik routers on the next deploy.

  async listDomains(organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    const domains = await this.prisma.customDomain.findMany({
      where: { appId },
      orderBy: { createdAt: 'asc' },
    });
    const ip = await this.network.primaryIp();
    const views = await Promise.all(
      domains.map(async (d) =>
        this.domainView(d, app.subdomain, await this.hostedZoneFor(organizationId, d.domain), ip),
      ),
    );
    return { domains: views };
  }

  async addDomain(userId: string, organizationId: string, appId: string, dto: AddDomainDto) {
    const app = await this.findAppForOrg(appId, organizationId);
    const domain = dto.domain.trim().toLowerCase().replace(/\.$/, '');

    const existing = await this.prisma.customDomain.findUnique({ where: { domain } });
    if (existing) {
      throw new ConflictException({
        code: 'DOMAIN_TAKEN',
        message: 'That domain is already attached to an app.',
      });
    }

    const created = await this.prisma.customDomain.create({
      data: {
        appId,
        domain,
        status: 'pending',
        verifyToken: `upande-verify=${crypto.randomBytes(16).toString('hex')}`,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'domain.add',
      target: appId,
      metadata: { domain },
    });

    // Platform-hosted shortcut: verify + configure DNS right away.
    const zone = await this.hostedZoneFor(organizationId, domain);
    if (zone) {
      const result = await this.checkDomain(userId, app.subdomain, created, zone);
      return { domain: result.view, verified: result.verified, message: result.message };
    }
    return { domain: this.domainView(created, app.subdomain, null, await this.network.primaryIp()) };
  }

  async verifyDomain(userId: string, organizationId: string, appId: string, domainId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    const record = await this.prisma.customDomain.findFirst({
      where: { id: domainId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
    }
    const zone = await this.hostedZoneFor(organizationId, record.domain);
    const result = await this.checkDomain(userId, app.subdomain, record, zone);

    await this.auditService.log({
      actorUserId: userId,
      action: 'domain.verify',
      target: appId,
      metadata: {
        domain: record.domain,
        verified: result.verified,
        method: zone ? 'platform-dns' : 'txt',
      },
    });

    return { domain: result.view, verified: result.verified, message: result.message };
  }

  async removeDomain(userId: string, organizationId: string, appId: string, domainId: string) {
    await this.findAppForOrg(appId, organizationId);
    const record = await this.prisma.customDomain.findFirst({
      where: { id: domainId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
    }

    // Remove only the routing record the platform itself created.
    let recordRemoved = false;
    let recordError: string | null = null;
    if (record.dnsZoneName && record.autoRecordType && record.autoRecordValue) {
      try {
        recordRemoved = await this.dnsService.removeRoutingRecord(
          userId,
          record.dnsZoneName,
          record.domain,
          record.autoRecordType,
          record.autoRecordValue,
        );
      } catch (err) {
        recordError = err instanceof Error ? err.message : String(err);
      }
    }

    await this.prisma.customDomain.delete({ where: { id: record.id } });
    this.statusCache.delete(record.id);
    await this.auditService.log({
      actorUserId: userId,
      action: 'domain.remove',
      target: appId,
      metadata: { domain: record.domain, recordRemoved },
    });
    return {
      ok: true,
      recordRemoved,
      ...(recordError
        ? {
            message: `Domain removed, but its DNS record in ${record.dnsZoneName} could not be deleted (${recordError}). Remove the ${record.autoRecordType} record for ${record.domain} manually.`,
          }
        : {}),
    };
  }

  // ---- Custom domain target + live status ----

  // Short-lived per-domain status cache so the dashboard can't hammer DNS.
  private readonly statusCache = new Map<string, { at: number; value: DomainStatus }>();
  private static readonly STATUS_TTL_MS = 30_000;
  // Even an explicit refresh re-queries at most this often.
  private static readonly STATUS_MIN_REFRESH_MS = 5_000;

  /**
   * Point a domain in a platform-hosted zone at the platform (default target)
   * or at custom A/AAAA addresses, by writing its routing RRset in PowerDNS.
   * Records the platform didn't create are only replaced with confirmReplace.
   */
  async setDomainTarget(
    userId: string,
    organizationId: string,
    appId: string,
    domainId: string,
    dto: SetDomainTargetDto,
  ) {
    const app = await this.findAppForOrg(appId, organizationId);
    const record = await this.prisma.customDomain.findFirst({
      where: { id: domainId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
    }
    const zone = await this.hostedZoneFor(organizationId, record.domain);
    if (!zone) {
      throw new BadRequestException({
        code: 'NOT_HOSTED',
        message: `${record.domain} isn't in a DNS zone hosted on this platform by your organization, so its records can't be changed here. Update them at your DNS provider.`,
      });
    }

    const ip = await this.network.primaryIp();
    const ttl = dto.ttl ?? 300;
    let desired: { type: 'A' | 'AAAA' | 'CNAME'; values: string[]; ttl: number };
    if (dto.mode === 'platform') {
      const t = routeTarget(record.domain, app.subdomain, zone.name, ip);
      if (!t.value) {
        throw new BadRequestException({
          code: 'NO_PLATFORM_TARGET',
          message: t.note ?? "The platform target isn't configured.",
        });
      }
      desired = { type: t.type, values: [t.value], ttl };
    } else {
      const type = dto.type === 'AAAA' ? 'AAAA' : 'A';
      const family = type === 'A' ? 4 : 6;
      const seen = new Set<string>();
      const values: string[] = [];
      for (const raw of dto.values ?? []) {
        const v = raw.trim();
        if (!v) continue;
        if (isIP(v) !== family) {
          throw new BadRequestException({
            code: 'INVALID_IP',
            message: `"${v}" is not a valid ${family === 4 ? 'IPv4' : 'IPv6'} address (${type} record).`,
          });
        }
        const key = recordKey(type, v);
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(v);
      }
      if (!values.length) {
        throw new BadRequestException({
          code: 'INVALID_IP',
          message: `Enter at least one ${family === 4 ? 'IPv4' : 'IPv6'} address.`,
        });
      }
      desired = { type, values, ttl };
    }

    const managed =
      record.dnsZoneName === zone.name && record.autoRecordType && record.autoRecordValue
        ? { type: record.autoRecordType, values: splitManagedValues(record.autoRecordValue) }
        : null;
    const res = await this.dnsService.setRoutingRecord(
      userId,
      zone.name,
      record.domain,
      desired,
      managed,
      dto.confirmReplace === true,
    );
    const desc = `${desired.type} ${record.domain} -> ${desired.values.join(', ')} (TTL ${ttl}s)`;

    if (res.status === 'confirm_required') {
      return {
        ok: false,
        confirmRequired: true,
        existing: res.unmanaged,
        message: `${record.domain} already has ${describeRRSets(res.unmanaged)} in ${zone.name}, which the platform didn't create. Confirm to replace it with ${desc}.`,
      };
    }

    const updated = await this.prisma.customDomain.update({
      where: { id: record.id },
      data: {
        dnsZoneName: zone.name,
        autoRecordType: res.managedAfter ? desired.type : null,
        autoRecordValue: res.managedAfter ? desired.values.join(',') : null,
        // The previous check result described the old record; the live status replaces it.
        lastCheck: Prisma.DbNull,
        status: 'verified',
        verifiedAt: record.verifiedAt ?? new Date(),
      },
    });
    this.statusCache.delete(record.id);

    await this.auditService.log({
      actorUserId: userId,
      action: 'domain.target.update',
      target: appId,
      metadata: {
        domain: record.domain,
        zone: zone.name,
        mode: dto.mode,
        type: desired.type,
        values: desired.values,
        ttl,
        result: res.status,
        replaced: res.replaced,
        replacedUnmanaged: res.unmanaged.length > 0,
      },
    });

    const message =
      res.status === 'unchanged'
        ? `${desc} is already set in ${zone.name}.`
        : `Set ${desc} in ${zone.name}.` +
          (res.replaced.length ? ` Replaced ${describeRRSets(res.replaced)}.` : '') +
          ' Public DNS may take up to the old TTL to pick this up.';
    return {
      ok: true,
      message,
      domain: this.domainView(updated, app.subdomain, zone, ip),
    };
  }

  /**
   * What the world sees for a domain right now: public DNS answers (via a
   * public resolver), the routing RRsets in the platform's PowerDNS (hosted
   * zones only), and whether the zone is delegated to the platform. Cached
   * briefly per domain.
   */
  async domainStatus(
    organizationId: string,
    appId: string,
    domainId: string,
    refresh = false,
  ): Promise<DomainStatus> {
    const app = await this.findAppForOrg(appId, organizationId);
    const record = await this.prisma.customDomain.findFirst({
      where: { id: domainId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
    }
    const cached = this.statusCache.get(record.id);
    const maxAge = refresh ? AppsService.STATUS_MIN_REFRESH_MS : AppsService.STATUS_TTL_MS;
    if (cached && Date.now() - cached.at < maxAge) return { ...cached.value, cached: true };

    const ip = await this.network.primaryIp();
    const zone = await this.hostedZoneFor(organizationId, record.domain);
    const expected = routeTarget(record.domain, app.subdomain, zone?.name, ip);

    const [a, aaaa, cname] = await Promise.all([
      resolvePublic('A', record.domain),
      resolvePublic('AAAA', record.domain),
      resolvePublic('CNAME', record.domain),
    ]);
    const pub: DomainStatus['public'] = {
      a: a.values,
      aaaa: aaaa.values,
      cname: cname.values,
      error:
        a.values.length || aaaa.values.length || cname.values.length
          ? null
          : (a.error ?? cname.error ?? 'no records'),
    };
    const pubFound = [
      ...pub.cname.map((v) => `CNAME ${v}`),
      ...pub.a.map((v) => `A ${v}`),
      ...pub.aaaa.map((v) => `AAAA ${v}`),
    ];
    const pubText = pubFound.join(', ');

    const pointsAtPlatform =
      (!!ip && (pub.a.includes(ip) || pub.aaaa.some((v) => recordKey('AAAA', v) === recordKey('AAAA', ip)))) ||
      (expected.type === 'CNAME' && !!expected.value && pub.cname.some((v) => sameHost(v, expected.value!)));

    let platform: DomainStatus['platform'] = null;
    let delegation: DomainStatus['delegation'] = null;
    let targetMode: DomainStatus['targetMode'] = 'none';
    let state: DomainStatus['state'];
    let message: string;

    if (zone) {
      const managed =
        record.dnsZoneName === zone.name && record.autoRecordType && record.autoRecordValue
          ? { type: record.autoRecordType, values: splitManagedValues(record.autoRecordValue) }
          : null;
      try {
        const rr = await this.dnsService.getRoutingRecords(zone.name, record.domain);
        platform = {
          zone: zone.name,
          rrsets: rr.rrsets.map((r) => ({
            ...r,
            managed:
              !!managed &&
              r.type === managed.type &&
              r.records.length > 0 &&
              r.records.every((c) => managed.values.some((m) => recordKey(r.type, m) === recordKey(r.type, c))),
          })),
          error: null,
        };
      } catch (err) {
        platform = { zone: zone.name, rrsets: [], error: err instanceof Error ? err.message : String(err) };
      }
      delegation = await this.checkDelegation(zone.name);

      const rrsets = platform.rrsets;
      if (rrsets.length === 1 && expected.value && rrsets[0].type === expected.type &&
          sameValueSet(expected.type, rrsets[0].records, [expected.value])) {
        targetMode = 'platform';
      } else if (rrsets.length && rrsets.every((r) => r.type === 'A' || r.type === 'AAAA')) {
        targetMode = 'custom';
      } else if (rrsets.length) {
        targetMode = 'other';
      }

      const platformText = describeRRSets(rrsets);
      const publicMatches =
        rrsets.length > 0 &&
        rrsets.every((r) =>
          r.type === 'CNAME'
            ? pub.cname.some((v) => r.records.some((c) => sameHost(v, c)))
            : sameValueSet(r.type, r.type === 'A' ? pub.a : pub.aaaa, r.records),
        );

      if (platform.error) {
        state = 'error';
        message = `Could not read ${zone.name} from the platform DNS: ${platform.error}`;
      } else if (!rrsets.length) {
        state = 'no_record';
        message = `No A, AAAA or CNAME record for ${record.domain} in the ${zone.name} zone yet. Choose a target below to create one.`;
      } else if (!delegation.ok) {
        state = 'not_delegated';
        message = `Platform record set (${platformText}), but ${zone.name} is not delegated to the platform (current nameservers: ${delegation.found.length ? delegation.found.join(', ') : 'unknown'}). Set the nameservers at your registrar to ${delegation.expected.join(', ')}.`;
      } else if (publicMatches) {
        state = 'live';
        message = `Live: public DNS returns ${pubText}, matching the platform record.`;
      } else if (pubFound.length) {
        state = 'points_elsewhere';
        message = `Points elsewhere (${pubText}); the platform record is ${platformText}. If you just changed it, resolvers may keep the old answer for up to its TTL.`;
      } else {
        state = 'not_resolving';
        message = `${record.domain} doesn't resolve publicly yet (${pub.error}); the platform record is ${platformText}.`;
      }
    } else if (pointsAtPlatform) {
      state = 'live';
      message = `Live: public DNS returns ${pubText}, which points at this platform.`;
    } else if (pubFound.length) {
      state = 'points_elsewhere';
      message = `Points elsewhere (${pubText}); expected ${expected.type} ${expected.value ?? '(server IP not configured)'}.`;
    } else {
      state = 'not_resolving';
      message = `${record.domain} doesn't resolve publicly (${pub.error}).`;
    }

    const value: DomainStatus = {
      domainId: record.id,
      domain: record.domain,
      checkedAt: new Date().toISOString(),
      cached: false,
      state,
      message,
      pointsAtPlatform,
      targetMode,
      serverIp: ip,
      expected: {
        type: expected.type,
        value: expected.value,
        apex: expected.apex,
        note: expected.note ?? null,
      },
      public: pub,
      platform,
      delegation: delegation
        ? { ok: delegation.ok, zone: delegation.zone, expected: delegation.expected, found: delegation.found }
        : null,
    };
    this.statusCache.set(record.id, { at: Date.now(), value });
    return value;
  }

  /**
   * If the routing RRset the platform manages for this domain is still in
   * PowerDNS, report it (so Re-check doesn't try to re-create the default
   * target over a custom one). Null when there is none / it is gone.
   */
  private async managedRecordInPlace(
    record: CustomDomainRow,
    zoneName: string,
  ): Promise<NonNullable<DomainCheck['autoRecord']> | null> {
    if (record.dnsZoneName !== zoneName || !record.autoRecordType || !record.autoRecordValue) {
      return null;
    }
    const values = splitManagedValues(record.autoRecordValue);
    try {
      const rr = await this.dnsService.getRoutingRecords(zoneName, record.domain);
      const same = rr.rrsets.find((r) => r.type === record.autoRecordType);
      if (!same || !sameValueSet(same.type, same.records, values)) return null;
    } catch {
      return null;
    }
    return {
      status: 'exists',
      type: record.autoRecordType,
      value: values.join(', '),
      message: `DNS record ${record.autoRecordType} ${record.domain} -> ${values.join(', ')} (managed by the platform) is in place in ${zoneName}.`,
    };
  }

  /** The platform-hosted zone for `domain` if (and only if) this org owns it. */
  private async hostedZoneFor(organizationId: string, domain: string) {
    const zone = await this.dnsService.findZoneForDomain(domain);
    return zone && zone.organizationId === organizationId ? zone : null;
  }

  /**
   * Run ownership + routing checks for a domain, persist the outcome (status +
   * lastCheck) and build a human-readable summary.
   */
  private async checkDomain(
    userId: string,
    appSubdomain: string,
    record: CustomDomainRow,
    zone: { name: string } | null,
  ) {
    const ip = await this.network.primaryIp();
    const target = routeTarget(record.domain, appSubdomain, zone?.name, ip);
    const warnings: string[] = [];
    let verified: boolean;
    let ownership: DomainCheck['ownership'];
    let autoRecord: DomainCheck['autoRecord'];
    let delegation: DomainCheck['delegation'];
    const data: Record<string, unknown> = {};

    if (zone) {
      // 1) Ownership: the org owns the hosted zone.
      verified = true;
      ownership = {
        method: 'platform-dns',
        ok: true,
        zone: zone.name,
        message: `Ownership proven: ${zone.name} is a DNS zone hosted on this platform by your organization.`,
      };
      data.dnsZoneName = zone.name;

      // 2) Create the routing record for the user — unless the routing record
      //    the platform already manages (possibly a custom target set via
      //    setDomainTarget) is still in place, in which case keep it.
      autoRecord =
        (await this.managedRecordInPlace(record, zone.name)) ??
        (await this.configureRoutingRecord(userId, record, zone.name, target));
      if (autoRecord.status === 'created') {
        data.autoRecordType = target.type;
        data.autoRecordValue = target.value;
      }
      if (autoRecord.status !== 'created' && autoRecord.status !== 'exists') {
        warnings.push(autoRecord.message);
      }

      // 3) The records only take effect if the zone is delegated to us.
      delegation = await this.checkDelegation(zone.name);
      if (!delegation.ok) warnings.push(delegation.message);
    } else {
      // No longer (or never) in a hosted zone of this org: forget platform-DNS state.
      if (record.dnsZoneName) {
        data.dnsZoneName = null;
        data.autoRecordType = null;
        data.autoRecordValue = null;
      }
      const host = `_upande-challenge.${record.domain}`;
      const txt = await resolvePublic('TXT', host);
      verified = txt.values.some((v) => v.trim() === record.verifyToken);
      const foundText = txt.values.length
        ? `found ${txt.values.map((v) => `"${v}"`).join(', ')}`
        : `found nothing (${txt.error ?? 'no TXT records'})`;
      ownership = {
        method: 'txt',
        ok: verified,
        host,
        expected: record.verifyToken,
        found: txt.values,
        error: txt.error,
        message: verified
          ? `Ownership proven: TXT ${host} contains the verify token.`
          : `Queried TXT ${host}: ${foundText}. Expected "${record.verifyToken}". DNS changes can take a few minutes to propagate.`,
      };
    }

    const routing = await this.checkRouting(target, ip);
    if (!routing.ok) warnings.push(routing.message);

    const check: DomainCheck = {
      checkedAt: new Date().toISOString(),
      ownership,
      routing,
      ...(autoRecord ? { autoRecord } : {}),
      ...(delegation ? { delegation } : {}),
      warnings,
    };

    const updated = await this.prisma.customDomain.update({
      where: { id: record.id },
      data: {
        ...data,
        lastCheck: check as unknown as object,
        ...(verified
          ? { status: 'verified', verifiedAt: record.verifiedAt ?? new Date() }
          : { status: 'failed' }),
      },
    });

    let message: string;
    if (verified) {
      const parts = [ownership.message];
      if (autoRecord) parts.push(autoRecord.message);
      parts.push('Redeploy the app for the domain to go live.');
      const rest = warnings.filter((w) => w !== autoRecord?.message);
      if (rest.length) parts.push(`Warning: ${rest.join(' ')}`);
      message = parts.join(' ');
    } else {
      message = `Verification failed. ${ownership.message}`;
    }

    this.statusCache.delete(record.id);
    return { verified, message, view: this.domainView(updated, appSubdomain, zone, ip) };
  }

  private async configureRoutingRecord(
    userId: string,
    record: CustomDomainRow,
    zoneName: string,
    target: RouteTarget,
  ): Promise<NonNullable<DomainCheck['autoRecord']>> {
    if (!target.value) {
      return {
        status: 'skipped',
        type: target.type,
        message: `No routing record was created: ${target.note ?? 'no target is configured.'}`,
      };
    }
    const desc = `${target.type} ${record.domain} -> ${target.value}`;
    try {
      const res = await this.dnsService.ensureRoutingRecord(
        userId,
        zoneName,
        record.domain,
        target.type,
        target.value,
      );
      if (res.status === 'created') {
        return { status: 'created', type: target.type, value: target.value, message: `Created DNS record ${desc} in ${zoneName}.` };
      }
      if (res.status === 'exists') {
        return { status: 'exists', type: target.type, value: target.value, message: `DNS record ${desc} already exists in ${zoneName}.` };
      }
      const existing = (res.existing ?? [])
        .map((e) => `${e.type} ${e.records.join(', ')}`)
        .join('; ');
      return {
        status: 'conflict',
        type: target.type,
        value: target.value,
        existing: res.existing,
        message: `Did not create ${desc}: ${record.domain} already has ${existing} in ${zoneName}. Replace it with ${target.type} ${target.value} on the DNS page if you want this app to serve the domain.`,
      };
    } catch (err) {
      return {
        status: 'error',
        type: target.type,
        value: target.value,
        message: `Could not create ${desc} in ${zoneName}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Does public DNS send the domain to the platform? (warning only) */
  private async checkRouting(target: RouteTarget, ip: string | null): Promise<DomainCheck['routing']> {
    const [a, cname] = await Promise.all([
      resolvePublic(ip && ip.includes(':') ? 'AAAA' : 'A', target.host),
      resolvePublic('CNAME', target.host),
    ]);
    const cnameOk =
      target.type === 'CNAME' && !!target.value && cname.values.some((v) => sameHost(v, target.value!));
    const ipOk = !!ip && a.values.includes(ip);
    const ok = cnameOk || ipOk;

    const found = [
      ...cname.values.map((v) => `CNAME ${v}`),
      ...a.values.map((v) => `${ip && ip.includes(':') ? 'AAAA' : 'A'} ${v}`),
    ];
    const foundText = found.length ? found.join(', ') : `nothing (${a.error ?? 'no records'})`;
    let message: string;
    if (ok) {
      message = `${target.host} points at the platform (${foundText}).`;
    } else if (!target.value) {
      message = `${target.host} currently resolves to ${foundText}. Can't confirm it points at this platform because the routing target isn't configured (see the routing record note).`;
    } else {
      message = `${target.host} currently resolves to ${foundText}; expected ${target.type} ${target.value}. Traffic won't reach this app until it does.`;
    }
    return {
      ok,
      host: target.host,
      expectedType: target.type,
      expectedValue: target.value,
      foundA: a.values,
      foundCname: cname.values,
      error: a.error && cname.error ? a.error : null,
      message,
    };
  }

  /** Is the hosted zone publicly delegated to the platform nameservers? */
  private async checkDelegation(zoneName: string): Promise<NonNullable<DomainCheck['delegation']>> {
    const expected = this.dnsService.platformNameservers();
    const ns = await resolvePublic('NS', zoneName);
    const ok = ns.values.some((v) => expected.some((e) => sameHost(v, e)));
    return {
      ok,
      zone: zoneName,
      expected,
      found: ns.values,
      message: ok
        ? `${zoneName} is delegated to the platform nameservers.`
        : `${zoneName} is hosted here, but public DNS says its nameservers are ${ns.values.length ? ns.values.join(', ') : `unknown (${ns.error})`}. Set the nameservers at your registrar to ${expected.join(', ')} so the records on this platform take effect.`,
    };
  }

  // The per-domain DNS instructions + state shown in the dashboard.
  private domainView(
    d: CustomDomainRow,
    appSubdomain: string,
    zone: { name: string } | null,
    serverIp: string | null,
  ) {
    const zoneName = d.dnsZoneName ?? zone?.name ?? null;
    const route = routeTarget(d.domain, appSubdomain, zoneName, serverIp);
    return {
      id: d.id,
      domain: d.domain,
      status: d.status,
      verifiedAt: d.verifiedAt,
      createdAt: d.createdAt,
      // "platform-dns": zone hosted here by this org (no TXT needed, record auto-created).
      ownershipMethod: zoneName ? ('platform-dns' as const) : ('txt' as const),
      hostedZone: zoneName,
      autoConfigured: !!d.dnsZoneName,
      autoRecord:
        d.autoRecordType && d.autoRecordValue
          ? {
              host: d.domain,
              type: d.autoRecordType,
              value: d.autoRecordValue,
              values: splitManagedValues(d.autoRecordValue),
            }
          : null,
      // The server's current public IP (admin Settings -> Networking / PUBLIC_IP).
      serverIp,
      lastCheck: (d.lastCheck ?? null) as DomainCheck | null,
      instructions: {
        // 1) prove ownership (not needed for platform-hosted zones), 2) point traffic at the platform
        txtRecord: { host: `_upande-challenge.${d.domain}`, type: 'TXT', value: d.verifyToken },
        routeRecord: {
          host: route.host,
          type: route.type,
          value: route.value,
          apex: route.apex,
          note: route.note ?? null,
        },
      },
    };
  }

  private async findAppForOrg(appId: string, organizationId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { project: { select: { organizationId: true } } },
    });

    if (!app) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    if (app.project.organizationId !== organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    return app;
  }

  private async stopContainer(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = docker.getContainer(`upande-${subdomain}`);
      // Remove (not just stop): the placeholder/app container has a
      // restart-policy and its name would otherwise collide if the subdomain
      // is later reused. force:true stops it first if running.
      await container.remove({ force: true });
    } catch {
      // Container may not exist — ignore
    }
  }

  // Remove a named Docker volume (best-effort). Used to clean up a Node-RED
  // app's data volume on deletion. The container must already be removed
  // (stopContainer above) or the volume is still in use and the remove no-ops.
  private async removeVolume(volumeName: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      await docker.getVolume(volumeName).remove({ force: true });
    } catch (err) {
      console.warn(
        `[apps] removing volume ${volumeName} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Remove every image built for an app (best-effort). Each deploy tags a fresh
  // image `upande-app-<subdomain>:<deploymentId>`, so without this they pile up
  // on disk forever. Called on delete after the container is removed.
  private async removeAppImages(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const repo = `upande-app-${subdomain}`;
      // Match by repo tag prefix — covers all per-deployment tags of this app.
      const images = await docker.listImages({
        filters: { reference: [`${repo}:*`] },
      });
      // Remove by TAG, not image id: identical builds (e.g. two apps of the
      // same repo) share one image id, and force-removing the id would also
      // delete the other app's images.
      for (const tag of images.flatMap((i) => i.RepoTags ?? [])) {
        if (!tag.startsWith(`${repo}:`)) continue;
        try {
          await docker.getImage(tag).remove({ force: true });
        } catch (err) {
          console.warn(
            `[apps] removing image ${tag} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[apps] listing images for ${subdomain} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Start a maintenance placeholder container for a freshly-created app so its
  // URL serves a "being set up" page until the first deploy. Mirrors the deploy
  // pipeline's container name (`upande-<subdomain>`) and Traefik label scheme so
  // the real deploy cleanly replaces it via stopContainerIfExists + recreate.
  // Best-effort: any failure is logged and swallowed — it must never block
  // app creation (e.g. when Docker isn't reachable in a given environment).
  private async startMaintenanceContainer(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const containerName = `upande-${subdomain}`;

      // If a container already exists for this subdomain, leave it alone.
      try {
        await docker.getContainer(containerName).inspect();
        return;
      } catch {
        // Not found — proceed to create the placeholder.
      }

      await this.ensureImage(docker, MAINTENANCE_IMAGE);

      // Maintenance nginx listens on 8080 (see MAINTENANCE_NGINX_CONF) to match
      // the port real app containers use, so the placeholder routes the same way.
      const labels: Record<string, string> = buildSubdomainRouterLabels(
        subdomain,
        8080,
      );

      const networkMode = process.env.DOCKER_NETWORK ?? 'upande_net';
      const container = await docker.createContainer({
        Image: MAINTENANCE_IMAGE,
        name: containerName,
        Labels: labels,
        Cmd: maintenanceContainerCmd(),
        HostConfig: {
          NetworkMode: networkMode,
          RestartPolicy: { Name: 'unless-stopped' },
        },
      });
      await container.start();
    } catch (err) {
      // Swallow — the catch-all fallback page still covers this app if the
      // placeholder can't be started.
      // eslint-disable-next-line no-console
      console.warn(
        `[apps] maintenance container for ${subdomain} not started:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Pull an image if it isn't present locally. dockerode's pull is stream-based,
  // so we wait for it to finish before creating the container.
  private async ensureImage(docker: Docker, image: string): Promise<void> {
    try {
      await docker.getImage(image).inspect();
      return; // already present
    } catch {
      // Not present — pull it.
    }
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }
}

// Normalize an uploaded relative path: forward slashes, no leading slash, and
// no ".." segments (so a malicious path can't escape the upload dir). Returns
// "" for paths that resolve to nothing usable.
function sanitizeRelPath(rel: string): string {
  const parts = rel
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..');
  return parts.join('/');
}

// If every uploaded path shares the same first segment (the picked folder's
// own name, which browsers prepend), return that prefix incl. trailing slash
// so callers can strip it. Returns "" when there is no single common top dir.
function stripCommonTopDir(relPaths: string[]): string {
  const tops = new Set<string>();
  for (const p of relPaths) {
    const top = p.replace(/\\/g, '/').split('/')[0];
    if (!top) return '';
    tops.add(top);
  }
  return tops.size === 1 ? `${[...tops][0]}/` : '';
}

// ---- Custom domain types ----

function describeRRSets(rrs: RoutingRRSet[]): string {
  return rrs.map((r) => `${r.type} ${r.records.join(', ')}`).join('; ');
}

// Live DNS status of a custom domain (GET /apps/:id/domains/:domainId/status).
export interface DomainStatus {
  domainId: string;
  domain: string;
  checkedAt: string;
  cached: boolean;
  // live: public DNS matches the platform record (hosted) / points at the platform (external)
  state: 'live' | 'not_delegated' | 'points_elsewhere' | 'not_resolving' | 'no_record' | 'error';
  message: string;
  // Public DNS sends the domain to this server / app host.
  pointsAtPlatform: boolean;
  // Hosted zones: what the routing RRset in PowerDNS currently is.
  targetMode: 'platform' | 'custom' | 'other' | 'none';
  serverIp: string | null;
  expected: { type: string; value: string | null; apex: boolean; note: string | null };
  public: { a: string[]; aaaa: string[]; cname: string[]; error: string | null };
  platform: {
    zone: string;
    rrsets: (RoutingRRSet & { managed: boolean })[];
    error: string | null;
  } | null;
  delegation: { ok: boolean; zone: string; expected: string[]; found: string[] } | null;
}

export type CustomDomainRow = {
  id: string;
  domain: string;
  status: string;
  verifyToken: string;
  verifiedAt: Date | null;
  createdAt: Date;
  dnsZoneName: string | null;
  autoRecordType: string | null;
  autoRecordValue: string | null;
  lastCheck: unknown;
};

// Persisted in CustomDomain.lastCheck and returned to the dashboard.
export interface DomainCheck {
  checkedAt: string;
  ownership: {
    method: 'platform-dns' | 'txt';
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
    status: 'created' | 'exists' | 'conflict' | 'skipped' | 'error';
    type?: string;
    value?: string;
    existing?: { type: string; records: string[] }[];
    message: string;
  };
  delegation?: {
    ok: boolean;
    zone: string;
    expected: string[];
    found: string[];
    message: string;
  };
  warnings: string[];
}
