# REVIEW — v6.0 P4 Batch Dispatch

**Version:** 6.0
**Date:** 2026-03-14
**Reviewer:** Claude (Second-pass cross-review)
**Documents:** REQ-v6.0-P4-batch-dispatch.md, DESIGN-v6.0-P4-batch-dispatch.md, PLAN-v6.0-P4-batch-dispatch.md

---

## 1. REQ Coverage (F1-F8)

| REQ ID | Description | DESIGN | PLAN | Verdict |
|--------|-------------|--------|------|---------|
| F1 | P4 frontend rewrite (3-step flow) | DESIGN §1 module matrix + §2 data flow | PLAN T7 (detailed step breakdown) | ✅ PASS |
| F2 | `POST /api/hems/batch-dispatch` rewrite | DESIGN §6.1 (full API contract) | PLAN T2 (handler implementation) | ✅ PASS |
| F3 | `GET /api/hems/batch-history` | DESIGN §6.2 (full API contract + SQL) | PLAN T3 (handler implementation) | ✅ PASS |
| F4 | DDL: `batch_id` + `source` columns | DESIGN §5 (migration SQL) | PLAN T1 (DDL task) | ✅ PASS |
| F5 | DDL: `rated_*` columns on assets | DESIGN §5 (migration SQL) | PLAN T9 (DDL task) | ✅ PASS |
| F6 | `device-list-handler.ts` UPSERT rated_* | DESIGN §1 module matrix | PLAN T10 (detailed steps) | ✅ PASS |
| F7 | `put-gateway-schedule.ts` rated power check | DESIGN §1 module matrix | PLAN T11 (detailed steps) | ✅ PASS |
| F8 | P2 frontend `_validateSchedule` rated check | DESIGN §1 module matrix | PLAN T12 (detailed steps) | ✅ PASS |

### REQ Constraints Check

| Constraint | Covered | Verdict |
|------------|---------|---------|
| M1/M3 pipeline unchanged | DESIGN §1 lists both as "不動"; DESIGN §9 proves no WHERE clause impact | ✅ PASS |
| `dispatch_commands` table untouched | Not referenced in any DESIGN/PLAN modification | ✅ PASS |
| Existing P2 behavior unchanged | DESIGN §9 explicitly covers 6 scenarios (PUT, read, M3, M1, tracker) | ✅ PASS |
| Rated check = soft guard (NULL → skip) | DESIGN §4 衝突處理矩陣 + PLAN T11 step 3 | ✅ PASS |

---

## 2. Logical Consistency

### 2.1 DomainSchedule Generation — Three Modes

| Mode | Slots | validateSchedule(0-1440 coverage) | Verdict |
|------|-------|-----------------------------------|---------|
| **self_consumption** | `[{mode:'self_consumption', startMinute:0, endMinute:1440}]` | Single slot 0→1440, both multiples of 60 | ✅ PASS |
| **peak_shaving** | `[{mode:'peak_shaving', startMinute:0, endMinute:1440}]` | Single slot 0→1440, both multiples of 60 | ✅ PASS |
| **peak_valley_arbitrage** | arbSlots (hours) → DomainSlot[] (minutes) | See §2.2 below | ✅ PASS |

**Verification against `schedule-translator.ts` validateSchedule():**
- `assertInt("socMinLimit", ...)` range 0-100: P4 sends 5-50 (subset, valid)
- `assertInt("socMaxLimit", ...)` range 0-100: P4 sends 70-100 (subset, valid)
- `assertNonNegativeInt("maxChargeCurrent")`: historical value or default 100
- `assertNonNegativeInt("maxDischargeCurrent")`: historical value or default 100
- `assertNonNegativeInt("gridImportLimitKw")`: P4 new value or historical
- Slot coverage: must start at 0, end at 1440, no gaps, no overlaps
- Slot boundaries: `startMinute % 60 === 0` and `endMinute % 60 === 0` required

### 2.2 Arbitrage arbSlots → DomainSlot Conversion

```
Input:  arbSlots = [{startHour:0, endHour:6, action:'charge'}, ...]
Output: [{startMinute: 0×60=0, endMinute: 6×60=360, mode:'peak_valley_arbitrage', action:'charge'}, ...]
```

- Hours × 60 → always multiples of 60
- Frontend enforces 24h full coverage (0-24) → minutes cover 0-1440
- BFF re-validates arbSlots coverage 0-24h → rejects gaps at request level
- `validateSchedule()` re-validates 0-1440 coverage → defense in depth

**Verdict:** ✅ PASS

### 2.3 Read-History → Merge → Write Logic

```
Step 1: Read latest successful schedule (result IN 'success','accepted')
Step 2: Extract maxChargeCurrent, maxDischargeCurrent, gridImportLimitKw
Step 3: Merge P4 new values (soc*, mode-specific gridImportLimitKw) + historical power
Step 4: validateSchedule() on merged schedule
Step 5: Write to device_command_logs (result='pending')
```

**Verified against codebase:**
- `put-gateway-schedule.ts:149-155` INSERT pattern matches (gateway_id, command_type='set', config_name='battery_schedule', payload_json, result='pending')
- M3 `runPendingCommandDispatcher` (command-dispatcher.ts:130-131) picks up `WHERE result = 'pending'` → new P4 rows will be picked up
- M1 `CommandPublisher` (command-publisher.ts:44) picks up `WHERE result = 'dispatched'` → standard pipeline

**Verdict:** ✅ PASS

### 2.4 Field Parameter Source Matrix Cross-Check

| Field | Verified against DomainSchedule interface | Verdict |
|-------|------------------------------------------|---------|
| `socMinLimit: number` | P4 new value (5-50) | ✅ PASS |
| `socMaxLimit: number` | P4 new value (70-100) | ✅ PASS |
| `maxChargeCurrent: number` | Historical or default 100 | ✅ PASS |
| `maxDischargeCurrent: number` | Historical or default 100 | ✅ PASS |
| `gridImportLimitKw: number` | Peak shaving → P4 new; others → historical/default 3000 | ✅ PASS |
| `slots: DomainSlot[]` | P4 generated from mode + arbSlots | ⚠️ WARN (see §2.5) |

### 2.5 Missing `allowExport` for Arbitrage Discharge Slots

**Issue:** The `DomainSlot` interface (schedule-translator.ts:21-27) has an optional `allowExport?: boolean` field. For arbitrage mode, DESIGN §3 generates slots with `mode` + `action` but **does not specify `allowExport`**.

**Impact:** In `translateSlotToProtocol()` (schedule-translator.ts:197), when `allowExport` is `undefined`/`false`, discharge slots will have `export_policy: "forbid"`. If a gateway's existing schedule had `allowExport: true` on discharge slots, P4 batch dispatch will **silently disable export** for those gateways.

**Verdict:** ⚠️ WARN — Safe default (forbid), but this is an implicit behavioral change that should be documented as a conscious design decision. Consider adding an `allowExport` toggle to the P4 UI in a future iteration, or explicitly carrying forward the historical `allowExport` value.

---

## 3. Codebase Consistency

### 3.1 Function/Type Names

| DESIGN Reference | Codebase Actual | Match |
|-----------------|-----------------|-------|
| `extractTenantContext` | `backend/src/bff/middleware/auth.ts` → export | ✅ |
| `requireRole` | `backend/src/bff/middleware/auth.ts` → export | ✅ |
| `apiError` | `backend/src/bff/middleware/auth.ts` → export | ✅ |
| `queryWithOrg` | `backend/src/shared/db.ts` → export | ✅ |
| `validateSchedule` | `schedule-translator.ts:207` → export | ✅ |
| `DomainSchedule` | `schedule-translator.ts:12` → export interface | ✅ |
| `DomainSlot` | `schedule-translator.ts:21` → export interface | ✅ |
| `ScheduleValidationError` | `schedule-translator.ts:50` → export class | ✅ |
| `Role.SOLFACIL_ADMIN` | Used in `put-gateway-schedule.ts:45` | ✅ |
| `Role.ORG_MANAGER` | Used in `put-gateway-schedule.ts:45` | ✅ |
| `Role.ORG_OPERATOR` | Used in `post-hems-dispatch.ts:28` | ✅ |

### 3.2 Table/Column Names

| DESIGN Reference | Schema (02_schema.sql) | Match |
|-----------------|------------------------|-------|
| `device_command_logs` | Line 936 | ✅ |
| `device_command_logs.gateway_id` (VARCHAR 50) | Line 938 | ✅ |
| `device_command_logs.command_type` (VARCHAR 20) | Line 939, CHECK constraint | ✅ |
| `device_command_logs.config_name` (VARCHAR 100) | Line 940, DEFAULT 'battery_schedule' | ✅ |
| `device_command_logs.payload_json` (JSONB) | Line 942 | ✅ |
| `device_command_logs.result` (VARCHAR 20) | Line 943 | ✅ |
| `device_command_logs.message_id` (VARCHAR 50) | Line 941 | ✅ |
| `assets` | Line 811 | ✅ |
| `assets.gateway_id` (VARCHAR 50) | Line 839 | ✅ |
| `assets.asset_type` (VARCHAR 30) | Line 822, CHECK constraint | ✅ |
| `assets.is_active` (BOOLEAN) | Line 827 | ✅ |
| `gateways.gateway_id` | Referenced in device-list-handler.ts:41 | ✅ |
| `gateways.org_id` | Referenced in device-list-handler.ts:39 | ✅ |

### 3.3 New Column Type Compatibility

| New Column | Type | Existing Column Pattern | Match |
|------------|------|------------------------|-------|
| `batch_id VARCHAR(50)` | Same type as `message_id VARCHAR(50)` | ✅ |
| `source VARCHAR(10)` | Consistent with other flag columns | ✅ |
| `rated_max_power_kw REAL` | Same type as `max_charge_rate_kw REAL` (line 836) | ✅ |
| `rated_max_current_a REAL` | Same type pattern | ✅ |

### 3.4 Route Registration Pattern

| PLAN T4 Pattern | Existing bff-stack.ts Pattern | Match |
|----------------|-------------------------------|-------|
| `this.createHandler("PostHemsBatchDispatch", ...)` | Matches existing `this.createHandler("PutGatewaySchedule", ...)` at line 88-93 | ✅ |
| `this.addRoute(httpApi, "POST", "/api/hems/batch-dispatch", ...)` | Matches `/api/gateways/{gatewayId}/schedule` pattern at line 113-118 | ✅ |

### 3.5 DataSource Pattern

| PLAN T5 Pattern | Existing data-source.js Pattern | Match |
|----------------|-------------------------------|-------|
| `withFallback(function() { return apiPost(...) }, mockData)` | Matches `hems.overview()` at line 308-349 | ✅ |
| `withFallback(function() { return apiGet(...) }, MOCK_DATA.BATCH_HISTORY)` | Matches `devices.getSchedule()` at line 248-258 | ✅ |

### 3.6 MQTT Field Mapping (Phase 2)

| DESIGN Mapping | SolfacilDevice Interface (solfacil-protocol.ts) | Match |
|---------------|------------------------------------------------|-------|
| `device.maxPower` → `rated_max_power_kw` | `maxPower?: string` (line 35) | ✅ |
| `device.maxCurrent` → `rated_max_current_a` | `maxCurrent?: string` (line 34) | ✅ |
| `device.minPower` → `rated_min_power_kw` | `minPower?: string` (line 37) | ✅ |
| `device.minCurrent` → `rated_min_current_a` | `minCurrent?: string` (line 36) | ✅ |

**Note:** Fields are `string` type in the MQTT protocol; DESIGN correctly uses `NULLIF($x, '')::REAL` for type conversion.

**Verdict:** ✅ PASS — All codebase references verified.

---

## 4. Edge Cases

### 4.1 Active Command Conflict

**DESIGN:** Check `result IN ('pending', 'dispatched', 'accepted')`, skip if found.

**Codebase verification:** `put-gateway-schedule.ts:126-131` uses the exact same check. Command lifecycle in `command-tracker.ts:90-127` confirms these are the three non-terminal states before `success`/`fail`/`timeout`.

**Verdict:** ✅ PASS — Complete and consistent with existing P2 behavior.

### 4.2 No Historical Schedule — Safety Defaults

**DESIGN defaults:** `maxChargeCurrent=100`, `maxDischargeCurrent=100`, `gridImportLimitKw=3000`

**Analysis:**
- 100A is higher than typical residential inverters (25-50A) but within range of commercial systems
- In Phase 1, there is NO hardware capacity check — the only protection is gateway firmware
- Phase 2 adds `rated_max_power_kw` check, but only for `put-gateway-schedule.ts` (P2), NOT for `post-hems-batch-dispatch.ts` (P4)

**Verdict:** ⚠️ WARN — Defaults are reasonable but aggressive. Two recommendations:
1. Consider lowering defaults to `maxChargeCurrent=25`, `maxDischargeCurrent=25` (typical residential inverter) to reduce risk before Phase 2 deploys
2. Phase 2 should also add rated capacity check to `post-hems-batch-dispatch.ts`, not just `put-gateway-schedule.ts`

### 4.3 `rated_max_power_kw` NULL Fallback

**DESIGN:** Skip validation when NULL (backward compatible).

**Codebase verification:** The `assets` table currently has no `rated_*` columns. After Phase 2 DDL, new columns default to NULL. Only gateways that send `deviceList` with `maxPower` will have values. Skip-on-NULL is the correct backward-compatible approach.

**Verdict:** ✅ PASS

### 4.4 Partial Gateway Failure — Transaction Handling

**DESIGN:** Per-gateway independent try-catch. No cross-gateway transaction. Mixed results returned.

**Analysis:** This is the correct approach for batch operations:
- Gateway A succeeds → INSERT committed
- Gateway B fails validation → skipped, no rollback of A
- Gateway C has active command → skipped, no rollback of A
- Response includes all results with status per gateway

**Verdict:** ✅ PASS

### 4.5 Historical Schedule `payload_json` Format Anomaly

**DESIGN §4:** Try-catch parsing, fallback to safety defaults on failure.

**Analysis:** Since `payload_json` is JSONB (schema line 942), PostgreSQL ensures valid JSON. But the internal structure (DomainSchedule fields) could be incomplete if an older version wrote it. The try-catch with default fallback is appropriate.

**Verdict:** ✅ PASS

### 4.6 Gateway Offline Handling

**DESIGN:** BFF does NOT check online status; writes `pending` regardless. M1 `CommandPublisher` (command-publisher.ts:74-83) checks `isGatewayConnected()` and sets `result='failed', error_message='gateway_offline'` if disconnected.

**Codebase verification:** Confirmed at command-publisher.ts:74-83.

**Verdict:** ✅ PASS — Correct separation of concerns.

### 4.7 REQ F3 SQL Syntax Error

**REQ §4 F3 SQL:**
```sql
(array_agg(payload_json ORDER BY id LIMIT 1))[1]
```

**Issue:** `LIMIT` is not valid inside `array_agg()` in PostgreSQL. This would cause a syntax error.

**DESIGN §6.2 SQL (corrected):**
```sql
(array_agg(dcl.payload_json ORDER BY dcl.id)
  FILTER (WHERE dcl.payload_json IS NOT NULL))[1]
```

**Verdict:** ✅ PASS — DESIGN correctly fixes the REQ's SQL syntax error.

---

## 5. Execution Risks

### 5.1 Task Dependency Order

| Dependency | PLAN Order | Correct | Verdict |
|-----------|------------|---------|---------|
| T1 (DDL) before T2, T3 | T1 Day 1, T2/T3 Day 1-2 | T2/T3 can start in parallel with T1 if DDL is applied first | ✅ PASS |
| T2, T3 before T4 (route reg) | T4 Day 2, after T2/T3 | Correct: handler files must exist before CDK references them | ✅ PASS |
| T5 (data-source) before T7 (FE) | T5 Day 1, T7 Day 3-5 | Correct | ✅ PASS |
| T9 (DDL P2) before T10, T11 | T9 Day 6, T10/T11 Day 6-7 | Correct: columns must exist before UPSERT/query | ✅ PASS |

**Missing dependency identified:** None.

**Verdict:** ✅ PASS

### 5.2 Test Plan Coverage

| Edge Case | Test # | Covered | Verdict |
|-----------|--------|---------|---------|
| Self-consumption batch | #1 | Yes | ✅ |
| Peak shaving + gridImportLimitKw | #2 | Yes | ✅ |
| Arbitrage full 24h | #3 | Yes | ✅ |
| Arbitrage incomplete 24h | #4 | Yes | ✅ |
| socMinLimit >= socMaxLimit | #5 | Yes | ✅ |
| Invalid mode | #6 | Yes | ✅ |
| Empty gatewayIds | #7 | Yes | ✅ |
| gatewayIds > 100 | #8 | Yes | ✅ |
| Gateway not found / RLS | #9 | Yes | ✅ |
| Active command conflict | #10 | Yes | ✅ |
| No historical schedule | #11 | Yes | ✅ |
| With historical schedule | #12 | Yes | ✅ |
| Mixed results | #13 | Yes | ✅ |
| Permission check (RBAC) | #14-15 | Yes | ✅ |
| Batch history aggregation | #16-20 | Yes | ✅ |
| P2/P4 data consistency | #21-23 | Yes | ✅ |
| Rated capacity UPSERT | #24-25 | Yes | ✅ |
| Rated capacity validation | #26-29 | Yes | ✅ |
| **allowExport preservation** | — | **Missing** | ⚠️ WARN |
| **Malformed historical payload** | — | **Missing** | ⚠️ WARN |
| **Concurrent batch dispatch race** | — | **Missing** | ⚠️ WARN |

**Verdict:** ⚠️ WARN — 3 edge case tests missing. Add to T8 test suite.

### 5.3 Risk of Breaking Existing P2 Functionality

| P2 Operation | Impact Analysis | Verdict |
|-------------|-----------------|---------|
| `PUT /gateways/:id/schedule` | No code changes in Phase 1. `batch_id` defaults NULL, `source` defaults 'p2'. | ✅ PASS |
| P2 reads latest schedule | P4 writes to same table → P2 reads P4's latest if newer. This is desired. | ✅ PASS |
| M3 `runPendingCommandDispatcher` | `WHERE result='pending'` unchanged. No new columns in WHERE. | ✅ PASS |
| M1 `CommandPublisher` | `WHERE result='dispatched'` unchanged. SELECT only reads existing columns. | ✅ PASS |
| M1 `CommandTracker` | Updates based on gateway_id + config_name + result. Unaffected. | ✅ PASS |
| P2 active command guard | If P4 writes pending, P2 correctly sees conflict → 409. Correct behavior. | ✅ PASS |

**Verdict:** ✅ PASS — No P2 regression risk identified.

### 5.4 Performance Risk (R2)

**Analysis:** For 100 gateways: 4 queries × 100 = 400 queries. At ~5ms each ≈ 2s. Lambda 10s timeout leaves margin but is tight with cold starts.

**PLAN R2 "方案 A" (batch queries):** The `DISTINCT ON` + `ANY($1)` pattern reduces to ~4 total queries regardless of gateway count.

**Verdict:** ⚠️ WARN — Implement batch query optimization as the **default implementation**, not a fallback. The per-gateway loop approach risks timeout at scale.

### 5.5 Phase 2 Rated Check Missing from Batch Dispatch

**Issue:** REQ F7 adds rated capacity check to `put-gateway-schedule.ts` (P2). There is **no corresponding check in `post-hems-batch-dispatch.ts` (P4)**.

P4 batch dispatch can send schedules with `maxChargeCurrent` exceeding `rated_max_power_kw`, while P2 would correctly reject the same values.

**Verdict:** ⚠️ WARN — Add rated capacity check to P4 handler in Phase 2 scope. Not blocking for Phase 1 (historical values are presumably within rated capacity since previously accepted).

### 5.6 Old `post-hems-dispatch.ts` Dead Code

**Observation:** The existing `post-hems-dispatch.ts` writes to `dispatch_commands` (wrong table) and is **not registered** in `bff-stack.ts`. The DESIGN creates a new file but doesn't mention cleanup.

**Verdict:** ⚠️ WARN — Delete or archive to avoid confusion.

---

## 6. Summary

### Issue Count

| Level | Count | Details |
|-------|-------|---------|
| ❌ FAIL | **0** | — |
| ⚠️ WARN | **7** | See below |
| ✅ PASS | **28** | All critical paths verified |

### WARN Items

| # | Issue | Section | Severity | Recommendation |
|---|-------|---------|----------|----------------|
| W1 | `allowExport` omitted for arbitrage discharge slots | §2.5 | Medium | Document as design decision; consider carrying forward historical value |
| W2 | Safety defaults (100A) aggressive for residential | §4.2 | Medium | Lower to 25A; or accept with documented rationale |
| W3 | Phase 2 rated check missing from P4 handler | §5.5 | Medium | Add to Phase 2 scope (new T11b task) |
| W4 | Batch query optimization should be default | §5.4 | Medium | Implement PLAN §4 方案A as default |
| W5 | 3 missing test cases | §5.2 | Low | Add to T8 test suite |
| W6 | Old `post-hems-dispatch.ts` is dead code | §5.6 | Low | Delete file |
| W7 | REQ F3 SQL syntax error (LIMIT in array_agg) | §4.7 | Low | Already fixed in DESIGN; update REQ for consistency |

### Verdict

## ✅ CAN EXECUTE — with recommended fixes

The DESIGN and PLAN are fundamentally sound:
- All F1-F8 requirements covered
- DomainSchedule generation logically correct for all three modes
- Codebase references (functions, tables, columns) all verified against source
- Edge cases well-handled with defense-in-depth
- Task dependencies correctly ordered
- No P2 regression risk

**Recommended before execution:**
1. **W4**: Implement batch query optimization as default (prevents Lambda timeout)
2. **W3**: Add rated capacity check to P4 handler in Phase 2 task list

**Recommended during execution:**
3. **W1**: Decide on `allowExport` behavior for P4 arbitrage slots
4. **W5**: Add 3 missing test cases to T8
5. **W2**: Review safety defaults with hardware team

**Can defer:**
6. **W6**: Clean up dead code
7. **W7**: Update REQ SQL
