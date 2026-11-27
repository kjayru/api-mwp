import {
  BREVO_URL,
  BrevoTransport,
  createMailTransport,
  type MailMessage,
} from './mail-transport.js';

const KEY = 'xkeysib-secret-key-123';

const message: MailMessage = {
  from: 'miwebprofesional <no-reply@miwebprofesional.com>',
  to: 'hola@miwebprofesional.com',
  replyTo: 'ana@example.com',
  subject: 'Nuevo lead: Ana &lt;x&gt;',
  text: 'texto',
  html: '<p>Ana &lt;script&gt;</p>',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BrevoTransport', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the email to Brevo with the expected shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { messageId: '<abc@brevo>' }),
    );

    await new BrevoTransport(KEY).sendMail(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(url).toBe(BREVO_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'api-key': KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      sender: {
        name: 'miwebprofesional',
        email: 'no-reply@miwebprofesional.com',
      },
      to: [{ email: 'hola@miwebprofesional.com' }],
      replyTo: { email: 'ana@example.com' },
      subject: 'Nuevo lead: Ana &lt;x&gt;',
      htmlContent: '<p>Ana &lt;script&gt;</p>',
      textContent: 'texto',
      tags: ['lead'],
    });
  });

  it('accepts a bare sender email and no replyTo', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'm1' }));
    await new BrevoTransport(KEY).sendMail({
      ...message,
      from: 'no-reply@miwebprofesional.com',
      replyTo: undefined,
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.sender).toEqual({ email: 'no-reply@miwebprofesional.com' });
    expect(body).not.toHaveProperty('replyTo');
  });

  it('resolves with the body on 201', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { messageId: '<abc@brevo>' }),
    );
    await expect(new BrevoTransport(KEY).sendMail(message)).resolves.toEqual({
      messageId: '<abc@brevo>',
    });
  });

  it.each([
    [400, 'invalid_parameter', 'sender is invalid'],
    [401, 'unauthorized', 'Key not found'],
  ])(
    'throws with status and Brevo message on %i, never the key',
    async (status, code, text) => {
      fetchMock.mockResolvedValue(
        jsonResponse(status, { code, message: text }),
      );

      const error = await new BrevoTransport(KEY)
        .sendMail(message)
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(Error);
      const { message: msg } = error as Error;
      expect(msg).toContain(String(status));
      expect(msg).toContain(code);
      expect(msg).toContain(text);
      expect(msg).not.toContain(KEY);
    },
  );

  it('still throws when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>bad gateway</html>', { status: 502 }),
    );
    await expect(new BrevoTransport(KEY).sendMail(message)).rejects.toThrow(
      /502/,
    );
  });

  it('propagates the abort/timeout error and does not leak the key', async () => {
    fetchMock.mockRejectedValue(
      new DOMException('The operation timed out', 'TimeoutError'),
    );
    const error = await new BrevoTransport(KEY)
      .sendMail(message)
      .catch((e: Error) => e);
    expect((error as Error).name).toBe('TimeoutError');
    expect((error as Error).message).not.toContain(KEY);
  });
});

describe('createMailTransport', () => {
  const smtp = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 465,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    SMTP_SECURE: undefined,
  };
  const none = {
    SMTP_HOST: undefined,
    SMTP_PORT: undefined,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    SMTP_SECURE: undefined,
  };

  it('prefers Brevo over SMTP', () => {
    expect(createMailTransport({ ...smtp, BREVO_API_KEY: KEY })).toBeInstanceOf(
      BrevoTransport,
    );
  });

  it('uses SMTP without a Brevo key', () => {
    const transport = createMailTransport({
      ...smtp,
      BREVO_API_KEY: undefined,
    });
    expect(transport).not.toBeNull();
    expect(transport).not.toBeInstanceOf(BrevoTransport);
  });

  it('is null with no provider', () => {
    expect(
      createMailTransport({ ...none, BREVO_API_KEY: undefined }),
    ).toBeNull();
  });
});
