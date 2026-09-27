export interface PdnsRecord {
    content: string;
    disabled?: boolean;
}
export interface PdnsRRSet {
    name: string;
    type: string;
    ttl: number;
    records: PdnsRecord[];
    changetype?: 'REPLACE' | 'DELETE';
}
export interface PdnsZone {
    id: string;
    name: string;
    kind: string;
    serial: number;
    dnssec: boolean;
    rrsets?: PdnsRRSet[];
}
export declare class PowerDnsClient {
    private readonly logger;
    private readonly baseUrl;
    private readonly apiKey;
    private readonly serverId;
    constructor();
    static toCanonical(name: string): string;
    static fromCanonical(name: string): string;
    private request;
    listZones(): Promise<PdnsZone[]>;
    getZone(name: string): Promise<PdnsZone | null>;
    createZone(name: string, nameservers: string[]): Promise<PdnsZone>;
    deleteZone(name: string): Promise<void>;
    patchRRSets(zone: string, rrsets: PdnsRRSet[]): Promise<void>;
}
