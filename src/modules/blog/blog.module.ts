import { Module } from '@nestjs/common';
import { AdminBlogController } from './admin-blog.controller.js';
import { AdminBlogService } from './admin-blog.service.js';
import { BlogController } from './blog.controller.js';
import { BlogService } from './blog.service.js';

/** Blog: Markdown posts per locale (/blog on the site, editor in the admin). */
@Module({
  controllers: [BlogController, AdminBlogController],
  providers: [BlogService, AdminBlogService],
})
export class BlogModule {}
