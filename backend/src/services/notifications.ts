import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, DbOrTx } from '../db/client';
import { notifications, notificationTemplates, users } from '../db/schema';
import { logger } from '../lib/logger';

export const NOTIFICATION_TYPES = [
  'JSA_SUBMITTED', 'REVIEW_REQUIRED_AREA_OWNER', 'REVIEW_REQUIRED_SAFETY_OFFICER', 'AREA_OWNER_APPROVED',
  'JSA_APPROVED', 'REVISION_REQUESTED', 'JSA_REJECTED', 'JSA_EXPIRING', 'JSA_EXPIRED', 'JSA_CANCELLED', 'WORK_COMPLETED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Channel abstraction. IN_APP is always on (database-backed).
 * External channels (email, Microsoft Teams) can be registered here; none are implemented in this release.
 */
export interface NotificationChannel {
  code: string;
  send(input: { recipientIds: string[]; type: NotificationType; jsaId?: string; params: Record<string, string> }): Promise<void>;
}
const externalChannels: NotificationChannel[] = [];
export const registerChannel = (c: NotificationChannel) => externalChannels.push(c);

export async function notify(
  t: DbOrTx,
  recipientIds: (string | null | undefined)[],
  type: NotificationType,
  jsaId: string | undefined,
  params: Record<string, string>,
) {
  const ids = [...new Set(recipientIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await t.insert(notifications).values(ids.map((recipientId) => ({ recipientId, type, jsaId, params })));
  for (const ch of externalChannels) {
    // External delivery is best-effort and must never break the business transaction.
    ch.send({ recipientIds: ids, type, jsaId, params }).catch((err) => logger.error({ err, channel: ch.code }, 'notification channel failed'));
  }
}

export function renderTemplate(tpl: string, params: Record<string, string>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] ?? '').toString());
}

export async function listNotifications(userId: string, lang: string, opts: { unreadOnly?: boolean; limit?: number; offset?: number }) {
  const where = opts.unreadOnly ? and(eq(notifications.recipientId, userId), isNull(notifications.readAt)) : eq(notifications.recipientId, userId);
  const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(opts.limit ?? 30).offset(opts.offset ?? 0);
  const types = [...new Set(rows.map((r) => r.type))];
  const tpls = types.length
    ? await db.select().from(notificationTemplates).where(and(inArray(notificationTemplates.type, types), eq(notificationTemplates.channel, 'IN_APP')))
    : [];
  const pick = (type: string) => tpls.find((x) => x.type === type && x.language === lang) ?? tpls.find((x) => x.type === type);
  const [{ unread }] = await db.select({ unread: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
  return {
    unread,
    items: rows.map((r) => {
      const tpl = pick(r.type);
      return {
        id: r.id, type: r.type, jsaId: r.jsaId, params: r.params, readAt: r.readAt, createdAt: r.createdAt,
        title: tpl ? renderTemplate(tpl.title, r.params) : r.type,
        body: tpl ? renderTemplate(tpl.body, r.params) : '',
        link: r.jsaId ? `/jsa/${r.jsaId}` : null,
      };
    }),
  };
}

export async function markRead(userId: string, ids: string[] | 'ALL') {
  const base = and(eq(notifications.recipientId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() })
    .where(ids === 'ALL' ? base : and(base, inArray(notifications.id, ids)));
}

export { users };
