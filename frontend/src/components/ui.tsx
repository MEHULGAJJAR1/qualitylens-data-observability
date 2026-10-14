import type { ReactNode, SelectHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Check, CircleHelp, Inbox, RefreshCw } from 'lucide-react';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-header">
    <div className="min-w-0"><div className="page-eyebrow">{eyebrow || 'DATA OBSERVABILITY'}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>;
}

export function Card({ children, className = '', title, subtitle, action }: { children: ReactNode; className?: string; title?: string; subtitle?: string; action?: ReactNode }) {
  return <section className={`card ${className}`}>
    {(title || subtitle || action) && <div className="card-heading"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{action}</div>}
    {children}
  </section>;
}

export function MetricCard({ label, value, meta, icon, accent = 'blue', loading = false }: { label: string; value: ReactNode; meta?: string; icon: ReactNode; accent?: 'blue' | 'green' | 'amber' | 'violet'; loading?: boolean }) {
  return <div className="metric-card">
    <div className={`metric-icon metric-${accent}`}>{icon}</div>
    <div className="metric-label">{label}</div>
    {loading ? <div className="skeleton metric-skeleton" /> : <div className="metric-value">{value}</div>}
    {meta && <div className="metric-meta">{meta}</div>}
  </div>;
}

const severityClasses: Record<string, string> = {
  critical: 'badge badge-red', high: 'badge badge-orange', medium: 'badge badge-amber', low: 'badge badge-slate',
  healthy: 'badge badge-green', completed: 'badge badge-green', passed: 'badge badge-green', no_drift: 'badge badge-green',
  detected_drift: 'badge badge-amber', insufficient_data: 'badge badge-slate', failed_comparison: 'badge badge-red',
  failed: 'badge badge-red', attention: 'badge badge-amber', open: 'badge badge-red', acknowledged: 'badge badge-blue',
  resolved: 'badge badge-green', running: 'badge badge-blue', queued: 'badge badge-slate', not_monitored: 'badge badge-slate',
  not_run: 'badge badge-slate', reference: 'badge badge-violet', current: 'badge badge-blue',
};
export function Badge({ children, tone, className = '' }: { children: ReactNode; tone?: string; className?: string }) {
  const key = tone || String(children).toLowerCase().replaceAll(' ', '_');
  return <span className={`${severityClasses[key] || 'badge badge-slate'} ${className}`}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={status}>{label || status.replaceAll('_', ' ')}</Badge>;
}

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return <button className={`button button-${variant} button-${size} ${className}`} {...props}>{children}</button>;
}

export function IconButton({ children, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function EmptyState({ title, detail, icon }: { title: string; detail?: string; icon?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon || <Inbox size={22} />}</div><div className="empty-title">{title}</div>{detail && <p>{detail}</p>}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return <div className="error-state"><div className="error-icon"><AlertTriangle size={19} /></div><div><div className="font-semibold text-ink">We couldn’t load this view</div><div className="error-message">{message}</div></div>{retry && <Button variant="secondary" size="sm" onClick={retry}><RefreshCw size={14} /> Retry</Button>}</div>;
}

export function LoadingRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return <div className="space-y-3 p-5" aria-label="Loading">
    {Array.from({ length: rows }, (_, row) => <div className="flex gap-4" key={row}>{Array.from({ length: columns }, (_, col) => <div key={col} className={`skeleton h-4 ${col === 0 ? 'w-40' : 'flex-1'}`} />)}</div>)}
  </div>;
}

export function SelectField({ label, className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return <label className={`field ${className}`}>{label && <span className="field-label">{label}</span>}<select className="input select-input" {...props}>{children}</select></label>;
}

export function TextField({ label, hint, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return <label className={`field ${className}`}>{label && <span className="field-label">{label}</span>}<input className="input" {...props} />{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function TextAreaField({ label, hint, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }) {
  return <label className={`field ${className}`}>{label && <span className="field-label">{label}</span>}<textarea className="input textarea" {...props} />{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function DataTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`table-wrap ${className}`}><table className="data-table">{children}</table></div>;
}

export function formatDate(value?: string | null, includeTime = true): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, includeTime ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function formatNumber(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function formatScore(value?: number | null): string { return value === undefined || value === null ? '—' : `${Math.round(value)}%`; }
export function scoreTone(value?: number | null): string { return value === undefined || value === null ? 'text-muted' : value >= 95 ? 'text-green' : value >= 80 ? 'text-amber' : 'text-red'; }
export function shortId(value: string): string { return value.slice(0, 8).toUpperCase(); }

export function ProgressBar({ value, color = 'blue' }: { value: number; color?: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return <div className="progress-track" role="progressbar" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={100}><div className={`progress-fill progress-${color}`} style={{ width: `${safe}%` }} /></div>;
}

export function SectionLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return <div className="section-label"><span>{children}</span>{trailing}</div>;
}

export function InfoTip({ children }: { children: ReactNode }) {
  return <span className="info-tip" title={String(children)}><CircleHelp size={14} /></span>;
}

export function Checkmark({ checked }: { checked: boolean }) { return checked ? <Check size={15} className="text-green" /> : <span className="text-muted">—</span>; }
