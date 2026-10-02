import { validateEnv } from './env.js';

const DATABASE_URL = 'postgresql://mwp:mwp@localhost:5433/mwp?schema=public';

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv({ DATABASE_URL });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'http://localhost:3002',
    ]);
  });

  it('coerces PORT and splits CORS_ORIGINS', () => {
    const env = validateEnv({
      DATABASE_URL,
      PORT: '4000',
      CORS_ORIGINS:
        'https://miwebprofesional.com, https://admin.miwebprofesional.com',
    });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual([
      'https://miwebprofesional.com',
      'https://admin.miwebprofesional.com',
    ]);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'mysql://u:p@localhost/db' }),
    ).toThrow(/DATABASE_URL/);
  });
});
