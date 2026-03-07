# Database Schema -- v5.16 Peak Shaving Attribution

> **Version**: v5.16
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: 3 tables altered (+8 columns); DO telemetry, demand charge rate, PS savings, MonthlyTrueUp
> **Core Theme**: Peak Shaving savings attribution via counterfactual demand reconstruction

---

## 1. Version History

| Version | Date | Description |
|---------|------|-------------|
| v5.15 | 2026-03-07 | SC/TOU attribution, asset_5min_metrics, dispatch_records.target_mode, assets.allow_export |
| **v5.16** | **2026-03-07** | **Peak Shaving -- DO telemetry, demand charge rate, PS savings, MonthlyTrueUp** |

---

## 2. Complete `migration_v5.16.sql` DDL

```sql
-- ============================================================
-- migration_v5.16.sql -- Peak Shaving Attribution
-- Date: 2026-03-07
-- Prerequisite: migration_v5.15.sql already applied
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. telemetry_history: DO state columns
-- ────────────────────────────────────────────────────────────

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS do0_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS do1_active BOOLEAN;

COMMENT ON COLUMN telemetry_history.do0_active IS
    'Digital Output 0 relay state: true = closed (load shed active), false = open, NULL = no dido message';
COMMENT ON COLUMN telemetry_history.do1_active IS
    'Digital Output 1 relay state: true = closed (load shed active), false = open, NULL = no dido message';

-- ────────────────────────────────────────────────────────────
-- 2. tariff_schedules: demand charge config
-- ────────────────────────────────────────────────────────────

ALTER TABLE tariff_schedules
  ADD COLUMN IF NOT EXISTS demand_charge_rate_per_kva NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS billing_power_factor        NUMERIC(3,2) DEFAULT 0.92;

COMMENT ON COLUMN tariff_schedules.demand_charge_rate_per_kva IS
    'Demand charge rate in R$/kVA for exceeded contracted demand. Set per tariff contract.';
COMMENT ON COLUMN tariff_schedules.billing_power_factor IS
    'Commercial billing power factor (contract value, not measured). Default 0.92 per ANEEL convention.';

-- ────────────────────────────────────────────────────────────
-- 3. revenue_daily: PS attribution columns
-- ────────────────────────────────────────────────────────────

ALTER TABLE revenue_daily
  ADD COLUMN IF NOT EXISTS ps_savings_reais         NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ps_avoided_peak_kva      NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS do_shed_confidence       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS true_up_adjustment_reais NUMERIC(10,2);

COMMENT ON COLUMN revenue_daily.ps_savings_reais IS
    'Daily provisional peak shaving savings in BRL. Counterfactual demand reconstruction.';
COMMENT ON COLUMN revenue_daily.ps_avoided_peak_kva IS
    'Daily peak demand avoided in kVA (counterfactual peak - contracted demand).';
COMMENT ON COLUMN revenue_daily.do_shed_confidence IS
    'Confidence level of DO load shed calculation: high = telemetry present, low = fallback to 0';
COMMENT ON COLUMN revenue_daily.true_up_adjustment_reais IS
    'Monthly true-up adjustment. Written as NEW row on 1st of month. Historical rows NEVER updated.';

COMMIT;
```

---

## 3. `ddl_base.sql` Changes

For each of the 3 altered tables, add the new columns to the existing CREATE TABLE statements:

### 3.1 `telemetry_history`

Add after existing columns (before closing parenthesis):

```sql
    do0_active        BOOLEAN,                          -- v5.16: DO0 relay state
    do1_active        BOOLEAN,                          -- v5.16: DO1 relay state
```

### 3.2 `tariff_schedules`

Add after existing columns:

```sql
    demand_charge_rate_per_kva NUMERIC(8,4),            -- v5.16: R$/kVA demand charge
    billing_power_factor       NUMERIC(3,2) DEFAULT 0.92, -- v5.16: commercial PF
```

### 3.3 `revenue_daily`

Add after `tou_savings_reais` (v5.15):

```sql
    ps_savings_reais         NUMERIC(10,2),             -- v5.16: daily PS savings
    ps_avoided_peak_kva      NUMERIC(8,3),              -- v5.16: avoided demand kVA
    do_shed_confidence       VARCHAR(10),                -- v5.16: 'high' | 'low'
    true_up_adjustment_reais NUMERIC(10,2),             -- v5.16: monthly true-up
```

---

## 4. 15-Minute Demand Window (NO Intermediate Table)

### HARD CONSTRAINT: Do NOT create `asset_15min_demand` table

The 15-minute demand window required by Brazilian billing regulations is computed **inline** using PostgreSQL's `date_bin` function:

```sql
date_bin('15 minutes', window_start, TIMESTAMP '2026-01-01 03:00:00Z') AS window_15min
```

This bins every `asset_5min_metrics.window_start` timestamp into its 15-minute bucket, aligned at 03:00 UTC (BRT midnight).

### Why This Works

- `asset_5min_metrics` is already partitioned daily with BRT-aligned boundaries (03:00 UTC)
- M4's PS billing query filters by a single BRT day, hitting exactly **one partition**
- Within that partition, `date_bin` groups 3 consecutive 5-min windows into each 15-min bucket
- At 50,000 devices x 288 rows/day per partition, the GROUP BY is fast enough

### Why NOT a Separate Table

- Adds schema complexity (DDL, partition management, cron, retention)
- Doubles write I/O (M1 writes 5-min, then something must aggregate to 15-min)
- `date_bin` is a constant-time operation per row -- zero storage overhead
- No query performance benefit: the 5-min partition is already pruned to a single day

### BRT Alignment

The anchor timestamp `2026-01-01 03:00:00Z` ensures 15-min bins align with BRT midnight:
- BRT 00:00 = UTC 03:00 -> first bin of BRT day
- BRT 00:15 = UTC 03:15 -> second bin
- etc.

This matches the billing utility's 15-min demand measurement windows.

---

## 5. DO Telemetry Chain

### Full Chain: MQTT Payload -> DB

```
Xuheng EMS Device
  | MQTT publish (topic: xuheng/+/+/data)
  | payload: { data: { dido: { do: [...] } } }
  |
  v
XuhengAdapter.parse(raw)
  | Extracts: do0Active = (do[0].value === '1')
  |           do1Active = (do[1].value === '1')
  |
  v
ParsedTelemetry
  | do0Active: boolean
  | do1Active: boolean
  |
  v
mqtt-subscriber -> writer
  | INSERT INTO telemetry_history (..., do0_active, do1_active)
  |
  v
telemetry_history
  | do0_active BOOLEAN (NULL when no dido in message)
  | do1_active BOOLEAN (NULL when no dido in message)
```

### Source Payload Format (Confirmed from Device WKRD24070202100141I)

```json
{
  "data": {
    "dido": {
      "do": [
        { "id": "DO0", "gpionum": "/dev/DO1", "type": "DO", "value": "0" },
        { "id": "DO1", "gpionum": "/dev/DO2", "type": "DO", "value": "1" }
      ]
    }
  }
}
```

- Key path: `data.dido.do[]` (not `doList`)
- Value: `"0"` = relay open (not triggered), `"1"` = relay closed (load shed active)
- DI (Digital Input): not used, ignored
- DO0 / DO1: two independent relays, each controlling one load circuit

### Schema Mapping

| MQTT Field | TypeScript Field | DB Column | Type | Semantics |
|------------|-----------------|-----------|------|-----------|
| `data.dido.do[0].value` | `do0Active` | `do0_active` | BOOLEAN | `"1"` -> true, `"0"` -> false |
| `data.dido.do[1].value` | `do1Active` | `do1_active` | BOOLEAN | `"1"` -> true, `"0"` -> false |
| (no dido in message) | `do0Active` (undefined) | `do0_active` | NULL | Non-dido message |

---

## 6. Orphaned Telemetry Fallback Rule

### Scenario

DO triggered (relay closed, load shed active) but the next telemetry message (+3 min) is missing due to network interruption.

### Fallback Behavior

| Condition | `load_shed_kW` | `do_shed_confidence` | Rationale |
|-----------|---------------|---------------------|-----------|
| DO triggered, telemetry present before AND after | `load_before - load_after` | `'high'` | Physical measurement available |
| DO triggered, telemetry missing (before OR after) | `0` | `'low'` | Conservative: never overstate savings |
| No DO transition detected | `0` | `'high'` | No load shed occurred |

### Recovery Path (v6.0)

1. Gateway stores 5-min data locally during network outage
2. On reconnect, gateway sends backfill data to MQTT
3. Backfill data writes to `telemetry_history` (v6.0: UPSERT with new UNIQUE index)
4. `MonthlyTrueUpJob` rescans complete month data, automatically correcting PS savings

### v6.0 Prerequisite

```sql
-- Required for backfill UPSERT (NOT in v5.16 -- gateway backfill not yet implemented)
CREATE UNIQUE INDEX idx_telemetry_asset_recorded ON telemetry_history (asset_id, recorded_at);
```

---

## 7. True-up Auditability Rule

### HARD CONSTRAINT

**Historical daily `ps_savings_reais` rows are NEVER updated.**

The monthly true-up process:
1. Runs on the 1st of each month (or manually triggered)
2. Rescans the full previous month's data
3. Computes the delta between true monthly savings and sum of daily provisionals
4. **INSERTs** a new `revenue_daily` row for the 1st of the month with `true_up_adjustment_reais`
5. Does **NOT** UPDATE any existing rows

### Why This Matters

- Financial audit trail requires immutable historical records
- Regulators and auditors can verify: `SUM(daily_provisionals) + true_up = actual_monthly_savings`
- If a true-up row already exists for a month (re-run), it is **replaced** via UPSERT on `(asset_id, date)` -- but only the true-up row, not the original daily rows

### Revenue Calculation for Reporting

```sql
-- Total PS savings for a period (BFF query):
COALESCE(SUM(ps_savings_reais), 0)
  + COALESCE(SUM(true_up_adjustment_reais), 0) AS total_ps_savings
```

---

## 8. Table Count (Unchanged)

| Category | v5.15 Count | v5.16 Delta | v5.16 Count |
|----------|------------|-------------|-------------|
| M6 Identity | 3 | -- | 3 |
| M1 IoT Hub | 7 | -- | 7 |
| M2 Optimization | 2 | -- | 2 |
| M3 DR Dispatcher | 2 | -- | 2 |
| M4 Market & Billing | 5 | -- | 5 |
| M8 Admin Control | 4 | -- | 4 |
| Housing (v5.12) | 1 | -- | 1 |
| Shared Contract | 1 | -- | 1 |
| **Total** | **25** | **0** | **25** |

No new tables in v5.16. Only ALTER existing tables.

---

## 9. Index Analysis

### No New Indexes Required

- `do0_active` / `do1_active` on `telemetry_history`: accessed via existing `idx_telemetry_asset_time` (filter by asset_id + recorded_at range, then read DO columns)
- `demand_charge_rate_per_kva` / `billing_power_factor` on `tariff_schedules`: accessed via existing index on `(org_id, is_active)`, low-cardinality table
- `ps_savings_reais` / `true_up_adjustment_reais` on `revenue_daily`: accessed via existing `(asset_id, date)` index for UPSERT and BFF queries

---

## 10. Migration Safety Notes

1. **All ALTER TABLE ADD COLUMN use `IF NOT EXISTS`** -- safe to re-run (idempotent)
2. **No table rewrites** -- all new columns are nullable (except `billing_power_factor` which has DEFAULT)
3. **No backfill required** -- existing rows have NULL for new columns, handled by COALESCE in queries
4. **No new tables** -- no partition management overhead added
5. **No index changes** -- existing indexes cover new access patterns
6. **Wrapped in transaction** -- all-or-nothing migration

### COALESCE Rules for New Columns

| Column | COALESCE Default | Used By |
|--------|-----------------|---------|
| `do0_active` | `COALESCE(do0_active, false)` | M4 DO shed calculation |
| `do1_active` | `COALESCE(do1_active, false)` | M4 DO shed calculation |
| `demand_charge_rate_per_kva` | `COALESCE(demand_charge_rate_per_kva, 0)` | M4 PS savings (0 = no savings) |
| `billing_power_factor` | `COALESCE(billing_power_factor, 0.92)` | M4 kW->kVA conversion |
| `ps_savings_reais` | `COALESCE(ps_savings_reais, 0)` | BFF SUM query |
| `ps_avoided_peak_kva` | `COALESCE(ps_avoided_peak_kva, 0)` | BFF display |
| `do_shed_confidence` | NULL (informational only) | BFF display / audit |
| `true_up_adjustment_reais` | `COALESCE(true_up_adjustment_reais, 0)` | BFF total PS calc |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.4 | 2026-02-27 | PostgreSQL full adoption -- 19 initial tables |
| v5.5 | 2026-02-28 | revenue_daily dual-layer columns |
| v5.7 | 2026-02-28 | pld_horario import |
| v5.8 | 2026-03-02 | asset_hourly_metrics Data Contract |
| v5.10 | 2026-03-05 | RLS Scope Formalization |
| v5.11 | 2026-03-05 | DDL Fix -- RLS scope |
| v5.13 | 2026-03-05 | CREATE ems_health + ALTER asset_hourly_metrics +6 cols; 23->24 tables |
| v5.14 | 2026-03-06 | ALTER 4 tables +15 cols (telemetry deep + DP billing + DP params) |
| v5.15 | 2026-03-07 | CREATE asset_5min_metrics (PARTITION BY RANGE daily); ALTER dispatch_records +target_mode; ALTER assets +allow_export; ALTER homes +contracted_demand_kw; ALTER revenue_daily +sc/tou; 24->25 tables |
| v5.15-R1 | 2026-03-07 | Defence patches: partition pre-creation buffer, UTC-first billing, NULL fallback |
| **v5.16** | **2026-03-07** | **ALTER telemetry_history +do0_active +do1_active; ALTER tariff_schedules +demand_charge_rate_per_kva +billing_power_factor; ALTER revenue_daily +ps_savings_reais +ps_avoided_peak_kva +do_shed_confidence +true_up_adjustment_reais; 0 new tables; date_bin 15-min demand (no intermediate table); DO telemetry chain; orphan fallback; true-up auditability** |
