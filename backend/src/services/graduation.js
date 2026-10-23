// =====================================================================
// M4 — Төгсөлтийн нэгдсэн шалгалт: ирц (M2) + дүн (M4) + төлбөр (M3)
// Ирц% = (Ирсэн + Хоцорсон) / (Болсон хичээл − Чөлөөтэй) × 100
// Эцсийн дүн = төгсөлтөд тооцох шалгалтуудын хувийн дундаж
// =====================================================================
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/httpError.js';
import { invoiceBalance } from '../lib/money.js';

const round2 = (n) => Math.round(n * 100) / 100;

export async function studentAttendancePercent(classId, studentId) {
  const held = await prisma.classSession.count({ where: { classId, status: 'COMPLETED' } });
  const rows = await prisma.attendance.groupBy({
    by: ['status'],
    where: { studentId, classSession: { classId, status: 'COMPLETED' } },
    _count: true,
  });
  const c = Object.fromEntries(rows.map((r) => [r.status, r._count]));
  const attended = (c.PRESENT ?? 0) + (c.LATE ?? 0);
  const denominator = held - (c.EXCUSED ?? 0);
  return {
    held,
    present: c.PRESENT ?? 0,
    late: c.LATE ?? 0,
    absent: c.ABSENT ?? 0,
    excused: c.EXCUSED ?? 0,
    percent: denominator > 0 ? round2((attended / denominator) * 100) : 0,
  };
}

export async function studentFinalScore(classId, studentId) {
  const exams = await prisma.exam.findMany({
    where: { classId, countsForGraduation: true },
    include: { results: { where: { studentId, publishedAt: { not: null } } } },
  });
  const details = exams.map((e) => {
    const r = e.results[0];
    return { examId: e.id, title: e.title, score: r ? Number(r.finalScore) : null, maxScore: Number(e.maxScore) };
  });
  const scored = details.filter((d) => d.score !== null);
  const missing = details.filter((d) => d.score === null);
  const percent = scored.length ? round2(scored.reduce((a, d) => a + (d.score / d.maxScore) * 100, 0) / scored.length) : null;
  return { exams: details, missing, percent };
}

export async function graduationCheck(enrollmentId) {
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { class: { include: { course: true } }, invoice: { include: { payments: true, refunds: true } }, certificate: true },
  });
  if (!e) throw notFound('Элсэлт олдсонгүй');
  const course = e.class.course;

  const attendance = await studentAttendancePercent(e.classId, e.studentId);
  const score = await studentFinalScore(e.classId, e.studentId);
  const balance = e.invoice ? invoiceBalance(e.invoice) : null;

  const reasons = [];
  if (!['CONFIRMED', 'COMPLETED'].includes(e.status)) reasons.push(`Элсэлт ${e.status} төлөвтэй`);
  if (attendance.percent < Number(course.minAttendancePercent)) {
    reasons.push(`Ирц ${attendance.percent}% < шаардлага ${course.minAttendancePercent}%`);
  }
  if (score.exams.length === 0) reasons.push('Төгсөлтөд тооцох шалгалт тохируулаагүй');
  else if (score.missing.length) reasons.push(`Дүн гараагүй шалгалт: ${score.missing.map((m) => m.title).join(', ')}`);
  else if (score.percent < Number(course.minFinalScore)) reasons.push(`Эцсийн дүн ${score.percent} < шаардлага ${course.minFinalScore}`);
  if (course.requireFullPayment) {
    if (!balance) reasons.push('Нэхэмжлэл үүсээгүй');
    else if (balance.balanceCents > 0) reasons.push(`Төлбөрийн үлдэгдэл ${balance.balance}₮`);
  }
  if (e.certificate?.status === 'ISSUED') reasons.push('Гэрчилгээ олгогдсон байна');

  return {
    enrollmentId,
    eligible: reasons.length === 0,
    reasons,
    requirements: {
      minAttendancePercent: Number(course.minAttendancePercent),
      minFinalScore: Number(course.minFinalScore),
      requireFullPayment: course.requireFullPayment,
    },
    attendance,
    score,
    balance: balance ? { total: balance.totalAmount, paid: balance.netPaid, balance: balance.balance } : null,
  };
}

// Ангийн бүх сурагчийн ирцийн нэгтгэл
export async function attendanceSummary(classId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { classId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
    include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } } },
  });
  return Promise.all(enrollments.map(async (e) => ({
    student: e.student,
    enrollmentId: e.id,
    ...(await studentAttendancePercent(classId, e.studentId)),
  })));
}
