import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// Defense in depth: never send secret columns to a client, whatever a handler
// returns (many services spread whole Prisma rows, e.g. `...app`). Only plain
// objects/arrays are walked; Dates, Buffers, streams pass through untouched.
const SECRET_KEYS = new Set([
  'webhookSecret', // App: HMAC key for GitHub push webhooks
  'noderedAdminPasswordEnc', // App: encrypted Node-RED admin password
  'passwordHash', // User / NodeRedUser / PreviewProtection hashes
  'dbPasswordEnc', // Preview throwaway DB password
  'passwordEnc', // AppDatabase password
  'tokenHash', // DeployToken / reset token hashes
]);

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function stripSecrets<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1)) as unknown as T;
  if (!isPlain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(k)) continue;
    out[k] = stripSecrets(v, depth + 1);
  }
  return out as T;
}

@Injectable()
export class StripSecretsInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => stripSecrets(data)));
  }
}
