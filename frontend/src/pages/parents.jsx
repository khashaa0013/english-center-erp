// M1 — Эцэг эхийн жагсаалт, элсэлтийн жагсаалт
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { isStaff, useAuth } from '../lib/auth.jsx';
import { date, fullName, LABEL, money } from '../lib/format.js';
import { Badge, clean, ErrorBox, Field, Loading, Modal, PageHeader, Select, Table, useAction, useApi, useForm } from '../components/ui.jsx';

export function ParentsPage() {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi(`/parents${qs({ q })}`);
  const [creating, setCreating] = useState(false);
  const { values, bind } = useForm({ lastName: '', firstName: '', phone: '', email: '', password: '' });
  const [run, busy] = useAction();
  return (
    <>
      <PageHeader title="Эцэг эх" subtitle="Эцэг эх бүр өөрийн нэвтрэх эрхтэй (нэвтрэх нэр = утас)">
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Шинэ</button>
      </PageHeader>
      <div className="filters"><input placeholder="Нэр, утас хайх" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} columns={[
          { key: 'n', title: 'Нэр', render: fullName },
          { key: 'phone', title: 'Утас', className: 'mono' },
          { key: 'email', title: 'И-мэйл' },
          { key: 'c', title: 'Хүүхэд', render: (p) => p.children.map((c) => <span key={c.id} className="row"><Link to={`/students/${c.student.id}`}>{fullName(c.student)}</Link>{!c.verifiedAt && <Badge value="PENDING">баталгаажаагүй</Badge>}</span>) },
          { key: 'a', title: 'Эрх', render: (p) => <Badge value={p.user.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
        ]} />
      )}
      {creating && (
        <Modal title="Шинэ эцэг эх" onClose={() => setCreating(false)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => api('/parents', { method: 'POST', body: clean(values) }), `Бүртгэгдлээ. Нэвтрэх нэр: ${values.phone}`);
            setCreating(false);
            reload();
          }}>
            <Field label="Овог"><input required {...bind('lastName')} /></Field>
            <Field label="Нэр"><input required {...bind('firstName')} /></Field>
            <Field label="Утас"><input required pattern="\+?\d{8,15}" {...bind('phone')} /></Field>
            <Field label="И-мэйл"><input type="email" {...bind('email')} /></Field>
            <Field label="Анхны нууц үг" full><input required minLength={8} {...bind('password')} /></Field>
            <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function EnrollmentsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi(`/enrollments${qs({ status })}`);
  const [run] = useAction();
  return (
    <>
      <PageHeader title="Элсэлт" subtitle="Элсэлт батлахад нэхэмжлэл ба гэрээ нэг үйлдлээр үүснэ" />
      <div className="filters">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Бүх төлөв"
          options={['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'TRANSFERRED'].map((v) => ({ value: v, label: LABEL[v] }))} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} columns={[
          { key: 'd', title: 'Огноо', render: (e) => date(e.createdAt) },
          { key: 's', title: 'Сурагч', render: (e) => <Link to={`/students/${e.student.id}?tab=enrollments`}>{e.student.studentCode} {fullName(e.student)}</Link> },
          { key: 'c', title: 'Анги', render: (e) => `${e.class.code} · ${e.class.course.name}` },
          { key: 'amt', title: 'Дүн', className: 'right', render: (e) => money(e.finalAmount) },
          { key: 'bal', title: 'Үлдэгдэл', className: 'right', render: (e) => (e.invoice ? money(e.invoice.balance) : '—') },
          { key: 'st', title: 'Төлөв', render: (e) => <Badge value={e.status} /> },
          {
            key: 'a', title: '', render: (e) => (e.status === 'PENDING' && isStaff(user)
              ? <button type="button" className="btn sm primary" onClick={() => run(() => api(`/enrollments/${e.id}/confirm`, { method: 'POST', body: {} }), 'Баталгаажлаа').then(reload)}>Батлах</button>
              : null),
          },
        ]} />
      )}
    </>
  );
}
