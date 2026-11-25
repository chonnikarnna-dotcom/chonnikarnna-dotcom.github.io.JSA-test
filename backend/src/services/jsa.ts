/** JSA lifecycle: drafts, submission, revision, cancellation, completion, detail and search. */
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, DbOrTx, Tx } from '../db/client';
import {
  approvalHistory, approvalInstances, approvalTasks, contractorCompanies, departments, factoryAreas, factorySites,
  jobTypes, jsaAttachments, jsaDeclarations, jsas, jsaStatusHistory, jsaVersions, permitTypes, users, JsaStatus,
} from '../db/schema';
import { AuthUser, canReviewStage, hasRole, jsaVisibility } from '../lib/authz';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { audit, auditAsync } from '../lib/audit';
import { nextReferenceNo } from './reference';
import { getActiveMatrix, loadMatrix } from './risk';
import { getSettings, getValiditySettings } from './settings';
import { notify } from './notifications';
import {
  attachmentsForVersion, contentHash, contentToInput, diffContent, DraftInput, loadVersionContent, riskSummary,
  validateForSubmission, writeDraftContent,
} from './jsa-content';
import { cancelActiveInstance, lockJsa, recordStatus, startApproval } from './workflow';

const REVISABLE: JsaStatus[] = ['RETURNED', 'APPROVED'];
const CANCELLABLE: JsaStatus[] = ['DRAFT', 'PENDING_AREA_OWNER', 'PENDING_SAFETY_OFFICER', 'RETURNED', 'APPROVED'];

async function syncHeader(t: DbOrTx, jsaId: string, versionId: string, extra: Partial<typeof jsas.$inferInsert> = {}) {
  const { version, content } = await loadVersionContent(t, versionId);
  const matrix = version.riskMatrixVersionId ? await loadMatrix(version.riskMatrixVersionId, t) : await getActiveMatrix(t);
  const pts = content.permits.length ? await t.select().from(permitTypes).where(inArray(permitTypes.id, content.permits.map((p) => p.permitTypeId))) : [];
  await t.update(jsas).set({
    jobTitle: content.jobTitle, areaId: content.areaId, departmentId: content.departmentId, jobTypeId: content.jobTypeId,
    contractorCompanyId: version.contractorCompanyId, plannedStart: content.plannedStart, plannedEnd: content.plannedEnd,
    ...riskSummary(content, matrix!), isHighRiskWork: pts.some((p) => p.isHighRisk),
    ...extra, updatedAt: new Date(),
  }).where(eq(jsas.id, jsaId));
}

/** Owner-only operations. Users who cannot even see the record get 404 (no existence leak); visible non-owners get 403. */
async function assertOwner(j: { id: string; requesterId: string }, u: AuthUser, t: DbOrTx = db) {
  if (j.requesterId === u.id) return;
  const [visible] = await t.select({ id: jsas.id }).from(jsas).where(and(eq(jsas.id, j.id), jsaVisibility(u)));
  if (!visible) throw notFound('JSA');
  throw forbidden('NOT_OWNER', 'Only the requester can modify this JSA');
}

export async function createDraft(u: AuthUser, input: DraftInput) {
  if (!hasRole(u, 'REQUESTER')) throw forbidden();
  return db.transaction(async (t) => {
    const settings = await getSettings(t);
    const matrix = await getActiveMatrix(t);
    const referenceNo = await nextReferenceNo(t, new Date(), settings.timezone);
    const [j] = await t.insert(jsas).values({ referenceNo, requesterId: u.id, status: 'DRAFT', contractorCompanyId: u.contractorCompanyId }).returning();
    const [v] = await t.insert(jsaVersions).values({
      jsaId: j.id, versionNo: 1, requesterName: u.displayName, requesterType: u.userType,
      contractorCompanyId: u.contractorCompanyId, createdById: u.id,
    }).returning();
    // Requester identity always comes from the session; employees default to their own department.
    await writeDraftContent(t, v.id, { ...input, departmentId: input.departmentId ?? u.departmentId }, matrix);
    await t.update(jsas).set({ currentVersionId: v.id }).where(eq(jsas.id, j.id));
    await syncHeader(t, j.id, v.id);
    await recordStatus(t, j.id, null, 'DRAFT', 1, u.id);
    await audit(t, { action: 'JSA_CREATE_DRAFT', entityType: 'JSA', entityId: j.id, metadata: { referenceNo } });
    return { id: j.id, referenceNo };
  });
}

async function editableDraft(t: Tx, u: AuthUser, jsaId: string, expectedRowVersion?: number) {
  const j = await lockJsa(t, jsaId);
  await assertOwner(j, u, t);
  if (expectedRowVersion !== undefined && expectedRowVersion !== j.rowVersion) {
    throw conflict('STALE_RECORD', 'This JSA was changed elsewhere. Reload before saving.');
  }
  const v = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, j.currentVersionId!) });
  if (!v || v.locked) throw conflict('NOT_EDITABLE', 'The current version is submitted and cannot be edited');
  if (!['DRAFT', 'RETURNED', 'APPROVED'].includes(j.status)) throw conflict('NOT_EDITABLE', 'JSA cannot be edited in its current status');
  return { j, v };
}

export async function updateDraft(u: AuthUser, jsaId: string, input: DraftInput, expectedRowVersion?: number) {
  return db.transaction(async (t) => {
    const { j, v } = await editableDraft(t, u, jsaId, expectedRowVersion);
    const matrix = await getActiveMatrix(t);
    await writeDraftContent(t, v.id, { ...input, departmentId: input.departmentId ?? (u.userType === 'EMPLOYEE' ? u.departmentId : null) }, matrix);
    // While a revision draft exists on an approved/returned JSA, header filters keep reflecting the last submitted version.
    if (j.status === 'DRAFT') await syncHeader(t, j.id, v.id, { rowVersion: j.rowVersion + 1 });
    else await t.update(jsas).set({ rowVersion: j.rowVersion + 1, updatedAt: new Date() }).where(eq(jsas.id, j.id));
    await audit(t, { action: 'JSA_UPDATE_DRAFT', entityType: 'JSA', entityId: j.id, metadata: { versionNo: v.versionNo } });
    return { id: j.id, rowVersion: j.rowVersion + 1 };
  });
}

export const submitSchema = z.object({
  declarationAccepted: z.literal(true, { errorMap: () => ({ message: 'Declaration must be accepted' }) }),
  language: z.enum(['th', 'en']).default('th'),
  expectedRowVersion: z.number().int().optional(),
});

export async function submit(u: AuthUser, jsaId: string, body: z.infer<typeof submitSchema>) {
  return db.transaction(async (t) => {
    const { j, v } = await editableDraft(t, u, jsaId, body.expectedRowVersion);
    const now = new Date();
    const matrix = await getActiveMatrix(t);
    const settings = await getSettings(t);
    const validity = await getValiditySettings(t);
    // Re-score with the active matrix so the locked version records the matrix actually applied.
    const { content: current } = await loadVersionContent(t, v.id);
    await writeDraftContent(t, v.id, contentToInput(current), matrix);
    const { content } = await loadVersionContent(t, v.id);
    const atts = await attachmentsForVersion(t, j.id, v.versionNo);
    const pts = await t.select().from(permitTypes);
    const errors = validateForSubmission(content, {
      now, requesterType: v.requesterType, matrix, validity, permitTypes: pts,
      availableAttachmentIds: atts.map((a) => a.id), attachmentCount: atts.length,
    });
    if (errors.length) throw unprocessable('SUBMISSION_INVALID', 'The JSA is incomplete or invalid', errors);

    // Change summary vs. the previously submitted version
    let changeSummary = null;
    if (v.versionNo > 1) {
      const prev = await t.query.jsaVersions.findFirst({ where: and(eq(jsaVersions.jsaId, j.id), eq(jsaVersions.versionNo, v.versionNo - 1)) });
      if (prev) {
        const { content: prevContent } = await loadVersionContent(t, prev.id);
        const prevAtts = await attachmentsForVersion(t, j.id, prev.versionNo);
        changeSummary = diffContent(prevContent, content, prev.versionNo,
          prevAtts.map((a) => ({ id: a.id, name: a.originalName })), atts.map((a) => ({ id: a.id, name: a.originalName })));
      }
    }
    // Lock the version (single UPDATE — afterwards the DB trigger forbids any change)
    await t.update(jsaVersions).set({
      locked: true, submittedAt: now, riskMatrixVersionId: matrix.id,
      contentHash: contentHash(content, atts.map((a) => a.id)), changeSummary,
    }).where(eq(jsaVersions.id, v.id));
    const declText = body.language === 'en' ? settings.declarationTextEn : settings.declarationTextTh;
    await t.insert(jsaDeclarations).values({ versionId: v.id, userId: u.id, declarationVersion: settings.declarationVersion, language: body.language, textSnapshot: declText });

    const { reviewerIds } = await startApproval(t, j.id, v.id, content.areaId!, j.requesterId);
    await syncHeader(t, j.id, v.id, {
      status: 'PENDING_AREA_OWNER', submittedAt: now, currentVersionNo: v.versionNo, rowVersion: j.rowVersion + 1,
      // A resubmitted revision supersedes any previous approval until re-approved.
      validFrom: null, validUntil: null, approvedAt: null,
    });
    await recordStatus(t, j.id, j.status, 'SUBMITTED', v.versionNo, u.id);
    await recordStatus(t, j.id, 'SUBMITTED', 'PENDING_AREA_OWNER', v.versionNo, u.id);
    await t.insert(approvalHistory).values({ jsaId: j.id, versionId: v.id, versionNo: v.versionNo, decision: 'SUBMITTED', actorId: u.id, actorName: u.displayName, comment: v.revisionReason, metadata: changeSummary ? { changeSummary } : null });
    const params = { ref: j.referenceNo, title: content.jobTitle, actor: u.displayName };
    await notify(t, [u.id], 'JSA_SUBMITTED', j.id, params);
    await notify(t, reviewerIds, 'REVIEW_REQUIRED_AREA_OWNER', j.id, params);
    await audit(t, { action: 'JSA_SUBMIT', entityType: 'JSA', entityId: j.id, metadata: { versionNo: v.versionNo, referenceNo: j.referenceNo } });
    return { id: j.id, status: 'PENDING_AREA_OWNER' as const, versionNo: v.versionNo };
  });
}

export async function createRevision(u: AuthUser, jsaId: string, reason: string | null) {
  return db.transaction(async (t) => {
    const j = await lockJsa(t, jsaId);
    await assertOwner(j, u, t);
    if (!REVISABLE.includes(j.status)) throw conflict('INVALID_TRANSITION', 'A revision can only be created for a returned or approved JSA');
    const cur = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, j.currentVersionId!) });
    if (!cur?.locked) throw conflict('REVISION_EXISTS', 'A draft revision already exists');
    if (j.status === 'APPROVED' && j.validUntil && j.validUntil < new Date()) throw conflict('JSA_EXPIRED', 'The JSA validity has ended');
    const { content } = await loadVersionContent(t, cur.id);
    const matrix = await getActiveMatrix(t);
    const [nv] = await t.insert(jsaVersions).values({
      jsaId: j.id, versionNo: cur.versionNo + 1, requesterName: u.displayName, requesterType: u.userType,
      contractorCompanyId: u.contractorCompanyId, createdById: u.id, revisionReason: reason,
    }).returning();
    await writeDraftContent(t, nv.id, contentToInput(content), matrix);
    await t.update(jsas).set({ currentVersionId: nv.id, rowVersion: j.rowVersion + 1, updatedAt: new Date() }).where(eq(jsas.id, j.id));
    await audit(t, { action: 'JSA_CREATE_REVISION', entityType: 'JSA', entityId: j.id, reason, metadata: { fromVersion: cur.versionNo, toVersion: nv.versionNo } });
    return { id: j.id, versionNo: nv.versionNo };
  });
}

/** Discard an unsubmitted revision draft (restores the last submitted version as current). */
export async function discardRevision(u: AuthUser, jsaId: string) {
  return db.transaction(async (t) => {
    const j = await lockJsa(t, jsaId);
    await assertOwner(j, u, t);
    const cur = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, j.currentVersionId!) });
    if (!cur || cur.locked || cur.versionNo === 1) throw conflict('NO_REVISION', 'There is no draft revision to discard');
    const prev = await t.query.jsaVersions.findFirst({ where: and(eq(jsaVersions.jsaId, j.id), eq(jsaVersions.versionNo, cur.versionNo - 1)) });
    await t.update(jsas).set({ currentVersionId: prev!.id, rowVersion: j.rowVersion + 1 }).where(eq(jsas.id, j.id));
    const added = await t.select().from(jsaAttachments).where(and(eq(jsaAttachments.jsaId, j.id), eq(jsaAttachments.addedInVersion, cur.versionNo)));
    await t.update(jsaAttachments).set({ removedInVersion: null }).where(and(eq(jsaAttachments.jsaId, j.id), eq(jsaAttachments.removedInVersion, cur.versionNo)));
    await t.delete(jsaVersions).where(eq(jsaVersions.id, cur.id));
    if (added.length) await t.delete(jsaAttachments).where(inArray(jsaAttachments.id, added.map((a) => a.id)));
    await audit(t, { action: 'JSA_DISCARD_REVISION', entityType: 'JSA', entityId: j.id, metadata: { versionNo: cur.versionNo } });
    return { storageKeys: added.map((a) => a.storageKey) };
  });
}

export async function cancel(u: AuthUser, jsaId: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('REASON_REQUIRED', 'A cancellation reason is required', [{ path: 'reason', code: 'required', message: 'Reason required' }]);
  return db.transaction(async (t) => {
    const j = await lockJsa(t, jsaId);
    await assertOwner(j, u, t);
    if (!CANCELLABLE.includes(j.status)) throw conflict('INVALID_TRANSITION', 'This JSA cannot be cancelled in its current status');
    const { reviewerIds } = await cancelActiveInstance(t, j.id);
    const now = new Date();
    await t.update(jsas).set({ status: 'CANCELLED', cancelledAt: now, cancelReason: reason, rowVersion: j.rowVersion + 1, updatedAt: now }).where(eq(jsas.id, j.id));
    const v = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, j.currentVersionId!) });
    await t.insert(approvalHistory).values({ jsaId: j.id, versionId: v!.id, versionNo: v!.versionNo, decision: 'CANCELLED', actorId: u.id, actorName: u.displayName, comment: reason });
    await recordStatus(t, j.id, j.status, 'CANCELLED', v!.versionNo, u.id, reason);
    await notify(t, [u.id, ...reviewerIds], 'JSA_CANCELLED', j.id, { ref: j.referenceNo, title: j.jobTitle, actor: u.displayName, comment: reason });
    await audit(t, { action: 'JSA_CANCEL', entityType: 'JSA', entityId: j.id, reason });
    return { status: 'CANCELLED' as const };
  });
}

export async function complete(u: AuthUser, jsaId: string, note: string | null) {
  return db.transaction(async (t) => {
    const validity = await getValiditySettings(t);
    if (!validity.completionTrackingEnabled) throw conflict('COMPLETION_DISABLED', 'Work completion tracking is disabled');
    const j = await lockJsa(t, jsaId);
    const isAreaOwner = !!j.areaId && u.ownedAreaIds.includes(j.areaId) && hasRole(u, 'AREA_OWNER');
    if (j.requesterId !== u.id && !isAreaOwner) await assertOwner(j, u, t);
    if (!['APPROVED', 'EXPIRED'].includes(j.status)) throw conflict('INVALID_TRANSITION', 'Only approved work can be marked completed');
    const now = new Date();
    if (j.validFrom && now < j.validFrom) throw conflict('NOT_STARTED', 'Work cannot be completed before the validity period starts');
    await t.update(jsas).set({ status: 'COMPLETED', completedAt: now, completedById: u.id, completionNote: note, rowVersion: j.rowVersion + 1, updatedAt: now }).where(eq(jsas.id, j.id));
    await recordStatus(t, j.id, j.status, 'COMPLETED', j.currentVersionNo, u.id, note);
    const owners = j.areaId ? await t.select({ id: users.id }).from(users).where(sql`${users.id} IN (SELECT user_id FROM area_owner_assignments WHERE area_id = ${j.areaId} AND is_active)`) : [];
    await notify(t, [j.requesterId, ...owners.map((o) => o.id)].filter((x) => x !== u.id), 'WORK_COMPLETED', j.id, { ref: j.referenceNo, title: j.jobTitle, actor: u.displayName });
    await audit(t, { action: 'JSA_COMPLETE', entityType: 'JSA', entityId: j.id, reason: note });
    return { status: 'COMPLETED' as const };
  });
}

export async function deleteDraft(u: AuthUser, jsaId: string) {
  return db.transaction(async (t) => {
    const j = await lockJsa(t, jsaId);
    await assertOwner(j, u, t);
    if (j.status !== 'DRAFT' || j.submittedAt) throw conflict('NOT_DELETABLE', 'Only never-submitted drafts can be deleted');
    await t.update(jsas).set({ deletedAt: new Date() }).where(eq(jsas.id, j.id));
    await audit(t, { action: 'JSA_DELETE_DRAFT', entityType: 'JSA', entityId: j.id });
  });
}

/** Duplicate a JSA's latest content as a brand-new draft (reusable template). */
export async function copyAsNew(u: AuthUser, jsaId: string) {
  const j = await getVisibleJsa(u, jsaId);
  if (j.requesterId !== u.id) throw forbidden('NOT_OWNER', 'You can only copy your own JSAs');
  const { content } = await loadVersionContent(db, j.currentVersionId!);
  const input = contentToInput(content);
  input.jobTitle = `${input.jobTitle}`.slice(0, 190);
  input.plannedStart = null; input.plannedEnd = null;
  input.permits = input.permits.map((p) => ({ ...p, referenceNo: null, attachmentId: null }));
  return createDraft(u, input);
}

// ───────────────────────────── Reads ─────────────────────────────
export async function getVisibleJsa(u: AuthUser, jsaId: string) {
  if (!z.string().uuid().safeParse(jsaId).success) throw notFound('JSA');
  const [j] = await db.select().from(jsas).where(and(eq(jsas.id, jsaId), jsaVisibility(u)));
  if (!j) {
    auditAsync({ action: 'JSA_VIEW', entityType: 'JSA', entityId: jsaId, result: 'DENIED' });
    throw notFound('JSA');
  }
  return j;
}

/** Versions a user may view: owners & admins see drafts; reviewers only submitted (locked) versions. */
export async function viewableVersions(u: AuthUser, j: typeof jsas.$inferSelect) {
  const all = await db.select({
    id: jsaVersions.id, versionNo: jsaVersions.versionNo, locked: jsaVersions.locked, submittedAt: jsaVersions.submittedAt,
    changeSummary: jsaVersions.changeSummary, revisionReason: jsaVersions.revisionReason, createdAt: jsaVersions.createdAt,
  }).from(jsaVersions).where(eq(jsaVersions.jsaId, j.id)).orderBy(asc(jsaVersions.versionNo));
  const full = j.requesterId === u.id || hasRole(u, 'ADMIN');
  return full ? all : all.filter((v) => v.locked);
}

export async function getDetail(u: AuthUser, jsaId: string, versionNo?: number) {
  const j = await getVisibleJsa(u, jsaId);
  const versions = await viewableVersions(u, j);
  if (!versions.length) throw notFound('JSA');
  const sel = versionNo ? versions.find((v) => v.versionNo === versionNo) : versions[versions.length - 1];
  if (!sel) throw notFound('Version');
  const { version, content } = await loadVersionContent(db, sel.id);
  const matrix = version.riskMatrixVersionId ? await loadMatrix(version.riskMatrixVersionId) : null;
  const atts = await attachmentsForVersion(db, j.id, sel.versionNo);
  const requester = await db.query.users.findFirst({ where: eq(users.id, j.requesterId), columns: { id: true, displayName: true, email: true, userType: true, phone: true } });
  const area = content.areaId ? await db.query.factoryAreas.findFirst({ where: eq(factoryAreas.id, content.areaId), with: { site: true } }) : null;
  const dept = content.departmentId ? await db.query.departments.findFirst({ where: eq(departments.id, content.departmentId) }) : null;
  const contractor = version.contractorCompanyId ? await db.query.contractorCompanies.findFirst({ where: eq(contractorCompanies.id, version.contractorCompanyId) }) : null;
  const jobType = content.jobTypeId ? await db.query.jobTypes.findFirst({ where: eq(jobTypes.id, content.jobTypeId) }) : null;
  const history = await db.select().from(approvalHistory).where(eq(approvalHistory.jsaId, j.id)).orderBy(asc(approvalHistory.createdAt));
  const statusHistory = await db.select().from(jsaStatusHistory).where(eq(jsaStatusHistory.jsaId, j.id)).orderBy(asc(jsaStatusHistory.createdAt));
  const declaration = await db.query.jsaDeclarations.findFirst({ where: eq(jsaDeclarations.versionId, sel.id) });
  const activeInstance = await db.query.approvalInstances.findFirst({ where: and(eq(approvalInstances.jsaId, j.id), eq(approvalInstances.status, 'IN_PROGRESS')), with: { tasks: true } });
  const pendingTask = activeInstance?.tasks.find((tk) => tk.status === 'PENDING') ?? null;
  const assignee = pendingTask?.assigneeId ? await db.query.users.findFirst({ where: eq(users.id, pendingTask.assigneeId), columns: { id: true, displayName: true } }) : null;
  const validity = await getValiditySettings();
  const currentDraft = j.requesterId === u.id && versions.find((v) => v.id === j.currentVersionId && !v.locked);
  const isOwner = j.requesterId === u.id;
  const canReview = !!pendingTask && !isOwner && pendingTask.instanceId && activeInstance!.versionId === sel.id
    && canReviewStage(u, pendingTask.stage, area?.id ?? null, area?.siteId ?? null);
  const isAreaOwnerOfJsa = !!j.areaId && hasRole(u, 'AREA_OWNER') && u.ownedAreaIds.includes(j.areaId);
  return {
    jsa: {
      ...j, requester, area: area ? { id: area.id, code: area.code, nameEn: area.nameEn, nameTh: area.nameTh, building: area.building } : null,
      site: area?.site ? { id: area.site.id, nameEn: area.site.nameEn, nameTh: area.site.nameTh } : null,
      department: dept ? { id: dept.id, nameEn: dept.nameEn, nameTh: dept.nameTh } : null,
      contractorCompany: contractor ? { id: contractor.id, name: contractor.name } : null,
      jobType: jobType ? { id: jobType.id, nameEn: jobType.nameEn, nameTh: jobType.nameTh } : null,
      currentReviewer: assignee, currentStage: pendingTask?.stage ?? null, pendingSince: pendingTask?.createdAt ?? null,
    },
    version: { id: version.id, versionNo: version.versionNo, locked: version.locked, submittedAt: version.submittedAt, requesterName: version.requesterName, requesterType: version.requesterType, changeSummary: version.changeSummary, revisionReason: version.revisionReason, contentHash: version.contentHash, isApprovedVersion: j.approvedVersionId === version.id },
    content,
    attachments: atts.map((a) => ({ id: a.id, originalName: a.originalName, category: a.category, mimeType: a.mimeType, sizeBytes: a.sizeBytes, uploadedAt: a.uploadedAt, addedInVersion: a.addedInVersion })),
    versions,
    approvalHistory: history,
    statusHistory,
    declaration,
    matrix: matrix ? { id: matrix.id, versionNo: matrix.versionNo, name: matrix.name, size: matrix.size, isValidated: matrix.isValidated, levels: matrix.levels, severityLabels: matrix.severityLabels, likelihoodLabels: matrix.likelihoodLabels, rule: matrix.rule } : null,
    permissions: {
      canEdit: !!currentDraft,
      canSubmit: !!currentDraft,
      canDeleteDraft: isOwner && j.status === 'DRAFT' && !j.submittedAt,
      canCancel: isOwner && CANCELLABLE.includes(j.status),
      canRevise: isOwner && REVISABLE.includes(j.status) && !currentDraft,
      canDiscardRevision: !!currentDraft && (currentDraft as { versionNo: number }).versionNo > 1,
      canComplete: validity.completionTrackingEnabled && ['APPROVED', 'EXPIRED'].includes(j.status) && (isOwner || isAreaOwnerOfJsa),
      canCopy: isOwner,
      canDownloadPdf: !!j.approvedVersionId,
      review: canReview ? { taskId: pendingTask!.id, stage: pendingTask!.stage, versionId: activeInstance!.versionId } : null,
    },
  };
}

// ───────────────────────────── Search / register ─────────────────────────────
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['referenceNo', 'jobTitle', 'plannedStart', 'plannedEnd', 'status', 'riskLevel', 'updatedAt', 'createdAt', 'submittedAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().max(100).optional(),
  scope: z.enum(['mine', 'all']).default('all'),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  riskLevel: z.string().max(30).optional(),
  areaId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  contractorCompanyId: z.string().uuid().optional(),
  jobTypeId: z.string().uuid().optional(),
  requesterId: z.string().uuid().optional(),
  reviewerId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  highRiskOnly: z.enum(['true', 'false']).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export function buildListWhere(u: AuthUser, q: ListQuery): SQL {
  const c: SQL[] = [jsaVisibility(u)];
  if (q.scope === 'mine') c.push(eq(jsas.requesterId, u.id));
  const statuses = (Array.isArray(q.status) ? q.status : q.status ? q.status.split(',') : []).filter(Boolean);
  if (statuses.length) c.push(inArray(jsas.status, statuses as JsaStatus[]));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    c.push(or(ilike(jsas.referenceNo, like), ilike(jsas.jobTitle, like))!);
  }
  if (q.riskLevel) c.push(eq(jsas.riskLevelCode, q.riskLevel));
  if (q.areaId) c.push(eq(jsas.areaId, q.areaId));
  if (q.siteId) c.push(inArray(jsas.areaId, db.select({ id: factoryAreas.id }).from(factoryAreas).where(eq(factoryAreas.siteId, q.siteId))));
  if (q.departmentId) c.push(eq(jsas.departmentId, q.departmentId));
  if (q.contractorCompanyId) c.push(eq(jsas.contractorCompanyId, q.contractorCompanyId));
  if (q.jobTypeId) c.push(eq(jsas.jobTypeId, q.jobTypeId));
  if (q.requesterId) c.push(eq(jsas.requesterId, q.requesterId));
  if (q.reviewerId) {
    c.push(sql`${jsas.id} IN (SELECT ai.jsa_id FROM approval_instances ai JOIN approval_tasks at ON at.instance_id = ai.id
      WHERE at.assignee_id = ${q.reviewerId} OR at.acted_by_id = ${q.reviewerId})`);
  }
  if (q.from) c.push(gte(jsas.plannedEnd, new Date(q.from)));
  if (q.to) c.push(lte(jsas.plannedStart, new Date(q.to)));
  if (q.highRiskOnly === 'true') c.push(or(eq(jsas.isHighRiskWork, true), escalationLevelSql())!);
  return and(...c)!;
}

/** JSA whose highest residual (or initial) risk level is flagged "requires escalation" in its matrix. */
export const escalationLevelSql = () => sql`(${jsas.riskLevelCode} IN (SELECT l.code FROM risk_matrix_levels l JOIN risk_matrix_versions m ON m.id = l.matrix_version_id WHERE m.status = 'ACTIVE' AND l.requires_escalation)
  OR ${jsas.initialRiskLevelCode} IN (SELECT l.code FROM risk_matrix_levels l JOIN risk_matrix_versions m ON m.id = l.matrix_version_id WHERE m.status = 'ACTIVE' AND l.requires_escalation))`;

const SORTS = {
  referenceNo: jsas.referenceNo, jobTitle: jsas.jobTitle, plannedStart: jsas.plannedStart, plannedEnd: jsas.plannedEnd,
  status: jsas.status, riskLevel: jsas.maxResidualRiskScore, updatedAt: jsas.updatedAt, createdAt: jsas.createdAt, submittedAt: jsas.submittedAt,
};

export async function listJsas(u: AuthUser, q: ListQuery, opts: { limitOverride?: number } = {}) {
  const where = buildListWhere(u, q);
  const col = SORTS[q.sort];
  const limit = opts.limitOverride ?? q.pageSize;
  const offset = opts.limitOverride ? 0 : (q.page - 1) * q.pageSize;
  const rows = await db.select({
    id: jsas.id, referenceNo: jsas.referenceNo, version: jsas.currentVersionNo, jobTitle: jsas.jobTitle, status: jsas.status,
    plannedStart: jsas.plannedStart, plannedEnd: jsas.plannedEnd, riskLevelCode: jsas.riskLevelCode, maxResidualRiskScore: jsas.maxResidualRiskScore,
    isHighRiskWork: jsas.isHighRiskWork, updatedAt: jsas.updatedAt, submittedAt: jsas.submittedAt, approvedAt: jsas.approvedAt, validUntil: jsas.validUntil,
    requesterId: jsas.requesterId, requesterName: users.displayName,
    areaNameEn: factoryAreas.nameEn, areaNameTh: factoryAreas.nameTh, siteNameEn: factorySites.nameEn, siteNameTh: factorySites.nameTh,
    departmentNameEn: departments.nameEn, departmentNameTh: departments.nameTh,
    contractorName: contractorCompanies.name, jobTypeNameEn: jobTypes.nameEn, jobTypeNameTh: jobTypes.nameTh,
    currentStage: approvalTasks.stage, pendingSince: approvalTasks.createdAt,
    currentReviewerName: sql<string | null>`(SELECT display_name FROM users ru WHERE ru.id = ${approvalTasks.assigneeId})`,
  }).from(jsas)
    .innerJoin(users, eq(users.id, jsas.requesterId))
    .leftJoin(factoryAreas, eq(factoryAreas.id, jsas.areaId))
    .leftJoin(factorySites, eq(factorySites.id, factoryAreas.siteId))
    .leftJoin(departments, eq(departments.id, jsas.departmentId))
    .leftJoin(contractorCompanies, eq(contractorCompanies.id, jsas.contractorCompanyId))
    .leftJoin(jobTypes, eq(jobTypes.id, jsas.jobTypeId))
    .leftJoin(approvalInstances, and(eq(approvalInstances.jsaId, jsas.id), eq(approvalInstances.status, 'IN_PROGRESS')))
    .leftJoin(approvalTasks, and(eq(approvalTasks.instanceId, approvalInstances.id), eq(approvalTasks.status, 'PENDING')))
    .where(where)
    .orderBy(q.order === 'asc' ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS LAST`, desc(jsas.referenceNo))
    .limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(jsas).where(where);
  return { items: rows, total, page: q.page, pageSize: q.pageSize };
}
