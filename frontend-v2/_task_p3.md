# Task: Phase 3 — Energy Behavior Analysis

## CRITICAL: Read reference files FIRST
1. `/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Pages_v1.2.html` — Design spec (P3 Energy Behavior section)
2. `/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Build_Plan_v1.0.html` — Build plan (Phase 3 section, especially 🚨 rules)

Read BOTH completely before writing code.

## Working Directory
`/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/frontend-v2/`

## Existing Code Context
Phase 0-2 are COMPLETE. Key existing patterns to follow:
- `js/p1-fleet.js` / `js/p2-devices.js` — follow same init/onRoleChange/skeleton pattern
- `js/charts.js` — use `Charts.createChart(containerId, option, {pageId: 'energy'})` with try-catch
- `js/mock-data.js` — has TARIFA_BRANCA schedule, generator functions, HOMES array, DemoStore
- `js/components.js` — `Components.renderWithSkeleton()`, `Components.sectionCard()`, etc.
- `js/app.js` — router already has `case "energy"` that calls `showComingSoon()` — you need to update it to call `EnergyPage.init()` instead

**DO NOT break existing pages. Only modify:**
1. `js/p3-energy.js` (currently empty placeholder — write full implementation)
2. `js/mock-data.js` — ADD energy generator functions
3. `css/pages.css` — ADD P3-specific styles
4. `js/app.js` — Change `case "energy"` from `showComingSoon` to `EnergyPage.init()`

## CRITICAL ENGINEERING RULES (from Build Plan 🚨)
1. **Time-series Data Generator:** Use Math.sin() + noise for curves, NOT hardcoded JSON arrays
2. **Memoization:** Generators run ONCE at page load, store in DemoStore. Never regenerate on page switch.
3. **Timezone Defense:** X-axis must be string array `['00:00','00:15',...'23:45']`, NOT JS Date objects
4. **ECharts Singleton:** Use `Charts.createChart()` factory, wrap in try-catch
5. **Savings Formula:** `savings_brl = Σ((baseline[t] - actual[t]) × tariff_price[t] × 0.25)`

---

## T3.1 Home Selector
- Dropdown at top: Home A (Casa Silva) / Home B (Casa Santos) / Home C (Casa Oliveira)
- Selecting a different home refreshes ALL charts below with that home's data
- Each home has different mock data (generated with different parameters)

## T3.2 24-Hour Energy Flow Chart (MAIN CHART — ECharts)

This is the most important chart in the entire Dashboard. Make it beautiful.

### X-Axis
- String category array: `['00:00', '00:15', '00:30', ... '23:45']` (96 points, 15-min intervals)
- 🚨 NO JS Date objects

### Background Layer: Tarifa Branca Rate Zones
- Use `markArea` on xAxis to color-code time zones:
  - Off-peak (21:00-16:00): subtle dark blue/transparent background
  - Intermediate (16:00-17:00 & 20:00-21:00): subtle amber/transparent background  
  - Peak (17:00-20:00): subtle red/transparent background
- Labels: "Off-peak R$0.41" / "Intermediate R$0.62" / "Peak R$0.89"

### Curve 1: PV Generation (green area chart with gradient fill)
- `generateSolarCurve()` — bell curve: 0 at 06:00, rises to peak 3-5kW at 12:00, back to 0 at 18:00
- Green color (#22c55e), gradient area fill (top: 25% opacity → bottom: 2% opacity)

### Curve 2: Home Load (gray/white line)
- `generateLoadCurve()` — dual-peak: morning 07:00 (~1.5kW) + evening 18:00 (~2.5kW), base 0.5-0.8kW
- Light gray line

### Curve 3: Battery Charge/Discharge (purple line)
- `generateBatteryCurve(tariff, pv, load)`:
  - Off-peak: charge from grid (positive values)
  - When PV > Load: charge from PV surplus (positive)
  - Peak hours (17:00-20:00): discharge (negative values) for peak shaving
- Purple color (#a855f7), positive = charging ▲, negative = discharging ▼

### Curve 4: Grid Import/Export
- `grid_kw = load_kw - pv_kw - battery_kw` (energy conservation)
- Import (positive) = red (#ef4444), Export (negative) = green (#22c55e)
- This can be a single line with color split, or just one color

### Tooltip
- On hover: show ALL values at that time point + current tariff zone
- Format: "12:15 (Off-peak R$0.41)\nPV: 3.2 kW\nLoad: 1.5 kW\nBattery: +0.8 kW (charging)\nGrid: -1.5 kW (exporting)"

## T3.3 Dumb Baseline Overlay
- Add a dashed line on the energy flow chart: `baseline_grid = load_kw` (no PV, no battery)
- The area between baseline (dashed) and actual grid import (solid) = savings
- Fill this difference area with **gradient green** (top: 25% opacity → bottom: 2%)
- This visually shows "how much grid import was avoided by the optimization"

## T3.4 Per-Device Behavior (Tabs or vertical stack)
Use tabs: Battery | AC | EV Charger

### Battery Tab
- 24hr charge/discharge power curve (purple, reuse battery data from main chart)
- SoC line overlay (0-100%, right Y-axis)

### AC Tab
- On/Off timeline (horizontal bars showing when AC is running)
- Highlight segments where AC was turned off during peak (red mark = "peak shaving intervention")

### EV Charger Tab
- Charging session timeline
- Off-peak charging = green bars, Peak charging = red bars (should be minimal with optimization)

## T3.5 Before/After Comparison
- Two date pickers (mocked): "Before Optimization" / "After Optimization"
- Side-by-side or overlay showing energy flow difference
- Key delta cards: Self-consumption Δ / Peak Usage Δ / Grid Import Δ
- Mock: Before (82% self-consumption, 3.2kW peak) → After (97% self-consumption, 1.8kW peak)

## T3.6 Cross-Home Summary Table
- Table: Home / Self-consumption % / Grid Export (kWh) / Grid Import (kWh) / Peak Load (kW) / Target Mode
- 3 rows (one per home)
- Mock: self_consumption 96.2% / 98.5% / 94.1%
- Target modes: self_consumption / peak_valley_arbitrage / peak_shaving

---

## Mock Data Generators (add to mock-data.js)

```js
// 96 time slots (15-min intervals, 24 hours)
const TIME_LABELS = Array.from({length: 96}, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

function generateSolarCurve(peakKw = 4.5) {
  // Bell curve: 0 before 06:00, peak at 12:00, 0 after 18:00
  // Add ±5% random noise
  return TIME_LABELS.map((_, i) => {
    const hour = i / 4;
    if (hour < 6 || hour >= 18) return 0;
    const normalized = (hour - 6) / 6; // 0 at 6:00, 1 at 12:00
    const sinValue = Math.sin(normalized * Math.PI);
    const noise = 1 + (Math.random() - 0.5) * 0.1;
    return Math.max(0, +(peakKw * sinValue * noise).toFixed(2));
  });
}

function generateLoadCurve(baseKw = 0.6, morningPeak = 1.5, eveningPeak = 2.5) {
  // Dual peak: morning ~07:00, evening ~18:00
  return TIME_LABELS.map((_, i) => {
    const hour = i / 4;
    const base = baseKw + (Math.random() - 0.5) * 0.2;
    const morning = morningPeak * Math.exp(-0.5 * ((hour - 7) / 1.5) ** 2);
    const evening = eveningPeak * Math.exp(-0.5 * ((hour - 18.5) / 2) ** 2);
    return +(base + morning + evening).toFixed(2);
  });
}

function generateBatteryCurve(pvCurve, loadCurve) {
  // Off-peak (21:00-16:00): charge from grid at ~0.5kW
  // When PV > Load: charge from surplus
  // Peak (17:00-20:00): discharge at ~1.5-2kW
  return TIME_LABELS.map((_, i) => {
    const hour = i / 4;
    const pv = pvCurve[i];
    const load = loadCurve[i];
    
    if (hour >= 17 && hour < 20) {
      // Peak: discharge
      return -(1.5 + Math.random() * 0.5).toFixed(2);
    } else if (pv > load + 0.3) {
      // PV surplus: charge
      return +((pv - load) * 0.7).toFixed(2);
    } else if (hour >= 0 && hour < 6) {
      // Off-peak: charge from grid
      return +(0.3 + Math.random() * 0.3).toFixed(2);
    }
    return 0;
  });
}

// Generate once per home, memoize in DemoStore
function getHomeEnergyData(homeId) {
  const key = 'energyData_' + homeId;
  let data = DemoStore.get(key);
  if (data) return data;
  
  // Different parameters per home
  const params = {
    'HOME-001': { pvPeak: 4.5, base: 0.6, mPeak: 1.5, ePeak: 2.5 },
    'HOME-002': { pvPeak: 3.8, base: 0.5, mPeak: 1.2, ePeak: 2.0 },
    'HOME-003': { pvPeak: 5.2, base: 0.7, mPeak: 1.8, ePeak: 2.8 }
  };
  const p = params[homeId] || params['HOME-001'];
  
  const pv = generateSolarCurve(p.pvPeak);
  const load = generateLoadCurve(p.base, p.mPeak, p.ePeak);
  const battery = generateBatteryCurve(pv, load);
  const grid = load.map((l, i) => +(l - pv[i] - battery[i]).toFixed(2));
  const baseline = [...load]; // Dumb baseline = all grid
  
  data = { pv, load, battery, grid, baseline, timeLabels: TIME_LABELS };
  DemoStore.set(key, data);
  return data;
}
```

---

## Acceptance Criteria
1. Home selector switches all charts correctly
2. Main energy flow chart has 5 layers: tariff background zones + PV + Load + Battery + Grid
3. Tarifa Branca zones visually distinct (peak = red-ish, off-peak = blue-ish)
4. Dumb Baseline dashed line with gradient green savings area
5. Tooltip shows all 4 values + current tariff zone
6. Battery/AC/EV tabs show device-specific behavior
7. Before/After comparison shows deltas with clear improvement numbers
8. Cross-home table has 3 rows with correct self-consumption %
9. All charts use Charts.createChart() factory with try-catch
10. No console errors
11. Time labels are strings, NOT Date objects

## Completion Signal
```
openclaw system event --text "Phase 3 DONE: Energy Behavior complete. Ready for verification." --mode now
```
