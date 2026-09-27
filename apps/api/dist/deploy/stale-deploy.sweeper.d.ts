import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { LogStoreService } from './log-store.service';
export declare class StaleDeploySweeper implements OnModuleInit, OnModuleDestroy {
    private readonly prisma;
    private readonly logStore;
    private readonly queue;
    private readonly logger;
    private readonly docker;
    private timer;
    private running;
    constructor(prisma: PrismaService, logStore: LogStoreService, queue: Queue);
    onModuleInit(): void;
    onModuleDestroy(): void;
    private serving;
    sweep(): Promise<number>;
    private resetOwner;
}
