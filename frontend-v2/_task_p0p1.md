# Task: Phase 0 (Foundation) + Phase 1 (Fleet Overview)

## CRITICAL: Read these reference files FIRST before writing any code
1. `/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Pages_v1.2.html` — Design spec (component definitions, fields, colors, role visibility)
2. `/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Build_Plan_v1.0.html` — Build plan (mock data, acceptance criteria, engineering constraints)

Read BOTH files completely before starting. They contain mandatory engineering constraints (8 critical pitfalls marked with 🚨) that you MUST follow.

## Working Directory
`/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/frontend-v2/`

## Goal
Build the foundation CSS/JS framework + the Fleet Overview page (landing page) as a static SPA with mock data. This sets the visual tone for the entire Admin Portal.

---

## Phase 0: Foundation

### T0.1 Directory Structure
Create this exact file structure:
```
frontend-v2/
├── index.html
├── css/
│   ├── variables.css
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   └── pages.css
├── js/
│   ├── app.js
│   ├── mock-data.js
│   ├── components.js
│   ├── charts.js
│   ├── p1-fleet.js
│   ├── p2-devices.js      (empty placeholder)
│   ├── p3-energy.js        (empty placeholder)
│   ├── p4-hems.js          (empty placeholder)
│   ├── p5-vpp.js           (empty placeholder)
│   └── p6-performance.js   (empty placeholder)
└── assets/
```

### T0.1 index.html
- Load all CSS files
- Load CDN: ECharts 5.x (`https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js`)
- Load CDN: Inter font + JetBrains Mono from Google Fonts
- SPA structure: sidebar nav (left, 240px fixed) + main content area
- 6 page sections inside main area, only one visible at a time (display: block/none)
- Load all JS files at bottom

### T0.1b Mock Data Strategy (mock-data.js)
**CRITICAL RULES:**
- Time-series data (for P3/P5 charts): Write Data Generator functions, NOT hardcoded JSON arrays
  - `generateSolarCurve()` — Math.sin() bell curve, 06:00 start, 12:00 peak 3-5kW, 18:00 zero, ±5% noise
  - `generateLoadCurve()` — dual-peak (07:00 morning + 18:00 evening), base 0.5-0.8kW, peaks 2-3kW
  - `generateBatteryCurve(tariff, pv, load)` — off-peak charge, peak discharge
  - `grid_kw = load_kw - pv_kw - battery_kw` (energy conservation)
  - `baseline_grid = load_kw` (no PV, no battery = 100% grid)
- **MEMOIZATION:** All generators run ONCE at page load, store results in DemoStore. Never regenerate on page switch.
- **TIMEZONE DEFENSE:** X-axis must be string array `['00:00', '00:15', ... '23:45']`, NOT JS Date objects.
- **Tarifa Branca schedule (hardcode at top of mock-data.js):**
  - Peak: 17:00–20:00
  - Intermediate: 16:00–17:00 and 20:00–21:00
  - Off-peak: all other hours (21:00–16:00)
- **Savings calculation:** `savings_brl = Σ((baseline[t] - actual[t]) × tariff_price[t] × 0.25)` (tariff-weighted, not raw kW)

**Static mock data for P1/P2/P4/P5/P6:**
```js
const FLEET = {
  totalDevices: 47,
  onlineCount: 44,
  offlineCount: 3,
  onlineRate: 93.6,
  totalHomes: 3,
  totalIntegradores: 2
};

const DEVICE_TYPES = [
  { type: 'Inverter + Battery', count: 20, online: 19, color: '#a855f7' },
  { type: 'Smart Meter', count: 12, online: 12, color: '#06b6d4' },
  { type: 'AC', count: 10, online: 9, color: '#3b82f6' },
  { type: 'EV Charger', count: 5, online: 4, color: '#ec4899' }
];

const INTEGRADORES = [
  { orgId: 'org-001', name: 'Solar São Paulo', deviceCount: 26, onlineRate: 96.2, lastCommission: '28/02/2026' },
  { orgId: 'org-002', name: 'Green Energy Rio', deviceCount: 21, onlineRate: 90.5, lastCommission: '01/03/2026' }
];

const OFFLINE_EVENTS = [
  { deviceId: 'DEV-017', start: '02/03/2026 14:30', durationHrs: 4.2, cause: 'WiFi dropout', backfill: true },
  { deviceId: 'DEV-033', start: '01/03/2026 03:15', durationHrs: 12.0, cause: 'Power outage', backfill: true },
  { deviceId: 'DEV-041', start: '03/03/2026 09:45', durationHrs: 2.1, cause: 'Unknown', backfill: false }
];
```

Generate 28 days of uptime data for the trend chart (mostly 91-96%, with 2 days dipping to 87%).

### T0.2 CSS Variables (variables.css)
```css
:root {
  --bg: #0f1117;
  --card: #1a1d27;
  --border: #2a2d3a;
  --text: #e4e4e7;
  --muted: #9ca3af;
  --positive: #22c55e;
  --positive-bg: rgba(34, 197, 94, 0.1);
  --negative: #ef4444;
  --negative-bg: rgba(239, 68, 68, 0.1);
  --neutral: #a855f7;
  --neutral-bg: rgba(168, 85, 247, 0.1);
  --accent: #3b82f6;
  --amber: #f59e0b;
  --font-ui: 'Inter', -apple-system, sans-serif;
  --font-data: 'JetBrains Mono', monospace;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}
```
Also define `[data-theme="light"]` with same values as placeholder (for future Light Mode).

### T0.3 Base CSS (base.css)
- CSS Reset (box-sizing, margin, padding)
- `font-variant-numeric: tabular-nums;` on all `.data-value` elements
- Positive/negative helpers: `.positive { color: var(--positive); }` `.negative { color: var(--negative); }`
- `.positive::before { content: '+'; }` `.negative::before { content: '-'; }`
- Skeleton loading: `@keyframes skeleton-pulse` + `.skeleton` class
- Dark theme as default

### T0.4 Layout (layout.css)
- Sidebar: fixed left, 240px wide, dark background, contains:
  - Logo/brand area (top, just text "SOLFACIL VPP")
  - 6 nav items with icons (emoji is fine): Fleet / Devices / Energy / HEMS / VPP / Performance
  - Role switcher at bottom (dropdown: Admin / Integrador / Customer)
- Main content: margin-left: 240px, padding 24px
- Top bar: current page name + current role badge
- Responsive: < 768px sidebar collapses to icon-only (60px)

### T0.5 Shared Components (components.css + components.js)
- **KPI Card:** Big number (JetBrains Mono, 2rem) + label (Inter) + sparkline area (small div for future)
- **Data Table:** striped rows, numbers right-aligned, sort icons
- **Status Badge:** online(green) / offline(red) / warning(amber) / neutral(purple)
- **Confirm Dialog:** modal overlay with preview + confirm/cancel buttons
- **Skeleton components:** KPI skeleton / table skeleton / chart skeleton

### T0.5 Charts Factory (charts.js)
**CRITICAL RULES:**
- Create `createChart(containerId, option)` factory function
- Before `echarts.init()`, MUST check `echarts.getInstanceByDom(container)` — if exists, reuse with `.setOption()` + `.resize()`. NEVER duplicate init.
- Bind `ResizeObserver` to container → auto call `chart.resize()`
- NEVER init charts when container has `display: none` — use `requestAnimationFrame` after page becomes visible
- Export `activatePageCharts(pageId)` function for router to call after page switch
- ECharts dark theme config: dark background, grid lines match --border, tooltip matches card style

### T0.6 App Logic (app.js)
- Hash router: #fleet / #devices / #energy / #hems / #vpp / #performance
- Default to #fleet
- Page switching: hide all sections, show target, call `activatePageCharts(targetPageId)`
- Sidebar nav highlighting
- **Role switching:**
  - 3 roles: SOLFACIL_ADMIN / INTEGRADOR / CUSTOMER
  - Elements with `data-role="admin"` visible only for Admin
  - Elements with `data-role="integrador"` visible for Admin + Integrador
  - Customer shows "Coming Soon" overlay
  - Role switch also toggles `document.body.dataset.theme` (admin→dark, integrador→light)
- **DemoStore:**
```js
window.DemoStore = {
  get(key) { return JSON.parse(sessionStorage.getItem('ds_' + key) || 'null'); },
  set(key, val) { sessionStorage.setItem('ds_' + key, JSON.stringify(val)); },
  reset() { Object.keys(sessionStorage).filter(k => k.startsWith('ds_')).forEach(k => sessionStorage.removeItem(k)); }
};
```

---

## Phase 1: Fleet Overview (P1)

This is the landing page. Its visual quality sets the tone for the entire product.

### T1.1 KPI Cards (top row)
- 4-6 KPI cards in a responsive grid (CSS Grid: 2→3→6 columns)
- Cards: Total Devices (47) / Online (44, green) / Offline (3, red) / Online Rate (93.6%, green because >90%) / Homes (3) / Integradores (2)
- Numbers in JetBrains Mono, 2rem, bold
- Labels in Inter, 0.8rem, muted color
- Each card has a small sparkline placeholder area at bottom

### T1.2 Uptime Trend Chart (ECharts line chart)
- X axis: past 28 days (date labels)
- Y axis: uptime %
- 90% target line: horizontal dashed line with label "Target: 90%"
- Line color: green when ≥90%, red segments when <90%
- Use mock data: mostly 91-96%, 2 days dipping to 87%

### T1.3 Device Type Distribution
- Horizontal bar chart or donut showing the 4 device types with their counts and online status
- Colors per type: purple (inverter+battery), cyan (meter), blue (AC), pink (EV charger)

### T1.4 Integrador List (table)
- Columns: Org Name / Device Count / Online Rate / Last Commission
- 2 rows from mock data
- Admin role: see both rows
- Integrador role: see only 1 row (filter by org_id)

### T1.5 Offline Events List (table)
- Columns: Device ID / Offline Start / Duration (hrs) / Cause / Backfill Complete
- 3 rows from mock data
- Backfill: ✅ (true) or ⚠️ (false)

### Page Load Animation
- On first load, show skeleton screens for 500ms, then render real data
- This demonstrates the skeleton loading pattern for the entire app

---

## Acceptance Criteria (MUST ALL PASS)
1. Browser opens index.html → sees sidebar + Fleet Overview page
2. KPI numbers use JetBrains Mono with tabular-nums (numbers don't jitter)
3. Uptime chart has 90% target line, red-highlighted dip days
4. Sidebar navigation works (clicking other pages shows placeholder text "Page X — Coming Soon")
5. Role switcher works: Admin sees all, Integrador sees filtered integrador table
6. Skeleton loading animation plays on first page load (500ms)
7. No console errors
8. ECharts charts resize properly when browser window is resized

## Brazilian Localization
- Currency: R$ 1.234,56 (comma decimal, dot thousands)
- Dates: DD/MM/YYYY
- Time: 24-hour format (HH:mm), NO AM/PM
- Location names: São Paulo, Rio de Janeiro

## Completion Signal
When finished, run this command:
```
openclaw system event --text "Phase 0+1 DONE: Foundation + Fleet Overview complete. Ready for browser verification." --mode now
```
