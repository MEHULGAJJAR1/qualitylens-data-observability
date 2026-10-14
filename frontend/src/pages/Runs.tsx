import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, FileJson2, FileSpreadsheet, FileText, RefreshCw, Search, X } from 'lucide-react';
import { api, downloadReport } from '../lib/api';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, formatDate, formatNumber, formatScore, LoadingRows, PageHeader, SelectField, StatusBadge, scoreTone, shortId } from '../components/ui';
import type { Run } from '../types';

export default function Runs() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(params.get('run') || '');
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const datasets = useQuery({ queryKey: ['datasets', 'runs'], queryFn: () => api.datasets('', 1, 100) });
  const filters = useMemo(() => ({ dataset_id: datasetId || undefined, status: status || undefined, q: search || undefined, page, limit: 25 }), [datasetId, status, search, page]);
  const runs = useQuery({ queryKey: ['runs', filters], queryFn: () => api.runs(filters) });
  const detail = useQuery({ queryKey: ['run', selectedId], queryFn: () => api.run(selectedId), enabled: Boolean(selectedId) });
  useEffect(() => { const runId = params.get('run') || ''; if (runId) setSelectedId(runId); }, [params]);

  const trigger = useMutation({
    mutationFn: api.triggerRun,
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      queryClient.invalidateQueries({ queryKey: ['drift'] });
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      notify(run.status === 'completed' ? 'Monitoring run completed' : 'Monitoring run failed', run.status === 'completed' ? 'success' : 'error', run.error || `${run.dataset_name} · ${formatScore(run.summary.quality_score)} quality`);
    },
    onError: (error) => notify('Could not trigger monitoring', 'error', error instanceof Error ? error.message : 'Request failed'),
  });
  const selectRun = (run: Run) => { setSelectedId(run.id); setParams({ run: run.id }); };
  const closeRun = () => { setSelectedId(''); setParams({}); };
  const download = async (fmt: 'json' | 'csv' | 'html') => {
    if (!selectedId) return;
    try { await downloadReport(`/runs/${selectedId}/reports/${fmt}`); queryClient.invalidateQueries({ queryKey: ['reports'] }); notify(`${fmt.toUpperCase()} report downloaded`, 'success', 'Generated from persisted monitoring results.'); }
    catch (error) { notify('Report download failed', 'error', error instanceof Error ? error.message : 'Request failed'); }
  };
  const items = runs.data?.items || [];
  const readyDatasets = (datasets.data?.items || []).filter((dataset) => dataset.has_reference && dataset.has_current);

  return <div className="space-y-6">
    <PageHeader eyebrow="EXECUTION HISTORY" title="Monitoring runs" description="Trigger schema, quality, drift and alert checks; inspect persisted outcomes and reports."
      actions={<>
        <SelectField aria-label="Run a dataset" value="" onChange={(event) => { if (event.target.value) trigger.mutate(event.target.value); }} className="header-select"><option value="">{trigger.isPending ? 'Running…' : 'Run a dataset…'}</option>{readyDatasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</SelectField>
        <Button variant="secondary" onClick={() => { runs.refetch(); datasets.refetch(); }}><RefreshCw size={15} /> Refresh</Button>
      </>} />
    <div className="runs-filter-card">
      <label className="catalog-search runs-search"><Search size={15} /><input aria-label="Search runs" placeholder="Search dataset or run ID…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      <SelectField aria-label="Filter runs by dataset" value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setPage(1); }}><option value="">All datasets</option>{(datasets.data?.items || []).map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</SelectField>
      <SelectField aria-label="Filter runs by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="running">Running</option><option value="queued">Queued</option></SelectField>
      <span className="runs-total"><Activity size={15} /> {formatNumber(runs.data?.total || 0)} runs</span>
    </div>
    <Card className="runs-card">
      {runs.isPending ? <LoadingRows rows={7} columns={6} /> : runs.isError ? <ErrorState error={runs.error} retry={() => runs.refetch()} /> : items.length ? <DataTable>
        <thead><tr><th>RUN</th><th>DATASET</th><th>STATUS</th><th>QUALITY</th><th>DRIFT</th><th>STARTED</th><th>DURATION</th><th>TRIGGER</th><th className="text-right">REPORT</th></tr></thead>
        <tbody>{items.map((run) => <tr key={run.id} className="click-row" onClick={() => selectRun(run)}>
          <td><div className="run-id-cell"><span className={`run-list-icon ${run.status}`}><Activity size={14} /></span><div><strong>#{shortId(run.id)}</strong><small>{run.id.slice(9, 17)}</small></div></div></td>
          <td><strong>{run.dataset_name || 'Dataset'}</strong></td><td><StatusBadge status={run.status} /></td>
          <td><span className={`score-cell ${scoreTone(run.summary.quality_score)}`}>{formatScore(run.summary.quality_score)}</span></td>
          <td>{run.summary.drift_status ? <StatusBadge status={run.summary.drift_status} /> : <span className="text-muted">—</span>}</td>
          <td>{formatDate(run.started_at)}</td><td>{run.duration_ms == null ? '—' : `${formatNumber(run.duration_ms)} ms`}</td><td><Badge tone={run.trigger_type === 'scheduled' ? 'violet' : 'slate'}>{run.trigger_type}</Badge></td>
          <td className="text-right"><button className="icon-button table-action" aria-label={`Open report for ${shortId(run.id)}`} title="Open run details and reports" onClick={(event) => { event.stopPropagation(); selectRun(run); }}><FileText size={15} /></button></td>
        </tr>)}</tbody>
      </DataTable> : <EmptyState title="No monitoring runs" detail={search || datasetId || status ? 'No runs match those filters.' : 'Upload reference and current CSVs, then start a run from here or the dataset page.'} icon={<Activity size={22} />} />}
      {runs.data && runs.data.total > runs.data.limit && <div className="table-pagination"><span>Page {page} of {Math.ceil(runs.data.total / runs.data.limit)}</span><div><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ArrowLeft size={13} /> Previous</Button><Button size="sm" variant="secondary" disabled={page * runs.data.limit >= runs.data.total} onClick={() => setPage(page + 1)}>Next <ArrowRight size={13} /></Button></div></div>}
    </Card>
    {selectedId && <RunDrawer detail={detail.data} loading={detail.isPending} error={detail.error} onClose={closeRun} onDownload={download} />}
  </div>;
}

function RunDrawer({ detail, loading, error, onClose, onDownload }: { detail?: any; loading: boolean; error: unknown; onClose: () => void; onDownload: (format: 'json' | 'csv' | 'html') => void }) {
  const run = detail?.run as Run | undefined;
  const drift = detail?.drift;
  const quality = detail?.quality;
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="run-drawer" role="dialog" aria-modal="true" aria-label="Monitoring run details">
    <div className="drawer-topline"><span className="drawer-section-icon"><Activity size={16} /></span><span>MONITORING RUN</span><button className="icon-button ml-auto" aria-label="Close run details" onClick={onClose}><X size={19} /></button></div>
    {loading ? <div className="p-6"><LoadingRows rows={6} columns={3} /></div> : error ? <div className="p-5"><ErrorState error={error} /></div> : run && <>
      <div className="drawer-title-row"><div><div className="run-drawer-id">RUN {shortId(run.id)}</div><h2>{run.dataset_name || 'Dataset'}</h2><p>{formatDate(run.started_at)} · {run.trigger_type} trigger</p></div><StatusBadge status={run.status} /></div>
      {run.error && <div className="run-error-box"><AlertTriangle size={16} /><div><strong>Run error</strong><span>{run.error}</span></div></div>}
      <div className="run-drawer-kpis"><div><small>Quality score</small><strong className={scoreTone(quality?.score)}>{formatScore(quality?.score)}</strong></div><div><small>Checks passed</small><strong>{formatNumber(quality?.checks?.filter((c: any) => c.passed).length || 0)} / {formatNumber(quality?.checks?.length || 0)}</strong></div><div><small>Drifted features</small><strong>{formatNumber(drift?.features_drifted || 0)}</strong></div><div><small>Duration</small><strong>{run.duration_ms == null ? '—' : `${formatNumber(run.duration_ms)} ms`}</strong></div></div>
      <div className="report-downloads"><div><strong>Download report</strong><small>Generated from this run’s persisted results</small></div><div><button onClick={() => onDownload('json')} title="Download JSON" aria-label="Download JSON report"><FileJson2 size={16} /><span>JSON</span></button><button onClick={() => onDownload('csv')} title="Download CSV" aria-label="Download CSV report"><FileSpreadsheet size={16} /><span>CSV</span></button><button onClick={() => onDownload('html')} title="Download HTML" aria-label="Download HTML report"><FileText size={16} /><span>HTML</span></button></div></div>
      <div className="run-drawer-section"><h3>Quality checks <Badge tone="slate">{quality?.checks?.length || 0}</Badge></h3>{quality?.checks?.length ? <div className="run-check-list">{quality.checks.map((check: any, index: number) => <div className="run-check-row" key={`${check.rule_name}-${index}`}><span className={`result-check-icon ${check.passed ? 'passed' : 'failed'}`}>{check.passed ? '✓' : <AlertTriangle size={14} />}</span><div className="min-w-0 flex-1"><strong>{check.rule_name}</strong><small>{check.message} · {check.failed_rows}/{check.total_rows} failed rows</small></div><StatusBadge status={check.passed ? 'passed' : 'failed'} /></div>)}</div> : <p className="drawer-muted">No validation results were persisted.</p>}</div>
      <div className="run-drawer-section"><h3>Drift analysis <StatusBadge status={drift?.status || 'not_run'} /></h3>{drift?.features?.length ? <div className="run-check-list">{drift.features.slice(0, 8).map((feature: any) => <div className="run-check-row" key={feature.feature_name}><span className={`feature-dot ${feature.drifted ? 'feature-dot-drift' : feature.status === 'no_drift' ? 'feature-dot-ok' : ''}`} /><div className="min-w-0 flex-1"><strong>{feature.feature_name}</strong><small>{feature.feature_type} · {feature.details.score_name || feature.status}</small></div><span>{feature.score == null ? '—' : feature.score.toFixed(4)}</span><StatusBadge status={feature.status} /></div>)}</div> : <p className="drawer-muted">No feature comparison results.</p>}</div>
      <div className="run-drawer-section"><h3>Schema changes <Badge tone="slate">{detail.schema_changes?.length || 0}</Badge></h3>{detail.schema_changes?.length ? <div className="run-check-list">{detail.schema_changes.map((change: any) => <div className="run-check-row" key={change.id}><span className="schema-kind-icon"><Activity size={14} /></span><div className="min-w-0 flex-1"><strong>{change.kind.replaceAll('_', ' ')} · {change.column_name}</strong><small>{change.old_value || '—'} → {change.new_value || '—'}</small></div><StatusBadge status={change.severity} /></div>)}</div> : <p className="drawer-muted">No schema changes detected.</p>}</div>
      <div className="run-drawer-section"><h3>Alerts <Badge tone="slate">{detail.alerts?.length || 0}</Badge></h3>{detail.alerts?.length ? detail.alerts.map((alert: any) => <div className="run-alert-row" key={alert.id}><StatusBadge status={alert.severity} /><div><strong>{alert.title}</strong><small>{alert.trigger_reason}</small></div><StatusBadge status={alert.status} /></div>) : <p className="drawer-muted">No alerts generated by this run.</p>}</div>
      <div className="drawer-footer"><span>Completed {formatDate(run.completed_at)}</span><span>Run ID {shortId(run.id)}</span></div>
    </>}
  </section></div>;
}
