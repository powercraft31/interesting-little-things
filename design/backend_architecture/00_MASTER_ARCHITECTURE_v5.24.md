# SOLFACIL VPP -- Master Architecture Blueprint

> **Module Version**: v5.24
> **Last Updated**: 2026-03-13
> **Description**: System master blueprint -- P3 Asset History View (P3-1 Energy Flow + P3-2 Equipment Health)
> **Core Theme**: P3 Asset History View — asset 級多粒度歷史查詢頁面，新增 2 BFF endpoints + 2 前端頁面

---

## Document Index

| # | Document | Path | Description |
|---|----------|------|-------------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.24.md` | System master blueprint (this document) |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.22.md](./01_IOT_HUB_MODULE_v5.22.md) | v5.22: Two-phase set_reply + BackfillRequester + MissedDataHandler |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.22.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.22.md) | v5.16 PS slot generation (schema dep: homes→gateways) |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.22.md](./03_DR_DISPATCHER_MODULE_v5.22.md) | v5.22: M3→M1 command pipeline + accepted timeout |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.24.md](./04_MARKET_BILLING_MODULE_v5.24.md) | **v5.24: +P3 savings 即時計算公式對齊** |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.24.md](./05_BFF_MODULE_v5.24.md) | **v5.24: 34 handlers + 2 new P3 endpoints** |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.23.md](./06_IDENTITY_MODULE_v5.23.md) | Identity -- separate task |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API -- unchanged |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane -- separate task |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.24.md](./09_SHARED_LAYER_v5.24.md) | **v5.24: +tariffHelper 評估** |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.24.md](./10_DATABASE_SCHEMA_v5.24.md) | **v5.24: +多粒度查詢模式文檔** |
| 15 | **P3_EXECUTION_PLAN** | [15_P3_EXECUTION_PLAN_v5.24.md](./15_P3_EXECUTION_PLAN_v5.24.md) | **v5.24: P3 分階段實施計劃** |

---

## 1. System Positioning

(Same as v5.22. See `00_MASTER_ARCHITECTURE_v5.22.md` S1.)

> **v5.24 Version Notes (2026-03-13)**
>
> **Core Theme: P3 Asset History View**
>
> v5.24 新增 P3 Asset History View 功能，從 P2 Gateway Detail 點擊個別 asset
> 進入 P3 頁面，提供多粒度歷史遙測數據視覺化。
>
> **P3 範圍：**
> - P3-1 Energy Flow：日/週/月/年視圖，PV/負載/電池/電網功率時序，摘要卡片（自消費率、自給率、節省金額）
> - P3-2 Equipment Health：SOC/SOH/溫度歷史，電壓/電流，DO 事件紀錄
> - 2 個新 BFF endpoints：`GET /api/assets/:assetId/telemetry` + `GET /api/assets/:assetId/health`
> - 2 個新前端頁面：`p3-energy.js` + `p3-health.js`
>
> **不做的：** 即時數據流(SSE/WS)、多 asset 疊加比較、PDF 匯出、預測/預報、自訂圖表

### Technology Stack

(Same as v5.22.)

### Core Design Principles

(Same as v5.22.)

---

## 2. Page Architecture（v5.24 更新）

### 頁面層級結構

```
P1 Fleet Overview          ─── 全車隊概覽
  └── P2 Gateway Detail     ─── 單一 Gateway 詳情（設備列表 + 24h 能量流 + 排程）
        └── P3 Asset History ─── 單一 Asset 歷史視圖（v5.24 NEW）
              ├── P3-1 Energy Flow    ─── 能量流（日/週/月/年視圖 + 摘要卡片）
              └── P3-2 Equipment Health ─── 設備健康（SOC/SOH/溫度 + DO 事件）
P4 HEMS Control             ─── 批次調度控制
P5 VPP Market               ─── VPP 市場數據
P6 Performance              ─── 績效儀表板
```

### 路由表（v5.24 更新）

| 頁面 | Hash Route | JS 檔案 | 版本 |
|------|-----------|---------|------|
| P1 Fleet Overview | `#fleet` (default) | `p1-fleet.js` | v5.12 |
| P2 Devices (含 Gateway Detail 子視圖) | `#devices` | `p2-devices.js` | v5.20 |
| **P3-1 Energy Flow** | **`#asset-energy/:assetId`** | **`p3-energy.js`** | **v5.24** |
| **P3-2 Equipment Health** | **`#asset-health/:assetId`** | **`p3-health.js`** | **v5.24** |
| P4 HEMS Control | `#hems` | `p4-hems.js` | v5.12 |
| P5 VPP Market | `#vpp` | `p5-vpp.js` | v5.12 |
| P6 Performance | `#performance` | `p6-performance.js` | v5.14 |

> **注意**：P3-1/P3-2 使用帶參數的 hash route（`#asset-energy/:assetId`）。現有 `app.js` 的 router（`PAGES` 陣列 + `navigateTo`）僅支援精確 hash 比對。實施時需擴展 router 以支援參數化路由匹配（例如 `location.hash.startsWith('#asset-energy/')` 模式）。

### P3 導航流程

```
P2 Gateway Detail
  │
  │ 點擊 asset 卡片（逆變器/電池）
  │
  ▼
P3 Asset History
  ┌─────────────────────────────────────────┐
  │ 頂部導航列                               │
  │ ← 返回 Gateway │ Gateway名稱 → Asset名稱 │
  ├─────────────────────────────────────────┤
  │ Tab: [能量流] [設備健康]                  │
  ├─────────────────────────────────────────┤
  │ 全域控件（兩 tab 共用）                   │
  │ 日期選擇器：[←] 2026-01-21 (三) · BRT [→]│
  │ 快捷：[今天] [昨天] [7天] [30天] [自訂]   │
  │ 粒度：[日] [週] [月] [年]                 │
  ├─────────────────────────────────────────┤
  │ 內容區域（依 tab + 粒度切換）             │
  └─────────────────────────────────────────┘
```

---

## 3. API Contract Governance

(Same as v5.22.)

---

## 4. 8 Module Boundaries & Responsibilities

### Module Version Matrix（v5.24 更新）

| Module ID | Module Name | Current Version | Document | Key Technology |
|-----------|------------|----------------|----------|---------------|
| Shared | Shared Layer | **v5.24** | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.24.md) | +tariff helper 評估（結論：不抽取，inline in handler） |
| Shared | Database Schema | **v5.24** | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.24.md) | +多粒度查詢模式文檔（無 DDL 變更） |
| M1 | IoT Hub | v5.22 | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.22.md) | 不涉及 — 歷史查詢不經過 MQTT/M1 |
| M2 | Optimization Engine | v5.16 | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.22.md) | 不涉及 |
| M3 | DR Dispatcher | v5.22 | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.22.md) | 不涉及 |
| M4 | Market & Billing | **v5.24** | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.24.md) | +P3 savings 即時計算公式對齊 |
| M5 | BFF | **v5.24** | [05_BFF](./05_BFF_MODULE_v5.24.md) | Express + **34 handlers** + 2 new P3 endpoints |
| M6 | Identity | v5.23 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.23.md) | 不涉及 |
| M7 | Open API | v5.7 | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | 不涉及 |
| M8 | Admin Control | v5.10 | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | 不涉及 |

---

## 5. P3 Data Flow Diagram（v5.24 NEW）

```
┌──────────────┐     ┌──────────────────────────────────────┐
│  Frontend    │     │              BFF (M5)                │
│              │     │                                      │
│  p3-energy.js│────▶│ GET /api/assets/:id/telemetry       │
│    ECharts   │     │   ├── Q1: telemetry_history (points) │
│    日期選擇器 │     │   ├── Q2: telemetry_history (summary)│
│    粒度切換  │     │   └── Q3: tariff_schedules (rates)   │
│              │     │                                      │
│  p3-health.js│────▶│ GET /api/assets/:id/health           │
│    ECharts   │     │   ├── Q1: telemetry_history (current)│
│    DO事件表  │     │   ├── Q2-Q4: telemetry_history       │
│              │     │   │   (SOC/SOH/temp histories)       │
│              │     │   ├── Q5: telemetry_history (cycles)  │
│              │     │   ├── Q6: telemetry_history (DO)      │
│              │     │   └── Q7: assets (capacity_kwh)       │
│              │     │                                      │
│ data-source.js     │   All via queryWithOrg (RLS)         │
│ +asset.telemetry() │                                      │
│ +asset.health()    │                                      │
└──────────────┘     └──────────────┬───────────────────────┘
                                    │
                     ┌──────────────▼───────────────────────┐
                     │         PostgreSQL                    │
                     │                                      │
                     │  telemetry_history (PARTITIONED)     │
                     │    idx_telemetry_unique_asset_time   │
                     │    (asset_id, recorded_at)           │
                     │    → date_trunc aggregation          │
                     │                                      │
                     │  tariff_schedules                    │
                     │    peak/offpeak/intermediate rates   │
                     │                                      │
                     │  assets                              │
                     │    capacity_kwh (for cycle calc)     │
                     └──────────────────────────────────────┘
```

---

## 6. Inter-Module Communication（v5.24 更新）

v5.24 不引入新的模組間通訊。P3 端點為純讀取（BFF → telemetry_history），不觸發任何事件或寫入。

與 v5.22 差異：
```
M5 (BFF)               --reads    -->  telemetry_history (P3: asset-level, multi-granularity)  ← NEW v5.24
                        --reads    -->  tariff_schedules (P3: savings calculation)               ← NEW v5.24
                        --reads    -->  assets (P3: capacity_kwh for cycle calc)                 ← NEW v5.24
```

其餘模組間通訊與 v5.22 完全相同。

---

## 7. v5.24 Module Impact Map

| Module | Versions | Files Changed | Impact Level |
|--------|----------|--------------|-------------|
| **M5 BFF** | v5.22→v5.24 | 2 new handlers, 1 modified (local-server.ts) | **Primary** |
| **Frontend** | v5.22→v5.24 | 2 new (p3-energy.js, p3-health.js), 2 modified (data-source.js, index.html) | **Primary** |
| **M4 Market & Billing** | v5.22→v5.24 | 0 code changes (doc alignment only) | Doc only |
| **Shared Layer** | v5.22→v5.24 | 0 code changes (tariff helper evaluation) | Doc only |
| **Database Schema** | v5.22→v5.24 | 0 DDL changes (query pattern docs) | Doc only |
| M1 IoT Hub | — | 0 | None |
| M2 Optimization | — | 0 | None |
| M3 DR Dispatcher | — | 0 | None |
| M6 Identity | — | 0 | None |
| M7 Open API | — | 0 | None |
| M8 Admin Control | — | 0 | None |

### Frontend File Changes（v5.24）

| 檔案 | 動作 | 說明 |
|------|------|------|
| `frontend-v2/js/p3-energy.js` | **NEW** | P3-1 能量流頁面：日期選擇器、粒度切換、ECharts 折線/長條圖、摘要卡片 |
| `frontend-v2/js/p3-health.js` | **NEW** | P3-2 設備健康：SOC/SOH/溫度/電壓電流圖表、DO 事件表 |
| `frontend-v2/js/data-source.js` | **MODIFY** | 新增 `asset` namespace：`telemetry(assetId, from, to, resolution)` + `health(assetId, from, to)` |
| `frontend-v2/index.html` | **MODIFY** | 路由新增 `#asset-energy/:assetId` + `#asset-health/:assetId`；引入 p3-energy.js + p3-health.js |

---

## 8. Version Delta Summary: v5.22 → v5.24

| Aspect | v5.22 | v5.24 |
|--------|-------|-------|
| BFF handlers | 32 | **34** (+get-asset-telemetry, +get-asset-health) |
| Frontend pages | P1-P6 (6 pages) | **P1-P6 + P3-1 + P3-2** (8 pages, P3 split from P2) |
| Hash routes | 6 | **8** (+#asset-energy/:id, +#asset-health/:id) |
| telemetry_history access patterns | gateway-level 24h, asset latest 1 row | **+asset-level multi-granularity (5min/hour/day/month)** |
| Savings calculation | M4 batch (revenue_daily), BFF gateway-level | **+P3 asset-level real-time** (same formula, different source) |
| DDL changes | 0 | **0** (no schema changes) |
| New tables | 0 | **0** |

---

## 9. Open Items

### v5.25+ (Future)

- P1/P2 連動：P1 加日期顯示，P2 gateway 卡片加 sparkline
- 多 asset 疊加比較（P3 V2）
- PDF 報表匯出
- 預測/預報引擎整合
- P3 即時數據流（SSE/WebSocket）

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: 8 modules, EventBus, architecture governance |
| v5.3 | 2026-02-27 | HEMS single-home scenario |
| v5.4 | 2026-02-27 | PostgreSQL replaces DynamoDB/Timestream |
| v5.5 | 2026-02-28 | Dual-layer economic model |
| v5.6 | 2026-02-28 | System heartbeat + internal pipeline automation |
| v5.7 | 2026-02-28 | External awareness + M7 bidirectional |
| v5.8 | 2026-03-02 | Telemetry closed-loop + Data Contract |
| v5.9 | 2026-03-02 | Logic closed-loop + de-hardcoding |
| v5.10 | 2026-03-05 | 3D fix: DB Bootstrap + Architecture Boundary + BFF De-hardcoding |
| v5.11 | 2026-03-05 | Dual Connection Pool |
| v5.12 | 2026-03-05 | API Contract Alignment & BFF Expansion: 15 new endpoints |
| v5.13 | 2026-03-05 | Data Pipeline & Deterministic Math |
| v5.14 | 2026-03-06 | Formula Overhaul & Deep Telemetry |
| v5.15 | 2026-03-07 | SC/TOU Attribution & 5-min Telemetry |
| v5.16 | 2026-03-07 | Peak Shaving |
| v5.22 | 2026-03-13 | Two-phase set_reply + Backfill + SSE + Dispatch Guard |
| **v5.24** | **2026-03-13** | **P3 Asset History View：P3-1 Energy Flow（日/週/月/年視圖 + savings 計算）+ P3-2 Equipment Health（SOC/SOH/溫度 + DO 事件）；+2 BFF endpoints（get-asset-telemetry + get-asset-health）；+2 前端頁面（p3-energy.js + p3-health.js）；+2 hash routes；34 BFF handlers total；0 DDL changes** |
