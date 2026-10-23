// =====================================================================
// Нэвтрэлтгүй endpoint-ууд
// - Онлайн бүртгэлийн маягт (веб, Facebook-ийн холбоос) → M1 lead
// - Гэрчилгээ шалгах (QR кодоор)
// - QPay callback (туршилтын горим; нууц түлхүүрээр хамгаална)
// =====================================================================
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { notFound, unauthorized } from '../lib/httpError.js';
import { notifyUsers } from '../lib/notify.js';
import { ubDateString } from '../lib/time.js';
import { validate, zDate, zOptId, zOptStr, zStr } from '../middleware/validate.js';
import { recordPayment } from '../services/payments.js';

const router = Router();

// Маягт спамаас хамгаалах: IP тутамд цагт 20 хүсэлт
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) ?? { start: now, count: 0 };
  if (now - rec.start > 3600000) { rec.start = now; rec.count = 0; }
  rec.count += 1;
  hits.set(ip, rec);
  return rec.count > 20;
}

router.get('/form-options', async (_req, res) => {
  const [branches, courses] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, select: { code: true, name: true, address: true, phone: true } }),
    prisma.course.findMany({ where: { isActive: true }, select: { id: true, name: true, level: { select: { code: true } } } }),
  ]);
  res.json({ branches, courses });
});

router.post(
  '/leads',
  validate(z.object({
    branchCode: zStr(20),
    contactName: zStr(150),
    contactPhone: z.string().trim().regex(/^\+?[\d\s-]{8,20}$/, 'Утасны дугаар буруу'),
    studentName: zStr(150),
    studentBirthDate: zDate.optional().nullable(),
    interestedCourseId: zOptId,
    note: zOptStr(1000),
    source: z.enum(['WEB_FORM', 'FACEBOOK']).optional(),
    website: z.string().max(0).optional(), // honeypot: бот бөглөнө
  })),
  async (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ error: { code: 'TOO_MANY', message: 'Хэт олон хүсэлт' } });
    const branch = await prisma.branch.findUnique({ where: { code: req.body.branchCode } });
    if (!branch?.isActive) throw notFound('Салбар олдсонгүй');
    const { branchCode: _c, website: _w, studentBirthDate, contactPhone, ...rest } = req.body;
    const lead = await prisma.lead.create({
      data: {
        ...rest,
        branchId: branch.id,
        contactPhone: contactPhone.replace(/[^\d+]/g, ''),
        studentBirthDate: studentBirthDate ? new Date(`${studentBirthDate}T00:00:00Z`) : null,
        source: rest.source ?? 'WEB_FORM',
      },
    });
    const admins = await prisma.user.findMany({ where: { branchId: branch.id, isActive: true, role: { code: 'BRANCH_ADMIN' } }, select: { id: true } });
    await notifyUsers(admins.map((a) => a.id), { title: 'Онлайн бүртгэлийн шинэ хүсэлт', body: `${lead.contactName}: ${lead.studentName}`, link: '/leads' });
    res.status(201).json({ ok: true, id: lead.id });
  },
);

router.get('/certificates/verify/:code', async (req, res) => {
  const cert = await prisma.certificate.findUnique({
    where: { verificationCode: String(req.params.code).toUpperCase() },
    include: { enrollment: { include: { student: true, branch: true, class: { include: { course: { include: { level: true } } } } } } },
  });
  if (!cert) throw notFound('Гэрчилгээ олдсонгүй');
  const s = cert.enrollment.student;
  res.json({
    valid: cert.status === 'ISSUED',
    status: cert.status,
    certificateNo: cert.certificateNo,
    // Хувийн мэдээллийг хязгаарлана: овгийн эхний үсэг + нэр
    student: `${s.lastName.charAt(0)}. ${s.firstName}`,
    course: cert.enrollment.class.course.name,
    level: cert.enrollment.class.course.level.code,
    branch: cert.enrollment.branch.name,
    issuedAt: ubDateString(cert.issuedAt),
  });
});

// QPay callback (туршилт). Бодит QPay-д гэрээ, client id/secret, мөн QPay API-аас
// төлбөрийг дахин шалгах алхам нэмэгдэнэ. Ижил paymentId давтан ирэхэд давхар төлөлт үүсэхгүй.
router.post(
  '/qpay/callback',
  validate(z.object({ invoiceNo: zStr(30), paymentId: zStr(100), amount: z.coerce.number().positive() })),
  async (req, res) => {
    const secret = req.headers['x-qpay-secret'];
    const ok = env.qpayWebhookSecret && typeof secret === 'string' && secret.length === env.qpayWebhookSecret.length
      && crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(env.qpayWebhookSecret));
    if (!ok) throw unauthorized('QPay callback зөвшөөрөгдөөгүй');

    const inv = await prisma.invoice.findUnique({ where: { invoiceNo: req.body.invoiceNo } });
    if (!inv) throw notFound('Нэхэмжлэл олдсонгүй');
    const system = await prisma.user.findFirst({ where: { role: { code: 'SUPER_ADMIN' } }, orderBy: { id: 'asc' } });
    const result = await recordPayment({ ip: req.ip, user: { id: system.id, branchId: inv.branchId } }, {
      invoiceId: inv.id,
      amount: req.body.amount,
      method: 'QPAY',
      referenceNo: req.body.paymentId,
      idempotencyKey: `qpay:${req.body.paymentId}`,
      receivedBy: system.id,
    });
    res.json({ ok: true, duplicate: result.duplicate, paymentId: result.payment.id });
  },
);

export default router;
