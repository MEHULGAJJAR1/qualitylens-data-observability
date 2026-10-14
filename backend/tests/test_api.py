from __future__ import annotations

import csv
import io


def csv_bytes(rows: int = 30, with_nulls: bool = False) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["record_id", "amount", "segment"])
    for i in range(rows):
        amount = "" if with_nulls and i < 6 else 20 + i
        writer.writerow([i + 1, amount, "standard" if i % 2 == 0 else "premium"])
    return stream.getvalue().encode("utf-8")


def upload(client, file_bytes: bytes, **fields):
    return client.post("/api/v1/datasets/upload", files={"file": ("data.csv", file_bytes, "text/csv")}, data=fields)


def test_upload_monitor_quality_alert_report_and_filters(client):
    reference = upload(client, csv_bytes(), dataset_name="API integration fixture", role="reference")
    assert reference.status_code == 201, reference.text
    dataset_id = reference.json()["id"]
    assert reference.json()["has_reference"] is True

    current = upload(client, csv_bytes(with_nulls=True), dataset_id=dataset_id, role="current")
    assert current.status_code == 201, current.text
    profiles = client.get(f"/api/v1/datasets/{dataset_id}/profiles").json()["items"]
    assert {p["profile_type"] for p in profiles} == {"reference", "current"}
    assert any(p["column_name"] == "amount" and p["null_count"] == 6 for p in profiles)
    unsafe_name = client.post(f"/api/v1/datasets/{dataset_id}/rules", json={
        "name": "=2+2", "rule_type": "row_count", "config": {"minimum": 30}, "severity": "low",
    })
    assert unsafe_name.status_code == 201

    run_response = client.post("/api/v1/runs", json={"dataset_id": dataset_id, "trigger_type": "manual"})
    assert run_response.status_code == 201, run_response.text
    run = run_response.json()
    assert run["status"] == "completed"
    assert run["summary"]["quality_score"] < 100
    assert run["summary"]["checks_failed"] >= 1
    assert run["summary"]["row_count"] == 30

    quality = client.get("/api/v1/quality", params={"dataset_id": dataset_id}).json()["items"][0]
    assert quality["run"]["id"] == run["id"]
    assert quality["score"] == run["summary"]["quality_score"]
    assert any(not check["passed"] for check in quality["checks"])

    alerts = client.get("/api/v1/alerts", params={"dataset_id": dataset_id, "status": "open"}).json()
    assert alerts["total"] >= 1
    alert_id = alerts["items"][0]["id"]
    action = client.patch(f"/api/v1/alerts/{alert_id}", json={"action": "acknowledge", "notes": "Investigated in test"})
    assert action.status_code == 200
    assert action.json()["status"] == "acknowledged"
    assert action.json()["notes"] == "Investigated in test"
    assert client.patch(f"/api/v1/alerts/{alert_id}", json={"action": "resolve", "notes": "Root cause accepted"}).json()["status"] == "resolved"
    assert client.patch(f"/api/v1/alerts/{alert_id}", json={"action": "reopen", "notes": "Recheck"}).json()["status"] == "open"

    report = client.get(f"/api/v1/runs/{run['id']}/reports/json")
    assert report.status_code == 200
    assert "attachment" in report.headers.get("content-disposition", "")
    report_json = report.json()
    assert report_json["run"]["id"] == run["id"]
    assert report_json["quality"]["checks"]
    assert report_json["alerts"]
    csv_report = client.get(f"/api/v1/runs/{run['id']}/reports/csv")
    assert csv_report.headers["content-type"].startswith("text/csv")
    assert "'=2+2" in csv_report.text  # Spreadsheet-formula payload is neutralized.
    html = client.get(f"/api/v1/runs/{run['id']}/reports/html")
    assert "<!doctype html>" in html.text.lower()
    assert client.get("/api/v1/reports").json()["total"] >= 4

    overview = client.get("/api/v1/overview").json()
    assert overview["kpis"]["datasets"] == 1
    assert overview["kpis"]["average_quality_score"] < 100
    assert overview["recent_runs"][0]["id"] == run["id"]

    preview = client.get(f"/api/v1/datasets/{dataset_id}/preview", params={"page": 1, "limit": 5})
    assert preview.status_code == 200
    assert len(preview.json()["rows"]) == 5

    schedule = client.post("/api/v1/schedules", json={"dataset_id": dataset_id, "name": "Hourly smoke", "interval_minutes": 60})
    assert schedule.status_code == 201
    assert client.patch(f"/api/v1/schedules/{schedule.json()['id']}", json={"active": False}).json()["active"] is False
    assert client.delete(f"/api/v1/schedules/{schedule.json()['id']}").status_code == 204


def test_upload_rejects_non_csv_and_reuses_generated_storage_name(client):
    response = client.post("/api/v1/datasets/upload", files={"file": ("bad.txt", b"hello", "text/plain")}, data={"dataset_name": "Bad input"})
    assert response.status_code == 415
    response = client.post("/api/v1/datasets/upload", files={"file": ("../../outside.csv", csv_bytes(), "text/csv")}, data={"dataset_name": "Safe path", "role": "reference"})
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["reference_filename"] == "outside.csv"
    assert ".." not in payload["reference_filename"]


def test_health_and_pagination_validation(client):
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["database"]["connected"] is True
    assert client.get("/api/v1/datasets", params={"page": 0}).status_code == 422


def test_schema_ack_rule_crud_and_threshold_settings(client):
    reference_rows = [
        ["record_id", "event_date", "legacy_code", "region"],
        *[[i, f"2025-01-{i:02d}", f"L-{i:03d}", ["west", "east"][i % 2]] for i in range(1, 21)],
    ]
    current_rows = [
        ["region", "record_id", "event_date_v2", "transaction_code", "tier"],
        *[[["west", "north"][i % 2], i, f"2025-01-{i:02d}", f"T-{i:03d}", ["gold", "silver"][i % 2]] for i in range(1, 21)],
    ]
    def to_csv(rows):
        stream = io.StringIO(newline="")
        csv.writer(stream).writerows(rows)
        return stream.getvalue().encode("utf-8")

    ref = client.post("/api/v1/datasets/upload", files={"file": ("ref.csv", to_csv(reference_rows), "text/csv")}, data={"dataset_name": "Schema API fixture", "role": "reference"})
    assert ref.status_code == 201, ref.text
    dataset_id = ref.json()["id"]
    cur = client.post("/api/v1/datasets/upload", files={"file": ("current.csv", to_csv(current_rows), "text/csv")}, data={"dataset_id": dataset_id, "role": "current"})
    assert cur.status_code == 201, cur.text
    run = client.post("/api/v1/runs", json={"dataset_id": dataset_id}).json()
    assert run["status"] == "completed"

    schema = client.get("/api/v1/schema-changes", params={"dataset_id": dataset_id, "acknowledged": "false"}).json()
    assert schema["total"] >= 3
    assert any(change["kind"] == "possible_rename" for change in schema["items"])
    target = schema["items"][0]
    saved = client.patch(f"/api/v1/schema-changes/{target['id']}/acknowledge", json={"acknowledged": True, "notes": "Reviewed change"})
    assert saved.status_code == 200 and saved.json()["acknowledged"] is True
    acknowledged = client.get("/api/v1/schema-changes", params={"dataset_id": dataset_id, "acknowledged": "true"}).json()
    assert any(change["id"] == target["id"] and change["notes"] == "Reviewed change" for change in acknowledged["items"])

    created = client.post(f"/api/v1/datasets/{dataset_id}/rules", json={
        "name": "Unique transaction key", "rule_type": "unique_identifiers",
        "config": {"columns": ["record_id"]}, "severity": "critical", "enabled": True,
    })
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]
    updated = client.put(f"/api/v1/rules/{rule_id}", json={"enabled": False, "severity": "low"})
    assert updated.status_code == 200 and updated.json()["enabled"] is False and updated.json()["severity"] == "low"
    oversized = client.put(f"/api/v1/rules/{rule_id}", json={"config": {"payload": "x" * 12001}})
    assert oversized.status_code == 422
    assert client.delete(f"/api/v1/rules/{rule_id}").status_code == 204

    config = client.patch("/api/v1/settings", json={"alert_quality_threshold": 76, "numeric_drift_threshold": 0.35})
    assert config.status_code == 200
    assert config.json()["alert_quality_threshold"] == 76
    assert config.json()["numeric_drift_threshold"] == 0.35
    drift = client.get("/api/v1/drift", params={"dataset_id": dataset_id}).json()["items"][0]
    assert drift["status"] in {"detected_drift", "no_drift", "insufficient_data", "failed_comparison"}
