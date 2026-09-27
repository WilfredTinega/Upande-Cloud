import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Req,
  Res,
  Headers,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GithubService } from './github.service';
import { AppsService } from '../apps/apps.service';
import { PreviewsService } from '../apps/previews.service';
import { GithubPullRequestService } from './github-pr.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

@Controller('github')
export class GithubController {
  constructor(
    private readonly githubService: GithubService,
    private readonly appsService: AppsService,
    private readonly previewsService: PreviewsService,
    private readonly pullRequests: GithubPullRequestService,
  ) {}

  // Returns the GitHub consent URL for the client to redirect the user to.
  @Get('authorize')
  @UseGuards(JwtAuthGuard)
  authorize(@CurrentUser() user: AuthUser) {
    return this.githubService.buildAuthorizeUrl(user.id);
  }

  // GitHub redirects the browser here after consent. No JWT — trust the signed
  // state param. Redirects back to the dashboard when done.
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const { redirectTo } = await this.githubService.handleCallback(code, state);
      res.redirect(redirectTo);
    } catch {
      // e.g. the user cancelled on GitHub (no code) or the state expired —
      // send them back to the dashboard rather than a raw JSON error page.
      res.redirect(`${this.githubService.dashboardUrl()}/apps/new?github=error`);
    }
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthUser) {
    return this.githubService.getStatus(user.id);
  }

  @Get('repos')
  @UseGuards(JwtAuthGuard)
  repos(@CurrentUser() user: AuthUser) {
    return this.githubService.listRepos(user.id);
  }

  @Get('repos/:owner/:repo/branches')
  @UseGuards(JwtAuthGuard)
  branches(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    return this.githubService.listBranches(user.id, owner, repo);
  }

  // Branches for an arbitrary repo URL (Repository URL mode). Uses ls-remote.
  @Get('remote-branches')
  @UseGuards(JwtAuthGuard)
  remoteBranches(@CurrentUser() user: AuthUser, @Query('repoUrl') repoUrl: string) {
    return this.githubService.listRemoteBranches(user.id, repoUrl);
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  disconnect(@CurrentUser() user: AuthUser) {
    return this.githubService.disconnect(user.id);
  }

  // Inbound push webhook from GitHub. Verified via HMAC of the raw body.
  @Post('webhook/:appId')
  @HttpCode(202)
  async webhook(
    @Param('appId') appId: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await this.githubService.resolveWebhookDeploy(
      appId,
      event,
      raw,
      signature,
    );
    // pull_request events: preview lifecycle for the PR's head branch.
    if (result?.kind === 'pull_request') {
      return this.pullRequests.handle(result);
    }
    if (result && result.isTrackedBranch && !result.deleted) {
      await this.appsService.deployByToken(
        result.appId,
        { ref: result.ref },
        {
          trigger: 'webhook',
          detail: result.pusher ? `push by ${result.pusher}` : 'push',
          commitSha: result.commitSha,
          commitMessage: result.commitMessage,
        },
      );
      return { deployed: true, ref: result.ref };
    }
    // Any other branch → its preview deploy (PREVIEW_AUTO_DEPLOY, limits
    // apply); a push that deletes the branch removes its preview.
    if (result && !result.isTrackedBranch) {
      if (result.deleted) {
        const removed = await this.previewsService.removeForBranch(result.appId, result.ref);
        return { deployed: false, preview: { removed } };
      }
      const preview = await this.previewsService.deployFromWebhook(result.appId, result.ref, {
        detail: result.pusher ? `push by ${result.pusher}` : 'push',
        commitSha: result.commitSha,
        commitMessage: result.commitMessage,
      });
      return { deployed: 'previewId' in preview, ref: result.ref, preview };
    }
    return { deployed: false };
  }
}
