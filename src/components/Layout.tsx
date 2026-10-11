import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Briefcase, ChevronsLeft, ChevronsRight, FileText, Gauge, KanbanSquare, Landmark, LibraryBig, LogOut, Menu, Search,
  Settings as SettingsIcon, Target,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, useSnapshot } from '../lib/api';
import { isOverdue } from '../../shared/insights';
import { todayISO } from '../../shared/dates';
import { CommandPalette } from './CommandPalette';
import { cx } from '../lib/format';

const NAV = [
  { section: 'Overview' },
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/assets', label: 'Assets', icon: Briefcase },
  { to: '/finance', label: 'Finance', icon: Landmark },
  { section: 'Operate' },
  { to: '/work', label: 'Projects & tasks', icon: KanbanSquare, badge: 'overdue' },
  { to: '/performance', label: 'Performance', icon: BarChart3 },
  { section: 'Grow' },
  { to: '/acquisitions', label: 'Acquisitions', icon: Target },
  { to: '/knowledge', label: 'Notes & documents', icon: LibraryBig },
  { to: '/reports', label: 'Reports', icon: FileText },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hcos.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data } = useSnapshot();
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => api<{ required: boolean }>('/api/auth') });
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('hcos.sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const today = todayISO();
  const overdue = data?.tasks.filter((t) => isOverdue(t, today)).length ?? 0;

  return (
    <div className={cx('shell', collapsed && 'collapsed', mobileOpen && 'mobile-open')}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
              <path d="M8 6v20M24 6v20M8 16h16" stroke="#c9a96a" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">{data?.settings.company_name ?? 'Holding Company'}</div>
            <div className="brand-sub">Private office</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n, i) =>
            'section' in n ? (
              <div className="nav-section" key={i}>
                {n.section}
              </div>
            ) : (
              <NavLink key={n.to} to={n.to} end={'end' in n} title={collapsed ? n.label : undefined}>
                <n.icon size={17} strokeWidth={1.8} />
                <span>{n.label}</span>
                {'badge' in n && overdue > 0 && <em className="nav-badge" title="Overdue tasks">{overdue}</em>}
              </NavLink>
            ),
          )}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className="btn btn-ghost btn-icon" title="Settings & backups">
            <SettingsIcon size={17} />
          </NavLink>
          {auth.data?.required && (
            <button
              className="btn btn-ghost btn-icon"
              title="Lock"
              onClick={async () => {
                await api('/api/auth/logout', { method: 'POST' });
                window.location.reload();
              }}
            >
              <LogOut size={17} />
            </button>
          )}
          <button className="btn btn-ghost btn-icon" style={{ marginLeft: collapsed ? 0 : 'auto' }} onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setMobileOpen((o) => !o)} aria-label="Menu">
            <Menu size={18} />
          </button>
          <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
            <Search size={15} /> Search assets, notes, tasks…
            <kbd>Ctrl K</kbd>
          </button>
        </header>
        <main className="content" key={location.pathname.split('/')[1]}>
          {children}
        </main>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={(to) => { setPaletteOpen(false); navigate(to); }} />}
    </div>
  );
}
