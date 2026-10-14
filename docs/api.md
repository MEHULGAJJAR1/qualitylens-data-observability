# QualityLens REST API (v1)

Interactive OpenAPI docs are served by the running backend at `http://localhost:8000/docs` (ReDoc: `/redoc`). All application routes are under `/api/v1`; errors use FastAPI/Pydantic status codes with a readable `detail`.

## System and overview

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | API and configured database connectivity (503 on DB failure; no fallback) |
| GET | `/overview` | Database-derived KPI, quality-trend, latest health, failures, runs and alerts |

## Datasets and profiles

| Method | Route | Purpose |
|---|---|---|
| GET | `/datasets?q=&page=1&limit=20` | Searchable/paginated catalog |
| POST | `/datasets` | Register an empty dataset |
| POST | `/datasets/upload` | Multipart CSV registration/upload; `file`, `role=reference|current`, optional `dataset_id`, `dataset_name`, `description` |
| GET | `/datasets/{id}` | Dataset metadata and latest run |
| DELETE | `/datasets/{id}` | Delete dataset, cascading metadata, and managed CSV files |
| GET | `/datasets/{id}/profiles` | Persisted column profiles for reference/current files |
| GET | `/datasets/{id}/preview?role=current&q=&page=1&limit=10` | Paginated/searchable row sample |

Upload a reference file first, then attach a current file to the returned dataset ID. Upload accepts `.csv`, checks the header and duplicate names, enforces `MAX_UPLOAD_MB`, and persists files under generated UUID paths.

```powershell
curl.exe -F "file=@.\backend\sample_data\clean_reference.csv" `
  -F "dataset_name=Customer sample" -F "role=reference" `
  http://localhost:8000/api/v1/datasets/upload
```

## Quality rules and results

| Method | Route | Purpose |
|---|---|---|
| GET | `/datasets/{id}/rules` | List configured rules |
| POST | `/datasets/{id}/rules` | Add a rule (`name`, `rule_type`, `config`, `severity`, `enabled`) |
| PUT | `/rules/{rule_id}` | Update rule fields, including enable/disable |
| DELETE | `/rules/{rule_id}` | Delete rule |
| GET | `/quality?dataset_id=` | Latest persisted quality results by dataset |

Supported rule types: `null_threshold`, `duplicate_check`, `required_columns`, `data_types`, `numeric_ranges`, `allowed_values`, `unique_identifiers`, `date_validation`, `regex_checks`, and `row_count`. Rule `config` examples are in the Data Quality rule editor and `backend/app/services.py` (default generation) / `backend/app/engine.py` (evaluation).

## Monitoring, drift and schema

| Method | Route | Purpose |
|---|---|---|
| POST | `/runs` | Execute pipeline (`{"dataset_id":"…","trigger_type":"manual"}`) |
| GET | `/runs?page=1&limit=25&status=&dataset_id=&q=` | Filtered monitoring history |
| GET | `/runs/{run_id}` | Quality, drift, schema, alert and error details |
| GET | `/drift?dataset_id=` | Latest per-feature drift outcomes and charts |
| GET | `/schema-changes?dataset_id=&acknowledged=false&severity=&q=&page=1&limit=25` | Filter schema differences |
| PATCH | `/schema-changes/{id}/acknowledge` | Set/unset acknowledgement, reviewer and notes |

A run response has `queued/running/completed/failed` lifecycle state; a processing failure is recorded with `error` rather than returned as a fabricated success. A completed run also produces an automatic persisted JSON report.

## Alerts, reports, schedules and settings

| Method | Route | Purpose |
|---|---|---|
| GET | `/alerts?status=open&severity=&source=&dataset_id=&q=&page=1&limit=25` | Filter alert history |
| PATCH | `/alerts/{id}` | `action=acknowledge|resolve|reopen`, optional investigation `notes` |
| GET | `/reports?dataset_id=&fmt=&page=1&limit=25` | Persisted report artifacts |
| GET | `/reports/{report_id}/download` | Download a stored payload |
| GET | `/runs/{run_id}/reports/{json|csv|html}` | Build, persist and download a format from actual run results |
| GET / POST | `/schedules` | List/create interval-based APScheduler jobs |
| PATCH / DELETE | `/schedules/{id}` | Pause/update or remove a schedule |
| GET / PATCH | `/settings` | Read/update quality and drift thresholds; shows DB and SMTP readiness |

## Example end-to-end API calls

```powershell
# Upload current CSV after registering the reference; replace DATASET_ID.
curl.exe -F "file=@.\backend\sample_data\clean_current.csv" `
  -F "dataset_id=DATASET_ID" -F "role=current" `
  http://localhost:8000/api/v1/datasets/upload

# Run the persisted workflow.
curl.exe -H "Content-Type: application/json" `
  -d '{"dataset_id":"DATASET_ID","trigger_type":"manual"}' `
  http://localhost:8000/api/v1/runs

# Download JSON report. CSV and HTML use the same route suffix pattern.
curl.exe -OJ http://localhost:8000/api/v1/runs/RUN_ID/reports/json
```

Pagination responses use `{items, page, limit, total}`. Timestamps are ISO-8601 values. The REST API has no authentication by design for the trusted-local setup; secure it before exposing it beyond a local network.
