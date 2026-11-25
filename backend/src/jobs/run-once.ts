import { runExpiryJob } from './scheduler';
import { pool } from '../db/client';

runExpiryJob().then((r) => { console.log(r); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
