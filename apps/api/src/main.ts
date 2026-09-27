import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { StripSecretsInterceptor } from './common/strip-secrets.interceptor';

async function bootstrap() {
  // rawBody lets the GitHub webhook handler verify the HMAC signature against
  // the exact bytes GitHub signed (req.rawBody), not a re-serialized body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // JWT signing secret: without a real one, tokens (superadmin included) could
  // be forged with the code's 'change-me' fallback. Refuse to start in
  // production; warn loudly in development.
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (!jwtSecret || jwtSecret === 'change-me' || jwtSecret.length < 32) {
    const msg =
      'JWT_SECRET is missing, the default, or shorter than 32 characters — set a long random value (openssl rand -hex 32).';
    if (process.env.NODE_ENV === 'production') {
      await app.close();
      throw new Error(msg);
    }
    console.warn(`WARNING: ${msg}`);
  }

  // Behind nginx/another reverse proxy: trust X-Forwarded-* so req.ip is the
  // real client address (used for audit logging) rather than the proxy's.
  // Only proxies on loopback / private networks (Traefik, nginx on the same
  // host or Docker network) are trusted — a client can't fake its IP with its
  // own X-Forwarded-For. TRUST_PROXY overrides: a hop count ("1"), "true", or
  // an Express trust list ("loopback, 10.0.0.0/8").
  const trustProxy = (process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal').trim();
  app.set(
    'trust proxy',
    trustProxy === 'true' ? true : trustProxy === 'false' ? false : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
  );

  app.setGlobalPrefix('v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  // Never return secret columns (webhookSecret, password hashes, ...) to clients.
  app.useGlobalInterceptors(new StripSecretsInterceptor());

  const corsOrigins = (
    process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Upande Cloud API running on http://localhost:${port}/v1`);
}

bootstrap();
