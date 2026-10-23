// M4 — Даалгавар: үүсгэх, хариу илгээх (файл/аудио/бичвэр), үнэлэх
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime, fullName, label, toLocalInput } from '../lib/format.js';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, Table, useAction, useApi, useForm } from '../components/ui.jsx';

export function AssignmentForm({ classId, assignment, onClose, onSaved }) {
  const { values, bind } = useForm({
    title: assignment?.title ?? '', description: assignment?.description ?? '', answerType: assignment?.answerType ?? 'TEXT',
    dueAt: assignment ? toLocalInput(assignment.dueAt) : '', maxScore: assignment ? Number(assignment.maxScore) : 100,
  });
  const [file, setFile] = useState(null);
  const [run, busy] = useAction();
  return (
    <Modal title={assignment ? 'Даалгавар засах' : 'Шинэ даалгавар'} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData();
        if (!assignment) form.append('classId', classId);
        for (const [k, v] of Object.entries(values)) if (v !== '') form.append(k, v);
        if (file) form.append('file', file);
        await run(() => api(assignment ? `/assignments/${assignment.id}` : '/assignments', { method: assignment ? 'PUT' : 'POST', form }), 'Хадгаллаа. Сурагчдад мэдэгдэл очлоо.');
        onSaved();
      }}>
        <Field label="Гарчиг" full><input required {...bind('title')} /></Field>
        <Field label="Даалгаврын тайлбар" full><textarea rows={4} {...bind('description')} /></Field>
        <Field label="Хариултын хэлбэр"><Select placeholder={null} {...bind('answerType')} options={['TEXT', 'FILE', 'AUDIO'].map((t) => ({ value: t, label: label(t) }))} /></Field>
        <Field label="Илгээх хугацаа"><input type="datetime-local" required {...bind('dueAt')} /></Field>
        <Field label="Дээд оноо"><input type="number" min="1" {...bind('maxScore')} /></Field>
        <Field label="Хавсралт (зураг, аудио, PDF)"><input type="file" onChange={(e) => setFile(e.target.files[0])} /></Field>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Хадгалах</button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignmentsPage() {
  const { data, loading, error } = useApi('/assignments');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Даалгавар" subtitle="Шинэ даалгаврыг ангийн хуудаснаас үүсгэнэ" />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(a) => navigate(`/assignments/${a.id}`)} columns={[
          { key: 'c', title: 'Анги', render: (a) => a.class.code },
          { key: 'title', title: 'Гарчиг' },
          { key: 't', title: 'Хариу', render: (a) => label(a.answerType) },
          { key: 'due', title: 'Хугацаа', render: (a) => dateTime(a.dueAt) },
          { key: 's', title: 'Илгээсэн', render: (a) => a.submissions.length },
          { key: 'p', title: 'Дүгнэх', render: (a) => { const n = a.submissions.filter((x) => ['SUBMITTED', 'LATE'].includes(x.status)).length; return n ? <Badge value="PENDING">{n}</Badge> : '—'; } },
        ]} />
      )}
    </>
  );
}

function SubmissionContent({ sub }) {
  return (
    <>
      {sub.textAnswer && <div style={{ whiteSpace: 'pre-wrap' }}>{sub.textAnswer}</div>}
      {sub.filePath && (/\.(mp3|m4a|wav|webm|ogg)$/i.test(sub.filePath)
        ? <audio controls src={fileUrl(sub.filePath)} />
        : <a href={fileUrl(sub.filePath)} target="_blank" rel="noreferrer">Хавсаргасан файл</a>)}
    </>
  );
}

function GradeModal({ sub, assignment, onClose, onSaved }) {
  const { values, bind } = useForm({ score: sub.score ?? '', feedback: sub.feedback ?? '', reason: '', returnForRevision: false });
  const [run, busy] = useAction();
  const regrade = sub.status === 'GRADED';
  return (
    <Modal title={`Үнэлэх: ${fullName(sub.student)}`} onClose={onClose} wide>
      <Card><SubmissionContent sub={sub} /></Card>
      <form className="form" style={{ marginTop: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        await run(() => api(`/assignments/submissions/${sub.id}/grade`, { method: 'POST', body: { score: Number(values.score), feedback: values.feedback, returnForRevision: values.returnForRevision, ...(values.reason ? { reason: values.reason } : {}) } }), 'Үнэллээ');
        onSaved();
      }}>
        <Field label={`Оноо (0–${Number(assignment.maxScore)})`}><input type="number" min="0" max={Number(assignment.maxScore)} step="0.5" required {...bind('score')} /></Field>
        <Field label="Засварт буцаах"><span className="check"><input type="checkbox" {...bind('returnForRevision', { type: 'checkbox' })} /> Дахин илгээлгэх</span></Field>
        <Field label="Тайлбар (сурагч, эцэг эх харна)" full><textarea rows={3} {...bind('feedback')} /></Field>
        {regrade && <Field label="Дүн өөрчлөх шалтгаан (заавал)" full><input required minLength={3} {...bind('reason')} /></Field>}
        <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
      </form>
    </Modal>
  );
}

function SubmitForm({ assignment, existing, onSaved }) {
  const [text, setText] = useState(existing?.textAnswer ?? '');
  const [file, setFile] = useState(null);
  const [run, busy] = useAction();
  const accept = assignment.answerType === 'AUDIO' ? 'audio/*' : undefined;
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      const form = new FormData();
      if (text) form.append('textAnswer', text);
      if (file) form.append('file', file);
      await run(() => api(`/assignments/${assignment.id}/submit`, { method: 'POST', form }), 'Илгээлээ');
      onSaved();
    }}>
      {assignment.answerType === 'TEXT'
        ? <Field label="Хариулт" full><textarea rows={8} required value={text} onChange={(e) => setText(e.target.value)} /></Field>
        : <Field label={assignment.answerType === 'AUDIO' ? 'Аудио бичлэг (утаснаас бичиж болно)' : 'Файл'} full><input type="file" required accept={accept} capture={assignment.answerType === 'AUDIO' ? 'user' : undefined} onChange={(e) => setFile(e.target.files[0])} /></Field>}
      {assignment.answerType !== 'TEXT' && <Field label="Нэмэлт тайлбар" full><textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
      <div className="form-actions"><button className="btn primary" disabled={busy}>{existing ? 'Дахин илгээх' : 'Илгээх'}</button></div>
    </form>
  );
}

export function AssignmentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: a, loading, error, reload } = useApi(`/assignments/${id}`);
  const [grading, setGrading] = useState(null);
  const [editing, setEditing] = useState(false);
  if (loading && !a) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const student = user.role === 'STUDENT';
  const own = a.submissions[0];
  const overdue = new Date(a.dueAt) < new Date();

  return (
    <>
      <PageHeader title={a.title} subtitle={<>{a.class.code} · хариу: {label(a.answerType)} · хугацаа {dateTime(a.dueAt)} {overdue && <Badge value="LATE">Хугацаа өнгөрсөн</Badge>} · {Number(a.maxScore)} оноо</>}>
        {!student && user.role !== 'PARENT' && <button type="button" className="btn" onClick={() => setEditing(true)}>Засах</button>}
        {!student && user.role !== 'PARENT' && <Link className="btn" to={`/classes/${a.class.id}?tab=assignments`}>Анги</Link>}
      </PageHeader>
      <Card title="Даалгавар">
        <div style={{ whiteSpace: 'pre-wrap' }}>{a.description || <span className="muted">Тайлбаргүй</span>}</div>
        {a.attachmentPath && <div style={{ marginTop: 8 }}><a className="btn sm" href={fileUrl(a.attachmentPath)} target="_blank" rel="noreferrer">Хавсралт татах</a></div>}
      </Card>
      {student ? (
        <Card title="Миний хариулт">
          {own && (
            <div className="alert info">
              <Badge value={own.status} /> {dateTime(own.submittedAt)} илгээсэн
              {own.status === 'GRADED' && <div><b>Оноо: {Number(own.score)}/{Number(a.maxScore)}</b>{own.feedback && <div>Багшийн тайлбар: {own.feedback}</div>}</div>}
              {own.status === 'RETURNED' && own.feedback && <div>Багшийн тайлбар: {own.feedback}</div>}
              <div style={{ marginTop: 6 }}><SubmissionContent sub={own} /></div>
            </div>
          )}
          {own?.status !== 'GRADED' && <SubmitForm assignment={a} existing={own} onSaved={reload} />}
          {overdue && !own && <div className="muted small">Хугацаа өнгөрсөн ч илгээж болно — «Хоцорсон» гэж тэмдэглэгдэнэ.</div>}
        </Card>
      ) : (
        <Card title={`Илгээсэн хариу (${a.submissions.length})`}>
          {!a.submissions.length ? <Empty>Хариу ирээгүй</Empty> : (
            <Table rows={a.submissions} columns={[
              { key: 'n', title: 'Сурагч', render: (s) => fullName(s.student) },
              { key: 'at', title: 'Илгээсэн', render: (s) => dateTime(s.submittedAt) },
              { key: 'st', title: 'Төлөв', render: (s) => <Badge value={s.status} /> },
              { key: 'sc', title: 'Оноо', render: (s) => (s.score !== null ? Number(s.score) : '—') },
              { key: 'a', title: '', render: (s) => user.role !== 'PARENT' && <button type="button" className="btn sm primary" onClick={() => setGrading(s)}>{s.status === 'GRADED' ? 'Дүн засах' : 'Үнэлэх'}</button> },
            ]} />
          )}
        </Card>
      )}
      {grading && <GradeModal sub={grading} assignment={a} onClose={() => setGrading(null)} onSaved={() => { setGrading(null); reload(); }} />}
      {editing && <AssignmentForm assignment={a} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
