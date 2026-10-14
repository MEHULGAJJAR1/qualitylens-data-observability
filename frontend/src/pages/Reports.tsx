import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { api, downloadReport } from '../lib/api';
import { Button, Card, DataTable, EmptyState, ErrorState, formatDate, LoadingRows, PageHeader, SelectField, StatusBadge } from '../components/ui';
import { ArrowDownToLine, Download, FileJson2, FileSpreadsheet, FileText, ScrollText } from 'lucide-react';
import type { Run } from '../types';

export default function Reports() {
  const [selectedRun, setSelectedRun] = useState('');
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const reports = useQuery({ queryKey: ['reports'], queryFn: () => api.reports({ page: 1, limit: 100 }) });
  const runs = useQuery({ queryKey: ['runs', 'reports'], queryFn: () => api.runs({ page: 1, limit: 100 }) });
  const generate = useMutation({
    mutationFn: async ({ runId, format }: { runId: string; format: 'json' | 'csv' | 'html' }) => {
      await downloadReport(`/runs/${runId}/reports/${format}`);
      return format;
    },
    onSuccess: (format) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      notify(`${format.toUpperCase()} report downloaded`, 'success', 'Built from the selected monitoring run’s persisted results.');
    },
    onError: (error) => notify('Report generation failed', 'error', error instanceof Error ? error.message : 'Request failed'),
  });
  const downloadExisting = useMutation({
    mutationFn: async (id: string) => { await downloadReport(`/reports/${id}/download`); },
    onSuccess: () => notify('Report downloaded', 'success', 'This is the stored report artifact from its monitoring run.'),
    onError: (error) => notify('Download failed', 'error', error instanceof Error ? error.message : 'Request failed'),
  });
  const runItems = runs.data?.items || [];
  const reportItems = reports.data?.items || [];
  const chooseRun = (run: Run) => { setSelectedRun(run.id); };
  const selected = runItems.find((run) => run.id === selectedRun);

  return <div className="space-y-6">
    <PageHeader eyebrow="AUDIT & EXPORTS" title="Reports" description="Download JSON, CSV or HTML artifacts generated from actual persisted monitoring results." actions={<Button variant="secondary" onClick={() => { reports.refetch(); runs.refetch(); }}><ScrollText size={15} /> Refresh library</Button>} />
    <Card className="report-builder-card"><div className="report-builder-copy"><span className="report-builder-icon"><FileText size={19} /></span><div><h2>Generate a report</h2><p>Choose a completed or failed run. Downloads include quality checks, drift features, schema changes and alerts.</p></div></div>
      <div className="report-builder-controls"><SelectField label="Monitoring run" value={selectedRun} onChange={(event) => setSelectedRun(event.target.value)}><option value="">Select a run…</option>{runItems.map((run) => <option value={run.id} key={run.id}>{run.dataset_name} · {formatDate(run.started_at)} · {run.id.slice(0, 8)}</option>)}</SelectField>
        <div className="report-format-actions"><Button variant="secondary" disabled={!selectedRun || generate.isPending} onClick={() => generate.mutate({ runId: selectedRun, format: 'json' })}><FileJson2 size={15} /> JSON</Button><Button variant="secondary" disabled={!selectedRun || generate.isPending} onClick={() => generate.mutate({ runId: selectedRun, format: 'csv' })}><FileSpreadsheet size={15} /> CSV</Button><Button disabled={!selectedRun || generate.isPending} onClick={() => generate.mutate({ runId: selectedRun, format: 'html' })}>{generate.isPending ? <><span className="spinner" /> Building…</> : <><FileText size={15} /> HTML</>}</Button></div>
      </div>
      {selected && <div className="report-run-context"><StatusBadge status={selected.status} /><span>{selected.dataset_name}</span><span>{formatDate(selected.started_at)}</span><span>Quality {selected.summary.quality_score == null ? '—' : `${selected.summary.quality_score.toFixed(1)}%`}</span><span>{selected.summary.checks_total || 0} checks</span></div>}
      {runs.data?.total === 0 && !runs.isPending && <div className="report-empty-run">No monitoring runs are available yet. Start a run before generating a report.</div>}
    </Card>
    <Card title="Report library" subtitle="Automatically generated JSON reports and downloaded formats are recorded here" action={<span className="report-count">{reports.data?.total || 0} artifacts</span>}>
      {reports.isPending ? <LoadingRows rows={5} columns={5} /> : reports.isError ? <ErrorState error={reports.error} retry={() => reports.refetch()} /> : reportItems.length ? <DataTable>
        <thead><tr><th>ARTIFACT</th><th>DATASET</th><th>RUN</th><th>FORMAT</th><th>GENERATED</th><th className="text-right">DOWNLOAD</th></tr></thead>
        <tbody>{reportItems.map((report) => <tr key={report.id}>
          <td><div className="report-file-cell"><span className={`report-file-icon report-${report.format}`}>{report.format === 'json' ? <FileJson2 size={16} /> : report.format === 'csv' ? <FileSpreadsheet size={16} /> : <FileText size={16} />}</span><div><strong>{report.filename}</strong><small>Stored payload · {report.id.slice(0, 8)}</small></div></div></td>
          <td>{report.dataset_name || 'Dataset'}</td><td><button className="text-link" onClick={() => chooseRun(runItems.find((run) => run.id === report.run_id) || ({ id: report.run_id } as Run))}>{report.run_id.slice(0, 8).toUpperCase()}</button></td><td><StatusBadge status={report.format} /></td><td>{formatDate(report.created_at)}</td>
          <td className="text-right"><Button size="sm" variant="secondary" disabled={downloadExisting.isPending} onClick={() => downloadExisting.mutate(report.id)}><ArrowDownToLine size={14} /> Download</Button></td>
        </tr>)}</tbody>
      </DataTable> : <EmptyState title="No reports have been generated" detail="Completed monitoring runs create a JSON report. Generate CSV or HTML exports above." icon={<ScrollText size={22} />} />}
    </Card>
    <div className="report-content-note"><Download size={15} /><span>Report data is generated only from persisted run, validation, drift, schema and alert records. The JSON payload includes the score formula and engine/threshold metadata.</span></div>
  </div>;
}
