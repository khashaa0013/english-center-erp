// M6 — Багшийн удирдлага
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { isStaff, useAuth } from '../lib/auth.jsx';
import { addDays, DAYS, dateOnly, dateTime, fullName, LABEL, money, todayUb } from '../lib/format.js';
import {
  Badge, Card, clean, ErrorBox, Field, Loading, Modal, PageHeader, ReasonModal, Select, Stat, Table, Tabs, useAction, useApi, useForm,
} from '../components/ui.jsx';
import { BranchSelect } from './leads.jsx';

export function TeachersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, loading, error } = useApi(`/teachers${qs({ q })}`);
  const courses = useApi(isStaff(user) ? '/catalog/courses?active=1' : null);
  const [creating, setCreating] = useState(false);
  const { values, bind, set } = useForm({ branchId: '', lastName: '', firstName: '', phone: '', hiredOn: '', username: '', password: '', email: '', courseIds: [] });
  const [run, busy] = useAction();
  return (
    <>
      <PageHeader title="Багш нар">
        {isStaff(user) && <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Шинэ багш</button>}
      </PageHeader>
      <div className="filters"><input placeholder="Нэр, код хайх" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(t) => navigate(`/teachers/${t.id}`)} columns={[
          { key: 'teacherCode', title: 'Код', className: 'mono' },
          { key: 'n', title: 'Нэр', render: fullName },
          { key: 'phone', title: 'Утас' },
          { key: 'c', title: 'Заах курс', render: (t) => t.courses.map((c) => c.course.code).join(', ') || '—' },
          { key: 'r', title: 'Одоогийн ставк', className: 'right', render: (t) => (t.rates[0] ? `${money(t.rates[0].hourlyRate)}/ц` : '—') },
          { key: 'cl', title: 'Идэвхтэй анги', render: (t) => t._count.classes },
          { key: 's', title: 'Төлөв', render: (t) => <Badge value={t.status} /> },
        ]} />
      )}
      {creating && (
        <Modal title="Шинэ багш" onClose={() => setCreating(false)} wide>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api('/teachers', { method: 'POST', body: { ...clean({ ...values, courseIds: undefined }, ['branchId']), courseIds: values.courseIds.map(Number) } }), `Бүртгэгдлээ. Нэвтрэх нэр: ${values.username}`);
            navigate(`/teachers/${r.id}`);
          }}>
            <BranchSelect {...bind('branchId')} />
            <Field label="Овог"><input required {...bind('lastName')} /></Field>
            <Field label="Нэр"><input required {...bind('firstName')} /></Field>
            <Field label="Утас"><input {...bind('phone')} /></Field>
            <Field label="Ажилд орсон"><input type="date" {...bind('hiredOn')} /></Field>
            <Field label="Нэвтрэх нэр"><input required pattern="[a-zA-Z0-9._\-]{3,50}" {...bind('username')} /></Field>
            <Field label="Анхны нууц үг"><input required minLength={8} {...bind('password')} /></Field>
            <Field label="И-мэйл"><input type="email" {...bind('email')} /></Field>
            <Field label="Заах курс" full>
              <div className="row">
                {(courses.data ?? []).map((c) => (
                  <label key={c.id} className="check">
                    <input type="checkbox" checked={values.courseIds.includes(c.id)} onChange={(e) => set('courseIds', e.target.checked ? [...values.courseIds, c.id] : values.courseIds.filter((x) => x !== c.id))} /> {c.code}
                  </label>
                ))}
              </div>
            </Field>
            <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

function AvailabilityEditor({ teacher, onSaved }) {
  const [slots, setSlots] = useState(teacher.availability.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime })));
  const [run, busy] = useAction();
  const update = (i, patch) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      <div className="muted small" style={{ marginBottom: 8 }}>Боломжит цаг бүртгэсэн бол хуваарь зөвхөн энэ хүрээнд тавигдана. Хоосон бол хязгааргүй.</div>
      {slots.map((s, i) => (
        <div key={i} className="row" style={{ marginBottom: 6 }}>
          <select value={s.dayOfWeek} onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })} style={{ width: 130 }}>
            {DAYS.slice(1).map((d, k) => <option key={d} value={k + 1}>{d}</option>)}
          </select>
          <input type="time" value={s.startTime} onChange={(e) => update(i, { startTime: e.target.value })} style={{ width: 120 }} />
          <input type="time" value={s.endTime} onChange={(e) => update(i, { endTime: e.target.value })} style={{ width: 120 }} />
          <button type="button" className="btn sm ghost" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn sm" onClick={() => setSlots([...slots, { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }])}>+ Цаг</button>
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => run(() => api(`/teachers/${teacher.id}/availability`, { method: 'PUT', body: { slots } }), 'Хадгаллаа').then(onSaved)}>Хадгалах</button>
      </div>
    </>
  );
}

function LoadStats({ teacherId }) {
  const [from, setFrom] = useState(`${todayUb().slice(0, 8)}01`);
  const [to, setTo] = useState(todayUb());
  const { data } = useApi(`/teachers/${teacherId}/load${qs({ from, to })}`);
  return (
    <>
      <div className="filters">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {data && (
        <div className="grid stats">
          <Stat label="Төлөвлөсөн хичээл" value={data.plannedSessions} hint={`${Math.round(data.plannedMinutes / 6) / 10} цаг`} />
          <Stat label="Орсон хичээл" value={data.completedSessions} hint={`Цуцлагдсан: ${data.cancelledSessions}`} />
          <Stat label="Бодит цаг" value={`${Math.round(data.actualMinutes / 6) / 10} ц`} />
          <Stat label="Баталгаажсан цаг" value={`${Math.round(data.approvedMinutes / 6) / 10} ц`} tone="good" hint={`Батлагдаагүй: ${data.pendingHours}`} />
          <Stat label="Баталгаажсан хөлс" value={money(data.approvedAmount)} />
        </div>
      )}
    </>
  );
}

function TeacherView({ id, self }) {
  const { user } = useAuth();
  const staff = isStaff(user);
  const { data: t, loading, error, reload } = useApi(`/teachers/${id}`);
  const courses = useApi(staff ? '/catalog/courses?active=1' : null);
  const [tab, setTab] = useState('load');
  const [editing, setEditing] = useState(false);
  const [run] = useAction();
  const { values: rate, bind: bindRate } = useForm({ hourlyRate: '', effectiveFrom: todayUb() });
  if (loading && !t) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const courseIds = t.courses.map((c) => c.course.id);
  return (
    <>
      <PageHeader title={fullName(t)} subtitle={<><span className="mono">{t.teacherCode}</span> · {t.branch.name} · {t.phone ?? ''} · нэвтрэх нэр <span className="mono">{t.user.username}</span> · <Badge value={t.status} /></>}>
        {staff && <button type="button" className="btn" onClick={() => setEditing(true)}>Засах</button>}
        {self && <Link className="btn" to="/teaching-hours">Миний заасан цаг</Link>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'load', label: 'Ачаалал' }, { key: 'classes', label: 'Анги', count: t.classes.length }, { key: 'availability', label: 'Боломжит цаг' },
        { key: 'rates', label: 'Ставк' }, ...(staff ? [{ key: 'courses', label: 'Заах курс' }] : []),
      ]} />
      {tab === 'load' && <LoadStats teacherId={t.id} />}
      {tab === 'classes' && (
        <Table rows={t.classes} empty="Анги алга" columns={[
          { key: 'code', title: 'Код', render: (c) => <Link to={`/classes/${c.id}`}>{c.code}</Link> },
          { key: 'c', title: 'Курс', render: (c) => c.course.name },
          { key: 'd', title: 'Хугацаа', render: (c) => `${dateOnly(c.startDate)} — ${dateOnly(c.endDate)}` },
          { key: 's', title: 'Төлөв', render: (c) => <Badge value={c.status} /> },
        ]} />
      )}
      {tab === 'availability' && <Card><AvailabilityEditor teacher={t} onSaved={reload} /></Card>}
      {tab === 'rates' && (
        <>
          {staff && (
            <Card title="Шинэ ставк">
              <form className="form" onSubmit={async (e) => {
                e.preventDefault();
                await run(() => api(`/teachers/${t.id}/rates`, { method: 'POST', body: clean(rate, ['hourlyRate']) }), 'Ставк нэмэгдлээ. Өмнөх ставк хаагдлаа.');
                reload();
              }}>
                <Field label="Цагийн хөлс (₮)"><input type="number" min="1" required {...bindRate('hourlyRate')} /></Field>
                <Field label="Хүчинтэй эхлэх огноо"><input type="date" required {...bindRate('effectiveFrom')} /></Field>
                <div className="form-actions"><button className="btn primary">Нэмэх</button></div>
              </form>
            </Card>
          )}
          <Card title="Ставкийн түүх">
            <Table rows={t.rates} empty="Ставк бүртгээгүй" columns={[
              { key: 'r', title: 'Цагийн хөлс', className: 'right', render: (r) => money(r.hourlyRate) },
              { key: 'f', title: 'Эхлэх', render: (r) => dateOnly(r.effectiveFrom) },
              { key: 't', title: 'Дуусах', render: (r) => (r.effectiveTo ? dateOnly(r.effectiveTo) : <Badge value="ACTIVE">Одоо хүчинтэй</Badge>) },
              { key: 'b', title: 'Бүртгэсэн', render: (r) => r.creator.displayName },
            ]} />
          </Card>
        </>
      )}
      {tab === 'courses' && (
        <Card title="Заах курс">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const ids = [...new FormData(e.target).getAll('course')].map(Number);
            await run(() => api(`/teachers/${t.id}/courses`, { method: 'PUT', body: { courseIds: ids } }), 'Хадгаллаа');
            reload();
          }}>
            <div className="row">
              {(courses.data ?? []).map((c) => <label key={c.id} className="check"><input type="checkbox" name="course" value={c.id} defaultChecked={courseIds.includes(c.id)} /> {c.code} — {c.name}</label>)}
            </div>
            <div className="form-actions"><button className="btn primary">Хадгалах</button></div>
          </form>
        </Card>
      )}
      {editing && <TeacherEdit teacher={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}

function TeacherEdit({ teacher, onClose, onSaved }) {
  const { values, bind } = useForm({ lastName: teacher.lastName, firstName: teacher.firstName, phone: teacher.phone ?? '', hiredOn: dateOnly(teacher.hiredOn) === '—' ? '' : dateOnly(teacher.hiredOn), status: teacher.status });
  const [run, busy] = useAction();
  return (
    <Modal title="Багш засах" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        await run(() => api(`/teachers/${teacher.id}`, { method: 'PUT', body: clean(values) }), 'Хадгаллаа');
        onSaved();
      }}>
        <Field label="Овог"><input required {...bind('lastName')} /></Field>
        <Field label="Нэр"><input required {...bind('firstName')} /></Field>
        <Field label="Утас"><input {...bind('phone')} /></Field>
        <Field label="Ажилд орсон"><input type="date" {...bind('hiredOn')} /></Field>
        <Field label="Төлөв"><Select placeholder={null} {...bind('status')} options={['ACTIVE', 'INACTIVE'].map((s) => ({ value: s, label: LABEL[s] }))} /></Field>
        <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
      </form>
    </Modal>
  );
}

export function TeacherDetail() {
  const { id } = useParams();
  return <TeacherView id={id} />;
}

export function MyTeacherProfile() {
  const { user } = useAuth();
  return <TeacherView id={user.teacherId} self />;
}

// ----- Заасан цаг -----
export function HoursPage() {
  const { user } = useAuth();
  const staff = isStaff(user);
  const [filter, setFilter] = useState({ status: staff ? 'PENDING' : '', from: addDays(todayUb(), -60), to: todayUb() });
  const { data, loading, error, reload } = useApi(`/teaching-hours${qs(filter)}`);
  const [run] = useAction();
  const [modal, setModal] = useState(null);
  return (
    <>
      <PageHeader title={user.role === 'TEACHER' ? 'Миний заасан цаг' : 'Багшийн заасан цаг'} subtitle="Хичээл дуусахад бүртгэгдэнэ → админ баталгаажуулна → санхүү хөлс тооцно" />
      <div className="filters">
        <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} placeholder="Бүх төлөв" options={['PENDING', 'APPROVED', 'REJECTED'].map((s) => ({ value: s, label: LABEL[s] }))} />
        <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
        <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} columns={[
          { key: 'd', title: 'Хичээл', render: (h) => <Link to={`/sessions/${h.classSession.id}`}>{dateTime(h.classSession.startsAt)}</Link> },
          ...(user.role !== 'TEACHER' ? [{ key: 't', title: 'Багш', render: (h) => fullName(h.teacher) }] : []),
          { key: 'c', title: 'Анги', render: (h) => h.classSession.class.code },
          { key: 'p', title: 'Төлөвлөсөн', render: (h) => `${h.plannedMinutes} мин` },
          { key: 'a', title: 'Бодит', render: (h) => <>{h.actualMinutes} мин{h.actualMinutes !== h.plannedMinutes && <Badge value="LATE">зөрүү</Badge>}</> },
          { key: 'amt', title: 'Дүн', className: 'right', render: (h) => (h.amount ? money(h.amount) : '—') },
          { key: 's', title: 'Төлөв', render: (h) => <><Badge value={h.status} />{h.note && <div className="muted small">{h.note}</div>}</> },
          {
            key: 'x', title: '', render: (h) => (
              <div className="row">
                {h.status === 'PENDING' && (user.role === 'TEACHER' || staff) && <button type="button" className="btn sm" onClick={() => setModal({ edit: h })}>Засах</button>}
                {h.status === 'PENDING' && staff && <button type="button" className="btn sm primary" onClick={() => run(() => api(`/teaching-hours/${h.id}/approve`, { method: 'POST' }), 'Баталгаажлаа').then(reload)}>Батлах</button>}
                {h.status === 'PENDING' && staff && <button type="button" className="btn sm danger" onClick={() => setModal({ reject: h })}>Татгалзах</button>}
                {h.status !== 'PENDING' && staff && !h.payoutId && <button type="button" className="btn sm" onClick={() => setModal({ reopen: h })}>Дахин хянах</button>}
                {h.payoutId && <span className="muted small">Тооцоо #{h.payoutId}</span>}
              </div>
            ),
          },
        ]} />
      )}
      {modal?.edit && (
        <Modal title="Бодит заасан цаг" onClose={() => setModal(null)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => api(`/teaching-hours/${modal.edit.id}`, { method: 'PUT', body: { actualMinutes: Number(e.target.m.value), note: e.target.note.value } }), 'Хадгаллаа');
            setModal(null);
            reload();
          }}>
            <Field label="Минут"><input name="m" type="number" min="1" defaultValue={modal.edit.actualMinutes} /></Field>
            <Field label="Тайлбар"><input name="note" defaultValue={modal.edit.note ?? ''} /></Field>
            <div className="form-actions"><button className="btn primary">Хадгалах</button></div>
          </form>
        </Modal>
      )}
      {modal?.reject && <ReasonModal title="Цаг татгалзах" submitLabel="Татгалзах" onClose={() => setModal(null)} onSubmit={async (reason) => { await run(() => api(`/teaching-hours/${modal.reject.id}/reject`, { method: 'POST', body: { reason } }), 'Татгалзлаа'); reload(); }} />}
      {modal?.reopen && <ReasonModal title="Дахин хянах төлөвт буцаах" onClose={() => setModal(null)} onSubmit={async (reason) => { await run(() => api(`/teaching-hours/${modal.reopen.id}/reopen`, { method: 'POST', body: { reason } }), 'Буцаалаа'); reload(); }} />}
    </>
  );
}
