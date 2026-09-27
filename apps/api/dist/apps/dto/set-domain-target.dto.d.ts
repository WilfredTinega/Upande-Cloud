export declare class SetDomainTargetDto {
    mode: 'platform' | 'custom';
    type?: 'A' | 'AAAA';
    values?: string[];
    ttl?: number;
    confirmReplace?: boolean;
}
