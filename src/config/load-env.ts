import { existsSync } from 'node:fs';

// Loads .env before any other module reads process.env (e.g. the Observe setup).
// Variables already set in the environment take precedence over the file.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
