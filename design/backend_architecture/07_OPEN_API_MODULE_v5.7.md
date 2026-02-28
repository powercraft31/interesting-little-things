# Module 7: Open API & Integration

> **模組版本**: v5.7
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.7.md](./00_MASTER_ARCHITECTURE_v5.7.md)
> **最後更新**: 2026-02-28
> **說明**: 第三方對外 API Gateway、Webhook 派發、API Key 管理、Rate Limiting、WAF、HMAC 簽名、Inbound Webhook Receivers

---

## 1. 模組職責

M7 為外部合作夥伴（ERP 系統、交易平台、聚合商）提供 M2M API 存取和事件驅動的 Webhook 推送。

核心職責：
- 獨立的 M2M API Gateway（與 BFF 分離）
- OAuth 2.0 Client Credentials 認證
- API Key + Usage Plans 管理
- WAF WebACL 安全防護
- Rate Limiting 配額控制
- Event-driven Webhook 推送（HMAC-SHA256 簽名）
- Dead Letter Queue 處理失敗投遞
- **v5.7 新增：Inbound Webhook Receivers（接收外部資料推送）**

---

## 2. CDK Stack: `OpenApiStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| API Gateway (M2M) | API Gateway v2 (HTTP API) | **Separate** from BFF — for external integrations |
| Resource Server | Cognito Resource Server | OAuth 2.0 scopes: `solfacil/read`, `solfacil/dispatch`, `solfacil/billing` |
| Machine Client(s) | Cognito App Client | Client Credentials flow (no user login) |
| Usage Plans | API Gateway Usage Plans | Per-client rate limiting and quotas |
| WAF WebACL | AWS WAF v2 | OWASP Core Rule Set, SQLi protection, IP rate limiting |
| Webhook Subscriptions | DynamoDB | Self-service webhook registration |
| Webhook Connections | EventBridge Connection | Auth credentials for outbound webhooks |
| API Destinations | EventBridge API Destination | Target URL + rate limit |
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
  ├─ Inbound Webhook Lambda (v5.7):
  │   └─ rds-data:ExecuteStatement     → UPSERT pld_horario, weather_cache
  └─ WAF WebACL:
      └─ Associated with M2M API Gateway stage
```

---

## 3. EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Consumes** | `DRDispatchCompleted` | ← M3 → webhook delivery to external systems |
| **Consumes** | `InvoiceGenerated` | ← M4 → webhook delivery to billing systems |
| **Consumes** | `AssetModeChanged` | ← M3 → webhook delivery to monitoring systems |
| **Consumes** | `TariffUpdated` | ← M4 → webhook delivery to trading platforms |
| **Consumes** | `AlertTriggered` | ← M1 → webhook delivery to on-call systems |

---

## 4. M2M Authentication

### Option A: API Keys + Usage Plans (Low-Security)

```typescript
const usagePlan = api.addUsagePlan('ExternalPartnerPlan', {
  name: 'external-partner-plan',
  throttle: { rateLimit: 50, burstLimit: 100 },
  quota: { limit: 10_000, period: apigateway.Period.DAY },
});
const partnerKey = api.addApiKey('EnergiaCorpApiKey', { apiKeyName: 'energia-corp-erp' });
usagePlan.addApiKey(partnerKey);
```

### Option B: OAuth 2.0 Client Credentials (Enterprise)

```typescript
const resourceServer = this.userPool.addResourceServer('VppApi', {
  identifier: 'solfacil',
  scopes: [
    new cognito.ResourceServerScope({ scopeName: 'read', scopeDescription: 'Read assets, telemetry, trades' }),
    new cognito.ResourceServerScope({ scopeName: 'dispatch', scopeDescription: 'Dispatch mode changes' }),
    new cognito.ResourceServerScope({ scopeName: 'billing', scopeDescription: 'Billing, revenue, tariff data' }),
  ],
});

const machineClient = this.userPool.addClient('EnergiaCorp-ERP', {
  userPoolClientName: 'energia-corp-erp-m2m',
  generateSecret: true,
  oAuth: {
    flows: { clientCredentials: true },
    scopes: [cognito.OAuthScope.custom('solfacil/read'), cognito.OAuthScope.custom('solfacil/billing')],
  },
  accessTokenValidity: cdk.Duration.hours(1),
});
```

### Recommendation

| Use Case | Recommended | Rationale |
|----------|-------------|-----------|
| Internal Solfacil ERP | Client Credentials | Sensitive billing data |
| External energy aggregator | Client Credentials | Third-party trust boundary |
| Energy trading platform | Client Credentials | Financial transactions |
| Monitoring / health-check | API Key | Low-sensitivity read-only |

---

## 5. Rate Limiting & Quota Tiers

| Tier | Rate Limit | Burst | Daily Quota | Monthly Quota |
|------|-----------|-------|-------------|---------------|
| Standard | 50 rps | 100 | 10,000 | 300,000 |
| Professional | 200 rps | 400 | 100,000 | 3,000,000 |
| Enterprise | 500 rps | 1,000 | Unlimited | Unlimited |

---

## 6. WAF WebACL

```typescript
const webAcl = new wafv2.CfnWebACL(this, 'VppApiWaf', {
  scope: 'REGIONAL',
  defaultAction: { allow: {} },
  rules: [
    { name: 'AWS-AWSManagedRulesCommonRuleSet', priority: 1, /* OWASP Core */ },
    { name: 'AWS-AWSManagedRulesSQLiRuleSet', priority: 2, /* SQLi protection */ },
    { name: 'RateLimit', priority: 3, action: { block: {} },
      statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } } },
  ],
});
```

---

## 7. Event-Driven Webhooks

### Architecture

```
Internal Event ──► EventBridge ──► Rule (org-scoped) ──► Signing Proxy Lambda ──► API Destination ──► External System
                                                                                         │
                                                                                  (Retry up to 185x / 24h)
                                                                                         │
                                                                                  ──► SQS DLQ (on exhaustion)
```

### Webhook-Eligible Events

| Event | Typical Subscribers |
|-------|-------------------|
| `DRDispatchCompleted` | Billing systems, grid operator dashboards |
| `DRDispatchFailed` | Monitoring/alerting platforms |
| `InvoiceGenerated` | Customer ERP, accounting systems |
| `AssetModeChanged` | Monitoring dashboards, aggregator platforms |
| `AlertTriggered` | On-call notification systems |
| `TariffUpdated` | Trading platforms, customer portals |

### HMAC-SHA256 Webhook Signing

Every outbound webhook includes:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Solfacil-Signature` | `sha256=<hex-digest>` | HMAC-SHA256 of the raw body |
| `X-Solfacil-Timestamp` | Unix timestamp | Prevents replay attacks |

```
signature = HMAC-SHA256(key=webhook_secret, message=timestamp + "." + raw_body)
```

Receivers should reject webhooks where the timestamp is older than 5 minutes.

```typescript
async function signWebhookPayload(
  payload: Record<string, unknown>,
  secretArn: string,
): Promise<SignedWebhookResult> {
  const secretResponse = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const webhookSecret = secretResponse.SecretString!;
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`).digest('hex');
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

### DynamoDB: `webhook_subscriptions`

```
Table: webhook_subscriptions
PK: org_id (String)          — Partition key (tenant isolation)
SK: webhook_id (String)      — Sort key (ULID)
Attributes:
  url           (String)     — Target URL
  events        (StringSet)  — Subscribed event types
  secret_arn    (String)     — ARN of HMAC secret
  rule_name     (String)     — EventBridge rule name
  status        (String)     — "active" | "paused" | "failed"
  created_at    (String)     — ISO 8601
  updated_at    (String)     — ISO 8601
```

### Webhook Management API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/webhooks` | ORG_MANAGER | Register new webhook |
| `GET` | `/webhooks` | ORG_MANAGER | List org's webhooks |
| `GET` | `/webhooks/{id}` | ORG_MANAGER | Get specific webhook |
| `DELETE` | `/webhooks/{id}` | ORG_MANAGER | Delete webhook |

### Retry Policy and Dead Letter Queue

| Retry Phase | Attempts | Interval | Total Duration |
|-------------|----------|----------|---------------|
| Immediate | 1-5 | 1-30 seconds | ~2 minutes |
| Short backoff | 6-50 | 30s-5min | ~3 hours |
| Long backoff | 51-185 | 5min-30min | ~24 hours |

After 185 retries (24h), events go to SQS Dead Letter Queue (14-day retention).

---

## 8. org_id Integration

- M2M tokens have no `custom:org_id`; resolved from `m2m_client_config` DynamoDB table
- `validateM2MScope()` middleware maps client_id → org_id + scopes
- Webhook EventBridge rules are tenant-scoped: `detail.org_id = [tenantContext.orgId]`
- Webhook subscriptions table uses `org_id` as partition key

---

## 9. Lambda Handlers

```
src/open-api/
├── handlers/
│   ├── m2m-get-assets.ts         # M2M: GET /v1/assets
│   ├── m2m-get-telemetry.ts      # M2M: GET /v1/telemetry
│   ├── m2m-get-dispatches.ts     # M2M: GET /v1/dispatches
│   ├── webhook-create.ts         # POST /webhooks
│   ├── webhook-list.ts           # GET /webhooks
│   ├── webhook-delete.ts         # DELETE /webhooks/{id}
│   ├── webhook-signing-proxy.ts  # EventBridge → sign → API Destination
│   ├── inbound-ccee-pld.ts       # v5.7: POST /webhooks/ccee-pld
│   └── inbound-weather.ts        # v5.7: POST /webhooks/weather
├── middleware/
│   ├── m2m-scope.ts              # validateM2MScope() + client→org_id resolution
│   └── webhook-secret.ts         # v5.7: validateWebhookSecret() middleware
└── __tests__/
    ├── m2m-scope.test.ts
    ├── webhook-create.test.ts
    ├── inbound-ccee-pld.test.ts  # v5.7
    └── inbound-weather.test.ts   # v5.7
```

---

## § v5.7 Inbound Webhook Receivers

> **背景說明：** v5.2 的 M7 是純輸出系統（SOLFACIL 主動推送給外部夥伴）。
> v5.7 新增 Inbound 端，讓外部資料來源（CCEE、氣象局）主動推送資料進來。
> v5.7 使用 Mock Publisher 佔位，v6.0 替換為真實外部系統推送。

---

### § v5.7.1 POST /webhooks/ccee-pld — 批發電價接收器

功能：接收 CCEE 的批發電價更新，寫入 `pld_horario` 表。

**Request 格式：**

```json
{
  "mes_referencia": 202602,
  "dia": 28,
  "hora": 17,
  "submercado": "SUDESTE",
  "price_brl_mwh": 487.50,
  "published_at": "2026-02-28T08:00:00-03:00"
}
```

**安全驗證：**
- Header：`x-webhook-secret: <shared-secret>`
- 服務端驗證 secret 是否與環境變數 `WEBHOOK_SECRET_CCEE` 相符
- 不符則回傳 401 Unauthorized

**落庫邏輯：**

```sql
INSERT INTO pld_horario (mes_referencia, dia, hora, submercado, pld_hora)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (mes_referencia, dia, hora, submercado) DO UPDATE SET
  pld_hora = EXCLUDED.pld_hora;
```

**Response：**
- 成功：`200 OK` `{"status":"accepted","rows_upserted":1}`
- Secret 錯誤：`401 Unauthorized`
- Payload 格式錯誤：`400 Bad Request`

---

### § v5.7.2 POST /webhooks/weather — 天氣資料接收器

功能：接收氣象數據，寫入現有的 `weather_cache` 表。

> 注意：表名是 `weather_cache`（不是 weather_data），為既有表，無需建立新表。

**Request 格式：**

```json
{
  "location": "SP",
  "forecast_time": "2026-02-28T17:00:00-03:00",
  "temperature_c": 31.5,
  "irradiance_w_m2": 620.0,
  "cloud_cover_pct": 15.0,
  "source": "mock-weather-publisher"
}
```

**安全驗證：**
- Header：`x-webhook-secret: <shared-secret>`
- 服務端驗證 secret 是否與環境變數 `WEBHOOK_SECRET_WEATHER` 相符

**落庫邏輯：**

```sql
INSERT INTO weather_cache (location, recorded_at, temperature, irradiance, cloud_cover, source)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (location, recorded_at) DO UPDATE SET
  temperature = EXCLUDED.temperature,
  irradiance  = EXCLUDED.irradiance,
  cloud_cover = EXCLUDED.cloud_cover,
  source      = EXCLUDED.source;
```

**Response：**
- 成功：`200 OK` `{"status":"accepted","rows_upserted":1}`
- Secret 錯誤：`401 Unauthorized`
- Payload 格式錯誤：`400 Bad Request`

---

### § v5.7.3 Mock Publisher Script（本地模擬器）

位置：`backend/scripts/mock-publisher.ts`（v5.7 實作階段建立，此處僅設計）

功能：模擬外部系統向 M7 Webhook 發送動態資料，產生「電廠有呼吸感」的展示效果。

**發布邏輯：**
- 每 5 分鐘發一次 CCEE PLD 推送（模擬明天電價更新）
- 電價波動範圍：白天 R$80–200/MWh，尖峰 R$300–560/MWh
- 每 30 分鐘發一次天氣更新（irradiance、temperature）
- 目標 URL：`http://localhost:3000/webhooks/ccee-pld` 和 `/webhooks/weather`

**設計目標：** 啟動 mock-publisher 後，前端儀表板的收益趨勢圖會因 PLD 波動而產生自然的高低起伏。

**Mock Publisher 架構：**

```
mock-publisher.ts
├── setInterval(5 * 60 * 1000)    → publishCceePld()
│   └── POST /webhooks/ccee-pld
│       ├── Header: x-webhook-secret: ${WEBHOOK_SECRET_CCEE}
│       └── Body: { mes_referencia, dia, hora, submercado, price_brl_mwh, published_at }
│
└── setInterval(30 * 60 * 1000)   → publishWeather()
    └── POST /webhooks/weather
        ├── Header: x-webhook-secret: ${WEBHOOK_SECRET_WEATHER}
        └── Body: { location, forecast_time, temperature_c, irradiance_w_m2, cloud_cover_pct, source }
```

**電價波動模型（Mock）：**

```
basePrice(hour):
  hour ∈ [00:00, 06:00)  →  R$ 80–120/MWh    (離峰)
  hour ∈ [06:00, 17:00)  →  R$ 120–200/MWh   (日間)
  hour ∈ [17:00, 21:00)  →  R$ 300–560/MWh   (尖峰)
  hour ∈ [21:00, 24:00)  →  R$ 150–250/MWh   (晚間)

noise = basePrice × random(-0.15, +0.15)  // ±15% 隨機波動
finalPrice = basePrice + noise
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：M2M Gateway、Webhook、WAF、Rate Limiting |
| v5.7 | 2026-02-28 | Inbound Webhook Receivers：POST /webhooks/ccee-pld（CCEE 電價）、POST /webhooks/weather（天氣資料）、Mock Publisher Script 設計 |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | 消費 `AlertTriggered` → webhook |
| **依賴** | M3 (DR Dispatcher) | 消費 `DRDispatchCompleted`, `AssetModeChanged` → webhook |
| **依賴** | M4 (Market & Billing) | 消費 `InvoiceGenerated`, `TariffUpdated` → webhook |
| **依賴** | M6 (Identity) | Cognito Resource Server、Machine Clients |
| **依賴** | M8 (Admin Control) | AppConfig `api-quotas` 讀取 |
| **被依賴** | 外部系統 | ERP、交易平台、監控系統 |
| **被依賴** | M2 (Optimization Engine) | v5.7: Inbound Webhook 更新 pld_horario → M2 Schedule Generator 讀取最新電價 |
| **寫入** | pld_horario 表 | v5.7: POST /webhooks/ccee-pld → UPSERT |
| **寫入** | weather_cache 表 | v5.7: POST /webhooks/weather → UPSERT |
