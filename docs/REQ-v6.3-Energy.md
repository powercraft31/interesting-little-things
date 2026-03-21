# REQ-v6.3-Energy.md

## Status
Draft based on Alan-confirmed discussion on 2026-03-20.

## Goal
Rebuild the Energy page as a **Gateway-first time-series and energy-statistics page**, clearly separated from the Devices page.

## Implementation Boundary

### v6.3 frontend technology boundary
v6.3 must be implemented on the **current `frontend-v2` technology stack**.
- current stack = `index.html` + hash router + `frontend-v2/js/*.js` page modules + `data-source.js` + `charts.js` + `css/*.css`
- **v6.3 does not include React / Vite / shadcn / Tailwind migration**
- frontend framework migration is explicitly a **v7.0 topic**, not a v6.3 topic

### Replacement scope
v6.3 replaces the current Energy page implementation under the existing route.
- the existing `#energy` route remains the page entry
- the implementation scope is to **replace / rebuild the current `frontend-v2/js/p3-energy.js` path**, not to create a second parallel frontend

## Product Positioning

### Primary mission
**Time-series energy understanding**
- First question the page must answer: **over a selected time window, how did energy flow through this Gateway, and what are the resulting energy totals and structure?**

### Secondary mission
**Energy statistics interpretation**
- The page should summarize energy totals, efficiency, and peak context for the selected time window.

### Explicit exclusion
**Current-state device monitoring** does not belong here.
- Current status, device health, device composition, and control/configuration remain the responsibility of the **Devices** page.

### One-line page philosophy
> Devices 看现况，Energy 看时间序列与能量统计。

---

## Core Object Model

### Primary page subject
**Gateway**
- Energy page is Gateway-first, not asset-first.
- The page answers energy questions at the Gateway / site behavior level.

### Gateway selection rule
**Energy page owns its own Devices-style left Gateway locator**
- Energy page must provide its own left-hand Gateway locator / object selector, structurally aligned with the Devices page locator.
- The top control area must not introduce a second competing Gateway dropdown/select; gateway switching belongs to the left locator column inside the Energy page itself.
- Hash param / `DemoStore` may be used only to determine the default highlighted gateway on entry, not as a prerequisite for the page to function.
- Recommended default priority: `#energy?gw=...` > `DemoStore.selectedGatewayId` > first available gateway in the loaded locator list.

### Secondary subject
**Asset-level detail is supporting context only**
- Asset-level telemetry may still exist internally or via drill-down, but asset is not the primary subject of the Energy page.
- Energy page must not regress into an asset-history workbench.

---

## Time Model

### Supported windows
The page supports exactly four top-level time windows:
1. **24h**
2. **7d**
3. **30d**
4. **12m**

### Default window
**24h** is the default active window.

### Semantic split by window
These windows do **not** share the same semantic role.

#### 24h
**Behavior layer**
- 24h answers **how power flowed over time**.
- It is the only window where the page behaves like an operational waveform / energy-flow behavior view.

#### 7d / 30d / 12m
**Statistics layer**
- These windows answer **how much energy moved, what the structure was, and how the period performed**.
- They are not stretched versions of the 24h behavior chart.

### Latest-point requirement
For 24h:
- latest telemetry points should extend the time-series view when new data arrives
- the page should feel like a live behavior view, not a frozen report

### Refresh model
- **24h**: auto-refresh
- **7d / 30d / 12m**: refresh on demand / on window change; no unnecessary live jitter

---

## Date Controls

### 24h control
**Single-day picker**
- User selects a specific day
- Page shows that day’s 24h behavior

### 7d control
**End-date anchor**
- User selects an end date
- Page shows the most recent 7 days up to that end date

### 30d control
**End-date anchor**
- User selects an end date
- Page shows the most recent 30 days up to that end date

### 12m control
**Month anchor**
- User selects an ending month (year-month)
- Page shows the latest 12 months up to that month

### Why anchor controls
- These controls preserve clarity and avoid overcomplicated arbitrary range behavior in the first version.
- 24h is day-specific; 7d/30d are rolling windows; 12m is a month-anchored long-range view.

---

## 24h Behavior Layer

### Main chart mission
The 24h main chart exists to answer:
> At each moment of the selected day, how did energy flow between PV, load, battery, and grid?

### Main chart series
Exactly four series:
1. **PV**
2. **Load**
3. **Battery**
4. **Grid**

### Main chart expression model
Use **single zero-crossing lines** for Battery and Grid, with supporting directional summary outside the chart.

This is the final selected model from the A/B/C mock comparison.

### Fixed sign semantics
These semantics are mandatory and must be explicitly visible via axis / legend / tooltip help:

- **Battery**
  - positive = **discharging**
  - negative = **charging**
- **Grid**
  - positive = **import / buying from grid**
  - negative = **export / selling to grid**

### Industry alignment rationale
Alan explicitly confirmed this sign model is acceptable and aligns with industry-standard energy UIs such as Tesla Energy.

### Visual requirements
- zero line must be clearly visible — implemented as a **dashed line** with sufficient contrast against the dark chart background (not blending into grid lines)
- Battery and Grid series must use **area fill** (semi-transparent fill between the line and the zero axis) to visually communicate the direction zones (above/below zero)
- tooltip must explicitly explain direction meaning
- chart must preserve four-flow readability; do not explode Battery/Grid into multiple extra main-chart series

### Color palette (discussion-confirmed)
The following ECharts color assignments are fixed:
| Series | Color | Hex |
|--------|-------|-----|
| PV | Gold/Yellow | `#f6c445` |
| Load | Sky Blue | `#60a5fa` |
| Battery | Emerald Green | `#34d399` |
| Grid | Coral Red | `#f87171` |
| SoC | Purple | `#a78bfa` |

These colors must be used consistently across charts, stat cards, and legends.

### Explicit exclusion
Do **not** convert the 24h main chart into a six-line split-direction chart.
- Direction splits belong to summary/statistics layers, not the main behavior chart.

---

## Directional Summary

### Purpose
The page must still show the split totals for directional flows, but **outside** the main chart.

### Required directional summary items
1. **Battery Charge**
2. **Battery Discharge**
3. **Grid Import**
4. **Grid Export**

### Role
- Main chart = behavior semantics
- Direction summary = split totals

This separation is intentional and must be preserved.

---

## SoC Auxiliary Chart

### Scope rule
**SoC appears only in 24h mode.**

### Why only 24h
SoC is meaningful as an auxiliary chart only when it can be interpreted **against the same intraday power timeline**.
- In 7d / 30d / 12m, SoC should not become a pseudo-statistics chart.
- Long-period SoC views would blur semantics and weaken the page’s time-model clarity.

### Alignment rule
This is a hard UI/UX requirement from Alan:
- SoC must use the **same intraday X-axis time semantics** as the 24h main chart
- and must be **visually aligned** so a human can read the same moment vertically across the two charts

### User-reading goal
A user should be able to see:
- what happened in power flow at a given time
- and immediately see the corresponding SoC at that same time

### Long-window behavior
For 7d / 30d / 12m:
- do not render a long-period SoC chart
- instead show a clear explanation that SoC is only displayed in 24h because it depends on point-by-point alignment with the power timeline

---

## Statistics Layer (7d / 30d / 12m)

### Mission
For 7d / 30d / 12m, the page answers:
- how much energy moved
- what the energy structure was
- how efficient the period was
- what the peak-demand context looked like

### Chart principle
Use a statistics-oriented chart style.
- grouped / stacked bars, area totals, or similar aggregation-oriented forms are acceptable
- do not reuse the 24h zero-crossing behavior chart semantics for long windows

### Main statistics hierarchy

The three tiers must be **visually distinguishable** — a user scanning the page should immediately perceive that Primary metrics are the most important, Secondary are subordinate, and Supporting are contextual. This is achieved through progressive reduction in font size, font weight, and card prominence.

#### Primary metrics
These are the core statistics and must be visually primary:
1. **PV Generation**
2. **Load Consumption**
3. **Grid Import**
4. **Grid Export**

Visual treatment: largest value font size, bold weight, full-width card row.

#### Secondary metrics
These are important but subordinate to the four core Gateway energy totals:
1. **Battery Charge**
2. **Battery Discharge**

Visual treatment: medium value font size, semi-bold, narrower card row.

#### Supporting metrics
These provide performance / structure interpretation:
1. **Self-consumption**
2. **Self-sufficiency**
3. **Peak Demand**

Visual treatment: smallest value font size among the three tiers, regular weight.

### Metric description text
Each statistic card must include a **brief description line** below the value, in muted/secondary color, explaining what the metric means. Examples:
- PV Generation: "Total solar energy produced"
- Self-consumption: "% of PV used on-site"
- Peak Demand: "Maximum instantaneous load"

This ensures the page is self-explanatory without requiring external documentation.

### Explicit exclusion
No separate economic light section.
- Savings / cost / revenue are not the focus of the Energy page in v6.3.
- Economic presentation can live elsewhere if needed later.

---

## Separation from Devices Page

### Devices page responsibility
Devices page answers:
- what is happening now
- which devices are online/offline
- current health / composition / configuration / control workbench context

### Energy page responsibility
Energy page answers:
- over time, how energy flowed
- over time, how much energy moved
- over time, what structure / efficiency / peak patterns emerged

### Hard anti-regression rule
Energy page must not regress into:
- current-state device dashboard
- asset-level history workbench as primary mode
- duplicate Gateway selection UI already handled by Devices left sidebar

---

## UX Rules

### Navigation responsibility split
- **Energy page left Gateway locator** = who the user is looking at
- **Top controls** = what time window / date anchor the user is looking at

This split must remain clean.

### Chart reading priority
For 24h:
1. read main behavior chart
2. read SoC alignment below it
3. read directional summary
4. read metrics

For 7d / 30d / 12m:
1. read aggregated statistics chart
2. read metrics hierarchy
3. use SoC explanation block only as semantic guardrail

---

## Acceptance Criteria

### A. Object / navigation acceptance
- Energy page is clearly Gateway-first
- Energy page includes its own Devices-style left Gateway locator
- top area does not introduce a second duplicate Gateway dropdown/select

### B. 24h acceptance
- 24h is default
- main chart shows PV / Load / Battery / Grid only
- Battery/Grid use fixed zero-crossing sign semantics
- zero line and direction hints are visible
- SoC appears only in 24h
- SoC and main chart are visually aligned for same-time comparison
- latest-point/live-refresh behavior is supported conceptually for 24h

### C. Long-window acceptance
- 7d / 30d / 12m switch page into statistics mode
- long windows do not reuse the 24h behavior chart model
- long windows do not show SoC trend charts
- long windows show primary / secondary / supporting metrics with the approved hierarchy

### D. Date-control acceptance
- 24h uses day picker
- 7d/30d use end-date anchors
- 12m uses month anchor

### E. Separation acceptance
- Devices and Energy page roles are clearly distinct
- Energy page does not duplicate Devices current-state semantics

---

## Open items deliberately left to design/implementation
The following are intentionally delegated to DESIGN / PLAN, not decided at REQ level:
- exact chart library composition and component breakdown
- exact card layout and responsive breakpoints
- exact long-window chart form (grouped bar vs stacked bar vs area totals)
- tooltip wording details
- frontend state management / data fetching structure
- API reuse vs BFF extension details
xtension details
DESIGN / PLAN, not decided at REQ level:
- exact chart library composition and component breakdown
- exact card layout and responsive breakpoints
- exact long-window chart form (grouped bar vs stacked bar vs area totals)
- tooltip wording details
- frontend state management / data fetching structure
- API reuse vs BFF extension details
DESIGN / PLAN, not decided at REQ level:
- exact chart library composition and component breakdown
- exact card layout and responsive breakpoints
- exact long-window chart form (grouped bar vs stacked bar vs area totals)
- tooltip wording details
- frontend state management / data fetching structure
- API reuse vs BFF extension details
