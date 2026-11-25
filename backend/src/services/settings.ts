import { eq } from 'drizzle-orm';
import { db, DbOrTx } from '../db/client';
import { jsaValiditySettings, systemSettings } from '../db/schema';

export type SystemSettingsMap = {
  defaultLanguage: 'th' | 'en';
  timezone: string;
  attachmentMaxMb: number;
  allowedExtensions: string[];
  enforceValidatedRiskMatrix: boolean;
  declarationVersion: string;
  declarationTextEn: string;
  declarationTextTh: string;
  ppeOptions: string[];
  dashboardExpiringSoonHours: number;
  overdueReviewHours: number;
};

export const DEFAULT_SETTINGS: SystemSettingsMap = {
  defaultLanguage: 'th',
  timezone: 'Asia/Bangkok',
  attachmentMaxMb: 10,
  allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'],
  enforceValidatedRiskMatrix: false,
  declarationVersion: 'DECL-1.0',
  declarationTextEn: 'I confirm that the job steps, hazards, and control measures have been reviewed and that the information provided is accurate. All workers involved must be briefed on the approved JSA before work begins.',
  declarationTextTh: 'ข้าพเจ้าขอยืนยันว่าได้ทบทวนขั้นตอนการทำงาน อันตราย และมาตรการควบคุมแล้ว และข้อมูลที่ให้ไว้ถูกต้อง ผู้ปฏิบัติงานทุกคนที่เกี่ยวข้องต้องได้รับการชี้แจง JSA ที่ได้รับการอนุมัติก่อนเริ่มงาน',
  ppeOptions: ['SAFETY_HELMET', 'SAFETY_GLASSES', 'FACE_SHIELD', 'EAR_PROTECTION', 'GLOVES', 'SAFETY_SHOES', 'HARNESS', 'RESPIRATOR', 'CHEMICAL_SUIT', 'HI_VIS_VEST'],
  dashboardExpiringSoonHours: 48,
  overdueReviewHours: 24,
};

export async function getSettings(t: DbOrTx = db): Promise<SystemSettingsMap> {
  const rows = await t.select().from(systemSettings);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as SystemSettingsMap;
}

export async function getValiditySettings(t: DbOrTx = db) {
  const [row] = await t.select().from(jsaValiditySettings).limit(1);
  if (row) return row;
  const [created] = await t.insert(jsaValiditySettings).values({}).returning();
  return created;
}

/** Calculate validity window for an approved JSA according to configured rules. */
export function calculateValidity(
  s: { mode: string; durationHours: number },
  plannedStart: Date, plannedEnd: Date, approvedAt: Date,
) {
  const validFrom = plannedStart > approvedAt ? plannedStart : approvedAt;
  let validUntil = plannedEnd;
  if (s.mode === 'FIXED_DURATION') {
    const capped = new Date(validFrom.getTime() + s.durationHours * 3600_000);
    validUntil = capped < plannedEnd ? capped : plannedEnd;
  }
  return { validFrom, validUntil };
}

export async function setSetting(key: string, value: unknown, userId: string, t: DbOrTx = db) {
  await t.insert(systemSettings).values({ key, value, updatedById: userId })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedById: userId, updatedAt: new Date() } });
}
export { eq };
