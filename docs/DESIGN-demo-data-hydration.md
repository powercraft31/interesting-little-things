# DESIGN: Demo Data Hydration

**Date:** 2026-03-14
**Prereq:** REQ-demo-data-hydration.md

---

## 1. Source Data: telemetry_history Column Mapping

The REQ document references a JSONB `payload` column. **This is incorrect.** The actual `telemetry_history` table uses direct columns:

| Column | Type | Unit | Meaning |
|--------|------|------|---------|
| `pv_power` | numeric(8,3) | kW | Instantaneous PV generation power |
| `load_power` | numeric(8,3) | kW | Instantaneous load power |
| `battery_power` | numeric(8,3) | kW | Battery power (+charge, -discharge) |
| `grid_power_kw` | numeric(8,3) | kW | Grid power (+import, -export) |
| `grid_import_kwh` | numeric(10,3) | kWh | Energy imported from grid in this 5min interval |
| `grid_export_kwh` | numeric(10,3) | kWh | Energy exported to grid in this 5min interval |
| `battery_soc` | numeric(5,2) | % | State of charge |
| `battery_soh` | real | % | State of health |
| `battery_voltage` | real | V | Battery voltage |
| `battery_temperature` | real | C | Battery temperature |
| `daily_charge_kwh` | numeric(10,3) | kWh | Cumulative daily charge energy |
| `daily_discharge_kwh` | numeric(10,3) | kWh | Cumulative daily discharge energy |
| `pv_daily_energy_kwh` | numeric(10,3) | kWh | Cumulative daily PV energy |

### Energy Derivation from Telemetry

The generator (`generate_demo_telemetry_v2.py`) confirms:

- `grid_import_kwh = MAX(0, grid_power_kw) / 12` — already per-5min energy (kWh)
- `grid_export_kwh = MAX(0, -grid_power_kw) / 12` — already per-5min energy (kWh)
- `battery_power > 0` = charging; `battery_power < 0` = discharging
- 5min charge energy = `MAX(0, battery_power) / 12`
- 5min discharge energy = `MAX(0, -battery_power) / 12`
- 5min PV energy = `pv_power / 12`
- 5min load energy = `load_power / 12`

**Conversion factor: power (kW) x (5min / 60min) = power / 12 = energy (kWh)**

### Asset IDs in telemetry_history

- `DEMO-GW-5KW-INV` (Casa Ribeiro, 5kW residential)
- `DEMO-GW-10KW-INV` (Cafe Aurora, 10kW commercial)
- `DEMO-GW-50KW-INV` (Galpao Estrela, 50kW industrial)

### Gateway-to-Asset Mapping

| Gateway | INV Asset | Org |
|---------|-----------|-----|
| DEMO-GW-5KW | DEMO-GW-5KW-INV | ORG_DEMO_001 |
| DEMO-GW-10KW | DEMO-GW-10KW-INV | ORG_DEMO_001 |
| DEMO-GW-50KW | DEMO-GW-50KW-INV | ORG_DEMO_001 |

---

## 2. Tier 1 Table Derivations

### 2.1 asset_5min_metrics

**Target:** ~77,760 rows (1:1 with telemetry_history)

```sql
INSERT INTO asset_5min_metrics (
    asset_id, window_start,
    pv_energy_kwh, bat_charge_kwh, bat_discharge_kwh,
    grid_import_kwh, grid_export_kwh, load_kwh,
    bat_charge_from_grid_kwh, avg_battery_soc, data_points
)
SELECT
    asset_id,
    recorded_at AS window_start,
    ROUND(COALESCE(pv_power, 0) / 12.0, 4)             AS pv_energy_kwh,
    ROUND(GREATEST(0, COALESCE(battery_power, 0)) / 12.0, 4) AS bat_charge_kwh,
    ROUND(GREATEST(0, -COALESCE(battery_power, 0)) / 12.0, 4) AS bat_discharge_kwh,
    ROUND(COALESCE(grid_import_kwh, 0), 4)              AS grid_import_kwh,
    ROUND(COALESCE(grid_export_kwh, 0), 4)              AS grid_export_kwh,
    ROUND(COALESCE(load_power, 0) / 12.0, 4)            AS load_kwh,
    ROUND(GREATEST(0,
        GREATEST(0, COALESCE(battery_power, 0)) / 12.0
        - COALESCE(pv_power, 0) / 12.0
    ), 4)                                               AS bat_charge_from_grid_kwh,
    battery_soc                                         AS avg_battery_soc,
    1                                                   AS data_points
FROM telemetry_history
WHERE asset_id LIKE 'DEMO-%';
```

**Formula notes:**
- `bat_charge_from_grid_kwh` = MAX(0, charge_energy - pv_energy). When battery charges more than PV produces, the excess must come from the grid.
- All energy values are per-5min interval, derived from instantaneous power / 12.
- `grid_import_kwh` and `grid_export_kwh` are read directly (already in kWh per 5min).

#### CRITICAL: Partition Gap

Existing partitions cover **2026-03-06 through 2026-04-06** only. Demo data spans **2025-12-13 to 2026-03-13**.

**Missing partitions: 2025-12-13 through 2026-03-05 = 83 daily partitions.**

Partition boundaries use server timezone offset (+08 in pg_dump, which maps to BRT midnight = UTC 03:00 = +08 11:00). The script must dynamically create missing partitions:

```sql
-- Pattern for each missing day (example: 2025-12-13)
-- Boundaries: BRT midnight = UTC 03:00
CREATE TABLE IF NOT EXISTS asset_5min_metrics_20251213
    PARTITION OF asset_5min_metrics
    FOR VALUES FROM ('2025-12-13 03:00:00+00') TO ('2025-12-14 03:00:00+00');
```

**The script must:**
1. Query existing partitions: `SELECT tablename FROM pg_tables WHERE tablename LIKE 'asset_5min_metrics_2025%' OR tablename LIKE 'asset_5min_metrics_20260%'`
2. For each day from 2025-12-13 to 2026-03-05, create partition if not exists
3. Use UTC boundaries: `YYYY-MM-DD 03:00:00+00` (= BRT midnight)

### 2.2 asset_hourly_metrics

**Target:** ~6,480 rows (3 assets x 90 days x 24 hours)

```sql
INSERT INTO asset_hourly_metrics (
    asset_id, hour_timestamp,
    total_charge_kwh, total_discharge_kwh,
    data_points_count,
    avg_battery_soh, avg_battery_voltage, avg_battery_temperature
)
SELECT
    asset_id,
    date_trunc('hour', recorded_at)                     AS hour_timestamp,
    ROUND(SUM(GREATEST(0, COALESCE(battery_power, 0)) / 12.0)::numeric, 4)
                                                        AS total_charge_kwh,
    ROUND(SUM(GREATEST(0, -COALESCE(battery_power, 0)) / 12.0)::numeric, 4)
                                                        AS total_discharge_kwh,
    COUNT(*)                                            AS data_points_count,
    ROUND(AVG(battery_soh)::numeric, 1)                 AS avg_battery_soh,
    ROUND(AVG(battery_voltage)::numeric, 1)             AS avg_battery_voltage,
    ROUND(AVG(battery_temperature)::numeric, 1)         AS avg_battery_temperature
FROM telemetry_history
WHERE asset_id LIKE 'DEMO-%'
GROUP BY asset_id, date_trunc('hour', recorded_at);
```

**Expected `data_points_count`:** 12 per hour (one every 5 minutes). BRT doesn't observe DST since 2019, so always 12.

### 2.3 daily_uptime_snapshots

**Target:** 90 rows (2025-12-13 to 2026-03-12 inclusive, matching telemetry range)

```python
# Python logic (requires deterministic randomization)
import random

rng = random.Random(42)  # deterministic seed
for day in date_range(2025-12-13, 2026-03-13):
    # 85% chance all 10 online, 15% chance 1 offline
    if rng.random() < 0.15:
        online = 9
    else:
        online = 10
    uptime_pct = online / 10.0 * 100

    INSERT INTO daily_uptime_snapshots (org_id, date, total_assets, online_assets, uptime_pct)
    VALUES ('ORG_DEMO_001', day, 10, online, uptime_pct);
```

### 2.4 offline_events

**Target:** ~14 rows (matching days where uptime < 100%)

```python
# For each day where online_assets = 9 (from daily_uptime_snapshots):
DEMO_ASSETS = [
    'DEMO-GW-5KW-INV', 'DEMO-GW-5KW-PV', 'DEMO-GW-5KW-METER',
    'DEMO-GW-10KW-INV', 'DEMO-GW-10KW-PV', 'DEMO-GW-10KW-METER',
    'DEMO-GW-50KW-INV', 'DEMO-GW-50KW-PV', 'DEMO-GW-50KW-METER',
    'DEMO-GW-50KW-HVAC'
]
CAUSES = ['network_timeout', 'gateway_restart', 'inverter_fault', 'firmware_update']

for day in days_with_downtime:
    asset = rng.choice(DEMO_ASSETS)
    cause = rng.choice(CAUSES)
    duration_hours = rng.uniform(1, 6)
    start_hour = rng.randint(0, 23 - int(duration_hours))
    started_at = day + timedelta(hours=start_hour)  # in UTC
    ended_at = started_at + timedelta(hours=duration_hours)

    INSERT INTO offline_events (asset_id, org_id, started_at, ended_at, cause, backfill)
    VALUES (asset, 'ORG_DEMO_001', started_at, ended_at, cause, false);
```

**Consistency rule:** Number of offline_events per day MUST equal `(10 - online_assets)` from daily_uptime_snapshots for that day.

---

## 3. Tier 2 Table Derivations

### 3.1 Tariff Rate Mapping

The demo uses Enel SP tariff (per REQ):

| Period | BRT Hours | Rate (R$/kWh) |
|--------|-----------|---------------|
| Off-peak | 22:00-17:00 | 0.55 |
| Intermediate | 17:00-18:00, 21:00-22:00 | 0.72 |
| Peak | 18:00-21:00 | 0.95 |
| Export credit | All hours | 0.25 |

**BRT conversion:** BRT = UTC-3. So:
- Peak 18:00-21:00 BRT = 21:00-00:00 UTC
- Intermediate 17:00-18:00 BRT = 20:00-21:00 UTC; 21:00-22:00 BRT = 00:00-01:00 UTC (next day)
- Off-peak: all other hours

```python
def get_tariff_rate(brt_hour: int) -> float:
    """Map BRT hour to tariff rate."""
    if 18 <= brt_hour < 21:
        return 0.95   # peak
    elif 17 <= brt_hour < 18 or 21 <= brt_hour < 22:
        return 0.72   # intermediate
    else:
        return 0.55   # off-peak
```

**Tariff schedule ID:** Must look up existing `tariff_schedules` for ORG_DEMO_001. If none exists, the script should create one matching the Enel SP rates.

### 3.2 revenue_daily

**Target:** ~270 rows (3 assets x 90 days)

Derived from hourly aggregation of telemetry + tariff rates:

```sql
-- Step 1: Hourly aggregation with tariff rate
WITH hourly AS (
    SELECT
        asset_id,
        (recorded_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        EXTRACT(HOUR FROM recorded_at AT TIME ZONE 'America/Sao_Paulo') AS brt_hour,
        SUM(pv_power / 12.0)                     AS pv_kwh,
        SUM(grid_import_kwh)                     AS import_kwh,
        SUM(grid_export_kwh)                     AS export_kwh,
        SUM(GREATEST(0, -battery_power) / 12.0)  AS discharge_kwh,
        SUM(load_power / 12.0)                   AS load_kwh
    FROM telemetry_history
    WHERE asset_id LIKE 'DEMO-%'
    GROUP BY asset_id,
             (recorded_at AT TIME ZONE 'America/Sao_Paulo')::date,
             EXTRACT(HOUR FROM recorded_at AT TIME ZONE 'America/Sao_Paulo')
),
daily AS (
    SELECT
        asset_id, day,
        SUM(pv_kwh)                              AS pv_energy_kwh,
        SUM(import_kwh)                          AS grid_import_kwh,
        SUM(export_kwh)                          AS grid_export_kwh,
        SUM(discharge_kwh)                       AS bat_discharged_kwh,
        SUM(load_kwh)                            AS load_kwh,
        -- Cost of grid imports, weighted by tariff rate per hour
        SUM(import_kwh * CASE
            WHEN brt_hour >= 18 AND brt_hour < 21 THEN 0.95
            WHEN brt_hour >= 17 AND brt_hour < 18 THEN 0.72
            WHEN brt_hour >= 21 AND brt_hour < 22 THEN 0.72
            ELSE 0.55
        END)                                     AS cost_reais,
        -- Revenue from exports
        SUM(export_kwh) * 0.25                   AS revenue_reais,
        -- Baseline: what it would cost if ALL load came from grid
        SUM(load_kwh * CASE
            WHEN brt_hour >= 18 AND brt_hour < 21 THEN 0.95
            WHEN brt_hour >= 17 AND brt_hour < 18 THEN 0.72
            WHEN brt_hour >= 21 AND brt_hour < 22 THEN 0.72
            ELSE 0.55
        END)                                     AS baseline_cost_reais,
        -- PV self-consumption = PV total - export
        SUM(pv_kwh) - SUM(export_kwh)            AS pv_self_use_kwh
    FROM hourly
    GROUP BY asset_id, day
)
-- Step 2: Insert with derived columns
INSERT INTO revenue_daily (
    asset_id, date,
    pv_energy_kwh, grid_import_kwh, grid_export_kwh, bat_discharged_kwh,
    cost_reais, revenue_reais, profit_reais,
    baseline_cost_reais, actual_cost_reais, client_savings_reais,
    actual_self_consumption_pct, self_sufficiency_pct,
    calculated_at
)
SELECT
    asset_id, day,
    ROUND(pv_energy_kwh, 3),
    ROUND(grid_import_kwh, 3),
    ROUND(grid_export_kwh, 3),
    ROUND(bat_discharged_kwh, 3),
    ROUND(cost_reais, 2),
    ROUND(revenue_reais, 2),
    ROUND(revenue_reais - cost_reais, 2)                 AS profit_reais,
    ROUND(baseline_cost_reais, 2),
    ROUND(cost_reais, 2)                                 AS actual_cost_reais,
    ROUND(baseline_cost_reais - cost_reais, 2)           AS client_savings_reais,
    ROUND(CASE WHEN pv_energy_kwh > 0
        THEN (pv_self_use_kwh / pv_energy_kwh) * 100
        ELSE 0 END, 2)                                   AS actual_self_consumption_pct,
    ROUND(CASE WHEN load_kwh > 0
        THEN (1 - grid_import_kwh / load_kwh) * 100
        ELSE 0 END, 2)::real                             AS self_sufficiency_pct,
    tariff_id,  -- looked up from tariff_schedules (see Section 7)
    NOW()
FROM daily;
```

**NOTE:** `tariff_schedule_id` must be populated with the looked-up tariff id, not left NULL.

**Revenue formula breakdown:**
- `cost_reais` = SUM(grid_import per hour x tariff_rate per hour) — actual cost of electricity purchased
- `revenue_reais` = total_grid_export x 0.25 — feed-in credit for exported energy
- `baseline_cost_reais` = SUM(load per hour x tariff_rate per hour) — hypothetical cost without PV/battery
- `actual_cost_reais` = cost_reais (same value)
- `client_savings_reais` = baseline_cost - actual_cost (always positive with PV)
- `profit_reais` = revenue - cost (can be negative; net of export credits vs import costs)
- `actual_self_consumption_pct` = (PV_total - export) / PV_total x 100
- `self_sufficiency_pct` = (1 - grid_import / load) x 100

**Columns set to NULL:**
- `vpp_arbitrage_profit_reais` — calculated separately from trades
- `tariff_schedule_id` — looked up from tariff_schedules
- `best_tou_cost_reais`, `sc_savings_reais`, `tou_savings_reais`, `ps_savings_reais`, `ps_avoided_peak_kva`, `do_shed_confidence`, `true_up_adjustment_reais` — P6 features, not in scope

### 3.3 algorithm_metrics

**Target:** ~91 rows (1 per day for ORG_DEMO_001)

```sql
INSERT INTO algorithm_metrics (org_id, date, self_consumption_pct)
SELECT
    'ORG_DEMO_001',
    date,
    ROUND(AVG(actual_self_consumption_pct), 2)
FROM revenue_daily
WHERE asset_id LIKE 'DEMO-%'
GROUP BY date;
```

---

## 4. Tier 3 Table Derivations

### 4.1 vpp_strategies

**Target:** 3 rows

The `vpp_strategies` table has no `gateway_id` column — strategies are org-level with unique names.

```sql
INSERT INTO vpp_strategies (
    org_id, strategy_name, target_mode,
    min_soc, max_soc,
    charge_window_start, charge_window_end,
    discharge_window_start,
    max_charge_rate_kw, target_self_consumption_pct,
    is_default, is_active
) VALUES
    ('ORG_DEMO_001', 'Casa Ribeiro Self-Consumption',
     'self_consumption', 20, 95,
     '00:00', '06:00', '18:00',
     5.0, 85.0, true, true),
    ('ORG_DEMO_001', 'Cafe Aurora Peak Shaving',
     'peak_shaving', 15, 90,
     '00:00', '06:00', '18:00',
     10.0, 75.0, false, true),
    ('ORG_DEMO_001', 'Galpao Estrela Arbitrage',
     'arbitrage', 10, 95,
     '00:00', '06:00', '18:00',
     50.0, 70.0, false, true);
```

**Note:** `discharge_window_end` column does not exist in the schema. Only `discharge_window_start` is available. The discharge window end is implied by the tariff schedule (peak ends at 21:00 BRT).

### 4.2 pld_horario

**Target:** ~2,160 rows (90 days x 24 hours)

The `pld_horario` table has this structure:
- `mes_referencia` (integer): YYYYMM format (e.g., 202512)
- `dia` (smallint): day of month (1-31)
- `hora` (smallint): hour (0-23), in BRT
- `submercado` (varchar 10): always 'SE/CO'
- `pld_hora` (numeric 10,2): R$/MWh

**PLD price generation algorithm:**

```python
def generate_pld_price(hour: int, day_seed: int) -> float:
    """Generate realistic Brazilian PLD spot price in R$/MWh.
    hour is in BRT (0-23)."""
    rng = random.Random(day_seed * 100 + hour)

    if 18 <= hour < 21:           # Peak
        base = 300.0
        noise_range = 50.0       # 250-350 R$/MWh
    elif hour >= 22 or hour < 6:  # Off-peak night
        base = 100.0
        noise_range = 20.0       # 80-120 R$/MWh
    else:                         # Daytime
        base = 155.0
        noise_range = 25.0       # 130-180 R$/MWh

    return round(base + rng.uniform(-noise_range, noise_range), 2)
```

### 4.3 dispatch_records (UPDATE existing)

**Target:** Update ~60 of ~100 existing rows

```python
# Fetch existing dispatch_records for DEMO assets
rows = SELECT id, commanded_power_kw FROM dispatch_records
       WHERE asset_id LIKE 'DEMO-%' AND (success IS NULL OR success = false);

rng = random.Random(123)
for row in rows:
    if rng.random() < 0.60:
        actual = row.commanded_power_kw * (0.85 + rng.random() * 0.15)
        latency = 200 + int(rng.random() * 800)
        UPDATE dispatch_records SET
            actual_power_kw = actual,
            success = true,
            response_latency_ms = latency
        WHERE id = row.id;
    else:
        UPDATE dispatch_records SET
            success = false,
            error_message = rng.choice([
                'timeout', 'inverter_comm_error',
                'soc_below_minimum', 'grid_fault_detected'
            ])
        WHERE id = row.id;
```

### 4.4 dispatch_commands (UPDATE existing)

**Target:** Update ~80 of ~178 existing rows

```python
# IMPORTANT: After idempotent reset (status → 'dispatched'), select from 'dispatched'
rows = SELECT id, dispatched_at FROM dispatch_commands
       WHERE asset_id LIKE 'DEMO-%' AND status = 'dispatched';

rng = random.Random(456)
for row in rows:
    if rng.random() < 0.45:
        delay_seconds = 2 + rng.random() * 8
        UPDATE dispatch_commands SET
            status = 'completed',
            completed_at = dispatched_at + interval '{delay_seconds} seconds'
        WHERE id = row.id;
    else:
        UPDATE dispatch_commands SET
            status = 'failed',
            error_message = rng.choice(['timeout', 'inverter_offline', 'soc_below_minimum', 'grid_fault'])
        WHERE id = row.id;
```

### 4.5 trades

**Target:** ~60 rows (one per successful dispatch_record)

```python
# For each successful dispatch_record (INV assets only — PV/METER/HVAC don't trade energy):
# Filter: WHERE asset_id LIKE 'DEMO-%-INV' AND success = true
for rec in successful_inv_dispatch_records:
    brt_time = rec.dispatched_at - timedelta(hours=3)  # UTC to BRT
    brt_hour = brt_time.hour
    pld_price = lookup_pld_horario(rec.dispatched_at)  # R$/MWh

    if rec.actual_power_kw > 0:  # discharge = sell to grid
        trade_type = 'spot_sell'
        energy_kwh = rec.actual_power_kw / 12.0  # 5min dispatch
    else:
        trade_type = 'spot_buy'
        energy_kwh = abs(rec.actual_power_kw) / 12.0

    price_per_kwh = pld_price / 1000.0  # MWh to kWh
    total_reais = energy_kwh * price_per_kwh

    INSERT INTO trades (asset_id, traded_at, trade_type, energy_kwh, price_per_kwh, total_reais)
    VALUES (rec.asset_id, rec.dispatched_at, trade_type, energy_kwh, price_per_kwh, total_reais);
```

---

## 5. Energy Conservation Validation

### Invariant: load = pv_self_use + discharge + grid_import

At the 5-minute level:
```
load_power / 12 = (pv_power / 12 - grid_export_kwh) + GREATEST(0, -battery_power) / 12 + grid_import_kwh
```

From the generator:
```
grid_power = load - pv + bat_power
grid_import = MAX(0, grid_power) / 12
grid_export = MAX(0, -grid_power) / 12
```

**Validation query:**
```sql
SELECT
    asset_id,
    date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
    ROUND(SUM(load_power / 12.0)::numeric, 2)                       AS total_load,
    ROUND((
        SUM(pv_power / 12.0)
        - SUM(grid_export_kwh)
        + SUM(GREATEST(0, -battery_power) / 12.0)
        + SUM(grid_import_kwh)
    )::numeric, 2)                                                    AS reconstructed_load,
    ROUND(ABS(
        SUM(load_power / 12.0)
        - (SUM(pv_power / 12.0) - SUM(grid_export_kwh)
           + SUM(GREATEST(0, -battery_power) / 12.0)
           + SUM(grid_import_kwh))
    )::numeric, 4)                                                    AS error_kwh
FROM telemetry_history
WHERE asset_id LIKE 'DEMO-%'
GROUP BY asset_id, date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo')
HAVING ABS(
    SUM(load_power / 12.0)
    - (SUM(pv_power / 12.0) - SUM(grid_export_kwh)
       + SUM(GREATEST(0, -battery_power) / 12.0)
       + SUM(grid_import_kwh))
) > 0.1
ORDER BY error_kwh DESC;
```

Expected: 0 rows (or negligible rounding error < 0.1 kWh/day).

### Revenue math validation

```sql
SELECT asset_id, date,
    client_savings_reais,
    baseline_cost_reais - actual_cost_reais AS recomputed_savings,
    baseline_cost_reais, actual_cost_reais
FROM revenue_daily
WHERE asset_id LIKE 'DEMO-%'
  AND client_savings_reais < 0;
-- Expected: 0 rows (PV+battery always saves money vs baseline)
```

### Uptime vs offline consistency

```sql
SELECT d.date, d.online_assets, d.total_assets,
    d.total_assets - d.online_assets AS expected_offline,
    COALESCE(o.actual_offline, 0) AS actual_offline
FROM daily_uptime_snapshots d
LEFT JOIN (
    SELECT started_at::date AS date, COUNT(*) AS actual_offline
    FROM offline_events
    WHERE org_id = 'ORG_DEMO_001'
    GROUP BY started_at::date
) o ON d.date = o.date
WHERE d.org_id = 'ORG_DEMO_001'
  AND (d.total_assets - d.online_assets) != COALESCE(o.actual_offline, 0);
-- Expected: 0 rows
```

---

## 6. Timezone Handling

- All timestamps in the database are `timestamptz` (stored as UTC internally)
- Tariff hours are defined in BRT (UTC-3)
- Brazil (Sao Paulo) has NOT observed DST since 2019; BRT is always UTC-3
- When grouping by day for revenue, use `AT TIME ZONE 'America/Sao_Paulo'`
- PLD `hora` values are in BRT hours (0-23)
- Partition boundaries: BRT midnight = `YYYY-MM-DD 03:00:00+00` UTC

---

## 7. Tariff Schedule Prerequisite

The REQ references tariff rates for ORG_DEMO_001 (off-peak R$0.55, peak R$0.95, intermediate R$0.72, export R$0.25). The existing seed only has tariffs for ORG_ENERGIA_001 with different rates.

**The hydration script must look up the existing tariff for ORG_DEMO_001:**

```python
# Look up existing tariff (already seeded as id=3, 'TOU São Paulo')
cursor.execute("SELECT id FROM tariff_schedules WHERE org_id = 'ORG_DEMO_001' LIMIT 1")
row = cursor.fetchone()
if row:
    tariff_id = row[0]
else:
    # Only create if missing
    cursor.execute("""
        INSERT INTO tariff_schedules (
            org_id, schedule_name,
            peak_start, peak_end, peak_rate, offpeak_rate,
            feed_in_rate, intermediate_rate,
            intermediate_start, intermediate_end,
            disco, currency, effective_from, billing_power_factor
        ) VALUES (
            'ORG_DEMO_001', 'Enel SP Residencial TOU',
            '18:00:00', '20:59:00', 0.9500, 0.5500,
            0.2500, 0.7200,
            '17:00:00', '21:59:00',
            'Enel SP', 'BRL', '2025-01-01', 0.92
        ) RETURNING id
    """)
    tariff_id = cursor.fetchone()[0]
# Use tariff_id to populate revenue_daily.tariff_schedule_id
```

**IMPORTANT:** Do NOT use `ON CONFLICT DO NOTHING` — tariff_schedules has no unique constraint on org_id. Use Python-level check instead.
