// M3 — Төлбөр ба санхүү
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, authUrl, newKey, qs } from '../lib/api.js';
import { isStaff, useAuth } from '../lib/auth.jsx';
import { addDays, date, dateOnly, dateTime, fullName, label, LABEL, money, todayUb } from '../lib/format.js';
import {
  Badge, Card, clean, ErrorBox, Field, Loading, Modal, PageHeader, ReasonModal, Select, Stat, Table, useAction, useApi, useForm, useToast,
} from '../components/ui.jsx';
import { BranchSelect } from './leads.jsx';

const METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'QPAY'];
const methodOpts = METHODS.map((m) => ({ value: m, label: LABEL[m] }));
// Төлөлтийн COMPLETED нь «хүчинтэй» гэсэн утгатай (элсэлтийн «Дууссан»-аас ялгана)
const PaymentStatus = ({ status }) => <Badge value={status === 'COMPLETED' ? 'PAID' : status}>{status === 'COMPLETED' ? 'Хүчинтэй' : undefined}</Badge>;

// ----- Нэхэмжлэл -----
export function InvoicesPage() {
  const [filter, setFilter] = useState({ status: '', overdue: '', q: '' });
  const { data, loading, error, reload } = useApi(`/finance/invoices${qs(filter)}`);
  const [run, busy] = useAction();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Нэхэмжлэл" subtitle="Элсэлт батлахад автоматаар үүснэ (нэг элсэлт — нэг нэхэмжлэл)">
        <button type="button" className="btn" disabled={busy} onClick={() => run(() => api('/finance/invoices/remind-overdue', { method: 'POST' })).then((r) => { reload(); return r; })}>Хугацаа хэтэрсэнд сануулга илгээх</button>
      </PageHeader>
      <div className="filters">
        <input placeholder="Дугаар, сурагч" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} placeholder="Бүх төлөв" options={['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'].map((s) => ({ value: s, label: LABEL[s] }))} />
        <label className="check"><input type="checkbox" checked={filter.overdue === '1'} onChange={(e) => setFilter({ ...filter, overdue: e.target.checked ? '1' : '' })} /> Зөвхөн хугацаа хэтэрсэн</label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(i) => navigate(`/finance/invoices/${i.id}`)} columns={[
          { key: 'no', title: 'Дугаар', render: (i) => <span className="mono">{i.invoiceNo}</span> },
          { key: 's', title: 'Сурагч', render: (i) => `${i.enrollment.student.studentCode} ${fullName(i.enrollment.student)}` },
          { key: 'c', title: 'Анги', render: (i) => i.enrollment.class.code },
          { key: 't', title: 'Нийт', className: 'right', render: (i) => money(i.totalAmount) },
          { key: 'p', title: 'Төлсөн', className: 'right', render: (i) => money(i.netPaid) },
          { key: 'b', title: 'Үлдэгдэл', className: 'right', render: (i) => <b>{money(i.balance)}</b> },
          { key: 'd', title: 'Хугацаа', render: (i) => <span style={{ color: i.overdue ? 'var(--bad)' : undefined }}>{dateOnly(i.dueDate)}</span> },
          { key: 'st', title: 'Төлөв', render: (i) => <Badge value={i.status} /> },
        ]} />
      )}
    </>
  );
}

function PaymentModal({ invoice, onClose, onSaved }) {
  // Цонх нээгдэх бүрт нэг түлхүүр — давхар дарсан ч нэг л төлөлт бүртгэгдэнэ
  const key = useMemo(() => newKey(), []);
  const { values, bind } = useForm({ amount: Number(invoice.balance), method: 'CASH', referenceNo: '', paidAt: todayUb() });
  const [run, busy] = useAction();
  return (
    <Modal title={`Төлбөр бүртгэх — ${invoice.invoiceNo}`} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api('/finance/payments', { method: 'POST', body: { invoiceId: invoice.id, ...clean(values, ['amount']), idempotencyKey: key } }));
        onSaved(r.duplicate ? 'Энэ төлөлт өмнө бүртгэгдсэн (давхардуулаагүй)' : 'Төлбөр бүртгэгдлээ');
      }}>
        <div className="field full muted">Үлдэгдэл: <b>{money(invoice.balance)}</b>. Хэсэгчлэн төлж болно.</div>
        <Field label="Дүн (₮)"><input type="number" min="1" max={Number(invoice.balance)} step="0.01" required {...bind('amount')} /></Field>
        <Field label="Төлбөрийн хэлбэр"><Select placeholder={null} {...bind('method')} options={methodOpts} /></Field>
        <Field label="Лавлах дугаар (гүйлгээ)"><input {...bind('referenceNo')} /></Field>
        <Field label="Огноо"><input type="date" max={todayUb()} {...bind('paidAt')} /></Field>
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Болих</button><button className="btn primary" disabled={busy}>Бүртгэх</button></div>
      </form>
    </Modal>
  );
}

function RefundModal({ invoice, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [run] = useAction();
  return (
    <ReasonModal
      title="Буцаалт хийх"
      submitLabel="Буцаах"
      onClose={onClose}
      extra={(
        <>
          <div className="field full muted">Төлөгдсөн цэвэр дүн: <b>{money(invoice.netPaid)}</b></div>
          <Field label="Дүн (₮)"><input type="number" min="1" max={Number(invoice.netPaid)} required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Аль төлөлтөөс"><Select value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder="Ерөнхий" options={invoice.payments.filter((p) => p.status === 'COMPLETED').map((p) => ({ value: p.id, label: `${date(p.paidAt)} ${money(p.amount)} ${label(p.method)}` }))} /></Field>
        </>
      )}
      onSubmit={async (reason) => {
        await run(() => api('/finance/refunds', { method: 'POST', body: { invoiceId: invoice.id, amount: Number(amount), reason, ...(paymentId ? { paymentId: Number(paymentId) } : {}) } }), 'Буцаалт бүртгэгдлээ');
        onSaved();
      }}
    />
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { data: inv, loading, error, reload } = useApi(`/finance/invoices/${id}`);
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  const toast = useToast();
  const toastAndReload = (msg) => { setModal(null); reload(); toast(msg); };
  if (loading && !inv) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const open = ['UNPAID', 'PARTIAL'].includes(inv.status);

  return (
    <>
      <PageHeader title={`Нэхэмжлэл ${inv.invoiceNo}`} subtitle={<><Link to={`/students/${inv.enrollment.student.id}?tab=enrollments`}>{fullName(inv.enrollment.student)}</Link> · {inv.enrollment.class.code} · {inv.enrollment.class.course.name} · <Badge value={inv.status} /></>}>
        {open && <button type="button" className="btn primary" onClick={() => setModal('pay')}>Төлбөр бүртгэх</button>}
        {Number(inv.netPaid) > 0 && <button type="button" className="btn" onClick={() => setModal('refund')}>Буцаалт</button>}
        {open && <button type="button" className="btn" onClick={() => run(() => api(`/finance/invoices/${inv.id}/remind`, { method: 'POST' }), 'Сануулга илгээлээ').then(reload)}>Сануулга</button>}
        {open && <button type="button" className="btn" onClick={() => setModal('due')}>Хугацаа өөрчлөх</button>}
      </PageHeader>
      <div className="grid stats">
        <Stat label="Нийт" value={money(inv.totalAmount)} />
        <Stat label="Төлсөн" value={money(inv.paidAmount)} tone="good" />
        <Stat label="Буцаасан" value={money(inv.refundedAmount)} />
        <Stat label="Үлдэгдэл" value={money(inv.balance)} tone={Number(inv.balance) > 0 ? (inv.overdue ? 'bad' : 'warn') : 'good'} hint={`Төлөх хугацаа ${dateOnly(inv.dueDate)}${inv.overdue ? ' · хэтэрсэн' : ''}`} />
      </div>
      <Card title="Төлөлт" className="mt" >
        <Table rows={inv.payments} empty="Төлөлт алга" columns={[
          { key: 'd', title: 'Огноо', render: (p) => dateTime(p.paidAt) },
          { key: 'a', title: 'Дүн', className: 'right', render: (p) => money(p.amount) },
          { key: 'm', title: 'Хэлбэр', render: (p) => label(p.method) },
          { key: 'r', title: 'Лавлах', render: (p) => p.referenceNo ?? '—' },
          { key: 'by', title: 'Хүлээн авсан', render: (p) => p.receiver.displayName },
          { key: 's', title: 'Төлөв', render: (p) => <><PaymentStatus status={p.status} />{p.voidReason && <div className="muted small">{p.voidReason}</div>}</> },
          { key: 'x', title: '', render: (p) => p.status === 'COMPLETED' && <button type="button" className="btn sm danger" onClick={() => setModal({ void: p })}>Хүчингүй</button> },
        ]} />
      </Card>
      {inv.refunds.length > 0 && (
        <Card title="Буцаалт">
          <Table rows={inv.refunds} columns={[
            { key: 'd', title: 'Огноо', render: (r) => dateTime(r.refundedAt) },
            { key: 'a', title: 'Дүн', className: 'right', render: (r) => money(r.amount) },
            { key: 'r', title: 'Шалтгаан', render: (r) => r.reason },
            { key: 'b', title: 'Баталсан', render: (r) => r.approver.displayName },
          ]} />
        </Card>
      )}
      <Card title="Сануулгын түүх">
        <Table rows={inv.reminders} empty="Сануулга илгээгээгүй" columns={[{ key: 'd', title: 'Огноо', render: (r) => dateTime(r.sentAt) }, { key: 'b', title: 'Илгээсэн', render: (r) => r.sender.displayName }, { key: 'c', title: 'Суваг', render: () => 'Систем доторх мэдэгдэл' }]} />
      </Card>
      {modal === 'pay' && <PaymentModal invoice={inv} onClose={() => setModal(null)} onSaved={toastAndReload} />}
      {modal === 'refund' && <RefundModal invoice={inv} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.void && (
        <ReasonModal title="Төлөлт хүчингүй болгох" submitLabel="Хүчингүй болгох" onClose={() => setModal(null)}
          onSubmit={async (reason) => { await run(() => api(`/finance/payments/${modal.void.id}/void`, { method: 'POST', body: { reason } }), 'Хүчингүй болголоо'); reload(); }} />
      )}
      {modal === 'due' && <DueModal invoice={inv} onClose={() => setModal(null)} onSaved={reload} />}
    </>
  );
}

function DueModal({ invoice, onClose, onSaved }) {
  const [due, setDue] = useState(dateOnly(invoice.dueDate));
  const [run] = useAction();
  return (
    <ReasonModal title="Төлөх хугацаа өөрчлөх" onClose={onClose}
      extra={<Field label="Шинэ хугацаа" full><input type="date" required value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
      onSubmit={async (reason) => { await run(() => api(`/finance/invoices/${invoice.id}/due-date`, { method: 'PUT', body: { dueDate: due, reason } }), 'Өөрчлөгдлөө'); onSaved(); }} />
  );
}

// ----- Төлөлтийн жагсаалт -----
export function PaymentsPage() {
  const [filter, setFilter] = useState({ from: addDays(todayUb(), -30), to: todayUb(), method: '' });
  const { data, loading, error } = useApi(`/finance/payments${qs(filter)}`);
  const total = (data ?? []).filter((p) => p.status === 'COMPLETED').reduce((a, p) => a + Number(p.amount), 0);
  return (
    <>
      <PageHeader title="Төлөлт" subtitle={`Нийт: ${money(total)}`}>
        <a className="btn" href={authUrl(`/reports/export/payments${qs({ from: filter.from, to: filter.to })}`)}>Excel татах</a>
      </PageHeader>
      <div className="filters">
        <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
        <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
        <Select value={filter.method} onChange={(e) => setFilter({ ...filter, method: e.target.value })} placeholder="Бүх хэлбэр" options={methodOpts} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} columns={[
          { key: 'd', title: 'Огноо', render: (p) => dateTime(p.paidAt) },
          { key: 'i', title: 'Нэхэмжлэл', render: (p) => <Link to={`/finance/invoices/${p.invoiceId}`} className="mono">{p.invoice.invoiceNo}</Link> },
          { key: 's', title: 'Сурагч', render: (p) => fullName(p.invoice.enrollment.student) },
          { key: 'a', title: 'Дүн', className: 'right', render: (p) => money(p.amount) },
          { key: 'm', title: 'Хэлбэр', render: (p) => label(p.method) },
          { key: 'r', title: 'Лавлах', render: (p) => p.referenceNo ?? '—' },
          { key: 'st', title: 'Төлөв', render: (p) => <PaymentStatus status={p.status} /> },
        ]} />
      )}
    </>
  );
}

// ----- Авлага -----
export function ReceivablesPage() {
  const { data, loading, error } = useApi('/finance/receivables');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Авлага" subtitle="Төлөгдөөгүй үлдэгдэл, хугацаа хэтрэлтээр">
        <a className="btn" href={authUrl('/reports/export/receivables')}>Excel татах</a>
      </PageHeader>
      <ErrorBox error={error} />
      {loading ? <Loading /> : (
        <>
          <div className="grid stats" style={{ marginBottom: 16 }}>
            <Stat label="Нийт авлага" value={money(data.total)} />
            <Stat label="Хугацаа болоогүй" value={money(data.totals.current)} />
            <Stat label="1–30 хоног" value={money(data.totals.d1_30)} tone="warn" />
            <Stat label="31–60 хоног" value={money(data.totals.d31_60)} tone="bad" />
            <Stat label="60+ хоног" value={money(data.totals.d60plus)} tone="bad" />
          </div>
          <Table rows={data.rows} onRowClick={(i) => navigate(`/finance/invoices/${i.id}`)} columns={[
            { key: 'no', title: 'Нэхэмжлэл', render: (i) => <span className="mono">{i.invoiceNo}</span> },
            { key: 's', title: 'Сурагч', render: (i) => fullName(i.enrollment.student) },
            { key: 'b', title: 'Үлдэгдэл', className: 'right', render: (i) => money(i.balance) },
            { key: 'd', title: 'Хугацаа', render: (i) => dateOnly(i.dueDate) },
            { key: 'o', title: 'Хэтэрсэн', render: (i) => (i.overdueDays ? <Badge value="ABSENT">{i.overdueDays} хоног</Badge> : '—') },
          ]} />
        </>
      )}
    </>
  );
}

// ----- Кассын тайлан -----
export function CashPage() {
  const [day, setDay] = useState(todayUb());
  const { data, loading, error } = useApi(`/finance/cash-report?date=${day}`);
  return (
    <>
      <PageHeader title="Өдөр тутмын кассын тайлан">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 'auto' }} />
        <a className="btn" href={authUrl(`/finance/cash-report/export?date=${day}`)}>Excel татах</a>
      </PageHeader>
      <ErrorBox error={error} />
      {loading ? <Loading /> : (
        <>
          <div className="grid stats">
            {METHODS.map((m) => <Stat key={m} label={`Орлого: ${LABEL[m]}`} value={money(data.byMethod[m])} />)}
            <Stat label="Нийт орлого" value={money(data.income)} tone="good" />
            <Stat label="Буцаалт" value={money(data.refunds)} tone="bad" />
            <Stat label="Зарлага" value={money(data.expenses)} tone="bad" />
            <Stat label="Цэвэр" value={money(data.net)} hint={`Бэлэн мөнгөний цэвэр: ${money(data.cashNet)}`} />
          </div>
          <div className="grid two" style={{ marginTop: 16 }}>
            <Card title="Төлөлт">
              <Table rows={data.payments} empty="Төлөлт алга" columns={[
                { key: 'i', title: 'Нэхэмжлэл', render: (p) => p.invoice.invoiceNo },
                { key: 'a', title: 'Дүн', className: 'right', render: (p) => money(p.amount) },
                { key: 'm', title: 'Хэлбэр', render: (p) => label(p.method) },
              ]} />
            </Card>
            <Card title="Зарлага ба буцаалт">
              <Table rows={[...data.expenseRows.map((e) => ({ ...e, kind: e.category })), ...data.refundRows.map((r) => ({ ...r, id: `r${r.id}`, kind: `Буцаалт ${r.invoice.invoiceNo}`, description: r.reason }))]} empty="Алга" columns={[
                { key: 'k', title: 'Төрөл', render: (r) => r.kind },
                { key: 'a', title: 'Дүн', className: 'right', render: (r) => money(r.amount) },
                { key: 'd', title: 'Тайлбар', render: (r) => r.description ?? '—' },
              ]} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// ----- Зарлага -----
export function ExpensesPage() {
  const [filter, setFilter] = useState({ from: addDays(todayUb(), -30), to: todayUb() });
  const { data, loading, error, reload } = useApi(`/finance/expenses${qs(filter)}`);
  const [creating, setCreating] = useState(false);
  const { values, bind } = useForm({ branchId: '', category: '', amount: '', description: '', spentOn: todayUb() });
  const [file, setFile] = useState(null);
  const [run, busy] = useAction();
  return (
    <>
      <PageHeader title="Зарлага" subtitle={`Нийт: ${money((data ?? []).reduce((a, e) => a + Number(e.amount), 0))}`}>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Зарлага</button>
      </PageHeader>
      <div className="filters">
        <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
        <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} columns={[
          { key: 'd', title: 'Огноо', render: (e) => dateOnly(e.spentOn) },
          { key: 'category', title: 'Ангилал' },
          { key: 'a', title: 'Дүн', className: 'right', render: (e) => money(e.amount) },
          { key: 'description', title: 'Тайлбар' },
          { key: 'r', title: 'Баримт', render: (e) => (e.receiptPath ? <a href={authUrl(`/finance/expenses/${e.id}/receipt`)} target="_blank" rel="noreferrer">Харах</a> : '—') },
          { key: 'b', title: 'Бүртгэсэн', render: (e) => e.creator.displayName },
        ]} />
      )}
      {creating && (
        <Modal title="Зарлага бүртгэх" onClose={() => setCreating(false)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData();
            for (const [k, v] of Object.entries(values)) if (v !== '') form.append(k, v);
            if (file) form.append('receipt', file);
            await run(() => api('/finance/expenses', { method: 'POST', form }), 'Бүртгэгдлээ');
            setCreating(false);
            reload();
          }}>
            <BranchSelect {...bind('branchId')} />
            <Field label="Ангилал"><input required list="expense-cats" {...bind('category')} /></Field>
            <datalist id="expense-cats">{['Түрээс', 'Цахилгаан, ус', 'Интернэт', 'Бичиг хэрэг', 'Сурах бичиг', 'Сурталчилгаа', 'Багшийн хөлс', 'Бусад'].map((c) => <option key={c} value={c} />)}</datalist>
            <Field label="Дүн (₮)"><input type="number" min="1" required {...bind('amount')} /></Field>
            <Field label="Огноо"><input type="date" required {...bind('spentOn')} /></Field>
            <Field label="Баримт (зураг, PDF)"><input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files[0])} /></Field>
            <Field label="Тайлбар" full><input {...bind('description')} /></Field>
            <div className="form-actions"><button className="btn primary" disabled={busy}>Хадгалах</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ----- Excel импорт -----
export function ImportPage() {
  const history = useApi('/finance/payment-imports');
  const [current, setCurrent] = useState(null);
  const [file, setFile] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const preview = useApi(current ? `/finance/payment-imports/${current}` : null);
  const imp = preview.data;
  return (
    <>
      <PageHeader title="Төлбөрийн Excel импорт" subtitle="Банкны хуулгыг урьдчилан харж, тулгаж, давхардлыг шалгаад батална">
        <a className="btn" href={authUrl('/finance/payment-imports/template')}>Загвар татах</a>
      </PageHeader>
      <Card title="1. Файл оруулах">
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData();
          form.append('file', file);
          if (e.target.branchId) form.append('branchId', e.target.branchId.value);
          const r = await run(() => api('/finance/payment-imports', { method: 'POST', form }), 'Файлыг шалгалаа');
          setCurrent(r.id);
          history.reload();
        }}>
          <input type="file" accept=".xlsx" required onChange={(e) => setFile(e.target.files[0])} style={{ maxWidth: 360 }} />
          <BranchSelectInline />
          <button className="btn primary" disabled={busy || !file}>Урьдчилан харах</button>
        </form>
        <div className="muted small" style={{ marginTop: 8 }}>Багана: invoice_no, amount, method (CASH, BANK_TRANSFER, CARD, QPAY), reference_no, paid_at</div>
      </Card>
      {imp && (
        <Card title={`2. Тулгалт — ${imp.fileName}`} actions={imp.status === 'PREVIEW' && (
          <>
            <button type="button" className="btn primary" disabled={busy || !imp.validRows} onClick={async () => {
              const r = await run(() => api(`/finance/payment-imports/${imp.id}/confirm`, { method: 'POST' }), 'Импорт батлагдлаа');
              if (r.failed.length) toast(`${r.failed.length} мөр алдаатай: ${r.failed.map((f) => f.rowNo).join(', ')}`, 'err');
              preview.reload();
              history.reload();
            }}>{imp.validRows} мөрийг батлах</button>
            <button type="button" className="btn" onClick={() => run(() => api(`/finance/payment-imports/${imp.id}/cancel`, { method: 'POST' }), 'Цуцаллаа').then(() => { preview.reload(); history.reload(); })}>Цуцлах</button>
          </>
        )}>
          <div className="row" style={{ marginBottom: 8 }}><Badge value={imp.status} /> Нийт {imp.totalRows} · Зөв {imp.validRows}</div>
          <Table rows={imp.rows} columns={[
            { key: 'rowNo', title: 'Мөр' },
            { key: 'invoiceNo', title: 'Нэхэмжлэл' },
            { key: 'a', title: 'Дүн', className: 'right', render: (r) => money(r.amount) },
            { key: 'm', title: 'Хэлбэр', render: (r) => label(r.method) },
            { key: 'referenceNo', title: 'Лавлах' },
            { key: 's', title: 'Төлөв', render: (r) => <Badge value={r.status} /> },
            { key: 'message', title: 'Тайлбар' },
          ]} />
        </Card>
      )}
      <Card title="Импортын түүх">
        <Table rows={history.data} empty="Импорт хийгээгүй" onRowClick={(r) => setCurrent(r.id)} columns={[
          { key: 'd', title: 'Огноо', render: (r) => dateTime(r.createdAt) },
          { key: 'fileName', title: 'Файл' },
          { key: 'c', title: 'Мөр', render: (r) => `${r.validRows}/${r.totalRows}` },
          { key: 's', title: 'Төлөв', render: (r) => <Badge value={r.status} /> },
          { key: 'b', title: 'Хийсэн', render: (r) => r.creator.displayName },
        ]} />
      </Card>
    </>
  );
}

// Захирал файлтай форм дээр салбар сонгоно (name="branchId")
function BranchSelectInline() {
  const { user } = useAuth();
  const { data } = useApi(user.role === 'SUPER_ADMIN' ? '/branches' : null);
  if (user.role !== 'SUPER_ADMIN') return null;
  return <select name="branchId" required style={{ maxWidth: 220 }}>{(data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>;
}

// ----- Багшийн хөлс -----
export function PayoutsPage() {
  const { data, loading, error } = useApi('/finance/payouts');
  const teachers = useApi('/teachers');
  const navigate = useNavigate();
  const monthStart = `${todayUb().slice(0, 8)}01`;
  const { values, bind } = useForm({ teacherId: '', periodStart: monthStart, periodEnd: todayUb() });
  const [run, busy] = useAction();
  return (
    <>
      <PageHeader title="Багшийн хөлсний тооцоо" subtitle="Зөвхөн админ баталгаажуулсан заасан цаг тооцоонд орно" />
      <Card title="Шинэ тооцоо">
        <form className="form" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => api('/finance/payouts', { method: 'POST', body: clean(values, ['teacherId']) }), 'Тооцоо үүслээ');
          navigate(`/finance/payouts/${r.id}`);
        }}>
          <Field label="Багш"><Select required {...bind('teacherId')} options={(teachers.data ?? []).map((t) => ({ value: t.id, label: fullName(t) }))} /></Field>
          <Field label="Эхлэх"><input type="date" required {...bind('periodStart')} /></Field>
          <Field label="Дуусах"><input type="date" required {...bind('periodEnd')} /></Field>
          <div className="form-actions"><button className="btn primary" disabled={busy}>Тооцоо үүсгэх</button></div>
        </form>
      </Card>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Card title="Тооцоонууд">
          <Table rows={data} onRowClick={(p) => navigate(`/finance/payouts/${p.id}`)} columns={[
            { key: 't', title: 'Багш', render: (p) => fullName(p.teacher) },
            { key: 'p', title: 'Хугацаа', render: (p) => `${dateOnly(p.periodStart)} — ${dateOnly(p.periodEnd)}` },
            { key: 'h', title: 'Цаг', render: (p) => `${Math.round(p.totalMinutes / 6) / 10} ц (${p._count.hours} хичээл)` },
            { key: 'a', title: 'Дүн', className: 'right', render: (p) => money(p.totalAmount) },
            { key: 's', title: 'Төлөв', render: (p) => <Badge value={p.status} /> },
          ]} />
        </Card>
      )}
    </>
  );
}

export function PayoutDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: p, loading, error, reload } = useApi(`/finance/payouts/${id}`);
  const [run] = useAction();
  const [cancelling, setCancelling] = useState(false);
  if (loading && !p) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader title={`Хөлсний тооцоо #${p.id}`} subtitle={<>{fullName(p.teacher)} · {dateOnly(p.periodStart)} — {dateOnly(p.periodEnd)} · <Badge value={p.status} /></>}>
        {p.status === 'DRAFT' && isStaff(user) && <button type="button" className="btn primary" onClick={() => run(() => api(`/finance/payouts/${p.id}/approve`, { method: 'POST' }), 'Батлагдлаа').then(reload)}>Батлах</button>}
        {p.status === 'APPROVED' && <button type="button" className="btn primary" onClick={() => run(() => api(`/finance/payouts/${p.id}/pay`, { method: 'POST' }), 'Олгосон. Зарлагад бүртгэгдлээ.').then(reload)}>Олгосон гэж тэмдэглэх</button>}
        {p.status !== 'PAID' && isStaff(user) && <button type="button" className="btn danger" onClick={() => setCancelling(true)}>Цуцлах</button>}
      </PageHeader>
      <div className="grid stats">
        <Stat label="Нийт цаг" value={`${Math.round(p.totalMinutes / 6) / 10} ц`} />
        <Stat label="Нийт дүн" value={money(p.totalAmount)} tone="good" />
        <Stat label="Олгосон" value={p.paidAt ? dateTime(p.paidAt) : '—'} />
      </div>
      <Card title="Тооцоонд орсон цаг" className="mt">
        <Table rows={p.hours} columns={[
          { key: 'd', title: 'Хичээл', render: (h) => dateTime(h.classSession.startsAt) },
          { key: 'c', title: 'Анги', render: (h) => h.classSession.class.code },
          { key: 'm', title: 'Минут', render: (h) => h.actualMinutes },
          { key: 'r', title: 'Тариф', className: 'right', render: (h) => money(h.rate?.hourlyRate) },
          { key: 'a', title: 'Дүн', className: 'right', render: (h) => money(h.amount) },
        ]} />
      </Card>
      {cancelling && (
        <ReasonModal title="Тооцоо цуцлах" submitLabel="Цуцлах" onClose={() => setCancelling(false)}
          onSubmit={async (reason) => { await run(() => api(`/finance/payouts/${p.id}/cancel`, { method: 'POST', body: { reason } }), 'Цуцлагдлаа'); navigate('/finance/payouts'); }} />
      )}
    </>
  );
}
