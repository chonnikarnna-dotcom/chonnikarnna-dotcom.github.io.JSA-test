import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { asyncH, requireAuth } from '../middleware/core';
import * as auth from '../services/auth';
import { db } from '../db/client';
import { users } from '../db/schema';
import { audit } from '../lib/audit';

export const authRouter = Router();

const limiterOpts = { standardHeaders: 'draft-7' as const, legacyHeaders: false, skip: () => config.isTest,
  handler: (_req: any, res: any) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } }) };
const loginLimiter = rateLimit({
  ...limiterOpts, windowMs: 15 * 60_000, limit: config.AUTH_RATE_LIMIT,
  // per IP + identifier, so one user's failures don't lock out a whole shared shop-floor terminal
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.identifier ?? '').toLowerCase().slice(0, 100)}`,
});
const loginIpLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60_000, limit: config.AUTH_RATE_LIMIT * 10 });
const sensitiveLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60_000, limit: 10 });

const cookieOpts = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const, path: '/' });

const sessionPayload = (u: NonNullable<Express.Request['user']>, csrfToken: string) => ({
  user: {
    id: u.id, email: u.email, username: u.username, displayName: u.displayName, userType: u.userType, roles: u.roles,
    departmentId: u.departmentId, contractorCompanyId: u.contractorCompanyId, preferredLanguage: u.preferredLanguage,
    ownedAreaIds: u.ownedAreaIds, safetySiteScope: u.safetySiteScope,
  },
  csrfToken,
});

authRouter.post('/login', loginIpLimiter, loginLimiter, asyncH(async (req, res) => {
  const body = z.object({ identifier: z.string().min(1).max(255), password: z.string().min(1).max(200) }).parse(req.body);
  const r = await auth.login(body.identifier, body.password, { ip: req.ip, userAgent: req.get('user-agent') });
  res.cookie(config.sessionCookieName, r.token, { ...cookieOpts(), expires: r.expiresAt });
  res.json(sessionPayload(r.user, r.csrfToken));
}));

authRouter.post('/logout', requireAuth, asyncH(async (req, res) => {
  await auth.logout(req.sessionId!, req.user!.id);
  res.clearCookie(config.sessionCookieName, cookieOpts());
  res.status(204).end();
}));

authRouter.get('/me', requireAuth, (req, res) => { res.json(sessionPayload(req.user!, req.csrfToken!)); });

authRouter.patch('/me/preferences', requireAuth, asyncH(async (req, res) => {
  const body = z.object({ preferredLanguage: z.enum(['th', 'en']) }).parse(req.body);
  await db.update(users).set({ preferredLanguage: body.preferredLanguage }).where(eq(users.id, req.user!.id));
  res.json({ ok: true });
}));

authRouter.post('/change-password', requireAuth, sensitiveLimiter, asyncH(async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }).parse(req.body);
  await auth.changePassword(req.user!.id, body.currentPassword, body.newPassword);
  res.json({ ok: true });
}));

authRouter.post('/forgot-password', sensitiveLimiter, asyncH(async (req, res) => {
  const body = z.object({ identifier: z.string().min(1).max(255) }).parse(req.body);
  const r = await auth.requestPasswordReset(body.identifier);
  // Always 202 to avoid account enumeration.
  res.status(202).json({ ok: true, ...(r.devToken ? { devToken: r.devToken } : {}) });
}));

authRouter.post('/reset-password', sensitiveLimiter, asyncH(async (req, res) => {
  const body = z.object({ token: z.string().min(10).max(200), newPassword: z.string().min(1).max(200) }).parse(req.body);
  await auth.resetPassword(body.token, body.newPassword);
  res.json({ ok: true });
}));

authRouter.get('/invitations/:token', sensitiveLimiter, asyncH(async (req, res) => {
  res.json(await auth.inspectInvite(req.params.token));
}));

authRouter.post('/activate', sensitiveLimiter, asyncH(async (req, res) => {
  const body = z.object({ token: z.string().min(10).max(200), newPassword: z.string().min(1).max(200) }).parse(req.body);
  await auth.activateInvite(body.token, body.newPassword);
  res.json({ ok: true });
}));

export { audit };
