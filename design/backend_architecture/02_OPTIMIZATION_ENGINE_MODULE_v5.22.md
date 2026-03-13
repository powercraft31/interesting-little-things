# M2: 優化引擎 — 排程產生與即時套利

> **模組版本**: v5.22
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **前版**: [02_OPTIMIZATION_ENGINE_v5.16.md](./02_OPTIMIZATION_ENGINE_v5.16.md)
> **最後更新**: 2026-03-13
> **說明**: schedule-generator.ts 產生 SC/TOU/Peak Shaving 排程；run-optimization.ts 提供即時套利決策
> **核心主題**: 排程產生（含 PS 模式）與即時套利 Handler

---

## 與 v5.16 的差異

**v5.16 → v5.22：無程式碼變更。**

| 面向 | v5.16 | v5.22 |
|------|-------|-------|
| PS 排程產生 | 已實作 | 不變 |
| 資料讀取 | assets, device_state, vpp_strategies, pld_horario, homes | **schema 依賴備註**: `contracted_demand_kw` 已從 `homes` 遷移至 `gateways`（v5.19） |
| trade_schedules 輸出 | SC、TOU 及 peak_shaving 時段 | 不變 |
| contracted_demand_kw 用法 | 用於 PS 閾值評估 | 不變（但 JOIN 目標應為 gateways） |

> **Schema 依賴備註（v5.19）**：v5.19 將 `contracted_demand_kw` 從 `homes` 表遷移至 `gateways` 表。schedule-generator.ts 中的 SQL 查詢已於 v5.19 更新為 `LEFT JOIN gateways g ON g.gateway_id = a.gateway_id`，改從 `g.contracted_demand_kw` 讀取。程式碼邏輯本身未變更。

---

## 1. 即時套利 Handler

### 檔案：`optimization-engine/handlers/run-optimization.ts`

Lambda Handler，接收即時事件並產生充放電決策，發布至 EventBridge。

### 1.1 介面

```typescript
export async function handler(event: OptimizationEvent): Promise<OptimizationResult>
```

- **輸入 `OptimizationEvent`**: `{ orgId, assetId, soc, currentTariffPeriod }` 其中 `currentTariffPeriod` 為 `"peak" | "off-peak" | "intermediate"`
- **輸出 `OptimizationResult`**: `{ success, data: { assetId, orgId, targetMode, soc, tariffPeriod, dispatchId, eventPublished } }`

### 1.2 套利決策邏輯（`resolveTargetMode`）

| 條件 | 結果 |
|------|------|
| `period === "peak" && soc > minSoc` | `"discharge"` |
| `period === "off-peak" && soc < maxSoc` | `"charge"` |
| 其他 | `"idle"` |

- `minSoc`、`maxSoc` 透過 AppConfig Lambda Extension Sidecar（`http://localhost:2772`）動態取得
- 若 AppConfig 不可用，降級使用 `DEFAULT_STRATEGY`：`{ minSoc: 20, maxSoc: 90, emergencySoc: 10, profitMargin: 0.15 }`

### 1.3 EventBridge 發布

決策結果以 `DRCommandIssued` 事件發布至 EventBridge（Source: `solfacil.optimization-engine`），供 M3 DR Dispatcher 消費。

---

## 2. PS 排程產生邏輯

### 檔案：`optimization-engine/services/schedule-generator.ts`

在現有 SC/TOU 時段邏輯之後產生 PS 排程。以 cron 每小時執行一次（`0 * * * *`），系統啟動時亦立即執行。

### 2.1 何時產生 PS 時段

| 條件 | 要求 |
|------|------|
| 時間窗口 | 尖峰時段 BRT 18:00-22:00（硬編碼 `peakHours = [18, 19, 20, 21]`） |
| 資產資格 | `is_active = true` 且 `gateways.contracted_demand_kw IS NOT NULL` |

> **注意**：目前實作**不**進行需量風險評估（無 85% 閾值判斷）。只要資產有 `contracted_demand_kw`，即無條件為所有尖峰小時產生 PS 時段。未來可加入需量閾值篩選。

### 2.2 資產查詢（含 contracted_demand_kw）

PS 排程的資產篩選來自主資產查詢的結果（非獨立查詢）：

```sql
SELECT
  a.asset_id, a.org_id, a.capacidade_kw, a.submercado, a.operation_mode,
  COALESCE(d.battery_soc, 50) AS battery_soc,
  COALESCE(vs.min_soc, 20)   AS min_soc,
  COALESCE(vs.max_soc, 95)   AS max_soc,
  COALESCE(a.allow_export, false) AS allow_export,
  g.contracted_demand_kw
FROM assets a
LEFT JOIN device_state d ON d.asset_id = a.asset_id
LEFT JOIN vpp_strategies vs ON vs.org_id = a.org_id
  AND vs.target_mode = a.operation_mode
  AND vs.is_active = true
LEFT JOIN gateways g ON g.gateway_id = a.gateway_id
WHERE a.is_active = true
```

然後在 TypeScript 中以 `assetsResult.rows.filter(a => a.contracted_demand_kw != null)` 篩選具有契約容量的資產。

### 2.3 PS 時段寫入

針對每個具有 `contracted_demand_kw` 的資產，為每個尖峰小時（18, 19, 20, 21 BRT）各插入一筆排程：

```sql
INSERT INTO trade_schedules
  (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status, target_mode)
VALUES ($1, $2, $3, 'discharge', $4, 0, 'scheduled', 'peak_shaving')
ON CONFLICT DO NOTHING
```

- 每小時一筆（共 4 筆），而非單一 240 分鐘時段
- `expected_volume_kwh = capacidade_kw * 0.8`（額定功率 80%）
- `target_pld_price = 0`（PS 不涉及 PLD 定價）
- `action = 'discharge'`（電池放電以覆蓋尖峰）
- `target_mode = 'peak_shaving'`
- `status = 'scheduled'`（M3 擷取並派遣）
- `ON CONFLICT DO NOTHING` 避免重複插入
- `planned_time` 以 BRT → UTC 轉換：`hour + 3` 設為 UTC 小時

---

## 3. contracted_demand_kw 資料流

### 查詢

`contracted_demand_kw` 在主資產查詢中透過 `LEFT JOIN gateways g ON g.gateway_id = a.gateway_id` 取得，然後在應用層以 `filter(a => a.contracted_demand_kw != null)` 篩選。

### NULL 處理

若 `contracted_demand_kw IS NULL`（閘道器無契約容量）：
- 該資產被 TypeScript `filter()` 排除，**跳過** PS 排程產生
- **無明確日誌警告**（靜默跳過）
- 這對於沒有需量型電價的站點（住宅、小型商業）是預期行為

---

## 4. 組態

### 尖峰時段

```typescript
// 硬編碼於 schedule-generator.ts
const peakHours = [18, 19, 20, 21]; // BRT 18:00-22:00 peak risk window
```

> **注意**：目前尖峰時段為硬編碼陣列，非透過環境變數或 vpp_strategies 設定。程式碼中不存在 `PS_PEAK_START_HOUR_BRT`、`PS_PEAK_END_HOUR_BRT`、`PS_DEMAND_THRESHOLD_PCT` 等常數。

---

## 5. 連線池分配

| 元件 | 連線池 | 理由 |
|------|--------|------|
| schedule-generator（既有） | **Service Pool** | 跨租戶 cron 任務（v5.11 決策） |
| PS 排程產生（既有） | **Service Pool** | 相同 cron 上下文，跨租戶讀取 gateways/assets |
| run-optimization（既有） | **N/A（Lambda）** | 無連線池，使用 EventBridge + AppConfig |

PS 邏輯在現有 `runScheduleGenerator()` 函式內執行。run-optimization 為獨立 Lambda Handler。

---

## 6. 未變更項目

| 元件 | v5.16 狀態 | v5.22 狀態 |
|------|-----------|-----------|
| SC 時段產生 | v5.9 | 不變 |
| TOU (peak_valley_arbitrage) 時段產生 | v5.9 | 不變 |
| SoC 感知排程 | v5.9 | 不變 |
| PLD 動態定價 | v5.7 | 不變 |
| 策略配置（vpp_strategies） | v5.6 | 不變 |
| PS 排程產生 | v5.16 | 不變 |

---

## 7. 程式碼變更清單

| 檔案 | 動作 | 描述 |
|------|------|------|
| `optimization-engine/handlers/run-optimization.ts` | **無變更** | 即時套利 Handler，接收事件產生充放電決策並發布至 EventBridge |
| `optimization-engine/services/schedule-generator.ts` | **無變更** | v5.16 實作不變。v5.19 schema 遷移使 contracted_demand_kw JOIN 由 homes 改為 gateways，但此變更已於 v5.19 schema 階段反映在 SQL 中 |

---

## 8. 測試策略

| 測試 | 輸入 | 預期結果 |
|------|------|----------|
| PS 時段已產生 | 資產有 contracted_demand_kw | 為每個尖峰小時（18-21 BRT）各插入 1 筆 PS 時段 |
| NULL contracted_demand_kw | 閘道器無契約容量 | 靜默跳過，無 PS 時段 |
| 同一閘道器多個資產 | 2 個資產，閘道器契約 = 100kW | 兩者皆產生 PS 時段 |
| PS 不干擾 TOU | 資產於 19:00 有 TOU 時段，且有 contracted_demand_kw | 兩種時段均產生（M3 解決優先順序） |
| ON CONFLICT | 重複執行排程產生器 | 不產生重複 PS 時段（ON CONFLICT DO NOTHING） |
| 即時套利：peak 放電 | `currentTariffPeriod = "peak"`, `soc = 50` | `targetMode = "discharge"` |
| 即時套利：off-peak 充電 | `currentTariffPeriod = "off-peak"`, `soc = 50` | `targetMode = "charge"` |
| 即時套利：idle | `currentTariffPeriod = "intermediate"`, `soc = 50` | `targetMode = "idle"` |
| 即時套利：SOC 過低不放電 | `currentTariffPeriod = "peak"`, `soc = 15` | `targetMode = "idle"`（< minSoc 20） |

---

## 文件歷史

| 版本 | 日期 | 摘要 |
|------|------|------|
| v5.2 | 2026-02-27 | 初版：4 種策略演算法 |
| v5.5 | 2026-02-28 | 成本優化、SoC 約束 |
| v5.6 | 2026-02-28 | AppConfig 策略配置 |
| v5.7 | 2026-02-28 | 動態 PLD 定價 |
| v5.9 | 2026-03-02 | SoC 感知排程、排程產生器 cron |
| v5.11 | 2026-03-05 | 跨租戶排程產生使用 Service Pool |
| v5.16 | 2026-03-07 | PS 排程產生：讀取 gateways.contracted_demand_kw；為具有契約容量之資產在尖峰時段（BRT 18:00-22:00）插入 peak_shaving 時段；NULL 契約容量靜默跳過 |
| **v5.22** | **2026-03-13** | **無程式碼變更。文件修正：補充 run-optimization.ts Handler 文件；修正 PS 排程邏輯描述以符合實作（無 85% 閾值、每小時一筆非單一 240 分鐘、ON CONFLICT DO NOTHING）；Schema 依賴備註：contracted_demand_kw 從 homes 遷移至 gateways（v5.19）** |
