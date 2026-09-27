import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare const SETTING_SERVER_PUBLIC_IPV4 = "server_public_ipv4";
export declare const SETTING_SERVER_PUBLIC_IPV6 = "server_public_ipv6";
export type NetworkConfigSource = 'database' | 'environment' | 'none';
export interface PlatformNetworkConfig {
    ipv4: string | null;
    ipv6: string | null;
    sources: {
        ipv4: NetworkConfigSource;
        ipv6: NetworkConfigSource;
    };
}
export interface PlatformNetworkUpdate {
    ipv4?: string | null;
    ipv6?: string | null;
}
export declare class PlatformNetworkService {
    private readonly prisma;
    private readonly config;
    private cache;
    constructor(prisma: PrismaService, config: ConfigService);
    invalidate(): void;
    get(): Promise<PlatformNetworkConfig>;
    primaryIp(): Promise<string | null>;
    update(dto: PlatformNetworkUpdate): Promise<void>;
    private load;
}
