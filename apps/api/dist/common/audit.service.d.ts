import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from './request-context';
export interface AuditEntry {
    actorUserId?: string;
    action: string;
    target: string;
    metadata?: Record<string, unknown>;
    ip?: string;
}
export declare class AuditService {
    private readonly prisma;
    private readonly requestContext;
    constructor(prisma: PrismaService, requestContext: RequestContextService);
    log(entry: AuditEntry): Promise<void>;
}
