// =====================================================================
// M4 — Даалгавар: файл / аудио / бичвэрт хариу, багшийн үнэлгээ ба тайлбар
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { notifyUsers, studentAudienceUserIds } from '../lib/notify.js';
import { assertClassAccess, parentChildIds } from '../lib/access.js';
import { authorize, STAFF_TEACHER } from '../middleware/auth.js';
import { branchFilter } from '../middleware/scope.js';
import { idParam, zId, zOptStr, zStr } from '../middleware/validate.js';
import { storedPath, uploader } from '../middleware/upload.js';

const router = Router();
const fileUpload = uploader('assignments', 'media');
const submissionUpload = uploader('submissions', 'media');

// "2026-10-30T18:00" (УБ цаг) -> Date
const ubLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:MM').transform((v) => new Date(`${v}:00+08:00`));

const assignmentSchema = z.object({
  classId: zId,
  title: zStr(200),
  description: zOptStr(10000),
  answerType: z.enum(['FILE', 'TEXT', 'AUDIO']),
  dueAt: ubLocal,
  maxScore: z.coerce.number().positive().max(1000).optional(),
});

function parse(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest('Оролтын өгөгдөл буруу', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

router.get('/', async (req, res) => {
  const where = req.query.classId ? { classId: Number(req.query.classId) } : {};
  const { role } = req.user;
  let ownStudentIds = null;
  if (role === 'TEACHER') where.class = { OR: [{ teacherId: req.user.teacherId }, { sessions: { some: { teacherId: req.user.teacherId } } }] };
  else if (role === 'STUDENT' || role === 'PARENT') {
    ownStudentIds = role === 'STUDENT' ? [req.user.studentId] : await parentChildIds(req.user.parentId);
    where.class = { enrollments: { some: { studentId: { in: ownStudentIds }, status: { in: ['CONFIRMED', 'COMPLETED'] } } } };
  } else where.class = branchFilter(req);

  const items = await prisma.assignment.findMany({
    where,
    include: {
      class: { select: { id: true, code: true } },
      creator: { select: { lastName: true, firstName: true } },
      submissions: ownStudentIds ? { where: { studentId: { in: ownStudentIds } } } : { select: { id: true, status: true } },
    },
    orderBy: { dueAt: 'desc' },
  });
  res.json(items);
});

router.get('/:id', async (req, res) => {
  const a = await prisma.assignment.findUnique({ where: { id: idParam(req) } });
  if (!a) throw notFound();
  await assertClassAccess(req, a.classId);
  const own = ['STUDENT', 'PARENT'].includes(req.user.role);
  const ids = req.user.role === 'STUDENT' ? [req.user.studentId] : own ? await parentChildIds(req.user.parentId) : null;
  const full = await prisma.assignment.findUnique({
    where: { id: a.id },
    include: {
      class: { select: { id: true, code: true } },
      submissions: {
        where: ids ? { studentId: { in: ids } } : {},
        include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } }, grader: { select: { displayName: true } } },
        orderBy: { submittedAt: 'asc' },
      },
    },
  });
  res.json(full);
});

router.post('/', authorize(STAFF_TEACHER), fileUpload.single('file'), async (req, res) => {
  const data = parse(assignmentSchema, req.body);
  const cls = await assertClassAccess(req, data.classId, { write: true });
  const createdBy = req.user.teacherId ?? cls.teacherId;
  const a = await prisma.assignment.create({ data: { ...data, createdBy, attachmentPath: storedPath('assignments', req.file) } });
  await writeAudit(req, { action: 'CREATE', entityType: 'Assignment', entityId: a.id, newValues: a, branchId: cls.branchId });

  const enr = await prisma.enrollment.findMany({ where: { classId: cls.id, status: 'CONFIRMED' }, select: { studentId: true } });
  const audience = (await Promise.all(enr.map((e) => studentAudienceUserIds(e.studentId)))).flat();
  await notifyUsers(audience, { title: `Шинэ даалгавар: ${a.title}`, body: `${cls.code}, хугацаа ${req.body.dueAt.replace('T', ' ')}`, link: '/portal/assignments' });
  res.status(201).json(a);
});

router.put('/:id', authorize(STAFF_TEACHER), fileUpload.single('file'), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.assignment.findUnique({ where: { id } });
  if (!old) throw notFound();
  const cls = await assertClassAccess(req, old.classId, { write: true });
  const { classId: _c, ...data } = parse(assignmentSchema.partial(), req.body);
  if (req.file) data.attachmentPath = storedPath('assignments', req.file);
  const a = await prisma.assignment.update({ where: { id }, data });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Assignment', entityId: id, oldValues: old, newValues: data, branchId: cls.branchId });
  res.json(a);
});

// Сурагч хариу илгээх. Дүгнэгдэхээс өмнө дахин илгээж болно.
router.post('/:id/submit', authorize('STUDENT'), submissionUpload.single('file'), async (req, res) => {
  const id = idParam(req);
  const a = await prisma.assignment.findUnique({ where: { id } });
  if (!a) throw notFound();
  await assertClassAccess(req, a.classId);
  const enrolled = await prisma.enrollment.findFirst({ where: { classId: a.classId, studentId: req.user.studentId, status: 'CONFIRMED' } });
  if (!enrolled) throw forbidden('Идэвхтэй элсэлтгүй');

  const textAnswer = typeof req.body.textAnswer === 'string' ? req.body.textAnswer.trim().slice(0, 20000) : null;
  if (a.answerType === 'TEXT' && !textAnswer) throw badRequest('Хариултаа бичнэ үү');
  if (a.answerType !== 'TEXT' && !req.file) throw badRequest(a.answerType === 'AUDIO' ? 'Аудио файл хавсаргана уу' : 'Файл хавсаргана уу');
  if (a.answerType === 'AUDIO' && !req.file.mimetype.startsWith('audio/') && req.file.mimetype !== 'video/webm') throw badRequest('Аудио файл байх ёстой');

  const existing = await prisma.submission.findUnique({ where: { assignmentId_studentId: { assignmentId: id, studentId: req.user.studentId } } });
  // Засварт буцаасан (RETURNED) бол дахин илгээнэ
  if (existing?.status === 'GRADED') throw conflict('Дүгнэгдсэн даалгаврыг дахин илгээх боломжгүй');

  const now = new Date();
  const data = {
    textAnswer,
    filePath: storedPath('submissions', req.file),
    submittedAt: now,
    status: now > a.dueAt ? 'LATE' : 'SUBMITTED',
  };
  const sub = await prisma.submission.upsert({
    where: { assignmentId_studentId: { assignmentId: id, studentId: req.user.studentId } },
    create: { ...data, assignmentId: id, studentId: req.user.studentId },
    update: data,
  });
  res.status(existing ? 200 : 201).json(sub);
});

// Багш үнэлэх. Дүгнэсэн дүнг өөрчлөхөд шалтгаан шаардлагатай.
router.post('/submissions/:submissionId/grade', authorize(STAFF_TEACHER), async (req, res) => {
  const id = idParam(req, 'submissionId');
  const sub = await prisma.submission.findUnique({ where: { id }, include: { assignment: true } });
  if (!sub) throw notFound();
  const cls = await assertClassAccess(req, sub.assignment.classId, { write: true });
  const body = parse(z.object({
    score: z.coerce.number().min(0).max(Number(sub.assignment.maxScore)),
    feedback: zOptStr(5000),
    returnForRevision: z.boolean().optional(),
    reason: zOptStr(500),
  }), req.body);

  const regrade = sub.status === 'GRADED' && Number(sub.score) !== body.score;
  if (regrade && (!body.reason || body.reason.length < 3)) throw badRequest('Дүн өөрчлөх шалтгаан бичнэ үү');

  const updated = await prisma.submission.update({
    where: { id },
    data: {
      score: body.score,
      feedback: body.feedback ?? sub.feedback,
      gradedBy: req.user.id,
      gradedAt: new Date(),
      status: body.returnForRevision ? 'RETURNED' : 'GRADED',
    },
  });
  await writeAudit(req, {
    action: regrade ? 'REGRADE' : 'GRADE', entityType: 'Submission', entityId: id,
    oldValues: { score: sub.score, status: sub.status }, newValues: { score: updated.score, status: updated.status },
    reason: body.reason, branchId: cls.branchId,
  });
  await notifyUsers(await studentAudienceUserIds(sub.studentId), {
    title: `Даалгавар дүгнэгдлээ: ${sub.assignment.title}`,
    body: `Оноо: ${body.score}/${sub.assignment.maxScore}`,
    link: '/portal/assignments',
  });
  res.json(updated);
});

export default router;
