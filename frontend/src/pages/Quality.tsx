import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleHelp, ClipboardCheck, Code2, Edit2, Play, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, formatDate, formatNumber, formatScore, LoadingRows, PageHeader, SelectField, StatusBadge, TextField, scoreTone } from '../components/ui';
import type { QualityCheck, QualityItem, Rule } from '../types';

const ruleTypes = [
  { value: 'null_threshold', label: 'Null threshold', description: 'Maximum allowed missing-value fraction.' },
  { value: 'duplicate_check', label: 'Duplicate rows', description: 'Detect repeated rows, or duplicates by selected columns.' },
  { value: 'required_columns', label: 'Required columns', description: 'Ensure configured columns are present in the current file.' },
  { value: 'data_types', label: 'Data types', description: 'Validate logical types and coercible values.' },
  { value: 'numeric_ranges', label: 'Numeric ranges', description: 'Constrain numeric fields to min/max boundaries.' },
  { value: 'allowed_values', label: 'Allowed values', description: 'Restrict categorical fields to a known set.' },
  { value: 'unique_identifiers', label: 'Unique identifiers', description: 'Require non-null, unique identifier columns.' },
  { value: 'date_validation', label: 'Date validation', description: 'Parse configured date fields and optional bounds.' },
  { value: 'regex_checks', label: 'Regex checks', description: 'Match text values against a regular expression.' },
  { value: 'row_count', label: 'Row count', description: 'Constrain total dataset row count.' },
];
const templates: Record<string, string> = {
  null_threshold: '{\n  "threshold": 0.05,\n  "columns": []\n}',
  duplicate_check: '{\n  "columns": []\n}',
  required_columns: '{\n  "columns": ["customer_id", "email"]\n}',
  data_types: '{\n  "columns": {\n    "age": "integer",\n    "email": "string"\n  }\n}',
  numeric_ranges: '{\n  "ranges": {\n    "age": { "min": 0, "max": 120 }\n  }\n}',
  allowed_values: '{\n  "values": {\n    "status": ["active", "inactive"]\n  }\n}',
  unique_identifiers: '{\n  "columns": ["customer_id"],\n  "allow_null": false\n}',
  date_validation: '{\n  "columns": {\n    "event_date": "%Y-%m-%d"\n  },\n  "not_future": false\n}',
  regex_checks: '{\n  "columns": {\n    "email": "^[^@]+@[^@]+\\\\.[^@]+$"\n  }\n}',
  row_count: '{\n  "min": 1,\n  "max": null\n}',
};

export default function Quality() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [datasetId, setDatasetId] = useState(searchParams.get('dataset') || '');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const datasets = useQuery({ queryKey: ['datasets', 'all'], queryFn: () => api.datasets('', 1, 100) });
  const quality = useQuery({ queryKey: ['quality', datasetId], queryFn: () => api.quality(datasetId), enabled: Boolean(datasetId) });
  const rules = useQuery({ queryKey: ['rules', datasetId], queryFn: () => api.rules(datasetId), enabled: Boolean(datasetId) });
  useEffect(() => {
    if (!datasetId && datasets.data?.items.length) setDatasetId(datasets.data.items[0].id);
  }, [datasetId, datasets.data]);
  useEffect(() => {
    if (datasetId) setSearchParams({ dataset: datasetId }, { replace: true });
  }, [datasetId, setSearchParams]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['quality', datasetId] });
    queryClient.invalidateQueries({ queryKey: ['rules', datasetId] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    queryClient.invalidateQueries({ queryKey: ['alerts'] });
    queryClient.invalidateQueries({ queryKey: ['drift'] });
    queryClient.invalidateQueries({ queryKey: ['schema'] });
    queryClient.invalidateQueries({ queryKey: ['datasets'] });
  };
  const run = useMutation({ mutationFn: api.triggerRun, onSuccess: (result) => {
    invalidate();
    notify(result.status === 'completed' ? 'Quality validation completed' : 'Monitoring run failed', result.status === 'completed' ? 'success' : 'error', result.error || `${formatScore(result.summary.quality_score)} quality score`);
  }, onError: (error) => notify('Monitoring failed', 'error', error instanceof Error ? error.message : 'Unknown error') });
  const addRule = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Partial<Rule> }) => api.createRule(id, payload), onSuccess: () => { invalidate(); setEditorOpen(false); notify('Validation rule added', 'success', 'The rule will be evaluated in the next monitoring run.'); }, onError: (error) => notify('Could not add rule', 'error', error instanceof Error ? error.message : 'Unknown error') });
  const updateRule = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Partial<Rule> }) => api.updateRule(id, payload), onSuccess: () => { invalidate(); setEditorOpen(false); setEditing(null); notify('Validation rule updated', 'success'); }, onError: (error) => notify('Could not update rule', 'error', error instanceof Error ? error.message : 'Unknown error') });
  const deleteRule = useMutation({ mutationFn: api.deleteRule, onSuccess: () => { invalidate(); notify('Validation rule removed', 'success'); }, onError: (error) => notify('Could not remove rule', 'error', error instanceof Error ? error.message : 'Unknown error') });

  const datasetsList = datasets.data?.items || [];
  const result: QualityItem | undefined = quality.data?.items.find((item) => item.dataset_id === datasetId);
  const checkResults = result?.checks || [];
  const activeRules = rules.data?.items || [];
  const passed = checkResults.filter((check) => check.passed).length;
  const failed = checkResults.length - passed;
  const startAdd = () => { setEditing(null); setEditorOpen(true); };
  const startEdit = (rule: Rule) => { setEditing(rule); setEditorOpen(true); };

  return <div className="space-y-6">
    <PageHeader eyebrow="VALIDATION ENGINE" title="Data quality" description="Configure quality expectations and inspect persisted validation outcomes."
      actions={<>
        <SelectField aria-label="Select dataset" value={datasetId} onChange={(event) => setDatasetId(event.target.value)} className="header-select"><option value="">Select dataset</option>{datasetsList.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</SelectField>
        <Button variant="secondary" onClick={() => { quality.refetch(); rules.refetch(); }} disabled={!datasetId}><RefreshCw size={15} /> Refresh</Button>
        <Button onClick={() => run.mutate(datasetId)} disabled={!datasetId || run.isPending || !datasetsList.find((d) => d.id === datasetId)?.has_reference || !datasetsList.find((d) => d.id === datasetId)?.has_current}>{run.isPending ? <><span className="spinner" /> Running…</> : <><Play size={14} fill="currentColor" /> Run checks</>}</Button>
      </>} />

    {!datasets.isPending && !datasets.isError && datasetsList.length === 0 ? <Card><EmptyState title="No datasets to validate" detail="Register a dataset and upload both reference and current CSV files to begin." icon={<ShieldCheck size={22} />} /></Card> : null}
    {datasets.isError && <ErrorState error={datasets.error} retry={() => datasets.refetch()} />}
    {datasetsList.length > 0 && !datasetId && <Card><EmptyState title="Select a dataset" detail="Choose a dataset above to review its validation rules." /></Card>}
    {datasetId && <>
      {quality.isError && <ErrorState error={quality.error} retry={() => quality.refetch()} />}
      <div className="quality-summary-grid">
        <div className="quality-score-card"><div className="quality-score-ring" style={{ '--score': `${result?.score || 0}%` } as CSSProperties}><div><strong className={scoreTone(result?.score)}>{result?.score == null ? '—' : Math.round(result.score)}</strong><small>QUALITY</small></div></div><div className="quality-score-copy"><span>Current quality score</span><strong>{result?.run ? `Run ${result.run.id.slice(0, 8).toUpperCase()}` : 'No completed run'}</strong><small>{result?.run?.completed_at ? `Last validated ${formatDate(result.run.completed_at)}` : 'Start monitoring to produce actual validation results.'}</small></div></div>
        <div className="quality-stat-card"><span className="quality-stat-icon green-stat"><CheckCircle2 size={18} /></span><small>Passed checks</small><strong>{result ? passed : '—'}<em>{result ? ` / ${checkResults.length}` : ' not run'}</em></strong><span className="quality-stat-foot">Enabled validation outcomes</span></div>
        <div className="quality-stat-card"><span className="quality-stat-icon red-stat"><AlertTriangle size={18} /></span><small>Failed checks</small><strong>{result ? failed : '—'}<em>{result ? ` / ${checkResults.length}` : ' not run'}</em></strong><span className="quality-stat-foot">Based on real current-file rows</span></div>
      </div>

      <Card className="formula-card"><div className="formula-icon"><CircleHelp size={17} /></div><div><strong>How the score is calculated</strong><p>100 × (1 − severity-weighted mean of each rule’s failed-row fraction). Critical = 4, high = 3, medium = 2, low = 1. Table-level failures without a row denominator count as a full failure; no configured checks returns 100 with no evidence, so use the run status and check count together.</p></div><Badge tone="blue">Documented formula</Badge></Card>

      <Card title="Validation results" subtitle={result?.run ? `Persisted results from ${formatDate(result.run.completed_at)} · ${formatNumber(result.run.summary.row_count)} current rows` : 'Validation outcomes from the latest monitoring run'} action={result?.run && <Badge tone="blue">Run {result.run.id.slice(0, 8).toUpperCase()}</Badge>}>
        {quality.isPending ? <LoadingRows rows={5} columns={5} /> : checkResults.length ? <DataTable>
          <thead><tr><th>RULE</th><th>OUTCOME</th><th>SEVERITY</th><th>FAILED ROWS</th><th>OBSERVATION</th></tr></thead>
          <tbody>{checkResults.map((check) => <ValidationRow check={check} key={`${check.rule_id || check.rule_name}-${check.rule_type}`} />)}</tbody>
        </DataTable> : <EmptyState title="No validation result yet" detail="Run monitoring to evaluate configured rules against the current CSV." icon={<ClipboardCheck size={21} />} />}
      </Card>

      <Card title="Validation rules" subtitle={`${activeRules.filter((rule) => rule.enabled).length} enabled · changes apply to subsequent runs`} action={<Button size="sm" onClick={startAdd}><Plus size={15} /> Add rule</Button>}>
        {rules.isPending ? <LoadingRows rows={5} columns={4} /> : rules.isError ? <ErrorState error={rules.error} retry={() => rules.refetch()} /> : activeRules.length ? <DataTable>
          <thead><tr><th>RULE</th><th>TYPE</th><th>SEVERITY</th><th>CONFIGURATION</th><th>ENABLED</th><th className="text-right">ACTIONS</th></tr></thead>
          <tbody>{activeRules.map((rule) => <tr key={rule.id} className={!rule.enabled ? 'row-muted' : ''}>
            <td><div className="rule-name-cell"><span className="rule-icon"><Code2 size={15} /></span><div><strong>{rule.name}</strong><small>{rule.id.slice(0, 8)}</small></div></div></td>
            <td><Badge tone="slate">{rule.rule_type.replaceAll('_', ' ')}</Badge></td><td><StatusBadge status={rule.severity} /></td>
            <td><code className="config-preview">{JSON.stringify(rule.config)}</code></td>
            <td><button className={`switch ${rule.enabled ? 'switch-on' : ''}`} role="switch" aria-checked={rule.enabled} aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`} onClick={() => updateRule.mutate({ id: rule.id, payload: { enabled: !rule.enabled } })}><span /></button></td>
            <td className="text-right"><div className="table-actions"><button className="icon-button table-action" aria-label={`Edit ${rule.name}`} onClick={() => startEdit(rule)}><Edit2 size={15} /></button><button className="icon-button table-action delete-action" aria-label={`Delete ${rule.name}`} onClick={() => { if (window.confirm(`Delete rule “${rule.name}”?`)) deleteRule.mutate(rule.id); }}><Trash2 size={15} /></button></div></td>
          </tr>)}</tbody>
        </DataTable> : <EmptyState title="No rules configured" detail="Add one or more rules to make the quality score meaningful." icon={<ClipboardCheck size={21} />} />}
      </Card>
    </>}
    {editorOpen && datasetId && <RuleEditor rule={editing} onClose={() => { setEditorOpen(false); setEditing(null); }} onSave={(payload) => editing ? updateRule.mutate({ id: editing.id, payload }) : addRule.mutate({ id: datasetId, payload })} busy={addRule.isPending || updateRule.isPending} />}
  </div>;
}

function ValidationRow({ check }: { check: QualityCheck }) {
  return <tr><td><div className="rule-name-cell"><span className={`result-check-icon ${check.passed ? 'passed' : 'failed'}`}>{check.passed ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span><div><strong>{check.rule_name}</strong><small>{check.rule_type.replaceAll('_', ' ')}</small></div></div></td><td><StatusBadge status={check.passed ? 'passed' : 'failed'} label={check.passed ? 'Passed' : 'Failed'} /></td><td><StatusBadge status={check.severity} /></td><td><strong>{formatNumber(check.failed_rows)}</strong><span className="table-secondary"> / {formatNumber(check.total_rows)}</span></td><td><div className="observation-cell"><span>{check.message}</span><details><summary>Details</summary><pre>{JSON.stringify({ observed: check.observed, expected: check.expected }, null, 2)}</pre></details></div></td></tr>;
}

function RuleEditor({ rule, onClose, onSave, busy }: { rule: Rule | null; onClose: () => void; onSave: (payload: Partial<Rule>) => void; busy: boolean }) {
  const [name, setName] = useState(rule?.name || '');
  const [type, setType] = useState(rule?.rule_type || 'null_threshold');
  const [severity, setSeverity] = useState(rule?.severity || 'medium');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [config, setConfig] = useState(rule ? JSON.stringify(rule.config, null, 2) : templates.null_threshold);
  const [parseError, setParseError] = useState('');
  const selectedType = ruleTypes.find((item) => item.value === type);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(config); setParseError(''); }
    catch (error) { setParseError(error instanceof Error ? error.message : 'Invalid JSON'); return; }
    onSave({ name: name.trim(), rule_type: type, severity, enabled, config: parsed });
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card rule-modal" role="dialog" aria-modal="true" aria-labelledby="rule-modal-title">
    <div className="modal-heading"><div><span className="modal-icon"><ClipboardCheck size={18} /></span><div><h2 id="rule-modal-title">{rule ? 'Edit validation rule' : 'Create validation rule'}</h2><p>Rules are evaluated against actual current-file rows.</p></div></div><button className="icon-button" aria-label="Close rule editor" onClick={onClose}><X size={18} /></button></div>
    <form onSubmit={save} className="rule-editor-form">
      <div className="form-grid"><TextField label="Rule name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Email format" />
        <SelectField label="Rule type" value={type} onChange={(event) => { setType(event.target.value); if (!rule) setConfig(templates[event.target.value]); }}>{ruleTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField>
        <SelectField label="Severity weight" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="critical">Critical · 4×</option><option value="high">High · 3×</option><option value="medium">Medium · 2×</option><option value="low">Low · 1×</option></SelectField>
        <label className="enabled-editor"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>Rule enabled</strong><small>Disabled rules are skipped in monitoring.</small></span></label>
      </div>
      <div className="config-editor-label"><div><strong>Configuration JSON</strong><span>{selectedType?.description}</span></div><Badge tone="slate">Validated on run</Badge></div>
      <textarea aria-label="Rule configuration JSON" className="input config-editor" spellCheck={false} value={config} onChange={(event) => setConfig(event.target.value)} />
      {parseError && <div className="inline-error"><AlertTriangle size={14} />{parseError}</div>}
      <div className="rule-editor-note"><CircleHelp size={14} />For column-based checks use exact header names from the dataset profile. Config errors are persisted as failed checks, not silently ignored.</div>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <><span className="spinner" /> Saving…</> : rule ? 'Save changes' : <><Plus size={15} /> Create rule</>}</Button></div>
    </form>
  </section></div>;
}
