// =====================================================================
// M7 — Систем доторх мэдэгдэл (хэрэглэгч бүр зөвхөн өөрийнхийг)
// =====================================================================
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { idParam } from '../middleware/validate.js';

const router = Router();

router.get('/', async (req, res) => {
  const where = { userId: req.user.id, ...(req.query.unread === '1' ? { isRead: false } : {}) };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { id: 'desc' }, take: 100 }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
  ]);
  res.json({ items, unread });
});

router.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: idParam(req), userId: req.user.id }, data: { isRead: true } });
  res.json({ ok: true });
});

router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
  res.json({ ok: true });
});

export default router;
