# REQ: Demo Data Hydration — Pipeline-Consistent Seeding

**Date:** 2026-03-14
**Priority:** P1 (blocks demo validation of P4-P6)

---

## 1. Problem Statement

The demo environment has 77,760 rows of raw telemetry data (3 inverters × 90 days × 288 intervals/day) but the downstream pipeline tables are empty. Pages P4 (HEMS), P5 (VPP), and P6 (Performance) show zeros, dashes, and empty sections because they depend on aggregated/computed tables that would normally be populated by M2/M3/M4 cron jobs.

## 2. Existing Data (DO NOT MODIFY)

These tables already have correct data. The hydration script must NOT touch them:

| Table | Rows | Notes |
|-------|------|-------|
| `telemetry_history` | 77,760 | 3 demo INV assets, 2025-12-13 → 2026-03-13, 5min intervals |
| `gateways` | 3 demo | DEMO-GW-5KW, DEMO-GW-10KW, DEMO-GW-50KW (all status='online') |
| `assets` | 10 demo | 3 INV + 3 PV + 3 METER + 1 HVAC |
| `organizations` | 2 | ORG_DEMO_001, ORG_ENERGIA_001 |
| `users` | 2 | admin@solfacil.com.br, alan@xuheng.com |
| `user_org_roles` | 2 | Role mappings |
| `tariff_schedules` | 3 | Enel SP rates (off-peak R$0.55, intermediate R$0.72, peak R$0.95, export R$0.25) |

## 3. Tables to Hydrate (11 tables)

### 3.1 Tier 1 — Derived directly from telemetry_history

#### `asset_5min_metrics` (~77,760 rows)
- **Source:** SELECT from `telemetry_history` WHERE asset_id LIKE 'DEMO%'
- **Logic:** Each 5min telemetry row → 1 metrics row. Decompose energy:
  - `pv_energy_kwh` = pvTotal from telemetry
  - `bat_charge_kwh` = charge from telemetry
  - `bat_discharge_kwh` = discharge from telemetry
  - `grid_import_kwh` = gridImport from telemetry
  - `grid_export_kwh` = gridExport from telemetry
  - `load_kwh` = loadTotal from telemetry
  - `bat_charge_from_grid_kwh` = MAX(0, charge - pvTotal) (estimate)
  - `avg_battery_soc` = soc from telemetry
  - `data_points` = 1
- **Partition:** Uses daily partitions `asset_5min_metrics_YYYYMMDD`

#### `asset_hourly_metrics` (~6,480 rows)
- **Source:** Aggregate from telemetry_history, GROUP BY asset_id, date_trunc('hour', recorded_at)
- **Logic:**
  - `total_charge_kwh` = SUM(charge) for the hour
  - `total_discharge_kwh` = SUM(discharge) for the hour
  - `data_points_count` = COUNT(*)
  - `avg_battery_soh` = AVG(soh) — use 95-98% range, degrading slightly over 90 days
  - `avg_battery_voltage` = AVG(voltage) — 48V nominal, 46-52V range
  - `avg_battery_temperature` = AVG(temp) — 25-35°C, seasonal pattern

#### `daily_uptime_snapshots` (~90 rows)
- **Source:** Count of assets per day. Demo has 10 assets, assume 95%+ uptime
- **Logic:** For each day in range:
  - `org_id` = 'ORG_DEMO_001'
  - `total_assets` = 10
  - `online_assets` = random 9 or 10 (occasional 1 device offline)
  - `uptime_pct` = online_assets / total_assets * 100

#### `offline_events` (~30-50 rows)
- **Source:** Synthetic but consistent with uptime_snapshots
- **Logic:** When daily_uptime < 100%, generate matching offline events
  - Random asset goes offline for 1-6 hours
  - `cause` = one of 'network_timeout', 'gateway_restart', 'inverter_fault', 'firmware_update'
  - Ensure `ended_at - started_at` duration matches the downtime implied by uptime_snapshots

### 3.2 Tier 2 — Derived from Tier 1 + tariffs

#### `revenue_daily` (~270 rows, 3 assets × 90 days)
- **Source:** Aggregate from `asset_hourly_metrics` + `tariff_schedules`
- **Logic per asset per day:**
  - Sum hourly charge/discharge
  - Apply tariff rates based on hour-of-day (BRT = UTC-3):
    - Off-peak (22:00-17:00 BRT): R$0.55/kWh
    - Intermediate (17:00-18:00, 21:00-22:00 BRT): R$0.72/kWh  
    - Peak (18:00-21:00 BRT): R$0.95/kWh
    - Export credit: R$0.25/kWh
  - `pv_energy_kwh` = SUM(pv) for day
  - `grid_import_kwh` = SUM(gridImport) for day
  - `grid_export_kwh` = SUM(gridExport) for day
  - `bat_discharged_kwh` = SUM(discharge) for day
  - `cost_reais` = SUM(grid_import × tariff_rate_for_hour)
  - `revenue_reais` = SUM(grid_export × 0.25)
  - `baseline_cost_reais` = SUM(load × tariff_rate_for_hour) (cost if no PV/battery)
  - `actual_cost_reais` = cost_reais
  - `profit_reais` = revenue_reais - cost_reais
  - `client_savings_reais` = baseline_cost_reais - actual_cost_reais
  - `actual_self_consumption_pct` = (pv_self_use / pv_total) × 100
  - `self_sufficiency_pct` = (1 - grid_import / load) × 100

#### `algorithm_metrics` (~90 rows)
- **Source:** Daily aggregate from `revenue_daily`
- **Logic:**
  - `org_id` = 'ORG_DEMO_001'
  - `self_consumption_pct` = AVG across 3 assets of actual_self_consumption_pct

### 3.3 Tier 3 — VPP/HEMS operational data

#### `vpp_strategies` (3 rows)
- **Logic:** One strategy per gateway:
  - DEMO-GW-5KW: `self_consumption` mode, min_soc=20, max_soc=95
  - DEMO-GW-10KW: `peak_shaving` mode, min_soc=15, max_soc=90
  - DEMO-GW-50KW: `arbitrage` mode, min_soc=10, max_soc=95
  - charge_window: 00:00-06:00 (off-peak), discharge_window: 18:00-21:00 (peak)

#### `pld_horario` (~2,160 rows)
- **Source:** Synthetic Brazilian PLD hourly spot prices
- **Logic:** For each day × 24 hours:
  - `submercado` = 'SE/CO' (Southeast/Central-West)
  - Base price ~R$150/MWh with patterns:
    - Peak hours (18-21h): R$250-350/MWh
    - Off-peak (22-06h): R$80-120/MWh
    - Daytime: R$130-180/MWh
    - Add ±10% random noise

#### `trades` (~270 rows)
- **Source:** From `dispatch_records` that succeeded
- **Logic:** For each successful dispatch:
  - `trade_type` = 'spot_sell' or 'spot_buy'
  - `energy_kwh` = actual dispatched energy
  - `price_per_kwh` = PLD price at that hour / 1000 (MWh → kWh)
  - `total_reais` = energy × price

#### Fix `dispatch_records` (update ~60 of 100 existing rows)
- Set `actual_power_kw` = commanded_power_kw × (0.85 + random×0.15) for ~60%
- Set `success` = true, `response_latency_ms` = 200 + random×800 for those
- Keep ~40% as failed (current state)

#### Fix `dispatch_commands` (update ~80 of 178 existing rows)
- Change status from 'failed' to 'completed' for ~45%
- Set `completed_at` = dispatched_at + interval '2-10 seconds'

## 4. Consistency Rules (CRITICAL)

1. **Energy conservation:** For any time window, `load = pv_self_use + discharge + grid_import` must hold
2. **Revenue math:** `client_savings = baseline_cost - actual_cost` must be positive (PV+battery saves money)
3. **Uptime vs offline_events:** If `daily_uptime_snapshots` says 9/10 online, there must be exactly 1 offline_event for that day
4. **SoC bounds:** Battery SoC must stay within `min_soc` and `max_soc` from `vpp_strategies`
5. **Temporal alignment:** All timestamps must be in UTC, aligned to 5-minute boundaries for telemetry, hourly for aggregates
6. **Timezone:** BRT = UTC-3. Tariff hours are in BRT.
7. **Partitions:** `asset_5min_metrics` uses daily partitions. Rows must go into the correct partition table.

## 5. Deliverable

A single Python script (`scripts/hydrate_demo_data.py`) that:
1. Connects to PostgreSQL (host=localhost, port=5433, db=solfacil_vpp, user=postgres)
2. Reads existing `telemetry_history` for DEMO assets
3. Computes and inserts all 11 tables in dependency order (Tier 1 → 2 → 3)
4. Updates existing `dispatch_records` and `dispatch_commands`
5. Prints row counts for verification
6. Is idempotent (can run multiple times — deletes existing demo data first, re-inserts)

## 6. Verification

After hydration, these queries should return non-zero results:
```sql
SELECT COUNT(*) FROM asset_5min_metrics WHERE asset_id LIKE 'DEMO%';
SELECT COUNT(*) FROM asset_hourly_metrics WHERE asset_id LIKE 'DEMO%';
SELECT COUNT(*) FROM revenue_daily WHERE asset_id LIKE 'DEMO%';
SELECT COUNT(*) FROM daily_uptime_snapshots WHERE org_id = 'ORG_DEMO_001';
SELECT COUNT(*) FROM offline_events WHERE org_id = 'ORG_DEMO_001';
SELECT COUNT(*) FROM vpp_strategies WHERE org_id = 'ORG_DEMO_001';
SELECT COUNT(*) FROM algorithm_metrics WHERE org_id = 'ORG_DEMO_001';
SELECT COUNT(*) FROM pld_horario;
SELECT COUNT(*) FROM trades WHERE asset_id LIKE 'DEMO%';
SELECT COUNT(*) FROM dispatch_records WHERE success = true;
SELECT COUNT(*) FROM dispatch_commands WHERE status = 'completed';
```

## 7. Telemetry Column Reference

From the existing `telemetry_history` data, the `payload` JSONB column contains:
```json
{
  "pvTotal": 1.25,
  "loadTotal": 3.50,
  "gridImport": 1.75,
  "gridExport": 0.50,
  "charge": 0.30,
  "discharge": 0.20,
  "soc": 65.0,
  "pvPower": 5.0,
  "loadPower": 14.0,
  "gridPower": 7.0,
  "batPower": -1.2
}
```

Check actual column names:
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'telemetry_history' ORDER BY ordinal_position;
```
The telemetry may use direct columns (not JSONB). Verify before writing the script.
