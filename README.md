# Upande Cloud

A self-hosted, multi-tenant Platform-as-a-Service for full-stack web deployment. It builds
and runs static frontends, Node.js backends, full-stack apps, and Node-RED instances in
Docker, with a reverse proxy that gives every app its own URL. It runs the same way on a
local machine and on an Ubuntu VPS.

This document covers installation (local and VPS), prerequisites, how to access the
dashboard and the admin panel, and the database setup.

> 📘 **Going to production?** See
> [`docs/DEPLOYMENT_AND_TROUBLESHOOTING.md`](docs/DEPLOYMENT_AND_TROUBLESHOOTING.md)
> — an end-to-end runbook (publish images → install → domain + HTTPS → deploy apps)
> with a catalogue of real errors and their fixes.

> Status: in active development. Static and Node/full-stack apps deploy end to end from a Git
> repo or a connected GitHub account (push-to-deploy). Full-stack apps are automatically given
> a managed PostgreSQL database inside the shared server. App types: `static`, `node`,
> `fullstack`, `nodered`.
>
> Two install paths are documented below: the **`zone` operator CLI** (recommended for servers —
> installs from npm and pulls prebuilt images, no monorepo clone) and a **manual from-source**
> setup (recommended for local development on this repo).

### What has been verified

The steps below were exercised on a development machine. Verified working:

- `npm install` for the API, dashboard, and admin
- TypeScript builds: `tsc` (dashboard, admin) and `nest build` (API) all compile cleanly
- Dashboard dev server boots and serves on http://localhost:5173
- Admin dev server boots and serves on http://localhost:5174
- API compiles and the NestJS bootstrap runs

Requires a working environment to complete (documented in the steps):

- Docker Engine reachable by your user, plus the Docker Compose plugin (for PostgreSQL,
  Redis, and Traefik)
- Outbound access to a Prisma engine source on first `prisma generate`. Prisma's default CDN
  (`binaries.prisma.sh`) is slow on many networks; the steps below use the faster
  `cdn.npmmirror.com` mirror via `PRISMA_ENGINES_MIRROR`. This is an environment/network
  detail, not a code issue.

---

## Quickstart: see the dashboard

Every command, in order, to get the dashboard open in your browser. Run from the repo root.
Each numbered block is a separate terminal that stays running.

```bash
# ---------------------------------------------------------------
# 0. One-time setup (skip if `docker ps` and `docker compose version` already work)
# ---------------------------------------------------------------
sudo usermod -aG docker "$USER"
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
newgrp docker                                  # refresh group in this shell
docker ps && docker compose version            # both must succeed

# ---------------------------------------------------------------
# 1. Configure environment (from the repo root)
# ---------------------------------------------------------------
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
cp apps/admin/.env.example apps/admin/.env

# Generate and inject the API encryption key (64-char hex)
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$KEY/" apps/api/.env

# ---------------------------------------------------------------
# 2. Start infrastructure: PostgreSQL, Redis, Traefik (background)
# ---------------------------------------------------------------
docker compose up -d
docker compose ps                              # traefik, postgres, redis, whoami = running
curl http://whoami.localhost                   # proves the proxy routes (request metadata)

# ---------------------------------------------------------------
# 3. API — Terminal 1 (leave running)
# ---------------------------------------------------------------
cd apps/api
npm install

# Prisma's default CDN (binaries.prisma.sh) is slow/throttled on many networks.
# Use the faster npmmirror mirror so the engine downloads in seconds. Export it
# for prisma:generate and prisma:migrate (safe to add to your shell profile).
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"

npm run prisma:generate                        # downloads engines from the mirror
npm run prisma:migrate                         # creates the database schema
npm run dev                                     # serves http://localhost:4000

# ---------------------------------------------------------------
# 4. Dashboard — Terminal 2 (leave running)
# ---------------------------------------------------------------
cd apps/dashboard
npm install
npm run dev                                     # serves http://localhost:5173

# ---------------------------------------------------------------
# 5. Admin panel — Terminal 3 (optional, leave running)
# ---------------------------------------------------------------
cd apps/admin
npm install
npm run dev                                     # serves http://localhost:5174
```

Then open the dashboard in your browser:

```
http://localhost:5173
```

Web registration always creates a regular **user**. The platform **superadmin** is created
only from the terminal — see Local installation, Step 9 (`npm run create-superadmin`). Log in
with the superadmin credentials to reach the admin panel at **http://localhost:5174**.

If you only want to look at the dashboard UI (no login, no deploys), you can run just step 4 —
the dashboard dev server starts on its own; API-backed actions will simply error until the API
in step 3 is running.

> Verified: steps 1, 4, and 5 run as shown (frontends serve HTTP 200). Steps 0, 2, and 3
> require Docker access and network access to `binaries.prisma.sh`; see Troubleshooting if
> either is restricted on your machine.

---

## Contents

- [Quickstart: see the dashboard](#quickstart-see-the-dashboard)
- [Architecture at a glance](#architecture-at-a-glance)
- [Database](#database)
- [Prerequisites](#prerequisites)
- [Install with the `zone` CLI (servers)](#install-with-the-zone-cli-servers)
- [Local installation (from source)](#local-installation-from-source)
- [Accessing the dashboard and admin panel](#accessing-the-dashboard-and-admin-panel)
- [GitHub integration (connect repos & push-to-deploy)](#github-integration-connect-repos--push-to-deploy)
  - [Sign in / sign up with GitHub](#sign-in--sign-up-with-github)
  - [Pull request integration](#pull-request-integration-commit-statuses--preview-comments)
- [Managed per-app databases (full-stack apps)](#managed-per-app-databases-full-stack-apps)
- [Deployments: history, rollback, health checks, previews](#deployments-history-rollback-health-checks-previews)
- [Uptime monitoring & graphs](#uptime-monitoring--graphs)
- [Notifications](#notifications)
  - [New-notification alerts](#new-notification-alerts)
- [Support chat](#support-chat)
- [VPS installation from source (Ubuntu)](#vps-installation-from-source-ubuntu)
- [GitHub Actions auto-deploy](#github-actions-auto-deploy)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Architecture at a glance

| Component | Tech | Default port | Purpose |
| --- | --- | --- | --- |
| API (control plane) | NestJS + Prisma + BullMQ | 4000 | Auth, apps, deploys, admin, deploy engine |
| User dashboard | React + Vite + Tailwind | 5173 | Tenant-facing app management |
| Admin panel | React + Vite + Tailwind | 5174 | Operator control across all tenants |
| Reverse proxy | Traefik v3 | 8090 local / 80+443 VPS (8080 dashboard) | Routes each app at `<slug>.localhost` |
| Database | PostgreSQL 16 | 5432 | Platform data + managed per-app databases |
| Queue / cache | Redis 7 | 6379 | Build job queue and log buffering |
| Operator CLI | `@zonalcloud/zone` (npm) | n/a | Install/run/upgrade/backup the platform on a server |

Infrastructure (Traefik, PostgreSQL, Redis) runs via `docker-compose.yml`. The API and the
two frontends run as Node processes in development.

> Local proxy port: a system nginx commonly holds `:80`, so locally Traefik publishes its HTTP
> entrypoint on **`:8090`** and apps are reachable at `http://<slug>.localhost:8090`. This is
> controlled by `APP_HTTP_PORT` in `apps/api/.env`; set it to `""`/`80` once `:80` is free (and
> on the VPS, where Traefik owns `:80`/`:443`).

The platform now supports two deployment models:

- **From-source (this repo):** clone the monorepo, run the API + frontends. Best for local
  development. See [Local installation (from source)](#local-installation-from-source).
- **Prebuilt images via the `zone` CLI:** install a standalone CLI from npm that pulls
  published `api`/`dashboard`/`admin` images and runs them with Traefik + Postgres + Redis. The
  server never needs the monorepo. See [Install with the `zone` CLI](#install-with-the-zone-cli-servers).

---

## Database

The control plane uses **PostgreSQL 16**.

PostgreSQL was chosen because the control plane is write-heavy and concurrent (many deploys
and log writes at once), stores semi-structured data such as audit metadata in `JSONB`, and
needs strict transactional integrity for a multi-tenant, billable system. It is the standard
choice for PaaS control planes.

Note on MariaDB/MySQL: while the platform itself runs on PostgreSQL, MariaDB and MySQL are
planned as databases that can be provisioned for the user apps you deploy (the full-stack app
type, a later step). The control-plane database and the per-app databases are independent.

The schema is managed by Prisma. Migrations are applied with `npm run prisma:migrate` from
`apps/api`. You never write SQL by hand to set this up.

---

## Prerequisites

Required on any machine (local or VPS):

| Tool | Minimum version | Check | Notes |
| --- | --- | --- | --- |
| Docker Engine | 24+ | `docker --version` | Runs Traefik, PostgreSQL, Redis, and deployed app containers |
| Docker Compose | v2 (plugin) | `docker compose version` | Bundled with modern Docker |
| Node.js | 20+ (24 recommended) | `node --version` | Runs the API and frontends |
| npm | 10+ | `npm --version` | Ships with Node |
| Git | any recent | `git --version` | Cloning user repos and this repo |

Optional:

| Tool | Purpose | Check |
| --- | --- | --- |
| nixpacks | Automatic builds. If absent, the deploy engine falls back to a generated Dockerfile | `which nixpacks` |
| act | Run GitHub Actions workflows locally for CI testing | `act --version` |

The Docker daemon must be reachable by your user and the Compose plugin installed. The Local
installation steps below begin with that one-time setup (Step 1).

---

## Install with the `zone` CLI (servers)

`zone` (`@zonalcloud/zone`, in [`apps/zone/`](apps/zone/)) is a standalone operator CLI that
installs, runs, and maintains the platform on a Linux server **without cloning this repo**. It
carries its own copy of the deploy files and pulls **prebuilt** `api`/`dashboard`/`admin`
images from a container registry (GHCR by default).

```bash
# Install the CLI from npm — use the scoped name and -g (not `npm install zone`)
npm install -g @zonalcloud/zone
zone --version

# Or bootstrap Node + the CLI and install in one shot (scripts/install.sh):
curl -fsSL https://raw.githubusercontent.com/WilfredTinega/Upande-Cloud/main/scripts/install.sh \
  | bash -s -- --domain example.com --acme-email you@example.com
```

Typical server flow:

```bash
zone preflight      # read-only readiness check (OS, RAM, disk, Docker, ports)
zone install        # pull images, write deploy files + secrets, migrate, create superadmin
zone status         # confirm services are healthy
```

`install` is idempotent (existing `.env` secrets are preserved). With `--domain` it switches to
**production/TLS mode**: Traefik serves HTTPS on `:443`, redirects HTTP→HTTPS, and obtains
Let's Encrypt certificates for `api.`, `dashboard.`, and `admin.` + your domain (point DNS at
the server and open ports 80/443 first). Omit `--domain` for localhost/HTTP mode.

Other lifecycle commands: `up`/`down`/`restart`, `logs`, `migrate`, `superadmin`, `tls`,
`upgrade --tag vX.Y.Z`, `backup`, `restore`, `secrets rotate`. State (compose files,
`traefik.yml`, `.env`, `backups/`) lives in a data directory (`UPANDE_DATA_DIR`, else
`/opt/upande-cloud`, else `~/.upande-cloud`).

Images are published by the [`.github/workflows/release.yml`](.github/workflows/release.yml)
workflow. Full CLI reference: [`apps/zone/README.md`](apps/zone/README.md).

---

## Local installation (from source)

Use this path to develop on the monorepo. Follow these steps in order: the database must be
running before the API can migrate or start. Each step says which terminal it belongs in.

### Step 1 — One-time Docker setup

The API, database, Redis, and proxy all run in Docker. On a fresh machine two things usually
need fixing first. Run these once:

```bash
# a) Allow your user to use Docker without sudo
sudo usermod -aG docker "$USER"

# b) Install the Docker Compose v2 plugin
sudo apt-get update && sudo apt-get install -y docker-compose-plugin

# c) Apply the new group membership (or log out and back in)
newgrp docker
```

Confirm both work before continuing — neither command should error:

```bash
docker ps                 # must NOT say "permission denied"
docker compose version    # must print Compose v2.x
```

### Step 2 — Get the code

```bash
git clone <your-upande-cloud-repo-url> upande-cloud
cd upande-cloud
```

If you already have the project, just `cd` into it. Run all remaining steps from this repo
root unless told otherwise.

### Step 3 — Create the environment files

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
cp apps/admin/.env.example apps/admin/.env
```

### Step 4 — Set secrets and check the database credentials

Generate the API encryption key (a 64-character hex string) and write it in:

```bash
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$KEY/" apps/api/.env
```

Then edit the files and set strong values for `JWT_SECRET` (in both `.env` and
`apps/api/.env`) and `POSTGRES_PASSWORD` (in root `.env`).

Important — the database credentials must match between the two files, or the API cannot
connect. The defaults already match; if you change the password, change it in both places:

```
# root .env  (used by the PostgreSQL container)
POSTGRES_USER=upande
POSTGRES_PASSWORD=changeme
POSTGRES_DB=upande

# apps/api/.env  (used by the API; it runs on the host in dev, so host is localhost)
DATABASE_URL="postgresql://upande:changeme@localhost:5432/upande"
```

### Step 5 — Start the database, Redis, and proxy

```bash
docker compose up -d
docker compose ps          # traefik, postgres, redis, whoami must all be "running"
```

If you already run a native Redis on port 6379, the Redis container will fail to bind that
port. That is harmless — start the others and let the API use your native Redis:

```bash
docker compose up -d postgres traefik whoami
```

Confirm PostgreSQL is actually accepting connections on port 5432 before moving on:

```bash
docker compose exec postgres pg_isready -U upande    # expect: "accepting connections"
```

Verify the proxy routes (optional but quick):

```bash
curl http://whoami.localhost     # returns request metadata through Traefik
```

On most Linux systems `*.localhost` resolves to `127.0.0.1` automatically. If it does not, add
`127.0.0.1 whoami.localhost` to `/etc/hosts`.

### Step 6 — Set up and run the API (Terminal 1)

```bash
cd apps/api
npm install

# Prisma downloads its engines on first generate. Its default CDN
# (binaries.prisma.sh) is slow/throttled on many networks. Use the faster mirror:
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"

npm run prisma:generate    # downloads the Prisma engines from the mirror
npm run prisma:migrate     # creates the tables (PostgreSQL from step 5 must be running)
npm run dev                # API now listening on http://localhost:4000
```

Confirm the API is serving:

```bash
curl http://localhost:4000/v1/auth/me     # expect HTTP 401 (no token) — proves it is up
```

Leave the API running in this terminal.

Notes:

- Why the mirror: on a normal connection `binaries.prisma.sh` is fine and you can skip the
  export. On throttled networks it delivers the ~7 MB engine at a few KB/s, so
  `prisma generate` fails with `Error: request to https://binaries.prisma.sh/... failed,
  reason:` and the API then fails with `@prisma/client did not initialize yet`. The mirror
  serves the identical files far faster. Make it permanent by adding the `export` line to
  `~/.bashrc`.
- If you see `connect ECONNREFUSED 127.0.0.1:5432` when registering or starting the API, the
  database is not running — go back to step 5 (`docker compose up -d`).
- Resilience: Prisma is configured with the PostgreSQL driver adapter (`@prisma/adapter-pg`,
  the `driverAdapters` preview feature), so the client connects through the `pg` driver and
  the WASM query engine, reducing reliance on the native engine binary.

### Step 7 — Run the dashboard (Terminal 2)

```bash
cd apps/dashboard
npm install
npm run dev      # http://localhost:5173
```

### Step 8 — Run the admin panel (Terminal 3)

```bash
cd apps/admin
npm install
npm run dev      # http://localhost:5174
```

Each dev server prints `VITE vX ready` and serves immediately. If a port is taken, Vite picks
the next free one and prints the actual URL.

### Step 9 — Create the superadmin (CLI only)

The platform superadmin (the Administrator) is created **only from the terminal**, never
through the web UI. This is deliberate: web registration always creates a regular `user`, and
the superadmin role cannot be granted, changed, or suspended through the dashboard or admin API
(those actions return HTTP 403). The only way to make a superadmin is this CLI command, which
writes directly to the database.

From `apps/api` (the database from Step 5 must be running):

```bash
cd apps/api
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"   # if not already set
npm run create-superadmin -- admin@example.com 'ChangeThisStrongPass#1' 'Administrator'
#                              ^email             ^password                ^org name (optional)
```

- Email defaults to `admin@example.com` and org name to `Administrator` if omitted; a password
  is always required (minimum 8 characters).
- If the email already exists, the account is promoted to superadmin and its password updated.
- On success it prints `Superadmin created: admin@example.com ...`.

Log in with these credentials at the dashboard (http://localhost:5173) and the admin panel
(http://localhost:5174).

Promoting other people: a superadmin can promote a normal user to `admin` from the admin panel
(or `POST /v1/admin/users/:id/role`), but `superadmin` itself can only ever be granted by
re-running this CLI command.

Regular users still self-register in the dashboard:

```bash
curl -X POST http://localhost:4000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-strong-password","orgName":"Your Org"}'
# -> always returns "role":"user"
```

---

## Accessing the dashboard and admin panel

| Surface | URL | Who | Theme |
| --- | --- | --- | --- |
| User dashboard | http://localhost:5173 | Any registered user | Light/dark toggle in the top bar |
| Admin panel | http://localhost:5174 | Users with role admin or superadmin | Light/dark toggle in the top bar |
| Traefik dashboard | http://localhost:8080 | Operator (local only) | n/a |
| Deployed apps | http://&lt;app-slug&gt;.localhost:8090 (local) / https on VPS | Public | n/a |

### Create the first account

There is no default login. Web registration always creates a regular `user`. The **superadmin**
is created only from the terminal with `npm run create-superadmin` (see Local installation,
Step 9), and its role cannot be changed or suspended through the UI. The superadmin's
credentials log into both the dashboard and the admin panel.

### Open the admin panel

1. Go to http://localhost:5174.
2. Log in with your superadmin (or admin) account.
3. A user without admin privileges sees an access-denied state here, by design.

From the admin panel you can manage all users and tenants, set per-tenant quotas, view and
stop any app across tenants, see platform metrics, and read the audit log.

### Theme toggle

Both apps default to your system light/dark preference and persist your choice in the browser
(`localStorage` key `upande-theme`). Use the toggle in the top bar to switch.

### Forgot / reset password

The login page has a **Forgot password?** link. The flow:

1. Enter your email on `/forgot-password`. The API issues a one-time reset token (valid 1 hour).
2. You receive a reset link (see delivery below) and open it — it lands on `/reset-password`.
3. Set a new password and sign in.

How the link is delivered depends on whether SMTP is configured (in `apps/api/.env`):

- **No SMTP set (default, dev mode):** no email is sent. The reset link is returned in the
  `forgot-password` response and the request page shows a "Continue to reset your password"
  link directly. The link is also logged by the API. Good for local development.
- **SMTP set:** the link is emailed via Nodemailer. For a realistic local inbox, the bundled
  **Mailpit** service (in `docker-compose.yml`) is an open-source SMTP server with a web UI.
  Point the API at it and read captured emails in the browser:

  ```
  # apps/api/.env
  SMTP_HOST=localhost
  SMTP_PORT=1025
  SMTP_FROM=Upande Cloud <no-reply@upande.local>
  ```

  Then open the Mailpit inbox at **http://localhost:8025** to see the reset email.
  For production, set `SMTP_HOST/PORT/USER/PASS` to a real mail provider.

Security notes: reset tokens are stored hashed (SHA-256), are single-use, expire after one
hour, and `forgot-password` always returns the same generic message so it cannot be used to
discover which emails have accounts.

### AI deploy-log analyzer (admin)

The admin panel can explain failed deployments with AI. On the **Apps** page, a failed
app shows an **Explain with AI** button; clicking it sends the build log to a Mistral agent
and shows a plain-English diagnosis and suggested fix.

Configure it in `apps/api/.env`:

```
MISTRAL_API_KEY=...        # your Mistral API key
MISTRAL_AGENT_ID=...       # the agent id from https://console.mistral.ai
```

If either is blank the feature is disabled gracefully (the button is hidden and the API
returns a clear "not configured" message rather than erroring).

### AI agent over MCP (inspect / act on apps)

`packages/mcp` is an [MCP](https://modelcontextprotocol.io) server that lets an AI agent
inspect and act on deployed apps: `list_apps`, `get_app`, `list_deployments`, `get_metrics`,
`deploy_app`, `stop_app`. It authenticates to the Upande API with a base URL + token.

Set those on the admin **Settings** page (the token is stored encrypted), then launch the
server with the same values:

```bash
cd packages/mcp
npm install && npm run build
UPANDE_API_URL=http://localhost:4000 UPANDE_AGENT_TOKEN=<superadmin-jwt> node dist/index.js
```

Point any MCP client (Claude, etc.) at it — see `packages/mcp/README.md` for the client
config. Action tools change platform state, so only give the token to a trusted agent.

**Permanent agent tokens.** Instead of a short-lived login JWT, generate a long-lived,
revocable token for the agent on the admin **Settings** page (under *Agent tokens*). These
tokens (`ztk_...`) are stored hashed, never expire, and the API accepts them as admin auth on
the routes the MCP tools use. Revoke one anytime — it stops working immediately.

**One-click MCP config.** On the Settings page, **Download MCP config** mints a fresh agent
token and downloads a ready-to-use `.mcp.json` (server path + base URL + token already filled
in). Drop it where your MCP client reads its config and the agent is wired with no manual env
setup.

### Custom domains

Every app is reachable at its default `<slug>.<BASE_DOMAIN>` host. You can also attach your own
domains (e.g. `example.com` or `app.example.com`) from the app's detail page in the dashboard,
under **Custom domains**.

Every custom domain needs two things: **proof of ownership** and a **routing record** that
sends its traffic to this server. The routing record depends on the kind of name:

| Domain | Record | Value |
| --- | --- | --- |
| Apex / root (`example.com`, `example.co.ke`) | `A` (`AAAA` for an IPv6 server) | the server's public IP (admin **Settings → Networking**, else `PUBLIC_IP`) |
| Subdomain (`app.example.com`) | `CNAME` | the app's platform host, `<slug>.<BASE_DOMAIN>` |

A CNAME is not allowed at an apex, which is why the root of a domain uses an A record. If
`BASE_DOMAIN` is not a public domain (e.g. `localhost` in dev), subdomains are also given an A
record to the server IP. If no server IP is configured, the dashboard shows the record without a
value and a note that the server IP isn't configured, so set it on any real server.

**Server public IP.** A superadmin sets it in the admin app under **Settings → Networking**
(IPv4, plus an optional IPv6 that is used for AAAA records only when no IPv4 is set). A value
saved there overrides the `PUBLIC_IP` env var (`PUBLIC_IPV6` also works as the IPv6 fallback) and
applies right away, with no API restart. The page shows where each value comes from ("set here",
"from API environment", "not set"). Its **Detect** button asks ipify.org, from the API server,
which address the server's outbound traffic uses and fills in the fields (it doesn't save them).
Behind NAT or a load balancer that address may not be the right one. Changes are audited
(`settings.update`, target `network`).

**Domains in a zone hosted on this platform (automatic).** If the domain, or its closest parent,
is a DNS zone hosted here (**DNS** page) by the same organization, the zone already proves
ownership: the domain is `verified` right away (no TXT record needed), and the platform creates
the routing record in that zone for you (it shows as **auto-configured**). It never overwrites an
existing, different record for that name. If one exists, the conflict is reported and you
decide whether to replace it on the DNS page. Removing the domain later deletes only the record
the platform created. Those records only take effect once the zone is delegated to the platform
nameservers (`DNS_NAMESERVERS`, default `ns1/ns2.<DNS_BASE_DOMAIN>`) at your registrar. Verify
warns you if public DNS shows other nameservers.

**Choosing where a hosted domain points.** For a domain in a hosted zone, the domain's card has a
**DNS target** section. It shows the current A/AAAA/CNAME record as stored in PowerDNS (marked
*managed by the platform* or *not created by the platform*) and lets you pick one of two targets:
**Point to the platform** (the default: A to the server IP, or CNAME to the app host) or
**Custom IP** (an A or AAAA record with one or more addresses you enter), plus a TTL. The API call
is `PUT /v1/apps/:id/domains/:domainId/target`. If saving would replace a record the platform
didn't create, you have to confirm first. Afterwards the platform tracks the new record as its own
(`autoRecordType`/`autoRecordValue`), so removing the domain deletes only those values. A custom IP
only sends traffic to this app if the address actually reaches this server (for example a load
balancer or floating IP). For domains whose DNS is hosted elsewhere, the card shows the record to
create at your provider, with the current server IP.

**Live status.** Each domain card shows what public DNS (1.1.1.1 / 8.8.8.8) returns for the domain,
what the platform's PowerDNS has for it, and whether the zone is delegated to the platform
nameservers. The badges are **Live**; **Platform record set, domain not delegated** (with the
nameservers currently in use); **Points elsewhere (x.x.x.x)**; **No routing record**; and
**Not resolving**. Results are cached on the server for 30 s. **Refresh** re-queries, at most once
every 5 s (`GET /v1/apps/:id/domains/:domainId/status?refresh=1`).

**External domains (manual).**

1. Enter the domain and click **Add domain**. It starts as `pending`, and the UI shows the records
   to create at your DNS provider (with copy buttons):
   - a **TXT** record at `_upande-challenge.<domain>` containing the verify token, and
   - the routing record from the table above.
2. Click **Verify**. The API looks up the TXT record. On a match the domain becomes `verified`.
   On a failure it becomes `failed`, and the UI says which host was queried, what was found
   (the TXT values, or NXDOMAIN / no records), and what was expected. Verify also checks that the
   routing record points at the platform. A wrong or missing routing record is shown as a
   warning, not a blocker. **Re-check** runs the checks again at any time.
3. **Redeploy the app.** Verified domains are attached as Traefik routes at deploy time, so a
   new deployment makes the domain live.

TLS: set `ACME_RESOLVER` in `apps/api/.env` (matching the resolver in
`services/proxy/traefik.yml`) to issue Let's Encrypt certificates for custom domains. This is
for the VPS with public domains. Locally, custom domains stay HTTP. A domain can only be
attached to one app (duplicates are rejected).

---

## GitHub integration (connect repos & push-to-deploy)

Beyond deploying from a public Git URL, a user can connect their **GitHub account** and deploy
straight from their repositories, with new commits auto-deploying.

The flow:

1. Configure GitHub OAuth on the server — from the **admin panel** (Settings → GitHub OAuth) or
   with env vars (see below). Create an OAuth App at
   https://github.com/settings/applications/new with callback URL
   `http://localhost:4000/v1/github/callback` (use your public API origin in production).
2. In the dashboard, **Connect GitHub** (`GET /v1/github/authorize` → GitHub → `/v1/github/callback`).
   The connection (token, encrypted) is stored against the user.
3. When creating an app, pick a connected repo (`githubRepoFullName` = `owner/repo`). The API
   installs a push webhook on that repo.
4. Pushing to the repo hits `POST /v1/github/webhook/:appId`, which enqueues a deploy — commits
   ship automatically.

Disconnect anytime from the dashboard (`DELETE /v1/github/disconnect`). If GitHub OAuth is not
configured, the API returns a clear `GITHUB_NOT_CONFIGURED` error and the UI hides the feature.

**Option A — admin panel (recommended, no restart):** as the superadmin open
**Settings → GitHub OAuth**. The page shows the exact *Homepage URL* and *Authorization callback
URL* to paste into GitHub (with copy buttons), then takes the client ID, client secret and an
optional state secret. Values saved there are stored in the `Setting` table (secrets encrypted
with `ENCRYPTION_KEY`, never returned by the API), override the env vars below and take effect
immediately. **Test** checks the pair with GitHub; **Clear stored values** reverts to the env vars.
API: `GET/POST /v1/admin/settings/github`, `POST /v1/admin/settings/github/test` (superadmin, audited).

**Option B — environment:** configure it in `apps/api/.env` (used for any value not set in the
admin panel; `API_PUBLIC_URL` / `DASHBOARD_URL` are env-only):

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_STATE_SECRET=...        # optional; blank falls back to JWT_SECRET
API_PUBLIC_URL=http://localhost:4000     # used to build callback + webhook URLs
DASHBOARD_URL=http://localhost:5173      # post-connect / post-login redirect target
```

### Sign in / sign up with GitHub

The same OAuth App also powers **Sign in with GitHub** (dashboard login page) and **Sign up with
GitHub** (register page). The buttons appear automatically once a client ID and secret are
configured — in admin Settings → GitHub OAuth or via `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
(`GET /v1/auth/github/config` → `{ enabled }`).

- **GitHub OAuth App settings:** keep the single *Authorization callback URL*
  `<API_PUBLIC_URL>/v1/github/callback`. Sign-in returns to the sub-path
  `/v1/github/callback/login`, which GitHub accepts under that registered URL — no second URL
  needed. (If you use a *GitHub App* instead of an OAuth App, add
  `<API_PUBLIC_URL>/v1/github/callback/login` as an extra callback URL.)
- **Scopes:** sign-in asks only for `read:user user:email` (identity + verified emails). It never
  gets repo access; connecting repos for deploys remains a separate consent (`repo read:user`).
- **Flow:** `GET /v1/auth/github/start?mode=login|signup[&org=<slug>][&redirect=/path]` sets a
  short-lived HttpOnly nonce cookie and redirects to GitHub with an HMAC-signed `state`
  (10 min TTL, bound to that cookie). GitHub returns to `/v1/github/callback/login`, which issues
  the normal platform JWT and redirects to `<DASHBOARD_URL>/auth/github#token=…` (fragment, so it
  isn't sent to servers or leaked via `Referer`). Failures redirect to the login/register page with
  `?github_error=…`.
- **Account matching:** a user already linked to that GitHub id (`User.githubId`) signs in; else a
  user whose email matches one of the GitHub account's **verified** emails is linked and signed in;
  else, in sign-up mode only, a new regular `user` is created in the organization named by the
  slug (same rule as web registration: you join an existing org). Username comes from the GitHub
  login, email from the primary verified GitHub email. GitHub-created accounts have no password —
  use **Forgot password** to set one if you want password sign-in (needed for deleting the account).
- Connecting GitHub for repos also links the GitHub id, so those users can sign in with GitHub.
- The **superadmin** can never sign in, be linked, or be created via GitHub — password only.

### Pull request integration (commit statuses & preview comments)

For apps created from a connected GitHub repo, deploys are reported back to GitHub like the
Vercel bot. Both features are **on by default** and can be switched off per app on the app page
(**GitHub** section → *Commit status checks* / *Pull request comments*; API:
`PATCH /v1/apps/:id { githubCommitStatus, githubPrComments }`).

- **Commit status checks.** When a production or preview deploy of a commit starts, succeeds or
  fails, the API sets a commit status on that SHA (`POST /repos/:repo/statuses/:sha`): context
  `Upande Cloud — production` or `Upande Cloud — preview`, state `pending` → `success` /
  `failure` (`error` for platform errors), a short description (the failure reason, credentials
  redacted) and `target_url` = `<DASHBOARD_URL>/apps/<appId>?deployment=<deploymentId>`.
  *Pending* is set once the commit is known (after the clone).
- **Pull request comment.** When a branch preview deploys and the branch has an open pull
  request (looked up with `GET /repos/:repo/pulls?head=owner:branch`, or known from a
  `pull_request` event), the API posts **one** comment with the preview URL, status, commit SHA
  and a link to the deploy log, stores its id on the preview (`Preview.githubCommentId`) and
  **edits that same comment** on every later deploy (a comment deleted on GitHub is re-posted).
- **`pull_request` webhook events** (same webhook URL): `opened` / `reopened` / `synchronize` /
  `ready_for_review` make sure the PR's head branch has a preview on the head commit (skipped when
  the `push` event already deployed that commit); `closed` (merged or not) deletes the preview and
  edits the comment to *Preview removed*. PRs from forks are ignored (the branch is not in the
  app's repository).
- GitHub calls use the **app owner's** GitHub connection (the OAuth token of the user who owns the
  project, scope `repo read:user`) with a 10 s timeout. A GitHub error or outage **never fails a
  deploy** — it appears as a `Warning: GitHub … failed (HTTP 503 …) — the deploy is not affected`
  line in the deploy log. Tokens are never logged.

**What to configure on GitHub**

- The OAuth App needs nothing extra: the `repo` scope that connecting already requests covers
  commit statuses (`repo:status`), reading pull requests and writing PR comments.
- Webhook events: apps created from now on get a webhook subscribed to **`push`** and
  **`pull_request`**. For apps created earlier, open the repo's *Settings → Webhooks →* the Upande
  Cloud hook (`<API_PUBLIC_URL>/v1/github/webhook/<appId>`) → *Let me select individual events* →
  tick **Pushes** and **Pull requests**. Without `pull_request` events, previews and comments
  still follow pushes, but closing a PR won't remove its preview.
- If you use a *GitHub App* instead of an OAuth App, grant repository permissions **Commit
  statuses: Read & write**, **Pull requests: Read & write**, **Issues: Read & write** (PR comments
  use the issues API), **Contents: Read**, **Webhooks: Read & write**, and subscribe to the *Push*
  and *Pull request* events.
- GitHub Enterprise Server: set `GITHUB_API_URL` (e.g. `https://ghe.example.com/api/v3`) and
  `GITHUB_OAUTH_URL` (`https://ghe.example.com/login/oauth`), or the DB settings `github_api_url` /
  `github_oauth_url`. The same override points the integration at a local stub API in tests.

---

## Managed per-app databases (full-stack apps)

When you deploy a **full-stack** app, the platform automatically provisions a dedicated
PostgreSQL database and a scoped role **inside the shared Postgres server**, and injects a
`DATABASE_URL` into the app container at deploy time. You do not create or wire up a database by
hand — the app gets one on its first deploy.

Key points:

- The per-app database is separate from the control-plane database; each app gets its own DB and
  least-privilege role.
- The connection string injected into the container uses the **`postgres` service host** on
  `upande_net` (not `localhost`), because the app container talks to Postgres over the Docker
  network.
- A provisioning failure is fatal for that deploy (the app cannot run without its database).

Configure it in `apps/api/.env`:

```
# Admin DSN used to run CREATE ROLE/DATABASE (defaults to DATABASE_URL — the `upande` superuser)
# APP_DB_ADMIN_URL="postgresql://upande:changeme@localhost:5432/upande"

# How the APP CONTAINER reaches Postgres (the compose service name, not localhost)
APP_DB_HOST=postgres
APP_DB_PORT=5432
```

---

## Deployments: history, rollback, health checks, previews

**Deploy history & logs.** The app page lists every production deployment
(status, commit, branch, who/what triggered it — user, GitHub push, API token,
rollback, admin — start time, duration). **Log** opens that deployment's full
build log: the live Redis copy while it runs, then the copy persisted to
Postgres when it finishes (capped at `DEPLOY_LOG_MAX_BYTES`, tail kept).

**Rollback.** **Redeploy** on an earlier successful deployment rolls back to it,
recorded as a new deployment (trigger `rollback`). The images of the last
`IMAGE_RETENTION_COUNT` successful deploys are kept, so a rollback normally
reuses the image (no rebuild); if it was pruned, a git app rebuilds that exact
commit. The app's *current* env vars and settings are applied. Not available for
Node-RED or for pruned upload builds.

**Health checks.** Every deploy starts the new image next to the running one
(unrouted), probes it over the Docker network and only swaps it in when healthy;
otherwise the deploy is marked failed and the current version keeps serving.
Per app (**Health check** section): a path (must return 2xx/3xx; empty = any
non-5xx answer on `/`; static sites always use the latter), per-probe timeout
and number of attempts.

**Zero-downtime swap.** The healthy new container is started *next to* the live
one with the same Traefik labels, so Traefik load-balances both (a `retry`
middleware on every app/preview router re-sends requests the booting one
refuses); once it passes the health check the old container is removed and the
new one takes its name. If the new version is unhealthy it is removed and the old
one never stopped. When the router labels change (first deploy after an upgrade,
custom domains added/removed, preview password toggled) or for Node-RED (shared
data volume) the old stop → start swap with restore-on-failure is used.
Database-backed apps (full stack, or any `DATABASE_URL`) skip the throwaway
candidate — it would boot (migrations, workers) against the production database
— and are health-checked once, in place, before the old container is retired.
A dynamic / full-stack app whose env sets a numeric `PORT` is routed and
health-checked on that port (static sites always use 8080).

**Cancel / delete during a deploy.** **Cancel** stops queued retries and marks the
deploy cancelled; the live container keeps serving (it is never removed) and no
global build-cache prune runs. A running deploy notices the cancellation (or the
app / preview being deleted) before it touches the live container and stops; if
the app was deleted during the swap, the just-started container is removed.
Deployments left `queued`/`building` without a queue job (API restart, crash) are
failed after `STALE_DEPLOY_MINUTES` (default 5) by a sweeper that runs every
`STALE_DEPLOY_SWEEP_SECONDS` (default 120); the app/preview returns to `live` if
its container still serves, else `failed`. Preview databases are named
`pvdb_<host>_<hash of the preview id>`, so two long branch names never share one.

**Auto-restart.** App containers run with `APP_RESTART_POLICY` (default
`on-failure:5`): a crashed app is restarted up to 5 times, then Docker gives up
and the app page shows **Crashed · gave up after 5 restarts** instead of an
endless crash loop. Restart counts show in the app header. `unless-stopped` /
`always` retry forever. Note: `on-failure` does not restart a container that
exited cleanly (e.g. after a Docker daemon/host restart where the app exited 0);
use `unless-stopped` if apps must come back after a reboot. The policy applies
to containers created by a (re)deploy — existing containers keep theirs until
redeployed.

**Preview deploys per branch.** The **Preview deploys** section on the app page
deploys any non-production branch of a git app to its own URL,
`<app>-<branch-slug>.<BASE_DOMAIN>` (e.g. `shop-feature-login.localhost`),
in a separate container (`upande-preview-<host>`) with its own image and Traefik
router — the production container, status, history and rollback images are
never touched. Custom domains are not routed to previews.

- **Databases:** previews never get the production database. For full-stack
  apps (or any app whose env vars set `DATABASE_URL`) each preview gets its own
  empty, throwaway Postgres database, injected as `DATABASE_URL` and dropped
  when the preview is deleted (a `DATABASE_URL` env var of any scope never
  reaches a preview). Other env vars follow their **environment scope** (see
  below). Previews also get `UPANDE_PREVIEW=true` and `UPANDE_PREVIEW_BRANCH`.
- **GitHub push:** with push-to-deploy installed, a push to the tracked branch
  deploys production; a push to any other branch creates/updates that branch's
  preview (turn off with `PREVIEW_AUTO_DEPLOY=false`), and deleting the branch
  on GitHub deletes its preview.
- **Limits:** `PREVIEW_MAX_PER_APP` (default 3) and `PREVIEW_MAX_PER_ORG`
  (default 10) active previews; delete one to deploy another.
- **Delete** removes the container (and with it the Traefik router), its images,
  the throwaway database and the preview's deployment rows/logs. Deleting the
  app removes all its previews.
- Not available for Node-RED or uploaded apps (no branches). On a VPS the
  preview hosts need the same wildcard DNS (`*.<BASE_DOMAIN>`) as apps; TLS is
  requested per host via `ACME_RESOLVER` like any app.

**Source & data safety.** Repository URLs must be `http(s)://` git URLs —
`file://` URLs and local paths are rejected on create/update and at deploy time
(they would let an app publish files from the server). Deleting an app (or a
user's account) cancels its queued deploys and drops its managed production
database and role; a leftover database with no owning app is never adopted by a
new app with the same subdomain (the deploy fails with a message to drop it).
Secret columns (webhook secret, password hashes, encrypted passwords) are
stripped from every API response.

**Sessions.** Session JWTs are only accepted in the `Authorization` header.
Event streams (`EventSource` can't send headers) use a 60-second *stream ticket*
from `POST /v1/auth/stream-ticket` as `?token=`; tickets only open GET streams
and are refused as bearer tokens. Admin "Login as user" links carry the token in
the URL fragment (`/impersonate#token=…`, never sent to a server) and the
dashboard scrubs it from history. Every JWT carries the user's session
generation (`User.tokenVersion`); changing or resetting a password (or an admin
setting one) bumps it, so all older sessions stop working (the password change
itself returns a fresh token). A 401 on any request sends the dashboard/admin to
the login page; network errors / 5xx no longer sign you out.

**Framework detection.** Before the first deploy the **New App** form detects the
framework of the chosen repository + branch (Next.js, Nuxt, Remix, SvelteKit, Astro,
Gatsby, Docusaurus, Angular, Create React App, Vue CLI, Vite + React/Vue/Svelte/…,
Parcel, NestJS/Express/Fastify/Koa/Hono, plain HTML, Dockerfile, Python/Go) and
shows the suggested site type, build/start command, output dir, package manager,
Node version and build-time env prefix (`VITE_`, `NEXT_PUBLIC_`, …). The site type
is pre-selected (unless you pick one) and a non-default static output dir (e.g.
`build`, `out`, `dist/<app>/browser`) is saved with the app. A database driver/ORM
in the dependencies suggests **Full stack**. On an existing app, **Configuration →
Detect framework** compares the detection with the app's settings and offers
**Apply suggested settings**. Detection reads only the file list and a few small
config files (blobless, no-checkout shallow clone; the user's GitHub token for
private github.com repos) — nothing is built or run. API:
`POST /v1/frameworks/detect` `{ repoUrl, branch? }` (http(s) URLs) and
`GET /v1/apps/:id/framework` (git or uploaded apps).

**Environment-scoped env vars.** Each env var (**Environment variables** section,
API `GET/POST /v1/apps/:id/env`, `PATCH/DELETE /v1/apps/:id/env/:envId`,
`?scope=` filters) has a scope: **All** (default; every existing var),
**Production** or **Preview**. Production deploys get all + production, previews
all + preview. The same key may exist once per scope (unique per app, key,
scope); a scoped value beats the **All** one (e.g. `API_URL` All + `API_URL`
Preview → previews get the Preview value). Secret values are write-only (never
returned by the API; stored and injected as before). Changes apply on the next
deploy.

**Promote preview to production.** **Promote** on a live, healthy preview makes
production run that preview's already-built image — no rebuild — through the
normal production path: health-checked candidate, zero-downtime swap, and a new
production deployment in the history (trigger `promote`, ref = the preview
branch, its commit, `triggerDetail` = branch + preview deployment id). The image
is re-tagged into the production repo (`upande-app-<subdomain>:<deployment id>`)
so it is kept for rollback (`IMAGE_RETENTION_COUNT`) even after the preview is
deleted; **Redeploy** on the previous deployment rolls it back. Only the image
is reused: the container starts with **production**-scoped env vars and the
production database. For static / full-stack apps whose build-time vars
(`VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`, `NUXT_PUBLIC_`, `PUBLIC_`, `GATSBY_`)
differ between preview and production, the confirm dialog warns that the image
has the preview values baked in and offers **Rebuild & promote** (builds the
preview's commit in the production pipeline) or **Promote image anyway**. A
pruned preview image is always rebuilt from its commit. API:
`GET /v1/apps/:id/previews/:previewId/promote` (checks) and `POST …/promote`
(`{ "rebuild": true }` to rebuild). Audit action `app.preview.promote`.
Note: the platform does not currently pass env vars into the image build, so a
rebuild bakes whatever the repository itself provides.

**Password-protected previews.** **Protect previews** (Preview deploys section,
or `GET/PUT/DELETE /v1/apps/:id/preview-protection` with
`{ "username"?, "password" }`) puts every preview URL of the app behind HTTP
basic auth (default username `preview`, password 8–128 chars). It is a Traefik
`basicAuth` middleware on each preview's own router (`pv-<host>`) only —
production and custom domains are never protected. Only a bcrypt hash is stored
(`PreviewProtection` table) and placed in the labels; the password is never
stored. Enabling, changing or removing the password recreates the existing
preview containers from their current image/env with the new labels (a ~1s blip
per preview, no rebuild), and new preview deploys pick it up when their
container starts. Protected previews show a lock badge. Audit actions
`app.preview.protection.enable|update|disable`.

### Build cache

Repeat deploys of the same app reuse a **per-app build cache** (never shared between apps, so
never between organizations):

- **Dependency layer.** For Node projects built with the generated Dockerfile, only the manifest +
  lockfile (`package.json`, `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`, `.npmrc`) are
  copied before the install (`npm ci`, `yarn install --frozen-lockfile`, `pnpm install
  --frozen-lockfile`, detected from the lockfile / `packageManager`), then the source. The install
  layer is reused as long as the lockfile is unchanged; a source-only change re-runs just the
  build. Monorepo workspaces, install hooks (`preinstall`/`postinstall`/`prepare`) and Yarn Berry
  install with the full source instead (safe mode). An `ARG UPANDE_CACHE_SCOPE=<app>` in the
  builder stage is part of every RUN cache key, which keeps layers per app.
- **BuildKit cache mounts** (when the docker CLI has the `buildx` plugin — installed in the API's
  production image; `DOCKER_BUILDKIT=0` forces the legacy builder): the package manager cache
  (`/root/.npm`, yarn / pnpm store) and framework caches (`.next/cache`, `node_modules/.vite`,
  `node_modules/.cache`) live in cache mounts with per-app ids (`ubc-<appId>-*`), so even a
  lockfile change reuses downloaded packages. Nixpacks builds get `--cache-key ubc-<appId>`.
- **Deploy log.** After the build a line reports it, e.g. `Build cache hit: used build cache for
  13 of 15 steps — dependency install restored from cache (legacy builder); app build cache now
  84 MB`.
- **Clear build cache & redeploy** (app page button, or `POST /v1/apps/:id/deploy
  { "clearCache": true }`) deletes this app's cache and runs a clean, rollback-safe rebuild (the
  same pipeline as Migrate; history shows *Clear cache & deploy*). `GET /v1/apps/:id/build-cache`
  returns its size. Migrate and automatic retries also clear only this app's cache (previously they
  pruned the whole Docker builder cache).
- **Bounded.** Deleting an app deletes its cache. A scheduled job (`BUILD_CACHE_PRUNE_INTERVAL_MINUTES`,
  default 60) removes cache entries unused for `BUILD_CACHE_MAX_AGE_DAYS` (14) and, above
  `BUILD_CACHE_MAX_GB` (10), the least-recently-used entries until under the cap; if the daemon's
  whole BuildKit cache exceeds the cap it is trimmed to it. Only the platform's own entries
  (labelled `upande.build-cache` layers, `ubc-*` cache mounts) are pruned by age/per app.
- Measured on a Vite + React app (legacy builder, dev machine): first deploy 47 s, redeploy with no
  change 2.6 s, source-only change 6.2 s; with BuildKit a lockfile change rebuilt in 4 s instead of
  a full reinstall.

## Uptime monitoring & graphs

**Monitor.** Every `UPTIME_CHECK_INTERVAL_SECONDS` (default 60) the API probes
each production app whose status is **live** (all types, Node-RED included)
over the Docker network, container IP — not through Traefik — using the app's
**Health check** settings: the configured path must return 2xx/3xx, otherwise
any non-5xx answer on `/` counts as up (static sites always use the latter).
Each probe is capped at `UPTIME_CHECK_TIMEOUT_SECONDS` (default 5, or the app's
shorter timeout); a failed probe is retried once after 1s so one dropped
connection isn't recorded as an outage. At most `UPTIME_CHECK_CONCURRENCY`
(default 5) apps are probed at a time. A missing, exited or crash-looping
container is recorded as down with that reason (e.g. `container is not running
(exited, exit code 2)`), as are timeouts, refused connections and bad HTTP
statuses. Stopped, idle, failed and building apps are not probed (their gaps
show as **no data**, never as downtime); previews are not monitored. A failed
redeploy that left the previous version serving stays live and keeps being
monitored.

Each check is stored in `UptimeCheck` (app, time, up, HTTP status, response
time, error). Raw checks older than `UPTIME_RETENTION_DAYS` (default 30) are
deleted daily. The schedule runs as BullMQ job schedulers on the `uptime`
queue (upserted by id in Redis), so restarts or several API instances never
run it twice. `UPTIME_MONITOR_ENABLED=false` turns it off.

**Graphs.**
- **Dashboard → app page → Uptime:** 24h / 7d / 30d tabs; uptime %, average
  response time, incident count and current state; an availability chart
  (15-minute buckets for 24h, hourly for 7d, daily for 30d — blue up, red
  down, grey no data), a response-time line, and the incidents list (start,
  duration, reason; ongoing ones flagged).
- **Admin → Metrics → Uptime:** platform uptime %, monitored sites, sites down
  now, a platform-wide availability chart and a per-site table (customer,
  current state, uptime %, average response time), worst first.

**API.** `GET /v1/apps/:id/uptime?range=24h|7d|30d` (org-scoped) and
`GET /v1/admin/uptime?range=…` (admins). Each bucket has `checks`, `up`,
`upRatio` (`null` = no data) and `avgLatencyMs`; incidents are contiguous
runs of down checks, ending at the next up check.

---

## Notifications

The dashboard shows in-app notifications via a bell in the top bar. Two kinds are raised today:

- **Impersonation alert** — a user is told when an operator has impersonated their account.
- **Deployment-failure alert** — the app owner is notified when one of their deployments fails.

Endpoints: `GET /v1/notifications` (unread), `POST /v1/notifications/:id/read`,
`POST /v1/notifications/read-all`. On the admin side, deployment-failure notifications are
aggregated cross-tenant into an operator **Errors** view. Notifications carry structured
metadata (who impersonated, which deployment failed) for context.

A third kind, **Support message** (`support_message`), is raised by the
[support chat](#support-chat) whenever the other side posts a message.

### New-notification alerts

Both apps alert you when a notification arrives while you have the app open:

- **Toast.** A toast shows the notification's title and message. Click it to go to the page it
  is about: the deploy error, or the support conversation. Otherwise it opens the bell.
- **Sound.** A short chime plays. A deployment failure plays the falling "failure" tone instead.
- **Badge and tab title.** The bell's unread badge goes up, and the browser tab title shows the
  unread count, e.g. `(3) Upande Cloud — Dashboard`.
- **Desktop notification (opt-in).** Open the bell and click **Enable desktop notifications**
  (the browser then asks for permission). After that, a system notification is also shown,
  but only while the tab is in the background. Click **Disable** to turn it off. The setting
  is saved per browser.

Only notifications that are new in this session raise an alert. Anything that already existed
when the page loaded is listed but does not alert. The bell polls every 20 s, and also
refreshes right away when the support-chat stream reports a new message. In the admin panel,
the bell lists new cross-tenant deployment errors plus the admin's own support-message
notifications.

---

## Support chat

Users and the platform team can chat about an issue without leaving Upande Cloud.

**Users (dashboard).** Open the **Support** tab in the sidebar, or click the round chat button
at the bottom-right of any page. Click **New conversation**, pick a category (**Issue**,
**Inquiry**, **FAQs** or **Custom**) and write your first message (max 5000 characters). The
first three are titled by their category name. **Custom** asks for your own title (required,
max 200 characters). Everyone in your organization can see and reply to the organization's
conversations. The list is grouped by who started each conversation, with **You** first. Each
item shows its reference, title, status and last activity. Press Enter to send and Shift+Enter for a new line.
Replies from the team always appear as **Upande Support**. Unread replies show as a badge on
the Support tab and on the chat button. You can **Close** a conversation and **Reopen** it
later. You can't send into a closed conversation until it is reopened.

**References.** Every conversation gets a permanent reference such as `ISSUE-0001`,
`INQUIRY-0001`, `FAQS-0001` or `CUSTOM-0001`. Each category has its own counter. Numbers are
padded to at least 4 digits and keep growing past that (`ISSUE-10000` follows `ISSUE-9999`).
The database assigns the reference in a `BEFORE INSERT` trigger (`upc_support_reference()`,
one Postgres sequence per category), so concurrent creates never collide. The reference and
category can't change after that. The reference shows as a small badge in lists, thread
headers and notifications ("New reply on ISSUE-0003 …").

**Admins (admin panel).** The **Support** tab is an inbox of every organization's
conversations, grouped by organization (collapsible, with counts and unread totals) and then
by the user who started each conversation. You can filter by Open / Unread / Closed / All, by
category and by organization, and search by reference (`ISSUE-0003`, `issue-3`) or title. The
floating inbox uses the same grouping in compact form. Replies are sent as Upande Support: users
see only that name, while admins see which admin wrote each reply. The thread header has
Close/Reopen and an **Impersonate** button for the user who started the conversation. The
floating chat button opens a compact inbox and thread on every admin page.

**Resolution.** On an open conversation an admin clicks **Ask if resolved** (**Ask** in the
floating inbox). A question card is posted into the thread, worded by category: Issue "Is this
issue solved?", Inquiry "Did this answer your inquiry?", FAQs "Did this answer your
question?", Custom "Is this resolved?". The org members in the thread get a notification
such as "Is ISSUE-0003 solved?". Any member of the organization can answer on the card
(not during an impersonation session):

- **Yes** posts "Marked as solved by <username>" and closes the conversation
  (`resolution = solved`, `resolvedAt`, `resolvedByUserId`; audit `support.conversation.resolved`).
- **No** posts "Not solved yet", keeps it open (`resolution = unsolved`) and notifies the
  admins (bell + chime).

Only the latest question can be answered. Asking again supersedes a pending one, and normal
replies still work while one is pending. Answered cards show the outcome instead of buttons.
Lists and headers show **Awaiting answer** while a question is pending and **Solved** once
answered Yes. Reopening clears the resolution; a manual close drops a pending question.
Messages carry `kind` (`text`, `resolution_request`, `resolution_answer`) and, for answers,
`answer` (true = solved), in API responses and SSE events.

**Sound.** Each message from the other side plays a short "message" chime as it arrives.
This happens even if the chat is open. You hear it at most once per message across the
page, the floating widget and the bell. A burst of messages plays one chime. History that
loads when you open the page never chimes. The speaker icon in the chat header mutes the
chime, and the setting is saved per browser.

**Real time.** Each side has a Server-Sent Events stream: `GET /v1/support/stream` and
`GET /v1/admin/support/stream`. The JWT is passed as `?token=`, because EventSource can't send
headers. The stream pushes new messages and conversation changes (status, unread counts). One
stream per tab is shared by the sidebar badge, the Support page and the floating widget. If
the stream drops, the UI reconnects with backoff and polls in the meantime.

**Notifications.** Each new message creates a `support_message` notification for the other
side, so the [new-notification alerts](#new-notification-alerts) show it:

- **A user writes:** every active admin/superadmin is notified.
- **An admin replies:** the organization members taking part in the conversation are notified.
  That means its creator plus any member who has posted in it. If none of them are still
  active, every active member of the organization is notified instead. Other members' bells
  stay quiet about threads they are not part of, but the org can still see every
  conversation on the Support page.
- **Opening a conversation** marks it read and clears your bell entries for it.

**API.**

| User side (`/v1/support`, own organization only) | Admin side (`/v1/admin/support`, admin/superadmin) |
| --- | --- |
| `GET conversations?status=open\|closed` | `GET conversations?status=&unread=true&organizationId=&category=&q=` |
| `POST conversations` `{category, title?, body}` (`title` only for `custom`) | – |
| `GET conversations/:id` (conversation + messages) | `GET conversations/:id` |
| `POST conversations/:id/messages` `{body}` | `POST conversations/:id/messages` `{body}` |
| `POST conversations/:id/read` | `POST conversations/:id/read` |
| `POST conversations/:id/close` / `reopen` | `POST conversations/:id/close` / `reopen` |
| `POST conversations/:id/resolution` `{solved}` (409 when nothing is pending or it's closed) | `POST conversations/:id/ask-resolution` (409 when closed) |
| `GET unread`, `GET stream` (SSE) | `GET unread`, `GET stream` (SSE) |

The organization always comes from the caller's JWT. A conversation from another organization
returns 404. Sends are rate-limited per user (20 per minute, then 429). Creating, closing and
reopening a conversation is audit-logged as `support.conversation.create|close|reopen`;
individual messages are not. During an impersonation session the user-side chat is read-only.
Data lives in `SupportConversation` / `SupportMessage` (migrations
`20260925180000_support_chat` and `20260925233000_support_categories`). Conversations include
`reference`, `category` and `title`. A conversation keeps a separate unread counter for each side,
and is deleted along with its organization.

---

## VPS installation from source (Ubuntu)

> For most servers, prefer the [`zone` CLI](#install-with-the-zone-cli-servers) — it pulls
> prebuilt images and needs no source on the box. The steps below are the manual, build-from-
> source alternative.

The platform runs on a VPS exactly as it does locally, with three differences: a real domain,
TLS via Let's Encrypt, and the services locked down. These steps assume Ubuntu 22.04 or 24.04.

### 1. Install prerequisites

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"     # log out/in afterwards

# Node.js 20+ (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 2. Point DNS at the server

In your DNS provider, create records pointing at the server's public IP:

```
A     @              <server-ip>      # yourdomain.com (optional, for the API/dashboard)
A     *.yourdomain.com   <server-ip>  # wildcard, so every app slug resolves
```

The wildcard record is what lets `<app-slug>.yourdomain.com` work without per-app DNS changes.

### 3. Get the code and configure

```bash
git clone <your-upande-cloud-repo-url> upande-cloud
cd upande-cloud
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Edit `.env`:

- Set a strong `POSTGRES_PASSWORD` and `JWT_SECRET`.
- Set `DOMAIN=yourdomain.com` (uncomment it).

Edit `apps/api/.env`:

- Set `BASE_DOMAIN=yourdomain.com`.
- Set a strong `JWT_SECRET` and a real `ENCRYPTION_KEY`.
- Set `DATABASE_URL` to match your PostgreSQL credentials. When the API runs on the host,
  use `localhost`; when run as a container on `upande_net`, use the host `postgres`.

### 4. Enable TLS in Traefik

Open `services/proxy/traefik.yml` and `docker-compose.yml` and switch from local to VPS mode
(the VPS lines are present but commented):

- Uncomment the `websecure` entrypoint on `:443` and expose `443:443` in compose.
- Uncomment the `certificatesResolvers.letsencrypt` block and set a real contact email.
- Uncomment the HTTP-to-HTTPS redirect.
- Set the Traefik API `insecure: false` (do not expose the dashboard publicly).
- For app routers, change the host rule from `*.localhost` to `*.yourdomain.com` and add
  `tls=true` with `tls.certresolver=letsencrypt`.

See `services/proxy/README.md` for the exact lines.

### 5. Bring it up

```bash
docker compose up -d

cd apps/api
npm install
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"   # faster engine download
npm run prisma:generate
npm run prisma:migrate
npm run build
npm run start            # or run under a process manager / systemd
```

Build the frontends for production and serve the static output (through Traefik or any static
host):

```bash
cd ../dashboard && npm install && npm run build   # output in dist/
cd ../admin && npm install && npm run build        # output in dist/
```

Point a Traefik router at each `dist/` (or serve them with a small nginx container on
`upande_net`). The dashboard and admin panel are then reachable over HTTPS on your domain.

### 6. Hardening checklist (VPS)

- Run the API under systemd or a process manager so it restarts on failure and on reboot.
- Do not expose the Traefik dashboard (port 8080) publicly.
- Restrict the firewall to ports 80, 443, and SSH.
- Back up the PostgreSQL volume on a schedule.
- Keep `JWT_SECRET` and `ENCRYPTION_KEY` secret and stable (rotating `ENCRYPTION_KEY`
  invalidates stored encrypted env vars).

---

## GitHub Actions auto-deploy

Push to a repo and have it deploy to Upande automatically. The workflow calls the Upande deploy
API with a per-app deploy token.

For local testing (no public URL yet), the workflow is run on this machine with `act`, which
executes the workflow in Docker against your local API. See `ci/README.md` for the full
procedure. In short:

1. In the dashboard, create a deploy token for an app.
2. Store it for `act` in a `.secrets` file (a `.secrets.example` is provided).
3. Run `act push` with the provided `ci/.actrc`.

The same `.github/workflows/deploy.yml` works unchanged on real GitHub Actions once the VPS is
live; only the API base URL and where the secret lives change.

---

## Environment variables

### Root `.env` (infrastructure)

| Variable | Example | Description |
| --- | --- | --- |
| `POSTGRES_USER` | `upande` | PostgreSQL user created in the container |
| `POSTGRES_PASSWORD` | `changeme` | PostgreSQL password (set a strong one) |
| `POSTGRES_DB` | `upande` | Database name |
| `REDIS_HOST` / `REDIS_PORT` | `redis` / `6379` | Redis location on `upande_net` |
| `JWT_SECRET` | long random string | Shared JWT signing secret |
| `DOMAIN` | `yourdomain.com` | VPS only; your real domain |

### `apps/api/.env` (API)

| Variable | Example | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://upande:changeme@localhost:5432/upande` | Prisma connection string |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis for BullMQ |
| `JWT_SECRET` | long random string | Must match the value the API signs/verifies with. At least 32 characters (`openssl rand -hex 32`): the API refuses to start in production when it is missing, the default or shorter (development only warns) |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Which proxies may set `X-Forwarded-For` (client IP for audit logs / rate limits). Default: only loopback / private-network proxies (Traefik, nginx on the host or Docker network). Also accepts a hop count (`1`) or `true`/`false` |
| `STALE_DEPLOY_MINUTES` / `STALE_DEPLOY_SWEEP_SECONDS` | `5` / `120` | Deploys stuck in queued/building with no queue job are failed after this many minutes (sweeper interval) |
| `RATE_LIMIT_DISABLED` | `false` | `true` turns off the built-in rate limits (login 20/5 min per IP and per email, register 10/h, forgot-password 5/15 min, reset/change-password 10/15 min, token deploys 30/min). Limits are in-memory per API process |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `ENCRYPTION_KEY` | 64-char hex | Encrypts stored env-var values & tokens (AES-256-GCM) |
| `BASE_DOMAIN` | `localhost` | App routing domain (`yourdomain.com` on VPS) |
| `APP_HTTP_PORT` | `8090` | Public port for Traefik's HTTP entrypoint locally; `""`/`80` on VPS |
| `APP_HTTP_SCHEME` | `http` | Scheme used to build deployed-app URLs |
| `PUBLIC_IP` | `203.0.113.10` | Server's public IP, used as a fallback. The admin **Settings → Networking** value takes precedence. Custom-domain A records point here (blank everywhere = the UI says it isn't configured). `PUBLIC_IPV6` is an optional IPv6 fallback |
| `DOCKER_NETWORK` | `upande_net` | Network deployed app containers join |
| `APP_DB_HOST` / `APP_DB_PORT` | `postgres` / `5432` | How app containers reach the shared Postgres |
| `APP_DB_ADMIN_URL` | (defaults to `DATABASE_URL`) | Admin DSN for provisioning per-app databases |
| `ACME_RESOLVER` | (blank locally) | Traefik resolver name for custom-domain TLS (VPS) |
| `API_PUBLIC_URL` | `http://localhost:4000` | Public API origin (OAuth callback + webhook URLs) |
| `DASHBOARD_URL` | `http://localhost:5173` | Public dashboard origin (post-connect redirect) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:5174` | Allowed CORS origins (dashboard + admin) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | from GitHub OAuth App | GitHub connect + push-to-deploy (blank = disabled) |
| `GITHUB_STATE_SECRET` | random (or `JWT_SECRET`) | HMAC secret for the OAuth `state` param |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | Password-reset email (blank host = dev mode) |
| `MISTRAL_API_KEY` / `MISTRAL_AGENT_ID` | from console.mistral.ai | AI deploy-log analyzer (blank = disabled) |
| `NODE_ENV` | `development` | Node environment |
| `DEPLOY_LOG_MAX_BYTES` | `2097152` | Max persisted build log per deployment (tail kept) |
| `IMAGE_RETENTION_COUNT` | `5` | Recent successful images kept per app for instant rollback |
| `HEALTH_CHECK_INTERVAL_MS` | `3000` | Pause between deploy health-check probes |
| `UPTIME_CHECK_INTERVAL_SECONDS` | `60` | How often live apps are probed by the uptime monitor (min 10) |
| `UPTIME_RETENTION_DAYS` | `30` | Raw uptime checks kept (older ones deleted daily) |
| `UPTIME_CHECK_TIMEOUT_SECONDS` | `5` | Max time per uptime probe (the app's health-check timeout if shorter) |
| `UPTIME_CHECK_CONCURRENCY` | `5` | Apps probed in parallel per run |
| `UPTIME_MONITOR_ENABLED` | `true` | `false` disables the uptime monitor |
| `APP_RESTART_POLICY` | `on-failure:5` | Restart policy of app containers (`on-failure[:N]`, `unless-stopped`, `always`, `no`) |
| `PREVIEW_MAX_PER_APP` / `PREVIEW_MAX_PER_ORG` | `3` / `10` | Active branch previews allowed per app / per organization |
| `PREVIEW_AUTO_DEPLOY` | `true` | GitHub pushes to non-production branches create/update previews |
| `BUILD_CACHE_ENABLED` | `true` | `false` disables per-app build caching (old Dockerfile layout) |
| `BUILD_CACHE_MAX_GB` | `10` | Cap for the platform's build cache; LRU entries pruned above it |
| `BUILD_CACHE_MAX_AGE_DAYS` | `14` | Build cache entries unused this long are pruned |
| `BUILD_CACHE_PRUNE_INTERVAL_MINUTES` | `60` | How often the build cache prune job runs |
| `DOCKER_BUILDKIT` | (auto) | `0` forces the legacy builder even when buildx is installed |
| `GITHUB_API_URL` / `GITHUB_OAUTH_URL` | `https://api.github.com` / `https://github.com/login/oauth` | GitHub Enterprise Server or a test stub |

See [`apps/api/.env.example`](apps/api/.env.example) for the authoritative, commented list.

### `apps/dashboard/.env` and `apps/admin/.env`

| Variable | Example | Description |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000` | Base URL of the API |

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `docker ps` permission denied | Add your user to the docker group (see One-time Docker setup), then `newgrp docker` or re-login |
| `docker compose` is an unknown command | Install the Compose plugin: `sudo apt-get install -y docker-compose-plugin` |
| `prisma generate` fails with `Error: request to https://binaries.prisma.sh/... failed, reason:` | The Prisma CDN is slow/throttled on your network. Set the faster mirror and retry: `export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"` then `npm run prisma:generate`. Confirm success with `ls apps/api/node_modules/.prisma/client/*.node` |
| `@prisma/client did not initialize yet` on API start | `prisma generate` did not complete (usually the engine download above failed). Set `PRISMA_ENGINES_MIRROR` as shown, re-run `npm run prisma:generate`, then start the API again |
| `whoami.localhost` does not resolve | Add `127.0.0.1 whoami.localhost` to `/etc/hosts` |
| `docker compose up` fails: `failed to bind host port 0.0.0.0:6379: address already in use` | You already run a native Redis on 6379. That is fine — the API uses it. Start the other services only: `docker compose up -d postgres traefik whoami`, or stop the native Redis if you prefer the container |
| Traefik logs `client version 1.24 is too old. Minimum supported API version is 1.44` | The Traefik image predates your Docker Engine. Use `traefik:v3.5` (already set in docker-compose.yml) and recreate: `docker compose up -d --force-recreate traefik` |
| `failed to bind host port 0.0.0.0:80: address already in use` | Another process (often a host nginx/apache) holds port 80. Find it with `sudo ss -ltnp | grep ':80'` and stop it, or change Traefik's published port in docker-compose.yml (e.g. `8088:80`) and use `http://whoami.localhost:8088`. Routing of deployed apps needs port 80 free |
| API cannot connect to the database | Ensure `docker compose up -d` ran, and `DATABASE_URL` host is `localhost` when the API runs on the host |
| Prisma migrate fails | The PostgreSQL container must be running and credentials in `apps/api/.env` must match the root `.env` |
| Build logs never appear in the UI | The API must be running; the dashboard streams logs over SSE from the API |
| Admin panel shows access denied | The account is not admin/superadmin. Create a superadmin from the CLI: `cd apps/api && npm run create-superadmin -- admin@example.com 'pass'` (see Step 9) |
| A deployed app is unreachable | Check it is on `upande_net` with the correct Traefik labels; inspect the Traefik dashboard at `http://localhost:8080` |

---

## Project layout

```
upande-cloud/
  apps/
    api/         NestJS control plane (auth, apps, deploys, admin, deploy engine,
                 github, notifications, per-app database provisioning)
    dashboard/   User-facing React app
    admin/       Operator React app
    zone/        @zonalcloud/zone — standalone operator CLI (install/run/upgrade)
  services/
    proxy/       Traefik configuration and routing docs
  ci/            GitHub Actions deploy workflow and act setup
  scripts/
    install.sh   Bootstrap installer (Node + the zone CLI, then `zone install`)
  packages/
    shared/      Shared TypeScript types (the API contract)
    mcp/         MCP server for AI agents to inspect/act on apps
  .github/workflows/
    deploy.yml   Per-app push-to-deploy workflow
    release.yml  Builds & publishes the api/dashboard/admin images
  docker-compose.yml       Traefik, PostgreSQL, Redis, Mailpit, and a whoami test service
  docker-compose.vps.yml   VPS overlay (TLS / production routing)
  docker-compose.prod.yml  Prebuilt-image production stack
  SPEC.md        The build specification all components conform to
  docs/          Architecture and planning documents
```
