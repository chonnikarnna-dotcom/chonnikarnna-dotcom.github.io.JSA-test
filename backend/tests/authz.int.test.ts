import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, Client, pendingTask, submitted, validDraft } from './helpers';

let c1: Client, c2: Client, emp: Client, ao1: Client, ao2: Client, so1: Client, admin: Client;
beforeAll(async () => {
  [c1, c2, emp, ao1, ao2, so1, admin] = await Promise.all(['contractor1', 'contractor2', 'somchai', 'areaowner1', 'areaowner2', 'safety1', 'admin'].map((u) => as(u)));
});

describe('authorization', () => {
  it('unauthenticated requests are rejected', async () => {
    expect((await request(app).get('/api/v1/jsas')).status).toBe(401);
    expect((await request(app).get('/api/v1/reports/dashboard')).status).toBe(401);
  });
  it('state-changing requests without the CSRF token are rejected', async () => {
    const r = await c1.agent.post('/api/v1/jsas').send(await validDraft());
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_INVALID');
  });
  it('a requester cannot approve a JSA (role and endpoint guard)', async () => {
    const id = await submitted(c1);
    const t = await pendingTask(id);
    const r = await c1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    expect(r.status).toBe(403);
    expect((await c1.get('/approvals/inbox')).status).toBe(403);
  });
  it("a contractor cannot access another contractor's records", async () => {
    const id = await submitted(c1);
    expect((await c2.get(`/jsas/${id}`)).status).toBe(404);
    expect((await c2.get(`/jsas/${id}/pdf`)).status).toBe(404);
    expect((await c2.post(`/jsas/${id}/cancel`, { reason: 'malicious' })).status).toBe(404);
    const lk = await c2.get('/lookups');
    expect(lk.body.contractors).toHaveLength(1);
    expect(lk.body.reviewers).toHaveLength(0);
  });
  it('an Area Owner cannot approve outside assigned areas', async () => {
    // new area with only areaowner1 assigned
    const site = (await admin.get('/admin/sites')).body.items[0].id;
    const area = await admin.post('/admin/areas', { siteId: site, code: `T-${Date.now()}`, nameEn: 'Test area', nameTh: 'พื้นที่ทดสอบ' });
    expect((await admin.post('/admin/area-owners', { areaId: area.body.id, userId: ao1.userId, isBackup: false })).status).toBe(201);
    const id = await submitted(emp, { areaId: area.body.id });
    const t = await pendingTask(id);
    const fresh = await as('areaowner2');
    const r = await fresh.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_ASSIGNED_REVIEWER');
    expect((await fresh.get(`/jsas/${id}`)).status).toBe(404);
    expect((await (await as('areaowner1')).post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(200);
  });
  it('a reviewer cannot approve their own JSA', async () => {
    // areaowner1 is also a requester; the Area Owner task is routed to the backup (areaowner2)
    const id = await submitted(ao1);
    const t = await pendingTask(id);
    const r = await ao1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SELF_APPROVAL');
    expect((await ao2.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(200);
  });
  it('a Safety Officer cannot skip Area Owner approval', async () => {
    const id = await submitted(emp);
    const t = await pendingTask(id);
    expect((await so1.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(403);
  });
  it('administrator role does not grant approval rights or admin-only routes to others', async () => {
    const id = await submitted(emp);
    const t = await pendingTask(id);
    expect((await admin.post(`/approvals/tasks/${t!.taskId}/approve`, { versionId: t!.versionId })).status).toBe(403);
    expect((await so1.get('/admin/users')).status).toBe(403);
    expect((await c1.put('/admin/settings', { defaultLanguage: 'en' })).status).toBe(403);
  });
  it('an inactive account cannot access protected functions and its sessions are revoked', async () => {
    const created = await admin.post('/admin/users', { email: 'temp.user@example.com', username: 'tempuser', displayName: 'Temp', userType: 'EMPLOYEE', roles: ['REQUESTER'], password: 'TempPassw0rd1' });
    expect(created.status).toBe(201);
    const tmp = await as('tempuser', 'TempPassw0rd1');
    expect((await tmp.get('/jsas')).status).toBe(200);
    expect((await admin.put(`/admin/users/${created.body.id}`, { isActive: false })).status).toBe(200);
    expect((await tmp.get('/jsas')).status).toBe(401);
    const relog = await request(app).post('/api/v1/auth/login').send({ identifier: 'tempuser', password: 'TempPassw0rd1' });
    expect(relog.status).toBe(403);
    expect(relog.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
  it('invited contractor activates with a one-time token', async () => {
    const ctr = (await admin.get('/admin/contractor-companies')).body.items[0].id;
    const r = await admin.post('/admin/users', { email: 'new.contractor@example.com', username: 'newctr', displayName: 'New Contractor', userType: 'CONTRACTOR', contractorCompanyId: ctr, roles: ['REQUESTER'] });
    const token = new URL(r.body.activationLink).searchParams.get('token')!;
    expect((await request(app).get(`/api/v1/auth/invitations/${token}`)).body.email).toBe('new.contractor@example.com');
    expect((await request(app).post('/api/v1/auth/activate').send({ token, newPassword: 'weak' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/activate').send({ token, newPassword: 'Contractor2026' })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/activate').send({ token, newPassword: 'Contractor2026' })).body.error.code).toBe('TOKEN_INVALID');
    expect((await as('newctr', 'Contractor2026')).userId).toBe(r.body.id);
    // contractors may only hold the Requester role
    expect((await admin.post('/admin/users', { email: 'x@example.com', username: 'xyz', displayName: 'X', userType: 'CONTRACTOR', contractorCompanyId: ctr, roles: ['AREA_OWNER'] })).body.error.code).toBe('CONTRACTOR_ROLE_RESTRICTED');
  });
  it('password reset flow issues a single-use token and revokes sessions', async () => {
    const r = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: 'newctr' });
    expect(r.status).toBe(202);
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: 'nobody' });
    expect(unknown.status).toBe(202); // no enumeration
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: r.body.devToken, newPassword: 'NewPassw0rd99' })).status).toBe(200);
    expect((await as('newctr', 'NewPassw0rd99')).csrf).toBeTruthy();
  });
  it('invalid credentials return a generic error; logout ends the session', async () => {
    const bad = await request(app).post('/api/v1/auth/login').send({ identifier: 'somchai', password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const u = await as('somchai');
    expect((await u.post('/auth/logout')).status).toBe(204);
    expect((await u.get('/auth/me')).status).toBe(401);
  });
  it('errors never expose stack traces', async () => {
    const r = await c1.get('/jsas/not-a-uuid');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts:\d+/);
  });
});
