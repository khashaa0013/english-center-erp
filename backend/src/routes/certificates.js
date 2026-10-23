// =====================================================================
// M4 — Ахицын үнэлгээ, төгсөлтийн шалгалт, PDF гэрчилгээ
// Гэрчилгээ: ирц (M2) + дүн (M4) + төлбөр (M3) шаардлага хангасан үед л
// =====================================================================
import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { conflict, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { nextCode, randomCode } from '../lib/codes.js';
import { dateOnly } from '../lib/time.js';
import { notifyUsers, studentAudienceUserIds } from '../lib/notify.js';
import { renderCertificatePdf } from '../lib/pdf.js';
import { assertClassAccess, assertStudentAccess } from '../lib/access.js';
import { authorize, STAFF, STAFF_TEACHER } from '../middleware/auth.js';
import { assertBranch, branchFilter } from '../middleware/scope.js';
import { absolutePath } from '../middleware/upload.js';
import { idParam, validate, zDate, zId, zOptStr, zReason } from '../middleware/validate.js';
import { graduationCheck } from '../services/graduation.js';

const router = Router();

// ----- Ахицын үнэлгээ (4 чадвар) -----
router.post(
  '/progress',
  authorize(STAFF_TEACHER),
  validate(z.object({
    enrollmentId: zId,
    skill: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING']),
    score: z.coerce.number().min(0).max(100),
    teacherComment: zOptStr(5000),
    assessedOn: zDate,
  })),
  async (req, res) => {
    const e = await prisma.enrollment.findUnique({ where: { id: req.body.enrollmentId }, include: { class: true } });
    if (!e) throw notFound();
    const cls = await assertClassAccess(req, e.classId, { write: true });
    const assessedBy = req.user.teacherId ?? e.class.teacherId;
    const row = await prisma.progressAssessment.create({
      data: { ...req.body, assessedOn: dateOnly(req.body.assessedOn), assessedBy },
    });
    await writeAudit(req, { action: 'CREATE', entityType: 'ProgressAssessment', entityId: row.id, newValues: row, branchId: cls.branchId });
    await notifyUsers(await studentAudienceUserIds(e.studentId), { title: 'Ахицын үнэлгээ нэмэгдлээ', body: `${req.body.skill}: ${req.body.score}`, link: '/portal/progress' });
    res.status(201).json(row);
  },
);

router.get('/progress/enrollment/:enrollmentId', async (req, res) => {
  const e = await prisma.enrollment.findUnique({ where: { id: idParam(req, 'enrollmentId') } });
  if (!e) throw notFound();
  await assertStudentAccess(req, e.studentId);
  res.json(await prisma.progressAssessment.findMany({
    where: { enrollmentId: e.id },
    include: { assessor: { select: { lastName: true, firstName: true } } },
    orderBy: [{ assessedOn: 'asc' }, { id: 'asc' }],
  }));
});

// ----- Төгсөлтийн шалгалт -----
router.get('/graduation/:enrollmentId', async (req, res) => {
  const e = await prisma.enrollment.findUnique({ where: { id: idParam(req, 'enrollmentId') } });
  if (!e) throw notFound();
  await assertStudentAccess(req, e.studentId);
  res.json(await graduationCheck(e.id));
});

router.get('/graduation/class/:classId', authorize(STAFF_TEACHER), async (req, res) => {
  const classId = idParam(req, 'classId');
  await assertClassAccess(req, classId);
  const enrollments = await prisma.enrollment.findMany({
    where: { classId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
    include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } } },
  });
  res.json(await Promise.all(enrollments.map(async (e) => ({ student: e.student, ...(await graduationCheck(e.id)) }))));
});

// ----- Гэрчилгээ -----
const certInclude = {
  enrollment: {
    include: {
      student: { select: { id: true, studentCode: true, lastName: true, firstName: true } },
      class: { select: { code: true, course: { select: { name: true, level: { select: { code: true } } } } } },
    },
  },
  issuer: { select: { displayName: true } },
};

router.get('/certificates', authorize(STAFF), async (req, res) => {
  res.json(await prisma.certificate.findMany({
    where: { enrollment: branchFilter(req) },
    include: certInclude,
    orderBy: { id: 'desc' },
  }));
});

router.post('/certificates', authorize(STAFF), validate(z.object({ enrollmentId: zId })), async (req, res) => {
  const enrollmentId = req.body.enrollmentId;
  const e = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { certificate: true } });
  if (!e) throw notFound();
  assertBranch(req, e.branchId);

  const check = await graduationCheck(enrollmentId);
  if (!check.eligible) throw conflict('Гэрчилгээ олгох шаардлага хангаагүй', { reasons: check.reasons, check });

  const cert = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${enrollmentId} FOR UPDATE`;
    const existing = await tx.certificate.findUnique({ where: { enrollmentId } });
    if (existing?.status === 'ISSUED') throw conflict('Гэрчилгээ олгогдсон байна');
    const data = {
      certificateNo: await nextCode(tx.certificate, 'certificateNo', 'CERT'),
      verificationCode: randomCode(8),
      attendancePercent: check.attendance.percent,
      finalScore: check.score.percent,
      issuedBy: req.user.id,
      issuedAt: new Date(),
      status: 'ISSUED',
      revokeReason: null,
    };
    // Хүчингүй болсон гэрчилгээг шинэ дугаартайгаар дахин олгоно
    const c = existing
      ? await tx.certificate.update({ where: { id: existing.id }, data })
      : await tx.certificate.create({ data: { ...data, enrollmentId } });
    await tx.enrollment.update({ where: { id: enrollmentId }, data: { status: 'COMPLETED' } });
    return c;
  });

  const full = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { student: true, class: { include: { course: { include: { level: true } } } }, branch: true },
  });
  const relPath = `certificates/${cert.certificateNo}.pdf`;
  await renderCertificatePdf(relPath, { certificate: cert, enrollment: full, branch: full.branch });
  const saved = await prisma.certificate.update({ where: { id: cert.id }, data: { filePath: relPath } });

  await writeAudit(req, { action: 'ISSUE', entityType: 'Certificate', entityId: cert.id, newValues: { certificateNo: cert.certificateNo, attendance: cert.attendancePercent, score: cert.finalScore }, branchId: e.branchId });
  await notifyUsers(await studentAudienceUserIds(e.studentId), { title: 'Гэрчилгээ олгогдлоо', body: `Дугаар ${cert.certificateNo}`, link: '/portal/certificates' });
  res.status(201).json(saved);
});

router.post('/certificates/:id/revoke', authorize(STAFF), validate(z.object({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const cert = await prisma.certificate.findUnique({ where: { id }, include: { enrollment: true } });
  if (!cert) throw notFound();
  assertBranch(req, cert.enrollment.branchId);
  if (cert.status === 'REVOKED') throw conflict('Аль хэдийн хүчингүй болсон');
  const updated = await prisma.$transaction(async (tx) => {
    await tx.enrollment.update({ where: { id: cert.enrollmentId }, data: { status: 'CONFIRMED' } });
    return tx.certificate.update({ where: { id }, data: { status: 'REVOKED', revokeReason: req.body.reason } });
  });
  await writeAudit(req, { action: 'REVOKE', entityType: 'Certificate', entityId: id, oldValues: { status: 'ISSUED' }, newValues: { status: 'REVOKED' }, reason: req.body.reason, branchId: cert.enrollment.branchId });
  res.json(updated);
});

router.get('/certificates/:id/file', async (req, res) => {
  const cert = await prisma.certificate.findUnique({ where: { id: idParam(req) }, include: { enrollment: true } });
  if (!cert?.filePath) throw notFound();
  await assertStudentAccess(req, cert.enrollment.studentId);
  if (cert.status !== 'ISSUED' && ['STUDENT', 'PARENT'].includes(req.user.role)) throw forbidden('Гэрчилгээ хүчингүй');
  const full = absolutePath(cert.filePath);
  if (!fs.existsSync(full)) throw notFound('Файл олдсонгүй');
  res.download(full, `${cert.certificateNo}.pdf`);
});

export default router;
