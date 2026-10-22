import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { latLngSchema, uuidSchema } from '@masterio/shared';
import { Public, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { CatalogService } from './catalog.service';

const availabilityQuery = z.object({
  categoryId: uuidSchema,
  cityId: uuidSchema,
  lat: z.coerce.number().pipe(latLngSchema.shape.lat),
  lng: z.coerce.number().pipe(latLngSchema.shape.lng),
});

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('cities')
  cities() {
    return this.catalog.cities();
  }

  @Public()
  @Get('categories')
  categories(@Query('cityId', new ZodPipe(uuidSchema.optional())) cityId?: string) {
    return this.catalog.categories(cityId);
  }

  /** Сколько подходящих мастеров рядом прямо сейчас — клиент сразу видит, если никого нет (раздел 9). */
  @ApiBearerAuth()
  @Roles('CLIENT')
  @Get('availability')
  availability(@Query(new ZodPipe(availabilityQuery)) q: z.infer<typeof availabilityQuery>) {
    return this.catalog.availability(q.cityId, q.categoryId, { lat: q.lat, lng: q.lng });
  }
}
