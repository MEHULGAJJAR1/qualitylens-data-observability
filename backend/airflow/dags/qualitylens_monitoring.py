"""Optional Airflow trigger DAG; Airflow is not required by the local application.
Set QUALITYLENS_API_URL and QUALITYLENS_DATASET_IDS in the scheduler environment.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone
from airflow import DAG
from airflow.operators.python import PythonOperator


def trigger_qualitylens_runs() -> None:
    import requests
    base = os.getenv("QUALITYLENS_API_URL", "http://host.docker.internal:8000").rstrip("/")
    dataset_ids = [item.strip() for item in os.getenv("QUALITYLENS_DATASET_IDS", "").split(",") if item.strip()]
    if not dataset_ids:
        raise RuntimeError("Set QUALITYLENS_DATASET_IDS to comma-separated registered dataset IDs")
    for dataset_id in dataset_ids:
        response = requests.post(
            f"{base}/api/v1/runs",
            json={"dataset_id": dataset_id, "trigger_type": "api"},
            timeout=120,
        )
        response.raise_for_status()


with DAG(
    dag_id="qualitylens_monitoring",
    description="Trigger QualityLens persisted monitoring runs through its REST API",
    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
    schedule=None,
    catchup=False,
    tags=["qualitylens", "data-quality", "optional"],
) as dag:
    trigger_runs = PythonOperator(
        task_id="trigger_qualitylens_runs",
        python_callable=trigger_qualitylens_runs,
    )
