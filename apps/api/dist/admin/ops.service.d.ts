import { AuditService } from '../common/audit.service';
export type ZoneCommandKey = 'upgrade' | 'status' | 'restart' | 'migratedb' | 'backupdb';
export declare class OpsService {
    private readonly audit;
    private readonly logger;
    private readonly docker;
    private readonly dataDir;
    private readonly cliPkg;
    private readonly helperImage;
    private readonly maxOutput;
    private readonly COMMANDS;
    constructor(audit: AuditService);
    listCommands(): Array<{
        key: ZoneCommandKey;
        label: string;
        mutating: boolean;
        description: string;
    }>;
    runCommand(actorUserId: string, key: ZoneCommandKey, onChunk?: (text: string) => void): Promise<{
        command: string;
        output: string;
        exitCode: number;
    }>;
    private pullIfMissing;
    private shellSafe;
}
