# SOLFACIL VPP -- Master Architecture Blueprint

> **Module Version**: v5.22
> **Last Updated**: 2026-03-13
> **Description**: System master blueprint -- document index, system positioning, 8 module boundaries, event flow, architecture decisions
> **Core Theme**: Two-phase set_reply + Backfill Infrastructure -- reliable command acknowledgement + automatic gap detection and data recovery

---

## Document Index

| # | Document | Path | Description |
|---|----------|------|-------------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.22.md` | System master blueprint (this document) |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.22.md](./01_IOT_HUB_MODULE_v5.22.md) | **v5.22: Two-phase set_reply + BackfillRequester + MissedDataHandler** |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.22.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.22.md) | v5.16 PS slot generation (schema dep: homes→gateways) |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.22.md](./03_DR_DISPATCHER_MODULE_v5.22.md) | **v5.22: M3→M1 command pipeline + accepted timeout** |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.22.md](./04_MARKET_BILLING_MODULE_v5.22.md) | v5.16 PS counterfactual attribution (schema dep: homes→gateways) |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.22.md](./05_BFF_MODULE_v5.22.md) | **v5.22: 32 handlers + SSE endpoint + dispatch guard** |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.23.md](./06_IDENTITY_MODULE_v5.23.md) | Identity -- separate task |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API -- unchanged |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane -- separate task |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.22.md](./09_SHARED_LAYER_v5.22.md) | **v5.22: +solfacil-protocol.ts types, expanded ParsedTelemetry** |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.22.md](./10_DATABASE_SCHEMA_v5.22.md) | **v5.22: 26 tables (+backfill_requests), homes→gateways merge** |

---

## 1. System Positioning

(Same as v5.14. See `00_MASTER_ARCHITECTURE_v5.14.md` S1.)

> **v5.22 Version Notes (2026-03-13)**
>
> **Core Theme: Two-phase set_reply + Backfill Infrastructure**
>
> v5.22 completes the command acknowledgement closed-loop and adds automatic
> data recovery for gateway reconnections. Changes span v5.18 through v5.22:
>
> **v5.18 — Full Solfacil Protocol v1.2 Integration (M1):**
> FragmentAssembler for multi-message debounce, ems_health dual-write to gateways,
> 5 subscribe + 3 publish topics per gateway via GatewayConnectionManager.
>
> **v5.19 — Schema Consolidation (All modules):**
> homes table merged into gateways (name, address, contracted_demand_kw absorbed).
> gateway_id changed from synthetic IDs to serial numbers (SN = client_id = gateway_id).
> homes table DROPPED. RLS enabled on gateways. 7 new BFF gateway-level handlers.
>
> **v5.20 — Gateway-Level UI (M5/Frontend):**
> Energy Flow SVG, gateway-level detail/schedule/devices endpoints, EMS health display.
>
> **v5.21 — SSE Real-time Push + Command Pipeline (M1/M3/M5):**
> pg_notify('telemetry_update'/'gateway_health') → BFF SSE → frontend EventSource.
> M3→M1 command dispatch pipeline via device_command_logs. Config + Schedule card merge.
>
> **v5.22 — Two-phase set_reply + Backfill (M1):**
> Phase 1: set_reply accepted→success/fail two-phase tracking in CommandTracker.
> Phase 2: HeartbeatHandler reconnect detection → backfill_requests table → BackfillRequester
> chunked get_missed publishing.
> Phase 3: MissedDataHandler + BackfillAssembler for historical data ingest with dedup.
> Dispatch guard: BFF 409 + 20s accepted timeout + frontend disable.
>
> **v5.22 Scope:**
> - M1 IoT Hub: v5.18 → v5.22 (two-phase set_reply, backfill infrastructure, missed data handler)
> - M3 DR Dispatcher: v5.16 → v5.22 (M3→M1 command pipeline, accepted timeout)
> - M5 BFF: v5.16 → v5.22 (32 handlers, SSE, dispatch guard)
> - Shared Layer: v5.14 → v5.22 (+solfacil-protocol.ts, expanded telemetry types)
> - Database Schema: v5.16 → v5.22 (26 tables, homes→gateways, +backfill_requests)
> - M2 Optimization: v5.16 (schema dep note only)
> - M4 Market & Billing: v5.16 (schema dep note only)

### Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 20 LTS |
| Language | TypeScript | 5.x |
| HTTP Framework | Express | 5.x |
| Database | PostgreSQL | 15 Alpine |
| MQTT Client | mqtt.js | 5.x |
| MQTT Broker | EMQX | External |
| Frontend | Vanilla JS + HTML/CSS | No framework |
| Container | Docker Compose | 3.8 |
| Process Manager | Single-process (BFF + M1) | local-server.ts / run-m1-local.ts |

### Core Design Principles

(Same as v5.14.)

---

## 2. API Contract Governance

(Same as v5.14. See `00_MASTER_ARCHITECTURE_v5.14.md` S2.)

---

## 3. 8 Module Boundaries & Responsibilities

### Module Version Matrix

| Module ID | Module Name | Current Version | Document | Key Technology |
|-----------|------------|----------------|----------|---------------|
| Shared | Shared Layer | **v5.22** | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.22.md) | +solfacil-protocol.ts types, expanded ParsedTelemetry (34 fields) |
| Shared | Database Schema | **v5.22** | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.22.md) | PostgreSQL — **26 tables**, +backfill_requests, homes→gateways merge |
| M1 | IoT Hub | **v5.22** | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.22.md) | MQTT + **6 subscribe topics** + two-phase set_reply + backfill pipeline |
| M2 | Optimization Engine | v5.16 | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.22.md) | PS slot generation (schema dep: homes→gateways) |
| M3 | DR Dispatcher | **v5.22** | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.22.md) | M3→M1 command pipeline + **accepted timeout 20s** |
| M4 | Market & Billing | v5.16 | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.22.md) | PS counterfactual attribution (schema dep: homes→gateways) |
| M5 | BFF | **v5.22** | [05_BFF](./05_BFF_MODULE_v5.22.md) | Express + **32 handlers** + SSE + dispatch guard |
| M6 | Identity | v5.23 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.23.md) | Cognito (separate task) |
| M7 | Open API | v5.7 | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | Webhook delivery |
| M8 | Admin Control | v5.10 | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | DynamoDB + AppConfig |

---

## 4. EventBus Core Event Flow

(Same as v5.14. See `00_MASTER_ARCHITECTURE_v5.14.md` S4.)

---

## 5. Inter-Module Communication

### Inter-Module Communication Flow (v5.22 Update)

```
M1 (IoT Hub)          --subscribes->  MQTT 6 topics per gateway (v5.22: +data/missed)
                       --publishes -->  MQTT config/set, subDevices/get, data/get_missed (v5.22)
                       --writes   -->  telemetry_history (live + backfill ON CONFLICT DO NOTHING)
                       --writes   -->  device_state (live only, NOT backfill)
                       --writes   -->  gateways (ems_health, last_seen_at, status)
                       --writes   -->  device_command_logs (set_reply: accepted→success/fail)
                       --writes   -->  backfill_requests (v5.22: heartbeat reconnect detection)
                       --writes   -->  asset_5min_metrics (5-min aggregator, unchanged)
                       --writes   -->  asset_hourly_metrics (hourly aggregator, unchanged)
                       --fires    -->  pg_notify('telemetry_update') (live only)
                       --fires    -->  pg_notify('gateway_health')
                       --fires    -->  pg_notify('command_status') (v5.22)
                       --uses     -->  service pool
M2 (Optimization Engine)--reads   -->  device_state, vpp_strategies, gateways.contracted_demand_kw
                       --writes   -->  trade_schedules
                       --uses     -->  service pool
M3 (DR Dispatcher)     --reads    -->  trade_schedules, device_command_logs
                       --writes   -->  dispatch_commands, dispatch_records
                       --writes   -->  device_command_logs (pending→dispatched)
                       --uses     -->  service pool
M4 (Market & Billing)  --reads    -->  asset_5min_metrics, dispatch_records, tariff_schedules
                       --reads    -->  telemetry_history (DO transitions only)
                       --reads    -->  gateways.contracted_demand_kw
                       --writes   -->  revenue_daily
                       --uses     -->  service pool
M5 (BFF)               --reads    -->  all read-model tables via queryWithOrg
                       --writes   -->  device_command_logs (schedule set commands)
                       --listens  -->  pg_notify → SSE push (v5.21)
                       --returns  -->  409 on dispatch conflict (v5.22)
                       --uses     -->  app pool + queryWithOrg (RLS enforced)
M6 (IAM)               --publishes-->  OrgProvisioned, UserCreated
M7 (Open API)          --consumes -->  webhook delivery
M8 (Admin Control)     --publishes-->  ConfigUpdated, SchemaEvolved
```

### v5.22 Data Flow Diagram

```
                      MQTT Broker (EMQX)
                           |
          ┌────────────────┼────────────────────────────┐
          │ 6 subscribe    │                             │ 4 publish
          │ per gateway    │                             │ per gateway
          ▼                ▼                             ▲
   ┌──────────────────────────────┐        ┌────────────────────────┐
   │  GatewayConnectionManager   │        │ config/set             │
   │  +routeMessage (by topic)   │        │ subDevices/get         │
   └──┬──┬──┬──┬──┬──┬──────────┘        │ config/get             │
      │  │  │  │  │  │                    │ data/get_missed (v5.22)│
      │  │  │  │  │  │                    └────────────────────────┘
      │  │  │  │  │  └─ data/missed → MissedDataHandler    (v5.22)
      │  │  │  │  └─── status → HeartbeatHandler            (v5.22: reconnect detect)
      │  │  │  └────── set_reply → CommandTracker            (v5.22: two-phase)
      │  │  └───────── get_reply → CommandTracker
      │  └──────────── data → FragmentAssembler → telemetry_history
      └─────────────── deviceList → DeviceListHandler → assets UPSERT
                                                          │
           ┌──────────────────────────────────────────────┘
           │
           ▼
    ┌──────────────────────┐
    │ FragmentAssembler    │ (live path)
    │ +parseTelemetryPayload│ (shared pure function)
    │ → MessageBuffer      │ → telemetry_history
    │ → updateDeviceState  │ → device_state
    │ → pg_notify          │ → SSE push
    └──────────────────────┘

    ┌──────────────────────┐
    │ BackfillAssembler    │ (backfill path, v5.22)
    │ (same accumulation)  │
    │ ⛔ No pg_notify      │
    │ ⛔ No device_state   │
    │ ON CONFLICT DO NOTHING│ → telemetry_history (dedup)
    └──────────────────────┘

    ┌──────────────────────┐
    │ HeartbeatHandler     │ (v5.22: reconnect detection)
    │ CTE: prev → update  │
    │ gap > 2min →         │ → backfill_requests INSERT
    └──────┬───────────────┘
           │
           ▼
    ┌──────────────────────┐
    │ BackfillRequester    │ (v5.22: 10s poll)
    │ 30s delay → chunk   │
    │ 20s cooldown        │ → MQTT data/get_missed
    │ 30min chunks        │
    └──────────────────────┘

    ┌──────────────────────┐           ┌──────────────────────┐
    │ CommandTracker       │           │ BFF SSE              │
    │ set_reply handling:  │           │ LISTEN telemetry_    │
    │  accepted → phase 1 │──notify──▶│       update         │
    │  success/fail → p2  │           │ LISTEN gateway_health│
    └──────────────────────┘           │ → EventSource        │
                                       └──────────────────────┘
```

### Pool Assignment Rule (unchanged from v5.11)

| Pool | Role | RLS | Used By |
|------|------|-----|---------|
| **App Pool** (`getAppPool()`) | `solfacil_app` | Enforced -- must set `app.current_org_id` | BFF handlers (via `queryWithOrg`) |
| **Service Pool** (`getServicePool()`) | `solfacil_service` | Bypassed (`BYPASSRLS`) | M1 all handlers, M2/M3/M4 cron jobs |

---

## 6. v5.22 Database Changes Summary

### New Tables (1)

| Table | Type | Purpose |
|-------|------|---------|
| `backfill_requests` | Regular | Gateway reconnect data gap tracking + chunked backfill orchestration |

### New Indexes (3)

| Index | Table | Purpose |
|-------|-------|---------|
| `idx_dcl_accepted_set` | `device_command_logs` | Accepted command timeout check (v5.22 Phase 1) |
| `idx_backfill_active` | `backfill_requests` | Active backfill request polling (v5.22 Phase 2) |
| `idx_telemetry_unique_asset_time` | `telemetry_history` | Backfill dedup via ON CONFLICT DO NOTHING (v5.22 Phase 3) |

### Schema Changes (v5.18 → v5.22 cumulative)

| Version | Change |
|---------|--------|
| v5.18 | +gateways table, +device_command_logs table, assets +gateway_id |
| v5.19 | homes→gateways merge (homes DROPPED), gateway_id→SN, RLS on gateways |
| v5.20 | device_command_logs +dispatched_at +acked_at, permissions fix |
| v5.21 | idx_dcl_dispatched_set index |
| v5.22 | +backfill_requests, +3 indexes (accepted_set, backfill_active, telemetry_unique) |

### Total Table Count: **26 tables** (+1 from v5.16, net 0 from homes drop + gateways already existed)

Full DDL documented in [10_DATABASE_SCHEMA_v5.22.md](./10_DATABASE_SCHEMA_v5.22.md).

---

## 7. v5.22 Module Impact Map

| Module | Versions | Files Changed | Impact Level |
|--------|----------|--------------|-------------|
| **Database** | v5.18-v5.22 | 7 migration files | Foundation |
| **M1 IoT Hub** | v5.18→v5.22 | 3 modified, 2 new (missed-data-handler, backfill-requester) | **Primary** |
| **M3 DR Dispatcher** | v5.16→v5.22 | 1 modified (command-dispatcher.ts + timeout) | Secondary |
| **M5 BFF** | v5.16→v5.22 | 12 new handlers, 1 new SSE, dispatch guard | **Primary** |
| **Shared Layer** | v5.14→v5.22 | 1 new (solfacil-protocol.ts), 1 modified (telemetry.ts) | Secondary |
| M2 Optimization | v5.16 | 0 (schema dep note) | None |
| M4 Market & Billing | v5.16 | 0 (schema dep note) | None |
| M6 Identity | -- | 0 | None (separate task) |
| M7 Open API | -- | 0 | None |
| M8 Admin Control | -- | 0 | None (separate task) |
| Frontend | v5.19-v5.22 | Multiple (SSE, dispatch, energy flow) | Secondary |

### Deployment Architecture (v5.22)

```
docker-compose.yml:
  ┌─────────────────────┐
  │ solfacil-db         │  PostgreSQL 15 Alpine
  │ port: 5433 (local)  │  Volume: solfacil_pgdata
  │ db-init/ on startup │  Users: solfacil_app + solfacil_service
  └─────────┬───────────┘
            │
  ┌─────────┴──────────┐    ┌────────────────────────┐
  │ solfacil-bff       │    │ solfacil-m1            │
  │ port: 3100→3000    │    │ network_mode: host     │
  │ local-server.ts    │    │ run-m1-local.ts        │
  │ BFF + frontend     │    │ MQTT subscriber        │
  │ APP_DATABASE_URL   │    │ SERVICE_DATABASE_URL   │
  │ SERVICE_DATABASE_URL│    └────────────────────────┘
  └────────────────────┘
```

---

## 8. Version Delta Summary: v5.16 → v5.22

| Aspect | v5.16 | v5.22 |
|--------|-------|-------|
| MQTT topics per gateway | 5 subscribe + 3 publish | **6 subscribe + 4 publish** (+data/missed) |
| set_reply tracking | Single-phase (success/fail) | **Two-phase** (accepted → success/fail) |
| Backfill | Not implemented | **Full**: heartbeat gap detect → queue → chunked request → data ingest |
| SSE push | Not implemented | **pg_notify → BFF SSE → EventSource** |
| M3→M1 command | M3 publishes MQTT directly | **M3→device_command_logs→M1 CommandPublisher→MQTT** |
| Dispatch guard | None | **BFF 409 + 20s accepted timeout** |
| homes table | Present (19 columns) | **DROPPED** (absorbed into gateways) |
| gateways table | Present (MQTT config) | **+name, +address, +contracted_demand_kw, +ems_health** |
| gateway_id format | Synthetic (GW-SF-001) | **Serial number** (WKRD24070202100144F) |
| BFF handlers | 19 | **32** |
| SSE endpoint | None | **1** (sse-events.ts) |
| telemetry_history dedup | No unique index | **UNIQUE INDEX** (asset_id, recorded_at) |
| DB tables | 25 | **26** (+backfill_requests, -homes +gateways absorbed) |
| ParsedTelemetry fields | 23 | **34** (+inverterTemp, +pvTotal, +pv1/2, +telemetryExtra) |

---

## 9. Open Items

### v5.23+ (Future)

- Identity module overhaul (separate task)
- Admin control module update (separate task)
- PS monthly true-up in production (M4 cron needs validation)
- Forward-looking DP optimization (v6.0)
- Load/PV forecasting engine (v6.0)
- CCEE PLD wholesale arbitrage (regulatory dependency)
- Cross-gateway aggregation dashboard

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: 8 modules, EventBus, architecture governance |
| v5.3 | 2026-02-27 | HEMS single-home scenario |
| v5.4 | 2026-02-27 | PostgreSQL replaces DynamoDB/Timestream |
| v5.5 | 2026-02-28 | Dual-layer economic model |
| v5.6 | 2026-02-28 | System heartbeat + internal pipeline automation |
| v5.7 | 2026-02-28 | External awareness + M7 bidirectional |
| v5.8 | 2026-03-02 | Telemetry closed-loop + Data Contract |
| v5.9 | 2026-03-02 | Logic closed-loop + de-hardcoding |
| v5.10 | 2026-03-05 | 3D fix: DB Bootstrap + Architecture Boundary + BFF De-hardcoding |
| v5.11 | 2026-03-05 | Dual Connection Pool: dual-role DB architecture |
| v5.12 | 2026-03-05 | API Contract Alignment & BFF Expansion: 15 new endpoints |
| v5.13 | 2026-03-05 | Data Pipeline & Deterministic Math: MQTT subscriber + Tarifa Branca |
| v5.14 | 2026-03-06 | Formula Overhaul & Deep Telemetry: DP optimal TOU + 9 telemetry fields |
| v5.15 | 2026-03-07 | SC/TOU Attribution & 5-min Telemetry: asset_5min_metrics + dispatch target_mode |
| v5.16 | 2026-03-07 | Peak Shaving: PS slot generation, counterfactual attribution, MonthlyTrueUp |
| **v5.22** | **2026-03-13** | **Two-phase set_reply + Backfill: v5.18 full protocol (FA, GCM, 5+3 topics); v5.19 homes→gateways merge (SN as gateway_id, homes DROPPED, RLS on gateways); v5.20 gateway-level BFF (energy flow, detail/schedule); v5.21 SSE real-time push (pg_notify→BFF SSE→EventSource) + M3→M1 command pipeline; v5.22 two-phase set_reply (accepted→success/fail) + backfill infrastructure (heartbeat gap detect→backfill_requests→BackfillRequester chunked get_missed) + backfill data path (MissedDataHandler + BackfillAssembler ON CONFLICT DO NOTHING) + dispatch guard (BFF 409 + 20s accepted timeout); 25→26 tables (+backfill_requests); 19→32 BFF handlers + 1 SSE** |
