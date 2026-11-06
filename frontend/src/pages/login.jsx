// Нэвтрэх: том арын зурагтай, хэрэглэгч бүр тусдаа карт → нэр, нууц үг
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { ROLE } from '../lib/format.js';
import { ErrorBox, useApi } from '../components/ui.jsx';
import PublicShell from '../components/PublicShell.jsx';

const ROLE_ORDER = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE', 'TEACHER', 'STUDENT', 'PARENT'];

// "Алхам ... төв — Төв салбар" → "Төв салбар"
const shortBranch = (b) => (b ? b.split('—').pop().trim() : 'Бүх салбар');

export function Login() {
  const { login } = useAuth();
  const { data: users, loading, error } = useApi('/auth/users');
  const [selected, setSelected] = useState(null); // хэрэглэгч эсвэл { manual: true }
  const shown = useMemo(
    () => [...(users ?? [])].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)),
    [users],
  );

  return (
    <PublicShell>
      {selected ? (
        <PasswordPanel key={selected.id ?? 'manual'} user={selected} onBack={() => setSelected(null)} login={login} />
      ) : (
        <section className="login-picker">
          <div className="login-hero">
            <h1>Сургалтын төвийн удирдлагын нэгдсэн систем</h1>
            <p className="login-sub">Сургалт, ирц, төлбөр, санхүү, тайлангийн нэгдсэн ERP</p>
          </div>

          <ErrorBox error={error} />
          <div className="login-grid">
            {loading && Array.from({ length: 6 }, (_, i) => <div key={i} className="login-card skeleton" />)}
            {shown.map((u, i) => (
              <button key={u.id} type="button" className={`login-card role-${u.role}`} style={{ '--i': i }} onClick={() => setSelected(u)}>
                <span className="login-name">{u.displayName}</span>
                <span className="login-role">{ROLE[u.role]}</span>
                <span className="login-branch">{shortBranch(u.branch)}</span>
              </button>
            ))}
          </div>
          {!loading && !error && !shown.length && <div className="login-empty">Нэвтрэх хэрэглэгч бүртгэгдээгүй байна</div>}

          <button type="button" className="login-manual" onClick={() => setSelected({ manual: true })}>
            Жагсаалтад нэр байхгүй юу? Нэвтрэх нэрээ гараар оруулах →
          </button>
        </section>
      )}
    </PublicShell>
  );
}

function PasswordPanel({ user, onBack, login }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`login-panel role-${user.role ?? 'none'}${error ? ' shake' : ''}`} onSubmit={submit}>
      <button type="button" className="login-back" onClick={onBack}>← Буцах</button>

      {user.manual ? (
        <h2 className="login-panel-name">Нэвтрэх</h2>
      ) : (
        <>
          <h2 className="login-panel-name">{user.displayName}</h2>
          <div className="login-panel-meta">
            <span className="login-role">{ROLE[user.role]}</span>
            <span>{shortBranch(user.branch)}</span>
          </div>
        </>
      )}

      <label className="login-field">
        <span>Хэрэглэгчийн нэр</span>
        <input autoFocus autoComplete="username" placeholder="Нэвтрэх нэрээ оруулна уу" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>

      <label className="login-field">
        <span>Нууц үг</span>
        <div className="login-pass">
          <input
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Нуух' : 'Харуулах'}>{show ? 'Нуух' : 'Харах'}</button>
        </div>
      </label>

      <ErrorBox error={error} />
      <button className="login-submit" disabled={busy}>{busy ? 'Нэвтэрч байна…' : 'Нэвтрэх'}</button>
    </form>
  );
}
