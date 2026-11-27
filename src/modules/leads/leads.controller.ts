import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CONTACT_FORM_THROTTLE,
  ContactFormThrottlerGuard,
} from './contact-form-throttler.guard.js';
import { ContactFormDto } from './dto/contact-form.dto.js';
import { type ContactFormResult, LeadsService } from './leads.service.js';

@Public()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /** Contact form of the public site (docs/API.md 11.1). 5 per hour per IP. */
  @Post()
  @UseGuards(ContactFormThrottlerGuard)
  @Throttle({ default: CONTACT_FORM_THROTTLE })
  create(
    @Body() dto: ContactFormDto,
    @Req() req: Request,
  ): Promise<ContactFormResult> {
    return this.leads.createFromForm(dto, req.ip);
  }
}
