// =====================================================================
// M6 — Багшийн удирдлага: профайл, заах курс, боломжит цаг, ставк,
// ачаалал, бодитоор орсон цаг → админ баталгаажуулна → M3 хөлс
// =====================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { nextCode } from '../lib/codes.js';
import { dateOnly, ubDateString, ubDayRange } from '../lib/time.js';
import { fromCents } from '../lib/money.js';
import { authorize, STAFF, STAFF_FINANCE } from '../middleware/auth.js';
import { assertBranch, branchFilter, resolveBranchId } from '../middleware/scope.js';
import { idParam, validate, zDate, zId, zOptId, zOptStr, zPositiveMoney, zReason, zStr, zTime } from '../middleware/validate.js';

const router = Router();

// Багш өөрийн мэдээллийг, ажилтан салбарынхаа багшийг харна
async function loadTeacher(req, id) {
  const t = await prisma.teacher.findUnique({ where: { id } });
  if (!t) throw notFound('Багш олдсонгүй');
  if (req.user.role === 'TEACHER') {
    if (req.user.teacherId !== id) throw forbidden();
  } else if (['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'].includes(req.user.role)) {
    assertBranch(req, t.branchId);
  } else throw forbidden();
  return t;
}

router.get('/', authorize(STAFF_FINANCE), async (req, res) => {
  const { q, status } = req.query;
  res.json(await prisma.teacher.findMany({
    where: {
      ...branchFilter(req),
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { teacherCode: { contains: q } }] } : {}),
    },
    include: {
      user: { select: { username: true, isActive: true } },
      courses: { include: { course: { select: { id: true, code: true, name: true } } } },
      rates: { where: { effectiveTo: null }, take: 1 },
      _count: { select: { classes: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } } } },
    },
    orderBy: { lastName: 'asc' },
  }));
});

router.get('/:id', async (req, res) => {
  const t = await loadTeacher(req, idParam(req));
  res.json(await prisma.teacher.findUnique({
    where: { id: t.id },
    include: {
      user: { select: { id: true, username: true, email: true, isActive: true } },
      branch: { select: { id: true, name: true } },
      courses: { include: { course: { select: { id: true, code: true, name: true } } } },
      availability: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      rates: { orderBy: { effectiveFrom: 'desc' }, include: { creator: { select: { displayName: true } } } },
      classes: { where: { status: { notIn: ['CANCELLED'] } }, include: { course: { select: { name: true } } }, orderBy: { startDate: 'desc' } },
    },
  }));
});

const teacherSchema = z.object({
  branchId: zOptId,
  lastName: zStr(100),
  firstName: zStr(100),
  phone: zOptStr(30),
  hiredOn: zDate.optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// Багш үүсгэхэд TEACHER эрхтэй нэвтрэх эрх хамт үүснэ
router.post(
  '/',
  authorize(STAFF),
  validate(teacherSchema.extend({
    username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/),
    password: z.string().min(8),
    email: z.string().email().optional().nullable(),
    courseIds: z.array(zId).optional(),
  })),
  async (req, res) => {
    const branchId = resolveBranchId(req, req.body.branchId);
    const { username, password, email, courseIds = [], hiredOn, branchId: _b, ...data } = req.body;
    const role = await prisma.role.findUnique({ where: { code: 'TEACHER' } });
    const teacher = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { username, email: email ?? null, displayName: `${data.lastName} ${data.firstName}`, passwordHash: await bcrypt.hash(password, env.bcryptRounds), roleId: role.id, branchId },
      });
      return tx.teacher.create({
        data: {
          ...data, branchId, userId: user.id,
          teacherCode: await nextCode(tx.teacher, 'teacherCode', 'T'),
          hiredOn: hiredOn ? dateOnly(hiredOn) : null,
          courses: { create: courseIds.map((courseId) => ({ courseId })) },
        },
      });
    });
    await writeAudit(req, { action: 'CREATE', entityType: 'Teacher', entityId: teacher.id, newValues: { ...teacher, username }, branchId });
    res.status(201).json(teacher);
  },
);

router.put('/:id', authorize(STAFF), validate(teacherSchema.partial()), async (req, res) => {
  const old = await loadTeacher(req, idParam(req));
  const { hiredOn, branchId: _b, ...rest } = req.body;
  const t = await prisma.teacher.update({
    where: { id: old.id },
    data: { ...rest, ...(hiredOn !== undefined ? { hiredOn: hiredOn ? dateOnly(hiredOn) : null } : {}) },
  });
  if (rest.status) await prisma.user.update({ where: { id: old.userId }, data: { isActive: rest.status === 'ACTIVE' } });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Teacher', entityId: old.id, oldValues: old, newValues: t, branchId: old.branchId });
  res.json(t);
});

router.put('/:id/courses', authorize(STAFF), validate(z.object({ courseIds: z.array(zId) })), async (req, res) => {
  const t = await loadTeacher(req, idParam(req));
  await prisma.$transaction([
    prisma.teacherCourse.deleteMany({ where: { teacherId: t.id } }),
    prisma.teacherCourse.createMany({ data: req.body.courseIds.map((courseId) => ({ teacherId: t.id, courseId })) }),
  ]);
  await writeAudit(req, { action: 'UPDATE_COURSES', entityType: 'Teacher', entityId: t.id, newValues: req.body, branchId: t.branchId });
  res.json({ ok: true });
});

// Боломжит цаг: багш өөрөө эсвэл админ бүртгэнэ
router.put(
  '/:id/availability',
  validate(z.object({ slots: z.array(z.object({ dayOfWeek: z.coerce.number().int().min(1).max(7), startTime: zTime, endTime: zTime })) })),
  async (req, res) => {
    const t = await loadTeacher(req, idParam(req));
    if (req.user.role === 'FINANCE') throw forbidden();
    for (const s of req.body.slots) if (s.startTime >= s.endTime) throw badRequest(`Цаг буруу: ${s.startTime}-${s.endTime}`);
    await prisma.$transaction([
      prisma.teacherAvailability.deleteMany({ where: { teacherId: t.id } }),
      prisma.teacherAvailability.createMany({ data: req.body.slots.map((s) => ({ ...s, teacherId: t.id })) }),
    ]);
    await writeAudit(req, { action: 'UPDATE_AVAILABILITY', entityType: 'Teacher', entityId: t.id, newValues: req.body, branchId: t.branchId });
    res.json({ ok: true });
  },
);

// Ставк (цагийн тариф) — шинэ тариф өмнөхийг хаана, түүх хадгалагдана
router.post(
  '/:id/rates',
  authorize(STAFF),
  validate(z.object({ hourlyRate: zPositiveMoney, effectiveFrom: zDate })),
  async (req, res) => {
    const t = await loadTeacher(req, idParam(req));
    const from = dateOnly(req.body.effectiveFrom);
    const rate = await prisma.$transaction(async (tx) => {
      const latest = await tx.teacherRate.findFirst({ where: { teacherId: t.id }, orderBy: { effectiveFrom: 'desc' } });
      if (latest && latest.effectiveFrom >= from) throw conflict(`Шинэ тариф ${ubDateString(latest.effectiveFrom)}-аас хойш эхлэх ёстой`);
      if (latest) await tx.teacherRate.update({ where: { id: latest.id }, data: { effectiveTo: new Date(from.getTime() - 86400000) } });
      return tx.teacherRate.create({ data: { teacherId: t.id, hourlyRate: req.body.hourlyRate, effectiveFrom: from, createdBy: req.user.id } });
    });
    await writeAudit(req, { action: 'CREATE', entityType: 'TeacherRate', entityId: rate.id, newValues: rate, branchId: t.branchId });
    res.status(201).json(rate);
  },
);

// Ачаалал: төлөвлөсөн ба орсон хичээл, цаг
router.get('/:id/load', async (req, res) => {
  const t = await loadTeacher(req, idParam(req));
  const today = ubDateString(new Date());
  const from = req.query.from ?? `${today.slice(0, 8)}01`;
  const to = req.query.to ?? today;
  const range = { gte: ubDayRange(from).start, lt: ubDayRange(to).end };
  const [sessions, hours] = await Promise.all([
    prisma.classSession.findMany({ where: { teacherId: t.id, startsAt: range }, select: { status: true, startsAt: true, endsAt: true } }),
    prisma.teachingHour.findMany({ where: { teacherId: t.id, classSession: { startsAt: range } } }),
  ]);
  const minutes = (list) => list.reduce((a, s) => a + Math.round((s.endsAt - s.startsAt) / 60000), 0);
  res.json({
    from, to,
    plannedSessions: sessions.filter((s) => s.status !== 'CANCELLED').length,
    plannedMinutes: minutes(sessions.filter((s) => s.status !== 'CANCELLED')),
    completedSessions: sessions.filter((s) => s.status === 'COMPLETED').length,
    cancelledSessions: sessions.filter((s) => s.status === 'CANCELLED').length,
    actualMinutes: hours.reduce((a, h) => a + h.actualMinutes, 0),
    approvedMinutes: hours.filter((h) => h.status === 'APPROVED').reduce((a, h) => a + h.actualMinutes, 0),
    pendingHours: hours.filter((h) => h.status === 'PENDING').length,
    approvedAmount: fromCents(hours.filter((h) => h.status === 'APPROVED').reduce((a, h) => a + Math.round(Number(h.amount ?? 0) * 100), 0)),
  });
});

export default router;

// =====================================================================
// Заасан цаг (teaching hours) — тусдаа router: /api/teaching-hours
// =====================================================================
export const hoursRouter = Router();

const hourInclude = {
  teacher: { select: { id: true, teacherCode: true, lastName: true, firstName: true, branchId: true } },
  classSession: { select: { id: true, startsAt: true, endsAt: true, topic: true, class: { select: { code: true } } } },
  approver: { select: { displayName: true } },
  rate: { select: { hourlyRate: true } },
};

hoursRouter.get('/', async (req, res) => {
  const { status, teacherId, from, to } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(from || to ? { classSession: { startsAt: { ...(from ? { gte: ubDayRange(from).start } : {}), ...(to ? { lt: ubDayRange(to).end } : {}) } } } : {}),
  };
  if (req.user.role === 'TEACHER') where.teacherId = req.user.teacherId;
  else if (['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'].includes(req.user.role)) {
    where.teacher = branchFilter(req);
    if (teacherId) where.teacherId = Number(teacherId);
  } else throw forbidden();
  res.json(await prisma.teachingHour.findMany({ where, include: hourInclude, orderBy: { classSession: { startsAt: 'desc' } }, take: 1000 }));
});

// Багш батлагдаагүй цагаа засна (бодит минут, тайлбар)
hoursRouter.put(
  '/:id',
  authorize('TEACHER', 'SUPER_ADMIN', 'BRANCH_ADMIN'),
  validate(z.object({ actualMinutes: z.coerce.number().int().min(1).max(600), note: zOptStr(500) })),
  async (req, res) => {
    const id = idParam(req);
    const h = await prisma.teachingHour.findUnique({ where: { id }, include: { teacher: true } });
    if (!h) throw notFound();
    if (req.user.role === 'TEACHER' && h.teacherId !== req.user.teacherId) throw forbidden();
    assertBranch(req, h.teacher.branchId);
    if (h.status !== 'PENDING') throw conflict('Батлагдсан эсвэл татгалзсан цагийг засах боломжгүй');
    const updated = await prisma.teachingHour.update({ where: { id }, data: req.body });
    await writeAudit(req, { action: 'UPDATE', entityType: 'TeachingHour', entityId: id, oldValues: { actualMinutes: h.actualMinutes }, newValues: req.body, branchId: h.teacher.branchId });
    res.json(updated);
  },
);

// Батлах: тухайн өдөр хүчинтэй тарифаар дүнг сервер тооцно
hoursRouter.post('/:id/approve', authorize(STAFF), async (req, res) => {
  const id = idParam(req);
  const h = await prisma.teachingHour.findUnique({ where: { id }, include: { teacher: true, classSession: true } });
  if (!h) throw notFound();
  assertBranch(req, h.teacher.branchId);
  if (h.status !== 'PENDING') throw conflict(`Цаг ${h.status} төлөвтэй`);
  const day = dateOnly(ubDateString(h.classSession.startsAt));
  const rate = await prisma.teacherRate.findFirst({
    where: { teacherId: h.teacherId, effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!rate) throw conflict('Тухайн өдөр хүчинтэй тариф бүртгэгдээгүй байна');
  const amount = fromCents(Math.round((h.actualMinutes / 60) * Number(rate.hourlyRate) * 100));
  const r = await prisma.teachingHour.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'APPROVED', approvedBy: req.user.id, approvedAt: new Date(), rateId: rate.id, amount },
  });
  if (!r.count) throw conflict('Цаг өөр хүсэлтээр өөрчлөгдсөн');
  await writeAudit(req, { action: 'APPROVE', entityType: 'TeachingHour', entityId: id, newValues: { amount, rate: rate.hourlyRate, minutes: h.actualMinutes }, approvedBy: req.user.id, branchId: h.teacher.branchId });
  res.json(await prisma.teachingHour.findUnique({ where: { id }, include: hourInclude }));
});

hoursRouter.post('/:id/reject', authorize(STAFF), validate(z.object({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const h = await prisma.teachingHour.findUnique({ where: { id }, include: { teacher: true } });
  if (!h) throw notFound();
  assertBranch(req, h.teacher.branchId);
  if (h.status !== 'PENDING') throw conflict(`Цаг ${h.status} төлөвтэй`);
  const updated = await prisma.teachingHour.update({ where: { id }, data: { status: 'REJECTED', note: req.body.reason, approvedBy: req.user.id, approvedAt: new Date() } });
  await writeAudit(req, { action: 'REJECT', entityType: 'TeachingHour', entityId: id, reason: req.body.reason, branchId: h.teacher.branchId });
  res.json(updated);
});

// Буруу баталсан цагийг (тооцоонд ороогүй бол) дахин хянах төлөвт буцаана
hoursRouter.post('/:id/reopen', authorize(STAFF), validate(z.object({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const h = await prisma.teachingHour.findUnique({ where: { id }, include: { teacher: true } });
  if (!h) throw notFound();
  assertBranch(req, h.teacher.branchId);
  if (h.payoutId) throw conflict('Хөлсний тооцоонд орсон цагийг буцаах боломжгүй');
  if (h.status === 'PENDING') throw conflict('Аль хэдийн хянах төлөвтэй');
  const updated = await prisma.teachingHour.update({ where: { id }, data: { status: 'PENDING', approvedBy: null, approvedAt: null, rateId: null, amount: null } });
  await writeAudit(req, { action: 'REOPEN', entityType: 'TeachingHour', entityId: id, oldValues: { status: h.status, amount: h.amount }, reason: req.body.reason, branchId: h.teacher.branchId });
  res.json(updated);
});
