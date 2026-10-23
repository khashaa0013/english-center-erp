// Нэвтрэх, нүүр, мэдэгдэл, профайл
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime, money, ROLE, time, todayUb } from '../lib/format.js';
import { Badge, Card, Empty, ErrorBox, Field, Loading, PageHeader, Stat, useAction, useApi } from '../components/ui.jsx';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <div className="auth-card">
        <h1>Алхам ERP</h1>
        <div className="muted">Англи хэлний сургалтын төвийн удирдлагын систем</div>
        <form className="form" onSubmit={submit}>
          <ErrorBox error={error} />
          <Field label="Нэвтрэх нэр">
            <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Нууц үг">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn primary lg" disabled={busy}>{busy ? 'Нэвтэрч байна…' : 'Нэвтрэх'}</button>
        </form>
        <div className="row small" style={{ marginTop: 16, justifyContent: 'space-between' }}>
          <Link to="/register">Сургалтад бүртгүүлэх</Link>
          <Link to="/verify">Гэрчилгээ шалгах</Link>
        </div>
      </div>
    </div>
  );
}

function TodaySessions({ teacher }) {
  const today = todayUb();
  const { data, loading, error } = useApi(`/sessions${qs({ from: today, to: today })}`);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data.filter((s) => s.status !== 'CANCELLED');
  if (!items.length) return <Empty>Өнөөдөр хичээл алга</Empty>;
  return items.map((s) => (
    <Link key={s.id} to={`/sessions/${s.id}`} className="session-item" style={{ color: 'inherit' }}>
      <span className="session-time">{time(s.startsAt)}–{time(s.endsAt)}</span>
      <span><b>{s.class.code}</b> · {s.class.course.name}</span>
      <span className="muted">{s.classroom.name} танхим{teacher ? '' : ` · ${s.teacher.lastName} ${s.teacher.firstName}`}</span>
      <span className="spacer" />
      <Badge value={s.status} />
    </Link>
  ));
}

function OfficeHome() {
  const { data, loading, error } = useApi('/reports/dashboard');
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Нүүр" subtitle={data ? `${data.from} — ${data.to} хугацааны үзүүлэлт` : ''}>
        <Link className="btn" to="/reports">Дэлгэрэнгүй тайлан</Link>
      </PageHeader>
      <ErrorBox error={error} />
      {loading ? <Loading /> : data && (
        <div className="grid stats">
          <Stat label="Идэвхтэй сурагч" value={data.total.students} />
          <Stat label="Идэвхтэй элсэлт" value={data.total.activeEnrollments} hint={`Энэ сард шинэ: ${data.total.newEnrollments}`} />
          <Stat label="Орлого" value={money(data.total.income)} tone="good" />
          <Stat label="Авлага" value={money(data.total.receivable)} hint={`Хугацаа хэтэрсэн: ${money(data.total.overdue)}`} tone={Number(data.total.overdue) > 0 ? 'bad' : ''} />
          <Stat label="Ирцийн хувь" value={data.total.attendance.rate === null ? '—' : `${data.total.attendance.rate}%`} />
          <Stat label="Батлах цаг" value={data.total.pendingHours} hint="Багшийн заасан цаг" tone={data.total.pendingHours ? 'warn' : ''} />
        </div>
      )}
      {user.role !== 'FINANCE' && (
        <Card title="Өнөөдрийн хичээлүүд" className="mt">
          <div style={{ marginTop: 4 }}><TodaySessions /></div>
        </Card>
      )}
    </>
  );
}

function TeacherHome() {
  const { user } = useAuth();
  const hours = useApi('/teaching-hours?status=PENDING');
  const load = useApi(user.teacherId ? `/teachers/${user.teacherId}/load` : null);
  return (
    <>
      <PageHeader title={`Сайн байна уу, ${user.displayName}`} subtitle="Өнөөдрийн хичээл, ирц, заасан цаг">
        <Link className="btn" to="/sessions">Долоо хоногийн хуваарь</Link>
      </PageHeader>
      {load.data && (
        <div className="grid stats" style={{ marginBottom: 16 }}>
          <Stat label="Энэ сарын төлөвлөсөн хичээл" value={load.data.plannedSessions} />
          <Stat label="Орсон хичээл" value={load.data.completedSessions} />
          <Stat label="Баталгаажсан цаг" value={`${Math.round(load.data.approvedMinutes / 6) / 10} ц`} />
          <Stat label="Батлагдаагүй" value={hours.data?.length ?? 0} tone={hours.data?.length ? 'warn' : ''} />
        </div>
      )}
      <Card title="Өнөөдрийн хичээлүүд"><TodaySessions teacher /></Card>
    </>
  );
}

export function Home() {
  const { user } = useAuth();
  if (['STUDENT', 'PARENT'].includes(user.role)) return <Navigate to="/portal" replace />;
  if (user.role === 'TEACHER') return <TeacherHome />;
  return <OfficeHome />;
}

export function Notifications() {
  const { data, loading, error, reload } = useApi('/notifications');
  const [run] = useAction();
  const navigate = useNavigate();
  const open = async (n) => {
    if (!n.isRead) await api(`/notifications/${n.id}/read`, { method: 'POST' });
    if (n.link) navigate(n.link);
    else reload();
  };
  return (
    <>
      <PageHeader title="Мэдэгдэл">
        <button type="button" className="btn" onClick={() => run(() => api('/notifications/read-all', { method: 'POST' })).then(reload)}>Бүгдийг уншсан</button>
      </PageHeader>
      <ErrorBox error={error} />
      {loading ? <Loading /> : !data.items.length ? <Empty>Мэдэгдэл алга</Empty> : data.items.map((n) => (
        <button type="button" key={n.id} className="session-item" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', fontWeight: n.isRead ? 400 : 600 }} onClick={() => open(n)}>
          {!n.isRead && <Badge value="NEW">Шинэ</Badge>}
          <span>
            <div>{n.title}</div>
            {n.body && <div className="muted small" style={{ fontWeight: 400 }}>{n.body}</div>}
          </span>
          <span className="spacer" />
          <span className="muted small nowrap">{dateTime(n.createdAt)}</span>
        </button>
      ))}
    </>
  );
}

export function Profile() {
  const { user } = useAuth();
  const [run, busy] = useAction();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return run(() => Promise.reject(new Error('Шинэ нууц үг таарахгүй байна')));
    await run(() => api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } }), 'Нууц үг солигдлоо');
    setForm({ currentPassword: '', newPassword: '', confirm: '' });
  };
  return (
    <>
      <PageHeader title="Миний профайл" />
      <div className="grid two">
        <Card title="Мэдээлэл">
          <dl className="kv">
            <dt>Нэр</dt><dd>{user.displayName}</dd>
            <dt>Нэвтрэх нэр</dt><dd className="mono">{user.username}</dd>
            <dt>Эрх</dt><dd>{ROLE[user.role]}</dd>
            <dt>Салбар</dt><dd>{user.branch?.name ?? 'Бүх салбар'}</dd>
            <dt>Сүүлд нэвтэрсэн</dt><dd>{dateTime(user.lastLoginAt)}</dd>
          </dl>
        </Card>
        <Card title="Нууц үг солих">
          <form className="form" onSubmit={submit}>
            <Field label="Одоогийн нууц үг" full><input type="password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></Field>
            <Field label="Шинэ нууц үг (8+ тэмдэгт)"><input type="password" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></Field>
            <Field label="Шинэ нууц үг давтах"><input type="password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></Field>
            <div className="form-actions"><button className="btn primary" disabled={busy}>Солих</button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
