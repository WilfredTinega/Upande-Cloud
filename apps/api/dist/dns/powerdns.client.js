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
var PowerDnsClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PowerDnsClient = void 0;
const common_1 = require("@nestjs/common");
let PowerDnsClient = PowerDnsClient_1 = class PowerDnsClient {
    constructor() {
        this.logger = new common_1.Logger(PowerDnsClient_1.name);
        this.baseUrl = (process.env.PDNS_API_URL || 'http://pdns:8081').replace(/\/+$/, '');
        this.apiKey = process.env.PDNS_API_KEY || 'changeme-pdns-api-key';
        this.serverId = process.env.PDNS_SERVER_ID || 'localhost';
    }
    static toCanonical(name) {
        const n = name.trim().toLowerCase();
        return n.endsWith('.') ? n : `${n}.`;
    }
    static fromCanonical(name) {
        return name.trim().toLowerCase().replace(/\.$/, '');
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}/api/v1/servers/${this.serverId}${path}`;
        let res;
        try {
            res = await fetch(url, {
                method,
                headers: {
                    'X-API-Key': this.apiKey,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        }
        catch (err) {
            this.logger.error(`PowerDNS API unreachable: ${String(err)}`);
            throw new common_1.ServiceUnavailableException('DNS backend is unavailable. Please try again shortly.');
        }
        if (res.status === 204 || res.status === 201 || res.status === 200) {
            const text = await res.text();
            return (text ? JSON.parse(text) : undefined);
        }
        const detail = await res.text().catch(() => '');
        this.logger.warn(`PowerDNS ${method} ${path} -> ${res.status} ${detail}`);
        throw new common_1.ServiceUnavailableException(`DNS backend error (${res.status}): ${detail || res.statusText}`);
    }
    listZones() {
        return this.request('GET', '/zones');
    }
    async getZone(name) {
        const id = encodeURIComponent(PowerDnsClient_1.toCanonical(name));
        try {
            return await this.request('GET', `/zones/${id}`);
        }
        catch (err) {
            if (err instanceof common_1.ServiceUnavailableException &&
                /\(404\)/.test(err.message)) {
                return null;
            }
            throw err;
        }
    }
    createZone(name, nameservers) {
        const canonical = PowerDnsClient_1.toCanonical(name);
        return this.request('POST', '/zones', {
            name: canonical,
            kind: 'Native',
            nameservers: nameservers.map((ns) => PowerDnsClient_1.toCanonical(ns)),
        });
    }
    async deleteZone(name) {
        const id = encodeURIComponent(PowerDnsClient_1.toCanonical(name));
        await this.request('DELETE', `/zones/${id}`);
    }
    async patchRRSets(zone, rrsets) {
        const id = encodeURIComponent(PowerDnsClient_1.toCanonical(zone));
        await this.request('PATCH', `/zones/${id}`, { rrsets });
    }
};
exports.PowerDnsClient = PowerDnsClient;
exports.PowerDnsClient = PowerDnsClient = PowerDnsClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PowerDnsClient);
//# sourceMappingURL=powerdns.client.js.map