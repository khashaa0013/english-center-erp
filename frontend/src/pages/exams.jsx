// M4 — Онлайн шалгалт: асуулт бэлтгэх, оролдлого үнэлэх, дүн нийтлэх
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';
import { dateTime, fullName, label } from '../lib/format.js';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, Table, useAction, useApi } from '../components/ui.jsx';

export function ExamsPage() {
  const { data, loading, error } = useApi('/exams');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Онлайн шалгалт"><Link className="btn primary" to="/exams/new">+ Шалгалт</Link></PageHeader>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(e) => navigate(`/exams/${e.id}`)} columns={[
          { key: 'c', title: 'Анги', render: (e) => e.class.code },
          { key: 'title', title: 'Гарчиг' },
          { key: 't', title: 'Төрөл', render: (e) => label(e.examType) },
          { key: 'o', title: 'Нээх — хаах', render: (e) => `${dateTime(e.opensAt)} — ${dateTime(e.closesAt)}` },
          { key: 'd', title: 'Хугацаа', render: (e) => `${e.durationMinutes} мин` },
          { key: 'a', title: 'Оролдлого', render: (e) => e._count.attempts },
        ]} />
      )}
    </>
  );
}

const emptyQuestion = () => ({ questionType: 'MULTIPLE_CHOICE', prompt: '', points: 10, options: [{ optionText: '', isCorrect: true }, { optionText: '', isCorrect: false }] });

export function ExamBuilder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const classes = useApi('/classes');
  const [exam, setExam] = useState({
    classId: params.get('classId') ?? '', title: '', examType: 'QUIZ', opensAt: '', closesAt: '', durationMinutes: 30, maxAttempts: 1, countsForGraduation: false,
  });
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [run, busy] = useAction();
  const setQ = (i, patch) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const total = questions.reduce((a, q) => a + Number(q.points || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      ...exam,
      classId: Number(exam.classId),
      durationMinutes: Number(exam.durationMinutes),
      maxAttempts: Number(exam.maxAttempts),
      questions: questions.map((q) => ({
        questionType: q.questionType, prompt: q.prompt, points: Number(q.points),
        ...(q.questionType === 'MULTIPLE_CHOICE' ? { options: q.options } : {}),
      })),
    };
    const r = await run(() => api('/exams', { method: 'POST', body }), 'Шалгалт үүслээ');
    navigate(`/exams/${r.id}`);
  };

  return (
    <>
      <PageHeader title="Шинэ онлайн шалгалт" subtitle={`Нийт ${total} оноо · сонгох асуулт автоматаар, бичгийн ба ярианы хариуг багш үнэлнэ`} />
      <form onSubmit={submit} className="stack">
        <Card title="Ерөнхий тохиргоо">
          <div className="form">
            <Field label="Анги"><Select required value={exam.classId} onChange={(e) => setExam({ ...exam, classId: e.target.value })} options={(classes.data ?? []).filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status)).map((c) => ({ value: c.id, label: `${c.code} — ${c.course.name}` }))} /></Field>
            <Field label="Гарчиг"><input required value={exam.title} onChange={(e) => setExam({ ...exam, title: e.target.value })} /></Field>
            <Field label="Төрөл"><Select placeholder={null} value={exam.examType} onChange={(e) => setExam({ ...exam, examType: e.target.value })} options={['QUIZ', 'MIDTERM', 'FINAL'].map((t) => ({ value: t, label: label(t) }))} /></Field>
            <Field label="Нээгдэх"><input type="datetime-local" required value={exam.opensAt} onChange={(e) => setExam({ ...exam, opensAt: e.target.value })} /></Field>
            <Field label="Хаагдах"><input type="datetime-local" required value={exam.closesAt} onChange={(e) => setExam({ ...exam, closesAt: e.target.value })} /></Field>
            <Field label="Үргэлжлэх (мин)"><input type="number" min="1" required value={exam.durationMinutes} onChange={(e) => setExam({ ...exam, durationMinutes: e.target.value })} /></Field>
            <Field label="Оролдлогын тоо"><input type="number" min="1" max="10" value={exam.maxAttempts} onChange={(e) => setExam({ ...exam, maxAttempts: e.target.value })} /></Field>
            <Field label="Төгсөлт"><span className="check"><input type="checkbox" checked={exam.countsForGraduation} onChange={(e) => setExam({ ...exam, countsForGraduation: e.target.checked })} /> Төгсөлтийн дүнд тооцох</span></Field>
          </div>
        </Card>
        {questions.map((q, i) => (
          <Card key={i} title={`Асуулт ${i + 1}`} actions={questions.length > 1 && <button type="button" className="btn sm danger" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>Хасах</button>}>
            <div className="form">
              <Field label="Төрөл"><Select placeholder={null} value={q.questionType} onChange={(e) => setQ(i, { questionType: e.target.value })} options={['MULTIPLE_CHOICE', 'WRITING', 'SPEAKING'].map((t) => ({ value: t, label: label(t) }))} /></Field>
              <Field label="Оноо"><input type="number" min="0.5" step="0.5" required value={q.points} onChange={(e) => setQ(i, { points: e.target.value })} /></Field>
              <Field label="Асуулт" full><textarea rows={2} required value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} /></Field>
              {q.questionType === 'MULTIPLE_CHOICE' && (
                <div className="field full">
                  <span className="field-label">Сонголтууд (зөв хариултыг тэмдэглэнэ)</span>
                  {q.options.map((o, k) => (
                    <div key={k} className="option">
                      <input type="radio" name={`correct-${i}`} checked={o.isCorrect} onChange={() => setQ(i, { options: q.options.map((x, m) => ({ ...x, isCorrect: m === k })) })} />
                      <input required value={o.optionText} onChange={(e) => setQ(i, { options: q.options.map((x, m) => (m === k ? { ...x, optionText: e.target.value } : x)) })} placeholder={`Сонголт ${k + 1}`} />
                      {q.options.length > 2 && <button type="button" className="btn sm ghost" onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k).map((x, m, arr) => ({ ...x, isCorrect: arr.some((y) => y.isCorrect) ? x.isCorrect : m === 0 })) })}>×</button>}
                    </div>
                  ))}
                  <button type="button" className="btn sm" onClick={() => setQ(i, { options: [...q.options, { optionText: '', isCorrect: false }] })}>+ Сонголт</button>
                </div>
              )}
              {q.questionType === 'SPEAKING' && <div className="field full muted small">Сурагч аудио бичлэг илгээнэ. Асуултын аудиог шалгалт үүсгэсний дараа хавсаргана.</div>}
            </div>
          </Card>
        ))}
        <div className="row">
          <button type="button" className="btn" onClick={() => setQuestions([...questions, emptyQuestion()])}>+ Асуулт нэмэх</button>
          <span className="spacer" />
          <button className="btn primary lg" disabled={busy}>Шалгалт хадгалах ({total} оноо)</button>
        </div>
      </form>
    </>
  );
}

function GradeAttemptModal({ attemptId, onClose, onSaved }) {
  const { data: at, loading, error } = useApi(`/exams/attempts/${attemptId}`);
  const [scores, setScores] = useState({});
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  if (loading) return <Modal title="Оролдлого" onClose={onClose}><Loading /></Modal>;
  if (error) return <Modal title="Оролдлого" onClose={onClose}><ErrorBox error={error} /></Modal>;
  const manual = at.exam.questions.filter((q) => q.questionType !== 'MULTIPLE_CHOICE');
  const answerOf = (q) => at.answers.find((a) => a.questionId === q.id);
  return (
    <Modal title={`${fullName(at.student)} — оролдлого #${at.attemptNo}`} onClose={onClose} wide>
      {at.exam.questions.map((q, i) => {
        const a = answerOf(q);
        return (
          <div key={q.id} className="question">
            <div><b>{i + 1}. {q.prompt}</b> <span className="muted small">({label(q.questionType)}, {Number(q.points)} оноо)</span></div>
            {q.questionType === 'MULTIPLE_CHOICE' ? (
              q.options.map((o) => <div key={o.id} className="option small">{a?.selectedOptionId === o.id ? '◉' : '○'} {o.optionText} {o.isCorrect && <Badge value="APPROVED">зөв</Badge>}</div>)
            ) : (
              <>
                {a?.textAnswer && <div style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{a.textAnswer}</div>}
                {a?.audioPath && <audio controls src={fileUrl(a.audioPath)} />}
                {!a?.textAnswer && !a?.audioPath && <div className="muted">Хариулаагүй</div>}
              </>
            )}
            <div className="muted small">Оноо: {a?.score !== null && a?.score !== undefined ? Number(a.score) : 'үнэлээгүй'}</div>
            {q.questionType !== 'MULTIPLE_CHOICE' && (
              <div className="row" style={{ marginTop: 6 }}>
                <input type="number" min="0" max={Number(q.points)} step="0.5" placeholder="Оноо" style={{ maxWidth: 120 }}
                  value={scores[q.id]?.score ?? (a?.score ?? '')} onChange={(e) => setScores({ ...scores, [q.id]: { ...scores[q.id], score: e.target.value } })} />
                <input placeholder="Тайлбар" value={scores[q.id]?.feedback ?? (a?.feedback ?? '')} onChange={(e) => setScores({ ...scores, [q.id]: { ...scores[q.id], feedback: e.target.value } })} />
              </div>
            )}
          </div>
        );
      })}
      {manual.length > 0 && (
        <form className="form" style={{ marginTop: 12 }} onSubmit={async (e) => {
          e.preventDefault();
          const answers = manual.map((q) => {
            const a = answerOf(q);
            return { questionId: q.id, score: Number(scores[q.id]?.score ?? a?.score ?? 0), feedback: scores[q.id]?.feedback ?? a?.feedback ?? '' };
          });
          await run(() => api(`/exams/attempts/${attemptId}/grade`, { method: 'POST', body: { answers, ...(reason ? { reason } : {}) } }), 'Үнэллээ');
          onSaved();
        }}>
          {at.status === 'GRADED' && <Field label="Дүн өөрчлөх шалтгаан (заавал)" full><input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          <div className="form-actions"><button className="btn primary" disabled={busy}>Үнэлгээ хадгалах</button></div>
        </form>
      )}
    </Modal>
  );
}

export function ExamDetail() {
  const { id } = useParams();
  const { data: exam, loading, error, reload } = useApi(`/exams/${id}`);
  const attempts = useApi(`/exams/${id}/attempts`);
  const results = useApi(`/exams/${id}/results`);
  const [grading, setGrading] = useState(null);
  const [run] = useAction();
  if (loading && !exam) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const pending = (attempts.data ?? []).filter((a) => a.status === 'SUBMITTED').length;
  const refresh = () => { reload(); attempts.reload(); results.reload(); };

  return (
    <>
      <PageHeader title={exam.title} subtitle={<>{exam.class.code} · {label(exam.examType)} · {dateTime(exam.opensAt)} — {dateTime(exam.closesAt)} · {exam.durationMinutes} мин · {Number(exam.maxScore)} оноо{exam.countsForGraduation && ' · төгсөлтөд тооцно'}</>}>
        <button type="button" className="btn primary" disabled={pending > 0} title={pending ? 'Үнэлээгүй оролдлого байна' : ''}
          onClick={() => run(() => api(`/exams/${id}/publish`, { method: 'POST' })).then((r) => { refresh(); return r; })}>Дүн нийтлэх</button>
      </PageHeader>
      <div className="grid two">
        <Card title={`Оролдлого (${attempts.data?.length ?? 0})`} actions={pending > 0 && <Badge value="PENDING">{pending} үнэлэх</Badge>}>
          <Table rows={attempts.data} empty="Оролдлого алга" onRowClick={(a) => a.status !== 'IN_PROGRESS' && setGrading(a.id)} columns={[
            { key: 'n', title: 'Сурагч', render: (a) => fullName(a.student) },
            { key: 'no', title: '#', render: (a) => a.attemptNo },
            { key: 'at', title: 'Илгээсэн', render: (a) => dateTime(a.submittedAt) },
            { key: 's', title: 'Төлөв', render: (a) => <Badge value={a.status} /> },
            { key: 'sc', title: 'Оноо', render: (a) => (a.totalScore !== null ? Number(a.totalScore) : '—') },
          ]} />
        </Card>
        <Card title="Эцсийн дүн (шилдэг оролдлого)">
          <Table rows={results.data} empty="Дүн алга" columns={[
            { key: 'n', title: 'Сурагч', render: (r) => fullName(r.student) },
            { key: 's', title: 'Дүн', render: (r) => `${Number(r.finalScore)} / ${Number(exam.maxScore)}` },
            { key: 'p', title: 'Нийтэлсэн', render: (r) => (r.publishedAt ? dateTime(r.publishedAt) : <Badge value="DRAFT">Нийтлээгүй</Badge>) },
          ]} />
        </Card>
      </div>
      <Card title={`Асуултууд (${exam.questions.length})`}>
        {!exam.questions.length ? <Empty /> : exam.questions.map((q, i) => (
          <div key={q.id} className="question">
            <div><b>{i + 1}. {q.prompt}</b> <span className="muted small">({label(q.questionType)}, {Number(q.points)} оноо)</span></div>
            {q.options.map((o) => <div key={o.id} className="option small">{o.isCorrect ? '✔' : '·'} {o.optionText}</div>)}
            {q.questionType === 'SPEAKING' && <QuestionAudio q={q} onSaved={reload} />}
          </div>
        ))}
      </Card>
      {grading && <GradeAttemptModal attemptId={grading} onClose={() => setGrading(null)} onSaved={() => { setGrading(null); refresh(); }} />}
    </>
  );
}

function QuestionAudio({ q, onSaved }) {
  const [run, busy] = useAction();
  return (
    <div className="row" style={{ marginTop: 6 }}>
      {q.audioPath && <audio controls src={fileUrl(q.audioPath)} />}
      <label className="btn sm">
        {busy ? 'Хуулж байна…' : q.audioPath ? 'Аудио солих' : 'Асуултын аудио хавсаргах'}
        <input type="file" accept="audio/*" hidden onChange={async (e) => {
          const form = new FormData();
          form.append('file', e.target.files[0]);
          await run(() => api(`/exams/questions/${q.id}/audio`, { method: 'POST', form }), 'Аудио хавсаргалаа');
          onSaved();
        }} />
      </label>
    </div>
  );
}
