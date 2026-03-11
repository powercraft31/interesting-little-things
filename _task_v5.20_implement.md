# v5.20 Implementation Plan — Atomic Steps

**Date:** 2026-03-11
**Author:** Claude (design phase)
**Prerequisites:** v5.19 fully applied (commit `9751f2a`)
**Design docs:** `design/backend_architecture/13_v5.20_ARCHITECTURE_UPDATE.md`, `frontend-v2/_task_v5.20_design.md`

---

## Step 1: DB Permissions + migration_v5.20.sql

### Files to create/modify
- **CREATE:** `backend/migrations/migration_v5.20.sql`

### Exact changes

Create new migration file with:

```sql
BEGIN;

-- Permission GRANTs missing from v5.19
GRANT SELECT, INSERT, UPDATE ON gateways TO solfacil_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateways TO solfacil_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_command_logs TO solfacil_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_command_logs TO solfacil_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_service;

-- device_command_logs schema updates for M3
ALTER TABLE device_command_logs
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acked_at TIMESTAMPTZ;

-- Index for M3 10s polling
CREATE INDEX IF NOT EXISTS idx_dcl_pending_dispatch
  ON device_command_logs (status, created_at)
  WHERE status = 'pending_dispatch';

COMMIT;
```

### Verification
```bash
# Apply migration
psql -U solfacil_service -d solfacil_vpp -f backend/migrations/migration_v5.20.sql

# Verify GRANTs
psql -U solfacil_app -d solfacil_vpp -c "SELECT * FROM gateways LIMIT 1;"
psql -U solfacil_app -d solfacil_vpp -c "SELECT * FROM device_command_logs LIMIT 1;"

# Verify new columns
psql -U solfacil_service -d solfacil_vpp -c "\d device_command_logs" | grep -E 'dispatched_at|acked_at'

# Verify index
psql -U solfacil_service -d solfacil_vpp -c "\di idx_dcl_pending_dispatch"
```

---

## Step 2: M2 schedule-generator `homes` → `gateways` fix

### Files to modify
- `backend/src/optimization-engine/services/schedule-generator.ts` — L51

### Exact changes

**L51:** Replace `LEFT JOIN homes h ON h.home_id = a.home_id` → `LEFT JOIN gateways g ON g.gateway_id = a.gateway_id`

**L45:** Replace `h.contracted_demand_kw` → `g.contracted_demand_kw`

Full diff:
```diff
-        h.contracted_demand_kw
+        g.contracted_demand_kw
       FROM assets a
       LEFT JOIN device_state d ON d.asset_id = a.asset_id
       LEFT JOIN vpp_strategies vs ON vs.org_id = a.org_id
         AND vs.target_mode = a.operation_mode
         AND vs.is_active = true
-      LEFT JOIN homes h ON h.home_id = a.home_id
+      LEFT JOIN gateways g ON g.gateway_id = a.gateway_id
       WHERE a.is_active = true
```

### Also fix command-dispatcher.ts (same `homes` reference)

**File:** `backend/src/dr-dispatcher/services/command-dispatcher.ts` — L66-69

```diff
-            SELECT h.contracted_demand_kw,
+            SELECT g.contracted_demand_kw,
                    COALESCE(ts.billing_power_factor, 0.92) AS billing_power_factor
             FROM assets a
-            JOIN homes h ON h.home_id = a.home_id
+            JOIN gateways g ON g.gateway_id = a.gateway_id
             LEFT JOIN tariff_schedules ts ON ts.org_id = a.org_id
```

### Verification
```bash
# Build
cd backend && npm run build

# Run schedule generator manually (if test harness exists)
npx ts-node -e "
  const { Pool } = require('pg');
  const { runScheduleGenerator } = require('./src/optimization-engine/services/schedule-generator');
  const pool = new Pool({ connectionString: process.env.SERVICE_DATABASE_URL });
  runScheduleGenerator(pool).then(() => { console.log('OK'); pool.end(); });
"

# Verify no "relation homes does not exist" error
# Check trade_schedules has new rows
psql -U solfacil_service -d solfacil_vpp -c "SELECT COUNT(*) FROM trade_schedules WHERE planned_time > NOW();"
```

---

## Step 3: BFF 0-vs-null purge (get-assets.ts)

### Files to modify
- `backend/src/bff/handlers/get-assets.ts` — L153-216

### Exact changes

**Add helper functions at top of file (after imports, ~L14):**

```typescript
function toNum(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val));
  return Number.isNaN(n) ? null : n;
}

function toInt(val: unknown): number | null {
  if (val == null) return null;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? null : n;
}
```

**Replace L163-199 field mappings:**

| Line | BEFORE | AFTER |
|------|--------|-------|
| 163 | `capacidade: parseFloat(String(r.capacidade)) \|\| 0` | `capacidade: toNum(r.capacidade)` |
| 164 | `capacity_kwh: parseFloat(String(r.capacity_kwh)) \|\| 0` | `capacity_kwh: toNum(r.capacity_kwh)` |
| 165 | `socMedio: Math.round(parseFloat(String(r.battery_soc)) \|\| 0)` | `socMedio: r.battery_soc != null ? Math.round(toNum(r.battery_soc)!) : null` |
| 168 | `investimento: parseFloat(String(r.investimento_brl)) \|\| 0` | `investimento: toNum(r.investimento_brl)` |
| 169 | `receitaHoje: parseFloat(String(r.receita_hoje_brl)) \|\| 0` | `receitaHoje: toNum(r.receita_hoje_brl)` |
| 170 | `receitaMes: parseFloat(String(r.receita_mes_brl)) \|\| 0` | `receitaMes: toNum(r.receita_mes_brl)` |
| 172 | `custoHoje: parseFloat(String(r.custo_hoje_brl)) \|\| 0` | `custoHoje: toNum(r.custo_hoje_brl)` |
| 173 | `lucroHoje: parseFloat(String(r.lucro_hoje_brl)) \|\| 0` | `lucroHoje: toNum(r.lucro_hoje_brl)` |
| 177 | `pv_power: parseFloat(String(r.pv_power)) \|\| 0` | `pv_power: toNum(r.pv_power)` |
| 178 | `battery_power: parseFloat(String(r.battery_power)) \|\| 0` | `battery_power: toNum(r.battery_power)` |
| 179 | `grid_power_kw: parseFloat(String(r.grid_power_kw)) \|\| 0` | `grid_power_kw: toNum(r.grid_power_kw)` |
| 180 | `load_power: parseFloat(String(r.load_power)) \|\| 0` | `load_power: toNum(r.load_power)` |
| 182 | `grid_import_kwh: parseFloat(String(r.grid_import_kwh)) \|\| 0` | `grid_import_kwh: toNum(r.grid_import_kwh)` |
| 183 | `grid_export_kwh: parseFloat(String(r.grid_export_kwh)) \|\| 0` | `grid_export_kwh: toNum(r.grid_export_kwh)` |
| 184 | `pv_daily_energy: parseFloat(String(r.pv_daily_energy)) \|\| 0` | `pv_daily_energy: toNum(r.pv_daily_energy)` |
| 185 | `bat_charged_today: parseFloat(String(r.bat_charged_today)) \|\| 0` | `bat_charged_today: toNum(r.bat_charged_today)` |
| 186 | `bat_discharged_today: parseFloat(String(r.bat_discharged_today)) \|\| 0` | `bat_discharged_today: toNum(r.bat_discharged_today)` |
| 189 | `battery_soc: parseFloat(String(r.battery_soc)) \|\| 0` | `battery_soc: toNum(r.battery_soc)` |
| 190 | `bat_soh: parseFloat(String(r.bat_soh)) \|\| 0` | `bat_soh: toNum(r.bat_soh)` |
| 195 | `battery_voltage: parseFloat(String(r.battery_voltage)) \|\| 0` | `battery_voltage: toNum(r.battery_voltage)` |
| 196 | `bat_cycle_count: parseInt(String(r.bat_cycle_count), 10) \|\| 0` | `bat_cycle_count: toInt(r.bat_cycle_count)` |
| 197 | `inverter_temp: parseFloat(String(r.inverter_temp)) \|\| 0` | `inverter_temp: toNum(r.inverter_temp)` |
| 199 | `grid_frequency: parseFloat(String(r.grid_frequency)) \|\| 0` | `grid_frequency: toNum(r.grid_frequency)` |

**KEEP unchanged (strategy defaults):**
- L207: `max_charge_rate: parseFloat(String(r.max_charge_rate_kw)) || 3.3` — strategy default
- L213: `target_self_consumption_pct: parseFloat(String(r.target_self_consumption_pct)) || 80` — strategy default

### Verification
```bash
cd backend && npm run build

# Test API response
curl -s http://localhost:3001/api/assets \
  -H "Authorization: Bearer <token>" | jq '.data.assets[0].status'
# Expect: fields with null instead of 0 when DB has NULL

# Run existing tests
npm test -- --grep "get-assets"
```

---

## Step 4: P6 Scorecard hardcode removal

### Files to modify
- `backend/src/bff/handlers/get-performance-scorecard.ts` — L47-268

### Exact changes

**Add 2 new queries to the `Promise.all` at L47-112:**

After `ssResult` (L104-111), add:

```typescript
// Commissioning Time (avg minutes)
queryWithOrg(
  `SELECT ROUND(AVG(
     EXTRACT(EPOCH FROM (
       (SELECT MIN(recorded_at) FROM telemetry_history th WHERE th.asset_id = a.asset_id)
       - a.commissioned_at
     )) / 60
   ), 0) AS avg_commission_min
   FROM assets a
   WHERE a.is_active = true AND a.commissioned_at IS NOT NULL`,
  [], rlsOrgId,
),
// Manual Interventions (last 7 days)
queryWithOrg(
  `SELECT COUNT(*)::int AS manual_count
   FROM device_command_logs
   WHERE command_type = 'manual'
     AND created_at > NOW() - INTERVAL '7 days'`,
  [], rlsOrgId,
),
```

**Update destructuring (L47):** Add `commissionResult, manualResult`

**Replace hardcoded metrics:**

| Metric | Line | Before | After |
|--------|------|--------|-------|
| Commissioning Time | L165-170 | `value: 45` | `value: commissionResult.rows[0]?.avg_commission_min != null ? parseFloat(String(commissionResult.rows[0].avg_commission_min)) : null` |
| First Telemetry | L186-191 | `value: 5` | `value: null` (needs `first_telemetry_at` column — deferred) |
| PV Forecast MAPE | L224-229 | `value: 8.2, status: "pass"` | `value: null, status: "warn"` |
| Load Forecast Adapt | L231-236 | `value: 92, status: "pass"` | `value: null, status: "warn"` |
| Training Time | L248-253 | `value: 2, status: "pass"` | `value: null, status: "warn"` |
| Manual Interventions | L255-259 | `value: 0, status: "pass"` | `value: parseInt(String(manualResult.rows[0]?.manual_count ?? 0), 10)` + proper evalStatus |
| App Uptime | L261-267 | `value: 99.9, status: "pass"` | `value: null, status: "warn"` (Gemini Decision #2) |

**Also fix `selfConsumptionPct` and `selfSufficiencyPct` (L146, L150):**

```diff
-  const selfConsumptionPct = parseFloat(String(scRow?.avg_sc ?? 0));
+  const selfConsumptionPct = scRow?.avg_sc != null ? parseFloat(String(scRow.avg_sc)) : null;

-  const selfSufficiencyPct = parseFloat(String(ssRow?.avg_ss ?? 0));
+  const selfSufficiencyPct = ssRow?.avg_ss != null ? parseFloat(String(ssRow.avg_ss)) : null;
```

**Fix `avgUptime` (L114-116):**

```diff
-  const avgUptime = parseFloat(
-    String((uptimeResult.rows[0] as Record<string, unknown>)?.avg_uptime ?? 95),
-  );
+  const uptimeRaw = (uptimeResult.rows[0] as Record<string, unknown>)?.avg_uptime;
+  const avgUptime = uptimeRaw != null ? parseFloat(String(uptimeRaw)) : null;
```

### Verification
```bash
cd backend && npm run build

curl -s http://localhost:3001/api/performance/scorecard \
  -H "Authorization: Bearer <token>" | jq '.data.optimization'
# Expect: PV Forecast MAPE, Load Forecast Adapt → value: null
# Expect: Commissioning Time → value: <number or null>

curl -s http://localhost:3001/api/performance/scorecard \
  -H "Authorization: Bearer <token>" | jq '.data.operations'
# Expect: Training Time, App Uptime → value: null
# Expect: Manual Interventions → value: <count>

npm test -- --grep "scorecard"
```

---

## Step 5: Frontend null-safety formalization (p3, p4)

### Files to modify
- `frontend-v2/js/utils.js` (or wherever `formatNumber`/`formatPercent` are defined)
- `frontend-v2/js/p4-hems.js` — L340-373
- `frontend-v2/js/p3-energy.js` — confirm existing guards are correct
- `frontend-v2/js/i18n.js` — add new keys

### Exact changes

**utils.js — `formatNumber` and `formatPercent`:**

```diff
 function formatNumber(val, decimals) {
-  if (val == null || isNaN(val)) return "0";
+  if (val == null || (typeof val === 'number' && isNaN(val))) return "\u2014";
   return Number(val).toFixed(decimals || 0);
 }

 function formatPercent(val) {
-  if (val == null || isNaN(val)) return "0%";
+  if (val == null || (typeof val === 'number' && isNaN(val))) return "\u2014";
   return Number(val).toFixed(1) + "%";
 }
```

**p4-hems.js — L340-373 `_buildAckStatusCard`:**

Replace entire method body (see frontend design doc §4.3 for full code). Key change: return empty state card when `lastDispatch` is null/undefined.

**p3-energy.js — Confirm existing guards:**
- L208-209: `_buildBACards` null guard — **KEEP** (already correct)
- L433: `_initMainChart` timeLabels check — **KEEP** (already correct)
- L46-48: `baCompare().catch(...)` — See Step 6

**i18n.js — Add keys:**

```javascript
"hems.noRecentDispatch": "No recent dispatch",
// PT-BR:
"hems.noRecentDispatch": "Nenhum despacho recente",
```

### Verification
```bash
# Open browser, navigate to P4 HEMS
# With no lastDispatch data, should show "No recent dispatch" instead of crash

# Open browser, navigate to P1 Fleet
# KPI cards with null values should show "—" instead of "0"

# Open browser DevTools console — zero errors on all pages
```

---

## Step 6: P3 baCompare removal/nullification

### Files to modify
- `frontend-v2/js/p3-energy.js` — L42-55 and L182-205

### Exact changes (Gemini Decision #1)

**Option A — Remove Before/After card entirely:**

**L42-55:** Remove baCompare calls from Promise.all:

```diff
       var secondResults = await Promise.all([
         self._currentGateway
           ? DataSource.energy.gatewayEnergy(self._currentGateway)
           : Promise.resolve({}),
-        DataSource.energy.baCompare(0).catch(function() { return {}; }),
-        DataSource.energy.baCompare(1).catch(function() { return {}; }),
-        DataSource.energy.baCompare(2).catch(function() { return {}; }),
       ]);
       self._currentEnergyData = secondResults[0];
-      self._baCompare = {
-        0: secondResults[1],
-        1: secondResults[2],
-        2: secondResults[3],
-      };
+      self._baCompare = {};
```

**L182-205:** `_buildBeforeAfterCard` returns empty:

```diff
   _buildBeforeAfterCard: function () {
+    // Gemini Decision #1: baCompare returns null — no baseline model yet
+    return '';
-    var gateways = this._gateways || [];
-    // ... entire existing body ...
   },
```

**L362-370:** Remove baCompare update from `_switchGateway`:

```diff
-    var gateways = self._gateways || [];
-    var gwIdx = gateways.findIndex(function (gw) {
-      return gw.gatewayId === gatewayId;
-    });
-    if (gwIdx < 0) gwIdx = 0;
-    var ba = self._baCompare[gwIdx];
-    var cardsEl = document.getElementById("p3-ba-cards");
-    if (cardsEl && ba) {
-      cardsEl.innerHTML = self._buildBACards(ba);
-    }
```

### Verification
```bash
# Open P3 Energy page
# Before/After card should not appear
# No console errors related to baCompare
# No 502 errors in Network tab
```

---

## Step 7: P2 Energy Flow CSS Grid + SVG

### Files to modify
- `frontend-v2/css/pages.css` — L1874-1929
- `frontend-v2/js/p2-devices.js` — L419-496 (`_buildEnergyFlow`)

### Exact changes

**pages.css L1874-1929:** Replace existing energy flow CSS with new version (see frontend design doc §2 for complete CSS).

Key changes:
- Keep 5×5 grid layout (already correct)
- Remove `.ef-line-*` absolute-positioned divs
- Add `.ef-svg-overlay` and SVG line classes
- Add SVG arrow marker styles

**p2-devices.js `_buildEnergyFlow`:** Replace L460-493 body construction with SVG overlay approach (see frontend design doc §2 for complete JS).

Key changes:
- Replace `ef-line-top/left/right/bottom` divs with inline SVG
- SVG lines use `<line>` elements with arrow markers
- Direction logic: `batteryPower > 0` = Hub→Battery (charging), `< 0` = Battery→Hub
- Direction logic: `gridPowerKw > 0` = Grid→Hub (importing), `< 0` = Hub→Grid

**Also fix null display (L420-433):**
- Change `"0 kW"` fallback to `"—"` for null values

### Verification
```bash
# Open P2, click a gateway, click a device
# Energy Flow diamond should show:
#   - 4 nodes (PV top, Battery left, Load right, Grid bottom)
#   - SVG lines with arrowheads between active nodes and center hub
#   - Lines hidden when power is 0 or null
#   - Arrow direction matches power flow direction
#   - Colors: green (PV), purple (battery), white (load), blue (grid)

# Screenshot at 1440px, 1024px, and 768px widths
```

---

## Step 8: CSS Responsive (@media 3 breakpoints)

### Files to modify
- `frontend-v2/css/layout.css` — L275-333 (replace existing @media)
- `frontend-v2/css/components.css` — add responsive rules for `two-col`, `data-table`
- `frontend-v2/css/pages.css` — add responsive rules for page components
- `frontend-v2/index.html` — add hamburger button to top-bar (for <1024px)

### Exact changes

**layout.css L275-333:** Replace both existing `@media` blocks with 3-breakpoint system (see frontend design doc §3 for complete CSS).

Breakpoints:
- `>=1440px`: Default (no media query)
- `@media (max-width: 1439px)`: Sidebar icon-only (60px)
- `@media (max-width: 1023px)`: Sidebar hidden + hamburger overlay

**components.css — Add after L293 (`.two-col` definition):**

```css
@media (max-width: 1439px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1023px) {
  .data-table-wrapper {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .data-table {
    min-width: 600px;
  }
}
```

**pages.css — Add responsive rules at end of file** for:
- `.gw-meta` wrap at <1440px
- `.detail-page` single-column at <1024px
- `.energy-flow-diamond` resize at <1024px
- `.p4-mode-cards` layout changes
- `.p4-filter-row` vertical stack at <1024px

**index.html — Add hamburger button:**

Inside `.top-bar`, before `.page-title`:
```html
<button class="hamburger-btn" onclick="document.querySelector('.sidebar').classList.toggle('sidebar-open')">☰</button>
```

CSS toggle:
```css
.hamburger-btn { display: none; }

@media (max-width: 1023px) {
  .hamburger-btn { display: flex; /* ... */ }
}
```

### Verification
```bash
# Test 3 viewport widths:

# 1440px: Full sidebar visible, 6-col KPI, 2-col charts, full tables
# 1024px: Icon-only sidebar, 3-col KPI, single-col charts
# 768px: No sidebar (hamburger), 2-col KPI, horizontal-scroll tables

# Use Chrome DevTools responsive mode
# Screenshot each width on P1, P2, P3, P4, P5, P6
# Check: no overflow, no truncation, no overlapping elements
```

---

## Step 9: M3 command-dispatcher implementation

### Files to modify
- `backend/src/dr-dispatcher/services/command-dispatcher.ts` — add `runPendingCommandDispatcher`, timeout check
- **CREATE:** `backend/src/iot-hub/mqtt-client.ts` (stub)

### Exact changes

**command-dispatcher.ts:**

1. **L4-6 `startCommandDispatcher`:** Add 10s interval for pending commands + 30s timeout check

2. **Append new function `runPendingCommandDispatcher`** (see backend architecture doc §2 for full code):
   - Query `device_command_logs WHERE status='pending_dispatch' ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`
   - Update status to `dispatched`, set `dispatched_at`
   - Call `publishMqtt(topic, payload)` for each
   - Log count

3. **Append `runTimeoutCheck`:**
   - `UPDATE device_command_logs SET status='timeout' WHERE status='dispatched' AND dispatched_at < NOW() - INTERVAL '90 seconds'`

**mqtt-client.ts (new file):**

```typescript
// Stub — replace with actual EMQX connection when available
export async function publishMqtt(topic: string, payload: string): Promise<void> {
  console.log(`[MQTT STUB] topic=${topic} payload=${payload.substring(0, 100)}...`);
}
```

### Verification
```bash
cd backend && npm run build

# Insert a test pending command
psql -U solfacil_service -d solfacil_vpp -c "
  INSERT INTO device_command_logs (gateway_id, asset_id, command_type, payload, status, created_at)
  VALUES ('WKRD24070202100144F', 'ASSET-001', 'schedule_update', '{\"test\": true}', 'pending_dispatch', NOW());
"

# Start the service and wait 10 seconds
# Check logs for: [PendingCommandDispatcher] Dispatched 1 commands
# Check DB:
psql -U solfacil_service -d solfacil_vpp -c "
  SELECT id, status, dispatched_at FROM device_command_logs ORDER BY id DESC LIMIT 5;
"
# Expect: status='dispatched', dispatched_at IS NOT NULL

# Wait 90 seconds, check timeout:
psql -U solfacil_service -d solfacil_vpp -c "
  SELECT id, status FROM device_command_logs WHERE status='timeout';
"
```

---

## Step 10: Test Suite Update + Full Regression

### Files to modify/create
- `backend/test/bff/get-assets.test.ts` — update assertions for null fields
- `backend/test/bff/get-performance-scorecard.test.ts` — update for null hardcodes
- `backend/test/bff/get-gateway-energy.test.ts` — update for null tariff fallback
- `backend/test/optimization-engine/schedule-generator.test.ts` — verify gateways join
- `backend/test/dr-dispatcher/command-dispatcher.test.ts` — add pending dispatch test
- Frontend: manual E2E test on all 6 pages

### Test cases to add/update

**get-assets.test.ts:**
```
✓ should return null (not 0) for telemetry fields when DB has NULL
✓ should return null for battery_soc when device_state has no row
✓ should return null for financial fields when revenue_daily has no row
✓ should keep strategy defaults (max_charge_rate=3.3) when vpp_strategies has no row
```

**get-performance-scorecard.test.ts:**
```
✓ should return null for PV Forecast MAPE (no ML pipeline)
✓ should return null for Load Forecast Adapt (no ML pipeline)
✓ should return null for Training Time (no ML pipeline)
✓ should return null for App Uptime (Gemini Decision #2)
✓ should return DB-computed value for Manual Interventions
✓ should return "warn" status for all null-valued metrics
```

**get-gateway-energy.test.ts:**
```
✓ should return null savingsBrl when no tariff_schedules exist
✓ should keep COALESCE(0) for SUM aggregates in energy query
```

**command-dispatcher.test.ts:**
```
✓ should process pending_dispatch commands within 10s
✓ should mark commands as timeout after 90s with no ACK
✓ should respect LIMIT 50 per cycle
✓ should use FOR UPDATE SKIP LOCKED for concurrency safety
```

### Verification
```bash
cd backend && npm test

# Expected: All tests pass
# Expected: 0 hardcoded values in scorecard
# Expected: 0 uses of parseFloat(...) || 0 for telemetry fields

# Full E2E check (manual):
# P1: KPI cards show "—" for null values
# P2: Energy Flow diamond with SVG arrows
# P3: No baCompare card, no console errors
# P4: lastDispatch null → shows "No recent dispatch"
# P5: KPI cards show "—" for null values
# P6: Scorecard shows "—" for 3 prediction metrics + App Uptime

# Responsive check (manual):
# Each page at 1440px, 1024px, 768px — no overflow, no crash
```

---

## Dependency Graph

```
Step 1 (DB migration)
  ├── Step 2 (M2 schedule-generator) — independent
  ├── Step 9 (M3 command-dispatcher) — needs dispatched_at column
  └── Step 3 (BFF null purge) — needs GRANTs
       └── Step 4 (P6 scorecard) — depends on Step 3 pattern
            └── Step 5 (Frontend null-safety) — depends on BFF returning null
                 ├── Step 6 (baCompare removal)
                 ├── Step 7 (Energy Flow SVG) — independent
                 └── Step 8 (CSS responsive) — independent
                      └── Step 10 (Tests) — depends on all above
```

**Parallelizable groups:**
- Group A (backend): Steps 1 → {2, 3, 9} in parallel → 4
- Group B (frontend): Steps 5 → {6, 7, 8} in parallel
- Group C (tests): Step 10 (after A+B complete)

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `commissioned_at` column doesn't exist in `assets` | Step 4 Commissioning Time query fails | Check `\d assets` first; if missing, set `value: null` |
| `command_type = 'manual'` has no data | Manual Interventions always 0 | Acceptable — COUNT(*) returns 0 for empty result |
| Frontend `formatNumber` change breaks existing tests | Tests expect `"0"` string | Update test assertions to expect `"—"` |
| SVG arrow positions off on different screen sizes | Diamond looks wrong | Use `viewBox` for resolution-independent SVG |
| Hamburger sidebar needs JS despite "CSS-only" decision | Decision #3 conflict | Single `classList.toggle` is acceptable (not state management) |
