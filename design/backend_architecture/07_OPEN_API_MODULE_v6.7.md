# Module 7: Open API & Integration (M7)

> **Module Version**: v6.7
> **Git HEAD**: `b94adf3`
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.7.md](./00_MASTER_ARCHITECTURE_v6.7.md)
> **Last Updated**: 2026-04-02
> **Description**: External-facing webhook delivery and inbound data endpoints -- HMAC-SHA256 signed outbound webhooks, CCEE wholesale price receiver, weather data receiver
> (**说明**: 对外webhook推送与入站数据端点 -- HMAC-SHA256签名出站webhook、CCEE批发电价接收器、天气数据接收器)

---

## 1. Module Overview

M7 provides the external integration surface of the VPP platform. It contains three TypeScript handlers:

1. **Outbound webhook delivery** (`webhook-delivery.ts`) -- EventBridge-triggered Lambda that signs payloads with HMAC-SHA256 and delivers to external systems with AppConfig-driven per-org timeouts.
   (出站webhook推送：EventBridge触发的Lambda，HMAC-SHA256签名，AppConfig驱动的每组织超时)

2. **CCEE wholesale price receiver** (`ccee-webhook.ts`) -- inbound webhook accepting CCEE PLD price data, UPSERT to `pld_horario` table covering 4 submercados.
   (CCEE批发电价接收器：接收CCEE PLD价格数据，UPSERT至pld_horario表，覆盖4个子市场)

3. **Weather data receiver** (`weather-webhook.ts`) -- inbound webhook accepting weather forecasts, UPSERT to `weather_cache` table.
   (天气数据接收器：接收天气预报数据，UPSERT至weather_cache表)

### Source Layout

```
src/open-api/
├── handlers/
│   ├── webhook-delivery.ts     # EventBridge → HMAC-SHA256 sign → outbound POST
│   ├── ccee-webhook.ts         # POST /webhooks/ccee-pld — CCEE PLD price receiver
│   └── weather-webhook.ts      # POST /webhooks/weather — weather data receiver
```

### v5.7 Planned vs v6.6 Implemented

| Feature | v5.7 Plan | v6.6 Status |
|---------|-----------|-------------|
| OAuth 2.0 Client Credentials | Designed (Cognito) | **Not implemented** |
| API Keys + Usage Plans | Designed | **Not implemented** |
| WAF WebACL | Designed | **Not implemented** |
| Rate Limiting tiers | 3 tiers | **Not implemented** |
| Webhook subscription CRUD | DynamoDB-based | **Not implemented** |
| Outbound webhook signing | Lambda + HMAC-SHA256 | **Implemented** |
| Inbound webhook receivers | POST endpoints | **Implemented** |
| Separate secrets per source | Per-source env vars | **Unified** `WEBHOOK_SECRET` |

---

## 2. webhook-delivery.ts (Outbound Webhook Delivery)

**Trigger**: EventBridge event with `WebhookDelivery` detail type
**Purpose**: Sign payload with HMAC-SHA256 and POST to external webhook URL with AppConfig-driven timeout
(签名payload并POST至外部webhook URL，超时由AppConfig驱动)

### 2.1 Event Input

```typescript
export interface WebhookEvent {
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly orgId: string;
  readonly traceId?: string;
}
```

### 2.2 HMAC-SHA256 Signing

Outbound webhooks are signed and include three custom headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `x-vpp-signature` | `sha256=<hex-digest>` | HMAC-SHA256 of JSON body (JSON body的HMAC-SHA256摘要) |
| `x-vpp-event-type` | Event type string | Event classification (事件分类) |
| `x-vpp-org-id` | Organization ID | Tenant identification (租户识别) |

**Signing code**:

```typescript
const bodyStr = JSON.stringify(payload);
const signature = createHmac('sha256', secret)
  .update(bodyStr)
  .digest('hex');
```

The signing secret is read from `process.env.WEBHOOK_SECRET`. If not set, the handler throws `Error('WEBHOOK_SECRET not configured')`.
(签名密钥从环境变量WEBHOOK_SECRET读取。未设置时抛出错误)

### 2.3 AppConfig-Driven Dynamic Timeout

Delivery timeout is resolved per-org from AWS AppConfig `api-quotas` configuration:

```typescript
async function fetchWebhookTimeout(orgId: string): Promise<number> {
  const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/api-quotas`;
  const res = await fetch(url, { signal: AbortSignal.timeout(500) });
  const quotas = await res.json() as ApiQuotasConfig;
  return quotas[orgId]?.webhookTimeoutMs ?? 10_000;  // default 10s
}
```

| Behavior | Detail |
|----------|--------|
| Per-org configurable timeout | Via `api-quotas` AppConfig profile |
| AppConfig fetch timeout | 500ms (fail-safe) |
| Default on any error | 10,000ms (10 seconds) |
| Request cancellation | `AbortController` with `setTimeout` |

### 2.4 Error Handling

| Error Type | Behavior |
|------------|----------|
| HTTP non-2xx response | Throws `Error` with status code (triggers EventBridge retry) |
| `AbortError` (timeout) | Throws descriptive timeout error |
| All other errors | Re-thrown for EventBridge DLQ processing |

### 2.5 Environment Variables

| Env Var | Default | Purpose |
|---------|---------|---------|
| `WEBHOOK_SECRET` | (none -- required) | HMAC signing secret (HMAC签名密钥) |
| `APPCONFIG_BASE_URL` | `http://localhost:2772` | AppConfig Lambda Extension endpoint |
| `APPCONFIG_APP` | `solfacil-vpp-dev` | AppConfig application name |
| `APPCONFIG_ENV` | `dev` | AppConfig environment |

---

## 3. ccee-webhook.ts (CCEE Wholesale Price Receiver)

**Route**: `POST /webhooks/ccee-pld`
**Purpose**: Receive CCEE wholesale electricity price (PLD) updates, UPSERT to `pld_horario` table
(接收CCEE批发电价更新，UPSERT至pld_horario表)

### 3.1 Authentication

```typescript
function getWebhookSecret(): string {
  return process.env.WEBHOOK_SECRET ?? "dev-secret-2026";
}
```

- Header: `x-webhook-secret: <shared-secret>`
- Validates against `WEBHOOK_SECRET` environment variable
- Mismatch or missing -> `401 Unauthorized`

### 3.2 Request Payload

```typescript
export interface CceePldPayload {
  mes_referencia: number;   // e.g. 202603 (参考月份)
  dia: number;              // 1-31 (日)
  hora: number;             // 0-23 (小时)
  submercado: "SUDESTE" | "SUL" | "NORDESTE" | "NORTE";  // 4 submercados (4个子市场)
  price_brl_mwh: number;   // e.g. 487.50 (价格 R$/MWh)
  published_at?: string;    // ISO 8601 (optional)
}
```

### 3.3 Validation Steps

1. `x-webhook-secret` header check -> 401 if invalid
2. Required fields: `mes_referencia`, `dia`, `hora`, `submercado`, `price_brl_mwh` -> 400 if missing
3. `submercado` enum validation against `["SUDESTE", "SUL", "NORDESTE", "NORTE"]` -> 400 if invalid
   (4个巴西电力子市场：东南、南、东北、北)

### 3.4 UPSERT SQL

```sql
INSERT INTO pld_horario (mes_referencia, dia, hora, submercado, pld_hora)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (mes_referencia, dia, hora, submercado)
DO UPDATE SET pld_hora = EXCLUDED.pld_hora
```

### 3.5 Response

- `200 OK`: `{"status":"accepted","rows_upserted":1,"detail":"pld_horario updated: SUDESTE 202603/31 hora=17 -> R$487.5/MWh"}`
- `401 Unauthorized`: `{"error":"Unauthorized"}`
- `400 Bad Request`: `{"error":"Invalid payload"}` or `{"error":"Invalid submercado: ..."}`
- `500`: `{"error":"Database error"}`

---

## 4. weather-webhook.ts (Weather Data Receiver)

**Route**: `POST /webhooks/weather`
**Purpose**: Receive weather forecast data, UPSERT to `weather_cache` table
(接收天气预报数据，UPSERT至weather_cache表)

### 4.1 Authentication

Identical to CCEE webhook: `x-webhook-secret` header validated against `WEBHOOK_SECRET` env var.
(与CCEE webhook相同的认证方式)

### 4.2 Request Payload

```typescript
export interface WeatherPayload {
  location: string;          // e.g. 'SP', 'RJ' (位置)
  forecast_time: string;     // ISO 8601 (预报时间)
  temperature_c: number;     // Temperature in Celsius (温度)
  irradiance_w_m2: number;   // Solar irradiance W/m2 (太阳辐照度)
  cloud_cover_pct?: number;  // Cloud cover % (optional, defaults to null) (云量)
  source?: string;           // Data source, defaults to 'webhook' (数据来源)
}
```

### 4.3 Validation Steps

1. `x-webhook-secret` header check -> 401 if invalid
2. Required fields: `location`, `forecast_time`, `temperature_c`, `irradiance_w_m2` -> 400 if missing
3. `cloud_cover_pct` is optional (defaults to `null`)

### 4.4 UPSERT SQL

```sql
INSERT INTO weather_cache (location, recorded_at, temperature, irradiance, cloud_cover, source)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (location, recorded_at)
DO UPDATE SET
  temperature = EXCLUDED.temperature,
  irradiance  = EXCLUDED.irradiance,
  cloud_cover = EXCLUDED.cloud_cover,
  source      = EXCLUDED.source
```

### 4.5 Field Mapping (Request -> DB)

| Request Field | DB Column | Transform |
|---------------|-----------|-----------|
| `location` | `location` | Direct |
| `forecast_time` | `recorded_at` | `new Date(forecast_time)` |
| `temperature_c` | `temperature` | Direct |
| `irradiance_w_m2` | `irradiance` | Direct |
| `cloud_cover_pct` | `cloud_cover` | `?? null` |
| `source` | `source` | `?? 'webhook'` |

### 4.6 Response

- `200 OK`: `{"status":"accepted","rows_upserted":1,"detail":"weather_cache updated: SP at 2026-03-31T17:00:00-03:00"}`
- `401 Unauthorized`: `{"error":"Unauthorized"}`
- `400 Bad Request`: `{"error":"Invalid payload"}`
- `500`: `{"error":"Database error"}`

---

## 5. DB Tables (数据库表)

### 5.1 `pld_horario`

| Column | Type | Constraint |
|--------|------|-----------|
| `mes_referencia` | `INT` | PK (composite) |
| `dia` | `SMALLINT` | PK (composite) |
| `hora` | `SMALLINT` | PK (composite) |
| `submercado` | `VARCHAR(10)` | PK (composite) |
| `pld_hora` | `NUMERIC(10,2)` | NOT NULL |

Composite PK: `(mes_referencia, dia, hora, submercado)` -- guarantees UPSERT idempotency.
(复合主键保证UPSERT幂等性)

### 5.2 `weather_cache`

| Column | Type | Constraint |
|--------|------|-----------|
| `id` | `SERIAL` | PRIMARY KEY |
| `location` | `VARCHAR(100)` | NOT NULL, UNIQUE (composite) |
| `recorded_at` | `TIMESTAMPTZ` | NOT NULL, UNIQUE (composite) |
| `temperature` | `DECIMAL(5,2)` | |
| `irradiance` | `DECIMAL(8,2)` | |
| `cloud_cover` | `DECIMAL(5,2)` | |
| `source` | `VARCHAR(50)` | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() |

Unique constraint: `(location, recorded_at)` -- guarantees UPSERT idempotency.
Index: `idx_weather_location_time ON weather_cache (location, recorded_at DESC)`

---

## 6. Security (安全)

### 6.1 Outbound: HMAC-SHA256 Signing

- Every outbound webhook carries `x-vpp-signature: sha256=<hex>` header
- Recipients verify by computing `HMAC-SHA256(shared_secret, request_body)` and comparing
- No replay protection (no timestamp in signature input) -- planned for Phase 2
  (无重放保护 -- 计划在Phase 2实现)

### 6.2 Inbound: Webhook Secret Header Validation

- Both inbound endpoints use `x-webhook-secret` header
- Single `WEBHOOK_SECRET` env var for all inbound sources (not per-source)
- Dev fallback: `"dev-secret-2026"` (should be overridden in production)
  (两个入站端点使用统一的WEBHOOK_SECRET环境变量)

### 6.3 UPSERT Idempotency

Both inbound receivers use PostgreSQL `INSERT ... ON CONFLICT DO UPDATE`:
- Duplicate pushes overwrite with latest values (verified by integration tests)
- Atomic single SQL statement -- no read-then-write race conditions
- Conflict-safe: PostgreSQL handles concurrent writes
  (两个入站接收器使用ON CONFLICT DO UPDATE实现幂等)

| Receiver | Target Table | Conflict Key | Updated Columns |
|----------|-------------|--------------|----------------|
| `/webhooks/ccee-pld` | `pld_horario` | `(mes_referencia, dia, hora, submercado)` | `pld_hora` |
| `/webhooks/weather` | `weather_cache` | `(location, recorded_at)` | `temperature`, `irradiance`, `cloud_cover`, `source` |

---

## 7. Route Registration (路由注册)

Routes are registered in the local Express server (`backend/scripts/local-server.ts`):

```typescript
app.post("/webhooks/ccee-pld", handleCceeWebhook);
app.post("/webhooks/weather", handleWeatherWebhook);
```

> In production, inbound webhooks are handled by independent Lambda functions routed via API Gateway HTTP API.
> (生产环境中，入站webhook由独立Lambda函数处理，通过API Gateway HTTP API路由)

---

## 8. Module Dependencies (模组依赖)

| Direction | Module | Description |
|-----------|--------|-------------|
| **Writes** | `pld_horario` | POST /webhooks/ccee-pld -> UPSERT |
| **Writes** | `weather_cache` | POST /webhooks/weather -> UPSERT |
| **Read by** | M2 (Optimization Engine) | Schedule generator reads `pld_horario` for PLD pricing (排程产生器读取PLD电价) |
| **Read by** | M2 (Strategy Evaluator) | Could read `weather_cache` for irradiance-based decisions |
| **Depends on** | M8 (Admin Control) | `webhook-delivery.ts` reads AppConfig `api-quotas` for per-org timeouts |
| **Depends on** | Shared DB (`getPool`) | Inbound handlers use `src/shared/db` connection pool |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: M2M Gateway, Webhook, WAF, Rate Limiting design |
| v5.7 | 2026-02-28 | Inbound Webhook Receivers: POST /webhooks/ccee-pld, POST /webhooks/weather, Mock Publisher design |
| **v6.6** | **2026-03-31** | **Code-aligned rewrite: document actual 3 handler implementations; webhook-delivery with HMAC-SHA256 + AppConfig timeouts; unified WEBHOOK_SECRET; updated signing headers (x-vpp-*); UPSERT patterns; DB table schemas; security model** |
| **v6.7** | **2026-04-02** | **Version bump for V2.4 protocol upgrade. No M7 code changes — webhook delivery and inbound receivers (weather/CCEE) are unaffected by MQTT protocol changes.** |

---

## V2.4 Protocol Impact

**No code changes required.** M7 handles outbound webhook delivery (HMAC-SHA256 signed HTTP) and inbound weather/CCEE-PLD endpoints. These operate on HTTP-layer data (weather JSON, PLD CSV) entirely independent of the Xuheng EMS MQTT protocol version.
