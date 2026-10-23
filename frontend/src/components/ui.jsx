// =====================================================================
// Нийтлэг UI бүрэлдэхүүн
// =====================================================================
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { label, tone } from '../lib/format.js';

// ----- Өгөгдөл ачаалах hook -----
export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api(path);
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

// ----- Мэдэгдэл (toast) -----
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, message, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}</div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// Үйлдэл ажиллуулж, амжилт/алдааг toast-оор харуулна
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, successMessage) => {
    setBusy(true);
    try {
      const r = await fn();
      if (successMessage) toast(successMessage);
      return r;
    } catch (e) {
      toast(errorText(e), 'err');
      // Хэрэглэгчид харуулсан тул main.jsx-ийн unhandledrejection дуугүй болгоно;
      // дахин шидэх нь дуудагчийн дараагийн алхмыг (navigate, хаах) зогсооно
      if (e && typeof e === 'object') e.handled = true;
      throw e;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

export function errorText(e) {
  const details = e?.details;
  if (Array.isArray(details)) return `${e.message}: ${details.map((d) => `${d.path ? `${d.path} — ` : ''}${d.message}`).join('; ')}`;
  if (details?.reasons) return `${e.message}: ${details.reasons.join('; ')}`;
  if (details?.clashes) return `${e.message}: ${details.clashes.map((c) => `${c.class} ${c.time ?? ''}`).join(', ')}`;
  return e?.message ?? 'Алдаа гарлаа';
}

// ----- Энгийн бүрэлдэхүүн -----
export const Badge = ({ value, children }) => <span className={`badge ${tone(value)}`}>{children ?? label(value)}</span>;

export function Loading({ children = 'Ачаалж байна…' }) {
  return <div className="muted pad">{children}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert err">{errorText(error)}</div>;
}

export function Empty({ children = 'Мэдээлэл алга' }) {
  return <div className="empty">{children}</div>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label: l, value, hint, tone: t }) {
  return (
    <div className={`stat ${t ?? ''}`}>
      <div className="stat-label">{l}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

// columns: [{ key, title, render?(row), className? }]
export function Table({ columns, rows, empty = 'Мэдээлэл алга', onRowClick, rowKey = 'id' }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.className}>{c.title}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Хаах">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={value === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ----- Форм -----
export function Field({ label: l, children, hint, full }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">{l}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// values-ийг удирдах энгийн form hook
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = (name, { type } = {}) => ({
    name,
    value: type === 'checkbox' ? undefined : values[name] ?? '',
    checked: type === 'checkbox' ? Boolean(values[name]) : undefined,
    onChange: (e) => {
      const v = type === 'checkbox' ? e.target.checked : e.target.value;
      setValues((s) => ({ ...s, [name]: v }));
    },
  });
  return { values, setValues, bind, set: (k, v) => setValues((s) => ({ ...s, [k]: v })) };
}

// Хоосон мөрийг илгээхгүй, тоог хувиргана
export function clean(values, numeric = []) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === undefined) continue;
    out[k] = numeric.includes(k) ? Number(v) : v;
  }
  return out;
}

export function Select({ options, placeholder = '— Сонгох —', ...props }) {
  return (
    <select {...props}>
      {placeholder !== null && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function ConfirmButton({ children, confirmText = 'Итгэлтэй байна уу?', onConfirm, className = 'btn', disabled }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="confirm-inline">
        <span>{confirmText}</span>
        <button type="button" className="btn danger sm" onClick={() => { setAsking(false); onConfirm(); }}>Тийм</button>
        <button type="button" className="btn ghost sm" onClick={() => setAsking(false)}>Үгүй</button>
      </span>
    );
  }
  return <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>{children}</button>;
}

// Шалтгаан асуудаг жижиг форм (цуцлах, залруулах, буцаах)
export function ReasonModal({ title, onClose, onSubmit, extra, submitLabel = 'Хадгалах' }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try { await onSubmit(reason); onClose(); } catch { /* toast харуулсан */ } finally { setBusy(false); }
        }}
      >
        {extra}
        <Field label="Шалтгаан (заавал)" full>
          <textarea required minLength={3} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
