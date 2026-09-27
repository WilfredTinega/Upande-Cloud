import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { PreviewsService } from './previews.service';
import { DeployPreviewDto } from './dto/preview.dto';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

// Preview deploys per branch (see previews.service.ts). All routes are
// org-scoped: the app must belong to the caller's organization.
@Controller('apps/:id/previews')
@UseGuards(JwtAuthGuard)
export class PreviewsController {
  constructor(private readonly previews: PreviewsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.previews.list(user.organizationId, id);
  }

  // Create the branch's preview (or redeploy it when it already exists).
  @Post()
  deploy(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeployPreviewDto) {
    return this.previews.deploy(user.id, user.organizationId, id, dto.branch);
  }

  @Delete(':previewId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('previewId') previewId: string,
  ) {
    return this.previews.remove(user.id, user.organizationId, id, previewId);
  }
}
