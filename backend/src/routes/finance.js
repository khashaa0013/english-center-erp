// =====================================================================
// M3 — Төлбөр ба санхүү: нэхэмжлэл, төлөлт, буцаалт, авлага, сануулга,
// зарлага, кассын тайлан, Excel импорт, багшийн хөлсний тооцоо
// =====================================================================
import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { fromCents, invoiceBalance, sumCents, toCents } from '../lib/money.js';
import { dateOnly, ubDateString, ubDayRange, ubDateTime } from '../lib/time.js';
import { notifyUsers, studentAudienceUserIds } from '../lib/notify.js';
import { readSheetRows, sendWorkbook } from '../lib/excel.js';
import { authorize, STAFF_FINANCE } from '../middleware/auth.js';
import { assertBranch, branchFilter, resolveBranchId } from '../middleware/scope.js';
import { absolutePath, storedPath, uploader } from '../middleware/upload.js';
import { idParam, validate, zDate, zId, zOptId, zOptStr, zPositiveMoney, zReason, zStr } from '../middleware/validate.js';
import { recordPayment, refreshInvoiceStatus } from '../services/payments.js';

const router = Router();
router.use(authorize(STAFF_FINANCE));

const METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'QPAY'];
const invoiceInclude = {
  enrollment: {
    select: {
      id: true, status: true,
      student: { select: { id: true, studentCode: true, lastName: true, firstName: true } },
      class: { select: { code: true, course: { select: { name: true } } } },
    },
  },
  payments: true,
  refunds: true,
};
const withBalance = (inv) => {
  const today = ubDateString(new Date());
  const b = invoiceBalance(inv);
  return { ...inv, ...b, overdue: ['UNPAID', 'PARTIAL'].includes(inv.status) && ubDateString(inv.dueDate) < today };
};

// ----- Нэхэмжлэл -----
router.get('/invoices', async (req, res) => {
  const { status, overdue, q } = req.query;
  const where = {
    ...branchFilter(req),
    ...(status ? { status } : {}),
    ...(overdue === '1' ? { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: dateOnly(ubDateString(new Date())) } } : {}),
    ...(q ? { OR: [{ invoiceNo: { contains: q } }, { enrollment: { student: { OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { studentCode: { contains: q } }] } } }] } : {}),
  };
  const items = await prisma.invoice.findMany({ where, include: invoiceInclude, orderBy: { id: 'desc' }, take: 1000 });
  res.json(items.map((i) => ({ ...withBalance(i), payments: undefined, refunds: undefined })));
});

router.get('/invoices/:id', async (req, res) => {
  const inv = await prisma.invoice.findUnique({
    where: { id: idParam(req) },
    include: {
      ...invoiceInclude,
      payments: { include: { receiver: { select: { displayName: true } } }, orderBy: { paidAt: 'asc' } },
      refunds: { include: { approver: { select: { displayName: true } } } },
      reminders: { include: { sender: { select: { displayName: true } } }, orderBy: { sentAt: 'desc' } },
      issuer: { select: { displayName: true } },
    },
  });
  if (!inv) throw notFound();
  assertBranch(req, inv.branchId);
  res.json(withBalance(inv));
});

router.put('/invoices/:id/due-date', validate(z.object({ dueDate: zDate, reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.invoice.findUnique({ where: { id } });
  if (!old) throw notFound();
  assertBranch(req, old.branchId);
  const inv = await prisma.invoice.update({ where: { id }, data: { dueDate: dateOnly(req.body.dueDate) } });
  await writeAudit(req, { action: 'UPDATE_DUE', entityType: 'Invoice', entityId: id, oldValues: { dueDate: old.dueDate }, newValues: { dueDate: inv.dueDate }, reason: req.body.reason, branchId: old.branchId });
  res.json(inv);
});

// Сануулга (систем доторх мэдэгдэл)
async function sendReminder(req, inv) {
  const b = invoiceBalance(inv);
  await notifyUsers(await studentAudienceUserIds(inv.enrollment.student.id), {
    title: `Төлбөрийн сануулга: ${inv.invoiceNo}`,
    body: `Үлдэгдэл ${Number(b.balance).toLocaleString()}₮, төлөх хугацаа ${ubDateString(inv.dueDate)}`,
    link: '/portal/payments',
  });
  await prisma.paymentReminder.create({ data: { invoiceId: inv.id, sentBy: req.user.id } });
}

router.post('/invoices/:id/remind', async (req, res) => {
  const inv = await prisma.invoice.findUnique({ where: { id: idParam(req) }, include: invoiceInclude });
  if (!inv) throw notFound();
  assertBranch(req, inv.branchId);
  if (!['UNPAID', 'PARTIAL'].includes(inv.status)) throw conflict('Үлдэгдэлгүй нэхэмжлэл');
  await sendReminder(req, inv);
  res.json({ ok: true });
});

router.post('/invoices/remind-overdue', async (req, res) => {
  const items = await prisma.invoice.findMany({
    where: { ...branchFilter(req), status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: dateOnly(ubDateString(new Date())) } },
    include: invoiceInclude,
  });
  for (const inv of items) await sendReminder(req, inv);
  await writeAudit(req, { action: 'REMIND_OVERDUE', entityType: 'Invoice', newValues: { count: items.length } });
  res.json({ sent: items.length });
});

// ----- Төлөлт -----
router.get('/payments', async (req, res) => {
  const { from, to, method, status } = req.query;
  const where = {
    ...branchFilter(req),
    ...(method ? { method } : {}),
    ...(status ? { status } : {}),
    ...(from || to ? { paidAt: { ...(from ? { gte: ubDayRange(from).start } : {}), ...(to ? { lt: ubDayRange(to).end } : {}) } } : {}),
  };
  res.json(await prisma.payment.findMany({
    where,
    include: {
      invoice: { select: { invoiceNo: true, enrollment: { select: { student: { select: { studentCode: true, lastName: true, firstName: true } } } } } },
      receiver: { select: { displayName: true } },
    },
    orderBy: { paidAt: 'desc' },
    take: 1000,
  }));
});

router.post(
  '/payments',
  validate(z.object({
    invoiceId: zId,
    amount: zPositiveMoney,
    method: z.enum(METHODS),
    referenceNo: zOptStr(100),
    paidAt: zDate.optional(),
    // Frontend товч дарах бүрт нэг түлхүүр үүсгэнэ — давтан илгээлтэд давхар төлөлт үүсэхгүй
    idempotencyKey: z.string().trim().min(8).max(100),
  })),
  async (req, res) => {
    const result = await recordPayment(req, {
      ...req.body,
      paidAt: req.body.paidAt ? ubDateTime(req.body.paidAt, '12:00') : new Date(),
      receivedBy: req.user.id,
      assertBranchFn: (branchId) => assertBranch(req, branchId),
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  },
);

router.post('/payments/:id/void', validate(z.object({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const result = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id }, include: { refunds: true } });
    if (!p) throw notFound();
    assertBranch(req, p.branchId);
    if (p.status === 'VOIDED') throw conflict('Аль хэдийн хүчингүй болсон');
    if (p.refunds.length) throw conflict('Буцаалт хийгдсэн төлөлтийг хүчингүй болгох боломжгүй');
    const voided = await tx.payment.update({ where: { id }, data: { status: 'VOIDED', voidReason: req.body.reason } });
    const inv = await refreshInvoiceStatus(tx, p.invoiceId);
    if (inv.balanceCents < 0) throw conflict('Хүчингүй болгосны дараа буцаалт төлөлтөөс их болно');
    await writeAudit(req, { action: 'VOID', entityType: 'Payment', entityId: id, oldValues: { status: p.status, amount: p.amount }, newValues: { status: 'VOIDED' }, reason: req.body.reason, branchId: p.branchId }, tx);
    return voided;
  });
  res.json(result);
});

// ----- Буцаалт (шалтгаан заавал, батлагч хадгалагдана) -----
router.post(
  '/refunds',
  authorize('SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'),
  validate(z.object({ invoiceId: zId, paymentId: zOptId, amount: zPositiveMoney, reason: zReason })),
  async (req, res) => {
    const { invoiceId, paymentId, amount, reason } = req.body;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: { include: { refunds: true } }, refunds: true } });
      if (!inv) throw notFound();
      assertBranch(req, inv.branchId);
      const cents = toCents(amount);
      const { netPaidCents } = invoiceBalance(inv);
      if (cents > netPaidCents) throw conflict(`Буцаах дүн төлөгдсөн дүнгээс (${fromCents(netPaidCents)}₮) их байна`);
      if (paymentId) {
        const p = inv.payments.find((x) => x.id === paymentId);
        if (!p || p.status !== 'COMPLETED') throw badRequest('Төлөлт энэ нэхэмжлэлийнх биш эсвэл хүчингүй');
        if (cents > toCents(p.amount) - sumCents(p.refunds)) throw conflict('Буцаах дүн тухайн төлөлтөөс их байна');
      }
      const refund = await tx.refund.create({ data: { invoiceId, paymentId: paymentId ?? null, amount: fromCents(cents), reason, approvedBy: req.user.id } });
      const updated = await refreshInvoiceStatus(tx, invoiceId);
      await writeAudit(req, { action: 'REFUND', entityType: 'Invoice', entityId: invoiceId, newValues: { refundId: refund.id, amount: refund.amount, balance: updated.balance }, reason, approvedBy: req.user.id, branchId: inv.branchId }, tx);
      return { refund, invoice: updated };
    });
    res.status(201).json(result);
  },
);

// ----- Авлага (хугацаа хэтрэлтийн шатлал) -----
router.get('/receivables', async (req, res) => {
  const items = await prisma.invoice.findMany({ where: { ...branchFilter(req), status: { in: ['UNPAID', 'PARTIAL'] } }, include: invoiceInclude });
  const today = new Date(`${ubDateString(new Date())}T00:00:00Z`);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0 };
  const rows = items.map((inv) => {
    const b = withBalance(inv);
    const days = Math.floor((today - inv.dueDate) / 86400000);
    const key = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : 'd60plus';
    buckets[key] += b.balanceCents;
    return { ...b, payments: undefined, refunds: undefined, overdueDays: Math.max(0, days) };
  });
  res.json({
    totals: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, fromCents(v)])),
    total: fromCents(Object.values(buckets).reduce((a, v) => a + v, 0)),
    rows: rows.sort((a, b) => b.overdueDays - a.overdueDays),
  });
});

// ----- Зарлага -----
const receiptUpload = uploader('receipts', 'document');
router.get('/expenses', async (req, res) => {
  const { from, to, category } = req.query;
  res.json(await prisma.expense.findMany({
    where: {
      ...branchFilter(req),
      ...(category ? { category } : {}),
      ...(from || to ? { spentOn: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } } : {}),
    },
    include: { creator: { select: { displayName: true } } },
    orderBy: { spentOn: 'desc' },
  }));
});

const expenseSchema = z.object({
  branchId: zOptId,
  category: zStr(100),
  amount: zPositiveMoney,
  description: zOptStr(500),
  spentOn: zDate,
});

router.post('/expenses', receiptUpload.single('receipt'), async (req, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Зарлагын мэдээлэл буруу', parsed.error.issues);
  const branchId = resolveBranchId(req, parsed.data.branchId);
  const { branchId: _b, spentOn, ...rest } = parsed.data;
  const exp = await prisma.expense.create({
    data: { ...rest, branchId, spentOn: dateOnly(spentOn), receiptPath: storedPath('receipts', req.file), createdBy: req.user.id },
  });
  await writeAudit(req, { action: 'CREATE', entityType: 'Expense', entityId: exp.id, newValues: exp, branchId });
  res.status(201).json(exp);
});

router.put('/expenses/:id', validate(expenseSchema.partial().extend({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.expense.findUnique({ where: { id } });
  if (!old) throw notFound();
  assertBranch(req, old.branchId);
  const { reason, branchId: _b, spentOn, ...rest } = req.body;
  const exp = await prisma.expense.update({ where: { id }, data: { ...rest, ...(spentOn ? { spentOn: dateOnly(spentOn) } : {}) } });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Expense', entityId: id, oldValues: old, newValues: exp, reason, branchId: old.branchId });
  res.json(exp);
});

// ----- Өдөр тутмын кассын тайлан -----
async function cashReport(req, date) {
  const { start, end } = ubDayRange(date);
  const bf = branchFilter(req);
  const [payments, refunds, expenses] = await Promise.all([
    prisma.payment.findMany({ where: { ...bf, status: 'COMPLETED', paidAt: { gte: start, lt: end } }, include: { invoice: { select: { invoiceNo: true } } } }),
    prisma.refund.findMany({ where: { invoice: bf, refundedAt: { gte: start, lt: end } }, include: { invoice: { select: { invoiceNo: true } } } }),
    prisma.expense.findMany({ where: { ...bf, spentOn: dateOnly(date) } }),
  ]);
  const byMethod = Object.fromEntries(METHODS.map((m) => [m, fromCents(sumCents(payments.filter((p) => p.method === m)))]));
  const income = sumCents(payments);
  const refunded = sumCents(refunds);
  const spent = sumCents(expenses);
  return {
    date,
    byMethod,
    income: fromCents(income),
    refunds: fromCents(refunded),
    expenses: fromCents(spent),
    net: fromCents(income - refunded - spent),
    cashNet: fromCents(toCents(byMethod.CASH) - refunded - spent),
    payments, refundRows: refunds, expenseRows: expenses,
  };
}

router.get('/cash-report', async (req, res) => {
  res.json(await cashReport(req, req.query.date ?? ubDateString(new Date())));
});

router.get('/cash-report/export', async (req, res) => {
  const date = req.query.date ?? ubDateString(new Date());
  const r = await cashReport(req, date);
  await sendWorkbook(res, `kass-${date}.xlsx`, [
    {
      name: 'Нэгтгэл',
      columns: [{ header: 'Үзүүлэлт', key: 'k', width: 24 }, { header: 'Дүн', key: 'v' }],
      rows: [
        ...Object.entries(r.byMethod).map(([k, v]) => ({ k: `Орлого: ${k}`, v: Number(v) })),
        { k: 'Нийт орлого', v: Number(r.income) },
        { k: 'Буцаалт', v: -Number(r.refunds) },
        { k: 'Зарлага', v: -Number(r.expenses) },
        { k: 'Цэвэр', v: Number(r.net) },
      ],
    },
    {
      name: 'Төлөлт',
      columns: [{ header: 'Нэхэмжлэл', key: 'inv' }, { header: 'Дүн', key: 'amount' }, { header: 'Төрөл', key: 'method' }, { header: 'Лавлах', key: 'ref' }],
      rows: r.payments.map((p) => ({ inv: p.invoice.invoiceNo, amount: Number(p.amount), method: p.method, ref: p.referenceNo })),
    },
  ]);
});

// ----- Excel импорт (банкны хуулга): урьдчилан харах → тулгалт → батлах -----
const excelUpload = uploader('imports', 'excel');
const IMPORT_COLUMNS = ['invoice_no', 'amount', 'method', 'reference_no', 'paid_at'];

router.get('/payment-imports/template', async (_req, res) => {
  await sendWorkbook(res, 'tolbor-import-zagvar.xlsx', [{
    name: 'Төлөлт',
    columns: IMPORT_COLUMNS.map((k) => ({ header: k, key: k, width: 20 })),
    rows: [{ invoice_no: 'INV2026-0001', amount: 200000, method: 'BANK_TRANSFER', reference_no: 'TXN123456', paid_at: '2026-10-23' }],
  }]);
});

router.get('/payment-imports', async (req, res) => {
  res.json(await prisma.paymentImport.findMany({ where: branchFilter(req), include: { creator: { select: { displayName: true } } }, orderBy: { id: 'desc' } }));
});

router.get('/payment-imports/:id', async (req, res) => {
  const imp = await prisma.paymentImport.findUnique({ where: { id: idParam(req) }, include: { rows: { orderBy: { rowNo: 'asc' } } } });
  if (!imp) throw notFound();
  assertBranch(req, imp.branchId);
  res.json(imp);
});

router.post('/payment-imports', excelUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Excel (.xlsx) файл сонгоно уу');
  const branchId = resolveBranchId(req, req.body.branchId);
  let raw;
  try {
    raw = await readSheetRows(req.file.path);
  } catch {
    throw badRequest('Excel файлыг уншиж чадсангүй');
  } finally {
    fs.rm(req.file.path, { force: true }, () => {});
  }
  if (!raw.length) throw badRequest('Файлд мөр алга');
  if (raw.length > 2000) throw badRequest('Нэг удаад 2000 мөрөөс ихгүй');

  const seenRefs = new Set();
  const pendingPerInvoice = new Map();
  const rows = [];
  for (const r of raw) {
    const row = { rowNo: r._row, invoiceNo: r.invoice_no ? String(r.invoice_no).trim() : null, referenceNo: r.reference_no ? String(r.reference_no).trim() : null };
    const errors = [];
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Дүн буруу');
    else row.amount = fromCents(toCents(amount));
    const method = String(r.method ?? 'BANK_TRANSFER').trim().toUpperCase();
    if (!METHODS.includes(method)) errors.push(`Төрөл буруу: ${method}`);
    else row.method = method;
    const paid = r.paid_at instanceof Date ? r.paid_at : r.paid_at ? new Date(`${String(r.paid_at).slice(0, 10)}T12:00:00+08:00`) : new Date();
    if (Number.isNaN(paid.getTime())) errors.push('Огноо буруу');
    else row.paidAt = paid;

    let status = 'VALID';
    if (!row.invoiceNo) errors.push('Нэхэмжлэлийн дугаар хоосон');
    else {
      const inv = await prisma.invoice.findUnique({ where: { invoiceNo: row.invoiceNo }, include: { payments: true, refunds: true } });
      if (!inv) errors.push('Нэхэмжлэл олдсонгүй');
      else if (inv.branchId !== branchId) errors.push('Өөр салбарын нэхэмжлэл');
      else if (inv.status === 'CANCELLED') errors.push('Цуцлагдсан нэхэмжлэл');
      else {
        row.invoiceId = inv.id;
        const pending = pendingPerInvoice.get(inv.id) ?? 0;
        if (row.amount && toCents(row.amount) + pending > invoiceBalance(inv).balanceCents) errors.push('Дүн үлдэгдлээс их');
        else if (row.amount) pendingPerInvoice.set(inv.id, pending + toCents(row.amount));
      }
    }
    // Давхардал: файл дотор болон өмнө бүртгэгдсэн лавлах дугаар
    if (row.referenceNo) {
      const key = row.referenceNo.toLowerCase();
      const inDb = await prisma.payment.findFirst({ where: { referenceNo: row.referenceNo, status: 'COMPLETED' } });
      if (seenRefs.has(key) || inDb) status = 'DUPLICATE';
      seenRefs.add(key);
    }
    if (errors.length) status = 'ERROR';
    rows.push({ ...row, status, message: errors.join('; ') || (status === 'DUPLICATE' ? 'Лавлах дугаар давхардсан' : null) });
  }

  const imp = await prisma.paymentImport.create({
    data: {
      branchId, fileName: req.file.originalname.slice(0, 255), createdBy: req.user.id,
      totalRows: rows.length, validRows: rows.filter((r) => r.status === 'VALID').length,
      rows: { create: rows },
    },
    include: { rows: { orderBy: { rowNo: 'asc' } } },
  });
  res.status(201).json(imp);
});

router.post('/payment-imports/:id/confirm', async (req, res) => {
  const id = idParam(req);
  const imp = await prisma.paymentImport.findUnique({ where: { id }, include: { rows: true } });
  if (!imp) throw notFound();
  assertBranch(req, imp.branchId);
  // Төлөвийг эхлээд солиод давтан батлахаас хамгаална
  const claimed = await prisma.paymentImport.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
  if (claimed.count === 0) throw conflict('Импорт аль хэдийн батлагдсан эсвэл цуцлагдсан');

  let imported = 0;
  const failed = [];
  for (const row of imp.rows.filter((r) => r.status === 'VALID')) {
    try {
      const r = await recordPayment(req, {
        invoiceId: row.invoiceId, amount: row.amount, method: row.method, referenceNo: row.referenceNo, paidAt: row.paidAt,
        idempotencyKey: row.referenceNo ? `import-ref:${row.referenceNo}` : `import:${id}:${row.rowNo}`,
        receivedBy: req.user.id,
      });
      await prisma.paymentImportRow.update({ where: { id: row.id }, data: { status: r.duplicate ? 'DUPLICATE' : 'IMPORTED' } });
      if (!r.duplicate) imported += 1;
    } catch (err) {
      failed.push({ rowNo: row.rowNo, message: err.message });
      await prisma.paymentImportRow.update({ where: { id: row.id }, data: { status: 'ERROR', message: err.message.slice(0, 500) } });
    }
  }
  await writeAudit(req, { action: 'IMPORT_CONFIRM', entityType: 'PaymentImport', entityId: id, newValues: { imported, failed: failed.length }, branchId: imp.branchId });
  res.json({ imported, failed });
});

router.post('/payment-imports/:id/cancel', async (req, res) => {
  const id = idParam(req);
  const imp = await prisma.paymentImport.findUnique({ where: { id } });
  if (!imp) throw notFound();
  assertBranch(req, imp.branchId);
  const r = await prisma.paymentImport.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'CANCELLED' } });
  if (!r.count) throw conflict('Зөвхөн урьдчилсан төлөвтэй импортыг цуцална');
  res.json({ ok: true });
});

// ----- Багшийн хөлсний тооцоо (M6 баталсан цагаас) -----
router.get('/payouts', async (req, res) => {
  res.json(await prisma.teacherPayout.findMany({
    where: { ...branchFilter(req), ...(req.query.teacherId ? { teacherId: Number(req.query.teacherId) } : {}) },
    include: { teacher: { select: { id: true, teacherCode: true, lastName: true, firstName: true } }, creator: { select: { displayName: true } }, _count: { select: { hours: true } } },
    orderBy: { id: 'desc' },
  }));
});

router.get('/payouts/:id', async (req, res) => {
  const p = await prisma.teacherPayout.findUnique({
    where: { id: idParam(req) },
    include: {
      teacher: true,
      hours: { include: { classSession: { select: { startsAt: true, class: { select: { code: true } } } }, rate: true }, orderBy: { classSession: { startsAt: 'asc' } } },
    },
  });
  if (!p) throw notFound();
  assertBranch(req, p.branchId);
  res.json(p);
});

// Зөвхөн баталгаажсан, өмнө тооцоонд ороогүй цаг орно
router.post('/payouts', validate(z.object({ teacherId: zId, periodStart: zDate, periodEnd: zDate })), async (req, res) => {
  const { teacherId, periodStart, periodEnd } = req.body;
  if (periodStart > periodEnd) throw badRequest('Хугацааны хүрээ буруу');
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher) throw notFound('Багш олдсонгүй');
  assertBranch(req, teacher.branchId);

  const payout = await prisma.$transaction(async (tx) => {
    const hours = await tx.teachingHour.findMany({
      where: {
        teacherId, status: 'APPROVED', payoutId: null,
        classSession: { startsAt: { gte: ubDayRange(periodStart).start, lt: ubDayRange(periodEnd).end } },
      },
    });
    if (!hours.length) throw conflict('Тухайн хугацаанд тооцоонд орох баталгаажсан цаг алга');
    const p = await tx.teacherPayout.create({
      data: {
        branchId: teacher.branchId, teacherId, periodStart: dateOnly(periodStart), periodEnd: dateOnly(periodEnd),
        totalMinutes: hours.reduce((a, h) => a + h.actualMinutes, 0),
        totalAmount: fromCents(sumCents(hours)),
        createdBy: req.user.id,
      },
    });
    const linked = await tx.teachingHour.updateMany({ where: { id: { in: hours.map((h) => h.id) }, payoutId: null }, data: { payoutId: p.id } });
    if (linked.count !== hours.length) throw conflict('Зарим цаг өөр тооцоонд орсон байна. Дахин оролдоно уу');
    return p;
  });
  await writeAudit(req, { action: 'CREATE', entityType: 'TeacherPayout', entityId: payout.id, newValues: payout, branchId: payout.branchId });
  res.status(201).json(payout);
});

router.post('/payouts/:id/approve', authorize('SUPER_ADMIN', 'BRANCH_ADMIN'), async (req, res) => {
  const id = idParam(req);
  const p = await prisma.teacherPayout.findUnique({ where: { id } });
  if (!p) throw notFound();
  assertBranch(req, p.branchId);
  const r = await prisma.teacherPayout.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'APPROVED' } });
  if (!r.count) throw conflict('Зөвхөн ноорог тооцоог батална');
  await writeAudit(req, { action: 'APPROVE', entityType: 'TeacherPayout', entityId: id, approvedBy: req.user.id, branchId: p.branchId });
  res.json({ ok: true });
});

// Олгосон хөлс зарлагад автоматаар бүртгэгдэнэ
router.post('/payouts/:id/pay', async (req, res) => {
  const id = idParam(req);
  const p = await prisma.teacherPayout.findUnique({ where: { id }, include: { teacher: true } });
  if (!p) throw notFound();
  assertBranch(req, p.branchId);
  await prisma.$transaction(async (tx) => {
    const r = await tx.teacherPayout.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date() } });
    if (!r.count) throw conflict('Зөвхөн батлагдсан тооцоог олгоно');
    await tx.expense.create({
      data: {
        branchId: p.branchId, category: 'Багшийн хөлс', amount: p.totalAmount,
        description: `${p.teacher.lastName} ${p.teacher.firstName}: ${ubDateString(p.periodStart)} — ${ubDateString(p.periodEnd)} (тооцоо #${id})`,
        spentOn: dateOnly(ubDateString(new Date())), createdBy: req.user.id,
      },
    });
  });
  await writeAudit(req, { action: 'PAY', entityType: 'TeacherPayout', entityId: id, newValues: { amount: p.totalAmount }, branchId: p.branchId });
  res.json({ ok: true });
});

router.post('/payouts/:id/cancel', authorize('SUPER_ADMIN', 'BRANCH_ADMIN'), validate(z.object({ reason: zReason })), async (req, res) => {
  const id = idParam(req);
  const p = await prisma.teacherPayout.findUnique({ where: { id } });
  if (!p) throw notFound();
  assertBranch(req, p.branchId);
  if (p.status === 'PAID') throw conflict('Олгосон тооцоог цуцлах боломжгүй');
  await prisma.$transaction([
    prisma.teachingHour.updateMany({ where: { payoutId: id }, data: { payoutId: null } }),
    prisma.teacherPayout.delete({ where: { id } }),
  ]);
  await writeAudit(req, { action: 'CANCEL', entityType: 'TeacherPayout', entityId: id, oldValues: p, reason: req.body.reason, branchId: p.branchId });
  res.json({ ok: true });
});

// Баримтын файл (зарлагын баримт)
router.get('/expenses/:id/receipt', async (req, res) => {
  const exp = await prisma.expense.findUnique({ where: { id: idParam(req) } });
  if (!exp?.receiptPath) throw notFound();
  assertBranch(req, exp.branchId);
  res.download(absolutePath(exp.receiptPath));
});

export default router;
