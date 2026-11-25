import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { reportExportLogs } from '../db/schema';
import { asyncH, requireAuth } from '../middleware/core';
import { getDashboard, getReports } from '../services/reports';
import { Column, sendExport } from '../services/export';
import { audit } from '../lib/audit';
import { formatDateTime, statusLabel, DECISION_LABELS, STAGE_LABELS, Lang } from '../lib/i18n';
import { getSettings } from '../services/settings';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get('/dashboard', asyncH(async (req, res) => { res.json(await getDashboard(req.user!)); }));

const rangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
const parseRange = (q: unknown) => {
  const r = rangeSchema.parse(q);
  const to = r.to ? new Date(r.to) : new Date();
  const from = r.from ? new Date(r.from) : new Date(to.getTime() - 180 * 86_400_000);
  return { from, to };
};

reportsRouter.get('/summary', asyncH(async (req, res) => { res.json(await getReports(req.user!, parseRange(req.query))); }));

const REPORT_TYPES = ['trends', 'turnaround', 'pending', 'department', 'contractor', 'area', 'jobType', 'risk', 'rejectedReturned', 'expiry', 'completed'] as const;

reportsRouter.get('/export', asyncH(async (req, res) => {
  const range = parseRange(req.query);
  const type = z.enum(REPORT_TYPES).parse(req.query.type);
  const format = z.enum(['csv', 'xlsx']).default('xlsx').parse(req.query.format);
  const lang: Lang = req.query.lang === 'en' ? 'en' : 'th';
  const th = lang === 'th';
  const tz = (await getSettings()).timezone;
  const dt = (d: unknown) => formatDateTime(d as Date, lang, tz);
  const r = await getReports(req.user!, range);
  let cols: Column[] = []; let rows: Record<string, unknown>[] = [];
  const nm = (x: { nameEn?: string | null; nameTh?: string | null }) => (th ? x.nameTh : x.nameEn);
  switch (type) {
    case 'trends': cols = [{ key: 'month', header: th ? 'เดือน' : 'Month' }, { key: 'submitted', header: th ? 'ส่ง' : 'Submitted' }, { key: 'approved', header: th ? 'อนุมัติ' : 'Approved' }, { key: 'rejected', header: th ? 'ไม่อนุมัติ' : 'Rejected' }, { key: 'cancelled', header: th ? 'ยกเลิก' : 'Cancelled' }]; rows = r.trends; break;
    case 'turnaround': cols = [{ key: 'stage', header: th ? 'ขั้นตอน' : 'Stage' }, { key: 'n', header: 'N' }, { key: 'avgHours', header: th ? 'เฉลี่ย (ชม.)' : 'Avg hours' }, { key: 'medianHours', header: th ? 'มัธยฐาน (ชม.)' : 'Median hours' }, { key: 'maxHours', header: th ? 'สูงสุด (ชม.)' : 'Max hours' }]; rows = r.turnaround.byStage.map((x) => ({ ...x, stage: STAGE_LABELS[x.stage][lang] })); break;
    case 'pending': cols = [{ key: 'stage', header: th ? 'ขั้นตอน' : 'Stage' }, { key: 'n', header: th ? 'รอดำเนินการ' : 'Pending' }, { key: 'overdue', header: th ? 'เกินกำหนด' : 'Overdue' }]; rows = r.pendingByRole.map((x) => ({ ...x, stage: STAGE_LABELS[x.stage][lang] })); break;
    case 'department': cols = [{ key: 'name', header: th ? 'แผนก' : 'Department', width: 40 }, { key: 'n', header: 'JSA' }]; rows = r.byDepartment.map((x) => ({ name: nm(x), n: x.n })); break;
    case 'contractor': cols = [{ key: 'name', header: th ? 'ผู้รับเหมา' : 'Contractor', width: 40 }, { key: 'n', header: 'JSA' }]; rows = r.byContractor; break;
    case 'area': cols = [{ key: 'siteEn', header: th ? 'โรงงาน' : 'Site' }, { key: 'name', header: th ? 'พื้นที่' : 'Area', width: 40 }, { key: 'n', header: 'JSA' }]; rows = r.byArea.map((x) => ({ ...x, name: nm(x) })); break;
    case 'jobType': cols = [{ key: 'name', header: th ? 'ประเภทงาน' : 'Job type', width: 40 }, { key: 'n', header: 'JSA' }]; rows = r.byJobType.map((x) => ({ name: nm(x), n: x.n })); break;
    case 'risk': cols = [{ key: 'phase', header: th ? 'ระยะ' : 'Phase' }, { key: 'levelCode', header: th ? 'ระดับ' : 'Level' }, { key: 'n', header: 'JSA' }]; rows = [...r.risk.initial.map((x) => ({ ...x, phase: th ? 'เริ่มต้น' : 'Initial' })), ...r.risk.residual.map((x) => ({ ...x, phase: th ? 'คงเหลือ' : 'Residual' }))]; break;
    case 'rejectedReturned': cols = [{ key: 'referenceNo', header: 'JSA' }, { key: 'jobTitle', header: th ? 'ชื่องาน' : 'Job title', width: 40 }, { key: 'versionNo', header: 'v' }, { key: 'stage', header: th ? 'ขั้นตอน' : 'Stage' }, { key: 'decision', header: th ? 'ผล' : 'Decision' }, { key: 'actorName', header: th ? 'ผู้พิจารณา' : 'Reviewer' }, { key: 'comment', header: th ? 'ความเห็น' : 'Comment', width: 60 }, { key: 'createdAt', header: th ? 'วันที่' : 'Date' }];
      rows = r.rejectedReturned.map((x) => ({ ...x, stage: x.stage ? STAGE_LABELS[x.stage][lang] : '', decision: DECISION_LABELS[x.decision][lang], createdAt: dt(x.createdAt) })); break;
    case 'expiry': cols = [{ key: 'referenceNo', header: 'JSA' }, { key: 'jobTitle', header: th ? 'ชื่องาน' : 'Job title', width: 40 }, { key: 'status', header: th ? 'สถานะ' : 'Status' }, { key: 'validUntil', header: th ? 'มีผลถึง' : 'Valid until' }, { key: 'area', header: th ? 'พื้นที่' : 'Area' }, { key: 'requesterName', header: th ? 'ผู้ขอ' : 'Requester' }];
      rows = r.expiry.map((x) => ({ ...x, status: statusLabel(x.status, lang), validUntil: dt(x.validUntil), area: th ? x.areaNameTh : x.areaNameEn })); break;
    case 'completed': cols = [{ key: 'referenceNo', header: 'JSA' }, { key: 'jobTitle', header: th ? 'ชื่องาน' : 'Job title', width: 40 }, { key: 'completedAt', header: th ? 'เสร็จเมื่อ' : 'Completed at' }, { key: 'area', header: th ? 'พื้นที่' : 'Area' }, { key: 'requesterName', header: th ? 'ผู้ขอ' : 'Requester' }, { key: 'completionNote', header: th ? 'หมายเหตุ' : 'Note', width: 40 }];
      rows = r.completed.map((x) => ({ ...x, completedAt: dt(x.completedAt), area: th ? x.areaNameTh : x.areaNameEn })); break;
  }
  await db.insert(reportExportLogs).values({ userId: req.user!.id, reportType: type, format, filters: range, rowCount: rows.length });
  await audit(db, { action: 'EXPORT', entityType: 'REPORT', entityId: type, metadata: { format, rows: rows.length } });
  await sendExport(res, format, `jsa-report-${type}-${new Date().toISOString().slice(0, 10)}`, type, cols, rows);
}));
