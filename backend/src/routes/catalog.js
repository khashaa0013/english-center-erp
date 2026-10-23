// =====================================================================
// M4 — Каталог: англи хэлний түвшин, хөтөлбөр, курс, үнийн багц, танхим
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { authorize, STAFF } from '../middleware/auth.js';
import { assertBranch, branchFilter, resolveBranchId } from '../middleware/scope.js';
import { idParam, validate, zId, zMoney, zOptId, zOptStr, zStr } from '../middleware/validate.js';

const router = Router();
const staffOnly = authorize(STAFF);

// Энгийн CRUD: жагсаалт бүх нэвтэрсэн хэрэглэгчид, өөрчлөлт зөвхөн ажилтанд
function crud(path, delegateName, entityType, schema, { include, orderBy = { id: 'asc' }, listWhere } = {}) {
  const delegate = prisma[delegateName];

  router.get(path, async (req, res) => {
    const where = { ...(listWhere ? listWhere(req) : {}), ...(req.query.active === '1' ? { isActive: true } : {}) };
    res.json(await delegate.findMany({ where, include, orderBy }));
  });

  router.post(path, staffOnly, validate(schema), async (req, res) => {
    const row = await delegate.create({ data: req.body, include });
    await writeAudit(req, { action: 'CREATE', entityType, entityId: row.id, newValues: req.body });
    res.status(201).json(row);
  });

  router.put(`${path}/:id`, staffOnly, validate(schema.partial()), async (req, res) => {
    const id = idParam(req);
    const old = await delegate.findUnique({ where: { id } });
    if (!old) throw notFound();
    const row = await delegate.update({ where: { id }, data: req.body, include });
    await writeAudit(req, { action: 'UPDATE', entityType, entityId: id, oldValues: old, newValues: req.body });
    res.json(row);
  });
}

crud('/levels', 'englishLevel', 'EnglishLevel', z.object({
  code: zStr(10),
  name: zStr(100),
  sortOrder: z.coerce.number().int().optional(),
}), { orderBy: { sortOrder: 'asc' } });

crud('/programs', 'program', 'Program', z.object({
  name: zStr(150),
  targetGroup: zOptStr(100),
  description: zOptStr(5000),
  isActive: z.boolean().optional(),
}), { include: { _count: { select: { courses: true } } } });

crud('/courses', 'course', 'Course', z.object({
  programId: zId,
  levelId: zId,
  code: zStr(20),
  name: zStr(150),
  totalSessions: z.coerce.number().int().min(1).max(500),
  sessionMinutes: z.coerce.number().int().min(15).max(480).optional(),
  minAttendancePercent: z.coerce.number().min(0).max(100).optional(),
  minFinalScore: z.coerce.number().min(0).max(100).optional(),
  requireFullPayment: z.boolean().optional(),
  isActive: z.boolean().optional(),
}), {
  include: { program: { select: { id: true, name: true } }, level: true, packages: { where: { isActive: true } } },
  listWhere: (req) => (req.query.programId ? { programId: Number(req.query.programId) } : {}),
});

crud('/packages', 'trainingPackage', 'TrainingPackage', z.object({
  courseId: zId,
  name: zStr(150),
  sessionsCount: z.coerce.number().int().min(1).max(500),
  durationWeeks: z.coerce.number().int().min(1).max(104),
  price: zMoney,
  isActive: z.boolean().optional(),
}), {
  include: { course: { select: { id: true, code: true, name: true } } },
  listWhere: (req) => (req.query.courseId ? { courseId: Number(req.query.courseId) } : {}),
});

// ----- Танхим (салбар тус бүрийн) -----
const classroomSchema = z.object({
  branchId: zOptId,
  name: zStr(50),
  capacity: z.coerce.number().int().min(1).max(500),
  isActive: z.boolean().optional(),
});

router.get('/classrooms', async (req, res) => {
  res.json(await prisma.classroom.findMany({
    where: { ...branchFilter(req), ...(req.query.active === '1' ? { isActive: true } : {}) },
    include: { branch: { select: { name: true } } },
    orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
  }));
});

router.post('/classrooms', staffOnly, validate(classroomSchema), async (req, res) => {
  const branchId = resolveBranchId(req, req.body.branchId);
  const row = await prisma.classroom.create({ data: { ...req.body, branchId } });
  await writeAudit(req, { action: 'CREATE', entityType: 'Classroom', entityId: row.id, newValues: row, branchId });
  res.status(201).json(row);
});

router.put('/classrooms/:id', staffOnly, validate(classroomSchema.partial()), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.classroom.findUnique({ where: { id } });
  if (!old) throw notFound();
  assertBranch(req, old.branchId);
  const { branchId: _b, ...data } = req.body;
  const row = await prisma.classroom.update({ where: { id }, data });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Classroom', entityId: id, oldValues: old, newValues: row, branchId: old.branchId });
  res.json(row);
});

export default router;
