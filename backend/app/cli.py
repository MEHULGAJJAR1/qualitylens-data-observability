from __future__ import annotations

import argparse
import json
import shutil

import pandas as pd
from sqlalchemy import select

from app.config import BACKEND_DIR, settings
from app.database import check_connection, create_schema, new_session
from app.logging_config import configure_logging
from app.models import Dataset
from app.services import persist_profiles, run_monitoring, seed_default_rules

configure_logging(settings.log_level)
SAMPLE_DIR = BACKEND_DIR / "sample_data"

DEMOS = [
    ("Retail customers · clean", "Clean baseline/current pair with stable distributions.", "clean_reference.csv", "clean_current.csv"),
    ("Support contacts · missing values", "Current file introduces missingness above the configured quality threshold.", "missing_reference.csv", "missing_current.csv"),
    ("Payments · duplicate records", "Current file contains duplicate transaction rows.", "duplicates_reference.csv", "duplicates_current.csv"),
    ("Product catalog · distribution drift", "Current prices and category mix shift relative to reference.", "drift_reference.csv", "drift_current.csv"),
    ("Customer registry · schema changes", "Column rename/addition, removal, order and type changes.", "schema_reference.csv", "schema_current.csv"),
]


def initialize_database() -> None:
    healthy, error = check_connection()
    if not healthy:
        raise RuntimeError(f"Database is not reachable ({settings.database_kind}): {error}")
    create_schema()


def initialize_demo() -> list[dict]:
    initialize_database()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    db = new_session()
    results = []
    try:
        for index, (name, description, reference_file, current_file) in enumerate(DEMOS):
            dataset = db.scalar(select(Dataset).where(Dataset.name == name))
            if not dataset:
                dataset = Dataset(name=name, description=description)
                db.add(dataset)
                db.flush()
            target_ref = (settings.upload_dir / f"demo-{index + 1}-reference.csv").resolve()
            target_cur = (settings.upload_dir / f"demo-{index + 1}-current.csv").resolve()
            for target in (target_ref, target_cur):
                target.relative_to(settings.upload_dir.resolve())
            shutil.copyfile(SAMPLE_DIR / reference_file, target_ref)
            shutil.copyfile(SAMPLE_DIR / current_file, target_cur)
            reference = pd.read_csv(target_ref, low_memory=False)
            current = pd.read_csv(target_cur, low_memory=False)
            dataset.reference_path = str(target_ref)
            dataset.current_path = str(target_cur)
            dataset.reference_filename = reference_file
            dataset.current_filename = current_file
            dataset.row_count = len(current)
            dataset.column_count = len(current.columns)
            persist_profiles(db, dataset.id, "reference", reference)
            persist_profiles(db, dataset.id, "current", current)
            seed_default_rules(db, dataset, reference)
            results.append({"dataset_id": dataset.id, "name": dataset.name})
        db.commit()
        # This runs the same validation, drift, schema, alert, persistence and report pipeline
        # invoked by the API; dashboard values are not seeded or fabricated.
        completed = []
        for item in results:
            run = run_monitoring(db, item["dataset_id"], trigger_type="manual")
            completed.append({"dataset_id": item["dataset_id"], "name": item["name"],
                              "run_id": run.id, "status": run.status,
                              "quality_score": (run.summary or {}).get("quality_score"),
                              "drift_status": (run.summary or {}).get("drift_status"),
                              "error": run.error})
        return completed
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="QualityLens local administration commands")
    parser.add_argument("command", choices=["init-db", "demo"], help="init-db creates schema; demo loads samples and runs real monitoring")
    args = parser.parse_args()
    if args.command == "init-db":
        initialize_database()
        print(f"Database schema is ready ({settings.database_kind}).")
    else:
        outcomes = initialize_demo()
        print(json.dumps({"message": "Demo files were processed by the monitoring pipeline.", "runs": outcomes}, indent=2))


if __name__ == "__main__":
    main()
