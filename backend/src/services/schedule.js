// =====================================================================
// M4 — Хуваарийн зөрчлийн хяналт: багш, танхим, анги, салбарын цаг
// =====================================================================
import { prisma } from '../lib/prisma.js';
import { conflict } from '../lib/httpError.js';
import { timeOverlaps } from '../lib/time.js';

const DAY = ['', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням'];

// Долоо хоногийн хуваарь: ангийн хугацаа давхцаж буй бусад хуваарьтай тулгана
export async function assertScheduleFree({ classId, teacherId, classroomId, dayOfWeek, startTime, endTime, excludeId }, tx = prisma) {
  if (startTime >= endTime) throw conflict('Эхлэх цаг дуусах цагаас өмнө байна');
  const cls = await tx.class.findUnique({ where: { id: classId } });

  const others = await tx.schedule.findMany({
    where: {
      dayOfWeek,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      OR: [{ teacherId }, { classroomId }, { classId }],
      class: {
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        startDate: { lte: cls.endDate },
        endDate: { gte: cls.startDate },
      },
    },
    include: { class: { select: { code: true } }, classroom: { select: { name: true } } },
  });

  const clashes = others.filter((s) => timeOverlaps(startTime, endTime, s.startTime, s.endTime)).map((s) => ({
    scheduleId: s.id,
    class: s.class.code,
    classroom: s.classroom.name,
    time: `${DAY[s.dayOfWeek]} ${s.startTime}-${s.endTime}`,
    reason: s.classId === classId ? 'CLASS' : s.teacherId === teacherId ? 'TEACHER' : 'CLASSROOM',
  }));
  if (clashes.length) throw conflict('Хуваарь давхцаж байна', { clashes });

  // Багш боломжит цагаа бүртгүүлсэн бол тэр хүрээнд багтах ёстой (M6)
  const availability = await tx.teacherAvailability.findMany({ where: { teacherId, dayOfWeek } });
  const anyAvailability = await tx.teacherAvailability.count({ where: { teacherId } });
  if (anyAvailability > 0 && !availability.some((a) => a.startTime <= startTime && endTime <= a.endTime)) {
    throw conflict(`Багш ${DAY[dayOfWeek]} гаригт ${startTime}-${endTime} цагт боломжгүй гэж бүртгэлтэй`);
  }

  const room = await tx.classroom.findUnique({ where: { id: classroomId } });
  if (!room?.isActive) throw conflict('Танхим идэвхгүй байна');
  if (room.branchId !== cls.branchId) throw conflict('Танхим өөр салбарынх байна');
  if (room.capacity < cls.capacity) throw conflict(`Танхимын багтаамж (${room.capacity}) ангийн хүчин чадлаас (${cls.capacity}) бага`);
}

// Тодорхой хичээл (огноо, цаг): бусад хичээлтэй багш эсвэл танхимаар давхцах эсэх
export async function assertSessionFree({ teacherId, classroomId, startsAt, endsAt, excludeId }, tx = prisma) {
  if (startsAt >= endsAt) throw conflict('Эхлэх цаг дуусах цагаас өмнө байна');
  const clash = await tx.classSession.findMany({
    where: {
      status: { not: 'CANCELLED' },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      OR: [{ teacherId }, { classroomId }],
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    include: { class: { select: { code: true } } },
    take: 5,
  });
  if (clash.length) {
    throw conflict('Хичээлийн цаг давхцаж байна', {
      clashes: clash.map((c) => ({ sessionId: c.id, class: c.class.code, startsAt: c.startsAt, reason: c.teacherId === teacherId ? 'TEACHER' : 'CLASSROOM' })),
    });
  }
}
