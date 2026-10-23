// =====================================================================
// M1 → M3 — Элсэлт: үүсгэх, батлах (нэхэмжлэл + гэрээ), цуцлах, шилжүүлэх
// Нэг элсэлт = нэг нэхэмжлэл. Давтан батлахад давхардал үүсэхгүй.
// =====================================================================
import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { nextCode } from '../lib/codes.js';
import { dateOnly, ubDateString } from '../lib/time.js';
import { fromCents, invoiceBalance, toCents } from '../lib/money.js';
import { notifyUsers, studentAudienceUserIds } from '../lib/notify.js';
import { renderContractPdf } from '../lib/pdf.js';
import { assertStudentAccess } from '../lib/access.js';
import { authorize, STAFF, STAFF_FINANCE } from '../middleware/auth.js';
import { assertBranch, branchFilter } from '../middleware/scope.js';
import { absolutePath } from '../middleware/upload.js';
import { idParam, validate, zDate, zId, zMoney, zOptId, zReason } from '../middleware/validate.js';

const router = Router();

const ACTIVE = ['PENDING', 'CONFIRMED'];
const detailInclude = {
  student: { select: { id: true, studentCode: true, lastName: true, firstName: true, userId: true } },
  class: { include: { course: { include: { level: true } }, teacher: { select: { lastName: true, firstName: true } } } },
  package: true,
  invoice: { include: { payments: true, refunds: true } },
  contract: { include: { signerParent: true } },
  certificate: true,
  confirmer: { select: { displayName: true } },
  transferredFrom: { select: { id: true, class: { select: { code: true } } } },
  transferredTo: { select: { id: true, class: { select: { code: true } } } },
};

const withBalance = (e) => ({
  ...e,
  invoice: e.invoice ? { ...e.invoice, ...invoiceBalance(e.invoice), payments: undefined, refunds: undefined } : null,
});

router.get('/', authorize(STAFF_FINANCE), async (req, res) => {
  const { status, classId, studentId } = req.query;
  const where = {
    ...branchFilter(req),
    ...(status ? { status } : {}),
    ...(classId ? { classId: Number(classId) } : {}),
    ...(studentId ? { studentId: Number(studentId) } : {}),
  };
  const items = await prisma.enrollment.findMany({ where, include: detailInclude, orderBy: { id: 'desc' }, take: 1000 });
  res.json(items.map(withBalance));
});

router.get('/:id', async (req, res) => {
  const e = await prisma.enrollment.findUnique({ where: { id: idParam(req) }, include: detailInclude });
  if (!e) throw notFound();
  await assertStudentAccess(req, e.studentId);
  res.json(withBalance(e));
});

// Анги дүүрсэн эсэх, багц ангийн курстэй таарах эсэхийг шалгана
async function checkClassForEnrollment(tx, req, classId, packageId, { excludeId } = {}) {
  await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classId} FOR UPDATE`;
  const cls = await tx.class.findUnique({ where: { id: classId } });
  if (!cls) throw notFound('Анги олдсонгүй');
  assertBranch(req, cls.branchId);
  if (['COMPLETED', 'CANCELLED'].includes(cls.status)) throw conflict('Энэ анги элсэлт авахгүй (дууссан эсвэл цуцлагдсан)');

  const pkg = await tx.trainingPackage.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.isActive) throw badRequest('Багц олдсонгүй эсвэл идэвхгүй');
  if (pkg.courseId !== cls.courseId) throw badRequest('Багц нь ангийн сургалттай таарахгүй байна');

  const taken = await tx.enrollment.count({
    where: { classId, status: { in: ACTIVE }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  });
  if (taken >= cls.capacity) throw conflict(`Анги дүүрсэн байна (${taken}/${cls.capacity})`);
  return { cls, pkg };
}

router.post(
  '/',
  authorize(STAFF),
  validate(z.object({
    studentId: zId,
    classId: zId,
    packageId: zId,
    discountAmount: zMoney.optional(),
    leadId: zOptId,
  })),
  async (req, res) => {
    const { studentId, classId, packageId, leadId } = req.body;
    const enrollment = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw notFound('Сурагч олдсонгүй');
      assertBranch(req, student.branchId);

      const { cls, pkg } = await checkClassForEnrollment(tx, req, classId, packageId);
      if (cls.branchId !== student.branchId) throw badRequest('Сурагч ба анги өөр салбарынх байна');

      const dup = await tx.enrollment.findUnique({ where: { studentId_classId: { studentId, classId } } });
      if (dup) throw conflict('Сурагч энэ ангид элссэн байна', { enrollmentId: dup.id });

      const list = toCents(pkg.price);
      const discount = toCents(req.body.discountAmount ?? 0);
      if (discount > list) throw badRequest('Хөнгөлөлт үнээс их байна');

      // Сонирхогчоос үүссэн бол тэр lead-тэй холбоно (нэг хүсэлт = нэг элсэлт)
      const sourceLead = leadId
        ? await tx.lead.findFirst({ where: { id: leadId, convertedStudentId: studentId } })
        : await tx.lead.findFirst({ where: { convertedStudentId: studentId, enrollment: null } });
      if (leadId && !sourceLead) throw badRequest('Сонирхогч энэ сурагчтай холбогдоогүй байна');

      return tx.enrollment.create({
        data: {
          branchId: cls.branchId,
          studentId,
          classId,
          packageId,
          leadId: sourceLead?.id ?? null,
          listPrice: fromCents(list),
          discountAmount: fromCents(discount),
          finalAmount: fromCents(list - discount),
        },
      });
    });
    await writeAudit(req, { action: 'CREATE', entityType: 'Enrollment', entityId: enrollment.id, newValues: enrollment, branchId: enrollment.branchId });
    res.status(201).json(enrollment);
  },
);

// Элсэлт батлах: нэхэмжлэл + гэрээний ноорог нэг transaction-д үүснэ
router.post(
  '/:id/confirm',
  authorize(STAFF),
  validate(z.object({ dueDate: zDate.optional() })),
  async (req, res) => {
    const id = idParam(req);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${id} FOR UPDATE`;
      const e = await tx.enrollment.findUnique({ where: { id }, include: { class: true } });
      if (!e) throw notFound();
      assertBranch(req, e.branchId);
      if (e.status !== 'PENDING') throw conflict(`Элсэлт ${e.status} төлөвтэй тул батлах боломжгүй`);

      const now = new Date();
      const updated = await tx.enrollment.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedAt: now, confirmedBy: req.user.id },
      });

      const due = req.body.dueDate
        ?? (e.class.startDate > now ? ubDateString(e.class.startDate) : ubDateString(new Date(now.getTime() + 7 * 86400000)));
      const invoice = await tx.invoice.create({
        data: {
          branchId: e.branchId,
          enrollmentId: id,
          invoiceNo: await nextCode(tx.invoice, 'invoiceNo', 'INV'),
          totalAmount: e.finalAmount,
          dueDate: dateOnly(due),
          status: toCents(e.finalAmount) === 0 ? 'PAID' : 'UNPAID',
          issuedBy: req.user.id,
        },
      });
      const contract = await tx.contract.create({
        data: { enrollmentId: id, contractNo: await nextCode(tx.contract, 'contractNo', 'CT') },
      });
      await writeAudit(req, { action: 'CONFIRM', entityType: 'Enrollment', entityId: id, oldValues: { status: e.status }, newValues: { status: 'CONFIRMED', invoiceId: invoice.id, contractId: contract.id }, branchId: e.branchId }, tx);
      await notifyUsers(await studentAudienceUserIds(e.studentId, tx), {
        title: 'Элсэлт баталгаажлаа',
        body: `Нэхэмжлэл ${invoice.invoiceNo}: ${Number(invoice.totalAmount).toLocaleString()}₮, төлөх хугацаа ${due}`,
        link: '/portal',
      }, tx);
      return { enrollment: updated, invoice, contract };
    });
    res.json(result);
  },
);

router.post('/:id/cancel', authorize(STAFF), validate(z.object({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${id} FOR UPDATE`;
    const e = await tx.enrollment.findUnique({ where: { id }, include: { invoice: { include: { payments: true, refunds: true } } } });
    if (!e) throw notFound();
    assertBranch(req, e.branchId);
    if (!ACTIVE.includes(e.status)) throw conflict(`${e.status} төлөвтэй элсэлтийг цуцлах боломжгүй`);
    if (e.invoice) {
      const bal = invoiceBalance(e.invoice);
      if (bal.netPaidCents > 0) throw conflict(`Төлөгдсөн ${bal.netPaid}₮ байна. Эхлээд буцаалт хийнэ үү.`);
      await tx.invoice.update({ where: { id: e.invoice.id }, data: { status: 'CANCELLED' } });
    }
    await tx.contract.updateMany({ where: { enrollmentId: id }, data: { status: 'CANCELLED' } });
    const updated = await tx.enrollment.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: req.body.reason } });
    await writeAudit(req, { action: 'CANCEL', entityType: 'Enrollment', entityId: id, oldValues: { status: e.status }, newValues: { status: 'CANCELLED' }, reason: req.body.reason, branchId: e.branchId }, tx);
    return updated;
  });
  res.json(result);
});

// Анги шилжүүлэх: шинэ элсэлт үүсч, нэхэмжлэл ба төлөлт нь шинэ элсэлт рүү шилжинэ
router.post(
  '/:id/transfer',
  authorize(STAFF),
  validate(z.object({ classId: zId, reason: zReason })),
  async (req, res) => {
    const id = idParam(req);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${id} FOR UPDATE`;
      const old = await tx.enrollment.findUnique({ where: { id }, include: { invoice: true, contract: true } });
      if (!old) throw notFound();
      assertBranch(req, old.branchId);
      if (old.status !== 'CONFIRMED') throw conflict('Зөвхөн баталгаажсан элсэлтийг шилжүүлнэ');
      if (old.classId === req.body.classId) throw badRequest('Ижил анги байна');

      const { cls } = await checkClassForEnrollment(tx, req, req.body.classId, old.packageId);
      const dup = await tx.enrollment.findUnique({ where: { studentId_classId: { studentId: old.studentId, classId: cls.id } } });
      if (dup) throw conflict('Сурагч тухайн ангид өмнө нь элссэн байна');

      await tx.enrollment.update({ where: { id }, data: { status: 'TRANSFERRED', cancelReason: req.body.reason } });
      const created = await tx.enrollment.create({
        data: {
          branchId: old.branchId,
          studentId: old.studentId,
          classId: cls.id,
          packageId: old.packageId,
          transferredFromId: id,
          listPrice: old.listPrice,
          discountAmount: old.discountAmount,
          finalAmount: old.finalAmount,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: req.user.id,
        },
      });
      if (old.invoice) await tx.invoice.update({ where: { id: old.invoice.id }, data: { enrollmentId: created.id } });
      if (old.contract) await tx.contract.update({ where: { id: old.contract.id }, data: { enrollmentId: created.id } });
      await writeAudit(req, { action: 'TRANSFER', entityType: 'Enrollment', entityId: id, oldValues: { classId: old.classId }, newValues: { classId: cls.id, newEnrollmentId: created.id }, reason: req.body.reason, branchId: old.branchId }, tx);
      return created;
    });
    res.json(result);
  },
);

// ----- Гэрээ (PDF) -----
async function loadContractContext(enrollmentId) {
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      student: { include: { parentLinks: { where: { verifiedAt: { not: null } }, include: { parent: true } } } },
      class: { include: { course: { include: { level: true } } } },
      package: true,
      contract: true,
      branch: true,
    },
  });
  if (!e) throw notFound();
  if (!e.contract) throw conflict('Элсэлт батлагдаагүй тул гэрээ байхгүй');
  return e;
}

router.post('/:id/contract/generate', authorize(STAFF), async (req, res) => {
  const e = await loadContractContext(idParam(req));
  assertBranch(req, e.branchId);
  if (e.contract.status === 'CANCELLED') throw conflict('Цуцлагдсан гэрээ');
  const relPath = `contracts/${e.contract.contractNo}.pdf`;
  const parent = e.contract.signerParentId
    ? e.student.parentLinks.find((l) => l.parentId === e.contract.signerParentId)?.parent
    : e.student.parentLinks[0]?.parent;
  await renderContractPdf(relPath, { contract: e.contract, enrollment: e, branch: e.branch, parent });
  const contract = await prisma.contract.update({ where: { id: e.contract.id }, data: { filePath: relPath } });
  await writeAudit(req, { action: 'GENERATE_PDF', entityType: 'Contract', entityId: contract.id, branchId: e.branchId });
  res.json(contract);
});

router.post(
  '/:id/contract/sign',
  authorize(STAFF),
  validate(z.object({ signerParentId: zOptId })),
  async (req, res) => {
    const e = await loadContractContext(idParam(req));
    assertBranch(req, e.branchId);
    if (e.contract.status !== 'DRAFT') throw conflict(`Гэрээ ${e.contract.status} төлөвтэй`);
    const { signerParentId } = req.body;
    if (signerParentId && !e.student.parentLinks.some((l) => l.parentId === signerParentId)) {
      throw badRequest('Энэ эцэг эх сурагчтай баталгаажсан холбоогүй');
    }
    const contract = await prisma.contract.update({
      where: { id: e.contract.id },
      data: { status: 'SIGNED', signedAt: new Date(), signerParentId: signerParentId ?? null },
    });
    await writeAudit(req, { action: 'SIGN', entityType: 'Contract', entityId: contract.id, newValues: contract, branchId: e.branchId });
    res.json(contract);
  },
);

router.get('/:id/contract/file', async (req, res) => {
  const e = await prisma.enrollment.findUnique({ where: { id: idParam(req) }, include: { contract: true } });
  if (!e?.contract?.filePath) throw notFound('Гэрээний PDF үүсгээгүй байна');
  await assertStudentAccess(req, e.studentId);
  const full = absolutePath(e.contract.filePath);
  if (!fs.existsSync(full)) throw notFound('Файл олдсонгүй');
  res.download(full, `${e.contract.contractNo}.pdf`);
});

export default router;
