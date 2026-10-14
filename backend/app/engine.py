from __future__ import annotations

import difflib
import json
import logging
import math
import re
from typing import Any

import numpy as np
import pandas as pd
from pandas.api import types as ptypes

logger = logging.getLogger(__name__)

SEVERITY_WEIGHTS = {"critical": 4.0, "high": 3.0, "medium": 2.0, "low": 1.0}


def _json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return None if not math.isfinite(float(value)) else float(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if pd.isna(value):
        return None
    return str(value) if not isinstance(value, (str, int, bool)) else value


def infer_type(series: pd.Series) -> str:
    if ptypes.is_bool_dtype(series.dtype):
        return "boolean"
    if ptypes.is_integer_dtype(series.dtype):
        return "integer"
    if ptypes.is_float_dtype(series.dtype) or ptypes.is_numeric_dtype(series.dtype):
        return "numeric"
    if ptypes.is_datetime64_any_dtype(series.dtype):
        return "datetime"
    values = series.dropna()
    if values.empty:
        return "string"
    sample = values.astype(str).head(300)
    parsed_numeric = pd.to_numeric(sample, errors="coerce")
    if parsed_numeric.notna().mean() >= 0.92:
        return "integer" if np.all(np.isclose(parsed_numeric.dropna() % 1, 0)) else "numeric"
    try:
        parsed_dates = pd.to_datetime(sample, errors="coerce", format="mixed", utc=True)
        if parsed_dates.notna().mean() >= 0.90:
            return "datetime"
    except (ValueError, TypeError, OverflowError):
        pass
    ratio = values.nunique(dropna=True) / max(1, len(values))
    return "categorical" if values.nunique(dropna=True) <= 30 or ratio <= 0.12 else "string"


def profile_dataframe(df: pd.DataFrame, profile_type: str) -> list[dict[str, Any]]:
    row_count = int(len(df))
    profiles: list[dict[str, Any]] = []
    for column in df.columns:
        series = df[column]
        null_count = int(series.isna().sum())
        numeric = pd.to_numeric(series, errors="coerce")
        numeric_values = numeric.dropna()
        mean = float(numeric_values.mean()) if len(numeric_values) and np.isfinite(numeric_values.mean()) else None
        try:
            minimum = _json_value(series.min(skipna=True)) if series.notna().any() else None
            maximum = _json_value(series.max(skipna=True)) if series.notna().any() else None
        except (TypeError, ValueError):
            minimum = maximum = None
        try:
            counts = series.dropna().astype(str).value_counts().head(8)
            top_values = [{"value": str(value), "count": int(count)} for value, count in counts.items()]
        except Exception:
            top_values = []
        profiles.append({
            "profile_type": profile_type,
            "column_name": str(column),
            "inferred_type": infer_type(series),
            "row_count": row_count,
            "null_count": null_count,
            "unique_count": int(series.nunique(dropna=True)),
            "null_rate": round(null_count / row_count, 6) if row_count else 0.0,
            "mean": mean,
            "minimum": minimum,
            "maximum": maximum,
            "top_values": top_values,
        })
    return profiles


def _columns(config: dict, keys: tuple[str, ...] = ("columns",)) -> list[str]:
    for key in keys:
        value = config.get(key)
        if isinstance(value, list):
            return [str(x) for x in value]
    return []


def _series_type_mask(series: pd.Series, expected: str) -> pd.Series:
    kind = expected.strip().lower()
    nonnull = series.notna()
    if kind in {"int", "integer", "int64", "whole_number"}:
        values = pd.to_numeric(series, errors="coerce")
        valid = values.notna() & np.isclose(values.fillna(0) % 1, 0)
    elif kind in {"float", "number", "numeric", "decimal"}:
        valid = pd.to_numeric(series, errors="coerce").notna()
    elif kind in {"date", "datetime", "timestamp"}:
        try:
            valid = pd.to_datetime(series, errors="coerce", format="mixed", utc=True).notna()
        except (ValueError, TypeError, OverflowError):
            valid = pd.to_datetime(series, errors="coerce", utc=True).notna()
    elif kind in {"bool", "boolean"}:
        valid = series.astype(str).str.strip().str.lower().isin({"true", "false", "1", "0", "yes", "no"})
    elif kind in {"str", "string", "text", "categorical"}:
        valid = series.map(lambda value: isinstance(value, str) or isinstance(value, (int, float, bool)))
    else:
        # Accept the inferred logical name, while still checking true dtype constraints above.
        valid = series.map(lambda value: infer_type(pd.Series([value])) == kind if pd.notna(value) else False)
    return (~nonnull) | valid.fillna(False)


def _result(rule: dict, total: int, passed: bool, failed_rows: int, message: str,
            observed: dict, expected: dict) -> dict[str, Any]:
    return {
        "rule_id": rule.get("id"),
        "rule_name": rule.get("name", rule.get("rule_type", "Rule")),
        "rule_type": rule.get("rule_type", "unknown"),
        "severity": rule.get("severity", "medium"),
        "passed": bool(passed),
        "failed_rows": max(0, int(failed_rows)),
        "total_rows": int(total),
        "message": message,
        "observed": observed,
        "expected": expected,
    }


def validate_rules(df: pd.DataFrame, rules: list[dict]) -> list[dict[str, Any]]:
    """Evaluate configured checks against the current DataFrame; output is persisted verbatim."""
    total = int(len(df))
    results: list[dict[str, Any]] = []
    for rule in rules:
        config = rule.get("config") or {}
        kind = rule.get("rule_type")
        try:
            failed_rows = 0
            observed: dict[str, Any] = {}
            expected: dict[str, Any] = {}
            message = "Check passed"
            if kind == "null_threshold":
                columns = _columns(config) or [str(c) for c in df.columns]
                threshold = float(config.get("threshold", config.get("max_null_ratio", 0.05)))
                if not 0 <= threshold <= 1:
                    raise ValueError("threshold must be between 0 and 1")
                unknown = [c for c in columns if c not in df.columns]
                rates = {c: float(df[c].isna().mean()) if total else 0.0 for c in columns if c in df.columns}
                failing = [c for c, rate in rates.items() if rate > threshold]
                if failing:
                    failed_rows = int(df[failing].isna().any(axis=1).sum())
                observed = {"null_rates": rates, "missing_columns": unknown}
                expected = {"max_null_ratio": threshold, "columns": columns}
                if unknown:
                    failed_rows = max(failed_rows, total or 1)
                    message = f"Configured columns not found: {', '.join(unknown)}"
                elif failing:
                    message = f"Null-rate threshold exceeded in {len(failing)} column(s)"
            elif kind == "duplicate_check":
                columns = _columns(config)
                subset = columns or None
                if columns and any(c not in df.columns for c in columns):
                    missing = [c for c in columns if c not in df.columns]
                    failed_rows = total or 1
                    observed = {"missing_columns": missing}
                    message = f"Duplicate check columns not found: {', '.join(missing)}"
                else:
                    mask = df.duplicated(subset=subset, keep=False)
                    failed_rows = int(mask.sum())
                    observed = {"duplicate_rows": failed_rows, "columns": columns or list(df.columns)}
                    if failed_rows:
                        message = f"Found {failed_rows} rows participating in duplicate groups"
                expected = {"duplicate_rows": 0}
            elif kind == "required_columns":
                columns = _columns(config, ("columns", "required_columns"))
                if not columns:
                    raise ValueError("required_columns rule needs config.columns")
                missing = [c for c in columns if c not in df.columns]
                failed_rows = (total or 1) if missing else 0
                observed = {"present_columns": [c for c in columns if c in df.columns], "missing_columns": missing}
                expected = {"required_columns": columns}
                if missing:
                    message = f"Missing required columns: {', '.join(missing)}"
            elif kind == "data_types":
                expected_types = config.get("columns", config.get("types", {}))
                if not isinstance(expected_types, dict) or not expected_types:
                    raise ValueError("data_types rule needs config.columns as {column: type}")
                details: dict[str, Any] = {}
                bad_masks = []
                missing = []
                for column, type_name in expected_types.items():
                    if column not in df.columns:
                        missing.append(column)
                        continue
                    mask = _series_type_mask(df[column], str(type_name))
                    invalid = int((~mask & df[column].notna()).sum())
                    details[column] = {"expected": str(type_name), "invalid_values": invalid, "inferred": infer_type(df[column])}
                    if invalid:
                        bad_masks.append((~mask & df[column].notna()).rename(column))
                if bad_masks:
                    failed_rows = int(pd.concat(bad_masks, axis=1).any(axis=1).sum())
                if missing:
                    failed_rows = max(failed_rows, total or 1)
                observed = {"columns": details, "missing_columns": missing}
                expected = {"columns": expected_types}
                if missing or failed_rows:
                    message = f"Type violations in {failed_rows} row(s); {len(missing)} configured column(s) missing"
            elif kind == "numeric_ranges":
                ranges = config.get("ranges", {k: v for k, v in config.items() if k not in {"columns"}})
                if not isinstance(ranges, dict) or not ranges:
                    raise ValueError("numeric_ranges rule needs config.ranges as {column: {min, max}}")
                details, masks, missing = {}, [], []
                for column, bounds in ranges.items():
                    if column not in df.columns:
                        missing.append(column)
                        continue
                    bounds = bounds or {}
                    nums = pd.to_numeric(df[column], errors="coerce")
                    nonnull = df[column].notna()
                    invalid = nonnull & nums.isna()
                    if bounds.get("min") is not None:
                        invalid |= nums.notna() & (nums < float(bounds["min"]))
                    if bounds.get("max") is not None:
                        invalid |= nums.notna() & (nums > float(bounds["max"]))
                    masks.append(invalid.rename(column))
                    details[column] = {"min": bounds.get("min"), "max": bounds.get("max"), "violations": int(invalid.sum())}
                failed_rows = int(pd.concat(masks, axis=1).any(axis=1).sum()) if masks else 0
                if missing:
                    failed_rows = max(failed_rows, total or 1)
                observed, expected = {"ranges": details, "missing_columns": missing}, {"ranges": ranges}
                if failed_rows:
                    message = f"Numeric range/type constraints failed for {failed_rows} row(s)"
            elif kind == "allowed_values":
                allowed = config.get("values", config.get("allowed_values", {}))
                if not isinstance(allowed, dict) or not allowed:
                    raise ValueError("allowed_values rule needs config.values as {column: [values]}")
                details, masks, missing = {}, [], []
                for column, options in allowed.items():
                    if column not in df.columns:
                        missing.append(column)
                        continue
                    if not isinstance(options, (list, tuple, set)) or not options:
                        raise ValueError(f"allowed values for {column} must be a non-empty list")
                    options_text = {str(v) for v in options}
                    invalid = df[column].notna() & ~df[column].astype(str).isin(options_text)
                    masks.append(invalid.rename(column))
                    details[column] = {"invalid_values": int(invalid.sum()), "allowed": sorted(options_text)[:100]}
                failed_rows = int(pd.concat(masks, axis=1).any(axis=1).sum()) if masks else 0
                if missing:
                    failed_rows = max(failed_rows, total or 1)
                observed, expected = {"columns": details, "missing_columns": missing}, {"values": allowed}
                if failed_rows:
                    message = f"Found disallowed values in {failed_rows} row(s)"
            elif kind == "unique_identifiers":
                columns = _columns(config, ("columns", "identifiers"))
                if not columns:
                    raise ValueError("unique_identifiers rule needs config.columns")
                missing = [c for c in columns if c not in df.columns]
                if missing:
                    failed_rows = total or 1
                    observed = {"missing_columns": missing, "duplicate_rows": 0}
                    message = f"Identifier columns not found: {', '.join(missing)}"
                else:
                    null_mask = df[columns].isna().any(axis=1) if not config.get("allow_null", False) else pd.Series(False, index=df.index)
                    duplicate_mask = df.duplicated(subset=columns, keep=False)
                    failed_rows = int((null_mask | duplicate_mask).sum())
                    observed = {"duplicate_rows": int(duplicate_mask.sum()), "null_identifier_rows": int(null_mask.sum()), "columns": columns}
                    if failed_rows:
                        message = f"Identifier uniqueness/non-null check failed for {failed_rows} row(s)"
                expected = {"unique_columns": columns, "allow_null": bool(config.get("allow_null", False))}
            elif kind == "date_validation":
                formats = config.get("columns", {})
                if isinstance(formats, list):
                    formats = {c: None for c in formats}
                if not isinstance(formats, dict) or not formats:
                    raise ValueError("date_validation rule needs config.columns as a list or {column: format}")
                details, masks, missing = {}, [], []
                for column, fmt in formats.items():
                    if column not in df.columns:
                        missing.append(column)
                        continue
                    try:
                        parsed = pd.to_datetime(df[column], errors="coerce", format=fmt or "mixed", utc=True)
                    except (ValueError, TypeError):
                        parsed = pd.to_datetime(df[column], errors="coerce", utc=True)
                    invalid = df[column].notna() & parsed.isna()
                    if config.get("not_future"):
                        invalid |= parsed.notna() & (parsed > pd.Timestamp.now(tz="UTC"))
                    if config.get("min_date"):
                        invalid |= parsed.notna() & (parsed < pd.Timestamp(config["min_date"], tz="UTC"))
                    if config.get("max_date"):
                        invalid |= parsed.notna() & (parsed > pd.Timestamp(config["max_date"], tz="UTC"))
                    masks.append(invalid.rename(column))
                    details[column] = {"invalid_dates": int(invalid.sum()), "format": fmt}
                failed_rows = int(pd.concat(masks, axis=1).any(axis=1).sum()) if masks else 0
                if missing:
                    failed_rows = max(failed_rows, total or 1)
                observed, expected = {"columns": details, "missing_columns": missing}, {"columns": formats}
                if failed_rows:
                    message = f"Date validation failed for {failed_rows} row(s)"
            elif kind == "regex_checks":
                patterns = config.get("columns", config.get("patterns", {}))
                if not isinstance(patterns, dict) or not patterns:
                    raise ValueError("regex_checks rule needs config.columns as {column: regex}")
                details, masks, missing = {}, [], []
                for column, pattern in patterns.items():
                    pattern = str(pattern)
                    if len(pattern) > 256:
                        raise ValueError("regex pattern exceeds the 256 character limit")
                    compiled = re.compile(pattern)
                    if column not in df.columns:
                        missing.append(column)
                        continue
                    values = df[column].astype("string")
                    invalid = df[column].notna() & ~values.str.fullmatch(compiled, na=False)
                    masks.append(invalid.rename(column))
                    details[column] = {"invalid_values": int(invalid.sum()), "pattern": pattern}
                failed_rows = int(pd.concat(masks, axis=1).any(axis=1).sum()) if masks else 0
                if missing:
                    failed_rows = max(failed_rows, total or 1)
                observed, expected = {"columns": details, "missing_columns": missing}, {"patterns": patterns}
                if failed_rows:
                    message = f"Regex validation failed for {failed_rows} row(s)"
            elif kind == "row_count":
                minimum, maximum = config.get("min"), config.get("max")
                count = total
                passed = (minimum is None or count >= int(minimum)) and (maximum is None or count <= int(maximum))
                failed_rows = 0 if passed else (total or 1)
                observed, expected = {"row_count": count}, {"min": minimum, "max": maximum}
                if not passed:
                    message = f"Row count {count} outside configured bounds"
            else:
                raise ValueError(f"Unsupported rule type: {kind}")
            passed = failed_rows == 0
            results.append(_result(rule, total, passed, failed_rows, message, observed, expected))
        except Exception as exc:
            results.append(_result(
                rule, total, False, total or 1,
                f"Rule evaluation error: {type(exc).__name__}: {str(exc)[:250]}",
                {"error": f"{type(exc).__name__}: {str(exc)[:250]}"},
                config,
            ))
    return results


def calculate_quality_score(results: list[dict[str, Any]]) -> float:
    """Weighted row-compliance score: 100 × (1 − weighted mean failure rate).

    Severity weights are critical=4, high=3, medium=2, low=1. A failed
    table-level/configuration check with no row denominator counts as a full failure.
    """
    if not results:
        return 100.0
    weighted_failures = total_weight = 0.0
    for result in results:
        weight = SEVERITY_WEIGHTS.get(str(result.get("severity", "medium")).lower(), 2.0)
        total = int(result.get("total_rows") or 0)
        failed = int(result.get("failed_rows") or 0)
        rate = min(1.0, failed / total) if total > 0 else (0.0 if result.get("passed") else 1.0)
        if not result.get("passed") and failed == 0:
            rate = 1.0
        weighted_failures += weight * rate
        total_weight += weight
    return round(max(0.0, min(100.0, 100.0 * (1 - weighted_failures / total_weight))), 2) if total_weight else 100.0


def schema_diff(reference: pd.DataFrame, current: pd.DataFrame) -> list[dict[str, Any]]:
    ref_columns, cur_columns = [str(c) for c in reference.columns], [str(c) for c in current.columns]
    removed = [c for c in ref_columns if c not in cur_columns]
    added = [c for c in cur_columns if c not in ref_columns]
    changes: list[dict[str, Any]] = []
    consumed_removed: set[str] = set()
    consumed_added: set[str] = set()
    candidates = []
    for old in removed:
        for new in added:
            if infer_type(reference[old]) == infer_type(current[new]):
                similarity = difflib.SequenceMatcher(None, old.lower(), new.lower()).ratio()
                if similarity >= 0.68:
                    candidates.append((similarity, old, new))
    for _, old, new in sorted(candidates, reverse=True):
        if old in consumed_removed or new in consumed_added:
            continue
        changes.append({"kind": "possible_rename", "column_name": old, "old_value": old, "new_value": new, "severity": "medium"})
        consumed_removed.add(old)
        consumed_added.add(new)
    for column in removed:
        if column not in consumed_removed:
            changes.append({"kind": "column_removed", "column_name": column, "old_value": infer_type(reference[column]), "new_value": None, "severity": "high"})
    for column in added:
        if column not in consumed_added:
            changes.append({"kind": "column_added", "column_name": column, "old_value": None, "new_value": infer_type(current[column]), "severity": "medium"})
    for column in ref_columns:
        if column in cur_columns:
            old_type, new_type = infer_type(reference[column]), infer_type(current[column])
            if old_type != new_type:
                changes.append({"kind": "type_changed", "column_name": column, "old_value": old_type, "new_value": new_type, "severity": "high"})
    common_ref = [c for c in ref_columns if c in cur_columns]
    common_cur = [c for c in cur_columns if c in ref_columns]
    if common_ref != common_cur:
        changes.append({
            "kind": "column_order_changed", "column_name": "__order__",
            "old_value": json.dumps(ref_columns, ensure_ascii=False),
            "new_value": json.dumps(cur_columns, ensure_ascii=False), "severity": "low",
        })
    return changes


def _missing_rate(series: pd.Series) -> float:
    return float(series.isna().mean()) if len(series) else 0.0


def _psi(ref_counts: np.ndarray, cur_counts: np.ndarray) -> float:
    epsilon = 1e-6
    p = np.asarray(ref_counts, dtype=float) + epsilon
    q = np.asarray(cur_counts, dtype=float) + epsilon
    p /= p.sum()
    q /= q.sum()
    return float(np.sum((p - q) * np.log(p / q)))


def _numeric_drift(reference: pd.Series, current: pd.Series, threshold: float) -> tuple[float, list[dict[str, Any]]]:
    ref = pd.to_numeric(reference, errors="coerce").dropna().astype(float).to_numpy()
    cur = pd.to_numeric(current, errors="coerce").dropna().astype(float).to_numpy()
    if not len(ref) or not len(cur):
        return 0.0, []
    quantiles = np.unique(np.quantile(ref, np.linspace(0, 1, 11)))
    if len(quantiles) <= 1:
        value = float(quantiles[0])
        margin = max(abs(value) * 0.01, 1e-6)
        edges = np.array([-np.inf, value - margin, value + margin, np.inf])
    else:
        edges = np.concatenate(([-np.inf], quantiles[1:-1], [np.inf]))
        edges = np.unique(edges)
        if len(edges) < 2:
            edges = np.array([-np.inf, np.inf])
    ref_counts, _ = np.histogram(ref, bins=edges)
    cur_counts, _ = np.histogram(cur, bins=edges)
    score = _psi(ref_counts, cur_counts)
    chart = []
    for i in range(len(ref_counts)):
        left, right = edges[i], edges[i + 1]
        label = f"{left:.3g}–{right:.3g}" if np.isfinite(left) and np.isfinite(right) else (f"≤ {right:.3g}" if not np.isfinite(left) else f"> {left:.3g}")
        chart.append({
            "bin": label,
            "reference": round(float(ref_counts[i] / max(1, len(ref))), 4),
            "current": round(float(cur_counts[i] / max(1, len(cur))), 4),
        })
    return score, chart


def _categorical_drift(reference: pd.Series, current: pd.Series) -> tuple[float, list[dict[str, Any]]]:
    ref = reference.dropna().astype(str)
    cur = current.dropna().astype(str)
    all_values = list(dict.fromkeys(list(ref.value_counts().head(50).index) + list(cur.value_counts().head(50).index)))
    if not all_values:
        return 0.0, []
    ref_freq = ref.value_counts(normalize=True)
    cur_freq = cur.value_counts(normalize=True)
    ref_p = np.array([float(ref_freq.get(v, 0.0)) for v in all_values])
    cur_p = np.array([float(cur_freq.get(v, 0.0)) for v in all_values])
    score = float(0.5 * np.abs(ref_p - cur_p).sum())
    chart = [{"bin": v[:48], "reference": round(float(ref_p[i]), 4), "current": round(float(cur_p[i]), 4)} for i, v in enumerate(all_values[:24])]
    return score, chart


class EvidentlyAdapter:
    """Optional Evidently bridge. The local statistical implementation remains deterministic."""
    @staticmethod
    def analyze(reference: pd.DataFrame, current: pd.DataFrame) -> tuple[str, dict[str, Any]]:
        try:
            try:
                from evidently import Report
                from evidently.presets import DataDriftPreset
            except ImportError:
                from evidently.metric_preset import DataDriftPreset
                from evidently.report import Report
            report = Report(metrics=[DataDriftPreset()])
            report.run(reference_data=reference, current_data=current)
            result = report.as_dict() if hasattr(report, "as_dict") else {}
            return "evidently", {"available": True, "adapter": "Evidently DataDriftPreset", "report_metrics": len(result.get("metrics", [])) if isinstance(result, dict) else None}
        except ImportError:
            return "statistical_fallback", {"available": False, "adapter": "built-in PSI/total-variation"}
        except Exception as exc:
            logger.warning("evidently_adapter_failed: %s", exc)
            return "statistical_fallback", {"available": True, "adapter_error": f"{type(exc).__name__}: {str(exc)[:180]}", "fallback": "built-in PSI/total-variation"}


class GreatExpectationsAdapter:
    """Compatibility smoke adapter for Great Expectations, version 0.x and 1.x."""
    @staticmethod
    def inspect(df: pd.DataFrame) -> dict[str, Any]:
        try:
            try:
                from great_expectations.dataset import PandasDataset
                ge_df = PandasDataset(df)
                result = ge_df.expect_table_row_count_to_be_between(min_value=1)
                success = bool(result.get("success", False)) if isinstance(result, dict) else bool(result.success)
            except ImportError:
                import great_expectations as gx
                ge_df = gx.from_pandas(df)
                result = ge_df.expect_table_row_count_to_be_between(min_value=1)
                success = bool(result.get("success", False)) if isinstance(result, dict) else bool(result.success)
            return {"available": True, "adapter": "Great Expectations table row-count expectation", "success": success}
        except ImportError:
            return {"available": False, "adapter": "built-in validation engine"}
        except Exception as exc:
            logger.warning("great_expectations_adapter_failed: %s", exc)
            return {"available": True, "adapter_error": f"{type(exc).__name__}: {str(exc)[:180]}", "fallback": "built-in validation engine"}


def analyze_drift(reference: pd.DataFrame, current: pd.DataFrame, thresholds: dict[str, float]) -> dict[str, Any]:
    numeric_threshold = float(thresholds.get("numeric", 0.20))
    categorical_threshold = float(thresholds.get("categorical", 0.10))
    missing_threshold = float(thresholds.get("missing", 0.05))
    common = [str(c) for c in reference.columns if c in current.columns]
    features: list[dict[str, Any]] = []
    for column in common:
        ref_series, cur_series = reference[column], current[column]
        ref_type, cur_type = infer_type(ref_series), infer_type(cur_series)
        ref_missing, cur_missing = _missing_rate(ref_series), _missing_rate(cur_series)
        missing_change = abs(ref_missing - cur_missing)
        common_detail = {
            "missing_change": round(missing_change, 6),
            "missing_threshold": missing_threshold,
            "reference_missing_rate": round(ref_missing, 6),
            "current_missing_rate": round(cur_missing, 6),
        }
        ref_nonnull, cur_nonnull = int(ref_series.notna().sum()), int(cur_series.notna().sum())
        if ref_type != cur_type and {ref_type, cur_type} & {"integer", "numeric"} and {ref_type, cur_type} <= {"integer", "numeric"}:
            cur_type = ref_type = "numeric"
        if ref_type != cur_type:
            features.append({
                "feature_name": column, "feature_type": f"{ref_type} → {cur_type}",
                "status": "failed_comparison", "drifted": False, "score": None,
                "threshold": None, "missing_reference": ref_missing, "missing_current": cur_missing,
                "details": {**common_detail, "error": "Reference and current feature types are incompatible"},
            })
            continue
        if ref_nonnull < 10 or cur_nonnull < 10:
            features.append({
                "feature_name": column, "feature_type": ref_type, "status": "insufficient_data",
                "drifted": False, "score": None,
                "threshold": numeric_threshold if ref_type in {"integer", "numeric"} else categorical_threshold,
                "missing_reference": ref_missing, "missing_current": cur_missing,
                "details": {**common_detail, "reference_non_null": ref_nonnull, "current_non_null": cur_nonnull, "minimum_non_null": 10},
            })
            continue
        if ref_type in {"integer", "numeric"}:
            score, chart = _numeric_drift(ref_series, cur_series, numeric_threshold)
            threshold = numeric_threshold
            score_name = "population_stability_index"
        else:
            score, chart = _categorical_drift(ref_series, cur_series)
            threshold = categorical_threshold
            score_name = "total_variation_distance"
        drifted = score >= threshold or missing_change >= missing_threshold
        features.append({
            "feature_name": column,
            "feature_type": "numeric" if ref_type in {"integer", "numeric"} else ref_type,
            "status": "detected_drift" if drifted else "no_drift",
            "drifted": bool(drifted), "score": round(float(score), 6), "threshold": threshold,
            "missing_reference": ref_missing, "missing_current": cur_missing,
            "details": {**common_detail, "score_name": score_name, "distribution_score": round(float(score), 6), "chart": chart},
        })
    statuses = [f["status"] for f in features]
    drifted_count = sum(1 for f in features if f["drifted"])
    valid_count = sum(1 for s in statuses if s in {"no_drift", "detected_drift"})
    failed_count = statuses.count("failed_comparison")
    if drifted_count:
        overall = "detected_drift"
    elif failed_count:
        overall = "failed_comparison"
    elif valid_count:
        overall = "no_drift"
    else:
        overall = "insufficient_data"
    engine, adapter = EvidentlyAdapter.analyze(reference, current)
    return {
        "overall_status": overall,
        "features_checked": len(features),
        "features_drifted": drifted_count,
        "engine": engine,
        "thresholds": {"numeric": numeric_threshold, "categorical": categorical_threshold, "missing": missing_threshold},
        "adapter": adapter,
        "features": features,
    }
