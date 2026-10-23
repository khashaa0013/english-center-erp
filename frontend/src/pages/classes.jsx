// M4 — Анги: хуваарь (зөрчил шалгалттай), хичээл, сурагч, материал, даалгавар, шалгалт, төгсөлт
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fileUrl, qs } from '../lib/api.js';
import { isStaff, useAuth } from '../lib/auth.jsx';
import { DAYS, dateOnly, dateTime, fullName, label, LABEL } from '../lib/format.js';
import {
  Badge, Card, clean, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, Table, Tabs, useAction, useApi, useForm, useToast,
} from '../components/ui.jsx';
import { BranchSelect } from './leads.jsx';
import { AssignmentForm } from './assignments.jsx';

const STATUSES = ['PLANNED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function ClassForm({ cls, onClose, onSaved }) {
  const courses = useApi('/catalog/courses?active=1');
  const teachers = useApi('/teachers?status=ACTIVE');
  const rooms = useApi('/catalog/classrooms?active=1');
  const { values, bind } = useForm({
    branchId: '', courseId: '', teacherId: '', classroomId: '', code: '', capacity: 12, startDate: '', endDate: '', status: 'PLANNED',
    ...(cls ? { ...cls, startDate: dateOnly(cls.startDate), endDate: dateOnly(cls.endDate), classroomId: cls.classroomId ?? '' } : {}),
  });
  const [run, busy] = useAction();
  const courseId = Number(values.courseId);
  // Курсийг заахаар бүртгэлтэй багш (бүртгэлгүй бол бүгд)
  const teacherOpts = (teachers.data ?? []).filter((t) => !courseId || !t.courses.length || t.courses.some((c) => c.course.id === courseId));
  return (
    <Modal title={cls ? 'Анги засах' : 'Шинэ анги'} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const fields = ['branchId', 'courseId', 'teacherId', 'classroomId', 'code', 'capacity', 'startDate', 'endDate', 'status'];
        const body = clean(Object.fromEntries(fields.map((f) => [f, values[f] ?? ''])), ['branchId', 'courseId', 'teacherId', 'classroomId', 'capacity']);
        const r = await run(() => (cls ? api(`/classes/${cls.id}`, { method: 'PUT', body }) : api('/classes', { method: 'POST', body })), 'Хадгаллаа');
        onSaved(r);
      }}>
        {!cls && <BranchSelect {...bind('branchId')} />}
        <Field label="Курс"><Select required {...bind('courseId')} options={(courses.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.level.code})` }))} /></Field>
        <Field label="Ангийн код"><input required placeholder="KIDS-A1-2026-01" {...bind('code')} /></Field>
        <Field label="Үндсэн багш"><Select required {...bind('teacherId')} options={teacherOpts.map((t) => ({ value: t.id, label: fullName(t) }))} /></Field>
        <Field label="Үндсэн танхим"><Select {...bind('classroomId')} options={(rooms.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.capacity})` }))} /></Field>
        <Field label="Хүчин чадал"><input type="number" min="1" required {...bind('capacity')} /></Field>
        <Field label="Төлөв"><Select placeholder={null} {...bind('status')} options={STATUSES.map((s) => ({ value: s, label: LABEL[s] }))} /></Field>
        <Field label="Эхлэх огноо"><input type="date" required {...bind('startDate')} /></Field>
        <Field label="Дуусах огноо"><input type="date" required {...bind('endDate')} /></Field>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Хадгалах</button>
        </div>
      </form>
    </Modal>
  );
}

export function ClassesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const { data, loading, error } = useApi(`/classes${qs({ status })}`);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title={user.role === 'TEACHER' ? 'Миний ангиуд' : 'Анги'}>
        {isStaff(user) && <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Шинэ анги</button>}
      </PageHeader>
      <div className="filters">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Бүх төлөв" options={STATUSES.map((s) => ({ value: s, label: LABEL[s] }))} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(c) => navigate(`/classes/${c.id}`)} columns={[
          { key: 'code', title: 'Код', className: 'mono' },
          { key: 'course', title: 'Курс', render: (c) => `${c.course.name} (${c.course.level.code})` },
          { key: 't', title: 'Багш', render: (c) => fullName(c.teacher) },
          { key: 'sch', title: 'Хуваарь', render: (c) => c.schedules.map((s) => `${DAYS[s.dayOfWeek].slice(0, 2)} ${s.startTime}`).join(', ') || '—' },
          { key: 'cap', title: 'Суудал', render: (c) => `${c._count.enrollments}/${c.capacity}` },
          { key: 'd', title: 'Хугацаа', render: (c) => `${dateOnly(c.startDate)} — ${dateOnly(c.endDate)}` },
          { key: 's', title: 'Төлөв', render: (c) => <Badge value={c.status} /> },
        ]} />
      )}
      {creating && <ClassForm onClose={() => setCreating(false)} onSaved={(c) => navigate(`/classes/${c.id}`)} />}
    </>
  );
}

function SchedulesTab({ cls, reload }) {
  const { user } = useAuth();
  const staff = isStaff(user);
  const rooms = useApi(staff ? '/catalog/classrooms?active=1' : null);
  const teachers = useApi(staff ? '/teachers?status=ACTIVE' : null);
  const { values, bind } = useForm({ dayOfWeek: '1', startTime: '18:00', endTime: '19:30', classroomId: cls.classroomId ?? '', teacherId: '' });
  const [run, busy] = useAction();
  const toast = useToast();
  return (
    <>
      {staff && (
        <Card title="Хуваарь нэмэх">
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => api(`/classes/${cls.id}/schedules`, { method: 'POST', body: clean(values, ['dayOfWeek', 'classroomId', 'teacherId']) }), 'Хуваарь нэмэгдлээ');
            reload();
          }}>
            <Field label="Гараг"><Select placeholder={null} {...bind('dayOfWeek')} options={DAYS.slice(1).map((d, i) => ({ value: i + 1, label: d }))} /></Field>
            <Field label="Эхлэх"><input type="time" required {...bind('startTime')} /></Field>
            <Field label="Дуусах"><input type="time" required {...bind('endTime')} /></Field>
            <Field label="Танхим"><Select required {...bind('classroomId')} options={(rooms.data ?? []).filter((r) => r.branchId === cls.branchId).map((r) => ({ value: r.id, label: r.name }))} /></Field>
            <Field label="Багш"><Select {...bind('teacherId')} placeholder="Үндсэн багш" options={(teachers.data ?? []).map((t) => ({ value: t.id, label: fullName(t) }))} /></Field>
            <div className="form-actions"><button className="btn primary" disabled={busy}>Нэмэх (зөрчил шалгана)</button></div>
          </form>
        </Card>
      )}
      <Card title="Долоо хоногийн хуваарь" actions={staff && cls.schedules.length > 0 && (
        <button type="button" className="btn primary" onClick={async () => {
          const r = await run(() => api(`/classes/${cls.id}/generate-sessions`, { method: 'POST' }));
          toast(r.created ? `${r.created} хичээл үүслээ` : 'Шинээр үүсгэх хичээл алга (бүгд үүссэн)');
          reload();
        }}>Хуваариас хичээл үүсгэх</button>
      )}>
        <Table rows={cls.schedules} empty="Хуваарь алга" columns={[
          { key: 'd', title: 'Гараг', render: (s) => DAYS[s.dayOfWeek] },
          { key: 't', title: 'Цаг', render: (s) => `${s.startTime}–${s.endTime}` },
          { key: 'r', title: 'Танхим', render: (s) => s.classroom.name },
          { key: 'te', title: 'Багш', render: (s) => fullName(s.teacher) },
          { key: 'a', title: '', render: (s) => staff && <ConfirmButton className="btn sm danger" confirmText="Ирээдүйн хичээлүүд цуцлагдана. Устгах уу?" onConfirm={() => run(() => api(`/classes/${cls.id}/schedules/${s.id}`, { method: 'DELETE' }), 'Устгалаа').then(reload)}>Устгах</ConfirmButton> },
        ]} />
      </Card>
    </>
  );
}

function SessionsTab({ cls }) {
  const { data, loading } = useApi(`/sessions?classId=${cls.id}`);
  const navigate = useNavigate();
  if (loading) return <Loading />;
  return (
    <Table rows={data} empty="Хичээл үүсээгүй. Хуваарь табаас үүсгэнэ." onRowClick={(s) => navigate(`/sessions/${s.id}`)} columns={[
      { key: 'n', title: '#', render: (s) => data.indexOf(s) + 1 },
      { key: 'd', title: 'Огноо, цаг', render: (s) => dateTime(s.startsAt) },
      { key: 'r', title: 'Танхим', render: (s) => s.classroom.name },
      { key: 't', title: 'Багш', render: (s) => fullName(s.teacher) },
      { key: 'topic', title: 'Сэдэв' },
      { key: 's', title: 'Төлөв', render: (s) => <Badge value={s.status} /> },
    ]} />
  );
}

function StudentsTab({ cls }) {
  const summary = useApi(`/attendance/class/${cls.id}/summary`);
  if (summary.loading) return <Loading />;
  return (
    <>
      <ErrorBox error={summary.error} />
      <Table rows={summary.data} rowKey="enrollmentId" empty="Элссэн сурагч алга" columns={[
        { key: 'c', title: 'Код', render: (r) => <Link to={`/students/${r.student.id}`} className="mono">{r.student.studentCode}</Link> },
        { key: 'n', title: 'Нэр', render: (r) => fullName(r.student) },
        { key: 'h', title: 'Болсон', render: (r) => r.held },
        { key: 'p', title: 'Ирсэн', render: (r) => r.present },
        { key: 'l', title: 'Хоцорсон', render: (r) => r.late },
        { key: 'a', title: 'Тасалсан', render: (r) => r.absent },
        { key: 'e', title: 'Чөлөөтэй', render: (r) => r.excused },
        { key: 'pc', title: 'Ирц %', render: (r) => <b>{r.percent}%</b> },
      ]} />
    </>
  );
}

function MaterialsTab({ cls }) {
  const { data, reload } = useApi(`/classes/${cls.id}/materials`);
  const { user } = useAuth();
  const [run, busy] = useAction();
  const { values, bind } = useForm({ title: '', type: 'PDF', url: '', allClasses: false });
  const [file, setFile] = useState(null);
  const canEdit = isStaff(user) || user.role === 'TEACHER';
  return (
    <>
      {canEdit && (
        <Card title="Материал нэмэх">
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData();
            form.append('title', values.title);
            form.append('type', values.type);
            if (values.type === 'LINK') form.append('url', values.url);
            else form.append('file', file);
            form.append('allClasses', values.allClasses ? 'true' : 'false');
            await run(() => api(`/classes/${cls.id}/materials`, { method: 'POST', form }), 'Нэмэгдлээ');
            e.target.reset();
            reload();
          }}>
            <Field label="Гарчиг"><input required {...bind('title')} /></Field>
            <Field label="Төрөл"><Select placeholder={null} {...bind('type')} options={['PDF', 'AUDIO', 'LINK', 'OTHER'].map((t) => ({ value: t, label: label(t) }))} /></Field>
            {values.type === 'LINK'
              ? <Field label="Холбоос"><input type="url" required {...bind('url')} /></Field>
              : <Field label="Файл"><input type="file" required onChange={(e) => setFile(e.target.files[0])} /></Field>}
            <Field label="Хамрах хүрээ"><span className="check"><input type="checkbox" {...bind('allClasses', { type: 'checkbox' })} /> Курсийн бүх ангид</span></Field>
            <div className="form-actions"><button className="btn primary" disabled={busy}>Нэмэх</button></div>
          </form>
        </Card>
      )}
      <MaterialList items={data} />
    </>
  );
}

export function MaterialList({ items }) {
  if (!items?.length) return <Empty>Материал алга</Empty>;
  return (
    <Table rows={items} columns={[
      { key: 'title', title: 'Гарчиг', render: (m) => (m.type === 'LINK' ? <a href={m.url} target="_blank" rel="noreferrer">{m.title}</a> : <a href={fileUrl(m.filePath)} target="_blank" rel="noreferrer">{m.title}</a>) },
      { key: 'type', title: 'Төрөл', render: (m) => label(m.type) },
      { key: 'scope', title: 'Хүрээ', render: (m) => (m.classId ? 'Энэ анги' : 'Курсийн бүх анги') },
      { key: 'd', title: 'Огноо', render: (m) => dateTime(m.createdAt) },
      ...(items.some((m) => m.type === 'AUDIO') ? [{ key: 'p', title: '', render: (m) => m.type === 'AUDIO' && <audio controls preload="none" src={fileUrl(m.filePath)} style={{ height: 32 }} /> }] : []),
    ]} />
  );
}

function AssignmentsTab({ cls }) {
  const { data, reload } = useApi(`/assignments?classId=${cls.id}`);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}><button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Даалгавар</button></div>
      <Table rows={data} empty="Даалгавар алга" onRowClick={(a) => navigate(`/assignments/${a.id}`)} columns={[
        { key: 'title', title: 'Гарчиг' },
        { key: 'type', title: 'Хариу', render: (a) => label(a.answerType) },
        { key: 'due', title: 'Хугацаа', render: (a) => dateTime(a.dueAt) },
        { key: 'sub', title: 'Илгээсэн', render: (a) => a.submissions.length },
        { key: 'gr', title: 'Дүгнэсэн', render: (a) => a.submissions.filter((s) => s.status === 'GRADED').length },
      ]} />
      {creating && <AssignmentForm classId={cls.id} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </>
  );
}

function ExamsTab({ cls }) {
  const { data } = useApi(`/exams?classId=${cls.id}`);
  const navigate = useNavigate();
  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}><Link className="btn primary" to={`/exams/new?classId=${cls.id}`}>+ Шалгалт</Link></div>
      <Table rows={data} empty="Шалгалт алга" onRowClick={(e) => navigate(`/exams/${e.id}`)} columns={[
        { key: 'title', title: 'Гарчиг' },
        { key: 'type', title: 'Төрөл', render: (e) => label(e.examType) },
        { key: 'o', title: 'Нээх', render: (e) => dateTime(e.opensAt) },
        { key: 'c', title: 'Хаах', render: (e) => dateTime(e.closesAt) },
        { key: 'q', title: 'Асуулт', render: (e) => e._count.questions },
        { key: 'a', title: 'Оролдлого', render: (e) => e._count.attempts },
        { key: 'g', title: 'Төгсөлтөд', render: (e) => (e.countsForGraduation ? 'Тооцно' : '—') },
      ]} />
    </>
  );
}

function GraduationTab({ cls }) {
  const { data, loading, error, reload } = useApi(`/graduation/class/${cls.id}`);
  const { user } = useAuth();
  const [run] = useAction();
  if (loading) return <Loading />;
  return (
    <>
      <ErrorBox error={error} />
      <Table rows={data} rowKey="enrollmentId" empty="Сурагч алга" columns={[
        { key: 'n', title: 'Сурагч', render: (r) => fullName(r.student) },
        { key: 'a', title: 'Ирц', render: (r) => `${r.attendance.percent}%` },
        { key: 's', title: 'Дүн', render: (r) => r.score.percent ?? '—' },
        { key: 'b', title: 'Үлдэгдэл', render: (r) => (r.balance ? `${Number(r.balance.balance).toLocaleString()}₮` : '—') },
        { key: 'r', title: 'Үр дүн', render: (r) => (r.eligible ? <Badge value="APPROVED">Шаардлага хангасан</Badge> : <ul className="reasons small">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>) },
        { key: 'act', title: '', render: (r) => isStaff(user) && r.eligible && <button type="button" className="btn sm primary" onClick={() => run(() => api('/certificates', { method: 'POST', body: { enrollmentId: r.enrollmentId } }), 'Гэрчилгээ олгогдлоо').then(reload)}>Гэрчилгээ олгох</button> },
      ]} />
    </>
  );
}

export function ClassDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'schedule';
  const { data: cls, loading, error, reload } = useApi(`/classes/${id}`);
  const [editing, setEditing] = useState(false);
  if (loading && !cls) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader title={`${cls.code}`} subtitle={<>{cls.course.name} ({cls.course.level.code}) · {fullName(cls.teacher)} · {dateOnly(cls.startDate)} — {dateOnly(cls.endDate)} · {cls._count.enrollments}/{cls.capacity} суудал · <Badge value={cls.status} /></>}>
        {isStaff(user) && <button type="button" className="btn" onClick={() => setEditing(true)}>Засах</button>}
      </PageHeader>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { key: 'schedule', label: 'Хуваарь' }, { key: 'sessions', label: 'Хичээлүүд', count: cls._count.sessions },
        { key: 'students', label: 'Сурагчид, ирц' }, { key: 'materials', label: 'Материал' },
        { key: 'assignments', label: 'Даалгавар' }, { key: 'exams', label: 'Шалгалт' }, { key: 'graduation', label: 'Төгсөлт' },
      ]} />
      {tab === 'schedule' && <SchedulesTab cls={cls} reload={reload} />}
      {tab === 'sessions' && <SessionsTab cls={cls} />}
      {tab === 'students' && <StudentsTab cls={cls} />}
      {tab === 'materials' && <MaterialsTab cls={cls} />}
      {tab === 'assignments' && <AssignmentsTab cls={cls} />}
      {tab === 'exams' && <ExamsTab cls={cls} />}
      {tab === 'graduation' && <GraduationTab cls={cls} />}
      {editing && <ClassForm cls={cls} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
