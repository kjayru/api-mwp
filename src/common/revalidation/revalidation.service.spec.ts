import { Logger } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  REVALIDATE_SECRET_HEADER,
  RevalidationService,
  RevalidationTag,
} from './revalidation.service.js';

interface Received {
  headers: IncomingMessage['headers'];
  body: unknown;
}

const SECRET = 'r'.repeat(32);

describe('RevalidationService', () => {
  let server: Server;
  let url: string;
  let received: Received[];
  let respond: (res: import('node:http').ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(raw) });
        respond(res);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/revalidate`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    respond = (res) => res.writeHead(200).end('{"revalidated":true}');
    vi.restoreAllMocks();
  });

  it('builds the case tag', () => {
    expect(RevalidationTag.case('cortemaestro')).toBe('case:cortemaestro');
  });

  it('POSTs the unique tags with the secret header', async () => {
    const service = new RevalidationService({
      url,
      secret: SECRET,
      timeoutMs: 3000,
    });

    await service.revalidate(['cases', 'case:a', 'cases', 'stats']);

    expect(received).toHaveLength(1);
    expect(received[0].body).toEqual({ tags: ['cases', 'case:a', 'stats'] });
    expect(received[0].headers[REVALIDATE_SECRET_HEADER]).toBe(SECRET);
    expect(received[0].headers['content-type']).toBe('application/json');
  });

  it('does nothing when FRONT_REVALIDATE_URL is not set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const service = new RevalidationService({ timeoutMs: 3000 });

    await service.revalidate(['cases']);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('logs and swallows an error response', async () => {
    respond = (res) => res.writeHead(401).end();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const service = new RevalidationService({
      url,
      secret: SECRET,
      timeoutMs: 3000,
    });

    await expect(service.revalidate(['services'])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('answered 401'));
  });

  it('gives up after the timeout without rejecting', async () => {
    respond = () => {}; // never answers
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const service = new RevalidationService({
      url,
      secret: SECRET,
      timeoutMs: 100,
    });

    const started = Date.now();
    await expect(service.revalidate(['cases'])).resolves.toBeUndefined();

    expect(Date.now() - started).toBeLessThan(2000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed'));
  });

  it('swallows network errors', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const service = new RevalidationService({
      url: 'http://127.0.0.1:1/api/revalidate',
      secret: SECRET,
      timeoutMs: 1000,
    });

    await expect(service.revalidate(['cases'])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
