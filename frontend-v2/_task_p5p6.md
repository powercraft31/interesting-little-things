# Task: Phase 5 (VPP & DR) + Phase 6 (Performance)

## CRITICAL: Read reference files FIRST
1. `/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Pages_v1.2.html` — Design spec (P5 VPP & DR + P6 Performance sections)
2. `/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Build_Plan_v1.0.html` — Build plan (Phase 5 + Phase 6 sections)

## Working Directory
`/tmp/ashe_share/2026-02-15_SOLFACIL_VPP_Demo/frontend-v2/`

## Existing Code — Follow the Pattern
Look at `p4-hems.js` for the latest pattern:
- `var PageName = { init() {...}, onRoleChange(role) {...} }`
- `Components.renderWithSkeleton()` for skeleton loading
- Charts wrapped in try-catch + `Charts.activatePageCharts(pageId)`
- Mock data in `mock-data.js` as top-level `const` declarations

**Modify:** `js/p5-vpp.js`, `js/p6-performance.js` (both empty), `js/mock-data.js` (add data), `css/pages.css` (add styles), `js/app.js` (wire both routes)

**IMPORTANT:** In `js/app.js`, change BOTH `case "vpp"` and `case "performance"` from `showComingSoon()` to `VPPPage.init()` and `PerformancePage.init()` respectively. They currently share a fallthrough to `showComingSoon`.

---

## PHASE 5: VPP & DR

### T5.1 VPP Aggregate Capacity Cards
6 KPI cards in a row:
```
Total Capacity: 156.0 kWh
Available: 112.3 kWh
Aggregate SoC: 72%
Max Discharge: 45.0 kW
Max Charge: 38.0 kW
Dispatchable: 41 devices
```
Plus a 7th card (grayed out, placeholder):
- "Net Dispatchable" — "Load forecast adapting — available in 2 weeks" (dimmed text, no value)

### T5.2 DR Event Trigger Panel
Form with:
- Event Type: dropdown (Discharge / Charge / Load Curtailment)
- Target Power: input (kW)
- Duration: input (minutes)
- Device Scope: dropdown (All / By Home / By Integrador)
- "Trigger DR Event" button → Confirm Dialog → mock execution:
  - Progress bar: 0% → 100% over 3 seconds
  - Counter: "12/41 devices responded" → "28/41" → "38/41" → "41/41"
  - Final: "✅ DR Event Complete — 41/41 devices responded"
- Integrador: all controls disabled

### T5.3 Dispatch Latency Test Results (Bar Chart — ECharts)
Horizontal bar chart showing 7 tiers:
```
1s:    60%  (red — below threshold)
5s:    72%  (amber)
15s:   88%  (amber)
30s:   94%  (green — above 90% target)
1min:  97%  (green)
15min: 99%  (green)
1h:   100%  (green)
```
- 90% target line (vertical dashed line)
- Bars colored: red (<80%), amber (80-90%), green (>90%)
- Use `Charts.createChart()` with try-catch

### T5.4 DR Event History Table
5 rows:
```
EVT-001 | Discharge  | 01/03/2026 18:00 | 30 kW  | 28.5 kW | 95.0% | 38/41 | 3
EVT-002 | Charge     | 02/03/2026 02:00 | 25 kW  | 24.8 kW | 99.2% | 41/41 | 0
EVT-003 | Curtailment| 02/03/2026 17:30 | 15 kW  | 14.1 kW | 94.0% | 35/41 | 6
EVT-004 | Discharge  | 03/03/2026 18:00 | 35 kW  | 33.2 kW | 94.9% | 39/41 | 2
EVT-005 | Charge     | 04/03/2026 01:00 | 20 kW  | 20.0 kW | 100%  | 41/41 | 0
```
Columns: Event ID / Type / Triggered At / Target kW / Achieved kW / Accuracy / Participated / Failed

---

## PHASE 6: Performance Scorecard

### T6.1 Pilot Acceptance Scorecard
Three groups displayed as vertical card columns:

**OBJECTIVE 1: Hardware**
```
Commissioning Time:    95 min   ✅  (target: <120)
Offline Resilience:    72 hrs   ✅  (target: ≥72)
Uptime (4 weeks):     93.6%    ✅  (target: >90%)
First Telemetry:      18 hrs   ✅  (target: <24)
```

**OBJECTIVE 2: Optimization**
```
Savings Alpha:        74.2%    ✅  (target: >70%)
Self-Consumption:     96.8%    🟡  (target: >98%) ← NEAR MISS
PV Forecast MAPE:     22.1%    ✅  (target: <25%)
Load Forecast Adapt:  11 days  ✅  (target: <14)
```

**Operations**
```
Dispatch Accuracy:    91.3%    ✅  (target: TBD)
Training Time:        75 min   ✅  (target: <90)
Manual Interventions:  4       ⚠️  (no target)
App Uptime:          99.2%    ✅  (target: >99%)
```

- Actual values: JetBrains Mono, large font
- Target values: small gray text
- Status icons colored: ✅ green, 🟡 amber (near miss), ⚠️ amber (warning)
- Self-consumption at 96.8% should visually stand out as "almost there but not quite"

### T6.2 Savings Chart (Stacked Bar — ECharts)
- 3 bars (one per home)
- Each bar stacked by savings source:
  - Self-consumption savings (green)
  - TOU arbitrage savings (blue)
  - Peak shaving savings (purple)
- Y axis: R$ (Brazilian currency format)
- Values with + sign: "+R$ 145,00"
- Alpha % label above each bar

Mock data:
```
Casa Silva:    +R$ 145,00 (alpha 74.2%) — SC: 85, TOU: 40, PS: 20
Casa Santos:   +R$ 118,50 (alpha 68.1%) — SC: 65, TOU: 35, PS: 18.5
Casa Oliveira: +R$ 167,30 (alpha 79.5%) — SC: 95, TOU: 48, PS: 24.3
```

---

## Mock Data (add to mock-data.js)

```js
const VPP_CAPACITY = {
  totalCapacityKwh: 156.0,
  availableKwh: 112.3,
  aggregateSoc: 72,
  maxDischargeKw: 45.0,
  maxChargeKw: 38.0,
  dispatchableDevices: 41
};

const LATENCY_TIERS = [
  { tier: '1s', successRate: 60 },
  { tier: '5s', successRate: 72 },
  { tier: '15s', successRate: 88 },
  { tier: '30s', successRate: 94 },
  { tier: '1min', successRate: 97 },
  { tier: '15min', successRate: 99 },
  { tier: '1h', successRate: 100 }
];

const DR_EVENTS = [
  { id: 'EVT-001', type: 'Discharge', triggeredAt: '01/03/2026 18:00', targetKw: 30, achievedKw: 28.5, accuracy: 95.0, participated: 38, failed: 3 },
  { id: 'EVT-002', type: 'Charge', triggeredAt: '02/03/2026 02:00', targetKw: 25, achievedKw: 24.8, accuracy: 99.2, participated: 41, failed: 0 },
  { id: 'EVT-003', type: 'Curtailment', triggeredAt: '02/03/2026 17:30', targetKw: 15, achievedKw: 14.1, accuracy: 94.0, participated: 35, failed: 6 },
  { id: 'EVT-004', type: 'Discharge', triggeredAt: '03/03/2026 18:00', targetKw: 35, achievedKw: 33.2, accuracy: 94.9, participated: 39, failed: 2 },
  { id: 'EVT-005', type: 'Charge', triggeredAt: '04/03/2026 01:00', targetKw: 20, achievedKw: 20.0, accuracy: 100, participated: 41, failed: 0 }
];

const SCORECARD = {
  hardware: [
    { name: 'Commissioning Time', value: 95, unit: 'min', target: '<120', status: 'pass' },
    { name: 'Offline Resilience', value: 72, unit: 'hrs', target: '≥72', status: 'pass' },
    { name: 'Uptime (4 weeks)', value: 93.6, unit: '%', target: '>90%', status: 'pass' },
    { name: 'First Telemetry', value: 18, unit: 'hrs', target: '<24', status: 'pass' }
  ],
  optimization: [
    { name: 'Savings Alpha', value: 74.2, unit: '%', target: '>70%', status: 'pass' },
    { name: 'Self-Consumption', value: 96.8, unit: '%', target: '>98%', status: 'near' },
    { name: 'PV Forecast MAPE', value: 22.1, unit: '%', target: '<25%', status: 'pass' },
    { name: 'Load Forecast Adapt', value: 11, unit: 'days', target: '<14', status: 'pass' }
  ],
  operations: [
    { name: 'Dispatch Accuracy', value: 91.3, unit: '%', target: 'TBD', status: 'pass' },
    { name: 'Training Time', value: 75, unit: 'min', target: '<90', status: 'pass' },
    { name: 'Manual Interventions', value: 4, unit: '', target: '—', status: 'warn' },
    { name: 'App Uptime', value: 99.2, unit: '%', target: '>99%', status: 'pass' }
  ]
};

const SAVINGS_BY_HOME = [
  { home: 'Casa Silva', total: 145.00, alpha: 74.2, sc: 85, tou: 40, ps: 20 },
  { home: 'Casa Santos', total: 118.50, alpha: 68.1, sc: 65, tou: 35, ps: 18.5 },
  { home: 'Casa Oliveira', total: 167.30, alpha: 79.5, sc: 95, tou: 48, ps: 24.3 }
];
```

---

## Acceptance Criteria
1. VPP capacity cards show correct values with JetBrains Mono
2. Net Dispatchable is grayed out with "adapting" message
3. DR trigger: filters → confirm → progress animation → completion message
4. Latency bar chart has 90% target line, bars colored red/amber/green
5. DR event history: 5 rows, accuracy percentages correct
6. Scorecard: 3 columns, 12 metrics, Self-Consumption shows 🟡 (near miss)
7. Savings stacked bar: 3 homes, +R$ format, alpha % labels
8. Integrador: VPP/DR controls disabled
9. No console errors

## Completion Signal
```
openclaw system event --text "Phase 5+6 DONE: VPP & DR + Performance complete. Ready for verification." --mode now
```
