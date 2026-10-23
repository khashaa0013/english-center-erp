// =====================================================================
// Дугаар үүсгэгч: ST2026-0001, INV2026-0001 гэх мэт.
// Давхцвал unique constraint алдаа өгнө; дуудагч дахин оролдоно.
// =====================================================================
import crypto from 'node:crypto';

export async function nextCode(delegate, field, prefix) {
  const year = new Date().getFullYear();
  const base = `${prefix}${year}-`;
  const last = await delegate.findFirst({
    where: { [field]: { startsWith: base } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });
  const lastNo = last ? Number(last[field].slice(base.length)) : 0;
  return `${base}${String(lastNo + 1).padStart(4, '0')}`;
}

export const randomCode = (bytes = 8) => crypto.randomBytes(bytes).toString('hex').toUpperCase();

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
