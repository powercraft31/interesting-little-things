# Task: v5.13 Design Documents — Data Pipeline & Deterministic Math

## Context

You are writing design documents for SOLFACIL VPP v5.13. This version has TWO blocks:

- **Block 1 (Data Pipeline):** M1 IoT Hub gains an MQTT subscriber that parses Xuheng EMS telemetry and writes to PostgreSQL.
- **Block 2 (Deterministic Math):** Wire up real SQL-based formulas in the aggregator and BFF, replacing hardcoded values with Tarifa Branca C-side savings calculations.

After v5.13, the code will be **ready** for live MQTT data — but actual live subscription is v6.0's scope.

### Business Context (from SOLFACIL_VPP_Implementation_v1.0)

SOLFACIL is a fintech (not a power operator). The VPP platform has 4 use cases:
1. **Peak Valley Arbitrage** — Tarifa Branca C-side savings (charge off-peak R$0.25/kWh, discharge peak R$0.82/kWh). **Legal today.**
2. **Demand Response** — DR subsidies. **Not yet regulated (2028+).**
3. **Self-Consumption** — Maximize PV self-use ratio. **Legal today.**
4. **Peak Shaving** — Avoid demand charge penalties. **Legal today.**

**Critical distinction:** Today's "arbitrage" is Tarifa Branca C-side electricity bill savings (ANEEL retail rates), NOT CCEE PLD wholesale market arbitrage. CCEE PLD is for 2028+ when regulations open up. The `pld_horario` table exists as future-proofing.

**Optimization Alpha** = actual savings / theoretical max savings × 100. This is deterministic: both terms are computable from telemetry data + Tarifa Branca rate schedule. No ML needed.

## What to Produce

Create these design files in `design/backend_architecture/`:

1. `00_MASTER_ARCHITECTURE_v5.13.md` — Overview of both blocks, module impact map, version delta from v5.12
2. `01_IOT_HUB_MODULE_v5.13.md` — Block 1: MQTT subscriber + XuhengAdapter integration into M1
3. `04_MARKET_BILLING_MODULE_v5.13.md` — Block 2: Revenue/savings formulas using Tarifa Branca rates × real aggregated data. Include Optimization Alpha calculation.
4. `05_BFF_MODULE_v5.13.md` — Block 2: Which endpoints switch from hardcoded to real SQL. Declare App Pool isolation constraints.
5. `09_SHARED_LAYER_v5.13.md` — Standardized telemetry payload types, shared pure functions, Tarifa Branca rate constants
6. `10_DATABASE_SCHEMA_v5.13.md` — Schema changes (asset_hourly_metrics column additions, indexes) + seed_v5.13.sql strategy with Xuheng MSG#4 mock samples

## Block 1 Technical Details — M1 MQTT Adapter

### Input Format (from Xuheng EMS hardware)

MQTT Topic: `xuheng/+/+/data` (on EMQX broker, port 1883, publicly accessible)

The device sends 5 message types. **MSG#4 is the energy data we need:**

```json
{
  "clientId": "WKRD24070202100141I",
  "productKey": "ems",
  "timeStamp": "1772620029130",
  "data": {
    "batList": [{ "deviceSn": "...", "properties": {
      "total_bat_soc": "60", "total_bat_power": "60",
      "total_bat_dailyChargedEnergy": "60", "total_bat_dailyDischargedEnergy": "60"
    }}],
    "pvList": [{ "deviceSn": "...", "properties": {
      "pv_totalPower": "60", "pv_dailyEnergy": "60"
    }}],
    "gridList": [{ "deviceSn": "...", "properties": {
      "grid_totalActivePower": "60", "grid_dailyBuyEnergy": "60", "grid_dailySellEnergy": "60"
    }}],
    "loadList": [{ "deviceSn": "...", "properties": {
      "load1_totalPower": "60"
    }}],
    "flloadList": [{ "deviceSn": "...", "properties": {
      "flload_totalPower": "60"
    }}]
  }
}
```

All property values are **strings** (need parseFloat). Current values are fake ("60") but format is real.

Other message types (MSG#0 emsList, MSG#1 dido, MSG#2-3 meterList) should be parsed for device_state/ems_health but are NOT needed for energy math.

### Architecture Decision

- The old `ingest-telemetry.ts` (AWS Lambda + Timestream + EventBridge) stays untouched — AWS IoT migration is future work
- The old `telemetry-webhook.ts` (HTTP POST) stays as a secondary ingestion path
- **New:** Add `mqtt-subscriber.ts` as the primary ingestion entry point in `iot-hub/`
- Reuse/adapt the XuhengAdapter pattern from the Phase 1 MQTT Bridge (commit 00a6133 in this repo)
- Use the **service pool** (from v5.11 dual-pool architecture) for DB writes — no JWT, no RLS

### Output Tables

- `telemetry_history` — raw time-series (asset_id, recorded_at, battery_soc, battery_power, energy_kwh, pv_power, grid_power_kw, load_power)
- `device_state` — latest snapshot per asset (UPSERT on each message)
- `ems_health` — EMS hardware status from MSG#0

### Existing Code to Reference

- Phase 1 Bridge code: `git show 00a6133` (14 files: XuhengAdapter, DeviceAssetCache, MessageBuffer, writer, state-updater)
- Current M1: `backend/src/iot-hub/` (handlers/ + services/ + parsers/)
- Dual pool: `backend/src/shared/db.ts` (getAppPool + getServicePool from v5.11)

## Block 2 Technical Details — Deterministic Math (Tarifa Branca)

### Tarifa Branca Rate Structure (ANEEL)
- **Ponta (peak):** 18:00–21:00 → ~R$0.82/kWh
- **Intermediária:** 17:00–18:00 + 21:00–22:00 → ~R$0.55/kWh
- **Fora-ponta (off-peak):** all other hours → ~R$0.25/kWh

These rates are already in `tarifa_config` table. All C-side savings calculations use these rates.

### Aggregator Enhancement (telemetry-aggregator.ts)

Current state: Only aggregates `charge` and `discharge` from `energy_kwh`.

**Needs to also aggregate:**
- `pv_generation_kwh` — SUM of pv_power samples × interval
- `grid_import_kwh` / `grid_export_kwh` — from grid_power_kw (positive=import, negative=export)
- `load_consumption_kwh` — SUM of load_power × interval
- `avg_battery_soc` — AVG of battery_soc readings
- `data_points_count` — already exists

This means `asset_hourly_metrics` table needs new columns.

### M4 Market Billing — Tarifa Branca C-Side Savings

Key formulas (all deterministic):

1. **Daily Revenue (savings):**
   ```
   For each hour h in day:
     tarifa_rate = lookup(tarifa_config, hour_to_period(h))
     savings_h = discharge_kwh[h] × tarifa_rate - charge_kwh[h] × offpeak_rate
   daily_savings = Σ savings_h
   ```

2. **Optimization Alpha:**
   ```
   actual_savings = Σ(real discharge × peak_rate - real charge × offpeak_rate)
   theoretical_max = total_battery_capacity × (peak_rate - offpeak_rate) × days
   alpha = actual_savings / theoretical_max × 100
   ```

3. **Self-Consumption Ratio:**
   ```
   self_consumption = (pv_generation - grid_export) / pv_generation × 100
   ```

### BFF Endpoints to De-hardcode

Scan these handlers and replace hardcoded return values with real SQL:

1. **get-dashboard.ts** — KPI cards: total_generation, total_savings, self_consumption_ratio, fleet_online_rate
2. **get-revenue-trend.ts** — Monthly revenue from asset_hourly_metrics × tarifa rates
3. **get-energy-behavior.ts** — 24h energy flow (pv/grid/battery/load curves from telemetry_history)
4. **get-performance-scorecard.ts** — All computable metrics:
   - Self-consumption ratio (formula above)
   - Online rate = online_assets / total_assets (from device_state)
   - Dispatch accuracy = successful / total (from dispatch_records)
   - Backfill rate = hours_with_data / total_hours (from asset_hourly_metrics)
   - Optimization Alpha (formula above)
   - Savings = Tarifa Branca C-side savings (formula above)

**BFF constraint:** All read queries MUST use App Pool + `queryWithOrg` for RLS isolation.

### What Stays Hardcoded (out of scope for v5.13)

These need prediction models or external data (v6.0+ scope):
- PV Forecast MAPE (needs forecast-engine implementation)
- Load Forecast Adaptation Rate (needs forecast-engine)
- Schedule Optimization Score (needs real M2 greedy algorithm, not hour%4)
- Training Time, Manual Interventions (operational metrics)
- CCEE PLD arbitrage profit (needs PLD data, regulation not ready)

## Constraints

- **No AWS dependencies.** Everything runs on PostgreSQL + Node.js.
- **Use service pool** for all M1 cron/subscriber DB writes (v5.11 dual-pool).
- **Use app pool + queryWithOrg** for all BFF read queries (RLS isolation).
- **Maintain test compatibility.** Design with testability in mind — mock MQTT messages for unit tests.
- **Frontend zero-change.** BFF response format must remain identical to v5.12 contracts.
- **Read existing code** before designing. Check `git show 00a6133` for Bridge code patterns, scan current BFF handlers to understand what's actually hardcoded.

## Completion Signal

When all design files are written, run:
```
openclaw system event --text "Done: v5.13 design docs — 6 files (00_MASTER + 01_M1 + 04_M4 + 05_BFF + 09_SHARED + 10_DB)" --mode now
```
