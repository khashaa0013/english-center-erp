// =====================================================================
// M3 — Төлөлт бүртгэх нийтлэг логик (гараар, Excel импорт, QPay)
// idempotencyKey давхцвал шинэ төлөлт үүсэхгүй, өмнөхийг буцаана.
// =====================================================================
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { fromCents, invoiceBalance, invoiceStatusFor, toCents } from '../lib/money.js';
import { notifyUsers, studentAudienceUserIds } from '../lib/notify.js';

export async function refreshInvoiceStatus(tx, invoiceId) {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, refunds: true } });
  const status = invoiceStatusFor(inv);
  if (status !== inv.status) await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  return { ...inv, status, ...invoiceBalance(inv) };
}

export async function recordPayment(req, { invoiceId, amount, method, referenceNo, paidAt, idempotencyKey, receivedBy, assertBranchFn }) {
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing) return { duplicate: true, payment: existing };

  const cents = toCents(amount);
  if (cents <= 0) throw badRequest('Төлөх дүн 0-ээс их байна');

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
    // Түгжээ авсны дараа дахин шалгана (зэрэг ирсэн ижил хүсэлт)
    const again = await tx.payment.findUnique({ where: { idempotencyKey } });
    if (again) return { duplicate: true, payment: again };

    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, refunds: true, enrollment: true } });
    if (!inv) throw notFound('Нэхэмжлэл олдсонгүй');
    if (assertBranchFn) assertBranchFn(inv.branchId);
    if (inv.status === 'CANCELLED') throw conflict('Цуцлагдсан нэхэмжлэл');
    const { balanceCents } = invoiceBalance(inv);
    if (cents > balanceCents) throw conflict(`Төлөх дүн үлдэгдлээс (${fromCents(balanceCents)}₮) их байна`);

    const payment = await tx.payment.create({
      data: {
        invoiceId, branchId: inv.branchId, amount: fromCents(cents), method,
        idempotencyKey, referenceNo: referenceNo ?? null, paidAt: paidAt ?? new Date(), receivedBy,
      },
    });
    const updated = await refreshInvoiceStatus(tx, invoiceId);
    await writeAudit(req, { action: 'PAYMENT', entityType: 'Invoice', entityId: invoiceId, newValues: { paymentId: payment.id, amount: payment.amount, method, balance: updated.balance }, branchId: inv.branchId }, tx);
    return { duplicate: false, payment, invoice: updated, studentId: inv.enrollment.studentId };
  });

  if (!result.duplicate) {
    await notifyUsers(await studentAudienceUserIds(result.studentId), {
      title: 'Төлбөр хүлээн авлаа',
      body: `${Number(result.payment.amount).toLocaleString()}₮. Үлдэгдэл: ${Number(result.invoice.balance).toLocaleString()}₮`,
      link: '/portal/payments',
    });
  }
  return result;
}
