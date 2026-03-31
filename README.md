# SOLFACIL VPP Platform

Virtual Power Plant (VPP) / Energy Management System (EMS) platform for distributed battery storage in Brazil.

**Version:** v6.6
**Git HEAD:** `4ec191a`

## Overview

Solfacil is a multi-tenant VPP platform designed for Brazil's distributed energy market. It manages residential and commercial battery storage assets, optimizes charge/discharge schedules using Tarifa Branca (ANEEL 3-tier TOU pricing), and provides real-time fleet monitoring with posture-aware governance.

### Key Capabilities

- **Fleet Management (P1):** Gateway-level monitoring, integrator tracking, uptime trends, offline event detection
- **Device Workbench (P2):** Gateway-first device management, schedule configuration, real-time SSE updates
- **Energy Analytics (P3):** Multi-granularity energy flow (5min/hour/day/month), asset health tracking (SOC/SOH/temperature)
- **HEMS Control (P4):** Batch dispatch workbench, gateway targeting, mode configuration
- **Strategy Triggers (P5):** Posture-aware triage cockpit, intent governance (approve/defer/suppress/escalate), VPP capacity monitoring
- **Performance Scorecard (P6):** Pilot acceptance metrics, savings tracking
- **Multi-language:** PT-BR, EN, ZH-CN
- **Role-based:** Admin (dark theme) / Integrador (light theme)

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | TypeScript, Express 5.x, Node.js 20 (ts-node) |
| **Frontend** | Vanilla JavaScript SPA, ECharts 5.x, Font Awesome |
| **Database** | PostgreSQL 15 with RLS (Row-Level Security) |
| **IoT** | MQTT (Xuheng EMS protocol) |
| **Infrastructure** | Docker Compose (3 services) |
| **Auth** | JWT (HS256, 24h expiry) |

## Project Structure

```
solfacil/
├── backend/
│   ├── src/
│   │   ├── bff/                    # M5: Backend-for-Frontend (47 routes / 45 handlers)
│   │   ├── iot-hub/                # M1: MQTT ingestion & telemetry
│   │   ├── optimization-engine/    # M2: Strategy evaluation & scheduling
│   │   ├── dr-dispatcher/          # M3: Demand response dispatch
│   │   ├── market-billing/         # M4: Tariff & daily billing
│   │   ├── admin-control-plane/    # M8: Admin CRUD operations
│   │   ├── open-api/               # M7: Webhook receivers (weather, CCEE)
│   │   └── shared/                 # M9: DB pools, types, middleware, tarifa
│   └── scripts/                    # Local dev server, M1 runner
├── frontend-v2/
│   ├── index.html                  # Main SPA shell
│   ├── login.html                  # Standalone JWT login
│   ├── js/                         # 16 JS modules (app, pages P1-P6, data, i18n, charts, components)
│   └── css/                        # 5-file modular CSS (variables, base, layout, components, pages)
├── db-init/                        # PostgreSQL schema, roles, grants, seed data
├── design/
│   └── backend_architecture/       # Architecture documents (v6.6)
├── docs/                           # Guides, feature design docs (REQ/DESIGN/PLAN/REVIEW)
├── document/                       # External reference PDFs
└── docker-compose.yml              # 3 services: db, bff, m1
```

## Local Development

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for direct backend development)

### Quick Start

```bash
# Start all services
docker compose up -d

# Services:
#   solfacil-db   → PostgreSQL 15 on 127.0.0.1:5433
#   solfacil-bff  → BFF + static frontend on 127.0.0.1:3100
#   solfacil-m1   → IoT MQTT processor (host network)
```

### Access Points

| Purpose | URL |
|---------|-----|
| **Production** | `https://solfacil.alwayscontrol.net/` |
| **Dev (human-facing)** | `http://188.166.184.87/solfacil/` |
| **Local service probe** | `http://127.0.0.1:3100` |
| **Local DB** | `127.0.0.1:5433` (user: `solfacil_app`) |

### Default Credentials

| User | Email | Role |
|------|-------|------|
| Admin | `admin@solfacil.com.br` | SOLFACIL_ADMIN |
| Alan | `alan@xuheng.com` | ORG_MANAGER |

## Architecture Documents

All architecture documentation lives in `design/backend_architecture/` with the v6.6 series:

| Doc | Module | File |
|-----|--------|------|
| 00 | Master Architecture | `00_MASTER_ARCHITECTURE_v6.6.md` |
| 01 | IoT Hub (M1) | `01_IOT_HUB_MODULE_v6.6.md` |
| 02 | Optimization Engine (M2) | `02_OPTIMIZATION_ENGINE_MODULE_v6.6.md` |
| 03 | DR Dispatcher (M3) | `03_DR_DISPATCHER_MODULE_v6.6.md` |
| 04 | Market Billing (M4) | `04_MARKET_BILLING_MODULE_v6.6.md` |
| 05 | BFF (M5) | `05_BFF_MODULE_v6.6.md` |
| 06 | Identity (M6) | `06_IDENTITY_MODULE_v6.6.md` |
| 07 | Open API (M7) | `07_OPEN_API_MODULE_v6.6.md` |
| 08 | Admin Control (M8) | `08_ADMIN_CONTROL_MODULE_v6.6.md` |
| 09 | Shared Layer (M9) | `09_SHARED_LAYER_v6.6.md` |
| 10 | Database Schema | `10_DATABASE_SCHEMA_v6.6.md` |

Frontend architecture: `docs/FRONTEND_ARCHITECTURE_v6.6.md`

## Database

- **29 tables** with comprehensive RLS (15 tenant-isolated tables)
- **Partitioned telemetry:** `telemetry_history` (monthly), `asset_5min_metrics` (daily)
- **Dual pool model:** `solfacil_app` (RLS-enforced) + `solfacil_service` (RLS-bypass for cron jobs)

## Author

Alan Kim - Xuheng Electronics (旭衡電子)

## License

Proprietary - All rights reserved
