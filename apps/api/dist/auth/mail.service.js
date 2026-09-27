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
var MailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nodemailer = require("nodemailer");
let MailService = MailService_1 = class MailService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(MailService_1.name);
        this.transporter = null;
        const host = this.config.get('SMTP_HOST');
        if (host) {
            const port = Number(this.config.get('SMTP_PORT') ?? 587);
            const user = this.config.get('SMTP_USER');
            const pass = this.config.get('SMTP_PASS');
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: user ? { user, pass } : undefined,
            });
            this.logger.log(`SMTP configured: ${host}:${port}`);
        }
        else {
            this.logger.warn('SMTP not configured — emails will be logged, not sent (dev mode).');
        }
    }
    get enabled() {
        return this.transporter !== null;
    }
    async sendPasswordReset(to, resetUrl) {
        const from = this.config.get('SMTP_FROM') ?? 'Upande Cloud <no-reply@upande.local>';
        const subject = 'Reset your Upande Cloud password';
        const text = `You requested a password reset.\n\nOpen this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`;
        if (!this.transporter) {
            this.logger.log(`[dev] Password reset for ${to}: ${resetUrl}`);
            return;
        }
        await this.transporter.sendMail({ from, to, subject, text });
        this.logger.log(`Password reset email sent to ${to}`);
    }
};
exports.MailService = MailService;
exports.MailService = MailService = MailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MailService);
//# sourceMappingURL=mail.service.js.map