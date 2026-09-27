"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUTING_TYPES = void 0;
exports.isApexDomain = isApexDomain;
exports.validIp = validIp;
exports.platformHostIsPublic = platformHostIsPublic;
exports.routeTarget = routeTarget;
exports.dnsErrorLabel = dnsErrorLabel;
exports.lookup = lookup;
exports.sameHost = sameHost;
exports.resolvePublic = resolvePublic;
exports.splitManagedValues = splitManagedValues;
exports.recordKey = recordKey;
exports.sameValueSet = sameValueSet;
const net_1 = require("net");
const promises_1 = require("dns/promises");
const app_url_util_1 = require("../common/app-url.util");
const MULTI_LABEL_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
    'co.ke', 'or.ke', 'ac.ke', 'go.ke', 'ne.ke', 'me.ke', 'sc.ke',
    'co.tz', 'or.tz', 'ac.tz', 'co.ug', 'or.ug', 'ac.ug', 'co.rw',
    'co.za', 'org.za', 'ac.za', 'com.ng', 'org.ng', 'com.gh',
    'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz',
    'co.in', 'net.in', 'org.in', 'co.jp', 'ne.jp', 'or.jp',
    'com.br', 'com.mx', 'com.ar', 'com.cn', 'com.hk', 'com.sg', 'com.tr',
]);
function isApexDomain(domain, hostedZone) {
    if (hostedZone)
        return domain === hostedZone;
    const labels = domain.split('.');
    if (labels.length <= 2)
        return true;
    return labels.length === 3 && MULTI_LABEL_SUFFIXES.has(labels.slice(1).join('.'));
}
function validIp(ip) {
    const v = (ip ?? '').trim();
    return v && (0, net_1.isIP)(v) ? v : null;
}
function platformHostIsPublic() {
    const base = (process.env.BASE_DOMAIN ?? 'localhost').trim().toLowerCase();
    return base.includes('.') && base !== 'localhost' && !base.endsWith('.localhost');
}
const IP_NOT_CONFIGURED = "The server's public IP isn't configured on this platform (admin Settings -> Networking, or PUBLIC_IP), so the " +
    'record value is unknown. Ask your platform operator for the server IP.';
function routeTarget(domain, appSubdomain, hostedZone, serverIp) {
    const apex = isApexDomain(domain, hostedZone);
    const ip = validIp(serverIp);
    const ipType = ip && (0, net_1.isIP)(ip) === 6 ? 'AAAA' : 'A';
    if (!apex && platformHostIsPublic()) {
        return { host: domain, type: 'CNAME', value: (0, app_url_util_1.appSubdomainHost)(appSubdomain), apex };
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
function dnsErrorLabel(err) {
    const code = err?.code;
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
async function lookup(fn) {
    try {
        return { values: await fn(), error: null };
    }
    catch (err) {
        return { values: [], error: dnsErrorLabel(err) };
    }
}
function sameHost(a, b) {
    return a.toLowerCase().replace(/\.$/, '') === b.toLowerCase().replace(/\.$/, '');
}
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'];
let publicResolverInstance = null;
function publicResolver() {
    if (!publicResolverInstance) {
        publicResolverInstance = new promises_1.Resolver({ timeout: 3000, tries: 2 });
        publicResolverInstance.setServers(PUBLIC_RESOLVERS);
    }
    return publicResolverInstance;
}
const systemResolver = new promises_1.Resolver({ timeout: 3000, tries: 2 });
async function resolvePublic(kind, host) {
    const run = (r) => () => {
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
    }
    catch (err) {
        const code = err?.code;
        if (code === 'ECONNREFUSED' || code === 'ETIMEOUT' || code === 'ECONNRESET') {
            return lookup(run(systemResolver));
        }
        return { values: [], error: dnsErrorLabel(err) };
    }
}
exports.ROUTING_TYPES = ['A', 'AAAA', 'CNAME'];
function splitManagedValues(v) {
    return (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
function recordKey(type, value) {
    const v = value.trim().toLowerCase();
    if (type === 'CNAME')
        return v.replace(/\.$/, '');
    if (type === 'AAAA' && (0, net_1.isIP)(v) === 6)
        return expandIpv6(v);
    return v;
}
function expandIpv6(ip) {
    let [head, tail] = ip.includes('::') ? ip.split('::') : [ip, null];
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(tail ?? head);
    if (v4) {
        const [a, b, c, d] = v4[1].split('.').map(Number);
        const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
        if (tail !== null)
            tail = tail.replace(v4[1], hex);
        else
            head = head.replace(v4[1], hex);
    }
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const fill = tail === null ? [] : new Array(8 - h.length - t.length).fill('0');
    return [...h, ...fill, ...t].map((x) => x.padStart(4, '0')).join(':');
}
function sameValueSet(type, a, b) {
    const ka = new Set(a.map((v) => recordKey(type, v)));
    const kb = new Set(b.map((v) => recordKey(type, v)));
    if (ka.size !== kb.size)
        return false;
    for (const k of ka)
        if (!kb.has(k))
            return false;
    return true;
}
//# sourceMappingURL=custom-domain.util.js.map