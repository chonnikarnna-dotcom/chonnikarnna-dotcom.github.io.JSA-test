import { and, eq } from 'drizzle-orm';
import crypto from 'crypto';
import path from 'path';
import { db } from '../db/client';
import { jsaAttachments, jsaPermitReferences, jsaVersions } from '../db/schema';
import { AuthUser } from '../lib/authz';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { audit, auditAsync } from '../lib/audit';
import { getSettings } from './settings';
import { newStorageKey, storage } from './storage';
import { getVisibleJsa, viewableVersions } from './jsa';
import { lockJsa } from './workflow';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileType = require('file-type') as { fromBuffer(b: Buffer): Promise<{ ext: string; mime: string } | undefined> };

export const ATTACHMENT_CATEGORIES = ['PHOTO', 'METHOD_STATEMENT', 'RISK_ASSESSMENT', 'WORK_PERMIT', 'TECHNICAL', 'OTHER'] as const;

const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

/** Validate by extension allow-list, declared MIME and magic bytes (content sniffing). */
export async function validateUpload(file: { originalname: string; mimetype: string; buffer: Buffer; size: number }, allowedExt: string[], maxMb: number) {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ext || !allowedExt.includes(ext) || !MIME_BY_EXT[ext]) throw unprocessable('FILE_TYPE_NOT_ALLOWED', `File type .${ext} is not allowed`, { allowed: allowedExt });
  if (file.size > maxMb * 1024 * 1024) throw unprocessable('FILE_TOO_LARGE', `File exceeds ${maxMb} MB`, { maxMb });
  if (file.size === 0) throw unprocessable('FILE_EMPTY', 'File is empty');
  const sniffed = await FileType.fromBuffer(file.buffer);
  const expected = MIME_BY_EXT[ext];
  if (!sniffed || !expected.includes(sniffed.mime)) throw unprocessable('FILE_CONTENT_MISMATCH', 'File content does not match its extension');
  return { ext, mime: sniffed.mime };
}

export const safeDisplayName = (n: string) => n.replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 200);

export async function uploadAttachment(u: AuthUser, jsaId: string, file: Express.Multer.File | undefined, category: string) {
  if (!file) throw badRequest('FILE_REQUIRED', 'No file uploaded');
  if (!(ATTACHMENT_CATEGORIES as readonly string[]).includes(category)) throw badRequest('INVALID_CATEGORY', 'Invalid attachment category');
  const settings = await getSettings();
  const { mime } = await validateUpload(file, settings.allowedExtensions, settings.attachmentMaxMb);
  const key = newStorageKey();
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  await storage.put(key, file.buffer);
  try {
    return await db.transaction(async (t) => {
      const j = await lockJsa(t, jsaId);
      if (j.requesterId !== u.id) { await getVisibleJsa(u, j.id); throw forbidden('NOT_OWNER', 'Only the requester can add attachments'); }
      const v = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, j.currentVersionId!) });
      if (!v || v.locked) throw conflict('NOT_EDITABLE', 'Attachments can only be added while the JSA is a draft or revision');
      const [a] = await t.insert(jsaAttachments).values({
        jsaId, addedInVersion: v.versionNo, category, originalName: safeDisplayName(file.originalname), storageKey: key,
        mimeType: mime, sizeBytes: file.size, sha256: sha, uploadedById: u.id,
      }).returning();
      await audit(t, { action: 'ATTACHMENT_UPLOAD', entityType: 'JSA', entityId: jsaId, metadata: { attachmentId: a.id, name: a.originalName, size: a.sizeBytes, sha256: sha } });
      return a;
    });
  } catch (e) {
    await storage.remove(key).catch(() => undefined);
    throw e;
  }
}

/** Authorize access to a stored attachment: JSA must be visible and the attachment must belong to a viewable version. */
export async function authorizeAttachment(u: AuthUser, attachmentId: string) {
  const a = await db.query.jsaAttachments.findFirst({ where: eq(jsaAttachments.id, attachmentId) });
  if (!a) throw notFound('Attachment');
  let jsa;
  try { jsa = await getVisibleJsa(u, a.jsaId); } catch {
    auditAsync({ action: 'ATTACHMENT_DOWNLOAD', entityType: 'ATTACHMENT', entityId: attachmentId, result: 'DENIED' });
    throw notFound('Attachment');
  }
  const versions = await viewableVersions(u, jsa);
  const maxViewable = Math.max(0, ...versions.map((v) => v.versionNo));
  if (a.addedInVersion > maxViewable) {
    auditAsync({ action: 'ATTACHMENT_DOWNLOAD', entityType: 'ATTACHMENT', entityId: attachmentId, result: 'DENIED', reason: 'version not viewable' });
    throw notFound('Attachment');
  }
  return a;
}

export async function removeAttachment(u: AuthUser, attachmentId: string) {
  const a = await db.query.jsaAttachments.findFirst({ where: eq(jsaAttachments.id, attachmentId) });
  if (!a) throw notFound('Attachment');
  const res = await db.transaction(async (t) => {
    const j = await lockJsa(t, a.jsaId);
    if (j.requesterId !== u.id) { await getVisibleJsa(u, j.id); throw forbidden('NOT_OWNER', 'Only the requester can remove attachments'); }
    const v = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, j.currentVersionId!) });
    if (!v || v.locked) throw conflict('NOT_EDITABLE', 'Attachments can only be removed from a draft');
    if (a.removedInVersion != null) throw conflict('ALREADY_REMOVED', 'Attachment already removed');
    let hardDelete = false;
    if (a.addedInVersion === v.versionNo) {
      // never part of a submitted version → can be physically deleted
      await t.update(jsaPermitReferences).set({ attachmentId: null }).where(and(eq(jsaPermitReferences.attachmentId, a.id), eq(jsaPermitReferences.versionId, v.id)));
      await t.delete(jsaAttachments).where(and(eq(jsaAttachments.id, a.id)));
      hardDelete = true;
    } else {
      await t.update(jsaAttachments).set({ removedInVersion: v.versionNo }).where(eq(jsaAttachments.id, a.id));
    }
    await audit(t, { action: 'ATTACHMENT_REMOVE', entityType: 'JSA', entityId: a.jsaId, metadata: { attachmentId: a.id, name: a.originalName, hardDelete, versionNo: v.versionNo } });
    return hardDelete;
  });
  if (res) await storage.remove(a.storageKey).catch(() => undefined);
}
