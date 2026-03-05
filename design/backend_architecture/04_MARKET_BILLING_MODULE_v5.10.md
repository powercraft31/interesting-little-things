# Module 4: Market & Billing

> **模組版本**: v5.10
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.10.md](./00_MASTER_ARCHITECTURE_v5.10.md)
> **最後更新**: 2026-03-05
> **說明**: 電力市場數據接入（分時電價 TOU + CCEE 批發市場 PLD）、計費邏輯、收益計算、ROI、月度報告、PostgreSQL schema、Daily Billing Batch Job（v5.8: 真實度數結算 via Data Contract）、**v5.10: 架構邊界修復**

---

## 1. 模組職責

M4 管理所有財務相關的數據和邏輯：

- 電力市場數據接入（巴西 Tarifa Branca 分時電價）
- 計費計算：`grid_positiveEnergy x 電價 → 電費`
- 收益計算：`grid_negativeEnergy x 賣電價 → 收益`
- ROI 計算與回本週期分析
- 月度帳單報告生成

---

## § v5.10 架構邊界修復

### 問題陳述

`src/market-billing/handlers/get-tariff-schedule.ts` 跨界 import 了 M5 BFF 的 middleware：

```typescript
// ❌ v5.9: 跨界依賴（Architecture Boundary Breach）
import { extractTenantContext, requireRole, apiError } from '../../bff/middleware/tenant-context';
```

此 import 違反限界上下文原則：M4 是獨立的業務模組，不應依賴 M5 BFF 的內部實作。

### 修正

將 import 路徑改為 Shared Layer（v5.10 新增的 `src/shared/middleware/tenant-context.ts`）：

```typescript
// ✅ v5.10: 從 Shared Layer import
import { extractTenantContext, requireRole, apiError } from '../../shared/middleware/tenant-context';
```

### 影響範圍

| 文件 | 修改內容 |
|------|---------|
| `src/market-billing/handlers/get-tariff-schedule.ts` | import 路徑變更 |

**無業務邏輯變更。** 函數簽名、參數、回傳值完全不變。僅修改 import 來源。

---

## 2. CDK Stack: `MarketBillingStack`

（與 v5.8 相同，不重複。）

## 3. EventBridge Integration

（與 v5.8 相同，不重複。）

## § 雙軌計算邏輯 (v5.5 → v5.8 Closed-loop)

（與 v5.8 相同，不重複。）

## § v5.8 Daily Billing Batch Job Design (Closed-loop)

（與 v5.8 相同，不重複。）

---

## 9. Lambda Handlers

```
src/market-billing/
├── handlers/
│   ├── get-tariff-schedule.ts    # Query current Tarifa Branca rates — v5.10: import from shared/middleware
│   ├── calculate-profit.ts       # Revenue/cost/profit per asset per day
│   ├── generate-invoice.ts       # Monthly billing report
│   ├── update-tariff-rules.ts    # Admin: update tariff configuration
│   └── daily-settlement.ts       # v5.5: 每日凌晨雙軌結算 Batch Job
├── services/
│   ├── tariff-engine.ts
│   ├── revenue-calculator.ts
│   ├── roi-calculator.ts
│   ├── arbitrage-calculator.ts   # v5.5
│   ├── savings-calculator.ts     # v5.5
│   ├── daily-billing-batch.ts    # v5.8: Closed-loop via asset_hourly_metrics
│   └── metadata-validator.ts
└── __tests__/
    ├── tariff-engine.test.ts
    ├── revenue-calculator.test.ts
    ├── arbitrage-calculator.test.ts
    ├── savings-calculator.test.ts
    └── daily-billing-batch.test.ts
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：Tarifa Branca、計費邏輯、PostgreSQL schema |
| v5.5 | 2026-02-28 | 雙軌計算邏輯：B端 PLD 套利 + C端客戶省電 Batch Job |
| v5.6 | 2026-02-28 | Daily Billing Batch Job：凌晨讀取 executed trades x pld_horario，Mock 推算 revenue_daily |
| v5.8 | 2026-03-02 | Closed-loop Billing via Data Contract：asset_hourly_metrics，實現真實度數結算 |
| **v5.10** | **2026-03-05** | **架構邊界修復：`get-tariff-schedule.ts` import 路徑從 `../../bff/middleware/tenant-context` 改為 `../../shared/middleware/tenant-context`。無業務邏輯變更。** |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | **v5.8: 讀取 `asset_hourly_metrics` (Shared Contract) 進行真實度數結算** |
| **依賴** | M2 (Optimization Engine) | 消費 `ScheduleGenerated` 記錄預期收益 |
| **依賴** | M3 (DR Dispatcher) | 消費 `DRDispatchCompleted` 進行財務結算 |
| **依賴** | M8 (Admin Control) | AppConfig `billing-rules` 讀取計費參數 |
| **依賴** | Shared Layer | **v5.10: import `shared/middleware/tenant-context`（原依賴 BFF，已修正）** |
| **被依賴** | M2 (Optimization Engine) | 提供電價查詢、發佈 `TariffUpdated` |
| **被依賴** | M5 (BFF) | PostgreSQL 查詢收益/電價/資產數據 |
| **被依賴** | M7 (Open API) | 消費 `InvoiceGenerated` → webhook |
| **被依賴** | M8 (Admin Control) | 共享 RDS PostgreSQL VPC |
