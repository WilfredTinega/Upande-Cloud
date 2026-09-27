import { PreviewProtectionService } from './preview-protection.service';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class SetPreviewProtectionDto {
    username?: string;
    password?: string;
}
export declare class PreviewProtectionController {
    private readonly protection;
    constructor(protection: PreviewProtectionService);
    get(user: AuthUser, id: string): Promise<{
        enabled: boolean;
        username: string | null;
        updatedAt: Date | null;
    }>;
    set(user: AuthUser, id: string, dto: SetPreviewProtectionDto): Promise<{
        updated: number;
        failed: string[];
        enabled: boolean;
        username: string;
    }>;
    disable(user: AuthUser, id: string): Promise<{
        updated: number;
        failed: string[];
        enabled: boolean;
        username: null;
    }>;
}
export {};
