// =====================================================================
// M7 — Нэгдсэн тайлан ба Excel экспорт
// Захирал бүх салбарыг (салбараар задлан), салбарын админ өөрийнхийг харна.
// =====================================================================
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { fromCents, invoiceBalance, sumCents } from '../lib/money.js';
import { dateOnly, ubDateString, ubDayRange } from '../lib/time.js';
import { sendWorkbook } from '../lib/excel.js';
import { authorize } from '../middleware/auth.js';
import { branchFilter } from '../middleware/scope.js';

const router = Router();
router.use(authorize('SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'));

function period(req) {
  const today = ubDateString(new Date());
  const from = req.query.from ?? `${today.slice(0, 8)}01`;
  const to = req.query.to ?? today;
  return { from, to, range: { gte: ubDayRange(from).start, lt: ubDayRange(to).end } };
}

async function branchSummary(branchId, { from, to, range }) {
  const bf = branchId ? { branchId } : {};
  const [students, newEnrollments, activeEnrollments, payments, refunds, expenses, openInvoices, attendance, hours, leads] = await Promise.all([
    prisma.student.count({ where: { ...bf, status: 'ACTIVE' } }),
    prisma.enrollment.count({ where: { ...bf, confirmedAt: range } }),
    prisma.enrollment.count({ where: { ...bf, status: 'CONFIRMED' } }),
    prisma.payment.findMany({ where: { ...bf, status: 'COMPLETED', paidAt: range }, select: { amount: true } }),
    prisma.refund.findMany({ where: { invoice: bf, refundedAt: range }, select: { amount: true } }),
    prisma.expense.findMany({ where: { ...bf, spentOn: { gte: dateOnly(from), lte: dateOnly(to) } }, select: { amount: true } }),
    prisma.invoice.findMany({ where: { ...bf, status: { in: ['UNPAID', 'PARTIAL'] } }, include: { payments: true, refunds: true } }),
    prisma.attendance.groupBy({ by: ['status'], where: { classSession: { startsAt: range, class: bf } }, _count: true }),
    prisma.teachingHour.findMany({ where: { teacher: bf, classSession: { startsAt: range } }, select: { actualMinutes: true, status: true, amount: true } }),
    prisma.lead.groupBy({ by: ['status'], where: { ...bf, createdAt: range }, _count: true }),
  ]);
  const att = Object.fromEntries(attendance.map((a) => [a.status, a._count]));
  const attTotal = Object.values(att).reduce((a, b) => a + b, 0) - (att.EXCUSED ?? 0);
  const today = ubDateString(new Date());
  const receivable = openInvoices.reduce((a, i) => a + invoiceBalance(i).balanceCents, 0);
  const overdue = openInvoices.filter((i) => ubDateString(i.dueDate) < today).reduce((a, i) => a + invoiceBalance(i).balanceCents, 0);
  const income = sumCents(payments);
  const refunded = sumCents(refunds);
  const spent = sumCents(expenses);
  return {
    students,
    activeEnrollments,
    newEnrollments,
    leads: Object.fromEntries(leads.map((l) => [l.status, l._count])),
    income: fromCents(income),
    refunds: fromCents(refunded),
    expenses: fromCents(spent),
    net: fromCents(income - refunded - spent),
    receivable: fromCents(receivable),
    overdue: fromCents(overdue),
    attendance: { ...att, rate: attTotal > 0 ? Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / attTotal) * 1000) / 10 : null },
    teacherMinutes: hours.reduce((a, h) => a + h.actualMinutes, 0),
    teacherApprovedAmount: fromCents(sumCents(hours.filter((h) => h.status === 'APPROVED'))),
    pendingHours: hours.filter((h) => h.status === 'PENDING').length,
  };
}

router.get('/dashboard', async (req, res) => {
  const p = period(req);
  const filter = branchFilter(req);
  const branches = await prisma.branch.findMany({ where: filter.branchId ? { id: filter.branchId } : {}, orderBy: { id: 'asc' } });
  const perBranch = await Promise.all(branches.map(async (b) => ({ branch: { id: b.id, name: b.name }, ...(await branchSummary(b.id, p)) })));
  const total = filter.branchId ? perBranch[0] : { branch: { id: null, name: 'Бүх салбар' }, ...(await branchSummary(null, p)) };
  res.json({ from: p.from, to: p.to, total, perBranch });
});

// Багшийн ачааллын тайлан
router.get('/teacher-load', async (req, res) => {
  const p = period(req);
  const teachers = await prisma.teacher.findMany({
    where: branchFilter(req),
    include: {
      sessions: { where: { startsAt: p.range }, select: { status: true, startsAt: true, endsAt: true } },
      hours: { where: { classSession: { startsAt: p.range } }, select: { actualMinutes: true, status: true, amount: true } },
    },
  });
  res.json(teachers.map((t) => ({
    id: t.id, teacherCode: t.teacherCode, name: `${t.lastName} ${t.firstName}`,
    plannedSessions: t.sessions.filter((s) => s.status !== 'CANCELLED').length,
    completedSessions: t.sessions.filter((s) => s.status === 'COMPLETED').length,
    actualMinutes: t.hours.reduce((a, h) => a + h.actualMinutes, 0),
    approvedMinutes: t.hours.filter((h) => h.status === 'APPROVED').reduce((a, h) => a + h.actualMinutes, 0),
    approvedAmount: fromCents(sumCents(t.hours.filter((h) => h.status === 'APPROVED'))),
  })));
});

// ----- Excel экспорт -----
const EXPORTS = {
  students: async (req) => {
    const rows = await prisma.student.findMany({ where: branchFilter(req), include: { currentLevel: true, branch: true, parentLinks: { include: { parent: true } } }, orderBy: { id: 'asc' } });
    return {
      name: 'Сурагчид',
      columns: [
        { header: 'Код', key: 'code' }, { header: 'Овог', key: 'last' }, { header: 'Нэр', key: 'first' }, { header: 'Утас', key: 'phone' },
        { header: 'Түвшин', key: 'level' }, { header: 'Төлөв', key: 'status' }, { header: 'Салбар', key: 'branch' }, { header: 'Эцэг эх', key: 'parents', width: 30 },
      ],
      rows: rows.map((s) => ({
        code: s.studentCode, last: s.lastName, first: s.firstName, phone: s.phone, level: s.currentLevel?.code, status: s.status, branch: s.branch.name,
        parents: s.parentLinks.map((l) => `${l.parent.firstName} ${l.parent.phone}`).join(', '),
      })),
    };
  },
  payments: async (req) => {
    const { range } = period(req);
    const rows = await prisma.payment.findMany({
      where: { ...branchFilter(req), paidAt: range },
      include: { invoice: { include: { enrollment: { include: { student: true } } } }, receiver: true },
      orderBy: { paidAt: 'asc' },
    });
    return {
      name: 'Төлөлт',
      columns: [
        { header: 'Огноо', key: 'date' }, { header: 'Нэхэмжлэл', key: 'inv' }, { header: 'Сурагч', key: 'student', width: 25 }, { header: 'Дүн', key: 'amount' },
        { header: 'Төрөл', key: 'method' }, { header: 'Лавлах', key: 'ref' }, { header: 'Төлөв', key: 'status' }, { header: 'Хүлээн авсан', key: 'by' },
      ],
      rows: rows.map((p) => ({
        date: ubDateString(p.paidAt), inv: p.invoice.invoiceNo, student: `${p.invoice.enrollment.student.lastName} ${p.invoice.enrollment.student.firstName}`,
        amount: Number(p.amount), method: p.method, ref: p.referenceNo, status: p.status, by: p.receiver.displayName,
      })),
    };
  },
  receivables: async (req) => {
    const rows = await prisma.invoice.findMany({ where: { ...branchFilter(req), status: { in: ['UNPAID', 'PARTIAL'] } }, include: { payments: true, refunds: true, enrollment: { include: { student: true, class: true } } } });
    return {
      name: 'Авлага',
      columns: [
        { header: 'Нэхэмжлэл', key: 'inv' }, { header: 'Сурагч', key: 'student', width: 25 }, { header: 'Анги', key: 'cls' }, { header: 'Нийт', key: 'total' },
        { header: 'Төлсөн', key: 'paid' }, { header: 'Үлдэгдэл', key: 'balance' }, { header: 'Хугацаа', key: 'due' },
      ],
      rows: rows.map((i) => {
        const b = invoiceBalance(i);
        return { inv: i.invoiceNo, student: `${i.enrollment.student.lastName} ${i.enrollment.student.firstName}`, cls: i.enrollment.class.code, total: Number(b.totalAmount), paid: Number(b.netPaid), balance: Number(b.balance), due: ubDateString(i.dueDate) };
      }),
    };
  },
  attendance: async (req) => {
    const { range } = period(req);
    const rows = await prisma.attendance.findMany({
      where: { classSession: { startsAt: range, class: branchFilter(req) } },
      include: { student: true, classSession: { include: { class: true } } },
      orderBy: { classSession: { startsAt: 'asc' } },
    });
    return {
      name: 'Ирц',
      columns: [
        { header: 'Огноо', key: 'date' }, { header: 'Анги', key: 'cls' }, { header: 'Сурагч', key: 'student', width: 25 },
        { header: 'Төлөв', key: 'status' }, { header: 'Арга', key: 'method' }, { header: 'Хоцролт (мин)', key: 'late' },
      ],
      rows: rows.map((a) => ({ date: ubDateString(a.classSession.startsAt), cls: a.classSession.class.code, student: `${a.student.lastName} ${a.student.firstName}`, status: a.status, method: a.method, late: a.lateMinutes })),
    };
  },
  'teacher-hours': async (req) => {
    const { range } = period(req);
    const rows = await prisma.teachingHour.findMany({
      where: { teacher: branchFilter(req), classSession: { startsAt: range } },
      include: { teacher: true, classSession: { include: { class: true } }, rate: true },
      orderBy: { classSession: { startsAt: 'asc' } },
    });
    return {
      name: 'Багшийн цаг',
      columns: [
        { header: 'Огноо', key: 'date' }, { header: 'Багш', key: 'teacher', width: 22 }, { header: 'Анги', key: 'cls' }, { header: 'Төлөвлөсөн (мин)', key: 'planned' },
        { header: 'Бодит (мин)', key: 'actual' }, { header: 'Төлөв', key: 'status' }, { header: 'Тариф', key: 'rate' }, { header: 'Дүн', key: 'amount' },
      ],
      rows: rows.map((h) => ({
        date: ubDateString(h.classSession.startsAt), teacher: `${h.teacher.lastName} ${h.teacher.firstName}`, cls: h.classSession.class.code,
        planned: h.plannedMinutes, actual: h.actualMinutes, status: h.status, rate: h.rate ? Number(h.rate.hourlyRate) : null, amount: h.amount ? Number(h.amount) : null,
      })),
    };
  },
};

router.get('/export/:kind', async (req, res) => {
  const build = EXPORTS[req.params.kind];
  if (!build) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Тайлангийн төрөл олдсонгүй' } });
  const sheet = await build(req);
  await sendWorkbook(res, `${req.params.kind}-${ubDateString(new Date())}.xlsx`, [sheet]);
});

export default router;
