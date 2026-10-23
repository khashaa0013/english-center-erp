// =====================================================================
// M7 — Audit log харах (залруулгын түүх)
// =====================================================================
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authorize } from '../middleware/auth.js';
import { branchFilter } from '../middleware/scope.js';

const router = Router();
router.use(authorize('SUPER_ADMIN', 'BRANCH_ADMIN'));

router.get('/', async (req, res) => {
  const { entityType, entityId, action, from, to } = req.query;
  const where = {
    ...branchFilter(req),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId: Number(entityId) } : {}),
    ...(action ? { action } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59+08:00`) } : {}) } } : {}),
  };
  const items = await prisma.auditLog.findMany({
    where,
    orderBy: { id: 'desc' },
    take: 300,
    include: {
      user: { select: { id: true, displayName: true, username: true } },
      approver: { select: { id: true, displayName: true } },
    },
  });
  res.json(items);
});

export default router;
