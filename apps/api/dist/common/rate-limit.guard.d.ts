import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
export interface RateLimitOptions {
    limit: number;
    windowSec: number;
    byBody?: string;
}
export declare const RATE_LIMIT_KEY = "upande:rate-limit";
export declare const RateLimit: (opts: RateLimitOptions) => import("@nestjs/common").CustomDecorator<string>;
export declare class RateLimitGuard implements CanActivate {
    private readonly reflector;
    constructor(reflector: Reflector);
    canActivate(ctx: ExecutionContext): boolean;
}
