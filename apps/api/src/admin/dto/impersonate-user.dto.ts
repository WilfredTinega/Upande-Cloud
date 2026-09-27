import { Transform } from 'class-transformer';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ImpersonateUserDto {
  // The admin's OWN password, re-entered to confirm the impersonation.
  @IsString()
  @MinLength(1, { message: 'Enter your password to continue' })
  @MaxLength(200)
  password: string;

  // Why the admin is signing in as this user. Shown to the user in the
  // notification they receive, and recorded in the audit log.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Give a reason (at least 5 characters)' })
  @MaxLength(500, { message: 'Keep the reason under 500 characters' })
  reason: string;
}
