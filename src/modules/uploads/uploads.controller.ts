import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ImageUploadInterceptor } from './image-upload.interceptor.js';
import {
  type UploadedImageFile,
  type UploadResult,
  UploadsService,
} from './uploads.service.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** multipart/form-data, field "file": JPEG, PNG, WebP or AVIF up to 5 MB. */
  @Post()
  @UseInterceptors(ImageUploadInterceptor)
  upload(
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<UploadResult> {
    return this.uploads.uploadImage(file);
  }
}
