# Module 4: Market & Billing

> **模組版本**: v5.8
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.8.md](./00_MASTER_ARCHITECTURE_v5.8.md)
> **最後更新**: 2026-03-02
> **說明**: 電力市場數據接入（分時電價 TOU + CCEE 批發市場 PLD）、計費邏輯、收益計算、ROI、月度報告、PostgreSQL schema、Daily Billing Batch Job（v5.8: 真實度數結算 via Data Contract）

---

## 1. 模組職責

M4 管理所有財務相關的數據和邏輯：

- 電力市場數據接入（巴西 Tarifa Branca 分時電價）
- 計費計算：`grid_positiveEnergy x 電價 → 電費`
- 收益計算：`grid_negativeEnergy x 賣電價 → 收益`
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
  |- rds-data:ExecuteStatement    -> solfacil-vpp RDS cluster
  |- secretsmanager:GetSecret     -> RDS credentials
  |- events:PutEvents             -> solfacil-vpp-events bus
  +- ssm:GetParameter             -> /solfacil/billing/* parameters
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
electricity_cost = grid_positiveEnergy_kwh x tariff_rate_per_kwh
```

### 收益計算

```
revenue = grid_negativeEnergy_kwh x sell_price_per_kwh
```

### 淨利潤

```
net_profit = revenue - electricity_cost - operating_cost
operating_cost = total_energy_kwh x operating_cost_per_kwh
```

### ROI 計算公式

```
roi_pct = (annual_profit / investment_brl) x 100
payback_years = investment_brl / annual_profit
```

---

## § 雙軌計算邏輯 (v5.5 → v5.8 Closed-loop)

### 重要：B端 vs C端的邏輯隔離

| 面向 | B端 (SOLFACIL) | C端 (客戶) |
|------|----------------|------------|
| 電價來源 | pld_horario (R$/MWh) | tariff_schedules.off_peak_rate (R$/kWh) |
| 數據來源 | **asset_hourly_metrics.total_discharge_kwh (v5.8)** | **asset_hourly_metrics.total_charge_kwh (v5.8)** |
| 計算邏輯 | 實際放電量 x PLD 電價差 | 實際充電量 x 離峰費率 |
| 目標 | 最大化套利利潤 | 最大化客戶省電金額 |
| 約束關係 | 受 target_self_consumption_pct 約束 | 由 vpp_strategies 設定門檻 |

> **v5.8 重大變更：** 數據來源從 `trade_schedules.expected_volume_kwh`（排程預估）切換為
> `asset_hourly_metrics`（實際量測匯總），實現 Open-loop → Closed-loop 財務結算。

---

## § v5.8 Daily Billing Batch Job Design (Closed-loop)

> **架構邊界硬規則：M4 SHALL NOT directly query `telemetry_history`。
> 數據來源：`asset_hourly_metrics` (Shared Contract)。違反 = 架構邊界違規 (Architecture Boundary Breach)。**

### 機制

| 項目 | 說明 |
|------|------|
| 觸發方式 | node-cron，每天 00:05 執行（`5 0 * * *`） |
| 處理範圍 | 昨天全天（00:00 ~ 23:59）所有 asset 的 `asset_hourly_metrics` |
| 執行環境 | Express server 內嵌 cron task |
| 數據來源 | **`asset_hourly_metrics`（Shared Contract，由 M1 Aggregator Job 每小時寫入）** |

### 輸入資料

| 資料來源 | 查詢條件 | 用途 |
|---------|---------|------|
| `asset_hourly_metrics` | `hour_timestamp >= yesterday_start AND hour_timestamp < today_start` | 取得每小時實際充放電量 |
| `pld_horario` | `dia` 對應昨天的日期、`hora` 對應各筆 metrics 的小時 | 取得對應時段的 PLD 電價 |
| `assets` | 透過 `asset_id` 關聯 | 取得 `retail_buy_rate_kwh`、`submercado` |
| `tariff_schedules` | 透過 `org_id` 關聯 | 取得 `off_peak_rate` 用於 C端計算 |

### 計算邏輯（v5.8 Closed-loop）

```
For each asset, for each hour H of yesterday:

  -- 從 Shared Contract 取得實際度數
  actual_discharge_kwh = asset_hourly_metrics
                         WHERE asset_id = X AND hour_timestamp = H
                         -> total_discharge_kwh

  actual_charge_kwh    = asset_hourly_metrics
                         WHERE asset_id = X AND hour_timestamp = H
                         -> total_charge_kwh

  -- 從 pld_horario 取得該時段電價
  pld_price            = pld_horario
                         WHERE submercado = asset.submercado
                           AND mes_referencia = YYYYMM(H)
                           AND dia = DAY(H)
                           AND hora = HOUR(H)
                         -> pld_hora (R$/MWh)

  -- B端計算：SOLFACIL 批發套利收益
  arbitrage_profit     = actual_discharge_kwh * (pld_price / 1000)
                         -- pld_price 單位 R$/MWh，/1000 轉為 R$/kWh

  -- C端計算：客戶省下的電費（離峰充電，省下的零售電費差額）
  client_savings       = actual_charge_kwh * tariff_schedules.off_peak_rate
```

### B-side SQL（SOLFACIL 套利）

```sql
-- v5.8 Closed-loop: 基於 asset_hourly_metrics 真實度數
SELECT
  ahm.asset_id,
  SUM(ahm.total_discharge_kwh * (p.pld_hora / 1000)) AS arbitrage_profit_reais
FROM asset_hourly_metrics ahm
JOIN assets a ON ahm.asset_id = a.asset_id
JOIN pld_horario p ON
  p.submercado = a.submercado AND
  p.mes_referencia = TO_CHAR(ahm.hour_timestamp, 'YYYYMM')::INT AND
  p.dia = EXTRACT(DAY FROM ahm.hour_timestamp)::SMALLINT AND
  p.hora = EXTRACT(HOUR FROM ahm.hour_timestamp)::SMALLINT
WHERE ahm.hour_timestamp >= $1   -- yesterday_start
  AND ahm.hour_timestamp <  $2   -- today_start
GROUP BY ahm.asset_id;
```

### C-side SQL（客戶節省）

```sql
-- v5.8 Closed-loop: 基於 asset_hourly_metrics 真實充電量
SELECT
  ahm.asset_id,
  SUM(ahm.total_charge_kwh * ts.off_peak_rate) AS savings_reais
FROM asset_hourly_metrics ahm
JOIN assets a ON ahm.asset_id = a.asset_id
JOIN tariff_schedules ts ON
  ts.org_id = a.org_id AND
  ts.effective_from <= CURRENT_DATE AND
  (ts.effective_to IS NULL OR ts.effective_to >= CURRENT_DATE)
WHERE ahm.hour_timestamp >= $1   -- yesterday_start
  AND ahm.hour_timestamp <  $2   -- today_start
GROUP BY ahm.asset_id;
```

### 輸出

```sql
INSERT INTO revenue_daily (
  asset_id, org_id, date,
  vpp_arbitrage_profit_reais, client_savings_reais,
  revenue_reais, cost_reais, profit_reais
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (asset_id, date) DO UPDATE SET
  vpp_arbitrage_profit_reais = EXCLUDED.vpp_arbitrage_profit_reais,
  client_savings_reais = EXCLUDED.client_savings_reais,
  revenue_reais = EXCLUDED.revenue_reais,
  cost_reais = EXCLUDED.cost_reais,
  profit_reais = EXCLUDED.profit_reais;
```

### 邊界限制與升版對照（v5.6 → v5.8）

| 項目 | v5.6（Open-loop） | v5.8（Closed-loop） |
|------|-------------------|---------------------|
| 數據來源 | `trade_schedules` (排程預估) | `asset_hourly_metrics` (實際量測) |
| 電量計算 | `power_kw x 1h` 簡化推算 | M1 Aggregator 精確匯總 |
| 精確度 | 低（基於「計畫做什麼」） | 高（基於「實際做了什麼」） |
| 跨模組依賴 | 無直接跨模組 table 讀取 | 讀取 Shared Contract 表（合規） |
| UPSERT 策略 | `ON CONFLICT (asset_id, date) DO UPDATE` | 同上 |

### `trade_schedules` 角色變更說明

> **v5.8 Note:** `trade_schedules` 表的 `expected_volume_kwh` 欄位自 v5.8 起
> **僅供排程參考 (scheduling reference only)**，不再用於最終財務結算。
> 真實度數來源：`asset_hourly_metrics`（由 M1 Aggregator Job 寫入的 Shared Contract）。
>
> `trade_schedules` 仍然由 M2 Schedule Generator 寫入，用途為：
> - M3 Command Dispatcher 讀取排程執行調度
> - M5 BFF Dashboard 顯示排程計畫
> - 審計追蹤（計畫 vs 實際的比對分析）

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
  "installation_site": { "lat": -23.5505, "lng": -46.6333, "city": "Sao Paulo" },
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
|-- handlers/
|   |-- get-tariff-schedule.ts    # Query current Tarifa Branca rates
|   |-- calculate-profit.ts       # Revenue/cost/profit per asset per day
|   |-- generate-invoice.ts       # Monthly billing report
|   |-- update-tariff-rules.ts    # Admin: update tariff configuration
|   +-- daily-settlement.ts       # v5.5: 每日凌晨雙軌結算 Batch Job
|-- services/
|   |-- tariff-engine.ts          # Tarifa Branca rate lookup
|   |-- revenue-calculator.ts     # Revenue = sum(volume * price) - costs
|   |-- roi-calculator.ts         # ROI & payback period computation
|   |-- arbitrage-calculator.ts   # v5.5: B端 PLD 套利計算
|   |-- savings-calculator.ts     # v5.5: C端客戶省電計算
|   |-- daily-billing-batch.ts    # v5.8: Daily Billing Batch Job — Closed-loop via asset_hourly_metrics
|   +-- metadata-validator.ts     # AssetMetadataSchema (Zod)
|-- migrations/
|   |-- 001_create_organizations.ts
|   |-- 002_create_tariffs.ts
|   |-- 003_create_assets.ts
|   |-- 004_create_trades.ts
|   |-- 005_create_daily_revenue.ts
|   +-- 006_add_assets_metadata.ts
+-- __tests__/
    |-- tariff-engine.test.ts
    |-- revenue-calculator.test.ts
    |-- arbitrage-calculator.test.ts   # v5.5
    |-- savings-calculator.test.ts     # v5.5
    +-- daily-billing-batch.test.ts    # v5.8: updated for closed-loop
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：Tarifa Branca、計費邏輯、PostgreSQL schema |
| v5.5 | 2026-02-28 | 雙軌計算邏輯：B端 PLD 套利 + C端客戶省電 Batch Job |
| v5.6 | 2026-02-28 | Daily Billing Batch Job：凌晨讀取 executed trades x pld_horario，Mock 推算 revenue_daily |
| v5.8 | 2026-03-02 | Closed-loop Billing via Data Contract：數據來源從 trade_schedules 切換為 asset_hourly_metrics（M1 Aggregator Job 寫入的 Shared Contract），實現真實度數結算 |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | **v5.8: 讀取 `asset_hourly_metrics` (Shared Contract) 進行真實度數結算** |
| **依賴** | M2 (Optimization Engine) | 消費 `ScheduleGenerated` 記錄預期收益；讀取 trade_schedules（僅排程參考，不用於結算） |
| **依賴** | M3 (DR Dispatcher) | 消費 `DRDispatchCompleted` 進行財務結算 |
| **依賴** | M8 (Admin Control) | AppConfig `billing-rules` 讀取計費參數 |
| **被依賴** | M2 (Optimization Engine) | 提供電價查詢、發佈 `TariffUpdated` |
| **被依賴** | M5 (BFF) | PostgreSQL 查詢收益/電價/資產數據 |
| **被依賴** | M7 (Open API) | 消費 `InvoiceGenerated` → webhook |
| **被依賴** | M8 (Admin Control) | 共享 RDS PostgreSQL VPC |
