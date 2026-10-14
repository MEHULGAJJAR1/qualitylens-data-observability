import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, Database, Gauge, Play, ShieldCheck, Zap } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, formatDate, formatNumber, formatScore, LoadingRows, MetricCard, PageHeader, scoreTone, StatusBadge } from '../components/ui';

export default function Overview() {
  const navigate = useNavigate();
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const drift = useQuery({ queryKey: ['drift', 'all'], queryFn: () => api.drift() });
  if (overview.isPending) return <div><PageHeader title="Overview" description="A live view of data health across your workspace." /><div className="metric-grid">{Array.from({ length: 4 }, (_, i) => <div className="metric-card" key={i}><div className="skeleton h-4 w-24" /><div className="skeleton mt-5 h-8 w-28" /><div className="skeleton mt-4 h-3 w-36" /></div>)}</div><div className="dashboard-grid mt-6"><Card title="Quality score trend"><LoadingRows rows={4} columns={3} /></Card><Card title="Dataset health"><LoadingRows rows={4} columns={4} /></Card></div></div>;
  if (overview.isError) return <><PageHeader title="Overview" description="A live view of data health across your workspace." /><ErrorState error={overview.error} retry={() => overview.refetch()} /></>;
  const data = overview.data;
  const kpis = data.kpis;
  const driftRates = drift.data?.items || [];
  const featureStatuses = driftRates.flatMap((item) => item.features).reduce<Record<string, number>>((acc, feature) => {
    acc[feature.status] = (acc[feature.status] || 0) + 1; return acc;
  }, {});
  const drifted = featureStatuses.detected_drift ?? kpis.drifted_features;
  const valid = (featureStatuses.no_drift ?? 0) + drifted;
  const noDriftPercent = valid ? Math.round(((featureStatuses.no_drift ?? 0) / valid) * 100) : 100;

  return <div className="space-y-6">
    <PageHeader eyebrow="WORKSPACE HEALTH" title="Overview" description="A live view of data health across your workspace."
      actions={<><Button variant="secondary" onClick={() => navigate('/datasets')}><Database size={15} /> Datasets</Button><Button onClick={() => navigate('/runs')}><Play size={15} fill="currentColor" /> Monitoring runs</Button></>} />

    <div className="metric-grid">
      <MetricCard label="Registered datasets" value={formatNumber(kpis.datasets)} meta={`${kpis.monitored_datasets} monitored`} icon={<Database size={19} />} accent="blue" />
      <MetricCard label="Average quality score" value={formatScore(kpis.average_quality_score)} meta={kpis.average_quality_score == null ? 'Run monitoring to establish a baseline' : 'Across latest completed runs'} icon={<Gauge size={19} />} accent="green" />
      <MetricCard label="Drifted features" value={formatNumber(kpis.drifted_features)} meta={`${kpis.datasets_with_drift} dataset${kpis.datasets_with_drift === 1 ? '' : 's'} with drift`} icon={<Activity size={19} />} accent="violet" />
      <MetricCard label="Open alerts" value={formatNumber(kpis.open_alerts)} meta={`${kpis.active_schedules} active schedules`} icon={<AlertTriangle size={19} />} accent="amber" />
    </div>

    <div className="dashboard-grid dashboard-grid-primary">
      <Card className="chart-card" title="Quality score trend" subtitle="Actual quality scores from persisted monitoring runs"
        action={<button className="text-link" onClick={() => navigate('/quality')}>View quality <ArrowRight size={14} /></button>}>
        {data.quality_trend.length ? <div className="chart-area trend-chart">
          <ResponsiveContainer width="100%" height="100%"><LineChart data={data.quality_trend} onClick={(event: any) => {
            const point = event?.activePayload?.[0]?.payload;
            if (point?.run_id) navigate(`/runs?run=${point.run_id}`);
          }} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tick={{ fill: 'var(--chart-text)', fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={10} />
            <YAxis domain={[0, 100]} tick={{ fill: 'var(--chart-text)', fontSize: 11 }} axisLine={false} tickLine={false} ticks={[0, 25, 50, 75, 100]} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)' }} labelStyle={{ color: 'var(--ink)', fontWeight: 600 }} formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Quality score']} />
            <Line type="monotone" dataKey="quality_score" stroke="#5779f5" strokeWidth={2.7} dot={{ fill: '#fff', stroke: '#5779f5', strokeWidth: 2, r: 4 }} activeDot={{ r: 6, fill: '#5779f5', cursor: 'pointer' }} />
          </LineChart></ResponsiveContainer>
        </div> : <EmptyState title="No quality history yet" detail="Upload a reference and current CSV, then run monitoring to populate this trend." icon={<Activity size={21} />} />}
        <div className="chart-footer"><span className="legend-dot brand-dot" />Quality score<span className="chart-footnote">Click a point to open its monitoring run</span></div>
      </Card>

      <Card className="health-card" title="Dataset health" subtitle="Latest completed monitoring result per dataset" action={<button className="text-link" onClick={() => navigate('/datasets')}>All datasets <ArrowRight size={14} /></button>}>
        {data.dataset_health.length ? <DataTable>
          <thead><tr><th>DATASET</th><th>QUALITY</th><th>DRIFT</th><th>STATUS</th></tr></thead>
          <tbody>{data.dataset_health.map((dataset) => <tr key={dataset.id} className="click-row" onClick={() => navigate(`/datasets?dataset=${dataset.id}`)}>
            <td><div className="dataset-cell"><span className="table-dataset-icon"><Database size={15} /></span><div><strong>{dataset.name}</strong><small>{formatNumber(dataset.rows)} rows · {formatNumber(dataset.columns)} cols</small></div></div></td>
            <td><span className={`score-cell ${scoreTone(dataset.quality_score)}`}>{formatScore(dataset.quality_score)}</span></td>
            <td>{dataset.drift_status ? <StatusBadge status={dataset.drift_status} /> : <span className="text-muted">—</span>}</td>
            <td><StatusBadge status={dataset.health_status} /></td>
          </tr>)}</tbody>
        </DataTable> : <EmptyState title="No datasets registered" detail="Add a dataset to start profiling and monitoring." icon={<Database size={21} />} />}
        {data.dataset_health.length > 0 && <div className="health-summary"><div className="health-summary-icon"><ShieldCheck size={16} /></div><span>{kpis.monitored_datasets} monitored dataset{kpis.monitored_datasets === 1 ? '' : 's'}</span><span className="summary-right">{formatScore(kpis.average_quality_score)} avg</span></div>}
      </Card>
    </div>

    <div className="dashboard-grid dashboard-grid-secondary">
      <Card title="Latest drift analysis" subtitle="Distribution checks against reference data" action={<button className="text-link" onClick={() => navigate('/drift')}>Explore drift <ArrowRight size={14} /></button>}>
        <div className="drift-summary">
          <div className="drift-ring" style={{ background: `conic-gradient(#24a87a ${noDriftPercent}%, #f2a93b ${noDriftPercent}% 100%)` }}><div><strong>{formatNumber(drift.data?.items.reduce((sum, item) => sum + item.features_checked, 0) || 0)}</strong><small>features checked</small></div></div>
          <div className="drift-legend"><div><span className="legend-dot green-dot" /><span>No drift detected</span><strong>{formatNumber(featureStatuses.no_drift || 0)}</strong></div><div><span className="legend-dot amber-dot" /><span>Drift detected</span><strong>{formatNumber(drifted)}</strong></div><div><span className="legend-dot slate-dot" /><span>Insufficient / failed</span><strong>{formatNumber((featureStatuses.insufficient_data || 0) + (featureStatuses.failed_comparison || 0))}</strong></div></div>
        </div>
        <div className="drift-note"><Zap size={14} />{drift.data?.items.length ? `Evaluated with ${drift.data.items.find((item) => item.engine)?.engine || 'statistical'} comparisons and persisted feature results.` : 'No comparisons have been run yet.'}</div>
      </Card>
      <Card title="Recent monitoring runs" subtitle="Most recent executions across datasets" action={<button className="text-link" onClick={() => navigate('/runs')}>Run history <ArrowRight size={14} /></button>}>
        {data.recent_runs.length ? <div className="run-list">{data.recent_runs.slice(0, 5).map((run) => <button className="run-list-item" key={run.id} onClick={() => navigate(`/runs?run=${run.id}`)}>
          <span className={`run-list-icon ${run.status}`}><Activity size={15} /></span><span className="run-list-copy"><strong>{run.dataset_name || 'Dataset'}</strong><small>{formatDate(run.completed_at || run.started_at)} · {run.trigger_type}</small></span><span className="run-list-score">{formatScore(run.summary.quality_score)}</span><StatusBadge status={run.status} />
        </button>)}</div> : <EmptyState title="No monitoring runs" detail="Start a run after uploading both reference and current data." icon={<Activity size={20} />} />}
      </Card>
    </div>

    <div className="dashboard-grid dashboard-grid-secondary">
      <Card title="Validation failures" subtitle="Rules that failed in persisted monitoring runs" action={<button className="text-link" onClick={() => navigate('/quality')}>Review checks <ArrowRight size={14} /></button>}>
        {data.validation_failures.length ? <div className="failure-list">{data.validation_failures.map((failure) => <button className="failure-item" key={failure.id} onClick={() => navigate(`/runs?run=${failure.run_id}`)}>
          <span className="failure-mark"><AlertTriangle size={15} /></span><span className="min-w-0 flex-1"><strong>{failure.rule_name}</strong><small>{failure.dataset_name} · {failure.message}</small></span><Badge tone={failure.severity}>{failure.severity}</Badge>
        </button>)}</div> : <EmptyState title="No validation failures" detail="Every configured rule passed in the latest results." icon={<ShieldCheck size={20} />} />}
      </Card>
      <Card title="Open alerts" subtitle="Requires acknowledgement or resolution" action={<button className="text-link" onClick={() => navigate('/alerts')}>Manage alerts <ArrowRight size={14} /></button>}>
        {data.open_alerts_preview.length ? <div className="alert-preview-list">{data.open_alerts_preview.map((alert) => <button key={alert.id} className="alert-preview-row" onClick={() => navigate('/alerts')}>
          <span className={`alert-source-icon alert-${alert.source}`}><AlertTriangle size={15} /></span><span className="min-w-0 flex-1"><strong>{alert.title}</strong><small>{alert.dataset_name} · {formatDate(alert.created_at)}</small></span><StatusBadge status={alert.severity} />
        </button>)}</div> : <EmptyState title="No open alerts" detail="New quality, drift and schema issues will appear here." icon={<ShieldCheck size={20} />} />}
      </Card>
    </div>
  </div>;
}
