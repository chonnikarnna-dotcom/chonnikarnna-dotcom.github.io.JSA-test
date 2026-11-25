/** Minimal server-side labels for generated documents (PDF / exports). UI translations live in the frontend. */
export type Lang = 'th' | 'en';

export const STATUS_LABELS: Record<string, { en: string; th: string }> = {
  DRAFT: { en: 'Draft', th: 'ฉบับร่าง' },
  SUBMITTED: { en: 'Submitted', th: 'ส่งแล้ว' },
  PENDING_AREA_OWNER: { en: 'Pending Area Owner Review', th: 'รอเจ้าของพื้นที่พิจารณา' },
  PENDING_SAFETY_OFFICER: { en: 'Pending Safety Officer Review', th: 'รอเจ้าหน้าที่ความปลอดภัยพิจารณา' },
  RETURNED: { en: 'Returned for Revision', th: 'ส่งกลับให้แก้ไข' },
  REJECTED: { en: 'Rejected', th: 'ไม่อนุมัติ' },
  APPROVED: { en: 'Approved', th: 'อนุมัติแล้ว' },
  CANCELLED: { en: 'Cancelled', th: 'ยกเลิก' },
  EXPIRED: { en: 'Expired', th: 'หมดอายุ' },
  COMPLETED: { en: 'Work Completed', th: 'งานเสร็จสิ้น' },
};
export const DECISION_LABELS: Record<string, { en: string; th: string }> = {
  SUBMITTED: { en: 'Submitted', th: 'ส่งเพื่อพิจารณา' },
  APPROVED: { en: 'Approved', th: 'อนุมัติ' },
  RETURNED: { en: 'Returned for revision', th: 'ส่งกลับให้แก้ไข' },
  REJECTED: { en: 'Rejected', th: 'ไม่อนุมัติ' },
  CANCELLED: { en: 'Cancelled', th: 'ยกเลิก' },
};
export const STAGE_LABELS: Record<string, { en: string; th: string }> = {
  AREA_OWNER: { en: 'Area Owner', th: 'เจ้าของพื้นที่' },
  SAFETY_OFFICER: { en: 'Safety Officer', th: 'เจ้าหน้าที่ความปลอดภัย' },
};

export const PPE_LABELS: Record<string, { en: string; th: string }> = {
  SAFETY_HELMET: { en: 'Safety helmet', th: 'หมวกนิรภัย' }, SAFETY_GLASSES: { en: 'Safety glasses', th: 'แว่นตานิรภัย' },
  FACE_SHIELD: { en: 'Face shield', th: 'กระบังหน้า' }, EAR_PROTECTION: { en: 'Hearing protection', th: 'อุปกรณ์ป้องกันเสียง' },
  GLOVES: { en: 'Gloves', th: 'ถุงมือ' }, SAFETY_SHOES: { en: 'Safety shoes', th: 'รองเท้านิรภัย' },
  HARNESS: { en: 'Full-body harness', th: 'เข็มขัดนิรภัยแบบเต็มตัว' }, RESPIRATOR: { en: 'Respirator', th: 'หน้ากากป้องกันระบบหายใจ' },
  CHEMICAL_SUIT: { en: 'Chemical protective suit', th: 'ชุดป้องกันสารเคมี' }, HI_VIS_VEST: { en: 'High-visibility vest', th: 'เสื้อสะท้อนแสง' },
};
export const ppeLabel = (code: string, lang: Lang) => PPE_LABELS[code]?.[lang] ?? code;

const L = {
  title: { en: 'Job Safety Analysis (JSA)', th: 'การวิเคราะห์งานเพื่อความปลอดภัย (JSA)' },
  reference: { en: 'Reference', th: 'เลขที่อ้างอิง' },
  version: { en: 'Version', th: 'ฉบับที่' },
  status: { en: 'Status', th: 'สถานะ' },
  approvedAt: { en: 'Final approval', th: 'อนุมัติขั้นสุดท้าย' },
  validity: { en: 'Valid', th: 'ช่วงเวลาที่มีผล' },
  generated: { en: 'Generated', th: 'สร้างเมื่อ' },
  page: { en: 'Page', th: 'หน้า' },
  general: { en: 'General Information', th: 'ข้อมูลทั่วไป' },
  jobTitle: { en: 'Job title', th: 'ชื่องาน' },
  scope: { en: 'Scope of work', th: 'ขอบเขตงาน' },
  requester: { en: 'Requester', th: 'ผู้ขอ' },
  requesterType: { en: 'Requester type', th: 'ประเภทผู้ขอ' },
  department: { en: 'Department', th: 'แผนก' },
  contractor: { en: 'Contractor company', th: 'บริษัทผู้รับเหมา' },
  contact: { en: 'Contact', th: 'ติดต่อ' },
  site: { en: 'Factory / Building', th: 'โรงงาน / อาคาร' },
  area: { en: 'Production area', th: 'พื้นที่ผลิต' },
  location: { en: 'Exact location', th: 'ตำแหน่งที่ทำงาน' },
  period: { en: 'Planned work period', th: 'ช่วงเวลาที่วางแผน' },
  workers: { en: 'Number of workers', th: 'จำนวนผู้ปฏิบัติงาน' },
  supervisor: { en: 'Responsible supervisor', th: 'หัวหน้างานผู้รับผิดชอบ' },
  jobType: { en: 'Job type', th: 'ประเภทงาน' },
  emergency: { en: 'Emergency contact', th: 'ผู้ติดต่อกรณีฉุกเฉิน' },
  ppe: { en: 'Required PPE', th: 'อุปกรณ์ป้องกันส่วนบุคคล' },
  permits: { en: 'High-Risk Work & Permit References', th: 'งานเสี่ยงสูงและเอกสารใบอนุญาต' },
  permitRef: { en: 'Permit ref.', th: 'เลขที่ใบอนุญาต' },
  verification: { en: 'Verification', th: 'การตรวจสอบ' },
  steps: { en: 'Job Steps & Hazard Analysis', th: 'ขั้นตอนงานและการวิเคราะห์อันตราย' },
  colStep: { en: '#', th: 'ที่' },
  colActivity: { en: 'Job activity', th: 'ขั้นตอนงาน' },
  colHazard: { en: 'Hazard / Consequence', th: 'อันตราย / ผลกระทบ' },
  colInitial: { en: 'Initial S×L=R', th: 'ความเสี่ยงเริ่มต้น' },
  colControls: { en: 'Existing / Additional controls', th: 'มาตรการควบคุมที่มี / เพิ่มเติม' },
  colOwner: { en: 'Control owner', th: 'ผู้รับผิดชอบ' },
  colResidual: { en: 'Residual S×L=R', th: 'ความเสี่ยงคงเหลือ' },
  declaration: { en: 'Requester Declaration', th: 'คำรับรองของผู้ขอ' },
  approvals: { en: 'Approval History', th: 'ประวัติการอนุมัติ' },
  attachments: { en: 'Supporting documents', th: 'เอกสารประกอบ' },
  matrix: { en: 'Risk matrix', th: 'เมทริกซ์ความเสี่ยง' },
  disclaimer: {
    en: 'An approved JSA is not a work permit. Work may proceed only within the validity period shown and after all required permits, isolations and other safety prerequisites have been completed and verified. All workers must be briefed on this JSA before work begins.',
    th: 'JSA ที่ได้รับอนุมัติไม่ใช่ใบอนุญาตทำงาน การปฏิบัติงานทำได้เฉพาะภายในช่วงเวลาที่มีผลตามที่ระบุ และหลังจากใบอนุญาต การตัดแยกพลังงาน และข้อกำหนดด้านความปลอดภัยอื่นที่จำเป็นได้รับการดำเนินการและตรวจสอบแล้ว ผู้ปฏิบัติงานทุกคนต้องได้รับการชี้แจง JSA นี้ก่อนเริ่มงาน',
  },
  notCurrent: { en: 'NOT CURRENTLY VALID FOR WORK', th: 'ไม่สามารถใช้ปฏิบัติงานได้ในขณะนี้' },
  employee: { en: 'Employee', th: 'พนักงาน' },
  contractorType: { en: 'Contractor', th: 'ผู้รับเหมา' },
  verified: { en: 'Verified by Safety Officer', th: 'ตรวจสอบโดยเจ้าหน้าที่ความปลอดภัยแล้ว' },
  manual: { en: 'Manually referenced — awaiting verification', th: 'อ้างอิงด้วยตนเอง — รอการตรวจสอบ' },
};
export type LabelKey = keyof typeof L;
export const label = (k: LabelKey, lang: Lang) => L[k][lang];
export const statusLabel = (s: string, lang: Lang) => STATUS_LABELS[s]?.[lang] ?? s;

export function formatDateTime(d: Date | string | null | undefined, lang: Lang, timeZone = 'Asia/Bangkok') {
  if (!d) return '—';
  return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
    timeZone, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(d));
}
