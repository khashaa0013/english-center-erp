// M1 — Сурагч: жагсаалт, профайл, эцэг эх, элсэлт (→ нэхэмжлэл, гэрээ), баримт, ирц, гэрчилгээ
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, authUrl, fileUrl, qs } from '../lib/api.js';
import { isStaff, useAuth } from '../lib/auth.jsx';
import { date, dateOnly, dateTime, fullName, label, LABEL, money } from '../lib/format.js';
import {
  Badge, Card, clean, Empty, ErrorBox, errorText, Field, Loading, Modal, PageHeader, ReasonModal, Select, Table, Tabs, useAction, useApi, useForm, useToast,
} from '../components/ui.jsx';
import { BranchSelect } from './leads.jsx';

const opts = (list) => list.map((v) => ({ value: v, label: LABEL[v] }));

function StudentForm({ student, onClose, onSaved }) {
  const levels = useApi('/catalog/levels');
  const { values, bind } = useForm({
    branchId: '', lastName: '', firstName: '', registerNo: '', birthDate: '', gender: '', phone: '', address: '', currentLevelId: '', status: 'ACTIVE',
    ...(student ? { ...student, birthDate: student.birthDate?.slice(0, 10) ?? '', currentLevelId: student.currentLevelId ?? '' } : {}),
  });
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState(null);
  const toast = useToast();

  const save = async (force) => {
    const fields = ['branchId', 'lastName', 'firstName', 'registerNo', 'birthDate', 'gender', 'phone', 'address', 'currentLevelId', ...(student ? ['status'] : [])];
    const body = clean(Object.fromEntries(fields.map((f) => [f, values[f] ?? ''])), ['branchId', 'currentLevelId']);
    if (force) body.force = true;
    setBusy(true);
    try {
      const r = await (student ? api(`/students/${student.id}`, { method: 'PUT', body }) : api('/students', { method: 'POST', body }));
      toast('Хадгаллаа');
      onSaved(r);
    } catch (e) {
      if (e.status === 409 && e.details?.students) setDups(e.details.students);
      else toast(errorText(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={student ? 'Сурагч засах' : 'Шинэ сурагч'} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        {dups && (
          <div className="alert warn field full">
            Ижил мэдээлэлтэй сурагч байна: {dups.map((s) => <Link key={s.id} to={`/students/${s.id}`}> {s.studentCode} {s.lastName} {s.firstName}</Link>)}
            <div><button type="button" className="btn sm" onClick={() => save(true)}>Тийм ч гэсэн бүртгэх</button></div>
          </div>
        )}
        {!student && <BranchSelect {...bind('branchId')} />}
        <Field label="Овог"><input required {...bind('lastName')} /></Field>
        <Field label="Нэр"><input required {...bind('firstName')} /></Field>
        <Field label="Регистрийн дугаар"><input {...bind('registerNo')} /></Field>
        <Field label="Төрсөн огноо"><input type="date" {...bind('birthDate')} /></Field>
        <Field label="Хүйс"><Select {...bind('gender')} options={opts(['MALE', 'FEMALE', 'OTHER'])} /></Field>
        <Field label="Утас"><input {...bind('phone')} /></Field>
        <Field label="Түвшин"><Select {...bind('currentLevelId')} options={(levels.data ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` }))} /></Field>
        {student && <Field label="Төлөв"><Select placeholder={null} {...bind('status')} options={opts(['ACTIVE', 'INACTIVE', 'GRADUATED'])} /></Field>}
        <Field label="Хаяг" full><input {...bind('address')} /></Field>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Хадгалах</button>
        </div>
      </form>
    </Modal>
  );
}

export function StudentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState({ q: '', status: '' });
  const { data, loading, error } = useApi(`/students${qs(filter)}`);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Сурагчид" subtitle={data ? `${data.length} сурагч` : ''}>
        {isStaff(user) && <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Шинэ сурагч</button>}
      </PageHeader>
      <div className="filters">
        <input placeholder="Нэр, код, утас, регистр" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} placeholder="Бүх төлөв" options={opts(['ACTIVE', 'INACTIVE', 'GRADUATED'])} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table
          rows={data}
          onRowClick={(r) => navigate(`/students/${r.id}`)}
          columns={[
            { key: 'studentCode', title: 'Код', className: 'mono' },
            { key: 'name', title: 'Овог нэр', render: fullName },
            { key: 'phone', title: 'Утас' },
            { key: 'level', title: 'Түвшин', render: (r) => r.currentLevel?.code ?? '—' },
            { key: 'enr', title: 'Элсэлт', render: (r) => r._count.enrollments },
            { key: 'acc', title: 'Нэвтрэх эрх', render: (r) => (r.user ? <span className="mono small">{r.user.username}</span> : <span className="muted">—</span>) },
            { key: 'status', title: 'Төлөв', render: (r) => <Badge value={r.status} /> },
          ]}
        />
      )}
      {creating && <StudentForm onClose={() => setCreating(false)} onSaved={(s) => navigate(`/students/${s.id}`)} />}
    </>
  );
}

// ----- Элсэлт -----
function EnrollModal({ student, onClose, onSaved }) {
  const classes = useApi('/classes');
  const { values, bind } = useForm({ classId: '', packageId: '', discountAmount: '' });
  const [run, busy] = useAction();
  const open = (classes.data ?? []).filter((c) => ['PLANNED', 'OPEN', 'IN_PROGRESS'].includes(c.status) && c.branchId === student.branchId);
  const cls = open.find((c) => String(c.id) === String(values.classId));
  const pkg = cls?.course.packages.find((p) => String(p.id) === String(values.packageId));
  return (
    <Modal title="Ангид элсүүлэх" onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        await run(() => api('/enrollments', { method: 'POST', body: { studentId: student.id, ...clean(values, ['classId', 'packageId', 'discountAmount']) } }), 'Элсэлт үүслээ');
        onSaved();
      }}>
        <Field label="Анги" full>
          <Select required {...bind('classId')} options={open.map((c) => ({
            value: c.id,
            label: `${c.code} — ${c.course.name} (${c.course.level.code}), ${c._count.enrollments}/${c.capacity} суудал${c._count.enrollments >= c.capacity ? ' · ДҮҮРСЭН' : ''}`,
          }))} />
        </Field>
        <Field label="Үнийн багц">
          <Select required {...bind('packageId')} options={(cls?.course.packages ?? []).map((p) => ({ value: p.id, label: `${p.name} — ${money(p.price)}` }))} />
        </Field>
        <Field label="Хөнгөлөлт (₮)"><input type="number" min="0" step="1000" {...bind('discountAmount')} /></Field>
        {pkg && <div className="field full muted">Төлөх дүн: <b>{money(Number(pkg.price) - Number(values.discountAmount || 0))}</b>. Элсэлтийг батлахад нэхэмжлэл ба гэрээ автоматаар үүснэ.</div>}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Элсүүлэх</button>
        </div>
      </form>
    </Modal>
  );
}

function TransferModal({ enrollment, onClose, onSaved }) {
  const classes = useApi(`/classes?courseId=${enrollment.class.courseId}`);
  const [classId, setClassId] = useState('');
  const [run] = useAction();
  const options = (classes.data ?? []).filter((c) => c.id !== enrollment.classId && !['COMPLETED', 'CANCELLED'].includes(c.status));
  return (
    <ReasonModal
      title="Анги шилжүүлэх"
      onClose={onClose}
      submitLabel="Шилжүүлэх"
      extra={(
        <Field label="Шинэ анги" full>
          <Select required value={classId} onChange={(e) => setClassId(e.target.value)} options={options.map((c) => ({ value: c.id, label: `${c.code} (${c._count.enrollments}/${c.capacity})` }))} />
        </Field>
      )}
      onSubmit={async (reason) => {
        await run(() => api(`/enrollments/${enrollment.id}/transfer`, { method: 'POST', body: { classId: Number(classId), reason } }), 'Шилжүүллээ. Нэхэмжлэл, төлөлт шинэ элсэлт рүү шилжсэн.');
        onSaved();
      }}
    />
  );
}

function GraduationModal({ enrollment, onClose, onSaved }) {
  const { data, loading, error } = useApi(`/graduation/${enrollment.id}`);
  const [run, busy] = useAction();
  return (
    <Modal title="Төгсөлтийн шалгалт" onClose={onClose} wide>
      <ErrorBox error={error} />
      {loading ? <Loading /> : data && (
        <>
          <div className={`alert ${data.eligible ? 'ok' : 'warn'}`}>
            {data.eligible ? 'Бүх шаардлага хангасан — гэрчилгээ олгож болно.' : 'Дутуу шаардлага:'}
            {!data.eligible && <ul className="reasons">{data.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>
          <div className="grid two">
            <Card title={`Ирц: ${data.attendance.percent}% (шаардлага ${data.requirements.minAttendancePercent}%)`}>
              <div className="small muted">Болсон {data.attendance.held} · Ирсэн {data.attendance.present} · Хоцорсон {data.attendance.late} · Тасалсан {data.attendance.absent} · Чөлөөтэй {data.attendance.excused}</div>
            </Card>
            <Card title={`Дүн: ${data.score.percent ?? '—'} (шаардлага ${data.requirements.minFinalScore})`}>
              {data.score.exams.map((e) => <div key={e.examId} className="small">{e.title}: {e.score ?? 'дүн гараагүй'} / {e.maxScore}</div>)}
            </Card>
            <Card title="Төлбөр">
              {data.balance ? <div className="small">Нийт {money(data.balance.total)} · Төлсөн {money(data.balance.paid)} · Үлдэгдэл <b>{money(data.balance.balance)}</b></div> : '—'}
              <div className="small muted">{data.requirements.requireFullPayment ? 'Бүрэн төлсөн байх шаардлагатай' : 'Төлбөрийн шаардлагагүй'}</div>
            </Card>
          </div>
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Хаах</button>
            <button type="button" className="btn primary" disabled={!data.eligible || busy} onClick={async () => {
              await run(() => api('/certificates', { method: 'POST', body: { enrollmentId: enrollment.id } }), 'Гэрчилгээ олгогдлоо');
              onSaved();
            }}>Гэрчилгээ олгох</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function EnrollmentsTab({ student, reload }) {
  const { user } = useAuth();
  const staff = isStaff(user);
  const [run] = useAction();
  const [modal, setModal] = useState(null);
  const done = () => { setModal(null); reload(); };
  const verifiedParents = student.parentLinks.filter((l) => l.verifiedAt);

  return (
    <>
      {staff && <div className="actions" style={{ marginBottom: 12 }}><button type="button" className="btn primary" onClick={() => setModal({ kind: 'enroll' })}>+ Ангид элсүүлэх</button></div>}
      {!student.enrollments.length ? <Empty>Элсэлт алга</Empty> : student.enrollments.map((e) => (
        <Card key={e.id} title={<>{e.class.code} · {e.class.course.name} ({e.class.course.level.code}) <Badge value={e.status} /></>}
          actions={staff && (
            <>
              {e.status === 'PENDING' && <button type="button" className="btn primary sm" onClick={() => run(() => api(`/enrollments/${e.id}/confirm`, { method: 'POST', body: {} }), 'Баталгаажлаа. Нэхэмжлэл, гэрээ үүслээ.').then(reload)}>Батлах</button>}
              {e.status === 'CONFIRMED' && <button type="button" className="btn sm" onClick={() => setModal({ kind: 'transfer', e })}>Анги шилжүүлэх</button>}
              {['CONFIRMED', 'COMPLETED'].includes(e.status) && <button type="button" className="btn sm" onClick={() => setModal({ kind: 'grad', e })}>Төгсөлт / гэрчилгээ</button>}
              {['PENDING', 'CONFIRMED'].includes(e.status) && <button type="button" className="btn danger sm" onClick={() => setModal({ kind: 'cancel', e })}>Цуцлах</button>}
            </>
          )}
        >
          <div className="grid two">
            <dl className="kv">
              <dt>Багц</dt><dd>{e.package.name}</dd>
              <dt>Багш</dt><dd>{fullName(e.class.teacher)}</dd>
              <dt>Хугацаа</dt><dd>{dateOnly(e.class.startDate)} — {dateOnly(e.class.endDate)}</dd>
              <dt>Үнэ / хөнгөлөлт</dt><dd>{money(e.listPrice)} / {money(e.discountAmount)}</dd>
              <dt>Төлөх</dt><dd><b>{money(e.finalAmount)}</b></dd>
              {e.cancelReason && <><dt>Шалтгаан</dt><dd>{e.cancelReason}</dd></>}
            </dl>
            <dl className="kv">
              <dt>Нэхэмжлэл</dt>
              <dd>{e.invoice ? <>{user.role !== 'TEACHER' ? <Link to={`/finance/invoices/${e.invoice.id}`}>{e.invoice.invoiceNo}</Link> : e.invoice.invoiceNo} <Badge value={e.invoice.status} /></> : '—'}</dd>
              {e.invoice && <><dt>Үлдэгдэл</dt><dd>{money(e.invoice.balance)} (хугацаа {dateOnly(e.invoice.dueDate)})</dd></>}
              <dt>Гэрээ</dt>
              <dd>
                {e.contract ? (
                  <span className="row">
                    {e.contract.contractNo} <Badge value={e.contract.status} />
                    {e.contract.filePath && <a className="btn sm" href={authUrl(`/enrollments/${e.id}/contract/file`)}>PDF</a>}
                    {staff && e.contract.status === 'DRAFT' && <button type="button" className="btn sm" onClick={() => run(() => api(`/enrollments/${e.id}/contract/generate`, { method: 'POST' }), 'Гэрээний PDF үүслээ').then(reload)}>PDF үүсгэх</button>}
                    {staff && e.contract.status === 'DRAFT' && <button type="button" className="btn sm" onClick={() => setModal({ kind: 'sign', e })}>Гарын үсэг зурсан</button>}
                  </span>
                ) : '—'}
              </dd>
              <dt>Гэрчилгээ</dt>
              <dd>{e.certificate ? <span className="row">{e.certificate.certificateNo} <Badge value={e.certificate.status} />{e.certificate.filePath && <a className="btn sm" href={authUrl(`/certificates/${e.certificate.id}/file`)}>PDF</a>}</span> : '—'}</dd>
            </dl>
          </div>
        </Card>
      ))}
      {modal?.kind === 'enroll' && <EnrollModal student={student} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'transfer' && <TransferModal enrollment={modal.e} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'grad' && <GraduationModal enrollment={modal.e} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'cancel' && (
        <ReasonModal title="Элсэлт цуцлах" submitLabel="Цуцлах" onClose={() => setModal(null)}
          onSubmit={async (reason) => { await run(() => api(`/enrollments/${modal.e.id}/cancel`, { method: 'POST', body: { reason } }), 'Цуцлагдлаа'); reload(); }} />
      )}
      {modal?.kind === 'sign' && (
        <Modal title="Гэрээнд гарын үсэг зурсан" onClose={() => setModal(null)}>
          <SignForm parents={verifiedParents} onSubmit={async (signerParentId) => {
            await run(() => api(`/enrollments/${modal.e.id}/contract/sign`, { method: 'POST', body: { signerParentId: signerParentId ? Number(signerParentId) : null } }), 'Гэрээ баталгаажлаа');
            done();
          }} />
        </Modal>
      )}
    </>
  );
}

function SignForm({ parents, onSubmit }) {
  const [parentId, setParentId] = useState(parents[0]?.parentId ?? '');
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit(parentId); }}>
      <Field label="Гарын үсэг зурсан" full>
        <Select value={parentId} onChange={(e) => setParentId(e.target.value)} placeholder="Суралцагч өөрөө" options={parents.map((l) => ({ value: l.parentId, label: `${fullName(l.parent)} (${label(l.relationship)})` }))} />
      </Field>
      <div className="form-actions"><button className="btn primary">Баталгаажуулах</button></div>
    </form>
  );
}

// ----- Эцэг эх -----
function ParentsTab({ student, reload }) {
  const [run] = useAction();
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(null);
  return (
    <>
      <div className="alert info">Эцэг эх нь өөрийн нэвтрэх эрхтэй. Админ холбоосыг <b>баталгаажуулсны дараа</b> л хүүхдийн мэдээллийг порталаас харна.</div>
      <div className="actions" style={{ marginBottom: 12 }}><button type="button" className="btn primary" onClick={() => setLinking(true)}>+ Эцэг эх холбох</button></div>
      <Table
        rows={student.parentLinks}
        empty="Холбогдсон эцэг эх алга"
        columns={[
          { key: 'name', title: 'Нэр', render: (l) => fullName(l.parent) },
          { key: 'phone', title: 'Утас / нэвтрэх нэр', render: (l) => <span className="mono">{l.parent.phone}</span> },
          { key: 'rel', title: 'Хамаарал', render: (l) => label(l.relationship) },
          { key: 'v', title: 'Баталгаажсан', render: (l) => (l.verifiedAt ? <><Badge value="APPROVED">Тийм</Badge> <span className="muted small">{date(l.verifiedAt)}, {l.verifier?.displayName}</span></> : <Badge value="PENDING">Хүлээгдэж буй</Badge>) },
          {
            key: 'a', title: '', render: (l) => (
              <div className="row">
                {!l.verifiedAt && <button type="button" className="btn sm primary" onClick={() => run(() => api(`/students/parent-links/${l.id}/verify`, { method: 'POST' }), 'Баталгаажлаа').then(reload)}>Баталгаажуулах</button>}
                <button type="button" className="btn sm danger" onClick={() => setUnlinking(l)}>Салгах</button>
              </div>
            ),
          },
        ]}
      />
      {linking && <LinkParentModal student={student} onClose={() => setLinking(false)} onSaved={() => { setLinking(false); reload(); }} />}
      {unlinking && (
        <ReasonModal title="Эцэг эхийн холбоос салгах" submitLabel="Салгах" onClose={() => setUnlinking(null)}
          onSubmit={async (reason) => { await run(() => api(`/students/parent-links/${unlinking.id}`, { method: 'DELETE', body: { reason } }), 'Салгалаа'); reload(); }} />
      )}
    </>
  );
}

function LinkParentModal({ student, onClose, onSaved }) {
  const [q, setQ] = useState('');
  const parents = useApi(`/parents${qs({ q })}`);
  const [mode, setMode] = useState('existing');
  const { values, bind } = useForm({ parentId: '', relationship: 'MOTHER', lastName: '', firstName: '', phone: '', email: '', password: '' });
  const [run, busy] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    let parentId = values.parentId;
    if (mode === 'new') {
      const p = await run(() => api('/parents', { method: 'POST', body: clean({ lastName: values.lastName, firstName: values.firstName, phone: values.phone, email: values.email, password: values.password }) }), `Эцэг эх бүртгэгдлээ. Нэвтрэх нэр: ${values.phone}`);
      parentId = p.id;
    }
    await run(() => api(`/students/${student.id}/parents`, { method: 'POST', body: { parentId: Number(parentId), relationship: values.relationship, verify: true } }), 'Холбож баталгаажууллаа');
    onSaved();
  };
  return (
    <Modal title="Эцэг эх холбох" onClose={onClose} wide>
      <Tabs value={mode} onChange={setMode} tabs={[{ key: 'existing', label: 'Бүртгэлтэй эцэг эх' }, { key: 'new', label: 'Шинээр бүртгэх' }]} />
      <form className="form" onSubmit={submit}>
        {mode === 'existing' ? (
          <>
            <Field label="Хайх (нэр, утас)"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
            <Field label="Эцэг эх"><Select required {...bind('parentId')} options={(parents.data ?? []).map((p) => ({ value: p.id, label: `${fullName(p)} — ${p.phone}` }))} /></Field>
          </>
        ) : (
          <>
            <Field label="Овог"><input required {...bind('lastName')} /></Field>
            <Field label="Нэр"><input required {...bind('firstName')} /></Field>
            <Field label="Утас (нэвтрэх нэр болно)"><input required inputMode="tel" pattern="\+?\d{8,15}" {...bind('phone')} /></Field>
            <Field label="И-мэйл"><input type="email" {...bind('email')} /></Field>
            <Field label="Анхны нууц үг (8+ тэмдэгт)"><input required minLength={8} {...bind('password')} /></Field>
          </>
        )}
        <Field label="Хамаарал"><Select placeholder={null} {...bind('relationship')} options={opts(['MOTHER', 'FATHER', 'GUARDIAN', 'OTHER'])} /></Field>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Холбох</button>
        </div>
      </form>
    </Modal>
  );
}

// ----- Баримт -----
function DocumentsTab({ student, reload }) {
  const [run, busy] = useAction();
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState('Төрсний гэрчилгээ');
  return (
    <>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData();
        form.append('docType', docType);
        form.append('file', file);
        await run(() => api(`/students/${student.id}/documents`, { method: 'POST', form }), 'Баримт хавсаргалаа');
        setFile(null);
        e.target.reset();
        reload();
      }}>
        <input style={{ maxWidth: 220 }} value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="Баримтын төрөл" required />
        <input style={{ maxWidth: 320 }} type="file" accept=".pdf,image/*" required onChange={(e) => setFile(e.target.files[0])} />
        <button className="btn primary" disabled={busy || !file}>Хавсаргах</button>
      </form>
      <Table
        rows={student.documents}
        empty="Баримт хавсаргаагүй"
        columns={[
          { key: 'docType', title: 'Төрөл' },
          { key: 'originalName', title: 'Файл', render: (d) => <a href={fileUrl(d.filePath)} target="_blank" rel="noreferrer">{d.originalName}</a> },
          { key: 'by', title: 'Хавсаргасан', render: (d) => d.uploader?.displayName },
          { key: 'at', title: 'Огноо', render: (d) => dateTime(d.createdAt) },
        ]}
      />
    </>
  );
}

function AttendanceTab({ student }) {
  const { data, loading, error } = useApi(`/attendance/student/${student.id}`);
  if (loading) return <Loading />;
  return (
    <>
      <ErrorBox error={error} />
      <Table
        rows={data}
        empty="Ирцийн бүртгэл алга"
        columns={[
          { key: 'd', title: 'Хичээл', render: (a) => dateTime(a.classSession.startsAt) },
          { key: 'c', title: 'Анги', render: (a) => a.classSession.class.code },
          { key: 's', title: 'Төлөв', render: (a) => <Badge value={a.status} /> },
          { key: 'm', title: 'Арга', render: (a) => label(a.method) },
          { key: 'l', title: 'Хоцролт', render: (a) => (a.lateMinutes ? `${a.lateMinutes} мин` : '—') },
          { key: 'cor', title: 'Залруулга', render: (a) => (a.corrections.length ? a.corrections.map((c) => `${label(c.oldStatus)}→${label(c.newStatus)}: ${c.reason}`).join('; ') : '—') },
        ]}
      />
    </>
  );
}

export function StudentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'profile';
  const { data: s, loading, error, reload } = useApi(`/students/${id}`);
  const [editing, setEditing] = useState(false);
  const [account, setAccount] = useState(false);
  const [run] = useAction();
  const staff = isStaff(user);

  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const tabs = [
    { key: 'profile', label: 'Профайл' },
    { key: 'enrollments', label: 'Элсэлт, төлбөр', count: s.enrollments.length },
    { key: 'parents', label: 'Эцэг эх', count: s.parentLinks.length },
    { key: 'attendance', label: 'Ирц' },
    ...(s.documents ? [{ key: 'documents', label: 'Баримт', count: s.documents.length }] : []),
  ];

  return (
    <>
      <PageHeader title={`${s.lastName} ${s.firstName}`} subtitle={<><span className="mono">{s.studentCode}</span> · {s.branch.name} · <Badge value={s.status} /></>}>
        {staff && <button type="button" className="btn" onClick={() => setEditing(true)}>Засах</button>}
        {staff && !s.user && <button type="button" className="btn" onClick={() => setAccount(true)}>Нэвтрэх эрх үүсгэх</button>}
      </PageHeader>
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'profile' && (
        <div className="grid two">
          <Card title="Үндсэн мэдээлэл">
            <dl className="kv">
              <dt>Регистр</dt><dd>{s.registerNo ?? '—'}</dd>
              <dt>Төрсөн огноо</dt><dd>{dateOnly(s.birthDate)}</dd>
              <dt>Хүйс</dt><dd>{label(s.gender)}</dd>
              <dt>Утас</dt><dd>{s.phone ?? '—'}</dd>
              <dt>Хаяг</dt><dd>{s.address ?? '—'}</dd>
              <dt>Түвшин</dt><dd>{s.currentLevel ? `${s.currentLevel.code} — ${s.currentLevel.name}` : '—'}</dd>
              <dt>Нэвтрэх нэр</dt><dd className="mono">{s.user?.username ?? '—'}</dd>
              <dt>Бүртгэлийн суваг</dt><dd>{s.lead ? `${label(s.lead.source)}, ${date(s.lead.createdAt)}` : 'Шууд'}</dd>
            </dl>
          </Card>
          <Card title="Гэрчилгээний түүх">
            {s.enrollments.filter((e) => e.certificate).length === 0 ? <Empty>Гэрчилгээ алга</Empty> : s.enrollments.filter((e) => e.certificate).map((e) => (
              <div key={e.id} className="row" style={{ marginBottom: 6 }}>
                <b>{e.certificate.certificateNo}</b> {e.class.course.name} <Badge value={e.certificate.status} />
                <span className="muted small">{date(e.certificate.issuedAt)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === 'enrollments' && <EnrollmentsTab student={s} reload={reload} />}
      {tab === 'parents' && (staff ? <ParentsTab student={s} reload={reload} /> : (
        <Table rows={s.parentLinks} columns={[{ key: 'n', title: 'Нэр', render: (l) => fullName(l.parent) }, { key: 'p', title: 'Утас', render: (l) => l.parent.phone }, { key: 'r', title: 'Хамаарал', render: (l) => label(l.relationship) }]} />
      ))}
      {tab === 'attendance' && <AttendanceTab student={s} />}
      {tab === 'documents' && <DocumentsTab student={s} reload={reload} />}

      {editing && <StudentForm student={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {account && (
        <Modal title="Сурагчийн нэвтрэх эрх" onClose={() => setAccount(false)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => api(`/students/${s.id}/account`, { method: 'POST', body: { password: e.target.password.value } }), 'Нэвтрэх эрх үүслээ');
            setAccount(false);
            reload();
          }}>
            <div className="field full muted">Нэвтрэх нэр: <span className="mono">{s.studentCode.toLowerCase()}</span></div>
            <Field label="Анхны нууц үг (8+ тэмдэгт)" full><input name="password" required minLength={8} /></Field>
            <div className="form-actions"><button className="btn primary">Үүсгэх</button></div>
          </form>
        </Modal>
      )}
      <div style={{ marginTop: 16 }}><Link className="btn ghost sm" to="/students">← Сурагчид</Link></div>
    </>
  );
}
