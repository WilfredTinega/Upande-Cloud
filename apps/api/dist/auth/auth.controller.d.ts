import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(dto: RegisterDto): Promise<{
        token: string;
        user: {
            id: string;
            username: string;
            email: string;
            role: string;
            status: string;
            organizationId: string;
            mustChangePassword: boolean;
            theme: string | null;
            createdAt: Date;
        };
    }>;
    login(dto: LoginDto): Promise<{
        token: string;
        user: {
            id: string;
            username: string;
            email: string;
            role: string;
            status: string;
            organizationId: string;
            mustChangePassword: boolean;
            theme: string | null;
            createdAt: Date;
        };
    }>;
    forgotPassword(dto: ForgotPasswordDto): Promise<{
        message: string;
    } | {
        devResetToken: string;
        devResetUrl: string;
        message: string;
    }>;
    resetPassword(dto: ResetPasswordDto): Promise<{
        message: string;
    }>;
    me(user: {
        id: string;
        imp?: {
            by: string;
            email: string;
        };
    }): Promise<{
        user: {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.UserStatus;
            organizationId: string;
            username: string;
            email: string;
            role: import(".prisma/client").$Enums.UserRole;
            mustChangePassword: boolean;
            theme: string | null;
        } | null;
    } | {
        impersonatedBy: string;
        user: {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.UserStatus;
            organizationId: string;
            username: string;
            email: string;
            role: import(".prisma/client").$Enums.UserRole;
            mustChangePassword: boolean;
            theme: string | null;
        } | null;
    }>;
    streamTicket(user: {
        id: string;
        email: string;
        role: string;
        organizationId: string;
        imp?: {
            by: string;
            email: string;
        };
    }): Promise<{
        ticket: string;
        expiresIn: number;
    }>;
    updatePreferences(user: {
        id: string;
        imp?: unknown;
    }, dto: UpdatePreferencesDto): Promise<{
        theme: "light" | "dark";
    }>;
    changePassword(user: {
        id: string;
    }, dto: ChangePasswordDto): Promise<{
        token: string;
        user: {
            id: string;
            username: string;
            email: string;
            role: string;
            status: string;
            organizationId: string;
            mustChangePassword: boolean;
            theme: string | null;
            createdAt: Date;
        };
    }>;
    deleteAccount(user: {
        id: string;
    }, dto: DeleteAccountDto): Promise<{
        message: string;
    }>;
}
