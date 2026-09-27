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
var DbProvisionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbProvisionService = void 0;
const common_1 = require("@nestjs/common");
const crypto = require("crypto");
const pg_1 = require("pg");
const prisma_service_1 = require("../prisma/prisma.service");
const encrypt_util_1 = require("../common/encrypt.util");
let DbProvisionService = DbProvisionService_1 = class DbProvisionService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(DbProvisionService_1.name);
    }
    appDbHost() {
        return process.env.APP_DB_HOST ?? 'postgres';
    }
    appDbPort() {
        return Number(process.env.APP_DB_PORT ?? 5432);
    }
    adminConnectionString() {
        const url = process.env.APP_DB_ADMIN_URL ?? process.env.DATABASE_URL;
        if (!url) {
            throw new Error('No admin DB connection string (set DATABASE_URL or APP_DB_ADMIN_URL)');
        }
        return url;
    }
    safeIdent(subdomain, prefix) {
        let base = subdomain.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!base)
            base = 'app';
        const ident = `${prefix}_${base}`;
        return ident.slice(0, 63);
    }
    quoteIdent(ident) {
        return `"${ident.replace(/"/g, '""')}"`;
    }
    async ensureForApp(appId, subdomain) {
        const existing = await this.prisma.appDatabase.findUnique({
            where: { appId },
        });
        if (existing) {
            await this.ensureObjectsExist(existing.dbName, existing.roleName, (0, encrypt_util_1.decrypt)(existing.passwordEnc));
            return existing;
        }
        const dbName = this.safeIdent(subdomain, 'db');
        const roleName = this.safeIdent(subdomain, 'app');
        const password = crypto.randomBytes(24).toString('base64url');
        const orphan = await this.withAdminClient((pool) => pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]));
        if (orphan.rowCount) {
            throw new Error(`A database named ${dbName} already exists from a previously deleted app. ` +
                'Ask the platform operator to drop it (or rename this app) before deploying.');
        }
        await this.createRoleAndDatabase(dbName, roleName, password);
        const record = await this.prisma.appDatabase.create({
            data: {
                appId,
                dbName,
                roleName,
                passwordEnc: (0, encrypt_util_1.encrypt)(password),
                host: this.appDbHost(),
                port: this.appDbPort(),
            },
        });
        this.logger.log(`Provisioned database ${dbName} (role ${roleName}) for app ${appId}`);
        return record;
    }
    async ensureForPreview(previewId, previewSubdomain) {
        const preview = await this.prisma.preview.findUnique({ where: { id: previewId } });
        if (!preview)
            throw new Error('Preview not found');
        if (preview.dbName && preview.dbRoleName && preview.dbPasswordEnc) {
            await this.ensureObjectsExist(preview.dbName, preview.dbRoleName, (0, encrypt_util_1.decrypt)(preview.dbPasswordEnc));
            return this.previewDb(preview.dbName, preview.dbRoleName, preview.dbPasswordEnc);
        }
        const tag = crypto.createHash('sha1').update(previewId).digest('hex').slice(0, 8);
        const dbName = `${this.safeIdent(previewSubdomain, 'pvdb').slice(0, 54)}_${tag}`;
        const roleName = `${this.safeIdent(previewSubdomain, 'pvapp').slice(0, 54)}_${tag}`;
        const password = crypto.randomBytes(24).toString('base64url');
        await this.createRoleAndDatabase(dbName, roleName, password);
        const passwordEnc = (0, encrypt_util_1.encrypt)(password);
        await this.prisma.preview.update({
            where: { id: previewId },
            data: { dbName, dbRoleName: roleName, dbPasswordEnc: passwordEnc },
        });
        this.logger.log(`Provisioned preview database ${dbName} (role ${roleName}) for preview ${previewId}`);
        return this.previewDb(dbName, roleName, passwordEnc);
    }
    previewDb(dbName, roleName, passwordEnc) {
        return { dbName, roleName, passwordEnc, host: this.appDbHost(), port: this.appDbPort() };
    }
    async dropPreviewDatabase(dbName, roleName) {
        if (!dbName.startsWith('pvdb_') || !roleName.startsWith('pvapp_')) {
            throw new Error(`Refusing to drop non-preview database ${dbName}`);
        }
        await this.withAdminClient(async (pool) => {
            await pool.query(`DROP DATABASE IF EXISTS ${this.quoteIdent(dbName)} WITH (FORCE)`);
            await pool.query(`DROP ROLE IF EXISTS ${this.quoteIdent(roleName)}`);
        });
        this.logger.log(`Dropped preview database ${dbName} (role ${roleName})`);
    }
    async dropForApp(appId) {
        const row = await this.prisma.appDatabase.findUnique({ where: { appId } });
        if (!row)
            return false;
        if (!row.dbName.startsWith('db_') || !row.roleName.startsWith('app_')) {
            throw new Error(`Refusing to drop unexpected database ${row.dbName}`);
        }
        await this.withAdminClient(async (pool) => {
            await pool.query(`DROP DATABASE IF EXISTS ${this.quoteIdent(row.dbName)} WITH (FORCE)`);
            await pool.query(`DROP ROLE IF EXISTS ${this.quoteIdent(row.roleName)}`);
        });
        await this.prisma.appDatabase.deleteMany({ where: { appId } });
        this.logger.log(`Dropped database ${row.dbName} (role ${row.roleName}) of deleted app ${appId}`);
        return true;
    }
    buildAppDatabaseUrl(db) {
        const password = (0, encrypt_util_1.decrypt)(db.passwordEnc);
        const enc = encodeURIComponent(password);
        return `postgresql://${db.roleName}:${enc}@${db.host}:${db.port}/${db.dbName}`;
    }
    async withAdminClient(fn) {
        const pool = new pg_1.Pool({ connectionString: this.adminConnectionString() });
        try {
            return await fn(pool);
        }
        finally {
            await pool.end();
        }
    }
    async createRoleAndDatabase(dbName, roleName, password) {
        await this.withAdminClient(async (pool) => {
            const qRole = this.quoteIdent(roleName);
            const qDb = this.quoteIdent(dbName);
            await pool.query(`DO $$
         BEGIN
           IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = $tag$${roleName}$tag$) THEN
             EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', $tag$${roleName}$tag$, $tag$${password}$tag$);
           ELSE
             EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', $tag$${roleName}$tag$, $tag$${password}$tag$);
           END IF;
         END
         $$;`);
            const dbExists = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
            if (dbExists.rowCount === 0) {
                await pool.query(`CREATE DATABASE ${qDb} OWNER ${qRole}`);
            }
            await pool.query(`GRANT ALL PRIVILEGES ON DATABASE ${qDb} TO ${qRole}`);
        });
        await this.grantSchemaPrivileges(dbName, roleName);
    }
    async grantSchemaPrivileges(dbName, roleName) {
        const adminUrl = new URL(this.adminConnectionString());
        adminUrl.pathname = `/${dbName}`;
        const pool = new pg_1.Pool({ connectionString: adminUrl.toString() });
        try {
            const qRole = this.quoteIdent(roleName);
            await pool.query(`GRANT ALL ON SCHEMA public TO ${qRole}`);
            await pool.query(`ALTER SCHEMA public OWNER TO ${qRole}`);
        }
        finally {
            await pool.end();
        }
    }
    async ensureObjectsExist(dbName, roleName, password) {
        await this.withAdminClient(async (pool) => {
            const role = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
            const db = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
            if (role.rowCount && db.rowCount)
                return;
            this.logger.warn(`DB objects for ${dbName} missing — recreating`);
        });
        await this.createRoleAndDatabase(dbName, roleName, password);
    }
};
exports.DbProvisionService = DbProvisionService;
exports.DbProvisionService = DbProvisionService = DbProvisionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DbProvisionService);
//# sourceMappingURL=db-provision.service.js.map