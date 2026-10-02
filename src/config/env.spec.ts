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

  it('requires a JWT_SECRET of at least 32 characters', () => {
    expect(() => validateEnv({ DATABASE_URL })).toThrow(/JWT_SECRET/);
    expect(() =>
      validateEnv({ DATABASE_URL, JWT_SECRET: 'too-short' }),
    ).toThrow(/JWT_SECRET/);
  });
});
