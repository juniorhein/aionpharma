import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

export default function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/assets/brand/logo.png" alt="Aion Pharma" />
          <span className="brand-sub">CRM</span>
        </div>
        <nav className="nav">
          <NavLink to="/vendas">Vendas</NavLink>
          <NavLink to="/rankings">Rankings</NavLink>
          <span className="nav-sep" aria-hidden />
          <NavLink to="/vitrine">Vitrine</NavLink>
          <NavLink to="/cupons">Cupons</NavLink>
          <NavLink to="/influencers">Influencers</NavLink>
          <NavLink to="/b2b">Contas CNPJ</NavLink>
        </nav>
        <div className="sidebar-foot">
          <p className="user-email">{user?.email}</p>
          <button type="button" className="btn-ghost" onClick={() => signOut()}>
            Sair
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
