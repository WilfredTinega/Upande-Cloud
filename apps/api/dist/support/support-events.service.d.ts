import { OnModuleDestroy } from '@nestjs/common';
import { Observable } from 'rxjs';
export interface SupportEvent {
    kind: 'message' | 'conversation';
    organizationId: string;
    conversationId: string;
    forUser: Record<string, unknown>;
    forAdmin: Record<string, unknown>;
}
export declare class SupportEventsService implements OnModuleDestroy {
    private readonly events$;
    publish(event: SupportEvent): void;
    userStream(organizationId: string): Observable<{
        data: unknown;
    }>;
    adminStream(): Observable<{
        data: unknown;
    }>;
    private heartbeat;
    onModuleDestroy(): void;
}
