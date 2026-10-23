// =====================================================================
// M1 — Сонирхогч (lead): бүртгэл, давхардал шалгах, сурагч болгох
// Онлайн маягт (веб, Facebook) нь /api/public/leads-ээр орно.
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { conflict, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { nextCode } from '../lib/codes.js';
import { dateOnly } from '../lib/time.js';
import { authorize, STAFF } from '../middleware/auth.js';
import { assertBranch, branchFilter, resolveBranchId } from '../middleware/scope.js';
import { idParam, validate, zDate, zOptId, zOptStr, zStr } from '../middleware/validate.js';

const router = Router();
router.use(authorize(STAFF));

const leadInclude = {
  interestedCourse: { select: { id: true, name: true, code: true } },
  placementLevel: { select: { id: true, code: true, name: true } },
  assignee: { select: { id: true, displayName: true } },
  convertedStudent: { select: { id: true, studentCode: true, lastName: true, firstName: true } },
};

const normalizePhone = (p) => p.replace(/[^\d+]/g, '');

// Утас эсвэл нэрээр давхардал хайх (lead болон сурагч)
export async function findDuplicates(branchId, { phone, studentName }) {
  const cleanPhone = phone ? normalizePhone(phone) : null;
  const [leads, students] = await Promise.all([
    prisma.lead.findMany({
      where: {
        branchId,
        status: { notIn: ['LOST'] },
        OR: [
          ...(cleanPhone ? [{ contactPhone: cleanPhone }] : []),
          ...(studentName ? [{ studentName }] : []),
        ],
      },
      select: { id: true, contactName: true, contactPhone: true, studentName: true, status: true },
      take: 10,
    }),
    prisma.student.findMany({
      where: {
        branchId,
        OR: [
          ...(cleanPhone ? [{ phone: cleanPhone }, { parentLinks: { some: { parent: { phone: cleanPhone } } } }] : []),
          ...(studentName ? [{ firstName: studentName.split(' ').pop() }] : []),
        ],
      },
      select: { id: true, studentCode: true, lastName: true, firstName: true, phone: true },
      take: 10,
    }),
  ]);
  return { leads, students };
}

router.get('/', async (req, res) => {
  const { status, q, source } = req.query;
  const where = {
    ...branchFilter(req),
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(q ? { OR: [{ contactName: { contains: q } }, { studentName: { contains: q } }, { contactPhone: { contains: q } }] } : {}),
  };
  res.json(await prisma.lead.findMany({ where, include: leadInclude, orderBy: { id: 'desc' }, take: 500 }));
});

router.get('/check-duplicate', async (req, res) => {
  const branchId = resolveBranchId(req, req.query.branchId);
  res.json(await findDuplicates(branchId, { phone: req.query.phone, studentName: req.query.studentName }));
});

router.get('/:id', async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: idParam(req) }, include: leadInclude });
  if (!lead) throw notFound();
  assertBranch(req, lead.branchId);
  res.json(lead);
});

const leadSchema = z.object({
  branchId: zOptId,
  contactName: zStr(150),
  contactPhone: z.string().trim().min(6).max(30),
  studentName: zStr(150),
  studentBirthDate: zDate.optional().nullable(),
  interestedCourseId: zOptId,
  placementLevelId: zOptId,
  source: z.enum(['WALK_IN', 'PHONE', 'WEB_FORM', 'FACEBOOK', 'REFERRAL', 'OTHER']).optional(),
  status: z.enum(['NEW', 'CONTACTED', 'PLACEMENT_TEST', 'LOST']).optional(),
  note: zOptStr(2000),
  assignedTo: zOptId,
  force: z.boolean().optional(),
});

const toLeadData = ({ force: _force, branchId: _b, studentBirthDate, contactPhone, ...rest }) => ({
  ...rest,
  ...(contactPhone ? { contactPhone: normalizePhone(contactPhone) } : {}),
  ...(studentBirthDate !== undefined ? { studentBirthDate: studentBirthDate ? dateOnly(studentBirthDate) : null } : {}),
});

router.post('/', validate(leadSchema), async (req, res) => {
  const branchId = resolveBranchId(req, req.body.branchId);
  if (!req.body.force) {
    const dup = await findDuplicates(branchId, { phone: req.body.contactPhone, studentName: req.body.studentName });
    const exact = dup.leads.find((l) => l.contactPhone === normalizePhone(req.body.contactPhone) && l.studentName === req.body.studentName);
    if (exact) throw conflict('Ижил утас, нэртэй сонирхогч бүртгэлтэй байна', dup);
  }
  const lead = await prisma.lead.create({ data: { ...toLeadData(req.body), branchId }, include: leadInclude });
  await writeAudit(req, { action: 'CREATE', entityType: 'Lead', entityId: lead.id, newValues: lead, branchId });
  res.status(201).json(lead);
});

router.put('/:id', validate(leadSchema.partial()), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.lead.findUnique({ where: { id } });
  if (!old) throw notFound();
  assertBranch(req, old.branchId);
  if (old.status === 'CONVERTED') throw conflict('Сурагч болсон сонирхогчийг засах боломжгүй');
  const lead = await prisma.lead.update({ where: { id }, data: toLeadData(req.body), include: leadInclude });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Lead', entityId: id, oldValues: old, newValues: req.body, branchId: old.branchId });
  res.json(lead);
});

// Сонирхогчийг сурагч болгох. Давтан дуудахад шинэ сурагч үүсэхгүй.
router.post(
  '/:id/convert',
  validate(z.object({
    lastName: zStr(100),
    firstName: zStr(100),
    registerNo: zOptStr(20),
    birthDate: zDate.optional().nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
    phone: zOptStr(30),
    currentLevelId: zOptId,
  })),
  async (req, res) => {
    const id = idParam(req);
    const result = await prisma.$transaction(async (tx) => {
      // Мөрийг түгжиж, зэрэг ирсэн хоёр хүсэлтээс давхар сурагч үүсэхээс хамгаална
      await tx.$queryRaw`SELECT id FROM leads WHERE id = ${id} FOR UPDATE`;
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead) throw notFound();
      assertBranch(req, lead.branchId);
      if (lead.convertedStudentId) throw conflict('Энэ сонирхогч аль хэдийн сурагч болсон', { studentId: lead.convertedStudentId });

      const { birthDate, ...rest } = req.body;
      const student = await tx.student.create({
        data: {
          ...rest,
          branchId: lead.branchId,
          studentCode: await nextCode(tx.student, 'studentCode', 'ST'),
          birthDate: birthDate ? dateOnly(birthDate) : lead.studentBirthDate,
          currentLevelId: rest.currentLevelId ?? lead.placementLevelId,
        },
      });
      await tx.lead.update({ where: { id }, data: { status: 'CONVERTED', convertedStudentId: student.id } });
      await writeAudit(req, { action: 'CONVERT', entityType: 'Lead', entityId: id, newValues: { studentId: student.id }, branchId: lead.branchId }, tx);
      return { student, lead };
    });
    res.status(201).json(result);
  },
);

export default router;
