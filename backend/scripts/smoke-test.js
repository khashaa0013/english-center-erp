// =====================================================================
// Нэгдсэн туршилт (SUERP3 "Хамгаалалтын нэгдсэн жишээ" + сөрөг нөхцөлүүд)
// Хөгжүүлэлтийн DB дээр шинэ туршилтын өгөгдөл үүсгэнэ (устгахгүй).
// Ажиллуулах: npm run db:seed:demo && npm start  →  npm run test:smoke
// =====================================================================
const API = process.env.API_URL ?? 'http://localhost:5000/api';
const PW = 'Demo12345!';
const run = Date.now().toString(36).toUpperCase();
let failures = 0;

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function check(name, cond, extra) {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures += 1;
    console.log(`  ✘ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '');
  }
}

async function ok(token, method, path, body, expected = [200, 201]) {
  const r = await call(token, method, path, body);
  if (!expected.includes(r.status)) {
    console.log(`  ✘ ${method} ${path} → ${r.status}`, JSON.stringify(r.data).slice(0, 400));
    failures += 1;
    throw new Error('stop');
  }
  return r.data;
}

const login = async (username) => (await ok(null, 'POST', '/auth/login', { username, password: username === 'admin' ? 'Admin12345!' : PW })).token;
const ubDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const ubTime = (d) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(11, 16);
const ubLocal = (d) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 16);

async function main() {
  console.log(`API: ${API}  (туршилт ${run})`);
  const admin = await login('branchadmin');
  const finance = await login('finance');
  const student = await login('st2026-0001');
  const parent = await login('99887766');

  console.log('\n1. M6 багш ба M4 анги, хуваарь');
  const courses = await ok(admin, 'GET', '/catalog/courses');
  const course = courses.find((c) => c.code === 'KIDS-A1');
  const pkg = course.packages[0];
  // Давтан ажиллуулахад цаг давхцахгүйн тулд туршилт бүр шинэ багш, танхимтай
  const username = `t${run.toLowerCase()}`;
  const newTeacher = await ok(admin, 'POST', '/teachers', { lastName: 'Туршилт', firstName: run, username, password: PW, courseIds: [course.id] });
  await ok(admin, 'POST', `/teachers/${newTeacher.id}/rates`, { hourlyRate: 30000, effectiveFrom: '2026-01-01' });
  const teacher = await login(username);
  const me = await ok(teacher, 'GET', '/auth/me');
  const rooms = [];
  for (const n of ['A', 'B', 'C']) rooms.push(await ok(admin, 'POST', '/catalog/classrooms', { name: `${n}-${run}`, capacity: 15 }));
  const today = ubDate();
  const end = ubDate(new Date(Date.now() + 90 * 86400000));
  const cls = await ok(admin, 'POST', '/classes', { courseId: course.id, teacherId: me.teacherId, classroomId: rooms[0].id, code: `K-${run}`, capacity: 2, startDate: today, endDate: end, status: 'OPEN' });
  check('Анги үүслээ', cls.id > 0);

  // Хуваарийн зөрчил: өөр ангид ижил багш, ижил цаг
  const dow = ((new Date(Date.now() + 8 * 3600000).getUTCDay() + 6) % 7) + 1;
  const slotDay = (dow % 7) + 1;
  await ok(admin, 'POST', `/classes/${cls.id}/schedules`, { dayOfWeek: slotDay, startTime: '06:00', endTime: '07:30' });
  const cls2 = await ok(admin, 'POST', '/classes', { courseId: course.id, teacherId: me.teacherId, classroomId: rooms[1].id, code: `K2-${run}`, capacity: 5, startDate: today, endDate: end });
  const clash = await call(admin, 'POST', `/classes/${cls2.id}/schedules`, { dayOfWeek: slotDay, startTime: '07:00', endTime: '08:00' });
  check('Багшийн давхардсан хуваарийг хүлээж авахгүй (409)', clash.status === 409, clash.data);
  const gen = await ok(admin, 'POST', `/classes/${cls.id}/generate-sessions`);
  const gen2 = await ok(admin, 'POST', `/classes/${cls.id}/generate-sessions`);
  check('Хуваариас хичээл үүсч, давтахад давхардахгүй', gen.created > 0 && gen2.created === 0, { gen, gen2 });

  console.log('\n2. M1 сонирхогч → сурагч → элсэлт → M3 нэхэмжлэл');
  const lead = await ok(admin, 'POST', '/leads', { contactName: 'Туршилт Эцэг', contactPhone: `8800${run.slice(-4).replace(/\D/g, '1')}`, studentName: `Сурагч ${run}`, source: 'WALK_IN' });
  const conv = await ok(admin, 'POST', `/leads/${lead.id}/convert`, { lastName: 'Туршилт', firstName: run });
  const conv2 = await call(admin, 'POST', `/leads/${lead.id}/convert`, { lastName: 'Туршилт', firstName: run });
  check('Давтан хөрвүүлэхэд шинэ сурагч үүсэхгүй (409)', conv2.status === 409);
  const newStudentId = conv.student.id;

  const enr = await ok(admin, 'POST', '/enrollments', { studentId: newStudentId, classId: cls.id, packageId: pkg.id });
  check('Элсэлт lead-тэй холбогдлоо', enr.leadId === lead.id, enr);
  const conf = await ok(admin, 'POST', `/enrollments/${enr.id}/confirm`, {});
  check('Батлахад 600,000₮ нэхэмжлэл үүслээ', Number(conf.invoice.totalAmount) === 600000, conf.invoice);
  const conf2 = await call(admin, 'POST', `/enrollments/${enr.id}/confirm`, {});
  check('Давтан батлахад давхар нэхэмжлэл үүсэхгүй (409)', conf2.status === 409);

  // Демо сурагчийг мөн ангид элсүүлнэ (QR туршилтад)
  const demoStudent = (await ok(student, 'GET', '/auth/me')).studentId;
  const enrDemo = await ok(admin, 'POST', '/enrollments', { studentId: demoStudent, classId: cls.id, packageId: pkg.id, discountAmount: 100000 });
  await ok(admin, 'POST', `/enrollments/${enrDemo.id}/confirm`, {});
  const full = await call(admin, 'POST', '/enrollments', { studentId: (await ok(admin, 'POST', '/students', { lastName: 'Дүүрэн', firstName: run, force: true })).id, classId: cls.id, packageId: pkg.id });
  check('Дүүрсэн ангид элсүүлэхгүй (409)', full.status === 409, full.data);

  console.log('\n3. M3 хэсэгчилсэн төлөлт, давхар төлөлтөөс хамгаалах');
  const invId = conf.invoice.id;
  const key1 = `test-${run}-1`;
  const p1 = await ok(finance, 'POST', '/finance/payments', { invoiceId: invId, amount: 200000, method: 'CASH', idempotencyKey: key1 });
  const p1dup = await ok(finance, 'POST', '/finance/payments', { invoiceId: invId, amount: 200000, method: 'CASH', idempotencyKey: key1 });
  check('Ижил түлхүүрээр давтан илгээхэд давхар төлөлт үүсэхгүй', p1dup.duplicate === true && p1dup.payment.id === p1.payment.id);
  await ok(finance, 'POST', '/finance/payments', { invoiceId: invId, amount: 150000, method: 'BANK_TRANSFER', referenceNo: `REF${run}`, idempotencyKey: `test-${run}-2` });
  let inv = await ok(finance, 'GET', `/finance/invoices/${invId}`);
  check('200,000 + 150,000 төлсний дараа үлдэгдэл 250,000₮, PARTIAL', Number(inv.balance) === 250000 && inv.status === 'PARTIAL', { balance: inv.balance, status: inv.status });
  const over = await call(finance, 'POST', '/finance/payments', { invoiceId: invId, amount: 300000, method: 'CASH', idempotencyKey: `test-${run}-3` });
  check('Үлдэгдлээс их төлөлт хүлээж авахгүй (409)', over.status === 409);

  console.log('\n4. Эрхийн хяналт');
  const otherStudent = await call(student, 'GET', `/students/${newStudentId}`);
  check('Сурагч өөр сурагчийн профайлыг харахгүй (403)', otherStudent.status === 403);
  const parentOther = await call(parent, 'GET', `/portal/students/${newStudentId}/overview`);
  check('Эцэг эх холбоогүй хүүхдийн мэдээллийг харахгүй (403)', parentOther.status === 403);
  const teacherFinance = await call(teacher, 'GET', '/finance/invoices');
  check('Багш санхүүгийн мэдээлэл харахгүй (403)', teacherFinance.status === 403);
  const noToken = await call(null, 'GET', '/students');
  check('Нэвтрэлтгүй хандалт хаагдана (401)', noToken.status === 401);

  console.log('\n5. M2 QR ирц');
  const now = new Date();
  const sStart = new Date(now.getTime() - 15 * 60000);
  const sEnd = new Date(now.getTime() + 75 * 60000);
  const session = await ok(admin, 'POST', '/sessions', { classId: cls.id, date: ubDate(sStart), startTime: ubTime(sStart), endTime: ubTime(sEnd), classroomId: rooms[2].id, topic: 'Greetings' });
  const qrEarly = await call(teacher, 'POST', `/sessions/${session.id}/qr`);
  check('Хичээл эхлээгүй үед QR гарахгүй (409)', qrEarly.status === 409);
  await ok(teacher, 'POST', `/sessions/${session.id}/start`);
  const qr = await ok(teacher, 'POST', `/sessions/${session.id}/qr`);
  check('QR зураг ба хугацаа ирлээ', qr.qrDataUrl?.startsWith('data:image/png') && qr.ttlSeconds > 0);
  const scan1 = await ok(student, 'POST', '/attendance/check-in', { token: `ECERP:${qr.token}` });
  const scan2 = await ok(student, 'POST', '/attendance/check-in', { token: `ECERP:${qr.token}` });
  check('15 минут хоцорсон тул LATE (босго 10)', scan1.attendance.status === 'LATE', scan1.attendance);
  check('Давхар уншилт нэг ирцтэй', scan2.already === true && scan2.attendance.id === scan1.attendance.id);
  const badToken = await call(student, 'POST', '/attendance/check-in', { token: 'ECERP:abcdefghijklmnop' });
  check('Буруу QR хүлээж авахгүй (400)', badToken.status === 400);
  const qr2 = await ok(teacher, 'POST', `/sessions/${session.id}/qr`);
  const oldQr = await call(student, 'POST', '/attendance/check-in', { token: qr.token });
  check('Шинэ QR гарахад хуучин нь хүчингүй (409)', oldQr.status === 409 && qr2.token !== qr.token);
  const earlyComplete = await call(teacher, 'POST', `/sessions/${session.id}/complete`, {});
  check('Ирц батлаагүй үед хичээл дуусгахгүй (409)', earlyComplete.status === 409);
  await ok(teacher, 'POST', `/sessions/${session.id}/attendance/confirm`, { marks: [{ studentId: newStudentId, status: 'PRESENT' }] });
  const detail = await ok(teacher, 'GET', `/sessions/${session.id}`);
  const attDemo = detail.attendance.find((a) => a.studentId === demoStudent);
  const noReason = await call(teacher, 'PUT', `/attendance/${attDemo.id}`, { status: 'PRESENT', reason: '' });
  check('Шалтгаангүй залруулга хүлээж авахгүй (400)', noReason.status === 400);
  await ok(teacher, 'PUT', `/attendance/${attDemo.id}`, { status: 'PRESENT', reason: 'Замын түгжрэлээр хоцорсныг багш зөвшөөрөв' });
  const done = await ok(teacher, 'POST', `/sessions/${session.id}/complete`, { actualMinutes: 90 });
  check('Хичээл дуусч, заасан цаг PENDING үүслээ', done.teachingHour.status === 'PENDING');

  console.log('\n6. M4 онлайн шалгалт ба даалгавар');
  const exam = await ok(teacher, 'POST', '/exams', {
    classId: cls.id, title: `Final ${run}`, examType: 'FINAL', countsForGraduation: true, maxAttempts: 2,
    opensAt: ubLocal(new Date(Date.now() - 3600000)), closesAt: ubLocal(new Date(Date.now() + 3600000)), durationMinutes: 30,
    questions: [
      { questionType: 'MULTIPLE_CHOICE', prompt: 'Hello = ?', points: 50, options: [{ optionText: 'Сайн уу', isCorrect: true }, { optionText: 'Баяртай', isCorrect: false }] },
      { questionType: 'WRITING', prompt: 'Write about your family', points: 50 },
    ],
  });
  const examForStudent = await ok(student, 'GET', `/exams/${exam.id}`);
  check('Сурагч оролдлогогүйгээр асуулт харахгүй', !examForStudent.questions);
  const attempt = await ok(student, 'POST', `/exams/${exam.id}/attempts`);
  const at = await ok(student, 'GET', `/exams/attempts/${attempt.id}`);
  check('Сурагчид зөв хариулт ил гарахгүй', at.exam.questions[0].options.every((o) => o.isCorrect === undefined));
  const mc = at.exam.questions.find((q) => q.questionType === 'MULTIPLE_CHOICE');
  const wr = at.exam.questions.find((q) => q.questionType === 'WRITING');
  await ok(student, 'PUT', `/exams/attempts/${attempt.id}/answers`, { questionId: mc.id, selectedOptionId: mc.options[0].id });
  await ok(student, 'PUT', `/exams/attempts/${attempt.id}/answers`, { questionId: wr.id, textAnswer: 'I have a mother and a father.' });
  const sub = await ok(student, 'POST', `/exams/attempts/${attempt.id}/submit`);
  check('Бичгийн асуулттай тул SUBMITTED (багш үнэлнэ)', sub.status === 'SUBMITTED' && Number(sub.totalScore) === 50, sub);
  const graded = await ok(teacher, 'POST', `/exams/attempts/${attempt.id}/grade`, { answers: [{ questionId: wr.id, score: 40, feedback: 'Good' }] });
  check('Багш үнэлсний дараа 90 оноо, GRADED', graded.status === 'GRADED' && Number(graded.totalScore) === 90, graded);

  // Шинэ сурагч шалгалт өгөөгүй → гэрчилгээний шаардлага хангахгүй
  const gradNew = await ok(admin, 'GET', `/graduation/${enr.id}`);
  check('Дүн дутуу, үлдэгдэлтэй сурагч гэрчилгээ авахгүй', !gradNew.eligible && gradNew.reasons.length >= 2, gradNew.reasons);
  const certFail = await call(admin, 'POST', '/certificates', { enrollmentId: enr.id });
  check('Шаардлага хангаагүй гэрчилгээний хүсэлт (409)', certFail.status === 409);

  await ok(teacher, 'POST', `/exams/${exam.id}/publish`);
  const results = await ok(parent, 'GET', `/exams/${exam.id}/results`);
  check('Эцэг эх нийтэлсэн дүнг харна', results.length === 1 && Number(results[0].finalScore) === 90);

  console.log('\n7. Үлдэгдэл төлөөд гэрчилгээ (демо сурагч)');
  const invDemo = (await ok(admin, 'GET', `/enrollments/${enrDemo.id}`)).invoice;
  await ok(finance, 'POST', '/finance/payments', { invoiceId: invDemo.id, amount: Number(invDemo.balance), method: 'CARD', idempotencyKey: `test-${run}-demo` });
  const grad = await ok(admin, 'GET', `/graduation/${enrDemo.id}`);
  check('Ирц, дүн, төлбөр хангасан → гэрчилгээ авах эрхтэй', grad.eligible, grad.reasons);
  const cert = await ok(admin, 'POST', '/certificates', { enrollmentId: enrDemo.id });
  check('PDF гэрчилгээ үүслээ', Boolean(cert.filePath));
  const verify = await ok(null, 'GET', `/public/certificates/verify/${cert.verificationCode}`);
  check('Гэрчилгээг нийтэд шалгахад хүчинтэй', verify.valid === true);
  const certAgain = await call(admin, 'POST', '/certificates', { enrollmentId: enrDemo.id });
  check('Давхар гэрчилгээ олгохгүй (409)', certAgain.status === 409);

  console.log('\n8. M6 цаг батлах → M3 хөлсний тооцоо');
  const approved = await ok(admin, 'POST', `/teaching-hours/${done.teachingHour.id}/approve`);
  check('90 мин × 30,000₮/цаг = 45,000₮', Number(approved.amount) === 45000, approved.amount);
  const payout = await ok(finance, 'POST', '/finance/payouts', { teacherId: me.teacherId, periodStart: ubDate(sStart), periodEnd: ubDate(sStart) });
  check('Батлагдсан цагаас хөлсний тооцоо үүслээ', Number(payout.totalAmount) >= 45000);
  const payoutAgain = await call(finance, 'POST', '/finance/payouts', { teacherId: me.teacherId, periodStart: ubDate(sStart), periodEnd: ubDate(sStart) });
  check('Ижил цагийг давхар тооцохгүй (409)', payoutAgain.status === 409);
  await ok(admin, 'POST', `/finance/payouts/${payout.id}/approve`);
  await ok(finance, 'POST', `/finance/payouts/${payout.id}/pay`);

  console.log('\n9. M5 портал ба M7 тайлан');
  const overview = await ok(parent, 'GET', `/portal/students/${demoStudent}/overview`);
  check('Эцэг эх хүүхдийн хуваарь, ирц, төлбөр, гэрчилгээг харна', overview.enrollments.length > 0 && overview.attendance.length > 0 && overview.results.length > 0);
  const req1 = await ok(parent, 'POST', '/portal/requests', { studentId: demoStudent, requestType: 'LEAVE', subject: 'Өвчтэй', message: 'Ханиад хүрсэн', leaveFrom: today, leaveTo: today });
  await ok(admin, 'POST', `/requests/${req1.id}/handle`, { status: 'APPROVED', response: 'Эдгэрэхийг хүсье' });
  const dash = await ok(admin, 'GET', '/reports/dashboard');
  check('Захирлын нэгдсэн тайлан', Number(dash.total.income) > 0, dash.total);
  const cash = await ok(finance, 'GET', `/finance/cash-report?date=${today}`);
  check('Өдрийн кассын тайлан', Number(cash.income) > 0);
  const audit = await ok(admin, 'GET', `/audit-logs?entityType=Attendance`);
  check('Залруулгын түүх audit log-д хадгалагдсан', audit.some((a) => a.action === 'CORRECT' && a.reason));

  console.log('\n10. Файл: гэрээ PDF, Excel экспорт/импорт, материал, QPay хамгаалалт');
  await ok(admin, 'POST', `/enrollments/${enr.id}/contract/generate`);
  const pdf = await fetch(`${API}/enrollments/${enr.id}/contract/file?token=${encodeURIComponent(admin)}`);
  check('Гэрээний PDF татагдлаа', pdf.ok && (await pdf.text()).startsWith('%PDF'));
  const xlsx = await fetch(`${API}/reports/export/students`, { headers: { Authorization: `Bearer ${admin}` } });
  const xbuf = Buffer.from(await xlsx.arrayBuffer());
  check('Excel экспорт (.xlsx)', xlsx.ok && xbuf.subarray(0, 2).toString() === 'PK');

  // Үлдэгдэл 250,000₮-ийг банкны хуулгаар (2 мөр, нэг нь давхардсан лавлахтай) импортлох
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Төлөлт');
  ws.addRow(['invoice_no', 'amount', 'method', 'reference_no', 'paid_at']);
  ws.addRow([conf.invoice.invoiceNo, 250000, 'BANK_TRANSFER', `BANK${run}`, today]);
  ws.addRow([conf.invoice.invoiceNo, 1000, 'BANK_TRANSFER', `BANK${run}`, today]);
  const upload = async () => {
    const form = new FormData();
    form.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'bank.xlsx');
    const r = await fetch(`${API}/finance/payment-imports`, { method: 'POST', headers: { Authorization: `Bearer ${finance}` }, body: form });
    return r.json();
  };
  const imp = await upload();
  check('Импорт: 1 зөв, 1 давхардсан мөр илэрлээ', imp.validRows === 1 && imp.rows.some((r) => r.status === 'DUPLICATE'), imp.rows);
  const confirmed = await ok(finance, 'POST', `/finance/payment-imports/${imp.id}/confirm`);
  inv = await ok(finance, 'GET', `/finance/invoices/${invId}`);
  check('Импорт батлагдаж нэхэмжлэл бүрэн төлөгдлөө', confirmed.imported === 1 && inv.status === 'PAID', { confirmed, status: inv.status });
  const again = await call(finance, 'POST', `/finance/payment-imports/${imp.id}/confirm`);
  check('Импортыг давтан батлахгүй (409)', again.status === 409);
  const imp2 = await upload();
  check('Ижил хуулгыг дахин оруулахад давхардал гэж илэрнэ', imp2.validRows === 0);

  const mform = new FormData();
  mform.append('title', 'Unit 1 workbook');
  mform.append('type', 'PDF');
  mform.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'unit1.pdf');
  const mat = await (await fetch(`${API}/classes/${cls.id}/materials`, { method: 'POST', headers: { Authorization: `Bearer ${teacher}` }, body: mform })).json();
  const asStudent = await fetch(`${API}/files/${mat.filePath}?token=${encodeURIComponent(student)}`);
  check('Элссэн сурагч ангийн материалыг татна', asStudent.ok);
  const outsider = await ok(admin, 'POST', '/students', { lastName: 'Гадны', firstName: run, force: true });
  await ok(admin, 'POST', `/students/${outsider.id}/account`, { password: PW });
  const outsiderToken = await login(outsider.studentCode.toLowerCase());
  const asOutsider = await fetch(`${API}/files/${mat.filePath}?token=${encodeURIComponent(outsiderToken)}`);
  check('Элсээгүй сурагч материал татахгүй (403)', asOutsider.status === 403);
  const traversal = await fetch(`${API}/files/materials/..%2F..%2F.env?token=${encodeURIComponent(admin)}`);
  check('Файлын замаар (../) гарах оролдлого хаагдана', traversal.status === 400 || traversal.status === 403 || traversal.status === 404);
  const qpay = await call(null, 'POST', '/public/qpay/callback', { invoiceNo: conf.invoice.invoiceNo, paymentId: 'X1', amount: 1 });
  check('Нууц түлхүүргүй QPay callback хаагдана (401)', qpay.status === 401);

  console.log(failures ? `\n✘ ${failures} шалгалт амжилтгүй` : '\n✔ Бүх шалгалт амжилттай');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  if (e.message !== 'stop') console.error(e);
  console.log(`\n✘ Туршилт зогслоо (${failures} алдаа)`);
  process.exitCode = 1;
});
