import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { AnalyticsService } from './analytics.service.js';
import {
  TRACK_THROTTLE,
  TRACK_THROTTLED,
  TrackThrottlerGuard,
} from './track-throttler.guard.js';

@Public()
@Controller('track')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Page view of the public site (docs/API.md 11.3). Always 204: invalid,
   * bot and over-the-limit views are silently ignored. The body is typed as
   * a plain object on purpose, so the global ValidationPipe never rejects it.
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TrackThrottlerGuard)
  @Throttle({ default: TRACK_THROTTLE })
  async track(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    if ((req as unknown as Record<symbol, unknown>)[TRACK_THROTTLED]) return;
    await this.analytics.track({ body, userAgent });
  }
}
