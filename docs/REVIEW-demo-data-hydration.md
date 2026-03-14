# REVIEW: Demo Data Hydration — Second-Pass Audit

**Date:** 2026-03-14
**Reviewer:** Automated DB schema cross-check
**Docs reviewed:** REQ, DESIGN, PLAN

---

## Summary

| Category | Pass | Fail | Warn |
|----------|------|------|------|
| Column name accuracy | 9 | 0 | 0 |
| NOT NULL / defaults | 10 | 0 | 1 |
| Partition boundaries | 1 | 0 | 0 |
| Date math | 0 | 1 | 1 |
| Idempotency logic | 0 | 2 | 0 |
| FK / constraint safety | 0 | 0 | 2 |
| Row count estimates | 0 | 1 | 1 |
| Formula correctness | 5 | 0 | 1 |

**Total: 3 FAIL, 6 WARN — must fix before implementation.**

---

## Phase 0: Prerequisites

### 0a. Partition creation — PASS

**Verified:** Existing partitions are `asset_5min_metrics_20260306` through `asset_5min_metrics_20260406` (32 partitions). Boundary format confirmed: `FOR VALUES FROM ('YYYY-MM-DD 03:00:00+00') TO ('YYYY-MM-(DD+1) 03:00:00+00')`.

DESIGN uses identical format. 83 missing partitions (2025-12-13 through 2026-03-05) is correct.

Telemetry max timestamp is `2026-03-13 02:55:00+00`, which falls in partition `asset_5min_metrics_20260312` (boundary 03-12 03:00 to 03-13 03:00). That partition exists.

### 0b. Tariff schedule — FAIL (idempotency bug)

**Problem:** The DESIGN Section 7 uses `ON CONFLICT DO NOTHING`, but `tariff_schedules` has **no unique constraint on `org_id`** (only PK on auto-increment `id`). The INSERT will never conflict and will create a duplicate row every run.

**Existing data:** A tariff for `ORG_DEMO_001` already exists (id=3):
```
id=3 | org_id=ORG_DEMO_001 | schedule_name='TOU São Paulo'
peak_start=18:00 | peak_end=21:00 | peak_rate=0.9500
offpeak_rate=0.5500 | feed_in_rate=0.2500 | intermediate_rate=0.7200
intermediate_start=17:00 | intermediate_end=18:00 | disco='Enel SP'
```

**Additional note:** Existing `intermediate_end=18:00` covers only the 17:00-18:00 slot. The 21:00-22:00 intermediate window cannot be represented with a single `intermediate_start/intermediate_end` pair. The DESIGN INSERT sets `intermediate_end='21:59:00'` which would encompass both intermediate AND peak hours, relying on "check peak first" logic. This is a different representation than the existing row.

**Fix required:**
1. Do NOT insert a new tariff. Look up existing tariff id with `SELECT id FROM tariff_schedules WHERE org_id = 'ORG_DEMO_001' LIMIT 1`.
2. Use that id for `tariff_schedule_id` in `revenue_daily` inserts.
3. If no tariff exists, then insert one — but use Python `IF NOT EXISTS` logic, not `ON CONFLICT`.

---

## Phase 1: Tier 1 Tables

### 1a. asset_5min_metrics — PASS

**Schema cross-check:**

| DESIGN column | DB column | DB type | Nullable | Default | Match |
|---------------|-----------|---------|----------|---------|-------|
| asset_id | asset_id | varchar(200) | NOT NULL | — | OK |
| window_start | window_start | timestamptz | NOT NULL | — | OK |
| pv_energy_kwh | pv_energy_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| bat_charge_kwh | bat_charge_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| bat_discharge_kwh | bat_discharge_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| grid_import_kwh | grid_import_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| grid_export_kwh | grid_export_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| load_kwh | load_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| bat_charge_from_grid_kwh | bat_charge_from_grid_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| avg_battery_soc | avg_battery_soc | numeric(5,2) | nullable | — | OK |
| data_points | data_points | integer | NOT NULL | 0 | OK |

- `id`: auto-generated via `nextval('asset_5min_metrics_id_seq')` — correctly omitted from INSERT.
- `created_at`: NOT NULL DEFAULT `now()` — correctly omitted.
- UNIQUE index on `(asset_id, window_start)` — idempotent DELETE handles this.
- All NOT NULL columns either provided in INSERT or have DEFAULT values.

**Telemetry source columns verified:** `pv_power`, `battery_power`, `grid_import_kwh`, `grid_export_kwh`, `load_power`, `battery_soc` all exist in `telemetry_history`.

**Formula check:** `bat_charge_from_grid_kwh = GREATEST(0, charge_energy - pv_energy)` is correct.

### 1b. asset_hourly_metrics — PASS

**Schema cross-check:**

| DESIGN column | DB column | DB type | Nullable | Default | Match |
|---------------|-----------|---------|----------|---------|-------|
| asset_id | asset_id | varchar(200) | NOT NULL | — | OK |
| hour_timestamp | hour_timestamp | timestamptz | NOT NULL | — | OK |
| total_charge_kwh | total_charge_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| total_discharge_kwh | total_discharge_kwh | numeric(10,4) | NOT NULL | 0 | OK |
| data_points_count | data_points_count | integer | NOT NULL | 0 | OK |
| avg_battery_soh | avg_battery_soh | real | nullable | — | OK |
| avg_battery_voltage | avg_battery_voltage | real | nullable | — | OK |
| avg_battery_temperature | avg_battery_temperature | real | nullable | — | OK |

- `id`: auto-generated. `created_at`, `updated_at`: have defaults. Correctly omitted.
- UNIQUE on `(asset_id, hour_timestamp)` — idempotent DELETE handles this.

### 1c. daily_uptime_snapshots — PASS

**Schema cross-check:** All columns in INSERT (`org_id`, `date`, `total_assets`, `online_assets`, `uptime_pct`) exist and match types. `id` auto-generated. `created_at` has default. UNIQUE on `(org_id, date)`.

### 1d. offline_events — PASS

**Schema cross-check:** All columns in INSERT (`asset_id`, `org_id`, `started_at`, `ended_at`, `cause`, `backfill`) exist and match types. `id` auto-generated. `cause` is nullable with default `'unknown'`, `backfill` nullable with default `false`.

**FK note:** `asset_id` references `assets(asset_id)`. All 10 DEMO assets exist in `assets` table. Safe.

---

## Phase 2: Tier 2 Tables

### 2a. revenue_daily — PASS (with warn)

**Schema cross-check:**

| DESIGN column | DB column | DB type | Nullable | Match |
|---------------|-----------|---------|----------|-------|
| asset_id | asset_id | varchar(200) | NOT NULL | OK |
| date | date | date | NOT NULL | OK |
| pv_energy_kwh | pv_energy_kwh | numeric(10,3) | nullable | OK |
| grid_import_kwh | grid_import_kwh | numeric(10,3) | nullable | OK |
| grid_export_kwh | grid_export_kwh | numeric(10,3) | nullable | OK |
| bat_discharged_kwh | bat_discharged_kwh | numeric(10,3) | nullable | OK |
| cost_reais | cost_reais | numeric(12,2) | nullable | OK |
| revenue_reais | revenue_reais | numeric(12,2) | nullable | OK |
| profit_reais | profit_reais | numeric(12,2) | nullable | OK |
| baseline_cost_reais | baseline_cost_reais | numeric(10,2) | nullable | OK |
| actual_cost_reais | actual_cost_reais | numeric(10,2) | nullable | OK |
| client_savings_reais | client_savings_reais | numeric(12,2) | nullable | OK |
| actual_self_consumption_pct | actual_self_consumption_pct | numeric(5,2) | nullable | OK |
| self_sufficiency_pct | self_sufficiency_pct | real | nullable | OK |
| calculated_at | calculated_at | timestamptz | nullable | OK |

- `id`: auto-generated. `created_at` has default. UNIQUE on `(asset_id, date)`.
- `tariff_schedule_id` is nullable with FK to `tariff_schedules(id)`. DESIGN sets it to NULL (implicit omission). **WARN**: Should populate with the existing tariff id (3) for completeness.

### 2b. algorithm_metrics — PASS

**Schema cross-check:** `org_id` (varchar 50, NOT NULL), `date` (date, NOT NULL), `self_consumption_pct` (numeric 5,2, nullable). `id` auto-generated. UNIQUE on `(org_id, date)`.

---

## Phase 3: Tier 3 Tables

### 3a. vpp_strategies — PASS

**Schema cross-check:** All 12 columns in INSERT exist and match types. `discharge_window_end` correctly noted as non-existent. `id` auto-generated. `created_at`/`updated_at` have defaults.

### 3b. pld_horario — PASS

**Schema cross-check:** `mes_referencia` (integer), `dia` (smallint), `hora` (smallint), `submercado` (varchar 10), `pld_hora` (numeric 10,2). All NOT NULL. PK is composite `(mes_referencia, dia, hora, submercado)`. No auto-generated id. DESIGN correctly omits id.

**UNIQUE/PK:** Composite PK means duplicate `(month, day, hour, submercado)` tuples will fail. TRUNCATE or DELETE ALL before INSERT handles this.

### 3c. dispatch_records UPDATE — PASS

**Schema cross-check:** UPDATE targets `actual_power_kw` (numeric 8,3, nullable), `success` (boolean, nullable), `response_latency_ms` (integer, nullable), `error_message` (text, nullable). All columns exist.

**Current state:** 100 rows, all with `success = NULL` (not `false`). DESIGN WHERE clause `success IS NULL OR success = false` correctly covers this.

### 3d. dispatch_commands UPDATE — FAIL (idempotency bug + wrong filter)

**Problem 1 — Wrong status filter after reset:** The PLAN Section 3 idempotency strategy resets dispatch_commands:
```sql
UPDATE SET status='dispatched', completed_at=NULL
WHERE asset_id LIKE 'DEMO-%' AND status IN ('completed','failed')
```
Then DESIGN Section 4.4 selects:
```sql
SELECT ... WHERE asset_id LIKE 'DEMO-%' AND status = 'failed'
```
After the reset, all rows have `status='dispatched'`. The WHERE clause finds **zero rows**. No updates happen.

**Fix:** Change the Phase 3d SELECT to `WHERE status = 'dispatched'` (matching the post-reset state).

**Problem 2 — Row count mismatch:** REQ says "update ~80 of 178 existing rows." Actual count is **163 rows** (all status='failed'). The number 178 in the REQ is wrong.

### 3e. trades — PASS (with warns)

**Schema cross-check:** All columns in INSERT (`asset_id`, `traded_at`, `trade_type`, `energy_kwh`, `price_per_kwh`, `total_reais`) exist. All are NOT NULL. `id` auto-generated. `created_at` has default.

**WARN — Non-INV dispatches:** `dispatch_records` contains rows for ALL 10 demo assets (INV, PV, METER, HVAC — 10 rows each, 100 total). Only INV assets logically dispatch energy (30 rows for 3 INV assets). The script should filter `WHERE asset_id LIKE 'DEMO-%-INV'` when creating trades to avoid nonsensical trades for PV panels and meters. Currently 30 INV dispatch_records exist; ~18 would become successful and generate trades.

**WARN — trade_type logic:** The DESIGN derives trade_type from `actual_power_kw > 0` = sell, else buy. But `dispatch_records.commanded_power_kw` could be negative for charge commands. Verify that the sign convention is consistent with the generator.

---

## Date Math

### Day count — FAIL

**Telemetry range verified:**
- MIN: `2025-12-13 03:00:00+00` (= Dec 13 00:00 BRT)
- MAX: `2026-03-13 02:55:00+00` (= Mar 12 23:55 BRT)
- COUNT: 77,760 rows

**BRT date range:** Dec 13 through Mar 12 inclusive = **90 days**.

Breakdown: Dec 19 + Jan 31 + Feb 28 + Mar 12 = 90.

**DESIGN Section 2.3** says "~91 rows (2025-12-13 to 2026-03-13 inclusive)" — **wrong**. Data does not include Mar 13. Should be 90.

**PLAN Section 4** initially says 91, then self-corrects to 90. The correction is right but the initial statement is confusing and the PLAN Section 5 says "91 partitions total" — should be 90.

**Impact on expected row counts:**
| Table | DESIGN says | Correct |
|-------|------------|---------|
| daily_uptime_snapshots | ~91 | 90 |
| algorithm_metrics | ~91 | 90 |
| pld_horario | ~2,160 | 2,160 (90 x 24, correct number wrong reason) |

### 90 vs 91 days — WARN

The REQ says "90 days" in the problem statement. The PLAN eventually agrees. The DESIGN says 91 in one place. **Standardize to 90 everywhere.**

---

## Partition Boundary Verification — PASS

Existing partition format: `FOR VALUES FROM ('2026-03-06 03:00:00+00') TO ('2026-03-07 03:00:00+00')`

DESIGN format: `FOR VALUES FROM ('2025-12-13 03:00:00+00') TO ('2025-12-14 03:00:00+00')`

Formats match. UTC 03:00 = BRT midnight. Correct.

**Partition coverage:**
- Need: 2025-12-13 through 2026-03-12 = 90 BRT days = 90 partitions
- Exist: 2026-03-06 through 2026-03-12 = 7 of those 90
- Missing: 2025-12-13 through 2026-03-05 = 83 partitions to create
- DESIGN says 83. Correct.

---

## NOT NULL Constraint Violations — PASS

Checked all INSERT statements against NOT NULL columns without defaults:

| Table | NOT NULL columns without defaults | Provided in INSERT? |
|-------|-----------------------------------|-------------------|
| asset_5min_metrics | asset_id, window_start | Yes |
| asset_hourly_metrics | asset_id, hour_timestamp | Yes |
| daily_uptime_snapshots | org_id, date, total_assets, online_assets, uptime_pct | Yes |
| offline_events | asset_id, org_id, started_at | Yes |
| revenue_daily | asset_id, date | Yes |
| algorithm_metrics | org_id, date | Yes |
| vpp_strategies | org_id, strategy_name, target_mode, min_soc, max_soc, is_default, is_active | Yes |
| pld_horario | mes_referencia, dia, hora, submercado, pld_hora | Yes |
| trades | asset_id, traded_at, trade_type, energy_kwh, price_per_kwh, total_reais | Yes |

**WARN:** `asset_5min_metrics` energy columns (`pv_energy_kwh`, etc.) are NOT NULL DEFAULT 0. The INSERT provides computed values via ROUND() which can return NULL if the source column is NULL. If any telemetry row has NULL `pv_power` or `battery_power`, the INSERT will fail. Add `COALESCE(pv_power, 0)`, `COALESCE(battery_power, 0)`, `COALESCE(load_power, 0)` wrappers.

---

## Tariff Schedule Column Names — PASS (with note)

DESIGN Section 7 INSERT columns vs actual schema:

| DESIGN column | Exists | Type match |
|---------------|--------|-----------|
| org_id | Yes | varchar(50) OK |
| schedule_name | Yes | varchar(100) OK |
| peak_start | Yes | time OK |
| peak_end | Yes | time OK |
| peak_rate | Yes | numeric(8,4) OK |
| offpeak_rate | Yes | numeric(8,4) OK |
| feed_in_rate | Yes | numeric(8,4) OK |
| intermediate_rate | Yes | numeric(8,4) OK |
| intermediate_start | Yes | time OK |
| intermediate_end | Yes | time OK |
| disco | Yes | varchar(50) OK |
| currency | Yes | varchar(3) OK |
| effective_from | Yes | date OK |
| billing_power_factor | Yes | numeric(3,2) OK |

All column names match. But as noted in Phase 0b, the INSERT is not needed (tariff already exists) and `ON CONFLICT DO NOTHING` won't work as intended.

---

## Fixes Required (ordered by severity)

### CRITICAL

1. **dispatch_commands Phase 3d filter bug:** Change `WHERE status = 'failed'` to `WHERE status = 'dispatched'` in the post-reset update logic. Without this fix, zero dispatch_commands will be updated to 'completed'.

2. **tariff_schedules idempotency bug:** Replace `INSERT ... ON CONFLICT DO NOTHING` with a Python check: `SELECT id FROM tariff_schedules WHERE org_id = 'ORG_DEMO_001' LIMIT 1`. If exists, use that id. If not, insert and capture returning id. Use the id to populate `revenue_daily.tariff_schedule_id`.

### HIGH

3. **Day count inconsistency:** Standardize to 90 days everywhere. DESIGN Section 2.3 says ~91 for `daily_uptime_snapshots` — change to 90. PLAN Section 5 says "91 partitions total" — change to 90.

4. **dispatch_commands row count:** REQ says 178 rows, actual is 163. Update REQ to match reality.

### MEDIUM

5. **Trades should filter INV-only dispatches:** Add `AND asset_id LIKE 'DEMO-%-INV'` to the successful dispatch_records query that generates trades. Non-INV assets (PV, METER, HVAC) should not have energy trades.

6. **revenue_daily.tariff_schedule_id:** Currently left NULL. Should be populated with the looked-up tariff id for FK completeness.

7. **Null-safety in telemetry-derived INSERTs:** Add `COALESCE(pv_power, 0)`, `COALESCE(battery_power, 0)`, `COALESCE(load_power, 0)` wrappers in the asset_5min_metrics and asset_hourly_metrics INSERTs, in case any telemetry rows have NULL power values.

### LOW

8. **dispatch_commands also needs failure updates:** After reset to 'dispatched', ~45% become 'completed'. The remaining ~55% should be explicitly set to `status = 'failed'` with an error_message, matching the REQ's expectation of "~40% as failed."

9. **Existing tariff intermediate_end mismatch:** The existing tariff has `intermediate_end=18:00` (pre-peak only). The post-peak intermediate window (21:00-22:00) is unrepresentable. Since computation hardcodes rates in SQL CASE statements, this has no functional impact, but it's an inaccuracy in the stored tariff data.

---

## Verification Checklist

| # | Check | Result |
|---|-------|--------|
| 1 | asset_5min_metrics column names match INSERT | PASS |
| 2 | asset_5min_metrics.id is auto-generated | PASS (nextval) |
| 3 | revenue_daily.id is auto-generated | PASS (nextval) |
| 4 | tariff_schedules column names match Section 7 INSERT | PASS |
| 5 | NOT NULL constraints won't fail with NULL values | PASS (warn on NULL source) |
| 6 | pld_horario PK/UNIQUE constraints | PASS (composite PK, TRUNCATE handles) |
| 7 | Partition boundary format matches existing | PASS |
| 8 | Date math: 90 or 91 days | 90 days (DESIGN says 91 in one place — FAIL) |
| 9 | dispatch_records column names for UPDATE | PASS |
| 10 | dispatch_commands column names for UPDATE | PASS |
| 11 | dispatch_commands post-reset filter logic | FAIL (finds 0 rows) |
| 12 | tariff_schedules ON CONFLICT logic | FAIL (no unique constraint) |
| 13 | Energy conservation formula | PASS |
| 14 | Revenue formula breakdown | PASS |
| 15 | Trades from non-INV dispatches | WARN |
