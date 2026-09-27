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
exports.PlatformNetworkService = exports.SETTING_SERVER_PUBLIC_IPV6 = exports.SETTING_SERVER_PUBLIC_IPV4 = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const net_1 = require("net");
const prisma_service_1 = require("../prisma/prisma.service");
exports.SETTING_SERVER_PUBLIC_IPV4 = 'server_public_ipv4';
exports.SETTING_SERVER_PUBLIC_IPV6 = 'server_public_ipv6';
const CACHE_TTL_MS = 30_000;
let PlatformNetworkService = class PlatformNetworkService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.cache = null;
    }
    invalidate() {
        this.cache = null;
    }
    async get() {
        if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS)
            return this.cache.value;
        const value = await this.load();
        this.cache = { value, at: Date.now() };
        return value;
    }
    async primaryIp() {
        const cfg = await this.get();
        return cfg.ipv4 ?? cfg.ipv6;
    }
    async update(dto) {
        const apply = async (key, value) => {
            if (value === undefined)
                return;
            const v = (value ?? '').trim();
            if (!v) {
                await this.prisma.setting.deleteMany({ where: { key } });
                return;
            }
            await this.prisma.setting.upsert({
                where: { key },
                create: { key, value: v, encrypted: false },
                update: { value: v, encrypted: false },
            });
        };
        try {
            await apply(exports.SETTING_SERVER_PUBLIC_IPV4, dto.ipv4);
            await apply(exports.SETTING_SERVER_PUBLIC_IPV6, dto.ipv6);
        }
        finally {
            this.invalidate();
        }
    }
    async load() {
        const rows = await this.prisma.setting.findMany({
            where: { key: { in: [exports.SETTING_SERVER_PUBLIC_IPV4, exports.SETTING_SERVER_PUBLIC_IPV6] } },
        });
        const db = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]));
        const env = (name) => (this.config.get(name) ?? '').trim();
        const publicIp = env('PUBLIC_IP');
        const pick = (key, family, envCandidates) => {
            const fromDb = db.get(key);
            if (fromDb && (0, net_1.isIP)(fromDb) === family)
                return [fromDb, 'database'];
            const fromEnv = envCandidates.find((v) => v && (0, net_1.isIP)(v) === family);
            if (fromEnv)
                return [fromEnv, 'environment'];
            return [null, 'none'];
        };
        const [ipv4, v4Src] = pick(exports.SETTING_SERVER_PUBLIC_IPV4, 4, [publicIp]);
        const [ipv6, v6Src] = pick(exports.SETTING_SERVER_PUBLIC_IPV6, 6, [env('PUBLIC_IPV6'), publicIp]);
        return { ipv4, ipv6, sources: { ipv4: v4Src, ipv6: v6Src } };
    }
};
exports.PlatformNetworkService = PlatformNetworkService;
exports.PlatformNetworkService = PlatformNetworkService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], PlatformNetworkService);
//# sourceMappingURL=platform-network.service.js.map