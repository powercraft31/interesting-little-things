# v5.20 Fix — Step-by-Step Execution Plan

**Date:** 2026-03-11
**Execution order:** #3 → #2 → #1 → #4 (dependency chain)
**Design refs:**
- `design/v5.20_fix_requirements.md`
- `design/backend_architecture/14_v5.20_FIX_UPDATE.md`
- `frontend-v2/_task_v5.20_fix_design.md`

---

## Phase 1: Fix #3 — Layer 3 Gateway-Level (Backend + Frontend)

### Step 1.1: Create `get-gateway-detail.ts`

**File:** `backend/src/bff/handlers/get-gateway-detail.ts` (NEW)

**Action:** Create new handler per `14_v5.20_FIX_UPDATE.md` §1. Runs 4 parallel SQL queries (Q1-Q4), assembles gateway-level aggregated response.

**Before:** File does not exist. Layer 3 uses `GET /api/devices/{assetId}` via `get-device-detail.ts`.

**After:** New file with handler function:
- Q1: gateway + devices + device_state JOIN
- Q2: telemetry extras (inverter-priority)
- Q3: VPP strategy defaults
- Q4: latest schedule from device_command_logs
- Aggregation logic: group by asset_type, pick primary inverter

**Verify:**
```bash
cd backend && npx ts-node -e "
  const h = require('./src/bff/handlers/get-gateway-detail');
  console.log(typeof h.handler === 'function' ? 'OK' : 'FAIL');
"
```

### Step 1.2: Create `get-gateway-schedule.ts` and `put-gateway-schedule.ts`

**Files:**
- `backend/src/bff/handlers/get-gateway-schedule.ts` (NEW — copy from `get-device-schedule.ts`)
- `backend/src/bff/handlers/put-gateway-schedule.ts` (NEW — copy from `put-device-schedule.ts`)

**Action:** Copy existing device-level handlers, change path parameter from `assetId` to `gatewayId`, remove asset→gateway lookup query, query `device_command_logs` directly with `gateway_id = $1`. See `14_v5.20_FIX_UPDATE.md` §3.

**Before:** Schedule API uses `assetId` path: `GET/PUT /api/devices/:assetId/schedule`

**After:** Schedule API uses `gatewayId` path: `GET/PUT /api/gateways/:gatewayId/schedule`. Gateway validation: `SELECT 1 FROM gateways WHERE gateway_id = $1`.

**Verify:**
```bash
cd backend && npx ts-node -e "
  const g = require('./src/bff/handlers/get-gateway-schedule');
  const p = require('./src/bff/handlers/put-gateway-schedule');
  console.log(typeof g.handler, typeof p.handler);
"
```

### Step 1.3: Register routes in `local-server.ts`

**File:** `backend/scripts/local-server.ts` (MODIFY)

**Before:** No gateway-level detail/schedule routes.

**After:** Add 3 new routes:
```typescript
app.get("/api/gateways/:gatewayId/detail", wrapHandler(getGatewayDetail.handler, "gatewayId"));
app.get("/api/gateways/:gatewayId/schedule", wrapHandler(getGatewaySchedule.handler, "gatewayId"));
app.put("/api/gateways/:gatewayId/schedule", wrapHandler(putGatewaySchedule.handler, "gatewayId"));
```

Keep old device-level schedule routes as deprecated aliases (remove in v5.21).

**Verify:**
```bash
cd backend && npm run dev &
sleep 3
# Test gateway detail endpoint
curl -s -H 'Authorization: {"userId":"demo","orgId":"ORG_ENERGIA_001","role":"SOLFACIL_ADMIN"}' \
  http://localhost:3000/api/gateways/WKRD24070202100141I/detail | jq '.success'
# Expected: true

# Test gateway schedule endpoint
curl -s -H 'Authorization: {"userId":"demo","orgId":"ORG_ENERGIA_001","role":"SOLFACIL_ADMIN"}' \
  http://localhost:3000/api/gateways/WKRD24070202100141I/schedule | jq '.success'
# Expected: true

kill %1
```

### Step 1.4: Register CDK routes in `bff-stack.ts`

**File:** `backend/lib/bff-stack.ts` (MODIFY)

**Before:** No gateway detail/schedule routes in CDK.

**After:** Add 3 entries:
```typescript
{ method: "GET", path: "/api/gateways/{gatewayId}/detail", handler: "get-gateway-detail" },
{ method: "GET", path: "/api/gateways/{gatewayId}/schedule", handler: "get-gateway-schedule" },
{ method: "PUT", path: "/api/gateways/{gatewayId}/schedule", handler: "put-gateway-schedule" },
```

**Verify:**
```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
# Expected: no new errors
```

### Step 1.5: Frontend — DataSource changes

**File:** `frontend-v2/js/data-source.js` (MODIFY)

**Before:**
- `deviceDetail(assetId)` → `GET /api/devices/:assetId`
- `getSchedule(assetId)` → `GET /api/devices/:assetId/schedule`
- `putSchedule(assetId, slots)` → `PUT /api/devices/:assetId/schedule`

**After:**
- ADD `gatewayDetail(gatewayId)` → `GET /api/gateways/:gatewayId/detail`
- MODIFY `getSchedule(gatewayId)` → `GET /api/gateways/:gatewayId/schedule`
- MODIFY `putSchedule(gatewayId, slots)` → `PUT /api/gateways/:gatewayId/schedule`
- Keep `deviceDetail(assetId)` as-is (deprecated, still used by mock mode)

**Verify:** Open browser console after page load:
```javascript
DataSource.devices.gatewayDetail("WKRD24070202100141I").then(d => console.log("gateway:", d.gateway.name));
// Expected: logs gateway name
```

### Step 1.6: Frontend — Navigation refactor

**File:** `frontend-v2/js/p2-devices.js` (MODIFY)

**Changes:**
1. `_buildGwCard()` — Add `.gw-detail-link` wrapper around gateway name
2. `_setupLayer1Events()` — Split: chevron click → expand, name click → Layer 3 GW
3. `_attachDeviceRowListeners()` — Remove click → Layer 3 (info-only rows)
4. ADD `_openLayer3GW(gatewayId)` — Calls `DataSource.devices.gatewayDetail()`
5. ADD `_buildLayer3GW()` — Reads gateway-level response, renders left-col (EnergyFlow, BatteryStatus, InverterGrid) + right-col (config, schedule, health)
6. ADD `_buildDeviceConfigGW(devices, config)` — Read-only config card

**Before:** Click device row → `_openLayer3(assetId)` → device-level detail page.

**After:** Click gateway name → `_openLayer3GW(gwId)` → gateway-level detail page with merged data.

**Verify:** Manual browser test:
1. Navigate to P2 Devices page
2. Click Gateway name (not chevron) → Layer 3 opens showing gateway-level data
3. Click chevron → device list expands (no Layer 3 navigation on device rows)
4. Energy Flow, Battery Status, Inverter & Grid cards show merged data from gateway detail API

### Step 1.7: Frontend — CSS additions for Fix #3

**File:** `frontend-v2/css/pages.css` (MODIFY)

**Add:** `.gw-detail-link`, `.device-chip`, `.device-chips-row` styles.
**Modify:** Remove `cursor: pointer` from `.device-row` (L1806).

**Verify:** Visual inspection — gateway name shows hover underline, device rows no longer show pointer cursor.

---

## Phase 2: Fix #2 — Grid Data Priority Logic (Backend Only)

### Step 2.1: Implement grid merge in `get-gateway-detail.ts`

**File:** `backend/src/bff/handlers/get-gateway-detail.ts` (MODIFY — created in Step 1.1)

**Action:** This is already part of Step 1.1's aggregation logic. Confirm the `mergeGridData()` function implements the fallback chain:

```
1. Primary inverter's device_state.grid_power_kw
2. First online smart meter's device_state.grid_power_kw
3. null
```

Same chain for telemetryExtra grid fields (voltage, current, power factor, totalBuyKwh, totalSellKwh).

**Before:** No gateway-level grid data merge exists.

**After:** `get-gateway-detail.ts` handler groups Q1 rows by `asset_type`, picks primary inverter, falls back to smart meter for grid fields when inverter grid data is null.

**Verify:**
```bash
cd backend && npm run dev &
sleep 3

# Check that grid_power_kw comes from inverter (value = 60.000 from test data)
curl -s -H 'Authorization: {"userId":"demo","orgId":"ORG_ENERGIA_001","role":"SOLFACIL_ADMIN"}' \
  http://localhost:3000/api/gateways/WKRD24070202100141I/detail | jq '.data.state.gridPowerKw'
# Expected: 60 (from inverter, not null/from meter)

kill %1
```

### Step 2.2: Verify no changes to `fragment-assembler.ts`

**Action:** Confirm decision — grid merge is BFF-level only. `fragment-assembler.ts` continues to write per-device rows. No code changes.

**Verify:**
```bash
git diff backend/src/iot-hub/services/fragment-assembler.ts
# Expected: no changes
```

---

## Phase 3: Fix #1 — Daily Schedule Editor UI (Frontend Only)

### Step 3.1: Add editable schedule methods

**File:** `frontend-v2/js/p2-devices.js` (MODIFY)

**Add methods:**
1. `_buildScheduleCardEditable(schedule)` — Editable card with timeline bar, table, Add Slot button, Apply button inside card
2. `_buildSlotRow(slot, index)` — Single editable row with native `<select>` dropdowns
3. `_renderScheduleRows()` — Re-renders tbody + calls `_renderTimelinePreview()`
4. `_renderTimelinePreview()` — Updates `.schedule-bar` from `_pendingSlots`
5. `_attachSlotListeners()` — Binds change/delete events on slot rows
6. `_handleApplyGW()` — Validates and sends `PUT /api/gateways/:gatewayId/schedule`

**Add properties:**
- `_pendingSlots: []`
- `_currentGatewayId: null`

**Before:** Schedule card is read-only (`_buildScheduleCard`). Apply button at page bottom sends empty schedule.

**After:** Schedule card is editable. Users can add/delete/modify time slots with native dropdowns. Timeline bar updates in real-time. Apply button inside card sends `_pendingSlots` to gateway schedule API.

**Verify:** Manual browser test:
1. Open Layer 3 for test gateway
2. Click "+ Add Slot" — new row appears with Start/End/Mode dropdowns
3. Change Start hour dropdown → timeline bar updates
4. Click delete button on a row → row removed, timeline updates
5. Click Apply → toast shows "Schedule submitted"
6. Check DB: `SELECT * FROM device_command_logs WHERE gateway_id = 'WKRD24070202100141I' ORDER BY created_at DESC LIMIT 1;`

### Step 3.2: Update `_setupLayer3Events()` for schedule editor

**File:** `frontend-v2/js/p2-devices.js` (MODIFY)

**Before:** `_setupLayer3Events` only binds back button + apply button (at page bottom).

**After:** Also calls `_renderScheduleRows()` + `_attachSlotListeners()` + binds `#schedule-add-slot` and `#schedule-apply` buttons. Remove binding for old `#detail-apply` button.

**Verify:** Covered by Step 3.1 manual test.

### Step 3.3: Schedule editor CSS

**File:** `frontend-v2/css/pages.css` (MODIFY)

**Add:** `.schedule-table select.config-input`, `.schedule-mode-select`, `.btn-delete-slot`, `#schedule-add-slot`, `.schedule-apply-row`, `.btn-outline` styles.

**Verify:** Visual inspection — dropdowns styled consistently with existing config inputs, delete button shows red trash icon, Add Slot button is dashed outline full-width.

### Step 3.4: i18n keys

**File:** `frontend-v2/js/i18n.js` (MODIFY)

**Add keys:**
| Key | EN | PT-BR | ZH |
|-----|-----|-------|-----|
| `devices.addSlot` | + Add Slot | + Adicionar Slot | + 添加时段 |
| `devices.deleteSlot` | Delete | Remover | 删除 |
| `devices.invalidSchedule` | Invalid schedule: check start/end hours | Horario invalido | 时间表无效：请检查开始/结束时间 |
| `devices.gatewayHealth` | Gateway Health | Saude do Gateway | 网关健康 |

**Verify:**
```bash
grep -c "devices.addSlot" frontend-v2/js/i18n.js
# Expected: 3 (one per language)
```

---

## Phase 4: Fix #4 — EMS Health Display (Frontend Only)

### Step 4.1: Add `_buildGatewayHealth()` method

**File:** `frontend-v2/js/p2-devices.js` (MODIFY)

**Action:** Add `_buildGatewayHealth(emsHealth)` method. Renders 8 indicators (WiFi, CPU Temp, CPU Usage, Memory, Disk, Uptime, EMS Temp, SIM Status) in a 4-column CSS Grid.

**Before:** No EMS health display in Layer 3. Gateway Card shows only WiFi RSSI, firmware, uptime.

**After:** Layer 3 right column has a "Gateway Health" card with compact icon+value+label grid.

**Verify:** Manual browser test:
1. Open Layer 3 for online test gateway
2. Scroll to right column → "Gateway Health" card visible
3. Shows 8 indicators with icons, values from `emsHealth`
4. Values match raw DB: `SELECT ems_health FROM gateways WHERE gateway_id = 'WKRD24070202100141I';`

### Step 4.2: Enhance Gateway Card (Layer 1) with CPU/Memory

**File:** `frontend-v2/js/p2-devices.js` — `_buildGwCard()` (MODIFY)

**Before:** `.gw-meta` shows: deviceCount, WiFi RSSI, firmware, uptime, lastSeen

**After:** `.gw-meta` shows: deviceCount, WiFi RSSI, **CPU temp**, **Memory usage**, uptime, lastSeen (firmware removed — less useful)

**Verify:** Visual inspection — Gateway Card in Layer 1 shows CPU temp and memory values inline.

### Step 4.3: EMS Health CSS Grid

**File:** `frontend-v2/css/pages.css` (MODIFY)

**Add:** `.ems-health-grid`, `.ems-health-item`, `.ems-icon`, `.ems-value`, `.ems-label` styles. Responsive: 2-col on `<1023px`.

**Verify:** Visual inspection — 4-column grid on desktop, 2-column on narrow viewport.

---

## Commit Plan

| Commit | Scope | Files |
|--------|-------|-------|
| `fix(v5.20/#3): gateway-level detail endpoint + route registration` | Backend | `get-gateway-detail.ts` (NEW), `get-gateway-schedule.ts` (NEW), `put-gateway-schedule.ts` (NEW), `local-server.ts`, `bff-stack.ts` |
| `fix(v5.20/#3): frontend Layer 3 gateway-level navigation` | Frontend | `data-source.js`, `p2-devices.js`, `pages.css` |
| `fix(v5.20/#2): grid data priority inverter > smart meter (in BFF)` | Backend | `get-gateway-detail.ts` (already included in commit 1 — verify only) |
| `fix(v5.20/#1): schedule editor with add/delete/preview + gateway API` | Frontend | `p2-devices.js`, `pages.css`, `i18n.js` |
| `fix(v5.20/#4): EMS health CSS grid display` | Frontend | `p2-devices.js`, `pages.css` |

**Note:** Commits 1+2 can be squashed since Fix #2 is implemented inside the Fix #3 handler. The verify step in Phase 2 confirms the logic.

---

## Rollback Plan

Each fix is independent enough to revert:
- **Fix #3 rollback:** Revert frontend navigation to device-level (restore `_openLayer3(assetId)` as primary). Backend endpoints remain (no harm).
- **Fix #2 rollback:** N/A — logic is inside the new endpoint. Old endpoint unaffected.
- **Fix #1 rollback:** Revert `_buildScheduleCardEditable` → `_buildScheduleCard` (read-only).
- **Fix #4 rollback:** Remove `_buildGatewayHealth()` call from `_buildLayer3GW()`.
