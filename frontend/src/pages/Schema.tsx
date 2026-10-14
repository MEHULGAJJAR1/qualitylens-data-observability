import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowRightLeft, Check, CheckCheck, Clock3, GitCompare, Layers3, Search, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, formatDate, formatNumber, LoadingRows, PageHeader, SelectField, StatusBadge, TextAreaField } from '../components/ui';
import type { SchemaChange } from '../types';

export default function Schema() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(() => params.get('acknowledged') === 'true' ? 'acknowledged' : params.get('acknowledged') === 'false' ? 'open' : 'open');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [ackTarget, setAckTarget] = useState<SchemaChange | null>(null);
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const filters = useMemo(() => ({ acknowledged: status === 'all' ? undefined : status === 'acknowledged', severity: severity || undefined, q: search || undefined, page, limit: 25 }), [status, severity, search, page]);
  const changes = useQuery({ queryKey: ['schema', filters], queryFn: () => api.schemaChanges(filters) });
  const acknowledge = useMutation({
    mutationFn: ({ id, acknowledged, text }: { id: string; acknowledged: boolean; text?: string }) => api.acknowledgeSchema(id, { acknowledged, notes: text }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      notify(variables.acknowledged ? 'Schema change acknowledged' : 'Acknowledgement removed', 'success', variables.acknowledged ? 'This change is now marked as reviewed.' : undefined);
      setAckTarget(null); setNotes('');
    },
    onError: (error) => notify('Could not update schema change', 'error', error instanceof Error ? error.message : 'Request failed'),
  });
  const total = changes.data?.total ?? 0;
  const pageItems = changes.data?.items || [];
  const unacknowledged = pageItems.filter((change) => !change.acknowledged).length;
  const acknowledgedOnPage = pageItems.length - unacknowledged;

  return <div className="space-y-6">
    <PageHeader eyebrow="SCHEMA GOVERNANCE" title="Schema changes" description="Review column additions, removals, possible renames, type and order changes. Acknowledgements are persisted per change." actions={<Button variant="secondary" onClick={() => changes.refetch()}><Clock3 size={15} /> Refresh</Button>} />
    <div className="schema-stat-grid"><div className="schema-stat"><span className="schema-stat-icon amber-stat"><ShieldAlert size={18} /></span><div><small>Unacknowledged on page</small><strong>{formatNumber(unacknowledged)}</strong></div></div><div className="schema-stat"><span className="schema-stat-icon green-stat"><CheckCheck size={18} /></span><div><small>Acknowledged on page</small><strong>{formatNumber(acknowledgedOnPage)}</strong></div></div><div className="schema-stat"><span className="schema-stat-icon blue-stat"><Layers3 size={18} /></span><div><small>Matching records</small><strong>{formatNumber(total)}</strong></div></div></div>
    <Card className="schema-card">
      <div className="schema-toolbar"><div className="schema-tabs" role="tablist" aria-label="Schema acknowledgement filter">
        {[['open', 'Needs review'], ['acknowledged', 'Acknowledged'], ['all', 'All changes']].map(([value, label]) => <button key={value} role="tab" aria-selected={status === value} className={status === value ? 'schema-tab selected' : 'schema-tab'} onClick={() => { setStatus(value); setPage(1); setParams(value === 'all' ? {} : { acknowledged: String(value === 'acknowledged') }); }}>{label}</button>)}
      </div><div className="schema-filters"><label className="catalog-search schema-search"><Search size={15} /><input aria-label="Search schema changes" placeholder="Search column or change…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><SelectField aria-label="Filter severity" value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1); }}><option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></SelectField></div></div>
      {changes.isPending ? <LoadingRows rows={6} columns={5} /> : changes.isError ? <ErrorState error={changes.error} retry={() => changes.refetch()} /> : pageItems.length ? <DataTable>
        <thead><tr><th>CHANGE</th><th>COLUMN</th><th>REFERENCE → CURRENT</th><th>SEVERITY</th><th>DETECTED</th><th>ACKNOWLEDGEMENT</th><th className="text-right">ACTION</th></tr></thead>
        <tbody>{pageItems.map((change) => <SchemaRow key={change.id} change={change} onAcknowledge={() => { setAckTarget(change); setNotes(change.notes || ''); }} onUndo={() => acknowledge.mutate({ id: change.id, acknowledged: false })} busy={acknowledge.isPending} />)}</tbody>
      </DataTable> : <EmptyState title={status === 'open' ? 'No schema changes need review' : 'No schema change records'} detail="Schema differences are created during a monitoring run and persisted with that run." icon={<GitCompare size={22} />} />}
      {changes.data && changes.data.total > changes.data.limit && <div className="table-pagination"><span>Page {changes.data.page} of {Math.ceil(changes.data.total / changes.data.limit)}</span><div><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ArrowLeft size={13} /> Previous</Button><Button size="sm" variant="secondary" disabled={page * changes.data.limit >= changes.data.total} onClick={() => setPage(page + 1)}>Next <ArrowRight size={13} /></Button></div></div>}
    </Card>
    <div className="schema-info-banner"><GitCompare size={16} /><span>Possible renames are proposed heuristically from similar names and compatible inferred types. Review the old and new values before acknowledging.</span></div>
    {ackTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAckTarget(null); }}><section className="modal-card schema-ack-modal" role="dialog" aria-modal="true" aria-labelledby="ack-title">
      <div className="modal-heading"><div><span className="modal-icon"><CheckCheck size={18} /></span><div><h2 id="ack-title">Acknowledge schema change</h2><p>{ackTarget.kind.replaceAll('_', ' ')} · {ackTarget.column_name}</p></div></div><button className="icon-button" aria-label="Close" onClick={() => setAckTarget(null)}>×</button></div>
      <div className="schema-diff-preview"><div><small>Reference</small><strong>{ackTarget.old_value || '—'}</strong></div><ArrowRightLeft size={15} /><div><small>Current</small><strong>{ackTarget.new_value || '—'}</strong></div></div>
      <TextAreaField label="Review notes (optional)" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add investigation context…" rows={3} maxLength={2000} />
      <div className="modal-actions"><Button variant="secondary" onClick={() => setAckTarget(null)}>Cancel</Button><Button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ id: ackTarget.id, acknowledged: true, text: notes })}>{acknowledge.isPending ? 'Saving…' : <><Check size={15} /> Acknowledge change</>}</Button></div>
    </section></div>}
  </div>;
}

function SchemaRow({ change, onAcknowledge, onUndo, busy }: { change: SchemaChange; onAcknowledge: () => void; onUndo: () => void; busy: boolean }) {
  return <tr><td><div className="schema-kind"><span className={`schema-kind-icon ${change.kind}`}><GitCompare size={15} /></span><div><strong>{change.kind.replaceAll('_', ' ')}</strong><small>{change.dataset_name}</small></div></div></td>
    <td><code className="column-code">{change.column_name}</code></td><td><div className="schema-values"><span>{change.old_value || <em>not present</em>}</span><ArrowRight size={13} /><span>{change.new_value || <em>not present</em>}</span></div></td><td><StatusBadge status={change.severity} /></td><td><span className="schema-date">{formatDate(change.created_at)}</span></td>
    <td>{change.acknowledged ? <span className="acknowledged-label"><Check size={14} /> Reviewed{change.acknowledged_at ? ` · ${formatDate(change.acknowledged_at)}` : ''}</span> : <Badge tone="amber">Needs review</Badge>}</td>
    <td className="text-right">{change.acknowledged ? <button className="text-link" disabled={busy} onClick={onUndo}>Undo</button> : <Button size="sm" variant="secondary" onClick={onAcknowledge}><Check size={13} /> Review</Button>}</td></tr>;
}
