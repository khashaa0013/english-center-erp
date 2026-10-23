// M1 — Сонирхогч: бүртгэх, давхардал шалгах, явц хянах, сурагч болгох
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { date, LABEL, label } from '../lib/format.js';
import { Badge, clean, ErrorBox, errorText, Field, Loading, Modal, PageHeader, Select, Table, useAction, useApi, useForm, useToast } from '../components/ui.jsx';

const STATUSES = ['NEW', 'CONTACTED', 'PLACEMENT_TEST', 'CONVERTED', 'LOST'];
const SOURCES = ['WALK_IN', 'PHONE', 'WEB_FORM', 'FACEBOOK', 'REFERRAL', 'OTHER'];
const opts = (list) => list.map((v) => ({ value: v, label: LABEL[v] }));

export function BranchSelect({ value, onChange, required }) {
  const { user } = useAuth();
  const { data } = useApi(user.role === 'SUPER_ADMIN' ? '/branches' : null);
  if (user.role !== 'SUPER_ADMIN') return null;
  return (
    <Field label="Салбар">
      <Select required={required} value={value ?? ''} onChange={onChange} options={(data ?? []).map((b) => ({ value: b.id, label: b.name }))} />
    </Field>
  );
}

function LeadForm({ lead, onClose, onSaved }) {
  const courses = useApi('/catalog/courses?active=1');
  const levels = useApi('/catalog/levels');
  const { values, bind } = useForm({
    branchId: '', contactName: '', contactPhone: '', studentName: '', studentBirthDate: '', interestedCourseId: '', placementLevelId: '', source: 'WALK_IN', status: 'NEW', note: '',
    ...(lead ? { ...lead, studentBirthDate: lead.studentBirthDate?.slice(0, 10) ?? '' } : {}),
  });
  const [dup, setDup] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async (force = false) => {
    const fields = ['branchId', 'contactName', 'contactPhone', 'studentName', 'studentBirthDate', 'interestedCourseId', 'placementLevelId', 'source', 'note', ...(lead ? ['status'] : [])];
    const body = clean(Object.fromEntries(fields.map((f) => [f, values[f] ?? ''])), ['branchId', 'interestedCourseId', 'placementLevelId']);
    if (force) body.force = true;
    setBusy(true);
    try {
      await (lead ? api(`/leads/${lead.id}`, { method: 'PUT', body }) : api('/leads', { method: 'POST', body }));
      toast('Хадгаллаа');
      onSaved();
    } catch (e) {
      // Давхардал: хэрэглэгчид харуулж, баталгаажуулбал force-оор хадгална
      if (e.status === 409 && e.details?.leads) setDup(e.details);
      else toast(errorText(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={lead ? 'Сонирхогч засах' : 'Шинэ сонирхогч'} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        {dup && (
          <div className="alert warn field full">
            Ижил мэдээлэлтэй бүртгэл байна:
            <ul>
              {dup.leads.map((l) => <li key={`l${l.id}`}>Сонирхогч: {l.contactName} ({l.contactPhone}) — {l.studentName}, {label(l.status)}</li>)}
              {dup.students.map((s) => <li key={`s${s.id}`}>Сурагч: <Link to={`/students/${s.id}`}>{s.studentCode} {s.lastName} {s.firstName}</Link></li>)}
            </ul>
            <button type="button" className="btn sm" onClick={() => save(true)}>Тийм ч гэсэн бүртгэх</button>
          </div>
        )}
        {!lead && <BranchSelect {...bind('branchId')} />}
        <Field label="Холбогдох хүн"><input required {...bind('contactName')} /></Field>
        <Field label="Утас"><input required {...bind('contactPhone')} /></Field>
        <Field label="Суралцагчийн нэр"><input required {...bind('studentName')} /></Field>
        <Field label="Төрсөн огноо"><input type="date" {...bind('studentBirthDate')} /></Field>
        <Field label="Сонирхож буй курс"><Select {...bind('interestedCourseId')} options={(courses.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.level.code})` }))} /></Field>
        <Field label="Тогтоосон түвшин"><Select {...bind('placementLevelId')} options={(levels.data ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` }))} /></Field>
        <Field label="Эх сурвалж"><Select placeholder={null} {...bind('source')} options={opts(SOURCES)} /></Field>
        {lead && <Field label="Төлөв"><Select placeholder={null} {...bind('status')} options={opts(STATUSES.filter((s) => s !== 'CONVERTED'))} /></Field>}
        <Field label="Тэмдэглэл" full><textarea rows={3} {...bind('note')} /></Field>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Хадгалах</button>
        </div>
      </form>
    </Modal>
  );
}

function ConvertModal({ lead, onClose }) {
  const navigate = useNavigate();
  const levels = useApi('/catalog/levels');
  const parts = lead.studentName.trim().split(/\s+/);
  const { values, bind } = useForm({
    lastName: parts.length > 1 ? parts.slice(0, -1).join(' ') : '', firstName: parts[parts.length - 1], registerNo: '', birthDate: lead.studentBirthDate?.slice(0, 10) ?? '',
    gender: '', phone: '', currentLevelId: lead.placementLevelId ?? '',
  });
  const [run, busy] = useAction();
  return (
    <Modal title="Сурагч болгох" onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api(`/leads/${lead.id}/convert`, { method: 'POST', body: clean(values, ['currentLevelId']) }), 'Сурагч бүртгэгдлээ');
        navigate(`/students/${r.student.id}?tab=enrollments`);
      }}>
        <div className="alert info field full">Сурагчийн профайл үүссэний дараа элсэлт, эцэг эхийн холбоосыг нэмнэ.</div>
        <Field label="Овог"><input required {...bind('lastName')} /></Field>
        <Field label="Нэр"><input required {...bind('firstName')} /></Field>
        <Field label="Регистр"><input {...bind('registerNo')} /></Field>
        <Field label="Төрсөн огноо"><input type="date" {...bind('birthDate')} /></Field>
        <Field label="Хүйс"><Select {...bind('gender')} options={opts(['MALE', 'FEMALE', 'OTHER'])} /></Field>
        <Field label="Утас"><input {...bind('phone')} /></Field>
        <Field label="Түвшин"><Select {...bind('currentLevelId')} options={(levels.data ?? []).map((l) => ({ value: l.id, label: l.code }))} /></Field>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Сурагч болгох</button>
        </div>
      </form>
    </Modal>
  );
}

export function LeadsPage() {
  const [filter, setFilter] = useState({ status: '', source: '', q: '' });
  const { data, loading, error, reload } = useApi(`/leads${qs(filter)}`);
  const [editing, setEditing] = useState(null);
  const [converting, setConverting] = useState(null);

  return (
    <>
      <PageHeader title="Сонирхогч, бүртгэлийн хүсэлт" subtitle="Биечлэн, утсаар, веб маягт болон Facebook-ээс ирсэн хүсэлт">
        <a className="btn" href="/register" target="_blank" rel="noreferrer">Онлайн маягт</a>
        <button type="button" className="btn primary" onClick={() => setEditing({})}>+ Шинэ</button>
      </PageHeader>
      <div className="filters">
        <input placeholder="Нэр, утас хайх" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} placeholder="Бүх төлөв" options={opts(STATUSES)} />
        <Select value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })} placeholder="Бүх суваг" options={opts(SOURCES)} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table
          rows={data}
          columns={[
            { key: 'createdAt', title: 'Огноо', render: (r) => date(r.createdAt) },
            { key: 'contactName', title: 'Холбогдох', render: (r) => <><div>{r.contactName}</div><div className="muted small">{r.contactPhone}</div></> },
            { key: 'studentName', title: 'Суралцагч' },
            { key: 'course', title: 'Сонирхол', render: (r) => r.interestedCourse?.name ?? '—' },
            { key: 'level', title: 'Түвшин', render: (r) => r.placementLevel?.code ?? '—' },
            { key: 'source', title: 'Суваг', render: (r) => label(r.source) },
            { key: 'status', title: 'Төлөв', render: (r) => <Badge value={r.status} /> },
            {
              key: 'act', title: '', render: (r) => (r.convertedStudent
                ? <Link to={`/students/${r.convertedStudent.id}`}>{r.convertedStudent.studentCode}</Link>
                : (
                  <div className="row">
                    <button type="button" className="btn sm" onClick={() => setEditing(r)}>Засах</button>
                    {r.status !== 'LOST' && <button type="button" className="btn sm primary" onClick={() => setConverting(r)}>Сурагч болгох</button>}
                  </div>
                )),
            },
          ]}
        />
      )}
      {editing && <LeadForm lead={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {converting && <ConvertModal lead={converting} onClose={() => setConverting(null)} />}
    </>
  );
}
