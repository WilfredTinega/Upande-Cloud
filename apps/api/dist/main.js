"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
const http_exception_filter_1 = require("./common/http-exception.filter");
const strip_secrets_interceptor_1 = require("./common/strip-secrets.interceptor");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        rawBody: true,
    });
    const jwtSecret = process.env.JWT_SECRET ?? '';
    if (!jwtSecret || jwtSecret === 'change-me' || jwtSecret.length < 32) {
        const msg = 'JWT_SECRET is missing, the default, or shorter than 32 characters — set a long random value (openssl rand -hex 32).';
        if (process.env.NODE_ENV === 'production') {
            await app.close();
            throw new Error(msg);
        }
        console.warn(`WARNING: ${msg}`);
    }
    const trustProxy = (process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal').trim();
    app.set('trust proxy', trustProxy === 'true' ? true : trustProxy === 'false' ? false : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
    }));
    app.useGlobalFilters(new http_exception_filter_1.HttpExceptionFilter());
    app.useGlobalInterceptors(new strip_secrets_interceptor_1.StripSecretsInterceptor());
    const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
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
//# sourceMappingURL=main.js.map