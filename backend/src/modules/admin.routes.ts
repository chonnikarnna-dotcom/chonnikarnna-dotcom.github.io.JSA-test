import { Router } from 'express';
import { z, ZodTypeAny } from 'zod';
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql, SQL } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import * as s from '../db/schema';
import { asyncH, requireAuth, requireRole } from '../middleware/core';
import { audit, verifyAuditChain } from '../lib/audit';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { hashPassword, passwordPolicy } from '../lib/crypto';
import { issueToken } from '../services/auth';
import { config } from '../config';
import { DEFAULT_SETTINGS, getSettings, getValiditySettings, setSetting } from '../services/settings';
import { loadMatrix, validateMatrixDefinition } from '../services/risk';
import { NOTIFICATION_TYPES } from '../services/notifications';
import { hasRole } from '../lib/authz';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

const code = z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_.-]+$/, 'Use letters, digits, _ . -');
const name = z.string().trim().min(1).max(200);

/** Generic master-data CRUD (no hard delete of referenced rows; deactivate instead). */
function crud(path: string, table: PgTable & { id: any; isActive?: any }, schema: z.AnyZodObject, orderCol: any, entity: string) {
  adminRouter.get(path, asyncH(async (_req, res) => { res.json({ items: await db.select().from(table).orderBy(asc(orderCol)) }); }));
  adminRouter.post(path, asyncH(async (req, res) => {
    const data = schema.parse(req.body);
    const row = await db.transaction(async (t) => {
      const [r] = await t.insert(table).values(data as any).returning();
      await audit(t, { action: 'CONFIG_CREATE', entityType: entity, entityId: (r as any).id, metadata: data });
      return r;
    });
    res.status(201).json(row);
  }));
  adminRouter.put(`${path}/:id`, asyncH(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const data = schema.partial().parse(req.body);
    const row = await db.transaction(async (t) => {
      const [before] = await t.select().from(table).where(eq(table.id, id));
      if (!before) throw notFound(entity);
      const [r] = await t.update(table).set(data as any).where(eq(table.id, id)).returning();
      await audit(t, { action: 'CONFIG_UPDATE', entityType: entity, entityId: id, metadata: { before, after: data } });
      return r;
    });
    res.json(row);
  }));
}

crud('/departments', s.departments, z.object({ code, nameEn: name, nameTh: name, isActive: z.boolean().default(true) }), s.departments.code, 'DEPARTMENT');
crud('/contractor-companies', s.contractorCompanies, z.object({
  code, name, taxId: z.string().max(30).nullable().optional(), contactName: z.string().max(200).nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(), contactEmail: z.string().email().max(255).nullable().optional().or(z.literal('').transform(() => null)),
  isActive: z.boolean().default(true),
}), s.contractorCompanies.name, 'CONTRACTOR_COMPANY');
crud('/sites', s.factorySites, z.object({ code, nameEn: name, nameTh: name, isActive: z.boolean().default(true) }), s.factorySites.code, 'FACTORY_SITE');
crud('/areas', s.factoryAreas, z.object({ siteId: z.string().uuid(), code, nameEn: name, nameTh: name, building: z.string().max(100).nullable().optional(), isActive: z.boolean().default(true) }), s.factoryAreas.code, 'FACTORY_AREA');
crud('/job-types', s.jobTypes, z.object({ code, nameEn: name, nameTh: name, defaultPermitCodes: z.array(z.string().max(50)).default([]), isActive: z.boolean().default(true) }), s.jobTypes.code, 'JOB_TYPE');
crud('/hazards', s.hazardMaster, z.object({ code, category: name, nameEn: name, nameTh: name, isActive: z.boolean().default(true) }), s.hazardMaster.code, 'HAZARD_MASTER');
crud('/controls', s.controlMeasureMaster, z.object({ code, hierarchy: z.enum(['ELIMINATION', 'SUBSTITUTION', 'ENGINEERING', 'ADMINISTRATIVE', 'PPE']), nameEn: name, nameTh: name, isActive: z.boolean().default(true) }), s.controlMeasureMaster.code, 'CONTROL_MASTER');
const followUp = z.object({ key: z.string().regex(/^[a-z0-9_]+$/i).max(50), en: name, th: name, type: z.enum(['boolean', 'text']), required: z.boolean() });
crud('/permit-types', s.permitTypes, z.object({
  code, nameEn: name, nameTh: name, isHighRisk: z.boolean().default(true), requiresPermitReference: z.boolean().default(true),
  requiresAttachment: z.boolean().default(false), requiresSafetyVerification: z.boolean().default(true),
  followUpQuestions: z.array(followUp).max(20).default([]), guidanceEn: z.string().max(2000).nullable().optional(),
  guidanceTh: z.string().max(2000).nullable().optional(), isActive: z.boolean().default(true), sortOrder: z.number().int().default(0),
}), s.permitTypes.sortOrder, 'PERMIT_TYPE');

// ───────────────────────────── Users ─────────────────────────────
const ROLE_CODES = ['REQUESTER', 'AREA_OWNER', 'SAFETY_OFFICER', 'ADMIN'] as const;

adminRouter.get('/roles', asyncH(async (_req, res) => {
  const rs = await db.select().from(s.roles).orderBy(asc(s.roles.code));
  const perms = await db.select({ roleId: s.rolePermissions.roleId, code: s.permissions.code, description: s.permissions.description })
    .from(s.rolePermissions).innerJoin(s.permissions, eq(s.permissions.id, s.rolePermissions.permissionId));
  res.json({ items: rs.map((r) => ({ ...r, permissions: perms.filter((p) => p.roleId === r.id).map(({ code: c, description }) => ({ code: c, description })) })) });
}));

adminRouter.get('/users', asyncH(async (req, res) => {
  const q = z.object({ q: z.string().max(100).optional(), role: z.enum(ROLE_CODES).optional(), active: z.enum(['true', 'false']).optional() }).parse(req.query);
  const conds: SQL[] = [];
  if (q.q) { const like = `%${q.q}%`; conds.push(or(ilike(s.users.displayName, like), ilike(s.users.email, like), ilike(s.users.username, like))!); }
  if (q.active) conds.push(eq(s.users.isActive, q.active === 'true'));
  if (q.role) conds.push(sql`${s.users.id} IN (SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code = ${q.role})`);
  const rows = await db.query.users.findMany({
    where: conds.length ? and(...conds) : undefined, orderBy: asc(s.users.displayName),
    columns: { passwordHash: false }, with: { roles: { with: { role: true } }, department: true, contractorCompany: true },
  });
  res.json({ items: rows.map((u) => ({ ...u, hasPassword: undefined, roles: u.roles.map((r) => r.role.code), invitationPending: !u.activatedAt && !!u.invitedAt })) });
}));

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  username: z.string().trim().toLowerCase().min(3).max(100).regex(/^[a-z0-9_.-]+$/),
  displayName: name,
  phone: z.string().max(50).nullable().optional(),
  userType: z.enum(['EMPLOYEE', 'CONTRACTOR']),
  departmentId: z.string().uuid().nullable().optional(),
  contractorCompanyId: z.string().uuid().nullable().optional(),
  preferredLanguage: z.enum(['th', 'en']).default('th'),
  roles: z.array(z.enum(ROLE_CODES)).min(1),
  isActive: z.boolean().default(true),
  password: z.string().max(200).optional(),
  sendInvite: z.boolean().default(true),
});

async function setRoles(t: any, userId: string, codes: string[]) {
  const rs = await t.select().from(s.roles).where(inArray(s.roles.code, codes));
  await t.delete(s.userRoles).where(eq(s.userRoles.userId, userId));
  if (rs.length) await t.insert(s.userRoles).values(rs.map((r: any) => ({ userId, roleId: r.id })));
}

function checkUserConsistency(u: { userType?: string; contractorCompanyId?: string | null; roles?: string[] }) {
  if (u.userType === 'CONTRACTOR' && !u.contractorCompanyId) throw badRequest('CONTRACTOR_COMPANY_REQUIRED', 'Contractor users must belong to a contractor company');
  if (u.userType === 'CONTRACTOR' && u.roles?.some((r) => r !== 'REQUESTER')) throw badRequest('CONTRACTOR_ROLE_RESTRICTED', 'Contractors can only hold the Requester role');
}

adminRouter.post('/users', asyncH(async (req, res) => {
  const body = userSchema.parse(req.body);
  checkUserConsistency(body);
  if (body.password && !passwordPolicy(body.password)) throw badRequest('WEAK_PASSWORD', 'Password must be at least 10 characters and contain letters and digits');
  const result = await db.transaction(async (t) => {
    const [u] = await t.insert(s.users).values({
      email: body.email, username: body.username, displayName: body.displayName, phone: body.phone ?? null, userType: body.userType,
      departmentId: body.departmentId ?? null, contractorCompanyId: body.userType === 'CONTRACTOR' ? body.contractorCompanyId! : null,
      preferredLanguage: body.preferredLanguage, isActive: body.isActive,
      passwordHash: body.password ? await hashPassword(body.password) : null,
      invitedAt: body.password ? null : new Date(), activatedAt: body.password ? new Date() : null,
    }).returning();
    await setRoles(t, u.id, body.roles);
    await audit(t, { action: 'USER_CREATE', entityType: 'USER', entityId: u.id, metadata: { email: u.email, roles: body.roles, userType: u.userType } });
    return u;
  });
  let activationLink: string | undefined;
  if (!body.password) {
    const token = await issueToken(result.id, 'INVITE', 72);
    activationLink = `${config.APP_BASE_URL}/activate?token=${token}`;
  }
  res.status(201).json({ id: result.id, activationLink });
}));

adminRouter.put('/users/:id', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = userSchema.omit({ password: true, sendInvite: true }).partial().parse(req.body);
  const existing = await db.query.users.findFirst({ where: eq(s.users.id, id), with: { roles: { with: { role: true } } } });
  if (!existing) throw notFound('User');
  const merged = { userType: body.userType ?? existing.userType, contractorCompanyId: body.contractorCompanyId !== undefined ? body.contractorCompanyId : existing.contractorCompanyId, roles: body.roles ?? existing.roles.map((r) => r.role.code) };
  checkUserConsistency(merged);
  if (id === req.user!.id && (body.isActive === false || (body.roles && !body.roles.includes('ADMIN')))) {
    throw conflict('SELF_LOCKOUT', 'You cannot deactivate yourself or remove your own administrator role');
  }
  await db.transaction(async (t) => {
    const { roles: newRoles, ...fields } = body;
    if (Object.keys(fields).length) await t.update(s.users).set({ ...fields, contractorCompanyId: merged.userType === 'CONTRACTOR' ? merged.contractorCompanyId : null }).where(eq(s.users.id, id));
    if (newRoles) await setRoles(t, id, newRoles);
    if (body.isActive === false) await t.delete(s.sessions).where(eq(s.sessions.userId, id));
    await audit(t, { action: body.isActive === false ? 'USER_DEACTIVATE' : 'USER_UPDATE', entityType: 'USER', entityId: id, metadata: { changes: body, previousRoles: existing.roles.map((r) => r.role.code) } });
  });
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/invitation', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const u = await db.query.users.findFirst({ where: eq(s.users.id, id) });
  if (!u) throw notFound('User');
  const kind = u.passwordHash ? 'PASSWORD_RESET' : 'INVITE';
  const token = await issueToken(id, kind, kind === 'INVITE' ? 72 : 2);
  if (kind === 'INVITE') await db.update(s.users).set({ invitedAt: new Date() }).where(eq(s.users.id, id));
  await audit(db, { action: kind === 'INVITE' ? 'USER_INVITE_ISSUED' : 'USER_RESET_LINK_ISSUED', entityType: 'USER', entityId: id });
  res.json({ link: `${config.APP_BASE_URL}/${kind === 'INVITE' ? 'activate' : 'reset-password'}?token=${token}`, kind });
}));

// ───────────────────────── Assignments ─────────────────────────
async function assertUserHasRole(userId: string, role: string) {
  const r = await db.select({ c: sql<number>`count(*)::int` }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(and(eq(s.userRoles.userId, userId), eq(s.roles.code, role)));
  if (!r[0].c) throw unprocessable('ROLE_REQUIRED', `User must have the ${role} role`);
}

adminRouter.get('/area-owners', asyncH(async (_req, res) => {
  res.json({ items: await db.query.areaOwnerAssignments.findMany({ with: { area: { with: { site: true } }, user: { columns: { id: true, displayName: true, email: true, isActive: true } } }, orderBy: asc(s.areaOwnerAssignments.createdAt) }) });
}));
adminRouter.post('/area-owners', asyncH(async (req, res) => {
  const body = z.object({ areaId: z.string().uuid(), userId: z.string().uuid(), isBackup: z.boolean().default(false) }).parse(req.body);
  await assertUserHasRole(body.userId, 'AREA_OWNER');
  const row = await db.transaction(async (t) => {
    const [r] = await t.insert(s.areaOwnerAssignments).values(body).onConflictDoUpdate({ target: [s.areaOwnerAssignments.areaId, s.areaOwnerAssignments.userId], set: { isActive: true, isBackup: body.isBackup } }).returning();
    await audit(t, { action: 'ASSIGN_AREA_OWNER', entityType: 'AREA_OWNER_ASSIGNMENT', entityId: r.id, metadata: body });
    return r;
  });
  res.status(201).json(row);
}));
adminRouter.put('/area-owners/:id', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ isBackup: z.boolean().optional(), isActive: z.boolean().optional() }).parse(req.body);
  await db.transaction(async (t) => {
    const r = await t.update(s.areaOwnerAssignments).set(body).where(eq(s.areaOwnerAssignments.id, id)).returning();
    if (!r.length) throw notFound('Assignment');
    await audit(t, { action: 'UPDATE_AREA_OWNER', entityType: 'AREA_OWNER_ASSIGNMENT', entityId: id, metadata: body });
  });
  res.json({ ok: true });
}));

adminRouter.get('/safety-officers', asyncH(async (_req, res) => {
  res.json({ items: await db.query.safetyOfficerAssignments.findMany({ with: { site: true, user: { columns: { id: true, displayName: true, email: true, isActive: true } } }, orderBy: asc(s.safetyOfficerAssignments.createdAt) }) });
}));
adminRouter.post('/safety-officers', asyncH(async (req, res) => {
  const body = z.object({ siteId: z.string().uuid().nullable(), userId: z.string().uuid(), isBackup: z.boolean().default(false) }).parse(req.body);
  await assertUserHasRole(body.userId, 'SAFETY_OFFICER');
  const row = await db.transaction(async (t) => {
    const [r] = await t.insert(s.safetyOfficerAssignments).values(body).returning();
    await audit(t, { action: 'ASSIGN_SAFETY_OFFICER', entityType: 'SAFETY_OFFICER_ASSIGNMENT', entityId: r.id, metadata: body });
    return r;
  });
  res.status(201).json(row);
}));
adminRouter.put('/safety-officers/:id', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ isBackup: z.boolean().optional(), isActive: z.boolean().optional() }).parse(req.body);
  await db.transaction(async (t) => {
    const r = await t.update(s.safetyOfficerAssignments).set(body).where(eq(s.safetyOfficerAssignments.id, id)).returning();
    if (!r.length) throw notFound('Assignment');
    await audit(t, { action: 'UPDATE_SAFETY_OFFICER', entityType: 'SAFETY_OFFICER_ASSIGNMENT', entityId: id, metadata: body });
  });
  res.json({ ok: true });
}));

// ───────────────────────── Risk matrix ─────────────────────────
adminRouter.get('/risk-matrices', asyncH(async (_req, res) => {
  const ms = await db.select().from(s.riskMatrixVersions).orderBy(desc(s.riskMatrixVersions.versionNo));
  res.json({ items: await Promise.all(ms.map((m) => loadMatrix(m.id))) });
}));

adminRouter.post('/risk-matrices/:id/clone', asyncH(async (req, res) => {
  const src = await loadMatrix(z.string().uuid().parse(req.params.id));
  if (!src) throw notFound('Risk matrix');
  const created = await db.transaction(async (t) => {
    const [{ max }] = await t.select({ max: sql<number>`coalesce(max(version_no),0)::int` }).from(s.riskMatrixVersions);
    const [m] = await t.insert(s.riskMatrixVersions).values({ versionNo: max + 1, name: `${src.name} (draft v${max + 1})`, status: 'DRAFT', size: src.size, scoreMethod: src.scoreMethod, severityLabels: src.severityLabels, likelihoodLabels: src.likelihoodLabels }).returning();
    if (src.levels.length) await t.insert(s.riskMatrixLevels).values(src.levels.map(({ id: _i, matrixVersionId: _m, ...l }) => ({ ...l, matrixVersionId: m.id })));
    if (src.rule) { const { id: _i, matrixVersionId: _m, ...r } = src.rule; await t.insert(s.riskAcceptanceRules).values({ ...r, matrixVersionId: m.id }); }
    await audit(t, { action: 'RISK_MATRIX_CLONE', entityType: 'RISK_MATRIX', entityId: m.id, metadata: { from: src.versionNo } });
    return m;
  });
  res.status(201).json(created);
}));

const scaleLabel = z.object({ value: z.number().int().min(1).max(10), en: name, th: name, descriptionEn: z.string().max(500).optional(), descriptionTh: z.string().max(500).optional() });
const levelSchema = z.object({ code: z.string().regex(/^[A-Z_]+$/).max(30), nameEn: name, nameTh: name, minScore: z.number().int().min(0), maxScore: z.number().int().min(0), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), sortOrder: z.number().int(), requiresEscalation: z.boolean() });
const ruleSchema = z.object({ maxAcceptableResidualScore: z.number().int().min(1), blockSubmission: z.boolean(), blockFinalApproval: z.boolean(), requireResidualLowerOrEqual: z.boolean(), description: z.string().max(1000).nullable().optional() });

adminRouter.put('/risk-matrices/:id', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({
    name: name.optional(), size: z.number().int().min(3).max(10).optional(), scoreMethod: z.enum(['MULTIPLY', 'ADD']).optional(),
    severityLabels: z.array(scaleLabel).optional(), likelihoodLabels: z.array(scaleLabel).optional(),
    levels: z.array(levelSchema).min(2).max(10).optional(), rule: ruleSchema.optional(),
  }).parse(req.body);
  await db.transaction(async (t) => {
    const m = await t.query.riskMatrixVersions.findFirst({ where: eq(s.riskMatrixVersions.id, id) });
    if (!m) throw notFound('Risk matrix');
    if (m.status !== 'DRAFT') throw conflict('MATRIX_LOCKED', 'Only draft matrix versions can be edited. Clone the active version to make changes.');
    const { levels, rule, ...fields } = body;
    await t.update(s.riskMatrixVersions).set({ ...fields, isValidated: false, validatedAt: null, validatedById: null }).where(eq(s.riskMatrixVersions.id, id));
    if (levels) { await t.delete(s.riskMatrixLevels).where(eq(s.riskMatrixLevels.matrixVersionId, id)); await t.insert(s.riskMatrixLevels).values(levels.map((l) => ({ ...l, matrixVersionId: id }))); }
    if (rule) await t.insert(s.riskAcceptanceRules).values({ ...rule, matrixVersionId: id }).onConflictDoUpdate({ target: s.riskAcceptanceRules.matrixVersionId, set: rule });
    await audit(t, { action: 'RISK_MATRIX_UPDATE', entityType: 'RISK_MATRIX', entityId: id, metadata: body });
  });
  res.json(await loadMatrix(id));
}));

adminRouter.post('/risk-matrices/:id/validate', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const m = await loadMatrix(id);
  if (!m) throw notFound('Risk matrix');
  const problems = validateMatrixDefinition(m);
  if (m.severityLabels.length !== m.size || m.likelihoodLabels.length !== m.size) problems.push('Severity/likelihood labels must be defined for every scale value');
  if (!m.rule) problems.push('A risk acceptance rule is required');
  if (problems.length) throw unprocessable('MATRIX_INVALID', 'Risk matrix definition is invalid', { problems });
  if (m.status === 'RETIRED') throw conflict('MATRIX_RETIRED', 'Retired matrices cannot be validated');
  await db.transaction(async (t) => {
    await t.execute(sql`UPDATE risk_matrix_versions SET is_validated = true, validated_at = now(), validated_by_id = ${req.user!.id} WHERE id = ${id}`);
    await audit(t, { action: 'RISK_MATRIX_VALIDATE', entityType: 'RISK_MATRIX', entityId: id, reason: z.object({ note: z.string().max(1000).optional() }).parse(req.body ?? {}).note });
  });
  res.json(await loadMatrix(id));
}));

adminRouter.post('/risk-matrices/:id/activate', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const m = await loadMatrix(id);
  if (!m) throw notFound('Risk matrix');
  if (m.status !== 'DRAFT') throw conflict('MATRIX_NOT_DRAFT', 'Only draft matrices can be activated');
  const problems = validateMatrixDefinition(m);
  if (problems.length || !m.rule) throw unprocessable('MATRIX_INVALID', 'Risk matrix definition is invalid', { problems });
  const settings = await getSettings();
  if (settings.enforceValidatedRiskMatrix && !m.isValidated) throw unprocessable('MATRIX_NOT_VALIDATED', 'The matrix must be validated before activation');
  await db.transaction(async (t) => {
    await t.update(s.riskMatrixVersions).set({ status: 'RETIRED' }).where(eq(s.riskMatrixVersions.status, 'ACTIVE'));
    await t.update(s.riskMatrixVersions).set({ status: 'ACTIVE', activatedAt: new Date() }).where(eq(s.riskMatrixVersions.id, id));
    await audit(t, { action: 'RISK_MATRIX_ACTIVATE', entityType: 'RISK_MATRIX', entityId: id, metadata: { versionNo: m.versionNo } });
  });
  res.json(await loadMatrix(id));
}));

// ───────────────────────── Settings ─────────────────────────
adminRouter.get('/validity', asyncH(async (_req, res) => { res.json(await getValiditySettings()); }));
adminRouter.put('/validity', asyncH(async (req, res) => {
  const body = z.object({
    mode: z.enum(['END_OF_WORK', 'FIXED_DURATION']), durationHours: z.number().int().min(1).max(24 * 90),
    maxWorkPeriodDays: z.number().int().min(1).max(365), expiryReminderHours: z.number().int().min(1).max(24 * 14),
    completionTrackingEnabled: z.boolean(), minLeadTimeHours: z.number().int().min(0).max(24 * 30),
  }).parse(req.body);
  const cur = await getValiditySettings();
  await db.transaction(async (t) => {
    await t.update(s.jsaValiditySettings).set({ ...body, updatedById: req.user!.id }).where(eq(s.jsaValiditySettings.id, cur.id));
    await audit(t, { action: 'CONFIG_UPDATE', entityType: 'VALIDITY_SETTINGS', entityId: cur.id, metadata: { before: cur, after: body } });
  });
  res.json(await getValiditySettings());
}));

adminRouter.get('/settings', asyncH(async (_req, res) => { res.json(await getSettings()); }));
adminRouter.put('/settings', asyncH(async (req, res) => {
  const body = z.object({
    defaultLanguage: z.enum(['th', 'en']), timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Invalid IANA timezone'),
    attachmentMaxMb: z.number().int().min(1).max(config.MAX_UPLOAD_MB), allowedExtensions: z.array(z.enum(['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'])).min(1),
    enforceValidatedRiskMatrix: z.boolean(), declarationVersion: z.string().min(1).max(20), declarationTextEn: z.string().min(20).max(2000),
    declarationTextTh: z.string().min(20).max(2000), ppeOptions: z.array(z.string().regex(/^[A-Z_]+$/).max(40)).max(40),
    dashboardExpiringSoonHours: z.number().int().min(1).max(24 * 30), overdueReviewHours: z.number().int().min(1).max(24 * 30),
  }).partial().parse(req.body);
  const before = await getSettings();
  await db.transaction(async (t) => {
    for (const [k, v] of Object.entries(body)) if (k in DEFAULT_SETTINGS) await setSetting(k, v, req.user!.id, t);
    await audit(t, { action: 'CONFIG_UPDATE', entityType: 'SYSTEM_SETTINGS', metadata: { before: Object.fromEntries(Object.keys(body).map((k) => [k, (before as any)[k]])), after: body } });
  });
  res.json(await getSettings());
}));

adminRouter.get('/notification-templates', asyncH(async (_req, res) => {
  res.json({ types: NOTIFICATION_TYPES, items: await db.select().from(s.notificationTemplates).orderBy(asc(s.notificationTemplates.type), asc(s.notificationTemplates.language)) });
}));
adminRouter.put('/notification-templates/:id', asyncH(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ title: z.string().min(1).max(300), body: z.string().max(2000), isEnabled: z.boolean() }).partial().parse(req.body);
  await db.transaction(async (t) => {
    const r = await t.update(s.notificationTemplates).set(body).where(eq(s.notificationTemplates.id, id)).returning();
    if (!r.length) throw notFound('Template');
    await audit(t, { action: 'CONFIG_UPDATE', entityType: 'NOTIFICATION_TEMPLATE', entityId: id, metadata: body });
  });
  res.json({ ok: true });
}));

adminRouter.get('/workflow', asyncH(async (_req, res) => {
  res.json({ items: await db.query.approvalWorkflows.findMany({ with: { steps: true } }) });
}));

adminRouter.post('/jobs/expiry', asyncH(async (_req, res) => {
  const { runExpiryJob } = await import('../jobs/scheduler');
  const r = await runExpiryJob();
  await audit(db, { action: 'JOB_RUN', entityType: 'SYSTEM', entityId: 'expiry', metadata: r });
  res.json(r);
}));

// ───────────────────────── Audit logs (Admin: all; Safety Officer: JSA entities) ─────────────────────────
export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole('ADMIN', 'SAFETY_OFFICER'));
auditRouter.get('/', asyncH(async (req, res) => {
  const q = z.object({
    entityType: z.string().max(60).optional(), entityId: z.string().max(100).optional(), action: z.string().max(100).optional(),
    actorId: z.string().uuid().optional(), result: z.enum(['SUCCESS', 'DENIED', 'FAILURE']).optional(),
    from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  const c: SQL[] = [];
  if (!hasRole(req.user!, 'ADMIN')) c.push(eq(s.auditLogs.entityType, 'JSA'));
  if (q.entityType) c.push(eq(s.auditLogs.entityType, q.entityType));
  if (q.entityId) c.push(eq(s.auditLogs.entityId, q.entityId));
  if (q.action) c.push(ilike(s.auditLogs.action, `%${q.action}%`));
  if (q.actorId) c.push(eq(s.auditLogs.actorId, q.actorId));
  if (q.result) c.push(eq(s.auditLogs.result, q.result));
  if (q.from) c.push(gte(s.auditLogs.occurredAt, new Date(q.from)));
  if (q.to) c.push(lte(s.auditLogs.occurredAt, new Date(q.to)));
  const where = c.length ? and(...c) : undefined;
  const items = await db.select().from(s.auditLogs).where(where).orderBy(desc(s.auditLogs.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(s.auditLogs).where(where);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}));
auditRouter.get('/verify', requireRole('ADMIN'), asyncH(async (_req, res) => { res.json(await verifyAuditChain()); }));

export { ne };
