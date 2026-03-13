# Design Document Review Report -- v5.22

**Reviewer:** Claude Code (automated source-code verification)
**Date:** 2026-03-13
**Scope:** 8 design documents in `design/backend_architecture/` compared against actual source code
**Codebase version:** v5.22 (commit d2e9045)

---

## Summary

| Document | Issues Found | Fixes Applied | Status |
|----------|:------------:|:-------------:|--------|
| 00_MASTER_ARCHITECTURE | 2 | 2 | Fixed |
| 01_IOT_HUB_MODULE | 27 | 27 | Fixed |
| 02_OPTIMIZATION_ENGINE_MODULE | 8 | 8 | Fixed |
| 03_DR_DISPATCHER_MODULE | 4 | 4 | Fixed |
| 04_MARKET_BILLING_MODULE | 7 | 7 | Fixed |
| 05_BFF_MODULE | 10 | 10 | Fixed |
| 09_SHARED_LAYER | 17 | 17 | Fixed |
| 10_DATABASE_SCHEMA | 14 | 14 | Fixed |
| **TOTAL** | **89** | **89** | **All fixed** |

---

## Per-Document Details

### 00_MASTER_ARCHITECTURE_v5.22.md (2 issues)

1. **M2 name inconsistency** -- Inter-module diagram said "M2 (Algorithm Engine)" instead of "M2 (Optimization Engine)". Fixed.
2. **Missing core dependencies** -- Express 5.x and mqtt.js 5.x were missing from the Technology Stack table despite being primary runtime deps. Added.

**Verified correct:** 8 module boundaries, 32 BFF handlers + 1 SSE, 6 subscribe topics, Node 20 LTS, TypeScript 5.x, PostgreSQL 15, 26 logical tables, Docker Compose layout.

---

### 01_IOT_HUB_MODULE_v5.22.md (27 issues)

**Function signature mismatches (7):**
1. `handleDeviceList` -- 3 params in doc, actual has 4 (`pool, gatewayId, _clientId, payload`)
2. `handleTelemetry` -- 3 params in doc, actual has 4
3. `handleHeartbeat` -- 3 params in doc, actual has 4
4. `handleGetReply`/`handleSetReply` -- 3 params in doc, actual has 4
5. `handleMissedData` -- 3 params in doc, actual has 4
6. `publishConfigGet` -- doc showed `(gatewayId)`, actual is `(pool, gatewayId, publish)`
7. ScheduleTranslator -- `parseGetReply` wrong param type, `buildConfigSet` wrong name (`buildConfigSetPayload`), `validateSchedule` wrong return type

**Logic/behavior mismatches (10):**
8. CommandPublisher poll interval: doc 5s, actual 10s
9. CommandPublisher query: doc `result = 'pending'`, actual `result = 'dispatched'`
10. CommandPublisher failure: doc "skip, remain pending", actual marks `failed` with `error_message='gateway_offline'`
11. BackfillRequester failure: doc "skip, remain pending", actual marks `failed`
12. set_reply `device_timestamp`: doc `to_timestamp($ts / 1000.0)`, actual `NOW()`
13. set_reply no-match: doc "log warning, skip", actual inserts standalone audit record
14. get_reply: doc says calls `ScheduleTranslator.parseGetReply()`, actual stores raw JSON
15. HeartbeatHandler reconnect: doc showed single CTE, actual is two-step (CTE + conditional INSERT)
16. BMS limit validation: doc claimed DB lookup, actual only checks `>= 0`
17. FragmentAssembler key: doc `gatewayId`, actual `payload.clientId`

**Protocol/data structure errors (2):**
18. dido JSON example: flat structure in doc, actual uses `{do: [...], di: [...]}` arrays
19. `translateSlotToProcotol` typo fixed to `translateSlotToProtocol`

**Missing documentation (3):**
20. Parsers section missing `AdapterRegistry.ts`, `TelemetryAdapter.ts`, `StandardTelemetry.ts` -- added
21. `DynamicAdapter` description wrong (said "auto-selects", actual is ParserRule-based)
22. Handler names used class method style, actual are standalone functions

**DB schema mismatches (3):**
23. `backfill_requests` table: doc had `updated_at`, actual uses `completed_at`
24. `pv_totalEnergy` mapping: doc claimed DB persistence, actually parsed-only
25. 3 fields (`maxChargeVoltage`, `totalChargeKwh`, `totalDischargeKwh`) claimed DB columns but are parsed-only

**Other (2):**
26. `ems_health` SQL: doc used `to_timestamp()`, actual passes Date object
27. `total_bat_power` unit: doc said "W", actual context suggests kW

---

### 02_OPTIMIZATION_ENGINE_MODULE_v5.22.md (8 issues)

1. **Missing file** -- `run-optimization.ts` (real-time arbitrage Lambda handler) was completely undocumented. Added new section.
2. **Fabricated 85% demand threshold** -- Doc described elaborate demand risk assessment with `LATERAL JOIN`, 7-day lookback, 15-minute binning, `HAVING > contracted_demand_kw * 0.85`. None exists. Actual: simple `contracted_demand_kw != null` filter. Replaced.
3. **Wrong INSERT for PS slots** -- Doc: single INSERT with `duration_minutes = 240`. Actual: 4 separate rows (one per peak hour), includes `target_pld_price = 0`, uses `ON CONFLICT DO NOTHING`, no `duration_minutes` column.
4. **Fabricated constants** -- `PS_PEAK_START_HOUR_BRT`, `PS_PEAK_END_HOUR_BRT`, `PS_DEMAND_THRESHOLD_PCT` don't exist. Actual: hardcoded array `[18, 19, 20, 21]`.
5. **Wrong NULL handling** -- Doc claimed log warning for NULL `contracted_demand_kw`. Actual: silent `.filter()` skip.
6. **Incorrect query description** -- Doc showed standalone JOIN query; actual fetches in main query and filters in TypeScript.
7. **Test cases referenced non-existent behavior** -- Referenced 85% threshold. Replaced with tests matching actual behavior.
8. **Section title and numbering** -- Updated to reflect both source files.

---

### 03_DR_DISPATCHER_MODULE_v5.22.md (4 issues)

1. **MQTT topic prefix wrong** -- Doc: `xuheng/{orgId}/{assetId}/command`. Actual: `solfacil/{orgId}/{assetId}/command/mode`. (`xuheng` is the inbound telemetry prefix.)
2. **MQTT payload mismatch** -- Doc described `PeakShavingCommand` with `mode`, `peak_limit_kva`, `asset_id`, `dispatched_at`. Actual payload: `{ targetMode, dispatchId }`. `peak_limit_kva` is written to DB, not published via MQTT.
3. **Error handling claims inaccurate** -- Three wrong claims: (a) `contracted_demand_kw IS NULL` doesn't skip, falls back to `?? 0`; (b) `billing_power_factor = 0` doesn't skip, ternary fallback; (c) MQTT failure doesn't retry 3x, marks FAILED and throws.
4. **Test case topic** -- Expected `xuheng/org1/asset1/command`, fixed to `solfacil/org1/asset1/command/mode`.

**Verified correct:** All 4 source files, `startCommandDispatcher(pool)` signature, polling intervals, SKIP LOCKED SQL, dual-timeout logic, `dispatch_records` INSERT.

---

### 04_MARKET_BILLING_MODULE_v5.22.md (7 issues)

1. **Cron schedule wrong (CRITICAL)** -- Doc: `02:00 UTC` / `"0 2 * * *"`. Actual: `00:05 UTC` / `"5 0 * * *"`. Fixed throughout.
2. **Monthly true-up cron doesn't exist (CRITICAL)** -- Doc claimed `cron.schedule("0 4 1 * *", () => runMonthlyTrueUp(pool))`. `runMonthlyTrueUp` is exported but never registered as a cron job. Added warning callout.
3. **Confidence logic oversimplified** -- Doc showed simple CASE. Actual: per-window `window_confidence` via telemetry_history DO state checks, aggregated via `MIN()`. Fixed.
4. **Stale `h.contracted_demand_kw` alias (code bug)** -- Code references `h.contracted_demand_kw` (old `homes` alias) but joins `gateways g`. Documented as known code bug.
5. **Missing `shared/tarifa.ts` reference** -- Doc never mentioned this despite imports of `calculateBaselineCost`, `calculateActualCost`, etc. Added.
6. **Missing `asset_hourly_metrics`** -- Doc only listed `asset_5min_metrics` but daily billing reads `asset_hourly_metrics`. Fixed.
7. **Execution sequence incomplete** -- Missing self-consumption/self-sufficiency calculation and initial UPSERT. Expanded to 6 steps.

---

### 05_BFF_MODULE_v5.22.md (10 issues)

1. **GET handler count label** -- Section header said "28", table had 27 entries. Fixed to 27.
2. **v5.22 changelog misattribution** -- 409 Conflict guard credited to `post-hems-dispatch.ts`, actually in `put-gateway-schedule.ts`. Fixed.
3. **post-hems-dispatch.ts version** -- Listed as v5.22 with 409 guard. Actual: unchanged since v5.12, no 409 guard. Fixed.
4. **5 route path errors** -- `get-assets` (`/api/assets` -> `/assets`), `get-dashboard` (`/api/dashboard` -> `/dashboard`), `get-revenue-trend` (`/api/revenue/trend` -> `/revenue-trend`), `get-trades` (`/api/trades` -> `/trades`), `sse-events` (`/api/sse/events` -> `/api/events`).
5. **4 route parameter naming errors** -- `:id` -> `:assetId` in `get-device-detail`, `get-device-schedule`, `put-device-schedule`, `put-device`. Also removed `/detail` suffix from device-detail route.
6. **Auth middleware description** -- Updated to reflect actual structure (HTTP adapter delegating to shared `verifyTenantToken`).
7. **Pool compliance count** -- `put-gateway-schedule.ts` doc claimed 4 calls, actual has 3. Fixed.
8. **vpp_strategies table claim** -- Doc said table "doesn't exist". It does exist. Fixed description.
9. **Dead code handlers** -- Added notes that `get-homes.ts`, `get-homes-summary.ts`, `get-home-energy.ts` are not registered in local-server.
10. **SSE factory signature** -- Updated `createSseHandler(pool)` to `createSseHandler(_pool)` (unused param).

---

### 09_SHARED_LAYER_v5.22.md (17 issues)

**Interface definitions completely wrong (7):**
1. `SolfacilMessage` -- Doc: `{messageType, gatewayId, timestamp, payload}`. Actual: `{DS, ackFlag, clientId, deviceName, productKey, messageId, timeStamp, data}`.
2. `SolfacilDevice` -- Doc: 3 fields. Actual: 18 fields (9 required + 9 optional).
3. `SolfacilListItem` -- Doc: `{key, value, unit?}`. Actual: `{deviceSn, fatherSn?, name, properties, ...}` with 14 fields.
4. `GatewayRecord` -- Doc: 8 fields with wrong names. Actual: `{gateway_id, org_id, mqtt_broker_host, mqtt_broker_port, mqtt_username, mqtt_password, name, status, last_seen_at}`.
5. `FragmentType` -- Doc: `'deviceList' | 'telemetry' | 'command_ack' | 'heartbeat'`. Actual: `"ems" | "dido" | "meter" | "core"`.
6. `GatewayFragments` -- Doc: `Partial<Record<FragmentType, unknown>>`. Actual: full interface with `clientId`, `recordedAt`, `ems?`, `dido?`, `meters?`, `core?`.
7. `AssetType` -- Doc: enum with 4 values. Actual: string union `"SMART_METER" | "INVERTER_BATTERY" | "EMS"`.

**Function signatures wrong (2):**
8. `queryWithOrg` -- Doc: `(pool, orgId, sql, params?)`. Actual: `<T>(sql, params, orgId: string | null)`. Pool auto-selected, orgId nullable, different parameter order.
9. `tenant-context.ts` -- Doc: Express middleware. Actual: two pure functions `verifyTenantToken(token)` and `requireRole(ctx, allowedRoles)`.

**Naming and type errors (8):**
10. `api.ts` error function: `error()` -> `fail()`.
11. `api.ts` exports: Doc only had `ok` and `error`. Added `ApiResponse`, `Organization`, `Asset`, `DeviceParserRule`, `VppStrategy`, etc.
12. `auth.ts` exports: Missing `TenantContext` interface.
13. `ParsedTelemetry` v5.18 fields: Doc showed required, actual all optional (`?`).
14. `telemetryExtra` type: Doc `Record<string, unknown>`, actual `Record<string, Record<string, number>> | null`.
15. Missing `XuhengMessageType` export from `telemetry.ts`.
16. `calculateSelfConsumption`/`calculateSelfSufficiency` return: `number` -> `number | null`.
17. Field count inconsistency: Standardized to 34 (25 required + 9 optional).

---

### 10_DATABASE_SCHEMA_v5.22.md (14 issues)

1. **gateways table severely simplified** -- Doc: 4 columns. Actual migration v5.18 has 15 columns including MQTT credentials, `client_id`, `status` CHECK, `last_seen_at`, `commissioned_at`, typed VARCHAR lengths, 3 indexes, RLS policy.
2. **device_command_logs completely wrong** -- `payload` -> `payload_json` (nullable), `status` -> `result`, missing `client_id`, `config_name`, `message_id`, `error_message`, `device_timestamp`, `resolved_at`, CHECK on `command_type`.
3. **Missing v5.18 section** -- 11 columns added to `telemetry_history` undocumented. Added.
4. **v5.18_hotfix missing column** -- `ems_health_at TIMESTAMPTZ` undocumented. Date corrected.
5. **v5.19 column types wrong** -- `name` VARCHAR vs VARCHAR(200), `address` VARCHAR vs TEXT, `contracted_demand_kw` NUMERIC(8,3) vs REAL. RLS policy name wrong. Missing 7 phases (FK drops, PK updates, column drops).
6. **v5.20 index wrong** -- `idx_dcl_pending_dispatch` columns: doc `(gateway_id, created_at)`, actual `(status, created_at)`. Missing PHASE 1 GRANTs.
7. **v5.21 index wrong** -- `idx_dcl_dispatched_set` completely wrong definition. Added `CONCURRENTLY`.
8. **v5.22_phase1 index wrong** -- `idx_dcl_accepted_set` completely wrong definition. Added `CONCURRENTLY`.
9. **v5.22_phase2 index wrong** -- `idx_backfill_active` columns wrong. GRANT roles wrong (`vpp_app`/`vpp_service` -> `solfacil_service`).
10. **v5.22_phase3** -- Added `CONCURRENTLY` keyword.
11. **gateways complete table** -- Added all missing columns, fixed types, fixed RLS policy name.
12. **device_command_logs complete table** -- Complete rewrite to match actual schema.
13. **Index analysis table** -- All 4 index definitions corrected.
14. **Migration dates** -- Multiple dates off by 1 day. All corrected.

---

## Code Bugs Discovered During Review

These are actual bugs in the source code (not doc issues):

1. **`daily-billing-job.ts:441`** -- Stale `h.contracted_demand_kw` alias references non-existent `homes` table join. Should be `g.contracted_demand_kw` (matching the `gateways g` join). The `runMonthlyTrueUp` function has it correct.

2. **`gateway-connection-manager.ts:13,124`** -- Code comments say "subscribes to 5 topics" but actual code subscribes to 6.

---

## Conclusion

**89 total discrepancies** found across 8 documents, all fixed in place. The most affected documents were:
- **01_IOT_HUB_MODULE** (27 issues) -- primarily function signatures and behavior descriptions
- **09_SHARED_LAYER** (17 issues) -- nearly all interface definitions were fabricated
- **10_DATABASE_SCHEMA** (14 issues) -- index definitions and table schemas significantly wrong
- **05_BFF_MODULE** (10 issues) -- route paths and parameter names

The least affected were **00_MASTER_ARCHITECTURE** (2 minor issues) and **03_DR_DISPATCHER** (4 issues).
