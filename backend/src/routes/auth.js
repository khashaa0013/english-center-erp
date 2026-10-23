// =====================================================================
// M7 — Нэвтрэлт
// =====================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, unauthorized } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Нууц үг таахаас хамгаалах энгийн хязгаарлалт: IP+username тутамд 15 минутад 10 оролдлого
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > 15 * 60 * 1000) {
    attempts.set(key, { first: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > 10;
}

router.post(
  '/login',
  validate(z.object({ username: z.string().trim().min(1), password: z.string().min(1) })),
  async (req, res) => {
    const { username, password } = req.body;
    const key = `${req.ip}:${username.toLowerCase()}`;
    if (tooManyAttempts(key)) {
      return res.status(429).json({ error: { code: 'TOO_MANY', message: 'Хэт олон оролдлого. 15 минутын дараа дахин оролдоно уу' } });
    }

    const user = await prisma.user.findUnique({ where: { username }, include: { role: true, branch: true } });
    const ok = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw unauthorized('Нэвтрэх нэр эсвэл нууц үг буруу');

    attempts.delete(key);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    req.user = { id: user.id, branchId: user.branchId };
    await writeAudit(req, { action: 'LOGIN', entityType: 'User', entityId: user.id });

    res.json({ token: signToken(user) });
  },
);

router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, username: true, email: true, displayName: true, lastLoginAt: true,
      role: { select: { code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
  });
  res.json({ ...user, role: user.role.code, roleName: user.role.name, teacherId: req.user.teacherId, studentId: req.user.studentId, parentId: req.user.parentId });
});

router.post(
  '/change-password',
  authenticate,
  validate(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'Хамгийн багадаа 8 тэмдэгт') })),
  async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw badRequest('Одоогийн нууц үг буруу');
    const passwordHash = await bcrypt.hash(req.body.newPassword, env.bcryptRounds);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await writeAudit(req, { action: 'CHANGE_PASSWORD', entityType: 'User', entityId: user.id });
    res.json({ ok: true });
  },
);

export default router;
