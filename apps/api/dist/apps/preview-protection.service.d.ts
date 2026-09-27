import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
export declare class PreviewProtectionService {
    private readonly prisma;
    private readonly audit;
    private readonly logger;
    private readonly docker;
    constructor(prisma: PrismaService, audit: AuditService);
    private assertApp;
    get(organizationId: string, appId: string): Promise<{
        enabled: boolean;
        username: string | null;
        updatedAt: Date | null;
    }>;
    set(userId: string, organizationId: string, appId: string, dto: {
        username?: string;
        password?: string;
    }): Promise<{
        updated: number;
        failed: string[];
        enabled: boolean;
        username: string;
    }>;
    disable(userId: string, organizationId: string, appId: string): Promise<{
        updated: number;
        failed: string[];
        enabled: boolean;
        username: null;
    }>;
    private applyToRunning;
    private relabel;
}
