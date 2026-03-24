# Task: Phase 4 — HEMS Control (Optimization Rules)

## CRITICAL: Read reference files FIRST
1. `/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Pages_v1.2.html` — Design spec (P4 HEMS Control section)
2. `/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/design/Admin_Portal_Build_Plan_v1.0.html` — Build plan (Phase 4 section)

## Working Directory
`/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/frontend-v2/`

## Existing Code — Follow the Pattern
Look at `p1-fleet.js`, `p2-devices.js`, `p3-energy.js` for the pattern:
- `init()` → `Components.renderWithSkeleton()` → callback sets up event listeners
- `onRoleChange(role)` → updates visibility
- Charts wrapped in try-catch + `Charts.activatePageCharts('hems')`
- Update `js/app.js`: change `case "hems"` from `showComingSoon` to `HEMSPage.init()` + add `onRoleChange` hook

**Only modify:** `js/p4-hems.js` (empty), `js/mock-data.js` (add data), `css/pages.css` (add styles), `js/app.js` (wire route)

---

## T4.1 Optimization Mode Selection Panel

Three large mode cards displayed horizontally:

### self_consumption
- Icon: ☀️
- Title: "Self-Consumption"
- Description: "Maximize use of self-generated PV power. Minimize grid import."
- Devices: 22 (46.8%)
- Border: green when selected

### peak_valley_arbitrage
- Icon: 📊
- Title: "Peak/Valley Arbitrage"
- Description: "Charge battery during off-peak, discharge during peak. Exploit Tarifa Branca price difference."
- Devices: 18 (38.3%)
- Border: blue when selected

### peak_shaving
- Icon: ⚡
- Title: "Peak Shaving"
- Description: "Limit peak grid demand. Shed AC/EV loads during peak hours."
- Devices: 7 (14.9%)
- Border: purple when selected

Clicking a mode card selects it (shows checkmark, highlighted border). Only Admin can select; Integrador sees read-only.

## T4.2 Batch Dispatch Operation

### Filters
- By Integrador (dropdown: All / Solar São Paulo / Green Energy Rio)
- By Home (dropdown: All / Casa Silva / Casa Santos / Casa Oliveira)
- By Device Type (dropdown: All / Inverter+Battery / Smart Meter / AC / EV Charger)
- By Current Mode (dropdown: All / self_consumption / peak_valley_arbitrage / peak_shaving)

### Target Mode Selector
- Radio buttons: same 3 modes as above
- Selected mode = the mode to switch TO

### Preview Button
- "Preview Impact" button → shows:
  - "This operation will change N devices from [current] to [target]"
  - Breakdown by home: "Casa Silva: 8 devices, Casa Santos: 6 devices..."
  - Offline devices warning: "2 offline devices will receive new rules when reconnected"

### Execute Button
- "Apply Changes" button (disabled until preview is done)
- Click → Confirm Dialog (use existing Components.confirmDialog):
  - "Are you sure you want to change 14 devices to Peak Shaving mode?"
  - "Confirm" / "Cancel"
- On confirm: mock 2-second delay → success toast notification
- **DemoStore update:** `DemoStore.set('targetModeDistribution', newDistribution)` so P3 can read it

### Role: Integrador sees all controls disabled with tooltip "Requires SOLFACIL Admin"

## T4.3 Tarifa Branca Rate Table

### Display
- Card showing current rates:
  - DISCO: CEMIG
  - Peak: R$ 0,89/kWh (17:00-20:00)
  - Intermediate: R$ 0,62/kWh (16:00-17:00 & 20:00-21:00)
  - Off-peak: R$ 0,41/kWh (Other hours)
  - Effective Date: 01/01/2026

### Edit Button
- "Edit Rates" button → Modal form:
  - Input fields for each rate (pre-filled with current values)
  - DISCO name input
  - Effective date input
  - "Save" / "Cancel" buttons
- On save: update display (mock, not persisted beyond DemoStore)

## T4.4 Rule Application Status Panel

### Last Dispatch Record
- Card: "Last rule change: 03/03/2026 14:30"
- Mode: Peak/Valley Arbitrage → Peak Shaving
- Affected: 7 devices
- Success Rate: 100% (7/7)

### ACK Status List
- Table: Device ID / Mode / ACK Status / Response Time
- Mock 7 rows:
  - 5 × ✅ ACK (0.5-3s response)
  - 1 × ⏳ Pending (offline device, will receive on reconnect)
  - 1 × ❌ Timeout (failed after 30s)
- "View behavior changes →" link: clicking navigates to #energy

---

## Mock Data (add to mock-data.js)

```js
const MODE_DISTRIBUTION = {
  self_consumption: 22,
  peak_valley_arbitrage: 18,
  peak_shaving: 7
};

const TARIFA_RATES = {
  disco: 'CEMIG',
  peak: 0.89,
  intermediate: 0.62,
  offPeak: 0.41,
  effectiveDate: '01/01/2026',
  peakHours: '17:00-20:00',
  intermediateHours: '16:00-17:00 & 20:00-21:00'
};

const LAST_DISPATCH = {
  timestamp: '03/03/2026 14:30',
  fromMode: 'peak_valley_arbitrage',
  toMode: 'peak_shaving',
  affectedDevices: 7,
  successRate: 100,
  ackList: [
    { deviceId: 'DEV-027', mode: 'peak_shaving', status: 'ack', responseTime: '0.8s' },
    { deviceId: 'DEV-029', mode: 'peak_shaving', status: 'ack', responseTime: '1.2s' },
    { deviceId: 'DEV-031', mode: 'peak_shaving', status: 'ack', responseTime: '0.5s' },
    { deviceId: 'DEV-032', mode: 'peak_shaving', status: 'ack', responseTime: '2.1s' },
    { deviceId: 'DEV-037', mode: 'peak_shaving', status: 'ack', responseTime: '1.7s' },
    { deviceId: 'DEV-041', mode: 'peak_shaving', status: 'pending', responseTime: '—' },
    { deviceId: 'DEV-045', mode: 'peak_shaving', status: 'timeout', responseTime: '30s' }
  ]
};
```

---

## Acceptance Criteria
1. Three mode cards display correctly with device counts
2. Batch dispatch: filters → preview → confirm dialog → mock execution → DemoStore update
3. Tarifa rate table shows correct values, edit modal works
4. ACK status table with ✅/⏳/❌ icons
5. "View behavior changes" link navigates to #energy
6. Integrador role: all action controls disabled with tooltip
7. No console errors

## Completion Signal
```
openclaw system event --text "Phase 4 DONE: HEMS Control complete. Ready for verification." --mode now
```
