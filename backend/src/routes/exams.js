// =====================================================================
// M4 — Онлайн шалгалт
// - Сонгох асуулт автоматаар, бичгийн ба ярианы хариуг багш үнэлнэ
// - Хугацааг сервер тооцно (deadline); хугацаа дууссаны дараа хариу хүлээж авахгүй
// - Оролдлогын тоо хязгаартай; эцсийн дүн = хамгийн өндөр дүгнэгдсэн оролдлого
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { notifyUsers, studentAudienceUserIds } from '../lib/notify.js';
import { assertClassAccess, parentChildIds } from '../lib/access.js';
import { authorize, STAFF_TEACHER } from '../middleware/auth.js';
import { branchFilter } from '../middleware/scope.js';
import { idParam, validate, zId, zOptId, zOptStr, zStr } from '../middleware/validate.js';
import { storedPath, uploader } from '../middleware/upload.js';

const router = Router();
const GRACE_MS = 15 * 1000; // сүлжээний сааталд зориулсан хүлцэл
const audioUpload = uploader('exam-audio', 'media');

const ubLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).transform((v) => new Date(`${v}:00+08:00`));

const questionSchema = z.object({
  questionType: z.enum(['MULTIPLE_CHOICE', 'WRITING', 'SPEAKING']),
  prompt: zStr(5000),
  points: z.coerce.number().positive().max(100),
  options: z.array(z.object({ optionText: zStr(500), isCorrect: z.boolean() })).optional(),
});

const examSchema = z.object({
  classId: zId,
  title: zStr(200),
  examType: z.enum(['QUIZ', 'MIDTERM', 'FINAL']),
  opensAt: ubLocal,
  closesAt: ubLocal,
  durationMinutes: z.coerce.number().int().min(1).max(600),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
  countsForGraduation: z.boolean().optional(),
  questions: z.array(questionSchema).min(1, 'Хамгийн багадаа нэг асуулт'),
});

function checkQuestions(questions) {
  questions.forEach((q, i) => {
    if (q.questionType === 'MULTIPLE_CHOICE') {
      if (!q.options || q.options.length < 2) throw badRequest(`${i + 1}-р асуулт: хамгийн багадаа 2 сонголт`);
      if (q.options.filter((o) => o.isCorrect).length !== 1) throw badRequest(`${i + 1}-р асуулт: яг нэг зөв хариулт сонгоно`);
    }
  });
}

const questionsCreate = (questions) => ({
  create: questions.map((q, i) => ({
    questionType: q.questionType,
    prompt: q.prompt,
    points: q.points,
    sortOrder: i,
    ...(q.questionType === 'MULTIPLE_CHOICE' ? { options: { create: q.options.map((o, j) => ({ ...o, sortOrder: j })) } } : {}),
  })),
});

// Сурагчид зөв хариултыг харуулахгүй
const publicQuestions = {
  orderBy: { sortOrder: 'asc' },
  select: {
    id: true, questionType: true, prompt: true, audioPath: true, points: true, sortOrder: true,
    options: { orderBy: { sortOrder: 'asc' }, select: { id: true, optionText: true, sortOrder: true } },
  },
};

router.get('/', async (req, res) => {
  const where = req.query.classId ? { classId: Number(req.query.classId) } : {};
  const { role } = req.user;
  let own = null;
  if (role === 'TEACHER') where.class = { OR: [{ teacherId: req.user.teacherId }, { sessions: { some: { teacherId: req.user.teacherId } } }] };
  else if (role === 'STUDENT' || role === 'PARENT') {
    own = role === 'STUDENT' ? [req.user.studentId] : await parentChildIds(req.user.parentId);
    where.class = { enrollments: { some: { studentId: { in: own }, status: { in: ['CONFIRMED', 'COMPLETED'] } } } };
  } else where.class = branchFilter(req);

  res.json(await prisma.exam.findMany({
    where,
    include: {
      class: { select: { id: true, code: true } },
      _count: { select: { questions: true, attempts: true } },
      ...(own ? {
        attempts: { where: { studentId: { in: own } }, select: { id: true, attemptNo: true, status: true, totalScore: true, studentId: true, deadlineAt: true } },
        results: { where: { studentId: { in: own }, publishedAt: { not: null } } },
      } : {}),
    },
    orderBy: { opensAt: 'desc' },
  }));
});

router.get('/:id', async (req, res) => {
  const exam = await prisma.exam.findUnique({ where: { id: idParam(req) } });
  if (!exam) throw notFound();
  await assertClassAccess(req, exam.classId);
  const staff = !['STUDENT', 'PARENT'].includes(req.user.role);
  res.json(await prisma.exam.findUnique({
    where: { id: exam.id },
    include: {
      class: { select: { id: true, code: true } },
      // Сурагч асуултыг зөвхөн оролдлого эхлүүлсний дараа харна
      ...(staff ? { questions: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } } } : {}),
    },
  }));
});

router.post('/', authorize(STAFF_TEACHER), validate(examSchema), async (req, res) => {
  const { questions, ...data } = req.body;
  if (data.opensAt >= data.closesAt) throw badRequest('Нээх цаг хаах цагаас өмнө байна');
  checkQuestions(questions);
  const cls = await assertClassAccess(req, data.classId, { write: true });
  const maxScore = questions.reduce((a, q) => a + q.points, 0);
  const exam = await prisma.exam.create({ data: { ...data, maxScore, questions: questionsCreate(questions) } });
  await writeAudit(req, { action: 'CREATE', entityType: 'Exam', entityId: exam.id, newValues: { ...data, questions: questions.length }, branchId: cls.branchId });
  res.status(201).json(exam);
});

// Оролдлого эхлээгүй үед л асуултыг сольж болно
router.put('/:id', authorize(STAFF_TEACHER), validate(examSchema.partial()), async (req, res) => {
  const id = idParam(req);
  const old = await prisma.exam.findUnique({ where: { id }, include: { _count: { select: { attempts: true } } } });
  if (!old) throw notFound();
  const cls = await assertClassAccess(req, old.classId, { write: true });
  const { questions, classId: _c, ...data } = req.body;
  if (questions) {
    if (old._count.attempts > 0) throw conflict('Оролдлого эхэлсэн шалгалтын асуултыг өөрчлөх боломжгүй');
    checkQuestions(questions);
  }
  if ((data.opensAt ?? old.opensAt) >= (data.closesAt ?? old.closesAt)) throw badRequest('Нээх цаг хаах цагаас өмнө байна');
  const exam = await prisma.$transaction(async (tx) => {
    if (questions) await tx.question.deleteMany({ where: { examId: id } });
    return tx.exam.update({
      where: { id },
      data: { ...data, ...(questions ? { maxScore: questions.reduce((a, q) => a + q.points, 0), questions: questionsCreate(questions) } : {}) },
    });
  });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Exam', entityId: id, oldValues: old, newValues: data, branchId: cls.branchId });
  res.json(exam);
});

// Ярианы даалгаврын аудио (асуултад)
router.post('/questions/:questionId/audio', authorize(STAFF_TEACHER), audioUpload.single('file'), async (req, res) => {
  const q = await prisma.question.findUnique({ where: { id: idParam(req, 'questionId') }, include: { exam: true } });
  if (!q) throw notFound();
  await assertClassAccess(req, q.exam.classId, { write: true });
  if (!req.file) throw badRequest('Аудио файл илгээнэ үү');
  res.json(await prisma.question.update({ where: { id: q.id }, data: { audioPath: storedPath('exam-audio', req.file) } }));
});

// ----- Оролдлого -----

// Сонгох асуултыг автоматаар дүгнэж, гараар дүгнэх асуулт байхгүй бол GRADED болгоно
async function finalizeAttempt(attemptId) {
  const attempt = await prisma.examAttempt.findUnique({
    where: { id: attemptId },
    include: { exam: { include: { questions: { include: { options: true } } } }, answers: true },
  });
  if (attempt.status !== 'IN_PROGRESS') return attempt;

  let manualNeeded = false;
  await prisma.$transaction(async (tx) => {
    for (const q of attempt.exam.questions) {
      const ans = attempt.answers.find((a) => a.questionId === q.id);
      if (q.questionType === 'MULTIPLE_CHOICE') {
        const correct = q.options.find((o) => o.isCorrect);
        const score = ans?.selectedOptionId === correct?.id ? Number(q.points) : 0;
        if (ans) await tx.attemptAnswer.update({ where: { id: ans.id }, data: { score } });
        else await tx.attemptAnswer.create({ data: { attemptId, questionId: q.id, score: 0 } });
      } else if (ans && (ans.textAnswer || ans.audioPath)) {
        manualNeeded = true;
      } else if (!ans) {
        await tx.attemptAnswer.create({ data: { attemptId, questionId: q.id, score: 0 } });
      } else {
        await tx.attemptAnswer.update({ where: { id: ans.id }, data: { score: 0 } });
      }
    }
    const answers = await tx.attemptAnswer.findMany({ where: { attemptId } });
    const total = answers.reduce((a, x) => a + Number(x.score ?? 0), 0);
    // Хугацаа дууссаны дараа хариу хадгалагдахгүй тул хадгалсан хариугаар дүгнэнэ
    const late = new Date() > new Date(attempt.deadlineAt.getTime() + GRACE_MS);
    await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        submittedAt: late ? attempt.deadlineAt : new Date(),
        totalScore: total,
        status: manualNeeded ? 'SUBMITTED' : 'GRADED',
      },
    });
  });
  await recomputeResult(attempt.examId, attempt.studentId);
  return prisma.examAttempt.findUnique({ where: { id: attemptId } });
}

// Хугацаа дууссан, илгээгээгүй оролдлогыг автоматаар хаана
async function closeExpired(where) {
  const expired = await prisma.examAttempt.findMany({
    where: { ...where, status: 'IN_PROGRESS', deadlineAt: { lt: new Date(Date.now() - GRACE_MS) } },
    select: { id: true },
  });
  for (const a of expired) await finalizeAttempt(a.id);
}

async function recomputeResult(examId, studentId) {
  const best = await prisma.examAttempt.findFirst({
    where: { examId, studentId, status: 'GRADED' },
    orderBy: [{ totalScore: 'desc' }, { id: 'asc' }],
  });
  if (!best) return;
  const existing = await prisma.examResult.findUnique({ where: { examId_studentId: { examId, studentId } } });
  if (existing) {
    await prisma.examResult.update({ where: { id: existing.id }, data: { bestAttemptId: best.id, finalScore: best.totalScore } });
  } else {
    await prisma.examResult.create({ data: { examId, studentId, bestAttemptId: best.id, finalScore: best.totalScore } });
  }
}

async function loadOwnAttempt(req, attemptId) {
  const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
  if (!attempt) throw notFound();
  if (req.user.role !== 'STUDENT' || attempt.studentId !== req.user.studentId) throw forbidden();
  return attempt;
}

router.post('/:id/attempts', authorize('STUDENT'), async (req, res) => {
  const examId = idParam(req);
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw notFound();
  await assertClassAccess(req, exam.classId);
  const studentId = req.user.studentId;
  const now = new Date();
  if (now < exam.opensAt) throw conflict('Шалгалт хараахан нээгдээгүй');
  if (now > exam.closesAt) throw conflict('Шалгалтын хугацаа дууссан');

  await closeExpired({ examId, studentId });
  const active = await prisma.examAttempt.findFirst({ where: { examId, studentId, status: 'IN_PROGRESS' } });
  if (active) return res.json(active);

  const count = await prisma.examAttempt.count({ where: { examId, studentId } });
  if (count >= exam.maxAttempts) throw conflict(`Оролдлогын тоо (${exam.maxAttempts}) дууссан`);

  const deadline = new Date(Math.min(now.getTime() + exam.durationMinutes * 60000, exam.closesAt.getTime()));
  const attempt = await prisma.examAttempt.create({ data: { examId, studentId, attemptNo: count + 1, startedAt: now, deadlineAt: deadline } });
  res.status(201).json(attempt);
});

router.get('/attempts/:attemptId', async (req, res) => {
  const id = idParam(req, 'attemptId');
  const attempt = await prisma.examAttempt.findUnique({ where: { id }, include: { exam: true } });
  if (!attempt) throw notFound();
  const isOwner = req.user.role === 'STUDENT' && attempt.studentId === req.user.studentId;
  if (!isOwner) {
    if (!['SUPER_ADMIN', 'BRANCH_ADMIN', 'TEACHER'].includes(req.user.role)) throw forbidden();
    await assertClassAccess(req, attempt.exam.classId, { write: true });
  }
  await closeExpired({ id });
  const full = await prisma.examAttempt.findUnique({
    where: { id },
    include: {
      exam: { include: { questions: isOwner ? publicQuestions : { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } } } },
      answers: isOwner ? { select: { questionId: true, selectedOptionId: true, textAnswer: true, audioPath: true, score: true, feedback: true } } : true,
      student: { select: { id: true, studentCode: true, lastName: true, firstName: true } },
    },
  });
  // Сурагч дүгнэгдээгүй оноог харахгүй
  if (isOwner && full.status !== 'GRADED') full.answers = full.answers.map((a) => ({ ...a, score: null, feedback: null }));
  res.json({ ...full, serverTime: new Date() });
});

function assertOpen(attempt) {
  if (attempt.status !== 'IN_PROGRESS') throw conflict('Оролдлого хаагдсан');
  if (Date.now() > attempt.deadlineAt.getTime() + GRACE_MS) throw conflict('Шалгалтын хугацаа дууссан');
}

router.put(
  '/attempts/:attemptId/answers',
  authorize('STUDENT'),
  validate(z.object({ questionId: zId, selectedOptionId: zOptId, textAnswer: zOptStr(20000) })),
  async (req, res) => {
    const attempt = await loadOwnAttempt(req, idParam(req, 'attemptId'));
    assertOpen(attempt);
    const q = await prisma.question.findUnique({ where: { id: req.body.questionId }, include: { options: true } });
    if (!q || q.examId !== attempt.examId) throw badRequest('Асуулт энэ шалгалтынх биш');
    if (req.body.selectedOptionId && !q.options.some((o) => o.id === req.body.selectedOptionId)) throw badRequest('Сонголт буруу');

    const data = q.questionType === 'MULTIPLE_CHOICE'
      ? { selectedOptionId: req.body.selectedOptionId ?? null }
      : { textAnswer: req.body.textAnswer ?? null };
    const ans = await prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: q.id } },
      create: { attemptId: attempt.id, questionId: q.id, ...data },
      update: data,
    });
    res.json({ questionId: ans.questionId, saved: true });
  },
);

router.post('/attempts/:attemptId/answers/:questionId/audio', authorize('STUDENT'), audioUpload.single('file'), async (req, res) => {
  const attempt = await loadOwnAttempt(req, idParam(req, 'attemptId'));
  assertOpen(attempt);
  const q = await prisma.question.findUnique({ where: { id: idParam(req, 'questionId') } });
  if (!q || q.examId !== attempt.examId || q.questionType !== 'SPEAKING') throw badRequest('Ярианы асуулт биш');
  if (!req.file) throw badRequest('Аудио илгээнэ үү');
  const audioPath = storedPath('exam-audio', req.file);
  await prisma.attemptAnswer.upsert({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: q.id } },
    create: { attemptId: attempt.id, questionId: q.id, audioPath },
    update: { audioPath },
  });
  res.json({ saved: true, audioPath });
});

router.post('/attempts/:attemptId/submit', authorize('STUDENT'), async (req, res) => {
  const attempt = await loadOwnAttempt(req, idParam(req, 'attemptId'));
  if (attempt.status !== 'IN_PROGRESS') throw conflict('Оролдлого аль хэдийн илгээгдсэн');
  res.json(await finalizeAttempt(attempt.id));
});

// Багш бичгийн ба ярианы хариуг үнэлнэ
router.post(
  '/attempts/:attemptId/grade',
  authorize(STAFF_TEACHER),
  validate(z.object({
    answers: z.array(z.object({ questionId: zId, score: z.coerce.number().min(0), feedback: zOptStr(5000) })).min(1),
    reason: zOptStr(500),
  })),
  async (req, res) => {
    const id = idParam(req, 'attemptId');
    const attempt = await prisma.examAttempt.findUnique({ where: { id }, include: { exam: { include: { questions: true } }, answers: true } });
    if (!attempt) throw notFound();
    const cls = await assertClassAccess(req, attempt.exam.classId, { write: true });
    if (attempt.status === 'IN_PROGRESS') throw conflict('Сурагч шалгалтаа дуусгаагүй байна');
    const regrade = attempt.status === 'GRADED';
    if (regrade && (!req.body.reason || req.body.reason.length < 3)) throw badRequest('Дүн өөрчлөх шалтгаан бичнэ үү');

    for (const g of req.body.answers) {
      const q = attempt.exam.questions.find((x) => x.id === g.questionId);
      if (!q) throw badRequest(`Асуулт ${g.questionId} энэ шалгалтынх биш`);
      if (g.score > Number(q.points)) throw badRequest(`Асуулт ${g.questionId}: оноо ${q.points}-аас их байж болохгүй`);
    }

    const oldTotal = attempt.totalScore;
    await prisma.$transaction(async (tx) => {
      for (const g of req.body.answers) {
        await tx.attemptAnswer.upsert({
          where: { attemptId_questionId: { attemptId: id, questionId: g.questionId } },
          create: { attemptId: id, questionId: g.questionId, score: g.score, feedback: g.feedback ?? null, gradedBy: req.user.id },
          update: { score: g.score, feedback: g.feedback ?? null, gradedBy: req.user.id },
        });
      }
      const answers = await tx.attemptAnswer.findMany({ where: { attemptId: id } });
      const manualQ = attempt.exam.questions.filter((q) => q.questionType !== 'MULTIPLE_CHOICE');
      const allGraded = manualQ.every((q) => {
        const a = answers.find((x) => x.questionId === q.id);
        return a && a.score !== null;
      });
      await tx.examAttempt.update({
        where: { id },
        data: { totalScore: answers.reduce((a, x) => a + Number(x.score ?? 0), 0), status: allGraded ? 'GRADED' : 'SUBMITTED' },
      });
    });
    await recomputeResult(attempt.examId, attempt.studentId);
    const updated = await prisma.examAttempt.findUnique({ where: { id } });
    await writeAudit(req, {
      action: regrade ? 'REGRADE' : 'GRADE', entityType: 'ExamAttempt', entityId: id,
      oldValues: { totalScore: oldTotal }, newValues: { totalScore: updated.totalScore, status: updated.status },
      reason: req.body.reason, branchId: cls.branchId,
    });
    res.json(updated);
  },
);

router.get('/:id/attempts', authorize(STAFF_TEACHER), async (req, res) => {
  const examId = idParam(req);
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw notFound();
  await assertClassAccess(req, exam.classId, { write: true });
  await closeExpired({ examId });
  res.json(await prisma.examAttempt.findMany({
    where: { examId },
    include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } } },
    orderBy: [{ studentId: 'asc' }, { attemptNo: 'asc' }],
  }));
});

router.get('/:id/results', async (req, res) => {
  const examId = idParam(req);
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw notFound();
  await assertClassAccess(req, exam.classId);
  const own = req.user.role === 'STUDENT' ? [req.user.studentId] : req.user.role === 'PARENT' ? await parentChildIds(req.user.parentId) : null;
  res.json(await prisma.examResult.findMany({
    where: { examId, ...(own ? { studentId: { in: own }, publishedAt: { not: null } } : {}) },
    include: { student: { select: { id: true, studentCode: true, lastName: true, firstName: true } } },
  }));
});

// Дүнг нийтлэх — сурагч, эцэг эх зөвхөн нийтэлсэн дүнг харна
router.post('/:id/publish', authorize(STAFF_TEACHER), async (req, res) => {
  const examId = idParam(req);
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw notFound();
  const cls = await assertClassAccess(req, exam.classId, { write: true });
  await closeExpired({ examId });
  const pending = await prisma.examAttempt.count({ where: { examId, status: 'SUBMITTED' } });
  if (pending) throw conflict(`Дүгнэгдээгүй ${pending} оролдлого байна`);
  const results = await prisma.examResult.findMany({ where: { examId, publishedAt: null } });
  await prisma.examResult.updateMany({ where: { examId, publishedAt: null }, data: { publishedAt: new Date() } });
  for (const r of results) {
    await notifyUsers(await studentAudienceUserIds(r.studentId), { title: `Шалгалтын дүн: ${exam.title}`, body: `Дүн: ${r.finalScore}/${exam.maxScore}`, link: '/portal/grades' });
  }
  await writeAudit(req, { action: 'PUBLISH', entityType: 'Exam', entityId: examId, newValues: { published: results.length }, branchId: cls.branchId });
  res.json({ published: results.length });
});

export default router;
