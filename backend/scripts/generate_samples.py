"""Generate fixed, deterministic CSV fixtures used by the local demo command."""
from __future__ import annotations
from datetime import date, timedelta
from pathlib import Path
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "sample_data"
OUT.mkdir(parents=True, exist_ok=True)


def save(name: str, rows: list[dict]) -> None:
    pd.DataFrame(rows).to_csv(OUT / name, index=False, lineterminator="\n")

# Clean baseline/current: same stable reference distribution, with tiny deterministic changes.
clean = []
for i in range(60):
    clean.append({
        "customer_id": 10001 + i,
        "name": ["Asha", "Rohan", "Meera", "Kabir", "Diya"][i % 5] + f" {i:02d}",
        "age": 22 + (i * 7 % 41),
        "region": ["west", "north", "south", "west", "east"][i % 5],
        "spend": round(120 + (i * 31 % 490) + (i % 4) * 0.7, 2),
        "signup_date": (date(2024, 1, 1) + timedelta(days=i * 5)).isoformat(),
        "plan": ["basic", "plus", "plus", "pro"][i % 4],
    })
save("clean_reference.csv", clean)
clean_current = [dict(r) for r in clean]
for i, row in enumerate(clean_current):
    row["spend"] = round(float(row["spend"]) + ((i % 3) - 1) * 0.18, 2)
save("clean_current.csv", clean_current)

# Null/missingness example.
missing_ref = [{"contact_id": 2000 + i, "email": f"person{i:02d}@example.com", "age": 21 + i % 39,
                "city": ["Ahmedabad", "Surat", "Vadodara", "Rajkot"][i % 4]} for i in range(50)]
missing_cur = [dict(r) for r in missing_ref]
for i, row in enumerate(missing_cur):
    if i % 3 == 0:
        row["email"] = ""
    if i % 8 == 0:
        row["age"] = ""
save("missing_reference.csv", missing_ref)
save("missing_current.csv", missing_cur)

# Duplicate records example.
duplicate_ref = [{"transaction_id": f"TX-{i:04d}", "account_id": f"AC-{i % 13:03d}",
                  "amount": round(40 + (i * 19 % 300) + (i % 3) * 0.25, 2),
                  "channel": ["web", "mobile", "branch"][i % 3]} for i in range(45)]
duplicate_cur = [dict(r) for r in duplicate_ref] + [dict(duplicate_ref[i]) for i in (3, 11, 24, 3)]
save("duplicates_reference.csv", duplicate_ref)
save("duplicates_current.csv", duplicate_cur)

# Numerical and categorical drift in current data.
drift_ref = [{"sku": f"SKU-{i:04d}", "price": round(8 + (i * 13 % 145) / 10, 2),
              "category": "electronics" if i % 10 < 8 else ["home", "apparel"][i % 2],
              "channel": ["store", "web", "partner", "web"][i % 4],
              "units_sold": 1 + (i * 3 % 17)} for i in range(120)]
drift_cur = [{"sku": f"SKU-{1000+i:04d}", "price": round(35 + (i * 17 % 245) / 10, 2),
              "category": "apparel" if i % 10 < 8 else ["electronics", "home"][i % 2],
              "channel": ["web", "web", "partner", "web"][i % 4],
              "units_sold": 1 + (i * 5 % 19)} for i in range(120)]
save("drift_reference.csv", drift_ref)
save("drift_current.csv", drift_cur)

# Schema change: a similar renamed date field, removed legacy column, added tier,
# changed age values/type, and a reordered schema.
schema_ref = [{"customer_id": 5000 + i, "age": 19 + i % 47, "city": ["Ahmedabad", "Surat", "Anand"][i % 3],
               "signup_date": (date(2023, 6, 1) + timedelta(days=i * 8)).isoformat(),
               "legacy_code": f"L-{i % 8:02d}"} for i in range(40)]
schema_cur = []
for i, row in enumerate(schema_ref):
    schema_cur.append({
        "signup_date_v2": row["signup_date"],
        "membership_tier": ["silver", "gold", "platinum"][i % 3],
        "city": row["city"],
        "age": "unknown" if i % 5 == 0 else str(row["age"]),
        "customer_id": row["customer_id"],
    })
save("schema_reference.csv", schema_ref)
save("schema_current.csv", schema_cur)
print(f"Wrote deterministic fixtures to {OUT}")
