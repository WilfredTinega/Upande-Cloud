"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var BuildCacheService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildCacheService = void 0;
const common_1 = require("@nestjs/common");
const child_process_1 = require("child_process");
const Docker = require("dockerode");
const build_cache_util_1 = require("./build-cache.util");
let BuildCacheService = BuildCacheService_1 = class BuildCacheService {
    constructor() {
        this.logger = new common_1.Logger(BuildCacheService_1.name);
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
        this.buildkitCache = null;
    }
    async buildkitAvailable() {
        if (process.env.DOCKER_BUILDKIT === '0')
            return false;
        if (this.buildkitCache && Date.now() - this.buildkitCache.at < 5 * 60_000) {
            return this.buildkitCache.value;
        }
        const value = await new Promise((resolve) => {
            (0, child_process_1.execFile)('docker', ['buildx', 'version'], { timeout: 10_000 }, (err) => resolve(!err));
        });
        this.buildkitCache = { value, at: Date.now() };
        return value;
    }
    async buildkitRecords() {
        return new Promise((resolve) => {
            this.docker.modem.dial({
                path: '/system/df?',
                method: 'GET',
                options: { type: ['build-cache'] },
                statusCodes: { 200: true },
            }, (err, result) => {
                const data = result;
                if (err) {
                    this.logger.debug(`build-cache df failed: ${String(err)}`);
                    resolve([]);
                }
                else
                    resolve(data?.BuildCache ?? []);
            });
        });
    }
    static mountScopeOf(r) {
        if (r.Type !== 'exec.cachemount')
            return null;
        const m = r.Description.match(/with id "\/?(ubc-[A-Za-z0-9]+)-[a-z]+"/);
        return m ? m[1] : null;
    }
    async pruneBuildkitIds(ids) {
        let reclaimed = 0;
        for (const id of ids) {
            try {
                const res = await this.docker.pruneBuilder({ filters: JSON.stringify({ id: [id] }) });
                reclaimed += res?.SpaceReclaimed ?? 0;
            }
            catch (err) {
                this.logger.debug(`prune build cache ${id} failed: ${String(err)}`);
            }
        }
        return reclaimed;
    }
    async labelledImages(scope) {
        try {
            return await this.docker.listImages({
                all: true,
                filters: { label: [scope ? `${build_cache_util_1.BUILD_CACHE_LABEL}=${scope}` : build_cache_util_1.BUILD_CACHE_LABEL] },
            });
        }
        catch (err) {
            this.logger.debug(`list cache images failed: ${String(err)}`);
            return [];
        }
    }
    async layerBytes(images) {
        const ids = new Set(images.map((i) => i.Id));
        const parents = new Set(images.map((i) => i.ParentId).filter(Boolean));
        const sizes = new Map();
        for (const leaf of images.filter((i) => !parents.has(i.Id))) {
            try {
                const history = (await this.docker.getImage(leaf.Id).history());
                for (const h of history)
                    if (ids.has(h.Id))
                        sizes.set(h.Id, h.Size);
            }
            catch {
            }
        }
        return [...sizes.values()].reduce((a, b) => a + b, 0);
    }
    async removeImages(images) {
        let removed = 0;
        let pending = images.map((i) => i.Id);
        for (let pass = 0; pass < 20 && pending.length > 0; pass++) {
            const left = [];
            for (const id of pending) {
                try {
                    await this.docker.getImage(id).remove({ force: false, noprune: false });
                    removed += 1;
                }
                catch (err) {
                    const code = err.statusCode;
                    if (code !== 404)
                        left.push(id);
                }
            }
            if (left.length === pending.length)
                break;
            pending = left;
        }
        return removed;
    }
    async usageForApp(appId) {
        const scope = (0, build_cache_util_1.buildCacheScope)(appId);
        const [buildkit, images, records] = await Promise.all([
            this.buildkitAvailable(),
            this.labelledImages(scope),
            this.buildkitRecords(),
        ]);
        const mounts = records.filter((r) => BuildCacheService_1.mountScopeOf(r) === scope);
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
    async clearForApp(appId) {
        const scope = (0, build_cache_util_1.buildCacheScope)(appId);
        try {
            const before = await this.usageForApp(appId);
            const images = await this.labelledImages(scope);
            const removedImages = await this.removeImages(images);
            const mountIds = (await this.buildkitRecords())
                .filter((r) => BuildCacheService_1.mountScopeOf(r) === scope && !r.InUse)
                .map((r) => r.ID);
            await this.pruneBuildkitIds(mountIds);
            const after = await this.usageForApp(appId);
            const reclaimedBytes = Math.max(0, before.totalBytes - after.totalBytes);
            this.logger.log(`Cleared build cache ${scope}: ${removedImages} layer image(s), ${mountIds.length} cache mount(s), ${(0, build_cache_util_1.formatBytes)(reclaimedBytes)}`);
            return { removedEntries: removedImages + mountIds.length, reclaimedBytes };
        }
        catch (err) {
            this.logger.warn(`Clearing build cache ${scope} failed: ${String(err)}`);
            return { removedEntries: 0, reclaimedBytes: 0 };
        }
    }
    async enforceLimits() {
        const maxAgeMs = (0, build_cache_util_1.buildCacheMaxAgeDays)() * 86_400_000;
        const cap = (0, build_cache_util_1.buildCacheMaxBytes)();
        const now = Date.now();
        let removed = 0;
        const images = await this.labelledImages();
        const parents = new Set(images.map((i) => i.ParentId).filter(Boolean));
        const leaves = images.filter((i) => !parents.has(i.Id)).sort((a, b) => a.Created - b.Created);
        const oldLeaves = leaves.filter((i) => now - i.Created * 1000 > maxAgeMs);
        removed += await this.removeImages(oldLeaves);
        const records = await this.buildkitRecords();
        const lastUsed = (r) => Date.parse(r.LastUsedAt || r.CreatedAt || '') || 0;
        const ours = records.filter((r) => BuildCacheService_1.mountScopeOf(r) && !r.InUse);
        const oldMounts = ours.filter((r) => now - lastUsed(r) > maxAgeMs).map((r) => r.ID);
        await this.pruneBuildkitIds(oldMounts);
        removed += oldMounts.length;
        let remainingImages = await this.labelledImages();
        let remainingMounts = ours.filter((r) => !oldMounts.includes(r.ID)).sort((a, b) => lastUsed(a) - lastUsed(b));
        let total = (await this.layerBytes(remainingImages)) + remainingMounts.reduce((a, r) => a + r.Size, 0);
        for (let i = 0; i < 200 && total > cap; i++) {
            const p = new Set(remainingImages.map((x) => x.ParentId).filter(Boolean));
            const leaf = remainingImages.filter((x) => !p.has(x.Id)).sort((a, b) => a.Created - b.Created)[0];
            const mount = remainingMounts[0];
            if (!leaf && !mount)
                break;
            if (mount && (!leaf || lastUsed(mount) < leaf.Created * 1000)) {
                await this.pruneBuildkitIds([mount.ID]);
                remainingMounts = remainingMounts.slice(1);
            }
            else if (leaf) {
                if ((await this.removeImages([leaf])) === 0) {
                    remainingImages = remainingImages.filter((x) => x.Id !== leaf.Id);
                    continue;
                }
            }
            removed += 1;
            remainingImages = await this.labelledImages();
            total = (await this.layerBytes(remainingImages)) + remainingMounts.reduce((a, r) => a + r.Size, 0);
        }
        const bkTotal = (await this.buildkitRecords()).reduce((a, r) => a + (r.Shared ? 0 : r.Size || 0), 0);
        if (bkTotal > cap) {
            try {
                await this.docker.pruneBuilder({
                    'keep-storage': Math.floor(cap),
                    'max-used-space': Math.floor(cap),
                });
            }
            catch (err) {
                this.logger.debug(`builder prune to cap failed: ${String(err)}`);
            }
        }
        if (removed > 0) {
            this.logger.log(`Build cache housekeeping removed ${removed} entr${removed === 1 ? 'y' : 'ies'}; platform cache now ${(0, build_cache_util_1.formatBytes)(total)}`);
        }
        return { removed, totalBytes: total };
    }
};
exports.BuildCacheService = BuildCacheService;
exports.BuildCacheService = BuildCacheService = BuildCacheService_1 = __decorate([
    (0, common_1.Injectable)()
], BuildCacheService);
//# sourceMappingURL=build-cache.service.js.map