# 《Solfacil Pilot: VPP 邊緣遙測與批量調度可視化升級方案 (v2.0)》

> **版本**: 2.0
> **日期**: 2026-02-27
> **基線**: VPP 批量模式更改功能設計方案 (v1.0)
> **協議依據**: 新工商儲架構 MQTT 協議 v1.0 / 標準屬性點 identifier 定義文檔

---

## Chapter 0: 升級背景與驅動力

### 0.1 v1.0 vs v2.0 差異對比表

| 維度 | v1.0 | v2.0 |
|------|------|------|
| Dashboard KPI 數量 | 7 張卡片（4 財務 + 3 算法） | 9 張卡片（4 財務 + 3 算法 + **2 信任指標**） |
| 信任信號 | 無 System Health 區塊 | **新增 System Health**（Gateway Uptime / Offline Test / Dispatch Success Rate） |
| 資產卡片內容 | 財務導向（投資額、收益、ROI、Payback） | **工程/運營導向**（能量流圖 + 設備健康 + 今日表現） |
| mockData 字段數 | 每資產 12 字段（純財務） | 每資產 **~30 字段**（metering + status + config 三層結構） |

### 0.2 Solfacil Pilot 評審指標覆蓋度表

| 指標 | 目標值 | v1.0 狀態 | v2.0 狀態 |
|------|--------|-----------|-----------|
| Optimization Alpha | ≥70% | ✅ KPI 卡片展示 76.3% | ✅ 保留 |
| Self-consumption Rate | ≥95% | ✅ KPI 卡片展示 98.2% | ✅ 保留 |
| Forecast MAPE | ≤20% | ✅ KPI 卡片展示 18.5% | ✅ 保留 |
| VPP Dispatch Accuracy | ≥85% | ❌ 未覆蓋 | ✅ **新增 KPI 卡片 87.3%** |
| DR Response Latency | <15 min | ❌ 未覆蓋 | ✅ **新增 KPI 卡片 12s avg** |

### 0.3 三大升級核心概覽

```
v2.0 升級
├── Upgrade 1: Dashboard 信任 KPI + System Health
│   ├── VPP Dispatch Accuracy 卡片
│   ├── DR Response Latency 卡片
│   └── System Health 區塊（3 子指標）
│
├── Upgrade 2: 資產卡片重構
│   ├── 移除純財務指標（投資額/ROI/Payback）
│   ├── 新增能量流圖（PV → Battery → Load → Grid）
│   ├── 新增設備健康面板（SOC/SOH/溫度/循環次數）
│   └── 新增今日表現面板（發電量/節省金額/自用率）
│
└── Upgrade 3: mockData 結構擴充
    ├── metering 物件（即時功率 + 日累計電量）
    ├── status 物件（電池健康 + 逆變器狀態 + 在線狀態）
    └── config 物件（運行模式 + SOC 限值 + 時間窗口）
```

---

## Chapter 1: Upgrade 1 — Dashboard 信任 KPI + System Health

### 1.1 新增 KPI 卡：VPP Dispatch Accuracy

**插入位置**: `index.html` → `#portfolio` section → `.kpi-row-algo` 末尾（現有 3 張卡片之後追加）

**展示規格**:
- 值: `87.3%`
- 目標: `>85%`
- 顏色規則: 達標（≥85%）= 綠色 `#059669`，未達標（<85%）= 紅色 `#dc2626`
- CSS class: `kpi-dispatch`
- 翻譯 key: `vpp_dispatch_accuracy`
- DOM id: `kpiDispatchValue`, delta id: `kpiDispatchDelta`

**線框圖**:
```
┌──────────────────────────────────┐
│ 🎯  VPP Dispatch Accuracy       │
│                                  │
│     87.3%                        │
│     ▲ Target >85%   ✅ PASSED    │
│                                  │
│     #059669 (green, 達標)        │
└──────────────────────────────────┘
```

### 1.2 新增 KPI 卡：DR Response Latency

**插入位置**: 緊接 1.1 之後，`.kpi-row-algo` 內第 5 張卡片

**展示規格**:
- 值: `12s avg`
- 目標: `<15 min`
- 達標顯示: 🟢 PASSED（12s 遠低於 15 min 門檻）
- CSS class: `kpi-latency`
- 翻譯 key: `dr_response_latency`
- DOM id: `kpiLatencyValue`, delta id: `kpiLatencyDelta`

**線框圖**:
```
┌──────────────────────────────────┐
│ ⚡  DR Response Latency          │
│                                  │
│     12s avg                      │
│     Target <15 min  🟢 PASSED    │
│                                  │
│     #059669 (green, 遠超達標)    │
└──────────────────────────────────┘
```

### 1.3 新增 System Health 區塊

**插入位置**: KPI 列（`.kpi-row-algo`）之後、Revenue 圖表（`.dashboard-grid`）之前

**結構**: 水平排列三個子指標卡片，統一包裝在 `.system-health-row` 容器中

#### a. Gateway Uptime

- 值: `99.7%`
- 副標題: `Last 30 days`
- Solfacil 評審要求: 邊緣閘道器需維持 >99% 可用性以確保調度指令可靠下達
- 圖標: `router`

#### b. 72h Offline Test

- 值: `✅ PASSED`
- 副標題: `Resumed in 4m23s`
- Solfacil 評審要求: 斷網 72 小時後系統須能自動恢復並重新連接平台，恢復時間 <10 min
- 圖標: `wifi_off`

#### c. Dispatch Success Rate

- 值: `156/160 次 (97.5%)`
- 副標題: `Last 30 days`
- Solfacil 評審要求: 調度指令成功執行率需 >95%，失敗指令須有重試機制
- 圖標: `check_circle`

**線框圖**:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡️ System Health                                                          │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│  🔌 Gateway Uptime  │  📡 72h Offline Test  │  ✅ Dispatch Success Rate     │
│                     │                       │                               │
│  99.7%              │  ✅ PASSED             │  156/160 次 (97.5%)           │
│  Last 30 days       │  Resumed in 4m23s     │  Last 30 days                │
│                     │                       │                               │
│  要求: >99%         │  要求: <10min 恢復     │  要求: >95%                   │
└─────────────────────┴───────────────────────┴───────────────────────────────┘
```

---

## Chapter 2: Upgrade 2 — 資產卡片重構（工程/運營視角）

### 2.1 重構原則表

| 操作 | 項目 | 理由 |
|------|------|------|
| **移除** | `investimento`（投資額） | 屬財務資訊，非運營實時監控所需 |
| **移除** | `receitaHoje` / `receitaMes`（日/月收入） | 同上，Portfolio KPI 已覆蓋全局收入 |
| **移除** | `roi`（投資回報率） | 靜態財務指標，不反映即時運行狀態 |
| **移除** | `custoHoje` / `lucroHoje`（日成本/利潤） | 同上 |
| **移除** | `payback`（回收期） | 長週期財務指標，Demo 場景無需逐卡展示 |
| **保留** | `id` / `name` / `region` / `status` | 資產基本識別信息 |
| **保留** | `capacidade`（容量 MWh） | 核心工程參數 |
| **保留** | `unidades`（設備數量） | 運維管理必要 |
| **保留** | `operationMode`（v1.0 新增的運行模式） | 批量調度核心字段 |
| **新增** | `metering` 物件 | 即時功率遙測 + 日累計電量（來自 MQTT 協議） |
| **新增** | `status` 物件 | 電池健康 + 逆變器狀態 + 在線狀態 |
| **新增** | `config` 物件 | 調度配置（SOC 限值、充放電時間窗口） |

### 2.2 新卡片結構 ASCII 線框圖

```
┌─────────────────────────────────────────────────────────────────┐
│ ☑  SP_001 São Paulo - Casa Verde          [⚡ 峰谷套利]  🟢 ON │  ← Header
├─────────────────────────────────────────────────────────────────┤
│                        ENERGY FLOW                              │
│                                                                 │
│         ☀️ PV                                 🔌 Grid           │
│        4.8 kW                              -1.2 kW             │
│           │                                    ▲                │
│           ▼                                    │                │
│     ┌──────────┐        ───────►         ┌──────────┐          │
│     │ 🔋 Battery│ ════════════════════►  │ 🏠 Load  │          │
│     │  SOC 72%  │       3.2 kW           │  6.8 kW  │          │
│     │  ⚡ +1.6kW │                        └──────────┘          │
│     └──────────┘                                                │
│                                                                 │
│  🟢 PV→Bat (charging)   🔵 Bat→Load   🟡 Grid→Load (-1.2kW)   │
├─────────────────────────────────────────────────────────────────┤
│  🔋 DEVICE HEALTH                                               │
│  SOC: ███████░░░ 72%  │ SOH: 96.2%  │ Cycles: 342  │ 32°C    │
├─────────────────────────────────────────────────────────────────┤
│  📊 TODAY PERFORMANCE                                           │
│  PV Gen: 28.5 kWh  │  Saved: R$42.30  │  Self-use: 94.7%      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 能量流圖設計規格

**四個節點**:

| 節點 | 圖標 | MQTT identifier | 字段映射 |
|------|------|-----------------|----------|
| ☀️ PV | `solar_power` | `pv_totalPower` | `metering.pv_power` |
| 🔋 Battery | `battery_charging_full` | `bat_totalPower` | `metering.battery_power` |
| 🏠 Load | `home` | `flload_totalPower` | `metering.load_power` |
| 🔌 Grid | `electrical_services` | `grid_activePower` | `metering.grid_power_kw` |

**能量流方向判斷規則**:

1. **電池方向** — 根據 `bat_workStatus`（MQTT identifier: `bat_workStatus`）:
   - `"charging"` → 箭頭朝向 Battery（PV/Grid → Battery），顯示 **+X.X kW**
   - `"discharging"` → 箭頭從 Battery 流出（Battery → Load/Grid），顯示 **-X.X kW**
   - `"other"` → 無箭頭，顯示 **0 kW IDLE**

2. **電網方向** — 根據 `grid_power_kw` 正負值:
   - `> 0`（正值）→ 買電，Grid → Load 方向，紅色箭頭
   - `< 0`（負值）→ 賣電，Load/Battery → Grid 方向，綠色箭頭
   - `≈ 0`（±0.1 kW 內）→ 無交互，灰色虛線

**顏色方案表**:

| 狀態 | 顏色 hex | 含義 |
|------|----------|------|
| PV 發電中 | `#f59e0b` (amber) | 太陽能輸出功率 > 0 |
| 電池充電 | `#3b82f6` (blue) | bat_workStatus = "charging" |
| 電池放電 | `#10b981` (green) | bat_workStatus = "discharging" |
| 電池閒置 | `#9ca3af` (gray) | bat_workStatus = "other" |
| 買電（Grid import） | `#ef4444` (red) | grid_power_kw > 0 |
| 賣電（Grid export） | `#059669` (emerald) | grid_power_kw < 0 |
| 無交互 | `#d1d5db` (light gray) | grid_power_kw ≈ 0 |

**動畫說明**: 每條能量流線使用 CSS `flow-arrow` animation，1.5s 週期脈衝動畫。箭頭沿流動方向以虛線動畫呈現，`animation: flow-arrow 1.5s linear infinite`。線條粗細與功率成正比（最小 2px，最大 6px）。

### 2.4 卡片各區塊規格

#### Header 區塊
- 左側: Checkbox（v1.0 批量選擇） + 資產名稱 + 區域圖標
- 中間: 運行模式標籤（v1.0 的 `asset-mode-badge`，保留顏色方案）
- 右側: 在線狀態指示燈（🟢 ON / 🔴 OFF）
- 容量標記: `5.2 MWh / 948 units`

#### Energy Flow 區塊
- 四節點菱形佈局（PV 上方、Battery 左側、Load 右側、Grid 下方）
- 節點之間以帶方向箭頭的線條連接
- 每條線標註即時功率值（kW）
- 底部狀態文字行：描述當前主要能量流動方向

#### Device Health 區塊
- 水平排列 4 個迷你指標:
  - SOC 進度條（`battery_soc`）: 帶百分比文字 + 彩色條（>60% 綠色, 20-60% 黃色, <20% 紅色）
  - SOH（`bat_soh`）: 百分比數字，<80% 紅色警告
  - 循環次數（`bat_cycleCount`）: 純數字
  - 逆變器溫度（`inverter_temp`）: 帶 °C 單位，>55°C 紅色警告

#### Today Performance 區塊
- 水平排列 3 個指標:
  - PV Generation: `pv_daily_energy` kWh
  - Today Saved: 計算值 `(grid_export_kwh × tariff_peak - grid_import_kwh × tariff_valley)`，以 R$ 顯示
  - Self-use Rate: 計算值 `(1 - grid_export_kwh / pv_daily_energy) × 100%`

### 2.5 四個示例資產的場景設計表

| 資產 | 場景 | 運行模式 | PV | Battery | Load | Grid | 描述 |
|------|------|----------|-----|---------|------|------|------|
| **SP_001** São Paulo | 峰谷套利 | `peak_valley_arbitrage` | 4.8 kW | +1.6 kW (charging) | 6.8 kW | -1.2 kW (少量買電) | PV 同時供負載和充電，不足部分從電網補充 |
| **RJ_002** Rio | 自發自用 | `self_consumption` | 5.5 kW | -2.1 kW (discharging) | 7.4 kW | +0.0 kW (Grid ≈ 0) | PV + 電池放電完全覆蓋負載，零電網交互 |
| **MG_003** Belo Horizonte | VPP 調度 | `peak_valley_arbitrage` | 1.2 kW | -4.5 kW (discharging) | 3.2 kW | -2.5 kW (賣電) | 峰時電池大功率放電，多餘電力賣回電網 |
| **PR_004** Curitiba | 削峰 | `peak_shaving` | 0.3 kW | -3.0 kW (discharging) | 8.1 kW | +4.8 kW (買電受限) | 電池放電削減峰值功率，限制電網購入量 |

---

## Chapter 3: Upgrade 3 — mockData 結構擴充

### 3.1 新增字段的協議依據

所有新增字段均源自以下兩份協議文檔：

1. **新工商儲架構嵌入式-雲端MQTT協議內容定義** (`document/新工商储架构嵌入式-云端MQTT协议内容定义.md`)
   - 定義了 `device/{productKey}/{clientId}/data` 主題下的實時數據上報結構
   - `bat_workStatus` 的值域定義: `"charging"` / `"discharging"` / `"other"`
   - 數據上報間隔由 `realTimeDataInterval` 配置控制，默認 5 秒

2. **標準屬性點與功能點 identifier 值定義** (`document/标准属性点与功能点identifier值定义.md`)
   - §2.1 電池設備總數據: `bat_soc`, `bat_soh`, `bat_totalPower`, `bat_workStatus`, `bat_cycleNumber` 等
   - §2.2 電表/逆變器公共字段: `grid_activePower`, `grid_positiveEnergy`, `grid_negativeEnergy`, `grid_frequency`, `grid_direction` 等
   - §2.3 逆變器相關: `pv_totalPower`, `flload_totalPower`, `inverter_ambientTemp`

### 3.2 metering 物件字段表

| 字段名 | 類型 | 單位 | MQTT identifier | 說明 |
|--------|------|------|-----------------|------|
| `pv_power` | Number | kW | `pv_totalPower` | 光伏 PCS 總即時功率 |
| `battery_power` | Number | kW | `bat_totalPower` | 電池總即時功率（正=充電, 負=放電） |
| `grid_power_kw` | Number | kW | `grid_activePower` | 電網側總有功功率（正=買電, 負=賣電） |
| `load_power` | Number | kW | `flload_totalPower` | 家庭/商業負載總功率 |
| `grid_import_kwh` | Number | kWh | `grid_positiveEnergy` | 電網側總正向電能（累計買電量） |
| `grid_export_kwh` | Number | kWh | `grid_negativeEnergy` | 電網側總負向電能（累計賣電量） |
| `pv_daily_energy` | Number | kWh | 由 `pv_totalPower` 積分計算 | 今日光伏累計發電量 |
| `bat_charged_today` | Number | kWh | `total_bat_dailyChargedEnergy` | 今日電池累計充電量 |
| `bat_discharged_today` | Number | kWh | `total_bat_dailyDischargedEnergy` | 今日電池累計放電量 |

### 3.3 status 物件字段表

| 字段名 | 類型 | 單位 | MQTT identifier | 說明 |
|--------|------|------|-----------------|------|
| `battery_soc` | Number | % | `bat_soc` | 電池當前 SOC（荷電狀態） |
| `bat_soh` | Number | % | `bat_soh` | 電池當前 SOH（健康狀態） |
| `bat_work_status` | String | — | `bat_workStatus` | 電池工作狀態: `"charging"` / `"discharging"` / `"other"` |
| `battery_voltage` | Number | V | `bat_totalVoltage` | 電池總電壓 |
| `bat_cycle_count` | Number | 次 | `bat_cycleNumber` | 電池循環次數 |
| `inverter_temp` | Number | °C | `inverter_ambientTemp` | PCS 環境溫度 |
| `is_online` | Boolean | — | 由網關心跳判斷 | 設備是否在線 |
| `grid_direction` | String | — | `grid_direction` | 電網側方向: `"input"` / `"output"` / `"other"` |
| `grid_frequency` | Number | Hz | `grid_frequency` | 電網側頻率 |

### 3.4 config 物件字段表

| 字段名 | 類型 | 說明 |
|--------|------|------|
| `target_mode` | String | 目標運行模式（與 v1.0 `operationMode` 對應）: `"self_consumption"` / `"peak_valley_arbitrage"` / `"peak_shaving"` |
| `min_soc` | Number | 最低 SOC 保護閾值（%），低於此值停止放電 |
| `max_charge_rate` | Number | 最大充電倍率（C），限制充電速度保護電池 |
| `charge_window_start` | Number | 充電窗口開始時間（分鐘數，0-1440），對應 MQTT 協議 `times[].start` |
| `charge_window_end` | Number | 充電窗口結束時間（分鐘數，0-1440），對應 MQTT 協議 `times[].end` |
| `discharge_window_start` | Number | 放電窗口開始時間（分鐘數，0-1440） |

### 3.5 能量守恆校驗公式

```
pv_power + grid_import ≈ load_power + battery_charging + grid_export
```

**詳細表達**:

```
若 battery_power > 0 (充電):
  pv_power + max(grid_power_kw, 0) ≈ load_power + battery_power + max(-grid_power_kw, 0)

若 battery_power < 0 (放電):
  pv_power + |battery_power| + max(grid_power_kw, 0) ≈ load_power + max(-grid_power_kw, 0)

簡化通用公式:
  pv_power + max(grid_power_kw, 0) + max(-battery_power, 0)
  ≈ load_power + max(-grid_power_kw, 0) + max(battery_power, 0)

允許誤差: ±0.5 kW（考慮逆變器損耗、量測精度、取樣時間差）
```

**四資產校驗**:

| 資產 | PV | Bat | Load | Grid | 左側 (供) | 右側 (需) | 差值 |
|------|-----|-----|------|------|-----------|-----------|------|
| SP_001 | 4.8 | +1.6 | 6.8 | -1.2 | 4.8+1.2=6.0 | 6.8+1.6=8.4 | … 需調整: PV 4.8 + Grid 3.6 = Load 6.8 + Bat 1.6 → Grid=+3.6 改為 買電 → 修正: Grid=+3.6 kW |

> **Note**: 實際 mock 值在實施 Phase 1 時需以此公式逐資產校準，確保 `|供 - 需| ≤ 0.5 kW`。上述 2.5 的場景值為設計意向值，實施時依公式微調。

---

## Chapter 4: 整體 UI 架構圖（v2.0）

### 4.1 Portfolio 頁面修改後的 ASCII 架構圖

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [HEADER] SOLFACIL - Gestão de Ativos de Energia         [🌐 PT/EN/中] │
├─────────────────────────────────────────────────────────────────────────┤
│  Portfólio ★ │ Arbitragem │ Ativos │ Relatórios                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│  │ 收入      │ │ 成本      │ │ 淨利      │ │ 套利價差  │  ← .kpi-row     │
│  │ R$62.450 │ │ R$14.215 │ │ R$48.235 │ │ R$0.57   │                  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                  │
│                                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Opt Alpha│ │ MAPE     │ │ Self-con │ │⭐Dispatch│ │⭐DR Lat  │    │
│  │ 76.3%    │ │ 18.5%    │ │ 98.2%    │ │ 87.3%    │ │ 12s avg  │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│                                               ↑ NEW         ↑ NEW     │
│  ╔═════════════════════════════════════════════════════════════════╗    │
│  ║ ⭐ SYSTEM HEALTH (NEW)                                        ║    │
│  ║ ┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ║    │
│  ║ │ Gateway Uptime  │ │ 72h Offline Test │ │ Dispatch Success │ ║    │
│  ║ │ 99.7%           │ │ ✅ PASSED         │ │ 156/160 (97.5%) │ ║    │
│  ║ │ Last 30 days    │ │ Resumed 4m23s    │ │ Last 30 days     │ ║    │
│  ║ └─────────────────┘ └──────────────────┘ └──────────────────┘ ║    │
│  ╚═════════════════════════════════════════════════════════════════╝    │
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐    │
│  │ 📈 Revenue vs Cost (24h)     │  │ 🏪 Market Conditions         │    │
│  │ [chart canvas]               │  │ Tarifa / Custo / Margem      │    │
│  └──────────────────────────────┘  ├──────────────────────────────┤    │
│                                     │ ⚡ Quick Actions              │    │
│                                     └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Ativos 頁面重構後的 ASCII 架構圖

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [HEADER] SOLFACIL - Gestão de Ativos de Energia         [🌐 PT/EN/中] │
├─────────────────────────────────────────────────────────────────────────┤
│  Portfólio │ Arbitragem │ Ativos ★ │ Relatórios                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  資產組合概覽                                   2,847 個活躍資產        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│  │ 投資總額  │ │ 總容量    │ │ 回收期   │ │ 內部收益率│                  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                  │
│                                                                         │
│  ╔══════════════════════════════════════════════════════════════════╗   │
│  ║ 🔧 批量操作工具欄 (v1.0 繼承)                                    ║   │
│  ║ ☑ 全選  已選: 2/4    目標模式: [自發自用] [峰谷套利] [削峰]      ║   │
│  ║ [🚀 批量下發模式]  [↻ 重置]                                     ║   │
│  ╚══════════════════════════════════════════════════════════════════╝   │
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐    │
│  │ ☑ SP_001 São Paulo  [⚡峰谷] │  │ ☐ RJ_002 Rio      [🏠自用]  │    │
│  │ ┌─ ENERGY FLOW ──────────┐  │  │ ┌─ ENERGY FLOW ──────────┐  │    │
│  │ │ PV→Bat  Bat→Load  Grid │  │  │ │ PV→Load  Bat→Load      │  │    │
│  │ └────────────────────────┘  │  │ └────────────────────────┘  │    │
│  │ 🔋 SOC:72% SOH:96% C:342   │  │ 🔋 SOC:85% SOH:98% C:215   │    │
│  │ 📊 PV:28.5kWh  Saved:R$42  │  │ 📊 PV:32.1kWh  Saved:R$56  │    │
│  └──────────────────────────────┘  └──────────────────────────────┘    │
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐    │
│  │ ☐ MG_003 B.H.     [⚡峰谷]  │  │ ☑ PR_004 Curitiba [🔶削峰]  │    │
│  │ ┌─ ENERGY FLOW ──────────┐  │  │ ┌─ ENERGY FLOW ──────────┐  │    │
│  │ │ Bat→Load  Bat→Grid     │  │  │ │ Bat→Load  Grid→Load    │  │    │
│  │ └────────────────────────┘  │  │ └────────────────────────┘  │    │
│  │ 🔋 SOC:45% SOH:91% C:580   │  │ 🔋 SOC:38% SOH:94% C:420   │    │
│  │ 📊 PV:8.2kWh   Saved:R$28  │  │ 📊 PV:2.1kWh   Saved:R$18  │    │
│  └──────────────────────────────┘  └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Chapter 5: 代碼修改清單

### 5.1 文件修改矩陣

| 文件 | 修改類型 | 主要改動 | 預估行數 |
|------|----------|----------|----------|
| `index.html` | 修改 | 新增 2 張 KPI 卡片 HTML + System Health 區塊 HTML | +60 行 |
| `js/app.js` | 修改 | mockData 結構擴充 + 新增能量流/設備健康/今日表現渲染函數 + System Health 更新 | +350 行 |
| `css/style.css` | 修改 | 新增 KPI 樣式 + System Health 樣式 + 能量流動畫 + 卡片重構樣式 | +280 行 |
| `js/i18n.js`（或 `translations` 物件） | 修改 | 新增 12+ 翻譯 key（三語言） | +40 行 |

### 5.2 app.js 新增/修改函數清單

| 函數名 | 操作 | 說明 |
|--------|------|------|
| `mockData.assets` | **修改** | 每個資產新增 `metering` / `status` / `config` 三層物件，移除純財務字段 |
| `populateAssets()` | **修改** | 重構卡片 HTML 模板：移除財務指標區塊，改為 Energy Flow + Device Health + Today Performance |
| `renderEnergyFlow(asset)` | **新增** | 根據 `asset.metering` + `asset.status.bat_work_status` 渲染四節點能量流圖 + 方向箭頭 |
| `renderDeviceHealth(asset)` | **新增** | 渲染 SOC 進度條 + SOH + 循環次數 + 溫度，帶顏色閾值判斷 |
| `renderTodayPerformance(asset)` | **新增** | 渲染 PV 發電量 + 今日節省金額 + 自用率 |
| `getFlowDirection(asset)` | **新增** | 根據 `bat_work_status` 和 `grid_power_kw` 計算能量流方向和顏色 |
| `startRealTimeUpdates()` | **修改** | 擴展即時更新邏輯：除原有 KPI 更新外，新增 metering 值隨機波動 + 能量流圖重繪 |
| `updateSystemHealth()` | **新增** | 更新 System Health 三個子指標的 DOM 值（可選：每 30 秒微調 dispatch 計數器） |

### 5.3 v1.0 繼承說明表

| v1.0 模塊 | 繼承方式 |
|------------|----------|
| Batch Toolbar | **完整保留** — HTML 結構 + CSS 樣式 + JS 邏輯不變 |
| Mode Badge（資產模式標籤） | **保留並遷移** — 從卡片 metrics 區上方移至 Header 區右側 |
| Confirm Modal（確認彈窗） | **完整保留** — `batchConfirmModal` 結構和邏輯不變 |
| Progress Modal（進度彈窗） | **完整保留** — `batchProgressModal` 結構和邏輯不變 |
| `executeBatchDispatch()` | **完整保留** — 模擬異步 API 調用、進度更新、結果展示邏輯不變 |
| `batchState` | **完整保留** — `selectedAssets` / `targetMode` / `isDispatching` / `dispatchResults` 狀態管理 |
| 翻譯 keys（batch 相關） | **完整保留** — `select_all` / `batch_dispatch` / `mode_self_consumption` / `mode_peak_valley` / `mode_peak_shaving` 等全部保留 |

---

## Chapter 6: 翻譯系統擴充

### 新增翻譯 key 表

| key | 中文 | English | Português |
|-----|------|---------|-----------|
| `vpp_dispatch_accuracy` | VPP 調度準確率 | VPP Dispatch Accuracy | Precisão de Despacho VPP |
| `dr_response_latency` | DR 響應延遲 | DR Response Latency | Latência de Resposta DR |
| `target_dispatch` | 目標 >85% | Target >85% | Meta >85% |
| `target_latency` | 目標 <15 min | Target <15 min | Meta <15 min |
| `system_health` | 系統健康 | System Health | Saúde do Sistema |
| `gateway_uptime` | 閘道器可用率 | Gateway Uptime | Uptime do Gateway |
| `offline_test_passed` | 離線測試通過 | 72h Offline Test Passed | Teste Offline 72h Aprovado |
| `dispatch_success_rate` | 調度成功率 | Dispatch Success Rate | Taxa de Sucesso de Despacho |
| `energy_flow` | 能量流 | Energy Flow | Fluxo de Energia |
| `bat_health` | 電池健康 | Battery Health | Saúde da Bateria |
| `today_saved` | 今日節省 | Today Saved | Economia Hoje |
| `pv_generation` | 光伏發電量 | PV Generation | Geração Fotovoltaica |

---

## Chapter 7: 設備離線與邊界情況處理

### 7.1 離線降級展示表

| 情況 | 處理方式 |
|------|----------|
| **單資產離線** (`is_online = false`) | 卡片 Header 右側顯示 🔴 OFFLINE，能量流圖所有節點灰色化，功率值顯示 `-- kW`，Device Health 指標凍結為最後已知值並標注 `(stale)` |
| **全部資產離線** | System Health 區塊 Gateway Uptime 變為紅色警告，能量流全部灰化，頂部 KPI 值不再波動（凍結），顯示全局 banner: "⚠ All gateways offline" |
| **部分遙測缺失**（如僅 PV 數據中斷） | 對應節點顯示 `? kW`（問號），能量流圖中該節點線條變為虛線灰色，其餘節點正常顯示 |
| **SOC 異常值**（<0% 或 >100%） | 前端 clamp 至 [0, 100] 範圍，SOC 進度條顯示紅色邊框 + tooltip: "Abnormal reading"，同時在 console 輸出 warning |

---

## Chapter 8: 實施步驟與工作量估算

### Phase 1: Data Layer — mockData 擴充 (1.5h)

1. 為 4 個資產定義 `metering` / `status` / `config` 物件
2. 移除舊財務字段（`investimento`, `receitaHoje`, `receitaMes`, `roi`, `custoHoje`, `lucroHoje`, `payback`）
3. 依能量守恆公式校驗每資產的功率值 (`|供 - 需| ≤ 0.5 kW`)
4. 確保 `operationMode` 與 `config.target_mode` 一致

### Phase 2: Portfolio KPI + System Health (1.5h)

1. 在 `index.html` 的 `.kpi-row-algo` 末尾新增 VPP Dispatch Accuracy + DR Response Latency 兩張 KPI 卡
2. 在 `.kpi-row-algo` 之後、`.dashboard-grid` 之前插入 System Health 區塊 HTML
3. 在 `style.css` 新增 `kpi-dispatch` / `kpi-latency` / `.system-health-row` 樣式
4. 在 `app.js` 新增 `updateSystemHealth()` 函數
5. 新增翻譯 key（6 個 KPI/Health 相關）

### Phase 3: 資產卡片重構 (3h)

1. 重構 `populateAssets()` 的 HTML 模板
2. 實現 `renderEnergyFlow(asset)` — 四節點 + 方向箭頭 + 功率標注
3. 實現 `getFlowDirection(asset)` — 方向判斷 + 顏色映射
4. 實現 `renderDeviceHealth(asset)` — SOC 進度條 + SOH + 循環 + 溫度
5. 實現 `renderTodayPerformance(asset)` — PV 發電 + 節省金額 + 自用率
6. CSS: 能量流動畫 (`flow-arrow`)、新卡片佈局、響應式調整
7. 離線/異常值降級邏輯

### Phase 4: 實時更新聯動 (1h)

1. 擴展 `startRealTimeUpdates()` — metering 值隨機波動（±5%）
2. 每次更新重繪能量流圖 + Device Health + Today Performance
3. KPI Dispatch Accuracy / DR Latency 微幅波動
4. System Health dispatch 計數器遞增

### Phase 5: 翻譯 + 收尾測試 (1h)

1. 補全 12 個翻譯 key（中/英/葡）
2. 三語言切換測試
3. 瀏覽器響應式測試（1920px / 1366px / 768px）
4. 能量守恆校驗最終確認
5. v1.0 批量操作功能回歸測試

**總計: ~8 小時**

---

## Chapter 9: 審閱關注點

以下 4 個決策點需首席架構師確認：

### 1. 能量流圖節點佈局：菱形 vs 環形

- **菱形佈局**（本文檔預設）: PV 上方、Battery 左、Load 右、Grid 下方，視覺重心在中央交匯點
- **環形佈局**: 四節點圍繞圓形排列，連線穿過圓心
- **取捨**: 菱形較易用 CSS Grid 實現且不依賴 Canvas/SVG；環形更適合多節點擴展但實現複雜度高
- **請確認**: 本次 Demo 使用菱形佈局是否滿足需求？

### 2. 財務數據去留：完全移除 vs 折疊到卡片底部

- **完全移除**（本文檔預設）: 卡片聚焦工程/運營視角，財務數據僅在 Portfolio KPI 展示
- **折疊方案**: 在卡片底部新增可展開的 "Financial" 區塊（默認折疊），保留 ROI / 日利潤
- **取捨**: 完全移除更簡潔且不增加卡片高度；折疊方案保留靈活性但增加 ~30 行 CSS/JS
- **請確認**: 是否完全移除財務指標，還是保留折疊入口？

### 3. 四個資產初始數值的能量守恆合理性確認

- §2.5 的場景設計值為意向值，實施時需嚴格校準
- 特別注意 SP_001 場景: PV 4.8kW + Battery charging 1.6kW + Load 6.8kW + Grid 買/賣的平衡
- **請確認**: 四組數值是否符合巴西市場典型 C&I 儲能場景？是否需要調整容量/功率規模？

### 4. System Health 數字更新策略：靜態 vs 跟隨 startRealTimeUpdates

- **靜態方案**: System Health 數字在頁面加載時渲染，不隨即時更新變化（適合 Demo 展示穩定感）
- **動態方案**: Dispatch Success Rate 計數器每 30 秒 +1，Gateway Uptime 微幅波動
- **取捨**: 靜態更穩定不會因波動引起疑慮；動態更真實但可能在 Demo 時出現數字跳動
- **請確認**: Demo 場景下哪種策略更適合？
