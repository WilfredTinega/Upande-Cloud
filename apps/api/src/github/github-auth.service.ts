import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { slugify } from '../common/slug.util';
import { GithubService } from './github.service';

const STATE_TTL_MS = 10 * 60 * 1000; // same 10-minute window as the connect flow
// HMAC domain separator so a sign-in state can never be replayed as a
// connect state (or vice versa) even though both share the same secret.
const STATE_PURPOSE = 'gh-login';

export const GITHUB_LOGIN_NONCE_COOKIE = 'upc_gh_login';

export type GithubLoginMode = 'login' | 'signup';

interface LoginState {
  m: GithubLoginMode;
  // Organization slug to join (signup only) — registration joins an existing org.
  o: string | null;
  // Same-app relative path to land on after sign-in.
  r: string;
  // Random nonce also stored in an HttpOnly cookie: binds the flow to the
  // browser that started it (prevents login CSRF / session fixation).
  n: string;
  t: number;
}

/** Failure that should be shown to the user on the dashboard login/register page. */
export class GithubLoginError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly mode: GithubLoginMode = 'login',
  ) {
    super(message);
  }
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * "Sign in / Sign up with GitHub" for the dashboard. Reuses the same GitHub
 * OAuth App as the repo-connect flow but with a login-only scope, and issues the
 * platform's normal JWT. Lookup order on callback:
 *   1. a user already linked to this GitHub id (User.githubId)
 *   2. a user whose email matches one of the GitHub account's VERIFIED emails
 *      (the GitHub id is then linked to that user)
 *   3. signup mode only: a new regular `user` in the org the visitor named.
 * The platform superadmin can never sign in (or be created) this way.
 */
@Injectable()
export class GithubAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly github: GithubService,
    private readonly auditService: AuditService,
  ) {}

  isEnabled(): Promise<boolean> {
    return this.github.isConfigured();
  }

  // Must be the OAuth App's callback URL or a sub-path of it (GitHub OAuth Apps
  // accept any redirect_uri under the registered callback), so ONE callback URL
  // — /v1/github/callback — serves both connect and sign-in.
  callbackUrl(): string {
    return `${this.github.apiBaseUrl()}/v1/github/callback/login`;
  }

  dashboardUrl(): string {
    return this.github.dashboardUrl().replace(/\/$/, '');
  }

  isSecureCookie(): boolean {
    return this.github.apiBaseUrl().startsWith('https://');
  }

  /** Dashboard page to send the browser to when the flow fails. */
  errorRedirect(err: unknown, mode: GithubLoginMode = 'login'): string {
    let code = 'GITHUB_LOGIN_FAILED';
    let message = 'GitHub sign-in failed. Please try again.';
    if (err instanceof GithubLoginError) {
      code = err.code;
      message = err.message;
      mode = err.mode;
    } else if (err instanceof BadRequestException) {
      const body = err.getResponse() as { code?: string; message?: string };
      code = body.code ?? code;
      message = body.message ?? message;
    }
    const page = mode === 'signup' ? 'register' : 'login';
    const params = new URLSearchParams({ github_error: message, github_error_code: code });
    return `${this.dashboardUrl()}/${page}?${params.toString()}`;
  }

  /**
   * Validate the request and build the GitHub consent URL. Returns the nonce the
   * controller must set as an HttpOnly cookie.
   */
  async start(
    modeRaw: string | undefined,
    orgRaw: string | undefined,
    redirectRaw: string | undefined,
  ): Promise<{ url: string; nonce: string }> {
    const mode: GithubLoginMode = modeRaw === 'signup' ? 'signup' : 'login';

    if (!(await this.github.isConfigured())) {
      throw new GithubLoginError(
        'GITHUB_NOT_CONFIGURED',
        'GitHub sign-in is not configured on this server.',
        mode,
      );
    }

    let orgSlug: string | null = null;
    if (mode === 'signup') {
      orgSlug = slugify(orgRaw ?? '');
      if (orgSlug.length < 2) {
        throw new GithubLoginError(
          'ORG_REQUIRED',
          'Enter your organization slug before signing up with GitHub.',
          mode,
        );
      }
      // Fail fast (before the GitHub round-trip) on a bad slug.
      await this.assertOrgJoinable(orgSlug, mode);
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const state = await this.signState({
      m: mode,
      o: orgSlug,
      r: this.safeRedirect(redirectRaw),
      n: nonce,
      t: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: await this.github.clientId(),
      redirect_uri: this.callbackUrl(),
      // Identity only — no repo access. Connecting repos is a separate consent.
      scope: 'read:user user:email',
      state,
      allow_signup: 'true',
    });
    return { url: `${await this.github.oauthUrl()}/authorize?${params.toString()}`, nonce };
  }

  /**
   * Handle GitHub's redirect: verify state + nonce, identify the GitHub user,
   * resolve/link/create the platform user and return where to send the browser
   * (the dashboard, carrying the JWT in the URL fragment).
   */
  async callback(
    code: string | undefined,
    stateRaw: string | undefined,
    cookieNonce: string | undefined,
    githubError: string | undefined,
  ): Promise<string> {
    const state = await this.verifyState(stateRaw, cookieNonce);

    if (githubError) {
      throw new GithubLoginError(
        'GITHUB_ACCESS_DENIED',
        githubError === 'access_denied'
          ? 'GitHub sign-in was cancelled.'
          : 'GitHub sign-in failed. Please try again.',
        state.m,
      );
    }

    const { accessToken } = await this.github.exchangeCode(code ?? '', this.callbackUrl());
    const ghUser = await this.github.githubFetch<GithubUser>(accessToken, '/user');
    const emails = await this.github
      .githubFetch<GithubEmail[]>(accessToken, '/user/emails')
      .catch(() => [] as GithubEmail[]);
    const verified = emails
      .filter((e) => e.verified)
      .sort((a, b) => Number(b.primary) - Number(a.primary))
      .map((e) => e.email.trim().toLowerCase());

    const githubId = String(ghUser.id);
    const { user, created, linked } = await this.resolveUser(state, githubId, ghUser, verified);

    if (user.role === 'superadmin') {
      throw new GithubLoginError(
        'SUPERADMIN_PASSWORD_ONLY',
        'The superadmin account must sign in with its password.',
        state.m,
      );
    }
    if (user.status === 'suspended') {
      throw new GithubLoginError('UNAUTHORIZED', 'Account suspended', state.m);
    }

    await this.auditService.log({
      actorUserId: user.id,
      action: created ? 'auth.github_signup' : 'auth.github_login',
      target: user.id,
      metadata: { githubLogin: ghUser.login, githubId, linked },
    });

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.organizationId,
      tv: user.tokenVersion,
    });

    // Fragment, not query: never sent to servers or leaked via Referer. The
    // dashboard reads it once and scrubs it from history.
    const fragment = new URLSearchParams({ token, redirect: state.r });
    return `${this.dashboardUrl()}/auth/github#${fragment.toString()}`;
  }

  private async resolveUser(
    state: LoginState,
    githubId: string,
    ghUser: GithubUser,
    verifiedEmails: string[],
  ) {
    // 1. Already linked.
    const linkedUser = await this.prisma.user.findUnique({ where: { githubId } });
    if (linkedUser) return { user: linkedUser, created: false, linked: false };

    // 2. Existing account with a matching verified email → link it.
    if (verifiedEmails.length) {
      const byEmail = await this.prisma.user.findFirst({
        where: {
          OR: verifiedEmails.map((email) => ({
            email: { equals: email, mode: Prisma.QueryMode.insensitive },
          })),
        },
      });
      if (byEmail) {
        if (byEmail.githubId && byEmail.githubId !== githubId) {
          throw new GithubLoginError(
            'GITHUB_LINK_CONFLICT',
            'This account is already linked to a different GitHub account.',
            state.m,
          );
        }
        if (byEmail.role === 'superadmin') {
          // Never attach a GitHub identity to the superadmin.
          return { user: byEmail, created: false, linked: false };
        }
        const user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { githubId },
        });
        return { user, created: false, linked: true };
      }
    }

    // 3. New user — only when signing up (they must name an org to join).
    if (state.m !== 'signup' || !state.o) {
      throw new GithubLoginError(
        'GITHUB_NO_ACCOUNT',
        'No Upande Cloud account is linked to this GitHub account. Sign up with GitHub (you will need your organization slug), or sign in with your password first.',
        'signup',
      );
    }
    const email = verifiedEmails[0];
    if (!email) {
      throw new GithubLoginError(
        'GITHUB_NO_VERIFIED_EMAIL',
        'Your GitHub account has no verified email address. Verify one on GitHub and try again.',
        state.m,
      );
    }

    const organization = await this.assertOrgJoinable(state.o, state.m);
    // Same as web registration: always a regular `user`, never superadmin. There
    // is no password — store an unusable random hash; the user can set one via
    // "Forgot password" if they ever want password sign-in.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    for (let attempt = 0; attempt < 5; attempt++) {
      const username = await this.pickUsername(ghUser.login, attempt);
      try {
        const user = await this.prisma.user.create({
          data: {
            organizationId: organization.id,
            username,
            email,
            passwordHash,
            role: 'user',
            status: 'active',
            githubId,
          },
        });
        return { user, created: true, linked: true };
      } catch (e) {
        const target = (e as Prisma.PrismaClientKnownRequestError).meta?.target;
        const isUnique =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (isUnique && String(target).includes('username')) continue; // raced — retry
        if (isUnique) {
          throw new GithubLoginError(
            'CONFLICT',
            'An account with this email or GitHub account already exists. Try signing in.',
            state.m,
          );
        }
        throw e;
      }
    }
    throw new GithubLoginError('CONFLICT', 'Could not allocate a username. Try again.', state.m);
  }

  // Derive a valid platform username (3–30 of [a-z0-9_-]) from the GitHub login.
  private async pickUsername(login: string, attempt: number): Promise<string> {
    let base = login.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
    if (base.length < 3) base = `${base || 'user'}-gh`;
    base = base.slice(0, 30);
    if (attempt === 0) {
      const taken = await this.prisma.user.findUnique({ where: { username: base } });
      if (!taken) return base;
    }
    const suffix = `-${crypto.randomBytes(2).toString('hex')}`;
    return `${base.slice(0, 30 - suffix.length)}${suffix}`;
  }

  private async assertOrgJoinable(slug: string, mode: GithubLoginMode) {
    const organization = await this.prisma.organization.findUnique({ where: { slug } });
    if (!organization) {
      throw new GithubLoginError(
        'ORG_NOT_FOUND',
        'No organization with that slug. Check the slug or ask your admin to create it.',
        mode,
      );
    }
    if (organization.status === 'suspended') {
      throw new GithubLoginError(
        'ORG_SUSPENDED',
        'This organization is suspended and cannot accept new members.',
        mode,
      );
    }
    return organization;
  }

  private safeRedirect(raw: string | undefined): string {
    // Only same-app relative paths (no protocol-relative "//evil.com").
    if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) {
      return raw.slice(0, 500);
    }
    return '/apps';
  }

  private async hmac(payload: string): Promise<string> {
    return crypto
      .createHmac('sha256', await this.github.stateSecret())
      .update(`${STATE_PURPOSE}:${payload}`)
      .digest('hex');
  }

  private async signState(state: LoginState): Promise<string> {
    const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
    return `${payload}.${await this.hmac(payload)}`;
  }

  private async verifyState(
    raw: string | undefined,
    cookieNonce: string | undefined,
  ): Promise<LoginState> {
    const bad = (message: string) =>
      new GithubLoginError('BAD_STATE', `${message}. Please start GitHub sign-in again.`);

    const parts = (raw ?? '').split('.');
    if (parts.length !== 2) throw bad('Invalid sign-in state');
    const [payload, sig] = parts;
    const expected = await this.hmac(payload);
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      throw bad('Sign-in state signature mismatch');
    }

    let state: LoginState;
    try {
      state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LoginState;
    } catch {
      throw bad('Invalid sign-in state');
    }
    const mode: GithubLoginMode = state.m === 'signup' ? 'signup' : 'login';

    if (typeof state.t !== 'number' || Date.now() - state.t > STATE_TTL_MS) {
      throw new GithubLoginError('BAD_STATE', 'GitHub sign-in expired. Please try again.', mode);
    }
    if (
      !cookieNonce ||
      typeof state.n !== 'string' ||
      cookieNonce.length !== state.n.length ||
      !crypto.timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(state.n))
    ) {
      throw new GithubLoginError(
        'BAD_STATE',
        'GitHub sign-in must be finished in the same browser it was started in. Please try again.',
        mode,
      );
    }
    return { ...state, m: mode, r: this.safeRedirect(state.r) };
  }
}
