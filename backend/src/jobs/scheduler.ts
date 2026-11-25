import { and, eq, gte, isNull, lt, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { jsas } from '../db/schema';
import { audit } from '../lib/audit';
import { logger } from '../lib/logger';
import { notify } from '../services/notifications';
import { getValiditySettings } from '../services/settings';
import { recordStatus } from '../services/workflow';

/** Mark approved JSAs whose validity ended as EXPIRED, and send expiry reminders. Idempotent. */
export async function runExpiryJob(now = new Date()) {
  const settings = await getValiditySettings();
  let expired = 0; let reminded = 0;
  const due = await db.select().from(jsas).where(and(eq(jsas.status, 'APPROVED'), lt(jsas.validUntil, now), isNull(jsas.deletedAt)));
  for (const j of due) {
    await db.transaction(async (t) => {
      const res = await t.update(jsas).set({ status: 'EXPIRED', rowVersion: j.rowVersion + 1, updatedAt: now })
        .where(and(eq(jsas.id, j.id), eq(jsas.status, 'APPROVED'))).returning({ id: jsas.id });
      if (!res.length) return;
      await recordStatus(t, j.id, 'APPROVED', 'EXPIRED', j.currentVersionNo, null, 'Validity period ended');
      await notify(t, [j.requesterId], 'JSA_EXPIRED', j.id, { ref: j.referenceNo, title: j.jobTitle });
      await audit(t, { action: 'JSA_EXPIRE', entityType: 'JSA', entityId: j.id, actorLabel: 'system', metadata: { validUntil: j.validUntil } });
      expired++;
    });
  }
  const horizon = new Date(now.getTime() + settings.expiryReminderHours * 3600_000);
  const soon = await db.select().from(jsas).where(and(eq(jsas.status, 'APPROVED'), gte(jsas.validUntil, now), lte(jsas.validUntil, horizon), isNull(jsas.expiryReminderSentAt), isNull(jsas.deletedAt)));
  for (const j of soon) {
    await db.transaction(async (t) => {
      const res = await t.update(jsas).set({ expiryReminderSentAt: now }).where(and(eq(jsas.id, j.id), isNull(jsas.expiryReminderSentAt))).returning({ id: jsas.id });
      if (!res.length) return;
      await notify(t, [j.requesterId], 'JSA_EXPIRING', j.id, { ref: j.referenceNo, title: j.jobTitle, validUntil: j.validUntil!.toISOString() });
      reminded++;
    });
  }
  if (expired || reminded) logger.info({ expired, reminded }, 'expiry job');
  return { expired, reminded };
}

let timer: NodeJS.Timeout | null = null;
export function startScheduler(intervalMinutes: number) {
  const tick = () => runExpiryJob().catch((err) => logger.error({ err }, 'expiry job failed'));
  setTimeout(tick, 5_000);
  timer = setInterval(tick, intervalMinutes * 60_000);
  timer.unref();
}
export const stopScheduler = () => { if (timer) clearInterval(timer); };
