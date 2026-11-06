// Нэвтрэлтгүй хуудсууд: онлайн бүртгэлийн маягт, гэрчилгээ шалгах
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ErrorBox, errorText } from '../components/ui.jsx';
import PublicShell from '../components/PublicShell.jsx';

const STEPS = [
  ['Хүсэлт илгээх', 'Доорх маягтыг бөглөнө'],
  ['Холбогдох', 'Манай ажилтан утсаар холбогдоно'],
  ['Түвшин тогтоох', 'Англи хэлний түвшнээ тогтоолгоно'],
  ['Суралцаж эхлэх', 'Тохирох ангидаа элсэнэ'],
];

const EMPTY_FORM = { contactName: '', contactPhone: '', studentName: '', studentBirthDate: '', interestedCourseId: '', note: '', website: '' };

function Input({ label, required, hint, children }) {
  return (
    <label className="pub-field">
      <span className="pub-label">{label}{required && <i>*</i>}</span>
      {children}
      {hint && <span className="pub-hint">{hint}</span>}
    </label>
  );
}

// Веб болон Facebook-ийн холбоос: /register?source=FACEBOOK&branch=MAIN
export function PublicLeadForm() {
  const params = new URLSearchParams(window.location.search);
  const [options, setOptions] = useState(null);
  const [branchCode, setBranchCode] = useState(params.get('branch') ?? '');
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/public/form-options').then((o) => {
      setOptions(o);
      if (o.branches.length === 1) setBranchCode(o.branches[0].code);
    }).catch(setError);
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, branchCode, source: params.get('source') === 'FACEBOOK' ? 'FACEBOOK' : 'WEB_FORM' };
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

  const reset = () => {
    setForm(EMPTY_FORM);
    setDone(false);
  };

  const branch = options?.branches.find((b) => b.code === branchCode);

  return (
    <PublicShell>
      <div className="pub-layout">
        <aside className="pub-intro">
          <h1>Сургалтад бүртгүүлэх</h1>
          <p>Хүсэлтээ үлдээгээрэй. Бид тантай холбогдож, суралцагчийн түвшинд тохирох сургалтыг санал болгоно.</p>
          <ol className="pub-steps">
            {STEPS.map(([title, text], i) => (
              <li key={title} className={done && i === 0 ? 'done' : ''}>
                <span className="pub-step-no">{done && i === 0 ? '✓' : i + 1}</span>
                <span><b>{title}</b><small>{text}</small></span>
              </li>
            ))}
          </ol>
          {branch && (branch.phone || branch.address) && (
            <div className="pub-contact">
              <b>{branch.name}</b>
              {branch.address && <span>📍 {branch.address}</span>}
              {branch.phone && <span>📞 <a href={`tel:${branch.phone}`}>{branch.phone}</a></span>}
            </div>
          )}
        </aside>

        <section className="pub-card">
          {done ? (
            <div className="pub-success">
              <span className="pub-success-icon">✓</span>
              <h2>Хүсэлт амжилттай илгээгдлээ</h2>
              <p>Манай ажилтан <b>{form.contactPhone}</b> дугаараар удахгүй холбогдоно. Баярлалаа!</p>
              <div className="pub-actions">
                <button type="button" className="pub-btn ghost" onClick={reset}>Өөр хүн бүртгүүлэх</button>
                <Link to="/login" className="pub-btn">Нүүр хуудас</Link>
              </div>
            </div>
          ) : !options && !error ? (
            <div className="pub-loading">Ачаалж байна…</div>
          ) : (
            <form onSubmit={submit}>
              <ErrorBox error={error} />

              {options && options.branches.length > 1 && (
                <fieldset className="pub-section">
                  <legend>Салбар</legend>
                  <div className="pub-choices">
                    {options.branches.map((b) => (
                      <label key={b.code} className={`pub-choice ${branchCode === b.code ? 'on' : ''}`}>
                        <input type="radio" name="branch" required value={b.code} checked={branchCode === b.code} onChange={() => setBranchCode(b.code)} />
                        <b>{b.name}</b>
                        {b.address && <small>{b.address}</small>}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <fieldset className="pub-section">
                <legend>Холбогдох хүн</legend>
                <div className="pub-grid">
                  <Input label="Таны нэр (эцэг эх)" required>
                    <input required autoComplete="name" placeholder="Жишээ: Болд" value={form.contactName} onChange={set('contactName')} />
                  </Input>
                  <Input label="Утасны дугаар" required hint="8 оронтой дугаар">
                    <input required type="tel" inputMode="tel" autoComplete="tel" placeholder="9911 2233" pattern="\+?[\d\s\-]{8,20}" value={form.contactPhone} onChange={set('contactPhone')} />
                  </Input>
                </div>
              </fieldset>

              <fieldset className="pub-section">
                <legend>Суралцагч</legend>
                <div className="pub-grid">
                  <Input label="Суралцагчийн нэр" required>
                    <input required placeholder="Жишээ: Тэмүүлэн" value={form.studentName} onChange={set('studentName')} />
                  </Input>
                  <Input label="Төрсөн огноо">
                    <input type="date" value={form.studentBirthDate} onChange={set('studentBirthDate')} />
                  </Input>
                </div>
              </fieldset>

              <fieldset className="pub-section">
                <legend>Сургалт</legend>
                <div className="pub-grid one">
                  <Input label="Сонирхож буй сургалт" hint="Мэдэхгүй бол хоосон үлдээгээрэй — түвшин тогтоосны дараа санал болгоно">
                    <select value={form.interestedCourseId} onChange={set('interestedCourseId')}>
                      <option value="">Түвшин тогтоосны дараа сонгоно</option>
                      {options?.courses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.level.code})</option>)}
                    </select>
                  </Input>
                  <Input label="Нэмэлт мэдээлэл">
                    <textarea rows={3} placeholder="Хичээллэх боломжтой цаг, асуух зүйл гэх мэт" value={form.note} onChange={set('note')} />
                  </Input>
                </div>
              </fieldset>

              {/* Ботоос хамгаалах далд талбар */}
              <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true" />

              <button className="pub-btn wide" disabled={busy || !branchCode}>{busy ? 'Илгээж байна…' : 'Хүсэлт илгээх'}</button>
              <p className="pub-note">Таны мэдээллийг зөвхөн бүртгэлийн зорилгоор ашиглана.</p>
            </form>
          )}
        </section>
      </div>
    </PublicShell>
  );
}

export function VerifyCertificate() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setInput(code ?? '');
    setResult(null);
    setError(null);
    if (!code) return;
    setLoading(true);
    api(`/public/certificates/verify/${encodeURIComponent(code)}`)
      .then(setResult)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [code]);

  const submit = (e) => {
    e.preventDefault();
    const v = input.trim().toUpperCase();
    if (v) navigate(`/verify/${encodeURIComponent(v)}`);
  };

  return (
    <PublicShell>
      <div className="pub-verify">
        <div className="pub-verify-head">
          <span className="pub-verify-icon">🎓</span>
          <h1>Гэрчилгээ шалгах</h1>
          <p>Гэрчилгээн дээрх QR кодыг утсаараа уншуулах, эсвэл шалгах кодыг доор оруулна уу.</p>
        </div>

        <form className="pub-search" onSubmit={submit}>
          <input
            autoFocus={!code}
            placeholder="Шалгах код"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            autoCapitalize="characters"
          />
          <button className="pub-btn" disabled={!input.trim() || loading}>{loading ? 'Шалгаж байна…' : 'Шалгах'}</button>
        </form>

        {error && (
          <div className="pub-result bad">
            <span className="pub-seal">!</span>
            <div>
              <h2>{error.status === 404 ? 'Гэрчилгээ олдсонгүй' : 'Шалгах үед алдаа гарлаа'}</h2>
              <p>{error.status === 404 ? 'Оруулсан кодоо дахин нягтална уу. Асуудал гарвал сургалтын төвтэй холбогдоно уу.' : errorText(error)}</p>
            </div>
          </div>
        )}

        {result && (
          <div className={`pub-result ${result.valid ? 'good' : 'bad'}`}>
            <span className="pub-seal">{result.valid ? '✓' : '✕'}</span>
            <div className="pub-result-body">
              <h2>{result.valid ? 'Хүчинтэй гэрчилгээ' : 'Энэ гэрчилгээ хүчингүй болсон'}</h2>
              <p>{result.valid ? 'Энэхүү гэрчилгээг манай сургалтын төв олгосон бөгөөд бүртгэлд баталгаажсан.' : 'Гэрчилгээ цуцлагдсан тул хүчин төгөлдөр бус.'}</p>
              <dl className="pub-cert">
                <div><dt>Гэрчилгээний дугаар</dt><dd>{result.certificateNo}</dd></div>
                <div><dt>Суралцагч</dt><dd>{result.student}</dd></div>
                <div><dt>Сургалт</dt><dd>{result.course} <span className="pub-level">{result.level}</span></dd></div>
                <div><dt>Олгосон огноо</dt><dd>{result.issuedAt}</dd></div>
                <div className="full"><dt>Олгосон байгууллага</dt><dd>{result.branch}</dd></div>
              </dl>
            </div>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
