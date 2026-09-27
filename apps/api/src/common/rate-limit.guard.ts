import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

// Small in-memory fixed-window rate limiter for abuse-prone routes (login,
// register, password reset, deploy tokens). Per API process: with several API
// replicas each keeps its own counters — move to Redis if you scale out.
//
//   @UseGuards(RateLimitGuard) @RateLimit({ limit: 10, windowSec: 60 })
//
// Keys are per client IP and, when `byBody` names a field (e.g. "email"), also
// per that value — so one account can't be brute-forced from many IPs.
// RATE_LIMIT_DISABLED=true turns it off (tests).

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
  byBody?: string;
}

export const RATE_LIMIT_KEY = 'upande:rate-limit';
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = Date.now();

function hit(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  b.count += 1;
  return b.count > limit ? Math.ceil((b.resetAt - now) / 1000) : null;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if ((process.env.RATE_LIMIT_DISABLED ?? '').toLowerCase() === 'true') return true;
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!opts) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const route = `${req.method} ${req.route?.path ?? req.path}`;
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const windowMs = opts.windowSec * 1000;
    const keys = [`${route}|ip:${ip}`];
    if (opts.byBody) {
      const v = (req.body as Record<string, unknown> | undefined)?.[opts.byBody];
      if (typeof v === 'string' && v) keys.push(`${route}|${opts.byBody}:${v.trim().toLowerCase()}`);
    }
    for (const key of keys) {
      const retryAfter = hit(key, opts.limit, windowMs);
      if (retryAfter !== null) {
        const res = ctx.switchToHttp().getResponse<{ setHeader?: (k: string, v: string) => void }>();
        res.setHeader?.('Retry-After', String(retryAfter));
        throw new HttpException(
          { code: 'RATE_LIMITED', message: `Too many attempts. Try again in ${retryAfter}s.` },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
