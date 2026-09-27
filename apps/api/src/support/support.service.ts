import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SupportAuthorRole,
  SupportCategory,
  SupportConversationStatus,
  SupportMessageKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { SupportEventsService } from './support-events.service';

/** How admin authors are shown to users: the team, never an individual. */
export const SUPPORT_DISPLAY_NAME = 'Upande Support';

// Light per-user send limit (no global throttler in this API): at most
// SEND_LIMIT messages / new conversations per SEND_WINDOW_MS.
const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

const PREVIEW_LEN = 140;

/** Display titles for the fixed categories; Custom uses the user's own title. */
export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  issue: 'Issue',
  inquiry: 'Inquiry',
  faqs: 'FAQs',
  custom: 'Custom',
};

/** The "Is this solved?" question an admin asks, worded per category. */
export const RESOLUTION_QUESTION: Record<SupportCategory, string> = {
  issue: 'Is this issue solved?',
  inquiry: 'Did this answer your inquiry?',
  faqs: 'Did this answer your question?',
  custom: 'Is this resolved?',
};

/** The matching bell text for the org members ("Is ISSUE-0003 solved?"). */
function resolutionNotification(category: SupportCategory, reference: string): string {
  switch (category) {
    case 'issue':
      return `Is ${reference} solved?`;
    case 'inquiry':
    case 'faqs':
      return `Did we answer ${reference}?`;
    default:
      return `Is ${reference} resolved?`;
  }
}

/**
 * Turn a search string into a reference when it looks like one:
 * "issue-3", "ISSUE 0003", "issue3" -> "ISSUE-0003". Returns null otherwise.
 */
function normalizeReference(q: string): string | null {
  const m = /^(issue|inquiry|faqs|custom)[\s-]*0*(\d+)$/i.exec(q.trim());
  if (!m) return null;
  const n = m[2] || '0';
  return `${m[1].toUpperCase()}-${n.padStart(4, '0')}`;
}

export type SupportSide = 'user' | 'admin';

export interface SupportActor {
  id: string;
  username?: string;
  organizationId: string;
}

const messageInclude = {
  author: { select: { id: true, username: true, email: true } },
} satisfies Prisma.SupportMessageInclude;

type MessageRow = Prisma.SupportMessageGetPayload<{ include: typeof messageInclude }>;

const conversationInclude = {
  organization: { select: { id: true, name: true, slug: true } },
  createdBy: { select: { id: true, username: true, email: true, role: true, status: true } },
  resolvedBy: { select: { id: true, username: true } },
  messages: { orderBy: { createdAt: 'desc' }, take: 1, include: messageInclude },
} satisfies Prisma.SupportConversationInclude;

type ConversationRow = Prisma.SupportConversationGetPayload<{
  include: typeof conversationInclude;
}>;

function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN - 1)}…` : flat;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  // userId -> timestamps of recent sends (sliding window).
  private readonly sendLog = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: SupportEventsService,
  ) {}

  // ---------------------------------------------------------------- shaping

  /** A message as a USER sees it: admin authors are masked as the team. */
  private userMessage(m: MessageRow, viewerId: string) {
    const isAdmin = m.authorRole === SupportAuthorRole.admin;
    return {
      id: m.id,
      conversationId: m.conversationId,
      body: m.body,
      kind: m.kind,
      answer: m.answer,
      createdAt: m.createdAt,
      authorRole: m.authorRole,
      authorName: isAdmin ? SUPPORT_DISPLAY_NAME : (m.author?.username ?? 'Former member'),
      // Admin ids are never exposed to users.
      authorUserId: isAdmin ? null : m.authorUserId,
      mine: !isAdmin && m.authorUserId === viewerId,
    };
  }

  /** A message as an ADMIN sees it: real usernames on both sides. */
  private adminMessage(m: MessageRow, viewerId?: string) {
    return {
      id: m.id,
      conversationId: m.conversationId,
      body: m.body,
      kind: m.kind,
      answer: m.answer,
      createdAt: m.createdAt,
      authorRole: m.authorRole,
      authorName: m.author?.username ?? 'Deleted user',
      authorEmail: m.author?.email ?? null,
      authorUserId: m.authorUserId,
      // In the admin panel every admin message is "ours" (right-aligned).
      mine: m.authorRole === SupportAuthorRole.admin,
      byMe: viewerId ? m.authorUserId === viewerId : false,
    };
  }

  private userConversation(c: ConversationRow) {
    const last = c.messages[0];
    return {
      id: c.id,
      reference: c.reference,
      category: c.category,
      title: c.subject,
      // Kept for older clients; same as title.
      subject: c.subject,
      status: c.status,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt,
      closedAt: c.closedAt,
      resolution: c.resolution,
      resolvedAt: c.resolvedAt,
      unreadCount: c.userUnreadCount,
      // The id lets the dashboard group the org's threads by creator ("You" first).
      createdBy: c.createdBy ? { id: c.createdBy.id, username: c.createdBy.username } : null,
      lastMessage: last
        ? {
            preview: preview(last.body),
            kind: last.kind,
            authorRole: last.authorRole,
            authorName:
              last.authorRole === 'admin'
                ? SUPPORT_DISPLAY_NAME
                : (last.author?.username ?? 'Former member'),
            createdAt: last.createdAt,
          }
        : null,
    };
  }

  private adminConversation(c: ConversationRow) {
    const last = c.messages[0];
    return {
      id: c.id,
      reference: c.reference,
      category: c.category,
      title: c.subject,
      // Kept for older clients; same as title.
      subject: c.subject,
      status: c.status,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt,
      closedAt: c.closedAt,
      resolution: c.resolution,
      resolvedAt: c.resolvedAt,
      resolvedBy: c.resolvedBy,
      unreadCount: c.adminUnreadCount,
      userUnreadCount: c.userUnreadCount,
      organization: c.organization,
      createdBy: c.createdBy
        ? {
            id: c.createdBy.id,
            username: c.createdBy.username,
            email: c.createdBy.email,
            // Lets the admin panel offer "Impersonate" only for active non-superadmins.
            role: c.createdBy.role,
            status: c.createdBy.status,
          }
        : null,
      lastMessage: last
        ? {
            preview: preview(last.body),
            kind: last.kind,
            authorRole: last.authorRole,
            authorName: last.author?.username ?? 'Deleted user',
            createdAt: last.createdAt,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------- helpers

  private rateLimit(userId: string): void {
    const now = Date.now();
    const recent = (this.sendLog.get(userId) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
    if (recent.length >= SEND_LIMIT) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'You are sending messages too quickly. Please wait a moment.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.sendLog.set(userId, recent);
    // Keep the map from growing without bound.
    if (this.sendLog.size > 5000) {
      for (const [k, v] of this.sendLog) {
        if (!v.some((t) => now - t < SEND_WINDOW_MS)) this.sendLog.delete(k);
      }
    }
  }

  private notFound(): never {
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found' });
  }

  /** Load a conversation, scoped to an org when one is given (user side). */
  private async load(id: string, organizationId?: string): Promise<ConversationRow> {
    const c = await this.prisma.supportConversation.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: conversationInclude,
    });
    if (!c) this.notFound();
    return c;
  }

  private async publishConversation(c: ConversationRow): Promise<void> {
    this.events.publish({
      kind: 'conversation',
      organizationId: c.organizationId,
      conversationId: c.id,
      forUser: { conversation: this.userConversation(c) },
      forAdmin: { conversation: this.adminConversation(c) },
    });
  }

  private async publishMessage(c: ConversationRow, m: MessageRow): Promise<void> {
    this.events.publish({
      kind: 'message',
      organizationId: c.organizationId,
      conversationId: c.id,
      // `mine` is viewer-relative; the client recomputes it from authorUserId.
      forUser: { conversation: this.userConversation(c), message: this.userMessage(m, '') },
      forAdmin: { conversation: this.adminConversation(c), message: this.adminMessage(m) },
    });
  }

  /**
   * Notify the OTHER side about a new message so the bell surfaces it.
   *   - user wrote  -> every active admin/superadmin.
   *   - admin wrote -> the org members taking part in the thread: its creator
   *     plus anyone from the org who has posted in it. Falls back to every
   *     active org member if none remain (e.g. the creator was deleted). This
   *     keeps the rest of the org's bells quiet about threads they aren't in,
   *     while still guaranteeing someone hears the reply.
   */
  private async notifyOtherSide(
    c: ConversationRow,
    m: MessageRow,
    authorSide: SupportSide,
    isNewConversation: boolean,
    override?: string,
  ): Promise<void> {
    try {
      const metadata = {
        conversationId: c.id,
        messageId: m.id,
        kind: m.kind,
        subject: c.subject,
        reference: c.reference,
        category: c.category,
        organizationId: c.organizationId,
        organizationName: c.organization.name,
      };
      let recipients: string[];
      let message: string;
      if (authorSide === 'user') {
        const admins = await this.prisma.user.findMany({
          where: { role: { in: ['admin', 'superadmin'] }, status: 'active' },
          select: { id: true },
        });
        recipients = admins.map((a) => a.id);
        const who = m.author?.username ?? 'A user';
        message = override ?? (isNewConversation
          ? `New ${c.reference} from ${who} (${c.organization.name}): ${c.subject}`
          : `New reply on ${c.reference} from ${who} (${c.organization.name}): ${preview(m.body)}`);
      } else {
        const posters = await this.prisma.supportMessage.findMany({
          where: { conversationId: c.id, authorRole: 'user', authorUserId: { not: null } },
          select: { authorUserId: true },
          distinct: ['authorUserId'],
        });
        const ids = new Set<string>(posters.map((p) => p.authorUserId as string));
        if (c.createdByUserId) ids.add(c.createdByUserId);
        let members = await this.prisma.user.findMany({
          where: { id: { in: [...ids] }, organizationId: c.organizationId, status: 'active' },
          select: { id: true },
        });
        if (members.length === 0) {
          members = await this.prisma.user.findMany({
            where: { organizationId: c.organizationId, status: 'active' },
            select: { id: true },
          });
        }
        recipients = members.map((u) => u.id);
        message =
          override ?? `New reply on ${c.reference} from ${SUPPORT_DISPLAY_NAME}: ${preview(m.body)}`;
      }
      // Never notify the author about their own message.
      recipients = recipients.filter((id) => id !== m.authorUserId);
      if (recipients.length === 0) return;
      await this.prisma.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          organizationId: authorSide === 'user' ? null : c.organizationId,
          type: 'support_message' as const,
          message,
          metadata: { ...metadata, side: authorSide === 'user' ? 'admin' : 'user' },
        })),
      });
    } catch (err) {
      // A notification failure must never fail the send itself.
      this.logger.warn(`support notification failed: ${(err as Error).message}`);
    }
  }

  /** Clear the viewer's bell entries for this conversation once they read it. */
  private async clearNotifications(userId: string, conversationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        type: 'support_message',
        readAt: null,
        metadata: { path: ['conversationId'], equals: conversationId },
      },
      data: { readAt: new Date() },
    });
  }

  private async addMessage(
    conversationId: string,
    actor: SupportActor,
    side: SupportSide,
    body: string,
    isNewConversation = false,
    opts: {
      kind?: SupportMessageKind;
      answer?: boolean;
      // Extra conversation fields written in the same transaction (resolution).
      conversationData?: Prisma.SupportConversationUpdateInput;
      notification?: string;
    } = {},
  ) {
    const now = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          conversationId,
          authorUserId: actor.id,
          authorRole: side === 'admin' ? 'admin' : 'user',
          body,
          kind: opts.kind ?? 'text',
          answer: opts.answer ?? null,
        },
        include: messageInclude,
      }),
      this.prisma.supportConversation.update({
        where: { id: conversationId },
        data: {
          ...(side === 'admin'
            ? // Sending implies the sender has read the thread.
              { lastMessageAt: now, userUnreadCount: { increment: 1 }, adminUnreadCount: 0, adminLastReadAt: now }
            : { lastMessageAt: now, adminUnreadCount: { increment: 1 }, userUnreadCount: 0, userLastReadAt: now }),
          ...opts.conversationData,
        },
      }),
    ]);
    const conversation = await this.load(conversationId);
    await this.publishMessage(conversation, message);
    await this.notifyOtherSide(conversation, message, side, isNewConversation, opts.notification);
    return { conversation, message };
  }

  // ------------------------------------------------------------- user side

  async listForOrg(organizationId: string, status?: SupportConversationStatus) {
    const rows = await this.prisma.supportConversation.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
      include: conversationInclude,
    });
    const unreadTotal = rows.reduce((n, c) => n + c.userUnreadCount, 0);
    return { conversations: rows.map((c) => this.userConversation(c)), unreadTotal };
  }

  async unreadForOrg(organizationId: string) {
    const agg = await this.prisma.supportConversation.aggregate({
      where: { organizationId },
      _sum: { userUnreadCount: true },
    });
    return { unreadCount: agg._sum.userUnreadCount ?? 0 };
  }

  async createForUser(
    actor: SupportActor,
    category: SupportCategory,
    title: string | undefined,
    body: string,
  ) {
    this.rateLimit(actor.id);
    // Fixed categories are titled by their name; only Custom takes a title
    // (validated as required by the DTO).
    const subject =
      category === 'custom' && title ? title : SUPPORT_CATEGORY_LABEL[category];
    // organizationId comes from the authenticated user, never the client.
    const created = await this.prisma.supportConversation.create({
      data: {
        organizationId: actor.organizationId,
        createdByUserId: actor.id,
        category,
        subject,
        // `reference` is assigned by the database trigger (per-category sequence).
      },
    });
    await this.audit.log({
      actorUserId: actor.id,
      action: 'support.conversation.create',
      target: created.id,
      metadata: {
        organizationId: actor.organizationId,
        reference: created.reference,
        category,
        subject,
      },
    });
    const { conversation } = await this.addMessage(created.id, actor, 'user', body, true);
    return { conversation: this.userConversation(conversation) };
  }

  async getForUser(actor: SupportActor, id: string) {
    const c = await this.load(id, actor.organizationId);
    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 1000,
      include: messageInclude,
    });
    return {
      conversation: this.userConversation(c),
      messages: messages.map((m) => this.userMessage(m, actor.id)),
    };
  }

  async sendAsUser(actor: SupportActor, id: string, body: string) {
    const c = await this.load(id, actor.organizationId);
    if (c.status === 'closed') {
      throw new ConflictException({
        code: 'CONVERSATION_CLOSED',
        message: 'This conversation is closed. Reopen it to send a message.',
      });
    }
    this.rateLimit(actor.id);
    const { conversation, message } = await this.addMessage(id, actor, 'user', body);
    return {
      conversation: this.userConversation(conversation),
      message: this.userMessage(message, actor.id),
    };
  }

  async markReadAsUser(actor: SupportActor, id: string) {
    await this.load(id, actor.organizationId);
    const updated = await this.prisma.supportConversation.update({
      where: { id },
      data: { userUnreadCount: 0, userLastReadAt: new Date() },
      include: conversationInclude,
    });
    await this.clearNotifications(actor.id, id);
    await this.publishConversation(updated);
    return { conversation: this.userConversation(updated) };
  }

  async setStatusAsUser(actor: SupportActor, id: string, status: SupportConversationStatus) {
    await this.load(id, actor.organizationId);
    const c = await this.setStatus(actor, id, status, 'user');
    return { conversation: this.userConversation(c) };
  }

  /**
   * Answer the pending "Is this solved?" question. Yes closes the conversation
   * (resolution = solved); No keeps it open (resolution = unsolved) and alerts
   * the admins. 409 when nothing is pending or the conversation is closed.
   */
  async answerResolutionAsUser(actor: SupportActor, id: string, solved: boolean) {
    const c = await this.load(id, actor.organizationId);
    if (c.status === 'closed') {
      throw new ConflictException({
        code: 'CONVERSATION_CLOSED',
        message: 'This conversation is closed.',
      });
    }
    if (c.resolution !== 'pending') {
      throw new ConflictException({
        code: 'NO_PENDING_QUESTION',
        message: 'There is no pending question to answer.',
      });
    }
    const who = actor.username ?? 'a member';
    const now = new Date();
    const { conversation, message } = await this.addMessage(
      id,
      actor,
      'user',
      solved ? `Marked as solved by ${who}` : 'Not solved yet',
      false,
      {
        kind: 'resolution_answer',
        answer: solved,
        conversationData: solved
          ? {
              resolution: 'solved',
              resolvedAt: now,
              resolvedBy: { connect: { id: actor.id } },
              status: 'closed',
              closedAt: now,
            }
          : { resolution: 'unsolved', resolvedAt: null, resolvedBy: { disconnect: true } },
        notification: solved
          ? `${c.reference} marked as solved by ${who} (${c.organization.name})`
          : `${c.reference} not solved yet: ${who} (${c.organization.name})`,
      },
    );
    await this.audit.log({
      actorUserId: actor.id,
      action: solved ? 'support.conversation.resolved' : 'support.conversation.unresolved',
      target: id,
      metadata: { organizationId: c.organizationId, reference: c.reference, side: 'user' },
    });
    // The message event already carries the updated conversation; this keeps
    // list-only subscribers in sync with the status change too.
    await this.publishConversation(conversation);
    return {
      conversation: this.userConversation(conversation),
      message: this.userMessage(message, actor.id),
    };
  }

  // ------------------------------------------------------------ admin side

  /**
   * Post the "Is this solved?" card into an open conversation. Asking again
   * supersedes the pending question (only the latest can be answered).
   */
  async askResolutionAsAdmin(actor: SupportActor, id: string) {
    const c = await this.load(id);
    if (c.status === 'closed') {
      throw new ConflictException({
        code: 'CONVERSATION_CLOSED',
        message: 'This conversation is closed. Reopen it first.',
      });
    }
    this.rateLimit(actor.id);
    const { conversation, message } = await this.addMessage(
      id,
      actor,
      'admin',
      RESOLUTION_QUESTION[c.category],
      false,
      {
        kind: 'resolution_request',
        conversationData: { resolution: 'pending', resolvedAt: null, resolvedBy: { disconnect: true } },
        notification: resolutionNotification(c.category, c.reference),
      },
    );
    await this.audit.log({
      actorUserId: actor.id,
      action: 'support.conversation.ask_resolution',
      target: id,
      metadata: { organizationId: c.organizationId, reference: c.reference },
    });
    return {
      conversation: this.adminConversation(conversation),
      message: this.adminMessage(message, actor.id),
    };
  }

  async listForAdmin(filters: {
    status?: SupportConversationStatus;
    unread?: boolean;
    organizationId?: string;
    category?: SupportCategory;
    q?: string;
  }) {
    const q = filters.q?.trim();
    const ref = q ? normalizeReference(q) : null;
    const where: Prisma.SupportConversationWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.unread ? { adminUnreadCount: { gt: 0 } } : {}),
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(q
        ? ref
          ? { reference: ref }
          : {
              OR: [
                { reference: { contains: q, mode: 'insensitive' as const } },
                { subject: { contains: q, mode: 'insensitive' as const } },
              ],
            }
        : {}),
    };
    const [rows, agg] = await Promise.all([
      this.prisma.supportConversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: 500,
        include: conversationInclude,
      }),
      this.prisma.supportConversation.aggregate({ _sum: { adminUnreadCount: true } }),
    ]);
    return {
      conversations: rows.map((c) => this.adminConversation(c)),
      unreadTotal: agg._sum.adminUnreadCount ?? 0,
    };
  }

  async unreadForAdmin() {
    const agg = await this.prisma.supportConversation.aggregate({
      _sum: { adminUnreadCount: true },
    });
    return { unreadCount: agg._sum.adminUnreadCount ?? 0 };
  }

  async getForAdmin(actor: SupportActor, id: string) {
    const c = await this.load(id);
    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 1000,
      include: messageInclude,
    });
    return {
      conversation: this.adminConversation(c),
      messages: messages.map((m) => this.adminMessage(m, actor.id)),
    };
  }

  async replyAsAdmin(actor: SupportActor, id: string, body: string) {
    const c = await this.load(id);
    if (c.status === 'closed') {
      throw new ConflictException({
        code: 'CONVERSATION_CLOSED',
        message: 'This conversation is closed. Reopen it to reply.',
      });
    }
    this.rateLimit(actor.id);
    const { conversation, message } = await this.addMessage(id, actor, 'admin', body);
    return {
      conversation: this.adminConversation(conversation),
      message: this.adminMessage(message, actor.id),
    };
  }

  async markReadAsAdmin(actor: SupportActor, id: string) {
    await this.load(id);
    const updated = await this.prisma.supportConversation.update({
      where: { id },
      data: { adminUnreadCount: 0, adminLastReadAt: new Date() },
      include: conversationInclude,
    });
    // Admins share the inbox, so reading clears the thread's bell entries for
    // THIS admin only; other admins keep theirs until they open it.
    await this.clearNotifications(actor.id, id);
    await this.publishConversation(updated);
    return { conversation: this.adminConversation(updated) };
  }

  async setStatusAsAdmin(actor: SupportActor, id: string, status: SupportConversationStatus) {
    await this.load(id);
    const c = await this.setStatus(actor, id, status, 'admin');
    return { conversation: this.adminConversation(c) };
  }

  // ---------------------------------------------------------------- shared

  private async setStatus(
    actor: SupportActor,
    id: string,
    status: SupportConversationStatus,
    side: SupportSide,
  ): Promise<ConversationRow> {
    const current = await this.load(id);
    const updated = await this.prisma.supportConversation.update({
      where: { id },
      data: {
        status,
        closedAt: status === 'closed' ? new Date() : null,
        // Reopening clears the resolution; a manual close drops a pending
        // question (solved / unsolved history is kept).
        ...(status === 'open'
          ? { resolution: null, resolvedAt: null, resolvedBy: { disconnect: true } }
          : current.resolution === 'pending'
            ? { resolution: null }
            : {}),
      },
      include: conversationInclude,
    });
    await this.audit.log({
      actorUserId: actor.id,
      action: status === 'closed' ? 'support.conversation.close' : 'support.conversation.reopen',
      target: id,
      metadata: { organizationId: updated.organizationId, side },
    });
    await this.publishConversation(updated);
    return updated;
  }
}
