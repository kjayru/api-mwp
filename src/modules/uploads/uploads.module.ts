import { Module } from '@nestjs/common';
import { FileStorage } from './storage/file-storage.js';
import { LocalFileStorage } from './storage/local-file-storage.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
  controllers: [UploadsController],
  providers: [
    UploadsService,
    // Swap for an S3-compatible implementation in production (later phase).
    { provide: FileStorage, useClass: LocalFileStorage },
  ],
})
export class UploadsModule {}
