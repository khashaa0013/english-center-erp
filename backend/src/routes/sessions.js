// =====================================================================
// M4 — Хичээл (class session): жагсаалт, нэмэлт хичээл, цуцлах, эхлэх, дуусгах
// Хичээл дуусахад багшийн заасан цаг (M6) PENDING төлөвтэй үүснэ.
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { minutesBetween, ubDateTime } from '../lib/time.js';
import { notifyUsers } from '../lib/notify.js';
import { parentChildIds } from '../lib/access.js';
import { authorize, STAFF, STAFF_TEACHER } from '../middleware/auth.js';
import { assertBranch, branchFilter, isSuper } from '../middleware/scope.js';
import { idParam, validate, zDate, zId, zOptId, zOptStr, zReason, zTime } from '../middleware/validate.js';
import { assertSessionFree } from '../services/schedule.js';

const router = Router();

const sessionInclude = {
  class: { select: { id: true, code: true, branchId: true, course: { select: { name: true } } } },
  teacher: { select: { id: true, lastName: true, firstName: true } },
  classroom: { select: { id: true, name: true } },
};

// Хичээлд хандах эрх: багш өөрийн заах хичээл, ажилтан салбараараа
export async function loadSessionForTeacher(req, id) {
  const session = await prisma.classSession.findUnique({ where: { id }, include: { class: { include: { branch: true } } } });
  if (!session) throw notFound('Хичээл олдсонгүй');
  if (req.user.role === 'TEACHER') {
    if (session.teacherId !== req.user.teacherId) throw forbidden('Энэ хичээлийг та заахгүй');
  } else if (!isSuper(req)) {
    if (!['BRANCH_ADMIN'].includes(req.user.role)) throw forbidden();
    assertBranch(req, session.class.branchId);
  }
  return session;
}

// Хичээлд хамрагдах сурагчдын user id (мэдэгдэл илгээхэд)
async function classAudience(classId) {
  const enr = await prisma.enrollment.findMany({
    where: { classId, status: 'CONFIRMED' },
    select: { student: { select: { userId: true, parentLinks: { where: { verifiedAt: { not: null } }, select: { parent: { select: { userId: true } } } } } } },
  });
  return enr.flatMap((e) => [e.student.userId, ...e.student.parentLinks.map((l) => l.parent.userId)]);
}

router.get('/', async (req, res) => {
  const { from, to, classId, status } = req.query;
  const where = {
    ...(classId ? { classId: Number(classId) } : {}),
    ...(status ? { status } : {}),
    ...(from || to ? { startsAt: { ...(from ? { gte: ubDateTime(from, '00:00') } : {}), ...(to ? { lt: new Date(ubDateTime(to, '00:00').getTime() + 86400000) } : {}) } } : {}),
  };
  const { role } = req.user;
  if (role === 'TEACHER') where.teacherId = req.user.teacherId;
  else if (role === 'STUDENT') where.class = { enrollments: { some: { studentId: req.user.studentId, status: { in: ['CONFIRMED', 'COMPLETED'] } } } };
  else if (role === 'PARENT') where.class = { enrollments: { some: { studentId: { in: await parentChildIds(req.user.parentId) }, status: { in: ['CONFIRMED', 'COMPLETED'] } } } };
  else where.class = branchFilter(req);

  res.json(await prisma.classSession.findMany({ where, include: sessionInclude, orderBy: { startsAt: 'asc' }, take: 1000 }));
});

router.get('/:id', authorize(STAFF_TEACHER), async (req, res) => {
  const session = await loadSessionForTeacher(req, idParam(req));
  const full = await prisma.classSession.findUnique({
    where: { id: session.id },
    include: {
      ...sessionInclude,
      teachingHour: true,
      attendance: { include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } }, corrections: { include: { corrector: { select: { displayName: true } } } } } },
    },
  });
  const roster = await prisma.enrollment.findMany({
    where: { classId: session.classId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
    select: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } } },
    orderBy: { student: { lastName: 'asc' } },
  });
  res.json({ ...full, roster: roster.map((r) => r.student), lateThresholdMinutes: session.class.branch.lateThresholdMinutes });
});

// Нэмэлт / нөхөх хичээл (хуваарьт ороогүй)
router.post(
  '/',
  authorize(STAFF),
  validate(z.object({ classId: zId, date: zDate, startTime: zTime, endTime: zTime, teacherId: zOptId, classroomId: zOptId, topic: zOptStr(255) })),
  async (req, res) => {
    const cls = await prisma.class.findUnique({ where: { id: req.body.classId } });
    if (!cls) throw notFound('Анги олдсонгүй');
    assertBranch(req, cls.branchId);
    const data = {
      classId: cls.id,
      teacherId: req.body.teacherId ?? cls.teacherId,
      classroomId: req.body.classroomId ?? cls.classroomId,
      startsAt: ubDateTime(req.body.date, req.body.startTime),
      endsAt: ubDateTime(req.body.date, req.body.endTime),
      topic: req.body.topic ?? null,
    };
    if (!data.classroomId) throw badRequest('Танхим сонгоно уу');
    await assertSessionFree(data);
    const session = await prisma.classSession.create({ data, include: sessionInclude });
    await writeAudit(req, { action: 'CREATE', entityType: 'ClassSession', entityId: session.id, newValues: data, branchId: cls.branchId });
    await notifyUsers(await classAudience(cls.id), { title: `Нэмэлт хичээл: ${cls.code}`, body: `${req.body.date} ${req.body.startTime}-${req.body.endTime}`, link: '/portal' });
    res.status(201).json(session);
  },
);

// Хичээлийн цаг, багш, танхим өөрчлөх (орлох багш гэх мэт)
router.put(
  '/:id',
  authorize(STAFF),
  validate(z.object({ date: zDate.optional(), startTime: zTime.optional(), endTime: zTime.optional(), teacherId: zOptId, classroomId: zOptId, topic: zOptStr(255), reason: zReason })),
  async (req, res) => {
    const id = idParam(req);
    const old = await prisma.classSession.findUnique({ where: { id }, include: { class: true } });
    if (!old) throw notFound();
    assertBranch(req, old.class.branchId);
    if (old.status !== 'SCHEDULED') throw conflict('Зөвхөн эхлээгүй хичээлийг өөрчилнө');

    const { date, startTime, endTime, reason, ...rest } = req.body;
    const data = { ...rest };
    if (date || startTime || endTime) {
      if (!date || !startTime || !endTime) throw badRequest('Огноо, эхлэх, дуусах цагийг хамт илгээнэ');
      data.startsAt = ubDateTime(date, startTime);
      data.endsAt = ubDateTime(date, endTime);
    }
    await assertSessionFree({
      teacherId: data.teacherId ?? old.teacherId,
      classroomId: data.classroomId ?? old.classroomId,
      startsAt: data.startsAt ?? old.startsAt,
      endsAt: data.endsAt ?? old.endsAt,
      excludeId: id,
    });
    const session = await prisma.classSession.update({ where: { id }, data, include: sessionInclude });
    await writeAudit(req, { action: 'RESCHEDULE', entityType: 'ClassSession', entityId: id, oldValues: old, newValues: data, reason, branchId: old.class.branchId });
    await notifyUsers(await classAudience(old.classId), { title: `Хичээлийн хуваарь өөрчлөгдлөө: ${old.class.code}`, body: reason, link: '/portal' });
    res.json(session);
  },
);

router.post('/:id/cancel', authorize(STAFF), validate(z.object({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.classSession.findUnique({ where: { id }, include: { class: true } });
  if (!old) throw notFound();
  assertBranch(req, old.class.branchId);
  if (old.status !== 'SCHEDULED') throw conflict('Зөвхөн эхлээгүй хичээлийг цуцална');
  const session = await prisma.classSession.update({ where: { id }, data: { status: 'CANCELLED' } });
  await writeAudit(req, { action: 'CANCEL', entityType: 'ClassSession', entityId: id, reason: req.body.reason, branchId: old.class.branchId });
  await notifyUsers(await classAudience(old.classId), { title: `Хичээл цуцлагдлаа: ${old.class.code}`, body: req.body.reason, link: '/portal' });
  res.json(session);
});

// Багш хичээл эхлүүлнэ: эхлэхээс 30 минутын өмнөөс дуусах хүртэл
router.post('/:id/start', authorize(STAFF_TEACHER), async (req, res) => {
  const session = await loadSessionForTeacher(req, idParam(req));
  if (session.status !== 'SCHEDULED') throw conflict(`Хичээл ${session.status} төлөвтэй`);
  const now = Date.now();
  if (now < session.startsAt.getTime() - 30 * 60000 || now > session.endsAt.getTime()) {
    throw conflict('Хичээлийг зөвхөн товлосон цагийн ойролцоо эхлүүлнэ');
  }
  res.json(await prisma.classSession.update({ where: { id: session.id }, data: { status: 'IN_PROGRESS' } }));
});

// Хичээл дуусгах: ирц баталгаажсан байх ёстой, заасан цаг бүртгэгдэнэ
router.post(
  '/:id/complete',
  authorize(STAFF_TEACHER),
  validate(z.object({ actualMinutes: z.coerce.number().int().min(1).max(600).optional(), topic: zOptStr(255) })),
  async (req, res) => {
    const session = await loadSessionForTeacher(req, idParam(req));
    if (session.status !== 'IN_PROGRESS') throw conflict('Эхэлсэн хичээлийг л дуусгана');
    const unconfirmed = await prisma.attendance.count({ where: { classSessionId: session.id, confirmedAt: null } });
    const roster = await prisma.enrollment.count({ where: { classId: session.classId, status: 'CONFIRMED' } });
    const marked = await prisma.attendance.count({ where: { classSessionId: session.id } });
    if (unconfirmed > 0 || marked < roster) throw conflict('Эхлээд ирцийг баталгаажуулна уу');

    const planned = minutesBetween(session.startsAt, session.endsAt);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.classSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', ...(req.body.topic ? { topic: req.body.topic } : {}) },
      });
      const hour = await tx.teachingHour.create({
        data: {
          classSessionId: session.id,
          teacherId: session.teacherId,
          plannedMinutes: planned,
          actualMinutes: req.body.actualMinutes ?? planned,
        },
      });
      await tx.qrSession.updateMany({ where: { classSessionId: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return { session: updated, teachingHour: hour };
    });
    await writeAudit(req, { action: 'COMPLETE', entityType: 'ClassSession', entityId: session.id, newValues: { actualMinutes: result.teachingHour.actualMinutes }, branchId: session.class.branchId });
    res.json(result);
  },
);

export default router;
