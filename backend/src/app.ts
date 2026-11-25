import express from 'express';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { logger } from './lib/logger';
import { csrfProtection, errorHandler, notFoundHandler, requestContext, sessionLoader } from './middleware/core';
import { authRouter } from './modules/auth.routes';
import { jsaRouter } from './modules/jsa.routes';
import { approvalsRouter } from './modules/approvals.routes';
import { attachmentsRouter } from './modules/attachments.routes';
import { notificationsRouter } from './modules/notifications.routes';
import { reportsRouter } from './modules/reports.routes';
import { lookupsRouter } from './modules/lookups.routes';
import { adminRouter, auditRouter } from './modules/admin.routes';
import { openapi } from './openapi';
import { pool } from './db/client';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY === 'false' ? false : config.TRUST_PROXY);
  app.use(requestContext);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"], connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"], frameSrc: ["'self'", 'blob:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() }); }
    catch { res.status(503).json({ status: 'degraded', db: 'unavailable' }); }
  });
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'JSA API' }));

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => config.isTest }));
  api.use(sessionLoader);
  api.use(csrfProtection);
  api.use('/auth', authRouter);
  api.use('/lookups', lookupsRouter);
  api.use('/jsas', jsaRouter);
  api.use('/approvals', approvalsRouter);
  api.use('/attachments', attachmentsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/reports', reportsRouter);
  api.use('/admin', adminRouter);
  api.use('/audit-logs', auditRouter);
  api.use(notFoundHandler);
  app.use('/api/v1', api);

  // Optional: serve the built frontend from the same origin (single-container deployment).
  if (config.SERVE_FRONTEND_DIR && fs.existsSync(config.SERVE_FRONTEND_DIR)) {
    const dir = path.resolve(config.SERVE_FRONTEND_DIR);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
