import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UserPurgeService } from '../common/user-purge.service';
import { MailService } from './mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
export declare class AuthService {
    private readonly prisma;
    private readonly jwtService;
    private readonly mailService;
    private readonly config;
    private readonly userPurge;
    constructor(prisma: PrismaService, jwtService: JwtService, mailService: MailService, config: ConfigService, userPurge: UserPurgeService);
    deleteAccount(userId: string, dto: DeleteAccountDto): Promise<{
        message: string;
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
    me(userId: string): Promise<{
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
    updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<{
        theme: "light" | "dark";
    }>;
    changePassword(userId: string, dto: ChangePasswordDto): Promise<{
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
}
