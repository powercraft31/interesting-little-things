# Module 4: Market & Billing

> **模組版本**: v5.11
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.11.md](./00_MASTER_ARCHITECTURE_v5.11.md)
> **最後更新**: 2026-03-05
> **說明**: 電力市場數據接入、計費邏輯、收益計算、Daily Billing Batch Job（v5.8: 真實度數結算 via Data Contract）、v5.10: 架構邊界修復、**v5.11: Service Pool for Daily Billing Job**

---

## § v5.11 Service Pool Switch

### 問題陳述

`daily-billing-job.ts` 的 `startBillingJob(pool)` 接收來自 `local-server.ts` 的 pool 參數。
v5.10 中，這個 pool 是 `getPool()`，連線為 `solfacil_app`（RLS enforced）。

Daily Billing Job 的核心查詢需要**跨租戶讀取所有 assets 的 hourly metrics**：

```sql
SELECT
  ahm.asset_id, a.org_id,
  SUM(ahm.total_discharge_kwh) AS total_discharge_kwh,
  SUM(ahm.total_charge_kwh) AS total_charge_kwh,
  SUM(ahm.total_discharge_kwh * COALESCE(p.pld_hora, 150) / 1000.0) AS arbitrage_profit_reais,
  a.retail_buy_rate_kwh
FROM asset_hourly_metrics ahm
JOIN assets a ON a.asset_id = ahm.asset_id
LEFT JOIN pld_horario p ON ...
WHERE DATE(ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo') = $1::date
GROUP BY ahm.asset_id, a.org_id, a.retail_buy_rate_kwh
```

**問題：**
- `assets` 表有 RLS：`org_id = current_setting('app.current_org_id')`
- Cron job 不設定 `app.current_org_id` → `assets` 表的 JOIN 返回空結果
- `asset_hourly_metrics` 無 RLS → 可以讀取
- `pld_horario` 無 RLS → 可以讀取
- 但最終 JOIN 因 `assets` 表 RLS 而被過濾為空

寫入也受影響：
- `revenue_daily` 無 RLS（無 `org_id` 欄位）→ 寫入正常
- 但讀取端（SELECT FROM assets）為空 → 沒有數據可寫

### 解決方案

```typescript
// scripts/local-server.ts — v5.11
import { getServicePool } from "../src/shared/db";

const servicePool = getServicePool();
startBillingJob(servicePool);  // ← was getPool()
```

### 代碼變更清單

| 文件 | 函數 | 變更 | 理由 |
|------|------|------|------|
| `scripts/local-server.ts` | `startBillingJob()` 呼叫處 | pool 參數從 `getPool()` 改為 `getServicePool()` | 需要跨租戶讀取 assets (RLS) |
| `src/market-billing/services/daily-billing-job.ts` | — | **不變** | 函數簽名 `startBillingJob(pool: Pool)` 已是 pool 注入模式 |

### 受影響的 Pool 查詢清單

| 函數 | 查詢 | 涉及 RLS 表 | Pool 需求 |
|------|------|------------|----------|
| `runDailyBilling()` | SELECT FROM `asset_hourly_metrics` JOIN `assets` LEFT JOIN `pld_horario` | assets (RLS) | **Service Pool** |
| `runDailyBilling()` | INSERT INTO `revenue_daily` ON CONFLICT DO UPDATE | 無 RLS (缺 org_id) | 任意 Pool |

---

## 其他章節（v5.10 — unchanged）

§1-§9、v5.10 架構邊界修復、v5.8 Daily Billing Batch Job Design — 與 v5.10 相同，不重複。
參見 `04_MARKET_BILLING_MODULE_v5.10.md`。

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：Tarifa Branca、計費邏輯、PostgreSQL schema |
| v5.5 | 2026-02-28 | 雙軌計算邏輯 |
| v5.6 | 2026-02-28 | Daily Billing Batch Job |
| v5.8 | 2026-03-02 | Closed-loop Billing via Data Contract |
| v5.10 | 2026-03-05 | 架構邊界修復 (import 路徑修正) |
| **v5.11** | **2026-03-05** | **Service Pool Switch: `startBillingJob()` 從 `getPool()` (solfacil_app, RLS enforced) 切換到 `getServicePool()` (solfacil_service, BYPASSRLS)。函數簽名不變（pool 注入模式）。解決跨租戶 assets JOIN 被 RLS 阻擋的問題。** |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | 讀取 `asset_hourly_metrics` (Shared Contract) |
| **依賴** | M2 (Optimization Engine) | 消費 `ScheduleGenerated` |
| **依賴** | M3 (DR Dispatcher) | 消費 `DRDispatchCompleted` |
| **依賴** | M8 (Admin Control) | AppConfig `billing-rules` |
| **依賴** | Shared Layer | v5.10: `shared/middleware/tenant-context`; **v5.11: `getServicePool()` from `shared/db`** |
| **被依賴** | M2 (Optimization Engine) | 提供電價查詢 |
| **被依賴** | M5 (BFF) | PostgreSQL 查詢收益/電價/資產數據 |
| **被依賴** | M7 (Open API) | 消費 `InvoiceGenerated` → webhook |
