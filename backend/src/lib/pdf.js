// =====================================================================
// PDF үүсгэгч: сургалтын гэрээ (M1), гэрчилгээ (M4)
// Тамга ба гарын үсгийн зураг нь баталгаат цахим гарын үсэг биш.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { ubDateString } from './time.js';

const fontAvailable = fs.existsSync(env.pdfFontPath);
const money = (v) => `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0 })}₮`;

function createDoc(relPath, options) {
  const full = path.join(env.uploadDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const doc = new PDFDocument({ size: 'A4', margin: 50, ...options });
  if (fontAvailable) doc.registerFont('main', env.pdfFontPath).font('main');
  const stream = fs.createWriteStream(full);
  doc.pipe(stream);
  const done = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return { doc, done };
}

function drawImageIfExists(doc, relPath, x, y, opts) {
  if (!relPath) return;
  const full = path.join(env.uploadDir, relPath);
  if (fs.existsSync(full)) doc.image(full, x, y, opts);
}

export async function renderContractPdf(relPath, { contract, enrollment, branch, parent }) {
  const { doc, done } = createDoc(relPath);
  const s = enrollment.student;
  const cls = enrollment.class;

  doc.fontSize(16).text('СУРГАЛТЫН ГЭРЭЭ', { align: 'center' }).moveDown(0.3);
  doc.fontSize(10).text(`Гэрээний дугаар: ${contract.contractNo}`, { align: 'center' });
  doc.text(`Огноо: ${ubDateString(new Date())}`, { align: 'center' }).moveDown();

  doc.fontSize(11).text(`Нэг талаас "${branch.name}" (цаашид "Төв"), нөгөө талаас доор дурдсан суралцагч болон түүний`
    + ' хууль ёсны төлөөлөгч (цаашид "Захиалагч") дараах нөхцөлөөр сургалтын гэрээ байгуулав.').moveDown();

  const rows = [
    ['Суралцагч', `${s.lastName} ${s.firstName} (${s.studentCode})`],
    ['Захиалагч', parent ? `${parent.lastName} ${parent.firstName}, утас ${parent.phone}` : 'Суралцагч өөрөө'],
    ['Сургалт', `${cls.course.name} (${cls.course.level.code})`],
    ['Анги', `${cls.code}, ${ubDateString(cls.startDate)} — ${ubDateString(cls.endDate)}`],
    ['Багц', `${enrollment.package.name}, ${enrollment.package.sessionsCount} хичээл`],
    ['Үнэ', money(enrollment.listPrice)],
    ['Хөнгөлөлт', money(enrollment.discountAmount)],
    ['Төлөх дүн', money(enrollment.finalAmount)],
  ];
  for (const [k, v] of rows) doc.text(`${k}: `, { continued: true }).text(v);
  doc.moveDown();

  const terms = [
    'Төв нь хөтөлбөрийн дагуу хичээлийг хуваарьт цагт чанартай зохион байгуулна.',
    'Захиалагч нь нэхэмжлэлийн дагуу төлбөрийг хугацаанд нь төлнө. Хэсэгчилсэн төлөлт хийж болно.',
    'Суралцагч нь хичээлд тогтмол хамрагдаж, ирцээ QR кодоор бүртгүүлнэ.',
    `Гэрчилгээ авах нөхцөл: ирц ${cls.course.minAttendancePercent}%-иас доошгүй, эцсийн дүн ${cls.course.minFinalScore}-аас доошгүй`
      + (cls.course.requireFullPayment ? ', төлбөрийг бүрэн төлсөн байх.' : '.'),
    'Сургалтыг цуцлах, буцаалт хийх асуудлыг Төвийн журмын дагуу шалтгаантайгаар шийдвэрлэнэ.',
  ];
  doc.text('Гэрээний нөхцөл:');
  terms.forEach((t, i) => doc.text(`${i + 1}. ${t}`, { indent: 10 }));
  doc.moveDown(2);

  const y = doc.y;
  doc.text('Төвийг төлөөлж: ____________', 50, y);
  doc.text('Захиалагч: ____________', 330, y);
  drawImageIfExists(doc, branch.signaturePath, 140, y - 25, { height: 40 });
  drawImageIfExists(doc, branch.stampPath, 60, y + 15, { height: 80 });

  doc.end();
  await done;
}

export async function renderCertificatePdf(relPath, { certificate, enrollment, branch }) {
  const { doc, done } = createDoc(relPath, { layout: 'landscape', margin: 40 });
  const s = enrollment.student;
  const course = enrollment.class.course;
  const width = doc.page.width;

  doc.rect(20, 20, width - 40, doc.page.height - 40).lineWidth(3).stroke('#1e3a8a');
  doc.fillColor('#1e3a8a').fontSize(30).text('ГЭРЧИЛГЭЭ', 0, 70, { align: 'center', width });
  doc.fontSize(14).fillColor('#333').text('CERTIFICATE OF COMPLETION', { align: 'center', width }).moveDown(1.5);
  doc.fontSize(14).text('Энэхүү гэрчилгээг', { align: 'center', width }).moveDown(0.5);
  doc.fontSize(26).fillColor('#000').text(`${s.lastName} ${s.firstName}`, { align: 'center', width }).moveDown(0.5);
  doc.fontSize(14).fillColor('#333')
    .text(`"${course.name}" (${course.level.code}) сургалтыг амжилттай дүүргэсэн тул олгов.`, { align: 'center', width })
    .moveDown(0.5)
    .text(`Ирц: ${certificate.attendancePercent}%   Эцсийн дүн: ${certificate.finalScore}`, { align: 'center', width })
    .moveDown(2);

  doc.fontSize(11).text(`Дугаар: ${certificate.certificateNo}`, 60, 420);
  doc.text(`Олгосон огноо: ${ubDateString(certificate.issuedAt)}`, 60, 438);
  doc.text(`${branch.name}`, 60, 456);
  doc.text(`Шалгах код: ${certificate.verificationCode}`, 60, 474);

  drawImageIfExists(doc, branch.signaturePath, 330, 400, { height: 50 });
  drawImageIfExists(doc, branch.stampPath, 420, 380, { height: 100 });

  const verifyUrl = `${env.publicAppUrl}/verify/${certificate.verificationCode}`;
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 110 });
  doc.image(qr, width - 170, 390, { width: 110 });

  doc.end();
  await done;
}
