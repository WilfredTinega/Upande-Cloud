import { EnvVarsService } from './env-vars.service';
import { CreateEnvVarDto, UpdateEnvVarDto } from './dto/env-var.dto';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class EnvVarsController {
    private readonly envVars;
    constructor(envVars: EnvVarsService);
    list(user: AuthUser, id: string, scope?: string): Promise<{
        envVars: {
            id: string;
            key: string;
            value: string | null;
            isSecret: boolean;
            scope: string;
        }[];
    }>;
    create(user: AuthUser, id: string, dto: CreateEnvVarDto): Promise<{
        envVar: {
            id: string;
            key: string;
            value: string | null;
            isSecret: boolean;
            scope: string;
        };
    }>;
    update(user: AuthUser, id: string, envId: string, dto: UpdateEnvVarDto): Promise<{
        envVar: {
            id: string;
            key: string;
            value: string | null;
            isSecret: boolean;
            scope: string;
        };
    }>;
    remove(user: AuthUser, id: string, envId: string): Promise<{
        ok: boolean;
    }>;
}
export {};
