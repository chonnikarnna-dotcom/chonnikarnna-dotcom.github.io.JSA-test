import request from 'supertest';
import { createApp } from '../src/app';
import { db } from '../src/db/client';
import * as s from '../src/db/schema';
import { eq } from 'drizzle-orm';

export const app = createApp();
export const PASSWORD = 'Passw0rd!2026';

export type Client = { agent: ReturnType<typeof request.agent>; csrf: string; userId: string;
  get: (p: string) => request.Test; post: (p: string, b?: object) => request.Test; put: (p: string, b?: object) => request.Test; del: (p: string) => request.Test };

export async function as(username: string, password = PASSWORD): Promise<Client> {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/login').send({ identifier: username, password });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  const csrf = r.body.csrfToken as string;
  return {
    agent, csrf, userId: r.body.user.id,
    get: (p) => agent.get(`/api/v1${p}`),
    post: (p, b = {}) => agent.post(`/api/v1${p}`).set('X-CSRF-Token', csrf).send(b),
    put: (p, b = {}) => agent.put(`/api/v1${p}`).set('X-CSRF-Token', csrf).send(b),
    del: (p) => agent.delete(`/api/v1${p}`).set('X-CSRF-Token', csrf),
  };
}

export async function ref() {
  const areas = await db.select().from(s.factoryAreas);
  const jt = await db.select().from(s.jobTypes);
  const pt = await db.select().from(s.permitTypes);
  return {
    area: (code: string) => areas.find((a) => a.code === code)!.id,
    jobType: (code: string) => jt.find((a) => a.code === code)!.id,
    permit: (code: string) => pt.find((a) => a.code === code)!.id,
  };
}

export const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

export async function validDraft(overrides: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const r = await ref();
  return {
    jobTitle: 'Test job', jobDescription: 'Scope of the test job', areaId: r.area('A-BTL1'), exactLocation: 'Line 1',
    jobTypeId: r.jobType('MAINT_MECH'), workerCount: 2, supervisorName: 'Supervisor', contactPhone: '0800000000',
    plannedStart: hours(24), plannedEnd: hours(30),
    steps: [{ activity: 'Isolate machine', hazards: [{ hazard: 'Moving parts', consequence: 'Crush', existingControls: 'LOTO', initialSeverity: 4, initialLikelihood: 3, residualSeverity: 4, residualLikelihood: 1 }] }],
    ...overrides,
  };
}

/** Create + submit as requester; returns ids. */
export async function submitted(requester: Client, overrides: Record<string, unknown> = {}) {
  const c = await requester.post('/jsas', await validDraft(overrides));
  if (c.status !== 201) throw new Error(JSON.stringify(c.body));
  const sub = await requester.post(`/jsas/${c.body.id}/submit`, { declarationAccepted: true, language: 'en' });
  if (sub.status !== 200) throw new Error(JSON.stringify(sub.body));
  return c.body.id as string;
}

export async function task(reviewer: Client, jsaId: string) {
  const d = await reviewer.get(`/jsas/${jsaId}`);
  return d.body.permissions?.review as { taskId: string; versionId: string; stage: string } | null;
}

export async function pendingTask(jsaId: string) {
  const inst = await db.query.approvalInstances.findFirst({ where: (t, { and, eq: e }) => and(e(t.jsaId, jsaId), e(t.status, 'IN_PROGRESS')), with: { tasks: true } });
  const t = inst?.tasks.find((x) => x.status === 'PENDING');
  return t ? { taskId: t.id, versionId: inst!.versionId, stage: t.stage } : null;
}

export { db, s, eq };

/** Assert a raw SQL statement is rejected by a database guard (message is on the driver error cause). */
export async function expectDbReject(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) {
    const msg = `${(e as Error).message} ${((e as { cause?: Error }).cause?.message) ?? ''}`;
    if (!re.test(msg)) throw new Error(`unexpected error: ${msg}`);
    return;
  }
  throw new Error('expected the statement to be rejected');
}
