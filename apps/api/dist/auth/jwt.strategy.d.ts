import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Request } from 'express';
export interface JwtPayload {
    sub: string;
    email: string;
    role: string;
    orgId: string;
    imp?: {
        by: string;
        email: string;
    };
    tv?: number;
    typ?: 'stream';
}
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly config;
    private readonly prisma;
    constructor(config: ConfigService, prisma: PrismaService);
    validate(req: Request, payload: JwtPayload): Promise<{
        orgId: string;
        id: string;
        status: import(".prisma/client").$Enums.UserStatus;
        organizationId: string;
        username: string;
        email: string;
        role: import(".prisma/client").$Enums.UserRole;
    } | {
        imp: {
            by: string;
            email: string;
        };
        orgId: string;
        id: string;
        status: import(".prisma/client").$Enums.UserStatus;
        organizationId: string;
        username: string;
        email: string;
        role: import(".prisma/client").$Enums.UserRole;
    }>;
}
export {};
