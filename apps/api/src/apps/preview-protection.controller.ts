import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { PreviewProtectionService } from './preview-protection.service';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

export class SetPreviewProtectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  // Required when turning protection on; omit to keep the current password.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}

// Password-protected previews of an app (org-scoped).
@Controller('apps/:id/preview-protection')
@UseGuards(JwtAuthGuard)
export class PreviewProtectionController {
  constructor(private readonly protection: PreviewProtectionService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.protection.get(user.organizationId, id);
  }

  @Put()
  set(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetPreviewProtectionDto) {
    return this.protection.set(user.id, user.organizationId, id, dto);
  }

  @Delete()
  disable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.protection.disable(user.id, user.organizationId, id);
  }
}
