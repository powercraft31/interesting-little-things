# REQ-v6.1-Fleet.md

## Status
Draft based on Alan-confirmed discussion on 2026-03-17.

## Goal
Reframe the Fleet page as a **Gateway-first operations dashboard** with asset-overview context, replacing the older device-first mixed view.

## Product Positioning

### Primary mission
**Operations monitoring**
- First question the page must answer: **which gateways are unhealthy, offline, or need operational attention right now?**

### Secondary mission
**Asset overview**
- The page should still provide fleet structure context, but this is subordinate to operations monitoring.

## Core Object Model

### Primary page subject
**Gateway**
- Fleet page is gateway-first, not device-first.
- Gateway is the main subject for KPIs, online rate, outage events, and backfill state.

### Secondary subject
**Assets / devices**
- Devices remain supporting context only.
- Device-level concepts must not replace Gateway as the page’s primary unit.

## Online / Offline Definitions

### Online-rate object
**Gateway online rate**
- The phrase "online rate" on the Fleet page refers to **Gateway online rate by default**.
- Device online rate is not a primary Fleet KPI.

### Online-status source of truth
**Backend-defined gateway status**
- Frontend does not derive online/offline status on its own.
- Frontend displays `gateway.status` from backend.

### Backend rule for gateway online
A Gateway is considered **online** when it has a **heartbeat within the last 15 minutes**.

### Connectivity vs data completeness
These are **two different dimensions** and must not be merged:
- `online/offline` reflects **gateway connectivity**, determined by heartbeat.
- `backfill` reflects **historical data completeness**, determined by telemetry gaps.

A Gateway may be **online** while still having **backfill pending or failed**.

## Gateway denominator rule
For v6.1 phase 1:
- **All registered gateways are included in the denominator**.
- This is valid because gateway registration is currently an internal controlled action.
- In future, if customer self-registration or pre-commissioning states are introduced, this rule may evolve.

## KPI Strip

### Final KPI set
1. **Total Gateways**
2. **Offline Gateways**
3. **Online Gateways**
4. **Gateway Online Rate**
5. **Gateways with Backfill Pending / Failed**
6. **Organizations**

### Final KPI order
1. Total Gateways
2. Offline Gateways
3. Online Gateways
4. Gateway Online Rate
5. Gateways with Backfill Pending / Failed
6. Organizations

### Explicit exclusions
- **Do not include `Total Devices` as a KPI card.**
- Device count is supporting context, not a primary Fleet KPI.

### KPI visual semantics
- **Offline Gateways** → risk color
- **Online Gateways** → healthy color
- Other KPI cards should remain neutral or lightly semantic

### Gateway Online Rate formatting
- Show **current value only**
- **No trend / delta** in KPI card
- Display format: **integer percent** (e.g. `75%`)

## Backfill Model

### Backfill object
**Gateway**
- Backfill on the Fleet page is defined at the **Gateway level**, not device level.
- Device/chunk/task-level execution may exist internally, but Fleet page reports Gateway-level status only.

### Why Gateway-level
- If a single device is offline but gateway data flow is still present, that is a device issue, not a Fleet-page backfill issue.
- Backfill is fundamentally about **Gateway-level data gaps** caused by network interruption, gateway disconnect, or upload discontinuity.

### Backfill trigger
A Gateway enters backfill-needed territory when the platform detects a **Gateway data gap greater than 5 minutes** on the **Gateway primary telemetry stream**.

### Backfill states
Use a **4-state model**:
- `not_started`
- `in_progress`
- `completed`
- `failed`

### Backfill failed definition
`failed` means:
- the platform attempted backfill,
- but the missing time range could not be recovered,
- typically because the data does not exist in the Gateway-side historical store, or retrieval failed.

### Retry behavior in v6.1 phase 1
- **No retry mechanism is implemented in v6.1 phase 1.**
- Therefore, a **single unsuccessful backfill attempt is treated as `failed`** in phase 1.
- In current operational assumptions, this usually implies the missing range is not recoverable from the Gateway-side store.

### Backfill KPI semantics
Primary KPI should represent **current unfinished backfill pressure**, i.e. Gateway count in:
- `not_started`
- `in_progress`
- `failed`

Secondary context may optionally show:
- last 24h backfill events
- last 7d backfill events

### Backfill KPI color rule
- Default card state: **warning color** when only pending/in-progress exists
- Escalate to **risk color** if any `failed` gateway exists

## Charts

### Chart layout
Two charts should be shown **side by side** in a left-right balanced layout.

### Left chart
**Gateway status distribution**
- This is the semantic primary chart.
- It expresses **connectivity health only**.

#### Status categories for this chart
Use only **2 categories**:
- `online`
- `offline`

#### Explicit exclusion
- Backfill lifecycle does **not** appear in this chart.
- This chart is not a full operational state machine; it is only a connectivity-health summary.

### Right chart
**Inverter brand distribution**
- This is the secondary chart.
- It expresses asset structure context.

#### Aggregation rule
Count by **number of inverter devices per brand**.
- Example: GoodWe = N devices, Huawei = N devices, etc.
- Do not use gateway-majority logic or capacity-weighted logic in v6.1 phase 1.

## Organization Table

### Purpose
The organization table is an **organization-level gateway operations summary**, not an asset inventory table.

### Display scope
- Show **only organizations that currently have gateways**.
- Do **not** show organizations with `0 gateways`.

### Columns
1. **Organization**
2. **Gateway Count**
3. **Gateway Online Rate**
4. **Backfill Pending / Failed**
5. **Last Commissioning**

### Sorting
- Primary sort: **Gateway Online Rate ascending**
- Secondary sort: **Gateway Count descending**

### Last Commissioning definition
`Last Commissioning` means:
- the most recent time a Gateway completed commissioning / first became validly online
- this is a business-operational timestamp, not a raw DB creation timestamp

### Last Commissioning source rule
- Use `gateway.commissioned_at` if available.
- If not available, fall back to the **first valid telemetry timestamp** for that Gateway.

## Offline Events Table

### Time window
Show **recent 7 days** only.

### Event object
Each row represents **one Gateway outage event**.

### Explicit exclusion
If only some devices are offline but the gateway remains online,
- this does **not** enter the main Fleet outage stream.
- Device-level anomalies belong in detail layers, not the Fleet main event table.

### Columns
1. **Gateway Name / ID**
2. **Organization**
3. **Offline Start**
4. **Duration**
5. **Backfill Status**

### Explicit exclusion
- Do **not** display a Cause column in v6.1 phase 1.
- Root-cause wording at Fleet level is likely to be noisy and misleading in first version.

### Sorting
- Sort by **Offline Start descending**
- Most recent outage appears first

## Outage Consolidation Rule
For the same Gateway:
- if recovery lasts **less than 5 minutes**,
- it is still considered the **same outage event**.

This prevents flap noise from fragmenting one operational incident into multiple rows.

## Interaction Model

### Fleet page interaction philosophy
v6.1 phase 1 is a **read-only dashboard**.

### Explicitly not included in phase 1
- No direct drill-down behavior from charts or tables
- No gateway list on the Fleet page
- No top-issues list on the Fleet page

### Rationale
The first goal of v6.1 is to stabilize the Gateway-first semantic model, not to expand interaction complexity.

## Timestamp Handling

### Gateway source time
- Gateway telemetry is reported as **timestamp-based machine time**.
- Gateways sync against the server time source in the **UTC+8** environment.

### Canonical ingestion rule
- Backend must treat reported timestamps as **canonical machine timestamps**.
- **Do not perform an additional timezone shift during ingestion.**
- Do not reinterpret canonical timestamps as naive local datetime strings.

### API output rule
- API must return **canonical timestamps** only:
  - either epoch timestamps,
  - or timezone-aware ISO timestamps.
- API must **not** return naive datetime strings without timezone context.

### Frontend display rule
- All user-facing Fleet timestamps must be displayed in the **browser local timezone**.

## Information Architecture Summary

### Page structure
1. KPI strip
2. Left-right dual charts
   - Left: Gateway status distribution
   - Right: Inverter brand distribution
3. Organization summary table
4. Recent Gateway outage table

## Design Principles to Preserve
1. **Gateway-first everywhere**
2. **Operations-first, assets-second**
3. **Do not reintroduce device-first logic into Fleet page**
4. **Do not show zero-gateway organization shells**
5. **Do not mix connectivity health and backfill lifecycle into the same chart**
6. **Keep Fleet page readable and high-signal; avoid turning it into a CRUD list or workflow console**

## Non-goals for v6.1 phase 1
- Device-level outage stream on Fleet homepage
- Device-level backfill state on Fleet homepage
- Capacity-weighted brand distribution
- Delta/trend-heavy KPI styling
- Interactive drill-down dashboard behavior
- Full gateway registry table on Fleet page

## One-sentence definition
**Fleet v6.1 is a Gateway-first operations dashboard that surfaces connectivity health, outage recovery, and organization-level operational status, with inverter brand structure shown only as secondary context.**
