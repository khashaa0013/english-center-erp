// =====================================================================
// M5 — Эцэг эхийн портал (ба сурагчийн хувийн үйлчилгээ)
// Зөвхөн баталгаажсан холбоотой хүүхдийн мэдээлэл; бусдын хүүхэд хаалттай.
// Мэдээллийг бусад модулийн эх бүртгэлээс уншина (дахин шивэхгүй).
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { invoiceBalance } from '../lib/money.js';
import { dateOnly, ubDateString, ubDayRange } from '../lib/time.js';
import { notifyUsers } from '../lib/notify.js';
import { assertStudentAccess, parentChildIds } from '../lib/access.js';
import { authorize, STAFF } from '../middleware/auth.js';
import { assertBranch, branchFilter } from '../middleware/scope.js';
import { idParam, validate, zDate, zId, zOptStr, zStr } from '../middleware/validate.js';
import { studentAttendancePercent } from '../services/graduation.js';

const router = Router();

// Эцэг эхийн хүүхдүүд (баталгаажсан ба хүлээгдэж буй холбоос)
router.get('/children', authorize('PARENT'), async (req, res) => {
  const links = await prisma.parentStudent.findMany({
    where: { parentId: req.user.parentId },
    include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true, currentLevel: { select: { code: true } } } } },
  });
  res.json(links.map((l) => ({ ...l, student: l.verifiedAt ? l.student : { id: l.student.id, firstName: l.student.firstName }, verified: Boolean(l.verifiedAt) })));
});

// Нэг хүүхдийн бүх мэдээллийн тойм
router.get('/students/:studentId/overview', async (req, res) => {
  const studentId = idParam(req, 'studentId');
  await assertStudentAccess(req, studentId);

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, studentCode: true, lastName: true, firstName: true, status: true, currentLevel: true, branch: { select: { name: true, phone: true } } },
  });
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] } },
    include: {
      class: { include: { course: { include: { level: true } }, teacher: { select: { lastName: true, firstName: true } }, classroom: { select: { name: true } }, schedules: true } },
      package: { select: { name: true } },
      invoice: { include: { payments: { where: { status: 'COMPLETED' }, orderBy: { paidAt: 'asc' } }, refunds: true } },
      certificate: { select: { id: true, certificateNo: true, verificationCode: true, status: true, issuedAt: true, filePath: true } },
      progressAssessments: { orderBy: { assessedOn: 'asc' }, include: { assessor: { select: { lastName: true, firstName: true } } } },
    },
    orderBy: { id: 'desc' },
  });
  const classIds = enrollments.filter((e) => e.status !== 'PENDING').map((e) => e.classId);
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86400000);

  const [upcoming, attendance, results, assignments, materials] = await Promise.all([
    prisma.classSession.findMany({
      where: { classId: { in: classIds }, startsAt: { gte: ubDayRange(ubDateString(now)).start, lte: in14 } },
      include: { class: { select: { code: true } }, classroom: { select: { name: true } }, teacher: { select: { lastName: true, firstName: true } } },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.attendance.findMany({
      where: { studentId, classSession: { classId: { in: classIds } } },
      include: { classSession: { select: { startsAt: true, class: { select: { code: true } } } } },
      orderBy: { classSession: { startsAt: 'desc' } },
      take: 100,
    }),
    prisma.examResult.findMany({
      where: { studentId, publishedAt: { not: null } },
      include: { exam: { select: { title: true, examType: true, maxScore: true, class: { select: { code: true } } } } },
    }),
    prisma.assignment.findMany({
      where: { classId: { in: classIds } },
      include: { class: { select: { code: true } }, submissions: { where: { studentId }, select: { status: true, score: true, feedback: true, submittedAt: true } } },
      orderBy: { dueAt: 'desc' },
    }),
    prisma.material.findMany({
      where: { OR: [{ classId: { in: classIds } }, { classId: null, course: { classes: { some: { id: { in: classIds } } } } }] },
      orderBy: { id: 'desc' },
    }),
  ]);

  const enrollmentsOut = await Promise.all(enrollments.map(async (e) => ({
    ...e,
    attendanceSummary: e.status === 'PENDING' ? null : await studentAttendancePercent(e.classId, studentId),
    invoice: e.invoice ? { id: e.invoice.id, invoiceNo: e.invoice.invoiceNo, dueDate: e.invoice.dueDate, status: e.invoice.status, payments: e.invoice.payments, ...invoiceBalance(e.invoice) } : null,
  })));

  res.json({ student, enrollments: enrollmentsOut, upcoming, attendance, results, assignments, materials });
});

// ----- Хүсэлт (чөлөө, лавлагаа) -----
router.get('/requests', authorize('PARENT'), async (req, res) => {
  res.json(await prisma.parentRequest.findMany({
    where: { parentId: req.user.parentId },
    include: { student: { select: { firstName: true, lastName: true } }, handler: { select: { displayName: true } } },
    orderBy: { id: 'desc' },
  }));
});

router.post(
  '/requests',
  authorize('PARENT'),
  validate(z.object({
    studentId: zId,
    requestType: z.enum(['LEAVE', 'INQUIRY']),
    subject: zStr(200),
    message: zStr(5000),
    leaveFrom: zDate.optional().nullable(),
    leaveTo: zDate.optional().nullable(),
  })),
  async (req, res) => {
    const { studentId, requestType, leaveFrom, leaveTo, ...rest } = req.body;
    const children = await parentChildIds(req.user.parentId);
    if (!children.includes(studentId)) throw forbidden('Энэ хүүхэд таны бүртгэлтэй баталгаажаагүй');
    if (requestType === 'LEAVE') {
      if (!leaveFrom || !leaveTo) throw badRequest('Чөлөөний эхлэх, дуусах огноо шаардлагатай');
      if (leaveFrom > leaveTo) throw badRequest('Огнооны хүрээ буруу');
    }
    const r = await prisma.parentRequest.create({
      data: {
        ...rest, studentId, requestType, parentId: req.user.parentId,
        leaveFrom: leaveFrom ? dateOnly(leaveFrom) : null,
        leaveTo: leaveTo ? dateOnly(leaveTo) : null,
      },
    });
    // Салбарын админуудад мэдэгдэнэ
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true, firstName: true } });
    const admins = await prisma.user.findMany({ where: { branchId: student.branchId, isActive: true, role: { code: 'BRANCH_ADMIN' } }, select: { id: true } });
    await notifyUsers(admins.map((a) => a.id), { title: `Эцэг эхийн хүсэлт: ${rest.subject}`, body: `${student.firstName} — ${requestType === 'LEAVE' ? 'Чөлөө' : 'Лавлагаа'}`, link: '/requests' });
    res.status(201).json(r);
  },
);

export default router;

// =====================================================================
// Ажилтан хүсэлт шийдвэрлэх: /api/requests
// =====================================================================
export const requestsRouter = Router();
requestsRouter.use(authorize(STAFF));

requestsRouter.get('/', async (req, res) => {
  res.json(await prisma.parentRequest.findMany({
    where: { student: branchFilter(req), ...(req.query.status ? { status: req.query.status } : {}) },
    include: {
      parent: { select: { lastName: true, firstName: true, phone: true } },
      student: { select: { id: true, studentCode: true, lastName: true, firstName: true } },
      handler: { select: { displayName: true } },
    },
    orderBy: { id: 'desc' },
  }));
});

const STATUS_MN = { IN_REVIEW: 'Хянаж байна', APPROVED: 'Зөвшөөрсөн', REJECTED: 'Татгалзсан', RESOLVED: 'Шийдвэрлэсэн' };

// Чөлөө зөвшөөрөхөд тухайн хугацааны хичээлийн ирц EXCUSED болно
requestsRouter.post(
  '/:id/handle',
  validate(z.object({ status: z.enum(['IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED']), response: zOptStr(5000) })),
  async (req, res) => {
    const id = idParam(req);
    const r = await prisma.parentRequest.findUnique({ where: { id }, include: { student: true, parent: true } });
    if (!r) throw notFound();
    assertBranch(req, r.student.branchId);
    if (['APPROVED', 'REJECTED', 'RESOLVED'].includes(r.status)) throw conflict('Хүсэлт шийдвэрлэгдсэн байна');
    if (r.requestType === 'INQUIRY' && req.body.status === 'APPROVED') throw badRequest('Лавлагааг RESOLVED төлөвөөр хаана');
    if (r.requestType === 'LEAVE' && req.body.status === 'RESOLVED') throw badRequest('Чөлөөг APPROVED эсвэл REJECTED болгоно');

    let excused = 0;
    await prisma.$transaction(async (tx) => {
      await tx.parentRequest.update({ where: { id }, data: { status: req.body.status, response: req.body.response ?? r.response, handledBy: req.user.id, handledAt: new Date() } });
      if (r.requestType === 'LEAVE' && req.body.status === 'APPROVED') {
        const from = ubDayRange(r.leaveFrom.toISOString().slice(0, 10)).start;
        const to = ubDayRange(r.leaveTo.toISOString().slice(0, 10)).end;
        const sessions = await tx.classSession.findMany({
          where: { status: { not: 'CANCELLED' }, startsAt: { gte: from, lt: to }, class: { enrollments: { some: { studentId: r.studentId, status: 'CONFIRMED' } } } },
        });
        for (const s of sessions) {
          const att = await tx.attendance.findUnique({ where: { classSessionId_studentId: { classSessionId: s.id, studentId: r.studentId } } });
          if (!att) {
            await tx.attendance.create({ data: { classSessionId: s.id, studentId: r.studentId, status: 'EXCUSED', method: 'MANUAL', confirmedBy: req.user.id, confirmedAt: new Date() } });
          } else if (att.status === 'ABSENT') {
            await tx.attendanceCorrection.create({ data: { attendanceId: att.id, oldStatus: att.status, newStatus: 'EXCUSED', reason: `Чөлөөний хүсэлт #${id} зөвшөөрсөн`, correctedBy: req.user.id } });
            await tx.attendance.update({ where: { id: att.id }, data: { status: 'EXCUSED' } });
          } else continue;
          excused += 1;
        }
      }
    });
    await writeAudit(req, { action: 'HANDLE', entityType: 'ParentRequest', entityId: id, oldValues: { status: r.status }, newValues: { status: req.body.status, excusedSessions: excused }, reason: req.body.response, branchId: r.student.branchId });
    await notifyUsers([r.parent.userId], { title: `Хүсэлт: ${STATUS_MN[req.body.status]}`, body: `${r.subject}${req.body.response ? ` — ${req.body.response}` : ''}`, link: '/portal/requests' });
    res.json({ ok: true, excusedSessions: excused });
  },
);
