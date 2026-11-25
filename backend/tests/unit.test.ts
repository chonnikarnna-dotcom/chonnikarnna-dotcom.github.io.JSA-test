import { describe, expect, it } from 'vitest';
import { formatReference } from '../src/services/reference';
import { assess, computeScore, levelForScore, validateMatrixDefinition } from '../src/services/risk';
import { calculateValidity } from '../src/services/settings';
import { diffContent, validateForSubmission, type VersionContent } from '../src/services/jsa-content';
import { canReviewStage, type AuthUser } from '../src/lib/authz';
import { canonicalJson, passwordPolicy } from '../src/lib/crypto';
import { safeCell, toCsv } from '../src/services/export';
import { thaiWrap, lighten } from '../src/services/pdf';

const levels = [
  { code: 'LOW', minScore: 1, maxScore: 4 }, { code: 'MEDIUM', minScore: 5, maxScore: 9 },
  { code: 'HIGH', minScore: 10, maxScore: 16 }, { code: 'CRITICAL', minScore: 17, maxScore: 25 },
];
const matrix = { id: 'm', size: 5, scoreMethod: 'MULTIPLY', levels: levels.map((l, i) => ({ ...l, id: String(i), matrixVersionId: 'm', nameEn: l.code, nameTh: l.code, color: '#000000', sortOrder: i, requiresEscalation: i > 1 })),
  rule: { id: 'r', matrixVersionId: 'm', maxAcceptableResidualScore: 9, blockSubmission: false, blockFinalApproval: true, requireResidualLowerOrEqual: true, description: null } } as never;

describe('JSA reference numbers', () => {
  it('formats as JSA-YYYY-NNNNN with zero padding', () => {
    expect(formatReference(2026, 1)).toBe('JSA-2026-00001');
    expect(formatReference(2026, 12345)).toBe('JSA-2026-12345');
  });
});

describe('risk scoring (server-side)', () => {
  it('multiplies severity × likelihood', () => { expect(computeScore('MULTIPLY', 4, 3)).toBe(12); });
  it('supports additive method', () => { expect(computeScore('ADD', 4, 3)).toBe(7); });
  it('maps score to configured level', () => {
    expect(levelForScore(levels, 4)).toBe('LOW');
    expect(levelForScore(levels, 5)).toBe('MEDIUM');
    expect(levelForScore(levels, 16)).toBe('HIGH');
    expect(levelForScore(levels, 25)).toBe('CRITICAL');
  });
  it('rejects out-of-range inputs', () => {
    expect(() => assess(matrix, 6, 1)).toThrow();
    expect(() => assess(matrix, 0, 1)).toThrow();
    expect(() => assess(matrix, 2.5, 1)).toThrow();
    expect(assess(matrix, 5, 5)).toEqual({ severity: 5, likelihood: 5, score: 25, levelCode: 'CRITICAL' });
  });
  it('detects gaps and overlaps in matrix definitions', () => {
    expect(validateMatrixDefinition({ size: 5, scoreMethod: 'MULTIPLY', levels } as never)).toEqual([]);
    const gap = validateMatrixDefinition({ size: 5, scoreMethod: 'MULTIPLY', levels: levels.filter((l) => l.code !== 'MEDIUM') } as never);
    expect(gap.join(' ')).toMatch(/Score 5 is not covered/);
    const overlap = validateMatrixDefinition({ size: 5, scoreMethod: 'MULTIPLY', levels: [...levels, { code: 'X', minScore: 4, maxScore: 5 }] } as never);
    expect(overlap.join(' ')).toMatch(/multiple levels/);
  });
});

describe('validity / expiration calculation', () => {
  const start = new Date('2026-11-01T01:00:00Z'); const end = new Date('2026-11-03T01:00:00Z');
  it('END_OF_WORK: valid from planned start until planned end', () => {
    const r = calculateValidity({ mode: 'END_OF_WORK', durationHours: 24 }, start, end, new Date('2026-10-30T00:00:00Z'));
    expect(r.validFrom).toEqual(start); expect(r.validUntil).toEqual(end);
  });
  it('FIXED_DURATION is capped at planned end', () => {
    const r = calculateValidity({ mode: 'FIXED_DURATION', durationHours: 12 }, start, end, new Date('2026-10-30T00:00:00Z'));
    expect(r.validUntil).toEqual(new Date('2026-11-01T13:00:00Z'));
    const r2 = calculateValidity({ mode: 'FIXED_DURATION', durationHours: 999 }, start, end, new Date('2026-10-30T00:00:00Z'));
    expect(r2.validUntil).toEqual(end);
  });
  it('validity never starts before approval', () => {
    const approved = new Date('2026-11-02T00:00:00Z');
    expect(calculateValidity({ mode: 'END_OF_WORK', durationHours: 1 }, start, end, approved).validFrom).toEqual(approved);
  });
});

const content = (o: Partial<VersionContent> = {}): VersionContent => ({
  jobTitle: 'Valid title', jobDescription: 'desc', departmentId: 'd', contactPhone: '1', contactEmail: null, siteId: 's', areaId: 'a',
  exactLocation: 'x', plannedStart: new Date(Date.now() + 3600_000), plannedEnd: new Date(Date.now() + 7200_000), workerCount: 2,
  supervisorName: 'sup', supervisorPhone: null, jobTypeId: 'j', emergencyContactName: null, emergencyContactPhone: null, ppeRequired: [],
  additionalRequirements: null,
  steps: [{ stepNo: 1, activity: 'a', hazards: [{ hazard: 'h', consequence: 'c', hazardMasterId: null, controlOwner: null, existingControls: 'e', additionalControls: '', initial: { severity: 4, likelihood: 3, score: 12, levelCode: 'HIGH' }, residual: { severity: 4, likelihood: 1, score: 4, levelCode: 'LOW' } }] }],
  permits: [], ...o,
});
const ctx = (o = {}) => ({ now: new Date(), requesterType: 'EMPLOYEE' as const, matrix, validity: { maxWorkPeriodDays: 30, minLeadTimeHours: 0 }, permitTypes: [], availableAttachmentIds: [], attachmentCount: 0, ...o });
const codes = (c: VersionContent, x = ctx()) => validateForSubmission(c, x).map((e) => `${e.path}:${e.code}`);

describe('submission validation rules', () => {
  it('accepts a complete JSA', () => { expect(codes(content())).toEqual([]); });
  it('requires at least one job step', () => { expect(codes(content({ steps: [] }))).toContain('steps:min_one_step'); });
  it('requires hazards, controls and both risk assessments', () => {
    const c = content({ steps: [{ stepNo: 1, activity: 'a', hazards: [{ hazard: '', consequence: 'c', hazardMasterId: null, controlOwner: null, existingControls: '', additionalControls: '', initial: null, residual: null }] }] });
    expect(codes(c)).toEqual(expect.arrayContaining(['steps.0.hazards.0.hazard:required', 'steps.0.hazards.0.controls:control_required', 'steps.0.hazards.0.initial:risk_required', 'steps.0.hazards.0.residual:risk_required']));
  });
  it('validates the work period', () => {
    const now = Date.now();
    expect(codes(content({ plannedStart: new Date(now + 7200_000), plannedEnd: new Date(now + 3600_000) }))).toContain('plannedEnd:end_before_start');
    expect(codes(content({ plannedStart: new Date(now - 7200_000), plannedEnd: new Date(now - 3600_000) }))).toContain('plannedEnd:in_past');
    expect(codes(content({ plannedEnd: new Date(now + 40 * 86_400_000) }))).toContain('plannedEnd:period_too_long');
    expect(codes(content(), ctx({ validity: { maxWorkPeriodDays: 30, minLeadTimeHours: 48 } }))).toContain('plannedStart:lead_time');
  });
  it('residual risk may not exceed initial risk (configured rule)', () => {
    const c = content();
    c.steps[0].hazards[0].residual = { severity: 5, likelihood: 5, score: 25, levelCode: 'CRITICAL' };
    expect(codes(c)).toContain('steps.0.hazards.0.residual:residual_above_initial');
  });
  it('enforces permit reference, evidence and confirmations; high-risk requires emergency contact', () => {
    const pt = { id: 'p', isActive: true, nameEn: 'Hot Work', requiresPermitReference: true, requiresAttachment: true, isHighRisk: true, followUpQuestions: [{ key: 'fire_watch', en: 'Fire watch', th: '', type: 'boolean', required: true }] };
    const c = content({ permits: [{ permitTypeId: 'p', referenceNo: null, verificationStatus: 'MANUAL_REFERENCE', answers: { fire_watch: false }, attachmentId: 'not-mine', notes: null }] });
    expect(codes(c, ctx({ permitTypes: [pt] }))).toEqual(expect.arrayContaining([
      'permits.0.referenceNo:required', 'permits.0.attachmentId:evidence_required', 'permits.0.answers.fire_watch:must_confirm', 'emergencyContactName:required',
    ]));
  });
  it('employees need a department; contractors do not', () => {
    expect(codes(content({ departmentId: null }))).toContain('departmentId:required');
    expect(codes(content({ departmentId: null }), ctx({ requesterType: 'CONTRACTOR' }))).not.toContain('departmentId:required');
  });
});

describe('version diff', () => {
  it('identifies changed fields and steps and flags critical changes', () => {
    const a = content(); const b = content({ exactLocation: 'elsewhere' });
    b.steps = [...a.steps, { ...a.steps[0], stepNo: 2, activity: 'new' }];
    const d = diffContent(a, b, 1, [{ id: '1', name: 'a.pdf' }], [{ id: '2', name: 'b.pdf' }]);
    expect(d.changedFields).toContain('exactLocation');
    expect(d.steps.added).toEqual([2]);
    expect(d.attachments).toEqual({ added: ['b.pdf'], removed: ['a.pdf'] });
    expect(d.criticalChange).toBe(true);
    expect(diffContent(a, structuredClone(a), 1, [], []).criticalChange).toBe(false);
  });
});

describe('permission checks (pure)', () => {
  const u = (o: Partial<AuthUser>): AuthUser => ({ id: 'u', email: '', username: '', displayName: '', userType: 'EMPLOYEE', departmentId: null, contractorCompanyId: null, preferredLanguage: 'en', roles: [], ownedAreaIds: [], safetySiteScope: [], ...o });
  it('Area Owner only for assigned areas', () => {
    const ao = u({ roles: ['AREA_OWNER'], ownedAreaIds: ['a1'] });
    expect(canReviewStage(ao, 'AREA_OWNER', 'a1', 's')).toBe(true);
    expect(canReviewStage(ao, 'AREA_OWNER', 'a2', 's')).toBe(false);
    expect(canReviewStage(ao, 'SAFETY_OFFICER', 'a1', 's')).toBe(false);
  });
  it('Safety Officer only within site scope; admin role grants no approval', () => {
    expect(canReviewStage(u({ roles: ['SAFETY_OFFICER'], safetySiteScope: ['s1'] }), 'SAFETY_OFFICER', 'a', 's1')).toBe(true);
    expect(canReviewStage(u({ roles: ['SAFETY_OFFICER'], safetySiteScope: ['s1'] }), 'SAFETY_OFFICER', 'a', 's2')).toBe(false);
    expect(canReviewStage(u({ roles: ['SAFETY_OFFICER'], safetySiteScope: 'ALL' }), 'SAFETY_OFFICER', 'a', 's2')).toBe(true);
    expect(canReviewStage(u({ roles: ['ADMIN'], safetySiteScope: 'ALL', ownedAreaIds: ['a'] }), 'SAFETY_OFFICER', 'a', 's')).toBe(false);
    expect(canReviewStage(u({ roles: ['ADMIN'], ownedAreaIds: ['a'] }), 'AREA_OWNER', 'a', 's')).toBe(false);
  });
});

describe('utilities', () => {
  it('canonical JSON is key-order independent', () => { expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 })); });
  it('password policy', () => { expect(passwordPolicy('short1')).toBe(false); expect(passwordPolicy('longenoughpassword')).toBe(false); expect(passwordPolicy('longenough123')).toBe(true); });
  it('neutralises spreadsheet formula injection and writes a UTF-8 BOM', () => {
    expect(safeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(toCsv([{ key: 'a', header: 'ชื่อ' }], [{ a: 'ไทย, "x"' }])).toBe('﻿ชื่อ\r\n"ไทย, ""x"""');
  });
  it('inserts zero-width break opportunities between Thai words only', () => {
    expect(thaiWrap('Hello world')).toBe('Hello world');
    expect(thaiWrap('งานบนที่สูง')).toContain('​');
    expect(thaiWrap('งานบนที่สูง').replace(/​/g, '')).toBe('งานบนที่สูง');
    expect(lighten('#000000', 0.5)).toBe('#808080');
  });
});
