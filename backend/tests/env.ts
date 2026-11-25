// Test environment: separate database, deterministic settings. Loaded before any app module.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://jsa:jsa_dev_password@localhost:5432/jsa_test';
process.env.SESSION_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
process.env.STORAGE_DIR = './storage-test';
process.env.JOBS_ENABLED = 'false';
process.env.EXPOSE_DEV_TOKENS = 'true';
