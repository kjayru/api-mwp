/**
 * Where uploaded files live. LocalFileStorage (UPLOADS_DIR, served at /uploads)
 * is used for now; an S3-compatible implementation can replace it in production
 * by binding another class to this token in UploadsModule.
 */
export abstract class FileStorage {
  /**
   * Stores `data` under `key` (a relative path such as "2026/10/<random>.png")
   * and returns its public URL. Must never overwrite an existing file.
   */
  abstract save(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<string>;
}
