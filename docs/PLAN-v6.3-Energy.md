# PLAN-v6.3-Energy

**Version:** 6.3
**Date:** 2026-03-20
**REQ:** REQ-v6.3-Energy.md
**DESIGN:** DESIGN-v6.3-Energy.md
**REVIEW:** REVIEW-v6.3-Energy.md
**Status:** Draft — rewritten post-review, targeting current frontend-v2 vanilla JS stack

---

## 1. 任務拆解

### Phase 1：BFF 端點準備

#### T1: BFF -- get-gateway-energy.ts 改造（24h 端點）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-gateway-energy.ts`（現有） |
| **改動** | (1) 15 分鐘粒度 -> 5 分鐘粒度（288 點）；(2) 增加 `summary` 區段（方向分拆總量）；(3) 回傳結構改為 DESIGN ss5.1 定義的 `GatewayEnergy24hResponse` |
| **預計行數** | ~120 行（取代現有 ~90 行） |
| **前置** | 無 |
| **可並行** | 與 T2 並行 |

**詳細步驟：**

1. **修改 SQL 聚合粒度：**
   - 現有使用 `date_trunc('hour', ...) + (EXTRACT(MINUTE ...) / 15) * 15 min` 聚合為 15 分鐘桶
   - 改為 `date_trunc('hour', ...) + (EXTRACT(MINUTE ...) / 5) * 5 min` 聚合為 5 分鐘桶
   - 結果從 96 行變為 288 行

2. **修改回傳格式：**
   - 現有回傳 `buckets: number[][]`（positional array）
   - 改為 `points: Array<{ ts, pv, load, battery, grid, soc }>`（named fields，語義清晰）

3. **增加 summary 計算：**
   ```typescript
   // 在應用層遍歷 points 計算方向分拆：
   const summary = points.reduce((acc, p) => ({
     batteryChargeKwh:    acc.batteryChargeKwh    + (p.battery < 0 ? Math.abs(p.battery) * 5/60 : 0),
     batteryDischargeKwh: acc.batteryDischargeKwh + (p.battery > 0 ? p.battery * 5/60 : 0),
     gridImportKwh:       acc.gridImportKwh       + (p.grid > 0 ? p.grid * 5/60 : 0),
     gridExportKwh:       acc.gridExportKwh       + (p.grid < 0 ? Math.abs(p.grid) * 5/60 : 0),
   }), { batteryChargeKwh: 0, batteryDischargeKwh: 0, gridImportKwh: 0, gridExportKwh: 0 });
   ```

4. **保持現有 auth / org 過濾邏輯不變**

5. **不需要向後相容 shim**（REVIEW L2：現有路由未註冊，為死代碼）

---

#### T2: BFF -- get-gateway-energy-stats.ts 新建（統計端點）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-gateway-energy-stats.ts`（**新建**） |
| **改動** | 新 handler：接受 `window` + `endDate` 參數，回傳按日/月聚合的能量統計 |
| **預計行數** | ~150 行 |
| **前置** | 無 |
| **可並行** | 與 T1 並行 |

**詳細步驟：**

1. **Request 參數解析：**
   ```typescript
   const { gatewayId } = event.pathParameters;
   const { window, endDate } = event.queryStringParameters;
   // window: '7d' | '30d' | '12m'
   // endDate: 'YYYY-MM-DD' (7d/30d) or 'YYYY-MM' (12m)
   ```

2. **計算時間範圍：**
   ```typescript
   // 7d: endDate - 6 days -> endDate (inclusive)
   // 30d: endDate - 29 days -> endDate (inclusive)
   // 12m: endMonth - 11 months -> endMonth (inclusive, full month)
   ```

3. **SQL 查詢（7d/30d）：**
   - 優先查詢 `asset_5min_metrics` 表（已有 pre-computed 方向分拆欄位）
   - GROUP BY `DATE(window_start AT TIME ZONE 'America/Sao_Paulo')`
   - 回傳每日 6 項能量指標

4. **SQL 查詢（12m）：**
   - 同上，GROUP BY `DATE_TRUNC('month', window_start AT TIME ZONE 'America/Sao_Paulo')`

5. **Totals 計算（含 REVIEW M2 + M3 修復）：**
   - pvGenerationKwh / loadConsumptionKwh / gridImportKwh / gridExportKwh / batteryChargeKwh / batteryDischargeKwh 由 SUM(buckets) 得出
   - selfConsumptionPct = `Math.max(0, Math.min(100, Math.round((pvGen - gridExport) / pvGen * 100)))`，pvGen = 0 時回傳 0 **（REVIEW M3 修復：CLAMP 0-100）**
   - selfSufficiencyPct = `Math.max(0, Math.min(100, Math.round((load - gridImport) / load * 100)))`，load = 0 時回傳 0 **（REVIEW M3 修復：CLAMP 0-100）**
   - peakDemandKw：**必須**用額外子查詢 `MAX(load_power) FROM telemetry_history` **（REVIEW M2 修復：不用 kWh 近似）**

6. **Fallback 策略：**
   - 若 `asset_5min_metrics` 無數據，fallback 到 `telemetry_history` 直接聚合（見 DESIGN ss5.2 SQL）
   - Peak demand **始終**從 `telemetry_history` 查詢，不受 fallback 影響

7. **Auth / org 過濾：** 複用 `queryWithOrg` pattern

---

#### T3: BFF -- bff-stack.ts 路由註冊

| 項目 | 內容 |
|------|------|
| **文件** | `backend/lib/bff-stack.ts` |
| **改動** | 註冊 2 條 Energy routes |
| **預計行數** | +10 行 |
| **前置** | T1, T2（handler 就緒） |
| **可並行** | 否（依賴 T1 + T2） |

**詳細步驟：**
1. 在現有 gateway routes 區塊後新增：
   ```typescript
   this.addRoute(httpApi, "GET", "/api/gateways/{gatewayId}/energy-24h", getGatewayEnergy24h);
   this.addRoute(httpApi, "GET", "/api/gateways/{gatewayId}/energy-stats", getGatewayEnergyStats);
   ```
2. 確保 auth middleware 與 org 過濾一致

**注意：** `get-gateway-energy.ts` 現有 handler 已存在但路由未註冊（為死代碼）。T3 同時解決此阻塞問題。若 handler 入口函數名稱需調整以匹配新路由，在 T1 中一併處理。

---

### Phase 2：前端 -- Gateway Locator + DataSource

#### T4: Frontend -- p3-energy.js 左側 Gateway locator（主對象定位器）

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p3-energy.js`（現有，將重寫） |
| **改動** | 在 Energy 頁面內建立與 Devices 頁同模式的左側 Gateway locator，作為 v6.3 的主要對象定位器 |
| **預計行數** | ~120-180 行（包含搜索、列表、active state、點擊切換） |
| **前置** | T5（可先以 DataSource.gateways() 取數） |
| **可並行** | 與 BFF 任務並行 |

**詳細步驟：**
1. 復用 Devices locator 的交互模式：search input、count、locator list、active item、status badge
2. Energy 頁面自己調 `DataSource.gateways()` 取得 gateway 列表
3. 預設選中優先級：
   - `#energy?gw=...`
   - `DemoStore.selectedGatewayId`
   - 第一個可用 gateway
4. 點擊 locator item 時，更新：
   - `EnergyPage._state.gatewayId/gatewayName`
   - `DemoStore`（僅作最近選中記憶）
   - URL hash/query（如設計需要）
   - 右側主內容重新抓數並重渲染
5. 這是 v6.3 的**主要**Gateway 選擇機制；DemoStore 只是預設記憶，不是主機制

---

#### T5: Frontend -- data-source.js 新增 Energy API 方法

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/data-source.js`（現有 517 行） |
| **改動** | 替換現有 `energy` 區段的 `gatewayEnergy` 方法，新增 `gateway24h` + `gatewayStats` 方法 |
| **預計行數** | ~+15 行（淨增，替換部分現有方法） |
| **前置** | 無（可用 mock 先行） |
| **可並行** | 與 T4 並行 |

**詳細步驟：**
1. 在 `data-source.js` 的 `energy` 區段（約 line 285-315），替換 / 新增：
   ```javascript
   gateway24h: function (gatewayId, date) {
     var qs = date ? '?date=' + date : '';
     return withFallback(
       function () { return apiGet('/api/gateways/' + gatewayId + '/energy-24h' + qs); },
       function () { return typeof MOCK_ENERGY_24H !== 'undefined' ? MOCK_ENERGY_24H : { points: [], summary: {} }; }
     );
   },
   gatewayStats: function (gatewayId, window, endDate) {
     var qs = '?window=' + window + '&endDate=' + endDate;
     return withFallback(
       function () { return apiGet('/api/gateways/' + gatewayId + '/energy-stats' + qs); },
       function () { return typeof MOCK_ENERGY_STATS !== 'undefined' ? MOCK_ENERGY_STATS : { buckets: [], totals: {} }; }
     );
   },
   ```
2. 保留現有 `gatewayEnergy`、`summary`、`baCompare` 方法供其他頁面使用（如 asset-energy submodule）
3. 遵循現有 `withFallback(apiCall, mockData)` dual-source pattern

---

### Phase 3：前端 -- Energy 頁面模組重寫

#### T6: Frontend -- p3-energy.js 替換重寫

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p3-energy.js`（現有 257 行，**完全替換**） |
| **改動** | 將 asset-first Gateway-selector + AssetEnergy/AssetHealth tab 架構，替換為 Gateway-first 能量頁面（DESIGN ss7 module pattern） |
| **預計行數** | ~600-700 行 |
| **前置** | T4（DemoStore 寫入）, T5（DataSource API） |
| **可並行** | 否（核心交互頁面） |

**詳細步驟：**

**6a. 頁面骨架與生命週期**
1. 定義 `var EnergyPage = { _state: { ... }, init: async function() { ... }, ... }`
2. `init()` 邏輯：
   - 解析 hash params（複用現有 `_parseHashParams()` pattern）
   - 先載入 gateway 列表並渲染左側 locator
   - 選中優先級：hash param -> `DemoStore.get('selectedGatewayId')` -> 第一個可用 gateway
   - 無可用 Gateway 列表 → 渲染 locator 空態
   - 有 Gateway → 設定默認 timeWindow='24h'、dateAnchor=今天，調用 `_fetchData()`
3. `onRoleChange()` → `Charts.disposePageCharts('energy'); this.init();`
4. `dispose()` → `_stopAutoRefresh(); Charts.disposePageCharts('energy');`

**6b. 頂部控制區（_buildTopControls）**
1. Gateway 名稱唯讀顯示（從 `_state.gatewayName`）
2. 4 個 toggle button：`[24h] [7d] [30d] [12m]`，使用 CSS class `.energy-window-btn.active`
3. 條件渲染日期控件：
   - 24h / 7d / 30d：`<input type="date" max="YYYY-MM-DD">`（max = 今天）
   - 12m：`<input type="month" max="YYYY-MM">`（max = 本月）
4. Refresh 按鈕
5. 事件監聽：window toggle → `_onWindowChange()`，date input → `_onDateChange()`

**6c. 窗口切換邏輯（_onWindowChange）**
1. 按 DESIGN ss8.1 規則轉換日期錨點
2. **12m -> 24h/7d/30d 必須 clamp 到今天**（REVIEW M1 修復）：
   ```javascript
   var lastDay = new Date(endYear, endMonth, 0);
   var today = new Date(); today.setHours(0,0,0,0);
   var clampedDate = lastDay > today ? today : lastDay;
   ```
3. 更新 `_state.timeWindow` 和 `_state.dateAnchor`
4. 重新渲染日期控件（類型可能變化）
5. 調用 `_fetchData()`

**6d. 24h 行為層（_build24hView + _init24hChart）**
1. 構建 HTML：chart 容器 `<div id="energy-24h-chart">` + directional summary cards + SoC 區域
2. `_init24hChart(data)` 構建 ECharts dual-grid option（DESIGN ss3.2）：
   - grid[0]: 主行為圖，4 條 line series（PV/Load/Battery/Grid）
   - grid[1]: SoC 面積圖
   - `left: 60, right: 30` 固定像素確保對齊
   - `axisPointer.link: [{ xAxisIndex: 'all' }]`
   - Y 軸 markLine at value=0（零線）
   - tooltip formatter：Battery/Grid 附加方向文字
3. 通過 `Charts.createChart('energy-24h-chart', option, { pageId: 'energy' })` 創建
4. SoC 全為 null → 不渲染 grid[1]，顯示「無電池數據」

**6e. 統計層（_buildStatsView + _initStatsChart）**
1. 構建 HTML：chart 容器 `<div id="energy-stats-chart">` + SoC 說明區塊 + metrics hierarchy
2. `_initStatsChart(data)` 構建 grouped bar option（DESIGN ss4.1）：
   - 4 個 bar series：PV / Load / Grid Import / Grid Export
   - tooltip 顯示完整 6 項（含 Battery）
   - 30d 模式 xAxis.axisLabel.interval 每 5 天
3. 通過 `Charts.createChart('energy-stats-chart', option, { pageId: 'energy' })` 創建
4. `_buildMetricsHierarchy(totals)` 渲染三級指標卡片

**6f. 方向總量摘要（_buildDirectionalSummary）**
1. 4 張 `.stat-card`：Battery Charge / Battery Discharge / Grid Import / Grid Export
2. 24h 數據來自 `response.summary`，stats 數據來自 `response.totals`
3. 數值格式：1 位小數 + kWh 單位

**6g. 自動刷新（_startAutoRefresh / _stopAutoRefresh）**
1. `var REFRESH_INTERVAL_MS = 60000;`（JS 常量，非環境變數）
2. 僅在 timeWindow === '24h' 且 dateAnchor === 今天 時啟動
3. 使用 `document.visibilityState` 檢查：頁面不可見時不發請求
4. 窗口切換 / 日期變更 / 離開頁面 → `_stopAutoRefresh()`

**6h. 空態處理**
1. 無 Gateway 選中 → 「請先在 Devices 頁面選擇一個 Gateway」+ 提供跳轉到 Devices 的按鈕
2. Gateway 無數據 → 「該 Gateway 尚無能量數據」

---

#### T7: Frontend -- pages.css 新增 Energy 樣式

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/css/pages.css`（現有） |
| **改動** | 新增 `.energy-*` 命名空間的樣式 |
| **預計行數** | ~80 行 |
| **前置** | T6（知道需要什麼 CSS class） |
| **可並行** | 與 T6 並行開發 |

**佈局約束（DESIGN 2.3.1，參考 Mock 居中佈局）：**
- `.energy-layout` 使用 `max-width` + `margin: 0 auto` 居中，不貼左不貼右
- `.energy-locator` 寬度 280px
- `.energy-workbench` 使用 `flex: 1` 撐滿剩餘寬度
- 主功率圖最小高度 480px，SoC 圖最小高度 180px
- 頁面無底部大片空白

**驗收條件（修訂）：**
- [ ] Energy 頁面內容視覺居中，與 Mock 效果一致
- [ ] 圖表使用 Mock 配色（PV=#f6c445, Load=#60a5fa, Battery=#34d399, Grid=#f87171, SoC=#a78bfa）
- [ ] Battery/Grid 有半透明面積填充，零軸有虛線
- [ ] SoC 圖高度足夠（≥180px），不被壓成一條線
- [ ] 統計卡有顏色編碼和卡片背景
- [ ] 底部無大片空白

**需要的 CSS class：**
- `.energy-top-controls` — 頂部控制區 flex 佈局
- `.energy-window-btn` / `.energy-window-btn.active` — 時間窗口 toggle 按鈕
- `.energy-date-input` — 日期控件樣式
- `.energy-chart-container` — 圖表容器（min-height 確保 ECharts 可渲染）
- `.energy-dir-cards` — 方向總量摘要 4 卡片 flex 容器
- `.energy-soc-info` — SoC 說明區塊（灰底 + info icon）
- `.energy-metric-primary` / `.energy-metric-secondary` / `.energy-metric-supporting` — 三級指標卡片
- `.energy-empty-state` — 空態引導
- `.energy-gw-label` — Gateway 名稱唯讀顯示

---

### Phase 4：測試

#### T8: 後端測試 -- energy-24h handler

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/bff/energy-v6.3-24h.test.ts`（**新建**） |
| **預計行數** | ~200 行 |
| **前置** | T1 |
| **可並行** | 與 T9 並行 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 1 | 回傳 288 個 5 分鐘點（完整 24h） | Unit |
| 2 | 每個點包含 ts / pv / load / battery / grid / soc 欄位 | Unit |
| 3 | Battery 正值 = 放電，負值 = 充電（符號正確性） | Unit |
| 4 | Grid 正值 = 進口，負值 = 出口（符號正確性） | Unit |
| 5 | summary.batteryChargeKwh = sum of charging intervals | Unit |
| 6 | summary.gridExportKwh = sum of export intervals | Unit |
| 7 | 無數據日期 -> 回傳空 points + summary 全 0 | Unit |
| 8 | 非 admin 角色 org 過濾正確 | Unit |

---

#### T9: 後端測試 -- energy-stats handler

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/bff/energy-v6.3-stats.test.ts`（**新建**） |
| **預計行數** | ~250 行 |
| **前置** | T2 |
| **可並行** | 與 T8 並行 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 9 | 7d 窗口回傳 7 個日 bucket | Unit |
| 10 | 30d 窗口回傳 30 個日 bucket | Unit |
| 11 | 12m 窗口回傳 12 個月 bucket | Unit |
| 12 | 每個 bucket 含 pvKwh / loadKwh / gridImportKwh / gridExportKwh / batteryChargeKwh / batteryDischargeKwh | Unit |
| 13 | totals.selfConsumptionPct 計算正確（pvGen > 0）且 CLAMP 0-100 | Unit |
| 14 | totals.selfConsumptionPct = 0 when pvGen = 0 | Unit |
| 15 | totals.selfConsumptionPct clamp to 100 when battery-to-grid exceeds PV | Unit |
| 16 | totals.selfSufficiencyPct 計算正確（load > 0）且 CLAMP 0-100 | Unit |
| 17 | totals.peakDemandKw = MAX(load_power) from telemetry_history（非 kWh 近似） | Unit |
| 18 | 無數據範圍 -> 空 buckets + totals 全 0 | Unit |
| 19 | 12m 跨年正確（2025-04 to 2026-03） | Unit |
| 20 | 非 admin 角色 org 過濾正確 | Unit |
| 21 | 非法 window 參數 -> 400 | Unit |

---

#### T10: 前端 E2E 測試 -- Energy 頁面

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/test/e2e/energy-page.test.js`（**新建**） |
| **預計行數** | ~250 行 |
| **前置** | T6（頁面完成） |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 22 | 無 Gateway 選中（DemoStore 為空）-> 顯示空態引導 | E2E |
| 23 | DemoStore 有 selectedGatewayId -> 默認載入 24h 今日視圖 | E2E |
| 24 | hash param `#energy?gw=xxx` 覆蓋 DemoStore | E2E |
| 25 | 24h 主圖顯示 4 條 series（PV/Load/Battery/Grid） | E2E |
| 26 | 24h 主圖零線可見 | E2E |
| 27 | SoC 輔助圖僅在 24h 模式下顯示 | E2E |
| 28 | SoC 與主圖 X 軸視覺對齊 | E2E |
| 29 | 方向總量摘要顯示 4 張卡片 | E2E |
| 30 | 切換到 7d -> 主圖變為柱狀圖 | E2E |
| 31 | 7d/30d/12m 模式不顯示 SoC 圖 | E2E |
| 32 | 7d/30d/12m 模式顯示 SoC 說明文字 | E2E |
| 33 | 統計指標按 Primary / Secondary / Supporting 三級呈現 | E2E |
| 34 | 24h 日期選擇器不允許選擇未來 | E2E |
| 35 | 12m 使用月份選擇器 | E2E |
| 36 | 頂部不出現 Gateway 選擇器（只有唯讀名稱顯示） | E2E |
| 37 | 不顯示任何經濟性指標（savings / cost / revenue） | E2E |

---

## 2. 執行順序圖

```
                    Phase 1: BFF 端點準備
                    ----------------------

Timeline:   Day 1        Day 2
            |            |
    T1 BFF  [============]       (改造 24h handler)
    T2 BFF  [============]       (新建 stats handler；與 T1 並行)
    T3 Route              [====] (依賴 T1 + T2)

                    Phase 2: 前端 Gateway Context + DataSource
                    ------------------------------------------

Timeline:   Day 1        Day 2
            |            |
    T4 P2   [====]                (p3-energy.js 左側 Gateway locator)
    T5 DS   [====]                (data-source.js API 方法；與 T4 並行)

                    Phase 3: 前端 Energy 頁面重寫
                    -----------------------------

Timeline:   Day 2        Day 3        Day 4        Day 5
            |            |            |            |
    T6 FE   [====================================]  (p3-energy.js 完整重寫)
    T7 CSS  [============]                          (pages.css；與 T6 並行迭代)

                    Phase 4: 測試
                    -------------

Timeline:   Day 2        Day 5        Day 6
            |            |            |
    T8 BE   [============]                   (24h tests；依賴 T1)
    T9 BE   [============]                   (stats tests；與 T8 並行)
    T10 E2E                    [============] (E2E tests；依賴 T6)
```

### 並行分組

| 分組 | 任務 | 並行策略 |
|------|------|---------|
| **Batch A（Day 1-2）** | T1 + T2 | 兩個 handler 完全獨立，可並行 |
| **Batch B（Day 1）** | T4 + T5 | p2-devices DemoStore 寫入 + data-source API 方法，獨立且微量 |
| **Batch C（Day 2）** | T3 | 串行：依賴 Batch A 完成 |
| **Batch D（Day 2-5）** | T6 + T7 | p3-energy.js 重寫 + CSS 並行迭代 |
| **Batch E（Day 2-5）** | T8 + T9 | 後端測試可提前，與 Batch D 並行 |
| **Batch F（Day 5-6）** | T10 | E2E 測試依賴 T6 完成 |

---

## 3. 驗證計畫

### 語義正確性驗證（最高優先級）

| # | 驗證項 | 方法 | 說明 |
|---|--------|------|------|
| V1 | 24h 主圖只有 4 條 series（PV/Load/Battery/Grid） | 目視確認圖例 | REQ ss24h: 不拆為 6 條 |
| V2 | Battery 正值 = 放電，負值 = 充電 | hover tooltip 確認方向標注 | REQ ss固定符號語義 |
| V3 | Grid 正值 = 進口，負值 = 出口 | hover tooltip 確認方向標注 | REQ ss固定符號語義 |
| V4 | 零線清晰可見 | 目視確認 | REQ ss視覺要求 |
| V5 | SoC 僅在 24h 出現 | 切換到 7d -> 確認 SoC 圖消失 | REQ ssSoC scope rule |
| V6 | SoC 與主圖 X 軸像素對齊 | 目視比對同一時刻的垂直位置 | Alan 硬性要求 |
| V7 | 7d/30d/12m 不複用 24h 行為圖語義 | 確認長窗口為柱狀圖 | REQ ss統計層 |
| V8 | 不顯示經濟性指標 | 搜索頁面中 savings / cost / revenue 文字 = 0 | REQ ss顯式排除 |
| V9 | Gateway context 繼承自 DemoStore，頂部無 Gateway selector | 目視確認頂部控制區 | REQ ss上下文繼承規則 |

### 數據正確性驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V10 | 24h API 回傳 288 個 5 分鐘點 | 手動呼叫 API 確認 response.data.points.length |
| V11 | summary 方向分拆與 points 數據一致 | 手動計算 sum 比對 |
| V12 | 7d API 回傳 7 個 bucket | 手動呼叫 API 確認 |
| V13 | 12m API 回傳 12 個 bucket | 手動呼叫 API 確認 |
| V14 | selfConsumptionPct 正確且 CLAMP 0-100 | 手動計算 + 邊界 case 驗證 |
| V15 | selfSufficiencyPct 正確且 CLAMP 0-100 | 手動計算 + 邊界 case 驗證 |
| V16 | peakDemandKw = 窗口內最大 load_power（from telemetry_history） | 手動 SQL 比對 |

### 交互驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V17 | 24h -> 7d 窗口切換：結束日期 = 原 24h 日期 | 操作確認日期控件值 |
| V18 | 12m -> 24h 窗口切換：24h 日期 = min(結束月份最後一天, 今天) | 操作確認（M1 修復） |
| V19 | 24h 今日視圖自動刷新（60s） | 觀察 network tab 確認 periodic request |
| V20 | 24h 非今日不自動刷新 | 選擇歷史日期，觀察無 periodic request |
| V21 | 日期控件不允許選擇未來 | 嘗試選擇明天 -> 確認被阻止 |
| V22 | DemoStore gateway context 正確傳遞 | 在 Devices 選 Gateway -> 切到 Energy -> 確認同一 Gateway 載入 |

### 回歸驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V23 | Devices 頁面功能不受影響 | 確認 Devices 頁面三段式工作台正常 |
| V24 | Fleet 頁面功能不受影響 | 確認 Fleet dashboard 正常 |
| V25 | 現有 gateway detail / schedule API 不受影響 | 呼叫確認回傳不變 |

---

## 4. 回歸風險

| # | 風險 | 嚴重度 | 概率 | 降級方案 |
|---|------|--------|------|---------|
| R1 | **get-gateway-energy.ts 改造破壞現有消費者** | 低 | 低 | 現有路由未註冊（死代碼），僅 mock 模式使用。直接替換，無需向後相容。 |
| R2 | **24h 5 分鐘粒度 -> 288 點查詢效能** | 中 | 低 | telemetry_history 已按月分區且有 asset_id + recorded_at 索引；單 Gateway 單日查詢量有限 |
| R3 | **12m 統計查詢效能（跨 12 個月分區）** | 中 | 中 | 優先使用 asset_5min_metrics pre-computed 表；必要時增加 materialized view |
| R4 | **ECharts 雙 grid 對齊在特定寬度下可能偏移** | 中 | 低 | 確保兩個 grid 的 left/right 以固定像素值設定（DESIGN ss3.2），不使用百分比 |
| R5 | **p2-devices.js DemoStore 寫入可能影響 Devices 頁面行為** | 低 | 低 | 僅增加 2 行 DemoStore.set()，不改變任何現有邏輯。DemoStore 為 append-only，不影響 Devices 頁面內部狀態。 |
| R6 | **自動刷新在大量 tab 開啟時造成不必要負載** | 低 | 低 | 使用 `document.visibilityState` 判斷：頁面不可見時暫停刷新 |
| R7 | **p3-energy.js 完全替換可能遺漏現有 selectGateway() 外部調用** | 中 | 低 | 現有 `EnergyPage.selectGateway(gatewayId, tab)` 可能被其他模組調用（如 Devices 頁面的跳轉連結）。v6.3 重寫後保留此公開方法，語義為寫入 DemoStore + 重新 init。 |

### R3 效能降級方案

如果 12m 查詢超過 500ms：

**方案 A（優先）：** 始終從 `asset_5min_metrics` 查詢，此表已有按 `asset_id + window_start` 的索引，月聚合效率遠高於原始 `telemetry_history`。

**方案 B：** 建立月粒度的 materialized view（`energy_monthly_summary`），每日凌晨刷新。

---

## 5. 上線檢查清單

### Pre-Deploy

- [ ] T1: energy-24h handler 改造完成，回傳 288 點 + summary
- [ ] T2: energy-stats handler 新建完成，支持 7d/30d/12m，含 CLAMP + MAX(load_power) peak demand
- [ ] T3: 兩條路由在 bff-stack.ts 中註冊
- [ ] T8/T9: 後端測試通過，覆蓋率 >= 80%
- [ ] T4: p2-devices.js DemoStore 寫入已添加
- [ ] T6: p3-energy.js 完整替換重寫
- [ ] T7: pages.css 能量頁面樣式就緒
- [ ] T10: E2E 測試通過（V1-V22）
- [ ] 回歸驗證通過（V23-V25）

### Deploy

- [ ] 部署 BFF（T1-T3 改動）
- [ ] 部署 Frontend（T4-T7 改動：p2-devices.js 微改 + p3-energy.js 替換 + data-source.js 擴展 + pages.css 新增）
- [ ] 無 DDL 變更（v6.3 不涉及 schema 改動）

### Post-Deploy

- [ ] 確認 Energy 頁面默認 24h 模式
- [ ] 確認主圖 4 條 series 正確（PV/Load/Battery/Grid）
- [ ] 確認零線可見
- [ ] 確認 Battery/Grid tooltip 方向標注正確
- [ ] 確認 SoC 僅在 24h 出現且與主圖對齊
- [ ] 確認 7d/30d/12m 為柱狀統計圖
- [ ] 確認不顯示經濟性指標
- [ ] 確認頂部無 Gateway 選擇器（只有唯讀名稱）
- [ ] 確認 24h 今日自動刷新
- [ ] 確認 12m -> 24h 切換日期不超過今天
- [ ] 確認 Devices / Fleet 頁面不受影響

### Rollback

回滾策略（如需）：
1. Frontend：還原 p3-energy.js + p2-devices.js + data-source.js + pages.css（git revert）
2. BFF handler：還原 get-gateway-energy.ts + 移除 get-gateway-energy-stats.ts（git revert）
3. Routes：還原 bff-stack.ts（git revert）
4. 無 DDL 回滾（v6.3 無 schema 改動）

---

## 6. 文件清單總覽

| # | 文件 | 動作 | Phase | Task |
|---|------|------|-------|------|
| 1 | `backend/src/bff/handlers/get-gateway-energy.ts` | **改**（5 分鐘粒度 + summary） | P1 | T1 |
| 2 | `backend/src/bff/handlers/get-gateway-energy-stats.ts` | **新建** | P1 | T2 |
| 3 | `backend/lib/bff-stack.ts` | **改**（+2 routes） | P1 | T3 |
| 4 | `frontend-v2/js/p2-devices.js` | **改**（+2 行 DemoStore 寫入） | P2 | T4 |
| 5 | `frontend-v2/js/data-source.js` | **改**（+2 API 方法） | P2 | T5 |
| 6 | `frontend-v2/js/p3-energy.js` | **替換重寫** | P3 | T6 |
| 7 | `frontend-v2/css/pages.css` | **改**（+.energy-* 樣式） | P3 | T7 |
| 8 | `backend/test/bff/energy-v6.3-24h.test.ts` | **新建** | P4 | T8 |
| 9 | `backend/test/bff/energy-v6.3-stats.test.ts` | **新建** | P4 | T9 |
| 10 | `frontend-v2/test/e2e/energy-page.test.js` | **新建** | P4 | T10 |

**不動文件（已驗證可複用）：**

| 文件 | 理由 |
|------|------|
| `frontend-v2/index.html` | `p3-energy.js` 的 `<script>` 標籤已存在（line 137），`EnergyPage` 全局變量名不變 |
| `frontend-v2/js/app.js` | `initPage('energy')` 已調用 `EnergyPage.init()`，hash route `#energy` 不變，`Charts.activatePageCharts()` 已自動調用 |
| `frontend-v2/js/charts.js` | 使用現有 `Charts.createChart()` API，無需修改 |
| `frontend-v2/js/p3-asset-energy.js` | 不再被 Energy 頁面引用，保留供其他用途 |
| `frontend-v2/js/p3-asset-health.js` | 同上 |
| `db-init/02_schema.sql` | v6.3 不涉及 schema 改動；telemetry_history + asset_5min_metrics 已足夠 |
| `backend/src/bff/handlers/get-gateway-detail.ts` | Devices 頁面端點，不受影響 |
| `backend/src/bff/handlers/get-gateway-schedule.ts` | Devices 頁面端點，不受影響 |
| `backend/src/iot-hub/*` | IoT pipeline 不受影響 |

**新建文件：3 個（handler + 2 test files）** | **替換重寫文件：1 個** | **修改文件：4 個** | **不動文件：** 全部 DDL、IoT pipeline、Devices/Fleet handler、app.js、index.html、charts.js

---

## 7. REVIEW 修復追蹤

| REVIEW 項 | 嚴重度 | PLAN 修復位置 | 狀態 |
|-----------|--------|-------------|------|
| **C1** 前端架構（React -> vanilla JS） | Critical | 全部 frontend tasks (T4-T7) 改為真實文件路徑 | 已修復 |
| **M1** 12m->24h 日期 clamp | Medium | T6 step 6c | 已修復 |
| **M2** Peak demand = MAX(load_power) | Medium | T2 step 5 | 已修復 |
| **M3** Self-cons/suff CLAMP(0,100) | Medium | T2 step 5 | 已修復 |
| **M4** p3-energy.js 替換 | Medium | T6（完全替換重寫） | 已修復 |
| **M5** Gateway 選擇機制需自洽 | Medium | T4（Energy 自帶左側 locator；DemoStore 僅作預設記憶） | 已修復 |
| **M6** 5 分鐘粒度備註 | Medium | 見 DESIGN ss3.1 | 已處理 |
| **L1** 刷新間隔為 JS 常量 | Low | T6 step 6g | 已修復 |
| **L2** 移除向後相容 shim | Low | T1 step 5 | 已移除 |
| **L5** 測試文件擴展名正確 | Low | T8(.ts) T9(.ts) T10(.js) | 已確認 |
L2** 移除向後相容 shim | Low | T1 step 5 | 已移除 |
| **L5** 測試文件擴展名正確 | Low | T8(.ts) T9(.ts) T10(.js) | 已確認 |
 |
(.js) | 已確認 |
) | 已確認 |
已確認 |
(.js) | 已確認 |
 | 已確認 |
