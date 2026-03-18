# DESIGN-v6.2-Devices

**Version:** 6.2
**Date:** 2026-03-18
**REQ:** REQ-6.2-Devices-Home-First-Workbench.md
**Status:** Draft

---

## 1. 概述

v6.2 將現有 Devices 頁面（`p2-devices.js`，目前為 Gateway-first Layer 1 + Layer 3 架構）重構為 **Home-first 能源系統控制工作台**。

**核心語義轉換：**
- 頁面主語：Device list / Gateway detail → **Home 現場**
- 操作流程：進入即改參數 → **先找對象、再看現場、再判斷、再修改、再確認、再 Apply**
- 頁面結構：單層列表 + 展開詳情 → **三段式（全局導航 + 對象定位器 + 右側工作台）**
- Schedule 編輯：允許構造非法結構再提交校驗 → **交互本身維持合法結構不變式**

**一句話定義（引自 REQ §18）：**
> 6.2 Devices 應被重構為一個 Home-first 的能源系統控制工作台：左側為固定展開的對象定位器，右側為 60/40 的雙瀑布流工作區，左邊負責現場理解，右邊負責控制執行。

---

## 2. 為什麼 Home-first

### 2.1 問題診斷：主語不清導致頁面退化

REQ §1 指出，`Devices` 這個名字天然引導三種錯誤理解：

| 理解方式 | 問題 |
|----------|------|
| 設備列表頁 | 只見部件清單，看不到現場 |
| Gateway 明細頁 | 技術錨點正確，但跳過了人類"先找現場"的認知步驟 |
| 參數表單頁 | 一進來就改參數，缺少判斷上下文 |

### 2.2 人類真實操作順序

操作者的認知流程是（REQ §1.2）：

1. **找到目標現場**（Home）
2. **看當前狀態與設定**（通過 Gateway 的數據與設定）
3. **在腦中判斷接下來怎麼改**
4. **確認變更**
5. **Apply**

因此頁面最高語義主語應為 **Home**（人類可讀的現場 alias），而非 Gateway（技術控制錨點）或 Device（組成部件）。

### 2.3 三層對象語義定義

| 對象 | 角色 | 設計原則 |
|------|------|---------|
| **Home** | 操作者可自定義的場景代號 / alias | 頁面最高層語義對象；幫助人認現場，不承擔系統控制身份 |
| **Gateway** | 當前實際控制錨點 | 負責 schedule 讀寫、命令下發、telemetry 獲取、同步狀態判定；是 Home 的控制錨點，不是 Home 的替代品 |
| **Device** | 組成與診斷明細對象 | 回答"裝了什麼"、"哪個部件在線/離線"、"異常在哪個部件" |

---

## 3. 信息架構：全局導航 + 對象定位器 + 工作台

### 3.1 為什麼三段式

REQ §4–§6 將頁面分為三個職責層：

```
┌────────────────────────────────────────────────────────────────────────┐
│ 全局導航（左側模組導航）                                                  │
│ Fleet / Devices / Energy / HEMS / VPP / Performance                    │
│ 職責：去哪一頁                                                          │
├──────────────────┬─────────────────────────────────────────────────────┤
│ 對象定位器         │ 右側工作台                                          │
│ (固定展開)         │                                                    │
│                   │  ┌─────────────────┬───────────────────┐            │
│ Home alias        │  │ Data Lane (60%) │ Control Lane (40%)│            │
│ Gateway identity  │  │ 現場理解         │ 控制執行           │            │
│ online/offline    │  │                 │                   │            │
│ SoC (when online) │  │ 能量流動圖       │ 數值設定           │            │
│ 異常 badge        │  │ 關鍵實時數值     │ 時間段編輯器       │            │
│                   │  │ Device 組成/健康 │ 輕量確認 + Apply  │            │
│ 搜索              │  │                 │                   │            │
│                   │  └─────────────────┴───────────────────┘            │
└──────────────────┴─────────────────────────────────────────────────────┘
```

### 3.2 為什麼對象定位器始終固定展開

REQ §6.1 明確要求定位器不自動收起、不作為臨時抽屜：

- 操作者需要**持續知道**自己當前在哪個現場
- 需要**隨時切換** Home / Gateway
- 本頁更像工作台，不像沉浸式單對象編輯器

對象定位器**不是**第二條主導航——它的職責是「選哪個 Home / Gateway」，不是「去哪個模組」。

### 3.3 對象定位器條目設計

每個條目最小信息集（REQ §6.3）：

| 欄位 | 說明 |
|------|------|
| Home alias | 人類可讀場景名 |
| Gateway identity | name 或 ID |
| online / offline | 連線狀態 |
| Battery SoC | 僅 online 時顯示 |
| 異常 badge | pending / failed / warning |

**排序：** 按 Home alias 穩定排序，不因狀態自動跳序（REQ §6.2）。

**搜索：** 一級入口，同時支持 Home alias、Gateway name、Gateway ID（REQ §6.2）。**實現方式：** 採用客戶端過濾（client-side filter）——gateway 列表一次性載入後在前端以 substring match 過濾。理由：當前 `get-gateways.ts` 無搜索參數，列表規模在單一 org tenant 內預期 <200 筆，客戶端過濾足夠且無需後端改動。若未來規模超過 200 筆，再遷移至伺服器端 `?search=` 查詢參數。

### 3.4 右側工作台默認狀態

進入 Devices 頁面時（REQ §7.1）：

- 右側**不自動選擇**任何 Home / Gateway
- 默認呈現空態引導 + 輕量骨架預覽
- 選中後**不展示大 Header 海報**（左側定位器已持續承載對象上下文，避免信息復讀）

---

## 4. Data Lane / Control Lane 責任劃分

### 4.1 為什麼雙瀑布流而非上下堆疊

REQ §7.3 定義右側為 60/40 雙瀑布流，共享單一滾動軸。這兩條流不是主次關係，而是：

> **數據理解流**與**設置操作流**的並行結構。

設計動機：
- 操作者做控制決策時需要**同時看到現場數據**（左列）和**當前設定**（右列）
- 上下堆疊會導致控制區被推到折疊線以下，破壞並行參照
- 單一共享滾動軸保證不出現兩個獨立滾動容器的認知割裂

### 4.2 Data Lane（左列 60%）

按「從現場理解到診斷細節」展開（REQ §8）：

| 順序 | 區塊 | 職責 | 說明 |
|------|------|------|------|
| 1 | **能量流動圖** | 首屏第一優先 | PV / Battery / Load / Grid 四向功率流向 + 量級 |
| 2 | 關鍵實時數值 | 補充量化 | SoC、power、voltage 等 |
| 3 | Device Composition / Health | 組成與診斷 | 該 Home 內各 Device 的在線/離線/異常 |
| 4 | 其他狀態或異常信息 | 擴展 | EMS health、telemetry extras 等 |

**為什麼能量流動圖排第一（REQ §8.1）：**
- 單純堆數字無法快速建立現場理解
- 能量流方向是操作者最需要的第一認知層
- 現有 `_buildEnergyFlow()` 已在 Layer 3 實現能量流圖（`p2-devices.js:1667`），可作為基礎

### 4.3 Control Lane（右列 40%）

按「從理解當前約束到執行修改」展開（REQ §9）：

| 順序 | 區塊 | 職責 | 說明 |
|------|------|------|------|
| 1 | **數值設定** | 先看當前控制約束 | SoC min/max、charge/discharge limit、mode（per-slot；若所有 slot 同 mode 則顯示該值，否則顯示 "Mixed"）、grid limit |
| 2 | **時間段編輯器** | 再進入 schedule 細節 | 混合型：預覽 + 表單 |
| 3 | **輕量確認** | 防改錯對象、防看漏改動 | 顯示 Home alias + Gateway ID + 字段 diff（from → to） |
| 4 | **Apply** | 流程末端 | 不固定、不懸浮、不 sticky，跟隨頁面自然流動 |

**為什麼數值設定排在時間段編輯器之前（REQ §9.1）：**
- 操作者先要知道當前控制約束是什麼
- 時間段編輯屬於更深層、成本更高的操作

**為什麼 Apply 不 sticky（REQ §9.3）：**
- 本頁強調判斷鏈，不是持續誘導提交
- Apply 是流程末端，不應成為懸浮壓迫性按鈕

---

## 5. Schedule Editor 交互模型

### 5.1 為什麼混合型（預覽 + 表單）

REQ §11.1 在三種形態中選擇了 **C：混合型**：

| 形態 | 優點 | 缺點 |
|------|------|------|
| 純時間軸型 | 整體感強 | 編輯易擁擠 |
| 純表單型 | 穩定 | 缺乏全天結構感 |
| **混合型** | **先看懂再編輯** | 需同步兩個視圖 |

結構：
- **上方：** 輕量時間軸預覽（24h bar）
- **下方：** slot 列表表單編輯

### 5.2 預覽交互：分階段實現

最終目標為 **B：輕度可編輯**（REQ §11.2），但在 vanilla JS 中實現含 snap-to-grid、雙向 resize、touch 支持的指針事件拖拽非同小可。因此分階段：

- **Phase 1（v6.2 核心）：** 時間軸預覽為**只讀視覺化**；時間邊界變更僅通過 split/merge + 表單 select 完成。此路徑已足夠滿足所有結構性硬規則（§5.3）。
- **Phase 2（v6.2 後續或 v6.3）：** 為時間軸預覽增加拖拽共享邊界交互。

複雜參數（purpose、direction、export policy）始終在下方表單編輯。不做圖上全功能排程器。

### 5.3 結構性硬規則（核心不變式）

REQ §12.1 定義 Schedule 必須始終滿足：

1. 覆蓋完整 24h（`00:00` → `24:00`）
2. 不允許重疊
3. 不允許留空檔
4. 相鄰 slot 必須連續銜接
5. 時間粒度鎖死為 1 小時（整點）

**設計原則（REQ §12.2）：**

> 通過交互本身盡量維持合法結構，而非依賴"用戶先弄壞，Apply 時才報錯"。

這是對現有前端的重要改進——現有 `p2-devices.js` 的 schedule 編輯允許用戶構造 overlap 和 gap（REQ §16.3），僅在 Apply 前校驗。後端 `schedule-translator.ts` 的 `validateSchedule()` 已具備完整的 24h 覆蓋 / 無 overlap / 無 gap / 整點粒度校驗（`schedule-translator.ts:207-297`），但前端編輯過程未強制維持此不變式。

### 5.4 拖拽規則

REQ §12.3 定義拖拽語義為**共享邊界拖拽**：

- 拖的是兩個相鄰 slot 的共享邊界
- 左邊 slot 的 end 與右邊 slot 的 start **同步變化**
- 不能制造 overlap 或 gap
- 第一段 start 鎖死 `00:00`，最後一段 end 鎖死 `24:00`
- 時間吸附到整點

### 5.5 Add / Delete 規則

| 操作 | 語義 | 說明 |
|------|------|------|
| **Add** | Split 當前 slot | 在某個整點切開，原 slot 變為兩段；天然維持 24h 連續覆蓋 |
| **Delete** | Merge 到相鄰 slot | 刪除後自動並入前一段或後一段；不允許留下 gap |

現有實現（`p2-devices.js` 的 `schedule-add-slot` 按鈕）採用「凭空新增一段」模式，需改為 split 語義。

### 5.6 時間粒度

本期鎖定為 **1 小時**（REQ §14）：
- UI 只允許整點
- 拖拽吸附整點
- split 只能切整點
- 校驗按整點執行

這與後端 `validateSchedule()` 中的 `startMinute % 60 !== 0` 校驗一致。

---

## 6. Online / Offline / Pending 狀態行為

### 6.1 狀態矩陣

| 狀態 | Data Lane | Control Lane | Apply |
|------|-----------|-------------|-------|
| **Online + idle** | 正常顯示 | 正常編輯 | 可 Apply |
| **Online + pending command** | 正常顯示 | **全鎖、不可編輯** | **不可 Apply** |
| **Offline + 有歷史快照** | 正常顯示 | **只讀**（顯示 last known settings） | **不可 Apply** |
| **Offline + 無歷史快照** | unavailable 空態 | unavailable 空態 | **不可 Apply** |

### 6.2 syncStatus 規範化要求

`get-gateway-detail.ts` 與 `get-gateway-schedule.ts` 對 syncStatus 的映射目前不一致：
- `detail` 識別 `pending_dispatch` → `"pending"`，不識別 `dispatched`/`accepted`（落入 `"unknown"`）
- `schedule` 識別 `dispatched`/`accepted` → `"pending"`，有獨立 `"failed"` 狀態

**v6.2 決策：** 以 `get-gateway-schedule.ts` 的 syncStatus 為狀態機判定的**唯一權威來源**。Control Lane 的 pending/idle/failed 判定僅讀取 schedule 端點回傳。detail 端點的 syncStatus 僅用於對象定位器的輕量 badge 顯示。v6.2 實現期間應同步規範化兩端映射（納入 PLAN），但即使規範化未完成，前端仍可依據此單一來源規則正確運作。

### 6.3 為什麼 pending 時全鎖 Control Lane

REQ §15.2：
- 避免並發修改
- 避免 UI 與設備狀態分叉
- 等待命令結果回流後再開放

### 6.4 為什麼 offline 時分兩種情況

REQ §15.3 + §16.1：offline 是否能展示設置，取決於**是否存在可信歷史記錄**，而非假定系統擁有獨立配置主表。

「歷史快照」的實際含義：從 `device_command_logs` 的歷史成功 `set` / `get_reply` 中提取的最近可用值。這正是 `get-gateway-schedule.ts` 中已實現的優先級鏈（§7.1）。

---

## 7. 當前實現約束與遷移注記

### 7.1 無獨立 Settings 主表

當前 battery schedule 的讀取來源（REQ §16.1，已在 `get-gateway-schedule.ts` 中實現）：

| 優先級 | 來源 | 說明 |
|--------|------|------|
| 1 | 最新成功 `set battery_schedule` 的 `payload_json` | `device_command_logs` 表 |
| 2 | 最新 `get_reply battery_schedule` 的 `payload_json` | fallback |
| 3 | 硬編碼 default + asset capacity 欄位 | `get-gateway-detail.ts:217-225`（注意：此為 detail 端點的 `config` 區段，非 schedule 端點的一部分） |

v6.2 **不建立獨立 canonical settings table**。上述優先級鏈已在 `get-gateway-schedule.ts:52-143` 中實現，v6.2 繼續沿用。

**`batterySchedule: null` 的處理：** 當優先級 1 和 2 均無數據時，`get-gateway-schedule.ts` 回傳 `batterySchedule: null`。此時 Control Lane 應：
- 數值設定區：顯示 `get-gateway-detail.ts` 的 `config` 區段默認值（如 `socMin: 10, socMax: 100`）作為參考，並標注為「默認值」
- Schedule 時間段編輯器：顯示空態（無可編輯的 slot）
- `detail.config` 提供的是設備容量參數與硬編碼預設，**不等同於** schedule 端點的歷史派生 payload

### 7.2 後端校驗已嚴格

`schedule-translator.ts` 的 `validateSchedule()` 已具備（REQ §16.2）：
- 24h 完整覆蓋（`startMinute === 0`、`endMinute === 1440`）
- 無 overlap（`curr.startMinute < prev.endMinute` → throw）
- 無 gap（`curr.startMinute > prev.endMinute` → throw）
- 整點粒度（`% 60 !== 0` → throw）
- SoC min < max
- 非負整數校驗

### 7.3 前端編輯體驗缺口

現有 `p2-devices.js` 的 schedule 編輯器（`_buildBatteryScheduleCard`，line ~933）：
- 使用 `<select>` 下拉框選擇 startMinute / endMinute（每 60 分鐘一個選項）
- Add slot 為「凭空新增」而非 split
- Delete slot 為「直接刪除」而非 merge
- 允許構造 overlap / gap，僅在 Apply 前校驗

v6.2 需將 add → split、delete → merge，並在拖拽 / 選擇時即時維持 24h 不變式。

### 7.4 現有前端 Layer 結構

`p2-devices.js` 當前為兩層架構：
- **Layer 1：** Gateway card list（`_buildLayer1`），含展開的 device rows
- **Layer 3：** Gateway detail（`_buildLayer3`），含 energy flow、telemetry、config、schedule

v6.2 將此兩層架構替換為三段式（全局導航 + 對象定位器 + 右側工作台）。

### 7.5 現有後端端點可複用性

| 端點 | 現狀 | v6.2 動作 |
|------|------|---------|
| `GET /api/gateways/:id/detail` | Gateway 級聚合詳情（state + telemetry + config + devices + schedule） | **可複用** — 提供 Data Lane 大部分數據 |
| `GET /api/gateways/:id/schedule` | 讀取 schedule（含 sync status） | **可複用** — 提供 Control Lane 的 schedule 數據 |
| `PUT /api/gateways/:id/schedule` | 下發 schedule | **可複用** — Apply 動作繼續使用 |
| `GET /api/gateways` | 列出 gateways | **需擴展 + 註冊路由** — handler 已存在（`get-gateways.ts`），但路由**未在 `bff-stack.ts` 中註冊**（當前為死代碼，僅 mock 模式可用）。v6.2 必須先註冊路由，再擴展回傳 Home alias + SoC |

### 7.6 Home alias 的來源

REQ 定義 Home 為「操作者可自定義的場景代號 / alias」。當前系統中 **Home alias 並非現有數據模型中的獨立字段**。

**可能的實現路徑（待 PLAN 確認）：**

| 方案 | 描述 | 影響 |
|------|------|------|
| A: `gateways` 表加 `home_alias` 欄位 | 最簡單 | 需 DDL + 後端 + 前端 |
| B: 獨立 `homes` 表 | 語義清晰，支持 1:N Home:Gateway | DDL + 關聯查詢 + 前端 |
| C: 前端 local 別名（localStorage） | 無後端改動 | 不可跨設備共享、不持久 |

**建議方案 A**：在 `gateways` 表新增 `home_alias VARCHAR(100)` 欄位。理由：
- 當前 Home 與 Gateway 為 1:1 關係（REQ 未要求 1:N）
- 最小化 DDL 改動
- alias 可為空（fallback 到 gateway name）

---

## 8. 非目標（本期不做）

以下項目不屬於 v6.2 核心目標（REQ §17）：

1. 圖上全功能排程器
2. 複雜預測仿真
3. 提交前能源結果模擬器
4. 30 分鐘或更細粒度調度
5. 離線排隊提交
6. 將左側對象定位器做成第二條主導航

---

## 9. 模塊影響矩陣

| 模塊 | 文件路徑 | 動作 | 風險 | 說明 |
|------|----------|------|------|------|
| **DB — home_alias** | `db-init/02_schema.sql` | **改** | 低 | `gateways` 表新增 `home_alias` 欄位（提議） |
| **BFF — gateway list** | `backend/src/bff/handlers/get-gateways.ts`（可能） | **改** | 低 | 回傳 home_alias + SoC 供對象定位器使用 |
| **BFF — gateway detail** | `backend/src/bff/handlers/get-gateway-detail.ts` | **不動** | 無 | 已提供 Data Lane 所需數據 |
| **BFF — gateway schedule** | `backend/src/bff/handlers/get-gateway-schedule.ts` | **不動** | 無 | 已提供 Control Lane 的 schedule 數據 |
| **BFF — put schedule** | `backend/src/bff/handlers/put-gateway-schedule.ts` | **不動** | 無 | Apply 動作繼續使用（已確認存在，回傳 202，需 ADMIN/MANAGER 角色） |
| **IoT — schedule-translator** | `backend/src/iot-hub/handlers/schedule-translator.ts` | **不動** | 無 | 驗證邏輯已完整 |
| **Frontend — p2-devices.js** | `frontend-v2/js/p2-devices.js` | **重寫** | 高 | 三段式工作台、schedule editor 結構性約束改造 |
| **Frontend — data-source.js** | `frontend-v2/js/data-source.js` | **改** | 低 | 可能需新增 home_alias 相關 API 方法 |

### 風險等級定義

| 等級 | 定義 |
|------|------|
| 高 | 核心交互模型變更（三段式佈局、schedule editor 語義重構），錯誤會導致操作流程不正確 |
| 中 | 新增數據字段或擴展現有 API，影響有限 |
| 低 | 增量式改動，不影響現有行為 |
