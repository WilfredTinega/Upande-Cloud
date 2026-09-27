import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PowerDnsClient } from './powerdns.client';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpsertRecordDto, DeleteRecordDto } from './dto/record.dto';
export interface RoutingRRSet {
    type: string;
    ttl: number;
    records: string[];
}
export declare class DnsService {
    private readonly prisma;
    private readonly pdns;
    private readonly audit;
    constructor(prisma: PrismaService, pdns: PowerDnsClient, audit: AuditService);
    private nameservers;
    listZones(organizationId: string): Promise<{
        nameservers: string[];
        id: string;
        createdAt: Date;
        name: string;
        status: import(".prisma/client").$Enums.DnsZoneStatus;
        organizationId: string;
    }[]>;
    quota(organizationId: string): Promise<{
        used: number;
        max: number;
        enabled: boolean;
        remaining: number;
    }>;
    listAllZones(): Promise<{
        id: string;
        name: string;
        status: import(".prisma/client").$Enums.DnsZoneStatus;
        createdAt: Date;
        organizationId: string;
        organizationName: string;
        nameservers: string[];
    }[]>;
    listRecordsAdmin(name: string): Promise<{
        name: string;
        type: string;
        ttl: number;
        records: string[];
        managed: boolean;
    }[]>;
    deleteZoneAdmin(actorUserId: string, name: string): Promise<{
        deleted: boolean;
    }>;
    private ownedZoneOrThrow;
    createZone(userId: string, organizationId: string, dto: CreateZoneDto): Promise<{
        nameservers: string[];
        id: string;
        createdAt: Date;
        name: string;
        status: import(".prisma/client").$Enums.DnsZoneStatus;
        organizationId: string;
    }>;
    deleteZone(userId: string, organizationId: string, name: string): Promise<{
        deleted: boolean;
    }>;
    listRecords(organizationId: string, name: string): Promise<{
        name: string;
        type: string;
        ttl: number;
        records: string[];
        managed: boolean;
    }[]>;
    upsertRecord(userId: string, organizationId: string, name: string, dto: UpsertRecordDto): Promise<{
        name: string;
        type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "CAA";
        ttl: number;
        records: string[];
    }>;
    deleteRecord(userId: string, organizationId: string, name: string, dto: DeleteRecordDto): Promise<{
        deleted: boolean;
    }>;
    platformNameservers(): string[];
    findZoneForDomain(domain: string): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        status: import(".prisma/client").$Enums.DnsZoneStatus;
        organizationId: string;
    } | null>;
    ensureRoutingRecord(userId: string, zoneName: string, fqdn: string, type: 'A' | 'AAAA' | 'CNAME', value: string): Promise<{
        status: 'created' | 'exists' | 'conflict';
        existing?: {
            type: string;
            records: string[];
        }[];
    }>;
    getRoutingRecords(zoneName: string, fqdn: string): Promise<{
        zoneStatus: string;
        rrsets: RoutingRRSet[];
        otherTypes: string[];
    }>;
    setRoutingRecord(userId: string, zoneName: string, fqdn: string, desired: {
        type: 'A' | 'AAAA' | 'CNAME';
        values: string[];
        ttl: number;
    }, managed: {
        type: string;
        values: string[];
    } | null, confirmReplace: boolean): Promise<{
        status: 'updated' | 'unchanged' | 'confirm_required';
        unmanaged: RoutingRRSet[];
        replaced: RoutingRRSet[];
        managedAfter: boolean;
    }>;
    removeRoutingRecord(userId: string, zoneName: string, fqdn: string, type: string, value: string): Promise<boolean>;
    private qualify;
    private relativize;
    private guardManagedRRSet;
    private normalizeContent;
}
