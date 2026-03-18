# PLAN-v6.2-Devices

**Version:** 6.2
**Date:** 2026-03-18
**REQ:** REQ-6.2-Devices-Home-First-Workbench.md
**DESIGN:** DESIGN-v6.2-Devices.md
**Status:** Draft

---

## 1. 任務拆解

### Phase 1：數據模型 + BFF 擴展（Home alias）

#### T1: DDL — gateways 表新增 home_alias 欄位

| 項目 | 內容 |
|------|------|
| **文件** | `db-init/02_schema.sql` |
| **改動** | `gateways` 表新增 `home_alias VARCHAR(100)` 欄位（nullable，fallback 到 gateway name） |
| **預計行數** | +3 行（ALTER + COMMENT） |
| **前置** | 無 |
| **可並行** | 是（DDL 獨立） |

**詳細步驟：**
1. 在 `02_schema.sql` 的 gateways 表定義區（約 line 1186-1206）末尾追加 `home_alias` 欄位
2. 加欄位註釋：「Human-readable alias for the Home site this gateway belongs to」
3. 無 NOT NULL 約束——alias 為空時前端 fallback 到 `gateway.name`

**設計決策（DESIGN §7.6 方案 A）：**
- 當前 Home 與 Gateway 為 1:1 關係（REQ 未要求 1:N）
- 在 gateways 表新增欄位比獨立 homes 表更簡單
- 如未來需要 1:N，可遷移到獨立表而不破壞前端 API 合約

---

#### T2: BFF — get-gateways.ts 擴展（回傳 home_alias + SoC）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-gateways.ts`（現有 70 行） |
| **改動** | SELECT 新增 `home_alias`；JOIN 最新 telemetry 取 battery SoC；回傳增加 `homeAlias`、`batterySoc` 欄位 |
| **預計行數** | ~+15 行 |
| **前置** | T1 (DDL) |
| **可並行** | 與 T3 並行 |

**詳細步驟：**
1. SQL SELECT 增加 `g.home_alias`
2. LEFT JOIN 最新 battery telemetry 取 SoC（可複用 `get-gateway-detail.ts` 中 Q1 的 device_state join 邏輯）
3. 回傳 response 增加 `homeAlias: row.home_alias || row.name`（前端 fallback）
4. 回傳 response 增加 `batterySoc: row.battery_soc`（nullable，offline 時為 null）
5. 保持現有 auth middleware 與 org 過濾不變

---

#### T3: BFF — 新增 PATCH /api/gateways/:id/home-alias 端點（可選）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/patch-gateway-home-alias.ts`（新建） |
| **改動** | 允許操作者修改 home_alias |
| **預計行數** | ~40 行 |
| **前置** | T1 (DDL) |
| **可並行** | 與 T2 並行 |

**詳細步驟：**
1. 接受 `{ homeAlias: string }` body
2. 校驗：非空、長度 ≤ 100、trim whitespace
3. `UPDATE gateways SET home_alias = $1 WHERE gateway_id = $2`
4. 回傳 204 No Content
5. 角色要求：SOLFACIL_ADMIN、ORG_MANAGER

---

#### T4: BFF — bff-stack.ts 路由註冊（GET /api/gateways + PATCH home-alias）

| 項目 | 內容 |
|------|------|
| **文件** | `backend/lib/bff-stack.ts` |
| **改動** | 註冊 `GET /api/gateways` 路由（**當前為死代碼：handler 存在但路由未註冊，僅 mock 模式可用**）+ 註冊 PATCH home-alias 路由 |
| **預計行數** | +10 行 |
| **前置** | T2, T3 |
| **可並行** | 否（依賴 T2 + T3） |

**詳細步驟：**
1. 在 `bff-stack.ts` 現有的三條 gateway 路由（detail / schedule GET / schedule PUT）之前，新增 `GET /api/gateways` 路由，指向 `get-gateways` handler
2. 新增 `PATCH /api/gateways/{gatewayId}/home-alias` 路由，指向 `patch-gateway-home-alias` handler
3. 確保 auth middleware 與 org 過濾一致

**⚠️ 重要：** 不註冊 `GET /api/gateways` 路由的話，整個對象定位器（左側面板）將無法載入任何數據——`DataSource.devices.gateways()` 會 404。這是 v6.2 的阻塞前置條件。

---

#### T4b: BFF — syncStatus 映射規範化

| 項目 | 內容 |
|------|------|
| **文件** | `backend/src/bff/handlers/get-gateway-detail.ts`、`backend/src/bff/handlers/get-gateway-schedule.ts` |
| **改動** | 統一兩端點的 syncStatus 映射邏輯，使 `dispatched`、`accepted`、`pending_dispatch` 在兩端一致映射為 `"pending"`；`failed`、`timeout` 一致映射為 `"failed"` |
| **預計行數** | ~+10 行（detail handler 增加缺失的狀態分支） |
| **前置** | 無（獨立修復） |
| **可並行** | 是（與 T1-T4 並行） |

**背景（DESIGN §6.2）：** 當前 `get-gateway-detail.ts`（line 253-258）與 `get-gateway-schedule.ts`（line 153-162）的 syncStatus 映射不一致。`dispatched` 在 schedule 端為 `"pending"`，在 detail 端落入 `"unknown"`。若不修復，T8 的狀態機判定會因查詢端點不同而出現不同結果。

**過渡策略：** 即使規範化尚未完成，前端 T8 應以 `get-gateway-schedule.ts` 的 syncStatus 為狀態機判定的唯一權威來源（DESIGN §6.2）。

---

### Phase 2：前端 — 三段式工作台骨架

#### T5: Frontend — p2-devices.js 重寫為三段式佈局

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p2-devices.js`（現有 2,348 行） |
| **改動** | 以三段式架構重寫：全局導航（已有）+ 對象定位器 + 右側工作台（60/40 雙瀑布流） |
| **預計行數** | ~1,800-2,200 行（重寫後可能略減，因職責更清晰） |
| **前置** | T2（API 回傳 homeAlias + SoC） |
| **可並行** | 否（核心交互頁面，串行開發） |

**詳細步驟：**

**5a. 頂層佈局骨架**
1. 移除現有 `_buildLayer1()` + `_buildLayer3()` 雙層架構
2. 建立三段式容器：`_buildLocator()` (左) + `_buildWorkbench()` (右)
3. 右側工作台內建立 60/40 雙欄容器，共享單一滾動軸
4. 進入頁面時右側呈現空態引導（REQ §7.1）

**5b. 對象定位器（左側固定展開）**
1. `_buildLocator()` — 始終展開，不自動收起
2. 調用 `DataSource.devices.gateways()` 取列表
3. 每條目顯示：Home alias、Gateway identity、online/offline 狀態、Battery SoC（online 時）、異常 badge
4. 按 Home alias 穩定排序（不因狀態跳序）
5. 搜索框：**客戶端過濾**（client-side substring match），同時搜索 Home alias、Gateway name、Gateway ID。gateway 列表一次性載入後在前端過濾，無需後端 `?search=` 參數。理由：單一 org tenant 內列表規模預期 <200 筆，客戶端過濾足夠且避免後端改動。若未來規模超 200 筆，再遷移至伺服器端搜索。
6. 點選條目後觸發右側工作台載入

**5c. 右側工作台容器**
1. `_buildWorkbench(gatewayId)` — 選中對象後呈現
2. 呼叫 `DataSource.devices.gatewayDetail(gatewayId)` + `DataSource.devices.getSchedule(gatewayId)` 並行
3. 不展示大 Header 海報（左側定位器已承載對象上下文）
4. 建立 Data Lane (60%) + Control Lane (40%) 雙欄

---

#### T6: Frontend — Data Lane 實現

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p2-devices.js`（T5 重寫內） |
| **改動** | Data Lane 四個區塊：能量流動圖 → 關鍵實時數值 → Device Composition/Health → 其他狀態 |
| **預計行數** | 包含在 T5 行數內 |
| **前置** | T5（佈局骨架） |
| **可並行** | 與 T7 並行（兩條 Lane 可獨立開發） |

**詳細步驟：**

**6a. 能量流動圖（首屏第一優先）**
1. 遷移現有 `_buildEnergyFlow()`（line 1667）到 Data Lane 左列頂部
2. 保持 PV / Battery / Load / Grid 四向功率流向 + 量級顯示
3. 數據來源：`gatewayDetail.state`（battery/PV/grid telemetry）

**6b. 關鍵實時數值**
1. SoC、power、voltage 等數值卡片
2. 數據來源：`gatewayDetail.state` + `gatewayDetail.telemetryExtra`

**6c. Device Composition / Health**
1. 遷移並改進現有 device rows 邏輯
2. 顯示該 Home 內各 Device 的在線/離線/異常
3. 數據來源：`gatewayDetail.devices`

**6d. 其他狀態**
1. EMS health（來自 `gatewayDetail.gateway.emsHealth`）
2. 其他 telemetry extras

---

#### T7: Frontend — Control Lane 實現（不含 Schedule Editor）

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p2-devices.js`（T5 重寫內） |
| **改動** | Control Lane 區塊：數值設定 → （schedule editor 佔位）→ 輕量確認 → Apply |
| **預計行數** | 包含在 T5 行數內 |
| **前置** | T5（佈局骨架） |
| **可並行** | 與 T6 並行 |

**詳細步驟：**

**7a. 數值設定區（頂部第一塊）**
1. 顯示當前控制數值：SoC min/max、charge/discharge limit、mode（per-slot 欄位——若所有 slot 共享同一 mode 則顯示該值，否則顯示 "Mixed"）、grid limit
2. 數據來源：`getSchedule` response 的 `batterySchedule` 頂層欄位（socMinLimit、socMaxLimit、chargeCurrentLimit、dischargeCurrentLimit 等）
3. **`batterySchedule: null` 的處理：** 若 schedule 端點回傳 `batterySchedule: null`（即無歷史 set/get_reply），數值設定區應顯示 `gatewayDetail.config` 的硬編碼默認值（如 `socMin: 10, socMax: 100`）作為參考並標注「默認值」；schedule 時間段編輯器顯示空態。注意：`detail.config` 是設備容量參數，不等同於 schedule 端點的歷史派生 payload。
4. 可編輯表單，inline editing

**7b. 輕量確認區**
1. 顯示 Home alias + Gateway ID + 字段 diff（from → to）
2. 僅在有變更時展開
3. 不額外重複整套狀態大盤

**7c. Apply 按鈕**
1. 不固定、不懸浮、不 sticky，跟隨頁面自然流動
2. 調用 `DataSource.devices.putSchedule(gatewayId, config)`
3. Apply 後進入 pending 狀態（Control Lane 全鎖）

---

#### T8: Frontend — Online / Offline / Pending 狀態處理

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p2-devices.js`（T5 重寫內） |
| **改動** | 根據 gateway status + schedule syncStatus 控制 Control Lane 可編輯性 |
| **預計行數** | 包含在 T5 行數內 |
| **前置** | T7（Control Lane 存在） |
| **可並行** | 否（依賴 T7） |

**狀態矩陣實現（DESIGN §6.1）：**

| 狀態 | Data Lane | Control Lane | Apply |
|------|-----------|-------------|-------|
| Online + idle | 正常 | 可編輯 | 可 Apply |
| Online + pending | 正常 | 全鎖 | 不可 Apply |
| Offline + 有歷史快照 | 正常 | 只讀 | 不可 Apply |
| Offline + 無歷史快照 | unavailable 空態 | unavailable 空態 | 不可 Apply |

**詳細步驟：**
1. 判斷 `gateway.status`（online/offline）——來源：`gatewayDetail`
2. 判斷 `schedule.syncStatus`（synced/pending/failed/unknown）——**唯一權威來源：`getSchedule` 端點**（DESIGN §6.2）。不使用 `gatewayDetail` 中的 syncStatus 做狀態機判定。
3. pending → disable 所有 Control Lane input + hide Apply
4. offline → 檢查 `batterySchedule` 是否非 null（歷史快照存在性）
5. offline + `batterySchedule: null` → 數值設定區顯示 `config` 默認值（標注「默認值」），schedule 編輯器顯示空態

---

### Phase 3：前端 — Schedule Editor 結構性重構

#### T9: Frontend — Schedule Editor 混合型重寫

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/p2-devices.js`（T5 重寫內） |
| **改動** | 重寫 `_buildBatteryScheduleCard()`（現 line ~933）為混合型 Schedule Editor：上方時間軸預覽 + 下方 slot 表單 |
| **預計行數** | ~350 行（Phase 1 只讀預覽；取代現有 schedule 相關 ~300 行） |
| **前置** | T7（Control Lane 框架） |
| **可並行** | 否（核心交互元件） |

**詳細步驟：**

**9a. 時間軸預覽（上方）— Phase 1：只讀**
1. 渲染 24h 水平 bar，按 slot 分段著色
2. 每段顯示 purpose / direction 的視覺區分
3. **Phase 1 為只讀視覺化**——不實現拖拽交互。時間邊界變更僅通過 split/merge + 表單 select 完成。
4. 此路徑已足夠滿足結構性硬規則（DESIGN §5.3），同時避免在 vanilla JS 中實現指針事件拖拽（含 snap-to-grid、雙向 resize、touch 支持）的高複雜度。

**（Phase 2 / v6.3）拖拽共享邊界（REQ §12.3 最終目標）：**
   - 拖的是兩個相鄰 slot 的共享邊界
   - 左 slot end 與右 slot start 同步變化
   - 不能制造 overlap 或 gap
   - 第一段 start 鎖死 `00:00`，最後一段 end 鎖死 `24:00`
   - 時間吸附到整點（60 分鐘粒度）

**9b. Slot 列表表單（下方）**
1. 每個 slot 一行：startMinute / endMinute / purpose / direction / exportPolicy
2. startMinute / endMinute 可通過 `<select>` 下拉框調整（Phase 1 不依賴拖拽），但受結構性不變式約束（不可造成 overlap / gap）
3. purpose、direction、exportPolicy 保持下拉表單編輯

**9c. Add = Split 語義**
1. 移除現有「凭空新增」按鈕
2. 每個 slot 行增加「Split」按鈕
3. Split 行為：在 slot 中間整點切開（預設取中點），原 slot 變為兩段
4. 天然維持 24h 連續覆蓋

**9d. Delete = Merge 語義**
1. 移除現有「直接刪除」按鈕
2. 每個 slot 行增加「Merge」按鈕（第一段和最後一段至少保留一段不可 merge）
3. Merge 行為：刪除當前 slot，時間範圍併入前一段（或後一段）
4. 不允許留下 gap

**9e. 結構性不變式校驗**
1. 每次 split / merge / drag 操作後即時校驗：
   - 覆蓋完整 24h（00:00 → 24:00）
   - 無 overlap、無 gap
   - 相鄰 slot 連續銜接
   - 整點粒度
2. 校驗失敗 → 回滾操作（不允許非法中間態）
3. 與後端 `validateSchedule()` 規則完全一致

---

#### T10: Frontend — data-source.js 擴展

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/js/data-source.js`（現有 517 行） |
| **改動** | 新增 `devices.patchHomeAlias(gatewayId, alias)` 方法 |
| **預計行數** | +10 行 |
| **前置** | T3（後端端點） |
| **可並行** | 與 Phase 2 並行 |

**詳細步驟：**
1. 新增 `patchHomeAlias(gatewayId, alias)` → PATCH `/api/gateways/{gatewayId}/home-alias`
2. 遵循現有 dual-source pattern（mock ↔ live API toggle）

---

### Phase 4：測試

#### T11: 後端測試 — home_alias + gateway list 擴展

| 項目 | 內容 |
|------|------|
| **文件** | `backend/test/bff/devices-v6.2-handlers.test.ts`（新建） |
| **改動** | 測試 get-gateways homeAlias/SoC 擴展 + patch-home-alias |
| **預計行數** | ~150 行 |
| **前置** | T2, T3 |
| **可並行** | 與 T12 並行 |

**測試用例：**

| # | 測試用例 | Handler | 類型 |
|---|---------|---------|------|
| 1 | Gateway list 回傳 homeAlias（有值） | get-gateways | Unit |
| 2 | Gateway list homeAlias 為空 → fallback 到 name | get-gateways | Unit |
| 3 | Gateway list 回傳 batterySoc（online 時有值） | get-gateways | Unit |
| 4 | Gateway list batterySoc offline 時為 null | get-gateways | Unit |
| 5 | PATCH home_alias 成功更新 | patch-home-alias | Integration |
| 6 | PATCH home_alias 空字串 → 400 | patch-home-alias | Unit |
| 7 | PATCH home_alias 超過 100 字元 → 400 | patch-home-alias | Unit |
| 8 | 非 admin/manager 角色 → 403 | patch-home-alias | Unit |
| 9 | Gateway list 回傳完整列表供前端客戶端過濾 | get-gateways | Unit |

---

#### T12: 前端 E2E 測試 — 三段式工作台

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/test/e2e/devices-workbench.test.js`（新建） |
| **預計行數** | ~250 行 |
| **前置** | T5-T9 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 10 | 進入 Devices 頁，右側呈現空態引導 | E2E |
| 11 | 左側定位器顯示 Home alias + Gateway identity + 狀態 | E2E |
| 12 | 按 Home alias 穩定排序（不因狀態跳序） | E2E |
| 13 | 搜索框可搜索 Home alias / Gateway name / Gateway ID | E2E |
| 14 | 點選條目後右側工作台載入 Data Lane + Control Lane | E2E |
| 15 | Data Lane 首屏顯示能量流動圖 | E2E |
| 16 | Control Lane 頂部顯示數值設定 | E2E |
| 17 | Online + idle 時可編輯 Control Lane + Apply | E2E |
| 18 | Pending 狀態時 Control Lane 全鎖 | E2E |
| 19 | Offline 時 Control Lane 只讀 | E2E |

---

#### T13: 前端 E2E 測試 — Schedule Editor 結構性約束

| 項目 | 內容 |
|------|------|
| **文件** | `frontend-v2/test/e2e/schedule-editor.test.js`（新建） |
| **預計行數** | ~200 行 |
| **前置** | T9 |

**測試用例：**

| # | 測試用例 | 類型 |
|---|---------|------|
| 20 | 時間軸預覽顯示完整 24h 覆蓋 | E2E |
| 21 | 時間軸預覽為只讀（Phase 1 不可拖拽） | E2E |
| 22 | 通過表單 select 修改邊界時間吸附整點 | E2E |
| 23 | 第一段 start 鎖死 00:00（不可修改） | E2E |
| 24 | 最後一段 end 鎖死 24:00（不可修改） | E2E |
| 25 | Add = Split：slot 被切為兩段，24h 覆蓋不變 | E2E |
| 26 | Delete = Merge：slot 被併入相鄰段，24h 覆蓋不變 | E2E |
| 27 | 無法構造 overlap 或 gap | E2E |
| 28 | Apply 前輕量確認區顯示 diff（from → to） | E2E |
| 29 | Apply 成功後進入 pending 狀態 | E2E |

---

## 2. 執行順序圖

```
                    Phase 1: 數據模型 + BFF
                    ----------------------

Timeline:   Day 1        Day 2
            |            |
    T1 DDL  [====]
    T2 BFF  [============]       (依賴 T1)
    T3 BFF  [============]       (依賴 T1；與 T2 並行)
    T4b sync[============]       (獨立；與 T2/T3 並行)
    T4 Route              [====] (依賴 T2 + T3；註冊 GET + PATCH 兩條路由)

                    Phase 2: 前端三段式工作台
                    -----------------------

Timeline:   Day 2        Day 3        Day 4        Day 5
            |            |            |            |
    T5 佈局 [============]                         (依賴 T2)
    T6 Data              [============]            (與 T7 並行)
    T7 Ctrl              [============]
    T8 狀態                           [====]       (依賴 T7)
    T10 DS  [====]                                 (與 T5 並行)

                    Phase 3: Schedule Editor 重構
                    ---------------------------

Timeline:   Day 5        Day 6        Day 7
            |            |            |
    T9 Sched[============================]         (依賴 T7)

                    Phase 4: 測試
                    ------------

Timeline:   Day 3        Day 7        Day 8
            |            |            |
    T11 BE  [============]                         (依賴 T2/T3)
    T12 E2E                    [============]      (依賴 T5-T9)
    T13 E2E                    [============]      (依賴 T9；與 T12 並行)
```

### 並行分組

| 分組 | 任務 | 並行策略 |
|------|------|---------|
| **Batch A（Day 1）** | T1 | DDL 最先 |
| **Batch B（Day 1-2）** | T2 + T3 + T4b + T10 | BFF/DS 改動獨立，可並行；T2/T3 依賴 T1，T4b 獨立 |
| **Batch C（Day 2）** | T4 | 串行：依賴 T2 + T3（需兩個 handler 完成後才能註冊路由） |
| **Batch D（Day 2-3）** | T5 | 佈局骨架，依賴 T2 |
| **Batch E（Day 3-4）** | T6 + T7 | Data Lane 和 Control Lane 獨立，可並行 |
| **Batch F（Day 4）** | T8 | 串行：依賴 T7 |
| **Batch G（Day 5-7）** | T9 | Schedule Editor 核心重構 |
| **Batch H（Day 3-8）** | T11 + T12 + T13 | T11 可提前；T12/T13 依賴前端完成 |

---

## 3. 驗證計畫

### 語義正確性驗證（最高優先級）

| # | 驗證項 | 方法 | 說明 |
|---|--------|------|------|
| V1 | 頁面主語為 Home alias，非 Gateway ID | 目視確認：定位器條目首行為 Home alias | REQ §2.1 核心語義 |
| V2 | 操作流程：先找對象→再看現場→再改→再確認→再 Apply | E2E 流程測試（T12 #10-#19） | REQ §3 工作流 |
| V3 | 定位器始終固定展開 | resize / scroll 測試：不自動收起 | REQ §6.1 |
| V4 | 右側默認空態（不自動選擇） | 進入頁面確認右側為空態引導 | REQ §7.1 |
| V5 | Data Lane 首屏為能量流動圖 | 目視確認 + viewport 測試 | REQ §8.1 |
| V6 | Control Lane 頂部為數值設定（非 schedule） | 目視確認 | REQ §9.1 |
| V7 | Apply 不 sticky | 滾動測試：Apply 跟隨頁面流動 | REQ §9.3 |

### Schedule Editor 結構性驗證（核心不變式）

| # | 驗證項 | 方法 |
|---|--------|------|
| V8 | 24h 完整覆蓋始終維持 | 每次 split/merge/drag 後自動校驗 |
| V9 | 無 overlap 始終維持 | 嘗試拖拽造成 overlap → 確認被阻止 |
| V10 | 無 gap 始終維持 | 嘗試 delete → 確認自動 merge |
| V11 | 整點粒度（1 小時） | 拖拽 → 確認吸附整點 |
| V12 | Add = Split 語義 | 操作 add → 確認原 slot 變兩段，24h 不變 |
| V13 | Delete = Merge 語義 | 操作 delete → 確認時間併入相鄰段 |
| V14 | 前端校驗與後端 `validateSchedule()` 一致 | 構造各種邊界 case → 前後端校驗結果一致 |

### 狀態行為驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V15 | Online + idle → Control Lane 可編輯 | 操作確認 |
| V16 | Online + pending → Control Lane 全鎖 | Apply 後確認不可繼續編輯 |
| V17 | Offline + 有歷史快照 → Control Lane 只讀 | 斷線 gateway + 有歷史數據 → 確認只讀 |
| V18 | Offline + 無歷史快照 → unavailable 空態 | 斷線 gateway + 無歷史數據 → 確認空態 |

### 回歸驗證

| # | 驗證項 | 方法 |
|---|--------|------|
| V19 | GET /api/gateways/{id}/detail API 不受影響 | 呼叫確認回傳格式不變 |
| V20 | GET /api/gateways/{id}/schedule API 不受影響 | 呼叫確認回傳格式不變 |
| V21 | PUT /api/gateways/{id}/schedule API 不受影響 | 提交合法 schedule → 成功 |
| V22 | 後端 `validateSchedule()` 不受影響 | 現有 test case 通過 |
| V23 | Fleet 頁面不受影響 | v6.1 Fleet dashboard 功能正常 |

---

## 4. 回歸風險

| # | 風險 | 嚴重度 | 概率 | 降級方案 |
|---|------|--------|------|---------|
| R1 | **p2-devices.js 重寫範圍大（2,348 行），可能引入回歸** | 高 | 中 | 逐步重構：先建骨架（T5），再遷移各區塊（T6/T7/T9），每步驗證 |
| R2 | **Schedule Editor 結構性重構（split/merge 語義）** | 高 | 中 | 嚴格維持不變式（每次操作後即時校驗）；E2E 覆蓋所有邊界 case（T13）。拖拽交互已延至 Phase 2（見 R9）。 |
| R3 | **get-gateways.ts SoC JOIN 可能影響列表查詢效能** | 中 | 低 | SoC 來自 device_state 表，已有 gateway 索引；必要時改為 separate call |
| R4 | **home_alias DDL 對現有數據無影響但需 migration** | 低 | 低 | nullable 欄位，無 default 值，ALTER TABLE 安全 |
| R5 | **60/40 雙瀑布流在窄螢幕上可能佈局破裂** | 中 | 中 | 設定最小寬度；窄螢幕降級為上下堆疊 |
| R6 | **現有 Layer 1/Layer 3 邏輯中可能有其他頁面依賴** | 中 | 低 | 確認 p2-devices.js 的 Layer 函數未被外部引用（likely 自包含） |
| R7 | **pending 狀態判斷依賴 syncStatus，可能有 race condition** | 中 | 低 | syncStatus 由 get-gateway-schedule 回傳（唯一權威來源），基於 device_command_logs 查詢，已有明確語義 |
| R8 | **v6.1 Fleet 與 v6.2 Devices 的 DDL 變更可能衝突** | 中 | 中 | 兩者都修改 `db-init/02_schema.sql`（v6.1 新增 `gateway_outage_events` 表，v6.2 新增 `home_alias` 欄位）。改動本身獨立不衝突，但若並行開發或交錯合併，需協調 DDL 順序避免 merge conflict。建議：v6.2 T1 的 ALTER TABLE 追加在文件末尾，遠離 v6.1 的 CREATE TABLE 區域。 |
| R9 | **Schedule Editor 拖拽交互在 vanilla JS 中實現複雜度高** | 高 | 高 | Phase 1 將時間軸預覽設為只讀，時間變更僅通過 split/merge + 表單 select。拖拽交互延至 Phase 2。此降級不影響結構性不變式保障。 |

### R1 降級方案詳細

如果全量重寫風險過高，可採用漸進式遷移：

**Stage A：** 保留現有 Layer 1 + Layer 3 架構，僅在 Layer 1 增加 Home alias 顯示 + 搜索
**Stage B：** 將 Layer 3 拆為 Data Lane + Control Lane 雙欄
**Stage C：** 將 Layer 1 改為固定展開的對象定位器
**Stage D：** 重寫 Schedule Editor 的 add/delete 語義

每個 Stage 可獨立驗證和回滾。

---

## 5. 上線檢查清單

### Pre-Deploy

- [ ] T1: DDL migration 在 staging 執行成功，gateways 表新增 home_alias 欄位
- [ ] T2/T3: BFF 擴展通過所有 unit test（T11）
- [ ] T5-T9: 前端三段式工作台通過所有 E2E test（T12/T13）
- [ ] Schedule Editor 結構性不變式驗證通過（V8-V14）
- [ ] 狀態行為驗證通過（V15-V18）
- [ ] 回歸驗證通過（V19-V23）
- [ ] 測試覆蓋率 >= 80%

### Deploy

- [ ] DDL migration 先行（home_alias 欄位）
- [ ] 部署 BFF（T2-T4 改動）
- [ ] 部署 Frontend（T5-T10 改動）

### Post-Deploy

- [ ] 確認 Devices 頁面進入時右側為空態引導
- [ ] 確認對象定位器顯示 Home alias + Gateway identity + 狀態 + SoC
- [ ] 確認搜索功能覆蓋 Home alias / Gateway name / Gateway ID
- [ ] 確認 Data Lane 首屏為能量流動圖
- [ ] 確認 Control Lane 頂部為數值設定
- [ ] 確認 Schedule Editor 的 add = split、delete = merge
- [ ] 確認拖拽邊界維持 24h 完整覆蓋
- [ ] 確認 Apply 不 sticky
- [ ] 確認 pending / offline 狀態行為正確
- [ ] 確認現有 gateway detail / schedule API 不受影響
- [ ] 確認 Fleet dashboard 不受影響

### Rollback

回滾策略（如需）：
1. Frontend：還原為 pre-v6.2 p2-devices.js（git revert）
2. BFF handler：還原 get-gateways.ts（git revert）— detail / schedule API 未改動
3. DDL：`home_alias` 為 nullable 新增欄位，回滾 = ALTER TABLE DROP COLUMN（無數據依賴）

---

## 6. 文件清單總覽

| # | 文件 | 動作 | Phase | Task |
|---|------|------|-------|------|
| 1 | `db-init/02_schema.sql` | 改（追加 home_alias） | P1 | T1 |
| 2 | `backend/src/bff/handlers/get-gateways.ts` | 改 | P1 | T2 |
| 3 | `backend/src/bff/handlers/patch-gateway-home-alias.ts` | **新建** | P1 | T3 |
| 4 | `backend/lib/bff-stack.ts` | 改（+2 routes: GET /api/gateways + PATCH home-alias） | P1 | T4 |
| 4b | `backend/src/bff/handlers/get-gateway-detail.ts` | 改（syncStatus 映射規範化） | P1 | T4b |
| 4c | `backend/src/bff/handlers/get-gateway-schedule.ts` | 改（syncStatus 映射規範化） | P1 | T4b |
| 5 | `frontend-v2/js/p2-devices.js` | **重寫** | P2-P3 | T5-T9 |
| 6 | `frontend-v2/js/data-source.js` | 改 | P2 | T10 |
| 7 | `backend/test/bff/devices-v6.2-handlers.test.ts` | **新建** | P4 | T11 |
| 8 | `frontend-v2/test/e2e/devices-workbench.test.js` | **新建** | P4 | T12 |
| 9 | `frontend-v2/test/e2e/schedule-editor.test.js` | **新建** | P4 | T13 |

**不動文件（已驗證可複用）：**

| 文件 | 理由 |
|------|------|
| `backend/src/bff/handlers/get-gateway-detail.ts` | 已提供 Data Lane 所需全部數據；**僅 T4b 修改 syncStatus 映射**（業務邏輯不變） |
| `backend/src/bff/handlers/get-gateway-schedule.ts` | 已提供 Control Lane 的 schedule 數據 + sync status；**僅 T4b 修改 syncStatus 映射**（業務邏輯不變） |
| `backend/src/bff/handlers/put-gateway-schedule.ts` | Apply 動作繼續使用（已確認存在，含 409 並發保護） |
| `backend/src/iot-hub/handlers/schedule-translator.ts` | 驗證邏輯已完整（24h / 無 overlap / 無 gap / 整點） |

**新建文件：4 個** | **重寫文件：1 個** | **修改文件：6 個**（含 T4b syncStatus 規範化）
