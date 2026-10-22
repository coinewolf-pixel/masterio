import { applyDecorators, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';
import { AppException } from './app-exception';

export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        'VALIDATION_FAILED',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}

/** Тело запроса, проверенное zod-схемой из @masterio/shared. */
export function ZBody<T extends ZodType>(schema: T): ParameterDecorator {
  return Body(new ZodPipe(schema));
}

export function ZQuery<T extends ZodType>(schema: T): ParameterDecorator {
  return Query(new ZodPipe(schema));
}

/** Описание тела в Swagger из той же zod-схемы. */
export function ApiZodBody(schema: ZodType): MethodDecorator {
  let jsonSchema: Record<string, unknown> = { type: 'object' };
  try {
    jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  } catch {
    // схема с refine/transform может не иметь JSON-представления — Swagger покажет объект без деталей
  }
  return applyDecorators(ApiBody({ schema: jsonSchema }));
}
