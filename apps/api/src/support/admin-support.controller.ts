import {
  Body,
  Controller,
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
import { AgentOrJwtGuard } from '../auth/agent-or-jwt.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { SupportService } from './support.service';
import { SupportEventsService } from './support-events.service';
import { AdminListConversationsQueryDto, SendMessageDto } from './dto/support.dto';

interface AuthUser {
  id: string;
  username?: string;
  organizationId: string;
  role: string;
}

/** Cross-tenant support inbox for platform admins. */
@Controller('admin/support')
@UseGuards(AgentOrJwtGuard, RolesGuard)
@Roles('admin', 'superadmin')
export class AdminSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly events: SupportEventsService,
  ) {}

  private actor(user: AuthUser) {
    return { id: user.id, username: user.username, organizationId: user.organizationId };
  }

  // Live updates across all orgs (JWT via ?token=).
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.events.adminStream() as Observable<MessageEvent>;
  }

  @Get('unread')
  unread() {
    return this.support.unreadForAdmin();
  }

  @Get('conversations')
  list(@Query() query: AdminListConversationsQueryDto) {
    return this.support.listForAdmin({
      status: query.status,
      unread: query.unread === 'true',
      organizationId: query.organizationId,
      category: query.category,
      q: query.q,
    });
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.getForAdmin(this.actor(user), id);
  }

  @Post('conversations/:id/messages')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.support.replyAsAdmin(this.actor(user), id, dto.body);
  }

  // Post the "Is this solved?" card for the user to answer.
  @Post('conversations/:id/ask-resolution')
  askResolution(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.askResolutionAsAdmin(this.actor(user), id);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.markReadAsAdmin(this.actor(user), id);
  }

  @Post('conversations/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.setStatusAsAdmin(this.actor(user), id, 'closed');
  }

  @Post('conversations/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.setStatusAsAdmin(this.actor(user), id, 'open');
  }
}
