"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFramework = detectFramework;
const DB_DEPS = [
    'prisma', '@prisma/client', 'pg', 'postgres', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3',
    'mongoose', 'mongodb', 'typeorm', 'sequelize', 'drizzle-orm', 'knex', '@mikro-orm/core',
];
const SERVER_DEPS = [
    ['@nestjs/core', 'NestJS'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['koa', 'Koa'],
    ['hono', 'Hono'],
    ['@hapi/hapi', 'hapi'],
];
function runCmd(pm, script) {
    if (pm === 'yarn')
        return `yarn ${script}`;
    if (pm === 'pnpm')
        return `pnpm run ${script}`;
    if (pm === 'bun')
        return `bun run ${script}`;
    return `npm run ${script}`;
}
function detectFramework(files, read) {
    const set = new Set(files);
    const has = (p) => set.has(p);
    const hasAny = (...ps) => ps.some(has);
    const configOf = (base) => ['js', 'mjs', 'cjs', 'ts', 'mts'].map((e) => `${base}.${e}`).find(has) ?? null;
    const notes = [];
    const hasDockerfile = has('Dockerfile');
    const base = (over) => ({
        buildCmd: null,
        outputDir: null,
        startCmd: null,
        packageManager: null,
        nodeVersion: null,
        buildTimeEnvPrefix: null,
        hasDockerfile,
        usesDatabase: false,
        notes,
        ...over,
    });
    let pkg = null;
    if (has('package.json')) {
        try {
            pkg = JSON.parse(read('package.json') ?? '');
        }
        catch {
            notes.push('package.json could not be parsed.');
        }
    }
    if (!pkg) {
        if (has('package.json')) {
            return base({ framework: { id: 'unknown', name: 'Unknown' }, type: 'static' });
        }
        const nested = files.find((f) => /^[^/]+\/package\.json$/.test(f));
        if (nested)
            notes.push(`No package.json at the root — found ${nested}. Monorepo subfolders aren't built.`);
        if (hasDockerfile)
            return base({ framework: { id: 'docker', name: 'Dockerfile' }, type: 'node' });
        if (hasAny('requirements.txt', 'pyproject.toml', 'Pipfile')) {
            notes.push('Python apps need a Dockerfile in the repository.');
            return base({ framework: { id: 'python', name: 'Python' }, type: 'node' });
        }
        if (has('go.mod')) {
            notes.push('Go apps need a Dockerfile in the repository.');
            return base({ framework: { id: 'go', name: 'Go' }, type: 'node' });
        }
        if (has('index.html') || files.some((f) => f.endsWith('.html'))) {
            if (!has('index.html'))
                notes.push('No index.html at the root.');
            return base({ framework: { id: 'html', name: 'Static HTML' }, type: 'static' });
        }
        notes.push('No package.json, Dockerfile or index.html found.');
        return base({ framework: { id: 'unknown', name: 'Unknown' }, type: 'static' });
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const dep = (n) => n in deps;
    const scripts = pkg.scripts ?? {};
    const pmField = (pkg.packageManager ?? '').split('@')[0];
    const packageManager = has('pnpm-lock.yaml') || pmField === 'pnpm'
        ? 'pnpm'
        : has('yarn.lock') || pmField === 'yarn'
            ? 'yarn'
            : has('bun.lockb') || has('bun.lock') || pmField === 'bun'
                ? 'bun'
                : 'npm';
    const nodeVersion = pkg.engines?.node ?? (has('.nvmrc') ? (read('.nvmrc') ?? '').trim() || null : null);
    const usesDatabase = DB_DEPS.some(dep) || has('prisma/schema.prisma');
    const build = scripts.build ? runCmd(packageManager, 'build') : null;
    const start = scripts.start ? runCmd(packageManager, 'start') : null;
    const common = { packageManager, nodeVersion, usesDatabase };
    const serverType = usesDatabase ? 'fullstack' : 'node';
    const needsServer = () => {
        if (!hasDockerfile)
            notes.push('Runs a Node server — add a Dockerfile (or install nixpacks) so it is not served as static files.');
    };
    const cfg = (b) => {
        const f = configOf(b);
        return f ? (read(f) ?? '') : '';
    };
    if (dep('next')) {
        const staticExport = /output\s*:\s*['"]export['"]/.test(cfg('next.config'));
        if (staticExport) {
            return base({
                framework: { id: 'nextjs', name: 'Next.js (static export)' },
                type: 'static', buildCmd: build, outputDir: 'out', buildTimeEnvPrefix: 'NEXT_PUBLIC_', ...common,
            });
        }
        needsServer();
        return base({
            framework: { id: 'nextjs', name: 'Next.js' },
            type: serverType, buildCmd: build, startCmd: start, buildTimeEnvPrefix: 'NEXT_PUBLIC_', ...common,
        });
    }
    if (dep('nuxt') || dep('nuxt3')) {
        if (/ssr\s*:\s*false/.test(cfg('nuxt.config')) || /nuxi?\s+generate/.test(scripts.build ?? '')) {
            return base({
                framework: { id: 'nuxt', name: 'Nuxt (static)' },
                type: 'static', buildCmd: scripts.generate ? runCmd(packageManager, 'generate') : build, outputDir: '.output/public',
                buildTimeEnvPrefix: 'NUXT_PUBLIC_', ...common,
            });
        }
        needsServer();
        return base({
            framework: { id: 'nuxt', name: 'Nuxt' },
            type: serverType, buildCmd: build, startCmd: start ?? 'node .output/server/index.mjs',
            buildTimeEnvPrefix: 'NUXT_PUBLIC_', ...common,
        });
    }
    if (Object.keys(deps).some((d) => d.startsWith('@remix-run/'))) {
        needsServer();
        return base({ framework: { id: 'remix', name: 'Remix' }, type: serverType, buildCmd: build, startCmd: start, ...common });
    }
    if (dep('@sveltejs/kit')) {
        if (dep('@sveltejs/adapter-static')) {
            return base({
                framework: { id: 'sveltekit', name: 'SvelteKit (static)' },
                type: 'static', buildCmd: build, outputDir: 'build', buildTimeEnvPrefix: 'PUBLIC_', ...common,
            });
        }
        needsServer();
        return base({
            framework: { id: 'sveltekit', name: 'SvelteKit' },
            type: serverType, buildCmd: build, startCmd: start ?? 'node build', buildTimeEnvPrefix: 'PUBLIC_', ...common,
        });
    }
    if (dep('astro')) {
        if (dep('@astrojs/node') || /output\s*:\s*['"](server|hybrid)['"]/.test(cfg('astro.config'))) {
            needsServer();
            return base({
                framework: { id: 'astro', name: 'Astro (server)' },
                type: serverType, buildCmd: build, startCmd: start ?? 'node ./dist/server/entry.mjs', buildTimeEnvPrefix: 'PUBLIC_', ...common,
            });
        }
        return base({
            framework: { id: 'astro', name: 'Astro' },
            type: 'static', buildCmd: build, outputDir: 'dist', buildTimeEnvPrefix: 'PUBLIC_', ...common,
        });
    }
    if (dep('gatsby')) {
        return base({
            framework: { id: 'gatsby', name: 'Gatsby' },
            type: 'static', buildCmd: build, outputDir: 'public', buildTimeEnvPrefix: 'GATSBY_', ...common,
        });
    }
    if (dep('@docusaurus/core')) {
        return base({ framework: { id: 'docusaurus', name: 'Docusaurus' }, type: 'static', buildCmd: build, outputDir: 'build', ...common });
    }
    if (dep('@angular/core')) {
        let outputDir = 'dist';
        try {
            const ng = JSON.parse(read('angular.json') ?? '{}');
            const [name, proj] = Object.entries(ng.projects ?? {})[0] ?? [];
            const op = proj?.architect?.build?.options?.outputPath;
            const baseDir = typeof op === 'string' ? op : op?.base ?? (name ? `dist/${name}` : 'dist');
            outputDir = dep('@angular/build') || /@angular-devkit\/build-angular:application/.test(read('angular.json') ?? '')
                ? `${baseDir}/browser`
                : baseDir;
        }
        catch {
        }
        return base({ framework: { id: 'angular', name: 'Angular' }, type: 'static', buildCmd: build, outputDir, ...common });
    }
    if (dep('react-scripts')) {
        return base({
            framework: { id: 'cra', name: 'Create React App' },
            type: 'static', buildCmd: build, outputDir: 'build', buildTimeEnvPrefix: 'REACT_APP_', ...common,
        });
    }
    if (dep('@vue/cli-service')) {
        return base({
            framework: { id: 'vue-cli', name: 'Vue CLI' },
            type: 'static', buildCmd: build, outputDir: 'dist', buildTimeEnvPrefix: 'VUE_APP_', ...common,
        });
    }
    const server = SERVER_DEPS.find(([d]) => dep(d));
    if (server) {
        needsServer();
        return base({
            framework: { id: server[0].replace(/[@/]/g, ''), name: server[1] },
            type: serverType, buildCmd: build, startCmd: start ?? (scripts['start:prod'] ? runCmd(packageManager, 'start:prod') : null),
            ...common,
        });
    }
    if (dep('vite')) {
        const flavour = dep('react') ? 'React' : dep('vue') ? 'Vue' : dep('svelte') ? 'Svelte' : dep('preact') ? 'Preact' : dep('solid-js') ? 'Solid' : dep('lit') ? 'Lit' : null;
        const out = /outDir\s*:\s*['"]([^'"]+)['"]/.exec(cfg('vite.config'))?.[1] ?? 'dist';
        return base({
            framework: { id: 'vite', name: flavour ? `Vite (${flavour})` : 'Vite' },
            type: 'static', buildCmd: build, outputDir: out, buildTimeEnvPrefix: 'VITE_', ...common,
        });
    }
    if (dep('parcel')) {
        return base({ framework: { id: 'parcel', name: 'Parcel' }, type: 'static', buildCmd: build, outputDir: 'dist', ...common });
    }
    if (start && !build) {
        needsServer();
        return base({ framework: { id: 'node', name: 'Node.js' }, type: serverType, startCmd: start, ...common });
    }
    if (!build)
        notes.push('package.json has no "build" script.');
    return base({
        framework: { id: 'node', name: build ? 'Node.js (build script)' : 'Node.js' },
        type: 'static', buildCmd: build, outputDir: 'dist', ...common,
    });
}
//# sourceMappingURL=framework-detect.util.js.map