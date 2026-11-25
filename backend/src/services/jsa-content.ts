/**
 * JSA version content: input schema, persistence of draft content, DTO mapping,
 * submission validation and version diffing.
 */
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbOrTx } from '../db/client';
import {
  factoryAreas, jsaAttachments, jsaControlMeasures, jsaJobSteps, jsaPermitReferences, jsaRiskAssessments,
  jsaStepHazards, jsaVersions, permitTypes,
} from '../db/schema';
import { FieldError, unprocessable } from '../lib/errors';
import { canonicalJson, sha256 } from '../lib/crypto';
import { assess, Matrix } from './risk';

// ───────────── Input schema (lenient: drafts may be incomplete) ─────────────
const optStr = (max: number) => z.string().trim().max(max).nullable().optional();
const optInt = z.number().int().min(1).max(10).nullable().optional();
const optUuid = z.string().uuid().nullable().optional();
const optDate = z.union([z.string().datetime({ offset: true }), z.date()]).nullable().optional()
  .transform((v) => (v ? new Date(v) : null));

export const hazardInputSchema = z.object({
  hazard: z.string().trim().max(1000).default(''),
  consequence: z.string().trim().max(1000).default(''),
  hazardMasterId: optUuid,
  initialSeverity: optInt,
  initialLikelihood: optInt,
  existingControls: z.string().trim().max(4000).default(''),
  additionalControls: z.string().trim().max(4000).default(''),
  controlOwner: optStr(200),
  residualSeverity: optInt,
  residualLikelihood: optInt,
});
export const stepInputSchema = z.object({
  activity: z.string().trim().max(1000).default(''),
  hazards: z.array(hazardInputSchema).max(30).default([]),
});
export const permitInputSchema = z.object({
  permitTypeId: z.string().uuid(),
  referenceNo: optStr(100),
  answers: z.record(z.union([z.string().max(1000), z.boolean()])).default({}),
  attachmentId: optUuid,
  notes: optStr(1000),
});
export const draftInputSchema = z.object({
  jobTitle: z.string().trim().max(200).default(''),
  jobDescription: z.string().trim().max(5000).default(''),
  departmentId: optUuid,
  contactPhone: optStr(50),
  contactEmail: z.string().trim().email().max(255).nullable().optional().or(z.literal('').transform(() => null)),
  areaId: optUuid,
  exactLocation: optStr(300),
  plannedStart: optDate,
  plannedEnd: optDate,
  workerCount: z.number().int().min(1).max(1000).nullable().optional(),
  supervisorName: optStr(200),
  supervisorPhone: optStr(50),
  jobTypeId: optUuid,
  emergencyContactName: optStr(200),
  emergencyContactPhone: optStr(50),
  ppeRequired: z.array(z.string().max(50)).max(30).default([]),
  additionalRequirements: optStr(4000),
  steps: z.array(stepInputSchema).max(100).default([]),
  permits: z.array(permitInputSchema).max(20).default([]),
});
export type DraftInput = z.infer<typeof draftInputSchema>;

// ───────────────────────────── DTO ─────────────────────────────
export type RiskDto = { severity: number; likelihood: number; score: number; levelCode: string } | null;
export type HazardDto = {
  hazard: string; consequence: string; hazardMasterId: string | null; controlOwner: string | null;
  existingControls: string; additionalControls: string; initial: RiskDto; residual: RiskDto;
};
export type StepDto = { stepNo: number; activity: string; hazards: HazardDto[] };
export type PermitDto = {
  id?: string; permitTypeId: string; permitTypeCode?: string; referenceNo: string | null; verificationStatus: string;
  answers: Record<string, unknown>; attachmentId: string | null; notes: string | null; verified?: boolean;
};
export type VersionContent = {
  jobTitle: string; jobDescription: string; departmentId: string | null; contactPhone: string | null; contactEmail: string | null;
  siteId: string | null; areaId: string | null; exactLocation: string | null; plannedStart: Date | null; plannedEnd: Date | null;
  workerCount: number | null; supervisorName: string | null; supervisorPhone: string | null; jobTypeId: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; ppeRequired: string[]; additionalRequirements: string | null;
  steps: StepDto[]; permits: PermitDto[];
};

export async function loadVersionContent(t: DbOrTx, versionId: string) {
  const v = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, versionId) });
  if (!v) throw new Error('version not found');
  const steps = await t.select().from(jsaJobSteps).where(eq(jsaJobSteps.versionId, versionId)).orderBy(asc(jsaJobSteps.stepNo));
  const stepIds = steps.map((s) => s.id);
  const hazards = stepIds.length ? await t.select().from(jsaStepHazards).where(inArray(jsaStepHazards.stepId, stepIds)).orderBy(asc(jsaStepHazards.seq)) : [];
  const hazardIds = hazards.map((h) => h.id);
  const controls = hazardIds.length ? await t.select().from(jsaControlMeasures).where(inArray(jsaControlMeasures.hazardId, hazardIds)) : [];
  const risks = hazardIds.length ? await t.select().from(jsaRiskAssessments).where(inArray(jsaRiskAssessments.hazardId, hazardIds)) : [];
  const permits = await t.query.jsaPermitReferences.findMany({
    where: eq(jsaPermitReferences.versionId, versionId), with: { permitType: true, verifications: true },
  });
  const toRisk = (hid: string, phase: 'INITIAL' | 'RESIDUAL'): RiskDto => {
    const r = risks.find((x) => x.hazardId === hid && x.phase === phase);
    return r ? { severity: r.severity, likelihood: r.likelihood, score: r.score, levelCode: r.levelCode } : null;
  };
  const content: VersionContent = {
    jobTitle: v.jobTitle, jobDescription: v.jobDescription, departmentId: v.departmentId, contactPhone: v.contactPhone,
    contactEmail: v.contactEmail, siteId: v.siteId, areaId: v.areaId, exactLocation: v.exactLocation,
    plannedStart: v.plannedStart, plannedEnd: v.plannedEnd, workerCount: v.workerCount, supervisorName: v.supervisorName,
    supervisorPhone: v.supervisorPhone, jobTypeId: v.jobTypeId, emergencyContactName: v.emergencyContactName,
    emergencyContactPhone: v.emergencyContactPhone, ppeRequired: v.ppeRequired, additionalRequirements: v.additionalRequirements,
    steps: steps.map((s) => ({
      stepNo: s.stepNo, activity: s.activity,
      hazards: hazards.filter((h) => h.stepId === s.id).map((h) => ({
        hazard: h.hazard, consequence: h.consequence, hazardMasterId: h.hazardMasterId, controlOwner: h.controlOwner,
        existingControls: controls.filter((c) => c.hazardId === h.id && c.type === 'EXISTING').map((c) => c.description).join('\n'),
        additionalControls: controls.filter((c) => c.hazardId === h.id && c.type === 'ADDITIONAL').map((c) => c.description).join('\n'),
        initial: toRisk(h.id, 'INITIAL'), residual: toRisk(h.id, 'RESIDUAL'),
      })),
    })),
    permits: permits
      .sort((a, b) => a.permitType.sortOrder - b.permitType.sortOrder)
      .map((p) => ({
        id: p.id, permitTypeId: p.permitTypeId, permitTypeCode: p.permitType.code, referenceNo: p.referenceNo,
        verificationStatus: p.verifications.length ? 'VERIFIED' : p.verificationStatus, answers: p.answers,
        attachmentId: p.attachmentId, notes: p.notes, verified: p.verifications.length > 0,
      })),
  };
  return { version: v, content };
}

/** Risk summary used to denormalize onto the JSA header. */
export function riskSummary(content: Pick<VersionContent, 'steps'>, matrix: Pick<Matrix, 'levels'>) {
  let maxInitial: number | null = null; let maxResidual: number | null = null;
  for (const s of content.steps) for (const h of s.hazards) {
    if (h.initial) maxInitial = Math.max(maxInitial ?? 0, h.initial.score);
    if (h.residual) maxResidual = Math.max(maxResidual ?? 0, h.residual.score);
  }
  const lvl = (score: number | null) => (score == null ? null : matrix.levels.find((l) => score >= l.minScore && score <= l.maxScore)?.code ?? null);
  return { maxInitialRiskScore: maxInitial, maxResidualRiskScore: maxResidual, initialRiskLevelCode: lvl(maxInitial), riskLevelCode: lvl(maxResidual) };
}

/** Persist draft content (replaces steps & permits). Scores are always computed on the server. */
export async function writeDraftContent(t: DbOrTx, versionId: string, input: DraftInput, matrix: Matrix) {
  let siteId: string | null = null;
  if (input.areaId) {
    const area = await t.query.factoryAreas.findFirst({ where: and(eq(factoryAreas.id, input.areaId), eq(factoryAreas.isActive, true)) });
    if (!area) throw unprocessable('INVALID_AREA', 'Selected factory area does not exist or is inactive', [{ path: 'areaId', code: 'invalid', message: 'Invalid area' }]);
    siteId = area.siteId;
  }
  await t.update(jsaVersions).set({
    jobTitle: input.jobTitle, jobDescription: input.jobDescription, departmentId: input.departmentId ?? null,
    contactPhone: input.contactPhone ?? null, contactEmail: input.contactEmail ?? null, siteId, areaId: input.areaId ?? null,
    exactLocation: input.exactLocation ?? null, plannedStart: input.plannedStart, plannedEnd: input.plannedEnd,
    workerCount: input.workerCount ?? null, supervisorName: input.supervisorName ?? null, supervisorPhone: input.supervisorPhone ?? null,
    jobTypeId: input.jobTypeId ?? null, emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null, ppeRequired: input.ppeRequired,
    additionalRequirements: input.additionalRequirements ?? null, riskMatrixVersionId: matrix.id,
  }).where(eq(jsaVersions.id, versionId));

  await t.delete(jsaJobSteps).where(eq(jsaJobSteps.versionId, versionId));
  await t.delete(jsaPermitReferences).where(eq(jsaPermitReferences.versionId, versionId));

  for (const [i, step] of input.steps.entries()) {
    const [s] = await t.insert(jsaJobSteps).values({ versionId, stepNo: i + 1, activity: step.activity }).returning({ id: jsaJobSteps.id });
    for (const [j, h] of step.hazards.entries()) {
      const [hz] = await t.insert(jsaStepHazards).values({
        stepId: s.id, seq: j + 1, hazard: h.hazard, consequence: h.consequence,
        hazardMasterId: h.hazardMasterId ?? null, controlOwner: h.controlOwner ?? null,
      }).returning({ id: jsaStepHazards.id });
      const controls = [
        ...(h.existingControls ? [{ hazardId: hz.id, type: 'EXISTING' as const, description: h.existingControls }] : []),
        ...(h.additionalControls ? [{ hazardId: hz.id, type: 'ADDITIONAL' as const, description: h.additionalControls }] : []),
      ];
      if (controls.length) await t.insert(jsaControlMeasures).values(controls);
      const assessments = [];
      if (h.initialSeverity && h.initialLikelihood) assessments.push({ hazardId: hz.id, phase: 'INITIAL' as const, ...assess(matrix, h.initialSeverity, h.initialLikelihood) });
      if (h.residualSeverity && h.residualLikelihood) assessments.push({ hazardId: hz.id, phase: 'RESIDUAL' as const, ...assess(matrix, h.residualSeverity, h.residualLikelihood) });
      if (assessments.length) await t.insert(jsaRiskAssessments).values(assessments);
    }
  }
  const seen = new Set<string>();
  for (const p of input.permits) {
    if (seen.has(p.permitTypeId)) continue;
    seen.add(p.permitTypeId);
    const pt = await t.query.permitTypes.findFirst({ where: eq(permitTypes.id, p.permitTypeId) });
    if (!pt) throw unprocessable('INVALID_PERMIT_TYPE', 'Unknown permit type');
    await t.insert(jsaPermitReferences).values({
      versionId, permitTypeId: p.permitTypeId, referenceNo: p.referenceNo ?? null, answers: p.answers,
      attachmentId: p.attachmentId ?? null, notes: p.notes ?? null,
      // No permit system integration: a typed reference is "manually referenced" until a Safety Officer verifies it.
      verificationStatus: pt.requiresSafetyVerification ? 'AWAITING_VERIFICATION' : 'MANUAL_REFERENCE',
    });
  }
}

/** Convert stored content back into the input shape (used to copy content into a new version). */
export function contentToInput(c: VersionContent): DraftInput {
  return {
    jobTitle: c.jobTitle, jobDescription: c.jobDescription, departmentId: c.departmentId, contactPhone: c.contactPhone,
    contactEmail: c.contactEmail, areaId: c.areaId, exactLocation: c.exactLocation, plannedStart: c.plannedStart,
    plannedEnd: c.plannedEnd, workerCount: c.workerCount, supervisorName: c.supervisorName, supervisorPhone: c.supervisorPhone,
    jobTypeId: c.jobTypeId, emergencyContactName: c.emergencyContactName, emergencyContactPhone: c.emergencyContactPhone,
    ppeRequired: c.ppeRequired, additionalRequirements: c.additionalRequirements,
    steps: c.steps.map((s) => ({
      activity: s.activity,
      hazards: s.hazards.map((h) => ({
        hazard: h.hazard, consequence: h.consequence, hazardMasterId: h.hazardMasterId, controlOwner: h.controlOwner,
        existingControls: h.existingControls, additionalControls: h.additionalControls,
        initialSeverity: h.initial?.severity ?? null, initialLikelihood: h.initial?.likelihood ?? null,
        residualSeverity: h.residual?.severity ?? null, residualLikelihood: h.residual?.likelihood ?? null,
      })),
    })),
    permits: c.permits.map((p) => ({
      permitTypeId: p.permitTypeId, referenceNo: p.referenceNo, answers: p.answers as Record<string, string | boolean>,
      attachmentId: p.attachmentId, notes: p.notes,
    })),
  };
}

// ───────────────────────────── Submission validation ─────────────────────────────
export type SubmissionContext = {
  now: Date;
  requesterType: 'EMPLOYEE' | 'CONTRACTOR';
  matrix: Matrix;
  validity: { maxWorkPeriodDays: number; minLeadTimeHours: number };
  permitTypes: (typeof permitTypes.$inferSelect)[];
  availableAttachmentIds: string[];
  attachmentCount: number;
};

export function validateForSubmission(c: VersionContent, x: SubmissionContext): FieldError[] {
  const errs: FieldError[] = [];
  const req = (path: string, v: unknown) => {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) errs.push({ path, code: 'required', message: `${path} is required` });
  };
  req('jobTitle', c.jobTitle);
  if (c.jobTitle && c.jobTitle.trim().length < 3) errs.push({ path: 'jobTitle', code: 'too_short', message: 'Job title is too short' });
  req('jobDescription', c.jobDescription);
  req('areaId', c.areaId);
  req('exactLocation', c.exactLocation);
  req('jobTypeId', c.jobTypeId);
  req('supervisorName', c.supervisorName);
  req('contactPhone', c.contactPhone);
  req('workerCount', c.workerCount);
  if (x.requesterType === 'EMPLOYEE') req('departmentId', c.departmentId);
  req('plannedStart', c.plannedStart);
  req('plannedEnd', c.plannedEnd);
  if (c.plannedStart && c.plannedEnd) {
    if (c.plannedEnd <= c.plannedStart) errs.push({ path: 'plannedEnd', code: 'end_before_start', message: 'Planned end must be after planned start' });
    if (c.plannedEnd <= x.now) errs.push({ path: 'plannedEnd', code: 'in_past', message: 'Planned end must be in the future' });
    const days = (c.plannedEnd.getTime() - c.plannedStart.getTime()) / 86_400_000;
    if (days > x.validity.maxWorkPeriodDays) errs.push({ path: 'plannedEnd', code: 'period_too_long', message: `Work period exceeds ${x.validity.maxWorkPeriodDays} days`, params: { max: x.validity.maxWorkPeriodDays } });
    if (x.validity.minLeadTimeHours > 0 && c.plannedStart.getTime() < x.now.getTime() + x.validity.minLeadTimeHours * 3600_000) {
      errs.push({ path: 'plannedStart', code: 'lead_time', message: `Work must be planned at least ${x.validity.minLeadTimeHours} hours ahead`, params: { hours: x.validity.minLeadTimeHours } });
    }
  }
  // Job steps
  if (c.steps.length === 0) errs.push({ path: 'steps', code: 'min_one_step', message: 'At least one job step is required' });
  const rule = x.matrix.rule;
  c.steps.forEach((s, i) => {
    const p = `steps.${i}`;
    req(`${p}.activity`, s.activity);
    if (s.hazards.length === 0) errs.push({ path: `${p}.hazards`, code: 'min_one_hazard', message: `Step ${i + 1}: at least one hazard is required` });
    s.hazards.forEach((h, j) => {
      const hp = `${p}.hazards.${j}`;
      req(`${hp}.hazard`, h.hazard);
      req(`${hp}.consequence`, h.consequence);
      if (!h.initial) errs.push({ path: `${hp}.initial`, code: 'risk_required', message: 'Initial risk assessment is required' });
      if (!h.residual) errs.push({ path: `${hp}.residual`, code: 'risk_required', message: 'Residual risk assessment is required' });
      if (!h.existingControls && !h.additionalControls) errs.push({ path: `${hp}.controls`, code: 'control_required', message: 'At least one control measure is required' });
      if (h.additionalControls && !h.controlOwner) errs.push({ path: `${hp}.controlOwner`, code: 'required', message: 'Control owner is required for additional controls' });
      if (h.initial && h.residual && rule?.requireResidualLowerOrEqual && h.residual.score > h.initial.score) {
        errs.push({ path: `${hp}.residual`, code: 'residual_above_initial', message: 'Residual risk cannot exceed initial risk' });
      }
      if (h.residual && rule?.blockSubmission && h.residual.score > rule.maxAcceptableResidualScore) {
        errs.push({ path: `${hp}.residual`, code: 'residual_not_acceptable', message: 'Residual risk exceeds the configured acceptance criteria', params: { max: rule.maxAcceptableResidualScore } });
      }
    });
  });
  // Permit / high-risk requirements
  c.permits.forEach((p, i) => {
    const pt = x.permitTypes.find((t) => t.id === p.permitTypeId);
    const pp = `permits.${i}`;
    if (!pt || !pt.isActive) { errs.push({ path: pp, code: 'invalid_permit_type', message: 'Permit type is not active' }); return; }
    if (pt.requiresPermitReference && !p.referenceNo) errs.push({ path: `${pp}.referenceNo`, code: 'required', message: `${pt.nameEn}: permit reference is required` });
    if (pt.requiresAttachment && (!p.attachmentId || !x.availableAttachmentIds.includes(p.attachmentId))) {
      errs.push({ path: `${pp}.attachmentId`, code: 'evidence_required', message: `${pt.nameEn}: supporting evidence attachment is required` });
    }
    for (const q of pt.followUpQuestions) {
      if (!q.required) continue;
      const a = p.answers[q.key];
      const ok = q.type === 'boolean' ? a === true : typeof a === 'string' && a.trim() !== '';
      if (!ok) errs.push({ path: `${pp}.answers.${q.key}`, code: q.type === 'boolean' ? 'must_confirm' : 'required', message: `${pt.nameEn}: ${q.en}` });
    }
  });
  const highRisk = c.permits.some((p) => x.permitTypes.find((t) => t.id === p.permitTypeId)?.isHighRisk);
  if (highRisk) {
    req('emergencyContactName', c.emergencyContactName);
    req('emergencyContactPhone', c.emergencyContactPhone);
  }
  return errs;
}

// ───────────────────────────── Hash & diff ─────────────────────────────
function stripVolatile(c: VersionContent) {
  return { ...c, permits: c.permits.map(({ id: _id, verificationStatus: _v, verified: _vv, permitTypeCode: _c, ...rest }) => rest) };
}
export const contentHash = (c: VersionContent, attachmentIds: string[]) => sha256(canonicalJson({ c: stripVolatile(c), a: [...attachmentIds].sort() }));

const CRITICAL_FIELDS = ['jobDescription', 'areaId', 'exactLocation', 'plannedStart', 'plannedEnd', 'jobTypeId', 'workerCount'];
const SIMPLE_FIELDS: (keyof VersionContent)[] = [
  'jobTitle', 'jobDescription', 'departmentId', 'contactPhone', 'contactEmail', 'areaId', 'exactLocation', 'plannedStart',
  'plannedEnd', 'workerCount', 'supervisorName', 'supervisorPhone', 'jobTypeId', 'emergencyContactName', 'emergencyContactPhone',
  'ppeRequired', 'additionalRequirements',
];

export type ChangeSummary = {
  comparedToVersion: number;
  changedFields: string[];
  steps: { added: number[]; removed: number[]; modified: number[] };
  permitsChanged: boolean;
  attachments: { added: string[]; removed: string[] };
  criticalChange: boolean;
};

export function diffContent(prev: VersionContent, next: VersionContent, prevNo: number, prevAtt: { id: string; name: string }[], nextAtt: { id: string; name: string }[]): ChangeSummary {
  const changedFields = SIMPLE_FIELDS.filter((f) => canonicalJson(prev[f]) !== canonicalJson(next[f])) as string[];
  const added: number[] = []; const removed: number[] = []; const modified: number[] = [];
  const max = Math.max(prev.steps.length, next.steps.length);
  for (let i = 0; i < max; i++) {
    const a = prev.steps[i]; const b = next.steps[i];
    if (!a) added.push(i + 1);
    else if (!b) removed.push(i + 1);
    else if (canonicalJson(a) !== canonicalJson(b)) modified.push(i + 1);
  }
  const permitsChanged = canonicalJson(stripVolatile(prev).permits) !== canonicalJson(stripVolatile(next).permits);
  const attAdded = nextAtt.filter((n) => !prevAtt.some((p) => p.id === n.id)).map((a) => a.name);
  const attRemoved = prevAtt.filter((p) => !nextAtt.some((n) => n.id === p.id)).map((a) => a.name);
  const criticalChange = changedFields.some((f) => CRITICAL_FIELDS.includes(f)) || added.length + removed.length + modified.length > 0 || permitsChanged;
  return { comparedToVersion: prevNo, changedFields, steps: { added, removed, modified }, permitsChanged, attachments: { added: attAdded, removed: attRemoved }, criticalChange };
}

export const attachmentsForVersion = (t: DbOrTx, jsaId: string, versionNo: number) =>
  t.select().from(jsaAttachments).where(eq(jsaAttachments.jsaId, jsaId)).then((rows) =>
    rows.filter((a) => a.addedInVersion <= versionNo && (a.removedInVersion == null || a.removedInVersion > versionNo)));
