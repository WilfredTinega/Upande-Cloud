import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { FrameworkService } from './framework.service';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

export class DetectFrameworkDto {
  @IsString()
  @MaxLength(500)
  repoUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string;
}

// Framework detection before a deploy (see framework.service.ts).
@Controller()
@UseGuards(JwtAuthGuard)
export class FrameworkController {
  constructor(private readonly frameworks: FrameworkService) {}

  // New App form: a repository URL (+ branch) that isn't an app yet.
  @Post('frameworks/detect')
  detect(@CurrentUser() user: AuthUser, @Body() dto: DetectFrameworkDto) {
    return this.frameworks.detectFromUrl(user.id, dto.repoUrl, dto.branch || undefined);
  }

  // An existing app's source, compared with its settings.
  @Get('apps/:id/framework')
  forApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.frameworks.detectForApp(user.id, user.organizationId, id);
  }
}
