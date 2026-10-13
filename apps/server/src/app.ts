import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from './generated/prisma/client.js';
import { AuthService } from './auth/service.js';
import { AuthController, AuthGuard, Public } from './auth/http.js';
import { ApiErrorFilter } from './auth/errors.js';
import { authConfig, type AuthConfig } from './auth/config.js';
import { ContentService } from './content/service.js';
import { WorldService } from './world/service.js';
import { ContentController, WorldController, SaveController } from './content/http.js';
import { GenerationService } from './content/generation.js';

export async function createApp(database: PrismaClient, config: AuthConfig = authConfig()) {
  const identity = new AuthService(database, config);
  const worlds = new WorldService(database);
  const content = new ContentService(database, worlds);
  const generation = new GenerationService(database, content);
  await identity.initialize();
  @Controller('api')
  class HealthController {
    @Public() @Get('health')
    async health() {
      await database.$queryRaw`SELECT 1`;
      return { data: { status: 'ok', database: 'connected', stage: 'workshop' } };
    }
  }
  @Module({ controllers: [HealthController, AuthController, ContentController, WorldController, SaveController], providers: [
    { provide: AuthService, useValue: identity },
    { provide: ContentService, useValue: content },
    { provide: WorldService, useValue: worlds },
    { provide: GenerationService, useValue: generation },
    { provide: APP_GUARD, useFactory: (reflector: Reflector) => new AuthGuard(identity, reflector), inject: [Reflector] },
  ] })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  app.getHttpAdapter().getInstance().set('trust proxy', config.trustedProxyIps.length ? config.trustedProxyIps : false);
  app.use('/api', (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useBodyParser('json', { limit: '2mb' });
  app.useGlobalFilters(new ApiErrorFilter());
  return app;
}
