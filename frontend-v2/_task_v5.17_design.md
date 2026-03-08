# SOLFACIL VPP v5.17 — Frontend Wiring Design Document

> **Author**: Claude Opus 4.6 (design-only, zero code)
> **Date**: 2026-03-08
> **Scope**: `frontend-v2/` only — BFF unchanged
> **Prerequisites**: v5.17_REQUIREMENTS.md + Gemini D1-D7 rulings

---

## 1. File Mutation Matrix

| # | File | Action | Summary | Est. Lines |
|---|------|--------|---------|------------|
| 1 | `index.html` | MODIFY | Add `<script src="../js/config.js">` before `data-source.js` | +1 |
| 2 | `js/data-source.js` | MODIFY | L1-1: API_BASE reads CONFIG; L1-2: withFallback strict mode (remove .catch fallback) | ~15 |
| 3 | `js/app.js` | MODIFY | `initPage()` switch cases: add `await` + error boundary wrapper | ~25 |
| 4 | `js/p1-fleet.js` | MODIFY | async init, 5 DataSource calls, date formatter for ISO→DD/MM | ~80 |
| 5 | `js/p2-devices.js` | MODIFY | async init, 2 DataSource calls (devices.list, devices.homes) | ~30 |
| 6 | `js/p3-energy.js` | MODIFY | async init, homeKey→homeId mapping, DataSource.energy.*, D1/D2 handling | ~100 |
| 7 | `js/p4-hems.js` | MODIFY | async init, DataSource.hems.overview, D3 ACK simplification | ~60 |
| 8 | `js/p5-vpp.js` | MODIFY | async init, 3 DataSource calls, date formatter, D4 DR trigger kept | ~50 |
| 9 | `js/p6-performance.js` | MODIFY | async init, DataSource.performance.*, remove alpha references | ~40 |
| 10 | `js/i18n.js` | MODIFY | Add 3 new metric keys + 2 error banner keys (3 languages each) | +15 |
| 11 | `js/mock-data.js` | NO CHANGE | Retained for `USE_LIVE_API=false` mode | 0 |
| 12 | `js/components.js` | MODIFY | Add `Components.errorBanner()` helper for API failure UI | +15 |
| 13 | `js/charts.js` | NO CHANGE | — | 0 |
| | | | **Total** | **~431** |

---

## 2. L1 Configuration & Interceptor Design

### 2.1 D6: Inject Global Config (index.html)

**Problem**: `frontend-v2/index.html` does not load `js/config.js`. `data-source.js` falls back to `http://localhost:3000`.

**Solution**: Add one `<script>` tag in `index.html`, **before** `data-source.js`:

```
Current load order:
  <script src="js/mock-data.js">
  <script src="js/data-source.js">    ← API_BASE = localhost:3000
  ...

New load order:
  <script src="js/mock-data.js">
  <script src="../js/config.js">       ← NEW: sets window.CONFIG
  <script src="js/data-source.js">     ← API_BASE now reads CONFIG
  ...
```

### 2.2 API_BASE URL De-duplication

**Problem**: `CONFIG.BFF_API_URL` = `"https://152.42.235.155:8443/api"` (ends with `/api`). DataSource methods call `apiGet("/api/fleet/overview")` — resulting in `https://…:8443/api/api/fleet/overview` (doubled `/api`).

**Solution**: In `data-source.js`, strip trailing `/api` from CONFIG value:

```
Pseudocode:
  raw = CONFIG.BFF_API_URL                          // "https://…:8443/api"
  API_BASE = raw.replace(/\/api\/?$/, "")           // "https://…:8443"
```

This preserves the DataSource's existing `/api/…` path convention while respecting the CONFIG value. If CONFIG doesn't end with `/api`, no stripping occurs.

### 2.3 D7: withFallback Strict Mode

**Current** (`data-source.js:63-69`):
```js
function withFallback(apiCall, mockData) {
  if (!USE_LIVE_API) return Promise.resolve(mockData);
  return apiCall().catch(function (err) {
    console.warn("[DataSource] API failed, using mock:", err.message);
    return mockData;  // ← SILENT FALLBACK (DANGEROUS)
  });
}
```

**New** (D7 ruling — strict mode):
```js
function withFallback(apiCall, mockData) {
  if (!USE_LIVE_API) return Promise.resolve(mockData);
  return apiCall();
  // NO .catch() — error propagates to caller
  // Page init() must catch and show error banner
}
```

**Key behaviors**:
- `USE_LIVE_API = true` (production): API failure → Error thrown → page shows error banner
- `USE_LIVE_API = false` (demo/dev): Mock data returned directly, no API call
- The `mockData` parameter is retained for the `!USE_LIVE_API` branch

### 2.4 USE_LIVE_API Source

`data-source.js` line 17 already has `USE_LIVE_API = true`. Additionally, read from CONFIG:
```
USE_LIVE_API = (typeof CONFIG !== "undefined" && CONFIG.USE_MOCK === false) || USE_LIVE_API;
```

This binds to `CONFIG.USE_MOCK` from `js/config.js` (currently `false` = live). If CONFIG says `USE_MOCK: true`, override to mock mode.

---

## 3. L2 View Layer Design — Async Init & Data Binding

### 3.1 Async Init Pattern (all 6 pages)

**Current pattern** (synchronous):
```js
init: function() {
  var data = GLOBAL_MOCK_CONSTANT;  // sync read
  this._render(data);
}
```

**New pattern** (async with error boundary):
```js
init: async function() {
  try {
    var data = await DataSource.xxx.method();
    this._render(data);
  } catch (err) {
    this._showError(err);
  }
}
```

**app.js `initPage()` modification**: Each `XxxPage.init()` now returns a Promise. Since `initPage()` is called from `navigateTo()` (sync context), we must handle the Promise:

```js
function initPage(pageId) {
  var promise;
  switch (pageId) {
    case "fleet":
      if (typeof FleetPage !== "undefined") promise = FleetPage.init();
      break;
    // ... same for all pages
  }
  // Handle rejected promises (error already displayed by page's error boundary)
  if (promise && typeof promise.catch === "function") {
    promise.catch(function(err) {
      console.error("[initPage] " + pageId + " init failed:", err);
    });
  }
}
```

### 3.2 Error Banner Component

New `Components.errorBanner(message)` helper:
```
Returns HTML:
<div class="error-banner">
  <span class="error-banner-icon">⚠️</span>
  <span class="error-banner-msg">{message}</span>
  <button class="error-banner-retry" onclick="location.reload()">Retry</button>
</div>
```

Each page's `_showError(err)` method replaces the page container content with this banner.

### 3.3 Per-Page DataSource API Mapping

---

#### P1 Fleet Overview (`p1-fleet.js`)

| Component | Current Source | New DataSource Call | Format Diff |
|-----------|---------------|---------------------|-------------|
| KPI Cards | `FLEET` global | `DataSource.fleet.overview()` | None — fields match |
| Device Distribution | `DEVICE_TYPES` global | `DataSource.fleet.overview()` → `.deviceTypes` | Mock: `{type, count, online, color}`. BFF: verify — if `color` absent, use local color map |
| Uptime Trend | `DemoStore.get("uptimeTrend")` / `generateUptimeTrend()` | `DataSource.fleet.uptimeTrend()` | **Date format**: Mock `"DD/MM"` → BFF `"YYYY-MM-DD"`. Need `formatDateShort(isoDate)` → `"DD/MM"` |
| Integrador Table | `INTEGRADORES` global | `DataSource.fleet.integradores()` | **Date format**: Mock `"28/02/2026"` → BFF ISO `"2026-02-28T..."`. Need `formatDateOnly(isoDate)` → `"DD/MM/YYYY"` |
| Offline Events Table | `OFFLINE_EVENTS` global | `DataSource.fleet.offlineEvents()` | **Date format**: Mock `"02/03/2026 14:30"` → BFF ISO. Need `formatDateTime(isoDate)` → `"DD/MM/YYYY HH:mm"` |

**Date format utility** (shared across pages):
```js
// Add to data-source.js or a new formatters section in components.js
function formatISODate(iso, includeTime) {
  var d = new Date(iso);
  var dd = String(d.getDate()).padStart(2, "0");
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var yyyy = d.getFullYear();
  if (!includeTime) return dd + "/" + mm + "/" + yyyy;
  var hh = String(d.getHours()).padStart(2, "0");
  var min = String(d.getMinutes()).padStart(2, "0");
  return dd + "/" + mm + "/" + yyyy + " " + hh + ":" + min;
}

function formatISODateShort(iso) {
  var d = new Date(iso);
  return String(d.getDate()).padStart(2, "0") + "/" +
         String(d.getMonth() + 1).padStart(2, "0");
}
```

**Async init flow**:
```
FleetPage.init = async function() {
  try {
    var [overview, integradores, offlineEvents, uptimeTrend] = await Promise.all([
      DataSource.fleet.overview(),
      DataSource.fleet.integradores(),
      DataSource.fleet.offlineEvents(),
      DataSource.fleet.uptimeTrend(),
    ]);
    // Store for _buildContent methods to use
    this._data = { overview, integradores, offlineEvents, uptimeTrend };
    // Render...
  } catch (err) { this._showError(err); }
};
```

**Key change**: `_getFleetStats(role)`, `_buildIntegradorTable(role)`, `_buildOfflineEventsCard()`, `_initUptimeChart()`, `_initDeviceDistChart(role)` must read from `this._data` instead of globals.

---

#### P2 Device Management (`p2-devices.js`)

| Component | Current Source | New DataSource Call | Format Diff |
|-----------|---------------|---------------------|-------------|
| Device Table | `DEVICES` global | `DataSource.devices.list(filters)` | None — fields match |
| Home Selector (in commissioning) | `HOMES` global | `DataSource.devices.homes()` | None — fields match |
| Commissioning History | `COMMISSIONING_HISTORY` global | No API endpoint — keep mock | Hardcoded, no change |

**Async init flow**:
```
DevicesPage.init = async function() {
  try {
    var [devices, homes] = await Promise.all([
      DataSource.devices.list(),
      DataSource.devices.homes(),
    ]);
    this._devices = devices;
    this._homes = homes;
    // Render...
  } catch (err) { this._showError(err); }
};
```

**Key change**: `_getFilteredDevices(role)` reads from `this._devices` instead of `DEVICES`. Filter changes re-call `DataSource.devices.list(filters)` OR filter client-side from cached `this._devices` (recommended for responsiveness — filter client-side, only fetch once).

---

#### P3 Energy Behavior (`p3-energy.js`) — MOST COMPLEX

| Component | Current Source | New DataSource Call | Format Diff |
|-----------|---------------|---------------------|-------------|
| 24hr Time-Series | `DemoStore.get("homeData")[homeKey]` | `DataSource.energy.homeEnergy(homeId, date)` | **Major**: Mock uses `homeKey` ("home-a"), BFF uses `homeId` ("HOME-001"). BFF returns `{homeId, date, timeLabels, pv, load, battery, grid, soc, acPower, evCharge, baseline, savings}` |
| AC Power Tab | `data.acPower` from mock (has values) | Same API → `.acPower` | **D2**: BFF returns all-zero array. Display zeros. |
| EV Charge Tab | `data.evCharge` from mock (has values) | Same API → `.evCharge` | **D2**: BFF returns all-zero array. Display zeros. |
| Before/After | `this._beforeAfterData[homeKey]` hardcoded | **No API — D1: keep hardcoded** | No change |
| Cross-Home Summary | `this._crossHomeSummary` hardcoded | `DataSource.energy.summary(date)` | Fields match |
| Home Selector | `HOMES` global | `DataSource.devices.homes()` | Fields match |

**homeKey → homeId mapping elimination**:

Current `_homeKeys: ["home-a", "home-b", "home-c"]` maps to `HOMES[0..2]`. This indirection must be removed:

```
Current: _currentHome = "home-a"  → DemoStore.get("homeData")["home-a"]
New:     _currentHome = "HOME-001" → DataSource.energy.homeEnergy("HOME-001", date)
```

The home selector `<option value="...">` changes from `homeKey` to `homeId`.

**D2: AC/EV zero-value handling**:
- BFF `acPower` and `evCharge` arrays contain all zeros (placeholder — per-device telemetry not implemented)
- Per D2 ruling: render the chart with zeros. The charts will show flat-line at 0.
- AC chart's peak-shaving red zone markers still render (visual context remains)
- No special "no data" message — the zero values are the truthful API response

**D1: Before/After hardcoded retention**:
- `this._beforeAfterData` stays exactly as-is (hardcoded object in p3-energy.js)
- `_buildBeforeAfterCard()` continues to read from it
- v5.18 will add a BFF endpoint for this

**Async init flow**:
```
EnergyPage.init = async function() {
  try {
    var [homes, summary] = await Promise.all([
      DataSource.devices.homes(),
      DataSource.energy.summary(),
    ]);
    this._homes = homes;
    this._crossHomeSummary = summary;  // overwrite hardcoded
    this._currentHome = homes[0].id;   // "HOME-001" instead of "home-a"

    // Load first home's energy data
    var energyData = await DataSource.energy.homeEnergy(this._currentHome);
    this._currentEnergyData = energyData;
    // Render...
  } catch (err) { this._showError(err); }
};
```

**Home switch handler** becomes async:
```
_switchHome: async function(homeId) {
  this._currentHome = homeId;
  try {
    this._currentEnergyData = await DataSource.energy.homeEnergy(homeId);
    this._initMainChart();
    this._initActiveDeviceChart();
  } catch (err) { console.error("[Energy] Home switch failed:", err); }
  // Before/After still reads from hardcoded — needs homeKey mapping for D1
  var homeIdx = this._homes.findIndex(function(h) { return h.id === homeId; });
  var homeKey = ["home-a", "home-b", "home-c"][homeIdx];
  var ba = this._beforeAfterData[homeKey];
  // ... update BA cards
}
```

---

#### P4 HEMS Control (`p4-hems.js`)

| Component | Current Source | New DataSource Call | Format Diff |
|-----------|---------------|---------------------|-------------|
| Mode Distribution | `MODE_DISTRIBUTION` global | `DataSource.hems.overview()` → `.modeDistribution` | Fields match |
| Tarifa Rates | `TARIFA_RATES` global | `DataSource.hems.overview()` → `.tarifaRates` | `intermediateHours` may be null in BFF — add null guard |
| ACK Status | `LAST_DISPATCH` global (full ackList) | `DataSource.hems.overview()` → `.lastDispatch` | **D3: BFF has NO `ackList`**. Only `{timestamp, toMode, affectedDevices, successRate}` |
| Batch Dispatch | Frontend mock (setTimeout) | `DataSource.hems.dispatch(targetMode, filters)` | API exists (POST), ready to use |
| Device List | `DEVICES` global | `DataSource.devices.list()` | Fields match |

**D3: ACK Status Simplification**:

Current ACK panel renders:
1. Summary block (timestamp, fromMode→toMode, affected, success rate)
2. Full `ackList` table (7 rows with deviceId, mode, status, responseTime)

BFF response has NO `ackList`, NO `fromMode`. Only:
```json
{ "timestamp": "...", "toMode": "peak_shaving", "affectedDevices": 7, "successRate": 100 }
```

**New design**: Remove `ackList` table entirely. Show only summary:
- Timestamp (ISO → formatted)
- Target mode (toMode only, no fromMode arrow)
- Affected devices count
- Success rate percentage

The `_buildAckStatusCard()` method shrinks significantly — no `Components.dataTable()` call.

**Async init flow**:
```
HEMSPage.init = async function() {
  try {
    var [overview, devices] = await Promise.all([
      DataSource.hems.overview(),
      DataSource.devices.list(),
    ]);
    this._data = overview;  // { modeDistribution, tarifaRates, lastDispatch }
    this._devices = devices;
    // Render...
  } catch (err) { this._showError(err); }
};
```

---

#### P5 VPP & DR (`p5-vpp.js`)

| Component | Current Source | New DataSource Call | Format Diff |
|-----------|---------------|---------------------|-------------|
| Capacity KPIs | `VPP_CAPACITY` global | `DataSource.vpp.capacity()` | Fields match |
| DR Event History | `DR_EVENTS` global | `DataSource.vpp.drEvents()` | **Date format**: Mock `"01/03/2026 18:00"` → BFF ISO. Need `formatDateTime()` |
| Latency Chart | `LATENCY_TIERS` global | `DataSource.vpp.latency()` | Fields match |
| DR Trigger Button | Frontend mock (750ms animation) | **D4: Keep frontend simulation** | No change — no BFF endpoint |

**D4: DR Trigger frontend simulation retained**:
- `_handleDRTrigger()` and `_executeDREvent()` stay unchanged
- The 750ms interval animation continues to run purely in frontend
- v5.18 will integrate with M3 command-dispatcher

**Async init flow**:
```
VPPPage.init = async function() {
  try {
    var [capacity, drEvents, latency] = await Promise.all([
      DataSource.vpp.capacity(),
      DataSource.vpp.drEvents(),
      DataSource.vpp.latency(),
    ]);
    this._data = { capacity, drEvents, latency };
    // Render...
  } catch (err) { this._showError(err); }
};
```

---

#### P6 Performance Scorecard (`p6-performance.js`)

| Component | Current Source | New DataSource Call | Format Diff |
|-----------|---------------|---------------------|-------------|
| Scorecard (3 sections) | `SCORECARD` global | `DataSource.performance.scorecard()` | **BREAKING**: optimization has 6 items (not 4). See below. |
| Savings Chart | `SAVINGS_BY_HOME` global | `DataSource.performance.savings()` | **BREAKING**: `alpha` field removed. See below. |

**Scorecard optimization section (v5.14 breaking change)**:

| # | Mock (4 items) | BFF v5.14 (6 items) | Status |
|---|---------------|---------------------|--------|
| 1 | Savings Alpha (74.2%) | **Actual Savings** (new) | REPLACED |
| 2 | Self-Consumption (96.8%) | **Optimization Efficiency** (new) | ADDED |
| 3 | PV Forecast MAPE (22.1%) | Self-Consumption (96.8%) | KEPT |
| 4 | Load Forecast Adapt (11 days) | **Self-Sufficiency** (new) | ADDED |
| 5 | — | PV Forecast MAPE (22.1%) | KEPT |
| 6 | — | Load Forecast Adapt (11 days) | KEPT |

The rendering logic in `_buildScorecard()` is already dynamic (iterates `metrics` array), so switching from mock to BFF will automatically display 6 items. **No rendering code change needed** — just swap the data source.

**D5: Scorecard forced to API** — no fallback to mock SCORECARD constant.

**Savings alpha removal (v5.15 breaking change)**:

Mock `SAVINGS_BY_HOME`:
```json
{ "home": "Casa Silva", "total": 145.0, "alpha": 74.2, "sc": 85, "tou": 40, "ps": 20 }
```

BFF v5.16:
```json
{ "home": "Casa Silva", "total": 150.00, "sc": 85.20, "tou": 42.60, "ps": 22.20 }
```

**Changes needed in `_renderSavingsChart()`** (line 153-295):
1. Remove `home.alpha` reference in tooltip formatter (line 195: `"Alpha: <strong>" + home.alpha + "%</strong>"`)
2. Remove alpha label in bar chart top label (line 287: `formatBRL(home.total) + "\nα " + home.alpha + "%"`) — change to just `formatBRL(home.total)`

**Async init flow**:
```
PerformancePage.init = async function() {
  try {
    var [scorecard, savings] = await Promise.all([
      DataSource.performance.scorecard(),
      DataSource.performance.savings(),
    ]);
    this._scorecard = scorecard;
    this._savings = savings;
    // Render...
  } catch (err) { this._showError(err); }
};
```

---

### 3.4 i18n Key Additions

#### New Scorecard Metric Keys (3 keys × 3 languages = 9 entries)

| Key | en | pt-BR | zh-CN |
|-----|-----|-------|-------|
| `perf.metric.Actual Savings` | Actual Savings | Economia Real | 实际节费 |
| `perf.metric.Optimization Efficiency` | Optimization Efficiency | Eficiência de Otimização | 优化效率 |
| `perf.metric.Self-Sufficiency` | Self-Sufficiency | Autossuficiência | 自给率 |

#### New Error Banner Keys (2 keys × 3 languages = 6 entries)

| Key | en | pt-BR | zh-CN |
|-----|-----|-------|-------|
| `shared.apiError` | System error — unable to load data. Please try again. | Erro de sistema — não foi possível carregar os dados. Tente novamente. | 系统错误 — 无法加载数据，请重试。 |
| `shared.retry` | Retry | Tentar novamente | 重试 |

#### Keys to Remove (when mock SCORECARD is no longer rendered)

`perf.metric.Savings Alpha` — can be **kept** (harmless) or removed. Recommend keeping for `USE_LIVE_API=false` mode compatibility.

---

## 4. Step-by-Step Execution Plan

### Batch Order: L1 → P2/P5 → P1 → P4 → P6 → P3

Ordered from simplest (least risk) to most complex (most dependencies).

---

### Step 1: L1 Foundation (index.html + data-source.js + components.js + i18n.js)

**Files**: `index.html`, `js/data-source.js`, `js/components.js`, `js/i18n.js`

**Actions**:
1. `index.html`: Add `<script src="../js/config.js">` between `mock-data.js` and `data-source.js`
2. `data-source.js`:
   - Line 16: `API_BASE` reads from `CONFIG.BFF_API_URL` with `/api` suffix stripping
   - Line 17: `USE_LIVE_API` also reads `CONFIG.USE_MOCK`
   - Lines 63-69: `withFallback()` removes `.catch()` fallback (D7)
3. `components.js`: Add `Components.errorBanner(message)` method
4. `i18n.js`: Add 5 new keys in all 3 language sections (3 metric + 2 error)
5. `data-source.js` or `components.js`: Add `formatISODate()` / `formatISODateShort()` utilities

**Checkpoint**:
- Open browser console: `typeof CONFIG` → `object`
- `DataSource.API_BASE` → `"https://152.42.235.155:8443"` (no trailing `/api`)
- `DataSource.USE_LIVE_API` → `true`
- `DataSource.fleet.overview()` → resolves with BFF data (not mock)
- `DataSource.fleet.overview()` with BFF down → rejects (no silent fallback)

---

### Step 2: P2 Device Management + P5 VPP & DR

**Files**: `js/p2-devices.js`, `js/p5-vpp.js`

**P2 Actions**:
1. `init()` → `async init()` with try/catch + error banner
2. Load devices & homes from DataSource
3. Store in `this._devices`, `this._homes`
4. `_getFilteredDevices()` reads `this._devices` instead of `DEVICES`
5. Commissioning wizard still uses `UNASSIGNED_DEVICES` (no API for unassigned)
6. Commissioning history still uses `COMMISSIONING_HISTORY` (no API)

**P5 Actions**:
1. `init()` → `async init()` with try/catch + error banner
2. Load capacity, drEvents, latency from DataSource (parallel Promise.all)
3. DR event table: apply `formatDateTime()` to `triggeredAt` field
4. DR trigger button: unchanged (D4 — frontend simulation)

**Checkpoint**:
- Navigate to P2: device table loads from BFF (verify device count matches DB)
- Navigate to P5: capacity KPIs from BFF, DR history dates in `DD/MM/YYYY HH:mm` format
- With BFF down: both pages show error banner (not blank, not mock data)
- `USE_LIVE_API = false`: both pages show mock data as before

---

### Step 3: P1 Fleet Overview

**Files**: `js/p1-fleet.js`

**Actions**:
1. `init()` → `async init()` with 4 parallel DataSource calls
2. Store all data in `this._data`
3. `_getFleetStats(role)`: read from `this._data.overview` not `FLEET`
4. `_buildIntegradorTable(role)`: read from `this._data.integradores`, apply `formatISODate()` to `lastCommission`
5. `_buildOfflineEventsCard()`: read from `this._data.offlineEvents`, apply `formatDateTime()` to `start`
6. `_initUptimeChart()`: read from `this._data.uptimeTrend`, apply `formatISODateShort()` to `date`
7. `_initDeviceDistChart(role)`: read from `this._data.overview.deviceTypes`
   - If BFF `deviceTypes` lacks `color`, use local color map: `{"Inverter + Battery": "#a855f7", "Smart Meter": "#06b6d4", "AC": "#3b82f6", "EV Charger": "#ec4899"}`
8. `onRoleChange(role)`: re-render using cached `this._data`

**Checkpoint**:
- Fleet page loads with BFF data
- Uptime chart x-axis shows `DD/MM` (not ISO dates)
- Integrador table shows `DD/MM/YYYY` dates
- Offline events shows `DD/MM/YYYY HH:mm` dates
- Role switch (admin → integrador) still filters correctly

---

### Step 4: P4 HEMS Control

**Files**: `js/p4-hems.js`

**Actions**:
1. `init()` → `async init()`, load `hems.overview()` + `devices.list()`
2. `_buildModeCards()`: read from `this._data.modeDistribution`
3. `_buildTarifaCard()`: read from `this._data.tarifaRates`, add null guard for `intermediateHours`
4. `_buildAckStatusCard()` — **D3 simplification**:
   - Remove `ackList` table entirely
   - Remove `fromMode` reference (BFF doesn't have it)
   - Show only: timestamp (formatted), toMode, affectedDevices, successRate
5. `_handleApply()`: call `DataSource.hems.dispatch(targetMode, filters)` instead of setTimeout mock
6. `_getFilteredDevices()`: read from `this._devices` not `DEVICES`

**Checkpoint**:
- Mode distribution cards show BFF counts
- ACK status panel shows summary only (no ackList table)
- Batch dispatch calls real POST `/api/hems/dispatch`
- Tarifa rates card displays correctly (even if `intermediateHours` is null)

---

### Step 5: P6 Performance Scorecard

**Files**: `js/p6-performance.js`

**Actions**:
1. `init()` → `async init()`, load `performance.scorecard()` + `performance.savings()`
2. `_buildScorecard()`: read from `this._scorecard` instead of `SCORECARD`
   - Optimization section will now show 6 items automatically (dynamic rendering)
   - New i18n keys (`Actual Savings`, `Optimization Efficiency`, `Self-Sufficiency`) resolve correctly
3. `_renderSavingsChart()`:
   - Read from `this._savings` instead of `SAVINGS_BY_HOME`
   - **Remove `home.alpha` references**:
     - Tooltip line 195: delete `"Alpha: <strong>" + home.alpha + "%</strong>"`
     - Bar label line 287: change from `formatBRL(home.total) + "\nα " + home.alpha + "%"` to just `formatBRL(home.total)`

**Checkpoint**:
- Scorecard shows 6 optimization metrics (not 4)
- New metric names display correctly in all 3 languages
- Savings chart tooltip has no "Alpha" line
- Savings chart bar labels show only total (no α%)
- `USE_LIVE_API=false`: mock SCORECARD (4 items) still works

---

### Step 6: P3 Energy Behavior (MOST COMPLEX)

**Files**: `js/p3-energy.js`

**Actions**:
1. `init()` → `async init()`, load homes + first home energy + summary
2. **Eliminate homeKey indirection**:
   - Remove `_homeKeys: ["home-a", "home-b", "home-c"]`
   - `_currentHome` stores `homeId` (e.g., `"HOME-001"`) instead of `homeKey`
   - Home selector `<option value>` uses `homeId` directly
3. `_getHomeData()` → reads from `this._currentEnergyData` (fetched from API) instead of `DemoStore`
4. `_switchHome(homeId)` becomes async — calls `DataSource.energy.homeEnergy(homeId)`
5. **D2: acPower/evCharge zeros**:
   - No special handling — chart renders the zero arrays as received
   - AC chart's peak-shaving markArea still displays (visual context)
   - EV chart shows flat zero bars
6. **D1: Before/After hardcoded**:
   - `_beforeAfterData` stays hardcoded in file
   - On home switch, map `homeId` back to `homeKey` for before/after lookup:
     ```
     var homeIdx = this._homes.findIndex(h => h.id === homeId);
     var homeKey = ["home-a", "home-b", "home-c"][homeIdx];
     var ba = this._beforeAfterData[homeKey];
     ```
   - This is intentional tech debt (D1 ruling) — v5.18 will add a BFF endpoint
7. `_buildCrossHomeSummaryCard()`: read from `this._crossHomeSummary` (API data)
8. `_buildHomeSelector()`: read from `this._homes` instead of `HOMES` global

**Checkpoint**:
- Energy page loads with BFF data for first home
- Home switch fetches new energy data (async, with loading state)
- Main chart renders PV/Load/Battery/Grid from BFF
- AC chart shows zero values (flat line, D2)
- EV chart shows zero values (no bars, D2)
- Before/After card still shows hardcoded data (D1)
- Cross-home summary table shows BFF data
- `USE_LIVE_API=false`: mock data via DemoStore still works

---

## Appendix A: DataSource API Path → BFF Route Mapping

| DataSource Method | HTTP | Path in data-source.js | BFF Route in local-server.ts | Double /api? |
|-------------------|------|------------------------|------------------------------|-------------|
| fleet.overview() | GET | `/api/fleet/overview` | `/api/fleet/overview` | Yes — fixed by L1 stripping |
| fleet.integradores() | GET | `/api/fleet/integradores` | `/api/fleet/integradores` | Yes |
| fleet.offlineEvents() | GET | `/api/fleet/offline-events` | `/api/fleet/offline-events` | Yes |
| fleet.uptimeTrend() | GET | `/api/fleet/uptime-trend` | `/api/fleet/uptime-trend` | Yes |
| devices.list() | GET | `/api/devices` | `/api/devices` | Yes |
| devices.homes() | GET | `/api/homes` | `/api/homes` | Yes |
| energy.homeEnergy() | GET | `/api/homes/:id/energy` | `/api/homes/:homeId/energy` | Yes |
| energy.summary() | GET | `/api/homes/summary` | `/api/homes/summary` | Yes |
| hems.overview() | GET | `/api/hems/overview` | `/api/hems/overview` | Yes |
| hems.dispatch() | POST | `/api/hems/dispatch` | `/api/hems/dispatch` | Yes |
| vpp.capacity() | GET | `/api/vpp/capacity` | `/api/vpp/capacity` | Yes |
| vpp.latency() | GET | `/api/vpp/latency` | `/api/vpp/latency` | Yes |
| vpp.drEvents() | GET | `/api/vpp/dr-events` | `/api/vpp/dr-events` | Yes |
| performance.scorecard() | GET | `/api/performance/scorecard` | `/api/performance/scorecard` | Yes |
| performance.savings() | GET | `/api/performance/savings` | `/api/performance/savings` | Yes |

All 15 paths have the double `/api` issue. The L1 fix (stripping `/api` suffix from CONFIG.BFF_API_URL) resolves all 15 at once.

---

## Appendix B: Decision Reference

| # | Ruling | Impact |
|---|--------|--------|
| D1 | P3 Before/After keep hardcoded | `_beforeAfterData` unchanged, homeKey lookup retained |
| D2 | P3 acPower/evCharge show 0 from API | No fallback to mock, charts render zeros |
| D3 | P4 ACK Status summary only | Remove ackList table, remove fromMode |
| D4 | P5 DR Trigger frontend simulation | `_executeDREvent()` unchanged |
| D5 | P6 Scorecard forced API | SCORECARD global bypassed in live mode |
| D6 | API_BASE from root config.js | `index.html` adds `<script src="../js/config.js">` |
| D7 | API fail = throw Error | `withFallback()` .catch() removed |
