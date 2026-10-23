// =====================================================================
// Өгөгдөлд хандах эрх: сурагч өөрийгөө, эцэг эх баталгаажсан хүүхдээ,
// багш өөрийн ангийг, ажилтан өөрийн салбарыг л харна.
// =====================================================================
import { prisma } from './prisma.js';
import { forbidden, notFound } from './httpError.js';

export async function assertStudentAccess(req, studentId) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, branchId: true } });
  if (!student) throw notFound('Сурагч олдсонгүй');
  const { role } = req.user;

  if (role === 'SUPER_ADMIN') return student;
  if (role === 'STUDENT') {
    if (req.user.studentId !== studentId) throw forbidden('Өөр сурагчийн мэдээлэлд хандах эрхгүй');
    return student;
  }
  if (role === 'PARENT') {
    const link = await prisma.parentStudent.findFirst({
      where: { parentId: req.user.parentId, studentId, verifiedAt: { not: null } },
    });
    if (!link) throw forbidden('Энэ хүүхэд таны бүртгэлтэй баталгаажаагүй байна');
    return student;
  }
  if (student.branchId !== req.user.branchId) throw forbidden('Өөр салбарын мэдээлэлд хандах эрхгүй');
  return student;
}

// Анги: ажилтан салбараараа, багш өөрийн ангиа, сурагч элссэн ангиа
export async function assertClassAccess(req, classId, { write = false } = {}) {
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls) throw notFound('Анги олдсонгүй');
  const { role } = req.user;

  if (role === 'SUPER_ADMIN') return cls;
  if (role === 'BRANCH_ADMIN' || role === 'FINANCE') {
    if (cls.branchId !== req.user.branchId) throw forbidden('Өөр салбарын анги');
    if (write && role === 'FINANCE') throw forbidden();
    return cls;
  }
  if (role === 'TEACHER') {
    if (cls.teacherId === req.user.teacherId) return cls;
    const taught = await prisma.classSession.findFirst({ where: { classId, teacherId: req.user.teacherId } });
    if (taught) return cls;
    throw forbidden('Энэ анги таных биш');
  }
  if (write) throw forbidden();
  if (role === 'STUDENT') {
    const enr = await prisma.enrollment.findFirst({
      where: { classId, studentId: req.user.studentId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
    });
    if (!enr) throw forbidden('Та энэ ангид элсээгүй байна');
    return cls;
  }
  if (role === 'PARENT') {
    const enr = await prisma.enrollment.findFirst({
      where: {
        classId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        student: { parentLinks: { some: { parentId: req.user.parentId, verifiedAt: { not: null } } } },
      },
    });
    if (!enr) throw forbidden();
    return cls;
  }
  throw forbidden();
}

// Эцэг эхийн баталгаажсан хүүхдүүдийн id
export async function parentChildIds(parentId) {
  const links = await prisma.parentStudent.findMany({
    where: { parentId, verifiedAt: { not: null } },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}
