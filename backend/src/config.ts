import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_IDLE_MINUTES: z.coerce.number().default(60),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().default(12),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().default(15),
  TRUST_PROXY: z.string().default('loopback'),
  COOKIE_SECURE: bool.optional(),
  EXPOSE_DEV_TOKENS: bool.default('false'),
  LOG_LEVEL: z.string().default('info'),
  PDF_FONT_REGULAR: z.string().optional(),
  PDF_FONT_BOLD: z.string().optional(),
  AUTH_RATE_LIMIT: z.coerce.number().default(20), // login attempts per 15 min per IP+identifier
  JOBS_ENABLED: bool.default('true'),
  JOBS_INTERVAL_MINUTES: z.coerce.number().default(10),
  SERVE_FRONTEND_DIR: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.SESSION_SECRET.startsWith('dev-only')) throw new Error('Refusing to start: SESSION_SECRET is a development value');
  if (env.EXPOSE_DEV_TOKENS) throw new Error('Refusing to start: EXPOSE_DEV_TOKENS must be false in production');
}

const cookieSecure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  cookieSecure,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  // __Host- prefix (Secure, Path=/, no Domain) whenever cookies are Secure, i.e. behind HTTPS
  sessionCookieName: cookieSecure ? '__Host-jsa_sid' : 'jsa_sid',
};
