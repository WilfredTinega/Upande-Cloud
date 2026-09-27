"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SupportService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportService = exports.RESOLUTION_QUESTION = exports.SUPPORT_CATEGORY_LABEL = exports.SUPPORT_DISPLAY_NAME = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../common/audit.service");
const support_events_service_1 = require("./support-events.service");
exports.SUPPORT_DISPLAY_NAME = 'Upande Support';
const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;
const PREVIEW_LEN = 140;
exports.SUPPORT_CATEGORY_LABEL = {
    issue: 'Issue',
    inquiry: 'Inquiry',
    faqs: 'FAQs',
    custom: 'Custom',
};
exports.RESOLUTION_QUESTION = {
    issue: 'Is this issue solved?',
    inquiry: 'Did this answer your inquiry?',
    faqs: 'Did this answer your question?',
    custom: 'Is this resolved?',
};
function resolutionNotification(category, reference) {
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
function normalizeReference(q) {
    const m = /^(issue|inquiry|faqs|custom)[\s-]*0*(\d+)$/i.exec(q.trim());
    if (!m)
        return null;
    const n = m[2] || '0';
    return `${m[1].toUpperCase()}-${n.padStart(4, '0')}`;
}
const messageInclude = {
    author: { select: { id: true, username: true, email: true } },
};
const conversationInclude = {
    organization: { select: { id: true, name: true, slug: true } },
    createdBy: { select: { id: true, username: true, email: true, role: true, status: true } },
    resolvedBy: { select: { id: true, username: true } },
    messages: { orderBy: { createdAt: 'desc' }, take: 1, include: messageInclude },
};
function preview(body) {
    const flat = body.replace(/\s+/g, ' ').trim();
    return flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN - 1)}…` : flat;
}
let SupportService = SupportService_1 = class SupportService {
    constructor(prisma, audit, events) {
        this.prisma = prisma;
        this.audit = audit;
        this.events = events;
        this.logger = new common_1.Logger(SupportService_1.name);
        this.sendLog = new Map();
    }
    userMessage(m, viewerId) {
        const isAdmin = m.authorRole === client_1.SupportAuthorRole.admin;
        return {
            id: m.id,
            conversationId: m.conversationId,
            body: m.body,
            kind: m.kind,
            answer: m.answer,
            createdAt: m.createdAt,
            authorRole: m.authorRole,
            authorName: isAdmin ? exports.SUPPORT_DISPLAY_NAME : (m.author?.username ?? 'Former member'),
            authorUserId: isAdmin ? null : m.authorUserId,
            mine: !isAdmin && m.authorUserId === viewerId,
        };
    }
    adminMessage(m, viewerId) {
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
            mine: m.authorRole === client_1.SupportAuthorRole.admin,
            byMe: viewerId ? m.authorUserId === viewerId : false,
        };
    }
    userConversation(c) {
        const last = c.messages[0];
        return {
            id: c.id,
            reference: c.reference,
            category: c.category,
            title: c.subject,
            subject: c.subject,
            status: c.status,
            createdAt: c.createdAt,
            lastMessageAt: c.lastMessageAt,
            closedAt: c.closedAt,
            resolution: c.resolution,
            resolvedAt: c.resolvedAt,
            unreadCount: c.userUnreadCount,
            createdBy: c.createdBy ? { id: c.createdBy.id, username: c.createdBy.username } : null,
            lastMessage: last
                ? {
                    preview: preview(last.body),
                    kind: last.kind,
                    authorRole: last.authorRole,
                    authorName: last.authorRole === 'admin'
                        ? exports.SUPPORT_DISPLAY_NAME
                        : (last.author?.username ?? 'Former member'),
                    createdAt: last.createdAt,
                }
                : null,
        };
    }
    adminConversation(c) {
        const last = c.messages[0];
        return {
            id: c.id,
            reference: c.reference,
            category: c.category,
            title: c.subject,
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
    rateLimit(userId) {
        const now = Date.now();
        const recent = (this.sendLog.get(userId) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
        if (recent.length >= SEND_LIMIT) {
            throw new common_1.HttpException({
                code: 'RATE_LIMITED',
                message: 'You are sending messages too quickly. Please wait a moment.',
            }, common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        recent.push(now);
        this.sendLog.set(userId, recent);
        if (this.sendLog.size > 5000) {
            for (const [k, v] of this.sendLog) {
                if (!v.some((t) => now - t < SEND_WINDOW_MS))
                    this.sendLog.delete(k);
            }
        }
    }
    notFound() {
        throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found' });
    }
    async load(id, organizationId) {
        const c = await this.prisma.supportConversation.findFirst({
            where: { id, ...(organizationId ? { organizationId } : {}) },
            include: conversationInclude,
        });
        if (!c)
            this.notFound();
        return c;
    }
    async publishConversation(c) {
        this.events.publish({
            kind: 'conversation',
            organizationId: c.organizationId,
            conversationId: c.id,
            forUser: { conversation: this.userConversation(c) },
            forAdmin: { conversation: this.adminConversation(c) },
        });
    }
    async publishMessage(c, m) {
        this.events.publish({
            kind: 'message',
            organizationId: c.organizationId,
            conversationId: c.id,
            forUser: { conversation: this.userConversation(c), message: this.userMessage(m, '') },
            forAdmin: { conversation: this.adminConversation(c), message: this.adminMessage(m) },
        });
    }
    async notifyOtherSide(c, m, authorSide, isNewConversation, override) {
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
            let recipients;
            let message;
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
            }
            else {
                const posters = await this.prisma.supportMessage.findMany({
                    where: { conversationId: c.id, authorRole: 'user', authorUserId: { not: null } },
                    select: { authorUserId: true },
                    distinct: ['authorUserId'],
                });
                const ids = new Set(posters.map((p) => p.authorUserId));
                if (c.createdByUserId)
                    ids.add(c.createdByUserId);
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
                    override ?? `New reply on ${c.reference} from ${exports.SUPPORT_DISPLAY_NAME}: ${preview(m.body)}`;
            }
            recipients = recipients.filter((id) => id !== m.authorUserId);
            if (recipients.length === 0)
                return;
            await this.prisma.notification.createMany({
                data: recipients.map((userId) => ({
                    userId,
                    organizationId: authorSide === 'user' ? null : c.organizationId,
                    type: 'support_message',
                    message,
                    metadata: { ...metadata, side: authorSide === 'user' ? 'admin' : 'user' },
                })),
            });
        }
        catch (err) {
            this.logger.warn(`support notification failed: ${err.message}`);
        }
    }
    async clearNotifications(userId, conversationId) {
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
    async addMessage(conversationId, actor, side, body, isNewConversation = false, opts = {}) {
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
                        ?
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
    async listForOrg(organizationId, status) {
        const rows = await this.prisma.supportConversation.findMany({
            where: { organizationId, ...(status ? { status } : {}) },
            orderBy: { lastMessageAt: 'desc' },
            take: 200,
            include: conversationInclude,
        });
        const unreadTotal = rows.reduce((n, c) => n + c.userUnreadCount, 0);
        return { conversations: rows.map((c) => this.userConversation(c)), unreadTotal };
    }
    async unreadForOrg(organizationId) {
        const agg = await this.prisma.supportConversation.aggregate({
            where: { organizationId },
            _sum: { userUnreadCount: true },
        });
        return { unreadCount: agg._sum.userUnreadCount ?? 0 };
    }
    async createForUser(actor, category, title, body) {
        this.rateLimit(actor.id);
        const subject = category === 'custom' && title ? title : exports.SUPPORT_CATEGORY_LABEL[category];
        const created = await this.prisma.supportConversation.create({
            data: {
                organizationId: actor.organizationId,
                createdByUserId: actor.id,
                category,
                subject,
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
    async getForUser(actor, id) {
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
    async sendAsUser(actor, id, body) {
        const c = await this.load(id, actor.organizationId);
        if (c.status === 'closed') {
            throw new common_1.ConflictException({
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
    async markReadAsUser(actor, id) {
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
    async setStatusAsUser(actor, id, status) {
        await this.load(id, actor.organizationId);
        const c = await this.setStatus(actor, id, status, 'user');
        return { conversation: this.userConversation(c) };
    }
    async answerResolutionAsUser(actor, id, solved) {
        const c = await this.load(id, actor.organizationId);
        if (c.status === 'closed') {
            throw new common_1.ConflictException({
                code: 'CONVERSATION_CLOSED',
                message: 'This conversation is closed.',
            });
        }
        if (c.resolution !== 'pending') {
            throw new common_1.ConflictException({
                code: 'NO_PENDING_QUESTION',
                message: 'There is no pending question to answer.',
            });
        }
        const who = actor.username ?? 'a member';
        const now = new Date();
        const { conversation, message } = await this.addMessage(id, actor, 'user', solved ? `Marked as solved by ${who}` : 'Not solved yet', false, {
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
        });
        await this.audit.log({
            actorUserId: actor.id,
            action: solved ? 'support.conversation.resolved' : 'support.conversation.unresolved',
            target: id,
            metadata: { organizationId: c.organizationId, reference: c.reference, side: 'user' },
        });
        await this.publishConversation(conversation);
        return {
            conversation: this.userConversation(conversation),
            message: this.userMessage(message, actor.id),
        };
    }
    async askResolutionAsAdmin(actor, id) {
        const c = await this.load(id);
        if (c.status === 'closed') {
            throw new common_1.ConflictException({
                code: 'CONVERSATION_CLOSED',
                message: 'This conversation is closed. Reopen it first.',
            });
        }
        this.rateLimit(actor.id);
        const { conversation, message } = await this.addMessage(id, actor, 'admin', exports.RESOLUTION_QUESTION[c.category], false, {
            kind: 'resolution_request',
            conversationData: { resolution: 'pending', resolvedAt: null, resolvedBy: { disconnect: true } },
            notification: resolutionNotification(c.category, c.reference),
        });
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
    async listForAdmin(filters) {
        const q = filters.q?.trim();
        const ref = q ? normalizeReference(q) : null;
        const where = {
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.unread ? { adminUnreadCount: { gt: 0 } } : {}),
            ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
            ...(filters.category ? { category: filters.category } : {}),
            ...(q
                ? ref
                    ? { reference: ref }
                    : {
                        OR: [
                            { reference: { contains: q, mode: 'insensitive' } },
                            { subject: { contains: q, mode: 'insensitive' } },
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
    async getForAdmin(actor, id) {
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
    async replyAsAdmin(actor, id, body) {
        const c = await this.load(id);
        if (c.status === 'closed') {
            throw new common_1.ConflictException({
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
    async markReadAsAdmin(actor, id) {
        await this.load(id);
        const updated = await this.prisma.supportConversation.update({
            where: { id },
            data: { adminUnreadCount: 0, adminLastReadAt: new Date() },
            include: conversationInclude,
        });
        await this.clearNotifications(actor.id, id);
        await this.publishConversation(updated);
        return { conversation: this.adminConversation(updated) };
    }
    async setStatusAsAdmin(actor, id, status) {
        await this.load(id);
        const c = await this.setStatus(actor, id, status, 'admin');
        return { conversation: this.adminConversation(c) };
    }
    async setStatus(actor, id, status, side) {
        const current = await this.load(id);
        const updated = await this.prisma.supportConversation.update({
            where: { id },
            data: {
                status,
                closedAt: status === 'closed' ? new Date() : null,
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
};
exports.SupportService = SupportService;
exports.SupportService = SupportService = SupportService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService,
        support_events_service_1.SupportEventsService])
], SupportService);
//# sourceMappingURL=support.service.js.map