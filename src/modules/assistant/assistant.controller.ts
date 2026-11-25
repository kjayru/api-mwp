import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { AssistantService } from './assistant.service.js';
import {
  CHAT_THROTTLE,
  ChatIpThrottlerGuard,
  ChatVisitorThrottlerGuard,
} from './chat-throttler.guard.js';
import { ChatRequestDto } from './dto/chat.dto.js';
import { SseStream } from './sse.js';

@Public()
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /**
   * Public chat, answered as Server-Sent Events (see docs/API.md, section 10).
   * Errors detected before streaming (400, 404, 429, 503) are plain JSON.
   */
  @Post('chat')
  @UseGuards(ChatIpThrottlerGuard, ChatVisitorThrottlerGuard)
  @Throttle({ default: CHAT_THROTTLE })
  async chat(
    @Body() dto: ChatRequestDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const turn = await this.assistant.startTurn(dto, req.ip);

    const abort = new AbortController();
    // 'close' fires when the client disconnects (or after res.end()).
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const sse = new SseStream(res);
    sse.open();
    try {
      await this.assistant.streamTurn(turn, sse, abort.signal);
    } finally {
      sse.close();
    }
  }
}
