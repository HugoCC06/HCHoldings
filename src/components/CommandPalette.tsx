import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, CheckSquare, FileText, FolderKanban, Paperclip, Search, Target, CornerDownLeft } from 'lucide-react';
import { api } from '../lib/api';
import { cx } from '../lib/format';

interface Hit { type: string; id: number; title: string; snippet: string | null }
const ICON: Record<string, typeof Briefcase> = { asset: Briefcase, opportunity: Target, note: FileText, task: CheckSquare, project: FolderKanban, document: Paperclip };
const LINK: Record<string, (id: number) => string> = {
  asset: (id) => `/assets/${id}`,
  opportunity: (id) => `/acquisitions/${id}`,
  note: (id) => `/knowledge?note=${id}`,
  task: (id) => `/work?task=${id}`,
  project: (id) => `/work?project=${id}`,
  document: () => `/knowledge?tab=documents`,
};
const PAGES = [
  { title: 'Dashboard', to: '/' }, { title: 'Assets', to: '/assets' }, { title: 'Finance', to: '/finance' },
  { title: 'Projects & tasks', to: '/work' }, { title: 'Performance', to: '/performance' }, { title: 'Acquisitions', to: '/acquisitions' },
  { title: 'Notes & documents', to: '/knowledge' }, { title: 'Reports', to: '/reports' }, { title: 'Settings & backups', to: '/settings' },
];

export function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (to: string) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);
  const { data: hits = [] } = useQuery({ queryKey: ['search', debounced], queryFn: () => api<Hit[]>(`/api/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 });
  const items = useMemo(() => {
    const pages = PAGES.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase())).map((p) => ({ key: p.to, title: p.title, sub: 'Go to page', to: p.to, Icon: Search }));
    const results = debounced.length >= 2 ? hits.map((h) => ({ key: `${h.type}-${h.id}`, title: h.title, sub: `${h.type[0].toUpperCase()}${h.type.slice(1)}${h.snippet ? ' · ' + h.snippet.slice(0, 90) : ''}`, to: LINK[h.type](h.id), Icon: ICON[h.type] ?? Search })) : [];
    return [...results, ...pages];
  }, [hits, q, debounced]);
  useEffect(() => setActive(0), [items.length]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-label="Search">
        <div className="row" style={{ padding: '4px 10px' }}>
          <Search size={17} className="muted" />
          <input
            autoFocus
            className="input"
            placeholder="Search everything…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && items[active]) onNavigate(items[active].to);
            }}
          />
        </div>
        <div className="palette-results">
          {items.map((it, i) => (
            <div key={it.key} className={cx('palette-item', i === active && 'active')} onMouseEnter={() => setActive(i)} onClick={() => onNavigate(it.to)}>
              <it.Icon size={16} className="muted" style={{ marginTop: 2 }} />
              <div className="grow">
                <div className="ellipsis">{it.title}</div>
                <div className="cell-sub ellipsis">{it.sub}</div>
              </div>
              {i === active && <CornerDownLeft size={14} className="muted" />}
            </div>
          ))}
          {debounced.length >= 2 && !hits.length && <div className="empty empty-compact">No matching records for “{debounced}”.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
