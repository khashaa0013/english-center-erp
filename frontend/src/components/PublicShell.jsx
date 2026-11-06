// Нэвтрэлтгүй хуудсуудын нийтлэг хүрээ: арын зураг, лого, дээд холбоосууд
import { Link, NavLink } from 'react-router-dom';

const LINKS = [
  ['/login', 'Нэвтрэх'],
  ['/register', 'Сургалтад бүртгүүлэх'],
  ['/verify', 'Гэрчилгээ шалгах'],
];

export default function PublicShell({ children }) {
  return (
    <div className="login-page">
      <header className="login-top">
        <Link to="/login" className="login-brand">
          <span className="login-logo"><img src="/lingora-mark.png" alt="" /></span>
          <span>
            <strong>Lingora</strong>
            <small>English Learning ERP</small>
          </span>
        </Link>
        <nav className="login-links">
          {LINKS.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
      </header>
      <main className="login-main">{children}</main>
    </div>
  );
}
