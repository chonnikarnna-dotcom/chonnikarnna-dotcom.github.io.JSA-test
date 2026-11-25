import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';

/**
 * Storage abstraction for private documents. Only the local private-disk driver is implemented;
 * an S3-compatible driver can implement the same interface (see README → "Object storage").
 * Files are stored under generated keys (no user-controlled path segments) outside any public web root.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  stream(key: string): fs.ReadStream;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class LocalDiskStorage implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!/^[a-z0-9/-]+$/i.test(key) || key.includes('..')) throw new Error('invalid storage key');
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fsp.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await fsp.writeFile(p, data, { mode: 0o600, flag: 'wx' });
  }
  stream(key: string) { return fs.createReadStream(this.resolve(key)); }
  async remove(key: string) { await fsp.rm(this.resolve(key), { force: true }); }
  async exists(key: string) { try { await fsp.access(this.resolve(key)); return true; } catch { return false; } }
}

export const storage: StorageDriver = new LocalDiskStorage(path.resolve(config.STORAGE_DIR));

export function newStorageKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}`;
}
