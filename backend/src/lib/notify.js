// Систем доторх мэдэгдэл (M7) — сурагч, эцэг эх, ажилтанд
import { prisma } from './prisma.js';

export async function notifyUsers(userIds, { title, body, link }, tx = prisma) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return;
  await tx.notification.createMany({
    data: ids.map((userId) => ({ userId, title, body: body ?? null, link: link ?? null })),
  });
}

// Сурагч болон түүний баталгаажсан эцэг эхийн user id-ууд
export async function studentAudienceUserIds(studentId, tx = prisma) {
  const student = await tx.student.findUnique({
    where: { id: studentId },
    select: {
      userId: true,
      parentLinks: { where: { verifiedAt: { not: null } }, select: { parent: { select: { userId: true } } } },
    },
  });
  if (!student) return [];
  return [student.userId, ...student.parentLinks.map((l) => l.parent.userId)];
}
