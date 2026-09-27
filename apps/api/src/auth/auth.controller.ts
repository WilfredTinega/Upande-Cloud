import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSec: 3600 })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 20, windowSec: 300, byBody: 'email' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSec: 900, byBody: 'email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSec: 900 })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: { id: string; imp?: { by: string; email: string } }) {
    const res = await this.authService.me(user.id);
    // Surface the impersonation marker so the dashboard can show a banner.
    return user.imp ? { ...res, impersonatedBy: user.imp.email } : res;
  }

  // Short-lived (60s) ticket for EventSource URLs (?token=), which can't send
  // an Authorization header. Only opens GET streams; the session token itself
  // never goes into a URL.
  @Post('stream-ticket')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  streamTicket(
    @CurrentUser()
    user: { id: string; email: string; role: string; organizationId: string; imp?: { by: string; email: string } },
  ) {
    return this.authService.streamTicket(user);
  }

  // Per-account UI preferences. Refused while impersonating so an admin's
  // theme choice never changes the user's saved preference.
  @Patch('me/preferences')
  @UseGuards(JwtAuthGuard)
  updatePreferences(
    @CurrentUser() user: { id: string; imp?: unknown },
    @Body() dto: UpdatePreferencesDto,
  ) {
    if (user.imp) {
      throw new ForbiddenException({
        code: 'IMPERSONATING',
        message: "Preferences can't be changed while impersonating.",
      });
    }
    return this.authService.updatePreferences(user.id, dto);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ limit: 10, windowSec: 900 })
  changePassword(@CurrentUser() user: { id: string }, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  deleteAccount(@CurrentUser() user: { id: string }, @Body() dto: DeleteAccountDto) {
    return this.authService.deleteAccount(user.id, dto);
  }
}
