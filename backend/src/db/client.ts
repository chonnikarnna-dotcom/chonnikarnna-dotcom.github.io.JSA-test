import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, types } from 'pg';
import { config } from '../config';
import * as schema from './schema';

// Return int8 (counts) as JS numbers.
types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 15 });
export const db = drizzle(pool, { schema });
export type DB = NodePgDatabase<typeof schema>;
/** Transaction handle type (same query API as db). */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;
export { schema };
