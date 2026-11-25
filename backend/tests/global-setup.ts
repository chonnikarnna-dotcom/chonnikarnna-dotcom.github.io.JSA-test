import { execSync } from 'child_process';
import path from 'path';

/** Recreate the test database schema, migrate and seed base data + demo users once per run. */
export default function setup() {
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://jsa:jsa_dev_password@localhost:5432/jsa_test', SESSION_SECRET: 'test-secret-0123456789abcdef0123456789abcdef' };
  const cwd = path.resolve(__dirname, '..');
  execSync('npx tsx src/db/reset.ts', { cwd, env, stdio: 'inherit' });
  execSync('npx tsx src/db/seed.ts', { cwd, env: { ...env, NODE_ENV: 'development', SEED_DEMO_USERS: 'true' }, stdio: 'inherit' });
}
