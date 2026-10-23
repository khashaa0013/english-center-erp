// Нэвтрэлтгүй хуудсууд: онлайн бүртгэлийн маягт, гэрчилгээ шалгах
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, ErrorBox, Field, Loading } from '../components/ui.jsx';

// Веб болон Facebook-ийн холбоос: /register?source=FACEBOOK&branch=MAIN
export function PublicLeadForm() {
  const params = new URLSearchParams(window.location.search);
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({ branchCode: params.get('branch') ?? '', contactName: '', contactPhone: '', studentName: '', studentBirthDate: '', interestedCourseId: '', note: '', website: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/public/form-options').then((o) => {
      setOptions(o);
      if (!form.branchCode && o.branches.length === 1) setForm((f) => ({ ...f, branchCode: o.branches[0].code }));
    }).catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, source: params.get('source') === 'FACEBOOK' ? 'FACEBOOK' : 'WEB_FORM' };
      for (const k of ['studentBirthDate', 'interestedCourseId', 'note']) if (!body[k]) delete body[k];
      if (body.interestedCourseId) body.interestedCourseId = Number(body.interestedCourseId);
      await api('/public/leads', { method: 'POST', body });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-wrap">
      <Card title="Сургалтад бүртгүүлэх хүсэлт">
        {done ? (
          <div className="alert ok">Хүсэлтийг хүлээн авлаа. Манай ажилтан тантай удахгүй холбогдоно. Баярлалаа!</div>
        ) : !options ? <Loading /> : (
          <form className="form" onSubmit={submit}>
            <ErrorBox error={error} />
            <Field label="Салбар" full>
              <select required value={form.branchCode} onChange={set('branchCode')}>
                <option value="">— Сонгох —</option>
                {options.branches.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Таны нэр (эцэг эх)"><input required value={form.contactName} onChange={set('contactName')} /></Field>
            <Field label="Утасны дугаар"><input required inputMode="tel" value={form.contactPhone} onChange={set('contactPhone')} /></Field>
            <Field label="Суралцагчийн нэр"><input required value={form.studentName} onChange={set('studentName')} /></Field>
            <Field label="Төрсөн огноо"><input type="date" value={form.studentBirthDate} onChange={set('studentBirthDate')} /></Field>
            <Field label="Сонирхож буй сургалт" full>
              <select value={form.interestedCourseId} onChange={set('interestedCourseId')}>
                <option value="">— Түвшин тогтоосны дараа —</option>
                {options.courses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.level.code})</option>)}
              </select>
            </Field>
            <Field label="Нэмэлт мэдээлэл" full><textarea rows={3} value={form.note} onChange={set('note')} /></Field>
            {/* Ботоос хамгаалах далд талбар */}
            <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true" />
            <div className="form-actions"><button className="btn primary lg" disabled={busy}>Илгээх</button></div>
          </form>
        )}
        <div className="small muted" style={{ marginTop: 16 }}><Link to="/login">Системд нэвтрэх</Link></div>
      </Card>
    </div>
  );
}

export function VerifyCertificate() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code) return;
    setResult(null);
    setError(null);
    api(`/public/certificates/verify/${encodeURIComponent(code)}`).then(setResult).catch(setError);
  }, [code]);

  return (
    <div className="public-wrap">
      <Card title="Гэрчилгээ шалгах">
        <form className="row" onSubmit={(e) => { e.preventDefault(); navigate(`/verify/${input.trim()}`); }}>
          <input placeholder="Шалгах код" value={input} onChange={(e) => setInput(e.target.value)} style={{ maxWidth: 280 }} />
          <button className="btn primary">Шалгах</button>
        </form>
        <div style={{ marginTop: 16 }}>
          <ErrorBox error={error} />
          {result && (
            <div className={`alert ${result.valid ? 'ok' : 'err'}`}>
              <b>{result.valid ? '✔ Хүчинтэй гэрчилгээ' : '✘ Энэ гэрчилгээ хүчингүй болсон'}</b>
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Дугаар</dt><dd>{result.certificateNo}</dd>
                <dt>Суралцагч</dt><dd>{result.student}</dd>
                <dt>Сургалт</dt><dd>{result.course} ({result.level})</dd>
                <dt>Байгууллага</dt><dd>{result.branch}</dd>
                <dt>Олгосон</dt><dd>{result.issuedAt}</dd>
              </dl>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
