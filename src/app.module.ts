import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { ObserveModule, observeEnabled } from './observe.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    // .env is loaded by config/load-env.ts; here it is only validated.
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
    // Distributed tracing, logs and metrics: https://observe.nestjs.com
    ...(observeEnabled
      ? [
          ObserveModule.forRoot({
            appKey: process.env.OBSERVE_APP_KEY!,
            appSecret: process.env.OBSERVE_APP_SECRET!,
            serviceId: 'api-mwp',
          }),
        ]
      : []),
  ],
})
export class AppModule {}
