/** DEVELOPMENT ONLY: drop and recreate the schema, then migrate. Refuses to run in production. */
import { sql } from 'drizzle-orm';
import { config } from '../config';
import { db, pool } from './client';
import { runMigrations } from './migrate';

async function main() {
  if (config.isProd) throw new Error('db:reset is disabled in production');
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
  console.log('Database reset and migrated.');
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
