import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';
type ToastItem = { id: number; title: string; detail?: string; tone: ToastTone };
type ToastContextValue = { notify: (title: string, tone?: ToastTone, detail?: string) => void };
const ToastContext = createContext<ToastContextValue>({ notify: () => undefined });
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const notify = useCallback((title: string, tone: ToastTone = 'success', detail?: string) => {
    const id = nextId++;
    setItems((current) => [...current.slice(-3), { id, title, detail, tone }]);
    window.setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);
  const value = useMemo(() => ({ notify }), [notify]);
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {items.map((item) => {
        const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? AlertCircle : Info;
        return <div className={`toast toast-${item.tone}`} key={item.id} role="status">
          <Icon size={18} /><div className="min-w-0 flex-1"><div className="font-semibold">{item.title}</div>{item.detail && <div className="toast-detail">{item.detail}</div>}</div>
          <button className="icon-button subtle" onClick={() => dismiss(item.id)} aria-label="Dismiss notification"><X size={16} /></button>
        </div>;
      })}
    </div>
  </ToastContext.Provider>;
}

export function useToast() { return useContext(ToastContext); }
