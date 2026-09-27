import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PowerDnsClient, PdnsRRSet } from './powerdns.client';
import { CreateZoneDto } from './dto/create-zone.dto';
import {
  UpsertRecordDto,
  DeleteRecordDto,
  SupportedRecordType,
} from './dto/record.dto';
import {
  ROUTING_TYPES,
  recordKey,
  sameValueSet,
  splitManagedValues,
} from '../apps/custom-domain.util';

/** An RRset as shown to the user: bare type, TTL and record contents. */
export interface RoutingRRSet {
  type: string;
  ttl: number;
  records: string[];
}

/**
 * Managed DNS hosting. Ownership/billing/quota live in the app DB (DnsZone +
 * Quota.maxDnsZones); the authoritative record data lives in PowerDNS and is
 * read/written through {@link PowerDnsClient}. Every customer-facing method is
 * scoped by organizationId so one org can never touch another's zone.
 */
@Injectable()
export class DnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdns: PowerDnsClient,
    private readonly audit: AuditService,
  ) {}

  /** Bare nameserver hostnames customers must delegate to. */
  private nameservers(): string[] {
    const base = process.env.DNS_BASE_DOMAIN || 'oponde.top';
    const raw =
      process.env.DNS_NAMESERVERS || `ns1.${base},ns2.${base}`;
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  // ---- Zones -------------------------------------------------------------

  async listZones(organizationId: string) {
    const zones = await this.prisma.dnsZone.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const nameservers = this.nameservers();
    return zones.map((z) => ({ ...z, nameservers }));
  }

  /** The org's DNS zone quota and current usage, for the dashboard. */
  async quota(organizationId: string) {
    const quota = await this.prisma.quota.findUnique({
      where: { organizationId },
    });
    const max = quota?.maxDnsZones ?? 0;
    const used = await this.prisma.dnsZone.count({ where: { organizationId } });
    return { used, max, enabled: max > 0, remaining: Math.max(0, max - used) };
  }

  // ---- Admin (cross-tenant) ---------------------------------------------

  /**
   * Platform-admin view: every hosted zone across all organizations, with the
   * owning org's name attached. Not org-scoped — guarded at the controller by
   * the admin role.
   */
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

  /** Admin: list a zone's records by zone name, regardless of owning org. */
  async listRecordsAdmin(name: string) {
    const canonical = PowerDnsClient.fromCanonical(name);
    const zone = await this.prisma.dnsZone.findUnique({ where: { name: canonical } });
    if (!zone) throw new NotFoundException(`DNS zone ${canonical} not found`);
    return this.listRecords(zone.organizationId, canonical);
  }

  /** Admin: delete any zone (e.g. abuse / cleanup), regardless of owning org. */
  async deleteZoneAdmin(actorUserId: string, name: string) {
    const canonical = PowerDnsClient.fromCanonical(name);
    const zone = await this.prisma.dnsZone.findUnique({ where: { name: canonical } });
    if (!zone) throw new NotFoundException(`DNS zone ${canonical} not found`);

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

  /** Look up a zone owned by this org or 404. */
  private async ownedZoneOrThrow(organizationId: string, name: string) {
    const canonical = PowerDnsClient.fromCanonical(name);
    const zone = await this.prisma.dnsZone.findUnique({
      where: { name: canonical },
    });
    if (!zone || zone.organizationId !== organizationId) {
      throw new NotFoundException(`DNS zone ${canonical} not found`);
    }
    return zone;
  }

  async createZone(
    userId: string,
    organizationId: string,
    dto: CreateZoneDto,
  ) {
    const name = PowerDnsClient.fromCanonical(dto.name);

    // Quota: the org must have bought the DNS add-on and have headroom.
    const quota = await this.prisma.quota.findUnique({
      where: { organizationId },
    });
    const maxDnsZones = quota?.maxDnsZones ?? 0;
    if (maxDnsZones <= 0) {
      throw new ForbiddenException(
        'DNS hosting is not enabled for your account. Contact billing to add it.',
      );
    }
    const used = await this.prisma.dnsZone.count({
      where: { organizationId },
    });
    if (used >= maxDnsZones) {
      throw new ForbiddenException(
        `DNS zone limit reached (${used}/${maxDnsZones}). Upgrade to host more domains.`,
      );
    }

    // Uniqueness: a domain can only be hosted once across the whole platform.
    const existing = await this.prisma.dnsZone.findUnique({
      where: { name },
    });
    if (existing) {
      throw new ConflictException(
        `${name} is already hosted on this platform.`,
      );
    }

    // Create in PowerDNS first; only persist ownership if that succeeds, so we
    // never have a DnsZone row pointing at a non-existent backend zone.
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

  async deleteZone(
    userId: string,
    organizationId: string,
    name: string,
  ) {
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

  // ---- Records -----------------------------------------------------------

  /**
   * List a zone's records as flat, customer-friendly rows: { name, type, ttl,
   * records[] }. The platform-managed SOA is hidden; apex NS are shown read-only.
   */
  async listRecords(organizationId: string, name: string) {
    const zone = await this.ownedZoneOrThrow(organizationId, name);
    const pdnsZone = await this.pdns.getZone(zone.name);
    if (!pdnsZone) {
      throw new NotFoundException(`DNS zone ${zone.name} not found in backend`);
    }
    const apex = PowerDnsClient.toCanonical(zone.name);
    return (pdnsZone.rrsets ?? [])
      .filter((rr) => rr.type !== 'SOA')
      .map((rr) => ({
        // Present names relative to the zone: apex -> "@", else strip the suffix.
        name: this.relativize(rr.name, apex),
        type: rr.type,
        ttl: rr.ttl,
        records: rr.records.map((r) => r.content),
        // Apex NS records are platform-managed; flag them as read-only in the UI.
        managed: rr.type === 'NS' && rr.name === apex,
      }));
  }

  async upsertRecord(
    userId: string,
    organizationId: string,
    name: string,
    dto: UpsertRecordDto,
  ) {
    const zone = await this.ownedZoneOrThrow(organizationId, name);
    if (zone.status !== 'active') {
      throw new ForbiddenException(
        'This zone is suspended; record edits are disabled.',
      );
    }

    const fqdn = this.qualify(dto.name, zone.name);
    this.guardManagedRRSet(dto.type, fqdn, zone.name);

    const rrset: PdnsRRSet = {
      name: PowerDnsClient.toCanonical(fqdn),
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

    return { name: this.relativize(rrset.name, PowerDnsClient.toCanonical(zone.name)), type: dto.type, ttl: rrset.ttl, records: dto.records };
  }

  async deleteRecord(
    userId: string,
    organizationId: string,
    name: string,
    dto: DeleteRecordDto,
  ) {
    const zone = await this.ownedZoneOrThrow(organizationId, name);
    if (zone.status !== 'active') {
      throw new ForbiddenException(
        'This zone is suspended; record edits are disabled.',
      );
    }
    const fqdn = this.qualify(dto.name, zone.name);
    this.guardManagedRRSet(dto.type, fqdn, zone.name);

    await this.pdns.patchRRSets(zone.name, [
      {
        name: PowerDnsClient.toCanonical(fqdn),
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

  // ---- App custom domains (platform-managed routing records) ---------------

  /** The platform nameservers hosted zones must be delegated to. */
  platformNameservers(): string[] {
    return this.nameservers();
  }

  /**
   * The hosted zone authoritative for `domain` on this platform: the domain
   * itself or its closest parent (longest match). Null when none is hosted.
   * Not org-scoped — callers compare `organizationId` themselves.
   */
  async findZoneForDomain(domain: string) {
    const name = PowerDnsClient.fromCanonical(domain);
    const labels = name.split('.');
    // "a.b.example.com" -> a.b.example.com, b.example.com, example.com (never the bare TLD).
    const candidates = labels
      .slice(0, -1)
      .map((_, i) => labels.slice(i).join('.'));
    if (!candidates.length) return null;
    const zones = await this.prisma.dnsZone.findMany({
      where: { name: { in: candidates } },
    });
    if (!zones.length) return null;
    return zones.sort((a, b) => b.name.length - a.name.length)[0];
  }

  /**
   * Create the routing RRset for an app custom domain in a hosted zone, without
   * clobbering anything: an identical RRset is reported as `exists`; a different
   * RRset of the same type (or a CNAME/other-data clash at the name) is reported
   * as `conflict` and left untouched.
   */
  async ensureRoutingRecord(
    userId: string,
    zoneName: string,
    fqdn: string,
    type: 'A' | 'AAAA' | 'CNAME',
    value: string,
  ): Promise<{
    status: 'created' | 'exists' | 'conflict';
    existing?: { type: string; records: string[] }[];
  }> {
    const zone = await this.prisma.dnsZone.findUnique({
      where: { name: PowerDnsClient.fromCanonical(zoneName) },
    });
    if (!zone) throw new NotFoundException(`DNS zone ${zoneName} not found`);
    if (zone.status !== 'active') {
      throw new ForbiddenException(
        `DNS zone ${zone.name} is suspended; records cannot be created.`,
      );
    }
    const pdnsZone = await this.pdns.getZone(zone.name);
    if (!pdnsZone) {
      throw new NotFoundException(`DNS zone ${zone.name} not found in backend`);
    }

    const canonical = PowerDnsClient.toCanonical(fqdn);
    const content =
      type === 'CNAME' ? PowerDnsClient.toCanonical(value) : value.trim();
    const atName = (pdnsZone.rrsets ?? []).filter(
      (rr) => rr.name === canonical,
    );
    const describe = (rrs: PdnsRRSet[]) =>
      rrs.map((rr) => ({
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
    // A CNAME cannot coexist with other data at the same name (RFC 1034).
    const blocking =
      type === 'CNAME'
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
      target: `${PowerDnsClient.fromCanonical(canonical)} ${type}`,
      metadata: {
        organizationId: zone.organizationId,
        source: 'custom-domain',
        content,
      },
    });
    return { status: 'created' };
  }

  /**
   * The routing RRsets (A/AAAA/CNAME) at `fqdn` as stored in PowerDNS, plus the
   * types of any other RRsets at that name (they block a CNAME).
   */
  async getRoutingRecords(
    zoneName: string,
    fqdn: string,
  ): Promise<{ zoneStatus: string; rrsets: RoutingRRSet[]; otherTypes: string[] }> {
    const zone = await this.prisma.dnsZone.findUnique({
      where: { name: PowerDnsClient.fromCanonical(zoneName) },
    });
    if (!zone) throw new NotFoundException(`DNS zone ${zoneName} not found`);
    const pdnsZone = await this.pdns.getZone(zone.name);
    if (!pdnsZone) {
      throw new NotFoundException(`DNS zone ${zone.name} not found in backend`);
    }
    const canonical = PowerDnsClient.toCanonical(fqdn);
    const atName = (pdnsZone.rrsets ?? []).filter((rr) => rr.name === canonical);
    const routing = new Set<string>(ROUTING_TYPES);
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

  /**
   * Point an app custom domain somewhere: make `desired` the only routing RRset
   * (A/AAAA/CNAME) at `fqdn`, in one atomic PATCH. Any existing routing RRset
   * that is not exactly the platform-managed one (`managed`, from
   * CustomDomain.autoRecordType/Value) is only replaced when `confirmReplace`
   * is set; otherwise nothing is changed and `confirm_required` is returned
   * with the RRsets that would be overwritten.
   */
  async setRoutingRecord(
    userId: string,
    zoneName: string,
    fqdn: string,
    desired: { type: 'A' | 'AAAA' | 'CNAME'; values: string[]; ttl: number },
    managed: { type: string; values: string[] } | null,
    confirmReplace: boolean,
  ): Promise<{
    status: 'updated' | 'unchanged' | 'confirm_required';
    unmanaged: RoutingRRSet[];
    replaced: RoutingRRSet[];
    /**
     * Whether the resulting RRset is platform-managed. False only when the
     * user's own identical RRset was kept as is (we don't adopt it, so removing
     * the domain later won't delete a record the user created).
     */
    managedAfter: boolean;
  }> {
    const current = await this.getRoutingRecords(zoneName, fqdn);
    const zone = PowerDnsClient.fromCanonical(zoneName);
    if (current.zoneStatus !== 'active') {
      throw new ForbiddenException(
        `DNS zone ${zone} is suspended; records cannot be changed.`,
      );
    }
    if (!desired.values.length) {
      throw new BadRequestException('At least one record value is required.');
    }
    if (desired.type === 'CNAME') {
      if (PowerDnsClient.fromCanonical(fqdn) === zone) {
        throw new BadRequestException('A CNAME is not allowed at the zone apex (RFC 1034).');
      }
      if (desired.values.length !== 1) {
        throw new BadRequestException('A CNAME must have exactly one target.');
      }
      // Never delete the user's TXT/MX/... to make room for a CNAME.
      if (current.otherTypes.length) {
        throw new BadRequestException(
          `${fqdn} also has ${[...new Set(current.otherTypes)].join(', ')} records, which can't coexist with a CNAME. Use "Custom IP" (A/AAAA) instead, or remove those records on the DNS page.`,
        );
      }
    }

    const contents = desired.values.map((v) =>
      desired.type === 'CNAME' ? PowerDnsClient.toCanonical(v) : v.trim(),
    );

    const isManaged = (rr: RoutingRRSet) =>
      !!managed &&
      rr.type === managed.type &&
      rr.records.length > 0 &&
      rr.records.every((c) =>
        managed.values.some((m) => recordKey(rr.type, m) === recordKey(rr.type, c)),
      );

    const same = current.rrsets.find((rr) => rr.type === desired.type);
    const others = current.rrsets.filter((rr) => rr.type !== desired.type);
    if (
      same &&
      !others.length &&
      same.ttl === desired.ttl &&
      sameValueSet(desired.type, same.records, contents)
    ) {
      const managedAfter = isManaged(same);
      return { status: 'unchanged', unmanaged: managedAfter ? [] : [same], replaced: [], managedAfter };
    }

    // What this change overwrites. An identical RRset (same values) is not
    // "overwritten" even if the user created it — only its TTL may change.
    const affected = [
      ...(same && !sameValueSet(desired.type, same.records, contents) ? [same] : []),
      ...others,
    ];
    const unmanaged = affected.filter((rr) => !isManaged(rr));
    if (unmanaged.length && !confirmReplace) {
      return { status: 'confirm_required', unmanaged, replaced: [], managedAfter: false };
    }

    const canonical = PowerDnsClient.toCanonical(fqdn);
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
        changetype: 'DELETE' as const,
        records: [],
      })),
    ]);
    await this.audit.log({
      actorUserId: userId,
      action: 'dns.record.upsert',
      target: `${PowerDnsClient.fromCanonical(canonical)} ${desired.type}`,
      metadata: {
        source: 'custom-domain-target',
        records: contents,
        ttl: desired.ttl,
        replaced: affected,
        replacedUnmanaged: unmanaged.length > 0,
      },
    });
    const keptUserRRSet =
      !!same && sameValueSet(desired.type, same.records, contents) && !isManaged(same);
    return { status: 'updated', unmanaged, replaced: affected, managedAfter: !keptUserRRSet };
  }

  /**
   * Remove a routing record previously created by {@link ensureRoutingRecord}
   * or {@link setRoutingRecord}. Only our exact value(s) are removed (`value`
   * may be comma-separated); other values the user added to the same RRset are
   * kept. Returns whether anything was removed.
   */
  async removeRoutingRecord(
    userId: string,
    zoneName: string,
    fqdn: string,
    type: string,
    value: string,
  ): Promise<boolean> {
    const name = PowerDnsClient.fromCanonical(zoneName);
    const zone = await this.prisma.dnsZone.findUnique({ where: { name } });
    if (!zone) return false;
    const pdnsZone = await this.pdns.getZone(zone.name);
    if (!pdnsZone) return false;

    const canonical = PowerDnsClient.toCanonical(fqdn);
    const ours = new Set(splitManagedValues(value).map((v) => recordKey(type, v)));
    const content = splitManagedValues(value).join(',');
    const rrset = (pdnsZone.rrsets ?? []).find(
      (rr) => rr.name === canonical && rr.type === type,
    );
    if (!rrset) return false;
    const remaining = rrset.records.filter(
      (r) => !ours.has(recordKey(type, r.content)),
    );
    if (remaining.length === rrset.records.length) return false;

    await this.pdns.patchRRSets(
      zone.name,
      [
        remaining.length
          ? { ...rrset, changetype: 'REPLACE', records: remaining }
          : { name: canonical, type, ttl: rrset.ttl, changetype: 'DELETE', records: [] },
      ],
    );
    await this.audit.log({
      actorUserId: userId,
      action: 'dns.record.delete',
      target: `${PowerDnsClient.fromCanonical(canonical)} ${type}`,
      metadata: {
        organizationId: zone.organizationId,
        source: 'custom-domain',
        content,
      },
    });
    return true;
  }

  // ---- Helpers -----------------------------------------------------------

  /** Resolve a relative sub-name ("@", "www") to a bare FQDN within the zone. */
  private qualify(sub: string, zone: string): string {
    const z = PowerDnsClient.fromCanonical(zone);
    const s = sub.trim().toLowerCase().replace(/\.$/, '');
    if (s === '' || s === '@') return z;
    // Already fully-qualified and inside the zone? keep it.
    if (s === z || s.endsWith(`.${z}`)) return s;
    return `${s}.${z}`;
  }

  /** Inverse of {@link qualify}: render a canonical FQDN relative to the apex. */
  private relativize(canonicalName: string, apexCanonical: string): string {
    const n = PowerDnsClient.fromCanonical(canonicalName);
    const apex = PowerDnsClient.fromCanonical(apexCanonical);
    if (n === apex) return '@';
    return n.endsWith(`.${apex}`) ? n.slice(0, -(apex.length + 1)) : n;
  }

  /**
   * Block edits to platform-managed RRsets: the apex SOA, and apex NS (which
   * delegate to ns1/ns2 and must not be removed). Customers may still add NS on
   * sub-names to delegate sub-zones.
   */
  private guardManagedRRSet(
    type: SupportedRecordType | 'SOA',
    fqdn: string,
    zone: string,
  ) {
    const apex = PowerDnsClient.fromCanonical(zone);
    const isApex = PowerDnsClient.fromCanonical(fqdn) === apex;
    if (type === ('SOA' as SupportedRecordType)) {
      throw new BadRequestException('The SOA record is managed automatically.');
    }
    if (isApex && type === 'NS') {
      throw new BadRequestException(
        'Apex NS records are managed by the platform and cannot be changed.',
      );
    }
    if (isApex && type === 'CNAME') {
      throw new BadRequestException(
        'A CNAME is not allowed at the zone apex (RFC 1034).',
      );
    }
  }

  /**
   * Light normalization/validation per type before handing to PowerDNS. Targets
   * for CNAME/MX/NS/SRV must be FQDNs (trailing dot) for PowerDNS; add it when
   * the value looks like a hostname.
   */
  private normalizeContent(type: SupportedRecordType, content: string): string {
    const c = content.trim();
    const ensureDot = (host: string) =>
      /^[a-z0-9._-]+$/i.test(host) && !host.endsWith('.') ? `${host}.` : host;

    switch (type) {
      case 'CNAME':
      case 'NS':
        return ensureDot(c);
      case 'MX': {
        // "10 mail.example.com" -> "10 mail.example.com."
        const m = c.match(/^(\d+)\s+(\S+)$/);
        if (!m) {
          throw new BadRequestException(
            'MX value must be "<priority> <host>", e.g. "10 mail.example.com".',
          );
        }
        return `${m[1]} ${ensureDot(m[2])}`;
      }
      case 'SRV': {
        // "<prio> <weight> <port> <target>"
        const m = c.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
        if (!m) {
          throw new BadRequestException(
            'SRV value must be "<priority> <weight> <port> <target>".',
          );
        }
        return `${m[1]} ${m[2]} ${m[3]} ${ensureDot(m[4])}`;
      }
      case 'TXT': {
        // PowerDNS requires TXT content to be quoted.
        if (c.startsWith('"') && c.endsWith('"')) return c;
        return `"${c.replace(/"/g, '\\"')}"`;
      }
      default:
        return c;
    }
  }
}
