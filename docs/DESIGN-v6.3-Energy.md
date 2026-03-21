# DESIGN-v6.3-Energy

**Version:** 6.3
**Date:** 2026-03-20
**REQ:** REQ-v6.3-Energy.md
**REVIEW:** REVIEW-v6.3-Energy.md
**Status:** Draft — rewritten post-review, targeting current frontend-v2 vanilla JS stack

---

## 1. 概述

v6.3 將 Energy 頁面重建為 **Gateway-first 時間序列與能量統計頁面**，與 Devices 頁面明確分離。

**核心語義轉換：**
- 頁面主語：Asset telemetry history → **Gateway 級能量行為與統計**
- 時間語義：單一圖表拉長 → **24h 行為層 vs 7d/30d/12m 統計層**二元模型
- SoC 定位：獨立趨勢圖 → **僅在 24h 模式下作為主圖輔助軸，視覺對齊**
- 方向表達：拆為多條獨立 series → **零線穿越單線 + 外部方向總量摘要**

**替換範圍（REVIEW M4 修復）：**
v6.3 **替換** 現有 `frontend-v2/js/p3-energy.js`（目前為 asset-first 的 Gateway 選擇器 + AssetEnergyPage/AssetHealthPage 子模組架構）。替換後，`#energy` hash route 在 `app.js` 中仍指向 `EnergyPage.init()`，但 EnergyPage 的內部實現完全改寫為 Gateway-first 能量頁面。現有 `p3-asset-energy.js` 和 `p3-asset-health.js` 不再被 Energy 頁面引用，可視需要保留供其他用途或後續移除。

**技術邊界（REVIEW C1 修復）：**
v6.3 使用 **current frontend-v2 vanilla JS stack**：
- `index.html` + hash router + `frontend-v2/js/*.js` page modules
- `DataSource` dual-source pattern（`data-source.js`）
- `Charts.createChart()` singleton pattern（`charts.js`）
- `DemoStore`（sessionStorage-backed cross-page state，`app.js`）
- ECharts 5.x via CDN
- **不使用** React / Vite / shadcn / Tailwind / TSX / hooks / Context
- 前端框架遷移為 **v7.0 議題**，不在 v6.3 範圍內

**一句話定義（引自 REQ）：**
> Devices 看現況，Energy 看時間序列與能量統計。

---

## 2. 信息架構

### 2.1 頁面結構（v6.3-R2 修訂）

```
┌────────────────────────────────────────────────────────────────────────┐
│ 全局導航（左側模組導航）                                                  │
│ Fleet / Devices / Energy / HEMS / VPP / Performance                    │
├──────────────────┬─────────────────────────────────────────────────────┤
│ Gateway locator   │ 右側內容區                                          │
│ (220-240px)       │                                                    │
│                   │  ┌─────────────────────────────────────────────┐   │
│ [search]          │  │ Gateway Context + Controls + [◀][Date][▶]   │   │
│ [gw-1 ●]          │  │ [24h][7d][30d][12m] + [Today]               │   │
│ [gw-2 ●]          │  ├─────────────────────────────────────────────┤   │
│ [gw-3 ○]          │  │ Headline Verdict (Self-sufficiency + badge) │   │
│                   │  ├─────────────────────────────────────────────┤   │
│                   │  │ Top Summary: PV | Load | Grid Imp | Grid Exp│   │
│                   │  ├─────────────────────────────────────────────┤   │
│                   │  │ Battery: Charged | Discharged | Net          │   │
│                   │  ├─────────────────────────────────────────────┤   │
│                   │  │                                             │   │
│                   │  │   24h 模式:                                  │   │
│                   │  │   ┌─────────────────────────────────┐       │   │
│                   │  │   │ 主行為圖（PV/Load/Battery/Grid） │       │   │
│                   │  │   │ 零線穿越 + tooltip 方向標注       │       │   │
│                   │  │   └─────────────────────────────────┘       │   │
│                   │  │   ┌─────────────────────────────────┐       │   │
│                   │  │   │ SoC 輔助圖（同 X 軸對齊）        │       │   │
│                   │  │   └─────────────────────────────────┘       │   │
│                   │  │   ┌───────────────────────────────────┐     │   │
│                   │  │   │ Behavior Interpretation            │     │   │
│                   │  │   │ PV Coverage / Battery Role /       │     │   │
│                   │  │   │ Grid Dependency / Energy Balance    │     │   │
│                   │  │   └───────────────────────────────────┘     │   │
│                   │  │                                             │   │
│                   │  │   7d/30d/12m 模式:                           │   │
│                   │  │   ┌─────────────────────────────────┐       │   │
│                   │  │   │ 統計圖表（分組柱狀圖）             │       │   │
│                   │  │   └─────────────────────────────────┘       │   │
│                   │  │   ┌───────────────────────────────────┐     │   │
│                   │  │   │ SoC 說明區塊                       │     │   │
│                   │  │   │ "SoC 僅在 24h 模式下顯示"          │     │   │
│                   │  │   └───────────────────────────────────┘     │   │
│                   │  │   ┌───────────────────────────────────┐     │   │
│                   │  │   │ 統計指標層次                        │     │   │
│                   │  │   │ Primary: PV/Load/Grid Imp/Grid Exp │     │   │
│                   │  │   │ Secondary: Bat Charge/Discharge     │     │   │
│                   │  │   │ Supporting: Self-cons/Self-suff/Peak│     │   │
│                   │  │   └───────────────────────────────────┘     │   │
│                   │  └─────────────────────────────────────────────┘   │
└──────────────────┴─────────────────────────────────────────────────────┘
```

### 2.2 Gateway 選擇規則（修正版）

REQ 修正後的正確要求是：**Energy 頁面自己要有一套與 Devices 頁面同模式的左側 Gateway locator**，而不是繼承 Devices 頁面的已選狀態才能工作。

**設計決策——Energy 自帶左側 Gateway locator；DemoStore 僅作預設選中記憶：**

- Energy 頁面左側渲染一套 Devices-style locator（gateway list / search / status badge / active item）
- 右側為能量工作區（24h / 7d / 30d / 12m、主圖、SoC、統計）
- 頂部控制區域**不放**第二個 Gateway dropdown/select

Energy 頁面 `init()` 的選中優先級：
```javascript
var gwId = self._parseHashParams().gw ||
  DemoStore.get('selectedGatewayId') ||
  firstGatewayIdFromLoadedList;
```

**優先級鏈：**
1. Hash query param `#energy?gw=xxx`（支持直接連結 / 深連結）
2. `DemoStore.get('selectedGatewayId')`（只作上次選中記憶）
3. 左側 locator 載入後的第一個可用 Gateway（默認選中）

**關鍵差異：**
- `DemoStore` 不再是主要 Gateway context 機制
- `DemoStore` 不是 Energy 頁面可用性的前置條件
- 即使從未進過 Devices，Energy 頁面也必須能靠自身左側 locator 正常工作

### 2.3 頁面骨架與頂部控制區設計

**v6.3-R2 修訂（2026-03-21，基於 v5 mock 共識）：** 24h 模式新增 Headline Verdict + Top Summary Strip + Battery Context Bar，取代原有「先看圖再看數字」的閱讀鏈，改為「先給結論和 totals，再看圖表」。

```
┌──────────────────────────────────────────────────────────────────┐
│ 左側：Gateway locator（與 Devices 同模式，寬度 220-240px）       │
│ 右側：                                                         │
│   ┌────────────────────────────────────────────────────────────┐│
│   │ Gateway Context Bar（名稱 + 站點 + Auto-refresh hint）     ││
│   │ [24h] [7d] [30d] [12m]  [◀ Prev][Date][Next ▶][Today]     ││
│   ├────────────────────────────────────────────────────────────┤│
│   │ Headline Verdict（Self-sufficiency % + grade badge）       ││
│   ├────────────────────────────────────────────────────────────┤│
│   │ Top Summary Strip（PV / Load / Grid Import / Grid Export） ││
│   ├────────────────────────────────────────────────────────────┤│
│   │ Battery Context Bar（Charged / Discharged / Net）          ││
│   ├────────────────────────────────────────────────────────────┤│
│   │ 24h 行為圖 / 統計柱狀圖                                    ││
│   │ SoC 輔助圖（僅 24h）                                       ││
│   ├────────────────────────────────────────────────────────────┤│
│   │ Behavior Interpretation（取代原方向卡片）                    ││
│   └────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

| 窗口 | 日期控件形態 | 說明 |
|------|------------|------|
| **24h** | `<input type="date">` 單日選擇器 | 選擇特定日期，顯示該日 24h 行為 |
| **7d** | `<input type="date">` 結束日期選擇器 | 選擇截止日期，向前推 7 天 |
| **30d** | `<input type="date">` 結束日期選擇器 | 選擇截止日期，向前推 30 天 |
| **12m** | `<input type="month">` 月份選擇器 | 選擇截止月份，向前推 12 個月 |

默認窗口為 **24h**，默認日期為**今天**。

**時間控件增強（v5 mock 共識）：**
- 除日期選擇器外，增加 **Prev / Next / Today** 快捷按鈕
- Prev / Next 在 24h 模式下前後推 1 天，在 7d/30d 下推 1 天，在 12m 下推 1 個月
- Today 按鈕重置日期錨點為今天（24h/7d/30d）或本月（12m）
- **Auto-refresh 指示器：** 在 24h + today 模式下顯示「Auto-refresh 60s · Updated HH:MM」提示，其餘模式隱藏

### 2.3.1 Headline Verdict（v6.3-R2 新增）

**定位：** 頁面 top summary 區域最上方，一個**緊湊的單指標結論區塊**。

**目的：** 回答「今天這個站表現如何？」不需要用戶自己算。

**內容：**
- **Self-sufficiency 百分比**（大字，與站點配色一致）
- **Grade badge**：根據百分比自動判定等級
  - `≥ 70%` → **Good**（綠色 badge `#34d399`）
  - `40-69%` → **Fair**（琥珀色 badge `#f6c445`）
  - `< 40%` → **Low**（紅色 badge `#f87171`）
- **一行解釋文字**（muted 色）：如「53% of load was met without grid imports」

**計算來源：**
- 24h 模式：前端從 `summary` 算 `(loadKwh - gridImportKwh) / loadKwh * 100`，CLAMP(0,100)
- 7d/30d/12m 模式：使用後端 `totals.selfSufficiencyPct`

**CSS class:** `.energy-verdict`

**規模約束：** 這是**唯一**的 headline verdict。不允許擴展為多指標 KPI 行。

### 2.3.2 Top Summary Strip（v6.3-R2 新增）

**定位：** 位於 Headline Verdict 下方、圖表上方。

**目的：** 以 answer-first 原則，在用戶看圖之前先給出當天/窗口的能量結構數字。

**Primary 指標（4 張大卡片，橫排）：**

| 指標 | 顏色 | 數據源 |
|------|------|--------|
| PV Generation | `#f6c445` | 24h: 前端累加 `pv * 5/60`；stats: `totals.pvGenerationKwh` |
| Load Consumed | `#60a5fa` | 24h: 前端累加 `load * 5/60`；stats: `totals.loadConsumptionKwh` |
| Grid Import | `#f87171` | 24h: `summary.gridImportKwh`；stats: `totals.gridImportKwh` |
| Grid Export | `#34d399` | 24h: `summary.gridExportKwh`；stats: `totals.gridExportKwh` |

**卡片內容：**
- 指標名稱（label）
- 數值 + 單位（大字，font-size 24-28px，font-weight 700-800）
- 說明文字（muted 色，font-size 12px）

**CSS class:** `.energy-summary-strip`

**重要規則：** Battery Charge/Discharge **不在此行顯示**，它有專屬的 Battery Context Bar。

### 2.3.3 Battery Context Bar（v6.3-R2 新增）

**定位：** 位於 Top Summary Strip 下方、圖表上方。視覺比 Primary 更輕。

**目的：** 給電池一個明確的「重要但次要」的位置，不與 PV/Load/Grid 搶地位。

**內容（3 項，一行緊湊佈局）：**

| 指標 | 顏色 | 說明 |
|------|------|------|
| Charged | `#34d399` | 充入電池的能量 |
| Discharged | `#34d399` | 電池釋放的能量 |
| Net | `#34d399` 或 `#fb923c` | Discharged - Charged，正=淨放電，負=淨充電 |

**CSS class:** `.energy-battery-context`

**視覺規格：**
- 字體比 Primary 小（font-size 18-20px，font-weight 600-700）
- 背景比 Primary 卡片更輕，一條細長 bar 而非獨立卡片
- Battery icon（🔋 或 SVG）+ 標題 "Battery" 左對齊

### 2.3.4 Behavior Interpretation（v6.3-R2，取代方向總量摘要 §3.3）

**定位：** 位於圖表（+ SoC）下方。

**目的：** 把圖表行為翻譯成人話。不是重複報數，而是提供**解讀和 net balance 確認**。

**取代了原 §3.3 方向總量摘要的位置和角色。**

**內容（3-4 張 interpretation cards）：**

| 卡片 | 範例文案 | 說明 |
|------|---------|------|
| PV Coverage | "PV covered 44% of total load (31.8 of 71.6 kWh)" | PV 對 Load 的覆蓋比 |
| Battery Role | "Net supplier — discharged 3.6 kWh more than charged" | 電池今天的角色判定 |
| Grid Dependency | "Net buyer — imported 36.0 kWh more than exported" | 電網依賴判定 |
| Energy Balance | "In ≈ Out — PV + Grid In + Bat Discharge ≈ Load + Grid Out + Bat Charge" | 能量守恆驗證 |

**CSS class:** `.energy-interpretation`

**規則：**
- 每張卡片的標題用對應系列的語義顏色
- 文案由前端根據數值動態生成
- 不重複 top summary strip 的 raw numbers——這裡負責「so what」

### 2.3.5 佈局約束（參考 Mock 居中佈局，原 §2.3.1）

佈局遵循 Mock 的設計語言（`energy-page-v63-mock.html`）：

1. **居中佈局**：`.energy-layout` 使用 `max-width` + `margin: 0 auto` 居中，而非 flush-left 撐滿全寬。整體最大寬度參考 Mock 的 1520px，但因左側 locator 佔 280px，workbench 區域實際可用寬度約 1200px。
2. **Locator 寬度**：`.energy-locator` 的 `width` / `min-width` 為 280px。
3. **Workbench 內容區**：右側 `.energy-workbench` 使用 `flex: 1; min-width: 0;`。
4. **圖表高度分配**：主功率圖最小高度 480px；SoC 圖最小高度 180px。避免頁面下半截大片空白。
5. **驗收基準**：頁面內容視覺居中，不貼左、不貼右，與 Mock 的居中效果一致。

---

## 3. 24h 行為層設計

### 3.1 主行為圖（Main Behavior Chart）

**使命：** 回答「在選定日期的每個時刻，PV / Load / Battery / Grid 的功率流向如何？」

**圖表類型：** ECharts 多 series 折線圖（line chart），共享 X 軸。通過 `Charts.createChart('energy-24h-chart', option, { pageId: 'energy' })` 創建。

**Series 定義：**

| Series | 名稱 | 顏色 | 數據來源 | 符號語義 |
|--------|------|------|---------|---------|
| 1 | PV | 黃/橙色 | `pv_power` | 始終 >= 0 |
| 2 | Load | 藍色 | `load_power` | 始終 >= 0 |
| 3 | Battery | 綠色 | `battery_power` | **正 = 放電，負 = 充電** |
| 4 | Grid | 紅/紫色 | `grid_power_kw` | **正 = 進口（買電），負 = 出口（賣電）** |

**X 軸：** 00:00 -> 23:55，5 分鐘間隔（288 個數據點），刻度標注每 2 小時。

**數據粒度備註（REVIEW M6 處理）：**
- 後端以 5 分鐘桶聚合（見 §5.1），產出 288 個數據點
- 底層 `telemetry_history` 的實際報告頻率約 1-5 分鐘（視 Gateway 配置），5 分鐘聚合為 AVG()，對大多數場景有效
- 若個別 Gateway 報告頻率 > 5 分鐘（如 10-15 分鐘），部分桶可能為 NULL，圖表將出現斷點（不做插值，見 §9 邊界情況）
- v6.3 phase 1 接受此行為，不做動態粒度適配

**Y 軸：** 功率（kW），自動範圍，含正負區域。

**零線要求（硬性 UI/UX 規則）：**
- Y=0 線必須清晰可見（使用 ECharts `markLine` 配置 `{ yAxis: 0 }`）
- 零線上方 = Battery 放電 / Grid 進口
- 零線下方 = Battery 充電 / Grid 出口

**Tooltip 要求：**
- 懸停顯示所有 4 個 series 的當前值
- Battery 值旁標注方向：`+1.2 kW (放電)` 或 `-0.8 kW (充電)`
- Grid 值旁標注方向：`+3.5 kW (進口)` 或 `-2.1 kW (出口)`

**顯式排除：**
- **不得**將 Battery/Grid 拆為 6 條獨立 series
- 方向分拆屬於摘要層，不屬於主行為圖

### 3.2 SoC 輔助圖

**出現條件：** 僅在 24h 模式下渲染。

**硬性對齊要求（Alan 明確確認）：**
- SoC 圖的 X 軸**必須使用與主行為圖完全相同的時間語義和像素寬度**
- 用戶必須能垂直對照同一時刻的功率流向與 SoC 值

**ECharts 實現策略——單一 ECharts 實例 + 雙 grid：**

通過 `Charts.createChart('energy-24h-chart', option, { pageId: 'energy' })` 創建**單一**圖表實例，使用 ECharts multi-grid 配置：

```javascript
var option = {
  grid: [
    { top: '5%', height: '55%', left: 60, right: 30 },   // 主行為圖
    { top: '72%', height: '18%', left: 60, right: 30 }    // SoC 輔助圖
  ],
  xAxis: [
    { gridIndex: 0, type: 'time', min: dayStart, max: dayEnd, /* ... */ },
    { gridIndex: 1, type: 'time', min: dayStart, max: dayEnd, show: false }
  ],
  yAxis: [
    { gridIndex: 0, name: 'kW', /* ... */ },
    { gridIndex: 1, name: 'SoC %', min: 0, max: 100 }
  ],
  axisPointer: { link: [{ xAxisIndex: 'all' }] },
  // ... series definitions
};
```

- 兩個 grid 的 `left` 和 `right` 使用**固定像素值**（非百分比），確保 X 軸像素級對齊
- SoC X 軸隱藏標籤（`show: false`），避免重複，僅保留 grid line 對齊
- `axisPointer.link` 實現聯動懸停

**SoC 圖表類型：** 面積圖（`type: 'line'` + `areaStyle: {}`），Y 軸 0-100%。

**數據來源：** `battery_soc`，與主圖同為 5 分鐘間隔。

### 3.3 Behavior Interpretation（v6.3-R2，取代方向總量摘要）

**⚠ 本節取代原方向總量摘要（4 張 direction cards）。**
詳見 §2.3.4 完整規格。

**簡要：** 圖表下方不再重複 raw totals（那些已經在 Top Summary Strip 和 Battery Context Bar 裡了），改為 3-4 張 interpretation cards，提供「so what」層面的解讀：PV Coverage / Battery Role / Grid Dependency / Energy Balance。

**數據來源：** 前端根據 API response 的 `summary` 數值動態生成文案。

### 3.4 24h 刷新模型

- **自動刷新：** 每 60 秒拉取最新數據（用於今日視圖）
- **非今日：** 不自動刷新（歷史日無新數據）
- **增量感知：** 刷新後 `Charts.createChart()` 以 `notMerge: true` 更新，圖表平滑更新至最新點位
- **刷新間隔配置（REVIEW L1 修復）：** 作為 `p3-energy.js` 模組內的 JS 常量 `var REFRESH_INTERVAL_MS = 60000;`，非後端環境變數
- **頁面不可見時暫停：** 使用 `document.visibilityState` 判斷，頁面不可見時暫停 `setInterval`

---

## 4. 統計層設計（7d / 30d / 12m）

### 4.1 統計圖表

**圖表類型決策：** 採用**分組柱狀圖（grouped bar chart）**。

**理由：**
- 7d/30d 的 X 軸為日期，12m 的 X 軸為月份——離散類別軸天然適合柱狀圖
- 柱狀圖在能量總量比較場景中比折線圖更直觀
- 可通過分組（grouped）展示 PV / Load / Grid Import / Grid Export 的對比關係

**Series 組成（4 個 bar series）：**

| Series | 顏色 | 說明 |
|--------|------|------|
| PV Generation | 黃/橙色 | 始終 >= 0 |
| Load Consumption | 藍色 | 始終 >= 0 |
| Grid Import | 紅色 | 始終 >= 0（已取絕對值） |
| Grid Export | 紫色 | 始終 >= 0（已取絕對值） |

**為什麼 Battery 不作為 bar series（REVIEW M7 處理）：**
Battery Charge / Discharge 為 REQ 定義的 **Secondary 指標**，若顯示為 bar series 將產生 6 組 grouped bar，可讀性下降。因此 Battery 僅出現在 tooltip（懸停時顯示該日/月完整 6 項能量指標）和下方指標卡片中。

**X 軸語義：**

| 窗口 | X 軸類型 | 刻度數 | 標籤格式 |
|------|---------|--------|---------|
| 7d | 每日一組 | 7 | `03/14`（月/日） |
| 30d | 每日一組 | 30 | `03/14`（稀疏標注，每 5 天） |
| 12m | 每月一組 | 12 | `2025/04`（年/月） |

**30d 密度備註（REVIEW L4）：** 30d 模式下 4 x 30 = 120 bar 較密，圖表容器使用 `min-width` 確保不過於擠壓；必要時允許水平滾動。

**ECharts 實例：** 通過 `Charts.createChart('energy-stats-chart', option, { pageId: 'energy' })` 創建獨立實例。

### 4.2 SoC 行為說明區塊

在 7d/30d/12m 模式下，SoC 輔助圖**不渲染**。取而代之，顯示一個語義守護文字區塊：

> SoC（電池荷電狀態）僅在 24h 模式下顯示，因為 SoC 需要與功率時間線逐點對齊才具備判讀價值。

此區塊用輕量樣式（`.energy-soc-info`，灰底 + info icon），不佔據大量視覺空間。

### 4.3 統計指標層次

REQ 定義了三級指標層次，DESIGN 將其映射為 HTML 卡片組：

**Primary 指標（大卡片 / 首行，class `.energy-metric-primary`）：**

| 指標 | 計算 | 單位 |
|------|------|------|
| PV Generation | sum pv_energy 全窗口 | kWh |
| Load Consumption | sum load_energy 全窗口 | kWh |
| Grid Import | sum grid_import 全窗口 | kWh |
| Grid Export | sum grid_export 全窗口 | kWh |

**Secondary 指標（中卡片 / 第二行，class `.energy-metric-secondary`）：**

| 指標 | 計算 | 單位 |
|------|------|------|
| Battery Charge | sum bat_charge 全窗口 | kWh |
| Battery Discharge | sum bat_discharge 全窗口 | kWh |

**Supporting 指標（小卡片 / 第三行，class `.energy-metric-supporting`）：**

| 指標 | 計算 | 單位 | 備註 |
|------|------|------|------|
| Self-consumption | CLAMP(0, 100, (pvGen - gridExport) / pvGen x 100) | % | **REVIEW M3 修復** |
| Self-sufficiency | CLAMP(0, 100, (load - gridImport) / load x 100) | % | **REVIEW M3 修復** |
| Peak Demand | MAX(load_power) 全窗口 from telemetry_history | kW | **REVIEW M2 修復** |

**Self-consumption / Self-sufficiency 邊界處理（REVIEW M3 修復）：**
- pvGen = 0 → selfConsumptionPct = 0（不除零）
- load = 0 → selfSufficiencyPct = 0（不除零）
- 計算結果 < 0 → clamp to 0
- 計算結果 > 100 → clamp to 100（可能因 battery-to-grid export 超過 PV）
- 後端在 totals 計算中執行 `Math.max(0, Math.min(100, Math.round(...)))`

**Peak Demand 計算規則（REVIEW M2 修復）：**
- **必須**使用 `MAX(load_power) FROM telemetry_history`（真實瞬時功率峰值）
- **不得**使用 `MAX(load_kwh * 12) FROM asset_5min_metrics`（5 分鐘平均功率，會低估真實峰值）
- 即使其他統計指標使用 `asset_5min_metrics` pre-computed 表，peak demand 仍需查詢 `telemetry_history`

### 4.4 統計卡片視覺層次規範（REQ 補充）

三級層次必須通過字體大小和權重的**遞減**產生視覺上的主次區分：

| 層次 | `.metric-value` font-size | font-weight | 視覺效果 |
|------|--------------------------|-------------|---------|
| **Primary** | `1.5rem` (24px) | 700 (bold) | 數字醒目，第一視覺落點 |
| **Secondary** | `1.2rem` (19px) | 600 (semi-bold) | 次要但清晰可讀 |
| **Supporting** | `1.0rem` (16px) | 600 | 最輕，作為上下文參考 |

### 4.5 指標說明文字（REQ 補充）

每張統計卡在數值下方必須包含一行 **muted 顏色的解釋文字**（class `.stat-card-desc`），說明指標含義。

實現：在 `renderStatCards()` 時為每個指標 append 一個 `<div class="stat-card-desc">` 元素。

i18n keys 範例（EN / PT-BR / ZH-TW）：

| 指標 key | EN | PT-BR | ZH-TW |
|---------|-----|-------|-------|
| `energy.desc.pvGen` | Total solar energy produced | Energia solar total gerada | 太陽能總發電量 |
| `energy.desc.loadCons` | Total energy consumed | Energia total consumida | 總用電量 |
| `energy.desc.gridImport` | Energy purchased from grid | Energia comprada da rede | 從電網購入電量 |
| `energy.desc.gridExport` | Energy sold back to grid | Energia vendida para a rede | 售回電網電量 |
| `energy.desc.batCharge` | Energy stored in battery | Energia armazenada na bateria | 充入電池電量 |
| `energy.desc.batDischarge` | Energy released from battery | Energia liberada da bateria | 電池釋放電量 |
| `energy.desc.selfCons` | % of PV energy used on-site | % da energia PV usada localmente | PV 現場自用比例 |
| `energy.desc.selfSuff` | % of load met without grid | % da carga atendida sem a rede | 不依賴電網的負載比例 |
| `energy.desc.peakDemand` | Maximum instantaneous load | Demanda máxima instantânea | 最大瞬時負載功率 |

**樣式：**
```css
.stat-card-desc {
  color: var(--muted);
  font-size: 0.75rem;
  margin-top: 4px;
  line-height: 1.3;
}
```

### 4.6 ECharts 配色與視覺規範（REQ 補充）

**固定配色（討論確認，全圖表 / 統計卡 / 圖例通用）：**

| Series | 色名 | Hex | 面積填充 |
|--------|------|-----|---------|
| PV | 金黃 | `#f6c445` | 無 |
| Load | 天藍 | `#60a5fa` | 無 |
| Battery | 翠綠 | `#34d399` | `rgba(52,211,153,0.18)` |
| Grid | 珊瑚紅 | `#f87171` | `rgba(248,113,113,0.15)` |
| SoC | 紫色 | `#a78bfa` | `rgba(167,139,250,0.18)` |

**面積填充規則：** Battery 和 Grid 使用面積填充（零軸到線之間）來強調方向區域。PV 和 Load 不用面積填充，避免視覺噪音。

**零軸虛線：** `lineStyle: { color: 'rgba(255,255,255,0.45)', type: 'dashed', width: 1.5 }`，必須與 splitLine 有明確視覺區分。

**顯式排除：** 不包含任何經濟性指標（savings / cost / revenue）。REQ v6.3 明確排除 economic light section。

---

## 5. 數據契約

### 5.1 EP-1: GET /api/gateways/{gatewayId}/energy-24h

**現狀：** `get-gateway-energy.ts` 已實現，但**路由未在 `bff-stack.ts` 中註冊**（死代碼）。

**現有 handler 回傳格式：** 96 x 15 分鐘桶，每桶包含 `[pv, load, battery, grid, soc, flload, baseline, savingsBrl]`。

**v6.3 改造：**

| 需求 | 現有 handler | 差距 |
|------|------------|------|
| 5 分鐘間隔（288 點） | 15 分鐘間隔（96 點） | **需修改：** 改為 5 分鐘聚合 |
| PV / Load / Battery / Grid / SoC | 已有 | 無差距 |
| 方向總量摘要（4 項分拆） | 未提供 | **需增加：** 回傳 summary 區段 |
| 不含經濟指標 | 含 savingsBrl | 前端忽略即可 |

**向後相容（REVIEW L2 處理）：** 現有路由未註冊（死代碼，僅 mock 模式使用），**不需要** `?format=v1` 向後相容 shim。直接替換為 v6.3 新格式。

**Response 結構：**

```typescript
interface GatewayEnergy24hResponse {
  success: true;
  data: {
    gatewayId: string;
    date: string;                    // YYYY-MM-DD
    resolution: '5min';
    points: Array<{
      ts: string;                    // ISO 8601
      pv: number;                    // kW, >= 0
      load: number;                  // kW, >= 0
      battery: number;               // kW, + = discharge, - = charge
      grid: number;                  // kW, + = import, - = export
      soc: number | null;            // 0-100, null if unavailable
    }>;
    summary: {
      batteryChargeKwh: number;      // sum charging energy
      batteryDischargeKwh: number;   // sum discharging energy
      gridImportKwh: number;         // sum import energy
      gridExportKwh: number;         // sum export energy
    };
  };
}
```

### 5.2 EP-2: GET /api/gateways/{gatewayId}/energy-stats

**新增端點，** 服務 7d / 30d / 12m 統計層。

**Request 參數：**
- `window`: `7d` | `30d` | `12m`
- `endDate`: `YYYY-MM-DD`（7d/30d）或 `YYYY-MM`（12m）

**Response 結構：**

```typescript
interface GatewayEnergyStatsResponse {
  success: true;
  data: {
    gatewayId: string;
    window: '7d' | '30d' | '12m';
    startDate: string;               // inclusive
    endDate: string;                 // inclusive
    buckets: Array<{
      label: string;                 // "2026-03-14" or "2026-03"
      pvKwh: number;
      loadKwh: number;
      gridImportKwh: number;
      gridExportKwh: number;
      batteryChargeKwh: number;
      batteryDischargeKwh: number;
    }>;
    totals: {
      pvGenerationKwh: number;
      loadConsumptionKwh: number;
      gridImportKwh: number;
      gridExportKwh: number;
      batteryChargeKwh: number;
      batteryDischargeKwh: number;
      selfConsumptionPct: number;    // integer 0-100, CLAMPED
      selfSufficiencyPct: number;    // integer 0-100, CLAMPED
      peakDemandKw: number;          // MAX(load_power) from telemetry_history
    };
  };
}
```

**SQL 方向（7d/30d）：**
```sql
-- 主統計查詢（優先 asset_5min_metrics）
SELECT
  DATE(m.window_start AT TIME ZONE 'America/Sao_Paulo') AS bucket_date,
  SUM(m.pv_kwh)              AS pv_kwh,
  SUM(m.load_kwh)            AS load_kwh,
  SUM(m.grid_import_kwh)     AS grid_import_kwh,
  SUM(m.grid_export_kwh)     AS grid_export_kwh,
  SUM(m.bat_charge_kwh)      AS battery_charge_kwh,
  SUM(m.bat_discharge_kwh)   AS battery_discharge_kwh
FROM asset_5min_metrics m
JOIN assets a ON a.asset_id = m.asset_id
WHERE a.gateway_id = $1
  AND m.window_start >= $2
  AND m.window_start < $3
GROUP BY bucket_date
ORDER BY bucket_date;

-- Peak demand 子查詢（REVIEW M2 修復：必須從 telemetry_history 取）
SELECT MAX(th.load_power) AS peak_demand_kw
FROM telemetry_history th
JOIN assets a ON a.asset_id = th.asset_id
WHERE a.gateway_id = $1
  AND th.recorded_at >= $2
  AND th.recorded_at < $3;
```

**Fallback 查詢（若 asset_5min_metrics 無數據）：**
```sql
SELECT
  DATE(th.recorded_at AT TIME ZONE 'America/Sao_Paulo') AS bucket_date,
  SUM(GREATEST(th.pv_power, 0) * 5.0 / 60)              AS pv_kwh,
  SUM(GREATEST(th.load_power, 0) * 5.0 / 60)             AS load_kwh,
  SUM(GREATEST(th.grid_power_kw, 0) * 5.0 / 60)          AS grid_import_kwh,
  SUM(GREATEST(-th.grid_power_kw, 0) * 5.0 / 60)         AS grid_export_kwh,
  SUM(GREATEST(-th.battery_power, 0) * 5.0 / 60)         AS battery_charge_kwh,
  SUM(GREATEST(th.battery_power, 0) * 5.0 / 60)          AS battery_discharge_kwh
FROM telemetry_history th
JOIN assets a ON a.asset_id = th.asset_id
WHERE a.gateway_id = $1
  AND th.recorded_at >= $2
  AND th.recorded_at < $3
GROUP BY bucket_date
ORDER BY bucket_date;
```

**時區備註（REVIEW L6）：** SQL 使用 `AT TIME ZONE 'America/Sao_Paulo'` 進行 BRT 聚合。v6.3 phase 1 為巴西市場，hardcode BRT。若未來擴展至其他時區，可參數化此值。

### 5.3 數據來源矩陣

| 端點 | 數據表 | 聚合粒度 | 說明 |
|------|--------|---------|------|
| energy-24h | `telemetry_history` | 5 分鐘 | 直接查詢分區表 |
| energy-stats (7d/30d) buckets | `asset_5min_metrics`（優先）或 `telemetry_history`（fallback） | 按日聚合 | 優先用 pre-computed 表 |
| energy-stats (12m) buckets | `asset_5min_metrics`（優先）或 `telemetry_history`（fallback） | 按月聚合 | 優先用 pre-computed 表 |
| energy-stats peak demand | `telemetry_history` | 全窗口 MAX | **始終從 telemetry_history 取真實峰值** |

---

## 6. 後端 vs 前端責任分工

| 責任 | 後端 | 前端 |
|------|------|------|
| 24h 功率數據聚合（5 分鐘） | SQL 聚合 + 回傳 | 僅渲染 |
| 24h 方向總量計算 | 在 summary 中回傳 | 僅顯示 |
| 7d/30d/12m 按日/月聚合 | SQL GROUP BY | 僅渲染柱狀圖 |
| 統計指標計算 | 在 totals 中回傳（含 CLAMP） | 僅顯示 |
| Self-consumption / Self-sufficiency CLAMP(0,100) | **後端計算並 clamp** | 僅顯示後端值 |
| Peak Demand | **MAX(load_power) from telemetry_history** | 僅顯示 |
| SoC 數據提供 | 隨 24h 端點回傳 | 僅渲染輔助圖 |
| 零線穿越符號語義 | 回傳帶符號原始值 | 按符號定義渲染 + tooltip 標注 |
| 時間窗口計算（startDate/endDate） | 接受窗口參數，計算範圍 | 傳遞窗口 + 錨點日期 |
| 自動刷新 | 無狀態、每次請求完整回傳 | 管理 setInterval timer |
| 時區處理 | BRT 聚合、ISO 8601 回傳 | 轉為瀏覽器本地時區顯示 |

---

## 7. 前端模組架構（vanilla JS page module pattern）

### 7.1 模組結構

v6.3 Energy 頁面遵循 v6.1 Fleet（`p1-fleet.js`）和 v6.2 Devices（`p2-devices.js`）的 **page module object pattern**：

```javascript
var EnergyPage = {
  // -- Page-local state -------------------------------------------
  _state: {
    gatewayId: null,          // from DemoStore or hash params
    gatewayName: null,
    timeWindow: '24h',        // '24h' | '7d' | '30d' | '12m'
    dateAnchor: null,         // Date object (24h/7d/30d) or { year, month } (12m)
    energy24hData: null,      // API response cache
    energyStatsData: null,    // API response cache
    isLoading: false,
    refreshTimer: null,       // setInterval ID
  },

  // -- Lifecycle --------------------------------------------------
  init: async function () { /* ... */ },
  onRoleChange: function () { /* re-init */ },
  dispose: function () { /* clear timer, dispose charts */ },

  // -- Skeleton ---------------------------------------------------
  _buildSkeleton: function () { /* loading skeleton HTML */ },

  // -- Content builders -------------------------------------------
  _buildContent: function () { /* top controls + verdict + summary + charts + interpretation */ },
  _buildTopControls: function () { /* window toggle + date picker + prev/next/today + refresh hint */ },
  _buildHeadlineVerdict: function (data) { /* self-sufficiency % + grade badge */ },
  _buildSummaryStrip: function (data) { /* PV / Load / Grid Import / Grid Export cards */ },
  _buildBatteryContext: function (data) { /* Charged / Discharged / Net compact bar */ },
  _build24hView: function (data) { /* behavior chart + SoC */ },
  _buildStatsView: function (data) { /* stats chart + SoC info + metrics hierarchy */ },
  _buildInterpretation: function (data) { /* PV Coverage / Battery Role / Grid Dependency / Energy Balance */ },
  _buildMetricsHierarchy: function (totals) { /* primary + secondary + supporting */ },
  _buildEmptyState: function () { /* no gateway selected */ },

  // -- Public API -------------------------------------------------
  selectGateway: function (gatewayId, tab) {
    // Preserve current public contract from existing p3-energy.js
    // Writes selected gateway into DemoStore, updates hash/query if needed,
    // then re-renders the page under the new gateway context.
  },

  // -- Chart builders ---------------------------------------------
  _init24hChart: function (data) {
    // Single ECharts instance with dual grid (behavior + SoC)
    // Uses Charts.createChart('energy-24h-chart', option, { pageId: 'energy' })
  },
  _initStatsChart: function (data) {
    // Grouped bar chart
    // Uses Charts.createChart('energy-stats-chart', option, { pageId: 'energy' })
  },

  // -- Data fetching ----------------------------------------------
  _fetchData: async function () { /* call EP-1 or EP-2 based on timeWindow */ },
  _startAutoRefresh: function () { /* setInterval for 24h today only */ },
  _stopAutoRefresh: function () { /* clearInterval */ },

  // -- Event handlers ---------------------------------------------
  _onWindowChange: function (newWindow) { /* switch + date conversion */ },
  _onDateChange: function (newDate) { /* re-fetch */ },
  _onRefreshClick: function () { /* manual refresh */ },

  // -- Helpers ----------------------------------------------------
  _parseHashParams: function () { /* reuse existing pattern from current p3-energy.js */ },
  _todayStr: function () { /* YYYY-MM-DD */ },
};
```

### 7.2 與現有基礎設施的整合

| 基礎設施 | 整合方式 |
|----------|---------|
| **app.js hash router** | `#energy` route -> `EnergyPage.init()`。現有 `initPage('energy')` 已調用 `EnergyPage.init()`，無需改動 `app.js`。 |
| **app.js navigateTo()** | 頁面切換時 `Charts.activatePageCharts('energy')` 已被 router 自動調用。 |
| **Charts.createChart()** | 所有 ECharts 實例通過 `Charts.createChart(containerId, option, { pageId: 'energy' })` 創建，自動註冊到 Charts registry，支持 theme refresh / page activation / ResizeObserver。 |
| **Charts.disposePageCharts()** | `onRoleChange()` 和離開頁面時由 `app.js invalidateHiddenPages()` 自動調用。 |
| **DataSource.energy.\*** | 新增 `gateway24h(gatewayId, date)` 和 `gatewayStats(gatewayId, window, endDate)` 方法到 `data-source.js` 的 `energy` 區段。遵循現有 `withFallback(apiCall, mockData)` dual-source pattern。 |
| **DemoStore** | 讀取 `DemoStore.get('selectedGatewayId')` 獲取跨頁面 Gateway 選擇。Energy 頁面為消費者，不寫入。 |
| **index.html** | 無需改動。`p3-energy.js` 的 `<script>` 標籤已存在（line 137），EnergyPage 全局變量名不變。 |
| **CSS** | 新增 Energy 頁面樣式到 `css/pages.css`（使用 `.energy-*` prefix），與現有命名空間不衝突。 |

### 7.3 狀態管理

```
DemoStore（跨頁面，sessionStorage-backed）：
|-- selectedGatewayId          // 由 Devices sidebar 寫入
+-- selectedGatewayName        // 由 Devices sidebar 寫入

EnergyPage._state（頁面本地，JavaScript 物件）：
|-- gatewayId                  // 從 hash params 或 DemoStore 讀取
|-- gatewayName                // 用於頂部顯示
|-- timeWindow                 // '24h' | '7d' | '30d' | '12m'
|-- dateAnchor                 // Date or { year, month }
|-- energy24hData              // API response cache
|-- energyStatsData            // API response cache
|-- isLoading                  // boolean
+-- refreshTimer               // setInterval ID
```

**數據拉取策略：**
- `gatewayId` 或 `timeWindow` 或 `dateAnchor` 變化時觸發 `_fetchData()`
- 24h 模式：調用 `DataSource.energy.gateway24h(gatewayId, dateStr)`
- 7d/30d/12m 模式：調用 `DataSource.energy.gatewayStats(gatewayId, window, endDateStr)`
- 切換窗口時清除舊數據，用 `_buildSkeleton()` 顯示 loading 狀態
- `_fetchData()` 完成後調用對應的 `_build24hView()` 或 `_buildStatsView()` 重新渲染

---

## 8. 交互規則

### 8.1 時間窗口切換

| 從 -> 到 | 行為 |
|---------|------|
| 24h -> 7d | 以當前 24h 日期作為 7d 結束日期 |
| 24h -> 30d | 以當前 24h 日期作為 30d 結束日期 |
| 24h -> 12m | 以當前 24h 日期所在月份作為 12m 結束月份 |
| 7d/30d -> 24h | 以當前結束日期作為 24h 日期 |
| 7d -> 30d | 保留結束日期 |
| 30d -> 7d | 保留結束日期 |
| 7d/30d -> 12m | 以結束日期所在月份作為 12m 結束月份 |
| 12m -> 24h | 以 `min(結束月份最後一天, 今天)` 作為 24h 日期 **（REVIEW M1 修復）** |
| 12m -> 7d/30d | 以 `min(結束月份最後一天, 今天)` 作為結束日期 **（REVIEW M1 修復）** |

**12m -> 24h/7d/30d 日期 clamp 規則（REVIEW M1 修復）：**

當 12m 結束月份為當前月份（如 2026-03），月份最後一天（03-31）可能在未來。必須 clamp：
```javascript
var lastDay = new Date(endYear, endMonth, 0); // 月份最後一天
var today = new Date();
today.setHours(0, 0, 0, 0);
var clampedDate = lastDay > today ? today : lastDay;
```

### 8.2 日期控件邊界

| 控件 | 最小值 | 最大值 |
|------|--------|--------|
| 24h DatePicker | 該 Gateway 首筆 telemetry 日期（或空） | **今天** |
| 7d/30d 結束日期 | Gateway 首筆 + 7d/30d（或空） | **今天** |
| 12m MonthPicker | Gateway 首筆所在月份 + 12m（或空） | **本月** |

HTML `<input type="date" max="2026-03-20">` 的 `max` 屬性可直接限制未來日期選擇。

### 8.3 圖表閱讀優先級

**24h：**
1. 讀主行為圖（功率流向趨勢）
2. 垂直對照 SoC 輔助圖
3. 讀方向總量摘要
4. （可選）hover tooltip 查看精確值

**7d/30d/12m：**
1. 讀統計柱狀圖（能量分佈趨勢）
2. 讀指標層次（totals）
3. SoC 說明區塊僅作語義守護

---

## 9. 邊界情況

| 場景 | 處理 | 說明 |
|------|------|------|
| 無 hash/DemoStore 預設 Gateway | 左側 locator 正常顯示，默認選中第一個可用 Gateway；若列表為空則顯示「暫無 Gateway」空態 | 不依賴 Devices 頁面 |
| Gateway 無 telemetry 數據 | 顯示空態：「該 Gateway 尚無能量數據」 | 不顯示空圖表 |
| 24h 選擇今日但僅有部分數據 | 圖表 X 軸仍為 00:00-24:00，無數據區域留白 | 自動刷新補充新點 |
| 24h 選擇未來日期 | 日期控件 `max` 屬性不允許選擇未來 | 最大值為今天 |
| 7d 窗口跨月 | 正常處理，X 軸標籤含月份 | 如 03/28 - 04/03 |
| 12m 窗口跨年 | 正常處理，X 軸標籤含年份 | 如 2025/04 - 2026/03 |
| Battery SoC 全為 null（無電池） | SoC 輔助圖區域顯示「無電池數據」文字 | 不渲染空面積圖 |
| 多 asset 的 Gateway | 後端按 gateway_id JOIN assets 聚合 | 前端無需感知 asset 粒度 |
| Grid power 始終為 0（離網場景） | Grid 線貼零，Grid Import/Export 摘要顯示 0 | 正常渲染 |
| 數據間隙（telemetry gap） | 圖表中對應時段無數據點，折線斷開 | 不做線性插值 |
| selfConsumptionPct 計算結果 < 0 或 > 100 | 後端 CLAMP(0, 100) | 前端僅顯示後端值 |

---

## 10. 明確非目標（v6.3）

以下項目不在本版設計範圍：

1. **經濟性指標**（savings / cost / revenue / tariff）——REQ 顯式排除
2. **Asset 級別鑽取**——Energy 頁面為 Gateway 級，不提供 asset 明細下鑽
3. **自定義時間範圍**——僅支持 4 種固定窗口
4. **實時推送（WebSocket / SSE）**——24h 採用 polling 刷新
5. **匯出功能**（CSV / PDF）——不在 v6.3 範圍
6. **多 Gateway 對比**——一次只看一個 Gateway
7. **SoC 在長窗口（7d/30d/12m）的趨勢展示**——REQ 顯式排除
8. **React / Vite / 前端框架遷移**——明確為 v7.0 議題

---

## 11. 模塊影響矩陣

| 模塊 | 文件路徑 | 動作 | 風險 | 說明 |
|------|----------|------|------|------|
| **BFF -- energy-24h** | `backend/src/bff/handlers/get-gateway-energy.ts` | **改** | 中 | 改為 5 分鐘粒度 + 增加 summary 區段 |
| **BFF -- energy-stats** | `backend/src/bff/handlers/get-gateway-energy-stats.ts` | **新建** | 中 | 7d/30d/12m 統計端點 |
| **BFF -- bff-stack.ts** | `backend/lib/bff-stack.ts` | **改** | 低 | 註冊 energy-24h + energy-stats 路由 |
| **Frontend -- p3-energy.js** | `frontend-v2/js/p3-energy.js` | **替換重寫** | 高 | 完整 Energy 頁面模組（vanilla JS page object） |
| **Frontend -- data-source.js** | `frontend-v2/js/data-source.js` | **改** | 低 | 新增 energy.gateway24h() + energy.gatewayStats() 方法 |
| **Frontend -- p2-devices.js** | `frontend-v2/js/p2-devices.js` | **改（微量）** | 低 | `_selectGateway()` 中增加 `DemoStore.set('selectedGatewayId', ...)` |
| **Frontend -- pages.css** | `frontend-v2/css/pages.css` | **改** | 低 | 新增 `.energy-*` 樣式 |

**不動文件（已驗證）：**

| 文件 | 理由 |
|------|------|
| `frontend-v2/index.html` | `p3-energy.js` 的 `<script>` 標籤已存在，`EnergyPage` 全局變量名不變 |
| `frontend-v2/js/app.js` | `initPage('energy')` 已調用 `EnergyPage.init()`，hash route `#energy` 不變 |
| `frontend-v2/js/charts.js` | 使用現有 `Charts.createChart()` API，無需修改 |
| `frontend-v2/js/p3-asset-energy.js` | 不再被 Energy 頁面引用，但保留供其他用途 |
| `frontend-v2/js/p3-asset-health.js` | 同上 |
| `db-init/02_schema.sql` | v6.3 不涉及 schema 改動 |
| `backend/src/bff/handlers/get-gateway-detail.ts` | Devices 頁面端點，不受影響 |
| `backend/src/iot-hub/*` | IoT pipeline 不受影響 |

### 風險等級定義

| 等級 | 定義 |
|------|------|
| 高 | 涉及核心圖表語義（零線穿越、SoC 對齊、統計 vs 行為模式切換），錯誤會導致數據誤讀 |
| 中 | 新增/修改 API 端點或數據拉取邏輯，影響有限但需正確性保證 |
| 低 | 增量式 UI 元件或配置，不影響數據語義 |

---

## 12. REVIEW 修復追蹤

| REVIEW 項 | 嚴重度 | 本 DESIGN 修復位置 | 狀態 |
|-----------|--------|-------------------|------|
| **C1** 前端架構不存在（React） | Critical | ss1（技術邊界）、ss7（整體重寫為 vanilla JS） | 已修復 |
| **M1** 12m->24h 可能產生未來日期 | Medium | ss8.1（clamp 規則） | 已修復 |
| **M2** Peak demand 必須用 MAX(load_power) | Medium | ss4.3、ss5.2、ss5.3 | 已修復 |
| **M3** Self-cons/suff 需 CLAMP(0,100) | Medium | ss4.3 | 已修復 |
| **M4** 未提及替換 p3-energy.js | Medium | ss1（替換範圍） | 已修復 |
| **M5** Gateway context 機制未定義 | Medium | ss2.2（Energy 自帶左側 locator；DemoStore 僅作預設記憶） | 已修復 |
| **M6** 5 分鐘粒度需驗證 | Medium | ss3.1（數據粒度備註） | 已處理 |
| **M7** Battery tooltip-only 未說明 | Medium | ss4.1（設計備註） | 已處理 |
| **L1** 刷新間隔配置位置 | Low | ss3.4（JS 常量） | 已修復 |
| **L2** 向後相容 shim 不必要 | Low | ss5.1 | 已移除 |
| **L6** SQL 時區參數化 | Low | ss5.2（備註） | 已處理 |
��理 |
註） | 已處理 |
im 不必要 | Low | ss5.1 | 已移除 |
| **L6** SQL 時區參數化 | Low | ss5.2（備註） | 已處理 |
