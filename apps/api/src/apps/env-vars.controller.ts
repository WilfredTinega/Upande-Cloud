import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { EnvVarsService } from './env-vars.service';
import { CreateEnvVarDto, UpdateEnvVarDto } from './dto/env-var.dto';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

// Env vars of an app (org-scoped). ?scope=all|production|preview filters.
@Controller('apps/:id/env')
@UseGuards(JwtAuthGuard)
export class EnvVarsController {
  constructor(private readonly envVars: EnvVarsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('scope') scope?: string) {
    return this.envVars.list(user.organizationId, id, scope);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateEnvVarDto) {
    return this.envVars.create(user.id, user.organizationId, id, dto);
  }

  @Patch(':envId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('envId') envId: string,
    @Body() dto: UpdateEnvVarDto,
  ) {
    return this.envVars.update(user.id, user.organizationId, id, envId, dto);
  }

  @Delete(':envId')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('envId') envId: string) {
    return this.envVars.remove(user.id, user.organizationId, id, envId);
  }
}
