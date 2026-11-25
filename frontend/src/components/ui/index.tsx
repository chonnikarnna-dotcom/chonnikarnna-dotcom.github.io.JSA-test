/** Small shadcn/ui-style component set (Tailwind, accessible defaults). */
import React, { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ───────────── Button ─────────────
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'warning';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-500',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 focus-visible:ring-slate-400',
  outline: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-500',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-500',
  warning: 'bg-amber-500 text-slate-900 hover:bg-amber-600 focus-visible:ring-amber-400',
};
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' | 'icon'; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'primary', size = 'md', loading, disabled, children, ...p }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap',
      variants[variant],
      size === 'sm' && 'h-8 px-3 text-sm', size === 'md' && 'h-10 px-4 text-sm', size === 'lg' && 'h-12 px-6 text-base', size === 'icon' && 'h-9 w-9',
      className,
    )}
    {...p}
  >
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

// ───────────── Form controls ─────────────
const fieldBase = 'w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-100';
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...p} />
));
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-[80px] py-2', className)} {...p} />
));
Textarea.displayName = 'Textarea';
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(fieldBase, 'h-10 pr-8', className)} {...p}>{children}</select>
));
Select.displayName = 'Select';
export const Checkbox = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }>(({ className, label, id, ...p }, ref) => {
  const gen = useId();
  const cid = id ?? gen;
  return (
    <label htmlFor={cid} className={cn('inline-flex items-start gap-2 text-sm text-slate-800 cursor-pointer', className)}>
      <input ref={ref} id={cid} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-400 text-brand-700 focus:ring-brand-500" {...p} />
      {label && <span>{label}</span>}
    </label>
  );
});
Checkbox.displayName = 'Checkbox';

export function Field({ label, error, hint, required, children, className, htmlFor }: { label?: React.ReactNode; error?: string | null; hint?: React.ReactNode; required?: boolean; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
          {label}{required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="flex items-center gap-1 text-xs text-red-700"><XCircle className="h-3.5 w-3.5" aria-hidden />{error}</p>}
    </div>
  );
}

// ───────────── Layout ─────────────
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)} {...p} />;
export const CardHeader = ({ className, title, action, subtitle }: { className?: string; title: React.ReactNode; action?: React.ReactNode; subtitle?: React.ReactNode }) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3', className)}>
    <div><h2 className="text-base font-semibold text-slate-900">{title}</h2>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>
    {action}
  </div>
);
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('p-4', className)} {...p} />;

export function Badge({ className, children, tone = 'slate', icon }: { className?: string; children: React.ReactNode; tone?: 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'purple' | 'orange' | 'gray'; icon?: React.ReactNode }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-300', blue: 'bg-blue-50 text-blue-800 ring-blue-300', amber: 'bg-amber-50 text-amber-900 ring-amber-300',
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-300', red: 'bg-red-50 text-red-800 ring-red-300', purple: 'bg-violet-50 text-violet-800 ring-violet-300',
    orange: 'bg-orange-50 text-orange-900 ring-orange-300', gray: 'bg-gray-100 text-gray-600 ring-gray-300',
  };
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>{icon}{children}</span>;
}

export function Alert({ tone = 'info', title, children, className, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const map = {
    info: ['border-blue-200 bg-blue-50 text-blue-900', Info], warning: ['border-amber-300 bg-amber-50 text-amber-900', AlertTriangle],
    danger: ['border-red-300 bg-red-50 text-red-900', XCircle], success: ['border-emerald-300 bg-emerald-50 text-emerald-900', CheckCircle2],
  } as const;
  const [cls, Icon] = map[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-md border p-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{title && <p className="font-semibold">{title}</p>}{children && <div className="mt-0.5">{children}</div>}</div>
      {action}
    </div>
  );
}

export const Spinner = ({ className, label }: { className?: string; label?: string }) => (
  <div className={cn('flex items-center justify-center gap-2 py-10 text-slate-500', className)} role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /><span className="text-sm">{label}</span></div>
);
export const EmptyState = ({ icon, title, children }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-slate-500">
    {icon && <div className="text-slate-300">{icon}</div>}
    <p className="font-medium text-slate-700">{title}</p>{children}
  </div>
);

// ───────────── Tabs ─────────────
export function Tabs({ tabs, value, onChange, className }: { tabs: { id: string; label: React.ReactNode; badge?: React.ReactNode }[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-slate-900')}>
          {t.label}{t.badge}
        </button>
      ))}
    </div>
  );
}

// ───────────── Table ─────────────
export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto"><table className={cn('w-full text-left text-sm', className)} {...p} /></div>
);
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn('whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600', className)} {...p} />;
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('border-b border-slate-100 px-3 py-2 align-top', className)} {...p} />;

// ───────────── Dialog ─────────────
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('textarea, input, select, button:not([data-close])')?.focus(), 30);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" className={cn('flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl',
        size === 'sm' && 'sm:max-w-md', size === 'md' && 'sm:max-w-lg', size === 'lg' && 'sm:max-w-2xl', size === 'xl' && 'sm:max-w-4xl')}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button data-close onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t bg-slate-50 px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmOpts = { title: React.ReactNode; message?: React.ReactNode; confirmLabel?: React.ReactNode; cancelLabel?: React.ReactNode; tone?: Variant };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export function ConfirmProvider({ children, labels }: { children: React.ReactNode; labels: { confirm: string; cancel: string } }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onClose={() => close(false)} title={state?.title} size="sm"
        footer={<><Button variant="outline" onClick={() => close(false)}>{state?.cancelLabel ?? labels.cancel}</Button><Button variant={state?.tone ?? 'primary'} onClick={() => close(true)}>{state?.confirmLabel ?? labels.confirm}</Button></>}>
        <div className="text-sm text-slate-700">{state?.message}</div>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ───────────── Toasts ─────────────
type Toast = { id: number; tone: 'success' | 'danger' | 'info' | 'warning'; text: React.ReactNode };
const ToastCtx = createContext<(tone: Toast['tone'], text: React.ReactNode) => void>(() => undefined);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: React.ReactNode) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'danger' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-sm shadow-lg"><Alert tone={t.tone}>{t.text}</Alert></div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Pagination({ page, pageSize, total, onPage, label }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label: (p: number, n: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-600">
      <span>{label(page, pages)}</span>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</Button>
      </div>
    </div>
  );
}
