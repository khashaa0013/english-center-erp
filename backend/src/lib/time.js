// =====================================================================
// Цагийн бүс: Asia/Ulaanbaatar (UTC+8, зуны цаг хэрэглэдэггүй)
// DB-д бүх DateTime UTC-ээр хадгалагдана.
// =====================================================================

export const UB_OFFSET_MINUTES = 8 * 60;

// "2026-10-23" + "18:30" (УБ цаг) -> UTC Date
export function ubDateTime(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00+08:00`);
}

// UTC Date -> УБ-ын "YYYY-MM-DD"
export function ubDateString(date) {
  const d = new Date(date.getTime() + UB_OFFSET_MINUTES * 60000);
  return d.toISOString().slice(0, 10);
}

// УБ-ын долоо хоногийн өдөр: 1 = Даваа ... 7 = Ням
export function ubDayOfWeek(date) {
  const d = new Date(date.getTime() + UB_OFFSET_MINUTES * 60000);
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

// УБ-ын өдрийн эхлэл ба төгсгөл (UTC Date)
export function ubDayRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

// Prisma @db.Date талбарт "YYYY-MM-DD" хадгалах
export function dateOnly(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

export function minutesBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

// "HH:MM" хоёр интервал давхцаж байгаа эсэх
export function timeOverlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
