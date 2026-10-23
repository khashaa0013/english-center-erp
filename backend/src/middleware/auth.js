// =====================================================================
// Нэвтрэлт (JWT) ба эрхийн шалгалт — бүх шалгалт сервер дээр
// =====================================================================
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/httpError.js';

export const STAFF = ['SUPER_ADMIN', 'BRANCH_ADMIN'];
export const STAFF_FINANCE = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'];
export const STAFF_TEACHER = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'TEACHER'];
export const ALL_STAFF = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE', 'TEACHER'];

export function signToken(user) {
  return jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function readToken(req) {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  // Файл татах холбоосод (<a href>) header явуулах боломжгүй тул query-г зөвшөөрнө
  if (typeof req.query?.token === 'string') return req.query.token;
  return null;
}

export async function authenticate(req, _res, next) {
  const token = readToken(req);
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized('Нэвтрэлтийн хугацаа дууссан эсвэл буруу token');
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    include: {
      role: true,
      teacher: { select: { id: true } },
      student: { select: { id: true } },
      parent: { select: { id: true } },
    },
  });
  if (!user || !user.isActive) throw unauthorized('Хэрэглэгч идэвхгүй байна');

  req.user = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role.code,
    branchId: user.branchId,
    teacherId: user.teacher?.id ?? null,
    studentId: user.student?.id ?? null,
    parentId: user.parent?.id ?? null,
  };
  next();
}

export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (!roles.flat().includes(req.user.role)) throw forbidden();
  next();
};
