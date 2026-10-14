import pandas as pd

from app.engine import analyze_drift, calculate_quality_score, schema_diff, validate_rules


def test_quality_score_uses_real_failed_row_rates_and_severity_weights():
    df = pd.DataFrame({"id": [1, 2, 3, 4], "email": ["a", None, None, "d"]})
    rule = {"id": "r1", "name": "Email nulls", "rule_type": "null_threshold",
            "severity": "high", "config": {"threshold": 0.1, "columns": ["email"]}}
    result = validate_rules(df, [rule])
    assert result[0]["passed"] is False
    assert result[0]["failed_rows"] == 2
    assert 0 < calculate_quality_score(result) < 100


def test_rule_types_cover_ranges_values_ids_regex_and_required_columns():
    df = pd.DataFrame({"id": [1, 1, 3], "score": [10, 99, -1], "state": ["CA", "XX", "CA"], "email": ["a@x.com", "bad", "c@x.com"]})
    rules = [
        {"name": "id", "rule_type": "unique_identifiers", "severity": "high", "config": {"columns": ["id"]}},
        {"name": "range", "rule_type": "numeric_ranges", "severity": "medium", "config": {"ranges": {"score": {"min": 0, "max": 100}}}},
        {"name": "values", "rule_type": "allowed_values", "severity": "low", "config": {"values": {"state": ["CA", "NY"]}}},
        {"name": "regex", "rule_type": "regex_checks", "severity": "medium", "config": {"columns": {"email": r"^[^@]+@[^@]+\.[^@]+$"}}},
        {"name": "required", "rule_type": "required_columns", "severity": "high", "config": {"columns": ["new_col"]}},
    ]
    results = validate_rules(df, rules)
    assert all(not row["passed"] for row in results)
    assert results[3]["failed_rows"] == 1
    assert calculate_quality_score(results) < 100


def test_date_type_and_row_count_checks_use_current_values():
    df = pd.DataFrame({"event_date": ["2026-02-01", "not-a-date"], "amount": ["12", "oops"]})
    rules = [
        {"name": "dates", "rule_type": "date_validation", "severity": "medium", "config": {"columns": {"event_date": "%Y-%m-%d"}}},
        {"name": "amount type", "rule_type": "data_types", "severity": "high", "config": {"columns": {"amount": "integer"}}},
        {"name": "row floor", "rule_type": "row_count", "severity": "low", "config": {"min": 3}},
    ]
    results = validate_rules(df, rules)
    assert [row["failed_rows"] for row in results] == [1, 1, 2]
    assert all(not row["passed"] for row in results)


def test_drift_status_distinguishes_drift_and_insufficient_data():
    reference = pd.DataFrame({"amount": range(40), "channel": ["web", "store"] * 20})
    current = pd.DataFrame({"amount": range(100, 140), "channel": ["app"] * 40})
    drift = analyze_drift(reference, current, {"numeric": 0.2, "categorical": 0.1, "missing": 0.05})
    assert drift["overall_status"] == "detected_drift"
    assert drift["features_drifted"] >= 1
    assert all("chart" in f["details"] for f in drift["features"] if f["score"] is not None)

    small = analyze_drift(reference.head(5), current.head(5), {"numeric": 0.2, "categorical": 0.1, "missing": 0.05})
    assert small["overall_status"] == "insufficient_data"
    assert all(f["status"] == "insufficient_data" for f in small["features"])


def test_schema_diff_reports_add_remove_rename_type_and_order():
    reference = pd.DataFrame({"user_id": [1, 2], "created_date": ["2024-01-01", "2024-01-02"], "old_code": ["A", "B"], "region": ["west", "east"]})
    current = pd.DataFrame({"new_code": ["A", "C"], "region": ["west", "north"], "user_id": ["x", "y"], "created_date_v2": ["2024-01-01", "2024-01-02"], "tier": ["gold", "silver"]})
    changes = schema_diff(reference, current)
    kinds = {c["kind"] for c in changes}
    assert "possible_rename" in kinds
    assert "type_changed" in kinds
    assert "column_order_changed" in kinds
    assert "column_added" in kinds or "column_removed" in kinds
