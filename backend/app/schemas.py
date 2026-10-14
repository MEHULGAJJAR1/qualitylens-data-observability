from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RULE_TYPES = {
    "null_threshold", "duplicate_check", "required_columns", "data_types",
    "numeric_ranges", "allowed_values", "unique_identifiers", "date_validation",
    "regex_checks", "row_count",
}


class DatasetCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    description: str = Field(default="", max_length=4000)


class RuleCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    rule_type: str
    config: dict[str, Any] = Field(default_factory=dict)
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    enabled: bool = True

    @field_validator("rule_type")
    @classmethod
    def valid_rule_type(cls, value: str) -> str:
        if value not in RULE_TYPES:
            raise ValueError(f"rule_type must be one of: {', '.join(sorted(RULE_TYPES))}")
        return value

    @field_validator("config")
    @classmethod
    def config_is_bounded(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(str(value)) > 12000:
            raise ValueError("rule configuration is too large")
        return value


class RuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    rule_type: str | None = None
    config: dict[str, Any] | None = None
    severity: Literal["critical", "high", "medium", "low"] | None = None
    enabled: bool | None = None

    @field_validator("rule_type")
    @classmethod
    def valid_rule_type(cls, value: str | None) -> str | None:
        if value is not None and value not in RULE_TYPES:
            raise ValueError(f"rule_type must be one of: {', '.join(sorted(RULE_TYPES))}")
        return value

    @field_validator("config")
    @classmethod
    def config_is_bounded(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and len(str(value)) > 12000:
            raise ValueError("rule configuration is too large")
        return value


class RunCreate(BaseModel):
    dataset_id: str = Field(min_length=1, max_length=36)
    trigger_type: Literal["manual", "scheduled", "api"] = "manual"


class ScheduleCreate(BaseModel):
    dataset_id: str = Field(min_length=1, max_length=36)
    name: str = Field(min_length=2, max_length=160)
    interval_minutes: int = Field(ge=1, le=10080)
    active: bool = True


class ScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    interval_minutes: int | None = Field(default=None, ge=1, le=10080)
    active: bool | None = None


class AlertAction(BaseModel):
    action: Literal["acknowledge", "resolve", "reopen"]
    notes: str | None = Field(default=None, max_length=4000)
    acknowledged_by: str | None = Field(default="local user", max_length=120)


class SchemaAcknowledge(BaseModel):
    acknowledged: bool = True
    notes: str | None = Field(default=None, max_length=2000)
    acknowledged_by: str | None = Field(default="local user", max_length=120)


class SettingsUpdate(BaseModel):
    alert_quality_threshold: float | None = Field(default=None, ge=0, le=100)
    numeric_drift_threshold: float | None = Field(default=None, gt=0, le=10)
    categorical_drift_threshold: float | None = Field(default=None, gt=0, le=1)
    missing_drift_threshold: float | None = Field(default=None, gt=0, le=1)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
