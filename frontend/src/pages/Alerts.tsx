import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BellRing, Check, CheckCheck, CircleAlert, ClipboardList, Search, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, formatDate, formatNumber, LoadingRows, PageHeader, SelectField, StatusBadge, TextAreaField } from '../components/ui';
import type { Alert } from '../types';

export default function Alerts() {
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Alert | null>(null);
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const filters = useMemo(() => ({ status: status || undefined, severity: severity || undefined, source: source || undefined, q: search || undefined, page, limit: 25 }), [status, severity, source, search, page]);
  const alerts = useQuery({ queryKey: ['alerts', filters], queryFn: () => api.alerts(filters) });
  const countQueries = useQuery({
    queryKey: ['alerts', 'status-counts'],
    queryFn: async () => {
      const [open, acknowledged, resolved] = await Promise.all([
        api.alerts({ status: 'open', limit: 1 }), api.alerts({ status: 'acknowledged', limit: 1 }), api.alerts({ status: 'resolved', limit: 1 }),
      ]);
      return { open: open.total, acknowledged: acknowledged.total, resolved: resolved.total };
    },
  });
  const action = useMutation({
    mutationFn: ({ id, actionName, note }: { id: string; actionName: 'acknowledge' | 'resolve' | 'reopen'; note?: string }) => api.updateAlert(id, { action: actionName, notes: note }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      const statusLabel = result.status === 'acknowledged' ? 'acknowledged' : result.status === 'resolved' ? 'resolved' : 'reopened';
      notify(`Alert ${statusLabel}`, 'success', 'The alert state and investigation notes were saved.');
      setSelected(null);
    },
    onError: (error) => notify('Alert update failed', 'error', error instanceof Error ? error.message : 'Request failed'),
  });
  const items = alerts.data?.items || [];
  const openDetail = (alert: Alert) => { setSelected(alert); setNotes(alert.notes || ''); };

  return <div className="space-y-6">
    <PageHeader eyebrow="INCIDENT MANAGEMENT" title="Alerts" description="Acknowledge, investigate and resolve quality, drift and schema notifications." actions={<Button variant="secondary" onClick={() => { alerts.refetch(); countQueries.refetch(); }}><BellRing size={15} /> Refresh</Button>} />
    <div className="alert-kpi-grid"><div className="alert-kpi alert-kpi-open"><span><CircleAlert size={18} /></span><div><small>Open</small><strong>{formatNumber(countQueries.data?.open || 0)}</strong></div></div><div className="alert-kpi alert-kpi-ack"><span><CheckCheck size={18} /></span><div><small>Acknowledged</small><strong>{formatNumber(countQueries.data?.acknowledged || 0)}</strong></div></div><div className="alert-kpi alert-kpi-resolved"><span><Check size={18} /></span><div><small>Resolved</small><strong>{formatNumber(countQueries.data?.resolved || 0)}</strong></div></div></div>
    <Card className="alerts-card">
      <div className="alerts-toolbar"><div className="alert-status-tabs">{[['open', 'Open'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved'], ['', 'All']].map(([value, label]) => <button key={label} className={status === value ? 'alert-tab active' : 'alert-tab'} onClick={() => { setStatus(value); setPage(1); }}>{label}{value && <span>{countQueries.data?.[value as 'open' | 'acknowledged' | 'resolved'] ?? '·'}</span>}</button>)}</div><div className="alerts-filters"><label className="catalog-search alerts-search"><Search size={15} /><input aria-label="Search alerts" placeholder="Search alert reason…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><SelectField aria-label="Filter alert severity" value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1); }}><option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></SelectField><SelectField aria-label="Filter alert source" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="">All sources</option><option value="data_quality">Data quality</option><option value="drift">Drift</option><option value="schema">Schema</option></SelectField></div></div>
      {alerts.isPending ? <LoadingRows rows={6} columns={5} /> : alerts.isError ? <ErrorState error={alerts.error} retry={() => alerts.refetch()} /> : items.length ? <DataTable>
        <thead><tr><th>ALERT</th><th>DATASET</th><th>SOURCE</th><th>SEVERITY</th><th>STATUS</th><th>TRIGGERED</th><th className="text-right">ACTION</th></tr></thead>
        <tbody>{items.map((alert) => <tr key={alert.id} className="click-row" onClick={() => openDetail(alert)}>
          <td><div className="alert-title-cell"><span className={`alert-source-icon alert-${alert.source}`}><CircleAlert size={15} /></span><div><strong>{alert.title}</strong><small>{shorten(alert.trigger_reason, 78)}</small></div></div></td>
          <td><strong>{alert.dataset_name}</strong></td><td><Badge tone="slate">{alert.source.replaceAll('_', ' ')}</Badge></td><td><StatusBadge status={alert.severity} /></td><td><StatusBadge status={alert.status} /></td><td>{formatDate(alert.created_at)}</td>
          <td className="text-right"><div className="table-actions" onClick={(event) => event.stopPropagation()}><button className="icon-button table-action" aria-label={`Investigate ${alert.title}`} title="Investigate alert" onClick={() => openDetail(alert)}><ClipboardList size={15} /></button>{alert.status === 'open' && <button className="icon-button table-action" aria-label={`Acknowledge ${alert.title}`} title="Acknowledge" onClick={() => action.mutate({ id: alert.id, actionName: 'acknowledge' })}><CheckCheck size={15} /></button>}</div></td>
        </tr>)}</tbody>
      </DataTable> : <EmptyState title={status === 'open' ? 'No open alerts' : 'No alerts found'} detail={search || severity || source ? 'Try adjusting the filters.' : 'Quality, drift and schema issues create alerts when monitoring is run.'} icon={<ShieldAlert size={22} />} />}
      {alerts.data && alerts.data.total > alerts.data.limit && <div className="table-pagination"><span>Page {page} of {Math.ceil(alerts.data.total / alerts.data.limit)}</span><div><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ArrowLeft size={13} /> Previous</Button><Button size="sm" variant="secondary" disabled={page * alerts.data.limit >= alerts.data.total} onClick={() => setPage(page + 1)}>Next <ArrowRight size={13} /></Button></div></div>}
    </Card>
    <div className="alert-dedup-note"><ShieldAlert size={15} /><span>Open and acknowledged alerts are deduplicated by dataset and trigger. Resolving an alert allows a later recurring issue to open a new alert.</span></div>
    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal-card alert-detail-modal" role="dialog" aria-modal="true" aria-labelledby="alert-title">
      <div className="modal-heading"><div><span className={`alert-source-icon alert-${selected.source}`}><CircleAlert size={17} /></span><div><h2 id="alert-title">{selected.title}</h2><p>{selected.dataset_name} · {formatDate(selected.created_at)}</p></div></div><button className="icon-button" aria-label="Close alert details" onClick={() => setSelected(null)}><X size={18} /></button></div>
      <div className="alert-detail-meta"><StatusBadge status={selected.severity} /><Badge tone="slate">{selected.source.replaceAll('_', ' ')}</Badge><StatusBadge status={selected.status} />{selected.run_id && <span>Run {selected.run_id.slice(0, 8).toUpperCase()}</span>}</div>
      <div className="alert-reason"><small>TRIGGER REASON</small><p>{selected.trigger_reason}</p></div>
      <TextAreaField label="Investigation notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={4000} placeholder="Record what you checked, owner, or next action…" />
      <div className="modal-actions alert-actions">
        {selected.status !== 'open' && <Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ id: selected.id, actionName: 'reopen', note: notes })}>Reopen</Button>}
        {selected.status === 'open' && <Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ id: selected.id, actionName: 'acknowledge', note: notes })}><CheckCheck size={15} /> Acknowledge</Button>}
        {selected.status !== 'resolved' && <Button disabled={action.isPending} onClick={() => action.mutate({ id: selected.id, actionName: 'resolve', note: notes })}><Check size={15} /> Resolve alert</Button>}
        {selected.status === 'resolved' && <Button disabled={action.isPending} onClick={() => action.mutate({ id: selected.id, actionName: 'reopen', note: notes })}>Reopen alert</Button>}
      </div>
    </section></div>}
  </div>;
}
function shorten(value: string, max: number) { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
