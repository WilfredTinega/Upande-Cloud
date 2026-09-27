export interface RequestStore {
    ip?: string;
    userId?: string;
}
export declare class RequestContextService {
    private readonly als;
    run<T>(store: RequestStore, fn: () => T): T;
    get(): RequestStore | undefined;
    get ip(): string | undefined;
    get userId(): string | undefined;
}
