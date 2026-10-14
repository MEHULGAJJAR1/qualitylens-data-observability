import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRightLeft, BarChart3, CircleHelp, Database, Info, ShieldAlert, Sparkles } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { Card, DataTable, EmptyState, ErrorState, formatDate, formatNumber, LoadingRows, PageHeader, SelectField, StatusBadge } from '../components/ui';
import type { DriftFeature, DriftItem } from '../types';

export default function Drift() {
  const [params, setParams] = useSearchParams();
  const [datasetId, setDatasetId] = useState(params.get('dataset') || '');
  const [selectedFeature, setSelectedFeature] = useState('');
  const datasets = useQuery({ queryKey: ['datasets', 'drift'], queryFn: () => api.datasets('', 1, 100) });
  const drift = useQuery({ queryKey: ['drift', datasetId], queryFn: () => api.drift(datasetId), enabled: Boolean(datasetId) });
  useEffect(() => { if (!datasetId && datasets.data?.items.length) setDatasetId(datasets.data.items[0].id); }, [datasetId, datasets.data]);
  useEffect(() => { if (datasetId) setParams({ dataset: datasetId }, { replace: true }); }, [datasetId, setParams]);
  const item: DriftItem | undefined = drift.data?.items.find((entry) => entry.dataset_id === datasetId);
  const features = item?.features || [];
  const selected: DriftFeature | undefined = features.find((feature) => feature.feature_name === selectedFeature) || features.find((feature) => feature.details.chart?.length);
  const chartData = useMemo(() => selected?.details.chart || [], [selected]);
  const counts = features.reduce((acc, feature) => { acc[feature.status] = (acc[feature.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  const referenceRows = item?.run?.summary.row_count ? 'Current file row count shown in run summary' : '';

  return <div className="space-y-6">
    <PageHeader eyebrow="DISTRIBUTION MONITORING" title="Drift monitoring" description="Compare current data against its reference and inspect feature-level distribution changes."
      actions={<SelectField aria-label="Select dataset" value={datasetId} onChange={(event) => setDatasetId(event.target.value)} className="header-select"><option value="">Select dataset</option>{(datasets.data?.items || []).map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</SelectField>} />
    {datasets.isError && <ErrorState error={datasets.error} retry={() => datasets.refetch()} />}
    {!datasets.isPending && datasets.data?.items.length === 0 && <Card><EmptyState title="No datasets to compare" detail="Register a dataset and upload reference and current CSV files." icon={<Database size={22} />} /></Card>}
    {datasetId && drift.isError && <ErrorState error={drift.error} retry={() => drift.refetch()} />}
    {datasetId && drift.isPending && <div className="dashboard-grid"><Card title="Drift summary"><LoadingRows rows={3} columns={3} /></Card><Card title="Feature analysis"><LoadingRows rows={5} columns={4} /></Card></div>}
    {datasetId && item && <>
      <div className="drift-status-banner">
        <div className={`drift-status-symbol drift-${item.status}`}><Activity size={20} /></div>
        <div className="drift-status-copy"><div><StatusBadge status={item.status} label={humanStatus(item.status)} /> <span className="drift-dataset-label">{item.dataset_name}</span></div><p>{statusDescription(item.status, item.features_drifted)}</p></div>
        <div className="drift-run-meta"><span>Latest comparison</span><strong>{formatDate(item.run?.completed_at || item.run?.started_at)}</strong><small>{item.engine || 'No engine recorded'} · run {item.run?.id.slice(0, 8).toUpperCase() || '—'}</small></div>
      </div>
      <div className="drift-kpi-grid">
        <div className="drift-kpi"><span className="drift-kpi-icon blue-stat"><BarChart3 size={18} /></span><small>Features checked</small><strong>{formatNumber(item.features_checked)}</strong><span>Common comparable fields</span></div>
        <div className="drift-kpi"><span className="drift-kpi-icon amber-stat"><ShieldAlert size={18} /></span><small>Features drifted</small><strong>{formatNumber(item.features_drifted)}</strong><span>Distribution or missingness</span></div>
        <div className="drift-kpi"><span className="drift-kpi-icon green-stat"><Sparkles size={18} /></span><small>No drift detected</small><strong>{formatNumber(counts.no_drift || 0)}</strong><span>Within configured thresholds</span></div>
        <div className="drift-kpi"><span className="drift-kpi-icon slate-stat"><CircleHelp size={18} /></span><small>Insufficient / failed</small><strong>{formatNumber((counts.insufficient_data || 0) + (counts.failed_comparison || 0))}</strong><span>Not treated as “no drift”</span></div>
      </div>
      <div className="drift-grid">
        <Card title="Feature comparison" subtitle="Select a feature to compare normalized reference/current distributions" className="distribution-card">
          {selected && chartData.length ? <>
            <div className="distribution-heading"><div><strong>{selected.feature_name}</strong><span>{selected.feature_type} · {selected.details.score_name?.replaceAll('_', ' ') || 'distribution'}</span></div><StatusBadge status={selected.status} /></div>
            <div className="distribution-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 10, right: 12, left: -18, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="bin" tick={{ fill: 'var(--chart-text)', fontSize: 10 }} axisLine={false} tickLine={false} tickMargin={8} interval={0} />
              <YAxis tick={{ fill: 'var(--chart-text)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`]} />
              <Legend />
              <Bar name="Reference" dataKey="reference" fill="#a8b4d6" radius={[4, 4, 0, 0]} />
              <Bar name="Current" dataKey="current" fill="#5a7cf6" radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer></div>
            <div className="distribution-stats"><div><small>{selected.details.score_name?.replaceAll('_', ' ') || 'Distribution score'}</small><strong>{selected.score?.toFixed(4) ?? '—'}</strong></div><div><small>Threshold</small><strong>{selected.threshold?.toFixed(3) ?? '—'}</strong></div><div><small>Missing rate</small><strong>{(selected.missing_reference * 100).toFixed(1)}% <ArrowRightLeft size={12} /> {(selected.missing_current * 100).toFixed(1)}%</strong></div></div>
          </> : <EmptyState title="No distribution chart available" detail="Choose a comparable feature with sufficient non-null values to see its reference/current chart." icon={<BarChart3 size={21} />} />}
        </Card>
        <Card title="Drift method & thresholds" subtitle="Values used for this persisted comparison">
          <div className="threshold-list"><Threshold label="Numerical PSI" value={item.thresholds.numeric} detail="Population Stability Index" /><Threshold label="Categorical distance" value={item.thresholds.categorical} detail="Total variation distance" percent /><Threshold label="Missing-rate change" value={item.thresholds.missing} detail="Absolute null-rate delta" percent /></div>
          <div className="method-note"><Info size={15} /><span>Numerical features use reference-quantile bins and PSI. Categorical features use total-variation distance; missingness is checked independently. Evidently is used when its compatible adapter is installed; deterministic built-in statistics remain the persisted feature-level source of truth.</span></div>
          <div className="adapter-status"><span className={`adapter-dot ${item.adapter?.adapter?.available ? 'adapter-active' : ''}`} /><div><strong>{item.adapter?.adapter?.adapter || item.engine || 'Built-in adapter'}</strong><small>{item.adapter?.adapter?.available ? 'Optional library detected' : 'Built-in statistical adapter'}</small></div><span className="adapter-status-text">{item.adapter?.adapter?.adapter_error ? 'Fallback used' : 'Ready'}</span></div>
          {referenceRows && <div className="source-note"><Database size={13} />{referenceRows}</div>}
        </Card>
      </div>
      <Card title="Feature-level drift results" subtitle={`Reference-to-current checks · ${features.length} features returned by the latest run`}>
        {features.length ? <DataTable>
          <thead><tr><th>FEATURE</th><th>TYPE</th><th>RESULT</th><th>DRIFT SCORE</th><th>MISSING · REF / CUR</th><th>THRESHOLD</th></tr></thead>
          <tbody>{features.map((feature) => <tr key={feature.id || feature.feature_name} className={`click-row ${selected?.feature_name === feature.feature_name ? 'selected-feature-row' : ''}`} onClick={() => setSelectedFeature(feature.feature_name)}>
            <td><div className="feature-name"><span className={`feature-dot ${feature.drifted ? 'feature-dot-drift' : feature.status === 'no_drift' ? 'feature-dot-ok' : ''}`} /><strong>{feature.feature_name}</strong></div></td>
            <td><span className="type-label">{feature.feature_type}</span></td><td><StatusBadge status={feature.status} label={humanStatus(feature.status)} /></td>
            <td>{feature.score == null ? <span className="text-muted">—</span> : <><strong className={feature.drifted ? 'text-amber' : 'text-green'}>{feature.score.toFixed(4)}</strong><small className="table-secondary block">{feature.details.score_name?.replaceAll('_', ' ')}</small></>}</td>
            <td>{(feature.missing_reference * 100).toFixed(1)}% <ArrowRightLeft size={12} className="inline-icon" /> {(feature.missing_current * 100).toFixed(1)}%</td><td>{feature.threshold == null ? '—' : feature.threshold.toFixed(3)}</td>
          </tr>)}</tbody>
        </DataTable> : <EmptyState title="No feature comparisons" detail="A completed comparison requires at least one common reference/current column." icon={<ArrowRightLeft size={21} />} />}
        <div className="status-legend"><span><i className="legend-dot amber-dot" />Detected drift</span><span><i className="legend-dot green-dot" />No drift</span><span><i className="legend-dot slate-dot" />Insufficient data</span><span><i className="legend-dot red-dot" />Failed comparison</span></div>
      </Card>
    </>}
  </div>;
}

function Threshold({ label, value, detail, percent = false }: { label: string; value?: number; detail: string; percent?: boolean }) {
  return <div className="threshold-row"><div><strong>{label}</strong><small>{detail}</small></div><code>{value == null ? '—' : percent ? `${(value * 100).toFixed(0)}%` : value.toFixed(2)}</code></div>;
}
function humanStatus(status: string) { return status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function statusDescription(status: string, drifted: number) {
  if (status === 'detected_drift') return `${drifted} feature${drifted === 1 ? '' : 's'} exceeded a distribution or missingness threshold. Review the feature results below.`;
  if (status === 'no_drift') return 'All comparable features were below configured thresholds. This is distinct from insufficient or failed comparisons.';
  if (status === 'insufficient_data') return 'No feature had enough non-null observations for a valid comparison. Add more reference/current rows and rerun.';
  if (status === 'failed_comparison') return 'At least one feature could not be compared because reference/current types are incompatible. Inspect per-feature statuses.';
  return 'No completed comparison has been persisted for this dataset yet.';
}
