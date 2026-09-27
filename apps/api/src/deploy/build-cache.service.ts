import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import * as Docker from 'dockerode';
import {
  BUILD_CACHE_LABEL,
  buildCacheMaxAgeDays,
  buildCacheMaxBytes,
  buildCacheScope,
  formatBytes,
} from './build-cache.util';

interface BuildKitRecord {
  ID: string;
  Type: string;
  Description: string;
  Size: number;
  InUse: boolean;
  Shared: boolean;
  LastUsedAt?: string | null;
  CreatedAt?: string;
}

export interface AppBuildCacheUsage {
  scope: string;
  buildkit: boolean;
  layerBytes: number; // legacy-builder intermediate layers of this app
  mountBytes: number; // BuildKit cache mounts (package manager / framework caches)
  totalBytes: number;
  entries: number;
}

// Owns the per-app build cache on the Docker daemon:
//  - legacy builder: intermediate images labelled upande.build-cache=<scope>
//    (the generated Dockerfile's builder stage carries the label);
//  - BuildKit: cache mounts whose id starts with the app scope.
// Everything here is best-effort — cache housekeeping must never fail a deploy
// or an app deletion.
@Injectable()
export class BuildCacheService {
  private readonly logger = new Logger(BuildCacheService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });
  private buildkitCache: { value: boolean; at: number } | null = null;

  // BuildKit is used when the docker CLI has the buildx plugin (the default
  // builder since Docker 23) and it is not explicitly disabled.
  async buildkitAvailable(): Promise<boolean> {
    if (process.env.DOCKER_BUILDKIT === '0') return false;
    if (this.buildkitCache && Date.now() - this.buildkitCache.at < 5 * 60_000) {
      return this.buildkitCache.value;
    }
    const value = await new Promise<boolean>((resolve) => {
      execFile('docker', ['buildx', 'version'], { timeout: 10_000 }, (err) => resolve(!err));
    });
    this.buildkitCache = { value, at: Date.now() };
    return value;
  }

  private async buildkitRecords(): Promise<BuildKitRecord[]> {
    return new Promise((resolve) => {
      this.docker.modem.dial(
        {
          path: '/system/df?',
          method: 'GET',
          options: { type: ['build-cache'] },
          statusCodes: { 200: true },
        },
        (err: unknown, result: unknown) => {
          const data = result as { BuildCache?: BuildKitRecord[] } | null;
          if (err) {
            this.logger.debug(`build-cache df failed: ${String(err)}`);
            resolve([]);
          } else resolve(data?.BuildCache ?? []);
        },
      );
    });
  }

  private static mountScopeOf(r: BuildKitRecord): string | null {
    if (r.Type !== 'exec.cachemount') return null;
    const m = r.Description.match(/with id "\/?(ubc-[A-Za-z0-9]+)-[a-z]+"/);
    return m ? m[1] : null;
  }

  private async pruneBuildkitIds(ids: string[]): Promise<number> {
    let reclaimed = 0;
    for (const id of ids) {
      try {
        const res: unknown = await this.docker.pruneBuilder({ filters: JSON.stringify({ id: [id] }) } as never);
        reclaimed += (res as { SpaceReclaimed?: number })?.SpaceReclaimed ?? 0;
      } catch (err) {
        this.logger.debug(`prune build cache ${id} failed: ${String(err)}`);
      }
    }
    return reclaimed;
  }

  private async labelledImages(scope?: string): Promise<Docker.ImageInfo[]> {
    try {
      return await this.docker.listImages({
        all: true,
        filters: { label: [scope ? `${BUILD_CACHE_LABEL}=${scope}` : BUILD_CACHE_LABEL] },
      });
    } catch (err) {
      this.logger.debug(`list cache images failed: ${String(err)}`);
      return [];
    }
  }

  // Unique on-disk bytes of a set of labelled intermediate images: the size of
  // each layer those images add (from the leaves' history), counted once.
  private async layerBytes(images: Docker.ImageInfo[]): Promise<number> {
    const ids = new Set(images.map((i) => i.Id));
    const parents = new Set(images.map((i) => i.ParentId).filter(Boolean));
    const sizes = new Map<string, number>();
    for (const leaf of images.filter((i) => !parents.has(i.Id))) {
      try {
        const history = (await this.docker.getImage(leaf.Id).history()) as Array<{ Id: string; Size: number }>;
        for (const h of history) if (ids.has(h.Id)) sizes.set(h.Id, h.Size);
      } catch {
        /* image vanished */
      }
    }
    return [...sizes.values()].reduce((a, b) => a + b, 0);
  }

  // Remove labelled images leaf-first (a removed untagged leaf takes its
  // unused untagged parents with it). Never forces: an image still used by a
  // tagged image or a container is left alone.
  private async removeImages(images: Docker.ImageInfo[]): Promise<number> {
    let removed = 0;
    let pending = images.map((i) => i.Id);
    for (let pass = 0; pass < 20 && pending.length > 0; pass++) {
      const left: string[] = [];
      for (const id of pending) {
        try {
          await this.docker.getImage(id).remove({ force: false, noprune: false });
          removed += 1;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code !== 404) left.push(id);
        }
      }
      if (left.length === pending.length) break; // no progress
      pending = left;
    }
    return removed;
  }

  async usageForApp(appId: string): Promise<AppBuildCacheUsage> {
    const scope = buildCacheScope(appId);
    const [buildkit, images, records] = await Promise.all([
      this.buildkitAvailable(),
      this.labelledImages(scope),
      this.buildkitRecords(),
    ]);
    const mounts = records.filter((r) => BuildCacheService.mountScopeOf(r) === scope);
    const layerBytes = await this.layerBytes(images);
    const mountBytes = mounts.reduce((a, r) => a + (r.Size || 0), 0);
    return {
      scope,
      buildkit,
      layerBytes,
      mountBytes,
      totalBytes: layerBytes + mountBytes,
      entries: images.length + mounts.length,
    };
  }

  // Drop everything cached for one app (clear-cache redeploy, app deletion).
  async clearForApp(appId: string): Promise<{ removedEntries: number; reclaimedBytes: number }> {
    const scope = buildCacheScope(appId);
    try {
      const before = await this.usageForApp(appId);
      const images = await this.labelledImages(scope);
      const removedImages = await this.removeImages(images);
      const mountIds = (await this.buildkitRecords())
        .filter((r) => BuildCacheService.mountScopeOf(r) === scope && !r.InUse)
        .map((r) => r.ID);
      await this.pruneBuildkitIds(mountIds);
      const after = await this.usageForApp(appId);
      const reclaimedBytes = Math.max(0, before.totalBytes - after.totalBytes);
      this.logger.log(
        `Cleared build cache ${scope}: ${removedImages} layer image(s), ${mountIds.length} cache mount(s), ${formatBytes(reclaimedBytes)}`,
      );
      return { removedEntries: removedImages + mountIds.length, reclaimedBytes };
    } catch (err) {
      this.logger.warn(`Clearing build cache ${scope} failed: ${String(err)}`);
      return { removedEntries: 0, reclaimedBytes: 0 };
    }
  }

  // Periodic housekeeping (BuildCacheProcessor):
  //  1. age: platform cache entries unused for BUILD_CACHE_MAX_AGE_DAYS go;
  //  2. size: while the platform's cache exceeds BUILD_CACHE_MAX_GB, the
  //     least-recently-used entries go; if the daemon's whole BuildKit cache is
  //     above the cap it is pruned down to it (max-used-space).
  // Only platform-labelled images / ubc-* cache mounts are touched by 1 and
  // the per-entry part of 2.
  async enforceLimits(): Promise<{ removed: number; totalBytes: number }> {
    const maxAgeMs = buildCacheMaxAgeDays() * 86_400_000;
    const cap = buildCacheMaxBytes();
    const now = Date.now();
    let removed = 0;

    // 1. Age
    const images = await this.labelledImages();
    const parents = new Set(images.map((i) => i.ParentId).filter(Boolean));
    const leaves = images.filter((i) => !parents.has(i.Id)).sort((a, b) => a.Created - b.Created);
    const oldLeaves = leaves.filter((i) => now - i.Created * 1000 > maxAgeMs);
    removed += await this.removeImages(oldLeaves);

    const records = await this.buildkitRecords();
    const lastUsed = (r: BuildKitRecord) => Date.parse(r.LastUsedAt || r.CreatedAt || '') || 0;
    const ours = records.filter((r) => BuildCacheService.mountScopeOf(r) && !r.InUse);
    const oldMounts = ours.filter((r) => now - lastUsed(r) > maxAgeMs).map((r) => r.ID);
    await this.pruneBuildkitIds(oldMounts);
    removed += oldMounts.length;

    // 2. Size cap (platform entries, least recently used first)
    let remainingImages = await this.labelledImages();
    let remainingMounts = ours.filter((r) => !oldMounts.includes(r.ID)).sort((a, b) => lastUsed(a) - lastUsed(b));
    let total = (await this.layerBytes(remainingImages)) + remainingMounts.reduce((a, r) => a + r.Size, 0);
    for (let i = 0; i < 200 && total > cap; i++) {
      const p = new Set(remainingImages.map((x) => x.ParentId).filter(Boolean));
      const leaf = remainingImages.filter((x) => !p.has(x.Id)).sort((a, b) => a.Created - b.Created)[0];
      const mount = remainingMounts[0];
      if (!leaf && !mount) break;
      if (mount && (!leaf || lastUsed(mount) < leaf.Created * 1000)) {
        await this.pruneBuildkitIds([mount.ID]);
        remainingMounts = remainingMounts.slice(1);
      } else if (leaf) {
        if ((await this.removeImages([leaf])) === 0) {
          remainingImages = remainingImages.filter((x) => x.Id !== leaf.Id);
          continue;
        }
      }
      removed += 1;
      remainingImages = await this.labelledImages();
      total = (await this.layerBytes(remainingImages)) + remainingMounts.reduce((a, r) => a + r.Size, 0);
    }

    // Whole-daemon BuildKit cache above the cap: let BuildKit trim LRU records.
    const bkTotal = (await this.buildkitRecords()).reduce((a, r) => a + (r.Shared ? 0 : r.Size || 0), 0);
    if (bkTotal > cap) {
      try {
        await this.docker.pruneBuilder({
          'keep-storage': Math.floor(cap),
          'max-used-space': Math.floor(cap),
        } as never);
      } catch (err) {
        this.logger.debug(`builder prune to cap failed: ${String(err)}`);
      }
    }

    if (removed > 0) {
      this.logger.log(`Build cache housekeeping removed ${removed} entr${removed === 1 ? 'y' : 'ies'}; platform cache now ${formatBytes(total)}`);
    }
    return { removed, totalBytes: total };
  }
}
