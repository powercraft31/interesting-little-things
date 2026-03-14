# PLAN: Demo Data Hydration — Execution Plan

**Date:** 2026-03-14
**Design:** DESIGN-demo-data-hydration.md

---

## 1. Script Structure

**File:** `scripts/hydrate_demo_data.py`
**Runtime:** Python 3.10+ with `psycopg2`
**Connection:** `host=localhost, port=5433, db=solfacil_vpp, user=postgres`

```
scripts/hydrate_demo_data.py
├── Constants (asset IDs, tariff rates, date range)
├── DB connection setup
├── Phase 0: Prerequisites (partitions, tariff schedule)
├── Phase 1: Tier 1 tables (from telemetry_history)
│   ├── 1a. asset_5min_metrics
│   ├── 1b. asset_hourly_metrics
│   ├── 1c. daily_uptime_snapshots
│   └── 1d. offline_events
├── Phase 2: Tier 2 tables (from Tier 1 + tariffs)
│   ├── 2a. revenue_daily
│   └── 2b. algorithm_metrics
├── Phase 3: Tier 3 tables (VPP/HEMS)
│   ├── 3a. vpp_strategies
│   ├── 3b. pld_horario
│   ├── 3c. dispatch_records (UPDATE)
│   ├── 3d. dispatch_commands (UPDATE)
│   └── 3e. trades
├── Phase 4: Verification queries
└── Summary report
```

---

## 2. Processing Order

### Phase 0: Prerequisites

**0a. Create missing `asset_5min_metrics` partitions**

- Date range: 2025-12-13 to 2026-03-05 (83 partitions needed)
- Existing partitions cover 2026-03-06 onward only
- For each missing day:
  ```sql
  CREATE TABLE IF NOT EXISTS asset_5min_metrics_YYYYMMDD
      PARTITION OF asset_5min_metrics
      FOR VALUES FROM ('YYYY-MM-DD 03:00:00+00') TO ('YYYY-MM-(DD+1) 03:00:00+00');
  ```
- Boundary uses UTC 03:00 (= BRT midnight)
- Must also create indexes to match existing partitions (asset_id+window_start composite, window_start)

**0b. Ensure tariff_schedule for ORG_DEMO_001**

- Check if `tariff_schedules` has a row for ORG_DEMO_001
- If not, INSERT the Enel SP tariff (peak=0.95, offpeak=0.55, intermediate=0.72, feed_in=0.25)
- Store the `tariff_schedule_id` for use in revenue_daily

### Phase 1: Tier 1 (direct from telemetry_history)

| Step | Table | Source | Delete Scope | Expected Rows |
|------|-------|--------|--------------|---------------|
| 1a | asset_5min_metrics | telemetry_history | WHERE asset_id LIKE 'DEMO-%' | ~77,760 |
| 1b | asset_hourly_metrics | telemetry_history | WHERE asset_id LIKE 'DEMO-%' | ~6,480 |
| 1c | daily_uptime_snapshots | Synthetic (Python RNG) | WHERE org_id = 'ORG_DEMO_001' | 90 |
| 1d | offline_events | Synthetic (from 1c) | WHERE org_id = 'ORG_DEMO_001' | ~14 |

**1a and 1b** can potentially run in parallel (independent inserts), but sequential is safer for demo.

### Phase 2: Tier 2 (derived from Tier 1 + tariffs)

| Step | Table | Source | Delete Scope | Expected Rows |
|------|-------|--------|--------------|---------------|
| 2a | revenue_daily | telemetry_history + tariff rates | WHERE asset_id LIKE 'DEMO-%' | ~270 |
| 2b | algorithm_metrics | revenue_daily | WHERE org_id = 'ORG_DEMO_001' | 90 |

**2b depends on 2a** — must be sequential.

### Phase 3: Tier 3 (VPP/HEMS)

| Step | Table | Source | Delete/Update Scope | Expected Rows |
|------|-------|--------|---------------------|---------------|
| 3a | vpp_strategies | Static definitions | WHERE org_id = 'ORG_DEMO_001' | 3 |
| 3b | pld_horario | Synthetic (Python RNG) | TRUNCATE (table is demo-only) | ~2,160 |
| 3c | dispatch_records | UPDATE existing | WHERE asset_id LIKE 'DEMO-%' | ~100 updated |
| 3d | dispatch_commands | UPDATE existing | WHERE asset_id LIKE 'DEMO-%' | ~163 updated (73 completed + 90 failed) |
| 3e | trades | dispatch_records (successful) | WHERE asset_id LIKE 'DEMO-%' | ~60 |

**3e depends on 3b (PLD prices) and 3c (successful dispatches)** — must run after both.

---

## 3. Idempotency Strategy

**Pattern: DELETE WHERE + INSERT** (per table, per scope)

```python
def idempotent_insert(cursor, table, scope_clause, insert_sql):
    """Delete existing demo data, then insert fresh."""
    cursor.execute(f"DELETE FROM {table} WHERE {scope_clause}")
    deleted = cursor.rowcount
    cursor.execute(insert_sql)
    inserted = cursor.rowcount
    print(f"  {table}: deleted {deleted}, inserted {inserted}")
```

### Per-table scope:

| Table | DELETE WHERE clause |
|-------|-------------------|
| asset_5min_metrics | `asset_id LIKE 'DEMO-%'` |
| asset_hourly_metrics | `asset_id LIKE 'DEMO-%'` |
| daily_uptime_snapshots | `org_id = 'ORG_DEMO_001'` |
| offline_events | `org_id = 'ORG_DEMO_001'` |
| revenue_daily | `asset_id LIKE 'DEMO-%'` |
| algorithm_metrics | `org_id = 'ORG_DEMO_001'` |
| vpp_strategies | `org_id = 'ORG_DEMO_001'` |
| pld_horario | `1=1` (TRUNCATE or DELETE all — table is demo-only) |
| trades | `asset_id LIKE 'DEMO-%'` |

### Special cases (UPDATE, not DELETE+INSERT):

| Table | Strategy |
|-------|----------|
| dispatch_records | Reset all DEMO rows first: `UPDATE SET success=NULL, actual_power_kw=NULL, response_latency_ms=NULL, error_message=NULL WHERE asset_id LIKE 'DEMO-%'`, then apply random updates |
| dispatch_commands | Reset all DEMO rows first: `UPDATE SET status='dispatched', completed_at=NULL WHERE asset_id LIKE 'DEMO-%' AND status IN ('completed','failed')`, then apply random updates |

### Transaction handling:

- Wrap entire script in a single transaction
- COMMIT only after all phases complete successfully
- ROLLBACK on any error
- This ensures atomicity — partial hydration is never visible

---

## 4. Expected Row Counts

| Table | Expected Rows | Calculation |
|-------|--------------|-------------|
| asset_5min_metrics | 77,760 | 3 assets x 90 days x 288 intervals |
| asset_hourly_metrics | 6,480 | 3 assets x 90 days x 24 hours |
| daily_uptime_snapshots | 90 | 90 days (Dec 13 - Mar 12 inclusive) |
| offline_events | ~14 | ~15% of 91 days |
| revenue_daily | 270 | 3 assets x 90 days |
| algorithm_metrics | 90 | 90 days (1 per day per org) |
| vpp_strategies | 3 | 1 per gateway |
| pld_horario | 2,160 | 90 days x 24 hours |
| trades | ~60 | ~60% of dispatch_records |
| dispatch_records | ~100 updated | existing rows |
| dispatch_commands | 163 updated | 45% completed + 55% failed |

**Note on day count:** 2025-12-13 to 2026-03-12 inclusive (telemetry ends at 2026-03-12 23:55 BRT):
- Dec: 19 days (13-31)
- Jan: 31 days
- Feb: 28 days (2026 is not a leap year)
- Mar: 13 days (1-13)
- Total: 91 days

**Note on revenue_daily:** 3 assets x 90 days = 270 (the last day Mar 13 starts at 00:00 BRT but telemetry ends at 00:00 BRT Mar 13, so effectively 90 full days of data from Dec 13 to Mar 12, plus possibly a partial Mar 13).

Actually the generator runs `START=2025-12-13 00:00 BRT` to `END=2026-03-13 00:00 BRT` exclusive, meaning the last timestamp is `2026-03-12 23:55 BRT`. This gives exactly **90 days** of telemetry (Dec 13 through Mar 12). So:
- daily_uptime_snapshots: 90 rows (Dec 13 - Mar 12 inclusive)
- revenue_daily: 270 rows (3 assets x 90 days)
- algorithm_metrics: 90 rows
- asset_5min_metrics: 77,760 (3 x 90 x 288)
- asset_hourly_metrics: 6,480 (3 x 90 x 24)
- Partitions needed: 90 total (83 to create, 7 already exist for Mar 6-12)

---

## 5. Partition Management Detail

### Existing partitions (from DDL):

`asset_5min_metrics_20260306` through `asset_5min_metrics_20260406` (32 partitions)

### Required partitions for demo data:

`asset_5min_metrics_20251213` through `asset_5min_metrics_20260312` (91 partitions total, 83 need creation)

### Partition creation in Python:

```python
from datetime import date, timedelta

start = date(2025, 12, 13)
end = date(2026, 3, 13)  # exclusive (last day of data is Mar 12)

# Get existing partitions
cursor.execute("""
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'asset_5min_metrics_202%'
""")
existing = {row[0] for row in cursor.fetchall()}

current = start
while current < end:
    partition_name = f"asset_5min_metrics_{current.strftime('%Y%m%d')}"
    if partition_name not in existing:
        next_day = current + timedelta(days=1)
        # BRT midnight = UTC 03:00
        cursor.execute(f"""
            CREATE TABLE {partition_name}
                PARTITION OF asset_5min_metrics
                FOR VALUES FROM ('{current.isoformat()} 03:00:00+00')
                             TO ('{next_day.isoformat()} 03:00:00+00')
        """)
        print(f"    Created partition: {partition_name}")
    current += timedelta(days=1)
```

### Index inheritance:

New partitions automatically inherit the parent table's partitioned indexes (`idx_5min_asset_window` and `idx_5min_window`). No explicit index creation needed — PostgreSQL handles this.

---

## 6. Verification Queries

Run after all phases complete:

```python
VERIFICATION_QUERIES = [
    ("asset_5min_metrics",
     "SELECT COUNT(*) FROM asset_5min_metrics WHERE asset_id LIKE 'DEMO-%'",
     77760),
    ("asset_hourly_metrics",
     "SELECT COUNT(*) FROM asset_hourly_metrics WHERE asset_id LIKE 'DEMO-%'",
     6480),
    ("revenue_daily",
     "SELECT COUNT(*) FROM revenue_daily WHERE asset_id LIKE 'DEMO-%'",
     270),
    ("daily_uptime_snapshots",
     "SELECT COUNT(*) FROM daily_uptime_snapshots WHERE org_id = 'ORG_DEMO_001'",
     90),
    ("offline_events (approx)",
     "SELECT COUNT(*) FROM offline_events WHERE org_id = 'ORG_DEMO_001'",
     None),  # ~14, variable
    ("vpp_strategies",
     "SELECT COUNT(*) FROM vpp_strategies WHERE org_id = 'ORG_DEMO_001'",
     3),
    ("algorithm_metrics",
     "SELECT COUNT(*) FROM algorithm_metrics WHERE org_id = 'ORG_DEMO_001'",
     90),
    ("pld_horario",
     "SELECT COUNT(*) FROM pld_horario",
     2160),
    ("trades",
     "SELECT COUNT(*) FROM trades WHERE asset_id LIKE 'DEMO-%'",
     None),  # ~60, variable
    ("dispatch_records (success)",
     "SELECT COUNT(*) FROM dispatch_records WHERE asset_id LIKE 'DEMO-%' AND success = true",
     None),  # ~60, variable
    ("dispatch_commands (completed)",
     "SELECT COUNT(*) FROM dispatch_commands WHERE asset_id LIKE 'DEMO-%' AND status = 'completed'",
     None),  # ~80, variable
]

# Energy conservation check
ENERGY_CHECK = """
SELECT COUNT(*) FROM (
    SELECT asset_id,
        date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
        ABS(
            SUM(load_power / 12.0)
            - (SUM(pv_power / 12.0) - SUM(grid_export_kwh)
               + SUM(GREATEST(0, -battery_power) / 12.0)
               + SUM(grid_import_kwh))
        ) AS error_kwh
    FROM telemetry_history
    WHERE asset_id LIKE 'DEMO-%'
    GROUP BY asset_id, date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo')
    HAVING ABS(
        SUM(load_power / 12.0)
        - (SUM(pv_power / 12.0) - SUM(grid_export_kwh)
           + SUM(GREATEST(0, -battery_power) / 12.0)
           + SUM(grid_import_kwh))
    ) > 0.1
) violations;
-- Expected: 0
"""

# Revenue sanity check
REVENUE_CHECK = """
SELECT COUNT(*) FROM revenue_daily
WHERE asset_id LIKE 'DEMO-%'
  AND client_savings_reais < 0;
-- Expected: 0 (PV+battery always saves money)
"""

# Uptime consistency check
UPTIME_CHECK = """
SELECT COUNT(*) FROM (
    SELECT d.date,
        d.total_assets - d.online_assets AS expected_offline,
        COALESCE(o.cnt, 0) AS actual_offline
    FROM daily_uptime_snapshots d
    LEFT JOIN (
        SELECT (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS date,
            COUNT(*) AS cnt
        FROM offline_events WHERE org_id = 'ORG_DEMO_001'
        GROUP BY (started_at AT TIME ZONE 'America/Sao_Paulo')::date
    ) o ON d.date = o.date
    WHERE d.org_id = 'ORG_DEMO_001'
      AND (d.total_assets - d.online_assets) != COALESCE(o.cnt, 0)
) mismatches;
-- Expected: 0
"""
```

---

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| telemetry_history empty | ABORT with message "No demo telemetry found" |
| Partition creation fails | ROLLBACK; likely a boundary overlap — log and exit |
| INSERT violates unique constraint | Idempotent delete should prevent this; if it happens, ROLLBACK |
| ORG_DEMO_001 not in organizations | ABORT with message "Run demo seed first" |
| dispatch_records empty for DEMO | WARN and skip trades generation |

---

## 8. Dependencies

```
pip install psycopg2-binary
```

No other dependencies. The script uses only:
- `psycopg2` for PostgreSQL
- `random` (stdlib) for deterministic synthetic data
- `datetime` (stdlib) for date manipulation

---

## 9. Runtime Estimate

- Partition creation: ~1s (83 DDL statements)
- asset_5min_metrics: ~5-10s (77K inserts via SELECT)
- asset_hourly_metrics: ~2s (6.5K inserts via SELECT)
- revenue_daily: ~3s (CTE with hourly aggregation)
- pld_horario: ~1s (2.2K inserts via executemany)
- All other tables: <1s each

**Total estimated runtime: 15-20 seconds**
