import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextService } from './request-context';
export declare class RequestContextInterceptor implements NestInterceptor {
    private readonly ctx;
    constructor(ctx: RequestContextService);
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
}
