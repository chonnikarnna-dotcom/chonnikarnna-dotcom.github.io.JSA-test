import { Router } from 'express';
import { z } from 'zod';
import { asyncH, requireAuth } from '../middleware/core';
import { listNotifications, markRead } from '../services/notifications';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', asyncH(async (req, res) => {
  const q = z.object({
    unreadOnly: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0), lang: z.enum(['th', 'en']).optional(),
  }).parse(req.query);
  res.json(await listNotifications(req.user!.id, q.lang ?? req.user!.preferredLanguage, { unreadOnly: q.unreadOnly === 'true', limit: q.limit, offset: q.offset }));
}));

notificationsRouter.post('/read', asyncH(async (req, res) => {
  const body = z.object({ ids: z.union([z.literal('ALL'), z.array(z.string().uuid()).max(200)]) }).parse(req.body);
  await markRead(req.user!.id, body.ids);
  res.json({ ok: true });
}));
