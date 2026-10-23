// =====================================================================
// M4 — Анги, долоо хоногийн хуваарь, хичээл үүсгэх, материал
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { dateOnly, ubDateString, ubDateTime, ubDayOfWeek } from '../lib/time.js';
import { assertClassAccess } from '../lib/access.js';
import { authorize, STAFF, STAFF_TEACHER } from '../middleware/auth.js';
import { assertBranch, branchFilter, resolveBranchId } from '../middleware/scope.js';
import { idParam, validate, zDate, zId, zOptId, zStr, zTime } from '../middleware/validate.js';
import { storedPath, uploader } from '../middleware/upload.js';
import { assertScheduleFree } from '../services/schedule.js';

const router = Router();

const classInclude = {
  course: { include: { level: true, packages: { where: { isActive: true } } } },
  teacher: { select: { id: true, lastName: true, firstName: true } },
  classroom: { select: { id: true, name: true, capacity: true } },
  schedules: { include: { classroom: { select: { name: true } }, teacher: { select: { lastName: true, firstName: true } } }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
  _count: { select: { enrollments: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } }, sessions: true } },
};

router.get('/', async (req, res) => {
  const { status, courseId, teacherId } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(courseId ? { courseId: Number(courseId) } : {}),
    ...(teacherId ? { teacherId: Number(teacherId) } : {}),
  };
  const { role } = req.user;
  if (role === 'TEACHER') {
    where.OR = [{ teacherId: req.user.teacherId }, { sessions: { some: { teacherId: req.user.teacherId } } }];
  } else if (role === 'STUDENT') {
    where.enrollments = { some: { studentId: req.user.studentId, status: { in: ['CONFIRMED', 'COMPLETED'] } } };
  } else if (role === 'PARENT') {
    where.enrollments = { some: { status: { in: ['CONFIRMED', 'COMPLETED'] }, student: { parentLinks: { some: { parentId: req.user.parentId, verifiedAt: { not: null } } } } } };
  } else {
    Object.assign(where, branchFilter(req));
  }
  res.json(await prisma.class.findMany({ where, include: classInclude, orderBy: { startDate: 'desc' } }));
});

router.get('/:id', async (req, res) => {
  const id = idParam(req);
  await assertClassAccess(req, id);
  const cls = await prisma.class.findUnique({
    where: { id },
    include: {
      ...classInclude,
      branch: { select: { id: true, name: true, lateThresholdMinutes: true } },
      materials: { orderBy: { id: 'desc' }, include: { uploader: { select: { displayName: true } } } },
    },
  });
  res.json(cls);
});

// Ангийн сурагчид (багш ба ажилтанд)
router.get('/:id/students', authorize('SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE', 'TEACHER'), async (req, res) => {
  const id = idParam(req);
  await assertClassAccess(req, id);
  res.json(await prisma.enrollment.findMany({
    where: { classId: id, status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] } },
    include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true, phone: true } } },
    orderBy: { student: { lastName: 'asc' } },
  }));
});

const classSchema = z.object({
  branchId: zOptId,
  courseId: zId,
  teacherId: zId,
  classroomId: zOptId,
  code: zStr(30),
  capacity: z.coerce.number().int().min(1).max(200),
  startDate: zDate,
  endDate: zDate,
  status: z.enum(['PLANNED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

async function checkClassRefs(branchId, { teacherId, classroomId, courseId }) {
  if (teacherId) {
    const t = await prisma.teacher.findUnique({ where: { id: teacherId }, include: { courses: true } });
    if (!t || t.branchId !== branchId || t.status !== 'ACTIVE') throw badRequest('Багш олдсонгүй эсвэл өөр салбарынх');
    if (courseId && t.courses.length && !t.courses.some((c) => c.courseId === courseId)) {
      throw badRequest('Багш энэ курсийг заахаар бүртгэгдээгүй байна');
    }
  }
  if (classroomId) {
    const r = await prisma.classroom.findUnique({ where: { id: classroomId } });
    if (!r || r.branchId !== branchId) throw badRequest('Танхим олдсонгүй эсвэл өөр салбарынх');
  }
}

router.post('/', authorize(STAFF), validate(classSchema), async (req, res) => {
  const branchId = resolveBranchId(req, req.body.branchId);
  const { startDate, endDate, ...rest } = req.body;
  if (startDate > endDate) throw badRequest('Эхлэх огноо дуусах огнооноос хойш байна');
  await checkClassRefs(branchId, rest);
  const cls = await prisma.class.create({
    data: { ...rest, branchId, startDate: dateOnly(startDate), endDate: dateOnly(endDate) },
    include: classInclude,
  });
  await writeAudit(req, { action: 'CREATE', entityType: 'Class', entityId: cls.id, newValues: req.body, branchId });
  res.status(201).json(cls);
});

router.put('/:id', authorize(STAFF), validate(classSchema.partial()), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.class.findUnique({ where: { id } });
  if (!old) throw notFound();
  assertBranch(req, old.branchId);
  const { startDate, endDate, branchId: _b, ...rest } = req.body;
  await checkClassRefs(old.branchId, { ...rest, courseId: rest.courseId ?? old.courseId });
  if (rest.capacity) {
    const taken = await prisma.enrollment.count({ where: { classId: id, status: { in: ['PENDING', 'CONFIRMED'] } } });
    if (rest.capacity < taken) throw conflict(`Элссэн ${taken} сурагчаас бага хүчин чадал тогтоох боломжгүй`);
  }
  const data = {
    ...rest,
    ...(startDate ? { startDate: dateOnly(startDate) } : {}),
    ...(endDate ? { endDate: dateOnly(endDate) } : {}),
  };
  if ((data.startDate ?? old.startDate) > (data.endDate ?? old.endDate)) throw badRequest('Огнооны хүрээ буруу');
  const cls = await prisma.class.update({ where: { id }, data, include: classInclude });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Class', entityId: id, oldValues: old, newValues: req.body, branchId: old.branchId });
  res.json(cls);
});

// ----- Долоо хоногийн хуваарь -----
const scheduleSchema = z.object({
  teacherId: zOptId,
  classroomId: zOptId,
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  startTime: zTime,
  endTime: zTime,
});

router.post('/:id/schedules', authorize(STAFF), validate(scheduleSchema), async (req, res) => {
  const classId = idParam(req);
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls) throw notFound();
  assertBranch(req, cls.branchId);
  const data = {
    classId,
    teacherId: req.body.teacherId ?? cls.teacherId,
    classroomId: req.body.classroomId ?? cls.classroomId,
    dayOfWeek: req.body.dayOfWeek,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
  };
  if (!data.classroomId) throw badRequest('Танхим сонгоно уу');
  await assertScheduleFree(data);
  const schedule = await prisma.schedule.create({ data });
  await writeAudit(req, { action: 'CREATE', entityType: 'Schedule', entityId: schedule.id, newValues: schedule, branchId: cls.branchId });
  res.status(201).json(schedule);
});

router.delete('/:id/schedules/:scheduleId', authorize(STAFF), async (req, res) => {
  const scheduleId = idParam(req, 'scheduleId');
  const s = await prisma.schedule.findUnique({ where: { id: scheduleId }, include: { class: true } });
  if (!s || s.classId !== idParam(req)) throw notFound();
  assertBranch(req, s.class.branchId);
  // Ирээдүйн, эхлээгүй хичээлүүдийг цуцална; болсон хичээл хадгалагдана
  const cancelled = await prisma.classSession.updateMany({
    where: { scheduleId, status: 'SCHEDULED', startsAt: { gt: new Date() } },
    data: { status: 'CANCELLED' },
  });
  await prisma.schedule.delete({ where: { id: scheduleId } });
  await writeAudit(req, { action: 'DELETE', entityType: 'Schedule', entityId: scheduleId, oldValues: s, newValues: { cancelledSessions: cancelled.count }, branchId: s.class.branchId });
  res.json({ ok: true, cancelledSessions: cancelled.count });
});

// Хуваариас хичээлүүд үүсгэх (курсийн нийт хичээлийн тоогоор хязгаарлана, давтан дуудахад давхардахгүй)
router.post('/:id/generate-sessions', authorize(STAFF), async (req, res) => {
  const classId = idParam(req);
  const cls = await prisma.class.findUnique({ where: { id: classId }, include: { schedules: true, course: true } });
  if (!cls) throw notFound();
  assertBranch(req, cls.branchId);
  if (!cls.schedules.length) throw badRequest('Эхлээд долоо хоногийн хуваарь нэмнэ үү');

  const existing = await prisma.classSession.findMany({ where: { classId }, select: { scheduleId: true, startsAt: true, status: true } });
  const existingKeys = new Set(existing.map((s) => `${s.scheduleId}:${s.startsAt.toISOString()}`));
  let remaining = cls.course.totalSessions - existing.filter((s) => s.status !== 'CANCELLED').length;

  const toCreate = [];
  const endStr = ubDateString(cls.endDate);
  for (let day = new Date(cls.startDate); ubDateString(day) <= endStr && remaining > 0; day = new Date(day.getTime() + 86400000)) {
    const dateStr = ubDateString(day);
    const dow = ubDayOfWeek(ubDateTime(dateStr, '12:00'));
    for (const s of cls.schedules.filter((x) => x.dayOfWeek === dow).sort((a, b) => a.startTime.localeCompare(b.startTime))) {
      if (remaining <= 0) break;
      const startsAt = ubDateTime(dateStr, s.startTime);
      if (existingKeys.has(`${s.id}:${startsAt.toISOString()}`)) continue;
      toCreate.push({ classId, scheduleId: s.id, teacherId: s.teacherId, classroomId: s.classroomId, startsAt, endsAt: ubDateTime(dateStr, s.endTime) });
      remaining -= 1;
    }
  }
  if (toCreate.length) await prisma.classSession.createMany({ data: toCreate });
  await writeAudit(req, { action: 'GENERATE_SESSIONS', entityType: 'Class', entityId: classId, newValues: { created: toCreate.length }, branchId: cls.branchId });
  res.json({ created: toCreate.length });
});

// ----- Материал (PDF, аудио, холбоос) -----
const materialUpload = uploader('materials', 'media');
router.post('/:id/materials', authorize(STAFF_TEACHER), materialUpload.single('file'), async (req, res) => {
  const classId = idParam(req);
  const cls = await assertClassAccess(req, classId, { write: true });
  const parsed = z.object({
    title: zStr(200),
    type: z.enum(['PDF', 'AUDIO', 'LINK', 'OTHER']),
    url: z.string().url().optional(),
    allClasses: z.enum(['true', 'false']).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Материалын мэдээлэл буруу', parsed.error.issues);
  if (parsed.data.type === 'LINK' ? !parsed.data.url : !req.file) throw badRequest('Файл эсвэл холбоос шаардлагатай');

  const material = await prisma.material.create({
    data: {
      courseId: cls.courseId,
      classId: parsed.data.allClasses === 'true' ? null : classId,
      title: parsed.data.title,
      type: parsed.data.type,
      url: parsed.data.url ?? null,
      filePath: storedPath('materials', req.file),
      uploadedBy: req.user.id,
    },
  });
  await writeAudit(req, { action: 'CREATE', entityType: 'Material', entityId: material.id, newValues: material, branchId: cls.branchId });
  res.status(201).json(material);
});

// Ангийн материал + курсийн нийтлэг материал
router.get('/:id/materials', async (req, res) => {
  const classId = idParam(req);
  const cls = await assertClassAccess(req, classId);
  res.json(await prisma.material.findMany({
    where: { courseId: cls.courseId, OR: [{ classId }, { classId: null }] },
    orderBy: { id: 'desc' },
  }));
});

export default router;
