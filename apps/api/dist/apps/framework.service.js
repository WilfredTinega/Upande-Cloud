"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameworkService = void 0;
const common_1 = require("@nestjs/common");
const child_process_1 = require("child_process");
const fs = require("fs");
const net = require("net");
const dns_1 = require("dns");
const os = require("os");
const path = require("path");
const simple_git_1 = require("simple-git");
const prisma_service_1 = require("../prisma/prisma.service");
const github_service_1 = require("../github/github.service");
const upload_path_util_1 = require("../common/upload-path.util");
const framework_detect_util_1 = require("../common/framework-detect.util");
const MAX_FILES = 20000;
const MAX_READ = 256 * 1024;
const BRANCH_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const GIT_SAFE = ['http.followRedirects=false'];
let FrameworkService = class FrameworkService {
    constructor(prisma, github) {
        this.prisma = prisma;
        this.github = github;
    }
    nixpacks() {
        try {
            (0, child_process_1.execSync)('which nixpacks', { stdio: 'ignore' });
            return true;
        }
        catch {
            return false;
        }
    }
    finish(d) {
        if (this.nixpacks())
            d.notes = d.notes.filter((n) => !n.startsWith('Runs a Node server'));
        return d;
    }
    async assertPublicRepoUrl(raw) {
        const url = (raw ?? '').trim();
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            parsed = null;
        }
        if (!parsed || !/^https?:$/.test(parsed.protocol)) {
            throw new common_1.BadRequestException({ code: 'BAD_REPO_URL', message: 'Repository URL must start with http(s)://' });
        }
        const host = parsed.hostname.replace(/^\[|\]$/g, '');
        const isPrivate = (ip) => net.isIPv4(ip)
            ? /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)
            : /^(::1?$|f[cd]|fe[89ab]|::ffff:(0|10|127|169\.254|192\.168)\.)/i.test(ip);
        let addrs;
        try {
            addrs = net.isIP(host) ? [host] : (await dns_1.promises.lookup(host, { all: true })).map((a) => a.address);
        }
        catch {
            throw new common_1.BadRequestException({ code: 'GIT_CLONE_FAILED', message: 'Could not resolve that repository host.' });
        }
        if (host.toLowerCase() === 'localhost' || addrs.some(isPrivate)) {
            throw new common_1.BadRequestException({ code: 'BAD_REPO_URL', message: 'That repository host is not allowed.' });
        }
        return url;
    }
    async detectFromUrl(userId, repoUrl, branch) {
        const url = await this.assertPublicRepoUrl(repoUrl);
        return { detection: await this.detectGit(userId, url, branch) };
    }
    async detectForApp(userId, organizationId, appId) {
        const app = await this.prisma.app.findUnique({
            where: { id: appId },
            include: { project: { select: { organizationId: true } } },
        });
        if (!app)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
        if (app.project.organizationId !== organizationId) {
            throw new common_1.ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
        }
        if (app.type === 'nodered') {
            throw new common_1.BadRequestException({ code: 'NO_SOURCE', message: 'Node-RED apps run the official image.' });
        }
        let detection;
        if (app.source === 'upload') {
            detection = this.detectDir((0, upload_path_util_1.appUploadDir)(app.id));
        }
        else if (app.repoUrl) {
            detection = await this.detectGit(userId, await this.assertPublicRepoUrl(app.repoUrl), app.branch ?? undefined);
        }
        else {
            throw new common_1.BadRequestException({ code: 'NO_SOURCE', message: 'This app has no source configured.' });
        }
        const warnings = [];
        if (detection.type !== 'static' && app.type === 'static') {
            warnings.push(`${detection.framework.name} runs a server, but the site type is Static.`);
        }
        if (detection.type === 'static' && app.type !== 'static' && !detection.hasDockerfile) {
            warnings.push(`${detection.framework.name} builds a static site, but the site type is ${app.type}.`);
        }
        if (detection.usesDatabase && app.type !== 'fullstack') {
            warnings.push('Uses a database — Full stack gets a managed Postgres.');
        }
        if (detection.outputDir && app.type === 'static' && (app.outputDir ?? 'dist') !== detection.outputDir) {
            warnings.push(`Output dir is ${app.outputDir ?? 'dist'}; ${detection.framework.name} writes to ${detection.outputDir}.`);
        }
        return {
            detection,
            current: { type: app.type, buildCmd: app.buildCmd, outputDir: app.outputDir },
            warnings,
        };
    }
    async detectGit(userId, repoUrl, branch) {
        if (branch && !BRANCH_RE.test(branch)) {
            throw new common_1.BadRequestException({ code: 'BAD_BRANCH', message: 'That is not a valid branch name.' });
        }
        let cloneUrl = repoUrl;
        if (/^https:\/\/github\.com\//i.test(repoUrl)) {
            const token = await this.github.getTokenIfConnected(userId);
            if (token)
                cloneUrl = repoUrl.replace(/^https:\/\//i, `https://x-access-token:${token}@`);
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upande-detect-'));
        try {
            const args = ['--depth', '1', '--filter=blob:none', '--no-checkout', '--single-branch'];
            if (branch)
                args.push('--branch', branch);
            try {
                await (0, simple_git_1.default)({ timeout: { block: 60000 }, config: GIT_SAFE }).clone(cloneUrl, dir, args);
            }
            catch {
                throw new common_1.BadRequestException({
                    code: 'GIT_CLONE_FAILED',
                    message: 'Could not read that repository. Check the URL, branch and access.',
                });
            }
            const git = (0, simple_git_1.default)({ baseDir: dir, timeout: { block: 60000 }, config: GIT_SAFE });
            const tree = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
            const files = tree.split('\n').filter(Boolean).slice(0, MAX_FILES);
            const cache = new Map();
            const wanted = files.filter((f) => /^(package\.json|angular\.json|\.nvmrc|(next|nuxt|astro|svelte|vite)\.config\.[cm]?[jt]s)$/.test(f));
            for (const f of wanted) {
                try {
                    const out = await git.raw(['show', `HEAD:${f}`]);
                    cache.set(f, out.length > MAX_READ ? out.slice(0, MAX_READ) : out);
                }
                catch {
                    cache.set(f, null);
                }
            }
            return this.finish((0, framework_detect_util_1.detectFramework)(files, (p) => cache.get(p) ?? null));
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    detectDir(root) {
        if (!fs.existsSync(root)) {
            throw new common_1.BadRequestException({ code: 'NO_UPLOAD', message: 'No uploaded files yet. Upload your folder first.' });
        }
        const files = [];
        const walk = (rel) => {
            if (files.length >= MAX_FILES)
                return;
            for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
                if (e.name === 'node_modules' || e.name === '.git')
                    continue;
                const p = rel ? `${rel}/${e.name}` : e.name;
                if (e.isDirectory())
                    walk(p);
                else if (e.isFile())
                    files.push(p);
            }
        };
        walk('');
        const read = (p) => {
            try {
                const full = path.join(root, p);
                if (fs.statSync(full).size > MAX_READ)
                    return null;
                return fs.readFileSync(full, 'utf8');
            }
            catch {
                return null;
            }
        };
        return this.finish((0, framework_detect_util_1.detectFramework)(files, read));
    }
};
exports.FrameworkService = FrameworkService;
exports.FrameworkService = FrameworkService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => github_service_1.GithubService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        github_service_1.GithubService])
], FrameworkService);
//# sourceMappingURL=framework.service.js.map