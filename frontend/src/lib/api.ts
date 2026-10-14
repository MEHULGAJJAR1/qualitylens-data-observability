import type {
  Alert, AppSettings, ColumnProfile, Dataset, DriftItem, Overview, Page, Preview,
  QualityItem, ReportItem, Rule, Run, RunDetail, Schedule, SchemaChange,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new ApiError(`Cannot reach the QualityLens API. Is the backend running on port 8000? ${String(error)}`, 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch { /* keep fallback */ }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function params(values: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const api = {
  overview: () => request<Overview>('/overview'),
  health: () => request<{ status: string; database: { kind: string; connected: boolean; error?: string | null } }>('/health'),
  datasets: (q = '', page = 1, limit = 100) => request<Page<Dataset>>(`/datasets${params({ q, page, limit })}`),
  dataset: (id: string) => request<Dataset>(`/datasets/${id}`),
  createDataset: (payload: { name: string; description: string }) => request<Dataset>('/datasets', { method: 'POST', body: JSON.stringify(payload) }),
  uploadDataset: (form: FormData) => request<Dataset & { uploaded_role: string; uploaded_rows: number; uploaded_columns: number }>('/datasets/upload', { method: 'POST', body: form }),
  deleteDataset: (id: string) => request<void>(`/datasets/${id}`, { method: 'DELETE' }),
  profiles: (id: string) => request<{ items: ColumnProfile[] }>(`/datasets/${id}/profiles`),
  preview: (id: string, role = 'current', q = '', page = 1, limit = 10) => request<Preview>(`/datasets/${id}/preview${params({ role, q, page, limit })}`),
  rules: (id: string) => request<{ items: Rule[] }>(`/datasets/${id}/rules`),
  createRule: (datasetId: string, payload: Partial<Rule>) => request<Rule>(`/datasets/${datasetId}/rules`, { method: 'POST', body: JSON.stringify(payload) }),
  updateRule: (id: string, payload: Partial<Rule>) => request<Rule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRule: (id: string) => request<void>(`/rules/${id}`, { method: 'DELETE' }),
  quality: (datasetId?: string) => request<{ items: QualityItem[] }>(`/quality${params({ dataset_id: datasetId })}`),
  drift: (datasetId?: string) => request<{ items: DriftItem[] }>(`/drift${params({ dataset_id: datasetId })}`),
  schemaChanges: (filters: Record<string, string | number | boolean | undefined | null> = {}) => request<Page<SchemaChange>>(`/schema-changes${params(filters)}`),
  acknowledgeSchema: (id: string, payload: { acknowledged: boolean; notes?: string }) => request<{ id: string; acknowledged: boolean }>(`/schema-changes/${id}/acknowledge`, { method: 'PATCH', body: JSON.stringify(payload) }),
  runs: (filters: Record<string, string | number | undefined | null> = {}) => request<Page<Run>>(`/runs${params(filters)}`),
  run: (id: string) => request<RunDetail>(`/runs/${id}`),
  triggerRun: (datasetId: string) => request<Run>('/runs', { method: 'POST', body: JSON.stringify({ dataset_id: datasetId, trigger_type: 'manual' }) }),
  alerts: (filters: Record<string, string | number | undefined | null> = {}) => request<Page<Alert>>(`/alerts${params(filters)}`),
  updateAlert: (id: string, payload: { action: 'acknowledge' | 'resolve' | 'reopen'; notes?: string }) => request<Partial<Alert>>(`/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  reports: (filters: Record<string, string | number | undefined | null> = {}) => request<Page<ReportItem>>(`/reports${params(filters)}`),
  schedules: () => request<{ items: Schedule[] }>('/schedules'),
  createSchedule: (payload: { dataset_id: string; name: string; interval_minutes: number; active: boolean }) => request<Schedule>('/schedules', { method: 'POST', body: JSON.stringify(payload) }),
  updateSchedule: (id: string, payload: Partial<Schedule>) => request<Schedule>(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSchedule: (id: string) => request<void>(`/schedules/${id}`, { method: 'DELETE' }),
  settings: () => request<AppSettings>('/settings'),
  updateSettings: (payload: Partial<AppSettings>) => request<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
};

export async function downloadReport(path: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ApiError('Cannot reach the report endpoint. Check that the backend is running.', 0);
  }
  if (!response.ok) {
    let message = `Report download failed (${response.status})`;
    try { const body = await response.json(); message = body.detail || message; } catch { /* no-op */ }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'qualitylens-report';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
