// M4 — Каталог: түвшин, хөтөлбөр, курс (төгсөлтийн босго), үнийн багц, танхим
import { useState } from 'react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Select, Table, Tabs, useAction, useApi, useForm } from '../components/ui.jsx';
import { BranchSelect } from './leads.jsx';

// Ерөнхий засварлах цонх: fields = [{ name, label, type?, options?, required?, numeric? }]
function EditModal({ title, fields, initial, onClose, onSubmit }) {
  const { values, bind } = useForm(initial);
  const [run, busy] = useAction();
  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const body = {};
        for (const f of fields) {
          const v = values[f.name];
          if (f.type === 'checkbox') body[f.name] = Boolean(v);
          else if (v !== '' && v !== undefined && v !== null) body[f.name] = f.numeric ? Number(v) : v;
        }
        await run(() => onSubmit(body), 'Хадгаллаа');
        onClose();
      }}>
        {fields.map((f) => (f.render ? <f.render key={f.name} {...bind(f.name)} /> : (
          <Field key={f.name} label={f.label} full={f.full}>
            {f.options ? <Select required={f.required} {...bind(f.name)} options={f.options} />
              : f.type === 'checkbox' ? <span className="check"><input type="checkbox" {...bind(f.name, { type: 'checkbox' })} /> {f.hint ?? 'Тийм'}</span>
                : f.type === 'textarea' ? <textarea rows={3} {...bind(f.name)} />
                  : <input type={f.type ?? 'text'} step={f.step} required={f.required} {...bind(f.name)} />}
          </Field>
        )))}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Болих</button>
          <button className="btn primary" disabled={busy}>Хадгалах</button>
        </div>
      </form>
    </Modal>
  );
}

function CrudTab({ path, columns, fields, defaults, title }) {
  const { data, loading, error, reload } = useApi(path);
  const [editing, setEditing] = useState(null);
  const base = path.split('?')[0];
  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}><button type="button" className="btn primary" onClick={() => setEditing({})}>+ {title}</button></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Table rows={data} onRowClick={(r) => setEditing(r)} columns={columns} />
      )}
      {editing && (
        <EditModal
          title={editing.id ? `${title} засах` : `Шинэ ${title.toLowerCase()}`}
          fields={fields}
          initial={{ ...defaults, ...Object.fromEntries(fields.map((f) => [f.name, editing[f.name] ?? defaults[f.name] ?? ''])) }}
          onClose={() => { setEditing(null); reload(); }}
          onSubmit={(body) => (editing.id ? api(`${base}/${editing.id}`, { method: 'PUT', body }) : api(base, { method: 'POST', body }))}
        />
      )}
    </>
  );
}

const active = (r) => <Badge value={r.isActive ? 'ACTIVE' : 'INACTIVE'} />;

export function CatalogPage() {
  const [tab, setTab] = useState('courses');
  const programs = useApi('/catalog/programs');
  const levels = useApi('/catalog/levels');
  const courses = useApi('/catalog/courses');
  const programOpts = (programs.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const levelOpts = (levels.data ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` }));
  const courseOpts = (courses.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));

  return (
    <>
      <PageHeader title="Хөтөлбөр, курс, танхим" subtitle="Курс бүрт төгсөлтийн босго (ирц, дүн, төлбөр) тохируулна" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'courses', label: 'Курс' }, { key: 'packages', label: 'Үнийн багц' }, { key: 'programs', label: 'Хөтөлбөр' },
        { key: 'levels', label: 'Түвшин' }, { key: 'classrooms', label: 'Танхим' },
      ]} />
      {tab === 'courses' && (
        <CrudTab path="/catalog/courses" title="Курс"
          defaults={{ sessionMinutes: 90, minAttendancePercent: 80, minFinalScore: 60, requireFullPayment: true, isActive: true }}
          columns={[
            { key: 'code', title: 'Код', className: 'mono' }, { key: 'name', title: 'Нэр' },
            { key: 'p', title: 'Хөтөлбөр', render: (c) => c.program.name }, { key: 'l', title: 'Түвшин', render: (c) => c.level.code },
            { key: 'totalSessions', title: 'Хичээл' }, { key: 'sessionMinutes', title: 'Минут' },
            { key: 'g', title: 'Төгсөлтийн босго', render: (c) => `ирц ≥${Number(c.minAttendancePercent)}%, дүн ≥${Number(c.minFinalScore)}${c.requireFullPayment ? ', бүрэн төлбөр' : ''}` },
            { key: 'a', title: 'Төлөв', render: active },
          ]}
          fields={[
            { name: 'programId', label: 'Хөтөлбөр', options: programOpts, required: true, numeric: true },
            { name: 'levelId', label: 'Түвшин', options: levelOpts, required: true, numeric: true },
            { name: 'code', label: 'Код', required: true }, { name: 'name', label: 'Нэр', required: true },
            { name: 'totalSessions', label: 'Нийт хичээл', type: 'number', required: true, numeric: true },
            { name: 'sessionMinutes', label: 'Нэг хичээл (мин)', type: 'number', numeric: true },
            { name: 'minAttendancePercent', label: 'Ирцийн босго (%)', type: 'number', numeric: true },
            { name: 'minFinalScore', label: 'Эцсийн дүнгийн босго', type: 'number', numeric: true },
            { name: 'requireFullPayment', label: 'Төлбөр', type: 'checkbox', hint: 'Гэрчилгээнд бүрэн төлсөн байх' },
            { name: 'isActive', label: 'Идэвхтэй', type: 'checkbox' },
          ]} />
      )}
      {tab === 'packages' && (
        <CrudTab path="/catalog/packages" title="Багц" defaults={{ isActive: true }}
          columns={[
            { key: 'c', title: 'Курс', render: (p) => p.course.name }, { key: 'name', title: 'Нэр' },
            { key: 'sessionsCount', title: 'Хичээл' }, { key: 'durationWeeks', title: 'Долоо хоног' },
            { key: 'price', title: 'Үнэ', className: 'right', render: (p) => money(p.price) }, { key: 'a', title: 'Төлөв', render: active },
          ]}
          fields={[
            { name: 'courseId', label: 'Курс', options: courseOpts, required: true, numeric: true },
            { name: 'name', label: 'Нэр', required: true },
            { name: 'sessionsCount', label: 'Хичээлийн тоо', type: 'number', required: true, numeric: true },
            { name: 'durationWeeks', label: 'Хугацаа (долоо хоног)', type: 'number', required: true, numeric: true },
            { name: 'price', label: 'Үнэ (₮)', type: 'number', step: '1000', required: true, numeric: true },
            { name: 'isActive', label: 'Идэвхтэй', type: 'checkbox' },
          ]} />
      )}
      {tab === 'programs' && (
        <CrudTab path="/catalog/programs" title="Хөтөлбөр" defaults={{ isActive: true }}
          columns={[{ key: 'name', title: 'Нэр' }, { key: 'targetGroup', title: 'Зорилтот бүлэг' }, { key: 'c', title: 'Курс', render: (p) => p._count.courses }, { key: 'a', title: 'Төлөв', render: active }]}
          fields={[
            { name: 'name', label: 'Нэр', required: true }, { name: 'targetGroup', label: 'Зорилтот бүлэг' },
            { name: 'description', label: 'Тайлбар', type: 'textarea', full: true }, { name: 'isActive', label: 'Идэвхтэй', type: 'checkbox' },
          ]} />
      )}
      {tab === 'levels' && (
        <CrudTab path="/catalog/levels" title="Түвшин" defaults={{}}
          columns={[{ key: 'code', title: 'Код' }, { key: 'name', title: 'Нэр' }, { key: 'sortOrder', title: 'Дараалал' }]}
          fields={[{ name: 'code', label: 'Код', required: true }, { name: 'name', label: 'Нэр', required: true }, { name: 'sortOrder', label: 'Дараалал', type: 'number', numeric: true }]} />
      )}
      {tab === 'classrooms' && (
        <CrudTab path="/catalog/classrooms" title="Танхим" defaults={{ isActive: true }}
          columns={[{ key: 'b', title: 'Салбар', render: (r) => r.branch.name }, { key: 'name', title: 'Нэр' }, { key: 'capacity', title: 'Багтаамж' }, { key: 'a', title: 'Төлөв', render: active }]}
          fields={[
            { name: 'branchId', render: BranchSelect, numeric: true },
            { name: 'name', label: 'Нэр', required: true }, { name: 'capacity', label: 'Багтаамж', type: 'number', required: true, numeric: true },
            { name: 'isActive', label: 'Идэвхтэй', type: 'checkbox' },
          ]} />
      )}
    </>
  );
}
