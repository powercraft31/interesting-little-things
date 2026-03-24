# Task: Phase 2 — Device Management + Commissioning Wizard

## CRITICAL: Read reference files FIRST
1. `/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Pages_v1.2.html` — Design spec
2. `/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Build_Plan_v1.0.html` — Build plan (Phase 2 section)

Read BOTH before writing code. They contain mandatory constraints.

## Working Directory
`/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/frontend-v2/`

## Existing Code Context
Phase 0+1 is COMPLETE. The following files already exist and work:
- `index.html` — SPA shell with sidebar, 6 page sections
- `css/` — Complete CSS system (variables, base, layout, components, pages)
- `js/app.js` — Router, role switching, DemoStore
- `js/mock-data.js` — Fleet data, device types, generators, Tarifa Branca schedule
- `js/components.js` — KPI cards, tables, skeleton, confirm dialog
- `js/charts.js` — ECharts factory with singleton + ResizeObserver + deferred init
- `js/p1-fleet.js` — Complete Fleet Overview page

**DO NOT modify existing files unless absolutely necessary for P2 integration.** Focus on:
1. `js/p2-devices.js` (currently empty placeholder)
2. `js/mock-data.js` — ADD device list data (do NOT remove existing data)
3. `css/pages.css` — ADD P2-specific styles
4. `index.html` — Only if the P2 section HTML needs updating

## IMPORTANT PATTERN: Follow P1's pattern
Look at how `p1-fleet.js` works:
- Has `init()` method called by router
- Has `onRoleChange(role)` method
- Uses `Components.renderWithSkeleton(container, skeleton, real, callback)`
- Charts wrapped in try-catch, followed by `Charts.activatePageCharts('devices')`
- Follow the same pattern for P2

---

## T2.1 Device List Table (47 devices)

### Mock Data (add to mock-data.js)
Generate a `DEVICES` array of 47 device objects:
```js
const DEVICES = generateDeviceList(); // generator function, not hardcoded

function generateDeviceList() {
  const devices = [];
  const brands = ['Growatt', 'Sofar', 'Goodwe', 'Deye', 'Huawei', 'Solis'];
  const homes = [
    { id: 'HOME-001', name: 'Casa Silva', org: 'org-001' },
    { id: 'HOME-002', name: 'Casa Santos', org: 'org-001' },
    { id: 'HOME-003', name: 'Casa Oliveira', org: 'org-002' }
  ];
  // Generate 20 Inverter+Battery, 12 Smart Meter, 10 AC, 5 EV Charger
  // Distribute across 3 homes
  // 44 online, 3 offline (matching FLEET.onlineCount)
  // Offline devices: DEV-017, DEV-033, DEV-041 (matching OFFLINE_EVENTS)
  // Each device: { deviceId, type, brand, model, homeId, homeName, orgId, orgName, status, lastSeen, commissionDate, telemetry: {...} }
  return devices;
}
```

**Consistency Rule:** The sum of devices by type MUST match DEVICE_TYPES array. Online count MUST match FLEET.onlineCount (44). Offline device IDs MUST match OFFLINE_EVENTS.

### Table UI
- Columns: Device ID / Type / Brand / Home / Status / Last Seen
- Status badges: 🟢 online / 🔴 offline / 🟡 maintenance
- Filters above table:
  - Type dropdown (All / Inverter+Battery / Smart Meter / AC / EV Charger)
  - Status dropdown (All / Online / Offline)
  - Search box (filters by device ID or home name)
- Numbers right-aligned, dates in DD/MM/YYYY HH:mm format (24h)
- Row click → opens drill-down panel (T2.2)

### Role Behavior
- Admin: sees all 47 devices
- Integrador: sees only devices from 'org-001' (Solar São Paulo = 26 devices)

---

## T2.2 Device Drill-Down Panel

When clicking a device row, show a slide-in panel (right side) or modal:
- Device header: ID + type icon + status badge + brand/model
- Telemetry section (varies by type):
  - **Inverter+Battery:** PV power (kW), battery SoC (%), charge/discharge rate (kW), grid export (kW)
  - **Smart Meter:** total consumption (kW), voltage (V), current (A), power factor
  - **AC:** on/off status, set temp, room temp, power draw (kW)
  - **EV Charger:** charging status, charge rate (kW), session energy (kWh), EV SoC (%)
- Mock telemetry: hardcode reasonable values per device type
- "Close" button to dismiss panel

---

## T2.3 Commissioning Wizard

Full-screen modal overlay with 5 steps. Step progress bar at top.

### Step 1: Home Selection
- Text input: "Home ID" (pre-filled with HOME-001)
- "Next" button (full width, min-height 48px, high contrast)

### Step 2: Gateway Scan
- Text input: "Gateway Serial Number"
- "📷 Scan QR" button (disabled state, tooltip: "QR scan requires mobile device")
- "Next" button

### Step 3: Device Discovery (animated)
- On entering this step: show spinner animation for 2 seconds
- After 2s: show list of 4 "discovered" devices
- **🚨 CONSISTENCY:** Read from `mock-data.js` `UNASSIGNED_DEVICES` array (4 devices not yet in DEVICES)
```js
const UNASSIGNED_DEVICES = [
  { deviceId: 'DEV-048', type: 'Inverter + Battery', brand: 'Growatt', model: 'MIN 5000TL-XH' },
  { deviceId: 'DEV-049', type: 'Smart Meter', brand: 'Huawei', model: 'DTSU666-H' },
  { deviceId: 'DEV-050', type: 'AC', brand: 'Midea', model: 'Springer R410A' },
  { deviceId: 'DEV-051', type: 'EV Charger', brand: 'ABB', model: 'Terra AC W7-T-0' }
];
```
- Each device shows: ID / Type / Brand / Model / checkbox (all checked by default)
- "Next" button

### Step 4: Communication Test (animated)
- On entering: show "Testing communication..." with progress bar
- After 1s: DEV-048 → ✅ Pass
- After 1.5s: DEV-049 → ✅ Pass
- After 2s: DEV-050 → ✅ Pass
- After 3s: DEV-051 → ✅ Pass
- All pass → "Next" button enabled

### Step 5: Result Report
- Large green success block: "✅ Commissioning Complete"
- Summary: Home ID, 4 devices commissioned, time elapsed (mock: 92 min)
- Device list with status
- "Done" button → closes wizard
- On "Done": `DemoStore.set('lastCommission', { homeId, devices: [...], timestamp })` — so P1 can reflect the update

### Wizard Buttons
- All buttons: `min-height: 48px` (outdoor protection)
- "Next" button: full width at bottom, bright accent color
- "Back" button: secondary style, left-aligned
- Step indicator: circles with numbers, completed steps filled, current highlighted

---

## T2.4 Commissioning Tracking Table

Below the device list, a "Commissioning History" section:
- Table: Home ID / Integrador / Start / Complete / Duration (min) / Devices / First Telemetry
- Mock 3 rows:
  - HOME-001 / Solar São Paulo / 15/02/2026 09:00 / 15/02/2026 10:25 / 85 ✅ / 15 / 15/02/2026 10:43
  - HOME-002 / Solar São Paulo / 18/02/2026 14:00 / 18/02/2026 15:50 / 110 ✅ / 16 / 18/02/2026 16:15
  - HOME-003 / Green Energy Rio / 22/02/2026 10:00 / 22/02/2026 12:25 / 145 ⚠️ / 16 / 22/02/2026 12:52
- Duration > 120 min shows ⚠️ (amber), ≤ 120 shows ✅ (green) — Pilot Brief target: < 2hrs

---

## CSS Additions (pages.css)
- Wizard overlay: `position: fixed; inset: 0; z-index: 1000; background: var(--bg);`
- Step progress bar styling
- Device drill-down panel: slide-in from right, width 400px
- Filter bar above device table

---

## Acceptance Criteria
1. Device table shows 47 devices with working filters (type/status/search)
2. Click device row → drill-down panel shows correct telemetry for device type
3. Role switch to Integrador → only 26 devices visible
4. Wizard 5-step flow completes without errors (all animations work)
5. Wizard buttons ≥ 48px height
6. After wizard "Done", DemoStore updated
7. Commissioning history table shows 3 rows with correct duration indicators
8. No console errors

## Brazilian Localization
- Currency: R$ with comma decimal
- Dates: DD/MM/YYYY HH:mm (24h)
- Location names in Portuguese

## Completion Signal
When finished, run:
```
openclaw system event --text "Phase 2 DONE: Device Management + Wizard complete. Ready for verification." --mode now
```
