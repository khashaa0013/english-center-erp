// =====================================================================
// M1/M5 — Эцэг эх: өөрийн нэвтрэх эрхтэй (сурагчийн нэрээр нэвтрэхгүй)
// =====================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { authorize, STAFF } from '../middleware/auth.js';
import { isSuper } from '../middleware/scope.js';
import { idParam, validate, zOptStr, zStr } from '../middleware/validate.js';

const router = Router();
router.use(authorize(STAFF));

// Эцэг эх нь салбаргүй байж болох тул салбарын хязгаарыг хүүхдээр нь тогтооно
const scopeWhere = (req) => (isSuper(req) ? {} : {
  OR: [
    { children: { some: { student: { branchId: req.user.branchId } } } },
    { user: { branchId: req.user.branchId } },
  ],
});

router.get('/', async (req, res) => {
  const { q } = req.query;
  const where = {
    AND: [
      scopeWhere(req),
      q ? { OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { phone: { contains: q } }] } : {},
    ],
  };
  res.json(await prisma.parent.findMany({
    where,
    include: {
      user: { select: { username: true, isActive: true } },
      children: { include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } } } },
    },
    orderBy: { id: 'desc' },
    take: 500,
  }));
});

router.get('/:id', async (req, res) => {
  const parent = await prisma.parent.findFirst({
    where: { id: idParam(req), ...scopeWhere(req) },
    include: {
      user: { select: { username: true, isActive: true, lastLoginAt: true } },
      children: { include: { student: true, verifier: { select: { displayName: true } } } },
      requests: { orderBy: { id: 'desc' }, take: 20 },
    },
  });
  if (!parent) throw notFound();
  res.json(parent);
});

// Эцэг эх үүсгэхэд нэвтрэх эрх хамт үүснэ (нэвтрэх нэр = утасны дугаар)
router.post(
  '/',
  validate(z.object({
    lastName: zStr(100),
    firstName: zStr(100),
    phone: z.string().trim().regex(/^\+?\d{8,15}$/, 'Утасны дугаар буруу'),
    email: z.string().email().optional().nullable(),
    password: z.string().min(8, 'Нууц үг хамгийн багадаа 8 тэмдэгт'),
  })),
  async (req, res) => {
    const { password, ...data } = req.body;
    const role = await prisma.role.findUnique({ where: { code: 'PARENT' } });
    const parent = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: data.phone,
          displayName: `${data.lastName} ${data.firstName}`,
          email: data.email ?? null,
          passwordHash: await bcrypt.hash(password, env.bcryptRounds),
          roleId: role.id,
          branchId: req.user.branchId,
        },
      });
      return tx.parent.create({ data: { ...data, userId: user.id } });
    });
    await writeAudit(req, { action: 'CREATE', entityType: 'Parent', entityId: parent.id, newValues: parent });
    res.status(201).json({ ...parent, username: parent.phone });
  },
);

router.put(
  '/:id',
  validate(z.object({ lastName: zStr(100).optional(), firstName: zStr(100).optional(), email: zOptStr(150) })),
  async (req, res) => {
    const id = idParam(req);
    const old = await prisma.parent.findFirst({ where: { id, ...scopeWhere(req) } });
    if (!old) throw forbidden();
    const parent = await prisma.parent.update({ where: { id }, data: req.body });
    await writeAudit(req, { action: 'UPDATE', entityType: 'Parent', entityId: id, oldValues: old, newValues: parent });
    res.json(parent);
  },
);

export default router;
