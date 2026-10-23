// =====================================================================
// Формат ба монгол шошго
// =====================================================================
const UB = 'Asia/Ulaanbaatar';

export const money = (v) => (v === null || v === undefined || v === '' ? '—' : `${Number(v).toLocaleString('mn-MN', { maximumFractionDigits: 2 })}₮`);

export const date = (v) => (v ? new Date(v).toLocaleDateString('sv-SE', { timeZone: UB }) : '—');
// @db.Date талбар UTC шөнө дундаар хадгалагддаг тул UTC-ээр уншина
export const dateOnly = (v) => (v ? String(v).slice(0, 10) : '—');
export const time = (v) => (v ? new Date(v).toLocaleTimeString('en-GB', { timeZone: UB, hour: '2-digit', minute: '2-digit' }) : '');
export const dateTime = (v) => (v ? `${date(v)} ${time(v)}` : '—');

export const todayUb = () => new Date().toLocaleDateString('sv-SE', { timeZone: UB });
export const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
// <input type="datetime-local"> утга (УБ цаг)
export const toLocalInput = (v) => (v ? `${date(v)}T${time(v)}` : '');

export const DAYS = ['', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням'];

export const ROLE = {
  SUPER_ADMIN: 'Захирал', BRANCH_ADMIN: 'Салбарын админ', FINANCE: 'Санхүү', TEACHER: 'Багш', STUDENT: 'Сурагч', PARENT: 'Эцэг эх',
};

export const LABEL = {
  // Lead
  NEW: 'Шинэ', CONTACTED: 'Холбогдсон', PLACEMENT_TEST: 'Түвшин тогтоох', CONVERTED: 'Сурагч болсон', LOST: 'Алдсан',
  WALK_IN: 'Биечлэн', PHONE: 'Утсаар', WEB_FORM: 'Веб маягт', FACEBOOK: 'Facebook', REFERRAL: 'Санал болгосон',
  // Student / teacher
  ACTIVE: 'Идэвхтэй', INACTIVE: 'Идэвхгүй', GRADUATED: 'Төгссөн', MALE: 'Эрэгтэй', FEMALE: 'Эмэгтэй',
  MOTHER: 'Ээж', FATHER: 'Аав', GUARDIAN: 'Асран хамгаалагч',
  // Enrollment
  PENDING: 'Хүлээгдэж буй', CONFIRMED: 'Баталгаажсан', CANCELLED: 'Цуцлагдсан', COMPLETED: 'Дууссан', TRANSFERRED: 'Шилжсэн',
  DRAFT: 'Ноорог', SIGNED: 'Гарын үсэг зурсан',
  // Class / session
  PLANNED: 'Төлөвлөсөн', OPEN: 'Элсэлт авч буй', IN_PROGRESS: 'Явагдаж буй', SCHEDULED: 'Товлогдсон',
  // Attendance
  PRESENT: 'Ирсэн', LATE: 'Хоцорсон', ABSENT: 'Тасалсан', EXCUSED: 'Чөлөөтэй', QR: 'QR', MANUAL: 'Гараар',
  // Finance
  UNPAID: 'Төлөөгүй', PARTIAL: 'Хэсэгчлэн', PAID: 'Төлсөн', VOIDED: 'Хүчингүй',
  CASH: 'Бэлэн', BANK_TRANSFER: 'Шилжүүлэг', CARD: 'Карт', QPAY: 'QPay',
  APPROVED: 'Батлагдсан', REJECTED: 'Татгалзсан',
  PREVIEW: 'Урьдчилсан', VALID: 'Зөв', DUPLICATE: 'Давхардсан', ERROR: 'Алдаатай', IMPORTED: 'Орсон',
  // Assessment
  SUBMITTED: 'Илгээсэн', GRADED: 'Дүгнэсэн', RETURNED: 'Засварт буцаасан', EXPIRED: 'Хугацаа дууссан',
  QUIZ: 'Сорил', MIDTERM: 'Явцын', FINAL: 'Төгсөлтийн',
  MULTIPLE_CHOICE: 'Сонгох', WRITING: 'Бичгийн', SPEAKING: 'Ярианы',
  FILE: 'Файл', TEXT: 'Бичвэр', AUDIO: 'Аудио', PDF: 'PDF', LINK: 'Холбоос', OTHER: 'Бусад',
  LISTENING: 'Сонсох', READING: 'Унших',
  ISSUED: 'Олгосон', REVOKED: 'Хүчингүй',
  // Requests
  LEAVE: 'Чөлөө', INQUIRY: 'Лавлагаа', IN_REVIEW: 'Хянаж байна', RESOLVED: 'Шийдвэрлэсэн',
};
export const label = (v) => LABEL[v] ?? v ?? '—';

export const TONE = {
  good: ['CONFIRMED', 'PAID', 'PRESENT', 'APPROVED', 'GRADED', 'ISSUED', 'COMPLETED', 'ACTIVE', 'SIGNED', 'CONVERTED', 'VALID', 'IMPORTED', 'RESOLVED', 'GRADUATED'],
  warn: ['PENDING', 'PARTIAL', 'LATE', 'SUBMITTED', 'IN_PROGRESS', 'DRAFT', 'PREVIEW', 'IN_REVIEW', 'CONTACTED', 'PLACEMENT_TEST', 'RETURNED', 'DUPLICATE', 'OPEN', 'EXCUSED'],
  bad: ['CANCELLED', 'UNPAID', 'ABSENT', 'REJECTED', 'VOIDED', 'REVOKED', 'ERROR', 'LOST', 'EXPIRED', 'INACTIVE', 'TRANSFERRED'],
};
export const tone = (v) => (TONE.good.includes(v) ? 'good' : TONE.warn.includes(v) ? 'warn' : TONE.bad.includes(v) ? 'bad' : 'neutral');

export const fullName = (p) => (p ? `${p.lastName ?? ''} ${p.firstName ?? ''}`.trim() : '—');
