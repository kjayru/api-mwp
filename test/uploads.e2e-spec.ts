import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import request from 'supertest';
import { TEST_PUBLIC_UPLOADS_URL, TEST_UPLOADS_DIR } from './e2e-env.js';
import { TINY_PNG } from './fixtures/images.js';
import { accessToken, bearer } from './utils/auth.js';
import { createTestApp } from './utils/test-app.js';

describe('Uploads (e2e)', () => {
  let app: NestExpressApplication;
  let editor: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await rm(TEST_UPLOADS_DIR, { recursive: true, force: true });
    app = await createTestApp();
    editor = bearer(accessToken(app, 'EDITOR'));
  });

  afterAll(async () => {
    await app.close();
    await rm(TEST_UPLOADS_DIR, { recursive: true, force: true });
  });

  it('returns 401 without a token', async () => {
    await http()
      .post('/api/v1/admin/uploads')
      .attach('file', TINY_PNG, 'tiny.png')
      .expect(401);
  });

  it('stores a valid PNG and serves it at /uploads with long cache and nosniff', async () => {
    const res = await http()
      .post('/api/v1/admin/uploads')
      .set(editor)
      // Wrong declared type and name: only the bytes matter.
      .attach('file', TINY_PNG, {
        filename: 'photo.jpg',
        contentType: 'application/octet-stream',
      })
      .expect(201);

    expect(res.body).toEqual({
      url: expect.stringMatching(
        new RegExp(
          `^${TEST_PUBLIC_UPLOADS_URL}/\\d{4}/\\d{2}/[0-9a-f]{32}\\.png$`,
        ),
      ),
      contentType: 'image/png',
      size: TINY_PNG.length,
    });

    const path = (res.body.url as string).slice(TEST_PUBLIC_UPLOADS_URL.length);
    expect(existsSync(`${TEST_UPLOADS_DIR}${path}`)).toBe(true);

    const served = await http().get(`/uploads${path}`).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(Buffer.compare(served.body as Buffer, TINY_PNG)).toBe(0);
  });

  it('rejects a text file renamed .png', async () => {
    const before = existsSync(TEST_UPLOADS_DIR)
      ? (await readdir(TEST_UPLOADS_DIR, { recursive: true })).length
      : 0;

    const res = await http()
      .post('/api/v1/admin/uploads')
      .set(editor)
      .attach('file', Buffer.from('I am plain text, not a picture\n'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(res.body).toMatchObject({
      statusCode: 400,
      message: 'Formato no permitido. Sube una imagen JPEG, PNG, WebP o AVIF.',
    });
    const after = existsSync(TEST_UPLOADS_DIR)
      ? (await readdir(TEST_UPLOADS_DIR, { recursive: true })).length
      : 0;
    expect(after).toBe(before);
  });

  it('rejects files over 5 MB with 413', async () => {
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await http()
      .post('/api/v1/admin/uploads')
      .set(editor)
      .attach('file', big, 'big.png')
      .expect(413);
    expect(res.body.message).toBe('La imagen supera el tamaño máximo de 5 MB');
  });

  it('returns 400 without a file or with another field name', async () => {
    const missing = await http()
      .post('/api/v1/admin/uploads')
      .set(editor)
      .expect(400);
    expect(missing.body.message).toBe(
      'Falta la imagen: envíala como multipart/form-data en el campo "file"',
    );
    const wrongField = await http()
      .post('/api/v1/admin/uploads')
      .set(editor)
      .attach('image', TINY_PNG, 'tiny.png')
      .expect(400);
    expect(wrongField.body.message).toMatch(/campo multipart "file"/);
  });

  it('does not list directories or serve files outside UPLOADS_DIR', async () => {
    await http().get('/uploads/').expect(404);
    await http().get('/uploads/2026').expect(404);
    await http().get('/uploads/../package.json').expect(404);
    await http().get('/uploads/%2e%2e/package.json').expect(404);
    await http().get('/uploads/..%2fpackage.json').expect(404);
  });
});
