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
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const encrypt_util_1 = require("../common/encrypt.util");
const SETTING_AGENT_API_URL = 'agent_api_url';
const SETTING_AGENT_TOKEN = 'agent_token';
const SETTING_AGENT_ID = 'agent_id';
let AiService = AiService_1 = class AiService {
    constructor(config, prisma) {
        this.config = config;
        this.prisma = prisma;
        this.logger = new common_1.Logger(AiService_1.name);
    }
    async setting(key) {
        const row = await this.prisma.setting.findUnique({ where: { key } });
        if (!row || !row.value)
            return null;
        return row.encrypted ? (0, encrypt_util_1.decrypt)(row.value) : row.value;
    }
    async resolveConfig() {
        const apiKey = (await this.setting(SETTING_AGENT_TOKEN)) ||
            this.config.get('MISTRAL_API_KEY') ||
            undefined;
        const agentId = (await this.setting(SETTING_AGENT_ID)) ||
            this.config.get('MISTRAL_AGENT_ID') ||
            undefined;
        const base = (await this.setting(SETTING_AGENT_API_URL)) || '';
        const endpoint = base
            ? `${base.replace(/\/+$/, '')}/agents/completions`
            : this.config.get('MISTRAL_API_URL') ||
                'https://api.mistral.ai/v1/agents/completions';
        return { apiKey, agentId, endpoint };
    }
    async isConfigured() {
        const cfg = await this.resolveConfig();
        return Boolean(cfg.apiKey && cfg.agentId);
    }
    async analyzeDeploymentLog(params) {
        const cfg = await this.resolveConfig();
        if (!cfg.apiKey || !cfg.agentId) {
            throw new common_1.ServiceUnavailableException({
                code: 'AI_NOT_CONFIGURED',
                message: 'AI analysis is not configured. Set the Base URL + Agent token (and an Agent ID) ' +
                    'in Admin → Settings → MCP/Agent, or set MISTRAL_API_KEY and MISTRAL_AGENT_ID in the API environment.',
            });
        }
        const log = this.truncate(params.log, 12000);
        const reasonBlock = params.errorReason
            ? `\n--- ERROR ---\n${this.truncate(params.errorReason, 2000)}\n`
            : '';
        const prompt = `A deployment failed on the Upande Cloud platform.\n` +
            `App: ${params.appName} (type: ${params.appType}).\n` +
            `Below is the failure reason and the build/deploy log. Explain in plain English why it ` +
            `failed and give a concrete, actionable fix. Be concise. If the log is empty, diagnose ` +
            `from the error reason.\n${reasonBlock}\n--- BUILD LOG ---\n${log}`;
        let res;
        try {
            res = await fetch(cfg.endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${cfg.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    agent_id: cfg.agentId,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
        }
        catch (err) {
            this.logger.error(`Mistral request failed: ${err instanceof Error ? err.message : err}`);
            throw new common_1.ServiceUnavailableException({
                code: 'AI_UNREACHABLE',
                message: 'Could not reach the AI service.',
            });
        }
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            this.logger.error(`Mistral API ${res.status}: ${detail.slice(0, 300)}`);
            throw new common_1.ServiceUnavailableException({
                code: 'AI_ERROR',
                message: `AI service returned ${res.status}.`,
            });
        }
        const data = (await res.json());
        const content = data.choices?.[0]?.message?.content?.trim();
        return content || 'The AI returned no analysis.';
    }
    truncate(text, max) {
        if (text.length <= max)
            return text;
        return `...[truncated ${text.length - max} chars]...\n` + text.slice(text.length - max);
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], AiService);
//# sourceMappingURL=ai.service.js.map