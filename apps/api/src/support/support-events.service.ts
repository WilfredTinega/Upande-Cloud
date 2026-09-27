import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, filter, interval, map, merge } from 'rxjs';

/**
 * What changed in a support conversation. Emitted after every write so the
 * SSE streams can push it to connected clients:
 *   - message:      a new message was posted (conversationId + messageId)
 *   - conversation: status / unread counters changed (close, reopen, read)
 * The payload is deliberately just ids + org: each stream re-shapes the data
 * for its side (users never see admin identities), so subscribers refetch the
 * small bits they need, or use the side-specific snapshot attached by the
 * service.
 */
export interface SupportEvent {
  kind: 'message' | 'conversation';
  organizationId: string;
  conversationId: string;
  // Side-specific, ready-to-render payloads (already masked for users).
  forUser: Record<string, unknown>;
  forAdmin: Record<string, unknown>;
}

// Heartbeat so proxies don't cut idle streams and clients can detect a drop.
const HEARTBEAT_MS = 25_000;

/**
 * In-process pub/sub for support-chat events. The API runs as a single
 * process, so an rxjs Subject is enough; if the API is ever scaled out this
 * would need a Redis pub/sub fan-out (clients already fall back to polling, so
 * a missed event only delays an update, it never loses a message).
 */
@Injectable()
export class SupportEventsService implements OnModuleDestroy {
  private readonly events$ = new Subject<SupportEvent>();

  publish(event: SupportEvent): void {
    this.events$.next(event);
  }

  /** Stream for one organization's members (user side). */
  userStream(organizationId: string): Observable<{ data: unknown }> {
    return merge(
      this.events$.pipe(
        filter((e) => e.organizationId === organizationId),
        map((e) => ({ data: { kind: e.kind, conversationId: e.conversationId, ...e.forUser } })),
      ),
      this.heartbeat(),
    );
  }

  /** Cross-tenant stream for platform admins. */
  adminStream(): Observable<{ data: unknown }> {
    return merge(
      this.events$.pipe(
        map((e) => ({ data: { kind: e.kind, conversationId: e.conversationId, ...e.forAdmin } })),
      ),
      this.heartbeat(),
    );
  }

  private heartbeat(): Observable<{ data: unknown }> {
    return interval(HEARTBEAT_MS).pipe(map(() => ({ data: { kind: 'ping' } })));
  }

  onModuleDestroy(): void {
    this.events$.complete();
  }
}
