# SOLFACIL VPP — Unified Backend Architecture Design

> **Version:** 5.0 | **Date:** 2026-02-21
> **Author:** Cloud Architecture Team
> **Status:** ACTIVE — Grand Fusion Architecture
> **Supersedes:** `SOLFACIL_BACKEND_DESIGN.md` v1.1, `SOLFACIL_AUTH_TENANT_DESIGN.md` v2.0

**This document is the Single Source of Truth for the SOLFACIL VPP backend architecture.**

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| **v1.0** | 2026-02-15 | Initial 5-module backend design: IoT Hub, Optimization Engine, DR Dispatcher, Market & Billing, BFF. EventBridge-based async communication. AWS CDK TypeScript as IaC. |
| **v1.1** | 2026-02-20 | Added Device Shadow sync flow (ScheduleGenerated → Module 1), SQS Delay Queue timeout mechanism for DR Dispatcher, edge-case event payloads, expanded cost estimation. |
| **v2.0 (Auth)** | 2026-02-20 | Separate document: Multi-tenancy via Cognito (hybrid custom attributes + groups), RBAC (4 roles), RLS, org_id across all data stores, enterprise SSO (SAML/OIDC), mandatory TOTP MFA, M2M OAuth 2.0 Client Credentials, WAF, event-driven webhooks with HMAC-SHA256 signing. |
| **v3.0** | 2026-02-20 | **Unified fusion.** Expanded from 5 to 7 bounded contexts (added M6: Identity & Tenant IAM, M7: Open API & Integration). org_id as first-class citizen in every data store. Merged CDK deployment into 7 coherent phases. Updated cost estimation with auth/webhook line items. Single Source of Truth. |
| **v4.0** | 2026-02-20 | **DDD Architecture Upgrade.** Added §19 Data Strategy & Anti-Corruption Layer: (1) M4 Extensible Metadata — PostgreSQL JSONB `metadata` column + GIN index on assets/organizations, enabling zero-migration business attribute expansion; (2) M1 Dual Ingestion & ACL — `StandardTelemetry` canonical contract, `TelemetryAdapter` interface, `HuaweiAdapter` (devSn→deviceId, W÷1000→kW) + `NativeAdapter`, `AdapterRegistry` priority chain; M2 Algorithm Engine is permanently isolated from vendor-specific formats. |
| **v4.1 (Draft)** | 2026-02-21 | **Admin Control Plane草案。** Added Module 8: Admin Control Plane (Configuration-Driven, No-Code Operations). Defines device_parser_rules + vpp_strategies schemas and REST API endpoints. M1–M7 unchanged. Full fusion deferred to v5.0. |
| **v5.0** | 2026-02-21 | **Grand Fusion.** M8 confirmed as Global Control Plane. M1-M7 confirmed as Data Plane. Introduces Control Plane vs. Data Plane separation law, Grand Fusion Matrix (8-module dependency map), and Configuration Sync Architecture (EventBridge ConfigUpdated + ElastiCache Redis). No hardcoding rule enforced across all modules. |

---

## Table of Contents

0. [Architectural Law: Control Plane vs. Data Plane](#0-architectural-law-control-plane-vs-data-plane-全局法則)
   - 0.1 [Grand Fusion Matrix — 8-Module Configuration Dependency](#01-grand-fusion-matrix--8-module-configuration-dependency八大模塊全面融合矩陣)
   - 0.2 [Configuration Sync & Caching Architecture](#02-configuration-sync--caching-architecture配置同步與快取架構)
1. [Executive Summary & Design Principles](#1-executive-summary--design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Global Data Isolation Strategy](#3-global-data-isolation-strategy)
4. [Module 1: IoT & Telemetry Hub](#4-module-1-iot--telemetry-hub)
5. [Module 2: Algorithm Engine](#5-module-2-algorithm-engine)
6. [Module 3: DR Dispatcher](#6-module-3-dr-dispatcher)
7. [Module 4: Market & Billing](#7-module-4-market--billing)
8. [Module 5: Frontend BFF](#8-module-5-frontend-bff)
9. [Module 6: Identity & Tenant Management (IAM)](#9-module-6-identity--tenant-management-iam)
10. [Module 7: Open API & Integration](#10-module-7-open-api--integration)
11. [Core Event Flow Examples](#11-core-event-flow-examples)
12. [Unified CDK Deployment Plan](#12-unified-cdk-deployment-plan)
13. [Backend Directory Structure](#13-backend-directory-structure)
14. [Observability](#14-observability)
15. [Cost Estimation](#15-cost-estimation)
16. [Security Posture Summary](#16-security-posture-summary)
17. [Appendix: Event Catalog](#17-appendix-event-catalog)
18. [Appendix: Cognito CLI & Test Users](#18-appendix-cognito-cli--test-users)
19. [Data Strategy & Anti-Corruption Layer](#19-data-strategy--anti-corruption-layer-資料戰略與防腐層)
20. [Module 8: Admin Control Plane (Draft)](#20-module-8-admin-control-plane-admin-營運中台--draft)

---

## 0. Architectural Law: Control Plane vs. Data Plane (全局法則)

> **ADR Status:** ACCEPTED | **Decision Date:** 2026-02-21
> **Scope:** System-wide architectural law governing all 8 modules
> **Drivers:** Operational agility, zero-downtime configuration updates, elimination of hardcoded business rules

### 0.0 The Supreme Principle

Starting from v5.0, the SOLFACIL VPP system formally adopts the **Control Plane vs. Data Plane Separation** as its supreme architectural law:

**Control Plane (控制面) — Module 8 (Admin Control Plane)**
- The system's **Single Source of Truth for Configuration**
- Responsibilities: dynamic configuration, business rules, thresholds, permission matrices, feature flags, API quotas
- **All business rule changes MUST and CAN ONLY originate from M8**
- Owns the PostgreSQL configuration tables; exposes REST API for CRUD operations
- Publishes `ConfigUpdated` events via EventBridge to notify Data Plane modules

**Data Plane (數據面) — Modules 1-7**
- Responsibilities: data ingestion, computation, scheduling, dispatching, billing, API serving
- **Iron Law (鐵律): Any mutable business rule or threshold MUST NOT be hardcoded in M1-M7 (No Hardcoding Rule)**
- M1-M7 configuration MUST be loaded dynamically from M8 at startup (Lambda cold start) or upon receiving a `ConfigUpdated` event
- Data Plane modules are consumers of configuration, never producers

**Code that violates this law SHALL NOT be merged into the main branch (Merge Blocked).**

---

### 0.1 Grand Fusion Matrix — 8-Module Configuration Dependency (八大模塊全面融合矩陣)

The following matrix defines the complete configuration dependency between M8 (Control Plane) and M1-M7 (Data Plane):

| Module | Configuration Type | M8 Table | Read Timing | Cache TTL | Redis Key Pattern |
|--------|-------------------|----------|-------------|-----------|-------------------|
| **M1** IoT Hub | Device parser rules (field mappings, unit conversions) | `device_parser_rules` | Lambda cold start + `ConfigUpdated{module:'M1'}` | 5 min | `parser_rules:{org_id}` |
| **M2** Algorithm Engine | Arbitrage strategy thresholds (SoC limits, profit margins) | `vpp_strategies` | Before each EventBridge scheduled trigger + `ConfigUpdated{module:'M2'}` | 1 min | `vpp_strategy:{org_id}` |
| **M3** DR Dispatcher | Dispatch policies (retry, concurrency, timeout) | `dispatch_policies` | Lambda cold start + `ConfigUpdated{module:'M3'}` | 10 min | `dispatch_policy:{org_id}` |
| **M4** Market & Billing | Billing rules (penalty multipliers, tariff periods, cost/kWh) | `billing_rules` | Every billing calculation (high-frequency, Redis-cached) | 60 min | `billing_rules:{org_id}` |
| **M5** Frontend BFF | Feature flags (UI toggles, canary releases) | `feature_flags` | Every API request (BFF middleware layer cache) | 5 min | `feature_flags:{org_id}` |
| **M6** Identity & Tenant | Dynamic RBAC permission matrix | `rbac_policies` | Cognito Lambda Trigger (token issuance) + JWT validation | 30 min | `rbac:{role}` |
| **M7** Open API | API quotas + webhook backoff policies | `api_quotas` / `webhook_policies` | API Gateway Lambda Authorizer per request | 1 min | `api_quota:{partner_id}` / `webhook_policy:{org_id}` |

---

#### M1 (IoT Hub) — Dynamic Parser Rules (動態解析規則)

**Source Table:** `device_parser_rules` (M8)

M1's telemetry ingestion Lambda reads vendor-specific `field_mapping` and `unit_conversions` from M8's `device_parser_rules` table, replacing the previously hardcoded `HuaweiAdapter` / `NativeAdapter` pattern.

- **Read Timing:** Lambda cold start + upon receiving `ConfigUpdated{module: 'M1'}` event
- **Cache:** ElastiCache Redis, TTL=5 min, Key: `parser_rules:{org_id}`
- **Fusion Effect:** Adding a new vendor (e.g., SMA, ABB) requires only creating a new parser rule in M8's admin UI — **zero code deployment**. The M1 Lambda dynamically constructs adapters from the rule's `field_mapping` JSON at runtime.

#### M2 (Algorithm Engine) — Arbitrage Strategy & Thresholds (套利策略與閾值)

**Source Table:** `vpp_strategies` (M8)

M2's optimization Lambda reads `min_soc`, `max_soc`, `emergency_soc`, `profit_margin`, and `active_hours` from M8's `vpp_strategies` table, replacing previously hardcoded threshold constants.

- **Read Timing:** Before each EventBridge scheduled trigger + upon receiving `ConfigUpdated{module: 'M2'}` event
- **Cache:** ElastiCache Redis, TTL=1 min (strategy changes must take effect quickly), Key: `vpp_strategy:{org_id}`
- **Fusion Effect:** During summer peak season, operators can change `min_soc=10` (more aggressive discharge) directly in M8's admin UI — **no code changes needed**. The next optimization cycle automatically uses the updated thresholds.

#### M3 (DR Dispatcher) — Dispatch Policies (派發政策)

**Source Table:** `dispatch_policies` (M8, new)

M3's dispatch Lambda reads operational parameters from M8's `dispatch_policies` table:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_retry_count` | 3 | Maximum retry attempts for failed device commands |
| `retry_backoff_seconds` | 60 | Backoff interval between retries |
| `max_concurrent_dispatches` | 10 | Maximum concurrent dispatch operations per org |
| `timeout_minutes` | 15 | SQS delay queue timeout (currently hardcoded!) |

- **Read Timing:** Lambda cold start + `ConfigUpdated{module: 'M3'}`
- **Cache:** ElastiCache Redis, TTL=10 min, Key: `dispatch_policy:{org_id}`
- **Fusion Effect:** In emergency situations, operators can temporarily change `timeout_minutes` from 15 to 5 in M8's admin UI — **immediate effect** on the next dispatch cycle. No redeployment required.

#### M4 (Market & Billing) — Billing Rules & Tariff Matrix (計費規則與電價矩陣)

**Source Table:** `billing_rules` (M8, new)

M4's billing Lambda reads pricing and cost parameters from M8's `billing_rules` table:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `tariff_penalty_multiplier` | 1.5x | Penalty multiplier for contract violations |
| `tariff_effective_period` | `'monthly'` | Tariff validity period (`'monthly'` / `'quarterly'` / `'annually'`) |
| `operating_cost_per_kwh` | _(required)_ | Operating cost per kWh (currently a hardcoded constant in M4!) |

- **Read Timing:** Every billing calculation (high-frequency reads — Redis cache mandatory)
- **Cache:** ElastiCache Redis, TTL=60 min (tariff rates change infrequently), Key: `billing_rules:{org_id}`
- **Fusion Effect:** When the Brazilian government updates Tarifa Branca rates, operators update M8's admin UI — **no redeployment needed**. The next billing cycle automatically uses the new rates.

#### M5 (Frontend BFF) — Feature Flags & UI Configuration (租戶功能開關與 UI 配置)

**Source Table:** `feature_flags` (M8, new)

M5's BFF middleware reads feature toggles from M8's `feature_flags` table:

| Parameter | Type | Description |
|-----------|------|-------------|
| `flag_name` | TEXT | Feature identifier (e.g., `'show_analytics_modal'`, `'enable_dr_test_button'`, `'show_shadow_benchmark'`) |
| `is_enabled` | BOOLEAN | Whether the feature is active |
| `target_org_ids` | JSONB | `null` = all tenants, or specific org list `["ORG_001", "ORG_002"]` |
| `valid_from` / `valid_until` | TIMESTAMPTZ | Time window for the feature flag |

- **Read Timing:** Every API request (cached in BFF middleware layer)
- **Cache:** ElastiCache Redis, TTL=5 min, Key: `feature_flags:{org_id}`
- **Fusion Effect:** New features can be initially enabled only for `SOLFACIL_ADMIN` in M8's admin UI, verified, then gradually rolled out to `ORG_MANAGER` and beyond — achieving **canary release (灰度發布)** without code changes.

#### M6 (Identity & Tenant) — Dynamic RBAC Permission Matrix (動態 RBAC 權限矩陣)

**Source Table:** `rbac_policies` (M8, future)

M6's Cognito Pre-Token-Generation Lambda reads permission definitions from M8's `rbac_policies` table:

| Parameter | Type | Description |
|-----------|------|-------------|
| `role` | TEXT | `'SOLFACIL_ADMIN'` / `'ORG_MANAGER'` / `'ORG_OPERATOR'` / `'ORG_VIEWER'` |
| `resource` | TEXT | `'assets'`, `'dispatch'`, `'billing'`, `'parser_rules'`, `'strategies'`, etc. |
| `actions` | JSONB | Subset of `['read', 'write', 'delete']` |
| `org_scope` | TEXT | `'all'` (cross-org) or `'own'` (own org only) |

- **Read Timing:** Cognito Lambda Trigger (token issuance) + JWT validation
- **Cache:** ElastiCache Redis, TTL=30 min (permission changes need to propagate relatively quickly), Key: `rbac:{role}`
- **Fusion Effect:** Adding a new permission (e.g., `ORG_OPERATOR` can view DR dispatches but cannot modify strategies) requires only an M8 admin UI update — Cognito automatically injects the updated claims on the next token issuance.

#### M7 (Open API) — API Quotas & Webhook Backoff Policies (API 配額與 Webhook 退避策略)

**Source Tables:** `api_quotas` + `webhook_policies` (M8, new)

M7's API Gateway Lambda Authorizer reads rate limits and webhook retry policies from two M8 tables:

**Table: `api_quotas`**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `calls_per_minute` | 60 | Per-partner per-minute rate limit |
| `calls_per_day` | 10,000 | Per-partner daily quota |
| `burst_limit` | 100 | Maximum burst capacity |

**Table: `webhook_policies`**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_retry_count` | 3 | Maximum webhook delivery retry attempts |
| `backoff_strategy` | `'exponential'` | `'linear'` or `'exponential'` backoff |
| `initial_delay_ms` | 1000 | Initial retry delay in milliseconds |
| `max_delay_ms` | 300000 | Maximum retry delay (5 minutes) |
| `dead_letter_email` | _(optional)_ | Alert email when DLQ is triggered |

- **Read Timing:** API Gateway Lambda Authorizer on every request (Redis cache mandatory for performance)
- **Cache:** ElastiCache Redis, TTL=1 min (quota changes must take effect quickly), Key: `api_quota:{partner_id}` / `webhook_policy:{org_id}`
- **Fusion Effect:** When a partner's API traffic spikes unexpectedly, operators can immediately lower their quota in M8's admin UI — the WAF/Authorizer layer enforces the new limit on the next request, **no code changes required**.

---

### 0.2 Configuration Sync & Caching Architecture (配置同步與快取架構)

> This is the **technical soul** of v5.0 — the mechanism that makes the Control Plane / Data Plane separation operationally viable at scale.

#### The Problem

M1-M7 (7 Data Plane modules) all need to read configuration from M8's PostgreSQL tables. If every Lambda invocation queries PostgreSQL directly, high-traffic scenarios (especially M1 telemetry ingestion at ~1M events/day) will exhaust the database connection pool (**Connection Pool Exhaustion**), creating a single point of failure.

#### Solution: Three-Tier Caching Architecture (三層快取架構)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Three-Tier Caching Architecture                         │
│                                                                                 │
│  Tier 1: Lambda Memory Cache (最快，Lambda 實例內部)                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Module-level variable outside Lambda handler function                   │    │
│  │  TTL determined by Lambda Execution Environment lifecycle               │    │
│  │  Suitable for: infrequently changing config (billing_rules, TTL=60min)  │    │
│  │  Limitation: Not shared across Lambda instances                         │    │
│  └──────────────────────────────────┬──────────────────────────────────────┘    │
│                                     │ MISS                                      │
│                                     ▼                                           │
│  Tier 2: ElastiCache Redis (共享快取，所有 Lambda 實例共用)                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Shared cache accessible by all Lambda instances across all modules      │    │
│  │  Each config type has a dedicated Redis Key (see Grand Fusion Matrix)   │    │
│  │  Update flow: M8 writes PostgreSQL → deletes Redis Key → next read      │    │
│  │    rebuilds cache (Cache Invalidation pattern)                          │    │
│  │  Suitable for: medium-frequency config changes                          │    │
│  └──────────────────────────────────┬──────────────────────────────────────┘    │
│                                     │ MISS                                      │
│                                     ▼                                           │
│  Tier 3: PostgreSQL (M8 的 Source of Truth)                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  The ultimate source of truth for all configuration                      │    │
│  │  NOT directly exposed to M1-M7 — accessed only via Redis cache layer   │    │
│  │  Owned exclusively by M8 Admin Control Plane                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### ConfigUpdated Event Broadcast Mechanism (配置更新事件廣播機制)

The following sequence describes the end-to-end configuration update flow:

```
Step 1: Operator modifies config in M8 Admin UI
        (e.g., changes vpp_strategy for ORG_ENERGIA_001)
              │
              ▼
Step 2: M8 Lambda writes updated config to PostgreSQL
              │
              ▼
Step 3: M8 publishes ConfigUpdated event to EventBridge
        ┌──────────────────────────────────────────────────┐
        │  Source: solfacil.admin-control-plane             │
        │  DetailType: ConfigUpdated                        │
        │  Detail: {                                        │
        │    "module": "M2",                                │
        │    "orgId": "ORG_ENERGIA_001",                    │
        │    "configType": "vpp_strategy",                  │
        │    "updatedAt": "2026-02-21T14:30:00Z"            │
        │  }                                                │
        └──────────────────────────┬───────────────────────┘
                                   │
                                   ▼
Step 4: EventBridge Rule routes to target module's config-refresh Lambda
        based on the "module" field:
        ┌──────────────────────────────────────────────────────────────┐
        │  module='M1' → M1 config-refresh Lambda                      │
        │                → DELETE Redis Key `parser_rules:{org_id}`    │
        │                → Reload from PostgreSQL on next invocation   │
        │                                                              │
        │  module='M2' → M2 config-refresh Lambda                      │
        │                → DELETE Redis Key `vpp_strategy:{org_id}`    │
        │                                                              │
        │  module='M3' → M3 config-refresh Lambda                      │
        │                → DELETE Redis Key `dispatch_policy:{org_id}` │
        │                                                              │
        │  module='M4' → M4 config-refresh Lambda                      │
        │                → DELETE Redis Key `billing_rules:{org_id}`   │
        │                                                              │
        │  module='M5' → M5 config-refresh Lambda                      │
        │                → DELETE Redis Key `feature_flags:{org_id}`   │
        │                                                              │
        │  module='M6' → M6 config-refresh Lambda                      │
        │                → DELETE Redis Key `rbac:{role}`              │
        │                                                              │
        │  module='M7' → M7 config-refresh Lambda                      │
        │                → DELETE Redis Key `api_quota:{partner_id}`   │
        │                → DELETE Redis Key `webhook_policy:{org_id}`  │
        │                                                              │
        │  module='ALL' → Broadcast to ALL modules (global config reset)│
        └──────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
Step 5: Next Lambda invocation discovers Redis Key missing
        → Automatically reloads latest config from PostgreSQL
        → Writes fresh value back to Redis with appropriate TTL
        → Business logic proceeds with updated configuration
```

#### New CDK Stack: ConfigSyncStack (v5.0 Deliverable)

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| Redis Cluster | ElastiCache Redis | Shared configuration cache (cluster mode disabled for dev, enabled for prod) |
| Redis Security Group | EC2 SG | Only accessible from Lambda Security Group |
| config-refresh Lambdas x7 | Lambda (Node.js 20) | One per Data Plane module (M1-M7) — invalidates Redis keys on ConfigUpdated |
| EventBridge Rule | EventBridge | Source=`solfacil.admin-control-plane`, DetailType=`ConfigUpdated` |
| VPC Endpoint (Redis) | VPC Endpoint | Lambda → ElastiCache connectivity within VPC |

#### v5.0 Deployment Order (融合後的系統部署順序)

```
Phase 0: SharedStack
    │
    ▼
Phase 1: AuthStack (M6)
    │
    ▼
Phase 2: ConfigSyncStack (NEW — ElastiCache Redis + config-refresh Lambdas)
    │
    ▼
Phase 3: AdminControlPlaneStack (M8 — must deploy before Data Plane)
    │
    ▼
Phase 4: IotHubStack (M1) + AlgorithmStack (M2)
    │
    ▼
Phase 5: DrDispatcherStack (M3) + MarketBillingStack (M4)
    │
    ▼
Phase 6: BffStack (M5)
    │
    ▼
Phase 7: OpenApiStack (M7)
```

**Key Change from v4.1:** ConfigSyncStack and AdminControlPlaneStack are deployed **before** any Data Plane stacks, ensuring that M1-M7 can read configuration from M8 + Redis from their very first invocation.

---

## 1. Executive Summary & Design Principles

### Purpose

SOLFACIL is building a **B2B SaaS Virtual Power Plant (VPP)** platform that aggregates distributed battery energy storage systems (BESS) across Brazil. The platform enables:

- **Tarifa Branca arbitrage** — Charge batteries during off-peak hours, discharge during peak hours to maximize the R$ 0.57/kWh spread
- **Demand Response (DR)** — Coordinated dispatch of 50,000+ battery assets for grid balancing events
- **Multi-tenant management** — Multiple enterprise clients (energy companies, investment funds, aggregators) each managing their own fleets with strict data isolation
- **External integration** — Machine-to-machine API access for ERP systems, trading platforms, and aggregators; event-driven webhook notifications for real-time downstream processing

### Core Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Multi-tenant by design** | `org_id` is a mandatory dimension in every data store, event payload, MQTT topic, and API response. Tenant isolation is enforced at infrastructure (RLS, IoT policies), middleware (extractTenantContext), and application levels. |
| 2 | **Event-driven decoupling** | All inter-module communication flows through a single Amazon EventBridge bus (`solfacil-vpp-events`). Modules publish domain events and subscribe to events they need. No direct Lambda-to-Lambda invocations. |
| 3 | **Bounded contexts** | Each of the 7 modules owns its data store. No shared databases. Cross-module data access is mediated by events or the BFF aggregation layer. |
| 4 | **Serverless-first** | Zero server management. Lambda for compute, DynamoDB/Timestream/RDS Serverless for storage, API Gateway for ingress. Pay-per-invocation pricing model. |
| 5 | **API-first** | The BFF (M5) exposes a clean REST API for the dashboard. The Open API Gateway (M7) exposes a separate, rate-limited API for external integrations. Both are documented and versioned independently. |
| 6 | **Zero-trust security** | Every request is authenticated (Cognito JWT or M2M OAuth token). Every data query is tenant-scoped. Every write operation is role-checked. Every MQTT topic is policy-restricted per device certificate. |
| 7 | **Immutability** | All state changes produce events. The EventBridge event log (with Archive) is the source of truth for audit. Lambda handlers return new objects, never mutate in place. |

### Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| IaC | AWS CDK (TypeScript) | v2.x |
| Compute | AWS Lambda | Node.js 20 / Python 3.12 (M2 only) |
| API | API Gateway v2 (HTTP API) | — |
| Auth | Amazon Cognito | User Pool + Identity Providers |
| Messaging | Amazon EventBridge | Custom bus |
| IoT | AWS IoT Core | MQTT v4.1.1 over TLS |
| Time-series | Amazon Timestream | — |
| Relational | Amazon RDS PostgreSQL 16 (Serverless v2) | — |
| Key-value | Amazon DynamoDB | On-demand |
| Queue | Amazon SQS | Standard + Delay |
| Security | AWS WAF v2, Secrets Manager | — |
| Observability | Lambda Powertools, X-Ray, CloudWatch | — |

---

## 2. Architecture Overview

### 7-Module Bounded Context Map

```
                    ┌──────────────────────────────────────────────────────────────────┐
                    │                      Frontend (Existing)                         │
                    │              Vanilla JS Dashboard + Chart.js                     │
                    └──────────────────────┬───────────────────────────────────────────┘
                                           │ HTTPS (Bearer JWT)
                    ┌──────────────────────▼───────────────────────────────────────────┐
                    │           Module 5: BFF (API Gateway + Lambda)                    │
                    │           Cognito Authorizer │ REST API (read/write)              │
                    └──┬──────────┬──────────┬──────────┬─────────────────────────────┘
                       │          │          │          │
                  EventBridge EventBridge EventBridge Direct Query
                       │          │          │          │
          ┌────────────▼──┐  ┌───▼────────┐ │  ┌───────▼──────────────────┐
          │  Module 1:     │  │ Module 2:   │ │  │  Module 4:               │
          │  IoT &         │  │ Algorithm   │ │  │  Market & Billing        │
          │  Telemetry Hub │  │ Engine      │ │  │  (RDS PostgreSQL + RLS)  │
          │  (IoT Core +   │  │ (EventBridge│ │  │                          │
          │   Timestream)  │  │  + Lambda)  │ │  └──────────────────────────┘
          └───────┬────────┘  └──────┬──────┘ │
                  │                  │        ┌▼──────────────────────────┐
                  │  ScheduleGenerated        │  Module 3:                │
                  │◄─────────────────┤        │  DR Dispatcher            │
                  │  (→Device Shadow)│        │  (Lambda + IoT Core       │
                  │       EventBridge│        │   MQTT publish +          │
                  │                  │        │   SQS Timeout Queue)      │
                  │                  └───────►│                           │
                  │◄──────────────────────────┘
                  │
          ┌───────▼────────────────────────────┐
          │         Edge Devices (Inverters)     │
          │     MQTT over TLS  │  Device Shadow  │
          └─────────────────────────────────────┘

  ┌─────────────────────────────────────┐   ┌────────────────────────────────────┐
  │  Module 6: Identity & Tenant (IAM)  │   │  Module 7: Open API & Integration  │
  │  ┌─────────────────────────────┐    │   │  ┌──────────────────────────────┐  │
  │  │ Cognito User Pool           │    │   │  │ API Gateway (M2M)            │  │
  │  │  ├─ SSO: SAML 2.0 / OIDC   │    │   │  │  ├─ OAuth 2.0 Client Creds   │  │
  │  │  ├─ MFA: TOTP mandatory     │    │   │  │  ├─ API Keys + Usage Plans   │  │
  │  │  └─ Groups: RBAC            │    │   │  │  └─ WAF WebACL               │  │
  │  │  └─ Pre-Token Lambda        │    │   │  ├──────────────────────────────┤  │
  │  ├─────────────────────────────┤    │   │  │ Webhook Subscriptions        │  │
  │  │ Organization Provisioning   │    │   │  │  ├─ EventBridge API Dest.    │  │
  │  │  ├─ POST /admin/orgs        │    │   │  │  ├─ HMAC-SHA256 signing     │  │
  │  │  └─ organizations table     │    │   │  │  └─ DynamoDB subscriptions   │  │
  │  └─────────────────────────────┘    │   │  └──────────────────────────────┘  │
  └─────────────────────────────────────┘   └────────────────────────────────────┘
```

### Module Responsibility Matrix

| Plane | Module | Name | Responsibility | Primary Data Store |
|-------|--------|------|----------------|--------------------|
| **Control** | M8 | Admin Control Plane | Dynamic configuration, business rules, feature flags, API quotas | RDS PostgreSQL + ElastiCache Redis |
| Data | M1 | IoT & Telemetry Hub | MQTT ingestion, Device Shadow, telemetry storage | Amazon Timestream |
| Data | M2 | Algorithm Engine | Schedule optimization, forecast, Tarifa Branca arbitrage | SSM Parameter Store |
| Data | M3 | DR Dispatcher | Demand-response commands, SQS timeout, status tracking | DynamoDB |
| Data | M4 | Market & Billing | Tarifa Branca rules, profit calculation, invoicing | RDS PostgreSQL |
| Data | M5 | Frontend BFF | Dashboard REST API (Cognito-protected, tenant-scoped) | Aggregates from M1-M4 |
| Data | M6 | Identity & Tenant (IAM) | Cognito User Pool, SSO/SAML, org provisioning, RBAC | Cognito + DynamoDB |
| Data | M7 | Open API & Integration | M2M API Gateway, WAF, rate limiting, webhook subscriptions | DynamoDB + Secrets Manager |

### Inter-Module Communication

All async communication flows through the shared EventBridge bus `solfacil-vpp-events`:

```
M1 (IoT Hub)          ──publishes──►  TelemetryReceived, DeviceStatusChanged
M2 (Algorithm Engine)  ──publishes──►  ScheduleGenerated, ForecastUpdated
M3 (DR Dispatcher)     ──publishes──►  DRDispatchCompleted, AssetModeChanged
M4 (Market & Billing)  ──publishes──►  ProfitCalculated, InvoiceGenerated, TariffUpdated
M5 (BFF)               ──publishes──►  DRCommandIssued (user-initiated dispatch)
M6 (IAM)               ──publishes──►  OrgProvisioned, UserCreated
M7 (Open API)          ──consumes ──►  DRDispatchCompleted, InvoiceGenerated → webhook delivery
```

**Rule: No direct Lambda-to-Lambda calls.** Modules interact only via EventBridge events or via the BFF aggregation layer for read queries.

### End-to-End Data Flow

```
Edge Device (Inverter)
    │ MQTT publish: solfacil/{org_id}/{region}/{asset_id}/telemetry
    ▼
M1: IoT Hub
    │ Ingest → Timestream; publish TelemetryReceived
    ▼
EventBridge ─────────────────────────────────────────────────────────
    │                    │                    │                    │
    ▼                    ▼                    ▼                    ▼
M2: Algorithm        M3: DR Dispatcher   M4: Market & Billing  M7: Open API
    │ Optimize            │ Dispatch          │ Calculate profit     │ Webhook
    │ Publish             │ Track status      │ Generate invoice     │ delivery
    │ ScheduleGenerated   │                   │                      │
    ▼                     │                   │                      │
M1: Device Shadow         │                   │                      │
    │ Push to device      │                   │                      │
    ▼                     ▼                   ▼                      ▼
M5: BFF (Dashboard) ◄──── Aggregates read data from M1-M4 ────────►  Frontend
```

---

## 3. Global Data Isolation Strategy

### First Principle: `org_id` Is a First-Class Citizen

Every data record in the SOLFACIL VPP platform carries an `org_id` field. This is the **#1 architectural invariant** — no data is stored, transmitted, or queried without tenant context.

```
org_id = Organization ID (e.g., "ORG_ENERGIA_001")
         Assigned at user creation time (Cognito custom:org_id)
         Immutable per user
         Mandatory in every:
           ├─ PostgreSQL row (RLS-enforced)
           ├─ DynamoDB item (GSI partition key)
           ├─ Timestream record (dimension)
           ├─ MQTT topic path segment
           ├─ EventBridge event detail
           └─ Lambda handler context (TenantContext)
```

### 3.1 PostgreSQL (Module 4: Market & Billing)

#### Organizations Table

```sql
CREATE TABLE organizations (
    id          VARCHAR(50) PRIMARY KEY,     -- e.g., "ORG_ENERGIA_001"
    name        VARCHAR(200) NOT NULL,       -- e.g., "Energia Corp S.A."
    cnpj        VARCHAR(18) UNIQUE NOT NULL, -- Brazilian tax ID (CNPJ)
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    plan_tier   VARCHAR(20) NOT NULL DEFAULT 'standard',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### Schema Changes (org_id on all tables)

```sql
ALTER TABLE assets           ADD COLUMN org_id VARCHAR(50) NOT NULL;
ALTER TABLE tariff_schedules ADD COLUMN org_id VARCHAR(50) NOT NULL;
ALTER TABLE trades           ADD COLUMN org_id VARCHAR(50) NOT NULL;
ALTER TABLE daily_revenue    ADD COLUMN org_id VARCHAR(50) NOT NULL;

-- Foreign keys
ALTER TABLE assets           ADD CONSTRAINT fk_assets_org    FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE tariff_schedules ADD CONSTRAINT fk_tariff_org    FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE trades           ADD CONSTRAINT fk_trades_org    FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE daily_revenue    ADD CONSTRAINT fk_revenue_org   FOREIGN KEY (org_id) REFERENCES organizations(id);

-- Indexes for tenant-scoped queries
CREATE INDEX idx_assets_org         ON assets(org_id);
CREATE INDEX idx_trades_org         ON trades(org_id, trade_date);
CREATE INDEX idx_daily_revenue_org  ON daily_revenue(org_id, report_date);
CREATE INDEX idx_tariff_org         ON tariff_schedules(org_id, valid_from);
```

#### Row-Level Security (RLS) — Defense in Depth

```sql
ALTER TABLE assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades           ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_revenue    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_schedules ENABLE ROW LEVEL SECURITY;

-- Lambda middleware sets: SET app.current_org_id = 'ORG_ENERGIA_001'
CREATE POLICY tenant_isolation_assets ON assets
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_trades ON trades
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_daily_revenue ON daily_revenue
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_tariff ON tariff_schedules
  USING (org_id = current_setting('app.current_org_id', true));

-- SOLFACIL_ADMIN bypass: a superuser role with BYPASSRLS privilege
```

### 3.2 DynamoDB (Module 3: DR Dispatcher)

```
Table: dispatch_tracker
PK: dispatch_id (ULID)
SK: asset_id
Attributes:
  + org_id (String)             ← MANDATORY
  - command_type, target_mode, status, requested_power_kw,
    actual_power_kw, response_latency_sec, accuracy_pct,
    timestamp, error_reason

GSI: org-dispatch-index
  PK: org_id
  SK: dispatch_id
  Purpose: "List all dispatches for org X" (dashboard query)
```

### 3.3 Timestream (Module 1: IoT Hub)

```
Database: solfacil_vpp
Table: device_telemetry

Dimensions:
  + org_id      ← MANDATORY (new first dimension)
    asset_id
    device_id
    region

Measures: soc, power_kw, voltage, temperature, operation_mode
Retention: Memory=24h, Magnetic=90d
```

All Timestream queries include `WHERE org_id = '{org_id}'`. Since Timestream partitions by dimensions, `org_id` improves query performance at no additional cost.

### 3.4 IoT Core (Modules 1 & 3) — MQTT Topic Namespace

```
Updated topic structure (org_id inserted):

  solfacil/{org_id}/{region}/{asset_id}/telemetry
  solfacil/{org_id}/{region}/{asset_id}/command/mode-change
  solfacil/{org_id}/{region}/{asset_id}/response/mode-change

IoT Policy (per device certificate):
  {
    "Effect": "Allow",
    "Action": ["iot:Publish", "iot:Subscribe", "iot:Receive"],
    "Resource": "arn:aws:iot:*:*:topic/solfacil/${iot:Connection.Thing.Attributes[org_id]}/*"
  }

IoT Rule SQL (updated topic position indices):
  SELECT *, topic(2) AS org_id, topic(3) AS region, topic(4) AS asset_id
  FROM 'solfacil/+/+/+/telemetry'
```

### 3.5 EventBridge Events — org_id Mandatory in All Payloads

```typescript
/** Base event envelope — ALL events must include org_id */
export interface VppEvent<T> {
  readonly source: string;
  readonly detailType: string;
  readonly detail: T & { readonly org_id: string };
  readonly timestamp: string;
}
```

Example payload:
```json
{
  "source": "solfacil.vpp.dr-dispatcher",
  "detail-type": "DRDispatchCompleted",
  "detail": {
    "org_id": "ORG_ENERGIA_001",
    "dispatch_id": "01HWXYZ...",
    "results": [...]
  }
}
```

### 3.6 Lambda — extractTenantContext() Utility

Every Lambda handler across all modules extracts tenant context before business logic executes. This shared utility lives in `src/shared/middleware/tenant-context.ts`:

```typescript
export interface TenantContext {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly email: string;
  readonly isPlatformAdmin: boolean;
}

export type Role = 'SOLFACIL_ADMIN' | 'ORG_MANAGER' | 'ORG_OPERATOR' | 'ORG_VIEWER';
```

Tenant scoping rule (enforced at middleware, not in handlers):
```
IF user.role == SOLFACIL_ADMIN:
    query_filter = {}                    // Admin sees everything
ELSE:
    query_filter = { org_id: user.orgId } // Strict org filter
```

---

## 4. Module 1: IoT & Telemetry Hub

### CDK Stack: `IotHubStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| MQTT Broker | IoT Core | Accept device connections via MQTT over TLS |
| Device Registry | IoT Core Registry | Manage device certificates & thing groups |
| Device Shadow | IoT Core Shadow | Store last-known state per device |
| Telemetry Store | Amazon Timestream | High-frequency time-series data |
| Ingestion Lambda | Lambda (Node.js 20) | IoT Rule Action → parse → batch write to Timestream |
| Shadow Sync Lambda | Lambda (Node.js 20) | ScheduleGenerated → Device Shadow update |

### IAM Grants

```
IotHubStack Lambda functions:
  ├─ timestream:WriteRecords  → solfacil_vpp/device_telemetry
  ├─ iot:UpdateThingShadow    → arn:aws:iot:*:*:thing/*
  ├─ events:PutEvents         → solfacil-vpp-events bus
  └─ ssm:GetParameter         → /solfacil/iot/* parameters
```

### EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `TelemetryReceived` | → M2 (forecast update), M5 (future WebSocket) |
| **Publishes** | `DeviceStatusChanged` | → M4 (asset status), M5 (dashboard) |
| **Consumes** | `ScheduleGenerated` | ← M2 (24h schedule → Device Shadow) |

### org_id Integration

- Timestream `org_id` dimension on every telemetry record
- IoT Rule SQL extracts `org_id` from topic position 2
- Device Shadow namespace: `solfacil/{org_id}/{region}/{asset_id}`
- IoT policies scoped to device certificate's `org_id` attribute

### Lambda Handlers

```
src/iot-hub/
├── handlers/
│   ├── ingest-telemetry.ts       # IoT Rule → Lambda: parse MQTT, write Timestream (with org_id dimension)
│   ├── device-shadow-sync.ts     # Device Shadow update handler
│   ├── schedule-to-shadow.ts     # EventBridge ScheduleGenerated → Device Shadow (Desired State)
│   └── device-registry.ts        # Device provisioning & registration
├── services/
│   ├── timestream-writer.ts      # Timestream batch write logic
│   └── shadow-manager.ts         # Device Shadow get/update
└── __tests__/
    ├── ingest-telemetry.test.ts
    └── timestream-writer.test.ts
```

### Device Shadow Schedule Sync

When Module 2 publishes `ScheduleGenerated`, the `schedule-to-shadow` handler writes the 24-hour charge/discharge schedule into each device's Device Shadow (Desired State):

```
M2 (Algorithm Engine) ──ScheduleGenerated──► EventBridge ──► M1 (schedule-to-shadow Lambda)
                                                                     │
                                                                     ├── For each asset:
                                                                     │   Update Device Shadow (Desired State)
                                                                     │   { "schedule": [...], "schedule_id": "...", "valid_from": "..." }
                                                                     │
                                                                     ├── Device online:  Delta → push immediately
                                                                     └── Device offline: Shadow stores state; on reconnect → auto-push
```

**Why Device Shadow?** Edge devices (inverters) may temporarily lose connectivity. The Delta mechanism guarantees that when a device reconnects, it automatically receives the latest schedule — ensuring no dispatch is lost during outages.

### Timestream Table Schema

```
Database: solfacil_vpp
Table: device_telemetry

Dimensions: org_id, asset_id, device_id, region
Measures:
  - soc (DOUBLE, %)
  - power_kw (DOUBLE, kW)
  - voltage (DOUBLE, V)
  - temperature (DOUBLE, C)
  - operation_mode (VARCHAR)

Retention: Memory=24h, Magnetic=90d
```

---

## 5. Module 2: Algorithm Engine

### CDK Stack: `AlgorithmStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| Scheduler | EventBridge Scheduler | Trigger every 15 min for schedule generation |
| Optimizer Lambda | Lambda (Python 3.12) | Run optimization algorithm |
| Forecast Model | SageMaker Endpoint (future) | Load & PV generation forecast |
| Config Store | SSM Parameter Store | Algorithm parameters, thresholds |

### IAM Grants

```
AlgorithmStack Lambda functions:
  ├─ timestream:Select         → solfacil_vpp/device_telemetry (read SoC data)
  ├─ events:PutEvents          → solfacil-vpp-events bus
  └─ ssm:GetParameter          → /solfacil/algorithm/* parameters
```

### EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `ScheduleGenerated` | → M1 (Device Shadow), M3 (immediate dispatch), M4 (expected revenue) |
| **Publishes** | `ForecastUpdated` | → M5 (dashboard display) |
| **Consumes** | `TelemetryReceived` | ← M1 (update forecast model) |
| **Consumes** | `TariffUpdated` | ← M4 (recalculate schedule with new rates) |

### org_id Integration

- All events published include `org_id` in detail
- Schedule generation queries Timestream with `WHERE org_id = ?`
- Optimization runs are per-org (one org's assets never influence another's schedule)

### Algorithm Logic (Tarifa Branca Arbitrage)

```
Tarifa Branca Time Blocks (Brazil ANEEL):
  Off-Peak:      00:00-06:00, 22:00-24:00  →  R$ 0.25/kWh
  Intermediate:  06:00-17:00, 20:00-22:00  →  R$ 0.45/kWh
  Peak:          17:00-20:00               →  R$ 0.82/kWh

Strategy:
  1. CHARGE during off-peak (lowest cost)
  2. HOLD during intermediate (wait for peak)
  3. DISCHARGE during peak (maximum spread: R$ 0.57/kWh)
  4. Optimization Alpha = actual_revenue / theoretical_max * 100
```

### Lambda Handlers

```
src/optimization-engine/
├── handlers/
│   ├── run-schedule.ts           # EventBridge Scheduled → generate dispatch plan
│   ├── evaluate-forecast.ts      # TelemetryReceived → update forecast
│   └── compute-alpha.ts          # On-demand optimization alpha calculation
├── services/
│   ├── tariff-optimizer.ts       # Peak/valley arbitrage logic
│   ├── forecast-engine.ts        # Load & PV forecast (MAPE tracking)
│   └── baseline-calculator.ts    # Shadow benchmark (dumb baseline)
└── __tests__/
    ├── tariff-optimizer.test.ts
    └── baseline-calculator.test.ts
```

---

## 6. Module 3: DR Dispatcher

### CDK Stack: `DrDispatcherStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| Command Handler | Lambda (Node.js 20) | Process dispatch commands |
| MQTT Publisher | IoT Core (iotdata) | Publish commands to device topics |
| Status Tracker | DynamoDB | Track per-asset dispatch status & latency |
| Response Collector | Lambda (Node.js 20) | IoT Rule on response topic → aggregate |
| Timeout Queue | SQS (Delay Queue) | 15-min delayed message for offline device timeout |
| Timeout Checker | Lambda (Node.js 20) | Mark timed-out devices as FAILED |

### IAM Grants

```
DrDispatcherStack Lambda functions:
  ├─ iot:Publish               → solfacil/*/command/mode-change topics
  ├─ dynamodb:PutItem/Query    → dispatch_tracker table
  ├─ sqs:SendMessage           → timeout delay queue
  ├─ events:PutEvents          → solfacil-vpp-events bus
  └─ ssm:GetParameter          → /solfacil/dr/* parameters
```

### EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `DRDispatchCompleted` | → M4 (financial settlement), M5 (dashboard), M7 (webhooks) |
| **Publishes** | `AssetModeChanged` | → M4 (record mode change) |
| **Consumes** | `DRCommandIssued` | ← M5 (user-initiated dispatch) |
| **Consumes** | `ScheduleGenerated` | ← M2 (execute immediate mode changes) |

### org_id Integration

- `dispatch_tracker` table includes `org_id` on every item
- GSI `org-dispatch-index` (PK=org_id, SK=dispatch_id) for tenant-scoped queries
- MQTT topics include org_id: `solfacil/{org_id}/{region}/{asset_id}/command/mode-change`
- All published events include `org_id` in detail

### DynamoDB Table

```
Table: dispatch_tracker
PK: dispatch_id (ULID)
SK: asset_id
Attributes:
  - org_id (String, required)
  - command_type (BATCH_DISPATCH | DR_TEST)
  - target_mode (self_consumption | peak_valley_arbitrage | peak_shaving)
  - status (PENDING | EXECUTING | SUCCESS | FAILED)
  - requested_power_kw
  - actual_power_kw
  - response_latency_sec
  - accuracy_pct
  - timestamp
  - error_reason (null | "DEVICE_ERROR" | "TIMEOUT" | "MQTT_DELIVERY_FAILED")

GSI: status-index    (PK=dispatch_id, SK=status)
GSI: org-dispatch-index (PK=org_id, SK=dispatch_id)
```

### Device Timeout Mechanism (SQS Delay Queue)

```
DR Dispatcher Lambda                       SQS (Delay Queue)
(dispatch-command)                         delay = 15 minutes
      │                                          │
      ├── 1. Write PENDING to DynamoDB           │
      ├── 2. Publish MQTT command to device      │
      ├── 3. Update status → EXECUTING           │
      └── 4. Send delayed message to SQS ────────┤
                                                  │
           ┌──────────── 15 min later ────────────┘
           ▼
  Timeout Checker Lambda
      ├── Query DynamoDB for dispatch_id
      ├── Find records still in EXECUTING
      ├── Mark as FAILED (reason: "TIMEOUT")
      └── If all assets resolved:
           └── Publish "DRDispatchCompleted" to EventBridge
               (status: PARTIAL_SUCCESS or FAILED)
```

**Key Invariant:** A `DRDispatchCompleted` event **must** be published after timeout resolution, ensuring M4 can perform financial settlement even when devices are partially unreachable.

### Lambda Handlers

```
src/dr-dispatcher/
├── handlers/
│   ├── dispatch-command.ts       # EventBridge DRCommandIssued → IoT Core MQTT + SQS delay
│   ├── collect-response.ts       # IoT Rule → aggregate device responses
│   ├── dr-test-orchestrator.ts   # DR test: select all → dispatch → report
│   └── timeout-checker.ts        # SQS trigger: check & mark timeouts
├── services/
│   ├── mqtt-publisher.ts         # IoT Core MQTT publish (batch fan-out)
│   ├── response-aggregator.ts    # Collect acks, compute latency & accuracy
│   ├── dispatch-tracker.ts       # DynamoDB: track dispatch status per asset
│   └── timeout-queue.ts          # SQS delayed message enqueue helper
└── __tests__/
    ├── dispatch-command.test.ts
    └── response-aggregator.test.ts
```

---

## 7. Module 4: Market & Billing

### CDK Stack: `MarketBillingStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| Database | RDS PostgreSQL 16 (Serverless v2) | Tariff rules, asset financials, trade history |
| Query Lambda | Lambda (Node.js 20) | Execute SQL via RDS Data API |
| Invoice Generator | Lambda (Node.js 20) | Monthly billing computation |
| Cache | ElastiCache Redis (optional) | Cache tariff lookups |

### IAM Grants

```
MarketBillingStack Lambda functions:
  ├─ rds-data:ExecuteStatement    → solfacil-vpp RDS cluster
  ├─ secretsmanager:GetSecret     → RDS credentials
  ├─ events:PutEvents             → solfacil-vpp-events bus
  └─ ssm:GetParameter             → /solfacil/billing/* parameters
```

### EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `ProfitCalculated` | → M5 (dashboard) |
| **Publishes** | `InvoiceGenerated` | → M5 (dashboard), M7 (webhooks) |
| **Publishes** | `TariffUpdated` | → M2 (recalculate schedule), M3 (dispatch awareness) |
| **Consumes** | `AssetModeChanged` | ← M3 (record mode change financial impact) |
| **Consumes** | `ScheduleGenerated` | ← M2 (record expected revenue) |
| **Consumes** | `DRDispatchCompleted` | ← M3 (financial settlement) |

### org_id Integration

- All PostgreSQL tables have `org_id` column with foreign key to `organizations`
- Row-Level Security enforced via `current_setting('app.current_org_id')`
- Lambda handlers set RLS session variable before any query
- SOLFACIL_ADMIN bypasses RLS via a superuser DB role

### PostgreSQL Schema

```sql
CREATE TABLE tariff_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    name             VARCHAR(100) NOT NULL,
    valid_from       DATE NOT NULL,
    valid_to         DATE,
    peak_rate        NUMERIC(8,4) NOT NULL,
    intermediate_rate NUMERIC(8,4) NOT NULL,
    off_peak_rate    NUMERIC(8,4) NOT NULL,
    peak_start       TIME NOT NULL,
    peak_end         TIME NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE assets (
    id               VARCHAR(20) PRIMARY KEY,
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    name             VARCHAR(200) NOT NULL,
    region           VARCHAR(5) NOT NULL,
    investment_brl   NUMERIC(12,2) NOT NULL,
    capacity_mwh     NUMERIC(8,2) NOT NULL,
    unit_count       INTEGER NOT NULL,
    operation_mode   VARCHAR(30) NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trades (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    asset_id         VARCHAR(20) REFERENCES assets(id),
    trade_date       DATE NOT NULL,
    time_block       VARCHAR(20) NOT NULL,
    tariff_type      VARCHAR(20) NOT NULL,
    operation        VARCHAR(20) NOT NULL,
    price_per_kwh    NUMERIC(8,4) NOT NULL,
    volume_kwh       NUMERIC(10,2),
    result_brl       NUMERIC(12,2) NOT NULL,
    status           VARCHAR(20) NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_revenue (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    asset_id         VARCHAR(20) REFERENCES assets(id),
    report_date      DATE NOT NULL,
    revenue_brl      NUMERIC(12,2) NOT NULL,
    cost_brl         NUMERIC(12,2) NOT NULL,
    profit_brl       NUMERIC(12,2) NOT NULL,
    roi_pct          NUMERIC(6,2),
    UNIQUE(org_id, asset_id, report_date)
);
```

### Lambda Handlers

```
src/market-billing/
├── handlers/
│   ├── get-tariff-schedule.ts    # Query current Tarifa Branca rates
│   ├── calculate-profit.ts       # Revenue/cost/profit per asset per day
│   ├── generate-invoice.ts       # Monthly billing report
│   └── update-tariff-rules.ts    # Admin: update tariff configuration
├── services/
│   ├── tariff-engine.ts          # Tarifa Branca rate lookup (peak/inter/off-peak)
│   ├── revenue-calculator.ts     # Revenue = sum(volume * price) - costs
│   └── roi-calculator.ts         # ROI & payback period computation
├── migrations/
│   ├── 001_create_organizations.ts
│   ├── 002_create_tariffs.ts
│   ├── 003_create_assets.ts
│   ├── 004_create_trades.ts
│   └── 005_create_daily_revenue.ts
└── __tests__/
    ├── tariff-engine.test.ts
    └── revenue-calculator.test.ts
```

---

## 8. Module 5: Frontend BFF

### CDK Stack: `BffStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| API Gateway | API Gateway v2 (HTTP API) | REST endpoints for Dashboard |
| Authorizer | Cognito User Pool (from M6) | JWT-based auth |
| Lambda Handlers | Lambda (Node.js 20) | One handler per route |
| WebSocket (future) | API Gateway WebSocket | Real-time dispatch progress |

### IAM Grants

```
BffStack Lambda functions:
  ├─ rds-data:ExecuteStatement    → solfacil-vpp RDS cluster (read-only)
  ├─ dynamodb:Query               → dispatch_tracker (via org-dispatch-index GSI)
  ├─ timestream:Select            → solfacil_vpp/device_telemetry
  ├─ events:PutEvents             → solfacil-vpp-events bus
  └─ cognito-idp:ListUsers        → user management (ORG_MANAGER only)
```

### EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `DRCommandIssued` | → M3 (dispatch execution) |
| **Consumes** | `DRDispatchCompleted` | ← M3 (future: WebSocket push) |
| **Consumes** | `ProfitCalculated` | ← M4 (future: WebSocket push) |

### org_id Integration

- Cognito Authorizer validates JWT and passes claims to Lambda
- `extractTenantContext()` middleware extracts `org_id` and `role` from JWT claims
- All queries are filtered by `org_id` (or unfiltered for SOLFACIL_ADMIN)
- Resource ownership checks for single-resource endpoints (return 404, not 403)

### API Routes

| Method | Path | Min Role | Tenant Scoping |
|--------|------|----------|----------------|
| `GET` | `/dashboard` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/assets` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/assets/{id}` | ORG_VIEWER | Verify asset belongs to `org_id` |
| `GET` | `/assets/{id}/analytics` | ORG_VIEWER | Verify asset belongs to `org_id` |
| `GET` | `/trades` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/revenue/trend` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/revenue/breakdown` | ORG_VIEWER | Scoped to `org_id` |
| `POST` | `/dispatch` | ORG_OPERATOR | Verify all `assetIds` belong to `org_id`; step-up auth |
| `POST` | `/dr-test` | ORG_OPERATOR | Scoped to `org_id` assets; step-up auth |
| `GET` | `/dispatch/{id}` | ORG_OPERATOR | Verify dispatch belongs to `org_id` |
| `GET` | `/algorithm/kpis` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/tariffs/current` | ORG_VIEWER | Scoped to `org_id` |
| `PUT` | `/tariffs/{id}` | ORG_MANAGER | Verify tariff belongs to `org_id` |
| `GET` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) |
| `POST` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) |
| `GET` | `/users` | ORG_MANAGER | Scoped to `org_id` |
| `POST` | `/users` | ORG_MANAGER | User created in caller's `org_id` |

### Middleware Chain

```
Request Flow:
┌──────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ API GW   │───►│ Cognito      │───►│ Middy         │───►│ Handler      │
│ receives │    │ Authorizer   │    │ Middleware     │    │ (business    │
│ request  │    │ (JWT verify) │    │ Chain          │    │  logic)      │
└──────────┘    └──────────────┘    └───────────────┘    └──────────────┘
                 validates JWT       1. extractTenant()   receives
                 rejects invalid     2. requireRole()     TenantContext
                 tokens              3. requireRecentAuth() (for write ops)
                                     4. logRequest()
                                     5. errorHandler()
```

### Lambda Handlers

```
src/bff/
├── handlers/
│   ├── get-dashboard.ts          # GET /dashboard — aggregated KPI data
│   ├── get-assets.ts             # GET /assets — list all assets
│   ├── get-asset-detail.ts       # GET /assets/:id — single asset + analytics
│   ├── get-trades.ts             # GET /trades — today's trade schedule
│   ├── post-dispatch.ts          # POST /dispatch — trigger batch mode change
│   ├── post-dr-test.ts           # POST /dr-test — trigger DR test
│   ├── get-dispatch-status.ts    # GET /dispatch/:id — poll dispatch progress
│   └── get-revenue-trend.ts      # GET /revenue/trend — 7-day revenue chart
├── middleware/
│   ├── tenant-context.ts         # JWT → TenantContext extraction
│   ├── cors.ts                   # CORS headers
│   └── rate-limit.ts             # API throttling
└── __tests__/
    ├── get-dashboard.test.ts
    └── post-dispatch.test.ts
```

---

## 9. Module 6: Identity & Tenant Management (IAM)

### CDK Stack: `AuthStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| User Pool | Cognito User Pool | User authentication, password policy, MFA |
| User Pool Groups | Cognito Groups | RBAC role assignment (4 roles) |
| App Client (Dashboard) | Cognito App Client | Browser-based auth (Authorization Code Grant) |
| SAML Provider | Cognito Identity Provider (SAML 2.0) | Azure AD / Microsoft Entra federation |
| OIDC Provider | Cognito Identity Provider (OIDC) | Okta / Google Workspace federation |
| Pre-Token Lambda | Lambda (Node.js 20) | Inject `org_id` into federated user JWTs |
| Federated Mappings | DynamoDB | Map federated users → org_id + role |
| HTTP Authorizer | API GW v2 Authorizer | Cognito JWT verification for BFF routes |

### IAM Grants

```
AuthStack resources:
  ├─ Pre-Token Lambda:
  │   ├─ dynamodb:GetItem          → federated_user_mappings table
  │   └─ logs:CreateLogGroup       → CloudWatch Logs
  ├─ Cognito User Pool:
  │   └─ lambda:InvokeFunction     → Pre-Token Lambda trigger
  └─ AuthStack outputs:
      ├─ userPool, userPoolClient  → consumed by BffStack, OpenApiStack
      └─ authorizer                → consumed by BffStack
```

### EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `OrgProvisioned` | → M4 (seed org in PostgreSQL), M1 (create IoT thing group) |
| **Publishes** | `UserCreated` | → Audit log |

### org_id Integration

- `custom:org_id` is a Cognito custom attribute (immutable after user creation)
- Pre-Token-Generation Lambda injects `org_id` for federated SSO users
- `federated_user_mappings` DynamoDB table maps external IdP emails → org_id + role

### Role Hierarchy (RBAC)

```
┌─────────────────────────────────────────────────────────────┐
│                     SOLFACIL_ADMIN                          │
│  Platform-level superuser. Can see ALL organizations.      │
│  custom:org_id = "SOLFACIL"                                │
│  Intended for: SOLFACIL internal operations team           │
├─────────────────────────────────────────────────────────────┤
│                     ORG_MANAGER                             │
│  Organization-level admin. Full control over their own org.│
│  Intended for: Enterprise client's energy manager          │
├─────────────────────────────────────────────────────────────┤
│                     ORG_OPERATOR                            │
│  Can dispatch commands and monitor within their org.       │
│  Intended for: Field technicians, dispatch operators       │
├─────────────────────────────────────────────────────────────┤
│                     ORG_VIEWER                              │
│  Read-only access to dashboards and reports within org.    │
│  Intended for: Executives, auditors, read-only stakeholders│
└─────────────────────────────────────────────────────────────┘
```

### Permission Matrix

| Permission | SOLFACIL_ADMIN | ORG_MANAGER | ORG_OPERATOR | ORG_VIEWER |
|------------|:-:|:-:|:-:|:-:|
| View dashboard (own org) | all orgs | own org | own org | own org |
| View assets | all orgs | own org | own org | own org |
| View trades & revenue | all orgs | own org | own org | own org |
| Dispatch mode change | all orgs | own org | own org | - |
| Trigger DR test | all orgs | own org | own org | - |
| Manage tariff config | all orgs | own org | - | - |
| Manage users in org | all orgs | own org | - | - |
| Create / delete organizations | yes | - | - | - |
| View audit logs (cross-org) | yes | - | - | - |

### Cognito User Pool CDK Definition

```typescript
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly authorizer: HttpUserPoolAuthorizer;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // ── Cognito User Pool ────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'VppUserPool', {
      userPoolName: resourceName(props.stage, 'UserPool'),
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      customAttributes: {
        org_id: new cognito.StringAttribute({
          mutable: false,
          minLen: 3,
          maxLen: 50,
        }),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Cognito Advanced Security ─────────────────────────────────
    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.userPoolAddOns = { advancedSecurityMode: 'ENFORCED' };

    // ── Role Groups ───────────────────────────────────────────────
    const roles = ['SOLFACIL_ADMIN', 'ORG_MANAGER', 'ORG_OPERATOR', 'ORG_VIEWER'];
    for (const role of roles) {
      new cognito.CfnUserPoolGroup(this, `Group${role}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: role,
        description: `${role} role group`,
      });
    }

    // ── App Client (Dashboard) ────────────────────────────────────
    this.userPoolClient = this.userPool.addClient('DashboardClient', {
      userPoolClientName: resourceName(props.stage, 'DashboardClient'),
      authFlows: { userPassword: true, userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:3000/callback', 'https://vpp.solfacil.com.br/callback'],
        logoutUrls: ['http://localhost:3000/', 'https://vpp.solfacil.com.br/'],
      },
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ── HTTP API Authorizer ───────────────────────────────────────
    this.authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', this.userPool, {
      userPoolClients: [this.userPoolClient],
      identitySource: '$request.header.Authorization',
    });

    // ── Pre-Token-Generation Lambda Trigger ───────────────────────
    const preTokenFn = new lambda.Function(this, 'PreTokenGeneration', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'pre-token-generation.handler',
      code: lambda.Code.fromAsset('src/auth/triggers'),
    });
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenFn,
    );
  }
}
```

### Enterprise SSO Federation

#### SAML 2.0 (Azure AD / Microsoft Entra ID)

```typescript
const azureAdProvider = new cognito.UserPoolIdentityProviderSaml(
  this, 'AzureAdSamlProvider', {
    userPool: this.userPool,
    name: 'AzureAD',
    metadata: cognito.UserPoolIdentityProviderSamlMetadata.url(
      'https://login.microsoftonline.com/<tenant-id>/federationmetadata/2007-06/federationmetadata.xml'
    ),
    attributeMapping: {
      email: cognito.ProviderAttribute.other(
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
      ),
      custom: {
        'custom:idp_sub': cognito.ProviderAttribute.other(
          'http://schemas.microsoft.com/identity/claims/objectidentifier'
        ),
      },
    },
    idpSignout: true,
  }
);
```

#### OIDC (Okta / Google Workspace)

```typescript
const oktaProvider = new cognito.UserPoolIdentityProviderOidc(
  this, 'OktaOidcProvider', {
    userPool: this.userPool,
    name: 'Okta',
    clientId: ssm.StringParameter.valueForStringParameter(this, '/solfacil/auth/okta/client-id'),
    clientSecret: ssm.StringParameter.valueForStringParameter(this, '/solfacil/auth/okta/client-secret'),
    issuerUrl: 'https://your-domain.okta.com/oauth2/default',
    scopes: ['openid', 'email', 'profile', 'groups'],
    attributeMapping: {
      email: cognito.ProviderAttribute.other('email'),
      custom: { 'custom:idp_sub': cognito.ProviderAttribute.other('sub') },
    },
    attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
  }
);
```

#### Federated User Mapping (Pre-Token-Generation Lambda)

For federated users, `custom:org_id` is not set at login time. The Pre-Token-Generation trigger injects org_id and role from a DynamoDB mapping table:

```typescript
export const handler = async (event: CognitoUserPoolTriggerEvent) => {
  const email = event.request.userAttributes.email;
  const mapping = await dynamodb.get({
    TableName: 'federated_user_mappings',
    Key: { email },
  }).promise();

  if (mapping.Item) {
    event.response.claimsOverrideDetails = {
      claimsToAddOrOverride: { 'custom:org_id': mapping.Item.org_id },
      groupOverrideDetails: { groupsToOverride: [mapping.Item.role] },
    };
  }
  return event;
};
```

**DynamoDB: `federated_user_mappings`**

| PK (email) | org_id | role | idp_name | provisioned_at |
|------------|--------|------|----------|----------------|
| joao@energiacorp.com.br | ORG_ENERGIA_001 | ORG_MANAGER | AzureAD | 2026-02-20 |
| maria@solarbr.com.br | ORG_SOLARBR_002 | ORG_OPERATOR | Okta | 2026-02-20 |

#### SSO Fallback Strategy

1. **Detection:** Cognito returns `SAML_PROVIDER_ERROR` or OIDC token exchange failure
2. **Fallback:** Users are redirected to the standard Cognito login page
3. **Emergency credentials:** ORG_MANAGER users have local Cognito passwords as break-glass
4. **Monitoring:** CloudWatch alarm on `FederationErrors` metric → SNS notification

```typescript
new cloudwatch.Alarm(this, 'SsoFailureAlarm', {
  metric: this.userPool.metric('FederationErrors', {
    period: cdk.Duration.minutes(5),
    statistic: 'Sum',
  }),
  threshold: 5,
  evaluationPeriods: 1,
  alarmDescription: 'SSO federation errors exceeding threshold',
  alarmActions: [snsAlertTopic],
});
```

### Multi-Factor Authentication (MFA)

| Role | MFA Requirement | Method | Rationale |
|------|----------------|--------|-----------|
| SOLFACIL_ADMIN | **Mandatory** | TOTP | Platform-wide access; highest privilege |
| ORG_MANAGER | **Mandatory** | TOTP | Can dispatch and manage users |
| ORG_OPERATOR | **Mandatory** | TOTP | Can dispatch mode changes to physical assets |
| ORG_VIEWER | Optional | TOTP | Read-only; lower compromise impact |

**TOTP over SMS:** TOTP is offline (no SIM-swap risk), free, works without cell signal, and meets NIST SP 800-63B Level 2.

### Step-Up Authentication (Sensitive Operations)

```typescript
/**
 * Middy middleware: requires recent MFA for dispatch and management operations.
 * If auth_time is older than maxAge, returns 401 with step-up challenge.
 */
export function requireRecentAuth(
  maxAgeSeconds: number = 900 // 15 minutes
): middy.MiddlewareObj<APIGatewayProxyEventV2> {
  return {
    before: async (request) => {
      const claims = request.event.requestContext?.authorizer?.jwt?.claims;
      const authTime = Number(claims?.auth_time ?? 0);
      const now = Math.floor(Date.now() / 1000);
      if (now - authTime > maxAgeSeconds) {
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: 'step_up_required',
            message: 'This operation requires recent authentication. Please re-authenticate.',
          }),
        };
      }
    },
  };
}
```

### Lambda Handlers

```
src/auth/
├── triggers/
│   └── pre-token-generation.ts   # Cognito trigger: inject org_id for federated users
├── handlers/
│   ├── provision-org.ts          # POST /admin/organizations — create new org
│   ├── create-user.ts            # POST /users — create user in caller's org
│   └── list-users.ts             # GET /users — list org users
└── __tests__/
    ├── pre-token-generation.test.ts
    └── provision-org.test.ts
```

---

## 10. Module 7: Open API & Integration

### CDK Stack: `OpenApiStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| API Gateway (M2M) | API Gateway v2 (HTTP API) | **Separate** from BFF — for external integrations |
| Resource Server | Cognito Resource Server | OAuth 2.0 scopes: `solfacil/read`, `solfacil/dispatch`, `solfacil/billing` |
| Machine Client(s) | Cognito App Client | Client Credentials flow (no user login) |
| Usage Plans | API Gateway Usage Plans | Per-client rate limiting and quotas |
| WAF WebACL | AWS WAF v2 | OWASP Core Rule Set, SQLi protection, IP rate limiting |
| Webhook Subscriptions | DynamoDB | Self-service webhook registration |
| Webhook Connections | EventBridge Connection | Auth credentials for outbound webhooks |
| API Destinations | EventBridge API Destination | Target URL + rate limit for outbound webhooks |
| Signing Proxy | Lambda (Node.js 20) | HMAC-SHA256 webhook payload signing |
| Webhook DLQ | SQS Queue | Failed webhook delivery (14-day retention) |

### IAM Grants

```
OpenApiStack resources:
  ├─ M2M Lambda functions:
  │   ├─ rds-data:ExecuteStatement  → read-only queries
  │   ├─ dynamodb:Query             → dispatch_tracker, webhook_subscriptions
  │   └─ timestream:Select          → device_telemetry
  ├─ Signing Proxy Lambda:
  │   └─ secretsmanager:GetSecret   → webhook HMAC secrets
  ├─ Webhook CRUD Lambda:
  │   ├─ dynamodb:PutItem/Query/Delete → webhook_subscriptions
  │   ├─ events:PutRule/PutTargets     → dynamic EventBridge rules
  │   └─ secretsmanager:CreateSecret   → per-webhook HMAC secrets
  └─ WAF WebACL:
      └─ Associated with M2M API Gateway stage
```

### EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Consumes** | `DRDispatchCompleted` | ← M3 → webhook delivery to external systems |
| **Consumes** | `InvoiceGenerated` | ← M4 → webhook delivery to billing systems |
| **Consumes** | `AssetModeChanged` | ← M3 → webhook delivery to monitoring systems |
| **Consumes** | `TariffUpdated` | ← M4 → webhook delivery to trading platforms |
| **Consumes** | `AlertTriggered` | ← M1 → webhook delivery to on-call systems |

### org_id Integration

- M2M tokens have no `custom:org_id`; org_id is resolved from a `m2m_client_config` DynamoDB table
- `validateM2MScope()` middleware maps client_id → org_id + scopes
- Webhook EventBridge rules are tenant-scoped: `detail.org_id = [tenantContext.orgId]`
- Webhook subscriptions table uses `org_id` as partition key

### M2M Authentication — Two Options

#### Option A: API Keys + Usage Plans (Low-Security Integrations)

```typescript
const usagePlan = api.addUsagePlan('ExternalPartnerPlan', {
  name: 'external-partner-plan',
  throttle: { rateLimit: 50, burstLimit: 100 },
  quota: { limit: 10_000, period: apigateway.Period.DAY },
});
const partnerKey = api.addApiKey('EnergiaCorpApiKey', {
  apiKeyName: 'energia-corp-erp',
});
usagePlan.addApiKey(partnerKey);
```

#### Option B: OAuth 2.0 Client Credentials (Enterprise Standard)

```typescript
// Resource Server with scoped access
const resourceServer = this.userPool.addResourceServer('VppApi', {
  identifier: 'solfacil',
  userPoolResourceServerName: 'Solfacil VPP API',
  scopes: [
    new cognito.ResourceServerScope({ scopeName: 'read',     scopeDescription: 'Read assets, telemetry, trades' }),
    new cognito.ResourceServerScope({ scopeName: 'dispatch',  scopeDescription: 'Dispatch mode changes and DR' }),
    new cognito.ResourceServerScope({ scopeName: 'billing',   scopeDescription: 'Billing, revenue, tariff data' }),
  ],
});

// Machine Client (Client Credentials flow)
const machineClient = this.userPool.addClient('EnergiaCorp-ERP', {
  userPoolClientName: 'energia-corp-erp-m2m',
  generateSecret: true,
  oAuth: {
    flows: { clientCredentials: true },
    scopes: [
      cognito.OAuthScope.custom('solfacil/read'),
      cognito.OAuthScope.custom('solfacil/billing'),
    ],
  },
  accessTokenValidity: cdk.Duration.hours(1),
});
```

#### Recommendation Matrix

| Use Case | Recommended | Rationale |
|----------|-------------|-----------|
| Internal Solfacil ERP | Client Credentials | Sensitive billing data; scoped access |
| External energy aggregator | Client Credentials | Third-party trust boundary; revocable tokens |
| Energy trading platform | Client Credentials | Financial transactions; audit trail required |
| Monitoring / health-check | API Key | Low-sensitivity read-only; simpler setup |

### Rate Limiting & Quota Tiers

| Tier | Rate Limit | Burst | Daily Quota | Monthly Quota |
|------|-----------|-------|-------------|---------------|
| Standard | 50 rps | 100 | 10,000 | 300,000 |
| Professional | 200 rps | 400 | 100,000 | 3,000,000 |
| Enterprise | 500 rps | 1,000 | Unlimited | Unlimited |

### WAF WebACL

```typescript
const webAcl = new wafv2.CfnWebACL(this, 'VppApiWaf', {
  name: resourceName(props.stage, 'VppApiWaf'),
  scope: 'REGIONAL',
  defaultAction: { allow: {} },
  visibilityConfig: {
    sampledRequestsEnabled: true,
    cloudWatchMetricsEnabled: true,
    metricName: 'VppApiWaf',
  },
  rules: [
    {
      name: 'AWS-AWSManagedRulesCommonRuleSet',
      priority: 1,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
      },
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'CommonRuleSet' },
    },
    {
      name: 'AWS-AWSManagedRulesSQLiRuleSet',
      priority: 2,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesSQLiRuleSet' },
      },
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'SQLiRuleSet' },
    },
    {
      name: 'RateLimit',
      priority: 3,
      action: { block: {} },
      statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'RateLimit' },
    },
  ],
});
```

### Event-Driven Webhooks

#### Architecture

```
Internal Event ──► EventBridge ──► Rule (org-scoped) ──► Signing Proxy Lambda ──► API Destination ──► External System
                                                                                         │
                                                                                  (Retry up to 185x / 24h)
                                                                                         │
                                                                                  ──► SQS DLQ (on exhaustion)
```

#### Webhook-Eligible Events

| Event | Typical Subscribers |
|-------|-------------------|
| `DRDispatchCompleted` | Billing systems, grid operator dashboards |
| `DRDispatchFailed` | Monitoring/alerting platforms |
| `InvoiceGenerated` | Customer ERP, accounting systems |
| `AssetModeChanged` | Monitoring dashboards, aggregator platforms |
| `AlertTriggered` | On-call notification systems |
| `TariffUpdated` | Trading platforms, customer portals |

#### HMAC-SHA256 Webhook Signing

Every outbound webhook includes two custom headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Solfacil-Signature` | `sha256=<hex-digest>` | HMAC-SHA256 of the raw body |
| `X-Solfacil-Timestamp` | Unix timestamp | Prevents replay attacks |

Signature computation:
```
signature = HMAC-SHA256(key=webhook_secret, message=timestamp + "." + raw_body)
```

Receivers should reject webhooks where the timestamp is older than 5 minutes.

```typescript
async function signWebhookPayload(
  payload: Record<string, unknown>,
  secretArn: string,
): Promise<SignedWebhookResult> {
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  const webhookSecret = secretResponse.SecretString!;
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Solfacil-Signature': `sha256=${signature}`,
      'X-Solfacil-Timestamp': timestamp,
    },
    body,
  };
}
```

#### DynamoDB: `webhook_subscriptions`

```
Table: webhook_subscriptions
PK: org_id (String)          — Partition key (tenant isolation)
SK: webhook_id (String)      — Sort key (ULID — "WH_01HWXYZ...")
Attributes:
  url           (String)     — Target URL for webhook POST
  events        (StringSet)  — Subscribed event types
  secret_arn    (String)     — ARN of HMAC secret in Secrets Manager
  rule_name     (String)     — Dynamically created EventBridge rule name
  status        (String)     — "active" | "paused" | "failed"
  created_at    (String)     — ISO 8601
  updated_at    (String)     — ISO 8601
```

#### Webhook Management API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/webhooks` | ORG_MANAGER | Register a new webhook subscription |
| `GET` | `/webhooks` | ORG_MANAGER | List org's webhook subscriptions |
| `GET` | `/webhooks/{id}` | ORG_MANAGER | Get a specific webhook |
| `DELETE` | `/webhooks/{id}` | ORG_MANAGER | Delete a webhook subscription |

#### Retry Policy and Dead Letter Queue

| Retry Phase | Attempts | Interval | Total Duration |
|-------------|----------|----------|---------------|
| Immediate | 1-5 | 1-30 seconds | ~2 minutes |
| Short backoff | 6-50 | 30s-5min | ~3 hours |
| Long backoff | 51-185 | 5min-30min | ~24 hours |

After 185 retries (24h), failed events go to the SQS Dead Letter Queue (14-day retention).

### Lambda Handlers

```
src/open-api/
├── handlers/
│   ├── m2m-get-assets.ts         # M2M: GET /v1/assets
│   ├── m2m-get-telemetry.ts      # M2M: GET /v1/telemetry
│   ├── m2m-get-dispatches.ts     # M2M: GET /v1/dispatches
│   ├── webhook-create.ts         # POST /webhooks
│   ├── webhook-list.ts           # GET /webhooks
│   ├── webhook-delete.ts         # DELETE /webhooks/{id}
│   └── webhook-signing-proxy.ts  # EventBridge → sign → API Destination
├── middleware/
│   └── m2m-scope.ts              # validateM2MScope() + client→org_id resolution
└── __tests__/
    ├── m2m-scope.test.ts
    └── webhook-create.test.ts
```

---

## 11. Core Event Flow Examples

### 11.1 DR Test Command Flow (Frontend → Edge Device)

```
Step  Component              Action
----- ---------------------- -------------------------------------------------
 1    Frontend (Dashboard)   POST /dr-test { targetMode: "peak_valley_arbitrage" }
                             Headers: Authorization: Bearer <Cognito JWT>

 2    API Gateway (M5)       Cognito Authorizer validates JWT → role=ORG_OPERATOR
                             extractTenantContext() → org_id=ORG_ENERGIA_001
                             requireRecentAuth() → auth_time within 15 min
                             Route → Lambda: post-dr-test

 3    BFF Lambda             Validates payload
      (post-dr-test)         Queries assets WHERE org_id = 'ORG_ENERGIA_001'
                             Creates dispatch_id (ULID)
                             Publishes event to EventBridge:
                             {
                               source: "solfacil.bff",
                               detail-type: "DRCommandIssued",
                               detail: {
                                 org_id: "ORG_ENERGIA_001",
                                 dispatch_id: "01HWXYZ...",
                                 command_type: "DR_TEST",
                                 target_mode: "peak_valley_arbitrage",
                                 asset_ids: ["ASSET_SP_001", "ASSET_RJ_002", ...],
                                 requested_by: "operador@energiacorp.com.br",
                               }
                             }
                             Returns: { dispatch_id, status: "ACCEPTED" }

 4    EventBridge            Rule: detail-type = "DRCommandIssued"
                             Target: M3 Lambda (dispatch-command)

 5    DR Dispatcher          For each asset_id in parallel:
                               a. Write PENDING to DynamoDB (with org_id)
                               b. MQTT publish: solfacil/ORG_ENERGIA_001/SP/ASSET_SP_001/command/mode-change
                               c. Update status → EXECUTING
                               d. Enqueue SQS delayed message (15 min timeout)

 6    IoT Core MQTT          Delivers to edge devices (QoS 1, ~50-200ms)

 7    Edge Devices           Execute mode change, publish response to response topic

 8    IoT Core Rule          SELECT * FROM 'solfacil/+/+/+/response/mode-change'
                             → M3 Lambda (collect-response)

 9    DR Dispatcher          Updates DynamoDB: status → SUCCESS, metrics recorded
      (collect-response)     When all assets complete → publishes DRDispatchCompleted

10    EventBridge            Fan-out DRDispatchCompleted:
                             → M4 (financial settlement)
                             → M5 (future: WebSocket push)
                             → M7 (webhook delivery to external systems)

11    Frontend               Polls GET /dispatch/{id} every 2 seconds
                             Renders progress bars, latency, accuracy per asset
```

### 11.2 Telemetry Ingestion Flow

```
Edge Device → MQTT publish (solfacil/{org_id}/{region}/{asset_id}/telemetry)
    → IoT Core Rule (extract org_id, region, asset_id from topic)
    → M1 Lambda (ingest-telemetry)
        → Batch write to Timestream (with org_id dimension)
        → Publish EventBridge: "TelemetryReceived" (with org_id)
            → M2 Lambda (evaluate-forecast): update MAPE
            → M5 (future: push via WebSocket)
```

### 11.3 Scheduled Optimization Flow

```
EventBridge Schedule (every 15 min)
    → M2 Lambda (run-schedule)
        → Query Timestream for latest SoC (per org)
        → Query M4 for current tariff (per org)
        → Compute optimal schedule (per org)
        → Publish "ScheduleGenerated" (with org_id)
            → M1 Lambda (schedule-to-shadow): write schedule to Device Shadow
            → M3 Lambda (dispatch-command): execute immediate mode changes
            → M4 Lambda: record expected revenue
```

### 11.4 Webhook Delivery Flow

```
M3 publishes DRDispatchCompleted (org_id=ORG_ENERGIA_001)
    → EventBridge rule: webhook-ORG_ENERGIA_001-WH_01HWXYZ
        matches: source=solfacil.vpp.*, detail.org_id=ORG_ENERGIA_001
    → M7 Lambda (webhook-signing-proxy)
        → Fetch HMAC secret from Secrets Manager
        → Sign payload with HMAC-SHA256
        → Attach X-Solfacil-Signature + X-Solfacil-Timestamp headers
    → API Destination: POST https://billing.partner.com/webhooks/solfacil
        → 200 OK → done
        → 5xx   → retry (up to 185 attempts / 24h)
        → Exhausted → SQS DLQ → CloudWatch alarm → on-call notification
```

---

## 12. Unified CDK Deployment Plan

### 7 Phases

```
Phase 0: SharedStack ──► Phase 1: AuthStack ──► Phase 2: IotHub + Algorithm
                                                         │
                                                         ▼
                                              Phase 3: DrDispatcher + MarketBilling
                                                         │
                                                         ▼
                                              Phase 4: BffStack (Cognito authorizer)
                                                         │
                                                         ▼
                                              Phase 5: OpenApiStack (M2M + Webhooks)
                                                         │
                                                         ▼
                                              Phase 6: Business Logic Implementation
```

### Phase 0: SharedStack

**Purpose:** Foundation resources shared by all modules.

```typescript
export class SharedStack extends cdk.Stack {
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: SharedStackProps) {
    super(scope, id, props);

    this.eventBus = new events.EventBus(this, 'VppEventBus', {
      eventBusName: 'solfacil-vpp-events',
    });

    // EventBridge Archive (30-day replay for debugging)
    new events.Archive(this, 'VppEventArchive', {
      sourceEventBus: this.eventBus,
      eventPattern: { source: [{ prefix: 'solfacil' }] },
      retention: cdk.Duration.days(30),
    });

    // SSM parameters for cross-stack configuration
    new ssm.StringParameter(this, 'EventBusArn', {
      parameterName: '/solfacil/shared/event-bus-arn',
      stringValue: this.eventBus.eventBusArn,
    });
  }
}
```

**Key resources:** EventBridge bus, Archive, SSM parameters.

### Phase 1: AuthStack (M6 — Identity & Tenant)

**Purpose:** Cognito User Pool, groups, SSO providers, MFA, Pre-Token Lambda.

**Key resources:** Cognito User Pool, App Client, SAML/OIDC providers, Pre-Token-Generation Lambda trigger, `federated_user_mappings` DynamoDB table.

**Why first:** All subsequent stacks that handle API requests need the Cognito authorizer. Deploying auth first ensures every endpoint is protected from day one.

**Outputs consumed by:** BffStack (authorizer), OpenApiStack (Resource Server, Machine Clients).

### Phase 2: IotHubStack (M1) + AlgorithmStack (M2)

**Purpose:** Device connectivity and optimization intelligence.

**Key resources:**
- M1: IoT Core rules, Timestream database/table, ingestion Lambda, shadow-sync Lambda
- M2: EventBridge Scheduler, optimizer Lambda, SSM config parameters

**Dependencies:** SharedStack (EventBridge bus).

### Phase 3: DrDispatcherStack (M3) + MarketBillingStack (M4)

**Purpose:** Command dispatch and financial data.

**Key resources:**
- M3: DynamoDB `dispatch_tracker` (with `org-dispatch-index` GSI), dispatch Lambda, SQS timeout queue
- M4: RDS Serverless v2 PostgreSQL, `organizations` table, all schema migrations with `org_id`

**Dependencies:** SharedStack (EventBridge), IoT Core (M1 for MQTT publishing).

### Phase 4: BffStack (M5)

**Purpose:** Dashboard REST API with Cognito authorization.

**Key resources:** API Gateway v2 (HTTP API), Cognito Authorizer (from AuthStack), Lambda handlers with `extractTenantContext()` middleware.

**Dependencies:** AuthStack (authorizer), all data-layer stacks (M1-M4 for read queries).

### Phase 5: OpenApiStack (M7)

**Purpose:** External API access and webhook delivery.

**Key resources:** Separate API Gateway (M2M), Cognito Resource Server + Machine Clients, WAF WebACL, DynamoDB `webhook_subscriptions`, EventBridge API Destinations, signing proxy Lambda, webhook DLQ.

**Dependencies:** AuthStack (Cognito User Pool for Resource Server), SharedStack (EventBridge for webhook rules).

### Phase 6: Business Logic Implementation

**Purpose:** Implement actual business logic in each module's Lambda handlers (per module, after all IaC is verified).

**Implementation order:**
1. M4 handlers (tariff engine, revenue calculator) — enables dashboard financial data
2. M5 handlers (BFF) — connects frontend to real APIs
3. M1 handlers (telemetry ingestion) — real device data flow
4. M2 handlers (optimization algorithm) — schedule generation
5. M3 handlers (dispatch, response collection) — real DR commands
6. M6 handlers (org provisioning, user management) — admin operations
7. M7 handlers (M2M endpoints, webhook CRUD) — external integration

### CDK Entry Point (`bin/app.ts`)

```typescript
const app = new cdk.App();
const stage = app.node.tryGetContext('stage') ?? 'dev';

// Phase 0: Shared
const shared = new SharedStack(app, `SolfacilVpp-${stage}-Shared`, { stage });

// Phase 1: Auth (M6)
const auth = new AuthStack(app, `SolfacilVpp-${stage}-Auth`, { stage });

// Phase 2: IoT + Algorithm (M1, M2)
const iotHub = new IotHubStack(app, `SolfacilVpp-${stage}-IotHub`, {
  stage, eventBus: shared.eventBus,
});
const algorithm = new AlgorithmStack(app, `SolfacilVpp-${stage}-Algorithm`, {
  stage, eventBus: shared.eventBus,
});

// Phase 3: DR + Billing (M3, M4)
const drDispatcher = new DrDispatcherStack(app, `SolfacilVpp-${stage}-DrDispatcher`, {
  stage, eventBus: shared.eventBus,
});
const marketBilling = new MarketBillingStack(app, `SolfacilVpp-${stage}-MarketBilling`, {
  stage, eventBus: shared.eventBus,
});

// Phase 4: BFF (M5)
const bff = new BffStack(app, `SolfacilVpp-${stage}-Bff`, {
  stage, eventBus: shared.eventBus,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  authorizer: auth.authorizer,
});

// Phase 5: Open API (M7)
const openApi = new OpenApiStack(app, `SolfacilVpp-${stage}-OpenApi`, {
  stage, eventBus: shared.eventBus,
  userPool: auth.userPool,
});
```

---

## 13. Backend Directory Structure

```
backend/
├── README.md
├── package.json                          # Monorepo root (npm workspaces)
├── tsconfig.base.json                    # Shared TypeScript config
├── cdk.json                              # CDK app entry point
├── jest.config.ts                        # Root test config
│
├── bin/
│   └── app.ts                            # CDK App: instantiates all 8 stacks
│
├── lib/                                  # CDK Stack definitions (7 phases)
│   ├── shared/
│   │   ├── event-bus.ts                  # Shared EventBridge bus construct
│   │   ├── event-schemas.ts              # Event type definitions (VppEvent<T> with org_id)
│   │   └── constants.ts                  # Account, region, naming conventions
│   │
│   ├── shared-stack.ts                   # Phase 0: SharedStack
│   ├── auth-stack.ts                     # Phase 1: M6 — Cognito, SSO, MFA
│   ├── iot-hub-stack.ts                  # Phase 2: M1 — IoT Core + Timestream
│   ├── algorithm-stack.ts               # Phase 2: M2 — Scheduler + Algorithm
│   ├── dr-dispatcher-stack.ts           # Phase 3: M3 — Dispatch + SQS + DynamoDB
│   ├── market-billing-stack.ts          # Phase 3: M4 — RDS + billing
│   ├── bff-stack.ts                     # Phase 4: M5 — API GW + Cognito authorizer
│   └── open-api-stack.ts               # Phase 5: M7 — M2M API + WAF + Webhooks
│
├── src/                                  # Lambda handler source code
│   ├── shared/                           # Cross-cutting concerns
│   │   ├── event-bridge-client.ts
│   │   ├── logger.ts                     # Structured logging (Powertools)
│   │   ├── middleware.ts                 # Middy middleware chain
│   │   ├── errors.ts                     # Custom error classes
│   │   └── types/
│   │       ├── asset.ts
│   │       ├── tariff.ts
│   │       ├── telemetry.ts
│   │       ├── events.ts                 # Event payload interfaces (with org_id)
│   │       └── auth.ts                   # TenantContext, Role types
│   │
│   ├── iot-hub/                          # Module 1
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   └── __tests__/ ...
│   │
│   ├── optimization-engine/              # Module 2
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   └── __tests__/ ...
│   │
│   ├── dr-dispatcher/                    # Module 3
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   └── __tests__/ ...
│   │
│   ├── market-billing/                   # Module 4
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   ├── migrations/ ...
│   │   └── __tests__/ ...
│   │
│   ├── bff/                              # Module 5
│   │   ├── handlers/ ...
│   │   ├── middleware/
│   │   │   ├── tenant-context.ts         # extractTenantContext(), requireRole()
│   │   │   ├── cors.ts
│   │   │   └── rate-limit.ts
│   │   └── __tests__/ ...
│   │
│   ├── auth/                             # Module 6
│   │   ├── triggers/
│   │   │   └── pre-token-generation.ts
│   │   ├── handlers/ ...
│   │   └── __tests__/ ...
│   │
│   └── open-api/                         # Module 7
│       ├── handlers/ ...
│       ├── middleware/
│       │   └── m2m-scope.ts              # validateM2MScope()
│       └── __tests__/ ...
│
├── test/                                 # CDK infrastructure tests
│   ├── shared-stack.test.ts
│   ├── auth-stack.test.ts
│   ├── iot-hub-stack.test.ts
│   ├── dr-dispatcher-stack.test.ts
│   ├── bff-stack.test.ts
│   ├── open-api-stack.test.ts
│   └── event-routing.test.ts
│
└── scripts/
    ├── seed-tariffs.ts                   # Seed Tarifa Branca data into RDS
    ├── seed-users.ts                     # Seed test users in Cognito
    ├── simulate-telemetry.ts             # Local MQTT simulator for dev
    └── deploy.sh                         # Multi-stack deployment script
```

---

## 14. Observability

| Layer | Tool | Purpose |
|-------|------|---------|
| Structured Logging | AWS Lambda Powertools (TS) | Correlation IDs, JSON logs, `dispatch_id` + `org_id` tracing |
| Metrics | CloudWatch Embedded Metrics | Latency, error rates, invocation counts per module |
| Tracing | AWS X-Ray | End-to-end request tracing across Lambda + EventBridge |
| Dashboards | CloudWatch Dashboards | Operational dashboard per bounded context |
| Alerting | CloudWatch Alarms + SNS | DR dispatch failure rate > 10%, Lambda errors, SSO failures, webhook DLQ |
| Event Audit | EventBridge Archive | Replay events for debugging (30-day retention) |
| Security Audit | CloudWatch Logs Insights | Structured audit logs for all write operations |

### Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| DR dispatch response latency P95 | M3 | > 5s |
| DR dispatch accuracy % | M3 | < 90% |
| Optimization Alpha trend | M2 | < 70% |
| Forecast MAPE trend | M2 | > 15% |
| Revenue per asset per day | M4 | — (dashboard only) |
| MQTT delivery success rate | M1 | < 99% |
| SSO federation errors (5 min) | M6 | > 5 errors |
| API throttle rate (5 min) | M7 | > 100 rejections |
| WAF blocked requests (5 min) | M7 | > 50 blocks |
| Webhook DLQ depth | M7 | > 0 messages |

### Audit Log Format

All write operations (dispatch, tariff update, user management, webhook CRUD) emit structured audit logs:

```json
{
  "timestamp": "2026-02-20T14:30:00Z",
  "action": "DISPATCH_MODE_CHANGE",
  "actor": {
    "userId": "sub-uuid",
    "email": "operador@energiacorp.com.br",
    "orgId": "ORG_ENERGIA_001",
    "role": "ORG_OPERATOR"
  },
  "resource": { "type": "dispatch", "id": "01HWXYZ..." },
  "details": { "assetIds": ["ASSET_SP_001", "ASSET_RJ_002"], "targetMode": "peak_valley_arbitrage" }
}
```

---

## 15. Cost Estimation

### Pilot Scale (4 assets, ~3,000 devices, ~1M telemetry points/day)

| Service | Category | Monthly Cost (USD) |
|---------|----------|--------------------|
| IoT Core (MQTT messages) | M1 | ~$15 |
| Timestream (1M writes/day, 90d retention) | M1 | ~$40 |
| Lambda (all modules, ~500K invocations) | All | ~$5 |
| API Gateway (HTTP API, ~100K requests) | M5 | ~$1 |
| EventBridge (custom events) | Shared | ~$2 |
| DynamoDB (dispatch_tracker + webhook_subscriptions, on-demand) | M3/M7 | ~$5 |
| RDS Serverless v2 (0.5 ACU min) | M4 | ~$45 |
| Cognito (100 users, TOTP MFA) | M6 | Free tier |
| Cognito Advanced Security (100 MAU) | M6 | ~$5 |
| WAF WebACL (3 managed rules, ~100K requests) | M7 | ~$11 |
| EventBridge API Destinations (webhooks) | M7 | ~$1 |
| Secrets Manager (webhook secrets) | M7 | ~$2 |
| CloudWatch / X-Ray | Observability | ~$10 |
| **Total (Pilot)** | | **~$142/month** |

### Growth Scale Projections

| Scale | Devices | Monthly Est. (USD) |
|-------|---------|-------------------|
| Pilot | 3,000 | ~$142 |
| Growth (1K assets) | 10,000 | ~$450-600 |
| Production (10K assets) | 50,000 | ~$2,500-3,500 |

| Cost Driver at Scale | Notes |
|---------------------|-------|
| Timestream writes | Largest cost driver; consider magnetic-only retention for old data |
| IoT Core MQTT | Scales linearly with devices x message frequency |
| RDS ACU scaling | Serverless v2 auto-scales; monitor ACU usage |
| Cognito MAU | First 50K MAU at $0.0055/MAU; 50K+ at $0.0046/MAU |
| WAF requests | $0.60/1M requests after base fee |
| EventBridge API Destinations | $0.20/1M invocations (webhook deliveries) |

### Cost Optimization Strategies

1. **Timestream:** Reduce memory store retention from 24h to 6h if real-time queries don't need full day
2. **Lambda:** Use ARM64 (Graviton2) for 20% cost reduction on compute-heavy handlers (M2)
3. **DynamoDB:** Already using on-demand; no over-provisioning risk
4. **Cognito:** Stays in free tier under 50K MAU; beyond that, $0.0055/MAU is competitive vs. Auth0
5. **WAF:** Core rule set at $1/month per rule group is minimal; avoid custom rule sprawl

---

## 16. Security Posture Summary

### Zero-Trust Checklist

| Layer | Control | Status |
|-------|---------|--------|
| **Frontend → API Gateway** | Cognito JWT (ID token) | Enforced on all BFF routes |
| **M2M → API Gateway** | OAuth 2.0 Client Credentials or API Key | Enforced on all M2M routes |
| **API Gateway → WAF** | OWASP Core Rule Set + SQLi + IP rate limiting | Deployed on M7 API |
| **Lambda → AWS Services** | IAM Roles (least privilege per module) | No shared IAM roles |
| **PostgreSQL** | Row-Level Security (RLS) | Defense-in-depth on all tenant tables |
| **DynamoDB** | org_id as GSI partition key | All queries tenant-scoped |
| **Timestream** | org_id as mandatory dimension | All queries include WHERE org_id |
| **IoT Core → Edge Devices** | X.509 client certificates per device | Topics policy-restricted to org |
| **MQTT topics** | org_id in topic path | IoT policies scope to org namespace |
| **EventBridge** | Resource-based policies per bus | Only declared sources can publish |
| **Secrets Management** | Secrets Manager with 30-day rotation | RDS creds, API keys, webhook secrets |
| **MFA** | TOTP mandatory for dispatch-authority roles | Cognito User Pool: MFA REQUIRED |
| **Step-Up Auth** | Re-authentication within 15 min for sensitive ops | requireRecentAuth() middleware |
| **Audit Logging** | Structured JSON logs for all write operations | CloudWatch Logs Insights |
| **Webhook Security** | HMAC-SHA256 signature + timestamp anti-replay | X-Solfacil-Signature header |

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Horizontal privilege escalation | Middleware `org_id` filter + PostgreSQL RLS + DynamoDB GSI scoping |
| Vertical privilege escalation | `requireRole()` middleware + Cognito group enforcement |
| JWT tampering | API Gateway Cognito authorizer verifies against JWKS endpoint |
| Token theft via XSS | Tokens stored in memory (not localStorage); 1h TTL; HttpOnly cookies for refresh |
| CSRF | Bearer token in header (not cookies); CSRF not applicable |
| Insecure direct object reference | Ownership check returns 404 (not 403) for cross-org resources |
| Admin account compromise | MFA mandatory; Cognito Advanced Security (risk-based blocking) |
| Cross-tenant MQTT traffic | IoT Core policies restrict device certificates to org's topic namespace |
| API abuse / DDoS | WAF rate-based rules + API Gateway throttling + Usage Plan quotas |
| Webhook replay attack | HMAC-SHA256 includes timestamp; receivers reject > 5 min old |
| Webhook secret compromise | Secrets Manager 90-day rotation; 7-day dual-secret overlap |

### ISO 27001 Alignment Notes

| ISO 27001 Control | VPP Implementation |
|-------------------|-------------------|
| A.9 Access Control | Cognito RBAC (4 roles), MFA, step-up auth |
| A.10 Cryptography | TLS 1.3 (MQTT, HTTPS), HMAC-SHA256 (webhooks), encryption at rest (RDS, DynamoDB, Timestream) |
| A.12 Operations Security | CloudWatch alarms, structured audit logging, EventBridge Archive |
| A.13 Communications Security | IoT Core mTLS, VPC for RDS access, WAF for external API |
| A.14 System Acquisition | CDK IaC (version-controlled, peer-reviewed infrastructure) |
| A.18 Compliance | LGPD compliance via tenant isolation + audit trail |

### LGPD (Lei Geral de Protecao de Dados) Compliance Notes

Brazil's LGPD (equivalent to GDPR) requires:

1. **Data isolation** — Ensured by `org_id` across all data stores + RLS + IoT policies
2. **Data minimization** — Timestream retention: 24h memory + 90d magnetic; EventBridge Archive: 30 days
3. **Right to erasure** — Organization deletion workflow can purge all data by `org_id` (PostgreSQL CASCADE, DynamoDB batch delete, Timestream: records expire naturally)
4. **Consent & purpose** — Authentication captures consent at login; audit logs record all data access
5. **Data portability** — BFF API + M2M API provide standard JSON access to all org data
6. **Breach notification** — CloudWatch alarms + SNS escalation chain enables 72-hour breach notification SLA
7. **DPO access** — SOLFACIL_ADMIN role provides cross-org audit capability for the Data Protection Officer

---

## 17. Appendix: Event Catalog

All events flowing through the shared EventBridge bus (`solfacil-vpp-events`):

| Event | Source | Detail Type | Consumers | Frequency |
|-------|--------|-------------|-----------|-----------|
| `TelemetryReceived` | `solfacil.iot-hub` | TelemetryReceived | M2 | ~1M/day |
| `DeviceStatusChanged` | `solfacil.iot-hub` | DeviceStatusChanged | M4, M5, M7 | On change |
| `ScheduleGenerated` | `solfacil.optimization` | ScheduleGenerated | M1, M3, M4 | Every 15 min |
| `ForecastUpdated` | `solfacil.optimization` | ForecastUpdated | M5 | Hourly |
| `DRCommandIssued` | `solfacil.bff` | DRCommandIssued | M3 | On demand |
| `DRDispatchCompleted` | `solfacil.dr-dispatcher` | DRDispatchCompleted | M4, M5, M7 | On demand |
| `AssetModeChanged` | `solfacil.dr-dispatcher` | AssetModeChanged | M4, M7 | On demand |
| `ProfitCalculated` | `solfacil.market-billing` | ProfitCalculated | M5 | Daily |
| `InvoiceGenerated` | `solfacil.market-billing` | InvoiceGenerated | M5, M7 | Monthly |
| `TariffUpdated` | `solfacil.market-billing` | TariffUpdated | M2, M3, M7 | On admin change |
| `OrgProvisioned` | `solfacil.auth` | OrgProvisioned | M4, M1 | On admin action |
| `UserCreated` | `solfacil.auth` | UserCreated | Audit | On admin action |
| `AlertTriggered` | `solfacil.iot-hub` | AlertTriggered | M7 | On anomaly |
| `ConfigUpdated` | `solfacil.admin-control-plane` | ConfigUpdated | M1-M7 (config-refresh Lambdas) | On admin config change |

### Mandatory Event Envelope

Every event **must** include `org_id` in its detail payload:

```typescript
interface VppEventDetail {
  readonly org_id: string;  // MANDATORY — never omit
  readonly timestamp: string;
  // ...event-specific fields
}
```

### Edge Case: DRDispatchCompleted with Timeout

| Scenario | `aggregate.status` | Description |
|----------|-------------------|-------------|
| All devices respond | `SUCCESS` | Normal path |
| Some devices respond, some timeout | `PARTIAL_SUCCESS` | Mixed results; `failed_count > 0`, individual `error_reason: "TIMEOUT"` |
| All devices timeout | `FAILED` | Complete failure; no device responded within 15 min |

Example payload:
```json
{
  "source": "solfacil.dr-dispatcher",
  "detail-type": "DRDispatchCompleted",
  "detail": {
    "org_id": "ORG_ENERGIA_001",
    "dispatch_id": "01HWXYZ...",
    "command_type": "DR_TEST",
    "resolution": "TIMEOUT",
    "results": [
      { "asset_id": "ASSET_SP_001", "status": "SUCCESS", "latency": 1.73, "accuracy": 96.4 },
      { "asset_id": "ASSET_MG_003", "status": "FAILED", "error_reason": "TIMEOUT" }
    ],
    "aggregate": {
      "success_count": 2, "failed_count": 2, "timeout_count": 2,
      "avg_latency": 1.94, "total_power": 9.64, "avg_accuracy": 95.1,
      "status": "PARTIAL_SUCCESS"
    }
  }
}
```

---

## 18. Appendix: Cognito CLI & Test Users

### CLI Quick Reference

```bash
# Create a user (admin provisioning)
aws cognito-idp admin-create-user \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --user-attributes \
    Name=email,Value=joao@energiacorp.com.br \
    Name=email_verified,Value=true \
    Name=custom:org_id,Value=ORG_ENERGIA_001 \
  --temporary-password "TempPass123!"

# Add user to role group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --group-name ORG_MANAGER

# List users in an org
aws cognito-idp list-users \
  --user-pool-id sa-east-1_XXXXXXX \
  --filter 'custom:org_id = "ORG_ENERGIA_001"'

# List users in a role group
aws cognito-idp list-users-in-group \
  --user-pool-id sa-east-1_XXXXXXX \
  --group-name SOLFACIL_ADMIN
```

### Test User Seed Data

| Email | Org | Role | Purpose |
|-------|-----|------|---------|
| `admin@solfacil.com.br` | SOLFACIL | SOLFACIL_ADMIN | Platform admin (all orgs) |
| `gerente@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_MANAGER | Org manager (Energia Corp) |
| `operador@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_OPERATOR | Dispatch operator |
| `auditor@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_VIEWER | Read-only viewer |
| `gerente@solarbr.com.br` | ORG_SOLARBR_002 | ORG_MANAGER | Org manager (Solar BR) |
| `operador@solarbr.com.br` | ORG_SOLARBR_002 | ORG_OPERATOR | Dispatch operator |

---

## 19. Data Strategy & Anti-Corruption Layer (資料戰略與防腐層)

> **ADR Status:** ACCEPTED | **Decision Date:** 2026-02-20
> **Scope:** Cross-cutting architectural decisions affecting M1 (IoT Hub) and M4 (Market & Billing)
> **Drivers:** Business extensibility, vendor neutrality, zero-downtime schema evolution

This chapter defines two foundational architecture decisions that protect the VPP core from external volatility: an extensible metadata strategy for asset data (M4) and a dual-ingestion anti-corruption layer for telemetry data (M1). Both decisions follow the principle of **isolating what changes from what stays stable**.

---

### 19.1 Module 4 — Extensible Metadata Design (可擴充元資料設計)

#### Context & Problem (背景與業務痛點)

VPP asset attributes grow continuously as the business evolves. New attributes include equipment model, installation site coordinates, warranty expiration, specific hardware specifications (e.g., Huawei LUNA2000 vs BYD HVS), firmware versions, and regulatory compliance fields required by ANEEL.

The traditional approach — `ALTER TABLE assets ADD COLUMN ...` for each new attribute — creates compounding problems:

1. **Migration overhead (遷移開銷):** Every new attribute requires a numbered migration file (currently `001_` through `005_`), code review, and staged rollout
2. **Table locks (資料表鎖定):** On PostgreSQL, `ALTER TABLE ADD COLUMN` with a `DEFAULT` on large tables acquires an `ACCESS EXCLUSIVE` lock, potentially blocking concurrent RLS-scoped queries during peak telemetry hours
3. **Column explosion (欄位爆炸):** As the fleet scales to 50,000+ assets across dozens of hardware vendors, the `assets` table schema becomes increasingly unwieldy and vendor-specific
4. **Cross-org variance (跨組織差異):** Different organizations (e.g., ORG_ENERGIA_001 vs ORG_SOLARBR_002) may require organization-specific attributes that don't apply globally

#### Architecture Decision (架構決策)

**M4 PostgreSQL core entities adopt a "Semi-Rigid + Semi-Flexible" (半剛性、半彈性) design principle.**

**Rigid Columns (剛性欄位)** — Columns critical for relational queries, RBAC permission filtering, and RLS policy matching. These MUST have strong type constraints, foreign keys, and indexes:

| Column | Type | Purpose |
|--------|------|---------|
| `asset_id` | `UUID PRIMARY KEY` | Identity, joins |
| `org_id` | `UUID NOT NULL REFERENCES organizations(org_id)` | RLS tenant isolation |
| `device_type` | `TEXT NOT NULL` | Categorization, filtering |
| `rated_power_kw` | `NUMERIC(10,2) NOT NULL` | Algorithm input (M2) |
| `status` | `TEXT NOT NULL` | Operational state, dispatch eligibility |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | Audit trail |

**Flexible Column (彈性欄位)** — A single `JSONB` column serving as a high-elasticity business extension slot (業務擴充槽), storing non-core, evolving attributes:

| Column | Type | Purpose |
|--------|------|---------|
| `metadata` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | Vendor specs, site info, compliance fields |

#### Schema Upgrade Example (schema.sql 升級範例)

```sql
-- Migration: 006_add_assets_metadata.sql
-- Zero-downtime: ADD COLUMN with DEFAULT '{}' is metadata-only on PG 11+
-- (no table rewrite, no ACCESS EXCLUSIVE lock on empty default)

ALTER TABLE assets
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN assets.metadata IS
    'Semi-flexible extension slot for vendor-specific and org-specific attributes. '
    'Schema validated at application layer. Indexed via GIN for @> containment queries.';

-- GIN index: supports @> (containment), ? (key existence), ?& (all keys exist)
CREATE INDEX idx_assets_metadata_gin ON assets USING GIN (metadata);

-- Partial index example: fast lookup for Huawei devices with warranty info
CREATE INDEX idx_assets_metadata_warranty ON assets ((metadata->>'warranty_expires'))
    WHERE metadata ? 'warranty_expires';
```

**Example metadata payloads by vendor:**

```json
// Huawei LUNA2000 (ORG_ENERGIA_001)
{
  "vendor": "huawei",
  "model": "LUNA2000-15-S0",
  "firmware_version": "V100R001C10SPC200",
  "warranty_expires": "2031-06-15",
  "installation_site": { "lat": -23.5505, "lng": -46.6333, "city": "São Paulo" },
  "aneel_registration": "DG-SP-2025-00847"
}

// BYD HVS (ORG_SOLARBR_002)
{
  "vendor": "byd",
  "model": "HVS-12.8",
  "firmware_version": "BMU-3.28",
  "warranty_expires": "2032-01-20",
  "installation_site": { "lat": -19.9167, "lng": -43.9345, "city": "Belo Horizonte" },
  "cycles_to_date": 487
}
```

**Application-layer validation (TypeScript):**

```typescript
// src/market-billing/services/metadata-validator.ts
import { z } from 'zod';

const InstallationSiteSchema = z.object({
  lat: z.number().min(-33.75).max(5.27),   // Brazil latitude bounds
  lng: z.number().min(-73.99).max(-34.79),  // Brazil longitude bounds
  city: z.string().min(1),
});

export const AssetMetadataSchema = z.object({
  vendor: z.string().min(1),
  model: z.string().min(1),
  firmware_version: z.string().optional(),
  warranty_expires: z.string().date().optional(),
  installation_site: InstallationSiteSchema.optional(),
  aneel_registration: z.string().optional(),
}).passthrough();  // Allow org-specific extra fields
```

**Query examples leveraging GIN index:**

```sql
-- Find all Huawei devices in ORG_ENERGIA_001
SELECT asset_id, device_type, rated_power_kw, metadata
FROM assets
WHERE metadata @> '{"vendor": "huawei"}'::jsonb;

-- Find devices with warranty expiring before 2030
SELECT asset_id, metadata->>'model' AS model, metadata->>'warranty_expires' AS warranty
FROM assets
WHERE (metadata->>'warranty_expires')::date < '2030-01-01';

-- Find devices at a specific site (GIN supports nested containment)
SELECT asset_id FROM assets
WHERE metadata @> '{"installation_site": {"city": "São Paulo"}}'::jsonb;
```

#### Consequences & Trade-offs (決策後果與權衡)

| | Impact |
|---|--------|
| ✅ | **Zero-downtime extensibility:** New business attributes require no migration — just write new JSON keys. `ADD COLUMN ... DEFAULT '{}'` on PG 11+ is metadata-only (no table rewrite) |
| ✅ | **GIN index performance:** The `@>` containment operator on JSONB with a GIN index provides acceptable query performance for the expected 50K asset scale |
| ✅ | **RLS compatibility:** Row-Level Security policies depend on the rigid `org_id` column. The `metadata` JSONB column does not affect RLS evaluation at all |
| ✅ | **Backward compatible:** Existing queries on rigid columns (`asset_id`, `org_id`, `status`, `rated_power_kw`) continue to work unchanged |
| ⚠️ | **No DB-level schema enforcement:** JSONB has no column-level type constraints — malformed metadata can be written. **Mitigation:** `AssetMetadataSchema` (Zod) validates at the application layer before every write |
| ⚠️ | **Deep nesting performance:** Complex nested JSONB queries (e.g., 3+ levels deep) are slower than rigid column lookups. **Mitigation:** Keep metadata flat or 1-level nested; extract frequently-queried paths into partial indexes |
| ⚠️ | **No foreign key on JSONB fields:** References inside metadata (e.g., `vendor_id`) cannot have FK constraints. **Mitigation:** Validate referential integrity at the application layer |

---

### 19.2 Module 1 — Dual Ingestion Channels & Anti-Corruption Layer (雙重進氣口與防腐層)

#### Context & Problem (背景與業務痛點)

VPP telemetry data originates from diverse and incompatible sources:

1. **Direct-connect devices (直連設備)** — BESS units and inverters that connect via AWS IoT Core MQTT, publishing to `solfacil/{org_id}/{region}/telemetry`. These send the native `TelemetryEvent` format already defined in `ingest-telemetry.ts`:
   ```typescript
   interface TelemetryEvent {
     orgId: string;
     deviceId: string;
     timestamp: string;  // ISO 8601
     metrics: { power: number; voltage: number; current: number; soc?: number; };
   }
   ```

2. **Third-party cloud platforms (第三方雲端平台)** — Vendor monitoring portals such as Huawei FusionSolar, Sungrow iSolarCloud, and GoodWe SEMS that deliver data via REST API webhooks in proprietary formats:
   - **Huawei FusionSolar:** Sends kW values in watts (×1000 scaling), uses Unix epoch timestamps (seconds), nests metrics under `dataItemMap`
   - **Sungrow iSolarCloud:** Uses Chinese field names in some API versions, packs SoC as integer 0–100 (not decimal)
   - **GoodWe SEMS:** Batches multiple inverters into a single payload, uses `pac` for power (watts)

If these heterogeneous payloads are allowed to reach M2 (Algorithm Engine) directly, the optimization algorithms become polluted with vendor-specific parsing logic — creating **Vendor Lock-in (廠商綁定)** at the core brain level.

#### Architecture Decision (架構決策)

**M1 serves as the Single Entry Point (唯一閘口) for all telemetry data, regardless of source.**

**Dual Ingestion Channel Design (雙重進氣口設計):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Module 1: IoT & Telemetry Hub                      │
│                                                                             │
│  Channel A: MQTT (IoT Core)          Channel B: REST API (API Gateway)      │
│  ┌──────────────────────┐            ┌──────────────────────────────────┐   │
│  │  Direct Devices       │            │  Third-Party Cloud Webhooks       │   │
│  │  (BESS, Inverters)    │            │  (FusionSolar, iSolarCloud, ...)│   │
│  │                       │            │                                  │   │
│  │  MQTT Topic:          │            │  POST /v1/webhook/telemetry      │   │
│  │  solfacil/{org_id}/   │            │  Authorization: HMAC-SHA256      │   │
│  │    {region}/telemetry │            │  X-Vendor: huawei | sungrow | …  │   │
│  └──────────┬───────────┘            └───────────────┬──────────────────┘   │
│             │                                         │                      │
│             │  IoT Rule Action                        │  Lambda Handler       │
│             ▼                                         ▼                      │
│  ┌──────────────────────┐            ┌──────────────────────────────────┐   │
│  │  ingest-telemetry.ts  │            │  webhook-telemetry-ingest.ts     │   │
│  │  (existing handler)   │            │  (new handler)                   │   │
│  └──────────┬───────────┘            └───────────────┬──────────────────┘   │
│             │                                         │                      │
│             │  Already in                             │  Vendor-specific      │
│             │  StandardTelemetry                      │  raw payload          │
│             │                                         ▼                      │
│             │                          ┌──────────────────────────────────┐  │
│             │                          │  Anti-Corruption Layer (ACL)     │  │
│             │                          │  ┌────────────┐ ┌────────────┐  │  │
│             │                          │  │ HuaweiAdptr│ │SungrowAdptr│  │  │
│             │                          │  └─────┬──────┘ └─────┬──────┘  │  │
│             │                          │        └──────┬───────┘         │  │
│             │                          │               ▼                 │  │
│             │                          │    StandardTelemetry output     │  │
│             │                          └───────────────┬────────────────┘  │
│             │                                          │                    │
│             └────────────────┬─────────────────────────┘                    │
│                              ▼                                              │
│                   ┌──────────────────────┐                                  │
│                   │  Timestream Write     │                                  │
│                   │  + EventBridge Emit   │                                  │
│                   │  (TelemetryReceived)  │                                  │
│                   └──────────────────────┘                                  │
│                              │                                              │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               ▼
                  M2 Algorithm Engine (消費 StandardTelemetry)
```

- **Channel A: MQTT (IoT Core)** — Direct-connect devices, low latency. The existing `ingest-telemetry.ts` handler already produces output compatible with `StandardTelemetry`
- **Channel B: REST API (API Gateway)** — Third-party cloud webhooks. A new `webhook-telemetry-ingest.ts` handler receives vendor payloads, routes through the ACL, and outputs `StandardTelemetry`

#### StandardTelemetry Internal Contract (內部標準契約)

This is the **canonical format** that all downstream modules (M2, M4, M5) consume. No module other than M1 ever sees vendor-specific formats:

```typescript
// src/iot-hub/contracts/standard-telemetry.ts

export interface StandardTelemetry {
  /** Tenant identifier — mandatory for RLS and EventBridge routing */
  readonly orgId: string;

  /** Unique device identifier within the org */
  readonly deviceId: string;

  /** ISO 8601 UTC timestamp of the measurement */
  readonly timestamp: string;

  /** Ingestion channel that produced this record */
  readonly source: 'mqtt' | 'webhook';

  /** Normalized metrics in SI-consistent units */
  readonly metrics: {
    readonly power_kw: number;     // kilowatts (always kW, never W)
    readonly voltage_v: number;    // volts
    readonly current_a: number;    // amperes
    readonly soc_pct?: number;     // 0.0–100.0 percentage (optional)
  };

  /** Original vendor payload preserved for audit & debugging */
  readonly rawPayload?: Record<string, unknown>;
}
```

**Key design choices:**
- `source` field distinguishes ingestion channel for observability and debugging
- Metric field names include units (`_kw`, `_v`, `_a`, `_pct`) to eliminate ambiguity
- `rawPayload` preserves the original vendor data for regulatory audit (ANEEL) and debugging, without polluting the normalized structure
- All fields are `readonly` — immutable by design (符合核心設計原則 #7)

#### Adapter Pattern Implementation (適配器模式實作)

```typescript
// src/iot-hub/adapters/telemetry-adapter.ts

export interface TelemetryAdapter {
  /** Vendor identifier matching X-Vendor header */
  readonly vendorId: string;

  /** Transform vendor-specific payload → StandardTelemetry */
  normalize(
    orgId: string,
    rawPayload: Record<string, unknown>
  ): StandardTelemetry;
}
```

```typescript
// src/iot-hub/adapters/huawei-adapter.ts

import type { TelemetryAdapter } from './telemetry-adapter';
import type { StandardTelemetry } from '../contracts/standard-telemetry';

export const HuaweiFusionSolarAdapter: TelemetryAdapter = {
  vendorId: 'huawei',

  normalize(orgId, raw): StandardTelemetry {
    // FusionSolar sends: { devId, collectTime (epoch s), dataItemMap: { ... } }
    const dataItems = raw.dataItemMap as Record<string, number>;

    return {
      orgId,
      deviceId: String(raw.devId),
      timestamp: new Date((raw.collectTime as number) * 1000).toISOString(),
      source: 'webhook',
      metrics: {
        power_kw: (dataItems.active_power ?? 0) / 1000,  // W → kW
        voltage_v: dataItems.mppt_voltage ?? 0,
        current_a: dataItems.mppt_current ?? 0,
        soc_pct: dataItems.battery_soc,                   // already 0–100
      },
      rawPayload: raw,
    };
  },
};
```

```typescript
// src/iot-hub/adapters/sungrow-adapter.ts

import type { TelemetryAdapter } from './telemetry-adapter';
import type { StandardTelemetry } from '../contracts/standard-telemetry';

export const SungrowAdapter: TelemetryAdapter = {
  vendorId: 'sungrow',

  normalize(orgId, raw): StandardTelemetry {
    // iSolarCloud sends: { sn, timestamp (ISO), p_ac (kW), v_grid, i_grid, soc (int) }
    return {
      orgId,
      deviceId: String(raw.sn),
      timestamp: String(raw.timestamp),
      source: 'webhook',
      metrics: {
        power_kw: Number(raw.p_ac),       // already in kW
        voltage_v: Number(raw.v_grid),
        current_a: Number(raw.i_grid),
        soc_pct: Number(raw.soc),          // integer 0–100, fits our 0.0–100.0 range
      },
      rawPayload: raw,
    };
  },
};
```

```typescript
// src/iot-hub/adapters/adapter-registry.ts

import type { TelemetryAdapter } from './telemetry-adapter';
import { HuaweiFusionSolarAdapter } from './huawei-adapter';
import { SungrowAdapter } from './sungrow-adapter';

const adapters = new Map<string, TelemetryAdapter>([
  [HuaweiFusionSolarAdapter.vendorId, HuaweiFusionSolarAdapter],
  [SungrowAdapter.vendorId, SungrowAdapter],
]);

export function getAdapter(vendorId: string): TelemetryAdapter {
  const adapter = adapters.get(vendorId);
  if (!adapter) {
    throw new Error(
      `Unsupported vendor: "${vendorId}". ` +
      `Supported: ${[...adapters.keys()].join(', ')}`
    );
  }
  return adapter;
}
```

#### Anti-Corruption Layer Data Flow (防腐層資料流)

```
                          Third-Party Webhook Request
                                    │
                                    ▼
                   ┌────────────────────────────────┐
                   │  API Gateway (POST /v1/webhook) │
                   │  HMAC-SHA256 signature verify   │
                   └────────────────┬───────────────┘
                                    │
                                    ▼
                   ┌────────────────────────────────┐
                   │  webhook-telemetry-ingest.ts    │
                   │                                 │
                   │  1. Extract X-Vendor header      │
                   │  2. Extract org_id from path/JWT │
                   │  3. getAdapter(vendorId)         │
                   │  4. adapter.normalize(orgId,raw) │
                   │  5. Validate StandardTelemetry   │
                   └────────────────┬───────────────┘
                                    │
                          StandardTelemetry
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌──────────────────┐           ┌──────────────────────┐
        │  Timestream Write │           │  EventBridge Publish  │
        │  (same as MQTT    │           │  TelemetryReceived    │
        │   ingestion path) │           │  { source: "webhook" }│
        └──────────────────┘           └──────────────────────┘
```

**Once data passes through the ACL, the downstream flow is identical regardless of ingestion channel.** M2 Algorithm Engine, M4 Market & Billing, and M5 BFF all consume `StandardTelemetry` — they never need to know whether the data originated from a direct MQTT device or a Huawei FusionSolar webhook.

#### New Files & Directory Structure

```
src/iot-hub/
├── handlers/
│   ├── ingest-telemetry.ts           # (existing) Channel A — MQTT
│   ├── webhook-telemetry-ingest.ts   # (new)      Channel B — REST webhook
│   ├── schedule-to-shadow.ts         # (existing)
│   └── device-registry.ts           # (existing)
├── contracts/
│   └── standard-telemetry.ts         # (new) StandardTelemetry interface
├── adapters/
│   ├── telemetry-adapter.ts          # (new) Adapter interface
│   ├── adapter-registry.ts           # (new) Vendor → Adapter lookup
│   ├── huawei-adapter.ts             # (new) Huawei FusionSolar
│   └── sungrow-adapter.ts            # (new) Sungrow iSolarCloud
├── services/
│   ├── timestream-writer.ts          # (existing)
│   └── shadow-manager.ts             # (existing)
└── __tests__/
    ├── ingest-telemetry.test.ts      # (existing)
    ├── timestream-writer.test.ts     # (existing)
    ├── huawei-adapter.test.ts        # (new) Vendor format normalization tests
    ├── sungrow-adapter.test.ts       # (new) Vendor format normalization tests
    └── adapter-registry.test.ts      # (new) Registry lookup + unknown vendor error
```

#### Consequences & Trade-offs (決策後果與權衡)

| | Impact |
|---|--------|
| ✅ | **Core algorithm isolation (核心演算法隔離):** M2 exclusively consumes `StandardTelemetry` — completely insulated from vendor format changes. Vendor formats can change without touching M2/M3/M4/M5 |
| ✅ | **Open/Closed Principle (開放封閉原則):** Adding a new vendor (e.g., GoodWe) requires only implementing a new `TelemetryAdapter` and registering it in `adapter-registry.ts` — no changes to existing handlers or downstream modules |
| ✅ | **Audit trail (稽核軌跡):** `rawPayload` preserves original vendor data for ANEEL regulatory compliance and post-incident debugging |
| ✅ | **Unified observability:** Both channels converge to the same Timestream write path and EventBridge emission, so CloudWatch dashboards and X-Ray traces work identically for MQTT and webhook data |
| ⚠️ | **Adapter development cost (適配器開發成本):** Each new vendor requires research into their proprietary API format and a dedicated adapter implementation. **Mitigation:** The adapter interface is small (~20 lines); most effort is in understanding vendor documentation |
| ⚠️ | **Adapter test coverage (適配器測試覆蓋):** Each adapter's `normalize()` logic must be unit-tested with real vendor payload samples. **Mitigation:** Request sample payloads during vendor onboarding; store as test fixtures in `__tests__/fixtures/` |
| ⚠️ | **Webhook authentication (Webhook 驗證):** REST Channel B must verify HMAC-SHA256 signatures per vendor. M7's existing HMAC verification pattern (`webhook-delivery.ts`) can be reused for inbound verification |

---

### 19.3 Architecture Evolution Roadmap (架構演進路線圖)

| Phase | Milestone (里程碑) | Modules | Key Deliverables |
|-------|---------------------|---------|------------------|
| **Done (現在)** | 7 modules with 69 bulletproof tests; `StandardTelemetry` contract defined | M1–M7 | All handlers, CDK stacks, EventBridge rules, RLS policies tested |
| **Phase 2** | Dual Ingestion & Extensible Metadata | M1, M4 | `HuaweiAdapter` + `SungrowAdapter` implemented; `schema.sql` adds JSONB `metadata` column; `AssetMetadataSchema` Zod validator; 12+ new unit tests |
| **Phase 3** | Identity Stack Production Deployment | M6, M5 | Cognito User Pool deployed to `sa-east-1`; replace hardcoded test JWTs with real Cognito tokens; MFA enforcement enabled |
| **Phase 4** | Full Cloud Activation | All | `cdk deploy --all` — all 7 stacks live in AWS; end-to-end telemetry flow from device → Timestream → M2 → Device Shadow verified |
| **Phase 5** | Open API Hardening & Partner Onboarding | M7 | WAF rate limiting (1000 req/min per API key); partner webhook subscriptions; HMAC-SHA256 delivery verification; API documentation published |
| **Phase 6** | Multi-Vendor Fleet Scale-out | M1 | GoodWe SEMS adapter; Growatt adapter; adapter performance benchmarks; webhook payload replay/retry mechanism |

#### Phase 2 Detailed Breakdown (Phase 2 細部拆解)

```
Phase 2 Dual Ingestion & Extensible Metadata
├── M4: Extensible Metadata
│   ├── 006_add_assets_metadata.sql migration
│   ├── GIN index on metadata column
│   ├── AssetMetadataSchema (Zod) validator
│   ├── Update calculate-profit.ts to surface metadata in responses
│   └── 4 new tests (validation, GIN query, RLS compatibility, malformed rejection)
│
├── M1: Anti-Corruption Layer
│   ├── StandardTelemetry contract (contracts/standard-telemetry.ts)
│   ├── TelemetryAdapter interface
│   ├── HuaweiFusionSolarAdapter
│   ├── SungrowAdapter
│   ├── AdapterRegistry
│   ├── webhook-telemetry-ingest.ts handler
│   └── 8 new tests (2 per adapter, registry, webhook handler integration)
│
└── CDK: IotHubStack update
    ├── API Gateway route: POST /v1/webhook/telemetry
    ├── Lambda function for webhook handler
    └── IAM grants for Timestream + EventBridge
```

---

## Data Model Mapping (Frontend → Backend)

| Frontend Data | Current Source | Backend Source | AWS Service |
|---------------|---------------|---------------|-------------|
| `assets[]` (id, name, region, SoC, mode) | `data.js` hardcoded | M4 (RDS `assets`) + M1 (Timestream live SoC) | RDS + Timestream |
| `trades[]` (time, tariff, operation, price) | `data.js` hardcoded | M4 (RDS `trades`) | RDS PostgreSQL |
| `revenueTrend` (7-day arrays) | `data.js` hardcoded | M4 (RDS `daily_revenue`) | RDS PostgreSQL |
| `revenueBreakdown` | `data.js` hardcoded | M4 (computed from `trades`) | RDS PostgreSQL |
| Market conditions (tariff, price, margin) | `market.js` (time-based) | M4 (`tariff_schedules`) + ANEEL data | RDS + external API |
| Algorithm KPIs (Alpha, MAPE) | `data.js` (random) | M2 (Timestream + forecast) | Lambda + Timestream |
| Site Analytics (PV, load, battery) | `data.js` (generated) | M1 (Timestream 24h query) | Timestream |
| Dispatch progress | `batch-ops.js` (simulated) | M3 (DynamoDB `dispatch_tracker`) | DynamoDB |
| Organization context | N/A (new) | M6 (Cognito `custom:org_id`) | Cognito |
| Webhook subscriptions | N/A (new) | M7 (DynamoDB `webhook_subscriptions`) | DynamoDB |

---

---

## 20. Module 8: Admin Control Plane — Global Control Plane (全局控制面)

> **Status:** ACTIVE — Confirmed as the system's Global Control Plane in v5.0.
> **Role:** Single Source of Truth for all configuration consumed by M1-M7 (Data Plane).
> **See also:** [§0 Architectural Law](#0-architectural-law-control-plane-vs-data-plane-全局法則) for the supreme separation principle.

### 20.1 核心職責與設計哲學

**Configuration-Driven（配置驅動）：** M8 是整個 VPP 系統的「大腦設定面板」。M1 的設備解析規則、M2 的套利決策閾值，未來將不再硬編碼在 Lambda 裡，而是由 M8 動態管理、即時生效。

**No-Code Operations（無代碼營運）：** 非技術營運人員（如客戶成功團隊、商業分析師）可透過前端後台介面，直接管理設備對接規則與 VPP 策略，無需重新部署代碼。

**隔離性（v4.1 原則）：** M8 在 v4.1 中完全獨立，不與 M1-M7 產生任何代碼耦合。M8 的 API 在 v5.0 才會被 M1/M2 主動調用。

---

### 20.2 M8 核心資料表設計（PostgreSQL, 與 M4 同一 VPC）

#### 20.2.1 device_parser_rules — 設備解析規則表

```sql
-- ============================================================
-- Table: device_parser_rules
-- Purpose: Stores vendor-specific telemetry parsing rules.
--          Replaces hardcoded adapters in M1 (v5.0 integration).
-- ============================================================

CREATE TABLE device_parser_rules (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          TEXT            NOT NULL REFERENCES organizations(org_id),
    rule_name       TEXT            NOT NULL,           -- human-readable, e.g. 'Huawei FusionSolar V3'
    manufacturer    TEXT            NOT NULL,           -- 'huawei' | 'sungrow' | 'generic'
    version         TEXT            NOT NULL DEFAULT '1.0',
    field_mapping   JSONB           NOT NULL DEFAULT '{}',
    unit_conversions JSONB          NOT NULL DEFAULT '{}',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by      TEXT            NOT NULL,           -- userId
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_org_rule_name UNIQUE (org_id, rule_name)
);

-- Row-Level Security: multi-tenant isolation
ALTER TABLE device_parser_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_parser_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_parser_rules
    ON device_parser_rules
    USING (org_id = current_setting('app.current_org_id'));

-- Indexes
CREATE INDEX idx_parser_rules_manufacturer ON device_parser_rules(manufacturer);
CREATE INDEX idx_parser_rules_org          ON device_parser_rules(org_id);
CREATE INDEX idx_parser_rules_metadata     ON device_parser_rules USING GIN(field_mapping);
```

**`field_mapping` JSONB Schema Example:**

```json
{
  "deviceId": "devSn",
  "timestamp": {
    "field": "collectTime",
    "type": "unix_ms"
  },
  "power": {
    "field": "dataItemMap.active_power",
    "unit": "W",
    "targetUnit": "kW",
    "divisor": 1000
  },
  "soc": {
    "field": "dataItemMap.battery_soc",
    "unit": "percent"
  }
}
```

**`unit_conversions` JSONB Schema Example:**

```json
{
  "power": { "from": "W", "to": "kW", "divisor": 1000 },
  "energy": { "from": "Wh", "to": "kWh", "divisor": 1000 },
  "temperature": { "from": "C", "to": "C", "offset": 0 }
}
```

#### 20.2.2 vpp_strategies — VPP 套利策略表

```sql
-- ============================================================
-- Table: vpp_strategies
-- Purpose: Stores per-org VPP arbitrage strategy parameters.
--          Replaces hardcoded thresholds in M2 (v5.0 integration).
-- ============================================================

CREATE TABLE vpp_strategies (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          TEXT            NOT NULL REFERENCES organizations(org_id),
    strategy_name   TEXT            NOT NULL,           -- e.g. 'Conservative', 'Aggressive', 'Summer Peak'
    description     TEXT,
    min_soc         NUMERIC(5,2)    NOT NULL DEFAULT 20.0,   -- % minimum discharge SOC floor
    max_soc         NUMERIC(5,2)    NOT NULL DEFAULT 90.0,   -- % maximum charge SOC ceiling
    profit_margin   NUMERIC(8,4)    NOT NULL DEFAULT 0.0,    -- BRL/kWh minimum profit threshold
    active_hours    JSONB           NOT NULL DEFAULT '{"start": "00:00", "end": "23:59"}',
    active_weekdays JSONB           NOT NULL DEFAULT '[0,1,2,3,4,5,6]',  -- 0=Sunday
    emergency_soc   NUMERIC(5,2)    NOT NULL DEFAULT 10.0,   -- % emergency reserve
    is_active       BOOLEAN         NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN         NOT NULL DEFAULT FALSE,  -- only one default per org
    created_by      TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_org_strategy_name UNIQUE (org_id, strategy_name),
    CONSTRAINT chk_soc_range        CHECK (min_soc < max_soc AND emergency_soc < min_soc),
    CONSTRAINT chk_profit_positive  CHECK (profit_margin >= 0)
);

-- Row-Level Security: multi-tenant isolation
ALTER TABLE vpp_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpp_strategies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_vpp_strategies
    ON vpp_strategies
    USING (org_id = current_setting('app.current_org_id'));

-- Partial unique index: enforce at most one default strategy per org
CREATE UNIQUE INDEX idx_strategies_default
    ON vpp_strategies(org_id) WHERE is_default = TRUE;

-- Composite index for active strategy lookups
CREATE INDEX idx_strategies_org_active
    ON vpp_strategies(org_id, is_active);
```

#### 20.2.3 dispatch_policies — 派發政策表 (M3 Consumer)

```sql
-- ============================================================
-- Table: dispatch_policies
-- Purpose: Stores per-org DR dispatch operational parameters.
--          Replaces hardcoded timeout/retry values in M3 (v5.0).
-- Consumer: M3 (DR Dispatcher)
-- ============================================================

CREATE TABLE dispatch_policies (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      TEXT            NOT NULL REFERENCES organizations(org_id),
    max_retry_count             INT             NOT NULL DEFAULT 3,
    retry_backoff_seconds       INT             NOT NULL DEFAULT 60,
    max_concurrent_dispatches   INT             NOT NULL DEFAULT 10,
    timeout_minutes             INT             NOT NULL DEFAULT 15,
    created_by                  TEXT            NOT NULL,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_dispatch_policy_org UNIQUE (org_id),
    CONSTRAINT chk_retry_positive     CHECK (max_retry_count > 0),
    CONSTRAINT chk_timeout_positive   CHECK (timeout_minutes > 0),
    CONSTRAINT chk_concurrent_positive CHECK (max_concurrent_dispatches > 0)
);

-- Row-Level Security: multi-tenant isolation
ALTER TABLE dispatch_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dispatch_policies
    ON dispatch_policies
    USING (org_id = current_setting('app.current_org_id'));

-- Indexes
CREATE INDEX idx_dispatch_policies_org ON dispatch_policies(org_id);
```

#### 20.2.4 billing_rules — 計費規則表 (M4 Consumer)

```sql
-- ============================================================
-- Table: billing_rules
-- Purpose: Stores per-org billing and tariff parameters.
--          Replaces hardcoded cost constants in M4 (v5.0).
-- Consumer: M4 (Market & Billing)
-- ============================================================

CREATE TABLE billing_rules (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      TEXT            NOT NULL REFERENCES organizations(org_id),
    tariff_penalty_multiplier   NUMERIC(4,2)    NOT NULL DEFAULT 1.5,
    tariff_effective_period     TEXT            NOT NULL DEFAULT 'monthly',
    operating_cost_per_kwh      NUMERIC(8,4)    NOT NULL,
    created_by                  TEXT            NOT NULL,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_billing_rules_org      UNIQUE (org_id),
    CONSTRAINT chk_penalty_positive      CHECK (tariff_penalty_multiplier > 0),
    CONSTRAINT chk_cost_positive         CHECK (operating_cost_per_kwh >= 0),
    CONSTRAINT chk_effective_period      CHECK (tariff_effective_period IN ('monthly', 'quarterly', 'annually'))
);

-- Row-Level Security: multi-tenant isolation
ALTER TABLE billing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_rules
    ON billing_rules
    USING (org_id = current_setting('app.current_org_id'));

-- Indexes
CREATE INDEX idx_billing_rules_org ON billing_rules(org_id);
```

#### 20.2.5 feature_flags — 功能開關表 (M5 Consumer)

```sql
-- ============================================================
-- Table: feature_flags
-- Purpose: Stores feature toggles for canary releases and A/B testing.
--          Enables gradual feature rollout without code deployment.
-- Consumer: M5 (Frontend BFF)
-- Note: No RLS — managed exclusively by SOLFACIL_ADMIN
-- ============================================================

CREATE TABLE feature_flags (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_name       TEXT            NOT NULL,
    is_enabled      BOOLEAN         NOT NULL DEFAULT FALSE,
    target_org_ids  JSONB           DEFAULT 'null'::jsonb,  -- null=all tenants, or ["ORG_001","ORG_002"]
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    description     TEXT,
    created_by      TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_feature_flag_name  UNIQUE (flag_name),
    CONSTRAINT chk_valid_window      CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until)
);

-- No RLS: feature_flags are managed exclusively by SOLFACIL_ADMIN
-- Access control enforced at application layer (RBAC middleware)

-- Indexes
CREATE INDEX idx_feature_flags_name     ON feature_flags(flag_name);
CREATE INDEX idx_feature_flags_enabled  ON feature_flags(is_enabled) WHERE is_enabled = TRUE;
CREATE INDEX idx_feature_flags_targets  ON feature_flags USING GIN(target_org_ids);
```

#### 20.2.6 api_quotas — API 配額表 (M7 Consumer)

```sql
-- ============================================================
-- Table: api_quotas
-- Purpose: Stores per-partner API rate limits and quotas.
--          Replaces static API Gateway Usage Plans with dynamic control.
-- Consumer: M7 (Open API & Integration)
-- ============================================================

CREATE TABLE api_quotas (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id      TEXT            NOT NULL,
    org_id          TEXT            NOT NULL REFERENCES organizations(org_id),
    calls_per_minute INT           NOT NULL DEFAULT 60,
    calls_per_day   INT             NOT NULL DEFAULT 10000,
    burst_limit     INT             NOT NULL DEFAULT 100,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by      TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_api_quota_partner  UNIQUE (partner_id),
    CONSTRAINT chk_rpm_positive      CHECK (calls_per_minute > 0),
    CONSTRAINT chk_rpd_positive      CHECK (calls_per_day > 0),
    CONSTRAINT chk_burst_positive    CHECK (burst_limit > 0)
);

-- Row-Level Security: multi-tenant isolation
ALTER TABLE api_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_quotas FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_api_quotas
    ON api_quotas
    USING (org_id = current_setting('app.current_org_id'));

-- Indexes
CREATE INDEX idx_api_quotas_partner ON api_quotas(partner_id);
CREATE INDEX idx_api_quotas_org     ON api_quotas(org_id);
CREATE INDEX idx_api_quotas_active  ON api_quotas(is_active) WHERE is_active = TRUE;
```

---

### 20.3 M8 REST API 端點設計

> All endpoints require authentication through M5 BFF's RBAC middleware.
> Minimum role: `ORG_MANAGER`. Delete operations require `SOLFACIL_ADMIN`.

#### Device Parser Rules API

| Method | Endpoint | Description | Min Role |
|--------|----------|-------------|----------|
| `GET` | `/admin/parsers` | List all parser rules for the org | `ORG_MANAGER` |
| `POST` | `/admin/parsers` | Create a new parser rule | `ORG_MANAGER` |
| `GET` | `/admin/parsers/:id` | Get single rule details | `ORG_MANAGER` |
| `PUT` | `/admin/parsers/:id` | Full update of a rule | `ORG_MANAGER` |
| `PATCH` | `/admin/parsers/:id/activate` | Toggle rule active/inactive | `ORG_MANAGER` |
| `DELETE` | `/admin/parsers/:id` | Delete rule (fails if `is_active=true`) | `SOLFACIL_ADMIN` |

#### VPP Strategy API

| Method | Endpoint | Description | Min Role |
|--------|----------|-------------|----------|
| `GET` | `/admin/strategies` | List all strategies for the org | `ORG_MANAGER` |
| `POST` | `/admin/strategies` | Create a new strategy | `ORG_MANAGER` |
| `GET` | `/admin/strategies/:id` | Get strategy details | `ORG_MANAGER` |
| `PUT` | `/admin/strategies/:id` | Update strategy parameters | `ORG_MANAGER` |
| `POST` | `/admin/strategies/:id/activate` | Activate strategy (auto-deactivates others) | `ORG_MANAGER` |
| `DELETE` | `/admin/strategies/:id` | Delete non-active strategy | `SOLFACIL_ADMIN` |

#### Dispatch Policies API (v5.0)

| Method | Endpoint | Description | Min Role |
|--------|----------|-------------|----------|
| `GET` | `/admin/dispatch-policies` | Get dispatch policy for the org | `ORG_MANAGER` |
| `PUT` | `/admin/dispatch-policies` | Create or update dispatch policy | `ORG_MANAGER` |

#### Billing Rules API (v5.0)

| Method | Endpoint | Description | Min Role |
|--------|----------|-------------|----------|
| `GET` | `/admin/billing-rules` | Get billing rules for the org | `ORG_MANAGER` |
| `PUT` | `/admin/billing-rules` | Create or update billing rules | `ORG_MANAGER` |

#### Feature Flags API (v5.0)

| Method | Endpoint | Description | Min Role |
|--------|----------|-------------|----------|
| `GET` | `/admin/feature-flags` | List all feature flags | `SOLFACIL_ADMIN` |
| `POST` | `/admin/feature-flags` | Create a new feature flag | `SOLFACIL_ADMIN` |
| `PUT` | `/admin/feature-flags/:id` | Update feature flag | `SOLFACIL_ADMIN` |
| `PATCH` | `/admin/feature-flags/:id/toggle` | Toggle flag enabled/disabled | `SOLFACIL_ADMIN` |
| `DELETE` | `/admin/feature-flags/:id` | Delete feature flag | `SOLFACIL_ADMIN` |

#### API Quotas API (v5.0)

| Method | Endpoint | Description | Min Role |
|--------|----------|-------------|----------|
| `GET` | `/admin/api-quotas` | List all API quotas for the org | `ORG_MANAGER` |
| `POST` | `/admin/api-quotas` | Create a new quota for a partner | `ORG_MANAGER` |
| `PUT` | `/admin/api-quotas/:id` | Update partner quota | `ORG_MANAGER` |
| `PATCH` | `/admin/api-quotas/:id/toggle` | Activate/deactivate quota | `ORG_MANAGER` |
| `DELETE` | `/admin/api-quotas/:id` | Delete quota entry | `SOLFACIL_ADMIN` |

---

### 20.4 v5.0 融合預告（Future Integration Points）

> **Note:** The following describes v5.0 design intent. None of this is implemented in v4.1.

#### M1 融合點 — Dynamic Adapter Resolution

`ingest-telemetry.ts` 的 `resolveAdapter()` 將在 Lambda 冷啟動時從 M8 的 `device_parser_rules` 載入規則，動態建構 Adapter（取代現有的硬編碼 `HuaweiAdapter` / `NativeAdapter`）。規則更新後無需重新部署 Lambda。

```
┌─────────────┐    cold start    ┌──────────────────────┐
│  M1 Lambda  │ ──────────────▶  │  M8: parser_rules    │
│  (IoT Hub)  │  GET /parsers    │  (PostgreSQL)        │
│             │ ◀────────────── │                      │
│  Build      │   rules[]       │                      │
│  adapters   │                 └──────────────────────┘
│  from rules │
└─────────────┘
```

#### M2 融合點 — Dynamic Strategy Loading

`run-optimization.ts` 的 3 條套利規則閾值（`min_soc=20`, `max_soc=90`）將替換為從 M8 的 `vpp_strategies` 動態讀取，支援每個 org 設定不同策略。

```
┌─────────────┐    per invocation    ┌──────────────────────┐
│  M2 Lambda  │ ──────────────────▶  │  M8: vpp_strategies  │
│  (Algo Eng) │  GET active strategy │  (PostgreSQL)        │
│             │ ◀────────────────── │                      │
│  Apply      │   {min_soc, max_soc, │                      │
│  thresholds │    profit_margin}    └──────────────────────┘
└─────────────┘
```

#### 快取策略（Cache Strategy for v5.0）

M8 規則的讀取頻率高（每次遙測都需要），建議在 v5.0 引入 **ElastiCache Redis** with `TTL=5min`，避免每次都查 PostgreSQL。

```
M1/M2 Lambda ──▶ Redis Cache (TTL=5min) ──miss──▶ M8 PostgreSQL
                       │ hit
                       ▼
                  Use cached rules
```

---

### 20.5 CDK Stack 規劃（v5.0 實作）

> **Note:** Infrastructure-as-Code details for v5.0 implementation. Not built in v4.1.

**AdminControlPlaneStack** will include:

| Resource | Purpose |
|----------|---------|
| `AdminParsersLambda` | CRUD operations for `device_parser_rules` |
| `AdminStrategiesLambda` | CRUD operations for `vpp_strategies` |
| M4 VPC + RDS reuse | Same `PRIVATE_ISOLATED` subnet as Market & Billing |
| M4 Secrets Manager VPC Endpoint reuse | Shared database credentials access |
| API Gateway routes: `/admin/*` | New route group under existing API Gateway |
| RBAC enforcement | `ORG_MANAGER` minimum role for all endpoints |

**Deployment Phase:** Phase 8 (after M7), independent of M1-M7 deployment.

---

*This document is the Single Source of Truth for the SOLFACIL VPP backend architecture. It supersedes both the original backend design (v1.1) and the auth/tenant design (v2.0). All future modifications should be made to this document.*
