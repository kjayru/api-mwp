import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { TEST_DATABASE_URL } from './e2e-env.js';

/** Creates the test database if needed and applies every migration to it. */
export default async function setup(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const database = target.pathname.slice(1);
  if (!/^\w+_test$/.test(database)) {
    throw new Error(`Refusing to run e2e tests against "${database}"`);
  }

  const maintenance = new URL(target);
  maintenance.pathname = '/postgres';
  maintenance.search = '';
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${database}"`);
    }
  } finally {
    await client.end();
  }

  // Run the local Prisma CLI with node directly (no shell, works on Windows too).
  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
}
