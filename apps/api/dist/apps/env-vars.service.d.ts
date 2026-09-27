import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { CreateEnvVarDto, UpdateEnvVarDto } from './dto/env-var.dto';
export declare class EnvVarsService {
    private readonly prisma;
    private readonly audit;
    constructor(prisma: PrismaService, audit: AuditService);
    private assertApp;
    private view;
    private duplicate;
    list(organizationId: string, appId: string, scope?: string): Promise<{
        envVars: {
            id: string;
            key: string;
            value: string | null;
            isSecret: boolean;
            scope: string;
        }[];
    }>;
    create(userId: string, organizationId: string, appId: string, dto: CreateEnvVarDto): Promise<{
        envVar: {
            id: string;
            key: string;
            value: string | null;
            isSecret: boolean;
            scope: string;
        };
    }>;
    update(userId: string, organizationId: string, appId: string, envId: string, dto: UpdateEnvVarDto): Promise<{
        envVar: {
            id: string;
            key: string;
            value: string | null;
            isSecret: boolean;
            scope: string;
        };
    }>;
    remove(userId: string, organizationId: string, appId: string, envId: string): Promise<{
        ok: boolean;
    }>;
}
