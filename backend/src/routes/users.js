// =====================================================================
// M7 — Хэрэглэгч ба эрх
// =====================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { authorize } from '../middleware/auth.js';
import { assertBranch, branchFilter, isSuper } from '../middleware/scope.js';
import { idParam, validate, zOptId, zStr } from '../middleware/validate.js';

const router = Router();
router.use(authorize('SUPER_ADMIN', 'BRANCH_ADMIN'));

const ROLE_CODES = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE', 'TEACHER', 'STUDENT', 'PARENT'];
const publicUser = {
  id: true, username: true, email: true, displayName: true, isActive: true, lastLoginAt: true, createdAt: true,
  branchId: true, role: { select: { code: true, name: true } }, branch: { select: { id: true, name: true } },
};

router.get('/roles', async (_req, res) => {
  res.json(await prisma.role.findMany({ orderBy: { id: 'asc' } }));
});

router.get('/', async (req, res) => {
  const { role, q } = req.query;
  const where = {
    ...branchFilter(req),
    ...(role ? { role: { code: role } } : {}),
    ...(q ? { OR: [{ username: { contains: q } }, { displayName: { contains: q } }] } : {}),
  };
  if (!isSuper(req)) where.NOT = { role: { code: 'SUPER_ADMIN' } };
  res.json(await prisma.user.findMany({ where, select: publicUser, orderBy: { id: 'desc' }, take: 500 }));
});

const createSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Латин үсэг, тоо, . _ - л ашиглана'),
  email: z.string().email().optional().nullable(),
  displayName: zStr(150),
  password: z.string().min(8, 'Нууц үг хамгийн багадаа 8 тэмдэгт'),
  role: z.enum(ROLE_CODES),
  branchId: zOptId,
});

// Салбарын админ захирал үүсгэх, өөр салбарт хэрэглэгч нэмэх эрхгүй
function checkRoleGrant(req, role, branchId) {
  if (isSuper(req)) {
    if (role !== 'SUPER_ADMIN' && !branchId) throw badRequest('Захирлаас бусад хэрэглэгч салбартай байна');
    return role === 'SUPER_ADMIN' ? null : branchId;
  }
  if (role === 'SUPER_ADMIN' || role === 'BRANCH_ADMIN') throw forbidden('Энэ эрхийг олгох боломжгүй');
  return req.user.branchId;
}

router.post('/', validate(createSchema), async (req, res) => {
  const { password, role, ...rest } = req.body;
  const branchId = checkRoleGrant(req, role, rest.branchId);
  const roleRow = await prisma.role.findUnique({ where: { code: role } });
  const user = await prisma.user.create({
    data: { ...rest, branchId, roleId: roleRow.id, passwordHash: await bcrypt.hash(password, env.bcryptRounds) },
    select: publicUser,
  });
  await writeAudit(req, { action: 'CREATE', entityType: 'User', entityId: user.id, newValues: { ...user, password: undefined } });
  res.status(201).json(user);
});

router.put(
  '/:id',
  validate(z.object({
    email: z.string().email().optional().nullable(),
    displayName: zStr(150).optional(),
    isActive: z.boolean().optional(),
    role: z.enum(ROLE_CODES).optional(),
    branchId: zOptId,
    password: z.string().min(8).optional(),
  })),
  async (req, res) => {
    const id = idParam(req);
    const old = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!old) throw notFound();
    if (!isSuper(req)) {
      assertBranch(req, old.branchId);
      if (old.role.code === 'BRANCH_ADMIN' && old.id !== req.user.id) throw forbidden();
    }
    if (id === req.user.id && req.body.isActive === false) throw badRequest('Өөрийгөө идэвхгүй болгох боломжгүй');

    const { password, role, branchId, ...rest } = req.body;
    const data = { ...rest };
    if (role) {
      data.branchId = checkRoleGrant(req, role, branchId ?? old.branchId);
      data.roleId = (await prisma.role.findUnique({ where: { code: role } })).id;
    } else if (branchId !== undefined && isSuper(req)) {
      data.branchId = branchId;
    }
    if (password) data.passwordHash = await bcrypt.hash(password, env.bcryptRounds);

    const user = await prisma.user.update({ where: { id }, data, select: publicUser });
    await writeAudit(req, {
      action: 'UPDATE', entityType: 'User', entityId: id,
      oldValues: { displayName: old.displayName, isActive: old.isActive, role: old.role.code, branchId: old.branchId },
      newValues: { ...rest, role, branchId: data.branchId, passwordChanged: Boolean(password) },
    });
    res.json(user);
  },
);

export default router;
