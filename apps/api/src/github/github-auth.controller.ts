import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  GITHUB_LOGIN_NONCE_COOKIE,
  GithubAuthService,
  GithubLoginMode,
} from './github-auth.service';

// The nonce cookie is only ever needed by the sign-in callback.
const NONCE_COOKIE_PATH = '/v1/github/callback/login';

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/**
 * "Sign in / Sign up with GitHub" for the dashboard. These are browser
 * navigations (not XHR), so every outcome is a redirect — errors land on the
 * dashboard login/register page with ?github_error=...
 */
@Controller()
export class GithubAuthController {
  constructor(private readonly githubAuth: GithubAuthService) {}

  // Lets the login/register pages show or hide the GitHub button.
  @Get('auth/github/config')
  async config() {
    return { enabled: await this.githubAuth.isEnabled() };
  }

  // Entry point: /v1/auth/github/start?mode=login|signup&org=<slug>&redirect=/apps
  @Get('auth/github/start')
  async start(
    @Query('mode') mode: string | undefined,
    @Query('org') org: string | undefined,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ) {
    try {
      const { url, nonce } = await this.githubAuth.start(mode, org, redirect);
      res.cookie(GITHUB_LOGIN_NONCE_COOKIE, nonce, {
        httpOnly: true,
        // Lax is sent on the top-level GET redirect back from github.com.
        sameSite: 'lax',
        secure: this.githubAuth.isSecureCookie(),
        path: NONCE_COOKIE_PATH,
        maxAge: 10 * 60 * 1000,
      });
      res.redirect(url);
    } catch (err) {
      const m: GithubLoginMode = mode === 'signup' ? 'signup' : 'login';
      res.redirect(this.githubAuth.errorRedirect(err, m));
    }
  }

  // GitHub redirects here after consent. A sub-path of the OAuth App's
  // registered callback (/v1/github/callback), so no extra GitHub config needed.
  @Get('github/callback/login')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const nonce = readCookie(req, GITHUB_LOGIN_NONCE_COOKIE);
    // One-shot: always clear the nonce so the state can't be reused.
    res.clearCookie(GITHUB_LOGIN_NONCE_COOKIE, { path: NONCE_COOKIE_PATH });
    try {
      res.redirect(await this.githubAuth.callback(code, state, nonce, error));
    } catch (err) {
      res.redirect(this.githubAuth.errorRedirect(err));
    }
  }
}
