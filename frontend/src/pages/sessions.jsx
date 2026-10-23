// M4/M2 — Хичээлийн хуваарь, хичээл эхлүүлэх, QR ирц, баталгаажуулах, дуусгах
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { isStaff, useAuth } from '../lib/auth.jsx';
import { addDays, date, DAYS, fullName, label, LABEL, time, todayUb } from '../lib/format.js';
import {
  Badge, Card, clean, Empty, ErrorBox, Field, Loading, Modal, PageHeader, ReasonModal, Select, Table, useAction, useApi, useForm,
} from '../components/ui.jsx';

const ATT = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

function mondayOf(d) {
  const x = new Date(`${d}T00:00:00Z`);
  const dow = (x.getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}

function AdhocSessionModal({ onClose, onSaved }) {
  const classes = useApi('/classes?status=IN_PROGRESS');
  const open = useApi('/classes?status=OPEN');
  const rooms = useApi('/catalog/classrooms?active=1');
  const teachers = useApi('/teachers?status=ACTIVE');
  const { values, bind } = useForm({ classId: '', date: todayUb(), startTime: '18:00', endTime: '19:30', classroomId: '', teacherId: '', topic: '' });
  const [run, busy] = useAction();
  const list = [...(classes.data ?? []), ...(open.data ?? [])];
  return (
    <Modal title="Нэмэлт / нөхөх хичээл" onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        await run(() => api('/sessions', { method: 'POST', body: clean(values, ['classId', 'classroomId', 'teacherId']) }), 'Хичээл нэмэгдлээ. Сурагч, эцэг эхэд мэдэгдэл очлоо.');
        onSaved();
      }}>
        <Field label="Анги" full><Select required {...bind('classId')} options={list.map((c) => ({ value: c.id, label: `${c.code} — ${c.course.name}` }))} /></Field>
        <Field label="Огноо"><input type="date" required {...bind('date')} /></Field>
        <Field label="Эхлэх"><input type="time" required {...bind('startTime')} /></Field>
        <Field label="Дуусах"><input type="time" required {...bind('endTime')} /></Field>
        <Field label="Танхим"><Select {...bind('classroomId')} placeholder="Ангийн үндсэн танхим" options={(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="Багш (орлох)"><Select {...bind('teacherId')} placeholder="Ангийн үндсэн багш" options={(teachers.data ?? []).map((t) => ({ value: t.id, label: fullName(t) }))} /></Field>
        <Field label="Сэдэв" full><input {...bind('topic')} /></Field>
        <div className="form-actions"><button className="btn primary" disabled={busy}>Нэмэх (зөрчил шалгана)</button></div>
      </form>
    </Modal>
  );
}

export function SessionsPage() {
  const { user } = useAuth();
  const [week, setWeek] = useState(mondayOf(todayUb()));
  const to = addDays(week, 6);
  const { data, loading, error, reload } = useApi(`/sessions${qs({ from: week, to })}`);
  const [adding, setAdding] = useState(false);

  const byDay = {};
  for (const s of data ?? []) (byDay[date(s.startsAt)] ??= []).push(s);

  return (
    <>
      <PageHeader title={user.role === 'TEACHER' ? 'Миний хичээлийн хуваарь' : 'Хичээлийн хуваарь'} subtitle={`${week} — ${to}`}>
        <button type="button" className="btn" onClick={() => setWeek(addDays(week, -7))}>← Өмнөх</button>
        <button type="button" className="btn" onClick={() => setWeek(mondayOf(todayUb()))}>Энэ долоо хоног</button>
        <button type="button" className="btn" onClick={() => setWeek(addDays(week, 7))}>Дараах →</button>
        {isStaff(user) && <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Нэмэлт хичээл</button>}
      </PageHeader>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data.length ? <Empty>Энэ долоо хоногт хичээл алга</Empty> : (
        Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d) => byDay[d]).map((d) => (
          <div key={d} className="day-group">
            <div className="day-title">{DAYS[((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1]}, {d}{d === todayUb() ? ' · Өнөөдөр' : ''}</div>
            {byDay[d].map((s) => (
              <Link key={s.id} to={`/sessions/${s.id}`} className="session-item" style={{ color: 'inherit', opacity: s.status === 'CANCELLED' ? 0.55 : 1 }}>
                <span className="session-time">{time(s.startsAt)}–{time(s.endsAt)}</span>
                <span><b>{s.class.code}</b> · {s.class.course.name}</span>
                <span className="muted">{s.classroom.name} · {fullName(s.teacher)}</span>
                <span className="spacer" />
                <Badge value={s.status} />
              </Link>
            ))}
          </div>
        ))
      )}
      {adding && <AdhocSessionModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

// ----- QR самбар: хугацаа дуусахаас 5 сек өмнө автоматаар шинэчилнэ -----
function QrPanel({ sessionId }) {
  const [qr, setQr] = useState(null);
  const [left, setLeft] = useState(0);
  const [auto, setAuto] = useState(true);
  const [run] = useAction();
  const timer = useRef(null);

  const issue = useCallback(async () => {
    const r = await run(() => api(`/sessions/${sessionId}/qr`, { method: 'POST' }));
    setQr(r);
  }, [run, sessionId]);

  useEffect(() => {
    clearInterval(timer.current);
    if (!qr) return undefined;
    timer.current = setInterval(() => {
      const s = Math.max(0, Math.round((new Date(qr.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (auto && s <= 5) { clearInterval(timer.current); issue().catch(() => {}); }
    }, 500);
    return () => clearInterval(timer.current);
  }, [qr, auto, issue]);

  return (
    <Card title="QR ирц" className="qr-panel">
      {!qr ? (
        <button type="button" className="btn primary lg" onClick={() => issue().catch(() => {})}>QR код гаргах</button>
      ) : (
        <>
          <img src={qr.qrDataUrl} alt="Ирцийн QR код" style={{ opacity: left === 0 ? 0.2 : 1 }} />
          <div className="countdown">{left > 0 ? `${left} сек` : 'Хугацаа дууссан'}</div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
            <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Автоматаар шинэчлэх</label>
            <button type="button" className="btn sm" onClick={() => issue().catch(() => {})}>Шинэ QR</button>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>Сурагч утаснаасаа нэвтрээд «QR ирц» цэсээр уншуулна. QR богино хугацаатай тул дамжуулж уншуулах эрсдэл багасна.</div>
        </>
      )}
    </Card>
  );
}

function CorrectModal({ attendance, onClose, onSaved }) {
  const [status, setStatus] = useState(attendance.status);
  const [run] = useAction();
  return (
    <ReasonModal
      title={`Ирц залруулах: ${fullName(attendance.student)}`}
      onClose={onClose}
      extra={<Field label="Шинэ төлөв" full><Select placeholder={null} value={status} onChange={(e) => setStatus(e.target.value)} options={ATT.map((s) => ({ value: s, label: LABEL[s] }))} /></Field>}
      onSubmit={async (reason) => {
        await run(() => api(`/attendance/${attendance.id}`, { method: 'PUT', body: { status, reason } }), 'Залруулсан. Эцэг эхэд мэдэгдэл очлоо.');
        onSaved();
      }}
    />
  );
}

export function SessionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: s, loading, error, reload } = useApi(`/sessions/${id}`);
  const [run, busy] = useAction();
  const [marks, setMarks] = useState({});
  const [correcting, setCorrecting] = useState(null);
  const [modal, setModal] = useState(null);
  const staff = isStaff(user);

  // Хичээл явагдаж байхад сурагчдын QR уншилтыг 5 сек тутам шинэчилнэ
  useEffect(() => {
    if (s?.status !== 'IN_PROGRESS') return undefined;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [s?.status, reload]);

  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const byStudent = Object.fromEntries(s.attendance.map((a) => [a.studentId, a]));
  const unconfirmed = s.roster.filter((st) => !byStudent[st.id]?.confirmedAt).length;
  const scanned = s.attendance.filter((a) => a.method === 'QR').length;

  const confirm = async () => {
    const list = Object.entries(marks).map(([studentId, status]) => ({ studentId: Number(studentId), status }));
    const r = await run(() => api(`/sessions/${s.id}/attendance/confirm`, { method: 'POST', body: { marks: list } }), 'Ирц баталгаажлаа');
    setMarks({});
    reload();
    return r;
  };

  return (
    <>
      <PageHeader
        title={`${s.class.code} · ${date(s.startsAt)} ${time(s.startsAt)}–${time(s.endsAt)}`}
        subtitle={<>{s.class.course.name} · {s.classroom.name} танхим · {fullName(s.teacher)} · <Badge value={s.status} /></>}
      >
        <Link className="btn" to={`/classes/${s.class.id}?tab=sessions`}>Анги</Link>
        {s.status === 'SCHEDULED' && <button type="button" className="btn primary" disabled={busy} onClick={() => run(() => api(`/sessions/${s.id}/start`, { method: 'POST' }), 'Хичээл эхэллээ').then(reload)}>Хичээл эхлүүлэх</button>}
        {s.status === 'SCHEDULED' && staff && <button type="button" className="btn" onClick={() => setModal('reschedule')}>Цаг өөрчлөх</button>}
        {s.status === 'SCHEDULED' && staff && <button type="button" className="btn danger" onClick={() => setModal('cancel')}>Цуцлах</button>}
        {s.status === 'IN_PROGRESS' && <button type="button" className="btn primary" disabled={unconfirmed > 0} title={unconfirmed ? 'Эхлээд ирцийг баталгаажуулна уу' : ''} onClick={() => setModal('complete')}>Хичээл дуусгах</button>}
      </PageHeader>

      <div className="grid two">
        {s.status === 'IN_PROGRESS' && <QrPanel sessionId={s.id} />}
        <Card title={`Ирц (${s.attendance.length}/${s.roster.length}, QR-аар ${scanned})`}
          actions={['IN_PROGRESS', 'COMPLETED'].includes(s.status) && unconfirmed > 0 && <button type="button" className="btn primary" disabled={busy} onClick={() => confirm().catch(() => {})}>Ирц баталгаажуулах</button>}>
          {s.status === 'IN_PROGRESS' && unconfirmed > 0 && <div className="alert info small">QR уншуулаагүй сурагчийг гараар тэмдэглэнэ. Тэмдэглээгүй бол «Тасалсан» болно. Хоцролтын босго: {s.lateThresholdMinutes} мин.</div>}
          <Table rows={s.roster} empty="Ангид баталгаажсан сурагч алга" columns={[
            { key: 'n', title: 'Сурагч', render: (st) => fullName(st) },
            {
              key: 's', title: 'Төлөв', render: (st) => {
                const a = byStudent[st.id];
                if (a?.confirmedAt) return <><Badge value={a.status} />{a.lateMinutes ? <span className="muted small"> {a.lateMinutes} мин</span> : null}</>;
                if (s.status === 'SCHEDULED') return <span className="muted">—</span>;
                return (
                  <Select placeholder={a ? `${label(a.status)} (QR ${time(a.checkedInAt)})` : '— Тасалсан —'} value={marks[st.id] ?? ''}
                    onChange={(e) => setMarks({ ...marks, [st.id]: e.target.value || undefined })} options={ATT.map((x) => ({ value: x, label: LABEL[x] }))} />
                );
              },
            },
            { key: 'm', title: 'Арга', render: (st) => (byStudent[st.id] ? label(byStudent[st.id].method) : '—') },
            {
              key: 'c', title: 'Залруулга', render: (st) => {
                const a = byStudent[st.id];
                if (!a?.confirmedAt) return null;
                return (
                  <div>
                    {a.corrections.map((c) => <div key={c.id} className="muted small">{label(c.oldStatus)}→{label(c.newStatus)}: {c.reason} ({c.corrector.displayName})</div>)}
                    <button type="button" className="btn sm" onClick={() => setCorrecting({ ...a, student: st })}>Залруулах</button>
                  </div>
                );
              },
            },
          ]} />
        </Card>
        {s.teachingHour && (
          <Card title="Заасан цаг (M6)">
            <dl className="kv">
              <dt>Төлөвлөсөн</dt><dd>{s.teachingHour.plannedMinutes} мин</dd>
              <dt>Бодит</dt><dd>{s.teachingHour.actualMinutes} мин</dd>
              <dt>Төлөв</dt><dd><Badge value={s.teachingHour.status} /></dd>
              <dt>Сэдэв</dt><dd>{s.topic ?? '—'}</dd>
            </dl>
          </Card>
        )}
      </div>

      {correcting && <CorrectModal attendance={correcting} onClose={() => setCorrecting(null)} onSaved={reload} />}
      {modal === 'cancel' && (
        <ReasonModal title="Хичээл цуцлах" submitLabel="Цуцлах" onClose={() => setModal(null)}
          onSubmit={async (reason) => { await run(() => api(`/sessions/${s.id}/cancel`, { method: 'POST', body: { reason } }), 'Цуцлагдлаа. Мэдэгдэл очлоо.'); reload(); }} />
      )}
      {modal === 'reschedule' && <RescheduleModal session={s} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'complete' && (
        <Modal title="Хичээл дуусгах" onClose={() => setModal(null)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => api(`/sessions/${s.id}/complete`, { method: 'POST', body: clean({ actualMinutes: e.target.actualMinutes.value, topic: e.target.topic.value }, ['actualMinutes']) }), 'Хичээл дууслаа. Заасан цаг батлуулахаар илгээгдлээ.');
            setModal(null);
            reload();
          }}>
            <Field label="Бодит заасан минут"><input name="actualMinutes" type="number" min="1" defaultValue={Math.round((new Date(s.endsAt) - new Date(s.startsAt)) / 60000)} /></Field>
            <Field label="Орсон сэдэв"><input name="topic" defaultValue={s.topic ?? ''} /></Field>
            <div className="form-actions"><button className="btn primary">Дуусгах</button></div>
          </form>
        </Modal>
      )}
      <div style={{ marginTop: 16 }}><button type="button" className="btn ghost sm" onClick={() => navigate(-1)}>← Буцах</button></div>
    </>
  );
}

function RescheduleModal({ session, onClose, onSaved }) {
  const rooms = useApi('/catalog/classrooms?active=1');
  const teachers = useApi('/teachers?status=ACTIVE');
  const [run] = useAction();
  const [form, setForm] = useState({ date: date(session.startsAt), startTime: time(session.startsAt), endTime: time(session.endsAt), classroomId: '', teacherId: '' });
  return (
    <ReasonModal
      title="Хичээлийн цаг, танхим, багш өөрчлөх"
      onClose={onClose}
      extra={(
        <>
          <Field label="Огноо"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Эхлэх"><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
          <Field label="Дуусах"><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
          <Field label="Танхим"><Select value={form.classroomId} onChange={(e) => setForm({ ...form, classroomId: e.target.value })} placeholder="Өөрчлөхгүй" options={(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
          <Field label="Орлох багш"><Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} placeholder="Өөрчлөхгүй" options={(teachers.data ?? []).map((t) => ({ value: t.id, label: fullName(t) }))} /></Field>
        </>
      )}
      onSubmit={async (reason) => {
        await run(() => api(`/sessions/${session.id}`, { method: 'PUT', body: { ...clean(form, ['classroomId', 'teacherId']), reason } }), 'Өөрчлөгдлөө. Мэдэгдэл очлоо.');
        onSaved();
      }}
    />
  );
}
