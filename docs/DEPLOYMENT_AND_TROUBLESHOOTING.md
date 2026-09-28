# Upande Cloud — Production Deployment & Troubleshooting Guide

This guide documents how Upande Cloud was stood up on a production VPS end‑to‑end,
and every error encountered along the way with its root cause and fix. It is a
field guide written from a real deployment (domain `oponde.top`, VPS
`209.151.144.92`), not theory.

> For the architecture and the CLI command reference, see [`README.md`](../README.md)
> and [`apps/zone/README.md`](../apps/zone/README.md). This document is the
> operational runbook: install, go‑live (HTTPS), deploy apps, and fix failures.

---

## Table of contents

1. [Prerequisites & minimum VPS specs](#1-prerequisites--minimum-vps-specs)
2. [Publishing the platform images (GHCR)](#2-publishing-the-platform-images-ghcr)
3. [Installing the `zone` CLI](#3-installing-the-zone-cli)
4. [Installing the platform](#4-installing-the-platform)
5. [Going live with a domain + HTTPS](#5-going-live-with-a-domain--https)
6. [Deploying apps](#6-deploying-apps)
7. [Required environment variables](#7-required-environment-variables)
8. [Troubleshooting catalogue](#8-troubleshooting-catalogue)
9. [Quick diagnostic command reference](#9-quick-diagnostic-command-reference)

---

## 1. Prerequisites & minimum VPS specs

The platform runs Traefik + PostgreSQL + Redis + the three platform services
(`api`, `dashboard`, `admin`), **plus every deployed app container** and their
on‑box image builds. Builds are the real resource driver.

**Software** (any Linux host, Ubuntu/Debian tested):

| Tool | Minimum | Notes |
| --- | --- | --- |
| Docker Engine | 24+ | runs everything |
| Docker Compose | v2 plugin | bundled with modern Docker |
| Node.js | 20+ | to run the `zone` CLI |

**Hardware** (not enforced, but learned in practice):

| Tier | vCPU | RAM | Disk | Good for |
| --- | --- | --- | --- | --- |
| Bare minimum | 2 | 4 GB | 40 GB | platform + a couple of light apps; **add swap** |
| Recommended | 2–4 | 8 GB | 80 GB | platform + several apps, comfortable on‑box builds |

> The reference deployment ran on **3.8 GiB RAM / ~24 GiB disk** — workable, but a
> **4 GiB swap file is mandatory** there or on‑box builds OOM. See
> [§8.10](#810-builds-oom--host-runs-out-of-memorydisk).

---

## 2. Publishing the platform images (GHCR)

The `zone` CLI pulls **prebuilt** images `ghcr.io/<owner>/upande-cloud/{api,dashboard,admin}`.
They must exist and be pullable before `zone install` will work.

1. Push the repo to GitHub on the **`main`** branch (the `release.yml` workflow
   triggers on `main`, **not** `master`). If your local branch is `master`:
   ```bash
   git push origin master:main
   ```
2. In the repo's **Actions** tab, confirm the **`release`** workflow ran green
   (three `build` jobs: api, dashboard, admin). It builds and pushes to GHCR.
   - First run may need **Settings → Actions → General → Workflow permissions →
     Read and write** so `GITHUB_TOKEN` can push packages.
3. **Make the packages public** (they are created **private** even for a public
   repo): GitHub → your account/org → **Packages** → each of `upande-cloud/api`,
   `/dashboard`, `/admin` → **Package settings → Change visibility → Public**.
   - Alternatively keep them private and `docker login ghcr.io` on the VPS with a
     `read:packages` token.
4. Verify anonymous pull works:
   ```bash
   docker pull ghcr.io/<owner>/upande-cloud/api:latest
   ```

> **Gotcha:** the repo being public does **not** make its GHCR packages public.
> That is a separate per‑package setting. See [§8.2](#82-ghcr-images-denied--404).

---

## 3. Installing the `zone` CLI

The CLI is published on npm as **[`@zonalcloud/zone`](https://www.npmjs.com/package/@zonalcloud/zone)**
(source in `apps/zone/`). The normal install is:

```bash
npm install -g @zonalcloud/zone
zone --version
# or run once without installing:
npx @zonalcloud/zone --help
```

> ⚠️ **Two common mistakes that leave you with `zone: command not found`:**
>
> 1. **Wrong name.** Install `@zonalcloud/zone` (the scoped name), **not** `zone`.
>    `npm install zone` pulls an unrelated package off npm and gives you no working
>    `zone` command.
> 2. **Missing `-g`.** Without the global flag, npm installs into `./node_modules`
>    in the current directory and never puts `zone` on your `PATH`. A CLI needs
>    `npm install -g`.
>
> If `zone --version` still says *command not found* after `npm install -g`, the
> npm global bin directory isn't on your `PATH`:
>
> ```bash
> npm prefix -g            # global root; bins live in <prefix>/bin
> ls -l "$(npm prefix -g)/bin/zone"   # should be a symlink to the CLI
> export PATH="$(npm prefix -g)/bin:$PATH"   # add to ~/.bashrc to persist
> ```

### Fallback: install from a tarball

If the VPS can't reach the npm registry (air-gapped, restricted network), build
and ship a tarball instead:

```bash
# On a machine with the repo:
cd apps/zone
npm run build          # produces dist/
npm pack               # produces upandecloud-zone-<version>.tgz

# Copy the .tgz to the VPS (e.g. scp), then on the VPS:
npm install -g /root/upandecloud-zone-<version>.tgz
zone --version
```

> If `npm install -g @zonalcloud/zone` returns **404**, the registry replica may
> just be lagging a fresh publish (retry after ~30s), or you're offline — use the
> tarball method above. See [§8.1](#81-npm-install--g-upandecloudzone--404).

Transferring the tarball when the VPS can't reach your machine (NAT): **push** from
your machine to the VPS rather than pulling — outbound SSH from your machine to the
VPS works even when the reverse doesn't:
```bash
scp -i <key> upandecloud-zone-<version>.tgz root@<vps-ip>:/root/
```

---

## 4. Installing the platform

```bash
zone preflight     # read-only: OS, RAM, disk, Docker, ports
zone install       # localhost/HTTP mode (no domain)
zone status        # confirm all services healthy
```

`zone install` writes `/opt/upande-cloud/` (compose files, `traefik.yml`, `.env`
with secrets, `backups/`), pulls images, starts the stack, runs DB migrations,
and prompts to create the superadmin. It is **idempotent**.

> `zone status` showing **API responding (HTTP 404)** is **normal** — the probe
> hits the API root, which has no route; 404 means "up and answering." Endpoints
> live under `/v1`.

**Recommendation:** install in HTTP/localhost mode first, confirm `zone status`
is green, *then* switch to a domain + TLS (§5). It's far less stressful to add
TLS to a proven stack than to debug both at once.

---

## 5. Going live with a domain + HTTPS

**Do these BEFORE `zone tls`, or Let's Encrypt will fail and rate‑limit you:**

1. **DNS** — at your DNS provider, point a wildcard at the VPS:
   ```
   A   *   <vps-ip>      # covers api./dashboard./admin. + every app subdomain
   A   @   <vps-ip>      # apex (optional)
   ```
   A wildcard `*` is the key record — it makes every `<slug>.<domain>` resolve,
   including future deployed apps.
2. **Firewall** — open inbound TCP **80 and 443** in the VPS provider's
   security group (preflight only checks they're free *locally*).
3. **Verify DNS resolves to the VPS before continuing:**
   ```bash
   dig +short api.<domain>     # must print <vps-ip>
   ```
4. **Enable TLS:**
   ```bash
   zone tls --domain <domain> --acme-email you@example.com
   ```
   Traefik switches to `:443`, redirects HTTP→HTTPS, and issues Let's Encrypt
   certs for `api.`/`dashboard.`/`admin.<domain>`. Certs are issued **on first
   request** to each host.

Verify:
```bash
curl -I https://dashboard.<domain>     # expect HTTP/2 200, valid cert
```

> **Never run `zone tls` before DNS resolves.** Each failed cert attempt counts
> against Let's Encrypt's "5 failed authorizations per host per hour" limit; burn
> through it and you wait ~1 hour. See [§8.4](#84-lets-encrypt-cert-fails).

### Before your DNS works: use the server IP via sslip.io

Routing is by hostname, so the bare IP (`http://<vps-ip>`) only ever shows the
"Site not available" fallback page. While your own domain's DNS is being sorted,
use [sslip.io](https://sslip.io) — a free wildcard DNS service that resolves any
name containing an IP to that IP, with no signup:

```bash
zone tls --domain cloud-94-237-46-39.sslip.io --acme-email you@example.com
```

- Write the IP with **dashes** (`94-237-46-39`), so each host stays one label
  deep and the certificates are valid.
- An optional word prefix is allowed (`cloud-94-237-46-39.sslip.io`,
  `upande-94-237-46-39.sslip.io`). The IP must stay in the name —
  `cloud.sslip.io` resolves to nothing.
- The platform is then at `https://admin.cloud-94-237-46-39.sslip.io`,
  `https://dashboard.…` and `https://api.…/v1`, and deployed apps at
  `https://<slug>.cloud-94-237-46-39.sslip.io`.
- sslip.io is shared, so Let's Encrypt may rate-limit it. Traefik then serves a
  self-signed certificate: the site still works after clicking through the
  browser warning.

When your domain resolves (step 3 above), switch over. Data and secrets are
kept:

```bash
zone tls --domain <domain> --acme-email you@example.com
```

---

## 6. Deploying apps

Apps are created in the **dashboard** (New App → choose Site type → Source).

| Site type | What it is | Port the platform routes to |
| --- | --- | --- |
| **Static** | prebuilt files via nginx | 8080 |
| **Dynamic** | long‑running Node server, no DB | 8080 |
| **Full stack** | Node server + managed PostgreSQL | 8080 |
| **Node‑RED** | official Node‑RED image + volume | 1880 |

Key behaviours:

- **App URLs** are `https://<slug>.<domain>` (e.g. `https://nodered.oponde.top`),
  served with their own Let's Encrypt cert. Requires the wildcard DNS from §5.
- **Full‑stack apps** get a managed Postgres database auto‑provisioned, and
  `DATABASE_URL` is **injected** pointing at `postgres:5432` on `upande_net` with a
  per‑app role/db (`app_<slug>` / `db_<slug>`). Don't set `DATABASE_URL` yourself
  unless you want to override it.
- **`PORT` is injected** (`8080`) for static/dynamic/fullstack apps. A
  `$PORT`‑honouring server (PaaS convention) binds it automatically. A user‑set
  `PORT` env var always wins.
- **A repo's own `Dockerfile` is used as‑is** if present (the generated fallback
  is skipped). Use this for monorepos or non‑standard builds.

### Connecting GitHub / private repos

- **Public repo, Repository‑URL mode:** paste the URL — needs no auth (just `git`
  in the api image).
- **Private repos, Connect GitHub:** requires GitHub OAuth configured (§7). The
  OAuth App's callback URL must be exactly `https://api.<domain>/v1/github/callback`.

---

## 7. Required environment variables

Set in `/opt/upande-cloud/.env` (passed to the api container via `env_file`).
`zone install` / `zone tls` do **not** set the ones below — add them manually,
then `zone upgrade` (or `zone restart`) to apply.

| Variable | Example | Purpose |
| --- | --- | --- |
| `BASE_DOMAIN` | `oponde.top` | domain apps are served under (`<slug>.<BASE_DOMAIN>`) |
| `APP_HTTP_PORT` | *(empty)* | public Traefik HTTP port; empty on the VPS |
| `APP_HTTP_SCHEME` | `https` | scheme in generated app URLs |
| `ACME_RESOLVER` | `letsencrypt` | enables TLS on app routers |
| `GITHUB_CLIENT_ID` | `Iv1.…` | GitHub OAuth (Connect GitHub) |
| `GITHUB_CLIENT_SECRET` | `…` | GitHub OAuth |
| `API_PUBLIC_URL` | `https://api.oponde.top` | builds the OAuth callback URL |
| `DASHBOARD_URL` | `https://dashboard.oponde.top` | post‑auth redirect target |
| `MISTRAL_API_KEY` | `…` | (optional) AI deploy‑log analysis |
| `MISTRAL_AGENT_ID` | `…` | (optional) AI deploy‑log analysis |

Safe edit pattern (set‑or‑append, with backup):
```bash
cd /opt/upande-cloud && cp .env .env.bak
for kv in "BASE_DOMAIN=oponde.top" "APP_HTTP_PORT=" "APP_HTTP_SCHEME=https" "ACME_RESOLVER=letsencrypt"; do
  k="${kv%%=*}"; grep -qE "^$k=" .env && sed -i "s|^$k=.*|$kv|" .env || echo "$kv" >> .env
done
grep -E '^(BASE_DOMAIN|APP_HTTP_PORT|APP_HTTP_SCHEME|ACME_RESOLVER)=' .env
```

> Set secrets without leaking them into shell history:
> ```bash
> read -rp "GITHUB_CLIENT_SECRET: " S; printf 'GITHUB_CLIENT_SECRET=%s\n' "$S" >> .env; unset S
> ```

---

## 8. Troubleshooting catalogue

Each entry: **symptom → root cause → fix**. These are real failures from the
reference deployment.

### 8.1 `npm install -g @zonalcloud/zone` → 404
**Cause:** the package **is** published, so a 404 means either the registry replica
is lagging a fresh publish (the new scope's first version can take ~30–60s to
propagate to all read replicas/CDN), or the machine can't reach the npm registry.
**Fix:** retry after ~30s; confirm with `npm view @zonalcloud/zone version`. If the
machine is offline/air-gapped, install from a tarball — `npm pack` in `apps/zone/`,
copy to the VPS, `npm install -g <tgz>`. See [§3](#3-installing-the-zone-cli).

### 8.2 GHCR images `DENIED` / 404
**Cause:** either the `release` workflow never published the images (check the
Actions tab; note it triggers on **`main`** not `master`), or the packages exist
but are **private** (GHCR default, even for public repos).
**Fix:** publish via the workflow, then make the three packages **public**
(Account → Packages → each → Change visibility), or `docker login ghcr.io` on the
VPS with a `read:packages` token. Verify with `docker pull …/api:latest`.
See [§2](#2-publishing-the-platform-images-ghcr).

### 8.3 Browser can't reach the site after DNS change (`DNS_PROBE_FINISHED_NXDOMAIN`)
**Cause:** public DNS is correct (verify: `dig +short api.<domain> @8.8.8.8`
returns the VPS IP) but your **local resolver cached the old NXDOMAIN**.
**Fix:** on the client, point at a public resolver and flush:
```bash
sudo resolvectl dns <iface> 8.8.8.8 1.1.1.1   # find <iface> via: ip route | grep default
sudo resolvectl flush-caches
nslookup api.<domain>                          # must now return the VPS IP
```
Also clear Chrome's cache at `chrome://net-internals/#dns`. The router's negative
cache also expires on its own within ~1 hour.

### 8.4 Let's Encrypt cert fails
**Symptoms in `docker logs upande_traefik | grep -i acme`:**
- `NXDOMAIN looking up A for …` → DNS not pointing at the VPS yet. Fix DNS (§5),
  then `docker restart upande_traefik` **once**.
- `429 too many failed authorizations` → you hit the rate limit (5 fails/host/hr).
  **Wait** until the time stated in the log, fix the real cause (DNS/ports), then
  retry. Do **not** loop restarts — each attempt digs the hole deeper.
- Connection/timeout on the challenge → inbound **port 80 blocked** by the cloud
  firewall. Open 80 + 443.
**Verify success:** `curl -I https://<host>` returns 200 with a valid cert (no
SSL/SAN error).

### 8.5 App shows `404 page not found` (plain text) over HTTP
**Cause:** the app router is HTTPS‑only (`websecure`); you loaded **`http://`**,
which matches no router → Traefik 404.
**Fix:** use **`https://<slug>.<domain>`**. (This is Traefik's 404, not the app's.)

### 8.6 Deployed app routes on `<slug>.localhost` instead of your domain
**Cause:** the api `.env` lacks `BASE_DOMAIN` / `ACME_RESOLVER` (older builds also
hardcoded `.localhost`).
**Fix:** set the env vars in §7, `zone upgrade`, then **redeploy the app** so its
container is recreated with the correct labels.

### 8.7 Redeploy didn't pick up new routing / a code change
**Cause:** a dashboard "redeploy" can reuse the existing container; stale/crashed
containers from earlier attempts also linger.
**Fix:** force a clean recreate:
```bash
docker rm -f upande-<slug>      # app data is in a named volume, so it survives
```
then redeploy. When debugging, inspect the **running** container's live env with
`docker exec <c> printenv`, and check `docker ps -a` for stale containers — don't
trust a single `docker inspect`.

### 8.8 Build fails: `spawn docker ENOENT` or `git` not found
**Cause:** the api image was missing the `docker` CLI and/or `git`. The deploy
engine shells out to `git clone` and `docker build`.
**Fix:** the api `Dockerfile` runtime stage must install **`git`** and a static
**`docker` CLI** (talks to the host daemon via the mounted socket). Rebuild the
image (push → `release` workflow) and `zone upgrade`. Verify:
```bash
docker exec upande_api sh -c "git --version && docker --version"
```

### 8.9 Build uses the generated fallback and ignores the repo's Dockerfile
**Symptom:** build log shows `nixpacks binary not found, using Dockerfile fallback`
and `FROM node:20-alpine` even though the repo has its own `Dockerfile`.
**Cause:** older builds always generated/overwrote the Dockerfile.
**Fix:** current platform detects a repo `Dockerfile` and builds with it. If you
see the fallback, rebuild the api image (push → `release`) and `zone upgrade`.
For monorepos whose root `postinstall` reaches into a subdir (e.g.
`npm install --prefix server`), the repo **must** ship a Dockerfile that
`COPY . .` before `npm install` — the generated fallback copies only root
`package*.json` and fails with `ENOENT … server/package.json`.

### 8.10 App returns `502 Bad Gateway` (but the app is running)
**Cause:** **port mismatch** — Traefik proxies to one port, the app listens on
another. The app's Node server picked its own default (e.g. 3000/8000) instead of
the routed port.
**Fix:** the platform injects `PORT=8080` and routes static/dynamic/fullstack apps
to 8080; the app must honour `$PORT`. Confirm:
```bash
C=upande-<slug>
docker exec "$C" printenv PORT                                   # should be 8080
docker exec upande_traefik sh -c "wget -qO- -T3 http://$C:8080/ >/dev/null 2>&1 && echo REACHABLE || echo UNREACHABLE"
```
A brief `Bad Gateway` right after deploy is **normal** while the app boots
(schema bootstrap/seed) — it clears once the server starts listening.

### 8.11 Full‑stack app: `ECONNREFUSED 127.0.0.1:5432`
**Cause:** the app fell back to localhost Postgres because `DATABASE_URL` wasn't
in its env — usually a **stale pre‑provision container** still running, or the app
isn't actually "Full stack" type.
**Fix:** confirm the **running** container has it:
```bash
docker exec upande-<slug> printenv DATABASE_URL    # expect …@postgres:5432/db_<slug>
```
If absent: ensure the app's Site type is **Full stack**, then `docker rm -f` the
stale container and redeploy. The deploy log should show a **"Provisioning
database"** stage and **"Database ready"**.

### 8.12 App's admin/page crashes: `Cannot read properties of undefined (reading 'length')`
**Cause:** an **app‑level** frontend bug — reading `.length`/`.map` on an
API field that's undefined, often because a data loader didn't unwrap the response
envelope (e.g. `setStats(resp)` instead of `setStats(resp.stats)`).
**Fix:** in the app code, unwrap the response and/or guard with optional chaining
(`x?.length`). Rebuild the app frontend (redeploy). *(This is a bug in the deployed
app, not the platform.)*

### 8.13 In‑app AI assistant repeats the same canned reply
**Cause:** the assistant's AI config is **not saved/enabled** (or has no API key),
so it returns its hardcoded fallback on every message. A "Test" button that calls
the provider directly can succeed while the **saved** config is still empty.
**Fix:** in the app's **Admin → AI Settings**, set provider + model + API key, set
**Enabled = ON**, and **Save** (not just Test). Verify the setting persisted, then
retry in the widget.
**Note:** a plain chat assistant answers from the model's general knowledge — it
does **not** retrieve your site/DB, so it may invent services/prices. A
"search‑the‑website / answer‑only‑from‑retrieved‑content" (RAG) prompt will make it
refuse most questions unless real retrieval is implemented. For accurate answers,
inject the app's real data (services/pricing from its DB) into the prompt.

### 8.14 `git push` rejected: `non-fast-forward` / divergent branches
**Cause:** local and remote `main` diverged (commits on both).
**Fix:** inspect, then rebase your commits on top of remote:
```bash
git fetch origin
git log --oneline origin/main..main    # your local-only commits
git log --oneline main..origin/main    # remote-only commits
git pull --rebase origin main          # resolve any conflicts, then: git rebase --continue
git push origin main
```
**Never** `git push --force` to bypass this — it erases remote‑only commits.

### 8.15 `zone --version` → `SyntaxError: Unexpected token '?'`
**Cause:** the server's Node.js is too old (Ubuntu 22.04's apt ships Node 12). The
CLI needs Node **20+**; npm only warns `EBADENGINE` at install time.
**Fix:** remove the distro Node, install Node 20 from NodeSource, reinstall the CLI:
```bash
apt-get remove -y nodejs libnode72 nodejs-doc; apt-get autoremove -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
hash -r && node -v                        # v20.x
npm install -g @zonalcloud/zone@latest
```
Removing `libnode72` first avoids NodeSource's `trying to overwrite
/usr/include/node/common.gypi` error.

### 8.16 Image pull fails: `lookup ghcr.io on 127.0.0.53:53: connection refused`
**Cause:** `zone install` disables systemd-resolved's stub listener to free port 53
for managed DNS, but `/etc/resolv.conf` still points at the stub (`127.0.0.53`),
so the server can no longer resolve anything.
**Fix:** point resolv.conf at the real upstream servers, then re-run the install:
```bash
ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
getent hosts ghcr.io                      # must print an IP
```
If the same run also printed `Cannot connect to the Docker daemon`, restart
Docker: `systemctl restart docker`.

### 8.17 `docker compose up` → `failed to bind host port … 6379` (or 80/443)
**Cause:** host services already hold the ports — a system `redis-server` on 6379
and/or `nginx` on 80/443. Preflight only **warns** about ports in use.
**Fix:** see what holds them, and stop the host services if nothing depends on them:
```bash
ss -ltnp | grep -E ':(80|443|6379) '
ls /etc/nginx/sites-enabled/              # nginx sites that would go offline
systemctl disable --now nginx redis-server
zone install                              # safe to re-run; secrets are kept
```

### 8.18 "Site not available" page for `admin.localhost` / `dashboard.localhost`
**Cause:** the page comes from the `upande-fallback` container: Traefik answered, but
no router matched the requested host. Two common reasons:
- **The install is still in localhost mode.** Routes only match `*.localhost`, so a
  request by IP or by your domain falls through to the fallback.
- **You opened `*.localhost` in a browser on another machine.** Browsers always send
  `*.localhost` to their own machine. If that machine runs a local Upande Cloud,
  its own fallback page answers, and the VPS never sees the request.

**Check** from any machine, forcing the host name:
```bash
curl -s -H 'Host: admin.localhost' http://<vps-ip>/ | grep -o '<title>[^<]*'
# "Upande Cloud -- Admin" → the VPS is fine; use a domain (§5) or sslip.io
```
**Fix:** switch to a real domain, or to sslip.io until DNS is ready
([§5](#5-going-live-with-a-domain--https)).

### 8.19 DNS record exists in the panel but `dig` returns nothing
**Cause:** the record was added in a DNS panel whose servers are **not** the domain's
nameservers. For example: the record is in the hosting provider's DNS
Management (zone NS `ns1.olitt.com`), while the registrar still delegates the
domain to other nameservers (`ns1.cloudoon.com`).
**Check:** compare the nameservers the domain uses with the ones that have the record:
```bash
dig +short NS <domain>                              # nameservers actually used
dig +short admin.<domain> @<ns-from-the-panel>      # does the panel's server have it?
dig +short admin.<domain> @<ns-from-first-command>  # does the live server have it?
```
**Fix:** either change the domain's nameservers at the registrar to the panel's
nameservers, or add the record at the nameservers already in use. If the
registrar panel errors on a nameserver change, ask its support to make it. In
the Name field, enter only `*`: many panels append the domain, so
`*.<domain>` becomes `*.<domain>.<domain>`.

---

## 9. Quick diagnostic command reference

```bash
# Platform health
zone status
docker ps --format '{{.Names}}\t{{.Status}}'

# Traefik routing + TLS
docker logs upande_traefik 2>&1 | grep -iE "acme|error|502" | tail -20
docker inspect <container> --format '{{range $k,$v := .Config.Labels}}{{if (eq (slice $k 0 7) "traefik")}}{{$k}}={{$v}}{{"\n"}}{{end}}{{end}}'

# A deployed app
C=upande-<slug>
docker ps -a --filter name=<slug> --format '{{.Names}} | {{.Status}}'   # spot stale containers
docker exec "$C" printenv | grep -iE 'PORT|DATABASE_URL|NODE_ENV'
docker logs "$C" --tail 30
docker exec upande_traefik sh -c "wget -qO- -T3 http://$C:8080/ >/dev/null 2>&1 && echo REACHABLE || echo UNREACHABLE"

# DNS (run on the client AND on the VPS)
dig +short <host>.<domain>            # local resolver
dig +short <host>.<domain> @8.8.8.8   # public resolver

# Lifecycle
zone upgrade            # pull new images, backup, migrate, restart
zone restart            # restart with current config/.env
zone logs <service> -f
zone backup             # pg_dump to backups/
```

---

*Generated from a real production deployment of Upande Cloud on `oponde.top`.*
