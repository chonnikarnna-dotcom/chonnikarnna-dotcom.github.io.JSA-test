import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { ZodError } from 'zod';
import { and, eq, gt } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { als } from '../lib/context';
import { AuthUser, hasRole, loadAuthUser, RoleCode } from '../lib/authz';
import { sha256 } from '../lib/crypto';
import { logger } from '../lib/logger';
import { auditAsync } from '../lib/audit';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      user?: AuthUser;
      sessionId?: string;
      csrfToken?: string;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  als.run({ requestId: req.id, ip: req.ip }, next);
}

/** Loads the session (if any) and the authenticated user. Does not reject anonymous requests. */
export async function sessionLoader(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[config.sessionCookieName];
    if (!token) return next();
    const now = new Date();
    const s = await db.query.sessions.findFirst({ where: and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)) });
    if (!s) return next();
    const idleLimit = new Date(now.getTime() - config.SESSION_IDLE_MINUTES * 60_000);
    if (s.lastSeenAt < idleLimit) {
      await db.delete(sessions).where(eq(sessions.id, s.id));
      return next();
    }
    const user = await loadAuthUser(s.userId);
    if (!user) {
      // deactivated account: kill session
      await db.delete(sessions).where(eq(sessions.id, s.id));
      return next();
    }
    if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
      await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.id));
    }
    req.user = user;
    req.sessionId = s.id;
    req.csrfToken = s.csrfToken;
    const store = als.getStore();
    if (store) { store.userId = user.id; store.userLabel = `${user.displayName} <${user.email}>`; }
    next();
  } catch (e) { next(e); }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** CSRF: state-changing requests from an authenticated session must echo the session's CSRF token. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || !req.sessionId) return next();
  const header = req.header('x-csrf-token');
  const digest = (v: string) => crypto.createHash('sha256').update(v).digest();
  if (!header || !req.csrfToken || !crypto.timingSafeEqual(digest(header), digest(req.csrfToken))) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export const requireRole = (...roleCodes: RoleCode[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (!hasRole(req.user, ...roleCodes)) {
    auditAsync({ action: 'ACCESS_DENIED', entityType: 'ROUTE', entityId: `${req.method} ${req.baseUrl}${req.path}`, result: 'DENIED', reason: `requires ${roleCodes.join('|')}` });
    return next(forbidden());
  }
  next();
};

export const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: req.id,
        details: err.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, reqId: req.id }, err.message);
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
  }
  const anyErr = err as any;
  if (anyErr?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large', requestId: req.id } });
  if (anyErr?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON', requestId: req.id } });
  if (anyErr?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File too large', requestId: req.id } });
  // DB guard triggers → treat as conflict, never leak internals
  const pgCode = anyErr?.code ?? anyErr?.cause?.code;
  if (pgCode === 'P0001') {
    logger.warn({ err, reqId: req.id }, 'integrity guard rejected change');
    return res.status(409).json({ error: { code: 'INTEGRITY_VIOLATION', message: 'The record is locked or immutable', requestId: req.id } });
  }
  if (pgCode === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists', requestId: req.id } });
  if (pgCode === '23503') return res.status(409).json({ error: { code: 'REFERENCE_CONSTRAINT', message: 'The record is referenced by or references other data', requestId: req.id } });
  logger.error({ err, reqId: req.id }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: req.id } });
}
