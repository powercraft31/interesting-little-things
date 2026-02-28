# Module 4: Market & Billing

> **模組版本**: v5.2
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.2.md](./00_MASTER_ARCHITECTURE_v5.2.md)
> **最後更新**: 2026-02-27
> **說明**: 電力市場數據接入（分時電價 TOU）、計費邏輯、收益計算、ROI、月度報告、PostgreSQL schema

---

## 1. 模組職責

M4 管理所有財務相關的數據和邏輯：

- 電力市場數據接入（巴西 Tarifa Branca 分時電價）
- 計費計算：`grid_positiveEnergy × 電價 → 電費`
- 收益計算：`grid_negativeEnergy × 賣電價 → 收益`
- ROI 計算與回本週期分析
- 月度帳單報告生成
- 資產元數據管理（Extensible Metadata Design）

---

## 2. CDK Stack: `MarketBillingStack`

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

---

## 3. EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `ProfitCalculated` | → M5 (dashboard) |
| **Publishes** | `InvoiceGenerated` | → M5 (dashboard), M7 (webhooks) |
| **Publishes** | `TariffUpdated` | → M2 (recalculate schedule), M3 (dispatch awareness) |
| **Consumes** | `AssetModeChanged` | ← M3 (record mode change financial impact) |
| **Consumes** | `ScheduleGenerated` | ← M2 (record expected revenue) |
| **Consumes** | `DRDispatchCompleted` | ← M3 (financial settlement) |

---

## 4. 電力市場數據接入 — Tarifa Branca (TOU)

巴西 ANEEL 分時電價：

| Time Block | Hours | Rate (BRL/kWh) |
|-----------|-------|----------------|
| **Off-Peak** | 00:00-06:00, 22:00-24:00 | R$ 0.25 |
| **Intermediate** | 06:00-17:00, 20:00-22:00 | R$ 0.45 |
| **Peak** | 17:00-20:00 | R$ 0.82 |

**Maximum Spread:** R$ 0.57/kWh (Peak - Off-Peak)

---

## 5. 計費計算邏輯

### 電費計算

```
electricity_cost = grid_positiveEnergy_kwh × tariff_rate_per_kwh
```

### 收益計算

```
revenue = grid_negativeEnergy_kwh × sell_price_per_kwh
```

### 淨利潤

```
net_profit = revenue - electricity_cost - operating_cost
operating_cost = total_energy_kwh × operating_cost_per_kwh
```

### ROI 計算公式

```
roi_pct = (annual_profit / investment_brl) × 100
payback_years = investment_brl / annual_profit
```

---

## 6. PostgreSQL Schema

### Organizations Table

```sql
CREATE TABLE organizations (
    id          VARCHAR(50) PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    cnpj        VARCHAR(18) UNIQUE NOT NULL,  -- Brazilian CNPJ
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    plan_tier   VARCHAR(20) NOT NULL DEFAULT 'standard',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Tariff Schedules

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
```

### Assets Table

```sql
CREATE TABLE assets (
    id               VARCHAR(20) PRIMARY KEY,
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    name             VARCHAR(200) NOT NULL,
    region           VARCHAR(5) NOT NULL,
    investment_brl   NUMERIC(12,2) NOT NULL,
    capacity_mwh     NUMERIC(8,2) NOT NULL,
    unit_count       INTEGER NOT NULL,
    operation_mode   VARCHAR(30) NOT NULL,
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- v4.0: Extensible Metadata
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_metadata_gin ON assets USING GIN (metadata);
```

### Trades Table

```sql
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
```

### Daily Revenue Table

```sql
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

### Row-Level Security (RLS)

```sql
ALTER TABLE assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades           ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_revenue    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_assets ON assets
  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY tenant_isolation_trades ON trades
  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY tenant_isolation_daily_revenue ON daily_revenue
  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY tenant_isolation_tariff ON tariff_schedules
  USING (org_id = current_setting('app.current_org_id', true));
```

### Indexes

```sql
CREATE INDEX idx_assets_org         ON assets(org_id);
CREATE INDEX idx_trades_org         ON trades(org_id, trade_date);
CREATE INDEX idx_daily_revenue_org  ON daily_revenue(org_id, report_date);
CREATE INDEX idx_tariff_org         ON tariff_schedules(org_id, valid_from);
```

---

## 7. Extensible Metadata Design (可擴充元資料)

### Architecture Decision

M4 PostgreSQL 採用「Semi-Rigid + Semi-Flexible」設計：
- **Rigid Columns:** `asset_id`, `org_id`, `device_type`, `rated_power_kw`, `status` — 強型別、FK、索引
- **Flexible Column:** `metadata JSONB` — 廠商規格、站點信息、合規欄位

### Example Metadata Payloads

```json
// Huawei LUNA2000
{
  "vendor": "huawei",
  "model": "LUNA2000-15-S0",
  "firmware_version": "V100R001C10SPC200",
  "warranty_expires": "2031-06-15",
  "installation_site": { "lat": -23.5505, "lng": -46.6333, "city": "São Paulo" },
  "aneel_registration": "DG-SP-2025-00847"
}
```

### Application-Layer Validation (Zod)

```typescript
export const AssetMetadataSchema = z.object({
  vendor: z.string().min(1),
  model: z.string().min(1),
  firmware_version: z.string().optional(),
  warranty_expires: z.string().date().optional(),
  installation_site: z.object({
    lat: z.number().min(-33.75).max(5.27),
    lng: z.number().min(-73.99).max(-34.79),
    city: z.string().min(1),
  }).optional(),
  aneel_registration: z.string().optional(),
}).passthrough();
```

### GIN Index Queries

```sql
-- Find all Huawei devices
SELECT asset_id FROM assets WHERE metadata @> '{"vendor": "huawei"}'::jsonb;

-- Find devices with warranty expiring before 2030
SELECT asset_id, metadata->>'warranty_expires' AS warranty
FROM assets WHERE (metadata->>'warranty_expires')::date < '2030-01-01';
```

---

## 8. org_id Integration

- All PostgreSQL tables have `org_id` column with FK to `organizations`
- RLS enforced via `current_setting('app.current_org_id')`
- Lambda handlers set RLS session variable before any query
- SOLFACIL_ADMIN bypasses RLS via superuser DB role

---

## 9. Lambda Handlers

```
src/market-billing/
├── handlers/
│   ├── get-tariff-schedule.ts    # Query current Tarifa Branca rates
│   ├── calculate-profit.ts       # Revenue/cost/profit per asset per day
│   ├── generate-invoice.ts       # Monthly billing report
│   └── update-tariff-rules.ts    # Admin: update tariff configuration
├── services/
│   ├── tariff-engine.ts          # Tarifa Branca rate lookup
│   ├── revenue-calculator.ts     # Revenue = sum(volume * price) - costs
│   ├── roi-calculator.ts         # ROI & payback period computation
│   └── metadata-validator.ts     # AssetMetadataSchema (Zod)
├── migrations/
│   ├── 001_create_organizations.ts
│   ├── 002_create_tariffs.ts
│   ├── 003_create_assets.ts
│   ├── 004_create_trades.ts
│   ├── 005_create_daily_revenue.ts
│   └── 006_add_assets_metadata.ts
└── __tests__/
    ├── tariff-engine.test.ts
    └── revenue-calculator.test.ts
```

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M2 (Optimization Engine) | 消費 `ScheduleGenerated` 記錄預期收益 |
| **依賴** | M3 (DR Dispatcher) | 消費 `DRDispatchCompleted` 進行財務結算 |
| **依賴** | M8 (Admin Control) | AppConfig `billing-rules` 讀取計費參數 |
| **被依賴** | M2 (Optimization Engine) | 提供電價查詢、發佈 `TariffUpdated` |
| **被依賴** | M5 (BFF) | PostgreSQL 查詢收益/電價/資產數據 |
| **被依賴** | M7 (Open API) | 消費 `InvoiceGenerated` → webhook |
| **被依賴** | M8 (Admin Control) | 共享 RDS PostgreSQL VPC |
