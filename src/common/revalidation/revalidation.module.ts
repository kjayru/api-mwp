import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import {
  REVALIDATION_OPTIONS,
  type RevalidationOptions,
  RevalidationService,
} from './revalidation.service.js';

export const REVALIDATION_TIMEOUT_MS = 3000;

@Global()
@Module({
  providers: [
    {
      provide: REVALIDATION_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RevalidationOptions => ({
        url: config.get('FRONT_REVALIDATE_URL', { infer: true }),
        secret: config.get('REVALIDATE_SECRET', { infer: true }),
        timeoutMs: REVALIDATION_TIMEOUT_MS,
      }),
    },
    RevalidationService,
  ],
  exports: [RevalidationService],
})
export class RevalidationModule {}
