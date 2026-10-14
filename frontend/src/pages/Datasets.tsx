import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, Database, Eye, FileUp, Filter, Play, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, formatDate, formatNumber, formatScore, LoadingRows, PageHeader, ProgressBar, SelectField, StatusBadge, TextAreaField, TextField, scoreTone } from '../components/ui';
import type { ColumnProfile, Dataset } from '../types';

export default function Datasets() {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get('q') || '';
  const initialDataset = params.get('dataset') || '';
  const [searchInput, setSearchInput] = useState(initialQ);
  const [query, setQuery] = useState(initialQ);
  const [datasetPage, setDatasetPage] = useState(() => Number(params.get('page') || 1));
  const [selectedId, setSelectedId] = useState(initialDataset);
  const [showUploader, setShowUploader] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'preview'>('profile');
  const [previewRole, setPreviewRole] = useState('current');
  const [previewSearch, setPreviewSearch] = useState('');
  const [previewPage, setPreviewPage] = useState(1);
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const datasets = useQuery({ queryKey: ['datasets', query, datasetPage], queryFn: () => api.datasets(query, datasetPage) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const selected = useQuery({ queryKey: ['dataset', selectedId], queryFn: () => api.dataset(selectedId), enabled: Boolean(selectedId) });
  const profiles = useQuery({ queryKey: ['profiles', selectedId], queryFn: () => api.profiles(selectedId), enabled: Boolean(selectedId) });
  const preview = useQuery({ queryKey: ['preview', selectedId, previewRole, previewSearch, previewPage], queryFn: () => api.preview(selectedId, previewRole, previewSearch, previewPage), enabled: Boolean(selectedId) && activeTab === 'preview' });

  useEffect(() => {
    const id = params.get('dataset') || '';
    setSelectedId(id);
    const q = params.get('q') || '';
    setSearchInput(q);
    setQuery(q);
    setDatasetPage(Number(params.get('page') || 1));
  }, [params]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['datasets'] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
    if (selectedId) {
      queryClient.invalidateQueries({ queryKey: ['dataset', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['profiles', selectedId] });
    }
  };
  const upload = useMutation({
    mutationFn: (form: FormData) => api.uploadDataset(form),
    onSuccess: (result) => {
      refresh();
      setShowUploader(false);
      setSelectedId(result.id);
      setDatasetPage(1);
      setParams({ dataset: result.id });
      notify(`${result.uploaded_role === 'reference' ? 'Reference' : 'Current'} CSV registered`, 'success', `${formatNumber(result.uploaded_rows)} rows · ${formatNumber(result.uploaded_columns)} columns`);
    },
    onError: (error) => notify('CSV upload failed', 'error', error instanceof Error ? error.message : 'Request failed'),
  });
  const run = useMutation({
    mutationFn: api.triggerRun,
    onSuccess: (result) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      queryClient.invalidateQueries({ queryKey: ['drift'] });
      queryClient.invalidateQueries({ queryKey: ['schema'] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      notify(result.status === 'completed' ? 'Monitoring run completed' : 'Monitoring run failed', result.status === 'completed' ? 'success' : 'error', result.error || `${formatScore(result.summary.quality_score)} quality score · ${result.summary.drift_status || 'no drift result'}`);
    },
    onError: (error) => notify('Could not start monitoring', 'error', error instanceof Error ? error.message : 'Request failed'),
  });
  const remove = useMutation({
    mutationFn: api.deleteDataset,
    onSuccess: () => {
      notify('Dataset deleted', 'success', 'Managed files and related history were removed.');
      setSelectedId('');
      setParams({});
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (error) => notify('Could not delete dataset', 'error', error instanceof Error ? error.message : 'Request failed'),
  });

  const selectDataset = (dataset: Dataset) => {
    setSelectedId(dataset.id);
    setDatasetPage(1);
    setParams({ ...(query ? { q: query } : {}), ...(datasetPage > 1 ? { page: String(datasetPage) } : {}), dataset: dataset.id });
    setActiveTab('profile');
    setPreviewSearch('');
    setPreviewPage(1);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = searchInput.trim();
    setQuery(term);
    setDatasetPage(1);
    setParams(term ? { q: term } : {});
  };

  return <div className="space-y-6">
    <PageHeader eyebrow="DATA CATALOG" title="Datasets" description="Register CSV sources, inspect column profiles and manage reference/current comparisons."
      actions={<Button onClick={() => setShowUploader((value) => !value)}><Plus size={16} /> Add dataset</Button>} />

    {showUploader && <UploadCard datasets={datasets.data?.items || []} maxMb={settings.data?.upload_limit_mb || 25} busy={upload.isPending} onCancel={() => setShowUploader(false)} onSubmit={(form) => upload.mutate(form)} />}

    <Card className="catalog-card">
      <div className="catalog-toolbar">
        <form className="catalog-search" onSubmit={submitSearch}><Search size={16} /><input aria-label="Filter datasets" placeholder="Search by name or description…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit">Search</button></form>
        <div className="catalog-toolbar-right"><span className="catalog-count"><Database size={15} /> {datasets.data?.total ?? 0} datasets</span><Button variant="secondary" size="sm" onClick={() => datasets.refetch()}><Activity size={14} /> Refresh</Button></div>
      </div>
      {datasets.isPending ? <LoadingRows rows={6} columns={5} /> : datasets.isError ? <ErrorState error={datasets.error} retry={() => datasets.refetch()} /> : datasets.data.items.length ? <DataTable>
        <thead><tr><th>DATASET</th><th>ROWS / COLUMNS</th><th>REFERENCE / CURRENT</th><th>QUALITY</th><th>LAST DRIFT RESULT</th><th>HEALTH</th><th className="text-right">ACTIONS</th></tr></thead>
        <tbody>{datasets.data.items.map((dataset) => <tr key={dataset.id} className="click-row" onClick={() => selectDataset(dataset)}>
          <td><div className="dataset-cell"><span className="table-dataset-icon"><Database size={15} /></span><div><strong>{dataset.name}</strong><small>{dataset.description || shortText(dataset.current_filename || dataset.reference_filename || 'CSV source', 44)}</small></div></div></td>
          <td><strong className="table-primary">{formatNumber(dataset.row_count)}</strong><span className="table-secondary"> rows · {formatNumber(dataset.column_count)} columns</span></td>
          <td><div className="file-pair"><span title={dataset.reference_filename || 'No reference'}><Badge tone="reference">REF</Badge>{shortText(dataset.reference_filename || 'Missing', 16)}</span><span title={dataset.current_filename || 'No current'}><Badge tone="current">CUR</Badge>{shortText(dataset.current_filename || 'Missing', 16)}</span></div></td>
          <td><span className={`score-cell ${scoreTone(dataset.quality_score)}`}>{formatScore(dataset.quality_score)}</span></td>
          <td>{dataset.drift_status ? <StatusBadge status={dataset.drift_status} /> : <span className="text-muted">Not run</span>}</td>
          <td><StatusBadge status={dataset.health_status} /></td>
          <td className="text-right"><div className="table-actions" onClick={(event) => event.stopPropagation()}><button className="icon-button table-action" aria-label={`Inspect ${dataset.name}`} title="Inspect dataset" onClick={() => selectDataset(dataset)}><Eye size={16} /></button><button className="icon-button table-action run-action" aria-label={`Run monitoring for ${dataset.name}`} title="Run monitoring" disabled={run.isPending || !dataset.has_reference || !dataset.has_current} onClick={() => run.mutate(dataset.id)}><Play size={15} /></button></div></td>
        </tr>)}</tbody>
      </DataTable> : <EmptyState title={query ? 'No matching datasets' : 'Your catalog is empty'} detail={query ? 'Try another search term or clear the filter.' : 'Upload a reference CSV to register your first dataset and begin profiling.'} icon={<Database size={22} />} />}
      {datasets.data && datasets.data.total > datasets.data.limit && <div className="table-pagination"><span>Showing {datasets.data.items.length} of {datasets.data.total}</span><div><Button variant="secondary" size="sm" disabled={datasets.data.page <= 1} onClick={() => { const next = datasets.data!.page - 1; setDatasetPage(next); setParams({ ...(query ? { q: query } : {}), page: String(next) }); }}>Previous</Button><Button variant="secondary" size="sm" disabled={datasets.data.page * datasets.data.limit >= datasets.data.total} onClick={() => { const next = datasets.data!.page + 1; setDatasetPage(next); setParams({ ...(query ? { q: query } : {}), page: String(next) }); }}>Next</Button></div></div>}
    </Card>

    {selectedId && <DatasetDrawer dataset={selected.data} datasetLoading={selected.isPending} datasetError={selected.error} profiles={profiles.data?.items || []} profilesLoading={profiles.isPending} preview={preview.data} previewLoading={preview.isPending} previewError={preview.error} activeTab={activeTab} setActiveTab={setActiveTab} role={previewRole} setRole={(role) => { setPreviewRole(role); setPreviewPage(1); }} search={previewSearch} setSearch={(value) => { setPreviewSearch(value); setPreviewPage(1); }} page={previewPage} setPage={setPreviewPage} onClose={() => { setSelectedId(''); setParams(query ? { q: query } : {}); }} onRun={() => run.mutate(selectedId)} runBusy={run.isPending} onDelete={() => { if (window.confirm('Delete this dataset, its managed CSVs, rules and monitoring history? This cannot be undone.')) remove.mutate(selectedId); }} deleteBusy={remove.isPending} />}
  </div>;
}

function UploadCard({ datasets, maxMb, busy, onCancel, onSubmit }: { datasets: Dataset[]; maxMb: number; busy: boolean; onCancel: () => void; onSubmit: (form: FormData) => void }) {
  const [datasetId, setDatasetId] = useState('');
  const [role, setRole] = useState('reference');
  const { notify } = useToast();
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get('file') as File | null;
    if (!file || !file.name) { notify('Choose a CSV file', 'error'); return; }
    if (file.size > maxMb * 1024 * 1024) { notify('File is too large', 'error', `Maximum upload size is ${maxMb} MB.`); return; }
    data.set('role', role);
    if (datasetId) { data.set('dataset_id', datasetId); data.delete('dataset_name'); }
    onSubmit(data);
  };
  return <Card className="upload-card">
    <div className="upload-card-heading"><span className="upload-illustration"><UploadCloud size={20} /></span><div><h2>Register a CSV dataset</h2><p>Files are validated and stored under a server-generated name. Maximum {maxMb} MB.</p></div><button className="icon-button ml-auto" aria-label="Close upload form" onClick={onCancel}><X size={18} /></button></div>
    <form onSubmit={handleSubmit} className="upload-grid">
      <SelectField label="Dataset" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}><option value="">Create a new dataset</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</SelectField>
      {!datasetId && <TextField label="Dataset name" name="dataset_name" placeholder="e.g. Customer events" required minLength={2} maxLength={180} />}
      <SelectField label="File role" value={role} onChange={(event) => setRole(event.target.value)}><option value="reference">Reference · baseline</option><option value="current">Current · comparison data</option></SelectField>
      <label className="field upload-file-field"><span className="field-label">CSV file</span><input className="file-input" type="file" name="file" accept=".csv,text/csv" required /><span className="field-hint">UTF-8 CSV, header row required</span></label>
      {!datasetId && <TextAreaField label="Description (optional)" name="description" placeholder="What does this dataset represent?" rows={1} className="upload-description" />}
      <div className="upload-actions"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <><span className="spinner" /> Uploading…</> : <><FileUp size={15} /> Upload and register</>}</Button></div>
    </form>
  </Card>;
}

function DatasetDrawer({ dataset, datasetLoading, datasetError, profiles, profilesLoading, preview, previewLoading, previewError, activeTab, setActiveTab, role, setRole, search, setSearch, page, setPage, onClose, onRun, runBusy, onDelete, deleteBusy }: {
  dataset?: Dataset; datasetLoading: boolean; datasetError: unknown; profiles: ColumnProfile[]; profilesLoading: boolean; preview?: any; previewLoading: boolean; previewError: unknown;
  activeTab: 'profile' | 'preview'; setActiveTab: (tab: 'profile' | 'preview') => void; role: string; setRole: (role: string) => void;
  search: string; setSearch: (value: string) => void; page: number; setPage: (page: number) => void;
  onClose: () => void; onRun: () => void; runBusy: boolean; onDelete: () => void; deleteBusy: boolean;
}) {
  const currentProfiles = useMemo(() => profiles.filter((item) => item.profile_type === 'current'), [profiles]);
  const referenceProfiles = useMemo(() => profiles.filter((item) => item.profile_type === 'reference'), [profiles]);
  const displayedRole = role === 'current' && !dataset?.has_current ? 'reference' : role;
  const shownProfiles = displayedRole === 'reference' ? referenceProfiles : currentProfiles;
  const hasBoth = Boolean(dataset?.has_reference && dataset?.has_current);
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dataset-drawer" role="dialog" aria-modal="true" aria-label="Dataset details">
      <div className="drawer-topline"><span className="drawer-section-icon"><Database size={16} /></span><span>DATASET DETAILS</span><button className="icon-button ml-auto" onClick={onClose} aria-label="Close dataset details"><X size={19} /></button></div>
      {datasetLoading ? <div className="p-6"><div className="skeleton h-7 w-56" /><div className="skeleton mt-3 h-4 w-80" /></div> : datasetError ? <div className="p-5"><ErrorState error={datasetError} /></div> : dataset && <>
        <div className="drawer-title-row"><div><h2>{dataset.name}</h2><p>{dataset.description || 'No description added.'}</p></div><StatusBadge status={dataset.health_status} /></div>
        <div className="drawer-stats"><div><small>Rows</small><strong>{formatNumber(dataset.row_count)}</strong></div><div><small>Columns</small><strong>{formatNumber(dataset.column_count)}</strong></div><div><small>Quality</small><strong className={scoreTone(dataset.quality_score)}>{formatScore(dataset.quality_score)}</strong></div><div><small>Drift</small><strong>{dataset.drift_status?.replaceAll('_', ' ') || '—'}</strong></div></div>
        <div className="drawer-file-pair"><div><Badge tone="reference">REFERENCE</Badge><span>{dataset.reference_filename || 'Not uploaded'}</span></div><div><Badge tone="current">CURRENT</Badge><span>{dataset.current_filename || 'Not uploaded'}</span></div></div>
        <div className="drawer-actions"><Button onClick={onRun} disabled={runBusy || !hasBoth}>{runBusy ? <><span className="spinner" /> Running…</> : <><Play size={14} fill="currentColor" /> Run monitoring</>}</Button><Button variant="secondary" onClick={() => { setActiveTab('preview'); setRole(dataset.has_current ? 'current' : 'reference'); }}><Eye size={14} /> Preview rows</Button></div>
        {!hasBoth && <div className="drawer-hint"><ArrowDown size={14} /> Upload both a reference and current CSV before running comparisons.</div>}
        <div className="drawer-tabs"><button className={activeTab === 'profile' ? 'drawer-tab active' : 'drawer-tab'} onClick={() => setActiveTab('profile')}>Column profile</button><button className={activeTab === 'preview' ? 'drawer-tab active' : 'drawer-tab'} onClick={() => { setActiveTab('preview'); if (!dataset.has_current) setRole('reference'); }}>Row preview</button></div>
        {activeTab === 'profile' ? <div className="drawer-body">
          <div className="profile-toolbar"><div><strong>Column statistics</strong><small>Missing values, cardinality and summary stats</small></div><SelectField aria-label="Profile data version" value={displayedRole} onChange={(event) => setRole(event.target.value)}><option value="current" disabled={!dataset.has_current}>Current</option><option value="reference">Reference</option></SelectField></div>
          {profilesLoading ? <LoadingRows rows={5} columns={4} /> : shownProfiles.length ? <DataTable>
            <thead><tr><th>FIELD</th><th>TYPE</th><th>MISSING</th><th>UNIQUE</th><th>SUMMARY</th></tr></thead>
            <tbody>{shownProfiles.map((profile) => <ProfileRow profile={profile} key={profile.id} />)}</tbody>
          </DataTable> : <EmptyState title="No column profile" detail="Upload a CSV file to calculate actual column statistics." icon={<Database size={20} />} />}
          <div className="profile-legend"><span><i className="legend-dot green-dot" />Null count is zero</span><span><i className="legend-dot amber-dot" />Missing values found</span></div>
        </div> : <div className="drawer-body">
          <div className="preview-toolbar"><SelectField aria-label="Preview data version" value={role} onChange={(event) => setRole(event.target.value)}><option value="current" disabled={!dataset.has_current}>Current data</option><option value="reference">Reference data</option></SelectField><form className="preview-search" onSubmit={(event) => { event.preventDefault(); setPage(1); }}><Search size={14} /><input aria-label="Search preview rows" placeholder="Filter rows…" value={search} onChange={(event) => setSearch(event.target.value)} /></form></div>
          {previewLoading ? <LoadingRows rows={6} columns={5} /> : previewError ? <ErrorState error={previewError} /> : preview?.rows.length ? <><div className="preview-table-wrap"><table className="data-table preview-table"><thead><tr>{preview.columns.map((column: string) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.rows.map((row: any[], i: number) => <tr key={`${page}-${i}`}>{row.map((value, j) => <td key={j}>{value === null ? <span className="null-cell">NULL</span> : String(value)}</td>)}</tr>)}</tbody></table></div><div className="table-pagination"><span>{formatNumber(preview.total)} rows</span><div><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ArrowLeft size={13} /> Prev</Button><Button size="sm" variant="secondary" disabled={page * preview.limit >= preview.total} onClick={() => setPage(page + 1)}>Next <ArrowRight size={13} /></Button></div></div></> : <EmptyState title="No rows found" detail={search ? 'Try clearing the row filter.' : 'This file has no previewable rows.'} icon={<Filter size={20} />} />}
        </div>}
        <div className="drawer-footer"><span>Created {formatDate(dataset.created_at, false)}</span><button className="delete-text-button" disabled={deleteBusy} onClick={onDelete}><Trash2 size={14} /> Delete dataset</button></div>
      </>}
    </section>
  </div>;
}

function ProfileRow({ profile }: { profile: ColumnProfile }) {
  return <tr><td><strong>{profile.column_name}</strong></td><td><span className="type-label">{profile.inferred_type}</span></td><td><div className="missing-cell"><span className={profile.null_count ? 'text-amber' : 'text-green'}>{formatNumber(profile.null_count)}</span><div><ProgressBar value={profile.null_rate * 100} color={profile.null_rate > 0.05 ? 'amber' : 'green'} /><small>{(profile.null_rate * 100).toFixed(1)}%</small></div></div></td><td>{formatNumber(profile.unique_count)}</td><td><div className="profile-summary">{profile.mean !== null && profile.mean !== undefined ? <span>μ {formatNumber(profile.mean)}</span> : null}<span>min {shortText(profile.minimum || '—', 12)}</span><span>max {shortText(profile.maximum || '—', 12)}</span></div></td></tr>;
}

function shortText(value: string, max: number) { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
