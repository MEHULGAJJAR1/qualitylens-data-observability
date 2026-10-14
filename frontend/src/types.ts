export interface Page<T> { items: T[]; page: number; limit: number; total: number }
export interface Dataset {
  id: string; name: string; description: string; reference_filename?: string | null; current_filename?: string | null;
  has_reference: boolean; has_current: boolean; row_count: number; column_count: number;
  created_at: string; updated_at: string; quality_score?: number | null; drift_status?: string | null;
  health_status: string; latest_run?: Run | null;
}
export interface Run {
  id: string; dataset_id: string; dataset_name?: string | null; status: string; trigger_type: string;
  started_at: string; completed_at?: string | null; duration_ms?: number | null; error?: string | null;
  summary: Record<string, any>;
}
export interface QualityCheck {
  id?: string; rule_id?: string | null; rule_name: string; rule_type: string; severity: string;
  passed: boolean; failed_rows: number; total_rows: number; message: string;
  observed: Record<string, any>; expected: Record<string, any>;
}
export interface QualityItem {
  dataset_id: string; dataset_name: string; run: Run | null; score?: number | null;
  score_formula: string; checks: QualityCheck[];
}
export interface Rule {
  id: string; dataset_id: string; name: string; rule_type: string; config: Record<string, any>;
  severity: string; enabled: boolean; created_at: string;
}
export interface DriftFeature {
  id?: string; feature_name: string; feature_type: string; status: string; drifted: boolean;
  score?: number | null; threshold?: number | null; missing_reference: number; missing_current: number;
  details: Record<string, any>;
}
export interface DriftItem {
  dataset_id: string; dataset_name: string; run: Run | null; status: string;
  features_checked: number; features_drifted: number; engine?: string | null;
  thresholds: Record<string, number>; adapter?: Record<string, any>; features: DriftFeature[];
}
export interface SchemaChange {
  id: string; dataset_id: string; dataset_name?: string; run_id: string; kind: string; column_name: string;
  old_value?: string | null; new_value?: string | null; severity: string; acknowledged: boolean;
  acknowledged_at?: string | null; notes?: string | null; created_at: string;
}
export interface Alert {
  id: string; dataset_id: string; dataset_name?: string; run_id?: string | null; source: string;
  severity: string; title: string; trigger_reason: string; status: 'open' | 'acknowledged' | 'resolved';
  dedupe_key?: string; notes?: string | null; acknowledged_at?: string | null; resolved_at?: string | null;
  created_at: string;
}
export interface ColumnProfile {
  id: string; dataset_id: string; profile_type: 'reference' | 'current'; column_name: string;
  inferred_type: string; row_count: number; null_count: number; unique_count: number; null_rate: number;
  mean?: number | null; minimum?: string | null; maximum?: string | null;
  top_values: Array<{ value: string; count: number }>;
}
export interface Preview { dataset_id: string; role: string; columns: string[]; rows: any[][]; page: number; limit: number; total: number; filtered: boolean }
export interface Overview {
  kpis: { datasets: number; average_quality_score?: number | null; drifted_features: number;
    datasets_with_drift: number; open_alerts: number; active_schedules: number; monitored_datasets: number };
  quality_trend: Array<{ run_id: string; label: string; timestamp: string; quality_score: number; dataset_name: string }>;
  dataset_health: Array<{ id: string; name: string; rows: number; columns: number; quality_score?: number | null;
    drift_status?: string | null; last_run_at?: string | null; run_status: string; health_status: string }>;
  drift_statistics: { drifted_features: number; datasets_with_drift: number; datasets_checked: number };
  recent_runs: Run[];
  validation_failures: Array<{ id: string; dataset_name: string; run_id: string; rule_name: string; severity: string;
    message: string; failed_rows: number; created_at: string }>;
  open_alerts_preview: Array<{ id: string; dataset_name: string; source: string; severity: string; title: string; status: string; created_at: string }>;
}
export interface Schedule {
  id: string; dataset_id: string; dataset_name?: string; name: string; interval_minutes: number;
  active: boolean; last_run_at?: string | null; created_at?: string;
}
export interface ReportItem {
  id: string; run_id: string; dataset_id?: string | null; dataset_name?: string | null;
  format: 'json' | 'csv' | 'html'; filename: string; created_at: string;
}
export interface AppSettings {
  alert_quality_threshold: number; numeric_drift_threshold: number; categorical_drift_threshold: number;
  missing_drift_threshold: number; database_kind: string; database_connected: boolean; database_error?: string | null;
  upload_limit_mb: number; email_configured: boolean; scheduler: string;
}
export interface RunDetail {
  run: Run;
  quality: { score?: number | null; checks: QualityCheck[] };
  drift: DriftItem | null;
  schema_changes: SchemaChange[];
  alerts: Alert[];
}
