export declare const NODERED_BCRYPT_COST = 8;
export declare function hashNodeRedPassword(plain: string): string;
export declare const NODERED_IMAGE = "nodered/node-red:4.0";
export declare const NODERED_DATA_DIR = "/data";
export declare const NODERED_UID = 1000;
export declare const NODERED_GID = 1000;
export declare const NODERED_PORT = 1880;
export declare function noderedVolumeName(subdomain: string): string;
export interface NodeRedUserSpec {
    username: string;
    passwordHash: string;
    permission: string;
}
export declare function renderNodeRedSettings(users: NodeRedUserSpec[]): string;
