// =====================================================================
// Мөнгөн дүн: бүх тооцоог мөнгөөр (₮ × 100) бүхэл тоогоор хийнэ,
// ингэснээр хөвөгч таслалын алдаа гарахгүй.
// =====================================================================

export const toCents = (value) => Math.round(Number(value ?? 0) * 100);
export const fromCents = (cents) => (cents / 100).toFixed(2);

export function sumCents(rows, field = 'amount') {
  return rows.reduce((acc, row) => acc + toCents(row[field]), 0);
}

// Нэхэмжлэлийн төлөгдсөн, буцаагдсан, үлдэгдэл дүн
export function invoiceBalance(invoice) {
  const paid = sumCents((invoice.payments ?? []).filter((p) => p.status === 'COMPLETED'));
  const refunded = sumCents(invoice.refunds ?? []);
  const total = toCents(invoice.totalAmount);
  const netPaid = paid - refunded;
  return {
    totalAmount: fromCents(total),
    paidAmount: fromCents(paid),
    refundedAmount: fromCents(refunded),
    netPaid: fromCents(netPaid),
    balance: fromCents(total - netPaid),
    balanceCents: total - netPaid,
    netPaidCents: netPaid,
  };
}

export function invoiceStatusFor(invoice) {
  if (invoice.status === 'CANCELLED') return 'CANCELLED';
  const { balanceCents, netPaidCents } = invoiceBalance(invoice);
  if (balanceCents <= 0) return 'PAID';
  if (netPaidCents > 0) return 'PARTIAL';
  return 'UNPAID';
}
