import { Queue } from 'bullmq';
import { DeployJobData } from './deploy.processor';
export declare class DeployService {
    private readonly deployQueue;
    constructor(deployQueue: Queue<DeployJobData>);
    enqueue(data: DeployJobData): Promise<import("bullmq").Job<DeployJobData, any, string>>;
    getQueueDepth(): Promise<number>;
    cancelForApp(appId: string): Promise<number>;
    cancelForPreview(previewId: string): Promise<number>;
}
