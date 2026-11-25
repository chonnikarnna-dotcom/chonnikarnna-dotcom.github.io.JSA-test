import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { asyncH, requireAuth, requireRole } from '../middleware/core';
import { reviewTask, ReviewAction } from '../services/workflow';
import { getInbox } from '../services/reports';
import { getDetail } from '../services/jsa';

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth, requireRole('AREA_OWNER', 'SAFETY_OFFICER'));

approvalsRouter.get('/inbox', asyncH(async (req, res) => { res.json({ items: await getInbox(req.user!) }); }));

const reviewBody = z.object({
  versionId: z.string().uuid(),
  comment: z.string().trim().max(2000).optional().nullable(),
  verifiedPermitRefIds: z.array(z.string().uuid()).max(20).optional(),
});

const action = (a: ReviewAction) => asyncH(async (req, res) => {
  const taskId = z.string().uuid().parse(req.params.taskId);
  const body = reviewBody.parse(req.body);
  const result = await db.transaction((t) => reviewTask(t, req.user!, taskId, a, body));
  res.json(result);
});
approvalsRouter.post('/tasks/:taskId/approve', action('APPROVE'));
approvalsRouter.post('/tasks/:taskId/return', action('RETURN'));
approvalsRouter.post('/tasks/:taskId/reject', action('REJECT'));

/** Approval history of a visible JSA (also included in GET /jsas/:id). */
approvalsRouter.get('/history/:jsaId', asyncH(async (req, res) => {
  const d = await getDetail(req.user!, z.string().uuid().parse(req.params.jsaId));
  res.json({ items: d.approvalHistory, statusHistory: d.statusHistory });
}));
