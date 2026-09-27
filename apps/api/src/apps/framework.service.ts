import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import { promises as dns } from 'dns';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { PrismaService } from '../prisma/prisma.service';
import { GithubService } from '../github/github.service';
import { appUploadDir } from '../common/upload-path.util';
import { detectFramework, FrameworkDetection } from '../common/framework-detect.util';

// Framework detection before a deploy. Reads only the repository tree and a
// few small files: a blobless, no-checkout shallow clone (git) or the upload
// dir. Nothing is built or run.

const MAX_FILES = 20000;
const MAX_READ = 256 * 1024;
const BRANCH_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
// No redirects (to internal hosts). Local-file URLs never get here (http(s) only).
const GIT_SAFE = ['http.followRedirects=false'];

@Injectable()
export class FrameworkService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => GithubService))
    private readonly github: GithubService,
  ) {}

  private nixpacks(): boolean {
    try {
      execSync('which nixpacks', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private finish(d: FrameworkDetection): FrameworkDetection {
    // With nixpacks installed a Node server is built & run without a Dockerfile.
    if (this.nixpacks()) d.notes = d.notes.filter((n) => !n.startsWith('Runs a Node server'));
    return d;
  }

  // Only public http(s) repositories: no file:// / local paths (server files)
  // and no loopback / private / link-local hosts (SSRF).
  private async assertPublicRepoUrl(raw: string): Promise<string> {
    const url = (raw ?? '').trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null as unknown as URL;
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      throw new BadRequestException({ code: 'BAD_REPO_URL', message: 'Repository URL must start with http(s)://' });
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const isPrivate = (ip: string) =>
      net.isIPv4(ip)
        ? /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)
        : /^(::1?$|f[cd]|fe[89ab]|::ffff:(0|10|127|169\.254|192\.168)\.)/i.test(ip);
    let addrs: string[];
    try {
      addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new BadRequestException({ code: 'GIT_CLONE_FAILED', message: 'Could not resolve that repository host.' });
    }
    if (host.toLowerCase() === 'localhost' || addrs.some(isPrivate)) {
      throw new BadRequestException({ code: 'BAD_REPO_URL', message: 'That repository host is not allowed.' });
    }
    return url;
  }

  // Repository URL typed / picked in the New App form.
  async detectFromUrl(userId: string, repoUrl: string, branch?: string) {
    const url = await this.assertPublicRepoUrl(repoUrl);
    return { detection: await this.detectGit(userId, url, branch) };
  }

  // An existing app (git or upload), compared with its current settings.
  async detectForApp(userId: string, organizationId: string, appId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { project: { select: { organizationId: true } } },
    });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    if (app.project.organizationId !== organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    if (app.type === 'nodered') {
      throw new BadRequestException({ code: 'NO_SOURCE', message: 'Node-RED apps run the official image.' });
    }
    let detection: FrameworkDetection;
    if (app.source === 'upload') {
      detection = this.detectDir(appUploadDir(app.id));
    } else if (app.repoUrl) {
      detection = await this.detectGit(userId, await this.assertPublicRepoUrl(app.repoUrl), app.branch ?? undefined);
    } else {
      throw new BadRequestException({ code: 'NO_SOURCE', message: 'This app has no source configured.' });
    }
    const warnings: string[] = [];
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

  private async detectGit(userId: string, repoUrl: string, branch?: string): Promise<FrameworkDetection> {
    if (branch && !BRANCH_RE.test(branch)) {
      throw new BadRequestException({ code: 'BAD_BRANCH', message: 'That is not a valid branch name.' });
    }
    let cloneUrl = repoUrl;
    if (/^https:\/\/github\.com\//i.test(repoUrl)) {
      const token = await this.github.getTokenIfConnected(userId);
      if (token) cloneUrl = repoUrl.replace(/^https:\/\//i, `https://x-access-token:${token}@`);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upande-detect-'));
    try {
      const args = ['--depth', '1', '--filter=blob:none', '--no-checkout', '--single-branch'];
      if (branch) args.push('--branch', branch);
      try {
        await simpleGit({ timeout: { block: 60000 }, config: GIT_SAFE }).clone(cloneUrl, dir, args);
      } catch {
        // Never echo the (possibly token-bearing) URL.
        throw new BadRequestException({
          code: 'GIT_CLONE_FAILED',
          message: 'Could not read that repository. Check the URL, branch and access.',
        });
      }
      const git = simpleGit({ baseDir: dir, timeout: { block: 60000 }, config: GIT_SAFE });
      const tree = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
      const files = tree.split('\n').filter(Boolean).slice(0, MAX_FILES);
      const cache = new Map<string, string | null>();
      // Blobs are fetched lazily, so only the few files the detector asks for
      // are downloaded. Reads are synchronous for the pure detector; prefetch.
      const wanted = files.filter((f) =>
        /^(package\.json|angular\.json|\.nvmrc|(next|nuxt|astro|svelte|vite)\.config\.[cm]?[jt]s)$/.test(f),
      );
      for (const f of wanted) {
        try {
          const out = await git.raw(['show', `HEAD:${f}`]);
          cache.set(f, out.length > MAX_READ ? out.slice(0, MAX_READ) : out);
        } catch {
          cache.set(f, null);
        }
      }
      return this.finish(detectFramework(files, (p) => cache.get(p) ?? null));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private detectDir(root: string): FrameworkDetection {
    if (!fs.existsSync(root)) {
      throw new BadRequestException({ code: 'NO_UPLOAD', message: 'No uploaded files yet. Upload your folder first.' });
    }
    const files: string[] = [];
    const walk = (rel: string) => {
      if (files.length >= MAX_FILES) return;
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) files.push(p);
      }
    };
    walk('');
    const read = (p: string) => {
      try {
        const full = path.join(root, p);
        if (fs.statSync(full).size > MAX_READ) return null;
        return fs.readFileSync(full, 'utf8');
      } catch {
        return null;
      }
    };
    return this.finish(detectFramework(files, read));
  }
}
