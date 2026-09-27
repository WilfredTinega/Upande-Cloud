import { ConfigService } from '@nestjs/config';
export declare class MailService {
    private readonly config;
    private readonly logger;
    private transporter;
    constructor(config: ConfigService);
    get enabled(): boolean;
    sendPasswordReset(to: string, resetUrl: string): Promise<void>;
}
