import 'reflect-metadata';
import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import { BRAND } from '@masterio/shared';
import { AppModule } from './app.module';
import { loadEnv, type Env } from './config/env';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

export async function createApp(env: Env): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env), {
    rawBody: true,
    logger: env.NODE_ENV === 'test' ? ['error'] : ['error', 'warn', 'log', ...(env.LOG_LEVEL === 'debug' ? (['debug'] as const) : [])],
  });
  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({ origin: origins, credentials: true });
  app.useWebSocketAdapter(new RedisIoAdapter(app, origins));
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle(`${BRAND.platform} API`)
      .setVersion('0.2.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }
  return app;
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
  const app = await createApp(env);
  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`${BRAND.platform} API listening on :${env.PORT}`);
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
