import { parseTrustProxy, validateEnv } from './env.js';

const DATABASE_URL = 'postgresql://mwp:mwp@localhost:5433/mwp?schema=public';
const JWT_SECRET = 'a'.repeat(32);
const required = { DATABASE_URL, JWT_SECRET };

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(required);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'http://localhost:3002',
    ]);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
  });

  it('coerces numbers and splits CORS_ORIGINS', () => {
    const env = validateEnv({
      ...required,
      PORT: '4000',
      JWT_ACCESS_TTL_SECONDS: '60',
      REFRESH_TOKEN_TTL_DAYS: '30',
      CORS_ORIGINS:
        'https://miwebprofesional.com, https://admin.miwebprofesional.com',
    });

    expect(env.PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(60);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(env.CORS_ORIGINS).toEqual([
      'https://miwebprofesional.com',
      'https://admin.miwebprofesional.com',
    ]);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() =>
      validateEnv({ JWT_SECRET, DATABASE_URL: 'mysql://u:p@localhost/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('defaults the uploads settings and leaves the revalidation webhook off', () => {
    const env = validateEnv(required);

    expect(env.UPLOADS_DIR).toBe('./uploads');
    expect(env.PUBLIC_UPLOADS_URL).toBe('http://localhost:3001/uploads');
    expect(env.FRONT_REVALIDATE_URL).toBeUndefined();
    expect(env.REVALIDATE_SECRET).toBeUndefined();
  });

  it('strips the trailing slash of PUBLIC_UPLOADS_URL and treats empty values as unset', () => {
    const env = validateEnv({
      ...required,
      PUBLIC_UPLOADS_URL: 'https://api.miwebprofesional.com/uploads/',
      FRONT_REVALIDATE_URL: '',
      REVALIDATE_SECRET: '',
    });

    expect(env.PUBLIC_UPLOADS_URL).toBe(
      'https://api.miwebprofesional.com/uploads',
    );
    expect(env.FRONT_REVALIDATE_URL).toBeUndefined();
  });

  it('requires a REVALIDATE_SECRET of at least 32 characters when FRONT_REVALIDATE_URL is set', () => {
    const FRONT_REVALIDATE_URL = 'http://localhost:3000/api/revalidate';

    expect(() => validateEnv({ ...required, FRONT_REVALIDATE_URL })).toThrow(
      /REVALIDATE_SECRET/,
    );
    expect(() =>
      validateEnv({
        ...required,
        FRONT_REVALIDATE_URL,
        REVALIDATE_SECRET: 'short',
      }),
    ).toThrow(/REVALIDATE_SECRET/);
    expect(
      validateEnv({
        ...required,
        FRONT_REVALIDATE_URL,
        REVALIDATE_SECRET: 's'.repeat(32),
      }).FRONT_REVALIDATE_URL,
    ).toBe(FRONT_REVALIDATE_URL);
  });

  it('rejects a non-http FRONT_REVALIDATE_URL', () => {
    expect(() =>
      validateEnv({
        ...required,
        FRONT_REVALIDATE_URL: 'ftp://localhost/revalidate',
        REVALIDATE_SECRET: 's'.repeat(32),
      }),
    ).toThrow(/FRONT_REVALIDATE_URL/);
  });

  it('requires a JWT_SECRET of at least 32 characters', () => {
    expect(() => validateEnv({ DATABASE_URL })).toThrow(/JWT_SECRET/);
    expect(() =>
      validateEnv({ DATABASE_URL, JWT_SECRET: 'too-short' }),
    ).toThrow(/JWT_SECRET/);
  });

  describe('assistant (Phase 4)', () => {
    it('defaults the Voyage model and the similarity threshold; keys are optional', () => {
      const env = validateEnv({ ...required, ANTHROPIC_API_KEY: '', VOYAGE_API_KEY: '' });
      expect(env.VOYAGE_MODEL).toBe('voyage-3.5');
      expect(env.KNOWLEDGE_MIN_SIMILARITY).toBe(0.5);
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.VOYAGE_API_KEY).toBeUndefined();
    });

    it('coerces KNOWLEDGE_MIN_SIMILARITY and rejects values outside 0-1', () => {
      expect(
        validateEnv({ ...required, KNOWLEDGE_MIN_SIMILARITY: '0.6' })
          .KNOWLEDGE_MIN_SIMILARITY,
      ).toBe(0.6);
      expect(() =>
        validateEnv({ ...required, KNOWLEDGE_MIN_SIMILARITY: '1.5' }),
      ).toThrow(/KNOWLEDGE_MIN_SIMILARITY/);
    });

    it('requires the three GOOGLE_* variables together', () => {
      expect(() =>
        validateEnv({ ...required, GOOGLE_CLIENT_ID: 'id' }),
      ).toThrow(/GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN/);
      const env = validateEnv({
        ...required,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REFRESH_TOKEN: 'refresh',
      });
      expect(env.GOOGLE_REFRESH_TOKEN).toBe('refresh');
    });
  });

  describe('TRUST_PROXY', () => {
    it('defaults to loopback', () => {
      expect(validateEnv(required).TRUST_PROXY).toEqual(['loopback']);
      expect(validateEnv({ ...required, TRUST_PROXY: '' }).TRUST_PROXY).toEqual(['loopback']);
    });

    it('accepts booleans, hop counts and lists of IPs, subnets and names', () => {
      expect(parseTrustProxy('false')).toBe(false);
      expect(parseTrustProxy('TRUE')).toBe(true);
      expect(parseTrustProxy('2')).toBe(2);
      expect(parseTrustProxy('loopback, 10.0.0.0/8, 192.168.1.10, ::1, fd00::/8')).toEqual([
        'loopback',
        '10.0.0.0/8',
        '192.168.1.10',
        '::1',
        'fd00::/8',
      ]);
    });

    it('rejects anything else at startup', () => {
      expect(parseTrustProxy('apache')).toBeNull();
      expect(parseTrustProxy('10.0.0.0/33')).toBeNull();
      expect(parseTrustProxy('300.1.1.1')).toBeNull();
      expect(() => validateEnv({ ...required, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
    });
  });

  describe('SMTP_* and ADMIN_URL', () => {
    const smtp = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_FROM: 'miwebprofesional <no-reply@example.com>',
    };

    it('requires the five SMTP variables together (or none)', () => {
      expect(validateEnv(required).SMTP_HOST).toBeUndefined();
      expect(() => validateEnv({ ...required, SMTP_HOST: 'smtp.example.com' })).toThrow(
        /SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM/,
      );
      const env = validateEnv({ ...required, ...smtp, SMTP_SECURE: '' });
      expect(env.SMTP_PORT).toBe(465);
      expect(env.SMTP_SECURE).toBeUndefined();
    });

    it('validates SMTP_SECURE and the port', () => {
      expect(() => validateEnv({ ...required, ...smtp, SMTP_SECURE: 'yes' })).toThrow(/SMTP_SECURE/);
      expect(() => validateEnv({ ...required, ...smtp, SMTP_PORT: '70000' })).toThrow(/SMTP_PORT/);
    });

    it('ADMIN_URL defaults to the local admin and drops the trailing slash', () => {
      expect(validateEnv(required).ADMIN_URL).toBe('http://localhost:3002');
      expect(
        validateEnv({ ...required, ADMIN_URL: 'https://admin.miwebprofesional.com/' }).ADMIN_URL,
      ).toBe('https://admin.miwebprofesional.com');
    });
  });
});
