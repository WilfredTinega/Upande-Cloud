import { PrismaService } from '../prisma/prisma.service';
export declare class DbProvisionService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    private appDbHost;
    private appDbPort;
    private adminConnectionString;
    private safeIdent;
    private quoteIdent;
    ensureForApp(appId: string, subdomain: string): Promise<{
        id: string;
        appId: string;
        dbName: string;
        roleName: string;
        passwordEnc: string;
        host: string;
        port: number;
        createdAt: Date;
    }>;
    ensureForPreview(previewId: string, previewSubdomain: string): Promise<{
        dbName: string;
        roleName: string;
        passwordEnc: string;
        host: string;
        port: number;
    }>;
    private previewDb;
    dropPreviewDatabase(dbName: string, roleName: string): Promise<void>;
    dropForApp(appId: string): Promise<boolean>;
    buildAppDatabaseUrl(db: {
        roleName: string;
        passwordEnc: string;
        dbName: string;
        host: string;
        port: number;
    }): string;
    private withAdminClient;
    private createRoleAndDatabase;
    private grantSchemaPrivileges;
    private ensureObjectsExist;
}
