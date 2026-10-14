from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    reference_path: Mapped[str | None] = mapped_column(Text)
    current_path: Mapped[str | None] = mapped_column(Text)
    reference_filename: Mapped[str | None] = mapped_column(String(255))
    current_filename: Mapped[str | None] = mapped_column(String(255))
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    profiles: Mapped[list["ColumnProfile"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")
    rules: Mapped[list["ValidationRule"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")


class ColumnProfile(Base):
    __tablename__ = "column_profiles"
    __table_args__ = (Index("ix_profile_dataset_role_column", "dataset_id", "profile_type", "column_name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    profile_type: Mapped[str] = mapped_column(String(16), nullable=False)  # reference | current
    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    inferred_type: Mapped[str] = mapped_column(String(32), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    null_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unique_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    null_rate: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    mean: Mapped[float | None] = mapped_column(Float)
    minimum: Mapped[str | None] = mapped_column(Text)
    maximum: Mapped[str | None] = mapped_column(Text)
    top_values: Mapped[list | dict] = mapped_column(JSON, default=list, nullable=False)
    dataset: Mapped[Dataset] = relationship(back_populates="profiles")


class ValidationRule(Base):
    __tablename__ = "validation_rules"
    __table_args__ = (Index("ix_rule_dataset_enabled", "dataset_id", "enabled"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    rule_type: Mapped[str] = mapped_column(String(48), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default="medium", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    dataset: Mapped[Dataset] = relationship(back_populates="rules")


class MonitoringRun(Base):
    __tablename__ = "monitoring_runs"
    __table_args__ = (Index("ix_run_dataset_started", "dataset_id", "started_at"), Index("ix_run_status", "status"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="queued", nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(24), default="manual", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class ValidationResult(Base):
    __tablename__ = "validation_results"
    __table_args__ = (Index("ix_validation_run_passed", "run_id", "passed"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("monitoring_runs.id", ondelete="CASCADE"), nullable=False)
    rule_id: Mapped[str | None] = mapped_column(ForeignKey("validation_rules.id", ondelete="SET NULL"))
    rule_name: Mapped[str] = mapped_column(String(160), nullable=False)
    rule_type: Mapped[str] = mapped_column(String(48), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    failed_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    observed: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    expected: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class DriftRun(Base):
    __tablename__ = "drift_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("monitoring_runs.id", ondelete="CASCADE"), nullable=False, unique=True)
    overall_status: Mapped[str] = mapped_column(String(32), nullable=False)
    features_checked: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    features_drifted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    engine: Mapped[str] = mapped_column(String(48), default="statistical_fallback", nullable=False)
    thresholds: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class FeatureDriftResult(Base):
    __tablename__ = "feature_drift_results"
    __table_args__ = (Index("ix_feature_drift_run", "drift_run_id", "drifted"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    drift_run_id: Mapped[str] = mapped_column(ForeignKey("drift_runs.id", ondelete="CASCADE"), nullable=False)
    feature_name: Mapped[str] = mapped_column(String(255), nullable=False)
    feature_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    drifted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    score: Mapped[float | None] = mapped_column(Float)
    threshold: Mapped[float | None] = mapped_column(Float)
    missing_reference: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    missing_current: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class SchemaChange(Base):
    __tablename__ = "schema_changes"
    __table_args__ = (Index("ix_schema_dataset_ack", "dataset_id", "acknowledged_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str] = mapped_column(ForeignKey("monitoring_runs.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(16), default="medium", nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alert_status_created", "status", "created_at"), Index("ix_alert_dataset_dedupe", "dataset_id", "dedupe_key", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("monitoring_runs.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    trigger_reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="open", nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (Index("ix_report_created", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("monitoring_runs.id", ondelete="CASCADE"), nullable=False)
    format: Mapped[str] = mapped_column(String(12), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Schedule(Base):
    __tablename__ = "schedules"
    __table_args__ = (Index("ix_schedule_active", "active"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
