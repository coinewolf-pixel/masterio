import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { bonusRuleSchema, bonusRunSchema, deleteAccountSchema, insuranceRuleSchema, paginationSchema } from '@masterio/shared';
import { AdminRoles, CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZodPipe, ZQuery } from '../common/zod';
import { BonusesService } from '../bonuses/bonuses.service';
import { PrivacyService } from '../privacy/privacy.service';
import { InsuranceService } from './insurance.service';

/** Мастер: требования к страховке и начисленные бонусы. Пользователь: свои данные (GDPR). */
@ApiTags('compliance')
@ApiBearerAuth()
@Controller()
export class ComplianceController {
  constructor(
    private readonly insurance: InsuranceService,
    private readonly bonuses: BonusesService,
    private readonly privacy: PrivacyService,
  ) {}

  @Get('worker/insurance-requirements')
  @Roles('WORKER')
  insuranceRequirements(@CurrentUser() user: AuthUser) {
    return this.insurance.forWorker(user.id);
  }

  @Get('worker/bonuses')
  @Roles('WORKER')
  myBonuses(@CurrentUser() user: AuthUser) {
    return this.bonuses.forWorker(user.id);
  }

  @Post('me/data-export')
  @HttpCode(200)
  @Roles('CLIENT', 'WORKER')
  exportData(@CurrentUser() user: AuthUser) {
    return this.privacy.export(user);
  }

  @Get('me/data-requests')
  @Roles('CLIENT', 'WORKER')
  dataRequests(@CurrentUser() user: AuthUser) {
    return this.privacy.myRequests(user);
  }

  @Post('me/delete-account')
  @HttpCode(200)
  @Roles('CLIENT', 'WORKER')
  @ApiZodBody(deleteAccountSchema)
  deleteAccount(@CurrentUser() user: AuthUser, @ZBody(deleteAccountSchema) body: z.infer<typeof deleteAccountSchema>) {
    return this.privacy.deleteAccount(user, body.reason);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR', 'FINANCE')
@Controller('admin')
export class AdminComplianceController {
  constructor(
    private readonly insurance: InsuranceService,
    private readonly bonuses: BonusesService,
    private readonly privacy: PrivacyService,
  ) {}

  // ── Правила страхования (меняет superadmin) ──
  @Get('insurance-rules')
  rules() {
    return this.insurance.list();
  }

  @Post('insurance-rules')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(insuranceRuleSchema)
  createRule(@CurrentUser() admin: AuthUser, @Body(new ZodPipe(insuranceRuleSchema)) body: z.infer<typeof insuranceRuleSchema>) {
    return this.insurance.upsert(admin, body);
  }

  @Put('insurance-rules/:id')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(insuranceRuleSchema)
  updateRule(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(insuranceRuleSchema)) body: z.infer<typeof insuranceRuleSchema>) {
    return this.insurance.upsert(admin, body, id);
  }

  @Delete('insurance-rules/:id')
  @AdminRoles('SUPERADMIN')
  deleteRule(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.insurance.remove(admin, id);
  }

  // ── Бонусы (finance) ──
  @Get('bonus-rules')
  @AdminRoles('FINANCE')
  bonusRules() {
    return this.bonuses.rules();
  }

  @Post('bonus-rules')
  @AdminRoles('FINANCE')
  @ApiZodBody(bonusRuleSchema)
  createBonusRule(@CurrentUser() admin: AuthUser, @Body(new ZodPipe(bonusRuleSchema)) body: z.infer<typeof bonusRuleSchema>) {
    return this.bonuses.saveRule(admin, body);
  }

  @Put('bonus-rules/:id')
  @AdminRoles('FINANCE')
  @ApiZodBody(bonusRuleSchema)
  updateBonusRule(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(bonusRuleSchema)) body: z.infer<typeof bonusRuleSchema>) {
    return this.bonuses.saveRule(admin, body, id);
  }

  @Get('bonus-runs')
  @AdminRoles('FINANCE')
  runs() {
    return this.bonuses.runs();
  }

  @Post('bonus-runs')
  @HttpCode(200)
  @AdminRoles('FINANCE')
  @ApiZodBody(bonusRunSchema)
  async calculate(@ZBody(bonusRunSchema) body: z.infer<typeof bonusRunSchema>) {
    const run = await this.bonuses.calculate(body.period);
    return this.bonuses.run(run.id);
  }

  @Get('bonus-runs/:id')
  @AdminRoles('FINANCE')
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.bonuses.run(id);
  }

  @Post('bonus-runs/:id/approve')
  @HttpCode(200)
  @AdminRoles('FINANCE')
  approve(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bonuses.approve(admin, id);
  }

  @Post('bonus-runs/:id/cancel')
  @HttpCode(200)
  @AdminRoles('FINANCE')
  cancel(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bonuses.cancel(admin, id);
  }

  // ── Запросы на данные (GDPR) ──
  @Get('data-requests')
  @AdminRoles('SUPPORT')
  dataRequests(@ZQuery(paginationSchema) q: z.infer<typeof paginationSchema>) {
    return this.privacy.adminList(q.limit);
  }
}
