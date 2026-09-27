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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DnsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../common/audit.service");
const powerdns_client_1 = require("./powerdns.client");
const custom_domain_util_1 = require("../apps/custom-domain.util");
let DnsService = class DnsService {
    constructor(prisma, pdns, audit) {
        this.prisma = prisma;
        this.pdns = pdns;
        this.audit = audit;
    }
    nameservers() {
        const base = process.env.DNS_BASE_DOMAIN || 'oponde.top';
        const raw = process.env.DNS_NAMESERVERS || `ns1.${base},ns2.${base}`;
        return raw
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
    }
    async listZones(organizationId) {
        const zones = await this.prisma.dnsZone.findMany({
            where: { organizationId },
            orderBy: { createdAt: 'desc' },
        });
        const nameservers = this.nameservers();
        return zones.map((z) => ({ ...z, nameservers }));
    }
    async quota(organizationId) {
        const quota = await this.prisma.quota.findUnique({
            where: { organizationId },
        });
        const max = quota?.maxDnsZones ?? 0;
        const used = await this.prisma.dnsZone.count({ where: { organizationId } });
        return { used, max, enabled: max > 0, remaining: Math.max(0, max - used) };
    }
    async listAllZones() {
        const zones = await this.prisma.dnsZone.findMany({
            orderBy: { createdAt: 'desc' },
            include: { organization: { select: { id: true, name: true } } },
        });
        const nameservers = this.nameservers();
        return zones.map((z) => ({
            id: z.id,
            name: z.name,
            status: z.status,
            createdAt: z.createdAt,
            organizationId: z.organizationId,
            organizationName: z.organization?.name ?? z.organizationId,
            nameservers,
        }));
    }
    async listRecordsAdmin(name) {
        const canonical = powerdns_client_1.PowerDnsClient.fromCanonical(name);
        const zone = await this.prisma.dnsZone.findUnique({ where: { name: canonical } });
        if (!zone)
            throw new common_1.NotFoundException(`DNS zone ${canonical} not found`);
        return this.listRecords(zone.organizationId, canonical);
    }
    async deleteZoneAdmin(actorUserId, name) {
        const canonical = powerdns_client_1.PowerDnsClient.fromCanonical(name);
        const zone = await this.prisma.dnsZone.findUnique({ where: { name: canonical } });
        if (!zone)
            throw new common_1.NotFoundException(`DNS zone ${canonical} not found`);
        await this.pdns.deleteZone(zone.name);
        await this.prisma.dnsZone.delete({ where: { id: zone.id } });
        await this.audit.log({
            actorUserId,
            action: 'dns.zone.delete.admin',
            target: zone.name,
            metadata: { organizationId: zone.organizationId },
        });
        return { deleted: true };
    }
    async ownedZoneOrThrow(organizationId, name) {
        const canonical = powerdns_client_1.PowerDnsClient.fromCanonical(name);
        const zone = await this.prisma.dnsZone.findUnique({
            where: { name: canonical },
        });
        if (!zone || zone.organizationId !== organizationId) {
            throw new common_1.NotFoundException(`DNS zone ${canonical} not found`);
        }
        return zone;
    }
    async createZone(userId, organizationId, dto) {
        const name = powerdns_client_1.PowerDnsClient.fromCanonical(dto.name);
        const quota = await this.prisma.quota.findUnique({
            where: { organizationId },
        });
        const maxDnsZones = quota?.maxDnsZones ?? 0;
        if (maxDnsZones <= 0) {
            throw new common_1.ForbiddenException('DNS hosting is not enabled for your account. Contact billing to add it.');
        }
        const used = await this.prisma.dnsZone.count({
            where: { organizationId },
        });
        if (used >= maxDnsZones) {
            throw new common_1.ForbiddenException(`DNS zone limit reached (${used}/${maxDnsZones}). Upgrade to host more domains.`);
        }
        const existing = await this.prisma.dnsZone.findUnique({
            where: { name },
        });
        if (existing) {
            throw new common_1.ConflictException(`${name} is already hosted on this platform.`);
        }
        await this.pdns.createZone(name, this.nameservers());
        const zone = await this.prisma.dnsZone.create({
            data: { organizationId, name },
        });
        await this.audit.log({
            actorUserId: userId,
            action: 'dns.zone.create',
            target: name,
            metadata: { organizationId },
        });
        return { ...zone, nameservers: this.nameservers() };
    }
    async deleteZone(userId, organizationId, name) {
        const zone = await this.ownedZoneOrThrow(organizationId, name);
        await this.pdns.deleteZone(zone.name);
        await this.prisma.dnsZone.delete({ where: { id: zone.id } });
        await this.audit.log({
            actorUserId: userId,
            action: 'dns.zone.delete',
            target: zone.name,
            metadata: { organizationId },
        });
        return { deleted: true };
    }
    async listRecords(organizationId, name) {
        const zone = await this.ownedZoneOrThrow(organizationId, name);
        const pdnsZone = await this.pdns.getZone(zone.name);
        if (!pdnsZone) {
            throw new common_1.NotFoundException(`DNS zone ${zone.name} not found in backend`);
        }
        const apex = powerdns_client_1.PowerDnsClient.toCanonical(zone.name);
        return (pdnsZone.rrsets ?? [])
            .filter((rr) => rr.type !== 'SOA')
            .map((rr) => ({
            name: this.relativize(rr.name, apex),
            type: rr.type,
            ttl: rr.ttl,
            records: rr.records.map((r) => r.content),
            managed: rr.type === 'NS' && rr.name === apex,
        }));
    }
    async upsertRecord(userId, organizationId, name, dto) {
        const zone = await this.ownedZoneOrThrow(organizationId, name);
        if (zone.status !== 'active') {
            throw new common_1.ForbiddenException('This zone is suspended; record edits are disabled.');
        }
        const fqdn = this.qualify(dto.name, zone.name);
        this.guardManagedRRSet(dto.type, fqdn, zone.name);
        const rrset = {
            name: powerdns_client_1.PowerDnsClient.toCanonical(fqdn),
            type: dto.type,
            ttl: dto.ttl ?? 3600,
            changetype: 'REPLACE',
            records: dto.records.map((content) => ({
                content: this.normalizeContent(dto.type, content),
                disabled: false,
            })),
        };
        await this.pdns.patchRRSets(zone.name, [rrset]);
        await this.audit.log({
            actorUserId: userId,
            action: 'dns.record.upsert',
            target: `${fqdn} ${dto.type}`,
            metadata: { organizationId, count: dto.records.length },
        });
        return { name: this.relativize(rrset.name, powerdns_client_1.PowerDnsClient.toCanonical(zone.name)), type: dto.type, ttl: rrset.ttl, records: dto.records };
    }
    async deleteRecord(userId, organizationId, name, dto) {
        const zone = await this.ownedZoneOrThrow(organizationId, name);
        if (zone.status !== 'active') {
            throw new common_1.ForbiddenException('This zone is suspended; record edits are disabled.');
        }
        const fqdn = this.qualify(dto.name, zone.name);
        this.guardManagedRRSet(dto.type, fqdn, zone.name);
        await this.pdns.patchRRSets(zone.name, [
            {
                name: powerdns_client_1.PowerDnsClient.toCanonical(fqdn),
                type: dto.type,
                ttl: 3600,
                changetype: 'DELETE',
                records: [],
            },
        ]);
        await this.audit.log({
            actorUserId: userId,
            action: 'dns.record.delete',
            target: `${fqdn} ${dto.type}`,
            metadata: { organizationId },
        });
        return { deleted: true };
    }
    platformNameservers() {
        return this.nameservers();
    }
    async findZoneForDomain(domain) {
        const name = powerdns_client_1.PowerDnsClient.fromCanonical(domain);
        const labels = name.split('.');
        const candidates = labels
            .slice(0, -1)
            .map((_, i) => labels.slice(i).join('.'));
        if (!candidates.length)
            return null;
        const zones = await this.prisma.dnsZone.findMany({
            where: { name: { in: candidates } },
        });
        if (!zones.length)
            return null;
        return zones.sort((a, b) => b.name.length - a.name.length)[0];
    }
    async ensureRoutingRecord(userId, zoneName, fqdn, type, value) {
        const zone = await this.prisma.dnsZone.findUnique({
            where: { name: powerdns_client_1.PowerDnsClient.fromCanonical(zoneName) },
        });
        if (!zone)
            throw new common_1.NotFoundException(`DNS zone ${zoneName} not found`);
        if (zone.status !== 'active') {
            throw new common_1.ForbiddenException(`DNS zone ${zone.name} is suspended; records cannot be created.`);
        }
        const pdnsZone = await this.pdns.getZone(zone.name);
        if (!pdnsZone) {
            throw new common_1.NotFoundException(`DNS zone ${zone.name} not found in backend`);
        }
        const canonical = powerdns_client_1.PowerDnsClient.toCanonical(fqdn);
        const content = type === 'CNAME' ? powerdns_client_1.PowerDnsClient.toCanonical(value) : value.trim();
        const atName = (pdnsZone.rrsets ?? []).filter((rr) => rr.name === canonical);
        const describe = (rrs) => rrs.map((rr) => ({
            type: rr.type,
            records: rr.records.map((r) => r.content),
        }));
        const same = atName.find((rr) => rr.type === type);
        if (same) {
            const contents = same.records.map((r) => r.content.toLowerCase());
            if (contents.length === 1 && contents[0] === content.toLowerCase()) {
                return { status: 'exists' };
            }
            return { status: 'conflict', existing: describe([same]) };
        }
        const blocking = type === 'CNAME'
            ? atName
            : atName.filter((rr) => rr.type === 'CNAME');
        if (blocking.length) {
            return { status: 'conflict', existing: describe(blocking) };
        }
        await this.pdns.patchRRSets(zone.name, [
            {
                name: canonical,
                type,
                ttl: 300,
                changetype: 'REPLACE',
                records: [{ content, disabled: false }],
            },
        ]);
        await this.audit.log({
            actorUserId: userId,
            action: 'dns.record.upsert',
            target: `${powerdns_client_1.PowerDnsClient.fromCanonical(canonical)} ${type}`,
            metadata: {
                organizationId: zone.organizationId,
                source: 'custom-domain',
                content,
            },
        });
        return { status: 'created' };
    }
    async getRoutingRecords(zoneName, fqdn) {
        const zone = await this.prisma.dnsZone.findUnique({
            where: { name: powerdns_client_1.PowerDnsClient.fromCanonical(zoneName) },
        });
        if (!zone)
            throw new common_1.NotFoundException(`DNS zone ${zoneName} not found`);
        const pdnsZone = await this.pdns.getZone(zone.name);
        if (!pdnsZone) {
            throw new common_1.NotFoundException(`DNS zone ${zone.name} not found in backend`);
        }
        const canonical = powerdns_client_1.PowerDnsClient.toCanonical(fqdn);
        const atName = (pdnsZone.rrsets ?? []).filter((rr) => rr.name === canonical);
        const routing = new Set(custom_domain_util_1.ROUTING_TYPES);
        return {
            zoneStatus: zone.status,
            rrsets: atName
                .filter((rr) => routing.has(rr.type))
                .map((rr) => ({
                type: rr.type,
                ttl: rr.ttl,
                records: rr.records.filter((r) => !r.disabled).map((r) => r.content),
            })),
            otherTypes: atName.filter((rr) => !routing.has(rr.type)).map((rr) => rr.type),
        };
    }
    async setRoutingRecord(userId, zoneName, fqdn, desired, managed, confirmReplace) {
        const current = await this.getRoutingRecords(zoneName, fqdn);
        const zone = powerdns_client_1.PowerDnsClient.fromCanonical(zoneName);
        if (current.zoneStatus !== 'active') {
            throw new common_1.ForbiddenException(`DNS zone ${zone} is suspended; records cannot be changed.`);
        }
        if (!desired.values.length) {
            throw new common_1.BadRequestException('At least one record value is required.');
        }
        if (desired.type === 'CNAME') {
            if (powerdns_client_1.PowerDnsClient.fromCanonical(fqdn) === zone) {
                throw new common_1.BadRequestException('A CNAME is not allowed at the zone apex (RFC 1034).');
            }
            if (desired.values.length !== 1) {
                throw new common_1.BadRequestException('A CNAME must have exactly one target.');
            }
            if (current.otherTypes.length) {
                throw new common_1.BadRequestException(`${fqdn} also has ${[...new Set(current.otherTypes)].join(', ')} records, which can't coexist with a CNAME. Use "Custom IP" (A/AAAA) instead, or remove those records on the DNS page.`);
            }
        }
        const contents = desired.values.map((v) => desired.type === 'CNAME' ? powerdns_client_1.PowerDnsClient.toCanonical(v) : v.trim());
        const isManaged = (rr) => !!managed &&
            rr.type === managed.type &&
            rr.records.length > 0 &&
            rr.records.every((c) => managed.values.some((m) => (0, custom_domain_util_1.recordKey)(rr.type, m) === (0, custom_domain_util_1.recordKey)(rr.type, c)));
        const same = current.rrsets.find((rr) => rr.type === desired.type);
        const others = current.rrsets.filter((rr) => rr.type !== desired.type);
        if (same &&
            !others.length &&
            same.ttl === desired.ttl &&
            (0, custom_domain_util_1.sameValueSet)(desired.type, same.records, contents)) {
            const managedAfter = isManaged(same);
            return { status: 'unchanged', unmanaged: managedAfter ? [] : [same], replaced: [], managedAfter };
        }
        const affected = [
            ...(same && !(0, custom_domain_util_1.sameValueSet)(desired.type, same.records, contents) ? [same] : []),
            ...others,
        ];
        const unmanaged = affected.filter((rr) => !isManaged(rr));
        if (unmanaged.length && !confirmReplace) {
            return { status: 'confirm_required', unmanaged, replaced: [], managedAfter: false };
        }
        const canonical = powerdns_client_1.PowerDnsClient.toCanonical(fqdn);
        await this.pdns.patchRRSets(zone, [
            {
                name: canonical,
                type: desired.type,
                ttl: desired.ttl,
                changetype: 'REPLACE',
                records: contents.map((content) => ({ content, disabled: false })),
            },
            ...others.map((rr) => ({
                name: canonical,
                type: rr.type,
                ttl: rr.ttl,
                changetype: 'DELETE',
                records: [],
            })),
        ]);
        await this.audit.log({
            actorUserId: userId,
            action: 'dns.record.upsert',
            target: `${powerdns_client_1.PowerDnsClient.fromCanonical(canonical)} ${desired.type}`,
            metadata: {
                source: 'custom-domain-target',
                records: contents,
                ttl: desired.ttl,
                replaced: affected,
                replacedUnmanaged: unmanaged.length > 0,
            },
        });
        const keptUserRRSet = !!same && (0, custom_domain_util_1.sameValueSet)(desired.type, same.records, contents) && !isManaged(same);
        return { status: 'updated', unmanaged, replaced: affected, managedAfter: !keptUserRRSet };
    }
    async removeRoutingRecord(userId, zoneName, fqdn, type, value) {
        const name = powerdns_client_1.PowerDnsClient.fromCanonical(zoneName);
        const zone = await this.prisma.dnsZone.findUnique({ where: { name } });
        if (!zone)
            return false;
        const pdnsZone = await this.pdns.getZone(zone.name);
        if (!pdnsZone)
            return false;
        const canonical = powerdns_client_1.PowerDnsClient.toCanonical(fqdn);
        const ours = new Set((0, custom_domain_util_1.splitManagedValues)(value).map((v) => (0, custom_domain_util_1.recordKey)(type, v)));
        const content = (0, custom_domain_util_1.splitManagedValues)(value).join(',');
        const rrset = (pdnsZone.rrsets ?? []).find((rr) => rr.name === canonical && rr.type === type);
        if (!rrset)
            return false;
        const remaining = rrset.records.filter((r) => !ours.has((0, custom_domain_util_1.recordKey)(type, r.content)));
        if (remaining.length === rrset.records.length)
            return false;
        await this.pdns.patchRRSets(zone.name, [
            remaining.length
                ? { ...rrset, changetype: 'REPLACE', records: remaining }
                : { name: canonical, type, ttl: rrset.ttl, changetype: 'DELETE', records: [] },
        ]);
        await this.audit.log({
            actorUserId: userId,
            action: 'dns.record.delete',
            target: `${powerdns_client_1.PowerDnsClient.fromCanonical(canonical)} ${type}`,
            metadata: {
                organizationId: zone.organizationId,
                source: 'custom-domain',
                content,
            },
        });
        return true;
    }
    qualify(sub, zone) {
        const z = powerdns_client_1.PowerDnsClient.fromCanonical(zone);
        const s = sub.trim().toLowerCase().replace(/\.$/, '');
        if (s === '' || s === '@')
            return z;
        if (s === z || s.endsWith(`.${z}`))
            return s;
        return `${s}.${z}`;
    }
    relativize(canonicalName, apexCanonical) {
        const n = powerdns_client_1.PowerDnsClient.fromCanonical(canonicalName);
        const apex = powerdns_client_1.PowerDnsClient.fromCanonical(apexCanonical);
        if (n === apex)
            return '@';
        return n.endsWith(`.${apex}`) ? n.slice(0, -(apex.length + 1)) : n;
    }
    guardManagedRRSet(type, fqdn, zone) {
        const apex = powerdns_client_1.PowerDnsClient.fromCanonical(zone);
        const isApex = powerdns_client_1.PowerDnsClient.fromCanonical(fqdn) === apex;
        if (type === 'SOA') {
            throw new common_1.BadRequestException('The SOA record is managed automatically.');
        }
        if (isApex && type === 'NS') {
            throw new common_1.BadRequestException('Apex NS records are managed by the platform and cannot be changed.');
        }
        if (isApex && type === 'CNAME') {
            throw new common_1.BadRequestException('A CNAME is not allowed at the zone apex (RFC 1034).');
        }
    }
    normalizeContent(type, content) {
        const c = content.trim();
        const ensureDot = (host) => /^[a-z0-9._-]+$/i.test(host) && !host.endsWith('.') ? `${host}.` : host;
        switch (type) {
            case 'CNAME':
            case 'NS':
                return ensureDot(c);
            case 'MX': {
                const m = c.match(/^(\d+)\s+(\S+)$/);
                if (!m) {
                    throw new common_1.BadRequestException('MX value must be "<priority> <host>", e.g. "10 mail.example.com".');
                }
                return `${m[1]} ${ensureDot(m[2])}`;
            }
            case 'SRV': {
                const m = c.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
                if (!m) {
                    throw new common_1.BadRequestException('SRV value must be "<priority> <weight> <port> <target>".');
                }
                return `${m[1]} ${m[2]} ${m[3]} ${ensureDot(m[4])}`;
            }
            case 'TXT': {
                if (c.startsWith('"') && c.endsWith('"'))
                    return c;
                return `"${c.replace(/"/g, '\\"')}"`;
            }
            default:
                return c;
        }
    }
};
exports.DnsService = DnsService;
exports.DnsService = DnsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        powerdns_client_1.PowerDnsClient,
        audit_service_1.AuditService])
], DnsService);
//# sourceMappingURL=dns.service.js.map