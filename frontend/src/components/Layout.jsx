// Үндсэн layout: эрхээс хамаарсан цэс, мэдэгдлийн тоо
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE } from '../lib/format.js';

const ADMIN = ['SUPER_ADMIN', 'BRANCH_ADMIN'];
const OFFICE = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'];

// [бүлэг, [[зам, нэр, эрхүүд]]]
const MENU = [
  ['', [
    ['/', 'Нүүр', null],
    ['/notifications', 'Мэдэгдэл', null],
  ]],
  ['Сурагчийн удирдлага (M1)', [
    ['/leads', 'Сонирхогч, бүртгэл', ADMIN],
    ['/students', 'Сурагчид', [...OFFICE, 'TEACHER']],
    ['/parents', 'Эцэг эх', ADMIN],
    ['/enrollments', 'Элсэлт', OFFICE],
  ]],
  ['Сургалт ба үнэлгээ (M4)', [
    ['/classes', 'Анги', [...ADMIN, 'TEACHER']],
    ['/sessions', 'Хичээлийн хуваарь', [...ADMIN, 'TEACHER']],
    ['/assignments', 'Даалгавар', [...ADMIN, 'TEACHER']],
    ['/exams', 'Шалгалт', [...ADMIN, 'TEACHER']],
    ['/catalog', 'Хөтөлбөр, курс, танхим', ADMIN],
    ['/certificates', 'Гэрчилгээ', ADMIN],
  ]],
  ['Миний сургалт', [
    ['/scan', 'QR ирц бүртгүүлэх', ['STUDENT']],
    ['/my/assignments', 'Даалгавар', ['STUDENT']],
    ['/my/exams', 'Онлайн шалгалт', ['STUDENT']],
    ['/portal/requests', 'Чөлөө, лавлагаа', ['PARENT']],
  ]],
  ['Төлбөр ба санхүү (M3)', [
    ['/finance/invoices', 'Нэхэмжлэл', OFFICE],
    ['/finance/payments', 'Төлөлт', OFFICE],
    ['/finance/receivables', 'Авлага', OFFICE],
    ['/finance/cash', 'Кассын тайлан', OFFICE],
    ['/finance/expenses', 'Зарлага', OFFICE],
    ['/finance/import', 'Excel импорт', OFFICE],
    ['/finance/payouts', 'Багшийн хөлс', OFFICE],
  ]],
  ['Багшийн удирдлага (M6)', [
    ['/teachers', 'Багш нар', OFFICE],
    ['/teaching-hours', 'Заасан цаг', [...OFFICE, 'TEACHER']],
    ['/me/teacher', 'Миний профайл', ['TEACHER']],
  ]],
  ['Эцэг эхийн портал (M5)', [
    ['/requests', 'Эцэг эхийн хүсэлт', ADMIN],
  ]],
  ['Удирдлага ба салбар (M7)', [
    ['/reports', 'Нэгдсэн тайлан', OFFICE],
    ['/branches', 'Салбар', ADMIN],
    ['/users', 'Хэрэглэгч, эрх', ADMIN],
    ['/audit', 'Өөрчлөлтийн түүх', ADMIN],
  ]],
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    let alive = true;
    const load = () => api('/notifications?unread=1').then((r) => alive && setUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [location.pathname]);

  const groups = MENU.map(([title, items]) => [title, items.filter(([, , roles]) => !roles || roles.includes(user.role))]).filter(([, items]) => items.length);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">Алхам ERP</div>
        <div className="brand-sub">Англи хэлний сургалтын төв</div>
        <nav className="nav">
          {groups.map(([title, items]) => (
            <div key={title || 'main'}>
              {title && <div className="nav-group">{title}</div>}
              {items.map(([to, name]) => <NavLink key={to} to={to} end={to === '/'}>{name}</NavLink>)}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost menu-btn" onClick={() => setOpen((v) => !v)} aria-label="Цэс">☰</button>
          <div className="muted small branch-name">{user.branch?.name ?? (user.role === 'SUPER_ADMIN' ? 'Бүх салбар' : '')}</div>
          <div className="who">
            <button type="button" className="btn ghost bell" onClick={() => navigate('/notifications')} aria-label="Мэдэгдэл">
              🔔{unread > 0 && <span className="dot">{unread}</span>}
            </button>
            <NavLink to="/profile" className="small">{user.displayName} · {ROLE[user.role]}</NavLink>
            <button type="button" className="btn sm" onClick={() => { logout(); navigate('/login'); }}>Гарах</button>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
