import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
export declare class UserPurgeService {
    private readonly prisma;
    private readonly moduleRef;
    private readonly logger;
    constructor(prisma: PrismaService, moduleRef: ModuleRef);
    purge(userId: string): Promise<void>;
    private removeContainer;
}
