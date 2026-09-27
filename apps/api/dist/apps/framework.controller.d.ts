import { FrameworkService } from './framework.service';
interface AuthUser {
    id: string;
    organizationId: string;
    role: string;
}
export declare class DetectFrameworkDto {
    repoUrl: string;
    branch?: string;
}
export declare class FrameworkController {
    private readonly frameworks;
    constructor(frameworks: FrameworkService);
    detect(user: AuthUser, dto: DetectFrameworkDto): Promise<{
        detection: import("../common/framework-detect.util").FrameworkDetection;
    }>;
    forApp(user: AuthUser, id: string): Promise<{
        detection: import("../common/framework-detect.util").FrameworkDetection;
        current: {
            type: "static" | "node" | "fullstack";
            buildCmd: string | null;
            outputDir: string | null;
        };
        warnings: string[];
    }>;
}
export {};
