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
var OpsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpsService = void 0;
const common_1 = require("@nestjs/common");
const Docker = require("dockerode");
const audit_service_1 = require("../common/audit.service");
let OpsService = OpsService_1 = class OpsService {
    constructor(audit) {
        this.audit = audit;
        this.logger = new common_1.Logger(OpsService_1.name);
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
        this.dataDir = process.env.UPANDE_DATA_DIR || '/opt/upande-cloud';
        this.cliPkg = process.env.UPANDE_CLI_PACKAGE || '@zonalcloud/zone';
        this.helperImage = process.env.UPANDE_OPS_IMAGE || 'docker:cli';
        this.maxOutput = 512 * 1024;
        this.COMMANDS = {
            upgrade: {
                argv: ['upgrade', '--no-backup'],
                label: 'upgrade',
                mutating: true,
                description: 'Updates the platform to the latest version and restarts it. Brief downtime is possible.',
            },
            status: {
                argv: ['status'],
                label: 'status',
                mutating: false,
                description: 'Shows whether each platform service is running.',
            },
            restart: {
                argv: ['restart'],
                label: 'restart',
                mutating: true,
                description: 'Restarts all platform services. Brief downtime while they come back up.',
            },
            migratedb: {
                argv: ['migrate'],
                label: 'migratedb',
                mutating: true,
                description: 'Applies pending database updates. Run after an upgrade if needed.',
            },
            backupdb: {
                argv: ['backup'],
                label: 'backupdb',
                mutating: false,
                description: 'Saves a backup of the database on the server. Changes nothing.',
            },
        };
    }
    listCommands() {
        return Object.keys(this.COMMANDS).map((key) => ({
            key,
            label: this.COMMANDS[key].label,
            mutating: this.COMMANDS[key].mutating,
            description: this.COMMANDS[key].description,
        }));
    }
    async runCommand(actorUserId, key, onChunk) {
        const spec = this.COMMANDS[key];
        if (!spec) {
            throw new common_1.BadRequestException({
                code: 'UNKNOWN_COMMAND',
                message: `Unknown zone command: ${key}`,
            });
        }
        const zoneArgs = spec.argv.map((a) => this.shellSafe(a)).join(' ');
        const inner = 'set -e; ' +
            'command -v node >/dev/null 2>&1 || apk add --no-cache nodejs npm >/tmp/node-install.log 2>&1; ' +
            `npm i -g ${this.shellSafe(this.cliPkg)} >/tmp/cli-install.log 2>&1; ` +
            `zone ${zoneArgs}`;
        await this.pullIfMissing(this.helperImage);
        const container = await this.docker.createContainer({
            Image: this.helperImage,
            Cmd: ['sh', '-lc', inner],
            Env: [`UPANDE_DATA_DIR=${this.dataDir}`, 'CI=1'],
            WorkingDir: this.dataDir,
            HostConfig: {
                AutoRemove: false,
                Binds: [
                    '/var/run/docker.sock:/var/run/docker.sock',
                    `${this.dataDir}:${this.dataDir}`,
                ],
                NetworkMode: 'upande_net',
            },
        });
        let output = '';
        let exitCode = 0;
        try {
            const stream = await container.attach({
                stream: true,
                stdout: true,
                stderr: true,
            });
            const chunks = [];
            let total = 0;
            const done = new Promise((resolve, reject) => {
                stream.on('data', (c) => {
                    if (total < this.maxOutput) {
                        chunks.push(c);
                        total += c.length;
                    }
                });
                stream.on('end', () => resolve());
                stream.on('error', reject);
            });
            await container.start();
            const result = await container.wait();
            exitCode = result.StatusCode ?? 0;
            await done;
            output = Buffer.concat(chunks)
                .toString('utf8')
                .replace(/[\x00-\x08\x0b-\x1f]/g, (m) => (m === '\n' || m === '\t' ? m : ''))
                .slice(0, this.maxOutput);
        }
        finally {
            await container.remove({ force: true }).catch(() => undefined);
        }
        await this.audit.log({
            actorUserId,
            action: `platform.ops.${key}`,
            target: 'platform',
            metadata: { exitCode },
        });
        return { command: `zone ${spec.argv.join(' ')}`, output, exitCode };
    }
    async pullIfMissing(image) {
        try {
            await this.docker.getImage(image).inspect();
            return;
        }
        catch {
        }
        await new Promise((resolve, reject) => {
            this.docker.pull(image, (err, stream) => {
                if (err)
                    return reject(err);
                this.docker.modem.followProgress(stream, (e) => e ? reject(e) : resolve());
            });
        });
    }
    shellSafe(s) {
        if (!/^[A-Za-z0-9@._/+-]+$/.test(s)) {
            throw new common_1.BadRequestException({ code: 'BAD_ARG', message: `Unsafe argument: ${s}` });
        }
        return s;
    }
};
exports.OpsService = OpsService;
exports.OpsService = OpsService = OpsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [audit_service_1.AuditService])
], OpsService);
//# sourceMappingURL=ops.service.js.map