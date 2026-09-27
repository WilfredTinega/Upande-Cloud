import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { SupportService } from './support.service';
import { SupportEventsService } from './support-events.service';
import {
  AnswerResolutionDto,
  CreateConversationDto,
  ListConversationsQueryDto,
  SendMessageDto,
} from './dto/support.dto';

interface AuthUser {
  id: string;
  username: string;
  organizationId: string;
  role: string;
  imp?: { by: string; email: string };
}

/**
 * User-side support chat. Everything is scoped to the caller's organization
 * (taken from the JWT, never the request): any member of the org can see and
 * reply to the org's conversations.
 */
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly events: SupportEventsService,
  ) {}

  // An admin impersonating a user must not write to the org's support threads
  // as that user (they'd be talking to themselves under someone else's name).
  private assertNotImpersonating(user: AuthUser): void {
    if (user.imp) {
      throw new ForbiddenException({
        code: 'IMPERSONATION_FORBIDDEN',
        message: 'Support chat is read-only during an impersonation session.',
      });
    }
  }

  private actor(user: AuthUser) {
    return { id: user.id, username: user.username, organizationId: user.organizationId };
  }

  // Live updates for the org (JWT via ?token= since EventSource can't set headers).
  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.events.userStream(user.organizationId) as Observable<MessageEvent>;
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.support.unreadForOrg(user.organizationId);
  }

  @Get('conversations')
  list(@CurrentUser() user: AuthUser, @Query() query: ListConversationsQueryDto) {
    return this.support.listForOrg(user.organizationId, query.status);
  }

  @Post('conversations')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    this.assertNotImpersonating(user);
    return this.support.createForUser(this.actor(user), dto.category, dto.title, dto.body);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.getForUser(this.actor(user), id);
  }

  @Post('conversations/:id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    this.assertNotImpersonating(user);
    return this.support.sendAsUser(this.actor(user), id, dto.body);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertNotImpersonating(user);
    return this.support.markReadAsUser(this.actor(user), id);
  }

  @Post('conversations/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertNotImpersonating(user);
    return this.support.setStatusAsUser(this.actor(user), id, 'closed');
  }

  // Yes / No to the pending "Is this solved?" question (Yes closes it).
  @Post('conversations/:id/resolution')
  @HttpCode(200)
  resolution(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AnswerResolutionDto,
  ) {
    this.assertNotImpersonating(user);
    return this.support.answerResolutionAsUser(this.actor(user), id, dto.solved);
  }

  @Post('conversations/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertNotImpersonating(user);
    return this.support.setStatusAsUser(this.actor(user), id, 'open');
  }
}
