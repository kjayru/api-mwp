import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { RevalidationModule } from './common/revalidation/revalidation.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BlogModule } from './modules/blog/blog.module.js';
import { CasesModule } from './modules/cases/cases.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { StatsModule } from './modules/stats/stats.module.js';
import { TechnologiesModule } from './modules/technologies/technologies.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';
import { UsersModule } from './modules/users/users.module.js';
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
    UsersModule,
    AuthModule,
    RevalidationModule,
    CasesModule,
    TechnologiesModule,
    ServicesModule,
    BlogModule,
    StatsModule,
    UploadsModule,
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
