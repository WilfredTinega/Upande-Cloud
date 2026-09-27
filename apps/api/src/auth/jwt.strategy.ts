import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  orgId: string;
  // Present only on impersonation sessions: the admin who started it.
  imp?: { by: string; email: string };
  // Session generation (User.tokenVersion); a password change/reset bumps it.
  tv?: number;
  // "stream" = short-lived ticket for EventSource URLs (see AuthService).
  typ?: 'stream';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Session JWTs come from the Authorization header. EventSource can't set
      // headers, so SSE GETs pass a short-lived *stream ticket* (typ=stream,
      // ~60s, from POST /auth/stream-ticket) as ?token= — a full session token
      // in a URL is rejected in validate() (URLs end up in logs / history).
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'change-me',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const fromHeader = /^Bearer\s/i.test(req.headers?.authorization ?? '');
    if (payload.typ === 'stream') {
      // Tickets only open read-only streams, never act as a bearer token.
      if (fromHeader || req.method !== 'GET') {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Stream tickets only open event streams' });
      }
    } else if (!fromHeader) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Session tokens are not accepted in URLs — use a stream ticket',
      });
    }
    const record = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        organizationId: true,
        tokenVersion: true,
      },
    });

    if (!record) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User not found' });
    }

    if (record.status === 'suspended') {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account suspended' });
    }

    // Signed out by a password change / reset (older session generation).
    if ((payload.tv ?? 0) !== record.tokenVersion) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session expired — sign in again' });
    }

    // Controllers read the org id as `user.organizationId` (matching the DB
    // column and refactored AuthUser contract). Expose it under that name —
    // also keep `orgId` as a backwards-compatible alias. Returning only `orgId`
    // (the old behavior) left `user.organizationId` undefined, which made every
    // org-scoped check fail with "Access denied" (e.g. creating a new site).
    const { tokenVersion: _tv, ...rest } = record;
    const user = { ...rest, orgId: record.organizationId };

    // Carry the impersonation marker (if any) onto req.user so the dashboard can
    // surface "you are impersonating" and audit can attribute actions.
    return payload.imp ? { ...user, imp: payload.imp } : user;
  }
}
