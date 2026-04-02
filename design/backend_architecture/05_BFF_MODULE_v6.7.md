# M5: BFF Module — Backend for Frontend (BFF 后端网关层)

> **Module Version**: v6.7
> **Git HEAD**: `b94adf3`
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.7.md](./00_MASTER_ARCHITECTURE_v6.7.md)
> **Last Updated**: 2026-04-02
> **Description**: 47 route endpoints (45 unique handler files) + SSE + middleware — complete Express API surface for the Solfacil VPP platform

---

## Version History (版本变更记录)

| Version | Date | Changes |
|---------|------|---------|
| v5.24 | 2026-03-13 | P3 Asset History: `get-asset-telemetry.ts`, `get-asset-health.ts` |
| v6.0 | 2026-03-16 | HEMS batch dispatch (`post-hems-batch-dispatch.ts`, 100-gateway limit) |
| v6.1 | 2026-03-18 | Fleet overview endpoints: `get-fleet-overview.ts` (EP-1), `get-fleet-integradores.ts` (EP-2) |
| v6.2 | 2026-03-20 | Home-first P2: gateway detail + energy + schedule + alias (home-centric UX) |
| v6.4 | 2026-03-25 | HEMS targeting: `get-hems-targeting.ts` for fleet eligibility workbench |
| v6.5 | 2026-03-28 | P5 Strategy Triggers: 4 new endpoints — overview, intent detail, intent action, posture override |
| **v6.6** | **2026-03-31** | P1/P2 Visual Unification (frontend-only, no BFF handler changes); this document: full inventory audit at 47 route endpoints (45 unique handler files) |

---

## 1. Middleware Chain (中间件链)

### 1.1 Request Lifecycle (请求生命周期)

```
Browser ──► Express Server (port 3000)
              │
              ├─ express.json()              ← Parse JSON body (解析请求体)
              ├─ authMiddleware              ← JWT validation on /api/* (JWT 验证)
              ├─ cors()                       ← Origin whitelist (跨域白名单)
              │
              ├─ wrapHandler(lambdaHandler)  ← Lambda-compatible adaptor (Lambda 适配器)
              │    └─ makeStubEvent()        ← Construct API Gateway V2 event from Express req
              │
              └─ Direct Express handlers     ← SSE, auth-login, admin-users, webhooks
```

### 1.2 Auth Middleware — `bff/middleware/auth.ts`

**JWT validation on `/api/*`** (except `/api/auth/login`):

| Behavior | Detail |
|----------|--------|
| **Skip** | Non-API routes (non `/api/*` paths — static files, frontend HTML) |
| **Skip** | Public routes: `["/api/auth/login"]` |
| **Validate** | All other `/api/*` routes — extracts `Bearer <token>` from `Authorization` header |
| **Context injection** | On success: calls `verifyTenantToken(token)` → overwrites `req.headers.authorization` with raw JSON `{ userId, orgId, role }` for downstream handler compatibility |
| **Failure** | Returns `401` with `fail()` envelope |

**Auth middleware functions** (from two sources):

- `verifyTenantToken(token)` — JWT decode + signature verification, returns `{ userId, orgId, role }` *(from `shared/middleware/tenant-context.ts`)*
- `requireRole(ctx, roles[])` — RBAC enforcement; throws with `statusCode: 403` if role not in allowed list *(from `shared/middleware/tenant-context.ts`)*
- `extractTenantContext(event)` — extracts tenant context from API Gateway V2 event (used by all Lambda-wrapped handlers) *(from `bff/middleware/auth.ts` — BFF-local, not shared)*
- `apiError(statusCode, message)` — standard error response builder *(from `bff/middleware/auth.ts` — BFF-local, not shared)*

### 1.3 Response Shape — `ApiResponse<T>`

All BFF responses use the standard `ok()` / `fail()` envelope from `shared/types/api`:

```typescript
// Success (成功)
{ success: true, data: T, error: null, _tenant?: { orgId, role } }

// Error (错误)
{ success: false, data: null, error: "Error message string" }
```

The `_tenant` field is included in development mode for debugging RLS scope visibility.

---

## 2. Complete Handler Inventory — 47 Route Endpoints / 45 Unique Handler Files (完整端点清单)

### 2.1 Auth & Admin (认证与管理) — 2 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 1 | POST | `/api/auth/login` | `auth-login.ts` | **Public** | JWT login — `bcrypt.compare()` + JWT signed with `JWT_SECRET`, 24h expiry. Uses Service Pool (BYPASSRLS, orgId unknown at login). Returns `{ token, user }` |
| 2 | POST | `/api/users` | `admin-users.ts` | **SOLFACIL_ADMIN** | Create user + assign role. Transaction: `BEGIN → INSERT users → INSERT user_org_roles → COMMIT`. Password: bcrypt 12 rounds |

---

### 2.2 Dashboard & SSE (仪表板与实时推送) — 2 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 3 | GET | `/dashboard` | `get-dashboard.ts` | JWT | 10 parallel queries via `Promise.all` (aggregated KPIs — see detail below) |
| 4 | GET | `/api/events` | `sse-events.ts` | JWT | SSE push via `pg_notify` — channels: `telemetry_update`, `gateway_health` |

**`get-dashboard.ts` — 10 parallel queries (仪表板10路并行查询)**:

| # | Query | Source Table |
|---|-------|-------------|
| 1 | Asset aggregation | `assets JOIN device_state` |
| 2 | Today's revenue (client_savings primary) | `revenue_daily` |
| 3 | Self-consumption 7-day avg | `revenue_daily` |
| 4 | Dispatch KPIs | `dispatch_commands` |
| 5 | Monthly revenue | `revenue_daily` |
| 6 | Self-consumption delta (today vs yesterday) | `revenue_daily` |
| 7 | Dispatch accuracy + latency | `dispatch_records` |
| 8 | Gateway uptime 7-day avg | `daily_uptime_snapshots` |
| 9 | Self-sufficiency 7-day avg | `revenue_daily` |
| 10 | Self-sufficiency delta (today vs yesterday) | `revenue_daily` |

---

### 2.3 Assets & Devices (资产与设备) — 6 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 5 | GET | `/api/devices` | `get-devices.ts` | JWT | Device list with filters (type, status, search keyword) |
| 6 | GET | `/api/devices/:assetId` | `get-device-detail.ts` | JWT | Single device detail — `assets JOIN gateways JOIN device_state JOIN telemetry_history JOIN vpp_strategies` |
| 7 | GET | `/api/devices/:assetId/schedule` | `get-device-schedule.ts` | JWT | Current schedule from `device_command_logs` |
| 8 | PUT | `/api/devices/:assetId/schedule` | `put-device-schedule.ts` | JWT | **Deprecated** (gateway-level schedule preferred). Slots: contiguous 0-24h. Returns 202 Accepted |
| 9 | PUT | `/api/devices/:assetId` | `put-device.ts` | JWT | Update `operationMode`, `allowExport`, `capacidadeKw`, `capacityKwh`, `socMin`, `socMax` |
| 10 | GET | `/assets` | `get-assets.ts` | JWT | VPP assets 3-tier nested view — `assets LEFT JOIN device_state LEFT JOIN revenue_daily LEFT JOIN vpp_strategies`. AppConfig feature flag: `show-roi-metrics` |

---

### 2.4 Gateways & Fleet (网关与车队) — 15 routes / 14 handler files

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 11 | GET | `/api/gateways` | `get-gateways.ts` | JWT | Gateway list with org/device state |
| 12 | GET | `/api/gateways/summary` | `get-gateways-summary.ts` | JWT | Summary aggregation (revenue, SOC, online count) |
| 13 | GET | `/api/gateways/:gatewayId/detail` | `get-gateway-detail.ts` | JWT | Full gateway detail — 3 parallel queries |
| 14 | GET | `/api/gateways/:gatewayId/devices` | `get-gateway-devices.ts` | JWT | Devices under a gateway |
| 15 | GET | `/api/gateways/:gatewayId/energy` | `get-gateway-energy.ts` | JWT | 288 × 5-min points (24h高精度能量时序). Also serves `/energy-24h` |
| 16 | GET | `/api/gateways/:gatewayId/energy-24h` | `get-gateway-energy.ts` | JWT | Alias for `/energy` (shared handler file) |
| 17 | GET | `/api/gateways/:gatewayId/energy-stats` | `get-gateway-energy-stats.ts` | JWT | Aggregated stats — window: `7d`\|`30d`\|`12m`. Dual-source: `asset_5min_metrics` primary, `telemetry_history` fallback |
| 18 | GET | `/api/gateways/:gatewayId/schedule` | `get-gateway-schedule.ts` | JWT | Current active schedule |
| 19 | PUT | `/api/gateways/:gatewayId/schedule` | `put-gateway-schedule.ts` | JWT | Schedule submission — `DomainSchedule` format. 409 Conflict guard (Dispatch Guard). Returns **202 Accepted** |
| 20 | PATCH | `/api/gateways/:gatewayId/home-alias` | `patch-gateway-home-alias.ts` | JWT | Set human-readable home alias (更新家庭别名). **Note:** This route is registered in CDK (bff-stack) but NOT in local-server.ts. Local development does not expose this endpoint. |
| 21 | GET | `/api/fleet/overview` | `get-fleet-overview.ts` | JWT | Fleet overview read model (EP-1 v6.1) — `gateways JOIN backfill_requests` |
| 22 | GET | `/api/fleet/integradores` | `get-fleet-integradores.ts` | JWT | Integrator-level fleet view (EP-2 v6.1) — `organizations JOIN gateways JOIN backfill_requests JOIN telemetry_history JOIN assets` |
| 23 | GET | `/api/fleet/offline-events` | `get-fleet-offline-events.ts` | JWT | Returns recent gateway outage events (last 7 days). Added in v5.12 |
| 24 | GET | `/api/fleet/uptime-trend` | `get-fleet-uptime-trend.ts` | JWT | Returns 28-day daily uptime percentage trend. Added in v5.12 |
| 25 | GET | `/api/fleet/charts` | `get-fleet-charts.ts` | JWT | Fleet-level chart data (v5.12) |

---

### 2.5 HEMS (家庭能源管理) — 4 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 26 | GET | `/api/hems/overview` | `get-hems-overview.ts` | JWT | HEMS dashboard — `assets`, `tariff_schedules`, `dispatch_commands`. 3 parallel queries |
| 27 | POST | `/api/hems/batch-dispatch` | `post-hems-batch-dispatch.ts` | **OPERATOR** | Batch schedule dispatch — 100-gateway limit (v6.0). 4 batch queries; per-gateway merge; 409 skip for active commands; source tagged `'p4'` |
| 28 | GET | `/api/hems/batch-history` | `get-hems-batch-history.ts` | JWT | Batch dispatch history log |
| 29 | GET | `/api/hems/targeting` | `get-hems-targeting.ts` | JWT | Fleet eligibility for HEMS Control Workbench (v6.4) — current mode, current slots, `hasActiveCommand` per gateway |

---

### 2.6 VPP (虚拟电厂) — 3 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 30 | GET | `/api/vpp/capacity` | `get-vpp-capacity.ts` | JWT | Aggregate VPP capacity — `assets JOIN device_state JOIN gateways JOIN vpp_strategies` |
| 31 | GET | `/api/vpp/latency` | `get-vpp-latency.ts` | JWT | Cumulative latency distribution (1s/5s/15s/30s/1min/15min/1h tiers). Param: `days` (1-365, default 30) |
| 32 | GET | `/api/vpp/dr-events` | `get-vpp-dr-events.ts` | JWT | DR event history grouped by hour. Param: `limit` (1-100, default 20) |

---

### 2.7 Revenue & Tariffs (收入与电价) — 3 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 33 | GET | `/revenue-trend` | `get-revenue-trend.ts` | JWT | 7-day dual-layer revenue trend (`revenue_daily`) |
| 34 | GET | `/api/tariffs` | `get-tariffs.ts` | JWT | Latest tariff schedule: peak/intermediate/offpeak rates, feed-in rate, time windows, demand charge rate, billing power factor |
| 35 | GET | `/trades` | `get-trades.ts` | JWT | Trade schedule list — `trade_schedules JOIN assets` |

---

### 2.8 Performance (性能指标) — 2 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 36 | GET | `/api/performance/scorecard` | `get-performance-scorecard.ts` | JWT | 14 metrics across 3 categories, 8 parallel queries |
| 37 | GET | `/api/performance/savings` | `get-performance-savings.ts` | JWT | 30-day savings analysis by home (gateway). Param: `period` (`month`\|`quarter`\|`year`) |

**Scorecard — 14 metrics, 3 categories (记分卡指标分类)**:

| Category | Metrics | Count |
|----------|---------|-------|
| **Hardware** | Commissioning Time, Offline Resilience, Uptime, First Telemetry | 4 |
| **Optimization** | Actual Savings, Optimization Efficiency, Self-Consumption, Self-Sufficiency, PV Forecast MAPE, Load Forecast Adapt | 6 |
| **Operations** | Dispatch Accuracy, Training Time, Manual Interventions, App Uptime | 4 |

Status evaluation: `pass` / `near` / `warn`

---

### 2.9 P5 Strategy Triggers (P5 策略触发器) — 5 routes / 4 handler files [v6.5 NEW]

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 38 | GET | `/api/p5/overview` | `get-p5-overview.ts` | JWT | Hero posture + intent lanes + context (策略概览 — 英雄姿态 + 意图车道 + 上下文) |
| 39 | GET | `/api/p5/intents/:intentId` | `get-p5-intent-detail.ts` | JWT | Intent detail + recovery condition + available actions |
| 40 | POST | `/api/p5/intents/:intentId/:action` | `post-p5-intent-action.ts` | **OPERATOR** | Governance actions: `approve`, `defer`, `suppress`, `escalate` |
| 41 | POST | `/api/p5/posture-override` | `post-p5-posture-override.ts` | **OPERATOR** | Create or cancel posture override (max 8h / 480 min) |
| 42 | POST | `/api/p5/posture-override/:overrideId/cancel` | `post-p5-posture-override.ts` | **OPERATOR** | Cancel an active posture override. Added in v6.5 |

**`get-p5-overview.ts` — Response shape (`P5Overview`)**:

```json
{
  "hero": {
    "posture": "calm | approval_gated | protective | escalation",
    "dominant_driver": "string",
    "governance_mode": "observe | approval_required | auto_governed | escalate",
    "governance_summary": "string",
    "override_active": false,
    "conflict_active": false,
    "operator_action_needed": false
  },
  "calm_explanation": { "reason": "...", "detail": "...", "contributing_factors": [] },
  "need_decision_now": ["IntentCard..."],
  "platform_acting": ["IntentCard..."],
  "watch_next": ["IntentCard..."],
  "context": {
    "operating_posture": {},
    "dominant_protector": null,
    "recent_handoffs": [],
    "suppressed_count": 0,
    "deferred_count": 0
  }
}
```

Calm explanation reasons: `no_conditions_detected` | `override_suppressing` | `all_deferred` | `telemetry_stale`

**`post-p5-intent-action.ts` — Governance-mode-aware action allowance (治理模式动作矩阵)**:

| Governance Mode | Allowed Actions |
|-----------------|----------------|
| `approval_required` | approve, defer, suppress, escalate |
| `auto_governed` | defer, suppress, escalate |
| `observe` | defer, suppress |
| `escalate` | defer, escalate |
| Intent status `deferred` | escalate only |

- `suppress` requires `reason`
- `defer` requires `defer_until` (valid future ISO timestamp)

**`post-p5-posture-override.ts` — Override types**:
`force_protective`, `suppress_economic`, `force_approval_gate`, `manual_escalation_note`, `suppress_alerts`

---

### 2.10 Asset History (资产历史) — 2 handlers

| # | Method | Route | Handler File | Auth | Description |
|---|--------|-------|-------------|------|-------------|
| 43 | GET | `/api/assets/:assetId/telemetry` | `get-asset-telemetry.ts` | JWT | Multi-resolution energy flow (P3 v5.24). Params: `from`, `to` (ISO), `resolution` (`5min`\|`hour`\|`day`\|`month`). Max 400 days |
| 44 | GET | `/api/assets/:assetId/health` | `get-asset-health.ts` | JWT | Device health time series — 8 parallel queries (SOC, SOH, temperature, cycles, voltage/current, DO events) |

---

### 2.11 Legacy (旧版端点) — 3 handlers

| # | Method | Route | Handler File | Auth | Status |
|---|--------|-------|-------------|------|--------|
| 45 | GET | `/api/homes` | `get-homes.ts` | JWT | **Deprecated** — replaced by `get-gateways.ts` (v5.19) |
| 46 | GET | `/api/homes/summary` | `get-homes-summary.ts` | JWT | **Deprecated** — replaced by `get-gateways-summary.ts` (v5.19) |
| 47 | GET | `/api/homes/:homeId/energy` | `get-home-energy.ts` | JWT | **Deprecated** — replaced by `get-gateway-energy.ts` (v5.19) |

> **Note:** These handlers exist as files but are NOT registered in local-server.ts. They are legacy code retained for potential CDK compatibility only.

---

## 3. SSE Events System (服务器推送事件系统)

### 3.1 Architecture

**Handler**: `sse-events.ts` at `GET /api/events`

```
Client (EventSource) ──► Express ──► Dedicated pg.Client (NOT from pool)
                                          │
                                   LISTEN telemetry_update
                                   LISTEN gateway_health
                                          │
                                   pg_notify channel ◄── IoT Hub / Telemetry writers
```

### 3.2 pg_notify Channels (推送频道)

| Channel | Trigger Source | Payload | Consumer Action |
|---------|---------------|---------|-----------------|
| `telemetry_update` | M1 IoT Hub telemetry ingest | `{ gatewayId }` | Frontend refreshes device state / energy charts |
| `gateway_health` | M1 watchdog / heartbeat handler | `{ gatewayId }` | Frontend updates online/offline indicator |

> **Note:** M3 fires `pg_notify('command_status', ...)` but `sse-events.ts` does NOT subscribe to this channel. Only `telemetry_update` and `gateway_health` are active SSE channels.

### 3.3 Connection Management (连接管理)

| Aspect | Detail |
|--------|--------|
| **Pool strategy** | Dedicated `pg.Client` per SSE connection (NOT from connection pool — long-lived LISTEN requires dedicated connection) |
| **Connection string** | `APP_DATABASE_URL` → `DATABASE_URL` → fallback `postgresql://solfacil_app:...@127.0.0.1:5433/solfacil_vpp` |
| **Keepalive** | `:keepalive\n\n` ping every 30 seconds |
| **Cleanup on disconnect** | `UNLISTEN *` → `client.end()` |

**Response Headers**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**SSE Event Shape**:
```
data: {"type":"telemetry_update","gatewayId":"GW_001"}

data: {"type":"gateway_health","gatewayId":"GW_001"}
```

---

## 4. Background Services (后台服务)

Started from `backend/scripts/local-server.ts` alongside the Express server:

| Service | Module | Interval | Description |
|---------|--------|----------|-------------|
| `startScheduleGenerator` | M2 Optimization Engine | Hourly (`0 * * * *`) + on startup | Generate SC/TOU/Peak Shaving schedules for eligible assets |
| `startCommandDispatcher` | M3 DR Dispatcher | Every minute (`* * * * *`) | Poll `dispatched` commands → publish MQTT config/set |
| `startTimeoutChecker` | M3 DR Dispatcher | Every minute (`* * * * *`) | Expire stale commands past timeout threshold |
| `startBillingJob` | M4 Market Billing | Daily at 00:05 UTC | Compute daily revenue attribution (SC/TOU/PS savings) |
| `startTelemetryAggregator` | M1 IoT Hub | Hourly (`:05` past hour) | Roll up `telemetry_history` → `asset_hourly_metrics` |
| `startTelemetry5MinAggregator` | M1 IoT Hub | Every 5 minutes (`*/5 * * * *`) | Roll up `telemetry_history` → `asset_5min_metrics` |

> All background services use the **Service Pool** (BYPASSRLS) since they operate across all orgs.

---

## 5. Webhook Routes (Webhook 路由)

| Method | Route | Handler (Module) | Auth | Description |
|--------|-------|-----------------|------|-------------|
| POST | `/webhooks/weather` | `open-api/handlers/weather-webhook.ts` | NONE | External weather data ingest |
| POST | `/webhooks/ccee-pld` | `open-api/handlers/ccee-webhook.ts` | NONE | CCEE PLD (Preço de Liquidação das Diferenças) price update |
| POST | `/api/telemetry/mock` | `iot-hub/handlers/telemetry-webhook.ts` | NONE | Mock telemetry injection (development/testing) |
| POST | `/api/dispatch/ack` | `dr-dispatcher/handlers/collect-response.ts` | NONE | Device command acknowledgment callback |

> Webhooks bypass JWT auth — they are either registered outside the `/api/*` prefix or are Express-native handlers not routed through `wrapHandler`.

### 5.1 Route Registration Divergence (路由注册差异)

- Most routes are registered in both `local-server.ts` (Express, for local dev) and CDK (`bff-stack.ts`, for AWS Lambda).
- **Exception:** `PATCH /api/gateways/:gatewayId/home-alias` is CDK-only — it is NOT registered in `local-server.ts`.
- The `local-server.ts` file is the authoritative route surface for local development.

---

## 6. Response Status Codes (HTTP 状态码)

| Code | Meaning | Usage |
|------|---------|-------|
| **200** | OK | Successful GET, POST action results, PUT update results |
| **201** | Created | User creation (`admin-users.ts`) |
| **202** | Accepted | Schedule submission queued (`put-gateway-schedule`, `put-device-schedule`) — async processing |
| **400** | Bad Request | Validation errors: missing params, invalid values, malformed JSON, date range violations |
| **401** | Unauthorized | Missing or invalid JWT token |
| **403** | Forbidden | Insufficient role permissions (`requireRole` check failed) |
| **404** | Not Found | Resource not found: asset, gateway, device, intent, override |
| **409** | Conflict | Dispatch Guard — active pending/dispatched/accepted command in progress |
| **500** | Internal Server Error | Catch-all for unexpected errors |

---

## 7. Auth Roles (认证角色矩阵)

### 7.1 Role Definitions

| Role | Scope | Description |
|------|-------|-------------|
| **SOLFACIL_ADMIN** | Platform-wide | Bypass all RLS restrictions. Full read/write access. Can create users and manage all organizations |
| **ORG_MANAGER** | Organization | Full read/write within own org. Can modify device settings, submit schedules |
| **ORG_OPERATOR** | Organization | Read access + operational actions: batch dispatch, P5 governance actions, posture overrides |
| **ORG_VIEWER** | Organization | Read-only access to all GET endpoints within own org |

### 7.2 RBAC Matrix (角色权限矩阵)

| Action | SOLFACIL_ADMIN | ORG_MANAGER | ORG_OPERATOR | ORG_VIEWER |
|--------|:-:|:-:|:-:|:-:|
| All GET read endpoints | Y | Y | Y | Y |
| PUT /api/devices/:id | Y | Y | -- | -- |
| PUT /api/devices/:id/schedule | Y | Y | -- | -- |
| PUT /api/gateways/:id/schedule | Y | Y | -- | -- |
| PATCH /api/gateways/:id/home-alias | Y | Y | -- | -- |
| POST /api/hems/batch-dispatch | Y | Y | Y | -- |
| GET /api/hems/targeting | Y | Y | Y | -- |
| P5 overview + intent detail (GET) | Y | Y | Y | -- |
| P5 intent action + posture override (POST) | Y | Y | Y | -- |
| POST /api/users | Y | -- | -- | -- |
| POST /api/auth/login | PUBLIC | PUBLIC | PUBLIC | PUBLIC |
| GET /api/events (SSE) | Y | Y | Y | Y |
| Webhooks | NO AUTH | NO AUTH | NO AUTH | NO AUTH |

---

## V2.4 Protocol Impact

**Two BFF handlers required changes for V2.4 compatibility:**

1. **`get-ems-health.ts`** — Added dual-key fallback for `ems_health` JSON field access. V2.4 gateways send lowercase keys (`battery_voltage`, `grid_frequency`, etc.) while V1.x gateways use uppercase (`Battery_Voltage`, `Grid_Frequency`). The handler now tries lowercase first, falls back to uppercase. This ensures P2 Device panel displays EMS health metrics correctly regardless of gateway firmware version.

2. **`get-telemetry-extra.ts`** — Fixed nested JSONB navigation for `telemetry_extra` payload. V2.4 restructured the telemetry extension fields into a nested object; the handler now navigates the correct path for both flat (V1.x) and nested (V2.4) layouts.

**No route additions or removals.** The 47 route / 45 handler count is unchanged. All other handlers read from PostgreSQL columns whose names and semantics are unaffected by V2.4.

---

## Document History (文档历史)

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: BFF Gateway + 4 endpoints |
| v5.12 | 2026-03-05 | API Contract Alignment — 15 new endpoints |
| v5.19 | 2026-03-10 | homes → gateways migration: 7 new gateway handlers |
| v5.21 | 2026-03-12 | SSE real-time push |
| v5.24 | 2026-03-13 | P3 Asset History: telemetry + health |
| v6.1 | 2026-03-18 | Fleet overview EP-1 + EP-2 |
| v6.4 | 2026-03-25 | HEMS targeting workbench |
| v6.5 | 2026-03-28 | P5 Strategy Triggers: 4 handlers, 5 routes |
| **v6.6** | **2026-03-31** | Full BFF inventory audit — 47 route endpoints (45 unique handler files) + SSE + middleware (Git HEAD `4ec191a`) |
| **v6.7** | **2026-04-02** | **V2.4 protocol alignment: `get-ems-health.ts` dual-key fallback (V2.4 lowercase + V1.x uppercase), `get-telemetry-extra.ts` nested JSONB navigation fix. No route count change (47/45). Git HEAD `b94adf3`.** |
