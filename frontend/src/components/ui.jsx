import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Inbox, RotateCw, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt } from '../lib/stats';
import { onToast } from '../lib/toast';

export const CardTitle = ({ id, children, sub, action }) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 id={id} className="font-semibold">{children}</h2>
      {sub && <p className="mt-0.5 text-xs text-ink/60">{sub}</p>}
    </div>
    {action}
  </div>
);

export const StatCard = ({ title, icon: Icon, iconClass, value, unit, foot }) => (
  <article className="flex flex-col justify-between gap-3 rounded-2xl bg-white p-4 text-ink shadow-[0_14px_34px_-20px_rgb(0_0_0/0.6)]">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className={`grid size-7 place-items-center rounded-full ${iconClass}`} aria-hidden="true">
        <Icon size={14} strokeWidth={2.5} />
      </span>
    </div>
    <p className="min-w-0 truncate">
      <span className="tabular text-2xl font-bold tracking-tight">{value}</span> {unit && <span className="text-xs font-medium text-ink/60">{unit}</span>}
    </p>
    {foot && <p className="truncate text-xs text-ink/60">{foot}</p>}
  </article>
);

// ---------- loading, empty, error ----------
const pulse = 'animate-pulse motion-reduce:animate-none';

// Page-level skeleton on the dark panel.
export const Loading = ({ label = 'Loading' }) => (
  <div role="status" className="grid gap-4">
    <span className="sr-only">{label}...</span>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`h-28 rounded-2xl bg-white/10 ${pulse}`} />
      ))}
    </div>
    <div className={`h-64 rounded-2xl bg-white/10 ${pulse}`} aria-hidden="true" />
  </div>
);

// Skeleton rows inside a table body.
export const SkeletonRows = ({ cols, rows = 4 }) =>
  Array.from({ length: rows }, (_, r) => (
    <tr key={r} aria-hidden="true" className="border-b border-line/40 last:border-0">
      {Array.from({ length: cols }, (_, c) => (
        <td key={c} className="px-4 py-3">
          <span className={`block h-3 rounded bg-ink/10 ${pulse}`} style={{ width: `${50 + ((r * 7 + c * 13) % 45)}%` }} />
        </td>
      ))}
    </tr>
  ));

// Empty state inside a white card.
export const Empty = ({ icon: Icon = Inbox, title, hint, action }) => (
  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
    <span className="grid size-11 place-items-center rounded-full bg-accent/15 text-accent-deep" aria-hidden="true">
      <Icon size={20} />
    </span>
    <p className="font-semibold">{title}</p>
    {hint && <p className="max-w-sm text-sm text-ink/60">{hint}</p>}
    {action}
  </div>
);

// Error on the dark panel.
export const ErrorBanner = ({ error, onRetry }) => (
  <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-bad/20 px-4 py-3 text-sm text-white ring-1 ring-bad/40">
    <CircleAlert size={18} className="shrink-0" aria-hidden="true" />
    <p className="min-w-0 flex-1">{error?.message || String(error)}</p>
    {onRetry && (
      <button type="button" onClick={onRetry} className="btn-glass h-8 px-3 text-xs">
        <RotateCw size={14} aria-hidden="true" /> Retry
      </button>
    )}
  </div>
);

// Error and success messages inside a white card.
export const FormError = ({ children }) =>
  children ? (
    <p role="alert" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad ring-1 ring-bad/30">
      {children}
    </p>
  ) : null;

export const Notice = ({ children }) => (
  <p role="status" className={children ? 'rounded-xl bg-good/10 px-3 py-2 text-sm font-medium text-[#17663a] ring-1 ring-good/30' : 'sr-only'}>
    {children}
  </p>
);

// ---------- form field: input, select (children = options) or textarea ----------
// `warn` flags a value that is allowed but worth attention (for example a mark under the pass minimum).
export function Field({ id, label, error, warn, hint, className = '', as = 'input', children, ...input }) {
  const message = error || warn;
  const describedBy = [hint && `${id}-hint`, message && `${id}-err`].filter(Boolean).join(' ') || undefined;
  const Tag = as;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <Tag
        id={id}
        className={`field ${as === 'textarea' ? 'h-auto min-h-24 py-2' : ''} ${message ? '!border-bad bg-bad/5' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      >
        {children}
      </Tag>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink/60">
          {hint}
        </p>
      )}
      {message && (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-bad">
          {message}
        </p>
      )}
    </div>
  );
}

// ---------- chips ----------
const GRADE_TONE = { 'A+': 'bg-good/15 text-[#17663a]', A: 'bg-good/15 text-[#17663a]', 'B+': 'bg-info/15 text-[#2a5aa8]', B: 'bg-info/15 text-[#2a5aa8]', C: 'bg-warn/20 text-[#7a4b00]', D: 'bg-warn/20 text-[#7a4b00]', F: 'bg-bad/15 text-bad' };
export const GradeBadge = ({ grade }) =>
  grade ? (
    <span className={`inline-grid min-w-8 place-items-center rounded-md px-1.5 py-0.5 text-xs font-bold ${GRADE_TONE[grade] ?? 'bg-ink/10 text-ink'}`}>
      {grade}
      {grade === 'F' && <span className="sr-only"> (fail)</span>}
    </span>
  ) : (
    <span className="text-ink/50">-</span>
  );

// Per-subject result from the server. Reasons (plain-English strings) show on hover/focus and to screen readers.
const RESULT = {
  pass: ['Pass', 'bg-good/15 text-[#17663a]'],
  fail: ['Fail', 'bg-bad/15 text-bad'],
  shortage: ['Low attendance', 'bg-warn/20 text-[#7a4b00]'],
  pending: ['Pending', 'bg-ink/10 text-ink/70'],
};
export const ResultChip = ({ result, reasons = [] }) => {
  if (!result) return <span className="text-ink/50">-</span>;
  const [label, cls] = RESULT[result] ?? [result, 'bg-ink/10 text-ink/70'];
  const why = (reasons ?? []).join('; ');
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`} title={why || undefined}>
      {label}
      {why && <span className="sr-only">: {why}</span>}
    </span>
  );
};

// Chip that expands (keyboard-accessible <details>) to list the reasons, when there are any.
export const ResultWithReasons = ({ result, reasons }) =>
  reasons?.length ? (
    <details className="group">
      <summary className="cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden">
        <ResultChip result={result} reasons={reasons} /> <span className="text-xs text-ink/60 underline underline-offset-2 group-open:hidden">why?</span>
      </summary>
      <ul className="mt-1 list-disc pl-4 text-xs text-ink/75">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  ) : (
    <ResultChip result={result} />
  );

const STATUS_TONE = {
  good: ['completed', 'approved', 'confirmed', 'synced'],
  info: ['in_progress', 'submitted'],
  warn: ['proposed', 'requested', 'pending'],
  bad: ['declined', 'rejected'],
};
const TONE_CLASS = { good: 'bg-good/15 text-[#17663a]', info: 'bg-info/15 text-[#2a5aa8]', warn: 'bg-warn/20 text-[#7a4b00]', bad: 'bg-bad/15 text-bad', muted: 'bg-ink/10 text-ink/70' };
export const StatusChip = ({ status }) => {
  const tone = Object.keys(STATUS_TONE).find((k) => STATUS_TONE[k].includes(status)) ?? 'muted';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${TONE_CLASS[tone]}`}>{String(status ?? '').replace(/_/g, ' ')}</span>;
};

// ---------- charts ----------
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Bar chart on a card. The SVG is hidden from screen readers; a visually hidden table carries the same numbers.
// `series` lists the value keys to draw; `max` fixes the y-axis (null = counts). A data row may carry `color`.
export function BarCard({ title, sub, data, series = [{ key: 'value', label: 'Average', color: '#f26b1d' }], max = 100, className = '', empty = 'No data yet.' }) {
  const id = useId();
  const show = (v) => (v == null ? '-' : max ? fmt(v) : v);
  return (
    <section className={`card ${className}`} aria-labelledby={id}>
      <CardTitle id={id} sub={sub}>{title}</CardTitle>
      {data.length ? (
        <>
          <div className="h-64" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e8e1d6" />
                <XAxis dataKey="label" tick={{ fill: '#6d645b', fontSize: 12 }} tickLine={false} axisLine={false} interval={0} />
                <YAxis domain={max ? [0, max] : [0, 'auto']} allowDecimals={!!max} tick={{ fill: '#6d645b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'rgb(31 26 20 / 0.05)' }} formatter={(v, name) => [show(v), name]} contentStyle={{ borderRadius: 12, border: '1px solid #cfc4b4', color: '#1f1a14' }} />
                {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: '#1f1a14' }} />}
                {series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={!reduceMotion()}>
                    {series.length === 1 && data.map((d) => <Cell key={d.label} fill={d.color ?? s.color} />)}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">Group</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <th scope="row">{d.label}</th>
                  {series.map((s) => (
                    <td key={s.key}>{show(d[s.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="py-8 text-center text-sm text-ink/60">{empty}</p>
      )}
    </section>
  );
}

// Horizontal meter for values out of 100.
export const Meter = ({ value, tone = 'bg-accent' }) => (
  <span className="block h-2 w-full min-w-16 rounded-full bg-ink/10" aria-hidden="true">
    <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} />
  </span>
);

// ---------- dialogs ----------
// Native <dialog>: focus trap, Escape to close and an inert page behind it for free.
export function Modal({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={id}
      className={`m-auto max-h-[calc(100dvh-2rem)] ${wide ? 'w-[min(56rem,calc(100vw-2rem))]' : 'w-[min(40rem,calc(100vw-2rem))]'} rounded-2xl bg-card p-0 text-ink shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm`}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={id} className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-ink/60 hover:bg-ink/5 hover:text-ink">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// Small confirm dialog for destructive actions.
export function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', busy, error, onConfirm, onCancel }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="grid gap-4">
        <div className="text-sm text-ink/80">{children}</div>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost" autoFocus>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn bg-bad text-white hover:bg-bad/85">
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- toasts ----------
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(
    () =>
      onToast((t) => {
        setItems((xs) => [...xs.slice(-3), t]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === 'bad' ? 7000 : 4500);
      }),
    [],
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-24 z-[70] flex flex-col items-end gap-2 sm:left-auto sm:right-5 lg:bottom-5 print:hidden">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'bad' ? 'alert' : undefined}
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-2xl px-4 py-3 text-sm text-white shadow-xl ring-1 backdrop-blur-xl ${
            t.tone === 'bad' ? 'bg-[#5a1d1d]/90 ring-bad/50' : 'bg-[#1c1815]/90 ring-white/15'
          }`}
        >
          {t.tone === 'bad' ? <CircleAlert size={18} className="mt-px shrink-0 text-[#ff8a8a]" aria-hidden="true" /> : <CircleCheck size={18} className="mt-px shrink-0 text-[#6fdc9a]" aria-hidden="true" />}
          <p className="min-w-0 flex-1">{t.message}</p>
          <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="-mr-1 grid size-6 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
