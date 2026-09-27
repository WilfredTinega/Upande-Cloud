import { EnvScope } from '../../common/env-scope.util';
export declare class CreateEnvVarDto {
    key: string;
    value: string;
    isSecret?: boolean;
    scope?: EnvScope;
}
export declare class UpdateEnvVarDto {
    value?: string;
    isSecret?: boolean;
    scope?: EnvScope;
}
