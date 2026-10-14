# QualityLens: Data Quality & Drift Monitoring Framework

A local-first, end-to-end data observability application. QualityLens ingests CSV reference/current snapshots, profiles columns, evaluates configurable rules, detects distribution and schema drift, persists monitoring history/alerts/reports, and exposes the results through a responsive React dashboard and versioned REST API.

> No reference image was attached to the request, so the UI uses a premium enterprise SaaS direction: calm navy navigation, white/soft surfaces, blue accents, compact data tables, responsive cards, and light/dark modes.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Windows 10/11 setup](#windows-1011-setup)
- [Database configuration](#database-configuration)
- [Demo data](#demo-data)
- [Pages and workflow](#pages-and-workflow)
- [Quality score and drift method](#quality-score-and-drift-method)
- [API](#api)
- [Tests, lint and build](#tests-lint-and-build)
- [Docker Compose](#docker-compose)
- [Optional integrations](#optional-integrations)
- [Troubleshooting](#troubleshooting)
- [Security and known limitations](#security-and-known-limitations)
- [GitHub initialization](#github-initialization)
- [Verification performed in this environment](#verification-performed-in-this-environment)

## Features

### Frontend

- React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Recharts and Lucide React.
- Responsive collapsible navigation, mobile sidebar, persistent browser theme setting, global dataset search, live API/database status, in-app alert notifications, loading/error/empty states, toasts and accessible action labels.
- Overview, Datasets, Data Quality, Drift Monitoring, Schema Changes, Monitoring Runs, Alerts, Reports and Settings routes.
- Dataset catalog with multipart CSV upload, server-side size/header checks, profile statistics and searchable/paginated row preview.
- Working quality-rule CRUD/toggle editor, monitoring triggers, schema acknowledgement, alert acknowledge/resolve/reopen/investigation notes, scheduled-check configuration, thresholds and JSON/CSV/HTML report downloads.
- Recharts quality trend and per-feature reference/current comparison distributions from backend results.

### Backend and data processing

- FastAPI/Uvicorn/Pydantic 2, SQLAlchemy 2, Alembic, Pandas, NumPy and APScheduler.
- SQLAlchemy models for datasets, profiles, rules, runs, validation results, drift runs/features, schema changes, alerts, reports, schedules and settings. Includes foreign keys, indexes, JSON result snapshots and SQLite foreign-key enforcement.
- SQLite when `DATABASE_URL` is absent; PostgreSQL through Psycopg 3 when explicitly configured. A failed explicit PostgreSQL connection is reported rather than replaced with SQLite.
- Real CSV profiling, row preview, null rates, cardinality, numeric summaries, top values and reference/current comparison.
- Validation rules: null thresholds, duplicate rows, required columns, logical types, numeric ranges, allowed values, unique IDs, date validity, regex checks and row-count bounds.
- Numerical PSI, categorical total-variation distance, independent missing-rate change, feature-level comparison charts, schema additions/removals/possible renames/type/order changes.
- Persisted run errors, run duration/status, configurable interval schedules, deduplicated alerts, optional SMTP and safe JSON/CSV/escaped HTML report artifacts.
- UUID-based managed upload paths, CSV-only acceptance, 25 MB default limit, path containment checks, sanitized display filenames, CORS, request IDs and structured request logs.
- Optional Apache Airflow trigger DAG; Airflow is not required for local execution.

## Architecture

See [`docs/architecture.svg`](docs/architecture.svg) for a rendered system diagram and [`docs/architecture.md`](docs/architecture.md) for the monitoring sequence, persistence map and trust boundary. API routes and examples are in [`docs/api.md`](docs/api.md). Swagger UI is available at `/docs` while the API is running.

```mermaid
flowchart LR
  Browser[React / Vite] -->|/api/v1| API[FastAPI]
  API --> Engine[Profile · quality · drift · schema · alerts · reports]
  Engine --> DB[(PostgreSQL or SQLite)]
  Engine --> Files[(UUID-managed CSV storage)]
  Scheduler[APScheduler] --> Engine
  Airflow[Optional Airflow DAG] --> API
```

## Windows 10/11 setup

### Prerequisites

- Python 3.11+ (the code was also exercised here with Python 3.13).
- Node.js 20.19+ (Vite 8 runtime requirement) and npm.
- PowerShell and VS Code are recommended. Docker Desktop is optional.

Open PowerShell in the project root. If local script execution is restricted, use a process-scoped policy (does not change the machine policy):

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Install the backend virtual environment/dependencies, copy the development environment template, and install the frontend dependencies:

```powershell
.\scripts\setup.ps1
```

Initialize the SQLite schema, copy deterministic sample CSVs into managed storage, and run the real pipeline for each demo pair:

```powershell
.\scripts\init-demo.ps1
```

Start each process in its **own VS Code terminal**:

```powershell
# Terminal 1 — FastAPI on port 8000
.\scripts\start-backend.ps1
```

```powershell
# Terminal 2 — Vite on port 5173; /api requests proxy to FastAPI
.\scripts\start-frontend.ps1
```

### Local URLs

- Dashboard: **http://localhost:5173**
- API health: **http://localhost:8000/api/v1/health**
- Swagger/OpenAPI: **http://localhost:8000/docs**
- ReDoc: **http://localhost:8000/redoc**
- OpenAPI schema: **http://localhost:8000/openapi.json**

The Vite app calls a relative `/api/v1` path and the Vite server proxies it to the backend. The browser does not need to call `localhost:8000` directly.

### Manual commands (if you prefer not to use scripts)

```powershell
# From project root
py -3 -m venv .\backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install --upgrade pip
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
Copy-Item .\backend\.env.example .\backend\.env
Push-Location .\backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.cli demo
Pop-Location

# Terminal 1
.\scripts\start-backend.ps1
# Terminal 2
.\scripts\start-frontend.ps1
```

If `.env` already exists, `setup.ps1` leaves it unchanged. Scripts create/use `backend\.venv`; generated venvs, databases and uploads are ignored by Git.

## Database configuration

### SQLite development default

If `DATABASE_URL` is not present in `backend/.env` or the process environment, the backend uses:

```text
sqlite:///./qualitylens.db
```

The relative file is created under `backend/` when the server/CLI is launched there. Run Alembic explicitly when desired:

```powershell
Push-Location .\backend
.\.venv\Scripts\python.exe -m alembic upgrade head
Pop-Location
```

The FastAPI startup also calls SQLAlchemy `create_all` as a local convenience. Alembic is included for versioned schema setup and upgrades.

### PostgreSQL

Set an explicit Psycopg 3 SQLAlchemy URL in `backend/.env`:

```dotenv
DATABASE_URL=postgresql+psycopg://qualitylens:CHANGE_ME@localhost:5432/qualitylens
```

Create the database/user first, then run `alembic upgrade head`. The application never silently falls back if an explicit PostgreSQL connection fails; `/api/v1/health` reports `503` with the configured database kind and connection error, while database operations return an availability error. Do not put production credentials in source control.

## Demo data

The fixtures under `backend/sample_data/` are reproducibly generated with `python backend/scripts/generate_samples.py` and cover:

1. **Retail customers · clean** — a stable clean reference/current pair.
2. **Support contacts · missing values** — elevated current-file null rates.
3. **Payments · duplicate records** — duplicated transaction rows.
4. **Product catalog · distribution drift** — numerical price and categorical mix shifts.
5. **Customer registry · schema changes** — renamed/removed/added/reordered columns and a changed type.

`python -m app.cli demo` copies these files into managed storage and executes the same pipeline as `POST /api/v1/runs`. It does **not** insert fabricated dashboard KPI values. It is idempotent by dataset name and creates a fresh monitoring run each time it is invoked.

## Pages and workflow

1. In **Datasets**, upload a reference CSV (registers the dataset and profile), then upload a current CSV against that dataset.
2. Inspect reference/current profiles and row previews. Search by dataset name or description.
3. In **Data Quality**, enable/edit/remove default rules or add custom rules. Config is JSON and rule evaluation errors are recorded as failed results.
4. Trigger a full run from Datasets, Data Quality or Monitoring Runs. A run checks schema, quality, drift, alert conditions and writes a JSON report record.
5. Review feature distributions/statuses in Drift Monitoring, review/acknowledge schema differences, then acknowledge/resolve alerts with notes.
6. Download persisted reports from the Reports page or the run detail panel. Adjust thresholds/schedules in Settings.

## Quality score and drift method

### Documented quality score

For each enabled validation result `i`, define:

- `rᵢ = min(1, failed_rowsᵢ / total_rowsᵢ)` when the table has rows.
- A failed table-level/configuration check without a row denominator has `rᵢ = 1`; a passed check has `rᵢ = 0`.
- Severity weights are `critical=4`, `high=3`, `medium=2`, `low=1`.

```text
quality_score = clamp(100 × (1 − Σ(weightᵢ × rᵢ) / Σ(weightᵢ)), 0, 100)
```

When there are no enabled rules, the mathematical default is `100`; the UI and report include check count so a score with no evidence is not mistaken for a successful validated dataset. A null-threshold rule that stays within its configured limit passes even though it observes null values; a threshold breach counts affected rows. All scores are calculated from the actual rule results persisted for that run.

### Drift semantics

- Numerical: reference-quantile histogram bins with PSI (default threshold `0.20`).
- Categorical: total variation distance over observed categories (default `0.10`).
- Missingness: independent absolute reference/current missing-rate delta (default `0.05`).
- Feature and overall states distinguish `detected_drift`, `no_drift`, `insufficient_data` (fewer than 10 non-null values on a side) and `failed_comparison` (incompatible types/no valid comparison).
- Schema rename suggestions are heuristic (similar column names and same inferred logical type); acknowledge after review.
- Settings thresholds can be updated in the UI and are stored for future runs. Initial defaults can be overridden in environment variables.

## API

All app routes are versioned under `/api/v1`. See [`docs/api.md`](docs/api.md) for the complete endpoint list, filters and examples. Key routes:

- `GET /health`, `GET /overview`
- `GET/POST /datasets`, `POST /datasets/upload`, `GET /datasets/{id}/profiles`, `GET /datasets/{id}/preview`
- `GET/POST /datasets/{id}/rules`, `PUT/DELETE /rules/{id}`, `GET /quality`
- `POST /runs`, `GET /runs`, `GET /runs/{id}`, `GET /drift`
- `GET /schema-changes`, `PATCH /schema-changes/{id}/acknowledge`
- `GET /alerts`, `PATCH /alerts/{id}`
- `GET /reports`, `GET /reports/{id}/download`, `GET /runs/{id}/reports/{json|csv|html}`
- `GET/POST /schedules`, `PATCH/DELETE /schedules/{id}`, `GET/PATCH /settings`

Pagination responses use `{ items, page, limit, total }`. FastAPI provides request validation and Swagger documentation.

## Tests, lint and build

Backend (from `backend/`):

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check app tests
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Frontend (from `frontend/`):

```powershell
npm test
npm run lint
npm run build
```

`npm run build` runs TypeScript checking before the Vite production bundle. CI runs backend tests/Ruff and frontend tests/lint/typecheck/build on pushes and pull requests.

## Docker Compose

With Docker Desktop running from the project root:

```powershell
docker compose up --build
```

Compose starts PostgreSQL 16 with a health check, waits before starting the API, applies Alembic migrations in the backend container, persists PostgreSQL and uploads in named volumes, and serves the production frontend at **http://localhost:5173** with `/api/` proxied to the API. Replace the development-only default `POSTGRES_PASSWORD` before using beyond a disposable local environment. `docker compose down -v` deletes the persistent database and uploads.

Docker was not installed in the authoring sandbox, so the Compose build/run has not been claimed or verified here.

## Optional integrations

- **Great Expectations / Evidently:** version-tolerant adapters live in `backend/app/engine.py`; the built-in rules/PSI/TV engine is deterministic and remains usable without them. Install with `pip install -r backend/requirements-optional.txt` to attempt enabling both packages. Adapter availability/errors are recorded in run metadata. They were not installed in the authoring sandbox, so optional-library execution is not claimed as verified.
- **Email:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`, and `ALERT_EMAIL_TO` in `backend/.env`. SMTP is best-effort; delivery failures are logged and do not replace in-app alert state. No email delivery is claimed as verified unless configured by the operator.
- **Airflow:** copy `backend/airflow/dags/qualitylens_monitoring.py` into an Airflow DAG folder and set `QUALITYLENS_API_URL` and comma-separated `QUALITYLENS_DATASET_IDS`. The DAG calls the REST API; Airflow is not included in local requirements or required by the application.

## Troubleshooting

### Frontend shows “API unavailable”

- Ensure the FastAPI terminal is running on port `8000` and `http://localhost:8000/api/v1/health` returns `200`.
- Ensure Vite is running on port `5173`; its `/api` proxy targets `127.0.0.1:8000` server-side.
- If using a different backend port, update `frontend/vite.config.ts` proxy and restart Vite.

### Database reports `503` / connection refused

- Check `backend/.env` for `DATABASE_URL`. Remove it to use local SQLite, or correct the configured PostgreSQL host/port/user/password/database and start PostgreSQL.
- The application intentionally does not silently switch databases after a configured connection fails.
- From `backend/`, run `python -m alembic upgrade head` after database service is ready.

### Demo data does not appear

- Run `scripts/init-demo.ps1` from the root (or `python -m app.cli demo` from `backend/`).
- Check `backend/data/uploads/` exists and `/api/v1/health` is healthy.
- Sample file fixtures are source-controlled under `backend/sample_data/`.

### Port conflict or PowerShell script restriction

- Stop the process using `8000`/`5173`, or change matching Uvicorn/Vite scripts and proxy config together.
- `Set-ExecutionPolicy -Scope Process Bypass` allows the current PowerShell process to run local scripts without changing the machine policy.

### Windows compiler / package issue

- Use Python 3.11+ and Node.js 20.19+ (or 22.12+) with npm 10+; the SQLite path requires no local PostgreSQL server.
- Run `python -m pip install --upgrade pip` in `backend/.venv` and retry `pip install -r requirements.txt`.
- If optional GE/Evidently wheels are unavailable for your Python version, keep the built-in engine; the core app remains functional and records adapter fallback status.

## Security and known limitations

- This is a trusted-local-development application with no authentication or tenant isolation. Do not expose it to the public internet without adding authz/authn, rate limits, TLS, deployment secrets and operational hardening.
- Upload validation limits file size, file extension, column count, duplicate headers and managed path access. Processing is synchronous in a FastAPI worker; for very large or high-concurrency data workloads use a queue/worker topology (or optional Airflow trigger) and object storage.
- SMTP delivery, optional GE/Evidently execution, external PostgreSQL and Docker deployment depend on user-provided services and were not verified in this environment.
- The frontend unit tests cover UI primitives/notifications; full browser-based end-to-end automation is not included.

## GitHub initialization

From the project root after reviewing `.gitignore` and ensuring no populated `backend/.env` is staged:

```powershell
git init
git add .
git commit -m "Build QualityLens data quality and drift monitoring framework"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/qualitylens.git
git push -u origin main
```

If the remote already exists, use `git remote set-url origin https://github.com/YOUR_USERNAME/qualitylens.git` before pushing.

## Verification performed in this environment

Recorded on the supplied Linux sandbox (not Windows):

- Python **3.13.16**, Node **20.20.2**, npm **10.8.2**; workspace was initially empty.
- Backend core requirements installed; SQLite schema initialized; deterministic demo pipeline completed **5 actual runs**. Observed statuses included clean/no drift, missingness/drift, duplicates/no drift, product distribution/drift, and schema changes/failed-comparison.
- Backend: **9 pytest tests passed** (one non-fatal Starlette/httpx TestClient deprecation warning); Ruff: **all checks passed**; a temporary SQLite Alembic upgrade created all 12 application tables.
- Frontend: **2 Vitest tests passed**; ESLint passed; TypeScript + Vite 8 production build passed with route/chart code-splitting; `npm audit` reported **0 vulnerabilities**.
- Live FastAPI health and overview APIs returned actual SQLite-backed demo data; the Vite `/api/v1` proxy worked, a manual real pipeline run completed, and JSON/CSV/HTML report downloads all returned `200`.
- Not verified: Docker (CLI not installed), PostgreSQL service, SMTP delivery, optional Great Expectations/Evidently package execution, Windows PowerShell runtime, and full browser e2e clicks.
