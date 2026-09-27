import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGithubSettingsDto {
  // OAuth App client ID. Omit to keep; send '' to clear the DB value (env fallback).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  // New client secret (write-only). Omit or leave empty to keep the current one.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientSecret?: string;

  // Remove the stored client secret so it falls back to GITHUB_CLIENT_SECRET.
  @IsOptional()
  @IsBoolean()
  clearClientSecret?: boolean;

  // Optional HMAC key for OAuth state (write-only). Empty keeps the current one.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  stateSecret?: string;

  // Remove the stored state secret (falls back to GITHUB_STATE_SECRET / JWT_SECRET).
  @IsOptional()
  @IsBoolean()
  clearStateSecret?: boolean;
}
