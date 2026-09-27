import { IsIP, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateNetworkSettingsDto {
  // Server public IPv4. Omit to keep; send '' to clear the DB value (PUBLIC_IP fallback).
  @IsOptional()
  @IsString()
  @ValidateIf((o) => typeof o.publicIpv4 === 'string' && o.publicIpv4.trim() !== '')
  @IsIP('4', { message: 'Enter a valid IPv4 address, e.g. 203.0.113.10' })
  publicIpv4?: string;

  // Server public IPv6 (optional). Omit to keep; '' clears it.
  @IsOptional()
  @IsString()
  @ValidateIf((o) => typeof o.publicIpv6 === 'string' && o.publicIpv6.trim() !== '')
  @IsIP('6', { message: 'Enter a valid IPv6 address, e.g. 2001:db8::10' })
  publicIpv6?: string;
}
