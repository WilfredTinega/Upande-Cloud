import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { PromoteService } from './promote.service';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

export class PromotePreviewDto {
  // Rebuild the preview's commit for production instead of reusing its image.
  @IsOptional()
  @IsBoolean()
  rebuild?: boolean;
}

// Promote a preview to production (org-scoped; see promote.service.ts).
@Controller('apps/:id/previews/:previewId/promote')
@UseGuards(JwtAuthGuard)
export class PromoteController {
  constructor(private readonly promoteService: PromoteService) {}

  @Get()
  check(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('previewId') previewId: string) {
    return this.promoteService.check(user.organizationId, id, previewId);
  }

  @Post()
  promote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('previewId') previewId: string,
    @Body() dto: PromotePreviewDto,
  ) {
    return this.promoteService.promote(user.id, user.organizationId, id, previewId, dto);
  }
}
