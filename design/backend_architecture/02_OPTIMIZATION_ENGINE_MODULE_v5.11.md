# Module 2: Optimization Engine (Algorithm Engine)

> **模組版本**: v5.11
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.11.md](./00_MASTER_ARCHITECTURE_v5.11.md)
> **最後更新**: 2026-03-05
> **說明**: 4 種策略演算法、AppConfig Strategy Profiles、成本最佳化、SOC 約束、排程輸出、雙目標最佳化框架、Schedule Generator Cron Job、動態電價優先策略、SoC-Aware Scheduling、**v5.11: Service Pool for Cross-Tenant Schedule Generation**

---

## § v5.11 Service Pool Switch

### 問題陳述

`schedule-generator.ts` 的 `startScheduleGenerator(pool)` 接收來自 `local-server.ts` 的 pool 參數。
v5.10 中，這個 pool 是 `getPool()`，連線為 `solfacil_app`（RLS enforced）。

Schedule Generator 的核心查詢需要**跨租戶讀取所有 active assets**：

```sql
SELECT a.asset_id, a.org_id, a.capacidade_kw, a.submercado, a.operation_mode,
       COALESCE(d.battery_soc, 50) AS battery_soc,
       COALESCE(vs.min_soc, 20) AS min_soc,
       COALESCE(vs.max_soc, 95) AS max_soc
FROM assets a
LEFT JOIN device_state d ON d.asset_id = a.asset_id
LEFT JOIN vpp_strategies vs ON vs.org_id = a.org_id
  AND vs.target_mode = a.operation_mode AND vs.is_active = true
WHERE a.is_active = true
```

**問題：**
- `assets` 表有 RLS：`org_id = current_setting('app.current_org_id')`
- `vpp_strategies` 表有 RLS：`org_id = current_setting('app.current_org_id')`
- Cron job 不設定 `app.current_org_id` → 兩張表的 RLS 都返回空結果
- Schedule Generator 讀不到任何 asset → 不產生任何排程

**影響範圍：**
- `runScheduleGenerator()` 查詢 `assets`（RLS）→ 空結果
- `runScheduleGenerator()` JOIN `vpp_strategies`（RLS）→ 空結果
- 寫入 `trade_schedules`（RLS on org_id）→ 寫入可能失敗或被 RLS 過濾
- 讀取 `pld_horario`（無 RLS）→ 正常
- 讀取 `device_state`（無 RLS）→ 正常

### 解決方案

切換 pool 來源：`local-server.ts` 傳入 `getServicePool()` 而非 `getPool()`。

```typescript
// scripts/local-server.ts — v5.11
import { getServicePool } from "../src/shared/db";

const servicePool = getServicePool();
startScheduleGenerator(servicePool);  // ← was getPool()
```

### 代碼變更清單

| 文件 | 函數 | 變更 | 理由 |
|------|------|------|------|
| `scripts/local-server.ts` | `startScheduleGenerator()` 呼叫處 | pool 參數從 `getPool()` 改為 `getServicePool()` | 需要跨租戶讀取 assets + vpp_strategies |
| `src/optimization-engine/services/schedule-generator.ts` | — | **不變** | 函數簽名 `startScheduleGenerator(pool: Pool)` 已是 pool 注入模式，無需修改 |

### 受影響的 Pool 查詢清單

| 函數 | 查詢 | 涉及 RLS 表 | Pool 需求 |
|------|------|------------|----------|
| `runScheduleGenerator()` | SELECT FROM `assets` JOIN `device_state` JOIN `vpp_strategies` | assets (RLS), vpp_strategies (RLS) | **Service Pool** |
| `runScheduleGenerator()` | SELECT FROM `pld_horario` | 無 RLS | 任意 Pool |
| `runScheduleGenerator()` | DELETE FROM `trade_schedules` WHERE asset_id = $1 | trade_schedules (RLS on org_id) | **Service Pool** |
| `runScheduleGenerator()` | INSERT INTO `trade_schedules` | trade_schedules (RLS on org_id) | **Service Pool** |

---

## 其他章節（v5.9 — unchanged）

§1-§8、SoC-Aware Scheduling、雙目標最佳化框架 — 與 v5.9 相同，不重複。
參見 `02_OPTIMIZATION_ENGINE_MODULE_v5.9.md`。

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：4 策略演算法、AppConfig、成本最佳化 |
| v5.5 | 2026-02-28 | 雙目標最佳化框架：B端套利 + C端自發自用約束 |
| v5.6 | 2026-02-28 | Schedule Generator Cron Job |
| v5.7 | 2026-02-28 | 動態電價優先策略 |
| v5.9 | 2026-03-02 | SoC-Aware Scheduling with vpp_strategies guardrails |
| **v5.11** | **2026-03-05** | **Service Pool Switch: `startScheduleGenerator()` 從 `getPool()` (solfacil_app, RLS enforced) 切換到 `getServicePool()` (solfacil_service, BYPASSRLS)。函數簽名不變（pool 注入模式）。解決跨租戶 assets + vpp_strategies 查詢被 RLS 阻擋的問題。** |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | LEFT JOIN device_state 讀取 battery_soc |
| **依賴** | M4 (Market & Billing) | 查詢當前電價 |
| **依賴** | M7 (Open API) | M7 Inbound Webhook 更新 pld_horario |
| **依賴** | M8 (Admin Control) | LEFT JOIN vpp_strategies 讀取 min_soc/max_soc |
| **依賴** | **Shared Layer** | **v5.11: import `getServicePool()` from `shared/db`（間接，透過 local-server.ts pool 注入）** |
| **被依賴** | M3 (DR Dispatcher) | trade_schedules DB polling |
| **被依賴** | M4 (Market & Billing) | ScheduleGenerated 事件 |
| **被依賴** | M5 (BFF) | trade_schedules 查詢 |
