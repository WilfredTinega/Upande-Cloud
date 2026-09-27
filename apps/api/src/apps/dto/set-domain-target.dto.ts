import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Where a custom domain in a platform-hosted zone should point. */
export class SetDomainTargetDto {
  // "platform": A to the server IP (apex) / CNAME to the app host (subdomain).
  // "custom": A or AAAA with the IPs in `values`.
  @IsIn(['platform', 'custom'])
  mode: 'platform' | 'custom';

  @ValidateIf((o) => o.mode === 'custom')
  @IsIn(['A', 'AAAA'])
  type?: 'A' | 'AAAA';

  // Addresses for mode=custom (validated per type in the service).
  @ValidateIf((o) => o.mode === 'custom')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  values?: string[];

  // Seconds; default 300.
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  ttl?: number;

  // Required to overwrite routing records the platform did not create.
  @IsOptional()
  @IsBoolean()
  confirmReplace?: boolean;
}
