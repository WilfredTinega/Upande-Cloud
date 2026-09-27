import { DnsService } from './dns.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpsertRecordDto, DeleteRecordDto } from './dto/record.dto';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class DnsController {
    private readonly dns;
    constructor(dns: DnsService);
    quota(user: AuthUser): Promise<{
        used: number;
        max: number;
        enabled: boolean;
        remaining: number;
    }>;
    listZones(user: AuthUser): Promise<{
        nameservers: string[];
        id: string;
        createdAt: Date;
        name: string;
        status: import(".prisma/client").$Enums.DnsZoneStatus;
        organizationId: string;
    }[]>;
    createZone(user: AuthUser, dto: CreateZoneDto): Promise<{
        nameservers: string[];
        id: string;
        createdAt: Date;
        name: string;
        status: import(".prisma/client").$Enums.DnsZoneStatus;
        organizationId: string;
    }>;
    deleteZone(user: AuthUser, name: string): Promise<{
        deleted: boolean;
    }>;
    listRecords(user: AuthUser, name: string): Promise<{
        name: string;
        type: string;
        ttl: number;
        records: string[];
        managed: boolean;
    }[]>;
    upsertRecord(user: AuthUser, name: string, dto: UpsertRecordDto): Promise<{
        name: string;
        type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "CAA";
        ttl: number;
        records: string[];
    }>;
    deleteRecord(user: AuthUser, name: string, dto: DeleteRecordDto): Promise<{
        deleted: boolean;
    }>;
}
export {};
