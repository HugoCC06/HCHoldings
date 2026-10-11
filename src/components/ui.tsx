import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { cx } from '../lib/format';

// ---------------------------------------------------------------- Buttons
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: ReactNode; loading?: boolean };
export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className, ...rest }: BtnProps) {
  return (
    <button {...rest} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', !children && 'btn-icon', className)} disabled={rest.disabled || loading}>
      {loading ? <Loader2 size={15} className="spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Layout primitives
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, pad = true, sub }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; sub?: ReactNode }) {
  return (
    <section className={cx('panel', className)}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className={cx(pad && 'panel-body')}>{children}</div>
    </section>
  );
}

export function Empty({ title, children, action, compact }: { title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('empty', compact && 'empty-compact')}>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <Loader2 size={18} className="spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <AlertTriangle size={16} /> {(error as Error).message ?? String(error)}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'accent'; title?: string }) {
  return (
    <span className={cx('badge', `badge-${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, hint, tone }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{label}</div>
      <div className={cx('stat-value', tone && `tone-${tone}`)}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Delta({ value, invert, suffix }: { value: number | null; invert?: boolean; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="muted">—</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.0005;
  return (
    <span className={cx('delta', !flat && (good ? 'tone-good' : 'tone-bad'))}>
      {flat ? '±' : value > 0 ? '▲' : '▼'} {Math.abs(value * 100).toFixed(1)}%{suffix ? ` ${suffix}` : ''}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={cx('tab', value === t.key && 'active')} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { key: T; label: ReactNode; icon?: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.key} className={cx(value === o.key && 'active')} onClick={() => onChange(o.key)} type="button">
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="progress" aria-valuenow={Math.round(pct)} role="progressbar">
      <div style={{ width: `${pct}%` }} className={cx(value !== null && value >= 1 && 'done')} />
    </div>
  );
}

// ---------------------------------------------------------------- Forms
export function Field({ label, error, hint, children, span }: { label: string; error?: string; hint?: ReactNode; children: (id: string) => ReactNode; span?: 1 | 2 | 3 }) {
  const id = useId();
  return (
    <div className={cx('field', span && `span-${span}`, error && 'has-error')}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string | number | null | undefined; onChange: (v: string) => void };
export function Input({ value, onChange, className, ...rest }: InputProps) {
  return <input {...rest} className={cx('input', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function MoneyInput({ value, onChange, currency, ...rest }: InputProps & { currency?: string }) {
  return (
    <div className="input-affix">
      <span>{currencySymbol(currency ?? 'GBP')}</span>
      <Input {...rest} inputMode="decimal" placeholder={rest.placeholder ?? '0.00'} value={value} onChange={onChange} />
    </div>
  );
}

export function currencySymbol(c: string) {
  return (0).toLocaleString('en-GB', { style: 'currency', currency: c, minimumFractionDigits: 0 }).replace(/[\d\s.,]/g, '') || c;
}

export function Textarea({ value, onChange, className, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & { value: string | null | undefined; onChange: (v: string) => void }) {
  return <textarea {...rest} className={cx('input', 'textarea', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function Select<T extends string>({ value, onChange, options, placeholder, className, ...rest }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & { value: T | '' | null | undefined; onChange: (v: T) => void; options: { value: T; label: string }[] | Record<T, string>; placeholder?: string }) {
  const opts = Array.isArray(options) ? options : (Object.entries(options) as [T, string][]).map(([v, l]) => ({ value: v, label: l }));
  return (
    <select {...rest} className={cx('input', 'select', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={cx('form-grid', `cols-${cols}`)}>{children}</div>;
}

// ---------------------------------------------------------------- Modal
export function Modal({ title, onClose, children, footer, width = 640 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: width }} ref={ref}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Standard form modal: submit on Enter (ctrl+enter in textareas), error display, save/cancel. */
export function FormModal({ title, onClose, onSubmit, saving, error, children, width, extraActions, submitLabel = 'Save' }: { title: ReactNode; onClose: () => void; onSubmit: () => void; saving?: boolean; error?: string | null; children: ReactNode; width?: number; extraActions?: ReactNode; submitLabel?: string }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={width}
      footer={
        <>
          <div>{extraActions}</div>
          <div className="row gap-sm">
            <Button variant="ghost" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" onClick={onSubmit} loading={saving} type="button">
              {submitLabel}
            </Button>
          </div>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
        }}
      >
        {error && <div className="alert alert-error">{error}</div>}
        {children}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Confirm & toast
interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
type ToastT = { id: number; tone: 'good' | 'bad' | 'info'; text: string };
const ToastCtx = createContext<(text: string, tone?: ToastT['tone']) => void>(() => {});

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const toast = useCallback((text: string, tone: ToastT['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3200);
  }, []);
  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={toast}>
        {children}
        {pending && (
          <Modal
            title={pending.title}
            onClose={() => close(false)}
            width={460}
            footer={
              <>
                <div />
                <div className="row gap-sm">
                  <Button variant="ghost" onClick={() => close(false)}>
                    Cancel
                  </Button>
                  <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                    {pending.confirmLabel ?? 'Confirm'}
                  </Button>
                </div>
              </>
            }
          >
            <div className="confirm-body">{pending.body}</div>
          </Modal>
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={cx('toast', `toast-${t.tone}`)}>
              {t.tone === 'good' ? <CheckCircle2 size={16} /> : t.tone === 'bad' ? <AlertTriangle size={16} /> : <Info size={16} />}
              {t.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);
export const useToast = () => useContext(ToastCtx);

export function AssetLogo({ name, logo, size = 28 }: { name: string; logo?: string | null; size?: number }) {
  if (logo) return <img src={logo} alt="" className="asset-logo" style={{ width: size, height: size }} />;
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return (
    <span className="asset-logo asset-logo-fallback" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}
