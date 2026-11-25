/**
 * Approval workflow engine: Requester → Area Owner → Safety Officer → Approved.
 * All transitions run inside a DB transaction with row locks on the JSA and the task,
 * so concurrent/duplicate actions cannot both succeed.
 */
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DbOrTx } from '../db/client';
import {
  approvalHistory, approvalInstances, approvalTasks, approvalWorkflows, approvalWorkflowSteps, areaOwnerAssignments,
  factoryAreas, JsaStatus, jsaPermitReferences, jsaPermitVerifications, jsas, jsaStatusHistory, jsaVersions, permitTypes,
  roles, safetyOfficerAssignments, userRoles, users, ApprovalStage,
} from '../db/schema';
import { AuthUser, canReviewStage } from '../lib/authz';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { audit, auditAsync } from '../lib/audit';
import { notify } from './notifications';
import { calculateValidity, getSettings, getValiditySettings } from './settings';
import { loadMatrix } from './risk';
import { loadVersionContent } from './jsa-content';

export const WORKFLOW_CODE = 'STANDARD_JSA';

export async function recordStatus(t: DbOrTx, jsaId: string, from: JsaStatus | null, to: JsaStatus, versionNo: number, actorId: string | null, reason?: string | null) {
  await t.insert(jsaStatusHistory).values({ jsaId, fromStatus: from, toStatus: to, versionNo, actorId, reason: reason ?? null });
}

export async function lockJsa(t: DbOrTx, jsaId: string) {
  await t.execute(sql`SELECT id FROM jsas WHERE id = ${jsaId} FOR UPDATE`);
  const j = await t.query.jsas.findFirst({ where: and(eq(jsas.id, jsaId), isNull(jsas.deletedAt)) });
  if (!j) throw notFound('JSA');
  return j;
}

async function usersWithRole(t: DbOrTx, ids: string[], role: string) {
  if (!ids.length) return new Set<string>();
  const rows = await t.select({ id: users.id }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(inArray(users.id, ids), eq(users.isActive, true), eq(roles.code, role)));
  return new Set(rows.map((r) => r.id));
}

/** Eligible Area Owners (primary first), excluding the requester (no self-approval). */
export async function resolveAreaOwners(t: DbOrTx, areaId: string, excludeUserId: string) {
  const rows = await t.select().from(areaOwnerAssignments)
    .where(and(eq(areaOwnerAssignments.areaId, areaId), eq(areaOwnerAssignments.isActive, true)))
    .orderBy(asc(areaOwnerAssignments.isBackup), asc(areaOwnerAssignments.createdAt));
  const ok = await usersWithRole(t, rows.map((r) => r.userId), 'AREA_OWNER');
  return rows.filter((r) => ok.has(r.userId) && r.userId !== excludeUserId).map((r) => r.userId);
}

/** Eligible Safety Officers for a site (site-specific first, then all-site), excluding the requester. */
export async function resolveSafetyOfficers(t: DbOrTx, siteId: string | null, excludeUserId: string) {
  const rows = await t.select().from(safetyOfficerAssignments)
    .where(and(eq(safetyOfficerAssignments.isActive, true),
      siteId ? or(eq(safetyOfficerAssignments.siteId, siteId), isNull(safetyOfficerAssignments.siteId)) : isNull(safetyOfficerAssignments.siteId)))
    .orderBy(asc(safetyOfficerAssignments.isBackup), sql`${safetyOfficerAssignments.siteId} IS NULL`, asc(safetyOfficerAssignments.createdAt));
  const ok = await usersWithRole(t, rows.map((r) => r.userId), 'SAFETY_OFFICER');
  return [...new Set(rows.filter((r) => ok.has(r.userId) && r.userId !== excludeUserId).map((r) => r.userId))];
}

export async function getWorkflowSteps(t: DbOrTx) {
  const wf = await t.query.approvalWorkflows.findFirst({ where: and(eq(approvalWorkflows.code, WORKFLOW_CODE), eq(approvalWorkflows.isActive, true)) });
  if (!wf) throw unprocessable('WORKFLOW_NOT_CONFIGURED', 'Approval workflow is not configured');
  const steps = await t.select().from(approvalWorkflowSteps).where(eq(approvalWorkflowSteps.workflowId, wf.id)).orderBy(asc(approvalWorkflowSteps.stepOrder));
  // Mandatory primary sequence must be AREA_OWNER → SAFETY_OFFICER.
  if (steps.length < 2 || steps[0].stage !== 'AREA_OWNER' || steps[steps.length - 1].stage !== 'SAFETY_OFFICER') {
    throw unprocessable('WORKFLOW_INVALID', 'Workflow must be Area Owner → Safety Officer');
  }
  return { wf, steps };
}

/** Start a new approval instance for a freshly locked version and create the Area Owner task. */
export async function startApproval(t: DbOrTx, jsaId: string, versionId: string, areaId: string, requesterId: string) {
  const { wf, steps } = await getWorkflowSteps(t);
  const owners = await resolveAreaOwners(t, areaId, requesterId);
  if (!owners.length) throw unprocessable('NO_AREA_OWNER', 'No eligible Area Owner is assigned to the selected area');
  const [inst] = await t.insert(approvalInstances).values({ jsaId, versionId, workflowId: wf.id, currentStepOrder: 1 }).returning();
  await t.insert(approvalTasks).values({ instanceId: inst.id, workflowStepId: steps[0].id, stage: 'AREA_OWNER', assigneeId: owners[0] });
  return { instance: inst, reviewerIds: owners };
}

export type ReviewAction = 'APPROVE' | 'RETURN' | 'REJECT';
export type ReviewInput = { versionId: string; comment?: string | null; verifiedPermitRefIds?: string[] };

/**
 * Execute a reviewer decision on a task. Enforces:
 *  - task is pending and belongs to the active instance of the JSA
 *  - action targets the current submitted version (stale actions are rejected)
 *  - actor is eligible for the stage (assigned area / site scope) and is not the requester
 *  - Safety Officer stage only after Area Owner approval
 *  - comments for return/reject; risk acceptance, permit verification and validity rules for final approval
 */
export async function reviewTask(t: DbOrTx, actor: AuthUser, taskId: string, action: ReviewAction, input: ReviewInput) {
  await t.execute(sql`SELECT id FROM approval_tasks WHERE id = ${taskId} FOR UPDATE`);
  const task = await t.query.approvalTasks.findFirst({ where: eq(approvalTasks.id, taskId), with: { instance: true } });
  if (!task) throw notFound('Approval task');
  const jsa = await lockJsa(t, task.instance.jsaId);
  // Re-read the task after acquiring the JSA lock (another transaction may have completed it).
  const fresh = await t.query.approvalTasks.findFirst({ where: eq(approvalTasks.id, taskId) });
  const deny = (code: string, msg: string) => {
    auditAsync({ action: `REVIEW_${action}`, entityType: 'JSA', entityId: jsa.id, result: 'DENIED', reason: code, metadata: { taskId } });
    return forbidden(code, msg);
  };
  if (!fresh || fresh.status !== 'PENDING' || task.instance.status !== 'IN_PROGRESS') throw conflict('TASK_NOT_PENDING', 'This approval task has already been completed');
  if (jsa.requesterId === actor.id) throw deny('SELF_APPROVAL', 'You cannot review your own JSA');
  const version = await t.query.jsaVersions.findFirst({ where: eq(jsaVersions.id, task.instance.versionId) });
  if (!version) throw notFound('Version');
  if (input.versionId !== task.instance.versionId || jsa.currentVersionId !== task.instance.versionId || !version.locked) {
    throw conflict('STALE_VERSION', 'The JSA has changed since you opened it. Reload and review the current version.');
  }
  const expectedStatus: JsaStatus = task.stage === 'AREA_OWNER' ? 'PENDING_AREA_OWNER' : 'PENDING_SAFETY_OFFICER';
  if (jsa.status !== expectedStatus) throw conflict('INVALID_TRANSITION', `JSA is not awaiting ${task.stage} review`);
  const area = version.areaId ? await t.query.factoryAreas.findFirst({ where: eq(factoryAreas.id, version.areaId) }) : null;
  if (!canReviewStage(actor, task.stage, version.areaId, area?.siteId ?? null)) throw deny('NOT_ASSIGNED_REVIEWER', 'You are not an assigned reviewer for this stage');

  const comment = input.comment?.trim() || null;
  if ((action === 'RETURN' || action === 'REJECT') && (!comment || comment.length < 5)) {
    throw badRequest('COMMENT_REQUIRED', 'A comment of at least 5 characters is required', [{ path: 'comment', code: 'required', message: 'Comment required' }]);
  }

  const now = new Date();
  const ref = { ref: jsa.referenceNo, title: jsa.jobTitle, actor: actor.displayName, comment: comment ?? '' };
  const historyBase = { instanceId: task.instance.id, jsaId: jsa.id, versionId: version.id, versionNo: version.versionNo, stage: task.stage as ApprovalStage, actorId: actor.id, actorName: actor.displayName, comment };
  const completeTask = (decision: 'APPROVED' | 'RETURNED' | 'REJECTED') =>
    t.update(approvalTasks).set({ status: 'COMPLETED', decision, actedById: actor.id, comment, completedAt: now })
      .where(and(eq(approvalTasks.id, taskId), eq(approvalTasks.status, 'PENDING'))).returning({ id: approvalTasks.id });
  const bump = { rowVersion: jsa.rowVersion + 1, updatedAt: now };

  if (action === 'RETURN' || action === 'REJECT') {
    const decision = action === 'RETURN' ? 'RETURNED' : 'REJECTED';
    const done = await completeTask(decision);
    if (done.length !== 1) throw conflict('TASK_NOT_PENDING', 'This approval task has already been completed');
    await t.update(approvalInstances).set({ status: decision, completedAt: now }).where(eq(approvalInstances.id, task.instance.id));
    await t.update(jsas).set({ status: decision, ...bump }).where(eq(jsas.id, jsa.id));
    await t.insert(approvalHistory).values({ ...historyBase, decision });
    await recordStatus(t, jsa.id, jsa.status, decision, version.versionNo, actor.id, comment);
    await notify(t, [jsa.requesterId], action === 'RETURN' ? 'REVISION_REQUESTED' : 'JSA_REJECTED', jsa.id, ref);
    await audit(t, { action: `REVIEW_${action}`, entityType: 'JSA', entityId: jsa.id, reason: comment, metadata: { stage: task.stage, versionNo: version.versionNo, taskId } });
    return { status: decision };
  }

  // ── APPROVE ──
  const { steps } = await getWorkflowSteps(t);
  if (task.stage === 'AREA_OWNER') {
    const sos = await resolveSafetyOfficers(t, area?.siteId ?? null, jsa.requesterId);
    if (!sos.length) throw unprocessable('NO_SAFETY_OFFICER', 'No eligible Safety Officer is configured for this site');
    const done = await completeTask('APPROVED');
    if (done.length !== 1) throw conflict('TASK_NOT_PENDING', 'This approval task has already been completed');
    const soStep = steps.find((s) => s.stage === 'SAFETY_OFFICER')!;
    await t.insert(approvalTasks).values({ instanceId: task.instance.id, workflowStepId: soStep.id, stage: 'SAFETY_OFFICER', assigneeId: sos[0] });
    await t.update(approvalInstances).set({ currentStepOrder: soStep.stepOrder }).where(eq(approvalInstances.id, task.instance.id));
    await t.update(jsas).set({ status: 'PENDING_SAFETY_OFFICER', ...bump }).where(eq(jsas.id, jsa.id));
    await t.insert(approvalHistory).values({ ...historyBase, decision: 'APPROVED' });
    await recordStatus(t, jsa.id, jsa.status, 'PENDING_SAFETY_OFFICER', version.versionNo, actor.id, comment);
    await notify(t, sos, 'REVIEW_REQUIRED_SAFETY_OFFICER', jsa.id, ref);
    await notify(t, [jsa.requesterId], 'AREA_OWNER_APPROVED', jsa.id, ref);
    await audit(t, { action: 'REVIEW_APPROVE', entityType: 'JSA', entityId: jsa.id, reason: comment, metadata: { stage: 'AREA_OWNER', versionNo: version.versionNo, taskId } });
    return { status: 'PENDING_SAFETY_OFFICER' as const };
  }

  // Safety Officer final approval — prerequisites
  const aoApproved = await t.select({ id: approvalTasks.id }).from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, task.instance.id), eq(approvalTasks.stage, 'AREA_OWNER'), eq(approvalTasks.decision, 'APPROVED')));
  if (!aoApproved.length) throw conflict('AREA_OWNER_APPROVAL_MISSING', 'Area Owner approval is required before Safety Officer approval');

  const problems: { code: string; message: string; params?: Record<string, unknown> }[] = [];
  const { content } = await loadVersionContent(t, version.id);
  const matrix = version.riskMatrixVersionId ? await loadMatrix(version.riskMatrixVersionId, t) : null;
  const settings = await getSettings(t);
  if (!matrix) problems.push({ code: 'RISK_MATRIX_MISSING', message: 'Risk matrix version is missing' });
  else {
    if (settings.enforceValidatedRiskMatrix && !matrix.isValidated) problems.push({ code: 'RISK_MATRIX_NOT_VALIDATED', message: 'The risk matrix used has not been validated by a Safety Administrator' });
    const rule = matrix.rule;
    const maxResidual = Math.max(0, ...content.steps.flatMap((s) => s.hazards.map((h) => h.residual?.score ?? 0)));
    if (rule?.blockFinalApproval && maxResidual > rule.maxAcceptableResidualScore) {
      problems.push({ code: 'RESIDUAL_RISK_NOT_ACCEPTABLE', message: `Residual risk score ${maxResidual} exceeds acceptance limit ${rule.maxAcceptableResidualScore}`, params: { score: maxResidual, max: rule.maxAcceptableResidualScore } });
    }
  }
  if (!version.plannedStart || !version.plannedEnd || version.plannedEnd <= now) problems.push({ code: 'WORK_PERIOD_ENDED', message: 'The planned work period has already ended' });
  // Permit evidence verification
  const pts = await t.select().from(permitTypes);
  const verifiedIds = new Set(input.verifiedPermitRefIds ?? []);
  const permitRefs = await t.select().from(jsaPermitReferences).where(eq(jsaPermitReferences.versionId, version.id));
  const toVerify: string[] = [];
  for (const p of permitRefs) {
    const pt = pts.find((x) => x.id === p.permitTypeId);
    if (pt?.requiresSafetyVerification) {
      if (!verifiedIds.has(p.id)) problems.push({ code: 'PERMIT_NOT_VERIFIED', message: `${pt.nameEn} permit evidence must be verified`, params: { permitRefId: p.id, permit: pt.code } });
      else toVerify.push(p.id);
    } else if (verifiedIds.has(p.id)) toVerify.push(p.id);
  }
  if (problems.length) {
    auditAsync({ action: 'REVIEW_APPROVE', entityType: 'JSA', entityId: jsa.id, result: 'FAILURE', reason: problems.map((p) => p.code).join(','), metadata: { stage: 'SAFETY_OFFICER' } });
    throw unprocessable('APPROVAL_PREREQUISITES_FAILED', 'Final approval prerequisites are not satisfied', { problems });
  }

  const done = await completeTask('APPROVED');
  if (done.length !== 1) throw conflict('TASK_NOT_PENDING', 'This approval task has already been completed');
  for (const id of toVerify) await t.insert(jsaPermitVerifications).values({ permitRefId: id, verifiedById: actor.id, note: 'Verified at final approval' });
  const validity = await getValiditySettings(t);
  const { validFrom, validUntil } = calculateValidity(validity, version.plannedStart!, version.plannedEnd!, now);
  await t.update(approvalInstances).set({ status: 'APPROVED', completedAt: now }).where(eq(approvalInstances.id, task.instance.id));
  await t.update(jsas).set({
    status: 'APPROVED', approvedVersionId: version.id, approvedAt: now, validFrom, validUntil, expiryReminderSentAt: null, ...bump,
  }).where(eq(jsas.id, jsa.id));
  await t.insert(approvalHistory).values({ ...historyBase, decision: 'APPROVED', metadata: { final: true, validFrom, validUntil, verifiedPermitRefIds: toVerify } });
  await recordStatus(t, jsa.id, jsa.status, 'APPROVED', version.versionNo, actor.id, comment);
  const aoTask = await t.select({ actedById: approvalTasks.actedById }).from(approvalTasks)
    .where(and(eq(approvalTasks.instanceId, task.instance.id), eq(approvalTasks.stage, 'AREA_OWNER')));
  await notify(t, [jsa.requesterId, ...aoTask.map((a) => a.actedById)], 'JSA_APPROVED', jsa.id, { ...ref, validUntil: validUntil.toISOString() });
  await audit(t, { action: 'REVIEW_APPROVE', entityType: 'JSA', entityId: jsa.id, reason: comment, metadata: { stage: 'SAFETY_OFFICER', final: true, versionNo: version.versionNo, taskId, validUntil } });
  return { status: 'APPROVED' as const, validFrom, validUntil };
}

/** Cancel the active approval instance (if any) and its pending task. */
export async function cancelActiveInstance(t: DbOrTx, jsaId: string) {
  const inst = await t.query.approvalInstances.findFirst({ where: and(eq(approvalInstances.jsaId, jsaId), eq(approvalInstances.status, 'IN_PROGRESS')) });
  if (!inst) return { reviewerIds: [] as string[] };
  const pending = await t.select().from(approvalTasks).where(and(eq(approvalTasks.instanceId, inst.id), eq(approvalTasks.status, 'PENDING')));
  await t.update(approvalTasks).set({ status: 'CANCELLED', decision: 'CANCELLED', completedAt: new Date() }).where(and(eq(approvalTasks.instanceId, inst.id), eq(approvalTasks.status, 'PENDING')));
  await t.update(approvalInstances).set({ status: 'CANCELLED', completedAt: new Date() }).where(eq(approvalInstances.id, inst.id));
  return { reviewerIds: pending.map((p) => p.assigneeId).filter((x): x is string => !!x), instanceId: inst.id };
}

export { approvalHistory, jsaStatusHistory };
