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
var AdminSeedService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminSeedService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bcrypt = require("bcrypt");
const prisma_service_1 = require("../prisma/prisma.service");
const slug_util_1 = require("../common/slug.util");
let AdminSeedService = AdminSeedService_1 = class AdminSeedService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.logger = new common_1.Logger(AdminSeedService_1.name);
    }
    async onModuleInit() {
        try {
            await this.seedDefaultAdmin();
        }
        catch (err) {
            this.logger.error(`Default admin seed skipped: ${err instanceof Error ? err.message : err}`);
        }
    }
    async seedDefaultAdmin() {
        const existing = await this.prisma.user.findFirst({
            where: { role: 'superadmin' },
            select: { id: true },
        });
        if (existing) {
            return;
        }
        const email = (this.config.get('DEFAULT_ADMIN_EMAIL') ?? 'admin@example.com')
            .trim()
            .toLowerCase();
        const username = (this.config.get('DEFAULT_ADMIN_USERNAME') ?? 'administrator')
            .trim()
            .toLowerCase();
        const password = this.config.get('DEFAULT_ADMIN_PASSWORD') ?? 'admin';
        const orgName = this.config.get('DEFAULT_ADMIN_ORG') ?? 'Administrator';
        const passwordHash = await bcrypt.hash(password, 10);
        let orgSlug = (0, slug_util_1.slugify)(orgName) || 'administrator';
        if (await this.prisma.organization.findUnique({ where: { slug: orgSlug } })) {
            orgSlug = `${orgSlug}-${Date.now()}`;
        }
        const organization = await this.prisma.organization.create({
            data: {
                name: orgName,
                slug: orgSlug,
                plan: 'free',
                status: 'active',
                quota: {
                    create: {
                        maxApps: 100,
                        cpu: '4',
                        memory: '4g',
                        disk: '50g',
                        buildMinutes: 1000,
                        maxConcurrentDeploys: 10,
                    },
                },
            },
        });
        const user = await this.prisma.user.create({
            data: {
                organizationId: organization.id,
                username,
                email,
                passwordHash,
                role: 'superadmin',
                status: 'active',
                mustChangePassword: true,
            },
        });
        this.logger.warn(`No superadmin found — seeded default admin "${user.username}" (${user.email}). ` +
            `Sign in with the default password and you will be prompted to change it immediately.`);
    }
};
exports.AdminSeedService = AdminSeedService;
exports.AdminSeedService = AdminSeedService = AdminSeedService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], AdminSeedService);
//# sourceMappingURL=admin-seed.service.js.map