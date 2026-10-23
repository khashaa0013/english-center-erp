// M7 — Удирдлага ба салбар: салбар, хэрэглэгч, audit, тайлан; M4 гэрчилгээ; M5 хүсэлт
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authUrl, fileUrl, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { addDays, date, dateOnly, dateTime, fullName, label, LABEL, money, ROLE, todayUb } from '../lib/format.js';
import {
  Badge, Card, clean, ErrorBox, Field, Loading, Modal, PageHeader, ReasonModal, Select, Stat, Table, useAction, useApi, useForm,
} from '../components/ui.jsx';

// ----- Салбар -----
function BranchForm({ branch, onClose, onSaved }) {
  const { user } = useAuth();
  const { values, bind } = useForm({ code: '', name: '', address: '', phone: '', lateThresholdMinutes: 10, qrTtlSeconds: 60, isActive: true, ...(branch ?? {}) });
  const [run, busy] = useAction();
  const superAdmin = user.role === 'SUPER_ADMIN';
  return (
    <Modal title={branch ? 'Салбар засах' : 'Шинэ салбар'} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const body = clean({ code: values.code, name: values.name, address: values.address, phone: values.phone, lateThresholdMinutes: values.lateThresholdMinutes, qrTtlSeconds: values.qrTtlSeconds }, ['lateThresholdMinutes', 'qrTtlSeconds']);
        if (superAdmin) body.isActive = Boolean(values.isActive);
        await run(() => (branch ? api(`/branches/${branch.id}`, { method: 'PUT', body }) : api('/branches', { method: 'POST', body })), 'Хадгаллаа');
        onSaved();
      }}>
        <Field label="Код"><input required disabled={branch && !superAdmin} {...bind('code')} /></Field>
        <Field label="Нэр"><input required {...bind('name')} /></Field>
        <Field label="Хаяг"><input {...bind('address')} /></Field>
        <Field label="Утас"><input {...bind('phone')} /></Field>
        <Field label="Хоцролтын босго (мин)" hint="Хичээл эхэлснээс хойш энэ хугацааны дараа уншуулбал «Хоцорсон»"><input type="number" min="0" max="120" {...bind('lateThresholdMinutes')} /></Field>
        <Field label="QR хүчинтэй хугацаа (сек)" hint="15–600"><input type="number" min="15" max="600" {...bind('qrTtlSeconds')} /></Field>
        {superAdmin && <Field label="Идэвхтэй"><span className="check"><input type="checkbox" {...bind('isActive', { type: 'checkbox' })} /> Тийм</span></Field>}
        <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
      </form>
    </Modal>
  );
}

export function BranchesPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/branches');
  const [editing, setEditing] = useState(null);
  const [run] = useAction();
  const upload = async (b, kind, file) => {
    const form = new FormData();
    form.append('file', file);
    await run(() => api(`/branches/${b.id}/branding/${kind}`, { method: 'POST', form }), 'Зураг хадгалагдлаа');
    reload();
  };
  return (
    <>
      <PageHeader title="Салбар" subtitle="Тамга, гарын үсгийн зураг гэрээ, гэрчилгээний PDF-д орно (баталгаат цахим гарын үсэг биш)">
        {user.role === 'SUPER_ADMIN' && <button type="button" className="btn primary" onClick={() => setEditing({})}>+ Шинэ салбар</button>}
      </PageHeader>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data.map((b) => (
        <Card key={b.id} title={<>{b.name} <span className="mono muted small">{b.code}</span> <Badge value={b.isActive ? 'ACTIVE' : 'INACTIVE'} /></>}
          actions={<button type="button" className="btn sm" onClick={() => setEditing(b)}>Засах</button>}>
          <div className="grid two">
            <dl className="kv">
              <dt>Хаяг</dt><dd>{b.address ?? '—'}</dd>
              <dt>Утас</dt><dd>{b.phone ?? '—'}</dd>
              <dt>Хоцролтын босго</dt><dd>{b.lateThresholdMinutes} мин</dd>
              <dt>QR хугацаа</dt><dd>{b.qrTtlSeconds} сек</dd>
            </dl>
            <div className="row">
              {[['stamp', 'Тамга', b.stampPath], ['signature', 'Гарын үсэг', b.signaturePath]].map(([kind, title, path]) => (
                <div key={kind} style={{ textAlign: 'center' }}>
                  <div className="small muted">{title}</div>
                  {path ? <img src={fileUrl(path)} alt={title} style={{ height: 70, display: 'block', margin: '4px auto' }} /> : <div className="muted small" style={{ height: 70, lineHeight: '70px' }}>байхгүй</div>}
                  <label className="btn sm">Солих<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && upload(b, kind, e.target.files[0])} /></label>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
      {editing && <BranchForm branch={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

// ----- Хэрэглэгч -----
export function UsersPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState({ role: '', q: '' });
  const { data, loading, error, reload } = useApi(`/users${qs(filter)}`);
  const branches = useApi('/branches');
  const [editing, setEditing] = useState(null);
  const superAdmin = user.role === 'SUPER_ADMIN';
  const grantable = superAdmin ? Object.keys(ROLE) : ['FINANCE', 'TEACHER', 'STUDENT', 'PARENT'];
  return (
    <>
      <PageHeader title="Хэрэглэгч, эрх" subtitle="Багш, сурагч, эцэг эхийн эрхийг тус тусын бүртгэлээс үүсгэх нь зөв (профайл хамт үүснэ)">
        <button type="button" className="btn primary" onClick={() => setEditing({})}>+ Ажилтан</button>
      </PageHeader>
      <div className="filters">
        <input placeholder="Нэр, нэвтрэх нэр" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <Select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value })} placeholder="Бүх эрх" options={Object.entries(ROLE).map(([k, v]) => ({ value: k, label: v }))} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(u) => setEditing(u)} columns={[
          { key: 'username', title: 'Нэвтрэх нэр', className: 'mono' },
          { key: 'displayName', title: 'Нэр' },
          { key: 'r', title: 'Эрх', render: (u) => ROLE[u.role.code] },
          { key: 'b', title: 'Салбар', render: (u) => u.branch?.name ?? 'Бүх салбар' },
          { key: 'l', title: 'Сүүлд нэвтэрсэн', render: (u) => dateTime(u.lastLoginAt) },
          { key: 'a', title: 'Төлөв', render: (u) => <Badge value={u.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
        ]} />
      )}
      {editing && (
        <UserForm u={editing.id ? editing : null} grantable={grantable} branches={branches.data ?? []} superAdmin={superAdmin}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}

function UserForm({ u, grantable, branches, superAdmin, onClose, onSaved }) {
  const { values, bind } = useForm({ username: u?.username ?? '', displayName: u?.displayName ?? '', email: u?.email ?? '', role: u?.role.code ?? 'FINANCE', branchId: u?.branchId ?? '', password: '', isActive: u?.isActive ?? true });
  const [run, busy] = useAction();
  return (
    <Modal title={u ? `Хэрэглэгч: ${u.username}` : 'Шинэ ажилтан'} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const body = clean({ displayName: values.displayName, email: values.email, role: values.role, branchId: values.branchId, password: values.password }, ['branchId']);
        if (u) {
          body.isActive = Boolean(values.isActive);
          await run(() => api(`/users/${u.id}`, { method: 'PUT', body }), 'Хадгаллаа');
        } else {
          await run(() => api('/users', { method: 'POST', body: { ...body, username: values.username } }), 'Үүслээ');
        }
        onSaved();
      }}>
        {!u && <Field label="Нэвтрэх нэр"><input required pattern="[a-zA-Z0-9._\-]{3,50}" {...bind('username')} /></Field>}
        <Field label="Нэр"><input required {...bind('displayName')} /></Field>
        <Field label="И-мэйл"><input type="email" {...bind('email')} /></Field>
        <Field label="Эрх"><Select placeholder={null} {...bind('role')} options={grantable.map((r) => ({ value: r, label: ROLE[r] }))} /></Field>
        {superAdmin && values.role !== 'SUPER_ADMIN' && <Field label="Салбар"><Select required {...bind('branchId')} options={branches.map((b) => ({ value: b.id, label: b.name }))} /></Field>}
        <Field label={u ? 'Шинэ нууц үг (солих бол)' : 'Нууц үг'}><input type="password" minLength={8} required={!u} {...bind('password')} /></Field>
        {u && <Field label="Идэвхтэй"><span className="check"><input type="checkbox" {...bind('isActive', { type: 'checkbox' })} /> Нэвтрэх эрхтэй</span></Field>}
        <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
      </form>
    </Modal>
  );
}

// ----- Audit log -----
export function AuditPage() {
  const [filter, setFilter] = useState({ entityType: '', action: '', from: addDays(todayUb(), -7), to: todayUb() });
  const { data, loading, error } = useApi(`/audit-logs${qs(filter)}`);
  const [open, setOpen] = useState(null);
  const types = ['Enrollment', 'Invoice', 'Payment', 'Attendance', 'Submission', 'ExamAttempt', 'Certificate', 'TeachingHour', 'TeacherPayout', 'Student', 'Lead', 'User', 'Branch', 'ClassSession'];
  return (
    <>
      <PageHeader title="Өөрчлөлтийн түүх" subtitle="Хэн, хэзээ, юуг, ямар шалтгаанаар өөрчилсөн (хуучин ба шинэ утга)" />
      <div className="filters">
        <Select value={filter.entityType} onChange={(e) => setFilter({ ...filter, entityType: e.target.value })} placeholder="Бүх төрөл" options={types.map((t) => ({ value: t, label: t }))} />
        <input placeholder="Үйлдэл (CORRECT, REFUND …)" value={filter.action} onChange={(e) => setFilter({ ...filter, action: e.target.value.toUpperCase() })} />
        <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
        <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(r) => setOpen(r)} columns={[
          { key: 'd', title: 'Огноо', render: (r) => dateTime(r.createdAt) },
          { key: 'u', title: 'Хэрэглэгч', render: (r) => r.user?.displayName ?? 'Систем' },
          { key: 'action', title: 'Үйлдэл', render: (r) => <span className="mono">{r.action}</span> },
          { key: 'e', title: 'Бичлэг', render: (r) => `${r.entityType} #${r.entityId ?? ''}` },
          { key: 'reason', title: 'Шалтгаан', render: (r) => r.reason ?? '—' },
          { key: 'ap', title: 'Батлагч', render: (r) => r.approver?.displayName ?? '—' },
        ]} />
      )}
      {open && (
        <Modal title={`${open.action} — ${open.entityType} #${open.entityId ?? ''}`} onClose={() => setOpen(null)} wide>
          <dl className="kv" style={{ marginBottom: 12 }}>
            <dt>Огноо</dt><dd>{dateTime(open.createdAt)}</dd>
            <dt>Хэрэглэгч</dt><dd>{open.user?.displayName ?? 'Систем'}</dd>
            <dt>IP</dt><dd>{open.ipAddress ?? '—'}</dd>
            <dt>Шалтгаан</dt><dd>{open.reason ?? '—'}</dd>
          </dl>
          <div className="grid two">
            <Card title="Хуучин утга"><pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{open.oldValues ? JSON.stringify(JSON.parse(open.oldValues), null, 2) : '—'}</pre></Card>
            <Card title="Шинэ утга"><pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{open.newValues ? JSON.stringify(JSON.parse(open.newValues), null, 2) : '—'}</pre></Card>
          </div>
        </Modal>
      )}
    </>
  );
}

// ----- Нэгдсэн тайлан -----
export function ReportsPage() {
  const { user } = useAuth();
  const [range, setRange] = useState({ from: `${todayUb().slice(0, 8)}01`, to: todayUb() });
  const { data, loading, error } = useApi(`/reports/dashboard${qs(range)}`);
  const load = useApi(`/reports/teacher-load${qs(range)}`);
  const exportLink = (kind) => authUrl(`/reports/export/${kind}${qs(range)}`);
  const rows = data ? (user.role === 'SUPER_ADMIN' && data.perBranch.length > 1 ? [data.total, ...data.perBranch] : [data.total]) : [];
  return (
    <>
      <PageHeader title="Нэгдсэн тайлан" subtitle={user.role === 'SUPER_ADMIN' ? 'Бүх салбар, салбар тус бүрээр' : 'Өөрийн салбар'}>
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ width: 'auto' }} />
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ width: 'auto' }} />
      </PageHeader>
      <Card title="Excel экспорт">
        <div className="row">
          <a className="btn" href={exportLink('students')}>Сурагчид</a>
          <a className="btn" href={exportLink('payments')}>Төлөлт</a>
          <a className="btn" href={exportLink('receivables')}>Авлага</a>
          <a className="btn" href={exportLink('attendance')}>Ирц</a>
          <a className="btn" href={exportLink('teacher-hours')}>Багшийн цаг</a>
        </div>
      </Card>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : rows.map((r) => (
        <Card key={r.branch.id ?? 'all'} title={r.branch.name}>
          <div className="grid stats">
            <Stat label="Идэвхтэй сурагч" value={r.students} />
            <Stat label="Шинэ элсэлт" value={r.newEnrollments} hint={`Идэвхтэй: ${r.activeEnrollments}`} />
            <Stat label="Сонирхогч" value={Object.values(r.leads).reduce((a, b) => a + b, 0)} hint={Object.entries(r.leads).map(([k, v]) => `${label(k)} ${v}`).join(', ')} />
            <Stat label="Орлого" value={money(r.income)} tone="good" />
            <Stat label="Буцаалт + зарлага" value={money(Number(r.refunds) + Number(r.expenses))} tone="bad" />
            <Stat label="Цэвэр" value={money(r.net)} />
            <Stat label="Авлага" value={money(r.receivable)} hint={`Хэтэрсэн: ${money(r.overdue)}`} tone={Number(r.overdue) ? 'warn' : ''} />
            <Stat label="Ирцийн хувь" value={r.attendance.rate === null ? '—' : `${r.attendance.rate}%`} hint={`Тасалсан: ${r.attendance.ABSENT ?? 0}, хоцорсон: ${r.attendance.LATE ?? 0}`} />
            <Stat label="Багшийн цаг" value={`${Math.round(r.teacherMinutes / 6) / 10} ц`} hint={`Баталгаажсан хөлс: ${money(r.teacherApprovedAmount)}`} />
          </div>
        </Card>
      ))}
      <Card title="Багшийн ачаалал">
        <Table rows={load.data} columns={[
          { key: 'name', title: 'Багш' },
          { key: 'p', title: 'Төлөвлөсөн', render: (t) => t.plannedSessions },
          { key: 'c', title: 'Орсон', render: (t) => t.completedSessions },
          { key: 'a', title: 'Бодит цаг', render: (t) => `${Math.round(t.actualMinutes / 6) / 10} ц` },
          { key: 'ap', title: 'Баталгаажсан', render: (t) => `${Math.round(t.approvedMinutes / 6) / 10} ц` },
          { key: 'm', title: 'Хөлс', className: 'right', render: (t) => money(t.approvedAmount) },
        ]} />
      </Card>
    </>
  );
}

// ----- Гэрчилгээ -----
export function CertificatesPage() {
  const { data, loading, error, reload } = useApi('/certificates');
  const [revoking, setRevoking] = useState(null);
  const [run] = useAction();
  return (
    <>
      <PageHeader title="Гэрчилгээ" subtitle="Гэрчилгээг сурагчийн элсэлт эсвэл ангийн «Төгсөлт» табаас олгоно">
        <Link className="btn" to="/verify" target="_blank">Нийтэд шалгах хуудас</Link>
      </PageHeader>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} columns={[
          { key: 'no', title: 'Дугаар', render: (c) => <span className="mono">{c.certificateNo}</span> },
          { key: 's', title: 'Сурагч', render: (c) => <Link to={`/students/${c.enrollment.student.id}`}>{fullName(c.enrollment.student)}</Link> },
          { key: 'c', title: 'Сургалт', render: (c) => `${c.enrollment.class.course.name} (${c.enrollment.class.course.level.code})` },
          { key: 'a', title: 'Ирц / дүн', render: (c) => `${Number(c.attendancePercent)}% / ${Number(c.finalScore)}` },
          { key: 'd', title: 'Олгосон', render: (c) => `${date(c.issuedAt)}, ${c.issuer.displayName}` },
          { key: 'v', title: 'Шалгах код', render: (c) => <Link to={`/verify/${c.verificationCode}`} target="_blank" className="mono small">{c.verificationCode}</Link> },
          { key: 'st', title: 'Төлөв', render: (c) => <><Badge value={c.status} />{c.revokeReason && <div className="muted small">{c.revokeReason}</div>}</> },
          {
            key: 'x', title: '', render: (c) => (
              <div className="row">
                {c.filePath && <a className="btn sm" href={authUrl(`/certificates/${c.id}/file`)}>PDF</a>}
                {c.status === 'ISSUED' && <button type="button" className="btn sm danger" onClick={() => setRevoking(c)}>Хүчингүй болгох</button>}
              </div>
            ),
          },
        ]} />
      )}
      {revoking && <ReasonModal title="Гэрчилгээ хүчингүй болгох" submitLabel="Хүчингүй болгох" onClose={() => setRevoking(null)}
        onSubmit={async (reason) => { await run(() => api(`/certificates/${revoking.id}/revoke`, { method: 'POST', body: { reason } }), 'Хүчингүй болголоо'); reload(); }} />}
    </>
  );
}

// ----- Эцэг эхийн хүсэлт шийдвэрлэх -----
export function RequestsPage() {
  const [status, setStatus] = useState('PENDING');
  const { data, loading, error, reload } = useApi(`/requests${qs({ status })}`);
  const [handling, setHandling] = useState(null);
  const [run, busy] = useAction();
  const [form, setForm] = useState({ status: 'APPROVED', response: '' });
  return (
    <>
      <PageHeader title="Эцэг эхийн хүсэлт" subtitle="Чөлөөг зөвшөөрөхөд тухайн хугацааны хичээлийн ирц «Чөлөөтэй» болно" />
      <div className="filters">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Бүгд" options={['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'].map((s) => ({ value: s, label: LABEL[s] }))} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} columns={[
          { key: 'd', title: 'Огноо', render: (r) => dateTime(r.createdAt) },
          { key: 'p', title: 'Эцэг эх', render: (r) => <>{fullName(r.parent)}<div className="muted small">{r.parent.phone}</div></> },
          { key: 's', title: 'Хүүхэд', render: (r) => <Link to={`/students/${r.student.id}`}>{fullName(r.student)}</Link> },
          { key: 't', title: 'Төрөл', render: (r) => label(r.requestType) },
          { key: 'sub', title: 'Агуулга', render: (r) => <><b>{r.subject}</b><div className="small">{r.message}</div>{r.leaveFrom && <div className="muted small">{dateOnly(r.leaveFrom)} — {dateOnly(r.leaveTo)}</div>}</> },
          { key: 'st', title: 'Төлөв', render: (r) => <><Badge value={r.status} />{r.handler && <div className="muted small">{r.handler.displayName}</div>}</> },
          { key: 'x', title: '', render: (r) => ['PENDING', 'IN_REVIEW'].includes(r.status) && <button type="button" className="btn sm primary" onClick={() => { setForm({ status: r.requestType === 'LEAVE' ? 'APPROVED' : 'RESOLVED', response: '' }); setHandling(r); }}>Шийдвэрлэх</button> },
        ]} />
      )}
      {handling && (
        <Modal title={`Хүсэлт: ${handling.subject}`} onClose={() => setHandling(null)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api(`/requests/${handling.id}/handle`, { method: 'POST', body: form }), 'Шийдвэрлэлээ. Эцэг эхэд мэдэгдэл очлоо.');
            setHandling(null);
            reload();
            return r;
          }}>
            <Field label="Шийдвэр" full>
              <Select placeholder={null} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={(handling.requestType === 'LEAVE' ? ['IN_REVIEW', 'APPROVED', 'REJECTED'] : ['IN_REVIEW', 'RESOLVED']).map((s) => ({ value: s, label: LABEL[s] }))} />
            </Field>
            <Field label="Хариу" full><textarea rows={3} value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} /></Field>
            <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
