// M5 — Эцэг эхийн портал ба сурагчийн хувийн үйлчилгээ
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, authUrl, fileUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { DAYS, date, dateOnly, dateTime, fullName, label, LABEL, money, time, todayUb } from '../lib/format.js';
import {
  Badge, Card, Empty, ErrorBox, errorText, Field, Loading, PageHeader, Select, Stat, Table, Tabs, useAction, useApi, useForm, useToast,
} from '../components/ui.jsx';
import { MaterialList } from './classes.jsx';

const TABS = [
  { key: 'schedule', label: 'Хуваарь' }, { key: 'attendance', label: 'Ирц' }, { key: 'grades', label: 'Дүн' },
  { key: 'payments', label: 'Төлбөр' }, { key: 'assignments', label: 'Даалгавар' }, { key: 'progress', label: 'Ахиц' },
  { key: 'certificates', label: 'Гэрчилгээ' }, { key: 'materials', label: 'Материал' },
];

function Overview({ studentId, tab, setTab }) {
  const { data, loading, error } = useApi(`/portal/students/${studentId}/overview`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const active = data.enrollments.filter((e) => e.status !== 'PENDING');
  const balance = data.enrollments.reduce((a, e) => a + Number(e.invoice?.balance ?? 0), 0);
  const att = active.map((e) => e.attendanceSummary).filter(Boolean);
  const attPct = att.length ? Math.round(att.reduce((a, s) => a + s.percent, 0) / att.length) : null;
  const next = data.upcoming.find((s) => s.status === 'SCHEDULED' && new Date(s.startsAt) > new Date());

  return (
    <>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <Stat label="Түвшин" value={data.student.currentLevel?.code ?? '—'} hint={data.student.branch.name} />
        <Stat label="Ирц" value={attPct === null ? '—' : `${attPct}%`} />
        <Stat label="Төлбөрийн үлдэгдэл" value={money(balance)} tone={balance > 0 ? 'warn' : 'good'} />
        <Stat label="Дараагийн хичээл" value={next ? time(next.startsAt) : '—'} hint={next ? `${date(next.startsAt)} · ${next.class.code}` : ''} />
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'schedule' && (
        <>
          {active.map((e) => (
            <Card key={e.id} title={`${e.class.code} · ${e.class.course.name} (${e.class.course.level.code})`}>
              <div className="small">Багш: {fullName(e.class.teacher)} · {e.class.classroom?.name ?? ''} танхим · {dateOnly(e.class.startDate)} — {dateOnly(e.class.endDate)}</div>
              <div className="small">Долоо хоногт: {e.class.schedules.map((s) => `${DAYS[s.dayOfWeek]} ${s.startTime}–${s.endTime}`).join(', ') || '—'}</div>
            </Card>
          ))}
          <Card title="Ойрын 14 хоногийн хичээл">
            {!data.upcoming.length ? <Empty>Хичээл алга</Empty> : data.upcoming.map((s) => (
              <div key={s.id} className="session-item" style={{ opacity: s.status === 'CANCELLED' ? 0.55 : 1 }}>
                <span className="session-time">{date(s.startsAt)} {time(s.startsAt)}</span>
                <span>{s.class.code}</span>
                <span className="muted">{s.classroom.name} · {fullName(s.teacher)}</span>
                <span className="spacer" />
                <Badge value={s.status} />
              </div>
            ))}
          </Card>
        </>
      )}

      {tab === 'attendance' && (
        <>
          <div className="grid stats" style={{ marginBottom: 12 }}>
            {active.filter((e) => e.attendanceSummary).map((e) => (
              <Stat key={e.id} label={e.class.code} value={`${e.attendanceSummary.percent}%`}
                hint={`Ирсэн ${e.attendanceSummary.present} · Хоцорсон ${e.attendanceSummary.late} · Тасалсан ${e.attendanceSummary.absent} · Чөлөө ${e.attendanceSummary.excused}`} />
            ))}
          </div>
          <Table rows={data.attendance} empty="Ирц бүртгэгдээгүй" columns={[
            { key: 'd', title: 'Хичээл', render: (a) => dateTime(a.classSession.startsAt) },
            { key: 'c', title: 'Анги', render: (a) => a.classSession.class.code },
            { key: 's', title: 'Төлөв', render: (a) => <Badge value={a.status} /> },
            { key: 'l', title: 'Хоцролт', render: (a) => (a.lateMinutes ? `${a.lateMinutes} мин` : '—') },
          ]} />
        </>
      )}

      {tab === 'grades' && (
        <Table rows={data.results} empty="Нийтлэгдсэн дүн алга" columns={[
          { key: 'c', title: 'Анги', render: (r) => r.exam.class.code },
          { key: 't', title: 'Шалгалт', render: (r) => r.exam.title },
          { key: 'ty', title: 'Төрөл', render: (r) => label(r.exam.examType) },
          { key: 's', title: 'Дүн', render: (r) => <b>{Number(r.finalScore)} / {Number(r.exam.maxScore)}</b> },
          { key: 'd', title: 'Нийтэлсэн', render: (r) => date(r.publishedAt) },
        ]} />
      )}

      {tab === 'payments' && data.enrollments.map((e) => (
        <Card key={e.id} title={`${e.class.code} · ${e.package.name}`} actions={e.invoice && <Badge value={e.invoice.status} />}>
          {!e.invoice ? <div className="muted">Элсэлт баталгаажаагүй — нэхэмжлэл үүсээгүй</div> : (
            <>
              <div className="grid stats">
                <Stat label="Нэхэмжлэл" value={e.invoice.invoiceNo} hint={`Төлөх хугацаа ${dateOnly(e.invoice.dueDate)}`} />
                <Stat label="Нийт" value={money(e.invoice.totalAmount)} />
                <Stat label="Төлсөн" value={money(e.invoice.netPaid)} tone="good" />
                <Stat label="Үлдэгдэл" value={money(e.invoice.balance)} tone={Number(e.invoice.balance) > 0 ? 'warn' : 'good'} />
              </div>
              <Table rows={e.invoice.payments} empty="Төлөлт алга" columns={[
                { key: 'd', title: 'Огноо', render: (p) => date(p.paidAt) },
                { key: 'a', title: 'Дүн', className: 'right', render: (p) => money(p.amount) },
                { key: 'm', title: 'Хэлбэр', render: (p) => label(p.method) },
              ]} />
            </>
          )}
        </Card>
      ))}

      {tab === 'assignments' && (
        <Table rows={data.assignments} empty="Даалгавар алга" columns={[
          { key: 't', title: 'Даалгавар', render: (a) => <Link to={`/assignments/${a.id}`}>{a.title}</Link> },
          { key: 'c', title: 'Анги', render: (a) => a.class.code },
          { key: 'd', title: 'Хугацаа', render: (a) => dateTime(a.dueAt) },
          { key: 's', title: 'Төлөв', render: (a) => (a.submissions[0] ? <Badge value={a.submissions[0].status} /> : new Date(a.dueAt) < new Date() ? <Badge value="ABSENT">Илгээгээгүй</Badge> : <Badge value="PENDING">Хүлээгдэж буй</Badge>) },
          { key: 'sc', title: 'Оноо', render: (a) => (a.submissions[0]?.status === 'GRADED' ? `${Number(a.submissions[0].score)} / ${Number(a.maxScore)}` : '—') },
          { key: 'f', title: 'Багшийн тайлбар', render: (a) => a.submissions[0]?.feedback ?? '—' },
        ]} />
      )}

      {tab === 'progress' && (active.length ? active.map((e) => (
        <Card key={e.id} title={`${e.class.code} — ахицын үнэлгээ`}>
          <Table rows={e.progressAssessments} empty="Үнэлгээ хийгдээгүй" columns={[
            { key: 'd', title: 'Огноо', render: (p) => dateOnly(p.assessedOn) },
            { key: 's', title: 'Чадвар', render: (p) => label(p.skill) },
            { key: 'sc', title: 'Оноо', render: (p) => <div className="row"><div className="progress" style={{ width: 120 }}><span style={{ width: `${Number(p.score)}%` }} /></div>{Number(p.score)}</div> },
            { key: 'c', title: 'Багшийн тайлбар', render: (p) => p.teacherComment ?? '—' },
          ]} />
        </Card>
      )) : <Empty>Ахицын үнэлгээ алга</Empty>)}

      {tab === 'certificates' && (
        <Table rows={data.enrollments.filter((e) => e.certificate)} empty="Гэрчилгээ алга" columns={[
          { key: 'n', title: 'Дугаар', render: (e) => e.certificate.certificateNo },
          { key: 'c', title: 'Сургалт', render: (e) => e.class.course.name },
          { key: 'd', title: 'Олгосон', render: (e) => date(e.certificate.issuedAt) },
          { key: 's', title: 'Төлөв', render: (e) => <Badge value={e.certificate.status} /> },
          { key: 'f', title: '', render: (e) => e.certificate.status === 'ISSUED' && <a className="btn sm" href={authUrl(`/certificates/${e.certificate.id}/file`)}>PDF татах</a> },
        ]} />
      )}

      {tab === 'materials' && <MaterialList items={data.materials} />}
    </>
  );
}

export function PortalPage() {
  const { user } = useAuth();
  const { tab = 'schedule' } = useParams();
  const navigate = useNavigate();
  const setTab = (t) => navigate(`/portal/${t}`);
  const children = useApi(user.role === 'PARENT' ? '/portal/children' : null);
  const [childId, setChildId] = useState(null);

  if (user.role === 'STUDENT') {
    return (
      <>
        <PageHeader title={user.displayName} subtitle="Миний сургалт">
          <Link className="btn primary" to="/scan">QR ирц бүртгүүлэх</Link>
        </PageHeader>
        <Overview studentId={user.studentId} tab={tab} setTab={setTab} />
      </>
    );
  }

  if (children.loading) return <Loading />;
  const verified = (children.data ?? []).filter((c) => c.verified);
  const pending = (children.data ?? []).filter((c) => !c.verified);
  const current = childId ?? verified[0]?.studentId;
  return (
    <>
      <PageHeader title="Эцэг эхийн портал" subtitle="Зөвхөн таны бүртгэлтэй, баталгаажсан хүүхдийн мэдээлэл">
        {verified.length > 1 && (
          <Select placeholder={null} value={current} onChange={(e) => setChildId(Number(e.target.value))}
            options={verified.map((c) => ({ value: c.studentId, label: fullName(c.student) }))} />
        )}
        <Link className="btn" to="/portal/requests">Чөлөө, лавлагаа</Link>
      </PageHeader>
      {pending.length > 0 && <div className="alert warn">{pending.map((c) => c.student.firstName).join(', ')} — холбоос баталгаажаагүй байна. Сургалтын төвд хандана уу.</div>}
      {current ? <Overview key={current} studentId={current} tab={tab} setTab={setTab} /> : <Empty>Баталгаажсан хүүхэд алга</Empty>}
    </>
  );
}

// ----- QR ирц (сурагч) -----
export function ScanPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanner = useRef(null);
  const busy = useRef(false);

  const checkIn = useCallback(async (token) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const r = await api('/attendance/check-in', { method: 'POST', body: { token } });
      setResult(r);
      if (scanner.current?.isScanning) await scanner.current.stop();
      setScanning(false);
    } catch (e) {
      setError(e);
    } finally {
      setTimeout(() => { busy.current = false; }, 1500);
    }
  }, []);

  const start = async () => {
    setResult(null);
    setError(null);
    try {
      // QR уншигч сан том тул зөвхөн энэ хуудсанд, камер нээх үед ачаална
      const { Html5Qrcode } = await import('html5-qrcode');
      scanner.current = scanner.current ?? new Html5Qrcode('qr-reader');
      await scanner.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, (text) => checkIn(text), () => {});
      setScanning(true);
    } catch (e) {
      setError(new Error(window.isSecureContext
        ? `Камер нээж чадсангүй: ${e?.message ?? e}`
        : 'Камер ашиглахын тулд HTTPS холболт шаардлагатай. Доорх талбарт кодыг оруулж болно.'));
    }
  };

  useEffect(() => () => { if (scanner.current?.isScanning) scanner.current.stop().catch(() => {}); }, []);

  return (
    <>
      <PageHeader title="QR ирц бүртгүүлэх" subtitle="Багшийн дэлгэц дээрх QR кодыг уншуулна" />
      <Card className="qr-panel">
        {result ? (
          <div className={`alert ${result.already ? 'info' : 'ok'}`}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{result.already ? 'Ирц өмнө нь бүртгэгдсэн' : '✔ Ирц бүртгэгдлээ'}</div>
            <div>Төлөв: <Badge value={result.attendance.status} />{result.attendance.lateMinutes ? ` (${result.attendance.lateMinutes} мин хоцорсон)` : ''}</div>
            <div className="small">{dateTime(result.attendance.checkedInAt)}</div>
          </div>
        ) : null}
        <ErrorBox error={error} />
        <div id="qr-reader" className="scanner" />
        {!scanning && <button type="button" className="btn primary lg" onClick={start}>{result ? 'Дахин уншуулах' : 'Камер нээх'}</button>}
        {scanning && <button type="button" className="btn" onClick={async () => { await scanner.current.stop(); setScanning(false); }}>Зогсоох</button>}
        <form className="row" style={{ justifyContent: 'center', marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); checkIn(manual.trim()); }}>
          <input placeholder="Эсвэл кодыг гараар оруулах" value={manual} onChange={(e) => setManual(e.target.value)} style={{ maxWidth: 300 }} />
          <button className="btn">Илгээх</button>
        </form>
      </Card>
    </>
  );
}

// ----- Сурагчийн даалгавар, шалгалт -----
export function MyAssignments() {
  const { data, loading, error } = useApi('/assignments');
  if (loading) return <Loading />;
  return (
    <>
      <PageHeader title="Миний даалгавар" />
      <ErrorBox error={error} />
      <Table rows={data} empty="Даалгавар алга" columns={[
        { key: 't', title: 'Даалгавар', render: (a) => <Link to={`/assignments/${a.id}`}>{a.title}</Link> },
        { key: 'c', title: 'Анги', render: (a) => a.class.code },
        { key: 'type', title: 'Хариу', render: (a) => label(a.answerType) },
        { key: 'd', title: 'Хугацаа', render: (a) => dateTime(a.dueAt) },
        { key: 's', title: 'Төлөв', render: (a) => (a.submissions[0] ? <Badge value={a.submissions[0].status} /> : <Badge value="PENDING">Илгээгээгүй</Badge>) },
        { key: 'sc', title: 'Оноо', render: (a) => (a.submissions[0]?.status === 'GRADED' ? `${Number(a.submissions[0].score)}/${Number(a.maxScore)}` : '—') },
      ]} />
    </>
  );
}

export function MyExams() {
  const { data, loading, error } = useApi('/exams');
  const navigate = useNavigate();
  const [run] = useAction();
  if (loading) return <Loading />;
  const now = new Date();
  return (
    <>
      <PageHeader title="Онлайн шалгалт" />
      <ErrorBox error={error} />
      <Table rows={data} empty="Шалгалт алга" columns={[
        { key: 't', title: 'Шалгалт', render: (e) => <><b>{e.title}</b><div className="muted small">{e.class.code} · {label(e.examType)} · {e.durationMinutes} мин · {e._count.questions} асуулт</div></> },
        { key: 'w', title: 'Хугацаа', render: (e) => `${dateTime(e.opensAt)} — ${dateTime(e.closesAt)}` },
        { key: 'a', title: 'Оролдлого', render: (e) => `${e.attempts.length}/${e.maxAttempts}` },
        { key: 'r', title: 'Дүн', render: (e) => (e.results[0] ? <b>{Number(e.results[0].finalScore)}/{Number(e.maxScore)}</b> : e.attempts.some((a) => a.status === 'SUBMITTED') ? <Badge value="SUBMITTED">Үнэлж байна</Badge> : '—') },
        {
          key: 'x', title: '', render: (e) => {
            const active = e.attempts.find((a) => a.status === 'IN_PROGRESS' && new Date(a.deadlineAt) > now);
            const open = new Date(e.opensAt) <= now && now <= new Date(e.closesAt);
            if (active) return <button type="button" className="btn sm primary" onClick={() => navigate(`/my/attempts/${active.id}`)}>Үргэлжлүүлэх</button>;
            if (open && e.attempts.length < e.maxAttempts) {
              return <button type="button" className="btn sm primary" onClick={async () => { const a = await run(() => api(`/exams/${e.id}/attempts`, { method: 'POST' })); navigate(`/my/attempts/${a.id}`); }}>Эхлэх</button>;
            }
            return <span className="muted small">{now < new Date(e.opensAt) ? 'Нээгдээгүй' : 'Хаагдсан'}</span>;
          },
        },
      ]} />
    </>
  );
}

function AudioAnswer({ attemptId, question, existing, onSaved }) {
  const [recording, setRecording] = useState(false);
  const [run, busy] = useAction();
  const rec = useRef(null);
  const upload = async (blob, name) => {
    const form = new FormData();
    form.append('file', blob, name);
    await run(() => api(`/exams/attempts/${attemptId}/answers/${question.id}/audio`, { method: 'POST', form }), 'Аудио хадгалагдлаа');
    onSaved();
  };
  const toggle = async () => {
    if (recording) { rec.current.stop(); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      upload(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), 'speaking.webm');
    };
    mr.start();
    rec.current = mr;
    setRecording(true);
  };
  return (
    <div className="row" style={{ marginTop: 8 }}>
      {existing?.audioPath && <audio controls src={fileUrl(existing.audioPath)} />}
      {navigator.mediaDevices?.getUserMedia && window.MediaRecorder && (
        <button type="button" className={`btn ${recording ? 'danger' : ''}`} disabled={busy} onClick={() => toggle().catch(() => {})}>{recording ? '■ Зогсоож хадгалах' : '● Бичлэг хийх'}</button>
      )}
      <label className="btn sm">Файл сонгох<input type="file" accept="audio/*" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0], e.target.files[0].name)} /></label>
    </div>
  );
}

export function TakeExam() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: at, loading, error, reload } = useApi(`/exams/attempts/${id}`);
  const [answers, setAnswers] = useState({});
  const [left, setLeft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [run] = useAction();
  const toast = useToast();
  const offset = useRef(0);
  const submitted = useRef(false);

  useEffect(() => {
    if (!at) return;
    offset.current = new Date(at.serverTime).getTime() - Date.now();
    setAnswers(Object.fromEntries(at.answers.map((a) => [a.questionId, a])));
  }, [at]);

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    await run(() => api(`/exams/attempts/${id}/submit`, { method: 'POST' }), 'Шалгалт илгээгдлээ');
    navigate('/my/exams');
  }, [id, navigate, run]);

  // Серверийн цагаар тооцсон үлдсэн хугацаа; дуусахад автоматаар илгээнэ
  useEffect(() => {
    if (!at || at.status !== 'IN_PROGRESS') return undefined;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((new Date(at.deadlineAt).getTime() - (Date.now() + offset.current)) / 1000));
      setLeft(s);
      if (s === 0) { clearInterval(t); submit().catch(() => {}); }
    }, 500);
    return () => clearInterval(t);
  }, [at, submit]);

  const save = async (questionId, patch) => {
    setAnswers((a) => ({ ...a, [questionId]: { ...a[questionId], ...patch } }));
    setSaving(true);
    try {
      await api(`/exams/attempts/${id}/answers`, { method: 'PUT', body: { questionId, ...patch } });
    } catch (e) {
      toast(errorText(e), 'err');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !at) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (at.status !== 'IN_PROGRESS') {
    return (
      <>
        <PageHeader title={at.exam.title} />
        <div className="alert info">Энэ оролдлого илгээгдсэн ({label(at.status)}). {at.status === 'GRADED' && `Оноо: ${Number(at.totalScore)}/${Number(at.exam.maxScore)}`}</div>
        <Link className="btn" to="/my/exams">Буцах</Link>
      </>
    );
  }
  const mm = left === null ? '--' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <>
      <PageHeader title={at.exam.title} subtitle={`Оролдлого #${at.attemptNo} · хариулт автоматаар хадгалагдана${saving ? ' · хадгалж байна…' : ''}`}>
        <span className={`countdown ${left !== null && left < 60 ? 'bad' : ''}`} style={{ color: left !== null && left < 60 ? 'var(--bad)' : undefined }}>{mm}</span>
      </PageHeader>
      {at.exam.questions.map((q, i) => (
        <div key={q.id} className="question">
          <div><b>{i + 1}. {q.prompt}</b> <span className="muted small">({Number(q.points)} оноо)</span></div>
          {q.audioPath && <audio controls src={fileUrl(q.audioPath)} style={{ marginTop: 6 }} />}
          {q.questionType === 'MULTIPLE_CHOICE' && q.options.map((o) => (
            <label key={o.id} className="option">
              <input type="radio" name={`q${q.id}`} checked={answers[q.id]?.selectedOptionId === o.id} onChange={() => save(q.id, { selectedOptionId: o.id })} /> {o.optionText}
            </label>
          ))}
          {q.questionType === 'WRITING' && (
            <textarea rows={6} style={{ marginTop: 6 }} defaultValue={answers[q.id]?.textAnswer ?? ''} onBlur={(e) => save(q.id, { textAnswer: e.target.value })} placeholder="Хариултаа бичнэ үү (талбараас гарахад хадгалагдана)" />
          )}
          {q.questionType === 'SPEAKING' && <AudioAnswer attemptId={id} question={q} existing={answers[q.id]} onSaved={reload} />}
        </div>
      ))}
      <div className="row" style={{ marginTop: 16 }}>
        <span className="spacer" />
        <button type="button" className="btn primary lg" onClick={() => submit().catch(() => {})}>Шалгалт илгээх</button>
      </div>
    </>
  );
}

// ----- Эцэг эхийн хүсэлт -----
export function ParentRequests() {
  const { data, loading, error, reload } = useApi('/portal/requests');
  const children = useApi('/portal/children');
  const { values, bind } = useForm({ studentId: '', requestType: 'LEAVE', subject: '', message: '', leaveFrom: todayUb(), leaveTo: todayUb() });
  const [run, busy] = useAction();
  const verified = (children.data ?? []).filter((c) => c.verified);
  return (
    <>
      <PageHeader title="Чөлөө, лавлагааны хүсэлт" />
      <Card title="Шинэ хүсэлт">
        <form className="form" onSubmit={async (e) => {
          e.preventDefault();
          const body = { ...values, studentId: Number(values.studentId || verified[0]?.studentId) };
          if (body.requestType !== 'LEAVE') { delete body.leaveFrom; delete body.leaveTo; }
          await run(() => api('/portal/requests', { method: 'POST', body }), 'Хүсэлт илгээгдлээ');
          reload();
        }}>
          <Field label="Хүүхэд"><Select placeholder={null} {...bind('studentId')} options={verified.map((c) => ({ value: c.studentId, label: fullName(c.student) }))} /></Field>
          <Field label="Төрөл"><Select placeholder={null} {...bind('requestType')} options={['LEAVE', 'INQUIRY'].map((t) => ({ value: t, label: LABEL[t] }))} /></Field>
          {values.requestType === 'LEAVE' && (
            <>
              <Field label="Эхлэх огноо"><input type="date" required {...bind('leaveFrom')} /></Field>
              <Field label="Дуусах огноо"><input type="date" required {...bind('leaveTo')} /></Field>
            </>
          )}
          <Field label="Гарчиг" full><input required {...bind('subject')} /></Field>
          <Field label="Дэлгэрэнгүй" full><textarea rows={3} required {...bind('message')} /></Field>
          <div className="form-actions"><button className="btn primary" disabled={busy || !verified.length}>Илгээх</button></div>
        </form>
      </Card>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Card title="Миний хүсэлтүүд">
          <Table rows={data} empty="Хүсэлт алга" columns={[
            { key: 'd', title: 'Огноо', render: (r) => dateTime(r.createdAt) },
            { key: 's', title: 'Хүүхэд', render: (r) => r.student.firstName },
            { key: 't', title: 'Төрөл', render: (r) => label(r.requestType) },
            { key: 'sub', title: 'Гарчиг', render: (r) => <>{r.subject}{r.leaveFrom && <div className="muted small">{dateOnly(r.leaveFrom)} — {dateOnly(r.leaveTo)}</div>}</> },
            { key: 'st', title: 'Төлөв', render: (r) => <Badge value={r.status} /> },
            { key: 'res', title: 'Хариу', render: (r) => r.response ?? '—' },
          ]} />
        </Card>
      )}
    </>
  );
}
