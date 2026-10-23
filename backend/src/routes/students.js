// =====================================================================
// M1 — Сурагч: профайл, нэвтрэх эрх, эцэг эхийн холбоо, баримт
// =====================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { nextCode } from '../lib/codes.js';
import { dateOnly } from '../lib/time.js';
import { invoiceBalance } from '../lib/money.js';
import { assertStudentAccess } from '../lib/access.js';
import { ALL_STAFF, authorize, STAFF } from '../middleware/auth.js';
import { assertBranch, branchFilter, resolveBranchId } from '../middleware/scope.js';
import { idParam, validate, zDate, zId, zOptId, zOptStr, zStr } from '../middleware/validate.js';
import { storedPath, uploader } from '../middleware/upload.js';

const router = Router();

const studentSchema = z.object({
  branchId: zOptId,
  lastName: zStr(100),
  firstName: zStr(100),
  registerNo: zOptStr(20),
  birthDate: zDate.optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  phone: zOptStr(30),
  address: zOptStr(255),
  currentLevelId: zOptId,
  status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED']).optional(),
  force: z.boolean().optional(),
});

const toStudentData = ({ force: _f, branchId: _b, birthDate, ...rest }) => ({
  ...rest,
  ...(birthDate !== undefined ? { birthDate: birthDate ? dateOnly(birthDate) : null } : {}),
});

router.get('/', authorize(ALL_STAFF), async (req, res) => {
  const { q, status, levelId } = req.query;
  const where = {
    ...branchFilter(req),
    ...(status ? { status } : {}),
    ...(levelId ? { currentLevelId: Number(levelId) } : {}),
    ...(q ? { OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { studentCode: { contains: q } }, { phone: { contains: q } }, { registerNo: { contains: q } }] } : {}),
  };
  if (req.user.role === 'TEACHER') {
    where.enrollments = { some: { status: { in: ['CONFIRMED', 'COMPLETED'] }, class: { teacherId: req.user.teacherId } } };
  }
  res.json(await prisma.student.findMany({
    where,
    include: {
      currentLevel: { select: { code: true } },
      user: { select: { id: true, username: true } },
      _count: { select: { enrollments: true } },
    },
    orderBy: { id: 'desc' },
    take: 1000,
  }));
});

// Сурагчийн бүрэн профайл (гэрчилгээний түүх M4-ээс, төлбөр M3-аас)
router.get('/:id', async (req, res) => {
  const id = idParam(req);
  await assertStudentAccess(req, id);
  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, name: true } },
      currentLevel: true,
      user: { select: { id: true, username: true, isActive: true } },
      lead: { select: { id: true, source: true, createdAt: true } },
      parentLinks: { include: { parent: true, verifier: { select: { displayName: true } } } },
      documents: { orderBy: { id: 'desc' }, include: { uploader: { select: { displayName: true } } } },
      enrollments: {
        orderBy: { id: 'desc' },
        include: {
          class: { include: { course: { include: { level: true } }, teacher: { select: { lastName: true, firstName: true } } } },
          package: true,
          invoice: { include: { payments: true, refunds: true } },
          contract: true,
          certificate: true,
        },
      },
    },
  });
  student.enrollments = student.enrollments.map((e) => ({
    ...e,
    invoice: e.invoice ? { ...e.invoice, ...invoiceBalance(e.invoice), payments: undefined, refunds: undefined } : null,
  }));
  if (['STUDENT', 'PARENT'].includes(req.user.role)) delete student.documents;
  res.json(student);
});

router.post('/', authorize(STAFF), validate(studentSchema), async (req, res) => {
  const branchId = resolveBranchId(req, req.body.branchId);
  if (!req.body.force) {
    const dup = await prisma.student.findMany({
      where: {
        branchId,
        OR: [
          ...(req.body.registerNo ? [{ registerNo: req.body.registerNo }] : []),
          { lastName: req.body.lastName, firstName: req.body.firstName, ...(req.body.birthDate ? { birthDate: dateOnly(req.body.birthDate) } : {}) },
        ],
      },
      select: { id: true, studentCode: true, lastName: true, firstName: true },
    });
    if (dup.length) throw conflict('Ижил мэдээлэлтэй сурагч бүртгэлтэй байна', { students: dup });
  }
  const student = await prisma.$transaction(async (tx) => tx.student.create({
    data: { ...toStudentData(req.body), branchId, studentCode: await nextCode(tx.student, 'studentCode', 'ST') },
  }));
  await writeAudit(req, { action: 'CREATE', entityType: 'Student', entityId: student.id, newValues: student, branchId });
  res.status(201).json(student);
});

router.put('/:id', authorize(STAFF), validate(studentSchema.partial()), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.student.findUnique({ where: { id } });
  if (!old) throw notFound();
  assertBranch(req, old.branchId);
  const student = await prisma.student.update({ where: { id }, data: toStudentData(req.body) });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Student', entityId: id, oldValues: old, newValues: student, branchId: old.branchId });
  res.json(student);
});

// Сурагчид нэвтрэх эрх үүсгэх (нэвтрэх нэр = сурагчийн код)
router.post('/:id/account', authorize(STAFF), validate(z.object({ password: z.string().min(8) })), async (req, res) => {
  const id = idParam(req);
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw notFound();
  assertBranch(req, student.branchId);
  if (student.userId) throw conflict('Сурагч нэвтрэх эрхтэй болсон байна');

  const role = await prisma.role.findUnique({ where: { code: 'STUDENT' } });
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        username: student.studentCode.toLowerCase(),
        displayName: `${student.lastName} ${student.firstName}`,
        passwordHash: await bcrypt.hash(req.body.password, env.bcryptRounds),
        roleId: role.id,
        branchId: student.branchId,
      },
    });
    await tx.student.update({ where: { id }, data: { userId: u.id } });
    return u;
  });
  await writeAudit(req, { action: 'CREATE_ACCOUNT', entityType: 'Student', entityId: id, newValues: { username: user.username } });
  res.status(201).json({ username: user.username });
});

// ----- Эцэг эхийн холбоо -----
router.post(
  '/:id/parents',
  authorize(STAFF),
  validate(z.object({
    parentId: zId,
    relationship: z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'OTHER']),
    verify: z.boolean().optional(),
  })),
  async (req, res) => {
    const studentId = idParam(req);
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw notFound();
    assertBranch(req, student.branchId);
    const link = await prisma.parentStudent.create({
      data: {
        studentId,
        parentId: req.body.parentId,
        relationship: req.body.relationship,
        ...(req.body.verify ? { verifiedBy: req.user.id, verifiedAt: new Date() } : {}),
      },
      include: { parent: true },
    });
    await writeAudit(req, { action: 'LINK_PARENT', entityType: 'Student', entityId: studentId, newValues: link, branchId: student.branchId });
    res.status(201).json(link);
  },
);

// Админ холбоосыг баталгаажуулснаар л эцэг эх хүүхдийн мэдээллийг харна (M5)
router.post('/parent-links/:linkId/verify', authorize(STAFF), async (req, res) => {
  const linkId = idParam(req, 'linkId');
  const link = await prisma.parentStudent.findUnique({ where: { id: linkId }, include: { student: true } });
  if (!link) throw notFound();
  assertBranch(req, link.student.branchId);
  if (link.verifiedAt) throw conflict('Аль хэдийн баталгаажсан');
  const updated = await prisma.parentStudent.update({ where: { id: linkId }, data: { verifiedBy: req.user.id, verifiedAt: new Date() } });
  await writeAudit(req, { action: 'VERIFY', entityType: 'ParentStudent', entityId: linkId, newValues: updated, branchId: link.student.branchId });
  res.json(updated);
});

router.delete('/parent-links/:linkId', authorize(STAFF), validate(z.object({ reason: z.string().min(3) })), async (req, res) => {
  const linkId = idParam(req, 'linkId');
  const link = await prisma.parentStudent.findUnique({ where: { id: linkId }, include: { student: true } });
  if (!link) throw notFound();
  assertBranch(req, link.student.branchId);
  await prisma.parentStudent.delete({ where: { id: linkId } });
  await writeAudit(req, { action: 'UNLINK', entityType: 'ParentStudent', entityId: linkId, oldValues: link, reason: req.body.reason, branchId: link.student.branchId });
  res.json({ ok: true });
});

// ----- Баримт хавсаргах -----
const docUpload = uploader('documents', 'document');
router.post('/:id/documents', authorize(STAFF), docUpload.single('file'), async (req, res) => {
  const id = idParam(req);
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw notFound();
  assertBranch(req, student.branchId);
  if (!req.file) throw badRequest('Файл сонгоно уу');
  const doc = await prisma.studentDocument.create({
    data: {
      studentId: id,
      enrollmentId: req.body.enrollmentId ? Number(req.body.enrollmentId) : null,
      docType: String(req.body.docType ?? 'OTHER').slice(0, 50),
      originalName: req.file.originalname.slice(0, 255),
      filePath: storedPath('documents', req.file),
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id,
    },
  });
  await writeAudit(req, { action: 'UPLOAD', entityType: 'StudentDocument', entityId: doc.id, newValues: doc, branchId: student.branchId });
  res.status(201).json(doc);
});

export default router;
