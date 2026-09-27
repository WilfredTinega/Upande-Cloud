export declare function isApexDomain(domain: string, hostedZone?: string | null): boolean;
export declare function validIp(ip: string | null | undefined): string | null;
export declare function platformHostIsPublic(): boolean;
export interface RouteTarget {
    host: string;
    type: 'A' | 'AAAA' | 'CNAME';
    value: string | null;
    apex: boolean;
    note?: string;
}
export declare function routeTarget(domain: string, appSubdomain: string, hostedZone: string | null | undefined, serverIp: string | null): RouteTarget;
export declare function dnsErrorLabel(err: unknown): string;
export declare function lookup(fn: () => Promise<string[]>): Promise<{
    values: string[];
    error: string | null;
}>;
export declare function sameHost(a: string, b: string): boolean;
export type PublicRecordKind = 'A' | 'AAAA' | 'CNAME' | 'NS' | 'TXT';
export declare function resolvePublic(kind: PublicRecordKind, host: string): Promise<{
    values: string[];
    error: string | null;
}>;
export declare const ROUTING_TYPES: readonly ["A", "AAAA", "CNAME"];
export type RoutingType = (typeof ROUTING_TYPES)[number];
export declare function splitManagedValues(v: string | null | undefined): string[];
export declare function recordKey(type: string, value: string): string;
export declare function sameValueSet(type: string, a: string[], b: string[]): boolean;
