# M5: BFF Module -- P3 Asset History View Endpoints

> **模組版本**: v5.24
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.24.md](./00_MASTER_ARCHITECTURE_v5.24.md)
> **最後更新**: 2026-03-13
> **說明**: 新增 2 個 asset 級歷史查詢端點：get-asset-telemetry（多粒度能量流）+ get-asset-health（設備健康）
> **核心主題**: P3 Asset History View — asset 級多粒度遙測查詢 + 設備健康時序

---

## v5.22 → v5.24 變更總覽

| 版本 | 變更內容 | 影響範圍 |
|------|----------|----------|
| **v5.24** | P3 Asset History View：新增 `get-asset-telemetry.ts`（多粒度能量流 + summary + savings）+ `get-asset-health.ts`（SOC/SOH/溫度時序 + DO 事件 + 電池循環數）；data-source.js 新增 `asset.telemetry()` + `asset.health()` | 新增 2 handler，修改 local-server.ts 路由註冊 + data-source.js |

---

## 1. 完整端點列表（34 handler + 1 middleware = 35 檔案）

### 新增 GET handlers（+2 = 29 個）

| # | Handler 檔案 | 路由 | 版本 | 說明 |
|---|-------------|------|------|------|
| 28 | **get-asset-telemetry.ts** | GET /api/assets/:assetId/telemetry | **v5.24** | Asset 級多粒度遙測 + summary + savings 計算 |
| 29 | **get-asset-health.ts** | GET /api/assets/:assetId/health | **v5.24** | 設備健康時序 + DO 事件 + 電池循環數 |

（其餘 27 GET + 4 POST/PUT + 1 SSE + 1 middleware 與 v5.22 完全相同，見 v5.22 文件。）

---

## 2. 新增端點詳情

### 2.1 GET `/api/assets/:assetId/telemetry` — 多粒度能量流（v5.24）

**檔案**：`bff/handlers/get-asset-telemetry.ts`

**角色**：SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR, ORG_VIEWER

**Query Parameters：**

| 參數 | 類型 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `from` | ISO datetime | ✅ | — | 開始時間（含） |
| `to` | ISO datetime | ✅ | — | 結束時間（不含） |
| `resolution` | `'5min' \| 'hour' \| 'day' \| 'month'` | ❌ | `'5min'` | 時間粒度 |

**驗證規則：**
- `from` 和 `to` 必須為有效 ISO datetime，否則 400
- `to` 必須大於 `from`，否則 400
- `to - from` 不得超過 400 天，否則 400
- `resolution` 不在允許值中時回 400

**SQL 查詢策略（依 resolution 分支）：**

#### resolution = `'5min'`（原始數據）

```sql
-- Q1: 時序數據
SELECT
  recorded_at AS t,
  pv_power,
  load_power,
  battery_power,
  grid_power_kw,
  battery_soc,
  grid_import_kwh,
  grid_export_kwh
FROM telemetry_history
WHERE asset_id = $1
  AND recorded_at >= $2
  AND recorded_at < $3
ORDER BY recorded_at
```

#### resolution = `'hour'`

```sql
SELECT
  date_trunc('hour', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS t,
  AVG(pv_power) AS pv_power,
  AVG(load_power) AS load_power,
  AVG(battery_power) AS battery_power,
  AVG(grid_power_kw) AS grid_power_kw,
  AVG(battery_soc) AS battery_soc,
  SUM(grid_import_kwh) AS grid_import_kwh,
  SUM(grid_export_kwh) AS grid_export_kwh
FROM telemetry_history
WHERE asset_id = $1
  AND recorded_at >= $2
  AND recorded_at < $3
GROUP BY t
ORDER BY t
```

#### resolution = `'day'`

```sql
SELECT
  date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS t,
  MAX(pv_daily_energy_kwh) AS pv_total,
  SUM(load_power) / 12 AS load_total,
  SUM(grid_import_kwh) AS grid_import,
  SUM(grid_export_kwh) AS grid_export,
  MAX(daily_charge_kwh) AS charge,
  MAX(daily_discharge_kwh) AS discharge,
  AVG(battery_soc) AS avg_soc
FROM telemetry_history
WHERE asset_id = $1
  AND recorded_at >= $2
  AND recorded_at < $3
GROUP BY t
ORDER BY t
```

#### resolution = `'month'`

```sql
SELECT
  date_trunc('month', sub.day) AS t,
  SUM(sub.day_pv) AS pv_total,
  SUM(sub.day_load) AS load_total,
  SUM(sub.day_grid_import) AS grid_import,
  SUM(sub.day_grid_export) AS grid_export,
  SUM(sub.day_charge) AS charge,
  SUM(sub.day_discharge) AS discharge
FROM (
  SELECT
    date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
    MAX(pv_daily_energy_kwh) AS day_pv,
    SUM(load_power) / 12 AS day_load,
    SUM(grid_import_kwh) AS day_grid_import,
    SUM(grid_export_kwh) AS day_grid_export,
    MAX(daily_charge_kwh) AS day_charge,
    MAX(daily_discharge_kwh) AS day_discharge
  FROM telemetry_history
  WHERE asset_id = $1
    AND recorded_at >= $2
    AND recorded_at < $3
  GROUP BY day
) sub
GROUP BY date_trunc('month', sub.day)
ORDER BY date_trunc('month', sub.day)
```

> **注意**：`pv_daily_energy_kwh`、`daily_charge_kwh`、`daily_discharge_kwh` 為逆變器回報的累計日能量，同日各筆相同或遞增，故使用 MAX（日粒度）避免重複計算。月粒度先 per-day MAX 再跨日 SUM。`load_power` 為瞬時功率 (kW)，5 分鐘一筆，除 12 轉 kWh。

**Q2: Summary 計算**

```sql
-- 與時序分離，獨立查詢（避免重覆 GROUP BY 影響 summary）
SELECT
  SUM(day_pv) AS pv_total,
  SUM(day_load) AS load_total,
  SUM(day_grid_import) AS grid_import_total,
  SUM(day_grid_export) AS grid_export_total,
  MAX(max_load) AS peak_demand
FROM (
  SELECT
    date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
    MAX(pv_daily_energy_kwh) AS day_pv,
    SUM(load_power) / 12 AS day_load,
    SUM(grid_import_kwh) AS day_grid_import,
    SUM(grid_export_kwh) AS day_grid_export,
    MAX(load_power) AS max_load
  FROM telemetry_history
  WHERE asset_id = $1
    AND recorded_at >= $2
    AND recorded_at < $3
  GROUP BY day
) daily
```

**Q3: Savings 計算（JOIN tariff_schedules）**

```sql
-- 電價費率
SELECT
  peak_rate, offpeak_rate, feed_in_rate,
  COALESCE(intermediate_rate, (peak_rate + offpeak_rate) / 2.0) AS intermediate_rate,
  peak_start, peak_end, intermediate_start, intermediate_end
FROM tariff_schedules
WHERE org_id = $1
  AND (effective_to IS NULL OR effective_to > NOW())
ORDER BY effective_from DESC
LIMIT 1
```

**Savings 計算邏輯（TypeScript）：**

```
// 逐 5min 窗口計算（使用原始 5min 數據，無論前端 resolution）
// 假設帳單 = Σ (load_power / 12) × 對應時段電價
// 實際帳單 = Σ grid_import_kwh × import_rate - Σ grid_export_kwh × feed_in_rate
// 節省 = 假設帳單 - 實際帳單

function classifyHourRate(hour, tariff):
  if hour >= peakStart && hour < peakEnd: return tariff.peak_rate
  if hour >= intStart && hour < intEnd: return tariff.intermediate_rate
  return tariff.offpeak_rate

hypotheticalBill = 0
actualBill = 0
for each row in rawRows:
  hour = BRT hour of row.recorded_at
  rate = classifyHourRate(hour, tariff)
  hypotheticalBill += (row.load_power / 12) * rate
  actualBill += row.grid_import_kwh * rate - row.grid_export_kwh * tariff.feed_in_rate

savings = round((hypotheticalBill - actualBill) * 100) / 100
```

> **與 M4 對齊**：此處的假設帳單公式與 `daily-billing-job.ts` 中 `calculateBaselineCost` 的邏輯一致，均使用 Tarifa Branca 三段費率（peak / intermediate / offpeak）。差異在於 M4 使用 `asset_hourly_metrics` 預聚合資料，P3 直接使用 `telemetry_history` 原始 5 分鐘資料進行即時計算。

**並行查詢策略：**

```
const [pointsResult, summaryResult, tariffResult] = await Promise.all([
  queryWithOrg(timeSeriesSQL, [assetId, from, to], rlsOrgId),
  queryWithOrg(summarySQL, [assetId, from, to], rlsOrgId),
  queryWithOrg(tariffSQL, [ctx.orgId], rlsOrgId),
]);
```

**Response Schema：**

```json
{
  "success": true,
  "data": {
    "points": [
      {
        "t": "2026-01-21T00:00:00-03:00",
        "pv": 0.0,
        "load": 0.4,
        "bat": 0.0,
        "grid": 0.4,
        "soc": 30.0,
        "gridImport": 0.033,
        "gridExport": 0.0
      }
    ],
    "summary": {
      "pvTotal": 19.94,
      "loadTotal": 32.5,
      "gridImport": 15.2,
      "gridExport": 2.7,
      "selfConsumption": 86.5,
      "selfSufficiency": 53.2,
      "peakDemand": 3.14,
      "savings": 8.50,
      "currency": "BRL"
    }
  }
}
```

**Summary 衍生公式：**
- `selfConsumption = (pvTotal - gridExport) / pvTotal × 100`（pvTotal = 0 時為 null）
- `selfSufficiency = (loadTotal - gridImport) / loadTotal × 100`（loadTotal = 0 時為 null）
- `peakDemand = MAX(load_power)` 跨選定期間

**錯誤處理：**

| HTTP | 條件 | 錯誤訊息 |
|------|------|----------|
| 400 | `from` / `to` 缺失或格式錯誤 | `"from and to are required (ISO datetime)"` |
| 400 | `to <= from` | `"to must be after from"` |
| 400 | 範圍超過 400 天 | `"Date range must not exceed 400 days"` |
| 400 | `resolution` 不合法 | `"resolution must be one of: 5min, hour, day, month"` |
| 404 | asset 不存在或不屬於此 org | `"Asset not found"` |

---

### 2.2 GET `/api/assets/:assetId/health` — 設備健康（v5.24）

**檔案**：`bff/handlers/get-asset-health.ts`

**角色**：SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR, ORG_VIEWER

**Query Parameters：**

| 參數 | 類型 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `from` | ISO datetime | ✅ | — | 開始時間（含） |
| `to` | ISO datetime | ✅ | — | 結束時間（不含） |

**並行查詢（Promise.all 8 路）：**

**Q1: 當前狀態（最新一筆）**

```sql
SELECT
  battery_soc,
  battery_soh,
  battery_temperature,
  inverter_temp,
  bat_work_status
FROM telemetry_history
WHERE asset_id = $1
ORDER BY recorded_at DESC
LIMIT 1
```

**Q2: SOC 歷史**

```sql
SELECT recorded_at AS t, battery_soc AS soc
FROM telemetry_history
WHERE asset_id = $1
  AND recorded_at >= $2
  AND recorded_at < $3
ORDER BY recorded_at
```

**Q3: SOH 每日趨勢**

```sql
SELECT
  date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
  AVG(battery_soh) AS soh
FROM telemetry_history
WHERE asset_id = $1
  AND recorded_at >= $2
  AND recorded_at < $3
  AND battery_soh IS NOT NULL
GROUP BY day
ORDER BY day
```

**Q4: 溫度歷史**

```sql
SELECT
  recorded_at AS t,
  battery_temperature AS bat_temp,
  inverter_temp AS inv_temp
FROM telemetry_history
WHERE asset_id = $1
  AND recorded_at >= $2
  AND recorded_at < $3
ORDER BY recorded_at
```

**Q5: 電池循環數**

```sql
SELECT
  COALESCE(SUM(sub.day_discharge), 0) AS total_discharge
FROM (
  SELECT
    date_trunc('day', th.recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
    MAX(th.daily_discharge_kwh) AS day_discharge
  FROM telemetry_history th
  WHERE th.asset_id = $1
    AND th.recorded_at >= $2
    AND th.recorded_at < $3
  GROUP BY day
) sub
```

**Q6: DO 事件（window function 找 false→true→false 區間）**

```sql
WITH ordered AS (
  SELECT
    recorded_at,
    do0_active,
    LAG(do0_active) OVER (ORDER BY recorded_at) AS prev_do0
  FROM telemetry_history
  WHERE asset_id = $1
    AND recorded_at >= $2
    AND recorded_at < $3
),
starts AS (
  SELECT recorded_at AS event_start
  FROM ordered
  WHERE do0_active = true AND (prev_do0 = false OR prev_do0 IS NULL)
),
ends AS (
  SELECT recorded_at AS event_end
  FROM ordered
  WHERE do0_active = false AND prev_do0 = true
)
SELECT
  s.event_start,
  (SELECT MIN(e.event_end) FROM ends e WHERE e.event_end > s.event_start) AS event_end
FROM starts s
ORDER BY s.event_start
```

**Q7: Asset 資訊（取 capacity_kwh 計算循環數）**

```sql
SELECT capacity_kwh
FROM assets
WHERE asset_id = $1
```

**Q8: 電壓/電流歷史**

```sql
SELECT
  recorded_at AS t,
  battery_voltage AS voltage,
  battery_current AS current
FROM telemetry_history
WHERE asset_id = $1
  AND recorded_at >= $2
  AND recorded_at < $3
ORDER BY recorded_at
```

**Response Schema：**

```json
{
  "success": true,
  "data": {
    "current": {
      "soc": 39.9,
      "soh": 97.0,
      "batTemp": 31.2,
      "invTemp": 42.5,
      "status": "standby"
    },
    "socHistory": [{ "t": "2026-01-21T00:00:00-03:00", "soc": 50.0 }],
    "sohTrend": [{ "day": "2025-12-13", "soh": 98.5 }],
    "tempHistory": [{ "t": "...", "batTemp": 30.0, "invTemp": 40.0 }],
    "voltageHistory": [{ "t": "...", "voltage": 51.2, "current": -10.5 }],
    "batteryCycles": 45.2,
    "doEvents": [
      {
        "start": "2026-01-15T18:10:00-03:00",
        "end": "2026-01-15T20:25:00-03:00",
        "durationMin": 135
      }
    ]
  }
}
```

**電池循環數計算：**
```
cycles = capacityKwh > 0
  ? round((totalDischarge / capacityKwh) * 10) / 10
  : 0
```

**DO 事件持續時間計算：**
```
durationMin = eventEnd != null
  ? round((eventEnd - eventStart) / 60000)
  : null  // 未結束事件（仍活躍）
```

**錯誤處理：**

| HTTP | 條件 | 錯誤訊息 |
|------|------|----------|
| 400 | `from` / `to` 缺失或格式錯誤 | `"from and to are required (ISO datetime)"` |
| 400 | `to <= from` | `"to must be after from"` |
| 404 | asset 不存在或不屬於此 org | `"Asset not found"` |

---

## 3. Query Routing Red Line（v5.24 更新）

| 查詢類型 | 允許來源 | 禁止來源 |
|----------|----------|----------|
| 長期聚合（Scorecard, Revenue, Dashboard, Savings） | `revenue_daily`, `asset_hourly_metrics`, `device_state` | ~~`telemetry_history`~~, ~~`asset_5min_metrics`~~ |
| 近 24h 高解析度（Gateway Energy） | `telemetry_history`（例外） | — |
| **P3 Asset 多粒度歷史（v5.24）** | **`telemetry_history`（asset 級，任意日期範圍 + date_trunc 聚合）** | — |
| 即時設備狀態 | `device_state` | ~~`telemetry_history`~~ |
| 指令歷史/排程狀態 | `device_command_logs` | — |
| Gateway 列表/摘要 | `gateways`, `organizations`, `assets` | — |

**v5.24 合規：**
- `get-asset-telemetry.ts`: `telemetry_history`(asset-level, date range) + `tariff_schedules` — **COMPLIANT**（P3 歷史查詢例外，與 gateway energy 相同合規理由）
- `get-asset-health.ts`: `telemetry_history`(asset-level, date range) + `assets` — **COMPLIANT**

---

## 4. App Pool Isolation（v5.24 更新）

### v5.24 Pool 合規檢查

| Handler | Pool 使用 | 狀態 |
|---------|----------|------|
| **get-asset-telemetry.ts** | queryWithOrg() x3 (Promise.all) | **COMPLIANT** |
| **get-asset-health.ts** | queryWithOrg() x8 (Promise.all) | **COMPLIANT** |
| 其餘 32 handler + 1 middleware | 無變更 | COMPLIANT |

---

## 5. What Stays Unchanged in v5.24

所有 v5.22 的 32 handler + 1 middleware + 1 SSE 均維持不變。完整清單見 [05_BFF_MODULE_v5.22.md](./05_BFF_MODULE_v5.22.md) §7。

---

## 6. Code Change List

| 檔案 | 動作 | 版本 | 說明 |
|------|------|------|------|
| `bff/handlers/get-asset-telemetry.ts` | **NEW** | v5.24 | Asset 級多粒度遙測 + summary + savings（3 路並行查詢） |
| `bff/handlers/get-asset-health.ts` | **NEW** | v5.24 | 設備健康時序 + DO 事件 + 電池循環數（8 路並行查詢） |
| `backend/scripts/local-server.ts` | **MODIFY** | v5.24 | 新增 2 個路由：`GET /api/assets/:assetId/telemetry` + `GET /api/assets/:assetId/health` |
| `frontend-v2/js/data-source.js` | **MODIFY** | v5.24 | 新增 `asset.telemetry(assetId, from, to, resolution)` + `asset.health(assetId, from, to)` |
| 其餘 32 handler + 1 middleware | **unchanged** | v5.22 | 無影響 |

---

## 7. Test Strategy（v5.24 新增）

| 測試 | 範圍 | 技術 |
|------|------|------|
| telemetry 5min 原始查詢 | 288 筆/天 seed data | 驗證 points 長度 = 288，時間排序正確 |
| telemetry hour 聚合 | 24h seed data | 驗證 points 長度 = 24，AVG(pv_power) 正確 |
| telemetry day 聚合 | 7 天 seed data | 驗證 points 長度 = 7，MAX(pv_daily_energy_kwh) 正確 |
| telemetry month 聚合 | 3 個月 seed data | 驗證 points 長度 = 3 |
| summary selfConsumption | pvTotal=20, gridExport=3 | `(20-3)/20*100 = 85%` |
| summary selfSufficiency | loadTotal=30, gridImport=12 | `(30-12)/30*100 = 60%` |
| summary peakDemand | MAX(load_power) = 3.14 | 驗證 peakDemand = 3.14 |
| savings 計算 | Tarifa Branca rates + energy data | 驗證與手算結果一致 |
| savings pvTotal=0 | 無 PV 數據 | selfConsumption = null |
| health current | 最新一筆 telemetry_history | soc/soh/batTemp/invTemp/status 正確 |
| health SOH 趨勢 | 90 天 seed data | 驗證 sohTrend 長度 = 90，遞減趨勢 |
| health 電池循環 | totalDischarge=450, capacity=10kWh | cycles = 45.0 |
| health DO 事件 | 3 段 do0_active=true 區間 | 驗證 doEvents 長度 = 3，durationMin 正確 |
| health DO 事件無 DO | 所有 do0_active = false/null | doEvents = [] |
| 400 缺少 from/to | 無 query params | 驗證 400 Bad Request |
| 400 resolution 非法 | resolution=10min | 驗證 400 Bad Request |
| 400 日期範圍過大 | 500 天 | 驗證 400 Bad Request |
| 404 asset 不存在 | assetId=NONEXIST | 驗證 404 Not Found |
| RLS 租戶隔離 | 不同 org 的 asset | 驗證 404（RLS 過濾） |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: BFF Gateway + 4 endpoints |
| v5.3 | 2026-02-27 | HEMS single-home control |
| v5.5 | 2026-02-28 | Dual-layer revenue KPI |
| v5.9 | 2026-03-02 | BFF de-hardcoding round 1 |
| v5.10 | 2026-03-05 | Dashboard 7 queries de-hardcoded |
| v5.12 | 2026-03-05 | API Contract Alignment -- 15 new endpoints |
| v5.13 | 2026-03-05 | Scorecard 2 metrics de-hardcoded; Dashboard revenue -> Tarifa Branca |
| v5.14 | 2026-03-06 | KPI Replacement: Savings Alpha -> Actual Savings + Opt Efficiency + Self-Sufficiency |
| v5.15 | 2026-03-07 | SC/TOU Real Attribution: remove fake ratios; ps=null |
| v5.16 | 2026-03-07 | PS Real Value: ps:null -> COALESCE(SUM(ps_savings_reais),0) |
| v5.19 | 2026-03-10 | homes→gateways 整合：7 個新 gateway handler |
| v5.20 | 2026-03-11 | Gateway-level detail + devices + energy flow + schedule 讀寫 |
| v5.21 | 2026-03-12 | SSE 即時推送 |
| v5.22 | 2026-03-13 | Dispatch Guard：409 Conflict 防護 |
| **v5.24** | **2026-03-13** | **P3 Asset History View：+get-asset-telemetry.ts（多粒度能量流 + summary + savings，3 路並行查詢，resolution 分支 SQL）+ get-asset-health.ts（SOC/SOH/溫度時序 + DO 事件 window function + 電池循環數，8 路並行查詢）；BFF 總計 34 handler + 1 middleware = 35 檔案；所有端點 App Pool compliant** |
