import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BlogModule } from '../blog/blog.module.js';
import { CasesModule } from '../cases/cases.module.js';
import { PreviewSecretGuard } from './preview-secret.guard.js';
import {
  AdminPreviewController,
  PreviewController,
} from './preview.controller.js';
import { PreviewService } from './preview.service.js';

/** Draft preview of cases and posts on the public site (docs/API.md 12.1). */
@Module({
  // JwtService comes from AuthModule; the preview secret is passed per call,
  // so preview tokens never use JWT_SECRET.
  imports: [AuthModule, CasesModule, BlogModule],
  controllers: [AdminPreviewController, PreviewController],
  providers: [PreviewService, PreviewSecretGuard],
})
export class PreviewModule {}
