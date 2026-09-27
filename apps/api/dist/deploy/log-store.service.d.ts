import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
export declare class LogStoreService {
    private readonly redis;
    private readonly prisma;
    constructor(redis: Redis, prisma: PrismaService);
    append(deploymentId: string, line: string): Promise<void>;
    getAll(deploymentId: string): Promise<string[]>;
    persist(deploymentId: string): Promise<void>;
    getFrom(deploymentId: string, start: number): Promise<string[]>;
}
