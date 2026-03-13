# REQ: P3 Asset History View (P3-1 能量流 + P3-2 設備健康)

> Status: DRAFT — 待 Alan 審閱  
> Date: 2026-03-13  
> Data source: `telemetry_history` (77,760 rows, 3 gateways × 90 days × 288 points/day)

---

## 影響模組盤點

### 需要修改的設計文件

| 模組 | 最新版本 | 影響內容 | 改動程度 |
|------|----------|----------|----------|
| **M05 BFF** | `05_BFF_MODULE_v5.22.md` | 新增 2 個 endpoint：`/api/assets/:assetId/telemetry` + `/api/assets/:assetId/health`。現有 `get-gateway-energy.ts` 只做 gateway 級 24h 15min-bucket，新端點需 asset 級 + 多粒度(5min/hour/day/month) + 日期範圍 + summary 計算 | **大改** — 新增 2 handler + data-source.js adapter |
| **M10 DB Schema** | `10_DATABASE_SCHEMA_v5.22.md` | **無 DDL 變更**。需補充文檔：telemetry_history 的多粒度查詢模式（date_trunc aggregation patterns）、tariff JOIN 計算節省金額的標準 SQL | **文檔補充** |
| **M04 Market Billing** | `04_MARKET_BILLING_MODULE_v5.22.md` | 節省金額公式目前散落在 `daily-billing-job.ts`。P3 summary 的 savings 計算邏輯需與 M04 保持一致（同一套 tariff JOIN）。需在 M04 文檔中明確「即時計算」vs「預聚合」的邊界 | **小改** — 補公式對齊 |
| **M00 Master Architecture** | `00_MASTER_ARCHITECTURE_v5.22.md` | 頁面架構更新：P3 從單頁拆成 P3-1 (Energy Flow) + P3-2 (Equipment Health)。路由新增 `#asset-energy` + `#asset-health` | **小改** — 頁面結構 |
| **M09 Shared Layer** | `09_SHARED_LAYER_v5.22.md` | `queryWithOrg` 已支援。可能需新增 tariff-aware 聚合 helper（根據時段 JOIN tariff_schedules 計算金額），避免在 handler 裡重複寫 tariff JOIN SQL | **可選** — 看是否抽 helper |

### 不需要修改的模組

| 模組 | 原因 |
|------|------|
| M01 IoT Hub | 不涉及 — 歷史查詢不經過 MQTT/M1 |
| M02 Optimization Engine | 不涉及 — 排程生成邏輯不變 |
| M03 DR Dispatcher | 不涉及 — DO 事件從 telemetry_history 的 do0_active 讀取，不改 dispatcher |
| M06 Identity | 不涉及 — auth/JWT 不變 |
| M07 Open API | 不涉及 — 外部 API 暫不開放歷史查詢 |
| M08 Admin Control | 不涉及 |

### 前端新增檔案

| 檔案 | 位置 | 說明 |
|------|------|------|
| `p3-energy.js` | `frontend-v2/js/` | P3-1 能量流頁面邏輯（ECharts 折線+長條、日期選擇器、粒度切換） |
| `p3-health.js` | `frontend-v2/js/` | P3-2 設備健康頁面邏輯（SOC/SOH/溫度圖表、DO 事件表） |
| `data-source.js` | `frontend-v2/js/` | **修改** — 新增 `DataSource.asset.telemetry(assetId, from, to, resolution)` + `DataSource.asset.health(assetId, from, to)` |
| `index.html` | `frontend-v2/` | **修改** — 路由新增 `#asset-energy` / `#asset-health`，全域日期控件 |

### 後端新增檔案

| 檔案 | 位置 | 說明 |
|------|------|------|
| `get-asset-telemetry.ts` | `backend/src/bff/handlers/` | 多粒度遙測查詢 + summary 計算 |
| `get-asset-health.ts` | `backend/src/bff/handlers/` | 設備健康數據 + DO 事件 |
| `local-server.ts` | `backend/scripts/` | **修改** — 註冊 2 個新路由 |

### 現有端點參考（有重疊但不取代）

- `GET /api/gateways/:gatewayId/energy`（`get-gateway-energy.ts`）— **gateway 級**，15min bucket，只看 24h。P3 是 **asset 級**，5min 原始，支持多粒度和任意日期範圍。兩者共存。
- `GET /api/devices/:assetId`（`get-device-detail.ts`）— 回傳 asset 靜態資訊 + 最新一筆 telemetry。P3 是**時序歷史**。兩者互補。
- `GET /api/performance/savings`（`get-performance-savings.ts`）— 全 org 級績效。P3 summary 是**單一 asset 級**。公式需對齊。

---

## 入口

從 P2 Gateway Detail 頁面，點擊某個 asset（逆變器）→ 進入 P3。  
P3 頂部有 tab 切換：**能量流 | 設備健康**

---

## 全域控件（兩個 tab 共用）

### 日期選擇器
- 顯示當前選定日期/範圍，格式：`2026-01-21 (三) · BRT`
- 快捷按鈕：**今天 | 昨天 | 7天 | 30天 | 自訂**
- 左右箭頭 ← → 切換前/後一期（日模式切一天，週模式切一週...）

### 時間粒度切換
- **日 | 週 | 月 | 年**
- 切換粒度時，圖表類型和 Y 軸單位同步變化

### 資產識別
- 頂部顯示：Gateway 名稱 → Asset 名稱（型號）
- 例：`Casa Ribeiro · Residencial 5kW → GoodWe GW5000-ES+ (INVERTER_BATTERY)`

---

## P3-1：能量流（Energy Flow）

### 摘要卡片（選定期間內的統計）

| 卡片 | 公式 | 單位 |
|------|------|------|
| PV 總發電 | `MAX(pv_daily_energy_kwh)` per day, then SUM | kWh |
| 總消費 | `SUM(load_power) / 12` | kWh |
| 電網進口 | `SUM(grid_import_kwh)` | kWh |
| 電網出口 | `SUM(grid_export_kwh)` | kWh |
| 自消費率 | `(PV發電 - 電網出口) / PV發電 × 100` | % |
| 自給率 | `(總消費 - 電網進口) / 總消費 × 100` | % |
| 日峰值需量 | `MAX(load_power)` in period | kW |
| 節省金額 | (假設帳單 - 實際帳單), 見下方公式 | R$ |

**節省金額計算：**
```
假設帳單 = SUM(load_power / 12) × 對應時段電價  (JOIN tariff_schedules by hour)
實際帳單 = SUM(grid_import_kwh) × 進口電價 - SUM(grid_export_kwh) × 出口電價
節省 = 假設帳單 - 實際帳單
```

電價時段（tariff_schedules, Enel SP）：
- Off-peak 00:00-17:00: R$0.55/kWh import, R$0.25/kWh export
- Intermediate 17:00-18:00: R$0.72/kWh import
- Peak 18:00-21:00: R$0.95/kWh import
- Off-peak 21:00-24:00: R$0.55/kWh import

### 主圖表

#### 日視圖（24h 折線圖）
- X 軸：00:00 → 23:55，5 分鐘間隔，共 288 個點
- Y 軸左：功率 (kW)
- Y 軸右：SOC (%)
- 折線：
  - 🟡 `pv_power` — 光伏發電
  - 🔵 `load_power` — 負載消費  
  - 🟢 `battery_power` — 電池（正=充電，負=放電）
  - 🔴 `grid_power_kw` — 電網（正=進口，負=出口）
  - ⚪ `battery_soc` — SOC（右軸，虛線）
- 數據源：`SELECT recorded_at, pv_power, load_power, battery_power, grid_power_kw, battery_soc FROM telemetry_history WHERE asset_id = $1 AND recorded_at >= $2 AND recorded_at < $3 ORDER BY recorded_at`

#### 週視圖（7 天堆疊長條圖）
- X 軸：Mon → Sun（7 根 bar）
- Y 軸：能量 (kWh)
- 每根 bar 堆疊：
  - 🟡 PV 自用 = PV 發電 - 電網出口
  - 🟢 電池淨放電 = daily_discharge - daily_charge（若為正）
  - 🔴 電網進口 = grid_import_kwh
- 疊加折線：PV 總發電量（讓人看到自用比例）
- 數據源：
```sql
SELECT date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
       MAX(pv_daily_energy_kwh) AS pv_total,
       SUM(grid_import_kwh) AS grid_import,
       SUM(grid_export_kwh) AS grid_export,
       MAX(daily_charge_kwh) AS charge,
       MAX(daily_discharge_kwh) AS discharge,
       SUM(load_power) / 12 AS load_total
FROM telemetry_history
WHERE asset_id = $1 AND recorded_at >= $2 AND recorded_at < $3
GROUP BY day ORDER BY day
```

#### 月視圖（30 天堆疊長條圖）
- 同週視圖邏輯，X 軸改為 1-30/31

#### 年視圖（12 個月堆疊長條圖）
- 同上，GROUP BY `date_trunc('month', ...)`
- 注意：目前只有 3 個月數據（Dec 2025 - Mar 2026），其餘月份空白

---

## P3-2：設備健康（Equipment Health）

### 摘要卡片

| 卡片 | 公式 | 單位 |
|------|------|------|
| 當前 SOC | 最新一筆 `battery_soc` | % |
| 當前 SOH | 最新一筆 `battery_soh` | % |
| 電池溫度 | 最新一筆 `battery_temperature` | °C |
| 逆變器溫度 | 最新一筆 `inverter_temp` | °C |
| 電池循環數（選定期間） | `SUM(daily_discharge_kwh)` / `capacity_kwh` (from assets) | 次 |
| 電池工作狀態 | 最新一筆 `bat_work_status` | charging/discharging/standby |

### 圖表

#### 電池 SOC 歷史（折線）
- 日視圖：5 分鐘分辨率，0-100%
- 週/月視圖：每小時 AVG(battery_soc)
- 數據源：`SELECT recorded_at, battery_soc FROM telemetry_history WHERE ...`

#### SOH 趨勢（折線）
- 月/年視圖：每日一個點，觀察退化趨勢
- 數據源：`SELECT date_trunc('day', recorded_at) AS day, AVG(battery_soh) FROM ... GROUP BY day`

#### 電池溫度 + 逆變器溫度（雙折線）
- 日視圖：5 分鐘分辨率
- 疊加環境溫度參考線（如果有的話，目前沒有，留 placeholder）

#### 電壓/電流（折線）
- `battery_voltage` + `battery_current` 日視圖
- 可觀察 CC/CV 充電模式

#### DO 事件紀錄（僅 GW-3，表格）
- 列出所有 `do0_active = true` 的時段
- 顯示：開始時間、結束時間、持續分鐘數
- 數據源：用 window function 找 do0_active 從 false→true→false 的區間
```sql
WITH changes AS (
  SELECT recorded_at, do0_active,
         LAG(do0_active) OVER (ORDER BY recorded_at) AS prev
  FROM telemetry_history
  WHERE asset_id = $1 AND recorded_at >= $2 AND recorded_at < $3
)
SELECT recorded_at AS event_start
FROM changes
WHERE do0_active = true AND (prev = false OR prev IS NULL)
```

---

## API 端點設計

### `GET /api/assets/:assetId/telemetry`
```
Query params:
  from: ISO datetime (required)
  to: ISO datetime (required)
  resolution: '5min' | 'hour' | 'day' | 'month' (default: '5min')

Response:
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
      }, ...
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

resolution 對應邏輯：
- `5min`: 原始數據，直接 SELECT
- `hour`: `date_trunc('hour', ...)` + AVG for power, SUM for energy
- `day`: `date_trunc('day', ...)` + MAX for daily totals, SUM for grid
- `month`: `date_trunc('month', ...)` + SUM

### `GET /api/assets/:assetId/health`
```
Query params:
  from: ISO datetime (required)
  to: ISO datetime (required)

Response:
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
    "socHistory": [ { "t": "...", "soc": 50.0 }, ... ],
    "sohTrend": [ { "day": "2025-12-13", "soh": 98.5 }, ... ],
    "tempHistory": [ { "t": "...", "batTemp": 30, "invTemp": 40 }, ... ],
    "batteryCycles": 45.2,
    "doEvents": [
      { "start": "2026-01-15T18:10-03:00", "end": "2026-01-15T20:25-03:00", "durationMin": 135 }
    ]
  }
}
```

---

## 不做的（明確排除）

- ❌ 即時數據流（SSE/WebSocket）— 目前是歷史回看，不是 real-time monitoring
- ❌ 多 asset 疊加比較 — V1 只看單一 asset
- ❌ PDF 報表匯出 — 留後續版本
- ❌ 預測/預報 — 沒有模型，不做
- ❌ 自訂圖表 — 固定佈局，不可拖拉

---

## 前端技術

- ECharts（已引入）
- 日期選擇器：原生 `<input type="date">` + 自訂快捷按鈕（不引入新套件）
- 頁面結構：`p3-energy.js` + `p3-health.js`，掛在 `index.html#asset-energy` 和 `#asset-health`

---

## 實施順序

1. **API first**：實作 `/api/assets/:assetId/telemetry` + `/api/assets/:assetId/health`
2. **P3-1 能量流**：日期選擇器 + 日視圖折線圖（先做最核心的）
3. **P3-1 週/月/年**：加粒度切換 + 堆疊長條
4. **P3-1 摘要卡片**：自消費率、節省金額等
5. **P3-2 設備健康**：SOC/SOH/溫度圖表 + DO 事件表
6. **P1/P2 連動**：P1 加日期顯示，P2 gateway 卡片加 sparkline
