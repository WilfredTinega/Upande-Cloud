export declare const SUPPORTED_RECORD_TYPES: readonly ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"];
export type SupportedRecordType = (typeof SUPPORTED_RECORD_TYPES)[number];
export declare class UpsertRecordDto {
    name: string;
    type: SupportedRecordType;
    ttl?: number;
    records: string[];
}
export declare class DeleteRecordDto {
    name: string;
    type: SupportedRecordType;
}
