import { IsIn } from 'class-validator';

export class UpdatePreferencesDto {
  @IsIn(['light', 'dark'], { message: 'theme must be "light" or "dark"' })
  theme: 'light' | 'dark';
}
