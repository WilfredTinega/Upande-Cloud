import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ENV_SCOPES, EnvScope } from '../../common/env-scope.util';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// POST /apps/:id/env
export class CreateEnvVarDto {
  @IsString()
  @MaxLength(128)
  @Matches(KEY_RE, { message: 'key must be letters, digits and _ (not starting with a digit)' })
  key!: string;

  @IsString()
  @MaxLength(32768)
  value!: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;

  @IsOptional()
  @IsIn(ENV_SCOPES as unknown as string[])
  scope?: EnvScope;
}

// PATCH /apps/:id/env/:envId — omitted fields are kept (a secret's value too).
export class UpdateEnvVarDto {
  @IsOptional()
  @IsString()
  @MaxLength(32768)
  value?: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;

  @IsOptional()
  @IsIn(ENV_SCOPES as unknown as string[])
  scope?: EnvScope;
}
