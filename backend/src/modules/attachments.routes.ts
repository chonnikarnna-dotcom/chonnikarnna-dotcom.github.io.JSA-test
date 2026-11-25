import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { asyncH, requireAuth } from '../middleware/core';
import { authorizeAttachment, removeAttachment } from '../services/attachments';
import { storage } from '../services/storage';
import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

attachmentsRouter.get('/:id/download', asyncH(async (req, res) => {
  const a = await authorizeAttachment(req.user!, z.string().uuid().parse(req.params.id));
  if (!(await storage.exists(a.storageKey))) throw notFound('File');
  const inline = req.query.inline === '1' && /^(image\/(png|jpeg)|application\/pdf)$/.test(a.mimeType);
  await audit(db, { action: 'ATTACHMENT_DOWNLOAD', entityType: 'JSA', entityId: a.jsaId, metadata: { attachmentId: a.id } });
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Content-Length', String(a.sizeBytes));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${a.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(a.originalName)}`);
  storage.stream(a.storageKey).on('error', () => res.destroy()).pipe(res);
}));

attachmentsRouter.delete('/:id', asyncH(async (req, res) => {
  await removeAttachment(req.user!, z.string().uuid().parse(req.params.id));
  res.status(204).end();
}));
