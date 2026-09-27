import { PrismaService } from '../prisma/prisma.service';
import { PreviewsService } from '../apps/previews.service';
import { GithubReporterService } from './github-reporter.service';
import { WebhookPullRequest } from './github.service';
export declare class GithubPullRequestService {
    private readonly prisma;
    private readonly previews;
    private readonly reporter;
    private readonly logger;
    constructor(prisma: PrismaService, previews: PreviewsService, reporter: GithubReporterService);
    handle(ev: WebhookPullRequest): Promise<Record<string, unknown>>;
}
