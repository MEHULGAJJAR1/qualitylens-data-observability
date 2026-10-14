from __future__ import annotations

import csv
import io
import logging
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import DatabaseUnavailable, check_connection, create_schema, new_session
from app.logging_config import configure_logging
from app.models import (
    Alert,
    AppSetting,
    ColumnProfile,
    Dataset,
    DriftRun,
    FeatureDriftResult,
    MonitoringRun,
    Report,
    Schedule,
    SchemaChange,
    ValidationResult,
    ValidationRule,
    utcnow,
)
from app.scheduler import remove_schedule, start_scheduler, stop_scheduler, sync_schedule
from app.schemas import (
    AlertAction,
    DatasetCreate,
    RuleCreate,
    RuleUpdate,
    RunCreate,
    ScheduleCreate,
    ScheduleUpdate,
    SchemaAcknowledge,
    SettingsUpdate,
)
from app.services import (
    create_report,
    persist_profiles,
    read_dataset,
    run_monitoring,
    safe_file_path,
    seed_default_rules,
    serialize_report,
)

configure_logging(settings.log_level)
logger = logging.getLogger("qualitylens.api")


@asynccontextmanager
async def lifespan(_app):
    on_startup()
    try:
        yield
    finally:
        on_shutdown()


app = FastAPI(
    lifespan=lifespan,
    title="QualityLens API",
    version="1.0.0",
    description=(
        "Data quality, schema change and drift monitoring. API base: `/api/v1`. "
        "Quality score formula: 100 × (1 − weighted mean failed-row fraction), "
        "severity weights critical=4, high=3, medium=2, low=1."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging(request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request_unhandled_error", extra={"request_id": request_id, "path": request.url.path})
        raise
    duration = round((time.perf_counter() - started) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    logger.info("http_request", extra={
        "request_id": request_id, "method": request.method, "path": request.url.path,
        "status_code": response.status_code, "duration_ms": duration,
    })
    return response


@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(_request, exc: SQLAlchemyError):
    logger.exception("database_operation_failed")
    return JSONResponse(status_code=503, content={
        "detail": "Database operation failed. Verify DATABASE_URL and database availability; no fallback database was selected.",
        "error_type": type(exc).__name__,
    })


def on_startup():
    healthy, error = check_connection()
    if not healthy:
        logger.error("database_unavailable_on_startup", extra={"detail": error})
        return
    try:
        create_schema()
        start_scheduler()
    except Exception:
        logger.exception("application_startup_initialization_failed")


def on_shutdown():
    stop_scheduler()


def get_db():
    try:
        db = new_session()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}") from exc
    try:
        yield db
    finally:
        db.close()


router = APIRouter(prefix="/api/v1")


def _stamp(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _dataset_dict(dataset: Dataset, latest: MonitoringRun | None = None) -> dict:
    summary = latest.summary or {} if latest else {}
    return {
        "id": dataset.id, "name": dataset.name, "description": dataset.description,
        "reference_filename": dataset.reference_filename, "current_filename": dataset.current_filename,
        "has_reference": bool(dataset.reference_path), "has_current": bool(dataset.current_path),
        "row_count": dataset.row_count, "column_count": dataset.column_count,
        "created_at": _stamp(dataset.created_at), "updated_at": _stamp(dataset.updated_at),
        "latest_run": _run_dict(latest, dataset.name) if latest else None,
        "quality_score": summary.get("quality_score"),
        "drift_status": summary.get("drift_status"),
        "health_status": ("healthy" if latest and latest.status == "completed"
                          and (summary.get("quality_score") or 0) >= 80
                          and summary.get("checks_failed", 0) == 0
                          and summary.get("drift_status") == "no_drift"
                          and summary.get("schema_changes", 0) == 0 else
                          "attention" if latest and latest.status == "completed" else
                          latest.status if latest else "not_monitored"),
    }


def _run_dict(run: MonitoringRun, dataset_name: str | None = None) -> dict:
    return {
        "id": run.id, "dataset_id": run.dataset_id, "dataset_name": dataset_name,
        "status": run.status, "trigger_type": run.trigger_type,
        "started_at": _stamp(run.started_at), "completed_at": _stamp(run.completed_at),
        "duration_ms": run.duration_ms, "error": run.error,
        "summary": run.summary or {},
    }


def _latest_runs(db: Session, dataset_ids: list[str]) -> dict[str, MonitoringRun]:
    if not dataset_ids:
        return {}
    runs = db.scalars(select(MonitoringRun).where(MonitoringRun.dataset_id.in_(dataset_ids)).order_by(MonitoringRun.started_at.desc())).all()
    result: dict[str, MonitoringRun] = {}
    for run in runs:
        result.setdefault(run.dataset_id, run)
    return result


def _page(page: int, limit: int) -> tuple[int, int]:
    return (page - 1) * limit, limit


def _clean_cell(value):
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, (str, int, float, bool)):
        if isinstance(value, float) and not pd.notna(value):
            return None
        return value
    return str(value)


@router.get("/health", tags=["system"])
def health():
    healthy, error = check_connection()
    payload = {
        "status": "ok" if healthy else "degraded",
        "service": "qualitylens-api",
        "version": app.version,
        "database": {"kind": settings.database_kind, "connected": healthy, "error": error},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return JSONResponse(status_code=200 if healthy else 503, content=payload)


@router.get("/overview", tags=["overview"])
def overview(db: Session = Depends(get_db)):
    datasets = db.scalars(select(Dataset).order_by(Dataset.created_at.desc())).all()
    latest_map = _latest_runs(db, [d.id for d in datasets])
    latest = list(latest_map.values())
    completed = [r for r in latest if r.status == "completed" and (r.summary or {}).get("quality_score") is not None]
    avg_score = round(sum(float(r.summary["quality_score"]) for r in completed) / len(completed), 1) if completed else None
    open_alert_count = db.scalar(select(func.count(Alert.id)).where(Alert.status == "open")) or 0
    schedule_count = db.scalar(select(func.count(Schedule.id)).where(Schedule.active.is_(True))) or 0
    recent_runs = db.scalars(select(MonitoringRun).order_by(MonitoringRun.started_at.desc()).limit(8)).all()
    name_by_id = {d.id: d.name for d in datasets}
    all_completed = db.scalars(select(MonitoringRun).where(MonitoringRun.status == "completed").order_by(MonitoringRun.started_at.desc()).limit(12)).all()
    quality_trend = [
        {"run_id": r.id, "label": (name_by_id.get(r.dataset_id, "Dataset")[:18]),
         "timestamp": _stamp(r.completed_at or r.started_at), "quality_score": (r.summary or {}).get("quality_score"),
         "dataset_name": name_by_id.get(r.dataset_id, "Dataset")}
        for r in reversed(all_completed)
    ]
    health_rows = []
    drifted_features = 0
    datasets_with_drift = 0
    for dataset in datasets:
        run = latest_map.get(dataset.id)
        summary = (run.summary or {}) if run else {}
        drift_count = int(summary.get("drifted_features") or 0)
        drifted_features += drift_count
        datasets_with_drift += int(drift_count > 0)
        health_rows.append({
            "id": dataset.id, "name": dataset.name, "rows": dataset.row_count, "columns": dataset.column_count,
            "quality_score": summary.get("quality_score"), "drift_status": summary.get("drift_status"),
            "last_run_at": _stamp(run.completed_at or run.started_at) if run else None,
            "run_status": run.status if run else "not_monitored",
            "health_status": _dataset_dict(dataset, run)["health_status"],
        })
    failures = db.execute(
        select(ValidationResult, MonitoringRun, Dataset.name)
        .join(MonitoringRun, MonitoringRun.id == ValidationResult.run_id)
        .join(Dataset, Dataset.id == MonitoringRun.dataset_id)
        .where(ValidationResult.passed.is_(False))
        .order_by(ValidationResult.created_at.desc()).limit(6)
    ).all()
    open_alerts = db.scalars(select(Alert).where(Alert.status == "open").order_by(Alert.created_at.desc()).limit(6)).all()
    alert_dataset_map = {d.id: d.name for d in datasets}
    return {
        "kpis": {
            "datasets": len(datasets), "average_quality_score": avg_score,
            "drifted_features": drifted_features, "datasets_with_drift": datasets_with_drift,
            "open_alerts": int(open_alert_count), "active_schedules": int(schedule_count),
            "monitored_datasets": len(completed),
        },
        "quality_trend": quality_trend,
        "dataset_health": health_rows[:10],
        "drift_statistics": {
            "drifted_features": drifted_features, "datasets_with_drift": datasets_with_drift,
            "datasets_checked": len(completed),
        },
        "recent_runs": [_run_dict(r, name_by_id.get(r.dataset_id)) for r in recent_runs],
        "validation_failures": [{
            "id": result.id, "dataset_name": dataset_name, "run_id": run.id,
            "rule_name": result.rule_name, "severity": result.severity, "message": result.message,
            "failed_rows": result.failed_rows, "created_at": _stamp(result.created_at),
        } for result, run, dataset_name in failures],
        "open_alerts_preview": [{
            "id": a.id, "dataset_name": alert_dataset_map.get(a.dataset_id, "Dataset"),
            "source": a.source, "severity": a.severity, "title": a.title,
            "status": a.status, "created_at": _stamp(a.created_at),
        } for a in open_alerts],
    }


@router.get("/datasets", tags=["datasets"])
def list_datasets(q: str | None = None, page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = select(Dataset)
    if q:
        term = f"%{q.strip()}%"
        query = query.where(or_(Dataset.name.ilike(term), Dataset.description.ilike(term)))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    offset, size = _page(page, limit)
    rows = db.scalars(query.order_by(Dataset.created_at.desc()).offset(offset).limit(size)).all()
    latest = _latest_runs(db, [d.id for d in rows])
    return {"items": [_dataset_dict(d, latest.get(d.id)) for d in rows], "page": page, "limit": limit, "total": int(total)}


@router.post("/datasets", tags=["datasets"], status_code=201)
def create_dataset(payload: DatasetCreate, db: Session = Depends(get_db)):
    dataset = Dataset(name=payload.name.strip(), description=payload.description.strip())
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return _dataset_dict(dataset)


@router.post("/datasets/upload", tags=["datasets"], status_code=201)
async def upload_dataset(
    file: UploadFile = File(...),
    dataset_name: str | None = Form(default=None),
    dataset_id: str | None = Form(default=None),
    role: Literal["reference", "current"] = Form(default="reference"),
    description: str = Form(default=""),
    db: Session = Depends(get_db),
):
    original = (file.filename or "upload.csv").replace("\\", "/").split("/")[-1]
    if Path(original).suffix.lower() != ".csv":
        raise HTTPException(status_code=415, detail="Only .csv uploads are accepted")
    content = await file.read(settings.max_upload_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty")
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"Upload exceeds the {settings.max_upload_mb} MB file-size limit")
    try:
        decoded = content.decode("utf-8-sig")
        header = next(csv.reader(io.StringIO(decoded)), [])
        if not header or not any(str(x).strip() for x in header):
            raise ValueError("CSV header row is missing")
        if len(header) > 500:
            raise ValueError("CSV contains more than 500 columns")
        normalized = [str(x).strip() for x in header]
        if len(normalized) != len(set(normalized)):
            raise ValueError("CSV has duplicate column names; rename them before upload")
        frame = pd.read_csv(io.BytesIO(content), low_memory=False)
        if frame.empty and len(frame.columns) == 0:
            raise ValueError("CSV must contain a header row")
        if frame.columns.empty:
            raise ValueError("CSV must contain at least one column")
    except (UnicodeDecodeError, pd.errors.ParserError, pd.errors.EmptyDataError, StopIteration, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {str(exc)[:300]}") from exc
    except Exception as exc:
        logger.exception("csv_upload_parse_failed")
        raise HTTPException(status_code=400, detail=f"Unable to read CSV: {type(exc).__name__}: {str(exc)[:250]}") from exc

    dataset = db.get(Dataset, dataset_id) if dataset_id else None
    if dataset_id and not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not dataset:
        if not dataset_name or len(dataset_name.strip()) < 2:
            raise HTTPException(status_code=422, detail="dataset_name is required when creating a dataset")
        dataset = Dataset(name=dataset_name.strip()[:180], description=description.strip()[:4000])
        db.add(dataset)
        db.flush()
    safe_name = re.sub(r"[^A-Za-z0-9._ -]", "_", original)[:120] or "data.csv"
    upload_dir = settings.upload_dir.resolve()
    upload_dir.mkdir(parents=True, exist_ok=True)
    generated_path = (upload_dir / f"{uuid4().hex}.csv").resolve()
    try:
        generated_path.relative_to(upload_dir)
        generated_path.write_bytes(content)
        if role == "reference":
            dataset.reference_path = str(generated_path)
            dataset.reference_filename = safe_name
        else:
            dataset.current_path = str(generated_path)
            dataset.current_filename = safe_name
        dataset.row_count = int(len(frame))
        dataset.column_count = int(len(frame.columns))
        dataset.updated_at = utcnow()
        persist_profiles(db, dataset.id, role, frame)
        if role == "reference":
            seed_default_rules(db, dataset, frame)
        db.commit()
        db.refresh(dataset)
        latest = db.scalars(select(MonitoringRun).where(MonitoringRun.dataset_id == dataset.id).order_by(MonitoringRun.started_at.desc()).limit(1)).first()
        return {**_dataset_dict(dataset, latest), "uploaded_role": role, "uploaded_filename": safe_name,
                "uploaded_rows": int(len(frame)), "uploaded_columns": int(len(frame.columns))}
    except Exception:
        db.rollback()
        try:
            generated_path.unlink(missing_ok=True)
        except Exception:
            logger.exception("upload_cleanup_failed")
        raise


@router.get("/datasets/{dataset_id}", tags=["datasets"])
def get_dataset(dataset_id: str, db: Session = Depends(get_db)):
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    latest = db.scalars(select(MonitoringRun).where(MonitoringRun.dataset_id == dataset.id).order_by(MonitoringRun.started_at.desc()).limit(1)).first()
    return _dataset_dict(dataset, latest)


@router.delete("/datasets/{dataset_id}", tags=["datasets"], status_code=204)
def delete_dataset(dataset_id: str, db: Session = Depends(get_db)):
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    paths = {p for p in (dataset.reference_path, dataset.current_path) if p}
    db.delete(dataset)
    db.commit()
    for value in paths:
        try:
            safe_file_path(value).unlink(missing_ok=True)
        except (ValueError, FileNotFoundError):
            pass
    return Response(status_code=204)


@router.get("/datasets/{dataset_id}/profiles", tags=["datasets"])
def dataset_profiles(dataset_id: str, db: Session = Depends(get_db)):
    if not db.get(Dataset, dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    rows = db.scalars(select(ColumnProfile).where(ColumnProfile.dataset_id == dataset_id).order_by(ColumnProfile.column_name, ColumnProfile.profile_type)).all()
    return {"items": [{
        "id": p.id, "dataset_id": p.dataset_id, "profile_type": p.profile_type,
        "column_name": p.column_name, "inferred_type": p.inferred_type,
        "row_count": p.row_count, "null_count": p.null_count, "unique_count": p.unique_count,
        "null_rate": p.null_rate, "mean": p.mean, "minimum": p.minimum, "maximum": p.maximum,
        "top_values": p.top_values,
    } for p in rows]}


@router.get("/datasets/{dataset_id}/preview", tags=["datasets"])
def dataset_preview(
    dataset_id: str, role: Literal["reference", "current"] = "current",
    q: str | None = None, page: int = Query(1, ge=1), limit: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    path = dataset.current_path if role == "current" else dataset.reference_path
    if not path:
        raise HTTPException(status_code=404, detail=f"No {role} CSV has been uploaded")
    try:
        frame = read_dataset(path)
    except (ValueError, FileNotFoundError, pd.errors.ParserError) as exc:
        raise HTTPException(status_code=409, detail=f"Unable to preview dataset: {str(exc)}") from exc
    if q:
        needle = q.strip().lower()
        mask = frame.astype("string").apply(lambda column: column.str.contains(needle, case=False, na=False, regex=False)).any(axis=1)
        frame = frame.loc[mask]
    total = int(len(frame))
    offset, size = _page(page, limit)
    rows = [[_clean_cell(value) for value in row] for row in frame.iloc[offset:offset + size].itertuples(index=False, name=None)]
    return {"dataset_id": dataset_id, "role": role, "columns": [str(c) for c in frame.columns], "rows": rows,
            "page": page, "limit": limit, "total": total, "filtered": bool(q)}


@router.get("/datasets/{dataset_id}/rules", tags=["quality"])
def list_rules(dataset_id: str, db: Session = Depends(get_db)):
    if not db.get(Dataset, dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    rules = db.scalars(select(ValidationRule).where(ValidationRule.dataset_id == dataset_id).order_by(ValidationRule.created_at)).all()
    return {"items": [_rule_dict(r) for r in rules]}


def _rule_dict(rule: ValidationRule) -> dict:
    return {"id": rule.id, "dataset_id": rule.dataset_id, "name": rule.name, "rule_type": rule.rule_type,
            "config": rule.config, "severity": rule.severity, "enabled": rule.enabled, "created_at": _stamp(rule.created_at)}


@router.post("/datasets/{dataset_id}/rules", tags=["quality"], status_code=201)
def create_rule(dataset_id: str, payload: RuleCreate, db: Session = Depends(get_db)):
    if not db.get(Dataset, dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    rule = ValidationRule(dataset_id=dataset_id, name=payload.name.strip(), rule_type=payload.rule_type,
                         config=payload.config, severity=payload.severity, enabled=payload.enabled)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_dict(rule)


@router.put("/rules/{rule_id}", tags=["quality"])
def update_rule(rule_id: str, payload: RuleUpdate, db: Session = Depends(get_db)):
    rule = db.get(ValidationRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Validation rule not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(rule, field, value.strip() if field == "name" else value)
    db.commit()
    db.refresh(rule)
    return _rule_dict(rule)


@router.delete("/rules/{rule_id}", tags=["quality"], status_code=204)
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.get(ValidationRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Validation rule not found")
    db.delete(rule)
    db.commit()
    return Response(status_code=204)


def _latest_run_for_dataset(db: Session, dataset_id: str) -> MonitoringRun | None:
    return db.scalars(select(MonitoringRun).where(MonitoringRun.dataset_id == dataset_id).order_by(MonitoringRun.started_at.desc()).limit(1)).first()


@router.get("/quality", tags=["quality"])
def quality_results(dataset_id: str | None = None, db: Session = Depends(get_db)):
    if dataset_id and not db.get(Dataset, dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    if dataset_id:
        datasets = [db.get(Dataset, dataset_id)]
    else:
        datasets = db.scalars(select(Dataset).order_by(Dataset.name)).all()
    items = []
    for dataset in datasets:
        run = _latest_run_for_dataset(db, dataset.id)
        results = db.scalars(select(ValidationResult).where(ValidationResult.run_id == run.id).order_by(ValidationResult.created_at)) .all() if run else []
        items.append({
            "dataset_id": dataset.id, "dataset_name": dataset.name,
            "run": _run_dict(run, dataset.name) if run else None,
            "score": (run.summary or {}).get("quality_score") if run else None,
            "score_formula": "100 × (1 − weighted mean failed-row fraction); severity weights critical=4, high=3, medium=2, low=1.",
            "checks": [{"id": x.id, "rule_id": x.rule_id, "rule_name": x.rule_name, "rule_type": x.rule_type,
                        "severity": x.severity, "passed": x.passed, "failed_rows": x.failed_rows,
                        "total_rows": x.total_rows, "message": x.message, "observed": x.observed,
                        "expected": x.expected} for x in results],
        })
    return {"items": items}


@router.get("/drift", tags=["drift"])
def drift_results(dataset_id: str | None = None, db: Session = Depends(get_db)):
    if dataset_id and not db.get(Dataset, dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    datasets = [db.get(Dataset, dataset_id)] if dataset_id else db.scalars(select(Dataset).order_by(Dataset.name)).all()
    items = []
    for dataset in datasets:
        run = _latest_run_for_dataset(db, dataset.id)
        drift_run = db.scalar(select(DriftRun).where(DriftRun.run_id == run.id)) if run else None
        features = db.scalars(select(FeatureDriftResult).where(FeatureDriftResult.drift_run_id == drift_run.id).order_by(FeatureDriftResult.feature_name)).all() if drift_run else []
        items.append({
            "dataset_id": dataset.id, "dataset_name": dataset.name,
            "run": _run_dict(run, dataset.name) if run else None,
            "status": drift_run.overall_status if drift_run else "not_run",
            "features_checked": drift_run.features_checked if drift_run else 0,
            "features_drifted": drift_run.features_drifted if drift_run else 0,
            "engine": drift_run.engine if drift_run else None,
            "thresholds": drift_run.thresholds if drift_run else {},
            "adapter": drift_run.details if drift_run else {},
            "features": [{"id": f.id, "feature_name": f.feature_name, "feature_type": f.feature_type,
                          "status": f.status, "drifted": f.drifted, "score": f.score,
                          "threshold": f.threshold, "missing_reference": f.missing_reference,
                          "missing_current": f.missing_current, "details": f.details} for f in features],
        })
    return {"items": items}


@router.get("/schema-changes", tags=["schema"])
def list_schema_changes(
    dataset_id: str | None = None, acknowledged: bool | None = None, severity: str | None = None,
    q: str | None = None, page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = select(SchemaChange)
    if dataset_id:
        query = query.where(SchemaChange.dataset_id == dataset_id)
    if acknowledged is True:
        query = query.where(SchemaChange.acknowledged_at.is_not(None))
    elif acknowledged is False:
        query = query.where(SchemaChange.acknowledged_at.is_(None))
    if severity:
        query = query.where(SchemaChange.severity == severity)
    if q:
        term = f"%{q.strip()}%"
        query = query.where(or_(SchemaChange.column_name.ilike(term), SchemaChange.kind.ilike(term)))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    offset, size = _page(page, limit)
    rows = db.scalars(query.order_by(SchemaChange.created_at.desc()).offset(offset).limit(size)).all()
    names = {d.id: d.name for d in db.scalars(select(Dataset)).all()}
    return {"items": [{"id": x.id, "dataset_id": x.dataset_id, "dataset_name": names.get(x.dataset_id),
                        "run_id": x.run_id, "kind": x.kind, "column_name": x.column_name,
                        "old_value": x.old_value, "new_value": x.new_value, "severity": x.severity,
                        "acknowledged": x.acknowledged_at is not None, "acknowledged_at": _stamp(x.acknowledged_at),
                        "acknowledged_by": x.acknowledged_by, "notes": x.notes, "created_at": _stamp(x.created_at)} for x in rows],
            "page": page, "limit": limit, "total": int(total)}


@router.patch("/schema-changes/{change_id}/acknowledge", tags=["schema"])
def acknowledge_schema_change(change_id: str, payload: SchemaAcknowledge, db: Session = Depends(get_db)):
    change = db.get(SchemaChange, change_id)
    if not change:
        raise HTTPException(status_code=404, detail="Schema change not found")
    change.acknowledged_at = utcnow() if payload.acknowledged else None
    change.acknowledged_by = payload.acknowledged_by if payload.acknowledged else None
    change.notes = payload.notes
    db.commit()
    return {"id": change.id, "acknowledged": change.acknowledged_at is not None, "acknowledged_at": _stamp(change.acknowledged_at), "notes": change.notes}


@router.get("/runs", tags=["monitoring"])
def list_runs(
    dataset_id: str | None = None, status: str | None = None, q: str | None = None,
    page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=100), db: Session = Depends(get_db),
):
    query = select(MonitoringRun)
    if dataset_id:
        query = query.where(MonitoringRun.dataset_id == dataset_id)
    if status:
        query = query.where(MonitoringRun.status == status)
    if q:
        term = f"%{q.strip()}%"
        query = query.join(Dataset, Dataset.id == MonitoringRun.dataset_id).where(or_(Dataset.name.ilike(term), MonitoringRun.id.ilike(term)))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    offset, size = _page(page, limit)
    rows = db.scalars(query.order_by(MonitoringRun.started_at.desc()).offset(offset).limit(size)).all()
    names = {d.id: d.name for d in db.scalars(select(Dataset)).all()}
    return {"items": [_run_dict(run, names.get(run.dataset_id)) for run in rows], "page": page, "limit": limit, "total": int(total)}


@router.post("/runs", tags=["monitoring"], status_code=201)
def trigger_run(payload: RunCreate, db: Session = Depends(get_db)):
    if not db.get(Dataset, payload.dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    run = run_monitoring(db, payload.dataset_id, payload.trigger_type)
    dataset = db.get(Dataset, payload.dataset_id)
    return _run_dict(run, dataset.name if dataset else None)


@router.get("/runs/{run_id}", tags=["monitoring"])
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(MonitoringRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Monitoring run not found")
    dataset = db.get(Dataset, run.dataset_id)
    validations = db.scalars(select(ValidationResult).where(ValidationResult.run_id == run_id).order_by(ValidationResult.created_at)).all()
    drift = db.scalar(select(DriftRun).where(DriftRun.run_id == run_id))
    features = db.scalars(select(FeatureDriftResult).where(FeatureDriftResult.drift_run_id == drift.id).order_by(FeatureDriftResult.feature_name)).all() if drift else []
    changes = db.scalars(select(SchemaChange).where(SchemaChange.run_id == run_id).order_by(SchemaChange.created_at)).all()
    alerts = db.scalars(select(Alert).where(Alert.run_id == run_id).order_by(Alert.created_at)).all()
    return {
        "run": _run_dict(run, dataset.name if dataset else None),
        "quality": {"score": (run.summary or {}).get("quality_score"), "checks": [{
            "id": x.id, "rule_name": x.rule_name, "rule_type": x.rule_type, "severity": x.severity,
            "passed": x.passed, "failed_rows": x.failed_rows, "total_rows": x.total_rows,
            "message": x.message, "observed": x.observed, "expected": x.expected,
        } for x in validations]},
        "drift": ({"status": drift.overall_status, "features_checked": drift.features_checked,
                   "features_drifted": drift.features_drifted, "engine": drift.engine,
                   "thresholds": drift.thresholds, "adapter": drift.details,
                   "features": [{"feature_name": f.feature_name, "feature_type": f.feature_type,
                                 "status": f.status, "drifted": f.drifted, "score": f.score,
                                 "threshold": f.threshold, "missing_reference": f.missing_reference,
                                 "missing_current": f.missing_current, "details": f.details} for f in features]} if drift else None),
        "schema_changes": [{"id": x.id, "kind": x.kind, "column_name": x.column_name, "old_value": x.old_value,
                            "new_value": x.new_value, "severity": x.severity, "acknowledged": x.acknowledged_at is not None} for x in changes],
        "alerts": [{"id": x.id, "source": x.source, "severity": x.severity, "title": x.title,
                    "trigger_reason": x.trigger_reason, "status": x.status, "created_at": _stamp(x.created_at)} for x in alerts],
    }


@router.get("/runs/{run_id}/reports/{fmt}", tags=["reports"])
def download_run_report(run_id: str, fmt: str, db: Session = Depends(get_db)):
    try:
        report = create_report(db, run_id, fmt)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 422, detail=str(exc)) from exc
    content, media_type = serialize_report(report)
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{report.filename}"', "X-Report-ID": report.id})


@router.get("/alerts", tags=["alerts"])
def list_alerts(
    status: str | None = None, severity: str | None = None, source: str | None = None,
    dataset_id: str | None = None, q: str | None = None,
    page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=100), db: Session = Depends(get_db),
):
    query = select(Alert)
    if status:
        if status not in {"open", "acknowledged", "resolved"}:
            raise HTTPException(status_code=422, detail="status must be open, acknowledged, or resolved")
        query = query.where(Alert.status == status)
    if severity:
        query = query.where(Alert.severity == severity)
    if source:
        query = query.where(Alert.source == source)
    if dataset_id:
        query = query.where(Alert.dataset_id == dataset_id)
    if q:
        term = f"%{q.strip()}%"
        query = query.where(or_(Alert.title.ilike(term), Alert.trigger_reason.ilike(term)))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    offset, size = _page(page, limit)
    rows = db.scalars(query.order_by(Alert.created_at.desc()).offset(offset).limit(size)).all()
    names = {d.id: d.name for d in db.scalars(select(Dataset)).all()}
    return {"items": [{"id": a.id, "dataset_id": a.dataset_id, "dataset_name": names.get(a.dataset_id),
                        "run_id": a.run_id, "source": a.source, "severity": a.severity, "title": a.title,
                        "trigger_reason": a.trigger_reason, "status": a.status, "dedupe_key": a.dedupe_key,
                        "notes": a.notes, "acknowledged_at": _stamp(a.acknowledged_at),
                        "resolved_at": _stamp(a.resolved_at), "created_at": _stamp(a.created_at)} for a in rows],
            "page": page, "limit": limit, "total": int(total)}


@router.patch("/alerts/{alert_id}", tags=["alerts"])
def update_alert(alert_id: str, payload: AlertAction, db: Session = Depends(get_db)):
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if payload.action == "acknowledge":
        alert.status = "acknowledged"
        alert.acknowledged_at = utcnow()
    elif payload.action == "resolve":
        alert.status = "resolved"
        alert.resolved_at = utcnow()
    else:
        alert.status = "open"
        alert.acknowledged_at = None
        alert.resolved_at = None
    if payload.notes is not None:
        alert.notes = payload.notes
    db.commit()
    return {"id": alert.id, "status": alert.status, "acknowledged_at": _stamp(alert.acknowledged_at),
            "resolved_at": _stamp(alert.resolved_at), "notes": alert.notes}


@router.get("/reports", tags=["reports"])
def list_reports(dataset_id: str | None = None, fmt: str | None = None,
                page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=100), db: Session = Depends(get_db)):
    query = select(Report).join(MonitoringRun, MonitoringRun.id == Report.run_id)
    if dataset_id:
        query = query.where(MonitoringRun.dataset_id == dataset_id)
    if fmt:
        query = query.where(Report.format == fmt)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    offset, size = _page(page, limit)
    rows = db.scalars(query.order_by(Report.created_at.desc()).offset(offset).limit(size)).all()
    run_ids = list({r.run_id for r in rows})
    runs = {r.id: r for r in db.scalars(select(MonitoringRun).where(MonitoringRun.id.in_(run_ids))).all()} if run_ids else {}
    datasets = {d.id: d for d in db.scalars(select(Dataset)).all()}
    return {"items": [{"id": r.id, "run_id": r.run_id, "dataset_id": runs[r.run_id].dataset_id if r.run_id in runs else None,
                        "dataset_name": datasets[runs[r.run_id].dataset_id].name if r.run_id in runs and runs[r.run_id].dataset_id in datasets else None,
                        "format": r.format, "filename": r.filename, "created_at": _stamp(r.created_at)} for r in rows],
            "page": page, "limit": limit, "total": int(total)}


@router.get("/reports/{report_id}/download", tags=["reports"])
def download_report(report_id: str, db: Session = Depends(get_db)):
    report = db.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    content, media_type = serialize_report(report)
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{report.filename}"'})


@router.get("/schedules", tags=["schedules"])
def list_schedules(db: Session = Depends(get_db)):
    rows = db.scalars(select(Schedule).order_by(Schedule.created_at.desc())).all()
    names = {d.id: d.name for d in db.scalars(select(Dataset)).all()}
    return {"items": [{"id": s.id, "dataset_id": s.dataset_id, "dataset_name": names.get(s.dataset_id),
                        "name": s.name, "interval_minutes": s.interval_minutes, "active": s.active,
                        "last_run_at": _stamp(s.last_run_at), "created_at": _stamp(s.created_at)} for s in rows]}


@router.post("/schedules", tags=["schedules"], status_code=201)
def create_schedule(payload: ScheduleCreate, db: Session = Depends(get_db)):
    if not db.get(Dataset, payload.dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    schedule = Schedule(dataset_id=payload.dataset_id, name=payload.name.strip(),
                        interval_minutes=payload.interval_minutes, active=payload.active)
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    sync_schedule(schedule)
    dataset = db.get(Dataset, schedule.dataset_id)
    return {"id": schedule.id, "dataset_id": schedule.dataset_id, "dataset_name": dataset.name if dataset else None,
            "name": schedule.name, "interval_minutes": schedule.interval_minutes, "active": schedule.active,
            "last_run_at": _stamp(schedule.last_run_at), "created_at": _stamp(schedule.created_at)}


@router.patch("/schedules/{schedule_id}", tags=["schedules"])
def update_schedule(schedule_id: str, payload: ScheduleUpdate, db: Session = Depends(get_db)):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(schedule, field, value.strip() if field == "name" else value)
    db.commit()
    db.refresh(schedule)
    sync_schedule(schedule)
    return {"id": schedule.id, "dataset_id": schedule.dataset_id, "name": schedule.name,
            "interval_minutes": schedule.interval_minutes, "active": schedule.active,
            "last_run_at": _stamp(schedule.last_run_at)}


@router.delete("/schedules/{schedule_id}", tags=["schedules"], status_code=204)
def delete_schedule(schedule_id: str, db: Session = Depends(get_db)):
    schedule = db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    remove_schedule(schedule.id)
    db.delete(schedule)
    db.commit()
    return Response(status_code=204)


@router.get("/settings", tags=["settings"])
def get_settings(db: Session = Depends(get_db)):
    keys = {
        "alert_quality_threshold": settings.alert_quality_threshold,
        "numeric_drift_threshold": settings.numeric_drift_threshold,
        "categorical_drift_threshold": settings.categorical_drift_threshold,
        "missing_drift_threshold": settings.missing_drift_threshold,
    }
    for key in list(keys):
        record = db.get(AppSetting, key)
        if record and isinstance(record.value, dict) and "value" in record.value:
            keys[key] = record.value["value"]
    connected, error = check_connection()
    return {**keys, "database_kind": settings.database_kind, "database_connected": connected,
            "database_error": error, "upload_limit_mb": settings.max_upload_mb,
            "email_configured": bool(settings.smtp_host and settings.smtp_from and settings.alert_email_to),
            "scheduler": "APScheduler"}


@router.patch("/settings", tags=["settings"])
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    values = payload.model_dump(exclude_unset=True)
    for key, value in values.items():
        if value is None:
            continue
        record = db.get(AppSetting, key)
        if record:
            record.value = {"value": value}
            record.updated_at = utcnow()
        else:
            db.add(AppSetting(key=key, value={"value": value}))
    db.commit()
    return get_settings(db)


app.include_router(router)


@app.get("/", include_in_schema=False)
def root():
    return {"service": "QualityLens API", "api": "/api/v1", "docs": "/docs", "health": "/api/v1/health"}
