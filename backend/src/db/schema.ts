/**
 * JSA Submission & Approval — PostgreSQL schema (Drizzle ORM).
 * Conventions: UUID primary keys, snake_case names, all timestamps are timestamptz (UTC).
 * Stable business codes (status, role, risk level) are stored as codes and translated in the UI.
 */
import {
  pgTable, pgEnum, uuid, text, varchar, boolean, integer, timestamp, jsonb, bigserial,
  primaryKey, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());

// ───────────────────────────── Enums ─────────────────────────────
export const userTypeEnum = pgEnum('user_type', ['EMPLOYEE', 'CONTRACTOR']);
export const jsaStatusEnum = pgEnum('jsa_status', [
  'DRAFT', 'SUBMITTED', 'PENDING_AREA_OWNER', 'PENDING_SAFETY_OFFICER', 'RETURNED',
  'REJECTED', 'APPROVED', 'CANCELLED', 'EXPIRED', 'COMPLETED',
]);
export const approvalStageEnum = pgEnum('approval_stage', ['AREA_OWNER', 'SAFETY_OFFICER']);
export const approvalDecisionEnum = pgEnum('approval_decision', ['SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED']);
export const instanceStatusEnum = pgEnum('instance_status', ['IN_PROGRESS', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED']);
export const taskStatusEnum = pgEnum('task_status', ['PENDING', 'COMPLETED', 'CANCELLED']);
export const riskPhaseEnum = pgEnum('risk_phase', ['INITIAL', 'RESIDUAL']);
export const controlTypeEnum = pgEnum('control_type', ['EXISTING', 'ADDITIONAL']);
export const permitVerificationEnum = pgEnum('permit_verification_status', ['MANUAL_REFERENCE', 'AWAITING_VERIFICATION', 'VERIFIED']);
export const tokenTypeEnum = pgEnum('token_type', ['INVITE', 'PASSWORD_RESET']);
export const matrixStatusEnum = pgEnum('matrix_status', ['DRAFT', 'ACTIVE', 'RETIRED']);

export type JsaStatus = (typeof jsaStatusEnum.enumValues)[number];
export type ApprovalStage = (typeof approvalStageEnum.enumValues)[number];

// ───────────────────── Identity & Organization ─────────────────────
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const contractorCompanies = pgTable('contractor_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: text('name').notNull(),
  taxId: text('tax_id'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  phone: text('phone'),
  userType: userTypeEnum('user_type').notNull().default('EMPLOYEE'),
  departmentId: uuid('department_id').references(() => departments.id),
  contractorCompanyId: uuid('contractor_company_id').references(() => contractorCompanies.id),
  preferredLanguage: varchar('preferred_language', { length: 5 }).notNull().default('th'),
  isActive: boolean('is_active').notNull().default(true),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  invitedAt: ts('invited_at'),
  activatedAt: ts('activated_at'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(), // REQUESTER | AREA_OWNER | SAFETY_OFFICER | ADMIN
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  csrfToken: varchar('csrf_token', { length: 128 }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)]);

export const userTokens = pgTable('user_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: tokenTypeEnum('type').notNull(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
}, (t) => [index('user_tokens_user_type_idx').on(t.userId, t.type)]);

export const factorySites = pgTable('factory_sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const factoryAreas = pgTable('factory_areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull().references(() => factorySites.id),
  code: varchar('code', { length: 50 }).notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  building: text('building'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const areaOwnerAssignments = pgTable('area_owner_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  areaId: uuid('area_id').notNull().references(() => factoryAreas.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  isBackup: boolean('is_backup').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('area_owner_area_user_uq').on(t.areaId, t.userId), index('area_owner_user_idx').on(t.userId)]);

export const safetyOfficerAssignments = pgTable('safety_officer_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').references(() => factorySites.id), // null = all sites
  userId: uuid('user_id').notNull().references(() => users.id),
  isBackup: boolean('is_backup').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index('safety_officer_user_idx').on(t.userId)]);

// ───────────────────────────── Configuration ─────────────────────────────
export const jobTypes = pgTable('job_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  defaultPermitCodes: text('default_permit_codes').array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const hazardMaster = pgTable('hazard_master', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  category: text('category').notNull(),
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const controlMeasureMaster = pgTable('control_measure_master', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  hierarchy: text('hierarchy').notNull(), // ELIMINATION | SUBSTITUTION | ENGINEERING | ADMINISTRATIVE | PPE
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export type ScaleLabel = { value: number; en: string; th: string; descriptionEn?: string; descriptionTh?: string };

export const riskMatrixVersions = pgTable('risk_matrix_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionNo: integer('version_no').notNull().unique(),
  name: text('name').notNull(),
  status: matrixStatusEnum('status').notNull().default('DRAFT'),
  size: integer('size').notNull().default(5),
  scoreMethod: varchar('score_method', { length: 20 }).notNull().default('MULTIPLY'),
  severityLabels: jsonb('severity_labels').$type<ScaleLabel[]>().notNull(),
  likelihoodLabels: jsonb('likelihood_labels').$type<ScaleLabel[]>().notNull(),
  isValidated: boolean('is_validated').notNull().default(false),
  validatedById: uuid('validated_by_id').references(() => users.id),
  validatedAt: ts('validated_at'),
  activatedAt: ts('activated_at'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const riskMatrixLevels = pgTable('risk_matrix_levels', {
  id: uuid('id').primaryKey().defaultRandom(),
  matrixVersionId: uuid('matrix_version_id').notNull().references(() => riskMatrixVersions.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 30 }).notNull(),
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  minScore: integer('min_score').notNull(),
  maxScore: integer('max_score').notNull(),
  color: varchar('color', { length: 20 }).notNull(),
  sortOrder: integer('sort_order').notNull(),
  requiresEscalation: boolean('requires_escalation').notNull().default(false),
}, (t) => [uniqueIndex('risk_level_matrix_code_uq').on(t.matrixVersionId, t.code)]);

export const riskAcceptanceRules = pgTable('risk_acceptance_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  matrixVersionId: uuid('matrix_version_id').notNull().references(() => riskMatrixVersions.id, { onDelete: 'cascade' }).unique(),
  maxAcceptableResidualScore: integer('max_acceptable_residual_score').notNull(),
  blockSubmission: boolean('block_submission').notNull().default(false),
  blockFinalApproval: boolean('block_final_approval').notNull().default(true),
  requireResidualLowerOrEqual: boolean('require_residual_lower_or_equal').notNull().default(true),
  description: text('description'),
});

export type FollowUpQuestion = { key: string; en: string; th: string; type: 'boolean' | 'text'; required: boolean };

export const permitTypes = pgTable('permit_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTh: text('name_th').notNull(),
  isHighRisk: boolean('is_high_risk').notNull().default(true),
  requiresPermitReference: boolean('requires_permit_reference').notNull().default(true),
  requiresAttachment: boolean('requires_attachment').notNull().default(false),
  requiresSafetyVerification: boolean('requires_safety_verification').notNull().default(true),
  followUpQuestions: jsonb('follow_up_questions').$type<FollowUpQuestion[]>().notNull().default([]),
  guidanceEn: text('guidance_en'),
  guidanceTh: text('guidance_th'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const jsaValiditySettings = pgTable('jsa_validity_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  mode: varchar('mode', { length: 30 }).notNull().default('END_OF_WORK'), // END_OF_WORK | FIXED_DURATION
  durationHours: integer('duration_hours').notNull().default(24),
  maxWorkPeriodDays: integer('max_work_period_days').notNull().default(30),
  expiryReminderHours: integer('expiry_reminder_hours').notNull().default(24),
  completionTrackingEnabled: boolean('completion_tracking_enabled').notNull().default(true),
  minLeadTimeHours: integer('min_lead_time_hours').notNull().default(0),
  updatedAt: updatedAt(),
  updatedById: uuid('updated_by_id').references(() => users.id),
});

export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
  updatedById: uuid('updated_by_id').references(() => users.id),
});

// ───────────────────────────── JSA ─────────────────────────────
/** Atomic per-year counter for human-readable references (JSA-YYYY-NNNNN). */
export const jsaReferenceCounters = pgTable('jsa_reference_counters', {
  year: integer('year').primaryKey(),
  lastValue: integer('last_value').notNull().default(0),
});

/** JSA header. "Denormalized" fields mirror the current version to support fast filtering. */
export const jsas = pgTable('jsas', {
  id: uuid('id').primaryKey().defaultRandom(),
  referenceNo: varchar('reference_no', { length: 30 }).notNull().unique(),
  status: jsaStatusEnum('status').notNull().default('DRAFT'),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  currentVersionId: uuid('current_version_id'),
  approvedVersionId: uuid('approved_version_id'),
  currentVersionNo: integer('current_version_no').notNull().default(1),
  jobTitle: text('job_title').notNull().default(''),
  areaId: uuid('area_id').references(() => factoryAreas.id),
  departmentId: uuid('department_id').references(() => departments.id),
  contractorCompanyId: uuid('contractor_company_id').references(() => contractorCompanies.id),
  jobTypeId: uuid('job_type_id').references(() => jobTypes.id),
  plannedStart: ts('planned_start'),
  plannedEnd: ts('planned_end'),
  maxInitialRiskScore: integer('max_initial_risk_score'),
  maxResidualRiskScore: integer('max_residual_risk_score'),
  riskLevelCode: varchar('risk_level_code', { length: 30 }),
  initialRiskLevelCode: varchar('initial_risk_level_code', { length: 30 }),
  isHighRiskWork: boolean('is_high_risk_work').notNull().default(false),
  submittedAt: ts('submitted_at'),
  approvedAt: ts('approved_at'),
  validFrom: ts('valid_from'),
  validUntil: ts('valid_until'),
  expiryReminderSentAt: ts('expiry_reminder_sent_at'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
  completedAt: ts('completed_at'),
  completedById: uuid('completed_by_id').references(() => users.id),
  completionNote: text('completion_note'),
  deletedAt: ts('deleted_at'),
  rowVersion: integer('row_version').notNull().default(0),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  index('jsas_status_idx').on(t.status),
  index('jsas_requester_idx').on(t.requesterId),
  index('jsas_area_idx').on(t.areaId),
  index('jsas_planned_start_idx').on(t.plannedStart),
  index('jsas_planned_end_idx').on(t.plannedEnd),
  index('jsas_valid_until_idx').on(t.validUntil),
  index('jsas_contractor_idx').on(t.contractorCompanyId),
  index('jsas_department_idx').on(t.departmentId),
  index('jsas_created_idx').on(t.createdAt),
]);

/**
 * One snapshot per submission. Editable only while locked = false (draft);
 * locked versions (and their child rows) are protected from UPDATE/DELETE by DB triggers.
 */
export const jsaVersions = pgTable('jsa_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  jsaId: uuid('jsa_id').notNull().references(() => jsas.id),
  versionNo: integer('version_no').notNull(),
  locked: boolean('locked').notNull().default(false),
  jobTitle: text('job_title').notNull().default(''),
  jobDescription: text('job_description').notNull().default(''),
  requesterName: text('requester_name').notNull(),
  requesterType: userTypeEnum('requester_type').notNull(),
  departmentId: uuid('department_id').references(() => departments.id),
  contractorCompanyId: uuid('contractor_company_id').references(() => contractorCompanies.id),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  siteId: uuid('site_id').references(() => factorySites.id),
  areaId: uuid('area_id').references(() => factoryAreas.id),
  exactLocation: text('exact_location'),
  plannedStart: ts('planned_start'),
  plannedEnd: ts('planned_end'),
  workerCount: integer('worker_count'),
  supervisorName: text('supervisor_name'),
  supervisorPhone: text('supervisor_phone'),
  jobTypeId: uuid('job_type_id').references(() => jobTypes.id),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  ppeRequired: text('ppe_required').array().notNull().default(sql`'{}'::text[]`),
  additionalRequirements: text('additional_requirements'),
  riskMatrixVersionId: uuid('risk_matrix_version_id').references(() => riskMatrixVersions.id),
  contentHash: varchar('content_hash', { length: 128 }),
  changeSummary: jsonb('change_summary'),
  revisionReason: text('revision_reason'),
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
  submittedAt: ts('submitted_at'),
}, (t) => [uniqueIndex('jsa_versions_jsa_version_uq').on(t.jsaId, t.versionNo)]);

export const jsaJobSteps = pgTable('jsa_job_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => jsaVersions.id, { onDelete: 'cascade' }),
  stepNo: integer('step_no').notNull(),
  activity: text('activity').notNull(),
}, (t) => [uniqueIndex('jsa_steps_version_no_uq').on(t.versionId, t.stepNo)]);

export const jsaStepHazards = pgTable('jsa_step_hazards', {
  id: uuid('id').primaryKey().defaultRandom(),
  stepId: uuid('step_id').notNull().references(() => jsaJobSteps.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  hazard: text('hazard').notNull(),
  consequence: text('consequence').notNull(),
  hazardMasterId: uuid('hazard_master_id').references(() => hazardMaster.id),
  controlOwner: text('control_owner'),
}, (t) => [uniqueIndex('jsa_hazards_step_seq_uq').on(t.stepId, t.seq)]);

export const jsaControlMeasures = pgTable('jsa_control_measures', {
  id: uuid('id').primaryKey().defaultRandom(),
  hazardId: uuid('hazard_id').notNull().references(() => jsaStepHazards.id, { onDelete: 'cascade' }),
  type: controlTypeEnum('type').notNull(),
  description: text('description').notNull(),
});

export const jsaRiskAssessments = pgTable('jsa_risk_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  hazardId: uuid('hazard_id').notNull().references(() => jsaStepHazards.id, { onDelete: 'cascade' }),
  phase: riskPhaseEnum('phase').notNull(),
  severity: integer('severity').notNull(),
  likelihood: integer('likelihood').notNull(),
  score: integer('score').notNull(),
  levelCode: varchar('level_code', { length: 30 }).notNull(),
}, (t) => [uniqueIndex('jsa_risk_hazard_phase_uq').on(t.hazardId, t.phase)]);

/**
 * Attachments belong to the JSA and record the version number in which they were added/removed,
 * so the attachment set of any historical version can be reconstructed.
 */
export const jsaAttachments = pgTable('jsa_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  jsaId: uuid('jsa_id').notNull().references(() => jsas.id),
  addedInVersion: integer('added_in_version').notNull(),
  removedInVersion: integer('removed_in_version'),
  category: varchar('category', { length: 40 }).notNull().default('OTHER'),
  originalName: text('original_name').notNull(),
  storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
  mimeType: varchar('mime_type', { length: 120 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  uploadedById: uuid('uploaded_by_id').notNull().references(() => users.id),
  uploadedAt: ts('uploaded_at').notNull().defaultNow(),
}, (t) => [index('jsa_attachments_jsa_idx').on(t.jsaId)]);

export const jsaPermitReferences = pgTable('jsa_permit_references', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => jsaVersions.id, { onDelete: 'cascade' }),
  permitTypeId: uuid('permit_type_id').notNull().references(() => permitTypes.id),
  referenceNo: text('reference_no'),
  verificationStatus: permitVerificationEnum('verification_status').notNull().default('MANUAL_REFERENCE'),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
  attachmentId: uuid('attachment_id').references(() => jsaAttachments.id),
  notes: text('notes'),
}, (t) => [uniqueIndex('jsa_permit_version_type_uq').on(t.versionId, t.permitTypeId)]);

/** Safety Officer verification of permit evidence (separate so locked versions stay immutable). */
export const jsaPermitVerifications = pgTable('jsa_permit_verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  permitRefId: uuid('permit_ref_id').notNull().references(() => jsaPermitReferences.id),
  verifiedById: uuid('verified_by_id').notNull().references(() => users.id),
  note: text('note'),
  verifiedAt: ts('verified_at').notNull().defaultNow(),
});

export const jsaDeclarations = pgTable('jsa_declarations', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => jsaVersions.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  declarationVersion: varchar('declaration_version', { length: 20 }).notNull(),
  language: varchar('language', { length: 5 }).notNull(),
  textSnapshot: text('text_snapshot').notNull(),
  acceptedAt: ts('accepted_at').notNull().defaultNow(),
});

// ───────────────────────── Workflow & Audit ─────────────────────────
export const approvalWorkflows = pgTable('approval_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const approvalWorkflowSteps = pgTable('approval_workflow_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => approvalWorkflows.id),
  stepOrder: integer('step_order').notNull(),
  stage: approvalStageEnum('stage').notNull(),
}, (t) => [uniqueIndex('approval_wf_step_uq').on(t.workflowId, t.stepOrder)]);

export const approvalInstances = pgTable('approval_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  jsaId: uuid('jsa_id').notNull().references(() => jsas.id),
  versionId: uuid('version_id').notNull().references(() => jsaVersions.id),
  workflowId: uuid('workflow_id').notNull().references(() => approvalWorkflows.id),
  status: instanceStatusEnum('status').notNull().default('IN_PROGRESS'),
  currentStepOrder: integer('current_step_order').notNull().default(1),
  startedAt: ts('started_at').notNull().defaultNow(),
  completedAt: ts('completed_at'),
}, (t) => [
  index('approval_instances_jsa_idx').on(t.jsaId),
  // at most one active instance per JSA
  uniqueIndex('approval_instances_one_active_uq').on(t.jsaId).where(sql`status = 'IN_PROGRESS'`),
]);

export const approvalTasks = pgTable('approval_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => approvalInstances.id),
  workflowStepId: uuid('workflow_step_id').notNull().references(() => approvalWorkflowSteps.id),
  stage: approvalStageEnum('stage').notNull(),
  assigneeId: uuid('assignee_id').references(() => users.id), // primary resolved reviewer
  status: taskStatusEnum('status').notNull().default('PENDING'),
  decision: approvalDecisionEnum('decision'),
  actedById: uuid('acted_by_id').references(() => users.id),
  comment: text('comment'),
  createdAt: createdAt(),
  completedAt: ts('completed_at'),
}, (t) => [
  index('approval_tasks_status_stage_idx').on(t.status, t.stage),
  index('approval_tasks_assignee_idx').on(t.assigneeId, t.status),
  uniqueIndex('approval_tasks_one_pending_uq').on(t.instanceId).where(sql`status = 'PENDING'`),
]);

/** Immutable (UPDATE/DELETE blocked by trigger). */
export const approvalHistory = pgTable('approval_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').references(() => approvalInstances.id),
  jsaId: uuid('jsa_id').notNull().references(() => jsas.id),
  versionId: uuid('version_id').notNull().references(() => jsaVersions.id),
  versionNo: integer('version_no').notNull(),
  stage: approvalStageEnum('stage'),
  decision: approvalDecisionEnum('decision').notNull(),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  actorName: text('actor_name').notNull(),
  comment: text('comment'),
  metadata: jsonb('metadata'),
  createdAt: createdAt(),
}, (t) => [index('approval_history_jsa_idx').on(t.jsaId)]);

/** Immutable (UPDATE/DELETE blocked by trigger). */
export const jsaStatusHistory = pgTable('jsa_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  jsaId: uuid('jsa_id').notNull().references(() => jsas.id),
  fromStatus: jsaStatusEnum('from_status'),
  toStatus: jsaStatusEnum('to_status').notNull(),
  versionNo: integer('version_no').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  reason: text('reason'),
  createdAt: createdAt(),
}, (t) => [index('jsa_status_history_jsa_idx').on(t.jsaId)]);

/** Append-only, hash-chained audit log (UPDATE/DELETE/TRUNCATE blocked by trigger). */
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  actorId: uuid('actor_id'),
  actorLabel: text('actor_label'),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 60 }).notNull(),
  entityId: text('entity_id'),
  result: varchar('result', { length: 20 }).notNull(), // SUCCESS | DENIED | FAILURE
  reason: text('reason'),
  requestId: varchar('request_id', { length: 64 }),
  ip: text('ip'),
  metadata: jsonb('metadata'),
  prevHash: varchar('prev_hash', { length: 64 }),
  hash: varchar('hash', { length: 64 }).notNull(),
}, (t) => [
  index('audit_entity_idx').on(t.entityType, t.entityId),
  index('audit_actor_idx').on(t.actorId),
  index('audit_occurred_idx').on(t.occurredAt),
]);

// ─────────────────────── Notifications & Reporting ───────────────────────
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 60 }).notNull(),
  jsaId: uuid('jsa_id').references(() => jsas.id),
  params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [index('notifications_recipient_idx').on(t.recipientId, t.readAt)]);

export const notificationTemplates = pgTable('notification_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 60 }).notNull(),
  channel: varchar('channel', { length: 20 }).notNull().default('IN_APP'), // IN_APP | EMAIL | TEAMS
  language: varchar('language', { length: 5 }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('notification_templates_uq').on(t.type, t.channel, t.language)]);

export const reportExportLogs = pgTable('report_export_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  reportType: varchar('report_type', { length: 60 }).notNull(),
  format: varchar('format', { length: 10 }).notNull(),
  filters: jsonb('filters').notNull(),
  rowCount: integer('row_count').notNull(),
  createdAt: createdAt(),
});

// ───────────────────────────── Relations ─────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  contractorCompany: one(contractorCompanies, { fields: [users.contractorCompanyId], references: [contractorCompanies.id] }),
  roles: many(userRoles),
}));
export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));
export const factoryAreasRelations = relations(factoryAreas, ({ one, many }) => ({
  site: one(factorySites, { fields: [factoryAreas.siteId], references: [factorySites.id] }),
  owners: many(areaOwnerAssignments),
}));
export const factorySitesRelations = relations(factorySites, ({ many }) => ({ areas: many(factoryAreas) }));
export const areaOwnerAssignmentsRelations = relations(areaOwnerAssignments, ({ one }) => ({
  area: one(factoryAreas, { fields: [areaOwnerAssignments.areaId], references: [factoryAreas.id] }),
  user: one(users, { fields: [areaOwnerAssignments.userId], references: [users.id] }),
}));
export const safetyOfficerAssignmentsRelations = relations(safetyOfficerAssignments, ({ one }) => ({
  site: one(factorySites, { fields: [safetyOfficerAssignments.siteId], references: [factorySites.id] }),
  user: one(users, { fields: [safetyOfficerAssignments.userId], references: [users.id] }),
}));
export const jsasRelations = relations(jsas, ({ one, many }) => ({
  requester: one(users, { fields: [jsas.requesterId], references: [users.id] }),
  area: one(factoryAreas, { fields: [jsas.areaId], references: [factoryAreas.id] }),
  department: one(departments, { fields: [jsas.departmentId], references: [departments.id] }),
  contractorCompany: one(contractorCompanies, { fields: [jsas.contractorCompanyId], references: [contractorCompanies.id] }),
  jobType: one(jobTypes, { fields: [jsas.jobTypeId], references: [jobTypes.id] }),
  versions: many(jsaVersions),
  attachments: many(jsaAttachments),
}));
export const jsaVersionsRelations = relations(jsaVersions, ({ one, many }) => ({
  jsa: one(jsas, { fields: [jsaVersions.jsaId], references: [jsas.id] }),
  steps: many(jsaJobSteps),
  permits: many(jsaPermitReferences),
  declarations: many(jsaDeclarations),
}));
export const jsaJobStepsRelations = relations(jsaJobSteps, ({ one, many }) => ({
  version: one(jsaVersions, { fields: [jsaJobSteps.versionId], references: [jsaVersions.id] }),
  hazards: many(jsaStepHazards),
}));
export const jsaStepHazardsRelations = relations(jsaStepHazards, ({ one, many }) => ({
  step: one(jsaJobSteps, { fields: [jsaStepHazards.stepId], references: [jsaJobSteps.id] }),
  controls: many(jsaControlMeasures),
  assessments: many(jsaRiskAssessments),
}));
export const jsaControlMeasuresRelations = relations(jsaControlMeasures, ({ one }) => ({
  hazard: one(jsaStepHazards, { fields: [jsaControlMeasures.hazardId], references: [jsaStepHazards.id] }),
}));
export const jsaRiskAssessmentsRelations = relations(jsaRiskAssessments, ({ one }) => ({
  hazard: one(jsaStepHazards, { fields: [jsaRiskAssessments.hazardId], references: [jsaStepHazards.id] }),
}));
export const jsaPermitReferencesRelations = relations(jsaPermitReferences, ({ one, many }) => ({
  version: one(jsaVersions, { fields: [jsaPermitReferences.versionId], references: [jsaVersions.id] }),
  permitType: one(permitTypes, { fields: [jsaPermitReferences.permitTypeId], references: [permitTypes.id] }),
  verifications: many(jsaPermitVerifications),
}));
export const jsaPermitVerificationsRelations = relations(jsaPermitVerifications, ({ one }) => ({
  permitRef: one(jsaPermitReferences, { fields: [jsaPermitVerifications.permitRefId], references: [jsaPermitReferences.id] }),
}));
export const jsaDeclarationsRelations = relations(jsaDeclarations, ({ one }) => ({
  version: one(jsaVersions, { fields: [jsaDeclarations.versionId], references: [jsaVersions.id] }),
}));
export const jsaAttachmentsRelations = relations(jsaAttachments, ({ one }) => ({
  jsa: one(jsas, { fields: [jsaAttachments.jsaId], references: [jsas.id] }),
}));
export const riskMatrixVersionsRelations = relations(riskMatrixVersions, ({ many }) => ({
  levels: many(riskMatrixLevels),
  rules: many(riskAcceptanceRules),
}));
export const riskMatrixLevelsRelations = relations(riskMatrixLevels, ({ one }) => ({
  matrixVersion: one(riskMatrixVersions, { fields: [riskMatrixLevels.matrixVersionId], references: [riskMatrixVersions.id] }),
}));
export const riskAcceptanceRulesRelations = relations(riskAcceptanceRules, ({ one }) => ({
  matrixVersion: one(riskMatrixVersions, { fields: [riskAcceptanceRules.matrixVersionId], references: [riskMatrixVersions.id] }),
}));
export const approvalWorkflowsRelations = relations(approvalWorkflows, ({ many }) => ({ steps: many(approvalWorkflowSteps) }));
export const approvalWorkflowStepsRelations = relations(approvalWorkflowSteps, ({ one }) => ({
  workflow: one(approvalWorkflows, { fields: [approvalWorkflowSteps.workflowId], references: [approvalWorkflows.id] }),
}));
export const approvalInstancesRelations = relations(approvalInstances, ({ one, many }) => ({
  jsa: one(jsas, { fields: [approvalInstances.jsaId], references: [jsas.id] }),
  tasks: many(approvalTasks),
}));
export const approvalTasksRelations = relations(approvalTasks, ({ one }) => ({
  instance: one(approvalInstances, { fields: [approvalTasks.instanceId], references: [approvalInstances.id] }),
}));
