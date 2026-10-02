import { validateEnv } from './env.js';

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
});
