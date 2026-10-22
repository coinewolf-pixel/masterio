import { HttpException, HttpStatus } from '@nestjs/common';
import { errorKey, type ErrorCode } from '@masterio/shared';

const STATUS: Partial<Record<ErrorCode, HttpStatus>> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  TOKEN_REUSED: HttpStatus.UNAUTHORIZED,
  OTP_INVALID: HttpStatus.UNAUTHORIZED,
  OTP_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  ACCOUNT_BLOCKED: HttpStatus.FORBIDDEN,
  GRANT_SELF_FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  OTP_TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,
  ORDER_ALREADY_TAKEN: HttpStatus.CONFLICT,
  OFFER_NOT_ACTIVE: HttpStatus.GONE,
  OFFER_EXPIRED: HttpStatus.GONE,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  WORKER_HAS_ACTIVE_ORDER: HttpStatus.CONFLICT,
  ALREADY_EXISTS: HttpStatus.CONFLICT,
  LAST_SUPERADMIN: HttpStatus.CONFLICT,
  TEAM_MEMBER_MODE: HttpStatus.FORBIDDEN,
  TEAMS_DISABLED: HttpStatus.FORBIDDEN,
  ALREADY_IN_TEAM: HttpStatus.CONFLICT,
  TEAM_HAS_ACTIVE_WORK: HttpStatus.CONFLICT,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Ошибка API с кодом и ключом перевода. Тело: { code, messageKey, details }. */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    details?: unknown,
    status?: HttpStatus,
  ) {
    super(
      { code, messageKey: errorKey(code), ...(details === undefined ? {} : { details }) },
      status ?? STATUS[code] ?? HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
