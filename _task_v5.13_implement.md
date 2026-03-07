# Task: v5.13 Implementation — Data Pipeline & Deterministic Math

## MANDATORY: Read Design Docs First

Before writing ANY code, read ALL 6 design documents in `design/backend_architecture/`:
1. `00_MASTER_ARCHITECTURE_v5.13.md` — System overview
2. `01_IOT_HUB_MODULE_v5.13.md` — M1 MQTT subscriber + XuhengAdapter
3. `04_MARKET_BILLING_MODULE_v5.13.md` — M4 Tarifa Branca billing
4. `05_BFF_MODULE_v5.13.md` — BFF de-hardcoding + **query routing red line**
5. `09_SHARED_LAYER_v5.13.md` — Shared types + tarifa pure functions
6. `10_DATABASE_SCHEMA_v5.13.md` — Schema changes + seed strategy

Also read existing code:
- `backend/src/shared/db.ts` — dual pool (getAppPool / getServicePool)
- `backend/src/iot-hub/` — current M1 structure
- `backend/src/market-billing/` — current M4 structure
- `backend/src/bff/handlers/` — current BFF handlers
- `git show 00a6133` — Phase 1 MQTT Bridge (XuhengAdapter reference)

## Build Sequence (strict order)

### Phase 0: DB Schema & Seed

1. Create `backend/migrations/migration_v5.13.sql`:
   - ALTER `asset_hourly_metrics` — add 6 columns (pv_generation_kwh, grid_import_kwh, grid_export_kwh, load_consumption_kwh, avg_battery_soc, sample_interval_minutes)
   - Verify UNIQUE constraint `uq_asset_hourly(asset_id, hour_timestamp)` exists (add if missing)
   - CREATE `ems_health` table (if not already in DDL)
   - Add indexes per design doc

2. Create `backend/migrations/seed_v5.13.sql`:
   - Insert realistic Xuheng MSG#4-format mock telemetry data into `telemetry_history`
   - Pre-aggregate into `asset_hourly_metrics` with the new columns populated
   - Ensure data covers multiple Tarifa Branca periods (ponta/intermediária/fora-ponta)

### Phase 1: Block 1 — M1 Data Pipeline

1. **`backend/src/shared/types/telemetry.ts`** — Canonical telemetry interfaces:
   - `XuhengRawMessage` (wire format with string values)
   - `ParsedTelemetry` (normalized numeric values)
   - Follow `09_SHARED_LAYER_v5.13.md` exactly

2. **`backend/src/shared/tarifa.ts`** — Tarifa Branca pure functions:
   - Rate constants (ponta/intermediária/fora-ponta)
   - `getTarifaPeriod(hour: number): TarifaPeriod`
   - `getTarifaRate(period: TarifaPeriod, rates: TarifaRates): number`
   - `calculateHourlySavings(...)` and `calculateOptimizationAlpha(...)`
   - All pure functions, zero side effects, zero DB calls

3. **`backend/src/iot-hub/parsers/XuhengAdapter.ts`** — Port from Phase 1 Bridge:
   - Parse MSG#4 (batList/pvList/gridList/loadList/flloadList)
   - Parse MSG#0 (emsList → ems_health)
   - All property values are strings → parseFloat
   - Output: `ParsedTelemetry` type from shared

4. **`backend/src/iot-hub/services/device-asset-cache.ts`** — Port from Bridge:
   - In-memory cache: device_sn → asset_id
   - 5-minute refresh from DB
   - Uses **getServicePool()** (no JWT)

5. **`backend/src/iot-hub/services/message-buffer.ts`** — Port from Bridge:
   - 2-second debounce per clientId (Gemini R2 defense from Phase 1)

6. **`backend/src/iot-hub/handlers/mqtt-subscriber.ts`** — New MQTT entry point:
   - Subscribe to EMQX topic pattern
   - Route messages through XuhengAdapter → buffer → DB writer
   - Write to `telemetry_history` (INSERT) + `device_state` (UPSERT) + `ems_health` (UPSERT)
   - **MUST use getServicePool()** — no JWT, no RLS for device writes

7. **Enhance `backend/src/iot-hub/services/telemetry-aggregator.ts`**:
   - Add 6 new aggregation columns (pv_generation_kwh, grid_import/export, load_consumption, avg_soc, sample_interval)
   - Use `INSERT ... ON CONFLICT (asset_id, hour_timestamp) DO UPDATE` (idempotent)
   - Uses **getServicePool()**

### Phase 2: Block 2 — Deterministic Math

8. **Enhance `backend/src/market-billing/handlers/daily-billing-job.ts`**:
   - Read `asset_hourly_metrics` (new columns) × `tariff_schedules` rates
   - Calculate Tarifa Branca C-side savings per hour using `shared/tarifa.ts`
   - Calculate Optimization Alpha per asset
   - Calculate self-consumption ratio
   - Populate `revenue_daily` with real computed values
   - **MUST use getServicePool()** (batch cron job, no JWT)

9. **De-hardcode BFF handlers** (per `05_BFF_MODULE_v5.13.md`):
   - `get-performance-scorecard.ts` — 4 metrics: Savings Alpha, Self-Consumption, Backfill Rate, Online Rate → real SQL from `revenue_daily` + `asset_hourly_metrics` + `device_state`
   - `get-dashboard.ts` — Revenue KPIs from `revenue_daily` Tarifa Branca savings; gatewayUptime from `daily_uptime_snapshots`
   - `get-revenue-trend.ts` — Monthly revenue from `revenue_daily` aggregation
   - `get-home-energy.ts` — 24h energy flow from `telemetry_history` (this is the ONE exception allowed)
   - **ALL BFF queries MUST use getAppPool() + queryWithOrg()** (RLS isolation)
   - **🛡 QUERY ROUTING RED LINE**: Long-range aggregates → `asset_hourly_metrics`/`revenue_daily` ONLY. Never scan `telemetry_history` for multi-day ranges. Only P3 24h flow may query `telemetry_history`.

## Critical Constraints

- **Response format unchanged** — Frontend expects identical JSON envelopes. Zero frontend changes.
- **Service Pool for writes** (M1 subscriber, M1 aggregator, M4 billing batch)
- **App Pool + queryWithOrg for reads** (all BFF handlers)
- **No AWS dependencies** — PostgreSQL + Node.js only
- **Existing tests must pass** — Run `npm test` after all changes and fix any regressions

## Test Strategy

- Unit tests for `XuhengAdapter` (parse MSG#0, MSG#4 with real sample data)
- Unit tests for `shared/tarifa.ts` pure functions
- Integration tests for aggregator (insert telemetry → run aggregation → verify hourly metrics)
- Integration tests for M4 billing (hourly metrics → revenue_daily with correct Tarifa Branca calculations)
- BFF handler tests (verify scorecard/dashboard return real DB values, not hardcoded)

## Completion Signal

When ALL phases are done and tests pass, run:
```
openclaw system event --text "Done: v5.13 implementation — Phase 0-2 complete. Tests: [X/X PASS]" --mode now
```
