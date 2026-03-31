# SOLFACIL VPP — Master Architecture Blueprint

> **Version**: v6.6
> **Git HEAD**: `4ec191a`
> **Last Updated**: 2026-03-31
> **Description**: System master blueprint — complete v6.6 documentation rebuild
> **Core Theme**: v6.6 Visual Unification + P5 Strategy Triggers + HEMS Workbench

---

## Document Index

| # | Document | Path | Description |
|---|----------|------|-------------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v6.6.md` | System master blueprint (this document) |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v6.6.md](./01_IOT_HUB_MODULE_v6.6.md) | MQTT ingestion: 26 files, 6 topics/gateway, fragment assembly, backfill |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v6.6.md](./02_OPTIMIZATION_ENGINE_MODULE_v6.6.md) | Strategy evaluation pipeline + schedule generation + real-time optimization |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v6.6.md](./03_DR_DISPATCHER_MODULE_v6.6.md) | Demand response dispatch: state machine + timeout + peak shaving |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v6.6.md](./04_MARKET_BILLING_MODULE_v6.6.md) | Tariff management + daily billing pipeline + PS savings + monthly true-up |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v6.6.md](./05_BFF_MODULE_v6.6.md) | 47 route endpoints (45 handler files) + SSE + middleware + background service orchestration |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v6.6.md](./06_IDENTITY_MODULE_v6.6.md) | JWT auth, RBAC, user management |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v6.6.md](./07_OPEN_API_MODULE_v6.6.md) | Webhook delivery + weather/CCEE inbound endpoints |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v6.6.md](./08_ADMIN_CONTROL_MODULE_v6.6.md) | Parser rules, VPP strategies, data dictionary CRUD |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v6.6.md](./09_SHARED_LAYER_v6.6.md) | Dual-pool DB, P5 persistence, tarifa, types, middleware |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v6.6.md](./10_DATABASE_SCHEMA_v6.6.md) | 29 tables, RLS, partitioning, indexes |

**Frontend Architecture**: [`docs/FRONTEND_ARCHITECTURE_v6.6.md`](../../docs/FRONTEND_ARCHITECTURE_v6.6.md)

---

## 1. System Positioning（系統定位）

Solfacil is a multi-tenant **Virtual Power Plant (VPP)** / **Energy Management System (EMS)** platform designed for Brazil's distributed energy market. It manages residential and commercial battery storage assets, optimizes charge/discharge schedules using **Tarifa Branca** (ANEEL 3-tier TOU pricing), and provides real-time fleet monitoring with **posture-aware governance**.

### Key Capabilities

| Capability | Description |
|-----------|-------------|
| Fleet Management | Gateway-level monitoring, integrator tracking, uptime trends |
| Device Control | Gateway-first schedule configuration, real-time SSE updates |
| Energy Analytics | Multi-granularity energy flow (5min→month), asset health tracking |
| HEMS Control | Batch dispatch workbench, gateway targeting, mode configuration |
| Strategy Triggers | Posture-aware triage, intent governance, operator escalation flows |
| Market Billing | Daily revenue calculation, TOU arbitrage, peak shaving savings |
| Performance | Pilot acceptance scorecard, savings analysis |

---

## 2. Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Runtime** | Node.js 20 (Express 5.x, ts-node) | TypeScript backend, local-server.ts entry point |
| **Backend Language** | TypeScript | Strict mode, immutable patterns |
| **Frontend** | Vanilla JavaScript SPA | No framework — hash-based routing, ECharts 5.x |
| **Database** | PostgreSQL 15 | RLS (Row-Level Security), table partitioning |
| **IoT Protocol** | MQTT | Xuheng EMS protocol (MSG#1–MSG#5) |
| **Auth** | JWT (HS256) | 4 roles, tenant isolation via RLS |
| **Infrastructure** | Docker Compose | 3 services: db, bff, m1 |
| **CSS** | Custom Properties | 5-file modular CSS, dark/light themes |
| **Charts** | ECharts 5.x | Theme-aware, ResizeObserver binding |
| **i18n** | Custom module | PT-BR (default), EN, ZH-CN |

---

## 3. Page Architecture（頁面架構）

### Page Hierarchy

```
P1 Fleet Overview          ─── Gateway-first fleet dashboard (v6.1)
  └── P2 Devices            ─── Home-first device workbench (v6.2)
        ├── P3-1 Energy Flow  ─── Gateway energy: 24h + Statistics (v6.3)
        └── P3-2 Asset Health ─── Asset SOC/SOH/temperature history (v5.24)
P4 HEMS Control             ─── 4-step batch dispatch workbench (v6.4)
P5 Strategy Triggers        ─── Posture-aware triage cockpit (v6.5)
  └── P5 VPP (legacy)       ─── VPP capacity/latency/DR events
P6 Performance              ─── Pilot acceptance scorecard (v5.14)
```

### Route Table

| Page | Hash Route | JS Module | Version | Key Features |
|------|-----------|-----------|---------|-------------|
| P1 Fleet | `#fleet` (default) | `p1-fleet.js` | v6.1 | Gateway summary, org list, offline events |
| P2 Devices | `#devices` | `p2-devices.js` | v6.2 | 3-segment: Locator + Data Lane + Control Lane |
| P3 Energy | `#energy` | `p3-energy.js` | v6.3 | Behavior (24h) + Statistics (7d/30d/12m) |
| P3 Asset Energy | `#asset-energy/:assetId` | `p3-asset-energy.js` | v5.24 | Per-asset telemetry history |
| P3 Asset Health | `#asset-health/:assetId` | `p3-asset-health.js` | v5.24 | SOC/SOH/temperature trends |
| P4 HEMS | `#hems` | `p4-hems.js` | v6.4 | Strategy→Impact→Targeting→Review |
| P5 Strategy | `#vpp` | `p5-strategy.js` | v6.5 | Hero posture, intent cards, overrides |
| P5 VPP | (sub-view) | `p5-vpp.js` | v5.12 | Legacy: capacity/latency/DR (file exists but not loaded in index.html — superseded by p5-strategy.js) |
| P6 Performance | `#performance` | `p6-performance.js` | v5.14 | 14 metrics, 3 categories. **Note:** Not in PAGES array — `#performance` falls back to `#fleet` via router. Init code exists but page is unreachable through standard navigation (reserved for future activation) |

---

## 4. Module Boundaries & Responsibilities

### Module Version Matrix（v6.6）

| Module ID | Module Name | Files | Key Responsibility |
|-----------|------------|-------|-------------------|
| M1 | IoT Hub | 26 .ts | MQTT↔DB bridge: telemetry ingestion, fragment assembly, aggregation |
| M2 | Optimization Engine | 4 .ts | Strategy evaluation, schedule generation, real-time SOC optimization |
| M3 | DR Dispatcher | 4 .ts | Trade→dispatch state machine, hardware ACK, timeout detection |
| M4 | Market Billing | 3 .ts | Daily billing pipeline, revenue calculation, PS savings, monthly true-up |
| M5 | BFF | 46 .ts | 47 route endpoints (45 handler files + 1 auth middleware) + SSE, background service orchestration |
| M6 | Identity | — | JWT auth via BFF + shared middleware (no standalone module) |
| M7 | Open API | 3 .ts | Outbound webhook delivery, inbound weather/CCEE endpoints |
| M8 | Admin Control | 8 .ts | Parser rules, VPP strategies, data dictionary CRUD |
| M9 | Shared Layer | 9 .ts + 1 .sql | Dual-pool DB, P5 persistence, tarifa, types, middleware, migrations |

---

## 5. Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (SPA)                           │
│  P1─P6 pages → data-source.js → BFF API                       │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP / SSE
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   M5 BFF (47 routes / 45 handlers)              │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌────────┐│
│  │ Auth │  │Fleet │  │Device│  │ HEMS │  │  P5  │  │Perf/Rev││
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └───┬────┘│
└─────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────┘
      │         │         │         │         │          │
      ▼         ▼         ▼         ▼         ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    M9 Shared Layer                               │
│  db.ts (dual pool) │ p5-db.ts │ tarifa.ts │ types/* │ auth    │
└────────────────────────────┬────────────────────────────────────┘
                             │ SQL (RLS)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PostgreSQL 15 (29 tables)                     │
│  RLS │ Partitions (telemetry monthly, 5min daily) │ Indexes    │
└─────────────────────────────────────────────────────────────────┘

Parallel Services (started from local-server.ts):
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ M1 IoT   │  │ M2 Sched │  │ M3 Disp  │  │ M4 Bill  │
│ MQTT→DB  │  │ Hourly   │  │ 1min/10s │  │ Daily    │
└──────────┘  └──────────┘  └──────────┘  └──────────┘

External:
┌──────────┐  ┌──────────┐  ┌──────────┐
│ M7 Open  │  │ M8 Admin │  │ EventBus │
│ Webhooks │  │ CRUD     │  │(AWS opt) │
└──────────┘  └──────────┘  └──────────┘
```

---

## 6. Inter-Module Communication

### Data Flow Patterns

| Source | Target | Mechanism | Purpose |
|--------|--------|-----------|---------|
| M1 IoT Hub | PostgreSQL | Direct SQL | Telemetry writes (telemetry_history, device_state, asset_5min_metrics) |
| M1 IoT Hub | BFF (SSE) | pg_notify | Real-time telemetry_update, gateway_health, command_status |
| M2 Optimization | PostgreSQL | Direct SQL | Strategy intents, trade schedules |
| M2 Optimization | EventBridge | AWS event | DRCommandIssued → M3 |
| M3 Dispatcher | PostgreSQL | Direct SQL | Dispatch commands, device command logs |
| M3 Dispatcher | M1 IoT Hub | MQTT via IoT Data Plane | Battery charge/discharge commands |
| M4 Billing | PostgreSQL | Direct SQL | Revenue daily aggregation (daily cron) |
| M5 BFF | PostgreSQL | queryWithOrg (RLS) | All read/write via RLS-scoped queries |
| M7 Open API | PostgreSQL | Direct SQL | Weather cache, PLD horario ingestion |
| M7 Open API | External | HMAC-SHA256 HTTP | Outbound webhook delivery |
| Frontend | M5 BFF | HTTP REST + SSE | 47 route endpoints (incl. webhooks, dispatch ACK) + 1 SSE stream |

### Background Service Schedule

| Service | Module | Schedule | DB Target |
|---------|--------|----------|-----------|
| GatewayConnectionManager | M1 | 60s poll + 6 topics/gateway | telemetry_history, device_state |
| Telemetry5MinAggregator | M1 | `*/5 * * * *` | asset_5min_metrics |
| TelemetryAggregator | M1 | `5 * * * *` | asset_hourly_metrics |
| ScheduleGenerator | M2 | `0 * * * *` | trade_schedules |
| CommandDispatcher | M3 | Every 1min + 10s + 30s | dispatch_commands, device_command_logs |
| TimeoutChecker | M3 | `* * * * *` | dispatch_commands |
| DailyBillingJob | M4 | `5 0 * * *` (00:05 UTC) | revenue_daily |

---

## 7. Database Architecture

- **29 tables** (27 in 02_schema.sql + 2 in 001_p5_strategy_triggers.sql)
- **Row-Level Security** on 15 tables using `app.current_org_id` session variable
- **Partitioned tables**: telemetry_history (monthly RANGE), asset_5min_metrics (daily RANGE)
- **Dual pool model**: `solfacil_app` (NOBYPASSRLS, max 20) + `solfacil_service` (BYPASSRLS, max 10)
- See [10_DATABASE_SCHEMA_v6.6.md](./10_DATABASE_SCHEMA_v6.6.md) for complete DDL reference

---

## 8. Auth & Multi-Tenancy

| Role | Scope | Key Capabilities |
|------|-------|-----------------|
| SOLFACIL_ADMIN | Cross-tenant | All operations, user creation, RLS bypass via 'SOLFACIL' org |
| ORG_MANAGER | Single org | Read/write for org, strategy management |
| ORG_OPERATOR | Single org | Read + dispatch + P5 intent actions |
| ORG_VIEWER | Single org | Read-only |

**Tenant Isolation**: Every SQL query runs through `queryWithOrg()` which wraps in a transaction with `SET LOCAL app.current_org_id`. RLS policies on 15 tables enforce row-level filtering.

---

## 9. Version History: v5.24 → v6.6

| Version | Date | Commit | Key Changes |
|---------|------|--------|-------------|
| v5.24 | 2026-03-13 | `70e79a4` | P3 Asset History View (telemetry/health API + frontend) |
| v5.25 | 2026-03-14 | `244eee6` | Responsive layout overhaul |
| v6.0 | 2026-03-16 | `b5976de` | P4 HEMS batch dispatch Phase 1+2 |
| v6.1 | 2026-03-19 | `e2ad0b5` | Fleet gateway-first dashboard, fleet overview/integradores endpoints |
| v6.2 | 2026-03-20 | `8b14245` | Devices home-first workbench, gateway schedule, home alias |
| v6.3 | 2026-03-21 | `bdfbbac` | Energy page redesign (gateway-first, 24h behavior + statistics) |
| v6.4 | 2026-03-23 | `dddb1ce` | P4 HEMS control workbench (targeting, batch dispatch v2) |
| v6.5 | 2026-03-26 | `440a253` | P5 Strategy Triggers — full stack (evaluator, governance, intent UI) |
| v6.5.1 | 2026-03-27 | `89c1f76` | P5 action model reframe (approve/defer/suppress/escalate) |
| **v6.6** | **2026-03-29** | **`4ec191a`** | **P1/P2 Visual Unification + SSE DB connection fix** |

### v6.6 Change Summary

**New modules/features since v5.24:**
- P5 Strategy Triggers: `strategy_intents` + `posture_overrides` tables, M2 strategy evaluator pipeline (6-step: evidence→conditions→qualify→governance→arbitrate→persist), 4 BFF P5 endpoints, p5-strategy.js frontend
- P4 HEMS Workbench: 4-step dispatch (Strategy→Impact→Targeting→Review), 100-gateway batch limit, targeting endpoint
- Fleet v6.1: Gateway-first dashboard with overview KPIs, integrator table
- Devices v6.2: Home-first workbench with 3-segment layout
- Energy v6.3: Gateway-first redesign with Behavior (24h) + Statistics views
- Dynamic Adapter v6.4: Universal telemetry mapper with iterator mode

**Handler count growth:** 34 (v5.24) → 47 routes / 45 handlers (v6.6)
**Table count growth:** 27 (v5.24) → 29 (v6.6, +strategy_intents, +posture_overrides)

---

## 10. Deployment

### Docker Compose (Local/Dev)

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| solfacil-db | postgres:15-alpine | 127.0.0.1:5433 | PostgreSQL with init scripts |
| solfacil-bff | node:20-alpine | 127.0.0.1:3100 | BFF + static frontend |
| solfacil-m1 | node:20-alpine | host network | MQTT↔DB pipeline |

### Access Points

| Environment | URL |
|-------------|-----|
| Production | `https://solfacil.alwayscontrol.net/` |
| Dev | `http://188.166.184.87/solfacil/` |
| Local | `http://127.0.0.1:3100` |
