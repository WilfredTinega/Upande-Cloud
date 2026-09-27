declare const APP_TYPES: readonly ["static", "node", "fullstack", "nodered"];
export declare class BulkMigrateDto {
    type?: (typeof APP_TYPES)[number];
}
export {};
