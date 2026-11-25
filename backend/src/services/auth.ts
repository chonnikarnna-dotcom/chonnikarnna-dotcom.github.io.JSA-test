import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions, users, userTokens } from '../db/schema';
import { config } from '../config';
import { hashPassword, passwordPolicy, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { AppError, badRequest } from '../lib/errors';
import { audit, auditAsync } from '../lib/audit';
import { loadAuthUser } from '../lib/authz';
import { logger } from '../lib/logger';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function login(identifier: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const id = identifier.trim().toLowerCase();
  const u = await db.query.users.findFirst({ where: or(eq(sql`lower(${users.email})`, id), eq(sql`lower(${users.username})`, id)) });
  const generic = new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username/email or password');
  if (!u) {
    await verifyPassword(null, password);
    auditAsync({ action: 'LOGIN', entityType: 'USER', result: 'FAILURE', reason: 'unknown user', metadata: { identifier: id.slice(0, 100) } });
    throw generic;
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    auditAsync({ action: 'LOGIN', entityType: 'USER', entityId: u.id, result: 'DENIED', reason: 'account locked' });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
  }
  const ok = await verifyPassword(u.passwordHash, password);
  if (!ok) {
    const failed = u.failedLoginCount + 1;
    await db.update(users).set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null }).where(eq(users.id, u.id));
    auditAsync({ action: 'LOGIN', entityType: 'USER', entityId: u.id, result: 'FAILURE', reason: 'bad password', metadata: { failed } });
    throw generic;
  }
  if (!u.isActive) {
    auditAsync({ action: 'LOGIN', entityType: 'USER', entityId: u.id, result: 'DENIED', reason: 'inactive' });
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is deactivated');
  }
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const expiresAt = new Date(Date.now() + config.SESSION_ABSOLUTE_HOURS * 3600_000);
  await db.transaction(async (t) => {
    await t.insert(sessions).values({ tokenHash: sha256(token), csrfToken, userId: u.id, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) });
    await t.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
    await audit(t, { action: 'LOGIN', entityType: 'USER', entityId: u.id, actorId: u.id, actorLabel: u.email });
  });
  const authUser = await loadAuthUser(u.id);
  return { token, csrfToken, expiresAt, user: authUser! };
}

export async function logout(sessionId: string, userId: string) {
  await db.transaction(async (t) => {
    await t.delete(sessions).where(eq(sessions.id, sessionId));
    await audit(t, { action: 'LOGOUT', entityType: 'USER', entityId: userId });
  });
}

/** Create a single-use token (stored hashed). */
export async function issueToken(userId: string, type: 'INVITE' | 'PASSWORD_RESET', hours: number) {
  const token = randomToken(32);
  await db.update(userTokens).set({ usedAt: new Date() }).where(and(eq(userTokens.userId, userId), eq(userTokens.type, type), isNull(userTokens.usedAt)));
  await db.insert(userTokens).values({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) });
  return token;
}

async function findValidToken(token: string, type: 'INVITE' | 'PASSWORD_RESET') {
  const row = await db.query.userTokens.findFirst({
    where: and(eq(userTokens.tokenHash, sha256(token)), eq(userTokens.type, type), isNull(userTokens.usedAt), gt(userTokens.expiresAt, new Date())),
  });
  if (!row) throw new AppError(400, 'TOKEN_INVALID', 'The link is invalid or has expired');
  return row;
}

export async function requestPasswordReset(identifier: string) {
  const id = identifier.trim().toLowerCase();
  const u = await db.query.users.findFirst({ where: or(eq(sql`lower(${users.email})`, id), eq(sql`lower(${users.username})`, id)) });
  auditAsync({ action: 'PASSWORD_RESET_REQUEST', entityType: 'USER', entityId: u?.id ?? null, result: u ? 'SUCCESS' : 'FAILURE' });
  if (!u || !u.isActive || !u.passwordHash) return { devToken: undefined as string | undefined };
  const token = await issueToken(u.id, 'PASSWORD_RESET', 1);
  // Email delivery is not configured in this release. The link is written to the server log in non-production
  // environments so administrators/testers can complete the flow; see README "Notifications".
  if (!config.isProd) logger.info({ userId: u.id, link: `${config.APP_BASE_URL}/reset-password?token=${token}` }, 'password reset link (dev only)');
  return { devToken: config.EXPOSE_DEV_TOKENS ? token : undefined };
}

export async function resetPassword(token: string, newPassword: string) {
  if (!passwordPolicy(newPassword)) throw badRequest('WEAK_PASSWORD', 'Password must be at least 10 characters and contain letters and digits');
  const row = await findValidToken(token, 'PASSWORD_RESET');
  await db.transaction(async (t) => {
    await t.update(userTokens).set({ usedAt: new Date() }).where(eq(userTokens.id, row.id));
    await t.update(users).set({ passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, row.userId));
    await t.delete(sessions).where(eq(sessions.userId, row.userId)); // revoke all sessions
    await audit(t, { action: 'PASSWORD_RESET', entityType: 'USER', entityId: row.userId, actorId: row.userId });
  });
}

export async function inspectInvite(token: string) {
  const row = await findValidToken(token, 'INVITE');
  const u = await db.query.users.findFirst({ where: eq(users.id, row.userId), with: { contractorCompany: true } });
  return { email: u!.email, displayName: u!.displayName, contractorCompany: u!.contractorCompany?.name ?? null };
}

export async function activateInvite(token: string, newPassword: string) {
  if (!passwordPolicy(newPassword)) throw badRequest('WEAK_PASSWORD', 'Password must be at least 10 characters and contain letters and digits');
  const row = await findValidToken(token, 'INVITE');
  await db.transaction(async (t) => {
    await t.update(userTokens).set({ usedAt: new Date() }).where(eq(userTokens.id, row.id));
    await t.update(users).set({ passwordHash: await hashPassword(newPassword), activatedAt: new Date(), isActive: true }).where(eq(users.id, row.userId));
    await audit(t, { action: 'ACCOUNT_ACTIVATE', entityType: 'USER', entityId: row.userId, actorId: row.userId });
  });
}

export async function changePassword(userId: string, current: string, next: string) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u || !(await verifyPassword(u.passwordHash, current))) throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  if (!passwordPolicy(next)) throw badRequest('WEAK_PASSWORD', 'Password must be at least 10 characters and contain letters and digits');
  await db.transaction(async (t) => {
    await t.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
    await audit(t, { action: 'PASSWORD_CHANGE', entityType: 'USER', entityId: userId });
  });
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}
