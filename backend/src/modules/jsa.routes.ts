import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { asyncH, requireAuth, requireRole } from '../middleware/core';
import * as jsa from '../services/jsa';
import { draftInputSchema } from '../services/jsa-content';
import { uploadAttachment } from '../services/attachments';
import { storage } from '../services/storage';
import { renderJsaPdf } from '../services/pdf';
import { getSettings } from '../services/settings';
import { sendExport } from '../services/export';
import { statusLabel, formatDateTime, Lang } from '../lib/i18n';
import { db } from '../db/client';
import { permitTypes, reportExportLogs } from '../db/schema';
import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';
import { config } from '../config';

export const jsaRouter = Router();
jsaRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
const idParam = (v: string) => z.string().uuid().parse(v);
const langOf = (req: { query: Record<string, unknown>; user?: { preferredLanguage: string } }): Lang =>
  (req.query.lang === 'en' || req.query.lang === 'th' ? req.query.lang : req.user?.preferredLanguage === 'en' ? 'en' : 'th') as Lang;

jsaRouter.get('/', asyncH(async (req, res) => {
  res.json(await jsa.listJsas(req.user!, jsa.listQuerySchema.parse(req.query)));
}));

jsaRouter.get('/export', asyncH(async (req, res) => {
  const q = jsa.listQuerySchema.parse(req.query);
  const format = z.enum(['csv', 'xlsx']).default('xlsx').parse(req.query.format);
  const lang = langOf(req);
  const settings = await getSettings();
  const { items } = await jsa.listJsas(req.user!, q, { limitOverride: 10000 });
  const th = lang === 'th';
  const cols = [
    { key: 'referenceNo', header: th ? 'เลขที่ JSA' : 'JSA Reference', width: 18 }, { key: 'version', header: th ? 'ฉบับ' : 'Version', width: 8 },
    { key: 'jobTitle', header: th ? 'ชื่องาน' : 'Job Title', width: 40 }, { key: 'requesterName', header: th ? 'ผู้ขอ' : 'Requester', width: 24 },
    { key: 'org', header: th ? 'แผนก / ผู้รับเหมา' : 'Department / Contractor', width: 28 }, { key: 'area', header: th ? 'พื้นที่' : 'Factory Area', width: 26 },
    { key: 'jobType', header: th ? 'ประเภทงาน' : 'Job Type', width: 22 }, { key: 'plannedStart', header: th ? 'เริ่ม' : 'Planned Start', width: 20 },
    { key: 'plannedEnd', header: th ? 'สิ้นสุด' : 'Planned End', width: 20 }, { key: 'riskLevelCode', header: th ? 'ระดับความเสี่ยง' : 'Risk Level', width: 14 },
    { key: 'status', header: th ? 'สถานะ' : 'Status', width: 26 }, { key: 'currentReviewerName', header: th ? 'ผู้พิจารณาปัจจุบัน' : 'Current Reviewer', width: 22 },
    { key: 'updatedAt', header: th ? 'ปรับปรุงล่าสุด' : 'Last Updated', width: 20 },
  ];
  const rows = items.map((r) => ({
    ...r, org: r.contractorName ?? (th ? r.departmentNameTh : r.departmentNameEn) ?? '', area: th ? r.areaNameTh : r.areaNameEn,
    jobType: th ? r.jobTypeNameTh : r.jobTypeNameEn, status: statusLabel(r.status, lang),
    plannedStart: formatDateTime(r.plannedStart, lang, settings.timezone), plannedEnd: formatDateTime(r.plannedEnd, lang, settings.timezone),
    updatedAt: formatDateTime(r.updatedAt, lang, settings.timezone),
  }));
  await db.insert(reportExportLogs).values({ userId: req.user!.id, reportType: 'JSA_REGISTER', format, filters: q, rowCount: rows.length });
  await audit(db, { action: 'EXPORT', entityType: 'REPORT', entityId: 'JSA_REGISTER', metadata: { format, rows: rows.length, filters: q } });
  await sendExport(res, format, `jsa-register-${new Date().toISOString().slice(0, 10)}`, 'JSA Register', cols, rows);
}));

jsaRouter.post('/', requireRole('REQUESTER'), asyncH(async (req, res) => {
  res.status(201).json(await jsa.createDraft(req.user!, draftInputSchema.parse(req.body)));
}));

jsaRouter.get('/:id', asyncH(async (req, res) => {
  const versionNo = req.query.version ? z.coerce.number().int().min(1).parse(req.query.version) : undefined;
  res.json(await jsa.getDetail(req.user!, idParam(req.params.id), versionNo));
}));

jsaRouter.put('/:id', asyncH(async (req, res) => {
  const { expectedRowVersion, ...rest } = req.body ?? {};
  res.json(await jsa.updateDraft(req.user!, idParam(req.params.id), draftInputSchema.parse(rest), expectedRowVersion === undefined ? undefined : z.number().int().parse(expectedRowVersion)));
}));

jsaRouter.delete('/:id', asyncH(async (req, res) => {
  await jsa.deleteDraft(req.user!, idParam(req.params.id));
  res.status(204).end();
}));

jsaRouter.post('/:id/submit', asyncH(async (req, res) => {
  res.json(await jsa.submit(req.user!, idParam(req.params.id), jsa.submitSchema.parse(req.body)));
}));

jsaRouter.post('/:id/revisions', asyncH(async (req, res) => {
  const body = z.object({ reason: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
  res.status(201).json(await jsa.createRevision(req.user!, idParam(req.params.id), body.reason || null));
}));

jsaRouter.delete('/:id/revisions/current', asyncH(async (req, res) => {
  const r = await jsa.discardRevision(req.user!, idParam(req.params.id));
  for (const k of r.storageKeys) await storage.remove(k).catch(() => undefined);
  res.status(204).end();
}));

jsaRouter.post('/:id/cancel', asyncH(async (req, res) => {
  const body = z.object({ reason: z.string().trim().max(1000) }).parse(req.body);
  res.json(await jsa.cancel(req.user!, idParam(req.params.id), body.reason));
}));

jsaRouter.post('/:id/complete', asyncH(async (req, res) => {
  const body = z.object({ note: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
  res.json(await jsa.complete(req.user!, idParam(req.params.id), body.note || null));
}));

jsaRouter.post('/:id/copy', requireRole('REQUESTER'), asyncH(async (req, res) => {
  res.status(201).json(await jsa.copyAsNew(req.user!, idParam(req.params.id)));
}));

jsaRouter.post('/:id/attachments', upload.single('file'), asyncH(async (req, res) => {
  const category = z.string().default('OTHER').parse(req.body?.category ?? 'OTHER');
  const a = await uploadAttachment(req.user!, idParam(req.params.id), req.file, category);
  res.status(201).json({ id: a.id, originalName: a.originalName, category: a.category, mimeType: a.mimeType, sizeBytes: a.sizeBytes, uploadedAt: a.uploadedAt, addedInVersion: a.addedInVersion });
}));

/** PDF of the approved version (or a specific approved/locked version for authorized viewers). */
jsaRouter.get('/:id/pdf', asyncH(async (req, res) => {
  const lang = langOf(req);
  const head = await jsa.getVisibleJsa(req.user!, idParam(req.params.id));
  if (!head.approvedVersionId) throw notFound('Approved version');
  const versions = await jsa.viewableVersions(req.user!, head);
  const approved = versions.find((v) => v.id === head.approvedVersionId);
  if (!approved) throw notFound('Approved version');
  const detail = await jsa.getDetail(req.user!, head.id, approved.versionNo);
  const settings = await getSettings();
  const pts = detail.content.permits.length ? await db.select().from(permitTypes).where(inArray(permitTypes.id, detail.content.permits.map((p) => p.permitTypeId))) : [];
  const doc = renderJsaPdf(detail, lang, settings.timezone, { permitTypes: Object.fromEntries(pts.map((p) => [p.id, p])) });
  await audit(db, { action: 'PDF_EXPORT', entityType: 'JSA', entityId: head.id, metadata: { versionNo: approved.versionNo, lang } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${head.referenceNo}-v${approved.versionNo}.pdf"`);
  doc.pipe(res);
}));

export { eq };
