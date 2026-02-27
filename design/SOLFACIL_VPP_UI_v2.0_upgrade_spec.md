# 《Solfacil Pilot: 邊緣遙測與 VPP 批量調度完整設計方案 (v2.0)》

> **版本**: v2.0（完整獨立版本，取代 v1.0）
> **日期**: 2026-02-27
> **說明**: 本文件包含 v1.0 全部內容並整合四大升級決策，無需參照任何其他文件

---

## 第一章：項目架構與數據層

### 1.1 現有架構分析

#### 1.1.1 項目結構

```
├── index.html          # 主頁面 (4個Section: Portfolio/Arbitragem/Ativos/Relatórios)
├── app.js              # 應用邏輯 (1354行, 含翻譯系統/Mock數據/圖表/實時更新)
├── style.css           # 樣式 (1280行, 金融儀表盤設計系統)
├── presentation.html   # 演示入口頁
└── demo-multilang.html # 多語言測試頁
```

#### 1.1.2 關鍵現有模組

| 模組 | 位置 | 描述 |
|------|------|------|
| 翻譯系統 | `app.js:8-542` | `translations` 對象, `t()` 函數, `changeLanguage()` |
| Mock 數據 | `app.js:627-713` | `mockData.assets[]` 含4個站點 |
| 資產渲染 | `app.js:1105-1165` | `populateAssets()` 生成站點卡片 |
| 導航系統 | `app.js:755-791` | Section 切換, `navigateTo()` |
| Modal 系統 | `app.js:1309-1345` | 交易機會彈窗 (可復用模式) |
| 實時更新 | `app.js:1201-1304` | `startRealTimeUpdates()` 每5秒刷新 |

#### 1.1.3 現有資產數據結構

```javascript
// app.js:628-693 - mockData.assets[] 中每個資產
{
    id: 'ASSET_SP_001',
    name: 'São Paulo - Casa Verde',
    region: 'SP',
    status: 'operando',        // 'operando' | 'carregando'
    investimento: 4200000,
    capacidade: 5.2,           // MWh
    unidades: 948,
    socMedio: 65,              // %
    receitaHoje: 18650,
    receitaMes: 412300,
    roi: 19.2,
    custoHoje: 4250,
    lucroHoje: 14400,
    payback: '3,8'
}
// 注意: 原始結構沒有 "運行模式" 字段 — v1.0 已添加 operationMode
```

---

### 1.2 v2.0 數據層升級 — mockData.assets 擴充

在 v1.0 添加的 `operationMode` 基礎上，每個 asset 新增三個嵌套對象：`metering`、`status`、`config`。

#### 1.2.1 metering 對象（實時功率流）

對齊巴西 HEMS 規模：PV 4-8kW、負載 5-10kW。

| 字段 | 類型 | 單位 | MQTT identifier 來源 | 描述 |
|------|------|------|----------------------|------|
| pv_power | Number | kW | `pv_totalPower` | 光伏即時功率 |
| battery_power | Number | kW | `bat_totalPower` | 電池功率（正=充電, 負=放電） |
| grid_power_kw | Number | kW | `grid_activePower` | 電網功率（正=買電/import, 負=賣電/export） |
| load_power | Number | kW | `flload_totalPower` | 家庭負載功率 |
| grid_import_kwh | Number | kWh | `grid_positiveEnergy` | 今日累計買電量 |
| grid_export_kwh | Number | kWh | `grid_negativeEnergy` | 今日累計賣電量 |
| pv_daily_energy | Number | kWh | — | 今日光伏發電總量 |
| bat_charged_today | Number | kWh | `total_bat_dailyChargedEnergy` | 今日電池充電量 |
| bat_discharged_today | Number | kWh | `total_bat_dailyDischargedEnergy` | 今日電池放電量 |

#### 1.2.2 status 對象（設備健康）

| 字段 | 類型 | 單位 | MQTT identifier 來源 | 描述 |
|------|------|------|----------------------|------|
| battery_soc | Number | % | `bat_soc` | 電池荷電狀態 |
| bat_soh | Number | % | `bat_soh` | 電池健康度 |
| bat_work_status | String | — | `bat_workStatus` | 工作狀態: `"charging"` / `"discharging"` / `"other"` |
| battery_voltage | Number | V | `bat_totalVoltage` | 電池組總電壓 |
| bat_cycle_count | Number | 次 | `bat_cycleNumber` | 循環次數 |
| inverter_temp | Number | °C | `inverter_ambientTemp` | 逆變器環境溫度 |
| is_online | Boolean | — | — | 設備在線狀態 |
| grid_frequency | Number | Hz | — | 電網頻率（巴西=60Hz） |

#### 1.2.3 config 對象（活動規則）

| 字段 | 類型 | 單位 | 描述 |
|------|------|------|------|
| target_mode | String | — | 同 v1.0 `operationMode` |
| min_soc | Number | % | 最低放電 SOC |
| max_charge_rate | Number | kW | 最大充電速率 |
| charge_window_start | String | "HH:MM" | 充電窗口開始 |
| charge_window_end | String | "HH:MM" | 充電窗口結束 |
| discharge_window_start | String | "HH:MM" | 放電窗口開始 |

#### 1.2.4 四個資產初始值

**能量守恆公式**（每個資產必須滿足，±0.5kW 容差）：

```
pv_power + max(grid_power_kw, 0) + max(-battery_power, 0)
≈ load_power + max(-grid_power_kw, 0) + max(battery_power, 0)
```

即：所有輸入功率之和 ≈ 所有輸出功率之和

**四種 HEMS 場景：**

| 資產 | 場景 | PV (kW) | Battery (kW) | Grid (kW) | Load (kW) | 能量守恆驗算 |
|------|------|---------|-------------|-----------|-----------|-------------|
| SP_001 São Paulo | 日間充電：PV發電，電池充電，小量買電 | 6.2 | +2.8 (充電) | +1.6 (import) | 5.0 | 輸入: 6.2+1.6=7.8 / 輸出: 5.0+2.8=7.8 ✅ |
| RJ_002 Rio de Janeiro | 完全自用：PV+電池放電覆蓋全部負載 | 4.5 | -3.0 (放電) | 0.0 (balance) | 7.5 | 輸入: 4.5+3.0=7.5 / 輸出: 7.5+0=7.5 ✅ |
| MG_003 Belo Horizonte | VPP調度中：電池放電，向電網賣電 | 5.8 | -4.2 (放電) | -3.5 (export) | 6.5 | 輸入: 5.8+4.2=10.0 / 輸出: 6.5+3.5=10.0 ✅ |
| PR_004 Curitiba | 削峰：高負載，電池放電限制電網買入 | 4.0 | -2.5 (放電) | +3.0 (import) | 9.5 | 輸入: 4.0+2.5+3.0=9.5 / 輸出: 9.5=9.5 ✅ |

**完整初始值表：**

| 字段 | SP_001 | RJ_002 | MG_003 | PR_004 |
|------|--------|--------|--------|--------|
| **metering** | | | | |
| pv_power | 6.2 kW | 4.5 kW | 5.8 kW | 4.0 kW |
| battery_power | +2.8 kW | -3.0 kW | -4.2 kW | -2.5 kW |
| grid_power_kw | +1.6 kW | 0.0 kW | -3.5 kW | +3.0 kW |
| load_power | 5.0 kW | 7.5 kW | 6.5 kW | 9.5 kW |
| grid_import_kwh | 8.4 kWh | 0.2 kWh | 0.0 kWh | 18.6 kWh |
| grid_export_kwh | 0.0 kWh | 0.0 kWh | 12.8 kWh | 0.0 kWh |
| pv_daily_energy | 24.8 kWh | 18.2 kWh | 22.5 kWh | 15.6 kWh |
| bat_charged_today | 12.5 kWh | 0.0 kWh | 0.0 kWh | 0.0 kWh |
| bat_discharged_today | 0.0 kWh | 14.2 kWh | 18.6 kWh | 11.3 kWh |
| **status** | | | | |
| battery_soc | 72% | 35% | 28% | 45% |
| bat_soh | 96% | 91% | 88% | 78% |
| bat_work_status | "charging" | "discharging" | "discharging" | "discharging" |
| battery_voltage | 52.4 V | 49.8 V | 48.6 V | 47.2 V |
| bat_cycle_count | 245 | 580 | 720 | 1150 |
| inverter_temp | 38 °C | 42 °C | 45 °C | 36 °C |
| is_online | true | true | true | true |
| grid_frequency | 60.02 Hz | 59.98 Hz | 60.01 Hz | 59.99 Hz |
| **config** | | | | |
| target_mode | "peak_valley_arbitrage" | "self_consumption" | "peak_valley_arbitrage" | "peak_shaving" |
| min_soc | 20% | 15% | 10% | 20% |
| max_charge_rate | 5.0 kW | 5.0 kW | 5.0 kW | 5.0 kW |
| charge_window_start | "23:00" | "22:00" | "23:00" | "22:30" |
| charge_window_end | "06:00" | "05:00" | "06:00" | "05:30" |
| discharge_window_start | "17:00" | "08:00" | "18:00" | "18:00" |

> **注意**：SP_001 的 `bat_soh=96%`（健康），PR_004 的 `bat_soh=78%`（需顯示 ⚠️ 警告，閾值 < 80%）。PR_004 的 `bat_cycle_count=1150` 代表高度使用。

---

## 第二章：UI/UX 設計（包含所有 ASCII 線框圖）

### 2.1 Portfolio 頁面升級（新增 KPI + System Health）

#### 2.1.1 兩個新 KPI 卡片

新增至 `.kpi-row-algo`（在現有 3 個 KPI 卡片之後）：

**VPP Dispatch Accuracy：**
- DOM id: `kpiDispatchValue` / `kpiDispatchDelta`
- 默認值: 87.3%, delta: +2.1% vs last week
- 顏色: 綠色 `#059669`（≥85%）, 紅色 `#dc2626`（<85%）
- CSS class: `kpi-dispatch`

```
┌─────────────────────────────────┐
│  VPP Dispatch Accuracy          │
│                                 │
│   87.3%                         │
│   ▲ +2.1% vs last week         │
│                                 │
│   [████████████████░░] 87.3%    │
└─────────────────────────────────┘
```

**DR Response Latency：**
- DOM id: `kpiLatencyValue` / `kpiLatencyDelta`
- 默認值: "12s avg", delta: -3s vs last week
- 顏色: 綠色 `#059669`（< 900s / 15min）, 紅色其他
- CSS class: `kpi-latency`

```
┌─────────────────────────────────┐
│  DR Response Latency            │
│                                 │
│   12s avg                       │
│   ▼ -3s vs last week            │
│                                 │
│   [██░░░░░░░░░░░░░░░░] 1.3%    │
└─────────────────────────────────┘
```

#### 2.1.2 System Health Block

插入位置：KPI 行下方，收益圖表上方。

三個子指標：

| 指標 | 值 | 動態性 | 說明 |
|------|-----|--------|------|
| Gateway Uptime | 99.7% | **STATIC** | 映射 Solfacil "72h offline resilience" 要求 |
| 72h Offline Test | ✅ PASSED / Resumed in 4m23s | **STATIC** | 靜態展示離線恢復能力 |
| Dispatch Success Rate | 156/160 (97.5%) | **MICRO-DYNAMIC** | 成功計數器（156）在每次批量調度操作全部成功後 +1 |

**微動態實現**：通過 `batchState.dispatchSuccessCount` 變量（初始值: 156, 總計: 160）。`executeBatchDispatch()` 完成且全部成功後，`dispatchSuccessCount++` 並重新渲染該指標。

```
╔═══════════════════════════════════════════════════════════════════╗
║  System Health                                                    ║
║                                                                   ║
║  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐ ║
║  │  Gateway Uptime   │  │  72h Offline Test │  │  Dispatch Rate  │ ║
║  │                   │  │                   │  │                 │ ║
║  │     99.7%         │  │  ✅ PASSED        │  │  156/160        │ ║
║  │  [██████████████] │  │  Resumed 4m23s    │  │  (97.5%)        │ ║
║  │     STATIC        │  │     STATIC        │  │  MICRO-DYNAMIC  │ ║
║  └──────────────────┘  └──────────────────┘  └─────────────────┘ ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

### 2.2 Ativos 頁面 — 整體佈局

在 **Ativos (資產管理)** 頁面的現有結構中插入批量操作工具列，並更新卡片結構為含能量流的工程卡片：

```
┌──────────────────────────────────────────────────────────────────┐
│ [header] SOLFACIL - Gestao de Ativos de Energia                  │
├──────────────────────────────────────────────────────────────────┤
│ Portfolio | Arbitragem | ★Ativos | Relatorios                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 資產組合                              2,847 個活躍資產            │
│                                                                  │
│ ┌─────────┬─────────┬─────────┬─────────┐                       │
│ │投資總額  │總容量    │回收期   │內部收益率│  <-- 現有統計          │
│ └─────────┴─────────┴─────────┴─────────┘                       │
│                                                                  │
│ ╔════════════════════════════════════════════════════════════╗   │
│ ║ 🔧 批量操作工具列 (v1.0)                                    ║   │
│ ║ ☑ 全選/取消   已選: 3/4 站點                                ║   │
│ ║ 目標模式: [自發自用▾] [峰谷套利▾] [削峰▾]                  ║   │
│ ║ [🚀 批量下發模式]  [↻ 重置選擇]                             ║   │
│ ╚════════════════════════════════════════════════════════════╝   │
│                                                                  │
│ ┌───────────────────────────┐  ┌───────────────────────────┐    │
│ │ ☑ Sao Paulo  [峰谷套利]   │  │ ☑ Rio de Janeiro [自發自用]│    │
│ │ ┌─────────────────────┐   │  │ ┌─────────────────────┐   │    │
│ │ │   ☀️ PV: 6.2kW       │   │  │ │   ☀️ PV: 4.5kW       │   │    │
│ │ │ 🔋--◇--🏠            │   │  │ │ 🔋--◇--🏠            │   │    │
│ │ │   🔌 Grid: +1.6kW   │   │  │ │   🔌 Grid: 0.0kW    │   │    │
│ │ └─────────────────────┘   │  │ └─────────────────────┘   │    │
│ │ SOC: 72% SOH: 96% 38°C   │  │ SOC: 35% SOH: 91% 42°C   │    │
│ │ ▶ 財務詳情 (collapsed)     │  │ ▶ 財務詳情 (collapsed)     │    │
│ └───────────────────────────┘  └───────────────────────────┘    │
│                                                                  │
│ ┌───────────────────────────┐  ┌───────────────────────────┐    │
│ │ ☐ Belo Horizonte [峰谷]   │  │ ☑ Curitiba [削峰] ⚠️SOH  │    │
│ │ ┌─────────────────────┐   │  │ ┌─────────────────────┐   │    │
│ │ │   ☀️ PV: 5.8kW       │   │  │ │   ☀️ PV: 4.0kW       │   │    │
│ │ │ 🔋--◇--🏠            │   │  │ │ 🔋--◇--🏠            │   │    │
│ │ │   🔌 Grid: -3.5kW   │   │  │ │   🔌 Grid: +3.0kW   │   │    │
│ │ └─────────────────────┘   │  │ └─────────────────────┘   │    │
│ │ SOC: 28% SOH: 88% 45°C   │  │ SOC: 45% SOH: 78%⚠️ 36°C │    │
│ │ ▶ 財務詳情 (collapsed)     │  │ ▶ 財務詳情 (collapsed)     │    │
│ └───────────────────────────┘  └───────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

### 2.3 批量操作工具列設計

```html
<!-- 新增區域: 插入在 .portfolio-overview 和 .sites-grid 之間 -->
<div class="batch-toolbar" id="batchToolbar">
    <!-- 第一行: 選擇控制 -->
    <div class="batch-toolbar-header">
        <div class="batch-toolbar-left">
            <label class="batch-checkbox-wrapper">
                <input type="checkbox" id="selectAllCheckbox">
                <span class="batch-checkmark"></span>
            </label>
            <span class="batch-label" data-translate="select_all">全選</span>
            <span class="batch-divider">|</span>
            <span class="batch-count">
                <span data-translate="selected">已選</span>:
                <strong id="selectedCount">0</strong> /
                <strong id="totalCount">4</strong>
                <span data-translate="sites">站點</span>
            </span>
        </div>
        <button class="batch-reset-btn" id="batchResetBtn" disabled>
            <span class="material-icons">refresh</span>
            <span data-translate="reset_selection">重置選擇</span>
        </button>
    </div>

    <!-- 第二行: 模式選擇 -->
    <div class="batch-toolbar-body">
        <span class="mode-label" data-translate="target_mode">目標模式</span>
        <div class="mode-btn-group" id="modeBtnGroup">
            <button class="mode-btn mode-self-consumption" data-mode="self_consumption">
                <span class="material-icons">home</span>
                <div class="mode-btn-text">
                    <span class="mode-btn-title" data-translate="mode_self_consumption">自發自用</span>
                    <span class="mode-btn-desc" data-translate="mode_self_desc">優先自用, 多餘才賣</span>
                </div>
            </button>
            <button class="mode-btn mode-peak-valley" data-mode="peak_valley_arbitrage">
                <span class="material-icons">swap_vert</span>
                <div class="mode-btn-text">
                    <span class="mode-btn-title" data-translate="mode_peak_valley">峰谷套利</span>
                    <span class="mode-btn-desc" data-translate="mode_pv_desc">全額買入/賣出 (VPP)</span>
                </div>
            </button>
            <button class="mode-btn mode-peak-shaving" data-mode="peak_shaving">
                <span class="material-icons">compress</span>
                <div class="mode-btn-text">
                    <span class="mode-btn-title" data-translate="mode_peak_shaving">削峰模式</span>
                    <span class="mode-btn-desc" data-translate="mode_ps_desc">功率限制, 避免罰款</span>
                </div>
            </button>
        </div>
    </div>

    <!-- 第三行: 執行按鈕 -->
    <div class="batch-toolbar-footer">
        <button class="batch-dispatch-btn" id="batchDispatchBtn" disabled>
            <span class="material-icons">send</span>
            <span data-translate="batch_dispatch">批量下發模式</span>
        </button>
    </div>
</div>
```

---

### 2.4 Site Card 重構設計（v2.0 工程卡片）

完整 ASCII 線框圖：

```
┌──────────────────────────────────────────────────────────┐
│ ZONE 1 — Header                                         │
│ ┌───┐                                                    │
│ │ ☑ │ Sao Paulo - Casa Verde  📍SP  [峰谷套利 ⚡] 🟢online│
│ └───┘                                                    │
├──────────────────────────────────────────────────────────┤
│ ZONE 2 — Diamond Energy Flow Panel                       │
│                                                          │
│                    ☀️ PV                                  │
│                  6.2 kW                                  │
│                    │                                     │
│                    │ <-- amber line #f59e0b               │
│               ╔════╧════╗                                │
│    🔋 Battery ║  FLOW   ║ 🏠 Load                       │
│    72% SOC   <║ CENTER  ║> 5.0 kW                       │
│   ▲ +2.8kW   ║         ║                                │
│  (charging)   ╚════╤════╝                                │
│   blue #3b82f6     │                                     │
│                    │ <-- red line #ef4444                 │
│                 🔌 Grid                                   │
│               +1.6 kW                                    │
│              IMPORT (red)                                │
│                                                          │
│  Line thickness: proportional to power (2px-6px)         │
│  Arrow animation: CSS @keyframes flow-arrow 1.5s         │
│  Line colors:                                            │
│    PV lines     = amber  #f59e0b                         │
│    Bat charging = blue   #3b82f6                         │
│    Bat discharge= green  #10b981                         │
│    Grid import  = red    #ef4444                         │
│    Grid export  = emerald #059669                        │
│    Grid balance = gray dashed, no animation              │
├──────────────────────────────────────────────────────────┤
│ ZONE 3 — Device Health Row                               │
│                                                          │
│  SOC [██████████████░░░░░░] 72%  SOH: 96%  ♻245  38°C  │
│                                                          │
│  Warning rules:                                          │
│    SOH < 80% -> show ⚠️                                  │
│    temp > 55°C -> show 🌡️                                │
│  SOC bar colors:                                         │
│    > 60% = green #059669                                 │
│    20-60% = yellow #d97706                               │
│    < 20% = red #dc2626                                   │
├──────────────────────────────────────────────────────────┤
│ ZONE 4 — Collapsible Financial Section                   │
│                                                          │
│  ▶ 財務詳情                    (default: COLLAPSED)      │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│  │ (When expanded:)                                    │ │
│  │ 🔆 PV Today: 24.8 kWh  |  💰 Saved: R$ 18.65     │ │
│  │ 🔄 Self-use Rate: 82%                              │ │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
└──────────────────────────────────────────────────────────┘
```

**Zone 2 方向邏輯：**

| 條件 | 箭頭方向 | 線條顏色 |
|------|----------|----------|
| `bat_work_status === "charging"` | 箭頭指向電池 (INTO battery) | 藍色 `#3b82f6` |
| `bat_work_status === "discharging"` | 箭頭從電池指出 (OUT of battery) | 綠色 `#10b981` |
| `grid_power_kw > 0` | IMPORT: 電網→負載, 紅色 | 紅色 `#ef4444` |
| `grid_power_kw < 0` | EXPORT: 電池/PV→電網, 綠色 | 翠綠 `#059669` |
| `grid_power_kw ≈ 0` | BALANCE: 灰色虛線, 無動畫 | 灰色 `#94a3b8` dashed |

---

### 2.5 三種運行模式定義

| 模式 | 圖標 | 顏色 | 描述 | 策略邏輯 |
|------|------|------|------|----------|
| **自發自用** `self_consumption` | `home` | 🟢 綠色 `#059669` | 優先自用，多餘才賣 | 儲能優先供給本地負載，餘電上網 |
| **峰谷套利** `peak_valley_arbitrage` | `swap_vert` | 🔵 藍色 `#3730a3` | 全額買入/賣出 (VPP核心) | 谷時滿充，峰時全放，最大化價差收益 |
| **削峰模式** `peak_shaving` | `compress` | 🟠 橙色 `#d97706` | 基於功率限制 | 限制峰值功率，避免需量電費罰款 |

---

### 2.6 確認彈窗設計

```
┌───────────────────────────────────────────┐
│ ⚡ 確認批量模式更改                        │
│                                           │
│ 您即將更改以下站點的運行模式:               │
│                                           │
│ 📍 São Paulo - Casa Verde                 │
│    峰谷套利 → 自發自用                     │
│ 📍 Rio de Janeiro - Copacabana            │
│    峰谷套利 → 自發自用                     │
│ 📍 Curitiba - Batel                       │
│    削峰模式 → 自發自用                     │
│                                           │
│ ⚠️ 模式更改將在下一個調度週期生效            │
│ 預計影響: 3 個站點 / 1,321 台設備           │
│                                           │
│ [✅ 確認下發]  [📋 查看詳情]  [❌ 取消]      │
└───────────────────────────────────────────┘
```

---

### 2.7 執行進度彈窗設計

```
┌───────────────────────────────────────────┐
│ 🔄 批量模式下發中...                       │
│                                           │
│ 總進度: ████████████░░░░ 2/3              │
│                                           │
│ ✅ São Paulo - Casa Verde        成功      │
│    → 自發自用 (948 台設備已切換)            │
│                                           │
│ ⏳ Rio de Janeiro - Copacabana   執行中... │
│    → 自發自用 (進度: 65%)                  │
│    ░░░░░░░░░░░░░░ 65%                     │
│                                           │
│ ⏸  Curitiba - Batel             等待中    │
│    → 自發自用                              │
│                                           │
│ [關閉] (執行完成後可關閉)                   │
└───────────────────────────────────────────┘
```

---

### 2.8 執行結果彈窗

```
┌───────────────────────────────────────────┐
│ ✅ 批量模式更改完成                        │
│                                           │
│ 成功: 2/3 站點  |  失敗: 1/3 站點          │
│                                           │
│ ✅ São Paulo - Casa Verde        成功      │
│ ✅ Rio de Janeiro - Copacabana   成功      │
│ ❌ Curitiba - Batel             失敗      │
│    原因: 設備通信超時 (重試 3/3)           │
│                                           │
│ [🔄 重試失敗項]  [📊 查看報告]  [✖ 關閉]   │
└───────────────────────────────────────────┘
```

---

## 第三章：代碼邏輯與數據流設計

### 3.1 運行模式定義 OPERATION_MODES

```javascript
// 插入位置: app.js, mockData 定義之後
const OPERATION_MODES = {
    self_consumption: {
        key: 'self_consumption',
        icon: 'home',
        color: '#059669',
        bgColor: '#ecfdf5',
        borderColor: '#a7f3d0'
    },
    peak_valley_arbitrage: {
        key: 'peak_valley_arbitrage',
        icon: 'swap_vert',
        color: '#3730a3',
        bgColor: '#eef2ff',
        borderColor: '#c7d2fe'
    },
    peak_shaving: {
        key: 'peak_shaving',
        icon: 'compress',
        color: '#d97706',
        bgColor: '#fffbeb',
        borderColor: '#fde68a'
    }
};
```

---

### 3.2 批量狀態管理 batchState

```javascript
// 插入位置: 全局變量區塊
const batchState = {
    selectedAssets: new Set(),       // 選中的資產 ID 集合
    targetMode: null,                // 目標模式 key
    isDispatching: false,            // 是否正在下發
    dispatchResults: [],             // 下發結果
    dispatchSuccessCount: 156,       // v2.0 新增: 當前成功調度次數 (micro-dynamic)
    dispatchTotalCount: 160          // v2.0 新增: 本月總調度次數
};
```

---

### 3.3 mockData.assets 擴充

完整 JavaScript 對象結構（以 SP_001 為例）：

```javascript
{
    // ===== v1.0 原有字段 =====
    id: 'ASSET_SP_001',
    name: 'São Paulo - Casa Verde',
    region: 'SP',
    status: 'operando',
    investimento: 4200000,
    capacidade: 5.2,           // MWh
    unidades: 948,
    socMedio: 65,              // %
    receitaHoje: 18650,
    receitaMes: 412300,
    roi: 19.2,
    custoHoje: 4250,
    lucroHoje: 14400,
    payback: '3,8',
    operationMode: 'peak_valley_arbitrage',   // v1.0 新增

    // ===== v2.0 新增: metering 即時功率流 =====
    metering: {
        pv_power: 6.2,              // kW - MQTT: pv_totalPower
        battery_power: 2.8,         // kW - 正=充電 - MQTT: bat_totalPower
        grid_power_kw: 1.6,         // kW - 正=import - MQTT: grid_activePower
        load_power: 5.0,            // kW - MQTT: flload_totalPower
        grid_import_kwh: 8.4,       // kWh - MQTT: grid_positiveEnergy
        grid_export_kwh: 0.0,       // kWh - MQTT: grid_negativeEnergy
        pv_daily_energy: 24.8,      // kWh
        bat_charged_today: 12.5,    // kWh - MQTT: total_bat_dailyChargedEnergy
        bat_discharged_today: 0.0   // kWh - MQTT: total_bat_dailyDischargedEnergy
    },

    // ===== v2.0 新增: status 設備健康 =====
    status: {
        battery_soc: 72,            // % - MQTT: bat_soc
        bat_soh: 96,                // % - MQTT: bat_soh
        bat_work_status: 'charging',// MQTT: bat_workStatus
        battery_voltage: 52.4,      // V - MQTT: bat_totalVoltage
        bat_cycle_count: 245,       // 次 - MQTT: bat_cycleNumber
        inverter_temp: 38,          // °C - MQTT: inverter_ambientTemp
        is_online: true,
        grid_frequency: 60.02       // Hz (巴西=60Hz)
    },

    // ===== v2.0 新增: config 活動規則 =====
    config: {
        target_mode: 'peak_valley_arbitrage',
        min_soc: 20,                // %
        max_charge_rate: 5.0,       // kW
        charge_window_start: '23:00',
        charge_window_end: '06:00',
        discharge_window_start: '17:00'
    }
}
```

---

### 3.4 批量工具列邏輯（6 個函數完整偽代碼）

```javascript
function initBatchToolbar() {
    // 綁定"全選" checkbox 事件
    // 綁定"重置" 按鈕事件
    // 綁定模式選擇按鈕事件
    // 綁定"批量下發" 按鈕事件
    // 初始化 UI 狀態
}

function toggleAssetSelection(assetId) {
    // 切換單個資產的選中狀態
    // 更新 batchState.selectedAssets
    // 更新全選 checkbox 狀態 (全選/部分選/不選)
    // 調用 updateBatchUI()
}

function toggleSelectAll() {
    // 如果當前非全選 → 選中全部
    // 如果當前全選 → 取消全部
    // 更新所有卡片的 checkbox
    // 調用 updateBatchUI()
}

function updateBatchUI() {
    // 更新選中計數顯示
    // 更新按鈕啟用/禁用狀態:
    //   - 選中 > 0 且 targetMode != null → 啟用"批量下發"
    //   - 選中 > 0 → 啟用"重置"
    //   - 否則全部禁用
    // 更新選中卡片的視覺高亮
}

function selectMode(mode) {
    // 設置 batchState.targetMode = mode
    // 更新模式按鈕的 active 狀態
    // 調用 updateBatchUI()
}

function resetBatchSelection() {
    // 清空 batchState.selectedAssets
    // 清空 batchState.targetMode
    // 重置所有 checkbox
    // 重置模式按鈕
    // 調用 updateBatchUI()
}
```

---

### 3.5 Site Card 渲染邏輯（v2.0 重構版）

#### 3.5.1 改造 populateAssets()

保留 checkbox 邏輯，新增三個渲染函數調用：

```javascript
function populateAssets() {
    const grid = document.getElementById('assetsGrid');
    if (!grid) return;

    mockData.assets.forEach(asset => {
        const card = document.createElement('div');
        card.className = 'site-card';
        card.setAttribute('data-asset-id', asset.id);

        const modeConfig = OPERATION_MODES[asset.operationMode];
        const isSelected = batchState.selectedAssets.has(asset.id);
        const isOnline = asset.status?.is_online !== false;

        card.innerHTML = `
            <!-- ZONE 1: Header -->
            <div class="site-header">
                <div class="site-name">
                    <label class="asset-checkbox-wrapper" onclick="event.stopPropagation()">
                        <input type="checkbox"
                               class="asset-checkbox"
                               data-asset-id="${asset.id}"
                               ${isSelected ? 'checked' : ''}
                               onchange="toggleAssetSelection('${asset.id}')">
                        <span class="asset-checkmark"></span>
                    </label>
                    <span class="material-icons asset-region-icon">location_on</span>
                    ${asset.name}
                </div>
                <div class="asset-mode-badge"
                     style="background:${modeConfig.bgColor};
                            color:${modeConfig.color};
                            border:1px solid ${modeConfig.borderColor}">
                    <span class="material-icons tiny-icon">${modeConfig.icon}</span>
                    ${t('current_mode')}: ${t('mode_' + asset.operationMode)}
                </div>
                <div class="online-status ${isOnline ? 'online' : 'offline'}">
                    <span class="status-dot"></span>
                </div>
            </div>

            <!-- ZONE 2: Diamond Energy Flow -->
            ${renderEnergyFlow(asset)}

            <!-- ZONE 3: Device Health Row -->
            ${renderDeviceHealth(asset)}

            <!-- ZONE 4: Collapsible Financial -->
            ${renderFinancialCollapsible(asset)}
        `;

        // 卡片點擊事件（點擊卡片也能切換選中）
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.asset-checkbox-wrapper') &&
                !e.target.closest('.financial-toggle')) {
                toggleAssetSelection(asset.id);
            }
        });

        grid.appendChild(card);
    });
}
```

#### 3.5.2 renderEnergyFlow(asset)

```javascript
function renderEnergyFlow(asset) {
    // 返回 HTML 字符串 — 菱形能量流面板
    const m = asset.metering;
    const s = asset.status;
    const flow = getFlowDirection(asset);
    const isOnline = s.is_online;

    // 如果離線: 灰化面板，顯示 "--" 佔位符
    if (!isOnline) {
        return `<div class="energy-flow-panel offline">
            <div class="ef-node ef-node-pv">☀️ -- kW</div>
            <div class="ef-node ef-node-bat">🔋 --% ⏸ -- kW</div>
            <div class="ef-node ef-node-load">🏠 -- kW</div>
            <div class="ef-node ef-node-grid">🔌 -- kW</div>
        </div>`;
    }

    // 電池狀態圖標
    const batIcon = s.bat_work_status === 'charging' ? '▲' :
                    s.bat_work_status === 'discharging' ? '▼' : '⏸';

    // 電網方向標籤
    const gridLabel = m.grid_power_kw > 0.1 ? 'IMPORT' :
                      m.grid_power_kw < -0.1 ? 'EXPORT' : 'BALANCE';
    const gridClass = m.grid_power_kw > 0.1 ? 'grid-import' :
                      m.grid_power_kw < -0.1 ? 'grid-export' : 'grid-balance';

    // 線條粗細計算（2px-6px 根據功率）
    // CSS 變量: --pv-line-width, --bat-line-width, --grid-line-width

    return `
    <div class="energy-flow-panel"
         style="--pv-line-w:${lineWidth(m.pv_power)}px;
                --bat-line-w:${lineWidth(Math.abs(m.battery_power))}px;
                --grid-line-w:${lineWidth(Math.abs(m.grid_power_kw))}px;">
        <div class="ef-node ef-node-pv">
            ☀️ <span class="ef-value">${m.pv_power.toFixed(1)} kW</span>
        </div>
        <div class="ef-line ef-line-pv"></div>
        <div class="ef-node ef-node-bat">
            🔋 ${s.battery_soc}% ${batIcon}
            <span class="ef-value">${Math.abs(m.battery_power).toFixed(1)} kW</span>
        </div>
        <div class="ef-center"></div>
        <div class="ef-node ef-node-load">
            🏠 <span class="ef-value">${m.load_power.toFixed(1)} kW</span>
        </div>
        <div class="ef-line ef-line-bat ${s.bat_work_status}"></div>
        <div class="ef-line ef-line-grid ${gridClass}"></div>
        <div class="ef-node ef-node-grid ${gridClass}">
            🔌 <span class="ef-value">${Math.abs(m.grid_power_kw).toFixed(1)} kW</span>
            <span class="grid-direction-label">${gridLabel}</span>
        </div>
    </div>`;
}

function lineWidth(powerKw) {
    // 2px min, 6px max, 線性映射 0-10kW
    return Math.max(2, Math.min(6, 2 + (powerKw / 10) * 4));
}
```

#### 3.5.3 renderDeviceHealth(asset)

```javascript
function renderDeviceHealth(asset) {
    const s = asset.status;
    const isOnline = s.is_online;

    if (!isOnline) {
        return `<div class="device-health-row offline">
            <span class="health-metric">SOC: --</span>
            <span class="health-metric">SOH: --</span>
        </div>`;
    }

    // SOC 進度條顏色
    const socColor = s.battery_soc > 60 ? '#059669' :
                     s.battery_soc >= 20 ? '#d97706' : '#dc2626';

    // 警告指標
    const sohWarning = s.bat_soh < 80 ? ' ⚠️' : '';
    const tempWarning = s.inverter_temp > 55 ? ' 🌡️' : '';

    return `
    <div class="device-health-row">
        <div class="soc-bar-container">
            <span class="health-label">SOC</span>
            <div class="soc-bar">
                <div class="soc-fill" style="width:${s.battery_soc}%;background:${socColor}"></div>
            </div>
            <span class="health-value">${s.battery_soc}%</span>
        </div>
        <span class="health-metric">SOH: ${s.bat_soh}%${sohWarning}</span>
        <span class="health-metric">♻${s.bat_cycle_count}</span>
        <span class="health-metric">${s.inverter_temp}°C${tempWarning}</span>
    </div>`;
}
```

#### 3.5.4 renderFinancialCollapsible(asset)

```javascript
function renderFinancialCollapsible(asset) {
    const m = asset.metering;
    // 今日節省 = 根據 receitaHoje 或計算
    const todaySaved = (asset.receitaHoje / 100).toFixed(2); // 轉換為 R$
    // 自用率 = (pv_daily_energy - grid_export_kwh) / pv_daily_energy * 100
    const selfUseRate = m.pv_daily_energy > 0
        ? Math.round(((m.pv_daily_energy - m.grid_export_kwh) / m.pv_daily_energy) * 100)
        : 0;

    return `
    <div class="financial-collapsible">
        <button class="financial-toggle" onclick="event.stopPropagation(); this.parentElement.classList.toggle('expanded')">
            ▶ ${t('today_financial')}
        </button>
        <div class="financial-content">
            <span class="fin-metric">🔆 ${t('pv_generation')}: ${m.pv_daily_energy} kWh</span>
            <span class="fin-metric">💰 ${t('today_saved')}: R$ ${todaySaved}</span>
            <span class="fin-metric">🔄 ${t('self_use_rate')}: ${selfUseRate}%</span>
        </div>
    </div>`;
}
```

#### 3.5.5 getFlowDirection(asset)

```javascript
function getFlowDirection(asset) {
    const m = asset.metering;
    const s = asset.status;

    return {
        pvToLoad: Math.min(m.pv_power, m.load_power),
        pvToBat: s.bat_work_status === 'charging'
            ? Math.max(0, m.pv_power - m.load_power)
            : 0,
        batToLoad: s.bat_work_status === 'discharging'
            ? Math.min(Math.abs(m.battery_power), m.load_power)
            : 0,
        batToGrid: s.bat_work_status === 'discharging' && m.grid_power_kw < 0
            ? Math.abs(m.grid_power_kw)
            : 0,
        gridToLoad: m.grid_power_kw > 0
            ? m.grid_power_kw
            : 0
    };
}
```

---

### 3.6 批量下發流程（完整代碼邏輯）

```javascript
function startBatchDispatch() {
    // 前置校驗
    if (batchState.selectedAssets.size === 0 || !batchState.targetMode) return;

    // 過濾掉目標模式與當前模式相同的資產
    const assetsToChange = getAssetsToChange();
    if (assetsToChange.length === 0) {
        // 提示: 所有選中站點已在目標模式下
        return;
    }

    showConfirmModal(assetsToChange);
}

function getAssetsToChange() {
    return mockData.assets.filter(asset =>
        batchState.selectedAssets.has(asset.id) &&
        asset.operationMode !== batchState.targetMode
    );
}

function showConfirmModal(assetsToChange) {
    // 構建確認彈窗內容
    // 顯示: 站點列表 + 模式變更方向 + 影響設備數量
    // 按鈕: [確認下發] [取消]
    const modal = document.getElementById('batchConfirmModal');
    // ... 填充內容 ...
    modal.classList.add('show');
}

async function executeBatchDispatch() {
    // 關閉確認彈窗
    document.getElementById('batchConfirmModal').classList.remove('show');

    // 顯示進度彈窗
    const progressModal = document.getElementById('batchProgressModal');
    progressModal.classList.add('show');

    batchState.isDispatching = true;
    batchState.dispatchResults = [];
    const assetsToChange = getAssetsToChange();

    // 初始化進度 UI
    renderProgressList(assetsToChange);

    // 逐個執行模式切換 (模擬異步過程)
    for (let i = 0; i < assetsToChange.length; i++) {
        const asset = assetsToChange[i];
        updateDispatchProgress(asset.id, 'executing', 0);

        const result = await simulateAssetModeChange(asset, batchState.targetMode);

        batchState.dispatchResults.push(result);
        updateDispatchProgress(asset.id, result.success ? 'success' : 'failed', 100);

        // 如果成功, 更新 mockData 中的模式
        if (result.success) {
            asset.operationMode = batchState.targetMode;
        }
    }

    batchState.isDispatching = false;

    // v2.0 新增: 如果全部成功, 更新 System Health Dispatch Success Rate
    const allSucceeded = batchState.dispatchResults.every(r => r.success);
    if (allSucceeded) {
        batchState.dispatchSuccessCount++;
        updateSystemHealth();
    }

    // 顯示結果摘要
    showDispatchResult(batchState.dispatchResults);

    // 刷新資產卡片以反映新模式
    const grid = document.getElementById('assetsGrid');
    grid.innerHTML = '';
    populateAssets();
}

function simulateAssetModeChange(asset, newMode) {
    // 模擬異步API調用
    // 返回 Promise, 模擬 2-4 秒延遲
    // 90% 成功率, 10% 隨機失敗
    return new Promise((resolve) => {
        const duration = 2000 + Math.random() * 2000;
        const steps = 10;
        let currentStep = 0;

        const interval = setInterval(() => {
            currentStep++;
            const progress = Math.round((currentStep / steps) * 100);
            updateDispatchProgress(asset.id, 'executing', progress);

            if (currentStep >= steps) {
                clearInterval(interval);
                const success = Math.random() > 0.1; // 90% 成功率
                resolve({
                    assetId: asset.id,
                    assetName: asset.name,
                    fromMode: asset.operationMode,
                    toMode: newMode,
                    success: success,
                    error: success ? null : 'communication_timeout',
                    units: asset.unidades,
                    timestamp: new Date().toISOString()
                });
            }
        }, duration / steps);
    });
}

function updateDispatchProgress(assetId, status, progress) {
    // 更新進度彈窗中對應站點的狀態
    const item = document.querySelector(`[data-progress-asset="${assetId}"]`);
    if (!item) return;

    const statusIcon = item.querySelector('.progress-status-icon');
    const progressBar = item.querySelector('.dispatch-progress-fill');
    const statusText = item.querySelector('.progress-status-text');

    // 更新圖標
    if (status === 'executing') {
        statusIcon.textContent = 'sync';
        statusIcon.className = 'material-icons progress-status-icon spinning';
        statusText.textContent = `${progress}%`;
    } else if (status === 'success') {
        statusIcon.textContent = 'check_circle';
        statusIcon.className = 'material-icons progress-status-icon status-success';
        statusText.textContent = t('dispatch_success');
    } else if (status === 'failed') {
        statusIcon.textContent = 'error';
        statusIcon.className = 'material-icons progress-status-icon status-failed';
        statusText.textContent = t('dispatch_failed');
    } else if (status === 'waiting') {
        statusIcon.textContent = 'hourglass_empty';
        statusIcon.className = 'material-icons progress-status-icon status-waiting';
        statusText.textContent = t('dispatch_waiting');
    }

    // 更新進度條
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }

    // 更新總進度
    updateOverallProgress();
}

function updateOverallProgress() {
    const total = getAssetsToChange().length;
    const completed = batchState.dispatchResults.length;
    const overallBar = document.getElementById('overallProgressFill');
    const overallText = document.getElementById('overallProgressText');

    if (overallBar) overallBar.style.width = `${(completed / total) * 100}%`;
    if (overallText) overallText.textContent = `${completed} / ${total}`;
}

function showDispatchResult(results) {
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    // 更新進度彈窗為結果視圖
    // 顯示成功/失敗統計
    // 如果有失敗項, 顯示"重試失敗項"按鈕
}

function retryFailedItems() {
    const failedAssets = batchState.dispatchResults
        .filter(r => !r.success)
        .map(r => mockData.assets.find(a => a.id === r.assetId));

    // 重置失敗項
    batchState.dispatchResults = batchState.dispatchResults.filter(r => r.success);

    // 重新執行失敗項
    // (復用 executeBatchDispatch 邏輯)
}

// v2.0 新增: 更新 System Health Dispatch Success Rate 顯示
function updateSystemHealth() {
    const countEl = document.getElementById('sh-dispatch-count');
    const totalEl = document.getElementById('sh-dispatch-total');
    if (countEl) countEl.textContent = batchState.dispatchSuccessCount;
    if (totalEl) totalEl.textContent = batchState.dispatchTotalCount;

    // 更新百分比
    const pct = ((batchState.dispatchSuccessCount / batchState.dispatchTotalCount) * 100).toFixed(1);
    const pctEl = document.querySelector('.sh-dispatch-pct');
    if (pctEl) pctEl.textContent = `(${pct}%)`;
}
```

---

### 3.7 翻譯系統擴充

詳見第五章 §5.1 完整翻譯鍵表。

---

### 3.8 數據流時序圖

```
用戶操作                     batchState              UI更新
  │                            │                       │
  │ 1. 點擊 checkbox           │                       │
  ├──────────────────────────►│                       │
  │     toggleAssetSelection() │                       │
  │                            │ selectedAssets.add()  │
  │                            ├──────────────────────►│
  │                            │   updateBatchUI()     │
  │                            │   → 計數, 高亮, 按鈕   │
  │                            │                       │
  │ 2. 選擇模式                 │                       │
  ├──────────────────────────►│                       │
  │     selectMode()           │                       │
  │                            │ targetMode = mode     │
  │                            ├──────────────────────►│
  │                            │   → 模式按鈕高亮       │
  │                            │   → 下發按鈕啟用       │
  │                            │                       │
  │ 3. 點擊"批量下發"           │                       │
  ├──────────────────────────►│                       │
  │     startBatchDispatch()   │                       │
  │                            │ 過濾需更改的站點       │
  │                            ├──────────────────────►│
  │                            │   showConfirmModal()  │
  │                            │                       │
  │ 4. 確認                    │                       │
  ├──────────────────────────►│                       │
  │     executeBatchDispatch() │                       │
  │                            │ isDispatching = true  │
  │                            ├──────────────────────►│
  │                            │  顯示進度彈窗          │
  │                            │                       │
  │                            │ 逐站點模擬切換         │
  │                            │  ┌───────────────┐    │
  │                            │  │ simulate...() │    │
  │                            │  │ 進度回調       │───►│ 進度條更新
  │                            │  │               │    │
  │                            │  │ resolve()     │    │
  │                            │  └───────────────┘    │
  │                            │                       │
  │                            │ asset.operationMode   │
  │                            │   = newMode           │
  │                            │                       │
  │                            │ v2.0: allSucceeded?   │
  │                            │ dispatchSuccessCount++│
  │                            │ updateSystemHealth()  │
  │                            │                       │
  │                            │ dispatchResults.push()│
  │                            ├──────────────────────►│
  │                            │  showDispatchResult() │
  │                            │  populateAssets()     │
  │                            │  (含能量流+健康行)     │
```

---

### 3.9 實時更新擴充

```javascript
function startRealTimeUpdates() {
    // 現有: 每 5 秒更新 Portfolio 數據

    setInterval(() => {
        // ... 現有 Portfolio 更新邏輯 ...

        // v2.0 新增: 如果 Ativos section 可見, 更新 metering 數據
        if (document.getElementById('ativos')?.classList.contains('active')) {
            mockData.assets.forEach(asset => {
                if (!asset.status.is_online) return;

                const m = asset.metering;

                // 隨機遊走 PV 功率 (±0.2kW)
                m.pv_power = Math.max(0, m.pv_power + (Math.random() - 0.5) * 0.4);

                // 隨機遊走 Battery 功率 (±0.2kW)
                m.battery_power = m.battery_power + (Math.random() - 0.5) * 0.4;

                // 維護能量守恆: 調整 grid_power_kw 以補償
                // grid = load + max(bat_charging, 0) - pv - max(bat_discharging, 0)
                m.grid_power_kw = m.load_power
                    + Math.max(m.battery_power, 0)
                    - m.pv_power
                    - Math.max(-m.battery_power, 0);

                // 四捨五入到 1 位小數
                m.pv_power = Math.round(m.pv_power * 10) / 10;
                m.battery_power = Math.round(m.battery_power * 10) / 10;
                m.grid_power_kw = Math.round(m.grid_power_kw * 10) / 10;
            });

            // 增量刷新: 僅更新功率數值 (不做完整卡片重新渲染)
            refreshEnergyFlowValues();
        }

        // System Health: Gateway Uptime 和 72h Offline Test → STATIC (不動畫)
        // Dispatch Success Rate → 僅在 executeBatchDispatch 成功後更新

    }, 5000);
}

function refreshEnergyFlowValues() {
    // 遍歷所有可見的 site-card
    // 對每個卡片, 僅更新 .ef-node 中的功率數字
    // 不重新渲染整個卡片 DOM, 避免 checkbox 狀態丟失
    mockData.assets.forEach(asset => {
        const card = document.querySelector(`[data-asset-id="${asset.id}"]`);
        if (!card) return;

        const m = asset.metering;
        const pvNode = card.querySelector('.ef-node-pv');
        const batNode = card.querySelector('.ef-node-bat');
        const loadNode = card.querySelector('.ef-node-load');
        const gridNode = card.querySelector('.ef-node-grid');

        if (pvNode) {
            const val = pvNode.querySelector('.ef-value');
            if (val) val.textContent = `${m.pv_power.toFixed(1)} kW`;
        }
        if (batNode) {
            const val = batNode.querySelector('.ef-value');
            if (val) val.textContent = `${Math.abs(m.battery_power).toFixed(1)} kW`;
        }
        if (loadNode) {
            const val = loadNode.querySelector('.ef-value');
            if (val) val.textContent = `${m.load_power.toFixed(1)} kW`;
        }
        if (gridNode) {
            const val = gridNode.querySelector('.ef-value');
            if (val) val.textContent = `${Math.abs(m.grid_power_kw).toFixed(1)} kW`;
            // 更新方向標籤
            const label = gridNode.querySelector('.grid-direction-label');
            if (label) {
                label.textContent = m.grid_power_kw > 0.1 ? 'IMPORT' :
                                    m.grid_power_kw < -0.1 ? 'EXPORT' : 'BALANCE';
            }
        }
    });
}
```

---

## 第四章：HTML/CSS 修改清單

### 4.1 文件修改矩陣

| 文件 | 修改類型 | 主要修改 | 預估行數 |
|------|----------|----------|----------|
| `index.html` | 修改 | 新增 2 個 KPI 卡片 + System Health block + 批量工具列 + 2 個 Modal | +120 行 |
| `js/app.js` | 修改 | metering/status/config 數據 + 能量流渲染 + 健康行 + 折疊財務 + System Health 更新 | +450 行 |
| `css/style.css` | 修改 | 能量流菱形 + 健康行 + 折疊面板 + 批量工具列 + KPI/System Health | +400 行 |
| `js/i18n.js` | 修改 | 新增 17 個翻譯鍵 (zh/en/pt) | +60 行 |

---

### 4.2 index.html 新增 HTML 結構

#### 4.2.1 兩個新 KPI 卡片容器

插入位置：`.kpi-row-algo` 現有 3 個 KPI 之後

```html
<!-- VPP Dispatch Accuracy KPI -->
<div class="kpi-card kpi-dispatch">
    <div class="kpi-label" data-translate="vpp_dispatch_accuracy">VPP 調度精準率</div>
    <div class="kpi-value" id="kpiDispatchValue">87.3%</div>
    <div class="kpi-delta positive" id="kpiDispatchDelta">
        <span class="material-icons">trending_up</span> +2.1% vs last week
    </div>
    <div class="kpi-bar">
        <div class="kpi-bar-fill" style="width: 87.3%; background: #059669;"></div>
    </div>
</div>

<!-- DR Response Latency KPI -->
<div class="kpi-card kpi-latency">
    <div class="kpi-label" data-translate="dr_response_latency">DR 響應延遲</div>
    <div class="kpi-value" id="kpiLatencyValue">12s avg</div>
    <div class="kpi-delta positive" id="kpiLatencyDelta">
        <span class="material-icons">trending_down</span> -3s vs last week
    </div>
    <div class="kpi-bar">
        <div class="kpi-bar-fill" style="width: 1.3%; background: #059669;"></div>
    </div>
</div>
```

#### 4.2.2 System Health Block

插入位置：KPI 行下方，收益圖表上方

```html
<!-- System Health Block -->
<div class="system-health-block" id="systemHealthBlock">
    <h3 class="sh-title">
        <span class="material-icons">monitor_heart</span>
        <span data-translate="system_health">系統健康度</span>
    </h3>
    <div class="sh-metrics">
        <!-- Gateway Uptime (STATIC) -->
        <div class="sh-metric" id="sh-uptime">
            <div class="sh-metric-label" data-translate="gateway_uptime">網關在線率</div>
            <div class="sh-metric-value">99.7%</div>
            <div class="sh-metric-bar">
                <div class="sh-bar-fill" style="width: 99.7%; background: #059669;"></div>
            </div>
        </div>

        <!-- 72h Offline Test (STATIC) -->
        <div class="sh-metric" id="sh-offline-test">
            <div class="sh-metric-label" data-translate="offline_test_passed">72h 斷線測試通過</div>
            <div class="sh-metric-value">✅ PASSED</div>
            <div class="sh-metric-detail">Resumed in 4m23s</div>
        </div>

        <!-- Dispatch Success Rate (MICRO-DYNAMIC) -->
        <div class="sh-metric" id="sh-dispatch-rate">
            <div class="sh-metric-label" data-translate="dispatch_success_rate">調度成功率</div>
            <div class="sh-metric-value">
                <span id="sh-dispatch-count">156</span>/<span id="sh-dispatch-total">160</span>
                <span class="sh-dispatch-pct">(97.5%)</span>
            </div>
            <div class="sh-metric-bar">
                <div class="sh-bar-fill" style="width: 97.5%; background: #059669;"></div>
            </div>
        </div>
    </div>
</div>
```

#### 4.2.3 站點卡片

不需要 HTML 模板變更 — 由 JS 動態渲染 (`populateAssets()`)。

---

### 4.3 CSS 新增樣式清單

#### a. KPI 新卡片變體

```css
.kpi-dispatch .kpi-value,
.kpi-latency .kpi-value {
    font-size: 2rem;
    font-weight: 700;
}

.kpi-dispatch .kpi-value { color: #059669; }
.kpi-latency .kpi-value { color: #059669; }

/* 低於閾值時變紅 */
.kpi-dispatch.warning .kpi-value { color: #dc2626; }
.kpi-latency.warning .kpi-value { color: #dc2626; }

.kpi-bar {
    height: 4px;
    background: #e2e8f0;
    border-radius: 2px;
    margin-top: 0.5rem;
}

.kpi-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
}
```

#### b. System Health Block

```css
.system-health-block {
    background: white;
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    margin-bottom: 1.5rem;
    border: 1px solid #e2e8f0;
}

.sh-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 1rem;
}

.sh-title .material-icons {
    color: #059669;
    font-size: 1.2rem;
}

.sh-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
}

.sh-metric {
    text-align: center;
}

.sh-metric-label {
    font-size: 0.8rem;
    color: #64748b;
    margin-bottom: 0.5rem;
}

.sh-metric-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
}

.sh-metric-detail {
    font-size: 0.75rem;
    color: #94a3b8;
    margin-top: 0.25rem;
}

.sh-metric-bar {
    height: 4px;
    background: #e2e8f0;
    border-radius: 2px;
    margin-top: 0.5rem;
}

.sh-bar-fill {
    height: 100%;
    border-radius: 2px;
}
```

#### c. Energy Flow Diamond Panel

```css
.energy-flow-panel {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: auto auto auto;
    gap: 0;
    padding: 1rem;
    position: relative;
    min-height: 160px;
    align-items: center;
    justify-items: center;
}

.energy-flow-panel.offline {
    opacity: 0.4;
    filter: grayscale(100%);
}
```

#### d. Energy Flow Nodes

```css
.ef-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.4rem 0.6rem;
    border-radius: 8px;
    z-index: 2;
}

.ef-node-pv {
    grid-column: 2;
    grid-row: 1;
    color: #f59e0b;
    background: #fffbeb;
    border: 1px solid #fde68a;
}

.ef-node-bat {
    grid-column: 1;
    grid-row: 2;
    color: #3b82f6;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
}

.ef-node-load {
    grid-column: 3;
    grid-row: 2;
    color: #6366f1;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
}

.ef-node-grid {
    grid-column: 2;
    grid-row: 3;
    color: #64748b;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
}

.ef-node-grid.grid-import {
    color: #ef4444;
    background: #fef2f2;
    border-color: #fecaca;
}

.ef-node-grid.grid-export {
    color: #059669;
    background: #ecfdf5;
    border-color: #a7f3d0;
}
```

#### e. Connecting Lines with Direction Arrows

```css
.ef-line {
    position: absolute;
    z-index: 1;
}

.ef-line-pv {
    width: var(--pv-line-w, 3px);
    background: #f59e0b;
}

.ef-line-bat {
    height: var(--bat-line-w, 3px);
}

.ef-line-bat.charging {
    background: #3b82f6;
}

.ef-line-bat.discharging {
    background: #10b981;
}

.ef-line-grid {
    width: var(--grid-line-w, 3px);
}

.ef-line-grid.grid-import {
    background: #ef4444;
}

.ef-line-grid.grid-export {
    background: #059669;
}

.ef-line-grid.grid-balance {
    background: transparent;
    border-left: 2px dashed #94a3b8;
}

.ef-arrow {
    position: absolute;
    width: 8px;
    height: 8px;
}
```

#### f. Flow Arrow Animation

```css
@keyframes flow-arrow {
    0% {
        transform: translateY(0);
        opacity: 1;
    }
    100% {
        transform: translateY(20px);
        opacity: 0.3;
    }
}

/* 水平方向箭頭 */
@keyframes flow-arrow-h {
    0% {
        transform: translateX(0);
        opacity: 1;
    }
    100% {
        transform: translateX(20px);
        opacity: 0.3;
    }
}

.ef-line .ef-arrow {
    animation: flow-arrow 1.5s linear infinite;
}

.ef-line-bat .ef-arrow {
    animation: flow-arrow-h 1.5s linear infinite;
}

/* Grid balance: no animation */
.ef-line-grid.grid-balance .ef-arrow {
    animation: none;
    display: none;
}
```

#### g. Device Health Row

```css
.device-health-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 1rem;
    background: #f8fafc;
    border-top: 1px solid #f1f5f9;
    font-size: 0.8rem;
}

.device-health-row.offline {
    opacity: 0.4;
}

.health-metric {
    color: #475569;
    font-weight: 500;
    white-space: nowrap;
}

.soc-bar-container {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
}

.health-label {
    font-weight: 600;
    color: #334155;
    font-size: 0.75rem;
}

.soc-bar {
    flex: 1;
    height: 8px;
    background: #e2e8f0;
    border-radius: 4px;
    overflow: hidden;
    min-width: 60px;
}

.soc-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s ease, background 0.3s ease;
}

.health-value {
    font-weight: 600;
    color: #334155;
    font-size: 0.8rem;
    min-width: 32px;
}
```

#### h. Collapsible Financial Section

```css
.financial-collapsible {
    border-top: 1px solid #f1f5f9;
    overflow: hidden;
}

.financial-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    color: #64748b;
    transition: color 0.2s ease;
}

.financial-toggle:hover {
    color: #3730a3;
}

.financial-content {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease, padding 0.3s ease;
    padding: 0 1rem;
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
}

.financial-collapsible.expanded .financial-toggle {
    color: #3730a3;
}

.financial-collapsible.expanded .financial-content {
    max-height: 100px;
    padding: 0.5rem 1rem 0.75rem;
}

.fin-metric {
    font-size: 0.8rem;
    color: #475569;
    white-space: nowrap;
}
```

#### i. v1.0 保留的 CSS 樣式

**批量工具列樣式：**

```css
/* ============================================
   Batch Operations Toolbar
   ============================================ */
.batch-toolbar {
    background: white;
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    margin-bottom: 1.5rem;
    border: 2px solid #e2e8f0;
    transition: border-color 0.3s ease;
}

.batch-toolbar.has-selection {
    border-color: #3730a3;
    box-shadow: 0 2px 8px rgba(55, 48, 163, 0.1);
}

.batch-toolbar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #f1f5f9;
}

.batch-toolbar-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.batch-count {
    font-size: 0.9rem;
    color: #64748b;
}

.batch-count strong {
    color: #3730a3;
    font-size: 1.1rem;
}

.batch-divider {
    color: #e2e8f0;
    font-size: 1.2rem;
}

.batch-reset-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.8rem;
    border: 1px solid #e2e8f0;
    background: white;
    border-radius: 6px;
    font-size: 0.85rem;
    color: #64748b;
    cursor: pointer;
    transition: all 0.2s ease;
}

.batch-reset-btn:hover:not(:disabled) {
    border-color: #dc2626;
    color: #dc2626;
}

.batch-reset-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.batch-reset-btn .material-icons {
    font-size: 1rem;
}
```

**模式選擇按鈕樣式：**

```css
/* Mode Button Group */
.batch-toolbar-body {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
}

.mode-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #475569;
    white-space: nowrap;
}

.mode-btn-group {
    display: flex;
    gap: 0.75rem;
    flex: 1;
}

.mode-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border: 2px solid #e2e8f0;
    background: white;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.mode-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.mode-btn .material-icons {
    font-size: 1.5rem;
    opacity: 0.6;
}

.mode-btn-text {
    display: flex;
    flex-direction: column;
}

.mode-btn-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: #334155;
}

.mode-btn-desc {
    font-size: 0.75rem;
    color: #94a3b8;
}

/* Mode button active states */
.mode-btn.active.mode-self-consumption {
    border-color: #059669;
    background: #ecfdf5;
}
.mode-btn.active.mode-self-consumption .material-icons {
    color: #059669;
    opacity: 1;
}

.mode-btn.active.mode-peak-valley {
    border-color: #3730a3;
    background: #eef2ff;
}
.mode-btn.active.mode-peak-valley .material-icons {
    color: #3730a3;
    opacity: 1;
}

.mode-btn.active.mode-peak-shaving {
    border-color: #d97706;
    background: #fffbeb;
}
.mode-btn.active.mode-peak-shaving .material-icons {
    color: #d97706;
    opacity: 1;
}
```

**批量下發按鈕樣式：**

```css
/* Batch Dispatch Button */
.batch-toolbar-footer {
    display: flex;
    justify-content: flex-end;
}

.batch-dispatch-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 2rem;
    background: linear-gradient(135deg, #3730a3, #4c1d95);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
}

.batch-dispatch-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #4338ca, #5b21b6);
    box-shadow: 0 4px 16px rgba(55, 48, 163, 0.35);
    transform: translateY(-1px);
}

.batch-dispatch-btn:disabled {
    background: #cbd5e1;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

.batch-dispatch-btn .material-icons {
    font-size: 1.2rem;
}
```

**資產卡片 Checkbox 樣式：**

```css
/* Asset Card Checkbox */
.asset-checkbox-wrapper {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    margin-right: 0.25rem;
}

.asset-checkbox {
    display: none;
}

.asset-checkmark {
    width: 20px;
    height: 20px;
    border: 2px solid #cbd5e1;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
}

.asset-checkbox:checked + .asset-checkmark {
    background: #3730a3;
    border-color: #3730a3;
}

.asset-checkbox:checked + .asset-checkmark::after {
    content: '✓';
    color: white;
    font-size: 0.75rem;
    font-weight: 700;
}

.site-card.selected {
    border: 2px solid #3730a3;
    background: #fafaff;
}

.site-card {
    cursor: pointer;
    border: 2px solid transparent;
}
```

**模式標籤樣式：**

```css
/* Asset Mode Badge */
.asset-mode-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
}

.asset-mode-badge .material-icons {
    font-size: 0.9rem;
}
```

**進度彈窗樣式：**

```css
/* Batch Progress Modal */
.modal-batch-progress .modal-content,
.modal-batch-confirm .modal-content {
    max-width: 580px;
}

.overall-progress {
    margin-bottom: 1.25rem;
    font-size: 0.9rem;
    color: #475569;
}

.overall-progress-bar {
    margin-top: 0.5rem;
    height: 10px;
}

.overall-progress-fill {
    transition: width 0.5s ease;
}

.dispatch-progress-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.dispatch-progress-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: #f8fafc;
    border-radius: 8px;
    transition: background 0.3s ease;
}

.dispatch-progress-item.success { background: #ecfdf5; }
.dispatch-progress-item.failed { background: #fef2f2; }

.progress-status-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
}

.progress-status-icon.spinning {
    animation: spin 1s linear infinite;
    color: #3730a3;
}

.progress-status-icon.status-success { color: #059669; }
.progress-status-icon.status-failed { color: #dc2626; }
.progress-status-icon.status-waiting { color: #94a3b8; }

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.dispatch-item-info {
    flex: 1;
}

.dispatch-item-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: #1e293b;
}

.dispatch-item-detail {
    font-size: 0.8rem;
    color: #64748b;
}

.dispatch-item-progress {
    width: 80px;
}

.dispatch-item-progress .progress-bar {
    height: 6px;
}

.progress-status-text {
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
}

/* Batch Change List (Confirm Modal) */
.batch-change-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 1rem 0;
}

.batch-change-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #f8fafc;
    border-radius: 6px;
    font-size: 0.9rem;
}

.batch-change-arrow {
    color: #3730a3;
    font-size: 1rem;
}

.batch-impact-box {
    padding: 0.75rem 1rem;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    font-size: 0.85rem;
    color: #92400e;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
```

**CSS 變量建議：**

```css
:root {
    --mode-self: #059669;
    --mode-self-bg: #ecfdf5;
    --mode-self-border: #a7f3d0;
    --mode-pv: #3730a3;
    --mode-pv-bg: #eef2ff;
    --mode-pv-border: #c7d2fe;
    --mode-ps: #d97706;
    --mode-ps-bg: #fffbeb;
    --mode-ps-border: #fde68a;

    /* v2.0 Energy flow colors */
    --ef-pv: #f59e0b;
    --ef-bat-charge: #3b82f6;
    --ef-bat-discharge: #10b981;
    --ef-grid-import: #ef4444;
    --ef-grid-export: #059669;
    --ef-grid-balance: #94a3b8;
}
```

---

### 4.4 v1.0 保留的 HTML 結構

**批量工具列 HTML：** 見 §2.3（完整 HTML 已在該節提供）

**確認 Modal HTML：**

```html
<!-- 批量確認 Modal -->
<div id="batchConfirmModal" class="modal">
    <div class="modal-content modal-batch-confirm">
        <h2>
            <span class="material-icons modal-icon" style="color:#d97706">bolt</span>
            <span data-translate="confirm_batch_change">確認批量模式更改</span>
        </h2>
        <div class="modal-body">
            <p data-translate="confirm_batch_desc">您即將更改以下站點的運行模式:</p>
            <div class="batch-change-list" id="batchChangeList">
                <!-- 動態填充 -->
            </div>
            <div class="batch-impact-box" id="batchImpactBox">
                <!-- 影響摘要 -->
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn-accept" onclick="executeBatchDispatch()">
                <span class="material-icons">check_circle</span>
                <span data-translate="confirm_dispatch">確認下發</span>
            </button>
            <button class="btn-reject" onclick="closeBatchConfirmModal()">
                <span class="material-icons">cancel</span>
                <span data-translate="cancel">取消</span>
            </button>
        </div>
    </div>
</div>
```

**進度 Modal HTML：**

```html
<!-- 批量進度 Modal -->
<div id="batchProgressModal" class="modal">
    <div class="modal-content modal-batch-progress">
        <h2>
            <span class="material-icons modal-icon spinning" style="color:#3730a3" id="progressIcon">sync</span>
            <span id="progressTitle" data-translate="batch_dispatching">批量模式下發中...</span>
        </h2>
        <div class="modal-body">
            <!-- 總進度 -->
            <div class="overall-progress">
                <span data-translate="overall_progress">總進度</span>:
                <span id="overallProgressText">0 / 0</span>
                <div class="progress-bar overall-progress-bar">
                    <div class="progress-fill overall-progress-fill" id="overallProgressFill" style="width:0%"></div>
                </div>
            </div>
            <!-- 逐站點進度列表 -->
            <div class="dispatch-progress-list" id="dispatchProgressList">
                <!-- 動態填充 -->
            </div>
        </div>
        <div class="modal-actions" id="progressActions">
            <button class="btn-view" id="closeProgressBtn" onclick="closeProgressModal()" disabled>
                <span class="material-icons">close</span>
                <span data-translate="close">關閉</span>
            </button>
            <button class="btn-accept" id="retryBtn" onclick="retryFailedItems()" style="display:none">
                <span class="material-icons">refresh</span>
                <span data-translate="retry_failed">重試失敗項</span>
            </button>
        </div>
    </div>
</div>
```

---

## 第五章：實施步驟

### 5.1 翻譯系統完整擴充（zh / en / pt 三語）

#### v1.0 原有翻譯鍵

```javascript
// 中文 (zh)
'select_all': '全選',
'selected': '已選',
'sites': '站點',
'reset_selection': '重置選擇',
'target_mode': '目標模式',
'mode_self_consumption': '自發自用',
'mode_peak_valley': '峰谷套利',
'mode_peak_shaving': '削峰模式',
'mode_self_desc': '優先自用, 多餘才賣',
'mode_pv_desc': '全額買入/賣出 (VPP)',
'mode_ps_desc': '功率限制, 避免罰款',
'batch_dispatch': '批量下發模式',
'current_mode': '當前模式',
'confirm_batch_change': '確認批量模式更改',
'confirm_batch_desc': '您即將更改以下站點的運行模式:',
'confirm_dispatch': '確認下發',
'cancel': '取消',
'batch_dispatching': '批量模式下發中...',
'overall_progress': '總進度',
'close': '關閉',
'retry_failed': '重試失敗項',
'dispatch_success': '成功',
'dispatch_failed': '失敗',
'dispatch_waiting': '等待中',
'batch_complete': '批量模式更改完成',
'batch_impact_warning': '模式更改將在下一個調度週期生效',
'affected_sites': '個站點',
'affected_units': '台設備',
'communication_timeout': '設備通信超時',
'all_in_target_mode': '所有選中站點已在目標模式下',
'success_count': '成功',
'failed_count': '失敗',

// English (en)
'select_all': 'Select All',
'selected': 'Selected',
'sites': 'sites',
'reset_selection': 'Reset',
'target_mode': 'Target Mode',
'mode_self_consumption': 'Self-Consumption',
'mode_peak_valley': 'Peak-Valley Arbitrage',
'mode_peak_shaving': 'Peak Shaving',
'mode_self_desc': 'Self-use first, sell excess',
'mode_pv_desc': 'Full buy/sell (VPP)',
'mode_ps_desc': 'Power limit, avoid penalties',
'batch_dispatch': 'Batch Dispatch Mode',
'current_mode': 'Current Mode',
'confirm_batch_change': 'Confirm Batch Mode Change',
'confirm_batch_desc': 'You are about to change the operating mode for:',
'confirm_dispatch': 'Confirm Dispatch',
'cancel': 'Cancel',
'batch_dispatching': 'Batch Mode Dispatching...',
'overall_progress': 'Overall Progress',
'close': 'Close',
'retry_failed': 'Retry Failed',
'dispatch_success': 'Success',
'dispatch_failed': 'Failed',
'dispatch_waiting': 'Waiting',
'batch_complete': 'Batch Mode Change Complete',
'batch_impact_warning': 'Mode change takes effect next scheduling cycle',
'affected_sites': 'sites',
'affected_units': 'devices',
'communication_timeout': 'Communication timeout',
'all_in_target_mode': 'All selected sites are already in target mode',
'success_count': 'Success',
'failed_count': 'Failed',

// Português (pt)
'select_all': 'Selecionar Tudo',
'selected': 'Selecionados',
'sites': 'sites',
'reset_selection': 'Resetar',
'target_mode': 'Modo Alvo',
'mode_self_consumption': 'Autoconsumo',
'mode_peak_valley': 'Arbitragem Ponta-Fora Ponta',
'mode_peak_shaving': 'Corte de Pico',
'mode_self_desc': 'Prioridade ao autoconsumo',
'mode_pv_desc': 'Compra/venda total (VPP)',
'mode_ps_desc': 'Limite de potência, evitar multas',
'batch_dispatch': 'Despacho em Lote',
'current_mode': 'Modo Atual',
'confirm_batch_change': 'Confirmar Alteração em Lote',
'confirm_batch_desc': 'Você está prestes a alterar o modo de operação de:',
'confirm_dispatch': 'Confirmar Despacho',
'cancel': 'Cancelar',
'batch_dispatching': 'Despachando Modos em Lote...',
'overall_progress': 'Progresso Geral',
'close': 'Fechar',
'retry_failed': 'Tentar Novamente',
'dispatch_success': 'Sucesso',
'dispatch_failed': 'Falha',
'dispatch_waiting': 'Aguardando',
'batch_complete': 'Alteração em Lote Concluída',
'batch_impact_warning': 'Alteração entra em vigor no próximo ciclo',
'affected_sites': 'sites',
'affected_units': 'dispositivos',
'communication_timeout': 'Timeout de comunicação',
'all_in_target_mode': 'Todos os sites já estão no modo alvo',
'success_count': 'Sucesso',
'failed_count': 'Falha',
```

#### v2.0 新增翻譯鍵

| key | 中文(zh) | English(en) | Português(pt) |
|-----|---------|------------|--------------|
| vpp_dispatch_accuracy | VPP 調度精準率 | VPP Dispatch Accuracy | Precisão de Despacho VPP |
| dr_response_latency | DR 響應延遲 | DR Response Latency | Latência de Resposta DR |
| system_health | 系統健康度 | System Health | Saúde do Sistema |
| gateway_uptime | 網關在線率 | Gateway Uptime | Uptime do Gateway |
| offline_test_passed | 72h 斷線測試通過 | 72h Offline Test Passed | Teste Offline 72h Aprovado |
| dispatch_success_rate | 調度成功率 | Dispatch Success Rate | Taxa de Despacho |
| energy_flow | 即時能量流 | Real-time Energy Flow | Fluxo de Energia |
| pv_power_label | 光伏功率 | PV Power | Potência Solar |
| bat_status_charging | 充電中 | Charging | Carregando |
| bat_status_discharging | 放電中 | Discharging | Descarregando |
| bat_status_idle | 待機 | Idle | Em Espera |
| grid_importing | 買電 | Importing | Importando |
| grid_exporting | 賣電 | Exporting | Exportando |
| bat_health | 電池健康度 | Battery Health | Saúde da Bateria |
| today_financial | 今日財務 | Today Financials | Finanças de Hoje |
| pv_generation | 光伏發電 | PV Generation | Geração Solar |
| today_saved | 今日節省 | Today Saved | Economia Hoje |
| self_use_rate | 自用率 | Self-use Rate | Taxa de Autoconsumo |

---

### 5.2 實施 Phases

#### Phase 0 — Portfolio KPI + System Health（1.5h）

| 步驟 | 內容 |
|------|------|
| 0.1 | 在 `index.html` 的 `.kpi-row-algo` 內插入 2 個新 KPI 卡片 HTML 容器 |
| 0.2 | 在 KPI 行下方插入 System Health block HTML（含 3 個指標） |
| 0.3 | 在 `style.css` 新增 `.kpi-dispatch`、`.kpi-latency`、`.system-health-block` 等樣式 |
| 0.4 | 在 `app.js` 新增 `updateSystemHealth()` 函數 |
| 0.5 | 驗證 Gateway Uptime 和 72h Offline Test 為靜態顯示 |

#### Phase 1 — Data Layer（1.5h）

| 步驟 | 內容 |
|------|------|
| 1.1 | 擴展 `mockData.assets` — 為每個 asset 添加 `metering`、`status`、`config` 對象 |
| 1.2 | 設置 4 個資產的初始值（§1.2.4 定義） |
| 1.3 | 驗證每個資產滿足能量守恆公式（±0.5kW 容差） |
| 1.4 | 定義 `OPERATION_MODES` 常量對象 |
| 1.5 | 擴展 `batchState` 添加 `dispatchSuccessCount` 和 `dispatchTotalCount` |
| 1.6 | 擴展 `translations` 三語翻譯（v1.0 + v2.0 新鍵） |

#### Phase 2 — UI Static Layer（1h）

| 步驟 | 內容 |
|------|------|
| 2.1 | 在 `style.css` 新增能量流菱形面板 CSS（`.energy-flow-panel`、`.ef-node-*`） |
| 2.2 | 新增連接線和動畫 CSS（`.ef-line-*`、`@keyframes flow-arrow`） |
| 2.3 | 新增設備健康行 CSS（`.device-health-row`、`.soc-bar`） |
| 2.4 | 新增折疊財務區 CSS（`.financial-collapsible`、展開/收起動畫） |

#### Phase 3 — Site Card Rewrite（3h）

| 步驟 | 內容 |
|------|------|
| 3.1 | 實現 `renderEnergyFlow(asset)` — 菱形能量流面板 HTML 生成 |
| 3.2 | 實現 `renderDeviceHealth(asset)` — 設備健康行 HTML 生成 |
| 3.3 | 實現 `renderFinancialCollapsible(asset)` — 折疊財務區 HTML 生成 |
| 3.4 | 實現 `getFlowDirection(asset)` — 流向計算邏輯 |
| 3.5 | 改造 `populateAssets()` — 整合四個 Zone 渲染 |
| 3.6 | 測試 4 個資產卡片的正確渲染 |

#### Phase 4 — Batch Toolbar Logic（1h）

| 步驟 | 內容 |
|------|------|
| 4.1 | 實現 `initBatchToolbar()` 和選擇邏輯 |
| 4.2 | 實現 `toggleAssetSelection()` / `toggleSelectAll()` / `updateBatchUI()` |
| 4.3 | 實現 `selectMode()` / `resetBatchSelection()` |

#### Phase 5 — Dispatch Flow + System Health Update（1h）

| 步驟 | 內容 |
|------|------|
| 5.1 | 實現 `startBatchDispatch()` / `showConfirmModal()` |
| 5.2 | 實現 `executeBatchDispatch()` / `simulateAssetModeChange()` |
| 5.3 | 實現 `updateDispatchProgress()` / `showDispatchResult()` |
| 5.4 | 實現 `retryFailedItems()` |
| 5.5 | 在 `executeBatchDispatch()` 中添加 `dispatchSuccessCount++` + `updateSystemHealth()` 邏輯 |

#### Phase 6 — Translation + Real-time Updates + Testing（1.5h）

| 步驟 | 內容 |
|------|------|
| 6.1 | 完整翻譯鍵集成（v1.0 全部 + v2.0 新增 17 鍵） |
| 6.2 | 擴展 `startRealTimeUpdates()` — metering 隨機遊走 + 能量守恆維護 |
| 6.3 | 實現 `refreshEnergyFlowValues()` — 增量更新（不重建 DOM） |
| 6.4 | 全語言測試 (中/英/葡) |
| 6.5 | 邊界情況測試 |
| 6.6 | 響應式適配驗證 |

**總預估: ~10.5h**

---

### 5.3 技術實現注意事項

#### 5.3.1 與現有代碼的兼容性

| 關注點 | 處理策略 |
|--------|----------|
| `populateAssets()` 被 `changeLanguage()` 調用 | 重新渲染時需保留 `batchState.selectedAssets` 狀態 |
| 實時更新 `startRealTimeUpdates()` | 批量操作進行中時 (`batchState.isDispatching`) 應暫停實時更新 |
| Modal 點擊背景關閉 | 進度彈窗在執行中時不應允許關閉 |
| `changeLanguage()` 切換語言 | 需要在 `changeLanguage()` 中調用工具列的翻譯更新 |

#### 5.3.2 DOMContentLoaded 初始化順序

```javascript
document.addEventListener('DOMContentLoaded', function() {
    updateAllTranslations();
    setupNavigation();
    setCurrentDate();
    initializeRevenueCurveChart();
    initializeArbitrageChart();
    initializeRevenueTrendChart();
    initializeRevenueBreakdownChart();
    populateAssets();         // 現有: 渲染資產卡片 (含新的能量流+健康行+折疊財務)
    initBatchToolbar();       // v1.0: 初始化批量工具列事件
    populateTrades();
    startRealTimeUpdates();   // 擴展: 含 metering 實時更新
});
```

#### 5.3.3 邊界情況處理

| 場景 | 處理方式 |
|------|----------|
| 選中站點已是目標模式 | 自動過濾, 不納入下發; 如果全部已是目標模式, 彈出提示 |
| 下發過程中切換頁面 | Modal 保持顯示, 後台繼續執行 |
| 下發過程中切換語言 | 彈窗內翻譯實時更新 (通過 data-translate 屬性) |
| 全部失敗 | 顯示結果, "重試失敗項"按鈕可見 |
| 部分失敗後重試 | 僅重試失敗項, 成功項保持不變 |
| 網絡超時模擬 | `simulateAssetModeChange()` 中10%隨機失敗 |
| 正在下發時點擊"全選/取消" | 工具列在下發期間禁用交互 |

#### 5.3.4 性能考慮

- 資產卡片重新渲染時使用 `innerHTML = ''` 清空再重建 (保持現有模式)
- 進度更新使用 `setInterval` 分步回調, 不阻塞主線程
- Modal DOM 元素預創建在 HTML 中, 而非動態創建
- 實時更新使用 `refreshEnergyFlowValues()` 增量更新, 避免全量重渲染
- 能量流動畫使用純 CSS `@keyframes`, 不依賴 JS 動畫循環

---

### 5.4 離線降級處理

當 `is_online === false` 時：

| 組件 | 降級行為 |
|------|----------|
| Energy Flow Panel | 灰化 (`opacity: 0.4`, `filter: grayscale(100%)`), 所有數值顯示 `"--"` |
| Device Health Row | 灰化, SOC/SOH 顯示 `"--"` |
| Mode Badge | **保持可見** (不灰化), 模式仍然有意義 |
| Checkbox | 正常可用 (離線資產仍可被選中進行批量操作, 但下發會失敗) |
| Financial Section | 灰化, 數據保持最後已知值 |
