import { desc, sql } from 'drizzle-orm';
import { db, DbOrTx } from '../db/client';
import { auditLogs } from '../db/schema';
import { canonicalJson, sha256 } from './crypto';
import { ctx } from './context';
import { logger } from './logger';

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  result?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  actorId?: string | null;
  actorLabel?: string | null;
};

const SENSITIVE = /pass(word)?|token|secret|hash|cookie|csrf/i;
function scrub(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(scrub);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : scrub(val)]));
}

/**
 * Append an audit event. Entries are hash-chained (hash = sha256(prevHash + canonical entry)),
 * serialized with a transaction-scoped advisory lock so the chain is linear.
 * Pass the surrounding transaction so the audit record commits atomically with the change.
 */
export async function audit(tx: DbOrTx, e: AuditInput) {
  const c = ctx();
  const run = async (t: DbOrTx) => {
    await t.execute(sql`SELECT pg_advisory_xact_lock(727274)`);
    const [last] = await t.select({ hash: auditLogs.hash }).from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
    const occurredAt = new Date();
    const entry = {
      occurredAt: occurredAt.toISOString(),
      actorId: e.actorId ?? c?.userId ?? null,
      actorLabel: e.actorLabel ?? c?.userLabel ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      result: e.result ?? 'SUCCESS',
      reason: e.reason ?? null,
      requestId: c?.requestId ?? null,
      ip: c?.ip ?? null,
      metadata: e.metadata ? (scrub(e.metadata) as Record<string, unknown>) : null,
    };
    const prevHash = last?.hash ?? null;
    const hash = sha256((prevHash ?? 'GENESIS') + canonicalJson(entry));
    await t.insert(auditLogs).values({ ...entry, occurredAt, prevHash, hash });
  };
  // When called with the root db (not a tx) we open a short transaction for the advisory lock.
  if ((tx as any) === db) return db.transaction(run);
  return run(tx);
}

/** Fire-and-forget audit for denied/failed events that occur outside a business transaction. */
export function auditAsync(e: AuditInput) {
  audit(db, e).catch((err) => logger.error({ err }, 'audit write failed'));
}

/** Recompute the hash chain and report the first broken link (tamper evidence). */
export async function verifyAuditChain(limit = 100000) {
  const rows = await db.select().from(auditLogs).orderBy(auditLogs.id).limit(limit);
  let prev: string | null = null;
  for (const r of rows) {
    const entry = {
      occurredAt: r.occurredAt.toISOString(), actorId: r.actorId, actorLabel: r.actorLabel, action: r.action,
      entityType: r.entityType, entityId: r.entityId, result: r.result, reason: r.reason, requestId: r.requestId,
      ip: r.ip, metadata: r.metadata ?? null,
    };
    const expected = sha256((prev ?? 'GENESIS') + canonicalJson(entry));
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked: rows.length, brokenAtId: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, brokenAtId: null };
}
