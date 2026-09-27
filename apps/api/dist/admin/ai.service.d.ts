import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare class AiService {
    private readonly config;
    private readonly prisma;
    private readonly logger;
    constructor(config: ConfigService, prisma: PrismaService);
    private setting;
    private resolveConfig;
    isConfigured(): Promise<boolean>;
    analyzeDeploymentLog(params: {
        appName: string;
        appType: string;
        log: string;
        errorReason?: string;
    }): Promise<string>;
    private truncate;
}
