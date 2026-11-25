import crypto from 'crypto';
import argon2 from 'argon2';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');

// Argon2id with OWASP-recommended baseline parameters.
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (pw: string) => argon2.hash(pw, ARGON_OPTS);
export const verifyPassword = async (hash: string | null | undefined, pw: string) => {
  if (!hash) {
    // equalize timing for unknown users
    await argon2.hash(pw, ARGON_OPTS).catch(() => undefined);
    return false;
  }
  try { return await argon2.verify(hash, pw); } catch { return false; }
};

/** Deterministic JSON (sorted keys) for hashing. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const passwordPolicy = (pw: string) =>
  pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
