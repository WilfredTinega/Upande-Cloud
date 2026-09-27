import { OnApplicationBootstrap } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { UptimeService } from './uptime.service';
export declare class UptimeProcessor extends WorkerHost implements OnApplicationBootstrap {
    private readonly uptime;
    private readonly queue;
    private readonly logger;
    constructor(uptime: UptimeService, queue: Queue);
    onApplicationBootstrap(): Promise<void>;
    process(job: Job): Promise<unknown>;
}
