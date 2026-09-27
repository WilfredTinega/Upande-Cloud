// Pure helpers for app custom domains: which DNS record routes a domain to the
// platform, and how to describe DNS lookup results to the user.
import { isIP } from 'net';
import { Resolver } from 'dns/promises';
import { appSubdomainHost } from '../common/app-url.util';

// Two-label public suffixes where <name>.<suffix> is still a registrable apex
// (e.g. example.co.uk). Not a full Public Suffix List — just the common ones —
// used only for external domains; hosted zones know their own apex.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'co.ke', 'or.ke', 'ac.ke', 'go.ke', 'ne.ke', 'me.ke', 'sc.ke',
  'co.tz', 'or.tz', 'ac.tz', 'co.ug', 'or.ug', 'ac.ug', 'co.rw',
  'co.za', 'org.za', 'ac.za', 'com.ng', 'org.ng', 'com.gh',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz',
  'co.in', 'net.in', 'org.in', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.mx', 'com.ar', 'com.cn', 'com.hk', 'com.sg', 'com.tr',
]);

/**
 * Whether `domain` is a zone apex (the "root" of a domain), where a CNAME is
 * not allowed and an A record must be used. For a platform-hosted zone the
 * answer is exact; otherwise it is inferred from the name.
 */
export function isApexDomain(domain: string, hostedZone?: string | null): boolean {
  if (hostedZone) return domain === hostedZone;
  const labels = domain.split('.');
  if (labels.length <= 2) return true;
  return labels.length === 3 && MULTI_LABEL_SUFFIXES.has(labels.slice(1).join('.'));
}

/** `ip` if it is a valid IPv4/IPv6 address, else null. */
export function validIp(ip: string | null | undefined): string | null {
  const v = (ip ?? '').trim();
  return v && isIP(v) ? v : null;
}

/** False when BASE_DOMAIN is localhost-ish, i.e. app hostnames don't resolve publicly. */
export function platformHostIsPublic(): boolean {
  const base = (process.env.BASE_DOMAIN ?? 'localhost').trim().toLowerCase();
  return base.includes('.') && base !== 'localhost' && !base.endsWith('.localhost');
}

export interface RouteTarget {
  host: string;
  type: 'A' | 'AAAA' | 'CNAME';
  // null when the platform can't tell what to point at (server IP not configured).
  value: string | null;
  apex: boolean;
  note?: string;
}

const IP_NOT_CONFIGURED =
  "The server's public IP isn't configured on this platform (admin Settings -> Networking, or PUBLIC_IP), so the " +
  'record value is unknown. Ask your platform operator for the server IP.';

/**
 * The record that points `domain` at an app: an A (AAAA for an IPv6 server IP)
 * to the server for an apex, otherwise a CNAME to the app's own platform
 * hostname (<slug>.<BASE_DOMAIN>, the same host deploy.processor routes). If
 * BASE_DOMAIN is not a public domain (local dev) a CNAME would be useless, so
 * subdomains fall back to an A record to the server IP.
 */
export function routeTarget(
  domain: string,
  appSubdomain: string,
  hostedZone: string | null | undefined,
  // The server's public IP (PlatformNetworkService.primaryIp()), or null.
  serverIp: string | null,
): RouteTarget {
  const apex = isApexDomain(domain, hostedZone);
  const ip = validIp(serverIp);
  const ipType = ip && isIP(ip) === 6 ? 'AAAA' : 'A';

  if (!apex && platformHostIsPublic()) {
    return { host: domain, type: 'CNAME', value: appSubdomainHost(appSubdomain), apex };
  }
  if (ip) {
    return {
      host: domain,
      type: ipType,
      value: ip,
      apex,
      note: apex
        ? undefined
        : `BASE_DOMAIN (${process.env.BASE_DOMAIN ?? 'localhost'}) is not a public domain, so point this name at the server IP instead of a CNAME.`,
    };
  }
  return {
    host: domain,
    type: apex ? 'A' : 'CNAME',
    value: null,
    apex,
    note: apex
      ? IP_NOT_CONFIGURED
      : `BASE_DOMAIN is "${process.env.BASE_DOMAIN ?? 'localhost'}" (not a public domain), so there is no app hostname to CNAME to, and the server's public IP isn't configured either. Ask your platform operator for the server IP.`,
  };
}

/** Human-readable label for a Node dns/promises error code. */
export function dnsErrorLabel(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case 'ENOTFOUND':
      return 'NXDOMAIN (the name does not exist)';
    case 'ENODATA':
      return 'no records of this type';
    case 'ETIMEOUT':
      return 'DNS query timed out';
    case 'ESERVFAIL':
      return 'SERVFAIL (the domain\'s nameservers returned an error)';
    case 'EREFUSED':
      return 'query refused by the nameserver';
    case 'ECONNREFUSED':
      return 'could not reach a DNS resolver';
    default:
      return code ? `DNS error ${code}` : String(err);
  }
}

/** Run a DNS lookup, turning failures into a labelled error instead of throwing. */
export async function lookup(
  fn: () => Promise<string[]>,
): Promise<{ values: string[]; error: string | null }> {
  try {
    return { values: await fn(), error: null };
  } catch (err) {
    return { values: [], error: dnsErrorLabel(err) };
  }
}

/** Case/trailing-dot-insensitive hostname comparison. */
export function sameHost(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\.$/, '') === b.toLowerCase().replace(/\.$/, '');
}

// ---- Public DNS view --------------------------------------------------------

// Well-known public resolvers, so "what the internet sees" isn't skewed by a
// local/split-horizon resolver in the API's container.
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'];
let publicResolverInstance: Resolver | null = null;

function publicResolver(): Resolver {
  if (!publicResolverInstance) {
    publicResolverInstance = new Resolver({ timeout: 3000, tries: 2 });
    publicResolverInstance.setServers(PUBLIC_RESOLVERS);
  }
  return publicResolverInstance;
}

const systemResolver = new Resolver({ timeout: 3000, tries: 2 });

export type PublicRecordKind = 'A' | 'AAAA' | 'CNAME' | 'NS' | 'TXT';

/**
 * Resolve `host` through a public resolver (1.1.1.1 / 8.8.8.8). If those can't
 * be reached at all (outbound port 53 blocked), fall back to the system
 * resolver. Returns labelled errors instead of throwing (see {@link lookup}).
 */
export async function resolvePublic(
  kind: PublicRecordKind,
  host: string,
): Promise<{ values: string[]; error: string | null }> {
  const run = (r: Resolver) => (): Promise<string[]> => {
    switch (kind) {
      case 'A':
        return r.resolve4(host);
      case 'AAAA':
        return r.resolve6(host);
      case 'CNAME':
        return r.resolveCname(host);
      case 'NS':
        return r.resolveNs(host);
      case 'TXT':
        return r.resolveTxt(host).then((rows) => rows.map((parts) => parts.join('')));
    }
  };
  try {
    return { values: await run(publicResolver())(), error: null };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'ECONNREFUSED' || code === 'ETIMEOUT' || code === 'ECONNRESET') {
      return lookup(run(systemResolver));
    }
    return { values: [], error: dnsErrorLabel(err) };
  }
}

// ---- Routing-record helpers ---------------------------------------------------

/** Routing RRset types at a custom-domain name. */
export const ROUTING_TYPES = ['A', 'AAAA', 'CNAME'] as const;
export type RoutingType = (typeof ROUTING_TYPES)[number];

/**
 * CustomDomain.autoRecordValue holds the platform-managed value(s) of the
 * routing RRset, comma-separated (IPs and hostnames never contain commas).
 */
export function splitManagedValues(v: string | null | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Canonical comparison key for a record value of `type`. */
export function recordKey(type: string, value: string): string {
  const v = value.trim().toLowerCase();
  if (type === 'CNAME') return v.replace(/\.$/, '');
  if (type === 'AAAA' && isIP(v) === 6) return expandIpv6(v);
  return v;
}

/** Full, zero-padded form of an IPv6 address, for comparisons ("::1" vs "0:0::1"). */
function expandIpv6(ip: string): string {
  let [head, tail] = ip.includes('::') ? ip.split('::') : [ip, null];
  // IPv4-mapped tail ("::ffff:1.2.3.4") -> two hextets.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(tail ?? head);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    if (tail !== null) tail = tail.replace(v4[1], hex);
    else head = head.replace(v4[1], hex);
  }
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : new Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((x) => x.padStart(4, '0')).join(':');
}

/** Same set of values (order/case/format-insensitive). */
export function sameValueSet(type: string, a: string[], b: string[]): boolean {
  const ka = new Set(a.map((v) => recordKey(type, v)));
  const kb = new Set(b.map((v) => recordKey(type, v)));
  if (ka.size !== kb.size) return false;
  for (const k of ka) if (!kb.has(k)) return false;
  return true;
}
