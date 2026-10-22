import { Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import { adminLoginSchema, otpRequestSchema, otpVerifySchema, refreshSchema } from '@masterio/shared';
import { Public } from '../common/auth';
import { ApiZodBody, ZBody } from '../common/zod';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@ApiTags('auth')
@Public()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  @ApiZodBody(otpRequestSchema)
  request(@ZBody(otpRequestSchema) body: z.infer<typeof otpRequestSchema>, @Ip() ip: string) {
    return this.auth.requestOtp(body, ip);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @ApiZodBody(otpVerifySchema)
  verify(@ZBody(otpVerifySchema) body: z.infer<typeof otpVerifySchema>, @Ip() ip: string) {
    return this.auth.verifyOtp(body, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiZodBody(refreshSchema)
  refresh(@ZBody(refreshSchema) body: z.infer<typeof refreshSchema>) {
    return this.tokens.rotate(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiZodBody(refreshSchema)
  async logout(@ZBody(refreshSchema) body: z.infer<typeof refreshSchema>): Promise<void> {
    await this.tokens.revokeByToken(body.refreshToken);
  }

  @Post('admin/login')
  @HttpCode(200)
  @ApiZodBody(adminLoginSchema)
  adminLogin(@ZBody(adminLoginSchema) body: z.infer<typeof adminLoginSchema>, @Ip() ip: string) {
    return this.auth.adminLogin(body, ip);
  }
}
