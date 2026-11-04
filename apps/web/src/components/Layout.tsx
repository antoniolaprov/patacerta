import { useState } from 'react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import type { Pet } from '../lib/types';
import { useFetch } from '../lib/useFetch';
import { Assistant } from './Assistant';

const NAV = [
  { to: '/', label: 'Início', icon: '⌂', end: true },
  { to: '/agendar', label: 'Agendar', icon: '＋' },
  { to: '/agendamentos', label: 'Agenda', icon: '◷' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { toasts, dismiss } = useRealtime();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const petMatch = useMatch('/pets/:id');
  const { data: pets } = useFetch<Pet[]>('/pets');
  const currentPet = pets?.find((p) => p.id === petMatch?.params.id);

  return (
    <div className={`shell ${assistantOpen ? 'shell--assistant' : ''}`}>
      <a className="skip" href="#main">
        Ir para o conteúdo
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="PataCerta, início">
          <img src="/logo-icon.png" alt="" width={32} height={32} />
          <span>PataCerta</span>
        </NavLink>
        <nav className="nav" aria-label="Principal">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav__link">
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar__user">
          <span>{user?.name.split(' ')[0]}</span>
          <button className="link-btn" onClick={logout}>
            Sair
          </button>
        </div>
      </header>

      <main id="main" className="main">
        <Outlet />
      </main>

      {!assistantOpen && (
        <button className="pata-fab" onClick={() => setAssistantOpen(true)} aria-label="Pergunte à Pata">
          <img src="/logo-icon.png" alt="" width={28} height={28} />
          <span className="pata-fab__label">Pergunte à Pata</span>
        </button>
      )}
      {assistantOpen && (
        <Assistant
          key={currentPet?.id ?? 'all'}
          petId={currentPet?.id}
          petName={currentPet?.name}
          onClose={() => setAssistantOpen(false)}
        />
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <p>{t.message}</p>
            <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dispensar">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
