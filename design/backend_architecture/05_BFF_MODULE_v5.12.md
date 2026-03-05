# Module 5: Frontend BFF (Backend-for-Frontend)

> **模組版本**: v5.12
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.12.md](./00_MASTER_ARCHITECTURE_v5.12.md)
> **最後更新**: 2026-03-05
> **說明**: API Contract Alignment & BFF Expansion — frontend-v2 全面數據盤點、Gap Analysis、新端點設計、漸進整合策略
> **核心主題**: 將 frontend-v2 從 100% mock 數據遷移到 BFF API，設計 10+ 個新端點對齊 6 個前端頁面

---

## 1. 模組職責

M5 BFF 是前端 Dashboard 的唯一 API 入口。職責：

- 聚合 M1（遙測）、M2（策略）、M3（調度）、M4（計費）的數據為統一 REST 回應
- Cognito JWT 認證 + RBAC 角色鑑權
- `extractTenantContext()` 中間件確保所有查詢都帶 `org_id` 過濾（v5.10: BFF 內部 HTTP 適配器）
- **v5.12: 擴展端點覆蓋所有 6 個前端頁面的數據需求**
- 所有 BFF 端點使用 `getAppPool()` via `queryWithOrg`（v5.11 dual pool 架構）

---

## 2. Frontend-v2 數據盤點

### 2.1 頁面數據依賴總覽

frontend-v2 包含 6 個核心頁面，目前使用 100% mock 數據（`mock-data.js` + `DemoStore` sessionStorage）。以下為每頁的完整數據需求：

| 頁面 | JS 文件 | Mock 數據物件 | 圖表數量 | 表格數量 |
|------|---------|-------------|---------|---------|
| P1 Fleet Overview | p1-fleet.js | FLEET, DEVICE_TYPES, INTEGRADORES, OFFLINE_EVENTS, uptimeTrend | 2 | 2 |
| P2 Device Management | p2-devices.js | DEVICES (47), HOMES (3), UNASSIGNED_DEVICES (4), COMMISSIONING_HISTORY (3) | 0 | 2 |
| P3 Energy Behavior | p3-energy.js | homeData (pv, load, battery, grid, baseline, soc, acPower, evCharge) × 3 homes | 4 | 1 |
| P4 HEMS Control | p4-hems.js | MODE_DISTRIBUTION, TARIFA_RATES, LAST_DISPATCH | 0 | 1 |
| P5 VPP & DR | p5-vpp.js | VPP_CAPACITY, LATENCY_TIERS, DR_EVENTS (5) | 1 | 1 |
| P6 Performance | p6-performance.js | SCORECARD (12 metrics), SAVINGS_BY_HOME (3 homes) | 1 | 0 |

### 2.2 Mock 數據結構詳細定義

#### P1: Fleet Overview

```typescript
// FLEET — Fleet aggregate KPIs
interface FleetOverview {
  totalDevices: number;      // 47
  onlineCount: number;       // 44
  offlineCount: number;      // 3
  onlineRate: number;        // 93.6 (%)
  totalHomes: number;        // 3
  totalIntegradores: number; // 2
}

// DEVICE_TYPES — Device distribution by type
interface DeviceTypeCount {
  type: string;    // "Inverter + Battery" | "Smart Meter" | "AC" | "EV Charger"
  count: number;   // total count
  online: number;  // online count
  color: string;   // hex color for chart
}

// INTEGRADORES — Integrador list (admin/integrador only)
interface Integrador {
  orgId: string;           // "org-001"
  name: string;            // "Solar São Paulo"
  deviceCount: number;     // 26
  onlineRate: number;      // 96.2 (%)
  lastCommission: string;  // "DD/MM/YYYY"
}

// OFFLINE_EVENTS — Recent offline event log
interface OfflineEvent {
  deviceId: string;     // "DEV-003"
  start: string;        // "DD/MM/YYYY HH:MM"
  durationHrs: number;  // 4.2
  cause: string;        // "firmware_update" | "network" | "hardware" | "unknown"
  backfill: boolean;    // true = data recovered
}

// uptimeTrend — 28-day uptime history (generated)
interface UptimeTrendPoint {
  date: string;    // "DD/MM"
  uptime: number;  // 80-100 (%)
}
```

#### P2: Device Management

```typescript
// DEVICES — Full device list (47 devices)
interface Device {
  deviceId: string;        // "DEV-001"
  type: string;            // "Inverter + Battery" | "Smart Meter" | "AC" | "EV Charger"
  brand: string;           // "Growatt", "Huawei", "Midea", etc.
  model: string;           // "MIN 5000TL-XH"
  homeId: string;          // "HOME-001"
  homeName: string;        // "Casa Silva"
  orgId: string;           // "org-001"
  orgName: string;         // "Solar São Paulo"
  status: string;          // "online" | "offline"
  lastSeen: string;        // "DD/MM/YYYY HH:MM"
  commissionDate: string;  // "DD/MM/YYYY"
  telemetry: InverterTelemetry | SmartMeterTelemetry | ACTelemetry | EVChargerTelemetry;
}

interface InverterTelemetry {
  pvPower: number;      // kW
  batterySoc: number;   // %
  chargeRate: number;   // kW
  gridExport: number;   // kW
}

interface SmartMeterTelemetry {
  consumption: number;  // kW
  voltage: number;      // V
  current: number;      // A
  powerFactor: number;  // 0-1
}

interface ACTelemetry {
  on: boolean;
  setTemp: number;     // °C
  roomTemp: number;    // °C
  powerDraw: number;   // kW
}

interface EVChargerTelemetry {
  charging: boolean;
  chargeRate: number;     // kW
  sessionEnergy: number;  // kWh
  evSoc: number;          // %
}

// HOMES — Home list
interface Home {
  id: string;       // "HOME-001"
  name: string;     // "Casa Silva"
  orgId: string;    // "org-001"
  orgName: string;  // "Solar São Paulo"
}

// COMMISSIONING_HISTORY
interface CommissioningRecord {
  homeId: string;
  integrador: string;
  start: string;
  complete: string;
  durationMin: number;
  devices: number;
  firstTelemetry: string;
}
```

#### P3: Energy Behavior (per home, 96 data points = 15-min intervals)

```typescript
interface HomeEnergyData {
  pv: number[];       // 96 values, kW (solar generation)
  load: number[];     // 96 values, kW (consumption)
  battery: number[];  // 96 values, kW (+charge/-discharge)
  grid: number[];     // 96 values, kW (+import/-export)
  baseline: number[]; // 96 values, kW (no-PV/battery scenario)
  savings: number;    // R$ daily savings
  soc: number[];      // 96 values, % (battery state of charge)
  acPower: number[];  // 96 values, kW (AC device)
  evCharge: number[]; // 96 values, kW (EV charger)
}

// TIME_LABELS_15MIN: ["00:00", "00:15", ..., "23:45"] (96 labels)

// Cross-home summary
interface CrossHomeSummary {
  homeId: string;
  name: string;
  selfCons: number;     // % self-consumption
  gridExport: number;   // kWh
  gridImport: number;   // kWh
  peakLoad: number;     // kW
  mode: string;         // "self_consumption" | "peak_valley_arbitrage" | "peak_shaving"
}

// Before/After comparison
interface BeforeAfter {
  before: { selfCons: number; peakKw: number; gridImport: number; };
  after:  { selfCons: number; peakKw: number; gridImport: number; };
}
```

#### P4: HEMS Control

```typescript
// MODE_DISTRIBUTION — Devices per optimization mode
interface ModeDistribution {
  self_consumption: number;        // 22 devices
  peak_valley_arbitrage: number;   // 18 devices
  peak_shaving: number;            // 7 devices
}

// TARIFA_RATES — Tarifa branca rates
interface TarifaRates {
  disco: string;             // "CEMIG"
  peak: number;              // R$ 0.89/kWh
  intermediate: number;      // R$ 0.62/kWh
  offPeak: number;           // R$ 0.41/kWh
  effectiveDate: string;     // "DD/MM/YYYY"
  peakHours: string;         // "17:00-20:00"
  intermediateHours: string; // "16:00-17:00, 20:00-21:00"
}

// LAST_DISPATCH — Last batch dispatch result
interface LastDispatch {
  timestamp: string;
  fromMode: string;
  toMode: string;
  affectedDevices: number;
  successRate: number;  // %
  ackList: DispatchAck[];
}

interface DispatchAck {
  deviceId: string;
  mode: string;
  status: "ack" | "pending" | "timeout";
  responseTime: string;
}
```

#### P5: VPP & DR

```typescript
// VPP_CAPACITY — Aggregated VPP capacity
interface VppCapacity {
  totalCapacityKwh: number;     // 156
  availableKwh: number;         // 112.3
  aggregateSoc: number;         // 72 (%)
  maxDischargeKw: number;       // 45
  maxChargeKw: number;          // 38
  dispatchableDevices: number;  // 41
}

// LATENCY_TIERS — Dispatch latency distribution
interface LatencyTier {
  tier: string;        // "1s", "5s", "15s", "30s", "1min", "15min", "1h"
  successRate: number; // % cumulative
}

// DR_EVENTS — DR event history
interface DrEvent {
  id: string;           // "EVT-001"
  type: string;         // "Discharge" | "Charge" | "Curtailment"
  triggeredAt: string;  // datetime
  targetKw: number;
  achievedKw: number;
  accuracy: number;     // %
  participated: number; // device count
  failed: number;       // device count
}
```

#### P6: Performance

```typescript
// SCORECARD — 12 pilot acceptance metrics in 3 categories
interface ScorecardMetric {
  name: string;
  value: number;
  unit: string;    // "min", "%", "hrs", "days", "count"
  target: string;  // "< 120 min", "> 90%", etc.
  status: "pass" | "near" | "warn";
}

interface Scorecard {
  hardware: ScorecardMetric[];     // 4 metrics
  optimization: ScorecardMetric[]; // 4 metrics
  operations: ScorecardMetric[];   // 4 metrics
}

// SAVINGS_BY_HOME — Per-home savings breakdown
interface HomeSavings {
  home: string;    // "Casa Silva"
  total: number;   // R$ 145.00
  alpha: number;   // 74.2 (%)
  sc: number;      // R$ 85 (self-consumption contribution)
  tou: number;     // R$ 40 (time-of-use)
  ps: number;      // R$ 20 (peak-shaving)
}
```

---

## 3. Gap Analysis: Frontend Needs vs Backend Provides

### 3.1 Gap Matrix

| # | Frontend Need | Needed Endpoint | Backend Status | Gap Type |
|---|--------------|-----------------|----------------|----------|
| G1 | P1 Fleet KPIs (totalDevices, onlineCount, onlineRate, totalHomes, totalIntegradores) | `GET /api/fleet/overview` | **Missing** — `GET /dashboard` returns asset-level KPIs, not fleet-level | Missing endpoint |
| G2 | P1 Device type distribution (4 types × online/offline) | `GET /api/fleet/device-types` | **Missing** — DB has `assets` but no device type taxonomy | Missing endpoint + missing DB column |
| G3 | P1 Integrador list (orgId, name, deviceCount, onlineRate) | `GET /api/fleet/integradores` | **Partial** — `organizations` table exists but no aggregation endpoint | Missing endpoint |
| G4 | P1 Offline events (deviceId, start, duration, cause, backfill) | `GET /api/fleet/offline-events` | **Missing** — No offline event tracking table | Missing endpoint + missing DB table |
| G5 | P1 Uptime trend (28 days × uptime %) | `GET /api/fleet/uptime-trend` | **Missing** — No daily uptime aggregation | Missing endpoint + missing DB table |
| G6 | P2 Device list (47 devices with telemetry, brand, model, homeId) | `GET /api/devices` | **Partial** — `GET /assets` returns assets (4) but not individual devices; no brand/model/homeId | Payload mismatch + model mismatch |
| G7 | P2 Home list | `GET /api/homes` | **Missing** — No homes table (frontend uses "HOME-001"...) | Missing endpoint + missing DB table |
| G8 | P2 Unassigned devices + commissioning | `GET /api/devices/unassigned`, `POST /api/devices/commission` | **Missing** — No commissioning workflow | Missing endpoint + missing DB table |
| G9 | P3 24hr energy time-series per home (pv, load, battery, grid, soc) | `GET /api/homes/:id/energy` | **Partial** — `telemetry_history` has asset-level data but no per-home aggregation; 96 × 15min intervals needed | Missing endpoint; data exists in telemetry_history |
| G10 | P3 Baseline & savings calculation | `GET /api/homes/:id/energy` (savings field) | **Missing** — No baseline comparison logic | Missing computation |
| G11 | P3 AC/EV per-device curves | `GET /api/homes/:id/energy` (acPower, evCharge fields) | **Missing** — DB has no AC/EV device type data | Missing DB columns |
| G12 | P3 Cross-home summary (selfCons, gridExport, gridImport, peakLoad, mode) | `GET /api/homes/summary` | **Missing** — No cross-home aggregation | Missing endpoint |
| G13 | P4 Mode distribution (devices per optimization mode) | `GET /api/hems/mode-distribution` | **Partial** — `vpp_strategies.target_mode` exists; can COUNT assets by strategy | Missing endpoint |
| G14 | P4 Tarifa branca rates (disco, peak, intermediate, offPeak, dates) | `GET /api/tariffs/current` | **Partial** — `tariff_schedules` has peak/offpeak rates but not intermediate rate; no disco field | Payload mismatch |
| G15 | P4 Batch dispatch + ACK status | `POST /api/hems/dispatch`, `GET /api/hems/dispatch-status` | **Partial** — `POST /dispatch` exists but for individual assets; `dispatch_commands` has ACK-like status | Endpoint exists but different model |
| G16 | P5 VPP aggregate capacity (total kWh, available, SoC, max discharge/charge) | `GET /api/vpp/capacity` | **Partial** — Can compute from `assets` + `device_state` (SUM capacity_kwh, AVG battery_soc, etc.) | Missing endpoint; data derivable |
| G17 | P5 Dispatch latency tiers | `GET /api/vpp/latency` | **Partial** — `dispatch_records.response_latency_ms` exists; needs histogram aggregation | Missing endpoint; data exists |
| G18 | P5 DR event history | `GET /api/vpp/dr-events` | **Partial** — `dispatch_records` has per-asset records; needs event-level grouping | Missing endpoint; data partially exists |
| G19 | P6 Scorecard (12 metrics across 3 categories) | `GET /api/performance/scorecard` | **Partial** — Some metrics derivable (uptime from device_state, dispatch accuracy from dispatch_commands) | Missing endpoint; partial data |
| G20 | P6 Savings by home (total, alpha, sc/tou/ps breakdown) | `GET /api/performance/savings` | **Partial** — `revenue_daily` has savings data but no per-home breakdown | Missing endpoint; partial data |

### 3.2 Gap Classification Summary

| Gap Type | Count | Description |
|----------|-------|-------------|
| **Missing endpoint entirely** | 12 | No BFF handler exists (G1-G5, G7-G8, G12, G13, G16-G18) |
| **Payload format mismatch** | 3 | Endpoint exists but returns different shape (G6, G14, G15) |
| **Missing DB table/column** | 5 | Data doesn't exist in any DB table (G4, G5, G7, G8, G11) |
| **Data derivable, no endpoint** | 4 | Data can be computed from existing tables (G16, G17, G19, G20) |
| **Missing computation logic** | 2 | Requires server-side calculation (G9, G10) |

### 3.3 Hardcoded Endpoint Inventory

The following existing BFF endpoints still contain hardcoded values that should be replaced with DB queries:

| Endpoint | Hardcoded Field | Current Value | Source for DB-backed replacement |
|----------|----------------|---------------|--------------------------------|
| `GET /dashboard` | `monthlyRevenueReais` | `0` | `SUM(revenue_daily.revenue_reais) WHERE date >= date_trunc('month', CURRENT_DATE)` |
| `GET /dashboard` | `selfConsumption.delta` | `"0.0"` | Compare today's vs yesterday's `algorithm_metrics.self_consumption_pct` |
| `GET /dashboard` | `systemHealthBlock` | `"OPTIMAL"` | Derive from online rate: >95% OPTIMAL, >85% DEGRADED, else CRITICAL |
| `GET /dashboard` | `vppDispatchAccuracy` | `97.5` | `AVG(accuracy) FROM dispatch_records WHERE dispatched_at >= CURRENT_DATE - 7` |
| `GET /dashboard` | `drResponseLatency` | `1.8` | `AVG(response_latency_ms)/1000 FROM dispatch_records WHERE dispatched_at >= CURRENT_DATE - 7` |
| `GET /dashboard` | `gatewayUptime` | `99.9` | No source — needs uptime tracking table or compute from device_state history |

---

## 4. API Contract Table (Complete v5.12)

### 4.1 Existing Endpoints (Unchanged from v5.10)

| Method | Path | Handler | Pool | Status |
|--------|------|---------|------|--------|
| `GET` | `/dashboard` | get-dashboard.ts | App Pool via queryWithOrg | **DB-backed** (v5.10) |
| `GET` | `/assets` | get-assets.ts | App Pool via queryWithOrg | **DB-backed** (v5.9) |
| `GET` | `/trades` | get-trades.ts | App Pool via queryWithOrg | **DB-backed** (v5.5) |
| `GET` | `/revenue-trend` | get-revenue-trend.ts | App Pool via queryWithOrg | **DB-backed** (v5.5) |

### 4.2 New Endpoints (v5.12)

All new endpoints follow the same pattern:
- Authentication: `extractTenantContext(req)` from `../middleware/auth.ts`
- Authorization: `requireRole(ctx, [SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR, ORG_VIEWER])`
- Pool: `getAppPool()` via `queryWithOrg(pool, orgId, sql, params)`
- Response envelope: `{ success: true, data: {...}, error: null }`
- Error envelope: `{ success: false, data: null, error: "message" }`
- Tenant scope: RLS enforced via `SET LOCAL app.current_org_id`

---

#### EP-1: `GET /api/fleet/overview`

**Purpose**: P1 Fleet Overview — aggregate fleet KPIs

**Request**:
```
GET /api/fleet/overview
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface FleetOverviewResponse {
  success: true;
  data: {
    totalDevices: number;
    onlineCount: number;
    offlineCount: number;
    onlineRate: number;        // percentage, 1 decimal
    totalHomes: number;
    totalIntegradores: number;
    deviceTypes: {
      type: string;
      count: number;
      online: number;
      color: string;
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
-- Fleet aggregate KPIs
SELECT
  COUNT(*) AS total_devices,
  COUNT(*) FILTER (WHERE ds.is_online = true) AS online_count,
  COUNT(*) FILTER (WHERE ds.is_online = false OR ds.is_online IS NULL) AS offline_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE ds.is_online = true) / NULLIF(COUNT(*), 0), 1
  ) AS online_rate
FROM assets a
LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
WHERE a.is_active = true;

-- Home count (distinct homeId from assets — requires homes table or asset grouping)
-- v5.12: Use COUNT(DISTINCT home_id) FROM assets if home_id column added,
-- otherwise derive from org-based grouping

-- Integrador count
SELECT COUNT(*) FROM organizations;
```

**Design Note (v5.12-fix)**: The frontend model has "devices" (47 per 3 homes) — these are ALL modeled as rows in the `assets` table with an `asset_type` column. The existing 4 battery+inverter assets become `asset_type = 'INVERTER_BATTERY'`; the remaining 43 devices (smart meters, ACs, EV chargers, solar panels) are additional rows in `assets`. This unified model means ALL existing M1–M4 logic (dispatch, telemetry, scheduling, billing) works WITHOUT changes — they already use `asset_id`. The `device_types` breakdown uses `COUNT(*) ... GROUP BY asset_type` on the `assets` table.

---

#### EP-2: `GET /api/fleet/integradores`

**Purpose**: P1 Fleet Overview — integrador (organization) list with device stats

**Request**:
```
GET /api/fleet/integradores
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface IntegradoresResponse {
  success: true;
  data: {
    integradores: {
      orgId: string;
      name: string;
      deviceCount: number;
      onlineRate: number;
      lastCommission: string | null; // ISO date
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
SELECT
  o.org_id,
  o.name,
  COUNT(a.asset_id) AS device_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE ds.is_online = true) / NULLIF(COUNT(a.asset_id), 0), 1
  ) AS online_rate,
  MAX(a.created_at) AS last_commission
FROM organizations o
LEFT JOIN assets a ON o.org_id = a.org_id AND a.is_active = true
LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
GROUP BY o.org_id, o.name
ORDER BY o.name;
```

**Min Role**: `SOLFACIL_ADMIN` (admin-only view; integrador sees only own org)

---

#### EP-3: `GET /api/fleet/offline-events`

**Purpose**: P1 Fleet Overview — recent offline events with duration and cause

**Request**:
```
GET /api/fleet/offline-events?limit=20
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface OfflineEventsResponse {
  success: true;
  data: {
    events: {
      deviceId: string;      // asset_id
      start: string;         // ISO datetime
      durationHrs: number;
      cause: string;         // "firmware_update" | "network" | "hardware" | "unknown"
      backfill: boolean;
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**DB Requirement**: **New table needed** — `offline_events`. See §6.1.

**SQL Logic** (after table creation):
```sql
SELECT
  oe.asset_id AS device_id,
  oe.started_at AS start,
  EXTRACT(EPOCH FROM (COALESCE(oe.ended_at, NOW()) - oe.started_at)) / 3600.0 AS duration_hrs,
  oe.cause,
  oe.backfill
FROM offline_events oe
JOIN assets a ON oe.asset_id = a.asset_id
WHERE a.is_active = true
ORDER BY oe.started_at DESC
LIMIT $1;
```

---

#### EP-4: `GET /api/fleet/uptime-trend`

**Purpose**: P1 Fleet Overview — 28-day daily uptime percentage

**Request**:
```
GET /api/fleet/uptime-trend?days=28
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface UptimeTrendResponse {
  success: true;
  data: {
    trend: {
      date: string;    // "DD/MM" format
      uptime: number;  // percentage
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**DB Requirement**: **New table needed** — `daily_uptime_snapshots`. See §6.2.

**SQL Logic** (after table creation):
```sql
SELECT
  TO_CHAR(date, 'DD/MM') AS date,
  uptime_pct AS uptime
FROM daily_uptime_snapshots
WHERE date >= CURRENT_DATE - $1::INT
ORDER BY date ASC;
```

**Alternative (no new table)**: Compute from `telemetry_history` — count distinct 15-min intervals with data per asset per day, divide by expected 96 intervals. Heavy query but avoids new table.

---

#### EP-5: `GET /api/devices`

**Purpose**: P2 Device Management — full device list with telemetry

**Request**:
```
GET /api/devices?type=all&status=all&search=
Authorization: Bearer <token>
```

**Query Params**:
- `type` (optional): `"Inverter + Battery"` | `"Smart Meter"` | `"AC"` | `"EV Charger"` | `"all"`
- `status` (optional): `"online"` | `"offline"` | `"all"`
- `search` (optional): partial match on deviceId or homeName

**Response Type**:
```typescript
interface DevicesResponse {
  success: true;
  data: {
    devices: {
      deviceId: string;
      type: string;
      brand: string;
      model: string;
      homeId: string;
      homeName: string;
      orgId: string;
      orgName: string;
      status: "online" | "offline";
      lastSeen: string;       // ISO datetime
      commissionDate: string;  // ISO date
      telemetry: Record<string, number | boolean>;
    }[];
    total: number;
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**Design Decision (v5.12-fix)**: All "devices" ARE "assets". The `assets` table is extended with `asset_type`, `home_id`, `brand`, `model`, `serial_number`, and `commissioned_at` columns (see §6.3). The 47 frontend "devices" are 47 rows in `assets`. This avoids a split-brain domain model — ALL existing M1–M4 logic (dispatch, telemetry, scheduling, billing) continues to use `asset_id` without any mapping layer.

**SQL Logic** (unified assets model):
```sql
SELECT
  a.asset_id AS device_id,
  a.asset_type AS type,
  a.brand,
  a.model,
  a.home_id,
  h.name AS home_name,
  a.org_id,
  o.name AS org_name,
  CASE WHEN ds.is_online THEN 'online' ELSE 'offline' END AS status,
  ds.updated_at AS last_seen,
  a.commissioned_at AS commission_date,
  ds.telemetry_json AS telemetry
FROM assets a
JOIN homes h ON a.home_id = h.home_id
JOIN organizations o ON a.org_id = o.org_id
LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
WHERE a.is_active = true
  AND ($1 = 'all' OR a.asset_type = $1)
  AND ($2 = 'all' OR (CASE WHEN ds.is_online THEN 'online' ELSE 'offline' END) = $2)
  AND ($3 = '' OR a.asset_id ILIKE '%' || $3 || '%' OR h.name ILIKE '%' || $3 || '%')
ORDER BY a.asset_id;
```

---

#### EP-6: `GET /api/homes`

**Purpose**: P2/P3 — Home list

**Request**:
```
GET /api/homes
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface HomesResponse {
  success: true;
  data: {
    homes: {
      id: string;
      name: string;
      orgId: string;
      orgName: string;
      deviceCount: number;
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**DB Requirement**: **New table needed** — `homes`. See §6.4.

---

#### EP-7: `GET /api/homes/:homeId/energy`

**Purpose**: P3 Energy Behavior — 24hr time-series for a specific home

**Request**:
```
GET /api/homes/:homeId/energy?date=2026-03-05
Authorization: Bearer <token>
```

**Query Params**:
- `date` (optional): ISO date, defaults to today

**Response Type**:
```typescript
interface HomeEnergyResponse {
  success: true;
  data: {
    homeId: string;
    date: string;
    timeLabels: string[];  // 96 values: ["00:00", "00:15", ..., "23:45"]
    pv: number[];          // 96 values, kW
    load: number[];        // 96 values, kW
    battery: number[];     // 96 values, kW (+charge/-discharge)
    grid: number[];        // 96 values, kW (+import/-export)
    soc: number[];         // 96 values, %
    acPower: number[];     // 96 values, kW
    evCharge: number[];    // 96 values, kW
    baseline: number[];    // 96 values, kW (no-PV/battery scenario)
    savings: number;       // R$ daily savings
    beforeAfter: {
      before: { selfCons: number; peakKw: number; gridImport: number };
      after:  { selfCons: number; peakKw: number; gridImport: number };
    };
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
-- REQUIRED INDEX (Defect 3 fix — avoid CPU spike on high-frequency telemetry table):
-- CREATE INDEX idx_telemetry_asset_time ON telemetry_history(asset_id, recorded_at DESC);
--
-- Fetch 15-min interval data for all assets in a home for a given date
SELECT
  date_trunc('minute', th.recorded_at)
    - (EXTRACT(MINUTE FROM th.recorded_at)::INT % 15) * INTERVAL '1 minute' AS time_bucket,
  SUM(th.pv_power) AS pv,
  SUM(th.load_power) AS load,
  SUM(th.battery_power) AS battery,
  SUM(th.grid_power_kw) AS grid,
  AVG(th.battery_soc) AS soc
FROM telemetry_history th
JOIN assets a ON th.asset_id = a.asset_id
WHERE a.home_id = $1
  AND a.is_active = true
  AND th.recorded_at >= $2::DATE
  AND th.recorded_at < $2::DATE + INTERVAL '1 day'
GROUP BY time_bucket
ORDER BY time_bucket;

-- For date ranges > 1 day, use pre-aggregated asset_hourly_metrics instead:
-- SELECT ... FROM asset_hourly_metrics WHERE asset_id IN (SELECT asset_id FROM assets WHERE home_id = $1)
-- This avoids scanning raw telemetry_history for multi-day views.
```

**Performance Note (Defect 3 fix)**: `telemetry_history` receives high-frequency writes (~1 row per 5 seconds per asset = 17,000+ rows/day per household). The composite index `idx_telemetry_asset_time ON telemetry_history(asset_id, recorded_at DESC)` is **mandatory** before deploying EP-7. For time ranges longer than 1 day, the handler SHOULD read from `asset_hourly_metrics` (pre-aggregated by M1 telemetry-aggregator) instead of raw `telemetry_history`.

**Server-side Computation**:
- `baseline[t] = load[t]` (no PV, no battery scenario)
- `savings = Σ((baseline[t] - grid[t]) × tariff_price[t] × 0.25)` using tariff_schedules
- `beforeAfter` computed from aggregated daily totals
- `acPower` and `evCharge` require `asset_type` filtering: `WHERE a.asset_type = 'HVAC'` / `'EV_CHARGER'`

---

#### EP-8: `GET /api/homes/summary`

**Purpose**: P3 Energy Behavior — cross-home comparison table

**Request**:
```
GET /api/homes/summary?date=2026-03-05
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface HomesSummaryResponse {
  success: true;
  data: {
    homes: {
      homeId: string;
      name: string;
      selfCons: number;     // %
      gridExport: number;   // kWh
      gridImport: number;   // kWh
      peakLoad: number;     // kW
      mode: string;
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**: Aggregate `telemetry_history` per home, compute self-consumption ratio, grid import/export totals, and peak load. Mode from `vpp_strategies.target_mode` linked via home's primary asset.

---

#### EP-9: `GET /api/hems/overview`

**Purpose**: P4 HEMS Control — mode distribution + tarifa rates + last dispatch

**Request**:
```
GET /api/hems/overview
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface HemsOverviewResponse {
  success: true;
  data: {
    modeDistribution: {
      self_consumption: number;
      peak_valley_arbitrage: number;
      peak_shaving: number;
    };
    tarifaRates: {
      disco: string;
      peak: number;
      intermediate: number;
      offPeak: number;
      effectiveDate: string;
      peakHours: string;
      intermediateHours: string;
    };
    lastDispatch: {
      timestamp: string;
      fromMode: string;
      toMode: string;
      affectedDevices: number;
      successRate: number;
      ackList: {
        deviceId: string;
        mode: string;
        status: "ack" | "pending" | "timeout";
        responseTime: string;
      }[];
    } | null;
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
-- Mode distribution: COUNT assets grouped by strategy target_mode
SELECT
  vs.target_mode,
  COUNT(a.asset_id) AS device_count
FROM assets a
JOIN vpp_strategies vs ON a.org_id = vs.org_id AND vs.is_active = true
WHERE a.is_active = true
GROUP BY vs.target_mode;

-- Tarifa rates: latest tariff_schedule for org
SELECT
  schedule_name AS disco,
  peak_rate AS peak,
  offpeak_rate AS off_peak,
  feed_in_rate AS feed_in,
  effective_from AS effective_date
FROM tariff_schedules
WHERE org_id = $1
ORDER BY effective_from DESC
LIMIT 1;

-- Note: tariff_schedules lacks intermediate rate and peak/intermediate hour ranges.
-- v5.12 DDL update needed to add intermediate_rate, peak_hours, intermediate_hours columns.

-- Last dispatch: most recent batch from dispatch_commands
SELECT
  dc.dispatched_at AS timestamp,
  dc.action AS to_mode,
  dc.status,
  dc.asset_id AS device_id,
  dc.completed_at,
  EXTRACT(EPOCH FROM (dc.completed_at - dc.dispatched_at)) AS response_seconds
FROM dispatch_commands dc
WHERE dc.org_id = $1
ORDER BY dc.dispatched_at DESC
LIMIT 20;
```

**Design Note**: `tariff_schedules` currently has `peak_rate` and `offpeak_rate` but not `intermediate_rate`. The frontend's tarifa branca model requires three tiers. See §6.5 for DDL update.

---

#### EP-10: `POST /api/hems/dispatch`

**Purpose**: P4 HEMS Control — batch mode dispatch

**Request**:
```
POST /api/hems/dispatch
Authorization: Bearer <token>
Content-Type: application/json

{
  "targetMode": "self_consumption",
  "filters": {
    "orgId": "org-001" | null,
    "homeId": "HOME-001" | null,
    "deviceType": "Inverter + Battery" | null,
    "currentMode": "peak_valley_arbitrage" | null
  }
}
```

**Response Type**:
```typescript
interface DispatchResponse {
  success: true;
  data: {
    affectedDevices: number;
    targetMode: string;
    dispatchId: string;
  };
  error: null;
}
```

**Min Role**: `ORG_OPERATOR`

**Logic**: Filter `assets` matching criteria (using `asset_type`, `home_id`, `org_id` columns) → create `dispatch_commands` batch → return dispatch ID for status polling. All filters use the unified `assets` table — no separate `devices` table needed.

---

#### EP-11: `GET /api/vpp/capacity`

**Purpose**: P5 VPP & DR — aggregated VPP capacity KPIs

**Request**:
```
GET /api/vpp/capacity
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface VppCapacityResponse {
  success: true;
  data: {
    totalCapacityKwh: number;
    availableKwh: number;
    aggregateSoc: number;       // %
    maxDischargeKw: number;
    maxChargeKw: number;
    dispatchableDevices: number;
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
SELECT
  SUM(a.capacity_kwh) AS total_capacity_kwh,
  SUM(a.capacity_kwh * ds.battery_soc / 100.0) AS available_kwh,
  ROUND(AVG(ds.battery_soc), 1) AS aggregate_soc,
  SUM(a.capacidade_kw) AS max_discharge_kw,
  SUM(COALESCE(vs.max_charge_rate_kw, a.capacidade_kw * 0.8)) AS max_charge_kw,
  COUNT(*) FILTER (WHERE ds.is_online = true) AS dispatchable_devices
FROM assets a
LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
LEFT JOIN vpp_strategies vs ON a.org_id = vs.org_id AND vs.is_active = true AND vs.is_default = true
WHERE a.is_active = true;
```

---

#### EP-12: `GET /api/vpp/latency`

**Purpose**: P5 VPP & DR — dispatch latency distribution

**Request**:
```
GET /api/vpp/latency?days=30
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface VppLatencyResponse {
  success: true;
  data: {
    tiers: {
      tier: string;        // "1s", "5s", "15s", "30s", "1min", "15min", "1h"
      successRate: number; // cumulative %
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
WITH latency_data AS (
  SELECT response_latency_ms
  FROM dispatch_records
  WHERE dispatched_at >= CURRENT_DATE - $1::INT
    AND response_latency_ms IS NOT NULL
),
total AS (SELECT COUNT(*) AS cnt FROM latency_data)
SELECT
  tier,
  ROUND(100.0 * COUNT(ld.response_latency_ms) / NULLIF(t.cnt, 0), 1) AS success_rate
FROM (VALUES
  ('1s', 1000), ('5s', 5000), ('15s', 15000), ('30s', 30000),
  ('1min', 60000), ('15min', 900000), ('1h', 3600000)
) AS tiers(tier, threshold_ms)
CROSS JOIN total t
LEFT JOIN latency_data ld ON ld.response_latency_ms <= tiers.threshold_ms
GROUP BY tier, tiers.threshold_ms, t.cnt
ORDER BY tiers.threshold_ms;
```

---

#### EP-13: `GET /api/vpp/dr-events`

**Purpose**: P5 VPP & DR — DR event history

**Request**:
```
GET /api/vpp/dr-events?limit=20
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface DrEventsResponse {
  success: true;
  data: {
    events: {
      id: string;
      type: string;         // "Discharge" | "Charge" | "Curtailment"
      triggeredAt: string;  // ISO datetime
      targetKw: number;
      achievedKw: number;
      accuracy: number;     // %
      participated: number;
      failed: number;
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
-- Group dispatch_records by dispatch batch (time window)
-- Each "event" = a batch of dispatches within a 5-minute window
SELECT
  MIN(dr.id)::TEXT AS id,
  CASE
    WHEN AVG(dr.commanded_power_kw) > 0 THEN 'Discharge'
    WHEN AVG(dr.commanded_power_kw) < 0 THEN 'Charge'
    ELSE 'Curtailment'
  END AS type,
  MIN(dr.dispatched_at) AS triggered_at,
  ABS(SUM(dr.commanded_power_kw)) AS target_kw,
  ABS(SUM(dr.actual_power_kw)) AS achieved_kw,
  ROUND(100.0 * ABS(SUM(dr.actual_power_kw)) / NULLIF(ABS(SUM(dr.commanded_power_kw)), 0), 1) AS accuracy,
  COUNT(*) FILTER (WHERE dr.success = true) AS participated,
  COUNT(*) FILTER (WHERE dr.success = false) AS failed
FROM dispatch_records dr
GROUP BY date_trunc('hour', dr.dispatched_at)  -- group by hour as proxy for event
ORDER BY triggered_at DESC
LIMIT $1;
```

---

#### EP-14: `GET /api/performance/scorecard`

**Purpose**: P6 Performance — pilot acceptance scorecard

**Request**:
```
GET /api/performance/scorecard
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface ScorecardResponse {
  success: true;
  data: {
    hardware: ScorecardMetric[];     // 4 metrics
    optimization: ScorecardMetric[]; // 4 metrics
    operations: ScorecardMetric[];   // 4 metrics
    _tenant: { orgId: string; role: string };
  };
  error: null;
}

interface ScorecardMetric {
  name: string;
  value: number;
  unit: string;
  target: string;
  status: "pass" | "near" | "warn";
}
```

**Computation Logic** (server-side, mixed DB + derived):

| Metric | Source | SQL / Computation |
|--------|--------|-------------------|
| Commissioning Time | Average time from `assets.commissioned_at` to first `telemetry_history` record | `AVG(first_telemetry - commissioned_at)` |
| Offline Resilience | Max offline duration from `offline_events` | `MAX(duration)` |
| Uptime (4 weeks) | From `daily_uptime_snapshots` | `AVG(uptime_pct) WHERE date >= CURRENT_DATE - 28` |
| First Telemetry | Average time from commission to first data | Same as commissioning time |
| Savings Alpha | `revenue_daily.vpp_arbitrage_profit_reais / revenue_daily.revenue_reais * 100` | Aggregated over period |
| Self-Consumption | `algorithm_metrics.self_consumption_pct` | Latest value |
| PV Forecast MAPE | Not in DB — needs forecast vs actual comparison | **Hardcoded for v5.12** |
| Load Forecast Adapt | Not in DB — needs learning curve data | **Hardcoded for v5.12** |
| Dispatch Accuracy | `dispatch_records` success rate | `COUNT(success=true) / COUNT(*)` |
| Training Time | Not in DB — operational metric | **Hardcoded for v5.12** |
| Manual Interventions | Not in DB — operational metric | **Hardcoded for v5.12** |
| App Uptime | Not in DB — infrastructure metric | **Hardcoded for v5.12** |

**Design Note**: 4 of 12 metrics cannot be derived from existing DB tables and will remain hardcoded in v5.12. These should be tracked in a future `operational_metrics` table.

---

#### EP-15: `GET /api/performance/savings`

**Purpose**: P6 Performance — savings breakdown by home

**Request**:
```
GET /api/performance/savings?period=month
Authorization: Bearer <token>
```

**Response Type**:
```typescript
interface SavingsResponse {
  success: true;
  data: {
    homes: {
      home: string;
      total: number;     // R$
      alpha: number;     // %
      sc: number;        // R$ self-consumption contribution
      tou: number;       // R$ time-of-use contribution
      ps: number;        // R$ peak-shaving contribution
    }[];
    _tenant: { orgId: string; role: string };
  };
  error: null;
}
```

**SQL Logic**:
```sql
SELECT
  h.name AS home,
  SUM(rd.client_savings_reais) AS total,
  ROUND(AVG(rd.actual_self_consumption_pct), 1) AS alpha,
  -- Breakdown approximation:
  SUM(rd.client_savings_reais * 0.55) AS sc,   -- ~55% from self-consumption
  SUM(rd.client_savings_reais * 0.30) AS tou,  -- ~30% from TOU arbitrage
  SUM(rd.client_savings_reais * 0.15) AS ps    -- ~15% from peak shaving
FROM revenue_daily rd
JOIN assets a ON rd.asset_id = a.asset_id
JOIN homes h ON a.home_id = h.home_id
WHERE rd.date >= date_trunc('month', CURRENT_DATE)
  AND a.is_active = true
GROUP BY h.home_id, h.name
ORDER BY total DESC;
```

**Design Note**: The savings breakdown (sc/tou/ps) is approximated using fixed ratios. For precise breakdown, `revenue_daily` would need separate columns for each savings component.

---

### 4.3 Existing Endpoint Hardcoded Cleanup (v5.12)

#### `GET /dashboard` — De-hardcode remaining fields

```typescript
// v5.12: Replace hardcoded values in get-dashboard.ts

// 1. monthlyRevenueReais: was 0
const monthlyResult = await queryWithOrg(pool, orgId, `
  SELECT COALESCE(SUM(revenue_reais), 0) AS monthly_revenue
  FROM revenue_daily
  WHERE date >= date_trunc('month', CURRENT_DATE)
`);
const monthlyRevenueReais = Number(monthlyResult.rows[0]?.monthly_revenue ?? 0);

// 2. selfConsumption.delta: was "0.0"
const deltaResult = await queryWithOrg(pool, orgId, `
  SELECT
    (SELECT self_consumption_pct FROM algorithm_metrics
     WHERE date = CURRENT_DATE ORDER BY id DESC LIMIT 1) -
    (SELECT self_consumption_pct FROM algorithm_metrics
     WHERE date = CURRENT_DATE - 1 ORDER BY id DESC LIMIT 1) AS delta
`);
const selfConsumptionDelta = (deltaResult.rows[0]?.delta ?? 0).toFixed(1);

// 3. systemHealthBlock: was "OPTIMAL"
// Derive from online rate
const onlineRate = Number(assetResult.rows[0]?.online_rate ?? 0);
const systemHealthBlock = onlineRate >= 95 ? 'OPTIMAL' : onlineRate >= 85 ? 'DEGRADED' : 'CRITICAL';

// 4. vppDispatchAccuracy: was 97.5
const accuracyResult = await queryWithOrg(pool, orgId, `
  SELECT ROUND(
    100.0 * COUNT(*) FILTER (WHERE success = true) / NULLIF(COUNT(*), 0), 1
  ) AS accuracy
  FROM dispatch_records
  WHERE dispatched_at >= CURRENT_DATE - 7
`);
const vppDispatchAccuracy = Number(accuracyResult.rows[0]?.accuracy ?? 0);

// 5. drResponseLatency: was 1.8
const latencyResult = await queryWithOrg(pool, orgId, `
  SELECT ROUND(AVG(response_latency_ms) / 1000.0, 1) AS avg_latency_s
  FROM dispatch_records
  WHERE dispatched_at >= CURRENT_DATE - 7
    AND response_latency_ms IS NOT NULL
`);
const drResponseLatency = Number(latencyResult.rows[0]?.avg_latency_s ?? 0);

// 6. gatewayUptime: was 99.9
// Requires daily_uptime_snapshots table or keep hardcoded
const gatewayUptime = 99.9; // TODO: derive from daily_uptime_snapshots when available
```

---

## 5. Frontend Progressive Integration Strategy

### 5.1 Architecture: Dual-Source Adapter Pattern

The frontend should be able to switch between mock data and live API on a per-page basis. This enables incremental migration without breaking the demo flow.

**Implementation Pattern**:

```javascript
// frontend-v2/js/data-source.js (NEW FILE)

/**
 * Dual-source adapter: mock ↔ live API toggle per page.
 *
 * Configuration object controls which pages use live API.
 * All pages default to mock data (backward compatible).
 */
const DATA_SOURCE_CONFIG = {
  // Toggle per page: true = live API, false = mock data
  fleet:       false,
  devices:     false,
  energy:      false,
  hems:        false,
  vpp:         false,
  performance: false,
};

// API base URL (configurable)
const API_BASE = window.__VPP_API_BASE__ || 'http://localhost:3000/api';

// Auth token (from login or demo mode)
const getAuthToken = () =>
  sessionStorage.getItem('authToken') || 'demo-token';

/**
 * Generic fetch wrapper with error handling.
 * @param {string} path - API path (e.g., "/fleet/overview")
 * @returns {Promise<object>} Parsed response data
 */
async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(`API ${path}: ${json.error}`);
  }
  return json.data;
}

/**
 * Data source factory: returns either mock data or API fetch result.
 *
 * Usage in page JS:
 *   const data = await getDataSource('fleet', 'overview', () => MOCK.FLEET);
 *
 * @param {string} page - Page name (key in DATA_SOURCE_CONFIG)
 * @param {string} endpoint - API sub-path (e.g., "overview", "devices")
 * @param {Function} mockFallback - Function returning mock data
 * @returns {Promise<object>} Data from API or mock
 */
async function getDataSource(page, endpoint, mockFallback) {
  if (!DATA_SOURCE_CONFIG[page]) {
    return mockFallback();
  }
  try {
    return await apiFetch(`/${page}/${endpoint}`);
  } catch (err) {
    console.warn(`[DataSource] API failed for ${page}/${endpoint}, falling back to mock:`, err);
    return mockFallback();
  }
}
```

### 5.2 Per-Page Migration Order

Recommended order based on data availability and complexity:

| Phase | Page | Endpoints | Rationale |
|-------|------|-----------|-----------|
| **Phase A** | P5 VPP & DR | EP-11, EP-12, EP-13 | Data already in DB (dispatch_records, device_state, assets) |
| **Phase B** | P4 HEMS | EP-9, EP-10 | Data mostly in DB (vpp_strategies, tariff_schedules, dispatch_commands) |
| **Phase C** | P1 Fleet | EP-1, EP-2, EP-3, EP-4 | Requires some new tables (offline_events, daily_uptime_snapshots) |
| **Phase D** | P6 Performance | EP-14, EP-15 | Mixed DB + hardcoded metrics |
| **Phase E** | P2 Devices | EP-5, EP-6 | Requires `homes` table + `assets` ALTER (unified model, no separate devices table) |
| **Phase F** | P3 Energy | EP-7, EP-8 | Requires 15-min time-series from telemetry_history + idx_telemetry_asset_time index |

### 5.3 Migration Pattern per Page

For each page, the migration follows this pattern:

1. **Create BFF handler** — new file in `src/bff/handlers/`
2. **Register route** — add to `scripts/local-server.ts`
3. **Create adapter call** in frontend — use `getDataSource()` with mock fallback
4. **Test with mock off** — set `DATA_SOURCE_CONFIG[page] = false`, verify mock still works
5. **Test with mock on** — set `DATA_SOURCE_CONFIG[page] = true`, verify API integration
6. **Gradual cutover** — enable live API per page in demo

---

## 6. New DB Tables Required (v5.12 DDL)

### 6.1 `offline_events` — Device offline event tracking

```sql
CREATE TABLE IF NOT EXISTS offline_events (
  id            SERIAL PRIMARY KEY,
  asset_id      VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
  org_id        VARCHAR(50) NOT NULL REFERENCES organizations(org_id),
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,  -- NULL = still offline
  cause         VARCHAR(50) DEFAULT 'unknown',
  backfill      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offline_events_asset ON offline_events(asset_id, started_at DESC);
ALTER TABLE offline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_offline_events_tenant ON offline_events
  USING (org_id = current_setting('app.current_org_id', true));
```

### 6.2 `daily_uptime_snapshots` — Daily uptime percentage per org

```sql
CREATE TABLE IF NOT EXISTS daily_uptime_snapshots (
  id           SERIAL PRIMARY KEY,
  org_id       VARCHAR(50) NOT NULL REFERENCES organizations(org_id),
  date         DATE NOT NULL,
  total_assets INTEGER NOT NULL,
  online_assets INTEGER NOT NULL,
  uptime_pct   DECIMAL(5,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, date)
);

CREATE INDEX idx_uptime_org_date ON daily_uptime_snapshots(org_id, date DESC);
ALTER TABLE daily_uptime_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_uptime_tenant ON daily_uptime_snapshots
  USING (org_id = current_setting('app.current_org_id', true));
```

### 6.3 `assets` ALTER — Extend for unified device model (Defect 1 fix)

> **Rationale**: ALL "devices" ARE "assets". Instead of creating a separate `devices` table
> (which would cause a split-brain domain model — M1–M4 all use `asset_id`), we extend the
> existing `assets` table. The 47 frontend "devices" become 47 rows in `assets`.

```sql
-- Extend assets table to support all device types and home linkage
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS asset_type       VARCHAR(30) NOT NULL DEFAULT 'INVERTER_BATTERY'
    CHECK (asset_type IN ('INVERTER_BATTERY', 'SMART_METER', 'HVAC', 'EV_CHARGER', 'SOLAR_PANEL')),
  ADD COLUMN IF NOT EXISTS home_id          VARCHAR(50) REFERENCES homes(home_id),
  ADD COLUMN IF NOT EXISTS brand            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS model            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS serial_number    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS commissioned_at  TIMESTAMPTZ;

-- Indexes for new query patterns
CREATE INDEX IF NOT EXISTS idx_assets_home ON assets(home_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

-- Existing RLS on assets table already covers these new columns.
-- No additional RLS policy needed — assets.org_id + existing policy = tenant isolation.
```

**Migration note**: Existing 4 assets get `asset_type = 'INVERTER_BATTERY'` (the DEFAULT). New seed data adds 43 more rows for smart meters, ACs, EV chargers, and solar panels — all as `assets` rows.

### 6.4 `homes` — Residential home registry

```sql
CREATE TABLE IF NOT EXISTS homes (
  home_id     VARCHAR(50) PRIMARY KEY,
  org_id      VARCHAR(50) NOT NULL REFERENCES organizations(org_id),
  name        VARCHAR(200) NOT NULL,
  address     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_homes_org ON homes(org_id);
ALTER TABLE homes ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_homes_tenant ON homes
  USING (org_id = current_setting('app.current_org_id', true));
```

### 6.5 `tariff_schedules` ALTER — Add intermediate rate and hour range columns

```sql
ALTER TABLE tariff_schedules
  ADD COLUMN IF NOT EXISTS intermediate_rate DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS intermediate_start TIME,
  ADD COLUMN IF NOT EXISTS intermediate_end TIME,
  ADD COLUMN IF NOT EXISTS disco VARCHAR(50);

-- Update existing records with typical tarifa branca values
UPDATE tariff_schedules SET
  intermediate_rate = (peak_rate + offpeak_rate) / 2.0,
  intermediate_start = '16:00',
  intermediate_end = '21:00',
  disco = schedule_name
WHERE intermediate_rate IS NULL;
```

### 6.6 `device_state` ALTER — Add JSONB telemetry for device-type-specific data (Defect 1 fix)

> **Rationale**: Since all "devices" are now rows in `assets`, each has a corresponding
> `device_state` row (FK: `device_state.asset_id → assets.asset_id`). The existing
> `device_state` columns cover inverter/battery metrics. For device-type-specific telemetry
> (AC temperature, EV SOC, smart meter power factor), we add a `telemetry_json JSONB` column.

```sql
ALTER TABLE device_state
  ADD COLUMN IF NOT EXISTS telemetry_json JSONB DEFAULT '{}';

-- No new table needed — device_state already has:
--   asset_id (PK/FK), is_online, battery_soc, pv_power, battery_power,
--   grid_power_kw, load_power, inverter_temp, updated_at, etc.
-- The telemetry_json column holds device-type-specific fields:
--   HVAC:       {"on": true, "setTemp": 23, "roomTemp": 25, "powerDraw": 1.2}
--   EV_CHARGER: {"charging": true, "chargeRate": 7.2, "sessionEnergy": 15.3, "evSoc": 65}
--   SMART_METER: {"consumption": 3.2, "voltage": 220, "current": 14.5, "powerFactor": 0.92}
```

---

## 7. Implementation Plan (v5.12 Build Tasks)

### Phase 0: DDL & Seed Updates

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 0.1 | Add `homes` table DDL + RLS | `scripts/ddl_base.sql` | `\d homes` shows correct schema with RLS |
| 0.2 | ALTER `assets` — add `asset_type`, `home_id`, `brand`, `model`, `serial_number`, `commissioned_at` | `scripts/ddl_base.sql` | New columns visible, CHECK constraint on asset_type |
| 0.3 | Add `offline_events` table DDL + RLS | `scripts/ddl_base.sql` | `\d offline_events` shows correct schema with RLS |
| 0.4 | Add `daily_uptime_snapshots` table DDL + RLS | `scripts/ddl_base.sql` | `\d daily_uptime_snapshots` shows correct schema with RLS |
| 0.5 | ALTER `device_state` — add `telemetry_json JSONB` | `scripts/ddl_base.sql` | New column visible |
| 0.6 | ALTER `tariff_schedules` for intermediate rate | `scripts/ddl_base.sql` | New columns visible |
| 0.7 | Add `idx_telemetry_asset_time` index on `telemetry_history` | `scripts/ddl_base.sql` | Index exists (required for EP-7 performance) |
| 0.8 | Create `scripts/seed_v5.12.sql` with homes, assets (47 rows), offline_events, uptime data | `scripts/seed_v5.12.sql` | Seed runs without errors |
| 0.9 | Update seed to populate 3 homes, 47 assets (unified model) matching frontend mock | `scripts/seed_v5.12.sql` | `SELECT COUNT(*) FROM assets WHERE is_active = true` = 47 |

### Phase 1: BFF Handler Implementation (VPP — Phase A)

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 1.1 | Create `get-vpp-capacity.ts` handler (EP-11) | `src/bff/handlers/get-vpp-capacity.ts` | `curl /api/vpp/capacity` returns JSON matching VppCapacityResponse |
| 1.2 | Create `get-vpp-latency.ts` handler (EP-12) | `src/bff/handlers/get-vpp-latency.ts` | `curl /api/vpp/latency` returns 7 tiers |
| 1.3 | Create `get-vpp-dr-events.ts` handler (EP-13) | `src/bff/handlers/get-vpp-dr-events.ts` | `curl /api/vpp/dr-events` returns event list |
| 1.4 | Register 3 VPP routes in local-server | `scripts/local-server.ts` | Routes accessible |

### Phase 2: BFF Handler Implementation (HEMS — Phase B)

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 2.1 | Create `get-hems-overview.ts` handler (EP-9) | `src/bff/handlers/get-hems-overview.ts` | `curl /api/hems/overview` returns modeDistribution + tarifaRates |
| 2.2 | Create `post-hems-dispatch.ts` handler (EP-10) | `src/bff/handlers/post-hems-dispatch.ts` | `curl -X POST /api/hems/dispatch` creates batch |
| 2.3 | Register 2 HEMS routes | `scripts/local-server.ts` | Routes accessible |

### Phase 3: BFF Handler Implementation (Fleet — Phase C)

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 3.1 | Create `get-fleet-overview.ts` handler (EP-1) | `src/bff/handlers/get-fleet-overview.ts` | Returns fleet KPIs |
| 3.2 | Create `get-fleet-integradores.ts` handler (EP-2) | `src/bff/handlers/get-fleet-integradores.ts` | Returns org list with stats |
| 3.3 | Create `get-fleet-offline-events.ts` handler (EP-3) | `src/bff/handlers/get-fleet-offline-events.ts` | Returns offline events |
| 3.4 | Create `get-fleet-uptime-trend.ts` handler (EP-4) | `src/bff/handlers/get-fleet-uptime-trend.ts` | Returns 28-day trend |
| 3.5 | Register 4 Fleet routes | `scripts/local-server.ts` | Routes accessible |

### Phase 4: BFF Handler Implementation (Performance — Phase D)

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 4.1 | Create `get-performance-scorecard.ts` handler (EP-14) | `src/bff/handlers/get-performance-scorecard.ts` | Returns 12 metrics in 3 categories |
| 4.2 | Create `get-performance-savings.ts` handler (EP-15) | `src/bff/handlers/get-performance-savings.ts` | Returns per-home savings |
| 4.3 | Register 2 Performance routes | `scripts/local-server.ts` | Routes accessible |

### Phase 5: BFF Handler Implementation (Assets by Type + Homes — Phase E)

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 5.1 | Create `get-devices.ts` handler (EP-5) — queries `assets` with `asset_type` filter | `src/bff/handlers/get-devices.ts` | Returns 47 assets with telemetry via unified model |
| 5.2 | Create `get-homes.ts` handler (EP-6) | `src/bff/handlers/get-homes.ts` | Returns 3 homes |
| 5.3 | Register 2 Device/Home routes | `scripts/local-server.ts` | Routes accessible |

### Phase 6: BFF Handler Implementation (Energy — Phase F)

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 6.1 | Create `get-home-energy.ts` handler (EP-7) | `src/bff/handlers/get-home-energy.ts` | Returns 96-point time-series |
| 6.2 | Create `get-homes-summary.ts` handler (EP-8) | `src/bff/handlers/get-homes-summary.ts` | Returns cross-home summary |
| 6.3 | Register 2 Energy routes | `scripts/local-server.ts` | Routes accessible |

### Phase 7: Dashboard De-hardcoding

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 7.1 | De-hardcode `monthlyRevenueReais` | `src/bff/handlers/get-dashboard.ts` | Value matches `SUM(revenue_daily)` for current month |
| 7.2 | De-hardcode `selfConsumption.delta` | `src/bff/handlers/get-dashboard.ts` | Value is today vs yesterday difference |
| 7.3 | De-hardcode `systemHealthBlock` | `src/bff/handlers/get-dashboard.ts` | Derives from online rate |
| 7.4 | De-hardcode `vppDispatchAccuracy` | `src/bff/handlers/get-dashboard.ts` | Computed from dispatch_records |
| 7.5 | De-hardcode `drResponseLatency` | `src/bff/handlers/get-dashboard.ts` | Computed from dispatch_records |

### Phase 8: Frontend Adapter Layer

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 8.1 | Create `data-source.js` adapter | `frontend-v2/js/data-source.js` | File loads without errors |
| 8.2 | Wire P5 VPP page to adapter | `frontend-v2/js/p5-vpp.js` | Page works with both mock=true and mock=false |
| 8.3 | Wire P4 HEMS page to adapter | `frontend-v2/js/p4-hems.js` | Page works with both modes |
| 8.4 | Wire remaining pages (P1, P2, P3, P6) | `frontend-v2/js/p1-fleet.js` etc. | All pages work with dual source |

### Phase 9: Test Suite

| # | Task | Target File | Verification |
|---|------|-------------|-------------|
| 9.1 | Unit tests for all new handlers | `src/bff/__tests__/get-fleet-*.test.ts` etc. | All tests pass |
| 9.2 | Integration tests for new routes | `test/integration/bff-v5.12.test.ts` | API contracts verified |
| 9.3 | Verify existing 194 tests still pass | `npm test` | 194/194 + new tests pass |

---

## 8. API Routes (Complete v5.12)

| Method | Path | Handler | Min Role | Status |
|--------|------|---------|----------|--------|
| `GET` | `/dashboard` | get-dashboard.ts | ORG_VIEWER | **v5.12: 5 fields de-hardcoded** |
| `GET` | `/assets` | get-assets.ts | ORG_VIEWER | Unchanged |
| `GET` | `/trades` | get-trades.ts | ORG_VIEWER | Unchanged |
| `GET` | `/revenue-trend` | get-revenue-trend.ts | ORG_VIEWER | Unchanged |
| `GET` | `/api/fleet/overview` | get-fleet-overview.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/fleet/integradores` | get-fleet-integradores.ts | SOLFACIL_ADMIN | **v5.12 NEW** |
| `GET` | `/api/fleet/offline-events` | get-fleet-offline-events.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/fleet/uptime-trend` | get-fleet-uptime-trend.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/devices` | get-devices.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/homes` | get-homes.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/homes/:homeId/energy` | get-home-energy.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/homes/summary` | get-homes-summary.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/hems/overview` | get-hems-overview.ts | ORG_VIEWER | **v5.12 NEW** |
| `POST` | `/api/hems/dispatch` | post-hems-dispatch.ts | ORG_OPERATOR | **v5.12 NEW** |
| `GET` | `/api/vpp/capacity` | get-vpp-capacity.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/vpp/latency` | get-vpp-latency.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/vpp/dr-events` | get-vpp-dr-events.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/performance/scorecard` | get-performance-scorecard.ts | ORG_VIEWER | **v5.12 NEW** |
| `GET` | `/api/performance/savings` | get-performance-savings.ts | ORG_VIEWER | **v5.12 NEW** |

**Total**: 4 existing + 15 new = **19 endpoints**

---

## 9. Lambda Handlers (v5.12 File Tree)

```
src/bff/
├── handlers/
│   ├── get-dashboard.ts              # v5.12: 5 hardcoded fields → DB-backed
│   ├── get-assets.ts                 # Unchanged
│   ├── get-asset-detail.ts           # Unchanged
│   ├── get-trades.ts                 # Unchanged
│   ├── get-revenue-trend.ts          # Unchanged
│   ├── post-dispatch.ts              # Unchanged
│   ├── post-dr-test.ts              # Unchanged
│   ├── get-dispatch-status.ts        # Unchanged
│   ├── get-fleet-overview.ts         # v5.12 NEW (EP-1)
│   ├── get-fleet-integradores.ts     # v5.12 NEW (EP-2)
│   ├── get-fleet-offline-events.ts   # v5.12 NEW (EP-3)
│   ├── get-fleet-uptime-trend.ts     # v5.12 NEW (EP-4)
│   ├── get-devices.ts                # v5.12 NEW (EP-5)
│   ├── get-homes.ts                  # v5.12 NEW (EP-6)
│   ├── get-home-energy.ts            # v5.12 NEW (EP-7)
│   ├── get-homes-summary.ts          # v5.12 NEW (EP-8)
│   ├── get-hems-overview.ts          # v5.12 NEW (EP-9)
│   ├── post-hems-dispatch.ts         # v5.12 NEW (EP-10)
│   ├── get-vpp-capacity.ts           # v5.12 NEW (EP-11)
│   ├── get-vpp-latency.ts            # v5.12 NEW (EP-12)
│   ├── get-vpp-dr-events.ts          # v5.12 NEW (EP-13)
│   ├── get-performance-scorecard.ts  # v5.12 NEW (EP-14)
│   └── get-performance-savings.ts    # v5.12 NEW (EP-15)
├── middleware/
│   ├── auth.ts                       # Unchanged (v5.10)
│   ├── cors.ts
│   └── rate-limit.ts
└── __tests__/
    ├── get-dashboard.test.ts         # v5.12: updated for de-hardcoded fields
    ├── get-assets.test.ts
    ├── post-dispatch.test.ts
    ├── get-fleet-overview.test.ts        # v5.12 NEW
    ├── get-fleet-integradores.test.ts    # v5.12 NEW
    ├── get-fleet-offline-events.test.ts  # v5.12 NEW
    ├── get-fleet-uptime-trend.test.ts    # v5.12 NEW
    ├── get-devices.test.ts               # v5.12 NEW
    ├── get-homes.test.ts                 # v5.12 NEW
    ├── get-home-energy.test.ts           # v5.12 NEW
    ├── get-homes-summary.test.ts         # v5.12 NEW
    ├── get-hems-overview.test.ts         # v5.12 NEW
    ├── post-hems-dispatch.test.ts        # v5.12 NEW
    ├── get-vpp-capacity.test.ts          # v5.12 NEW
    ├── get-vpp-latency.test.ts           # v5.12 NEW
    ├── get-vpp-dr-events.test.ts         # v5.12 NEW
    ├── get-performance-scorecard.test.ts # v5.12 NEW
    └── get-performance-savings.test.ts   # v5.12 NEW
```

---

## 10. 模組依賴關係 (v5.12)

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | `telemetry_history` for energy time-series (EP-7); `device_state` for fleet KPIs (EP-1) |
| **依賴** | M2 (Optimization Engine) | `vpp_strategies` for mode distribution (EP-9) |
| **依賴** | M3 (DR Dispatcher) | `dispatch_records` for latency tiers (EP-12), DR events (EP-13); `dispatch_commands` for ACK status (EP-9) |
| **依賴** | M4 (Market & Billing) | `revenue_daily` for savings (EP-15); `tariff_schedules` for tarifa rates (EP-9) |
| **依賴** | M6 (Identity) | Cognito Authorizer, JWT 驗證 |
| **依賴** | M8 (Admin Control) | `feature_flags` for conditional fields |
| **依賴** | Shared Layer | `queryWithOrg`, `getAppPool()`, `verifyTenantToken` |
| **被依賴** | Frontend Dashboard (frontend-v2) | **v5.12: 15 new endpoints + adapter layer for progressive integration** |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本 |
| v5.3 | 2026-02-27 | HEMS 單戶場景對齊，capacity_kwh |
| v5.5 | 2026-02-28 | BFF 淨化行動：移除 hardcode，改為 SQL 讀取 trade_schedules / revenue_daily / algorithm_metrics |
| v5.9 | 2026-03-02 | De-hardcoding: vpp_strategies JOIN, dashboard KPI from DB |
| v5.10 | 2026-03-05 | HTTP 適配器模式 + dispatch KPI de-hardcoding + API Gap Analysis |
| **v5.12** | **2026-03-05** | **API Contract Alignment & BFF Expansion: (1) 完整前端數據盤點 — 6 頁面、26 mock 數據物件、7 圖表、6 表格; (2) 20 項 Gap Analysis — 12 缺失端點、3 格式不符、5 缺失 DB 表/欄位; (3) 15 個新 BFF 端點設計 + TypeScript 介面 + SQL 查詢; (4) 3 個新 DB 表: homes, offline_events, daily_uptime_snapshots; 2 個 ALTER TABLE: assets (unified device model), device_state (telemetry_json); (5) tariff_schedules ALTER 新增 intermediate rate; (6) GET /dashboard 5 個硬編碼欄位去硬編碼; (7) Frontend Dual-Source Adapter Pattern — 漸進式 mock→API 遷移策略; (8) 9 階段實施計劃; (9) v5.12-fix: 統一 asset/device 域模型、全表 RLS、EP-7 性能索引** |
