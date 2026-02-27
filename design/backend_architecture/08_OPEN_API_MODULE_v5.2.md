# Module 7: Open API & Integration

> **模組版本**: v5.2
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.2.md](./00_MASTER_ARCHITECTURE_v5.2.md)
> **最後更新**: 2026-02-27
> **說明**: 第三方對外 API Gateway、Webhook 派發、API Key 管理、Rate Limiting、WAF、HMAC 簽名

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
│   └── webhook-signing-proxy.ts  # EventBridge → sign → API Destination
├── middleware/
│   └── m2m-scope.ts              # validateM2MScope() + client→org_id resolution
└── __tests__/
    ├── m2m-scope.test.ts
    └── webhook-create.test.ts
```

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
