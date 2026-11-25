/**
 * Idempotent seed: roles/permissions, workflow, master data, notification templates, a PROVISIONAL risk matrix,
 * and (outside production) demo users. Run: npm run db:seed   (SEED_DEMO_DATA=true also creates sample JSAs)
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from './client';
import * as s from './schema';
import { hashPassword } from '../lib/crypto';
import { config } from '../config';
import { DEFAULT_SETTINGS } from '../services/settings';

export const DEMO_PASSWORD = 'Passw0rd!2026';

const ROLES = [
  { code: 'REQUESTER', nameEn: 'Requester', nameTh: 'ผู้ขอ' },
  { code: 'AREA_OWNER', nameEn: 'Area Owner', nameTh: 'เจ้าของพื้นที่' },
  { code: 'SAFETY_OFFICER', nameEn: 'Safety Officer', nameTh: 'เจ้าหน้าที่ความปลอดภัย' },
  { code: 'ADMIN', nameEn: 'System Administrator', nameTh: 'ผู้ดูแลระบบ' },
];
const PERMS: [string, string, string[]][] = [
  ['jsa.create', 'Create and edit own JSA drafts', ['REQUESTER']],
  ['jsa.submit', 'Submit own JSA for review', ['REQUESTER']],
  ['jsa.cancel', 'Cancel own JSA', ['REQUESTER']],
  ['jsa.complete', 'Confirm work completion', ['REQUESTER', 'AREA_OWNER']],
  ['jsa.view.own', 'View own JSAs', ['REQUESTER']],
  ['jsa.view.area', 'View JSAs in assigned areas', ['AREA_OWNER']],
  ['jsa.view.site', 'View JSAs in safety scope', ['SAFETY_OFFICER']],
  ['jsa.view.all', 'View all JSAs (read-only)', ['ADMIN']],
  ['approval.area_owner', 'Approve / return / reject at Area Owner stage (assigned areas)', ['AREA_OWNER']],
  ['approval.safety_officer', 'Approve / return / reject at Safety Officer stage (scope)', ['SAFETY_OFFICER']],
  ['audit.view.jsa', 'View JSA audit events', ['SAFETY_OFFICER', 'ADMIN']],
  ['audit.view.all', 'View all audit events', ['ADMIN']],
  ['admin.users', 'Manage users, roles and assignments', ['ADMIN']],
  ['admin.master_data', 'Manage master data', ['ADMIN']],
  ['admin.risk_matrix', 'Configure risk matrix and acceptance rules', ['ADMIN']],
  ['admin.settings', 'Configure validity, notification and system settings', ['ADMIN']],
  ['reports.view', 'View dashboards and reports within record scope', ['REQUESTER', 'AREA_OWNER', 'SAFETY_OFFICER', 'ADMIN']],
];

const DEPARTMENTS = [
  ['PROD', 'Production', 'ฝ่ายผลิต'], ['MAINT', 'Maintenance', 'ฝ่ายซ่อมบำรุง'], ['ENG', 'Engineering', 'ฝ่ายวิศวกรรม'],
  ['QA', 'Quality Assurance', 'ฝ่ายประกันคุณภาพ'], ['WH', 'Warehouse & Logistics', 'ฝ่ายคลังสินค้าและโลจิสติกส์'],
  ['UTIL', 'Utilities', 'ฝ่ายสาธารณูปโภค'], ['EHS', 'Safety, Health & Environment', 'ฝ่ายความปลอดภัย อาชีวอนามัยและสิ่งแวดล้อม'],
];
const CONTRACTORS = [
  ['CTR-001', 'Siam Industrial Services Co., Ltd.', 'Khun Prasert', '02-000-0001'],
  ['CTR-002', 'Thai Electrical Engineering Co., Ltd.', 'Khun Wichai', '02-000-0002'],
];
const SITES = [['PLANT-A', 'Plant A — Beverage Production', 'โรงงาน A — ผลิตเครื่องดื่ม'], ['PLANT-B', 'Plant B — Packaging & Warehouse', 'โรงงาน B — บรรจุภัณฑ์และคลังสินค้า']];
const AREAS: [string, string, string, string, string][] = [
  ['PLANT-A', 'A-BTL1', 'Bottling Line 1', 'ไลน์บรรจุขวด 1', 'Building 1'],
  ['PLANT-A', 'A-BTL2', 'Bottling Line 2', 'ไลน์บรรจุขวด 2', 'Building 1'],
  ['PLANT-A', 'A-SYRUP', 'Syrup Room', 'ห้องผสมน้ำเชื่อม', 'Building 2'],
  ['PLANT-A', 'A-BOILER', 'Boiler House', 'อาคารหม้อไอน้ำ', 'Utility Building'],
  ['PLANT-A', 'A-CHEM', 'Chemical Store (CIP)', 'ห้องเก็บสารเคมี (CIP)', 'Building 2'],
  ['PLANT-A', 'A-ROOF', 'Production Roof', 'หลังคาอาคารผลิต', 'Building 1'],
  ['PLANT-B', 'B-WH', 'Finished Goods Warehouse', 'คลังสินค้าสำเร็จรูป', 'Warehouse 1'],
  ['PLANT-B', 'B-WWT', 'Wastewater Treatment', 'ระบบบำบัดน้ำเสีย', 'Outdoor'],
];
const JOB_TYPES: [string, string, string, string[]][] = [
  ['MAINT_MECH', 'Mechanical maintenance', 'งานซ่อมบำรุงเครื่องกล', ['LOTO', 'MACHINERY']],
  ['MAINT_ELEC', 'Electrical maintenance', 'งานซ่อมบำรุงไฟฟ้า', ['ELECTRICAL', 'LOTO']],
  ['WELDING', 'Welding / cutting', 'งานเชื่อม / ตัด', ['HOT_WORK']],
  ['CLEANING', 'Tank / equipment cleaning', 'งานทำความสะอาดถัง / อุปกรณ์', ['CONFINED_SPACE', 'CHEMICAL']],
  ['INSTALL', 'Installation / modification', 'งานติดตั้ง / ดัดแปลง', []],
  ['CIVIL', 'Civil / construction', 'งานโยธา / ก่อสร้าง', ['EXCAVATION', 'WORK_AT_HEIGHT']],
  ['LIFTING', 'Lifting / material handling', 'งานยก / เคลื่อนย้ายวัสดุ', ['LIFTING']],
  ['OTHER', 'Other', 'อื่น ๆ', []],
];
type Q = s.FollowUpQuestion;
const q = (key: string, en: string, th: string, type: 'boolean' | 'text' = 'boolean', required = true): Q => ({ key, en, th, type, required });
const PERMITS: { code: string; en: string; th: string; attach?: boolean; questions: Q[]; gEn: string; gTh: string }[] = [
  { code: 'HOT_WORK', en: 'Hot Work', th: 'งานที่ก่อให้เกิดความร้อน/ประกายไฟ', questions: [q('fire_watch', 'Fire watch assigned for the duration of work and after completion', 'มีผู้เฝ้าระวังไฟตลอดการทำงานและหลังเสร็จงาน'), q('combustibles_removed', 'Combustibles removed or protected within the configured radius', 'เคลื่อนย้ายหรือป้องกันวัสดุติดไฟในรัศมีที่กำหนดแล้ว'), q('extinguisher', 'Fire extinguisher available at the work point', 'มีถังดับเพลิงพร้อมใช้ ณ จุดทำงาน')], gEn: 'Hot work permit issued by the authorized issuer is required.', gTh: 'ต้องมีใบอนุญาตทำงานที่ก่อให้เกิดความร้อนจากผู้มีอำนาจออกใบอนุญาต' },
  { code: 'CONFINED_SPACE', en: 'Confined Space Entry', th: 'งานในที่อับอากาศ', attach: true, questions: [q('gas_test', 'Atmospheric gas test will be performed before entry', 'จะตรวจวัดบรรยากาศก่อนเข้าทำงาน'), q('standby_person', 'Standby person / attendant assigned', 'มีผู้ช่วยเหลือ/ผู้เฝ้าระวังประจำทางเข้า'), q('rescue_plan', 'Rescue plan reference', 'เลขที่แผนช่วยเหลือ', 'text')], gEn: 'Confined space entry permit and gas test record must be attached.', gTh: 'ต้องแนบใบอนุญาตเข้าที่อับอากาศและบันทึกการตรวจวัดก๊าซ' },
  { code: 'WORK_AT_HEIGHT', en: 'Work at Height', th: 'งานบนที่สูง', questions: [q('fall_protection', 'Fall protection (harness / guardrail) provided and inspected', 'มีและตรวจสอบอุปกรณ์ป้องกันการตก (เข็มขัดนิรภัย / ราวกันตก) แล้ว'), q('scaffold_tagged', 'Scaffold / platform inspected and tagged (if used)', 'นั่งร้าน / แท่นทำงานตรวจสอบและติดป้ายแล้ว (ถ้ามี)')], gEn: 'Height threshold for permit requirement must be configured per company rule.', gTh: 'เกณฑ์ความสูงที่ต้องขอใบอนุญาตให้เป็นไปตามข้อกำหนดของบริษัท' },
  { code: 'ELECTRICAL', en: 'Electrical Work', th: 'งานไฟฟ้า', questions: [q('qualified', 'Work performed by qualified/authorized electrical personnel', 'ดำเนินการโดยช่างไฟฟ้าที่มีคุณสมบัติ/ได้รับอนุญาต'), q('voltage_level', 'Voltage level / equipment', 'ระดับแรงดัน / อุปกรณ์', 'text')], gEn: 'Electrical isolation must follow LOTO procedure.', gTh: 'การตัดแยกไฟฟ้าต้องเป็นไปตามขั้นตอน LOTO' },
  { code: 'LOTO', en: 'Lockout / Tagout (LOTO)', th: 'การล็อกและติดป้าย (LOTO)', questions: [q('isolation_points', 'Isolation points identified', 'ระบุจุดตัดแยกพลังงานครบถ้วน'), q('zero_energy', 'Zero-energy verification will be performed', 'จะทดสอบยืนยันว่าไม่มีพลังงานตกค้าง')], gEn: 'Attach the isolation list where available.', gTh: 'แนบรายการจุดตัดแยกพลังงานถ้ามี' },
  { code: 'LIFTING', en: 'Lifting Operations', th: 'งานยก', questions: [q('lift_plan', 'Lift plan prepared (critical lifts)', 'จัดทำแผนการยก (สำหรับการยกวิกฤต)'), q('certified_operator', 'Certified crane / forklift operator', 'ผู้บังคับปั้นจั่น / รถยกมีใบรับรอง')], gEn: 'Lifting equipment inspection certificates must be valid.', gTh: 'อุปกรณ์ยกต้องมีใบรับรองการตรวจสอบที่ยังไม่หมดอายุ' },
  { code: 'EXCAVATION', en: 'Excavation', th: 'งานขุด', questions: [q('utilities_located', 'Underground utilities located and marked', 'ตรวจหาและทำเครื่องหมายระบบสาธารณูปโภคใต้ดินแล้ว')], gEn: 'Shoring requirements per depth to be confirmed by Safety.', gTh: 'ข้อกำหนดการค้ำยันตามความลึกให้ฝ่ายความปลอดภัยยืนยัน' },
  { code: 'CHEMICAL', en: 'Chemical Handling', th: 'งานเกี่ยวกับสารเคมี', questions: [q('sds_reviewed', 'Safety Data Sheets (SDS) reviewed with workers', 'ทบทวนเอกสารข้อมูลความปลอดภัย (SDS) กับผู้ปฏิบัติงานแล้ว'), q('chemicals', 'Chemicals involved', 'สารเคมีที่เกี่ยวข้อง', 'text')], gEn: 'Chemical-resistant PPE as specified in the SDS.', gTh: 'ใช้อุปกรณ์ป้องกันสารเคมีตามที่ระบุใน SDS' },
  { code: 'MACHINERY', en: 'Work on/near Operating Machinery', th: 'งานบนหรือใกล้เครื่องจักรที่ทำงานอยู่', questions: [q('guarding', 'Machine guarding / barricades in place', 'มีการ์ดป้องกันเครื่องจักร / แผงกั้นพื้นที่'), q('operator_informed', 'Line operator / shift supervisor informed', 'แจ้งผู้ควบคุมไลน์ / หัวหน้ากะแล้ว')], gEn: 'Where work is on stopped machinery, LOTO applies.', gTh: 'หากทำงานกับเครื่องจักรที่หยุดแล้ว ให้ใช้ LOTO' },
];
const HAZARDS: [string, string, string, string][] = [
  ['H-FALL', 'Physical', 'Fall from height', 'ตกจากที่สูง'], ['H-SLIP', 'Physical', 'Slip, trip or fall on same level', 'ลื่น สะดุด หกล้ม'],
  ['H-CAUGHT', 'Mechanical', 'Caught in / between moving parts', 'ถูกหนีบ / ดึงเข้าส่วนที่เคลื่อนไหว'], ['H-STRUCK', 'Mechanical', 'Struck by falling / moving object', 'ถูกวัตถุตก / เคลื่อนที่กระแทก'],
  ['H-ELEC', 'Electrical', 'Electric shock / arc flash', 'ไฟฟ้าดูด / อาร์คแฟลช'], ['H-FIRE', 'Fire', 'Fire / explosion from hot work', 'ไฟไหม้ / ระเบิดจากงานที่มีความร้อน'],
  ['H-BURN', 'Thermal', 'Burns from hot surfaces / steam', 'แผลไหม้จากพื้นผิวร้อน / ไอน้ำ'], ['H-CHEM', 'Chemical', 'Chemical splash / exposure (CIP caustic, acid)', 'สารเคมีกระเด็น / สัมผัส (โซดาไฟ กรด)'],
  ['H-O2', 'Atmospheric', 'Oxygen deficiency / toxic atmosphere', 'ออกซิเจนไม่เพียงพอ / บรรยากาศเป็นพิษ'], ['H-CO2', 'Atmospheric', 'CO₂ accumulation (carbonation)', 'การสะสมของ CO₂ (ระบบอัดก๊าซ)'],
  ['H-NOISE', 'Physical', 'Noise exposure', 'เสียงดัง'], ['H-ERGO', 'Ergonomic', 'Manual handling / awkward posture', 'การยกเคลื่อนย้ายด้วยมือ / ท่าทางไม่เหมาะสม'],
  ['H-FORKLIFT', 'Traffic', 'Forklift / vehicle collision', 'ชนกับรถยก / ยานพาหนะ'], ['H-PRESS', 'Mechanical', 'Stored pressure release (steam, air, CO₂ lines)', 'แรงดันตกค้างปล่อยออก (ไอน้ำ ลม CO₂)'],
  ['H-GLASS', 'Physical', 'Cuts from broken glass / sharp edges', 'บาดจากเศษแก้ว / ขอบคม'],
];
const CONTROLS: [string, string, string, string][] = [
  ['C-LOTO', 'ENGINEERING', 'Apply LOTO and verify zero energy', 'ล็อกและติดป้าย (LOTO) และทดสอบยืนยันไม่มีพลังงาน'],
  ['C-GUARD', 'ENGINEERING', 'Install guardrails / barricades', 'ติดตั้งราวกันตก / แผงกั้น'],
  ['C-VENT', 'ENGINEERING', 'Forced ventilation and continuous gas monitoring', 'ระบายอากาศเชิงกลและตรวจวัดก๊าซต่อเนื่อง'],
  ['C-SUB', 'SUBSTITUTION', 'Substitute with less hazardous chemical / method', 'ใช้สารเคมี / วิธีที่อันตรายน้อยกว่าแทน'],
  ['C-ELIM', 'ELIMINATION', 'Perform task at ground level / prefabricate', 'ทำงานที่ระดับพื้น / ประกอบล่วงหน้า'],
  ['C-PERMIT', 'ADMINISTRATIVE', 'Obtain work permit and toolbox talk before start', 'ขอใบอนุญาตและประชุมก่อนเริ่มงาน'],
  ['C-WATCH', 'ADMINISTRATIVE', 'Assign fire watch / standby person', 'จัดผู้เฝ้าระวังไฟ / ผู้เฝ้าระวัง'],
  ['C-HARNESS', 'PPE', 'Full-body harness with double lanyard', 'เข็มขัดนิรภัยแบบเต็มตัวพร้อมเชือกสองเส้น'],
  ['C-CHEMPPE', 'PPE', 'Face shield, chemical gloves and apron', 'หน้ากากกันสารเคมี ถุงมือและผ้ากันเปื้อนกันสารเคมี'],
  ['C-EARPPE', 'PPE', 'Hearing protection', 'อุปกรณ์ป้องกันเสียง'],
];
const SCALE_S = [
  { value: 1, en: 'Negligible — first aid', th: 'เล็กน้อย — ปฐมพยาบาล' }, { value: 2, en: 'Minor — medical treatment', th: 'น้อย — รักษาพยาบาล' },
  { value: 3, en: 'Moderate — lost time injury', th: 'ปานกลาง — บาดเจ็บถึงหยุดงาน' }, { value: 4, en: 'Major — permanent disability', th: 'รุนแรง — ทุพพลภาพถาวร' },
  { value: 5, en: 'Catastrophic — fatality', th: 'ร้ายแรงมาก — เสียชีวิต' },
];
const SCALE_L = [
  { value: 1, en: 'Rare', th: 'แทบไม่เกิด' }, { value: 2, en: 'Unlikely', th: 'ไม่น่าเกิด' }, { value: 3, en: 'Possible', th: 'อาจเกิด' },
  { value: 4, en: 'Likely', th: 'น่าจะเกิด' }, { value: 5, en: 'Almost certain', th: 'เกิดขึ้นแน่นอน' },
];
const LEVELS = [
  { code: 'LOW', nameEn: 'Low', nameTh: 'ต่ำ', minScore: 1, maxScore: 4, color: '#16a34a', sortOrder: 1, requiresEscalation: false },
  { code: 'MEDIUM', nameEn: 'Medium', nameTh: 'ปานกลาง', minScore: 5, maxScore: 9, color: '#ca8a04', sortOrder: 2, requiresEscalation: false },
  { code: 'HIGH', nameEn: 'High', nameTh: 'สูง', minScore: 10, maxScore: 16, color: '#ea580c', sortOrder: 3, requiresEscalation: true },
  { code: 'CRITICAL', nameEn: 'Critical', nameTh: 'วิกฤต', minScore: 17, maxScore: 25, color: '#b91c1c', sortOrder: 4, requiresEscalation: true },
];

const T = (type: string, en: [string, string], th: [string, string]) => [
  { type, channel: 'IN_APP', language: 'en', title: en[0], body: en[1] },
  { type, channel: 'IN_APP', language: 'th', title: th[0], body: th[1] },
];
const TEMPLATES = [
  ...T('JSA_SUBMITTED', ['{{ref}} submitted', 'Your JSA "{{title}}" was submitted and is awaiting Area Owner review.'], ['ส่ง {{ref}} แล้ว', 'JSA "{{title}}" ของคุณถูกส่งแล้วและรอเจ้าของพื้นที่พิจารณา']),
  ...T('REVIEW_REQUIRED_AREA_OWNER', ['Area Owner review required: {{ref}}', '{{actor}} submitted "{{title}}" for your review.'], ['รอเจ้าของพื้นที่พิจารณา: {{ref}}', '{{actor}} ส่ง "{{title}}" ให้คุณพิจารณา']),
  ...T('REVIEW_REQUIRED_SAFETY_OFFICER', ['Safety review required: {{ref}}', '"{{title}}" was approved by the Area Owner ({{actor}}) and awaits your safety review.'], ['รอฝ่ายความปลอดภัยพิจารณา: {{ref}}', '"{{title}}" ได้รับอนุมัติจากเจ้าของพื้นที่ ({{actor}}) และรอการพิจารณาด้านความปลอดภัย']),
  ...T('AREA_OWNER_APPROVED', ['{{ref}} approved by Area Owner', '{{actor}} approved the Area Owner stage. Safety Officer review is next.'], ['{{ref}} ผ่านการอนุมัติจากเจ้าของพื้นที่', '{{actor}} อนุมัติขั้นตอนเจ้าของพื้นที่แล้ว ขั้นถัดไปคือเจ้าหน้าที่ความปลอดภัย']),
  ...T('JSA_APPROVED', ['{{ref}} approved', '"{{title}}" received final approval from {{actor}}.'], ['{{ref}} ได้รับอนุมัติ', '"{{title}}" ได้รับการอนุมัติขั้นสุดท้ายจาก {{actor}}']),
  ...T('REVISION_REQUESTED', ['Revision requested: {{ref}}', '{{actor}}: {{comment}}'], ['ขอให้แก้ไข: {{ref}}', '{{actor}}: {{comment}}']),
  ...T('JSA_REJECTED', ['{{ref}} rejected', '{{actor}}: {{comment}}'], ['{{ref}} ไม่ได้รับอนุมัติ', '{{actor}}: {{comment}}']),
  ...T('JSA_EXPIRING', ['{{ref}} expiring soon', '"{{title}}" validity ends soon. Complete the work or submit a revision.'], ['{{ref}} ใกล้หมดอายุ', '"{{title}}" ใกล้หมดช่วงเวลาที่มีผล กรุณาปิดงานหรือส่งฉบับแก้ไข']),
  ...T('JSA_EXPIRED', ['{{ref}} expired', '"{{title}}" is no longer valid for work.'], ['{{ref}} หมดอายุ', '"{{title}}" ไม่สามารถใช้ปฏิบัติงานได้อีกต่อไป']),
  ...T('JSA_CANCELLED', ['{{ref}} cancelled', '{{actor}} cancelled "{{title}}": {{comment}}'], ['{{ref}} ถูกยกเลิก', '{{actor}} ยกเลิก "{{title}}": {{comment}}']),
  ...T('WORK_COMPLETED', ['{{ref}} work completed', '{{actor}} confirmed work completion for "{{title}}".'], ['{{ref}} งานเสร็จสิ้น', '{{actor}} ยืนยันว่างาน "{{title}}" เสร็จสิ้นแล้ว']),
];

export async function seedBase() {
  for (const r of ROLES) await db.insert(s.roles).values(r).onConflictDoNothing();
  const roles = await db.select().from(s.roles);
  for (const [code, description, rs] of PERMS) {
    await db.insert(s.permissions).values({ code, description }).onConflictDoNothing();
    const [p] = await db.select().from(s.permissions).where(eq(s.permissions.code, code));
    for (const rc of rs) await db.insert(s.rolePermissions).values({ roleId: roles.find((r) => r.code === rc)!.id, permissionId: p.id }).onConflictDoNothing();
  }
  for (const [code, nameEn, nameTh] of DEPARTMENTS) await db.insert(s.departments).values({ code, nameEn, nameTh }).onConflictDoNothing();
  for (const [code, name, contactName, contactPhone] of CONTRACTORS) await db.insert(s.contractorCompanies).values({ code, name, contactName, contactPhone }).onConflictDoNothing();
  for (const [code, nameEn, nameTh] of SITES) await db.insert(s.factorySites).values({ code, nameEn, nameTh }).onConflictDoNothing();
  const sites = await db.select().from(s.factorySites);
  for (const [site, code, nameEn, nameTh, building] of AREAS) await db.insert(s.factoryAreas).values({ siteId: sites.find((x) => x.code === site)!.id, code, nameEn, nameTh, building }).onConflictDoNothing();
  for (const [code, nameEn, nameTh, defaultPermitCodes] of JOB_TYPES) await db.insert(s.jobTypes).values({ code, nameEn, nameTh, defaultPermitCodes }).onConflictDoNothing();
  for (const [i, p] of PERMITS.entries()) {
    await db.insert(s.permitTypes).values({ code: p.code, nameEn: p.en, nameTh: p.th, requiresAttachment: !!p.attach, followUpQuestions: p.questions, guidanceEn: p.gEn, guidanceTh: p.gTh, sortOrder: i + 1 }).onConflictDoNothing();
  }
  for (const [code, category, nameEn, nameTh] of HAZARDS) await db.insert(s.hazardMaster).values({ code, category, nameEn, nameTh }).onConflictDoNothing();
  for (const [code, hierarchy, nameEn, nameTh] of CONTROLS) await db.insert(s.controlMeasureMaster).values({ code, hierarchy, nameEn, nameTh }).onConflictDoNothing();

  // Risk matrix — PROVISIONAL example. Must be reviewed, adjusted and validated by the Safety Administrator.
  const existing = await db.select().from(s.riskMatrixVersions).limit(1);
  if (!existing.length) {
    const [m] = await db.insert(s.riskMatrixVersions).values({
      versionNo: 1, name: 'PROVISIONAL 5×5 matrix (example — requires validation)', status: 'ACTIVE', size: 5, scoreMethod: 'MULTIPLY',
      severityLabels: SCALE_S, likelihoodLabels: SCALE_L, activatedAt: new Date(),
    }).returning();
    await db.insert(s.riskMatrixLevels).values(LEVELS.map((l) => ({ ...l, matrixVersionId: m.id })));
    await db.insert(s.riskAcceptanceRules).values({ matrixVersionId: m.id, maxAcceptableResidualScore: 9, blockSubmission: false, blockFinalApproval: true, requireResidualLowerOrEqual: true, description: 'PROVISIONAL: residual risk above MEDIUM (score > 9) cannot receive final approval. Confirm with the Safety Administrator.' });
  }
  const [vs] = await db.select().from(s.jsaValiditySettings).limit(1);
  if (!vs) await db.insert(s.jsaValiditySettings).values({});
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) await db.insert(s.systemSettings).values({ key: k, value: v }).onConflictDoNothing();

  await db.insert(s.approvalWorkflows).values({ code: 'STANDARD_JSA', name: 'Requester → Area Owner → Safety Officer' }).onConflictDoNothing();
  const [wf] = await db.select().from(s.approvalWorkflows).where(eq(s.approvalWorkflows.code, 'STANDARD_JSA'));
  await db.insert(s.approvalWorkflowSteps).values([{ workflowId: wf.id, stepOrder: 1, stage: 'AREA_OWNER' }, { workflowId: wf.id, stepOrder: 2, stage: 'SAFETY_OFFICER' }]).onConflictDoNothing();
  for (const t of TEMPLATES) await db.insert(s.notificationTemplates).values(t).onConflictDoNothing();
}

type DemoUser = { username: string; email: string; displayName: string; roles: string[]; userType?: 'EMPLOYEE' | 'CONTRACTOR'; dept?: string; contractor?: string; phone?: string };
export const DEMO_USERS: DemoUser[] = [
  { username: 'admin', email: 'admin@example.com', displayName: 'System Administrator', roles: ['ADMIN'], dept: 'EHS' },
  { username: 'somchai', email: 'somchai@example.com', displayName: 'Somchai Jaidee (Maintenance)', roles: ['REQUESTER'], dept: 'MAINT', phone: '081-000-1001' },
  { username: 'contractor1', email: 'contractor1@siam-industrial.example', displayName: 'Anan Kaewmanee (Siam Industrial)', roles: ['REQUESTER'], userType: 'CONTRACTOR', contractor: 'CTR-001', phone: '089-000-2001' },
  { username: 'contractor2', email: 'contractor2@thai-electrical.example', displayName: 'Wanida Srisuk (Thai Electrical)', roles: ['REQUESTER'], userType: 'CONTRACTOR', contractor: 'CTR-002', phone: '089-000-2002' },
  { username: 'areaowner1', email: 'areaowner1@example.com', displayName: 'Nattapong Rattana (Production Mgr, Plant A)', roles: ['AREA_OWNER', 'REQUESTER'], dept: 'PROD' },
  { username: 'areaowner2', email: 'areaowner2@example.com', displayName: 'Kanokwan Boonmee (Utilities / Plant B)', roles: ['AREA_OWNER', 'REQUESTER'], dept: 'UTIL' },
  { username: 'safety1', email: 'safety1@example.com', displayName: 'Pimchanok Wong (Safety Officer)', roles: ['SAFETY_OFFICER'], dept: 'EHS' },
  { username: 'safety2', email: 'safety2@example.com', displayName: 'Thanawat Chai (Safety Officer, Plant B)', roles: ['SAFETY_OFFICER'], dept: 'EHS' },
];

export async function seedDemoUsers() {
  const pw = await hashPassword(DEMO_PASSWORD);
  const roles = await db.select().from(s.roles);
  const depts = await db.select().from(s.departments);
  const ctrs = await db.select().from(s.contractorCompanies);
  for (const u of DEMO_USERS) {
    await db.insert(s.users).values({
      username: u.username, email: u.email, displayName: u.displayName, passwordHash: pw, userType: u.userType ?? 'EMPLOYEE',
      departmentId: u.dept ? depts.find((d) => d.code === u.dept)!.id : null, contractorCompanyId: u.contractor ? ctrs.find((c) => c.code === u.contractor)!.id : null,
      phone: u.phone ?? null, activatedAt: new Date(), preferredLanguage: 'th',
    }).onConflictDoNothing();
    const [row] = await db.select().from(s.users).where(eq(s.users.username, u.username));
    for (const rc of u.roles) await db.insert(s.userRoles).values({ userId: row.id, roleId: roles.find((r) => r.code === rc)!.id }).onConflictDoNothing();
  }
  const uid = async (un: string) => (await db.select().from(s.users).where(eq(s.users.username, un)))[0].id;
  const areas = await db.select().from(s.factoryAreas);
  const sites = await db.select().from(s.factorySites);
  const ao1 = await uid('areaowner1'); const ao2 = await uid('areaowner2');
  for (const a of areas) {
    const plantA = a.code.startsWith('A-');
    const primary = plantA && !['A-BOILER'].includes(a.code) ? ao1 : ao2;
    const backup = primary === ao1 ? ao2 : ao1;
    await db.insert(s.areaOwnerAssignments).values({ areaId: a.id, userId: primary, isBackup: false }).onConflictDoNothing();
    await db.insert(s.areaOwnerAssignments).values({ areaId: a.id, userId: backup, isBackup: true }).onConflictDoNothing();
  }
  const so1 = await uid('safety1'); const so2 = await uid('safety2');
  const hasSo = await db.select().from(s.safetyOfficerAssignments).limit(1);
  if (!hasSo.length) {
    await db.insert(s.safetyOfficerAssignments).values({ siteId: null, userId: so1, isBackup: false });
    await db.insert(s.safetyOfficerAssignments).values({ siteId: sites.find((x) => x.code === 'PLANT-B')!.id, userId: so2, isBackup: false });
  }
}

async function main() {
  if (config.isProd && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    console.log('Production: seeding base configuration only (no demo users).');
  }
  await seedBase();
  console.log('Base configuration seeded.');
  if (!config.isProd && process.env.SEED_DEMO_USERS !== 'false') {
    await seedDemoUsers();
    console.log(`Demo users seeded (password: ${DEMO_PASSWORD}) — development only.`);
  }
  if (!config.isProd && (process.env.SEED_DEMO_DATA === 'true' || process.argv.includes('--demo'))) {
    const { seedDemoJsas } = await import('./seed-demo');
    await seedDemoJsas();
  }
}

if (require.main === module) {
  main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
export { and, sql };
