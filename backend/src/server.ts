import { config } from './config';
import { createApp } from './app';
import { logger } from './lib/logger';
import { runMigrations } from './db/migrate';
import { startScheduler } from './jobs/scheduler';
import { purgeExpiredSessions } from './services/auth';
import { pool } from './db/client';

async function main() {
  if (process.env.MIGRATE_ON_START === 'true') { await runMigrations(); logger.info('migrations applied'); }
  const app = createApp();
  const server = app.listen(config.PORT, () => logger.info(`JSA API listening on :${config.PORT}`));
  if (config.JOBS_ENABLED) {
    startScheduler(config.JOBS_INTERVAL_MINUTES);
    setInterval(() => purgeExpiredSessions().catch(() => undefined), 3600_000).unref();
  }
  const shutdown = () => { logger.info('shutting down'); server.close(() => pool.end().then(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
main().catch((e) => { logger.fatal(e); process.exit(1); });
