import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, Clock3, Database, Mail, Plus, RefreshCw, Save, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { useTheme } from '../components/theme';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, formatDate, LoadingRows, PageHeader, SelectField, TextField } from '../components/ui';
import type { Schedule } from '../types';

export default function Settings() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { dark, toggle } = useTheme();
  const [values, setValues] = useState({ alert_quality_threshold: 80, numeric_drift_threshold: 0.2, categorical_drift_threshold: 0.1, missing_drift_threshold: 0.05 });
  const [scheduleDataset, setScheduleDataset] = useState('');
  const [scheduleName, setScheduleName] = useState('Daily data quality check');
  const [interval, setInterval] = useState(1440);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules });
  const datasets = useQuery({ queryKey: ['datasets', 'settings'], queryFn: () => api.datasets('', 1, 100) });
  useEffect(() => {
    if (settings.data) setValues({ alert_quality_threshold: settings.data.alert_quality_threshold,
      numeric_drift_threshold: settings.data.numeric_drift_threshold,
      categorical_drift_threshold: settings.data.categorical_drift_threshold,
      missing_drift_threshold: settings.data.missing_drift_threshold });
  }, [settings.data]);
  useEffect(() => { if (!scheduleDataset && datasets.data?.items.length) setScheduleDataset(datasets.data.items[0].id); }, [scheduleDataset, datasets.data]);
  const update = useMutation({ mutationFn: api.updateSettings, onSuccess: (result) => {
    queryClient.setQueryData(['settings'], result);
    queryClient.invalidateQueries({ queryKey: ['overview'] });
    notify('Monitoring thresholds saved', 'success', 'New monitoring runs use the updated thresholds.');
  }, onError: (error) => notify('Settings could not be saved', 'error', error instanceof Error ? error.message : 'Request failed') });
  const createSchedule = useMutation({ mutationFn: api.createSchedule, onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] }); queryClient.invalidateQueries({ queryKey: ['overview'] });
    notify('Schedule created', 'success', 'APScheduler will trigger the dataset after the configured interval.'); setScheduleName('');
  }, onError: (error) => notify('Schedule could not be created', 'error', error instanceof Error ? error.message : 'Request failed') });
  const updateSchedule = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<Schedule> }) => api.updateSchedule(id, patch), onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] }); queryClient.invalidateQueries({ queryKey: ['overview'] }); notify('Schedule updated', 'success');
  }, onError: (error) => notify('Schedule update failed', 'error', error instanceof Error ? error.message : 'Request failed') });
  const deleteSchedule = useMutation({ mutationFn: api.deleteSchedule, onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] }); queryClient.invalidateQueries({ queryKey: ['overview'] }); notify('Schedule removed', 'success');
  }, onError: (error) => notify('Schedule could not be deleted', 'error', error instanceof Error ? error.message : 'Request failed') });
  const submitThresholds = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); update.mutate(values); };
  const submitSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduleDataset) { notify('Select a dataset', 'error'); return; }
    createSchedule.mutate({ dataset_id: scheduleDataset, name: scheduleName.trim(), interval_minutes: Number(interval), active: true });
  };
  const config = settings.data;

  return <div className="space-y-6">
    <PageHeader eyebrow="WORKSPACE CONFIGURATION" title="Settings" description="Configure alert thresholds, scheduled monitoring, workspace appearance and delivery readiness." actions={<Button variant="secondary" onClick={() => { settings.refetch(); schedules.refetch(); }}><RefreshCw size={15} /> Refresh status</Button>} />
    {settings.isError && <ErrorState error={settings.error} retry={() => settings.refetch()} />}
    <div className="settings-grid">
      <Card title="Monitoring thresholds" subtitle="Persisted settings are applied to subsequent monitoring runs" action={<span className="settings-card-icon"><Activity size={16} /></span>}>
        {settings.isPending ? <LoadingRows rows={4} columns={2} /> : <form className="threshold-form" onSubmit={submitThresholds}>
          <NumberSetting label="Quality alert threshold" description="Create a quality alert below this score." value={values.alert_quality_threshold} min={0} max={100} step={1} suffix="/ 100" onChange={(value) => setValues({ ...values, alert_quality_threshold: value })} />
          <NumberSetting label="Numeric PSI threshold" description="Population Stability Index for numerical features." value={values.numeric_drift_threshold} min={0.001} max={10} step={0.01} onChange={(value) => setValues({ ...values, numeric_drift_threshold: value })} />
          <NumberSetting label="Categorical drift threshold" description="Total-variation distance for categorical features." value={values.categorical_drift_threshold} min={0.001} max={1} step={0.01} onChange={(value) => setValues({ ...values, categorical_drift_threshold: value })} />
          <NumberSetting label="Missing-rate change" description="Absolute reference/current null-rate delta." value={values.missing_drift_threshold} min={0.001} max={1} step={0.01} onChange={(value) => setValues({ ...values, missing_drift_threshold: value })} />
          <div className="threshold-footer"><span>Score calculations use real persisted validation results.</span><Button type="submit" disabled={update.isPending}>{update.isPending ? 'Saving…' : <><Save size={14} /> Save thresholds</>}</Button></div>
        </form>}
      </Card>

      <Card title="Appearance" subtitle="Your theme preference is stored in this browser" action={<span className="settings-card-icon"><Sun size={16} /></span>}>
        <div className="appearance-options"><button className={`appearance-option ${!dark ? 'selected' : ''}`} onClick={() => dark && toggle()}><span className="appearance-preview light-preview"><span /><span /><span /></span><span><strong>Light</strong><small>Clean white surfaces</small></span>{!dark && <Check size={16} className="text-blue" />}</button><button className={`appearance-option ${dark ? 'selected' : ''}`} onClick={() => !dark && toggle()}><span className="appearance-preview dark-preview"><span /><span /><span /></span><span><strong>Dark</strong><small>Low-light workspace</small></span>{dark && <Check size={16} className="text-blue" />}</button></div>
        <div className="appearance-note">Theme can also be changed from the top navigation. This setting is local to your browser.</div>
      </Card>

      <Card className="schedule-card" title="Scheduled checks" subtitle="Interval schedules are managed by APScheduler and stored in the database" action={<Badge tone="blue">{config?.scheduler || 'APScheduler'}</Badge>}>
        <form className="schedule-form" onSubmit={submitSchedule}>
          <SelectField label="Dataset" value={scheduleDataset} onChange={(event) => setScheduleDataset(event.target.value)}><option value="">Select dataset…</option>{(datasets.data?.items || []).map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</SelectField>
          <TextField label="Schedule name" value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Hourly checks" />
          <SelectField label="Run interval" value={interval} onChange={(event) => setInterval(Number(event.target.value))}><option value={15}>Every 15 minutes</option><option value={60}>Every hour</option><option value={360}>Every 6 hours</option><option value={720}>Every 12 hours</option><option value={1440}>Daily</option><option value={10080}>Weekly</option></SelectField>
          <Button type="submit" disabled={createSchedule.isPending || !scheduleDataset}>{createSchedule.isPending ? 'Creating…' : <><Plus size={15} /> Add schedule</>}</Button>
        </form>
        <div className="schedule-list-wrap">{schedules.isPending ? <LoadingRows rows={3} columns={3} /> : schedules.isError ? <ErrorState error={schedules.error} retry={() => schedules.refetch()} /> : schedules.data?.items.length ? <DataTable>
          <thead><tr><th>SCHEDULE</th><th>DATASET</th><th>INTERVAL</th><th>LAST RUN</th><th>ACTIVE</th><th className="text-right">ACTION</th></tr></thead>
          <tbody>{schedules.data.items.map((schedule) => <tr key={schedule.id}><td><div className="schedule-name"><Clock3 size={14} /><strong>{schedule.name}</strong></div></td><td>{schedule.dataset_name}</td><td>{intervalLabel(schedule.interval_minutes)}</td><td>{formatDate(schedule.last_run_at)}</td><td><button className={`switch ${schedule.active ? 'switch-on' : ''}`} role="switch" aria-checked={schedule.active} aria-label={`${schedule.active ? 'Pause' : 'Activate'} ${schedule.name}`} onClick={() => updateSchedule.mutate({ id: schedule.id, patch: { active: !schedule.active } })}><span /></button></td><td className="text-right"><button className="icon-button table-action delete-action" aria-label={`Delete ${schedule.name}`} title="Delete schedule" onClick={() => { if (window.confirm(`Delete schedule “${schedule.name}”?`)) deleteSchedule.mutate(schedule.id); }}><Trash2 size={15} /></button></td></tr>)}</tbody>
        </DataTable> : <EmptyState title="No schedules yet" detail="Add an interval schedule to run monitoring automatically." icon={<Clock3 size={20} />} />}</div>
      </Card>

      <Card title="Connections & notifications" subtitle="Runtime health and optional delivery configuration" action={<span className="settings-card-icon"><Database size={16} /></span>}>
        {config ? <div className="connection-settings-list">
          <ConnectionRow icon={<Database size={16} />} label="Primary database" value={config.database_kind.toUpperCase()} status={config.database_connected ? 'Connected' : 'Unavailable'} healthy={config.database_connected} />
          {!config.database_connected && <div className="connection-error">{config.database_error || 'Database connection failed. Check DATABASE_URL.'}</div>}
          <ConnectionRow icon={<Activity size={16} />} label="Monitoring scheduler" value={config.scheduler} status="Configured" healthy />
          <ConnectionRow icon={<Mail size={16} />} label="SMTP email delivery" value={config.email_configured ? 'Configuration detected' : 'Not configured'} status={config.email_configured ? 'Optional' : 'In-app only'} healthy={config.email_configured} />
          <div className="settings-info-note"><Mail size={14} />Email is attempted only when SMTP_HOST, SMTP_FROM and ALERT_EMAIL_TO are configured. Delivery is best-effort and failures are logged; in-app alert state remains authoritative.</div>
          <div className="connection-row"><span className="connection-row-icon"><ShieldCheck size={16} /></span><div><strong>CSV file-size limit</strong><small>Maximum accepted upload size</small></div><strong className="connection-value">{config.upload_limit_mb} MB</strong></div>
        </div> : settings.isPending ? <LoadingRows rows={4} columns={2} /> : null}
      </Card>
    </div>
    <div className="settings-footnote"><ShieldCheck size={14} /><span>Secrets and connection strings are configured through <code>backend/.env</code>. Never commit populated environment files.</span></div>
  </div>;
}

function NumberSetting({ label, description, value, min, max, step, suffix, onChange }: { label: string; description: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="number-setting"><span><strong>{label}</strong><small>{description}</small></span><span className="number-input-wrap"><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} required /><em>{suffix || ''}</em></span></label>;
}
function ConnectionRow({ icon, label, value, status, healthy }: { icon: ReactNode; label: string; value: string; status: string; healthy: boolean }) {
  return <div className="connection-row"><span className="connection-row-icon">{icon}</span><div><strong>{label}</strong><small>{value}</small></div><span className={`connection-status ${healthy ? 'connection-ok' : 'connection-muted'}`}><i />{status}</span></div>;
}
function intervalLabel(minutes: number) { return minutes >= 10080 ? 'Weekly' : minutes >= 1440 ? `${Math.round(minutes / 1440)} day(s)` : minutes >= 60 ? `${minutes / 60} hour(s)` : `${minutes} min`; }
