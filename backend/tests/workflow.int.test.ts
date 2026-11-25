import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { as, Client, db, eq, expectDbReject, hours, pendingTask, ref, s, submitted, validDraft } from './helpers';
import { nextReferenceNo } from '../src/services/reference';
import { runExpiryJob } from '../src/jobs/scheduler';

const pdfBuffer = () => new Promise<Buffer>((resolve) => { const d = new PDFDocument(); const c: Buffer[] = []; d.on('data', (x) => c.push(x)); d.on('end', () => resolve(Buffer.concat(c))); d.text('test'); d.end(); });

let c1: Client, c2: Client, emp: Client, ao1: Client, ao2: Client, so1: Client, so2: Client, admin: Client;
beforeAll(async () => {
  [c1, c2, emp, ao1, ao2, so1, so2, admin] = await Promise.all(['contractor1', 'contractor2', 'somchai', 'areaowner1', 'areaowner2', 'safety1', 'safety2', 'admin'].map((u) => as(u)));
});

describe('reference numbers under concurrency', () => {
  it('50 parallel generations are all unique and sequential', async () => {
    const refs = await Promise.all(Array.from({ length: 50 }, () => db.transaction((t) => nextReferenceNo(t))));
    expect(new Set(refs).size).toBe(50);
    const nums = refs.map((r) => Number(r.split('-')[2])).sort((a, b) => a - b);
    expect(nums[49] - nums[0]).toBe(49);
  });
});

describe('create, submit and full approval', () => {
  let id = '';
  it('creates a draft with server-generated reference and server-calculated risk', async () => {
    const r = await c1.post('/jsas', await validDraft({ jobTitle: 'Integration main flow' }));
    expect(r.status).toBe(201);
    expect(r.body.referenceNo).toMatch(/^JSA-\d{4}-\d{5}$/);
    id = r.body.id;
    const d = await c1.get(`/jsas/${id}`);
    expect(d.body.jsa.status).toBe('DRAFT');
    expect(d.body.version.requesterName).toMatch(/Anan/); // from session, not client
    expect(d.body.content.steps[0].hazards[0].initial).toMatchObject({ score: 12, levelCode: 'HIGH' });
    expect(d.body.content.steps[0].hazards[0].residual).toMatchObject({ score: 4, levelCode: 'LOW' });
  });
  it('ignores client-supplied identity fields', async () => {
    const r = await c1.post('/jsas', { ...(await validDraft()), requesterId: ao1.userId, requesterName: 'Fake', contractorCompanyId: null });
    const j = await db.query.jsas.findFirst({ where: eq(s.jsas.id, r.body.id) });
    expect(j!.requesterId).toBe(c1.userId);
  });
  it('rejects submission without the declaration and with missing data', async () => {
    expect((await c1.post(`/jsas/${id}/submit`, {})).status).toBe(400);
    const bad = await c1.post('/jsas', { jobTitle: 'x' });
    const r = await c1.post(`/jsas/${bad.body.id}/submit`, { declarationAccepted: true });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SUBMISSION_INVALID');
    expect(r.body.error.details.map((d: { code: string }) => d.code)).toContain('min_one_step');
  });
  it('submits, locks the version and assigns the Area Owner', async () => {
    const r = await c1.post(`/jsas/${id}/submit`, { declarationAccepted: true, language: 'th' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('PENDING_AREA_OWNER');
    const t = await pendingTask(id);
    expect(t!.stage).toBe('AREA_OWNER');
    const decl = await db.select().from(s.jsaDeclarations).where(eq(s.jsaDeclarations.versionId, t!.versionId));
    expect(decl[0].userId).toBe(c1.userId);
    expect(decl[0].textSnapshot).toMatch(/ข้าพเจ้า/);
    const n = await ao1.get('/notifications?unreadOnly=true&lang=en');
    expect(n.body.items.some((x: { type: string; jsaId: string }) => x.type === 'REVIEW_REQUIRED_AREA_OWNER' && x.jsaId === id)).toBe(true);
    // locked versions are immutable at the database level
    await expectDbReject(db.execute(sql`UPDATE jsa_versions SET job_title = 'tamper' WHERE id = ${t!.versionId}`), /locked/);
    await expectDbReject(db.execute(sql`DELETE FROM jsa_job_steps WHERE version_id = ${t!.versionId}`), /locked/);
    // and cannot be edited through the API
    expect((await c1.put(`/jsas/${id}`, await validDraft())).status).toBe(409);
  });
  it('Safety Officer cannot act before the Area Owner', async () => {
    const t = await pendingTask(id);
    const r = await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_ASSIGNED_REVIEWER');
  });
  it('Area Owner approves → routed to Safety Officer', async () => {
    const t = await pendingTask(id);
    const r = await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId, comment: 'ok' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('PENDING_SAFETY_OFFICER');
    expect((await so1.get('/approvals/inbox')).body.items.some((i: { jsaId: string }) => i.jsaId === id)).toBe(true);
    // safety2 is scoped to Plant B only → not eligible for a Plant A JSA
    const t2 = await pendingTask(id);
    const r2 = await so2.post(`/approvals/tasks/${t2!.taskId}/approve`, { versionId: t2!.versionId });
    expect(r2.status).toBe(403);
  });
  it('Safety Officer final approval sets validity and records history', async () => {
    const t = await pendingTask(id);
    const r = await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId, comment: 'final' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('APPROVED');
    const d = await c1.get(`/jsas/${id}`);
    expect(d.body.jsa.approvedVersionId).toBe(t!.versionId);
    expect(new Date(d.body.jsa.validUntil).getTime()).toBe(new Date(d.body.content.plannedEnd).getTime());
    expect(d.body.approvalHistory.map((h: { decision: string; stage: string | null }) => `${h.stage ?? 'REQ'}:${h.decision}`))
      .toEqual(['REQ:SUBMITTED', 'AREA_OWNER:APPROVED', 'SAFETY_OFFICER:APPROVED']);
    await expectDbReject(db.execute(sql`UPDATE approval_history SET comment = 'x' WHERE jsa_id = ${id}`), /append-only/);
    const pdf = await c1.get(`/jsas/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    // the task cannot be approved twice
    expect((await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(409);
  });
  it('approved JSA cannot be edited in place; completion is a separate event', async () => {
    expect((await c1.put(`/jsas/${id}`, await validDraft())).status).toBe(409);
    expect((await c1.post(`/jsas/${id}/complete`, { note: 'early' })).body.error.code).toBe('NOT_STARTED');
    await db.update(s.jsas).set({ validFrom: new Date(Date.now() - 1000) }).where(eq(s.jsas.id, id));
    const r = await c1.post(`/jsas/${id}/complete`, { note: 'done' });
    expect(r.status).toBe(200);
    expect((await c1.get(`/jsas/${id}`)).body.jsa.status).toBe('COMPLETED');
  });
});

describe('return, revision, resubmission and re-approval', () => {
  it('preserves versions and requires both stages again', async () => {
    const id = await submitted(emp, { jobTitle: 'Revision flow' });
    const t = await pendingTask(id);
    expect((await ao1.post(`/approvals/tasks/${t!.taskId}/return`, { versionId: t!.versionId })).body.error.code).toBe('COMMENT_REQUIRED');
    expect((await ao1.post(`/approvals/tasks/${t!.taskId}/return`, { versionId: t!.versionId, comment: 'Add barricade step' })).status).toBe(200);
    expect((await emp.get(`/jsas/${id}`)).body.jsa.status).toBe('RETURNED');
    const rev = await emp.post(`/jsas/${id}/revisions`, { reason: 'barricade' });
    expect(rev.body.versionNo).toBe(2);
    const draft = await validDraft({ jobTitle: 'Revision flow', exactLocation: 'Moved location' });
    expect((await emp.put(`/jsas/${id}`, draft)).status).toBe(200);
    // stale: the old (returned) task can no longer be used
    expect((await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(409);
    const rs = await emp.post(`/jsas/${id}/submit`, { declarationAccepted: true, language: 'en' });
    expect(rs.status, JSON.stringify(rs.body)).toBe(200);
    const d = await emp.get(`/jsas/${id}`);
    expect(d.body.version.versionNo).toBe(2);
    expect(d.body.version.changeSummary.changedFields).toContain('exactLocation');
    expect(d.body.version.changeSummary.criticalChange).toBe(true);
    const t2 = await pendingTask(id);
    expect(t2!.stage).toBe('AREA_OWNER');
    // approving with the old version id is rejected as stale
    expect((await ao1.post(`/approvals/tasks/${t2!.taskId}/approve`, { versionId: t!.versionId })).body.error.code).toBe('STALE_VERSION');
    expect((await ao1.post(`/approvals/tasks/${t2!.taskId}/approve`, { versionId: t2!.versionId })).status).toBe(200);
    const t3 = await pendingTask(id);
    expect((await so1.post(`/approvals/tasks/${t3!.taskId}/approve`, { versionId: t3!.versionId })).status).toBe(200);
    const v1 = await emp.get(`/jsas/${id}?version=1`);
    expect(v1.body.content.exactLocation).toBe('Line 1');
    expect(v1.body.approvalHistory.some((h: { comment: string }) => h.comment === 'Add barricade step')).toBe(true);
    // reviewers can see locked versions only
    expect((await ao1.get(`/jsas/${id}`)).body.versions.every((v: { locked: boolean }) => v.locked)).toBe(true);
  });
});

describe('rejection and cancellation', () => {
  it('rejected workflow cannot be approved further', async () => {
    const id = await submitted(emp);
    const t = await pendingTask(id);
    expect((await ao1.post(`/approvals/tasks/${t!.taskId}/reject`, { versionId: t!.versionId, comment: 'Not now' })).status).toBe(200);
    expect((await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(409);
    expect((await emp.post(`/jsas/${id}/revisions`, {})).status).toBe(409);
  });
  it('cancellation withdraws pending reviews', async () => {
    const id = await submitted(emp);
    const t = await pendingTask(id);
    expect((await emp.post(`/jsas/${id}/cancel`, { reason: 'no' })).status).toBe(400);
    expect((await emp.post(`/jsas/${id}/cancel`, { reason: 'Job postponed' })).status).toBe(200);
    expect(await pendingTask(id)).toBeNull();
    expect((await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(409);
  });
});

describe('concurrency: duplicate approval actions', () => {
  it('exactly one of two simultaneous approvals succeeds', async () => {
    const id = await submitted(emp);
    const t = await pendingTask(id);
    const [a, b] = await Promise.all([
      ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId }),
      ao2.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const tasks = await db.select().from(s.approvalTasks).where(eq(s.approvalTasks.stage, 'SAFETY_OFFICER'));
    const inst = await db.query.approvalInstances.findFirst({ where: eq(s.approvalInstances.jsaId, id) });
    expect(tasks.filter((x) => x.instanceId === inst!.id)).toHaveLength(1);
  });
});

describe('final-approval safety prerequisites', () => {
  it('blocks final approval when residual risk exceeds the acceptance rule', async () => {
    const r = await ref();
    const id = await submitted(emp, { steps: [{ activity: 'x', hazards: [{ hazard: 'h', consequence: 'c', existingControls: 'e', initialSeverity: 5, initialLikelihood: 4, residualSeverity: 5, residualLikelihood: 2 }] }], areaId: r.area('A-BTL1') });
    let t = await pendingTask(id);
    await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    t = await pendingTask(id);
    const res = await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    expect(res.status).toBe(422);
    expect(res.body.error.details.problems.map((p: { code: string }) => p.code)).toContain('RESIDUAL_RISK_NOT_ACCEPTABLE');
  });
  it('requires permit evidence and Safety Officer verification', async () => {
    const r = await ref();
    const draft = await validDraft({ emergencyContactName: 'ERT', emergencyContactPhone: '1199',
      permits: [{ permitTypeId: r.permit('CONFINED_SPACE'), referenceNo: 'CSE-1', answers: { gas_test: true, standby_person: true, rescue_plan: 'RP' } }] });
    const c = await emp.post('/jsas', draft);
    const sub = await emp.post(`/jsas/${c.body.id}/submit`, { declarationAccepted: true });
    expect(sub.body.error.details.map((d: { code: string }) => d.code)).toContain('evidence_required');
    const up = await emp.agent.post(`/api/v1/jsas/${c.body.id}/attachments`).set('X-CSRF-Token', emp.csrf).field('category', 'WORK_PERMIT').attach('file', await pdfBuffer(), 'permit.pdf');
    expect(up.status).toBe(201);
    draft.permits[0] = { ...(draft.permits as object[])[0], attachmentId: up.body.id } as never;
    await emp.put(`/jsas/${c.body.id}`, draft);
    const rs = await emp.post(`/jsas/${c.body.id}/submit`, { declarationAccepted: true });
    expect(rs.status, JSON.stringify(rs.body)).toBe(200);
    let t = await pendingTask(c.body.id);
    await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    t = await pendingTask(c.body.id);
    const noVerify = await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    expect(noVerify.body.error.details.problems.map((p: { code: string }) => p.code)).toContain('PERMIT_NOT_VERIFIED');
    const d = await so1.get(`/jsas/${c.body.id}`);
    const ok = await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId, verifiedPermitRefIds: d.body.content.permits.map((p: { id: string }) => p.id) });
    expect(ok.status).toBe(200);
    expect((await emp.get(`/jsas/${c.body.id}`)).body.content.permits[0].verified).toBe(true);
  });
  it('expiry job marks approved JSAs past validity as EXPIRED and notifies', async () => {
    const id = await submitted(emp);
    let t = await pendingTask(id); await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    t = await pendingTask(id); await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    await db.update(s.jsas).set({ validUntil: new Date(Date.now() - 60_000) }).where(eq(s.jsas.id, id));
    const r = await runExpiryJob();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await emp.get(`/jsas/${id}`)).body.jsa.status).toBe('EXPIRED');
    expect((await emp.get('/notifications?limit=50')).body.items.some((n: { type: string; jsaId: string }) => n.type === 'JSA_EXPIRED' && n.jsaId === id)).toBe(true);
  });
});

describe('attachments', () => {
  let jsaId = ''; let attId = '';
  it('validates type, size and content on upload', async () => {
    const c = await c1.post('/jsas', await validDraft());
    jsaId = c.body.id;
    const up = (buf: Buffer, name: string) => c1.agent.post(`/api/v1/jsas/${jsaId}/attachments`).set('X-CSRF-Token', c1.csrf).field('category', 'PHOTO').attach('file', buf, name);
    expect((await up(Buffer.from('MZ evil'), 'run.exe')).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await up(Buffer.from('not really a pdf'), 'fake.pdf')).body.error.code).toBe('FILE_CONTENT_MISMATCH');
    const ok = await up(await pdfBuffer(), '../../etc/passwd.pdf');
    expect(ok.status).toBe(201);
    expect(ok.body.originalName).not.toContain('/');
    attId = ok.body.id;
    const row = await db.query.jsaAttachments.findFirst({ where: eq(s.jsaAttachments.id, attId) });
    expect(row!.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(row!.uploadedById).toBe(c1.userId);
  });
  it('downloads only for authorized users', async () => {
    const own = await c1.get(`/attachments/${attId}/download`);
    expect(own.status).toBe(200);
    expect(own.headers['content-disposition']).toMatch(/attachment/);
    expect((await c2.get(`/attachments/${attId}/download`)).status).toBe(404);
    // reviewers cannot see draft attachments before submission
    expect((await ao1.get(`/attachments/${attId}/download`)).status).toBe(404);
    await c1.post(`/jsas/${jsaId}/submit`, { declarationAccepted: true });
    expect((await ao1.get(`/attachments/${attId}/download`)).status).toBe(200);
    expect((await c2.get(`/attachments/00000000-0000-0000-0000-000000000000/download`)).status).toBe(404);
  });
  it('cannot be removed after submission', async () => {
    expect((await c1.del(`/attachments/${attId}`)).status).toBe(409);
  });
});

describe('dashboard and register', () => {
  it('dashboard totals equal database counts within the user scope', async () => {
    const d = await admin.get('/reports/dashboard');
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.jsas).where(sql`deleted_at IS NULL`);
    expect(d.body.cards.total).toBe(n);
    const [{ a }] = await db.select({ a: sql<number>`count(*)::int` }).from(s.jsas).where(sql`status = 'APPROVED' AND deleted_at IS NULL`);
    expect(d.body.cards.approved).toBe(a);
    const mine = await c1.get('/reports/dashboard');
    const [{ m }] = await db.select({ m: sql<number>`count(*)::int` }).from(s.jsas).where(sql`requester_id = ${c1.userId} AND deleted_at IS NULL`);
    expect(mine.body.cards.total).toBe(m);
  });
  it('register search, pagination and export respect record-level permissions', async () => {
    const all = await c2.get('/jsas?pageSize=100');
    expect(all.body.items.every((x: { requesterId: string }) => x.requesterId === c2.userId)).toBe(true);
    const p1 = await admin.get('/jsas?pageSize=2&page=1&sort=referenceNo&order=asc');
    const p2 = await admin.get('/jsas?pageSize=2&page=2&sort=referenceNo&order=asc');
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.items[1].referenceNo < p2.body.items[0].referenceNo).toBe(true);
    const exp = await c2.get('/jsas/export?format=csv&lang=en');
    expect(exp.status).toBe(200);
    expect(exp.text).not.toContain('Integration main flow');
    const adminExp = await admin.get('/jsas/export?format=csv&lang=en');
    expect(adminExp.text).toContain('Integration main flow');
    const xlsx = await admin.get('/jsas/export?format=xlsx').buffer(true);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const logs = await db.select().from(s.reportExportLogs);
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });
});

describe('audit integrity', () => {
  it('audit log is append-only and the hash chain verifies', async () => {
    await expectDbReject(db.execute(sql`DELETE FROM audit_logs`), /append-only/);
    await expectDbReject(db.execute(sql`TRUNCATE audit_logs`), /append-only/);
    const v = await admin.get('/audit-logs/verify');
    expect(v.body.ok).toBe(true);
    expect(v.body.checked).toBeGreaterThan(10);
    expect((await c1.get('/audit-logs')).status).toBe(403);
  });
  it('configuration changes are audited', async () => {
    await admin.put('/admin/validity', { mode: 'END_OF_WORK', durationHours: 24, maxWorkPeriodDays: 30, expiryReminderHours: 24, completionTrackingEnabled: true, minLeadTimeHours: 0 });
    const l = await admin.get('/audit-logs?entityType=VALIDITY_SETTINGS');
    expect(l.body.items[0].action).toBe('CONFIG_UPDATE');
    expect(JSON.stringify(l.body.items)).not.toMatch(/password_hash|\$argon2/);
  });
});

export { hours };
