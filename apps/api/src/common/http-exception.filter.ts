import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';
import { errorKey, type ApiErrorBody } from '@masterio/shared';

/** Все ошибки отдаются в одном формате; неизвестные — как INTERNAL без деталей, с отправкой в Sentry. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) {
        res.status(status).json(body);
        return;
      }
      const code = status === HttpStatus.UNAUTHORIZED
        ? 'UNAUTHORIZED'
        : status === HttpStatus.FORBIDDEN
          ? 'FORBIDDEN'
          : status === HttpStatus.NOT_FOUND
            ? 'NOT_FOUND'
            : status === HttpStatus.TOO_MANY_REQUESTS
              ? 'RATE_LIMITED'
              : status === HttpStatus.PAYLOAD_TOO_LARGE || status === HttpStatus.BAD_REQUEST
                ? 'VALIDATION_FAILED'
                : 'INTERNAL';
      const payload: ApiErrorBody = { code, messageKey: errorKey(code) };
      res.status(status).json(payload);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    Sentry.captureException(exception);
    const payload: ApiErrorBody = { code: 'INTERNAL', messageKey: errorKey('INTERNAL') };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(payload);
  }
}
