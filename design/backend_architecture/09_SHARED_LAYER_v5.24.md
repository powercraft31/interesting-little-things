# Shared Layer — Tariff Helper 評估（P3 Asset History View）

> **模組版本**: v5.24
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.24.md](./00_MASTER_ARCHITECTURE_v5.24.md)
> **最後更新**: 2026-03-13
> **說明**: 評估是否需要新增 tariff-aware 聚合 helper；結論：不抽取，保持 inline
> **核心主題**: Tariff helper 評估 + 決策記錄

---

## Changes from v5.22

| Aspect | v5.22 | v5.24 |
|--------|-------|-------|
| `shared/tarifa.ts` | Tarifa Branca functions (7 exports) | **UNCHANGED** — 不新增 helper |
| `shared/db.ts` | Dual Pool Factory | **UNCHANGED** |
| `shared/types/*` | solfacil-protocol.ts, telemetry.ts, api.ts, auth.ts | **UNCHANGED** |
| `shared/middleware/*` | tenant-context.ts | **UNCHANGED** |
| **Tariff helper 評估** | N/A | **新增決策記錄**（見 §1） |

---

## 1. Tariff Helper 評估（v5.24 NEW）

### 1.1 需求背景

P3 Summary 的 savings 計算需要 JOIN `tariff_schedules` 並按時段分類電價。需求文件建議評估是否抽取一個 `tariffHelper` 到 shared 層，避免在 handler 中重複寫 tariff JOIN SQL。

### 1.2 現有 tariff 使用點盤點

| 模組 | 檔案 | tariff 使用方式 | tariff SQL |
|------|------|----------------|------------|
| M4 | `daily-billing-job.ts` | `calculateBaselineCost` / `calculateActualCost` 純函式 | 獨立查詢 tariff_schedules，傳入函式 |
| M5 | `get-gateway-energy.ts` | Inline SQL 查 tariff_schedules + inline 三段費率計算 | `SELECT peak_rate, offpeak_rate, ... FROM tariff_schedules ORDER BY effective_from DESC LIMIT 1` |
| M5 | **`get-asset-telemetry.ts`** (v5.24) | 同 get-gateway-energy 模式 | `SELECT ... FROM tariff_schedules WHERE org_id = $1 ...` |
| Shared | `shared/tarifa.ts` | 純函式：`classifyHour(hour)` → TarifaPeriod, `getRateForHour(hour, schedule)` | 不查 DB，接收 schedule 參數 |

### 1.3 評估結論：**不抽取新 helper**

**理由：**

1. **現有 `shared/tarifa.ts` 已提供純函式**：`classifyHour()` 和 `getRateForHour()` 已經封裝了時段分類邏輯。P3 handler 可以直接匯入使用，無需重複實作。

2. **SQL 查詢模式簡單且穩定**：tariff_schedules 的查詢只有一個模式（`ORDER BY effective_from DESC LIMIT 1`），加上 org_id WHERE 條件。兩行 SQL 不值得為此建立 helper。

3. **避免過度抽象**：目前只有 2 個 handler 使用 tariff SQL（get-gateway-energy + get-asset-telemetry）。按照「三次相似才抽取」原則，不應過早抽象。

4. **RLS 上下文需求不同**：get-gateway-energy 不帶 org_id WHERE（用 RLS），get-asset-telemetry 帶 org_id WHERE（更精確）。統一 helper 需處理兩種模式，增加複雜度。

### 1.4 建議做法

P3 `get-asset-telemetry.ts` 應：
1. SQL 查詢 tariff_schedules 保持 inline（與 get-gateway-energy 相同模式），取得 `peak_start`, `peak_end`, `intermediate_start`, `intermediate_end` 等時段邊界
2. 使用 tariff_schedules 回傳的時段邊界做三段分類（**不可直接使用 `classifyHour()`**，因為該函式硬編碼 peak=18-21, intermediate=17-18/21-22，無法反映不同 org 的實際費率時段）
3. 若確認 org 的費率時段與 ANEEL 標準一致（peak 18-21, intermediate 17-18/21-22），可使用 `getRateForHour(hour, schedule)` 作為快捷路徑

> **限制**：`getRateForHour()` 內部呼叫 `classifyHour()` 使用硬編碼時段。若 tariff_schedules 中的 peak_start/peak_end 與硬編碼值不同，則 `getRateForHour` 的分類結果會**錯誤**。安全做法是 handler 自行解析 DB 回傳的時段邊界。

```typescript
import { getRateForHour } from '../../shared/tarifa';

// In savings calculation loop:
for (const row of rawRows) {
  const hour = new Date(row.recorded_at).getHours();
  const rate = getRateForHour(hour, tariffSchedule);
  // ...
}
```

### 1.5 未來觸發條件

如果以下任一條件成立，應重新評估抽取 tariff DB helper：
- 第 3 個 handler 需要查詢 tariff_schedules
- tariff_schedules 查詢邏輯變更（例如支援多費率方案疊加）
- 需要 tariff 查詢快取

---

## 2-8. 其餘章節

(Same as v5.22 §1-8. 見 `09_SHARED_LAYER_v5.22.md`.)

所有 shared 檔案維持不變：
- `shared/types/solfacil-protocol.ts` — UNCHANGED
- `shared/types/telemetry.ts` — UNCHANGED (34 fields)
- `shared/types/api.ts` — UNCHANGED
- `shared/types/auth.ts` — UNCHANGED
- `shared/middleware/tenant-context.ts` — UNCHANGED
- `shared/db.ts` — UNCHANGED
- `shared/tarifa.ts` — UNCHANGED

---

## 9. 代碼變更清單（v5.22 → v5.24）

| 檔案 | 動作 | 版本 | 說明 |
|------|------|------|------|
| 所有 shared 檔案 | **unchanged** | v5.22 | 無程式碼變更 |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本 |
| v5.3 | 2026-02-27 | HEMS 單戶控制型別 |
| v5.4 | 2026-02-27 | PostgreSQL 全面取代 DynamoDB 型別 |
| v5.5 | 2026-02-28 | 雙層 KPI 型別 |
| v5.10 | 2026-03-05 | RLS Scope Formalization |
| v5.11 | 2026-03-05 | Dual Pool Factory |
| v5.13 | 2026-03-05 | XuhengRawMessage + ParsedTelemetry + Tarifa Branca |
| v5.14 | 2026-03-06 | Formula Overhaul: DP, expand ParsedTelemetry +9 fields |
| v5.22 | 2026-03-13 | +solfacil-protocol.ts, expanded ParsedTelemetry 34 fields, tenant-context.ts |
| **v5.24** | **2026-03-13** | **Tariff helper 評估：結論為不抽取新 helper。P3 handler 應直接匯入 `shared/tarifa.ts` 的 `classifyHour()` / `getRateForHour()` 純函式，tariff SQL 保持 inline。決策記錄：3 次相似才抽取、RLS 上下文差異、避免過度抽象** |
