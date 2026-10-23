// =====================================================================
// M2 — QR ирцийн систем
// - Багш идэвхтэй хичээлдээ богино хугацаатай QR гаргана (token-ийн SHA-256 л хадгална)
// - Нэвтэрсэн сурагч өөрийн элссэн ангийн QR-г уншуулна; давхар уншилт = нэг ирц
// - Хоцролтыг салбарын босгоор тооцно; гар засварт шалтгаан заавал
// =====================================================================
import { Router } from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { sha256 } from '../lib/codes.js';
import { minutesBetween } from '../lib/time.js';
import { notifyUsers, studentAudienceUserIds } from '../lib/notify.js';
import { assertStudentAccess } from '../lib/access.js';
import { authorize, STAFF_TEACHER } from '../middleware/auth.js';
import { assertBranch, isSuper } from '../middleware/scope.js';
import { idParam, validate, zId, zReason } from '../middleware/validate.js';
import { attendanceSummary } from '../services/graduation.js';
import { loadSessionForTeacher } from './sessions.js';

const router = Router();
const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
const STATUS_MN = { PRESENT: 'Ирсэн', LATE: 'Хоцорсон', ABSENT: 'Тасалсан', EXCUSED: 'Чөлөөтэй' };

// QR үүсгэх. Шинэ QR гаргахад өмнөх идэвхтэй QR хүчингүй болно.
router.post('/sessions/:id/qr', authorize(STAFF_TEACHER), async (req, res) => {
  const session = await loadSessionForTeacher(req, idParam(req));
  if (session.status !== 'IN_PROGRESS') throw conflict('QR гаргахын тулд хичээлийг эхлүүлнэ үү');

  const token = crypto.randomBytes(24).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + session.class.branch.qrTtlSeconds * 1000);
  await prisma.$transaction([
    prisma.qrSession.updateMany({ where: { classSessionId: session.id, revokedAt: null }, data: { revokedAt: now } }),
    prisma.qrSession.create({ data: { classSessionId: session.id, tokenHash: sha256(token), createdBy: req.user.id, issuedAt: now, expiresAt } }),
  ]);
  const qrDataUrl = await QRCode.toDataURL(`ECERP:${token}`, { margin: 1, width: 360 });
  res.json({ token, expiresAt, ttlSeconds: session.class.branch.qrTtlSeconds, qrDataUrl });
});

// Сурагч QR уншуулж ирц бүртгүүлэх
router.post('/attendance/check-in', authorize('STUDENT'), validate(z.object({ token: z.string().min(10).max(200) })), async (req, res) => {
  const raw = req.body.token.replace(/^ECERP:/, '');
  const qr = await prisma.qrSession.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { classSession: { include: { class: { include: { branch: true } } } } },
  });
  if (!qr) throw badRequest('QR код буруу байна');
  const now = new Date();
  if (qr.revokedAt || qr.expiresAt < now) throw conflict('QR кодын хугацаа дууссан. Багшаас шинэ QR авна уу');

  const session = qr.classSession;
  if (session.status !== 'IN_PROGRESS') throw conflict('Хичээл идэвхгүй байна');

  const studentId = req.user.studentId;
  const enrolled = await prisma.enrollment.findFirst({ where: { classId: session.classId, studentId, status: 'CONFIRMED' } });
  if (!enrolled) throw forbidden('Та энэ ангид элсээгүй тул ирц бүртгэх боломжгүй');

  const existing = await prisma.attendance.findUnique({ where: { classSessionId_studentId: { classSessionId: session.id, studentId } } });
  if (existing) return res.json({ already: true, attendance: existing });

  const late = Math.max(0, minutesBetween(session.startsAt, now));
  const status = late > session.class.branch.lateThresholdMinutes ? 'LATE' : 'PRESENT';
  let attendance;
  try {
    attendance = await prisma.attendance.create({
      data: {
        classSessionId: session.id, studentId, status, method: 'QR', qrSessionId: qr.id,
        checkedInAt: now, lateMinutes: status === 'LATE' ? late : 0, clientIp: req.ip,
      },
    });
  } catch (err) {
    // Зэрэг ирсэн хоёр уншилт: нэг нь үүсгэсэн тул байгаа ирцийг буцаана
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await prisma.attendance.findUnique({ where: { classSessionId_studentId: { classSessionId: session.id, studentId } } });
      return res.json({ already: true, attendance: again });
    }
    throw err;
  }
  await writeAudit(req, { action: 'CHECK_IN', entityType: 'Attendance', entityId: attendance.id, newValues: { status, lateMinutes: attendance.lateMinutes }, branchId: session.class.branchId });
  res.status(201).json({ already: false, attendance, class: session.class.code });
});

// Багш ирцийг баталгаажуулна: тэмдэглээгүй сурагч ABSENT болно, гараар тэмдэглэж болно
router.post(
  '/sessions/:id/attendance/confirm',
  authorize(STAFF_TEACHER),
  validate(z.object({ marks: z.array(z.object({ studentId: zId, status: z.enum(STATUSES) })).default([]) })),
  async (req, res) => {
    const session = await loadSessionForTeacher(req, idParam(req));
    if (!['IN_PROGRESS', 'COMPLETED'].includes(session.status)) throw conflict('Хичээл эхлээгүй байна');
    const roster = await prisma.enrollment.findMany({ where: { classId: session.classId, status: 'CONFIRMED' }, select: { studentId: true } });
    const rosterIds = new Set(roster.map((r) => r.studentId));
    const marks = new Map(req.body.marks.map((m) => [m.studentId, m.status]));
    for (const id of marks.keys()) if (!rosterIds.has(id)) throw badRequest(`Сурагч ${id} энэ ангид элсээгүй`);

    const now = new Date();
    const absentees = [];
    await prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findMany({ where: { classSessionId: session.id } });
      const byStudent = new Map(existing.map((a) => [a.studentId, a]));
      for (const studentId of rosterIds) {
        const current = byStudent.get(studentId);
        if (current) {
          // Баталгаажсан ирцийг энд өөрчлөхгүй — залруулга (шалтгаантай) ашиглана
          if (current.confirmedAt) continue;
          const status = marks.get(studentId) ?? current.status;
          if (status !== current.status) {
            await tx.attendanceCorrection.create({ data: { attendanceId: current.id, oldStatus: current.status, newStatus: status, reason: 'Багш баталгаажуулахдаа өөрчилсөн', correctedBy: req.user.id } });
          }
          await tx.attendance.update({ where: { id: current.id }, data: { status, confirmedBy: req.user.id, confirmedAt: now } });
          if (status === 'ABSENT') absentees.push(studentId);
        } else {
          const status = marks.get(studentId) ?? 'ABSENT';
          await tx.attendance.create({ data: { classSessionId: session.id, studentId, status, method: 'MANUAL', confirmedBy: req.user.id, confirmedAt: now } });
          if (status === 'ABSENT') absentees.push(studentId);
        }
      }
    });
    await writeAudit(req, { action: 'CONFIRM_ATTENDANCE', entityType: 'ClassSession', entityId: session.id, newValues: { marks: req.body.marks, absent: absentees }, branchId: session.class.branchId });
    for (const studentId of absentees) {
      await notifyUsers(await studentAudienceUserIds(studentId), {
        title: `Ирц: ${session.class.code} хичээлд тасалсан`,
        body: `${session.startsAt.toISOString().slice(0, 10)} өдрийн хичээлд ирээгүй гэж бүртгэгдлээ`,
        link: '/portal',
      });
    }
    res.json({ ok: true, absent: absentees.length });
  },
);

// Баталгаажсан ирцийг залруулах — шалтгаан заавал, түүх хадгалагдана
router.put(
  '/attendance/:id',
  authorize(STAFF_TEACHER),
  validate(z.object({ status: z.enum(STATUSES), reason: zReason })),
  async (req, res) => {
    const id = idParam(req);
    const att = await prisma.attendance.findUnique({ where: { id } });
    if (!att) throw notFound();
    const session = await loadSessionForTeacher(req, att.classSessionId);
    if (att.status === req.body.status) throw badRequest('Төлөв өөрчлөгдөөгүй');

    const updated = await prisma.$transaction(async (tx) => {
      await tx.attendanceCorrection.create({ data: { attendanceId: id, oldStatus: att.status, newStatus: req.body.status, reason: req.body.reason, correctedBy: req.user.id } });
      return tx.attendance.update({ where: { id }, data: { status: req.body.status, ...(req.body.status !== 'LATE' ? { lateMinutes: 0 } : {}) } });
    });
    await writeAudit(req, { action: 'CORRECT', entityType: 'Attendance', entityId: id, oldValues: { status: att.status }, newValues: { status: updated.status }, reason: req.body.reason, branchId: session.class.branchId });
    await notifyUsers(await studentAudienceUserIds(att.studentId), {
      title: 'Ирц залруулагдлаа',
      body: `${STATUS_MN[att.status]} → ${STATUS_MN[updated.status]}. Шалтгаан: ${req.body.reason}`,
      link: '/portal',
    });
    res.json(updated);
  },
);

// Сурагчийн ирцийн түүх (сурагч өөрийн, эцэг эх хүүхдийн, ажилтан салбарын)
router.get('/attendance/student/:studentId', async (req, res) => {
  const studentId = idParam(req, 'studentId');
  await assertStudentAccess(req, studentId);
  const where = { studentId, ...(req.query.classId ? { classSession: { classId: Number(req.query.classId) } } : {}) };
  res.json(await prisma.attendance.findMany({
    where,
    include: { classSession: { select: { startsAt: true, topic: true, class: { select: { code: true } } } }, corrections: true },
    orderBy: { classSession: { startsAt: 'desc' } },
  }));
});

// Ирцийн нэгтгэл: ангиар (ажилтан, багш)
router.get('/attendance/class/:classId/summary', authorize('SUPER_ADMIN', 'BRANCH_ADMIN', 'TEACHER'), async (req, res) => {
  const classId = idParam(req, 'classId');
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls) throw notFound();
  if (req.user.role === 'TEACHER' && cls.teacherId !== req.user.teacherId) throw forbidden();
  if (!isSuper(req) && req.user.role !== 'TEACHER') assertBranch(req, cls.branchId);
  res.json(await attendanceSummary(classId));
});

export default router;
