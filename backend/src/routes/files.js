// =====================================================================
// Хамгаалалттай файл татах: /api/files/<хавтас>/<файл>
// Файл бүрийг эзэмшигч бичлэгээр нь олж, хандах эрхийг шалгана.
// =====================================================================
import { Router } from 'express';
import fs from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { forbidden, notFound } from '../lib/httpError.js';
import { assertClassAccess, assertStudentAccess } from '../lib/access.js';
import { absolutePath } from '../middleware/upload.js';
import { assertBranch } from '../middleware/scope.js';

const router = Router();
const OFFICE = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'];

const CHECKS = {
  async materials(req, filePath) {
    const m = await prisma.material.findFirst({ where: { filePath } });
    if (!m) throw notFound();
    if (m.classId) return assertClassAccess(req, m.classId);
    // Курсийн нийтлэг материал: тухайн курсийн аль нэг ангид хандах эрхтэй байх
    const classes = await prisma.class.findMany({ where: { courseId: m.courseId }, select: { id: true } });
    for (const c of classes) {
      try { return await assertClassAccess(req, c.id); } catch { /* дараагийн анги */ }
    }
    throw forbidden();
  },
  async assignments(req, filePath) {
    const a = await prisma.assignment.findFirst({ where: { attachmentPath: filePath } });
    if (!a) throw notFound();
    return assertClassAccess(req, a.classId);
  },
  async submissions(req, filePath) {
    const s = await prisma.submission.findFirst({ where: { filePath }, include: { assignment: true } });
    if (!s) throw notFound();
    if (['STUDENT', 'PARENT'].includes(req.user.role)) return assertStudentAccess(req, s.studentId);
    return assertClassAccess(req, s.assignment.classId, { write: true });
  },
  async 'exam-audio'(req, filePath) {
    const q = await prisma.question.findFirst({ where: { audioPath: filePath }, include: { exam: true } });
    if (q) return assertClassAccess(req, q.exam.classId);
    const ans = await prisma.attemptAnswer.findFirst({ where: { audioPath: filePath }, include: { attempt: { include: { exam: true } } } });
    if (!ans) throw notFound();
    if (['STUDENT', 'PARENT'].includes(req.user.role)) return assertStudentAccess(req, ans.attempt.studentId);
    return assertClassAccess(req, ans.attempt.exam.classId, { write: true });
  },
  async documents(req, filePath) {
    if (!OFFICE.includes(req.user.role)) throw forbidden();
    const d = await prisma.studentDocument.findFirst({ where: { filePath }, include: { student: true } });
    if (!d) throw notFound();
    assertBranch(req, d.student.branchId);
  },
  async branding(req) {
    if (!OFFICE.includes(req.user.role)) throw forbidden();
  },
};

router.get('/*path', async (req, res) => {
  const parts = Array.isArray(req.params.path) ? req.params.path : [req.params.path];
  const filePath = parts.join('/');
  const check = CHECKS[parts[0]];
  if (!check || parts.length !== 2) throw forbidden();
  await check(req, filePath);
  const full = absolutePath(filePath);
  if (!fs.existsSync(full)) throw notFound('Файл олдсонгүй');
  res.sendFile(full);
});

export default router;
