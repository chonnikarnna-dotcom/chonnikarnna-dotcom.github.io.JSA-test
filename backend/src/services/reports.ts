/** Dashboard and report aggregations — always computed from the database and scoped by record-level visibility. */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, sql, SQL } from 'drizzle-orm';
import { db } from '../db/client';
import {
  approvalHistory, approvalInstances, approvalTasks, contractorCompanies, departments, factoryAreas, factorySites, jobTypes, jsas, users,
} from '../db/schema';
import { AuthUser, hasRole, jsaVisibility } from '../lib/authz';
import { getSettings } from './settings';
import { escalationLevelSql } from './jsa';

const count = sql<number>`count(*)::int`;

/** Pending approval tasks the user is eligible to act on (excludes own JSAs). */
export function inboxWhere(u: AuthUser): SQL | null {
  const parts: SQL[] = [];
  if (hasRole(u, 'AREA_OWNER') && u.ownedAreaIds.length) {
    parts.push(and(eq(approvalTasks.stage, 'AREA_OWNER'), inArray(jsas.areaId, u.ownedAreaIds))!);
  }
  if (hasRole(u, 'SAFETY_OFFICER')) {
    if (u.safetySiteScope === 'ALL') parts.push(eq(approvalTasks.stage, 'SAFETY_OFFICER'));
    else if (u.safetySiteScope.length) parts.push(and(eq(approvalTasks.stage, 'SAFETY_OFFICER'), inArray(factoryAreas.siteId, u.safetySiteScope))!);
  }
  if (!parts.length) return null;
  return and(eq(approvalTasks.status, 'PENDING'), eq(approvalInstances.status, 'IN_PROGRESS'), ne(jsas.requesterId, u.id), sql`(${sql.join(parts, sql` OR `)})`)!;
}

export async function getInbox(u: AuthUser) {
  const where = inboxWhere(u);
  if (!where) return [];
  return db.select({
    taskId: approvalTasks.id, stage: approvalTasks.stage, taskCreatedAt: approvalTasks.createdAt, assigneeId: approvalTasks.assigneeId,
    versionId: approvalInstances.versionId,
    jsaId: jsas.id, referenceNo: jsas.referenceNo, version: jsas.currentVersionNo, jobTitle: jsas.jobTitle, status: jsas.status,
    plannedStart: jsas.plannedStart, plannedEnd: jsas.plannedEnd, riskLevelCode: jsas.riskLevelCode, maxResidualRiskScore: jsas.maxResidualRiskScore,
    isHighRiskWork: jsas.isHighRiskWork, submittedAt: jsas.submittedAt,
    requesterName: users.displayName, contractorName: contractorCompanies.name,
    areaNameEn: factoryAreas.nameEn, areaNameTh: factoryAreas.nameTh,
  }).from(approvalTasks)
    .innerJoin(approvalInstances, eq(approvalInstances.id, approvalTasks.instanceId))
    .innerJoin(jsas, eq(jsas.id, approvalInstances.jsaId))
    .innerJoin(users, eq(users.id, jsas.requesterId))
    .leftJoin(contractorCompanies, eq(contractorCompanies.id, jsas.contractorCompanyId))
    .leftJoin(factoryAreas, eq(factoryAreas.id, jsas.areaId))
    .where(where)
    .orderBy(asc(approvalTasks.createdAt));
}

export async function getDashboard(u: AuthUser) {
  const vis = jsaVisibility(u);
  const settings = await getSettings();
  const tz = settings.timezone;
  const now = new Date();
  const soon = new Date(now.getTime() + settings.dashboardExpiringSoonHours * 3600_000);
  const week = new Date(now.getTime() + 7 * 86_400_000);

  const byStatusRows = await db.select({ status: jsas.status, n: count }).from(jsas).where(vis).groupBy(jsas.status);
  const byStatus = Object.fromEntries(byStatusRows.map((r) => [r.status, r.n])) as Record<string, number>;
  const [{ n: expiringSoon }] = await db.select({ n: count }).from(jsas).where(and(vis, eq(jsas.status, 'APPROVED'), gte(jsas.validUntil, now), lte(jsas.validUntil, soon)));
  const highRiskWhere = and(vis, inArray(jsas.status, ['PENDING_AREA_OWNER', 'PENDING_SAFETY_OFFICER', 'APPROVED']), sql`(${jsas.isHighRiskWork} OR ${escalationLevelSql()})`);
  const [{ n: highRisk }] = await db.select({ n: count }).from(jsas).where(highRiskWhere);
  const total = byStatusRows.reduce((a, r) => a + r.n, 0);

  const listCols = {
    id: jsas.id, referenceNo: jsas.referenceNo, jobTitle: jsas.jobTitle, status: jsas.status, riskLevelCode: jsas.riskLevelCode,
    plannedStart: jsas.plannedStart, plannedEnd: jsas.plannedEnd, submittedAt: jsas.submittedAt, validUntil: jsas.validUntil,
    updatedAt: jsas.updatedAt, isHighRiskWork: jsas.isHighRiskWork, areaNameEn: factoryAreas.nameEn, areaNameTh: factoryAreas.nameTh,
    requesterName: users.displayName,
  };
  const base = () => db.select(listCols).from(jsas).innerJoin(users, eq(users.id, jsas.requesterId)).leftJoin(factoryAreas, eq(factoryAreas.id, jsas.areaId));
  const recent = await base().where(and(vis, isNotNull(jsas.submittedAt))).orderBy(desc(jsas.submittedAt)).limit(8);
  const upcoming = await base().where(and(vis, eq(jsas.status, 'APPROVED'), gte(jsas.plannedStart, now), lte(jsas.plannedStart, week))).orderBy(asc(jsas.plannedStart)).limit(8);
  const highRiskList = await base().where(highRiskWhere).orderBy(desc(jsas.maxResidualRiskScore)).limit(8);
  const expiringList = await base().where(and(vis, eq(jsas.status, 'APPROVED'), gte(jsas.validUntil, now), lte(jsas.validUntil, soon))).orderBy(asc(jsas.validUntil)).limit(8);

  // My pending actions
  const inbox = await getInbox(u);
  const myReturned = await base().where(and(eq(jsas.requesterId, u.id), eq(jsas.status, 'RETURNED'), sql`${jsas.deletedAt} IS NULL`)).orderBy(desc(jsas.updatedAt)).limit(10);
  const myDrafts = await base().where(and(eq(jsas.requesterId, u.id), eq(jsas.status, 'DRAFT'), sql`${jsas.deletedAt} IS NULL`)).orderBy(desc(jsas.updatedAt)).limit(10);

  // Turnaround (submitted → approved), last 90 days
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [ta] = await db.select({
    avgHours: sql<number | null>`round(avg(extract(epoch from (${jsas.approvedAt} - ${jsas.submittedAt})) / 3600)::numeric, 1)::float`,
    n: count,
  }).from(jsas).where(and(vis, isNotNull(jsas.approvedAt), gte(jsas.approvedAt, since)));
  const stageTa = await db.select({
    stage: approvalTasks.stage,
    avgHours: sql<number | null>`round(avg(extract(epoch from (${approvalTasks.completedAt} - ${approvalTasks.createdAt})) / 3600)::numeric, 1)::float`,
    n: count,
  }).from(approvalTasks).innerJoin(approvalInstances, eq(approvalInstances.id, approvalTasks.instanceId)).innerJoin(jsas, eq(jsas.id, approvalInstances.jsaId))
    .where(and(vis, eq(approvalTasks.status, 'COMPLETED'), gte(approvalTasks.completedAt, since))).groupBy(approvalTasks.stage);

  const monthExpr = sql<string>`to_char(date_trunc('month', ${jsas.submittedAt} AT TIME ZONE ${tz}), 'YYYY-MM')`;
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
  const byMonth = await db.select({ month: monthExpr, n: count }).from(jsas).where(and(vis, gte(jsas.submittedAt, yearAgo))).groupBy(sql`1`).orderBy(sql`1`);
  const nonDraft = and(vis, isNotNull(jsas.submittedAt));
  const byDepartment = await db.select({ id: departments.id, nameEn: sql<string>`coalesce(${departments.nameEn}, 'Contractor / unspecified')`, nameTh: sql<string>`coalesce(${departments.nameTh}, 'ผู้รับเหมา / ไม่ระบุ')`, n: count })
    .from(jsas).leftJoin(departments, eq(departments.id, jsas.departmentId)).where(nonDraft).groupBy(departments.id, departments.nameEn, departments.nameTh).orderBy(desc(count));
  const byJobType = await db.select({ id: jobTypes.id, nameEn: sql<string>`coalesce(${jobTypes.nameEn}, 'Unspecified')`, nameTh: sql<string>`coalesce(${jobTypes.nameTh}, 'ไม่ระบุ')`, n: count })
    .from(jsas).leftJoin(jobTypes, eq(jobTypes.id, jsas.jobTypeId)).where(nonDraft).groupBy(jobTypes.id, jobTypes.nameEn, jobTypes.nameTh).orderBy(desc(count));
  const riskDistribution = await db.select({ levelCode: jsas.riskLevelCode, n: count }).from(jsas).where(and(nonDraft, isNotNull(jsas.riskLevelCode))).groupBy(jsas.riskLevelCode);
  const pendingByReviewer = await db.select({ reviewerId: approvalTasks.assigneeId, reviewerName: users.displayName, stage: approvalTasks.stage, n: count })
    .from(approvalTasks).innerJoin(approvalInstances, eq(approvalInstances.id, approvalTasks.instanceId)).innerJoin(jsas, eq(jsas.id, approvalInstances.jsaId))
    .leftJoin(users, eq(users.id, approvalTasks.assigneeId))
    .where(and(vis, eq(approvalTasks.status, 'PENDING'))).groupBy(approvalTasks.assigneeId, users.displayName, approvalTasks.stage).orderBy(desc(count));

  return {
    generatedAt: now,
    cards: {
      total, draft: byStatus.DRAFT ?? 0, pendingAreaOwner: byStatus.PENDING_AREA_OWNER ?? 0, pendingSafetyOfficer: byStatus.PENDING_SAFETY_OFFICER ?? 0,
      approved: byStatus.APPROVED ?? 0, returned: byStatus.RETURNED ?? 0, rejected: byStatus.REJECTED ?? 0, cancelled: byStatus.CANCELLED ?? 0,
      completed: byStatus.COMPLETED ?? 0, expired: byStatus.EXPIRED ?? 0, expiringSoon, highRiskAttention: highRisk,
    },
    expiringSoonHours: settings.dashboardExpiringSoonHours,
    overdueReviewHours: settings.overdueReviewHours,
    recent, upcoming, highRiskList, expiringList,
    myActions: { reviews: inbox.slice(0, 10), reviewCount: inbox.length, returned: myReturned, drafts: myDrafts },
    turnaround: { avgHours: ta?.avgHours ?? null, approvedCount: ta?.n ?? 0, byStage: stageTa },
    byMonth, byDepartment, byJobType, riskDistribution, pendingByReviewer,
  };
}

// ───────────────────────────── Reports ─────────────────────────────
export type ReportRange = { from: Date; to: Date };

export async function getReports(u: AuthUser, r: ReportRange) {
  const vis = jsaVisibility(u);
  const settings = await getSettings();
  const tz = settings.timezone;
  const inRange = and(vis, isNotNull(jsas.submittedAt), gte(jsas.submittedAt, r.from), lte(jsas.submittedAt, r.to));
  const monthExpr = sql<string>`to_char(date_trunc('month', ${jsas.submittedAt} AT TIME ZONE ${tz}), 'YYYY-MM')`;
  const trends = await db.select({
    month: monthExpr, submitted: count,
    approved: sql<number>`count(*) FILTER (WHERE ${jsas.approvedAt} IS NOT NULL)::int`,
    rejected: sql<number>`count(*) FILTER (WHERE ${jsas.status} = 'REJECTED')::int`,
    cancelled: sql<number>`count(*) FILTER (WHERE ${jsas.status} = 'CANCELLED')::int`,
  }).from(jsas).where(inRange).groupBy(sql`1`).orderBy(sql`1`);

  const hoursExpr = sql`extract(epoch from (${approvalTasks.completedAt} - ${approvalTasks.createdAt})) / 3600`;
  const turnaroundByStage = await db.select({
    stage: approvalTasks.stage, n: count,
    avgHours: sql<number | null>`round(avg(${hoursExpr})::numeric, 1)::float`,
    medianHours: sql<number | null>`round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${hoursExpr}))::numeric, 1)::float`,
    maxHours: sql<number | null>`round(max(${hoursExpr})::numeric, 1)::float`,
  }).from(approvalTasks).innerJoin(approvalInstances, eq(approvalInstances.id, approvalTasks.instanceId)).innerJoin(jsas, eq(jsas.id, approvalInstances.jsaId))
    .where(and(vis, eq(approvalTasks.status, 'COMPLETED'), gte(approvalTasks.completedAt, r.from), lte(approvalTasks.completedAt, r.to)))
    .groupBy(approvalTasks.stage);
  const [overall] = await db.select({
    n: count,
    avgHours: sql<number | null>`round(avg(extract(epoch from (${jsas.approvedAt} - ${jsas.submittedAt})) / 3600)::numeric, 1)::float`,
  }).from(jsas).where(and(vis, isNotNull(jsas.approvedAt), gte(jsas.approvedAt, r.from), lte(jsas.approvedAt, r.to)));

  const overdueCutoff = new Date(Date.now() - settings.overdueReviewHours * 3600_000);
  const pendingByRole = await db.select({
    stage: approvalTasks.stage, n: count,
    overdue: sql<number>`count(*) FILTER (WHERE ${approvalTasks.createdAt} < ${overdueCutoff})::int`,
  }).from(approvalTasks).innerJoin(approvalInstances, eq(approvalInstances.id, approvalTasks.instanceId)).innerJoin(jsas, eq(jsas.id, approvalInstances.jsaId))
    .where(and(vis, eq(approvalTasks.status, 'PENDING'))).groupBy(approvalTasks.stage);

  const byDepartment = await db.select({ nameEn: sql<string>`coalesce(${departments.nameEn}, '—')`, nameTh: sql<string>`coalesce(${departments.nameTh}, '—')`, n: count })
    .from(jsas).leftJoin(departments, eq(departments.id, jsas.departmentId)).where(inRange).groupBy(departments.nameEn, departments.nameTh).orderBy(desc(count));
  const byContractor = await db.select({ name: sql<string>`coalesce(${contractorCompanies.name}, 'Internal / ภายใน')`, n: count })
    .from(jsas).leftJoin(contractorCompanies, eq(contractorCompanies.id, jsas.contractorCompanyId)).where(inRange).groupBy(contractorCompanies.name).orderBy(desc(count));
  const byArea = await db.select({ nameEn: sql<string>`coalesce(${factoryAreas.nameEn}, '—')`, nameTh: sql<string>`coalesce(${factoryAreas.nameTh}, '—')`, siteEn: factorySites.nameEn, n: count })
    .from(jsas).leftJoin(factoryAreas, eq(factoryAreas.id, jsas.areaId)).leftJoin(factorySites, eq(factorySites.id, factoryAreas.siteId))
    .where(inRange).groupBy(factoryAreas.nameEn, factoryAreas.nameTh, factorySites.nameEn).orderBy(desc(count));
  const byJobType = await db.select({ nameEn: sql<string>`coalesce(${jobTypes.nameEn}, '—')`, nameTh: sql<string>`coalesce(${jobTypes.nameTh}, '—')`, n: count })
    .from(jsas).leftJoin(jobTypes, eq(jobTypes.id, jsas.jobTypeId)).where(inRange).groupBy(jobTypes.nameEn, jobTypes.nameTh).orderBy(desc(count));
  const residualRisk = await db.select({ levelCode: jsas.riskLevelCode, n: count }).from(jsas).where(and(inRange, isNotNull(jsas.riskLevelCode))).groupBy(jsas.riskLevelCode);
  const initialRisk = await db.select({ levelCode: jsas.initialRiskLevelCode, n: count }).from(jsas).where(and(inRange, isNotNull(jsas.initialRiskLevelCode))).groupBy(jsas.initialRiskLevelCode);

  const rejectedReturned = await db.select({
    jsaId: jsas.id, referenceNo: jsas.referenceNo, jobTitle: jsas.jobTitle, versionNo: approvalHistory.versionNo, stage: approvalHistory.stage,
    decision: approvalHistory.decision, actorName: approvalHistory.actorName, comment: approvalHistory.comment, createdAt: approvalHistory.createdAt,
  }).from(approvalHistory).innerJoin(jsas, eq(jsas.id, approvalHistory.jsaId))
    .where(and(vis, inArray(approvalHistory.decision, ['RETURNED', 'REJECTED']), gte(approvalHistory.createdAt, r.from), lte(approvalHistory.createdAt, r.to)))
    .orderBy(desc(approvalHistory.createdAt)).limit(500);

  const soon = new Date(Date.now() + settings.dashboardExpiringSoonHours * 3600_000);
  const expiry = await db.select({
    jsaId: jsas.id, referenceNo: jsas.referenceNo, jobTitle: jsas.jobTitle, status: jsas.status, validUntil: jsas.validUntil,
    areaNameEn: factoryAreas.nameEn, areaNameTh: factoryAreas.nameTh, requesterName: users.displayName,
  }).from(jsas).innerJoin(users, eq(users.id, jsas.requesterId)).leftJoin(factoryAreas, eq(factoryAreas.id, jsas.areaId))
    .where(and(vis, sql`((${jsas.status} = 'EXPIRED' AND ${jsas.validUntil} >= ${r.from} AND ${jsas.validUntil} <= ${r.to}) OR (${jsas.status} = 'APPROVED' AND ${jsas.validUntil} <= ${soon}))`))
    .orderBy(asc(jsas.validUntil)).limit(500);

  const completed = await db.select({
    jsaId: jsas.id, referenceNo: jsas.referenceNo, jobTitle: jsas.jobTitle, completedAt: jsas.completedAt, completionNote: jsas.completionNote,
    areaNameEn: factoryAreas.nameEn, areaNameTh: factoryAreas.nameTh, requesterName: users.displayName,
  }).from(jsas).innerJoin(users, eq(users.id, jsas.requesterId)).leftJoin(factoryAreas, eq(factoryAreas.id, jsas.areaId))
    .where(and(vis, eq(jsas.status, 'COMPLETED'), gte(jsas.completedAt, r.from), lte(jsas.completedAt, r.to)))
    .orderBy(desc(jsas.completedAt)).limit(500);

  return {
    range: r, trends, turnaround: { overall, byStage: turnaroundByStage }, pendingByRole, overdueReviewHours: settings.overdueReviewHours,
    byDepartment, byContractor, byArea, byJobType, risk: { residual: residualRisk, initial: initialRisk },
    rejectedReturned, expiry, completed,
  };
}
