from __future__ import annotations

import csv
import html
import io
import json
import logging
import smtplib
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.engine import (
    GreatExpectationsAdapter,
    analyze_drift,
    calculate_quality_score,
    infer_type,
    profile_dataframe,
    schema_diff,
    validate_rules,
)
from app.models import (
    Alert,
    AppSetting,
    ColumnProfile,
    Dataset,
    DriftRun,
    FeatureDriftResult,
    MonitoringRun,
    Report,
    SchemaChange,
    ValidationResult,
    ValidationRule,
)

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_file_path(path_value: str) -> Path:
    path = Path(path_value).resolve()
    root = settings.upload_dir.resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Dataset file path is outside the configured upload directory") from exc
    if not path.is_file():
        raise FileNotFoundError("Dataset file is missing from managed storage")
    return path


def read_dataset(path_value: str) -> pd.DataFrame:
    path = safe_file_path(path_value)
    try:
        return pd.read_csv(path, low_memory=False)
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding="utf-8-sig", low_memory=False)


def persist_profiles(db: Session, dataset_id: str, profile_type: str, frame: pd.DataFrame) -> None:
    db.execute(delete(ColumnProfile).where(
        ColumnProfile.dataset_id == dataset_id,
        ColumnProfile.profile_type == profile_type,
    ))
    rows = profile_dataframe(frame, profile_type)
    for row in rows:
        db.add(ColumnProfile(dataset_id=dataset_id, **row))


def seed_default_rules(db: Session, dataset: Dataset, reference: pd.DataFrame) -> None:
    if db.scalar(select(ValidationRule.id).where(ValidationRule.dataset_id == dataset.id).limit(1)):
        return
    types: dict[str, str] = {}
    dates: dict[str, None] = {}
    for column in reference.columns:
        kind = infer_type(reference[column])
        types[str(column)] = kind
        if kind == "datetime":
            dates[str(column)] = None
    defaults = [
        ValidationRule(dataset_id=dataset.id, name="Required reference columns", rule_type="required_columns",
                       config={"columns": [str(c) for c in reference.columns]}, severity="high", enabled=True),
        ValidationRule(dataset_id=dataset.id, name="Null rate threshold", rule_type="null_threshold",
                       config={"threshold": 0.05}, severity="high", enabled=True),
        ValidationRule(dataset_id=dataset.id, name="Duplicate row check", rule_type="duplicate_check",
                       config={}, severity="medium", enabled=True),
        ValidationRule(dataset_id=dataset.id, name="Reference data types", rule_type="data_types",
                       config={"columns": types}, severity="medium", enabled=True),
        ValidationRule(dataset_id=dataset.id, name="Minimum row count", rule_type="row_count",
                       config={"min": 1}, severity="high", enabled=True),
    ]
    if dates:
        defaults.append(ValidationRule(dataset_id=dataset.id, name="Date field validation", rule_type="date_validation",
                                       config={"columns": dates}, severity="medium", enabled=True))
    db.add_all(defaults)


def _setting(db: Session, key: str, env_default: float) -> float:
    record = db.get(AppSetting, key)
    if record and isinstance(record.value, dict) and "value" in record.value:
        try:
            return float(record.value["value"])
        except (TypeError, ValueError):
            pass
    return env_default


def _email_alert(alert: Alert, dataset: Dataset) -> None:
    if not (settings.smtp_host and settings.smtp_from and settings.alert_email_to):
        return
    try:
        message = EmailMessage()
        message["Subject"] = f"[QualityLens {alert.severity.upper()}] {alert.title}"
        message["From"] = settings.smtp_from
        message["To"] = settings.alert_email_to
        message.set_content(
            f"Dataset: {dataset.name}\nSeverity: {alert.severity}\n"
            f"Reason: {alert.trigger_reason}\nCreated: {alert.created_at.isoformat()}\n"
            f"Run ID: {alert.run_id or 'n/a'}\n"
        )
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=8) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password or "")
            smtp.send_message(message)
        logger.info("alert_email_sent", extra={"alert_id": alert.id, "dataset_id": dataset.id})
    except Exception:
        logger.exception("alert_email_delivery_failed", extra={"alert_id": alert.id})


def _create_alert(db: Session, dataset: Dataset, run: MonitoringRun, source: str,
                  severity: str, title: str, reason: str, dedupe_key: str) -> Alert | None:
    existing = db.scalar(select(Alert).where(
        Alert.dataset_id == dataset.id,
        Alert.dedupe_key == dedupe_key,
        Alert.status.in_(["open", "acknowledged"]),
    ).limit(1))
    if existing:
        return None
    alert = Alert(dataset_id=dataset.id, run_id=run.id, source=source,
                  severity=severity, title=title, trigger_reason=reason,
                  dedupe_key=dedupe_key, status="open")
    db.add(alert)
    db.flush()
    _email_alert(alert, dataset)
    return alert


def _run_payload(db: Session, run_id: str) -> dict[str, Any]:
    run = db.get(MonitoringRun, run_id)
    if not run:
        raise ValueError("Monitoring run not found")
    dataset = db.get(Dataset, run.dataset_id)
    validations = db.scalars(select(ValidationResult).where(ValidationResult.run_id == run_id).order_by(ValidationResult.created_at)).all()
    drift_run = db.scalar(select(DriftRun).where(DriftRun.run_id == run_id))
    features = db.scalars(select(FeatureDriftResult).where(FeatureDriftResult.drift_run_id == drift_run.id)).all() if drift_run else []
    changes = db.scalars(select(SchemaChange).where(SchemaChange.run_id == run_id)).all()
    alerts = db.scalars(select(Alert).where(Alert.run_id == run_id)).all()
    return {
        "report_version": "1.0",
        "generated_at": now_utc().isoformat(),
        "dataset": {"id": dataset.id, "name": dataset.name} if dataset else {"id": run.dataset_id},
        "run": {
            "id": run.id, "status": run.status, "trigger_type": run.trigger_type,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "duration_ms": run.duration_ms, "error": run.error,
            "summary": run.summary or {},
        },
        "quality": {
            "score": (run.summary or {}).get("quality_score"),
            "score_formula": "100 × (1 − weighted mean of per-rule failed-row fractions); severity weights critical=4, high=3, medium=2, low=1.",
            "checks": [{
                "name": x.rule_name, "type": x.rule_type, "severity": x.severity,
                "passed": x.passed, "failed_rows": x.failed_rows, "total_rows": x.total_rows,
                "message": x.message, "observed": x.observed, "expected": x.expected,
            } for x in validations],
        },
        "drift": ({
            "status": drift_run.overall_status, "features_checked": drift_run.features_checked,
            "features_drifted": drift_run.features_drifted, "engine": drift_run.engine,
            "thresholds": drift_run.thresholds, "adapter": drift_run.details,
            "features": [{
                "feature": f.feature_name, "type": f.feature_type, "status": f.status,
                "drifted": f.drifted, "score": f.score, "threshold": f.threshold,
                "missing_reference": f.missing_reference, "missing_current": f.missing_current,
                "details": f.details,
            } for f in features],
        } if drift_run else None),
        "schema_changes": [{
            "kind": c.kind, "column": c.column_name, "old_value": c.old_value,
            "new_value": c.new_value, "severity": c.severity,
            "acknowledged_at": c.acknowledged_at.isoformat() if c.acknowledged_at else None,
            "notes": c.notes,
        } for c in changes],
        "alerts": [{
            "id": a.id, "source": a.source, "severity": a.severity,
            "title": a.title, "reason": a.trigger_reason, "status": a.status,
            "created_at": a.created_at.isoformat(), "notes": a.notes,
        } for a in alerts],
    }


def run_monitoring(db: Session, dataset_id: str, trigger_type: str = "manual") -> MonitoringRun:
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise ValueError("Dataset not found")
    started_clock = time.perf_counter()
    run = MonitoringRun(dataset_id=dataset.id, status="running", trigger_type=trigger_type, started_at=now_utc(), summary={})
    db.add(run)
    db.commit()
    run_id = run.id
    try:
        if not dataset.reference_path:
            raise ValueError("This dataset has no reference CSV. Upload a reference file before monitoring.")
        if not dataset.current_path:
            raise ValueError("This dataset has no current CSV. Upload a current file before monitoring.")
        reference = read_dataset(dataset.reference_path)
        current = read_dataset(dataset.current_path)
        rules = db.scalars(select(ValidationRule).where(
            ValidationRule.dataset_id == dataset.id, ValidationRule.enabled.is_(True)
        ).order_by(ValidationRule.created_at)).all()
        rule_inputs = [{"id": r.id, "name": r.name, "rule_type": r.rule_type, "config": r.config,
                        "severity": r.severity} for r in rules]
        validations = validate_rules(current, rule_inputs)
        quality_score = calculate_quality_score(validations)
        ge_info = GreatExpectationsAdapter.inspect(current)
        changes = schema_diff(reference, current)
        drift_result = analyze_drift(reference, current, {
            "numeric": _setting(db, "numeric_drift_threshold", settings.numeric_drift_threshold),
            "categorical": _setting(db, "categorical_drift_threshold", settings.categorical_drift_threshold),
            "missing": _setting(db, "missing_drift_threshold", settings.missing_drift_threshold),
        })
        for item in validations:
            db.add(ValidationResult(
                run_id=run_id, rule_id=item.get("rule_id"), rule_name=item["rule_name"],
                rule_type=item["rule_type"], severity=item["severity"], passed=item["passed"],
                failed_rows=item["failed_rows"], total_rows=item["total_rows"],
                message=item["message"], observed=item["observed"], expected=item["expected"],
            ))
        drift_run = DriftRun(
            run_id=run_id, overall_status=drift_result["overall_status"],
            features_checked=drift_result["features_checked"], features_drifted=drift_result["features_drifted"],
            engine=drift_result["engine"], thresholds=drift_result["thresholds"],
            details={"adapter": drift_result["adapter"]},
        )
        db.add(drift_run)
        db.flush()
        for feature in drift_result["features"]:
            db.add(FeatureDriftResult(
                drift_run_id=drift_run.id, feature_name=feature["feature_name"],
                feature_type=feature["feature_type"], status=feature["status"], drifted=feature["drifted"],
                score=feature["score"], threshold=feature["threshold"],
                missing_reference=feature["missing_reference"], missing_current=feature["missing_current"],
                details=feature["details"],
            ))
        for change in changes:
            db.add(SchemaChange(dataset_id=dataset.id, run_id=run_id, **change))
        persist_profiles(db, dataset.id, "reference", reference)
        persist_profiles(db, dataset.id, "current", current)
        dataset.row_count = int(len(current))
        dataset.column_count = int(len(current.columns))
        dataset.updated_at = now_utc()
        db.flush()

        for item in validations:
            if not item["passed"] and item["severity"] in {"critical", "high"}:
                _create_alert(db, dataset, run, "data_quality", item["severity"],
                              f"Quality check failed: {item['rule_name']}", item["message"],
                              f"quality:{item.get('rule_id') or item['rule_type']}")
        quality_threshold = _setting(db, "alert_quality_threshold", settings.alert_quality_threshold)
        if quality_score < quality_threshold:
            _create_alert(db, dataset, run, "data_quality", "high", "Quality score below threshold",
                          f"Quality score {quality_score:.2f} is below configured threshold {quality_threshold:.2f}",
                          "quality:score-below-threshold")
        if drift_result["overall_status"] == "detected_drift":
            names = [f["feature_name"] for f in drift_result["features"] if f["drifted"]]
            _create_alert(db, dataset, run, "drift", "high", f"Drift detected in {len(names)} feature(s)",
                          "Distribution or missingness thresholds exceeded: " + ", ".join(names[:20]), "drift:features")
        elif drift_result["overall_status"] == "failed_comparison":
            _create_alert(db, dataset, run, "drift", "medium", "Drift comparison incomplete",
                          "One or more common features had incompatible types; inspect feature-level comparison details.", "drift:comparison-failed")
        for change in changes:
            if change["severity"] in {"critical", "high"}:
                _create_alert(db, dataset, run, "schema", change["severity"],
                              f"Schema {change['kind'].replace('_', ' ')}: {change['column_name']}",
                              f"Old: {change.get('old_value') or '—'}; new: {change.get('new_value') or '—'}",
                              f"schema:{change['kind']}:{change['column_name']}")
        summary = {
            "quality_score": quality_score,
            "checks_total": len(validations),
            "checks_passed": sum(1 for x in validations if x["passed"]),
            "checks_failed": sum(1 for x in validations if not x["passed"]),
            "quality_failures": sum(1 for x in validations if not x["passed"]),
            "drift_status": drift_result["overall_status"],
            "drifted_features": drift_result["features_drifted"],
            "features_checked": drift_result["features_checked"],
            "schema_changes": len(changes),
            "row_count": int(len(current)), "column_count": int(len(current.columns)),
            "engines": {"validation": ge_info, "drift": drift_result["adapter"]},
        }
        run = db.get(MonitoringRun, run_id)
        run.status = "completed"
        run.summary = summary
        run.completed_at = now_utc()
        run.duration_ms = int((time.perf_counter() - started_clock) * 1000)
        db.flush()
        payload = _run_payload(db, run_id)
        db.add(Report(run_id=run_id, format="json", filename=f"qualitylens-{run_id[:8]}.json", payload=payload))
        db.commit()
        logger.info("monitoring_run_completed", extra={"run_id": run_id, "dataset_id": dataset_id, "summary": summary})
        return db.get(MonitoringRun, run_id)
    except Exception as exc:
        db.rollback()
        failed_run = db.get(MonitoringRun, run_id)
        if failed_run:
            failed_run.status = "failed"
            failed_run.error = f"{type(exc).__name__}: {str(exc)[:1200]}"
            failed_run.completed_at = now_utc()
            failed_run.duration_ms = int((time.perf_counter() - started_clock) * 1000)
            db.commit()
            logger.exception("monitoring_run_failed", extra={"run_id": run_id, "dataset_id": dataset_id})
            return db.get(MonitoringRun, run_id)
        raise


def report_content(db: Session, run_id: str) -> dict[str, Any]:
    return _run_payload(db, run_id)


def create_report(db: Session, run_id: str, fmt: str) -> Report:
    if fmt not in {"json", "csv", "html"}:
        raise ValueError("Report format must be json, csv, or html")
    run = db.get(MonitoringRun, run_id)
    if not run:
        raise ValueError("Monitoring run not found")
    payload = _run_payload(db, run_id)
    extension = "html" if fmt == "html" else fmt
    report = Report(run_id=run_id, format=fmt, filename=f"qualitylens-{run_id[:8]}-{now_utc().strftime('%Y%m%dT%H%M%SZ')}.{extension}", payload=payload)
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def serialize_report(report: Report) -> tuple[bytes, str]:
    payload = report.payload or {}
    if report.format == "json":
        return json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8"), "application/json; charset=utf-8"
    if report.format == "csv":
        out = io.StringIO(newline="")
        writer = csv.DictWriter(out, fieldnames=["section", "name", "status", "severity", "score", "details"])
        writer.writeheader()

        def safe_writerow(row: dict[str, Any]) -> None:
            sanitized = {}
            for key, value in row.items():
                if isinstance(value, str) and value.lstrip()[:1] in {"=", "+", "-", "@", "\t", "\r"}:
                    value = "'" + value
                sanitized[key] = value
            writer.writerow(sanitized)
        run = payload.get("run", {})
        safe_writerow({"section": "run", "name": run.get("id"), "status": run.get("status"), "score": payload.get("quality", {}).get("score"), "details": json.dumps(run.get("summary", {}), ensure_ascii=False)})
        for check in payload.get("quality", {}).get("checks", []):
            safe_writerow({"section": "quality", "name": check.get("name"), "status": "passed" if check.get("passed") else "failed", "severity": check.get("severity"), "details": json.dumps(check, ensure_ascii=False)})
        drift = payload.get("drift") or {}
        for feature in drift.get("features", []):
            safe_writerow({"section": "drift", "name": feature.get("feature"), "status": feature.get("status"), "score": feature.get("score"), "details": json.dumps(feature, ensure_ascii=False)})
        for change in payload.get("schema_changes", []):
            safe_writerow({"section": "schema", "name": change.get("column"), "status": change.get("kind"), "severity": change.get("severity"), "details": json.dumps(change, ensure_ascii=False)})
        for alert in payload.get("alerts", []):
            safe_writerow({"section": "alert", "name": alert.get("title"), "status": alert.get("status"), "severity": alert.get("severity"), "details": json.dumps(alert, ensure_ascii=False)})
        return out.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8"
    title = html.escape(f"QualityLens report — {payload.get('dataset', {}).get('name', 'Dataset')}")
    run = payload.get("run", {})
    checks = payload.get("quality", {}).get("checks", [])
    drift = payload.get("drift") or {}
    changes = payload.get("schema_changes", [])
    alerts = payload.get("alerts", [])
    def safe(value: Any) -> str:
        return html.escape(str(value if value is not None else "—"))
    quality_rows = "".join(f"<tr><td>{safe(x.get('name'))}</td><td>{'PASS' if x.get('passed') else 'FAIL'}</td><td>{safe(x.get('severity'))}</td><td>{safe(x.get('failed_rows'))}/{safe(x.get('total_rows'))}</td><td>{safe(x.get('message'))}</td></tr>" for x in checks)
    drift_rows = "".join(f"<tr><td>{safe(x.get('feature'))}</td><td>{safe(x.get('status'))}</td><td>{safe(x.get('score'))}</td></tr>" for x in drift.get("features", []))
    schema_rows = "".join(f"<tr><td>{safe(x.get('kind'))}</td><td>{safe(x.get('column'))}</td><td>{safe(x.get('old_value'))}</td><td>{safe(x.get('new_value'))}</td></tr>" for x in changes)
    alert_rows = "".join(f"<tr><td>{safe(x.get('severity'))}</td><td>{safe(x.get('title'))}</td><td>{safe(x.get('status'))}</td><td>{safe(x.get('reason'))}</td></tr>" for x in alerts)
    content = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title>
<style>body{{font:15px/1.55 system-ui,Segoe UI,sans-serif;max-width:1120px;margin:36px auto;padding:0 20px;color:#172033}}h1{{color:#172554}}h2{{margin-top:34px;border-bottom:1px solid #dbe2ee;padding-bottom:8px}}.kpi{{display:inline-block;background:#f3f6fb;border:1px solid #e1e7f0;border-radius:12px;padding:14px 20px;margin:5px}}table{{width:100%;border-collapse:collapse}}th,td{{padding:9px;border-bottom:1px solid #e4e9f0;text-align:left;vertical-align:top}}th{{background:#f6f8fc}}.muted{{color:#667085}}</style>
<h1>{title}</h1><p class="muted">Run {safe(run.get('id'))} · {safe(run.get('completed_at'))} · {safe(run.get('status'))}</p>
<div class="kpi"><b>Quality</b><br>{safe(payload.get('quality',{}).get('score'))}/100</div><div class="kpi"><b>Drift</b><br>{safe(drift.get('status'))} · {safe(drift.get('features_drifted'))} features</div><div class="kpi"><b>Schema changes</b><br>{len(changes)}</div>
<h2>Quality validation</h2><p>Score: 100 × (1 − weighted mean of per-rule failed-row fractions), with severity weights critical=4, high=3, medium=2, low=1.</p><table><tr><th>Rule</th><th>Status</th><th>Severity</th><th>Rows</th><th>Details</th></tr>{quality_rows}</table>
<h2>Drift analysis</h2><p>Engine: {safe(drift.get('engine'))}; thresholds: {safe(drift.get('thresholds'))}</p><table><tr><th>Feature</th><th>Status</th><th>Score</th></tr>{drift_rows}</table>
<h2>Schema changes</h2><table><tr><th>Change</th><th>Column</th><th>Reference</th><th>Current</th></tr>{schema_rows}</table>
<h2>Alerts</h2><table><tr><th>Severity</th><th>Alert</th><th>Status</th><th>Reason</th></tr>{alert_rows}</table>
</html>"""
    return content.encode("utf-8"), "text/html; charset=utf-8"
