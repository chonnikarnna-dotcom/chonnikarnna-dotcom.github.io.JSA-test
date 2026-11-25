import { sql } from 'drizzle-orm';
import { DbOrTx } from '../db/client';

/**
 * Generates a unique, human-readable JSA reference (JSA-YYYY-NNNNN) using an atomic
 * INSERT … ON CONFLICT DO UPDATE … RETURNING on a per-year counter row. Safe under concurrency:
 * the row lock serializes concurrent increments and each caller receives a distinct value.
 */
export async function nextReferenceNo(t: DbOrTx, now = new Date(), timeZone = 'Asia/Bangkok') {
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(now));
  const res = await t.execute<{ last_value: number }>(sql`
    INSERT INTO jsa_reference_counters (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = jsa_reference_counters.last_value + 1
    RETURNING last_value`);
  const n = Number(res.rows[0].last_value);
  return formatReference(year, n);
}

export const formatReference = (year: number, n: number) => `JSA-${year}-${String(n).padStart(5, '0')}`;
