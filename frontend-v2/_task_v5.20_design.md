# v5.20 Frontend Design Document

**Date:** 2026-03-11
**Depends on:** v5.19 (commit `9751f2a`), backend v5.20 architecture update
**Scope:** 0-vs-null rendering, P2 Energy Flow redesign, CSS responsive, null-safety formalization

---

## 1. 0 vs null — Frontend Rendering Contract

### Rule

When BFF returns `null` for a numeric field:
- Display `"—"` (em-dash, U+2014) instead of `0` or `NaN`
- Never display `0%`, `0 kW`, `0°C` for missing data

### Implementation: Modify `formatNumber` and `formatPercent`

**File:** `frontend-v2/js/utils.js` (or wherever `formatNumber`/`formatPercent` are defined)

**BEFORE:**
```javascript
function formatNumber(val, decimals) {
  if (val == null || isNaN(val)) return "0";
  return Number(val).toFixed(decimals || 0);
}

function formatPercent(val) {
  if (val == null || isNaN(val)) return "0%";
  return Number(val).toFixed(1) + "%";
}
```

**AFTER:**
```javascript
function formatNumber(val, decimals) {
  if (val == null || (typeof val === 'number' && isNaN(val))) return "—";
  return Number(val).toFixed(decimals || 0);
}

function formatPercent(val) {
  if (val == null || (typeof val === 'number' && isNaN(val))) return "—";
  return Number(val).toFixed(1) + "%";
}
```

### Affected pages

Every page that calls `formatNumber()` or `formatPercent()` will automatically display "—" for null values. Pages using inline formatting (e.g., `val + "%"`) must add explicit null checks:

| Page | Pattern | Fix |
|------|---------|-----|
| P1 Fleet (`p1-fleet.js`) | KPI cards use `formatNumber` | Auto-fixed by helper change |
| P2 Devices (`p2-devices.js`) | `state.batterySoc + "%"` at L243-248 | Already uses `!= null ? ... : "--"` — OK |
| P3 Energy (`p3-energy.js`) | `ba.before.selfCons + "%"` at L215 | Need null guard (see §4) |
| P5 VPP (`p5-vpp.js`) | KPI cards use `formatNumber` | Auto-fixed by helper change |
| P6 Scorecard (`p6-scorecard.js`) | `metric.value` display | Must check `value === null` → display "—" |

### P6 Scorecard specific

When `metric.value === null`, display:
```html
<span class="scorecard-value scorecard-na">—</span>
```

With CSS:
```css
.scorecard-na {
  color: var(--muted);
  font-style: italic;
}
```

---

## 2. P2 Energy Flow — CSS Grid 4×4 Diamond + SVG Arrows

### Gemini Decision #5

SVG arrows are **static only** — color + direction represent flow. No `stroke-dashoffset` animation.

### CSS Grid Layout Spec

**File:** `frontend-v2/css/pages.css` — replace lines 1874-1929

**Current grid:** 5×5 with nodes at (3,1), (1,3), (5,3), (3,5), center at (3,3)

The current CSS grid structure is actually correct in concept (5×5 grid, diamond positions). The problem is:
1. No SVG lines/arrows connecting nodes to center
2. The `.ef-line-*` classes use `position: absolute` with hardcoded pixel offsets that don't work

**New approach:** Keep the 5×5 grid but replace `.ef-line-*` divs with a single SVG overlay.

### New CSS (replace L1874-1929)

```css
/* ---- Energy Flow Diamond ---- */
.energy-flow-diamond {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr 1fr 1fr;
  width: 280px;
  height: 280px;
  margin: var(--space-lg) auto;
  position: relative;
}

.ef-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  z-index: 2;
}
.ef-node-icon { font-size: 1.5rem; }
.ef-node-label { font-size: 0.7rem; color: var(--muted); margin-top: 2px; }
.ef-node-value { font-family: var(--font-data); font-size: 0.85rem; font-weight: 600; color: var(--text); }
.ef-node-sub { font-size: 0.65rem; color: var(--muted); margin-top: 1px; }

.ef-pv       { grid-column: 3; grid-row: 1; }
.ef-battery  { grid-column: 1; grid-row: 3; }
.ef-load     { grid-column: 5; grid-row: 3; }
.ef-grid     { grid-column: 3; grid-row: 5; }

.ef-center {
  grid-column: 3;
  grid-row: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}
.ef-center-hub {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px rgba(59,130,246,0.4);
}

/* SVG overlay for flow lines */
.ef-svg-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}

.ef-svg-overlay line {
  stroke-width: 2;
  stroke-linecap: round;
}

/* Line colors by flow type */
.ef-line-pv    { stroke: var(--positive); }  /* green — solar */
.ef-line-bat   { stroke: var(--neutral); }   /* purple — battery */
.ef-line-load  { stroke: var(--text); opacity: 0.6; }  /* white — load */
.ef-line-grid  { stroke: var(--accent); }    /* blue — grid */

/* Hidden when no flow */
.ef-line-hidden { display: none; }

/* Arrow markers */
.ef-arrow-positive { fill: var(--positive); }
.ef-arrow-neutral  { fill: var(--neutral); }
.ef-arrow-text     { fill: var(--text); opacity: 0.6; }
.ef-arrow-accent   { fill: var(--accent); }
```

### SVG Geometry

The diamond is 280×280px. Grid cells are 56×56px.

Node centers (column center, row center):
- **PV** (top): x=140, y=28
- **Battery** (left): x=28, y=140
- **Load** (right): x=252, y=140
- **Grid** (bottom): x=140, y=252
- **Hub** (center): x=140, y=140

Lines connect each node to the hub center:
- PV→Hub: (140, 56) → (140, 120) — vertical
- Battery→Hub: (56, 140) → (120, 140) — horizontal
- Hub→Load: (160, 140) → (224, 140) — horizontal
- Hub→Grid: (140, 160) → (140, 224) — vertical

### JavaScript Changes

**File:** `frontend-v2/js/p2-devices.js` — `_buildEnergyFlow` method (L419-496)

Replace the `ef-line-top`, `ef-line-left`, etc. divs with an SVG element:

**BEFORE (L460-493):**
```javascript
var body =
  '<div class="energy-flow-diamond">' +
  '<div class="ef-pv ef-node">...</div>' +
  '<div class="ef-line-top' + (showTop ? "" : " hidden") + '"></div>' +
  '<div class="ef-battery ef-node">...</div>' +
  // ... etc
  '</div>';
```

**AFTER:**
```javascript
// Build SVG overlay with directional arrows
var svgLines = [];

// SVG marker definitions for arrowheads
var markerDefs =
  '<defs>' +
  '<marker id="arrow-pv" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
  '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-positive"/></marker>' +
  '<marker id="arrow-bat" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
  '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-neutral"/></marker>' +
  '<marker id="arrow-load" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
  '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-text"/></marker>' +
  '<marker id="arrow-grid" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
  '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-accent"/></marker>' +
  '</defs>';

// PV line: always PV→Hub (solar generates into hub)
if (showTop) {
  svgLines.push(
    '<line x1="140" y1="56" x2="140" y2="120" class="ef-line-pv" marker-end="url(#arrow-pv)"/>'
  );
}

// Battery line: direction depends on charge/discharge
if (showLeft) {
  if (state.batteryPower > 0.05) {
    // Charging: Hub→Battery
    svgLines.push(
      '<line x1="120" y1="140" x2="56" y2="140" class="ef-line-bat" marker-end="url(#arrow-bat)"/>'
    );
  } else {
    // Discharging: Battery→Hub
    svgLines.push(
      '<line x1="56" y1="140" x2="120" y2="140" class="ef-line-bat" marker-end="url(#arrow-bat)"/>'
    );
  }
}

// Load line: always Hub→Load (hub feeds load)
if (showRight) {
  svgLines.push(
    '<line x1="160" y1="140" x2="224" y2="140" class="ef-line-load" marker-end="url(#arrow-load)"/>'
  );
}

// Grid line: direction depends on import/export
if (showBottom) {
  if (state.gridPowerKw > 0) {
    // Importing: Grid→Hub
    svgLines.push(
      '<line x1="140" y1="224" x2="140" y2="160" class="ef-line-grid" marker-end="url(#arrow-grid)"/>'
    );
  } else {
    // Exporting: Hub→Grid
    svgLines.push(
      '<line x1="140" y1="160" x2="140" y2="224" class="ef-line-grid" marker-end="url(#arrow-grid)"/>'
    );
  }
}

var svgOverlay =
  '<svg class="ef-svg-overlay" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">' +
  markerDefs +
  svgLines.join("") +
  '</svg>';

var body =
  '<div class="energy-flow-diamond">' +
  svgOverlay +
  '<div class="ef-pv ef-node"><div class="ef-node-icon">\u2600\ufe0f</div><div class="ef-node-value">' + pvVal + '</div><div class="ef-node-label">' + t("devices.ef.solarPv") + '</div></div>' +
  '<div class="ef-battery ef-node"><div class="ef-node-icon">\ud83d\udd0b</div><div class="ef-node-value">' + batVal + '</div><div class="ef-node-sub">' + batSub + '</div></div>' +
  '<div class="ef-center"><div class="ef-center-hub"></div></div>' +
  '<div class="ef-load ef-node"><div class="ef-node-icon">\ud83c\udfe0</div><div class="ef-node-value">' + loadVal + '</div><div class="ef-node-label">' + t("devices.ef.load") + '</div></div>' +
  '<div class="ef-grid ef-node ' + gridClass + '"><div class="ef-node-icon">\u26a1</div><div class="ef-node-value">' + gridVal + '</div><div class="ef-node-sub">' + gridSub + '</div></div>' +
  '</div>';
```

### Null-safety in Energy Flow values

Also fix null display (currently shows `"0 kW"` for null):

**BEFORE (L420-433):**
```javascript
var pvVal =
  state.pvPower != null ? formatNumber(state.pvPower, 1) + " kW" : "0 kW";
```

**AFTER:**
```javascript
var pvVal =
  state.pvPower != null ? formatNumber(state.pvPower, 1) + " kW" : "—";
var batVal =
  state.batteryPower != null
    ? formatNumber(Math.abs(state.batteryPower), 1) + " kW"
    : "—";
var loadVal =
  state.loadPower != null
    ? formatNumber(state.loadPower, 1) + " kW"
    : "—";
var gridVal =
  state.gridPowerKw != null
    ? formatNumber(Math.abs(state.gridPowerKw), 1) + " kW"
    : "—";
```

---

## 3. CSS Responsive — Breakpoint Matrix

### Gemini Decision #3

Responsive sidebar is **CSS-only**. No JavaScript state management for collapse/expand.

### Breakpoint Strategy

| Breakpoint | Viewport | Sidebar | KPI Grid | Charts | Tables | GW Cards |
|:----------:|:--------:|:-------:|:--------:|:------:|:------:|:--------:|
| `>=1440px` | Desktop | Full 240px | 6 columns | 2-col `two-col` | Full | 2-col |
| `1024px–1439px` | Tablet landscape | Icon-only 60px | 3 columns | Single column | Full | Single col |
| `<1024px` | Tablet portrait / mobile | Hidden + hamburger overlay | 2 columns | Single column | Horizontal scroll | Single col |

### File: `frontend-v2/css/layout.css`

**Replace the existing @media rules (L275-333) with 3-breakpoint system:**

```css
/* ---- Responsive: >= 1440px (default — no media query needed) ---- */
/* Current layout is the 1440px+ default */

/* ---- Responsive: 1024px–1439px — Sidebar icon-only ---- */
@media (max-width: 1439px) {
  .sidebar {
    width: var(--sidebar-collapsed);
  }

  .sidebar .brand-text,
  .sidebar .nav-label,
  .sidebar .role-switcher label,
  .sidebar .role-switcher select {
    display: none;
  }

  .sidebar-brand {
    justify-content: center;
    padding: var(--space-md);
  }

  .nav-item {
    justify-content: center;
    padding: var(--space-sm);
  }

  .nav-item .nav-icon {
    font-size: 1.3rem;
  }

  .sidebar-footer {
    display: flex;
    justify-content: center;
    padding: var(--space-sm);
  }

  .main-content {
    margin-left: var(--sidebar-collapsed);
  }

  .page-content {
    padding: var(--space-md);
  }

  .top-bar .page-title {
    font-size: 0.95rem;
  }
}

/* ---- Responsive: < 1024px — Sidebar hidden, hamburger overlay ---- */
@media (max-width: 1023px) {
  .sidebar {
    width: var(--sidebar-width);
    transform: translateX(-100%);
    transition: transform var(--transition-normal);
    z-index: 200;
  }

  .sidebar.sidebar-open {
    transform: translateX(0);
  }

  /* Overlay backdrop when sidebar is open */
  .sidebar-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 199;
  }
  .sidebar-backdrop.active {
    display: block;
  }

  .sidebar .brand-text,
  .sidebar .nav-label,
  .sidebar .role-switcher label,
  .sidebar .role-switcher select {
    display: unset; /* Show full sidebar content when overlay is open */
  }

  .sidebar-brand {
    justify-content: flex-start;
    padding: var(--space-lg);
  }

  .nav-item {
    justify-content: flex-start;
    padding: var(--space-sm) var(--space-md);
  }

  .main-content {
    margin-left: 0;
  }

  /* Hamburger button (added to top-bar) */
  .hamburger-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 1.2rem;
    cursor: pointer;
  }

  .page-content {
    padding: var(--space-md) var(--space-sm);
  }
}

/* Default: hamburger hidden on desktop */
.hamburger-btn {
  display: none;
}
```

### File: `frontend-v2/css/components.css`

**Add/update responsive rules for shared components:**

```css
/* ---- KPI grid responsive (already exists, verify) ---- */
/* L14-30: Already has 3-breakpoint for .kpi-grid-6 — OK */

/* ---- Chart container responsive ---- */
@media (max-width: 1439px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}

/* ---- Data table responsive (horizontal scroll) ---- */
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

### File: `frontend-v2/css/pages.css`

**Add responsive rules for page-specific components:**

```css
/* ---- P2: Gateway cards responsive ---- */
@media (max-width: 1439px) {
  .gw-meta {
    flex-wrap: wrap;
  }
}

@media (max-width: 1023px) {
  .gw-meta span {
    font-size: 0.7rem;
  }

  .detail-page {
    grid-template-columns: 1fr;
  }

  .energy-flow-diamond {
    width: 240px;
    height: 240px;
  }
}

/* ---- P3: Chart responsive ---- */
@media (max-width: 1439px) {
  .p3-main-chart {
    min-height: 250px;
  }
}

/* ---- P4: Mode cards responsive ---- */
@media (max-width: 1439px) {
  .p4-mode-cards {
    grid-template-columns: 1fr 1fr 1fr; /* keep 3-col even on tablet */
  }
}

@media (max-width: 1023px) {
  .p4-mode-cards {
    grid-template-columns: 1fr;
  }

  .p4-filter-row {
    flex-direction: column;
  }

  .p4-filter-row select {
    width: 100%;
  }
}
```

### Hamburger Button — Minimal JS (CSS-only toggle via checkbox hack)

Per Gemini Decision #3: **no JavaScript state management**. Use a hidden checkbox to toggle sidebar:

**HTML addition to top-bar (in `index.html`):**
```html
<input type="checkbox" id="sidebar-toggle" class="sidebar-toggle-input" hidden>
<label for="sidebar-toggle" class="hamburger-btn">☰</label>
```

**CSS-only toggle:**
```css
.sidebar-toggle-input { display: none; }

@media (max-width: 1023px) {
  .sidebar-toggle-input:checked ~ .sidebar {
    transform: translateX(0);
  }

  .sidebar-toggle-input:checked ~ .sidebar-backdrop {
    display: block;
  }
}
```

> **Note:** This requires the checkbox to be a sibling of `.sidebar` in the DOM. If the DOM structure doesn't allow this, the alternative is a single `classList.toggle('sidebar-open')` on the hamburger click — this is a CSS class toggle, not JS state management, and is acceptable under Decision #3.

---

## 4. Null-Safety Formalization — Temporary Fixes

### 4.1 `p3-energy.js` L46-48 — `baCompare().catch(() => {})`

**File:** `frontend-v2/js/p3-energy.js`

**Current (temporary):**
```javascript
DataSource.energy.baCompare(0).catch(function() { return {}; }),
DataSource.energy.baCompare(1).catch(function() { return {}; }),
DataSource.energy.baCompare(2).catch(function() { return {}; }),
```

**Gemini Decision #1:** `baCompare` returns null. No fake comparisons.

**Formal fix:**

Option A (preferred): Remove `baCompare` calls entirely, hide the Before/After card:

```javascript
// Remove lines 46-48 from Promise.all
// Set _baCompare to empty
self._baCompare = {};
```

Then in `_buildBeforeAfterCard` (L182-205):

```javascript
_buildBeforeAfterCard: function () {
  // Gemini Decision #1: baCompare returns null until baseline model exists
  // Hide the entire card
  return '';
},
```

Option B (show card with "N/A"): If product wants the card visible but empty:

```javascript
_buildBeforeAfterCard: function () {
  var html =
    '<div class="p3-ba-header">...</div>' +
    '<div class="p3-ba-cards">' +
    '<div class="empty-state-detail">' + t("energy.ba.noBaseline") + '</div>' +
    '</div>';
  return Components.sectionCard(t("energy.beforeAfter"), html);
},
```

**Recommendation:** Option A — remove the card entirely. Add i18n key `energy.ba.noBaseline` = "Baseline comparison not available" for future use.

### 4.2 `p3-energy.js` L208-209 — `_buildBACards` null guard

**Current (temporary):**
```javascript
_buildBACards: function (ba) {
  if (!ba || !ba.before || !ba.after) {
    return '<div class="empty-state-detail">' + t("shared.noData") + '</div>';
  }
```

**Formal status:** This guard is **correct** and should be kept as-is. It's the proper pattern for handling null baCompare data. No change needed — just remove the "temporary" label.

### 4.3 `p4-hems.js` L340 — `lastDispatch` null guard

**File:** `frontend-v2/js/p4-hems.js`

**Current (L340):**
```javascript
var dispatch = (this._overview && this._overview.lastDispatch) ? this._overview.lastDispatch : {};
```

**Problem:** When `dispatch` is `{}`, the lines below access `dispatch.toMode`, `dispatch.timestamp`, `dispatch.affectedDevices`, `dispatch.successRate` — all undefined, but `formatISODateTime(undefined)` may crash, and `t(this._modeKeys[undefined].titleKey)` will crash.

**Formal fix — replace L340-373:**

```javascript
_buildAckStatusCard: function () {
  var dispatch = (this._overview && this._overview.lastDispatch)
    ? this._overview.lastDispatch
    : null;

  if (!dispatch) {
    return Components.sectionCard(
      t("hems.ackStatus"),
      '<div class="empty-state-detail">' + t("hems.noRecentDispatch") + '</div>'
    );
  }

  var toLabel = (dispatch.toMode && this._modeKeys[dispatch.toMode])
    ? t(this._modeKeys[dispatch.toMode].titleKey)
    : dispatch.toMode || "—";

  var summary = [
    '<div class="p4-dispatch-summary">',
    '<div class="p4-dispatch-info">',
    '<span class="p4-dispatch-time">' +
      t("hems.lastChange") + " " +
      (dispatch.timestamp ? formatISODateTime(dispatch.timestamp) : "—") +
      '</span>',
    '<span class="p4-dispatch-detail">' +
      t("hems.targetMode") + ": " + toLabel + '</span>',
    '<span class="p4-dispatch-detail">' +
      t("hems.affected") + " " +
      (dispatch.affectedDevices != null ? dispatch.affectedDevices : "—") +
      " " + t("shared.devices") + '</span>',
    '<span class="p4-dispatch-detail">' +
      t("hems.successRate") + " " +
      (dispatch.successRate != null ? dispatch.successRate + "%" : "—") +
      '</span>',
    '</div>',
    '</div>',
  ].join("");

  // ... rest unchanged
```

**New i18n key:** `hems.noRecentDispatch` = "No recent dispatch" / "Nenhum despacho recente"

### 4.4 `p3-energy.js` L433 — `_initMainChart` timeLabels empty check

**Current (L433):**
```javascript
if (!data || !data.timeLabels || data.timeLabels.length === 0) return;
```

**Formal status:** This guard is **correct**. The early return prevents ECharts from crashing on empty data. No change needed — keep as-is, remove "temporary" label.

### 4.5 Additional: ECharts markArea async crash (P3 L588-649)

The markArea crash occurs when ECharts tries to map xAxis values (`"00:00"`, `"15:45"`, etc.) to coordinates but the axis data is all zeros or the series data doesn't align with the xAxis categories.

**Root cause:** When `grid` and `baseline` arrays are all zeros, the stacked savings band creates a flat line at y=0, and the markArea label positioning fails asynchronously.

**Fix (in `_initMainChart`):** Add a check before adding markArea:

```javascript
// Only add markArea if we have non-zero data
var hasNonZeroData = baseline.some(function(v) { return v > 0; });

// In the baseline series config:
markArea: hasNonZeroData ? {
  silent: true,
  data: [ /* ... existing markArea data ... */ ]
} : undefined,
```

---

## 5. i18n Keys Required

| Key | PT-BR | EN |
|-----|-------|-----|
| `energy.ba.noBaseline` | Comparação de baseline não disponível | Baseline comparison not available |
| `hems.noRecentDispatch` | Nenhum despacho recente | No recent dispatch |
| `scorecard.na` | Dados não disponíveis | Data not available |
