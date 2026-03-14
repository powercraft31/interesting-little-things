# REQ-v6.0-P4-batch-dispatch

**Version:** 6.0  
**Date:** 2026-03-14  
**Author:** Alan + Ashe  
**Status:** Draft  

---

## 1. 背景

P4（策略管理 / HEMS Control）目前存在以下問題：

1. **後端寫錯表**：`post-hems-dispatch.ts` 寫入 `dispatch_commands`（VPP 交易鏈），而非 `device_command_logs`（MQTT 下發管線）。導致 P4 的指令**永遠不會到達 Gateway**。
2. **前端純 mock**：模式卡片讀靜態 `assets.operation_mode`，批次調度邏輯使用 `DemoStore`，無真實 API 交互。
3. **P2 / P4 數據不同步**：P4 如果能下發，寫的是 `dispatch_commands`；P2 讀寫的是 `device_command_logs`。兩個頁面各自維護各自的狀態。
4. **設備額定參數未存儲**：Gateway MQTT `deviceList` 帶有 `maxPower`、`maxCurrent`，但 `handleDeviceList` 未寫入 DB。導致無法做硬體功率校驗。

## 2. 目標

- P4 能批量下發模式到多台 Gateway，指令走 `device_command_logs → M3 → M1 → MQTT` 統一管線
- P2 進入任一 Gateway 能看到 P4 最後推送的設定（單一數據源）
- 設備額定參數從 MQTT 自動入庫，為功率校驗提供數據基礎

## 3. 範圍

### Phase 1：P4 核心（批量調度）

| ID | 項目 | 類型 |
|----|------|------|
| F1 | P4 前端重寫 | Frontend |
| F2 | `POST /api/hems/batch-dispatch` 重寫 | BFF |
| F3 | `GET /api/hems/batch-history` 新增 | BFF |
| F4 | `device_command_logs` 加 `batch_id` + `source` 欄位 | DDL |

### Phase 2：設備額定參數增強

| ID | 項目 | 類型 |
|----|------|------|
| F5 | `assets` 加額定參數欄位 | DDL |
| F6 | `device-list-handler.ts` UPSERT 補 MQTT 欄位 | M1 |
| F7 | `put-gateway-schedule.ts` 加硬體功率校驗 (P2) | BFF |
| F7b | `post-hems-batch-dispatch.ts` 加硬體功率校驗 (P4) | BFF |
| F8 | P2 前端 `_validateSchedule` 加額定功率上限 | Frontend |

### 不動的模塊

| 模塊 | 原因 |
|------|------|
| M3 `command-dispatcher.ts` | pending→dispatched 邏輯不變 |
| M1 `command-publisher.ts` | dispatched→MQTT 邏輯不變 |
| M1 `command-tracker.ts` | ACK 處理邏輯不變 |
| `schedule-translator.ts` | DomainSchedule→Protocol 翻譯不變 |

---

## 4. Phase 1 詳細需求

### F1：P4 前端重寫

**三步流程：**

**Step 1 — 選擇模式 + 設定參數**

三種模式卡片：

| 模式 | Slots 生成規則 | 前端編輯器 |
|------|---------------|-----------|
| ☀️ 自發自用 | 單一 slot：`{mode:'self_consumption', 0→1440}` | 無時段編輯器 |
| ⚡ 削峰填谷 | 單一 slot：`{mode:'peak_shaving', 0→1440}` | 無時段編輯器 |
| 📊 峰谷套利 | 多 slot：用戶塗滿 24h 充電/放電 | 塗色式時間軸 |

參數面板（所有模式共用）：

| 參數 | 類型 | 說明 |
|------|------|------|
| socMinLimit | range 5-50% | SoC 下限 |
| socMaxLimit | range 70-100% | SoC 上限 |

削峰模式額外參數：

| 參數 | 類型 | 說明 |
|------|------|------|
| gridImportLimitKw | number | 需量上限 (kW)，僅削峰模式生效 |

**充放電功率不在 P4 設置**——沿用每台 Gateway 在 P2 的既有設定（從 `device_command_logs` 最新成功排程讀取）。

**套利塗色規則：**
- 24 格（每格 1 小時），兩種筆刷：充電 / 放電
- 必須塗滿 24 格，不能留空
- 有快速模板（Enel SP / 夜間充電 / 雙充雙放 / 清空）
- 未塗滿時「下一步」按鈕禁用

**Step 2 — 選擇 Gateway**

- Gateway 表格帶 checkbox 多選
- 顯示：Gateway ID、家庭名稱、狀態（在線/離線）、設備數、當前模式、當前排程（mini bar）、最後同步時間
- 篩選器：家庭、狀態
- 全選 checkbox

**Step 3 — 預覽與推送**

- 每台 Gateway 新舊排程並排對比（mini bar）
- 標記「將變更」/「無變化」
- 配置摘要（模式 + 參數 + 套利時段）
- 確認 modal → 批量推送
- 推送中顯示進度 → 完成 toast

**操作歷史**（在 Step 3 底部）：
- 從 `device_command_logs` 按 `batch_id` 分組
- 顯示：時間、操作者、模式、Gateway 數、成功/失敗數

### F2：`POST /api/hems/batch-dispatch` 重寫

**Request：**
```json
{
  "mode": "self_consumption" | "peak_shaving" | "peak_valley_arbitrage",
  "socMinLimit": 20,
  "socMaxLimit": 95,
  "gridImportLimitKw": 50,
  "arbSlots": [
    { "startHour": 0, "endHour": 6, "action": "charge" },
    { "startHour": 6, "endHour": 24, "action": "discharge" }
  ],
  "gatewayIds": ["DEMO-GW-5KW", "DEMO-GW-10KW"]
}
```

**後端邏輯：**

```
1. 驗證 mode 合法
2. 驗證 socMinLimit < socMaxLimit
3. 如果是套利：驗證 arbSlots 覆蓋 0-24h 無缺口
4. 生成 batch_id = `batch-${Date.now()}-${randomHex(4)}`
5. 生成 slots (DomainSlot[]):
   - 自耗: [{mode:'self_consumption', startMinute:0, endMinute:1440}]
   - 削峰: [{mode:'peak_shaving', startMinute:0, endMinute:1440}]
   - 套利: arbSlots → merge consecutive → DomainSlot[]
           每段 mode='peak_valley_arbitrage', action='charge'|'discharge'
6. for each gatewayId:
   a. RLS 檢查 gateway 存在
   b. 讀 device_command_logs 最新成功排程 (result IN ('success','accepted'))
      → 取 maxChargeCurrent, maxDischargeCurrent, gridImportLimitKw(非削峰時)
      → 如果無歷史：用安全預設 maxChargeCurrent=100, maxDischargeCurrent=100, gridImportLimitKw=3000
   c. 組裝完整 DomainSchedule:
      {
        socMinLimit: P4 新值,
        socMaxLimit: P4 新值,
        maxChargeCurrent: 歷史值,
        maxDischargeCurrent: 歷史值,
        gridImportLimitKw: 削峰→P4新值 / 其他→歷史值,
        slots: P4 生成的
      }
   d. validateSchedule(schedule) — 複用現有校驗
   e. 檢查無 active command (result IN ('pending','dispatched','accepted'))
      → 有衝突：跳過，記錄為 skipped
   f. INSERT device_command_logs (
        gateway_id, command_type='set', config_name='battery_schedule',
        payload_json=schedule, result='pending',
        batch_id=batch_id, source='p4'
      )
7. 回傳:
   {
     batchId: "batch-xxx",
     results: [
       { gatewayId: "DEMO-GW-5KW", status: "pending", commandId: 123 },
       { gatewayId: "DEMO-GW-10KW", status: "skipped", reason: "active_command" }
     ]
   }
```

**權限：** SOLFACIL_ADMIN, ORG_MANAGER, ORG_OPERATOR

### F3：`GET /api/hems/batch-history`

**Request：** `GET /api/hems/batch-history?limit=20`

**後端邏輯：**
```sql
SELECT batch_id,
       source,
       MIN(created_at) AS dispatched_at,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE result IN ('success','accepted')) AS success_count,
       COUNT(*) FILTER (WHERE result = 'failed') AS failed_count,
       jsonb_agg(jsonb_build_object(
         'gatewayId', gateway_id,
         'result', result
       )) AS gateways,
       (array_agg(payload_json ORDER BY id)
         FILTER (WHERE payload_json IS NOT NULL))[1] AS sample_payload
FROM device_command_logs
WHERE batch_id IS NOT NULL
  AND command_type = 'set'
GROUP BY batch_id, source
ORDER BY MIN(created_at) DESC
LIMIT $1
```

**權限：** 所有角色（ORG_VIEWER+）

### F4：DDL — `device_command_logs` 加欄位

```sql
ALTER TABLE device_command_logs
  ADD COLUMN batch_id VARCHAR(50),
  ADD COLUMN source VARCHAR(10) DEFAULT 'p2';

CREATE INDEX idx_dcl_batch ON device_command_logs (batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN device_command_logs.batch_id IS 'P4 批量操作 ID，null = 單筆操作（P2/自動）';
COMMENT ON COLUMN device_command_logs.source IS '指令來源：p2=手動單台, p4=批量, auto=M2自動排程';
```

---

## 5. Phase 2 詳細需求

### F5：DDL — `assets` 加額定參數欄位

```sql
ALTER TABLE assets
  ADD COLUMN rated_max_power_kw REAL,
  ADD COLUMN rated_max_current_a REAL,
  ADD COLUMN rated_min_power_kw REAL,
  ADD COLUMN rated_min_current_a REAL;

COMMENT ON COLUMN assets.rated_max_power_kw IS 'Gateway MQTT deviceList 回報的額定最大功率 (kW)';
COMMENT ON COLUMN assets.rated_max_current_a IS 'Gateway MQTT deviceList 回報的額定最大電流 (A)';
```

> 注意：已有 `max_charge_rate_kw` / `max_discharge_rate_kw` 是**用戶/管理員手動設定的操作上限**。`rated_*` 是**硬體銘牌值**，兩者語義不同。
>
> - `rated_max_power_kw` = 硬體能力天花板（不可超越）
> - `max_charge_rate_kw` = 操作設定值（≤ rated，可調）

### F6：M1 `device-list-handler.ts` 補 MQTT 欄位

UPSERT 語句新增：
```sql
rated_max_power_kw = NULLIF($x, '')::REAL,
rated_max_current_a = NULLIF($y, '')::REAL,
rated_min_power_kw = NULLIF($z, '')::REAL,
rated_min_current_a = NULLIF($w, '')::REAL
```

來源映射：
| MQTT field | DB column |
|------------|-----------|
| `device.maxPower` | `rated_max_power_kw` |
| `device.maxCurrent` | `rated_max_current_a` |
| `device.minPower` | `rated_min_power_kw` |
| `device.minCurrent` | `rated_min_current_a` |

### F7：BFF `put-gateway-schedule.ts` 加硬體校驗

在 `validateSchedule()` 之後、寫入 DB 之前，新增：

```typescript
// 讀取該 gateway 下 INV 類型 asset 的額定功率
const { rows: [inv] } = await queryWithOrg(
  `SELECT rated_max_power_kw, rated_max_current_a
   FROM assets
   WHERE gateway_id = $1 AND asset_type = 'INVERTER_BATTERY' AND is_active = true
   LIMIT 1`,
  [gatewayId], rlsOrgId
);

if (inv?.rated_max_power_kw != null) {
  if (schedule.maxChargeCurrent > inv.rated_max_power_kw) {
    return apiError(400,
      `maxChargeCurrent (${schedule.maxChargeCurrent}) exceeds rated capacity (${inv.rated_max_power_kw} kW)`);
  }
  if (schedule.maxDischargeCurrent > inv.rated_max_power_kw) {
    return apiError(400,
      `maxDischargeCurrent (${schedule.maxDischargeCurrent}) exceeds rated capacity (${inv.rated_max_power_kw} kW)`);
  }
}
```

> 如果 `rated_max_power_kw` 為 NULL（Gateway 未回報），跳過校驗（向後兼容）。

### F8：P2 前端校驗增強

`_validateSchedule` 新增：
```javascript
// 從 asset 數據取得額定功率（已在 drill-down 載入時 fetch）
if (self._ratedMaxPowerKw != null) {
  if (chargeCurrent > self._ratedMaxPowerKw) {
    return "Corrente de carga excede capacidade do equipamento (" + self._ratedMaxPowerKw + " kW)";
  }
  if (dischargeCurrent > self._ratedMaxPowerKw) {
    return "Corrente de descarga excede capacidade do equipamento (" + self._ratedMaxPowerKw + " kW)";
  }
}
```

---

## 6. 數據流總覽

```
P4 前端                              P2 前端
  │                                    │
  │ POST /api/hems/batch-dispatch      │ PUT /api/gateways/:id/schedule
  │ { mode, soc, arbSlots, gwIds[] }   │ { 完整 DomainSchedule }
  │                                    │
  ▼                                    ▼
post-hems-batch-dispatch.ts      put-gateway-schedule.ts
  │                                    │
  │ 讀歷史排程取功率 → 合併 →            │ Phase2: 校驗 rated_max_power
  │ validateSchedule()                 │ validateSchedule()
  │                                    │
  └──────────────┬─────────────────────┘
                 │
                 ▼
    device_command_logs (result='pending')
    [batch_id, source='p4']  |  [batch_id=NULL, source='p2']
                 │
                 ▼
    M3: runPendingCommandDispatcher (10s)
    pending → dispatched
                 │
                 ▼
    M1: CommandPublisher (10s)
    dispatched → validateSchedule → buildConfigSetPayload → MQTT publish
                 │
                 ▼
    Gateway (config/set topic)
                 │
                 ▼ ACK
    M1: CommandTracker
    → result='accepted' | 'rejected'
```

---

## 7. 測試需求

### Phase 1
- [ ] P4 自耗模式批量下發 2 台 → device_command_logs 2 筆 pending → M3 dispatched → M1 MQTT（或 mock gateway 驗證）
- [ ] P4 削峰模式 + gridImportLimitKw 覆寫 → payload_json 正確
- [ ] P4 套利模式 arbSlots 覆蓋 0-24h → DomainSlot 正確生成
- [ ] P4 套利模式 arbSlots 未滿 24h → 前端阻止提交
- [ ] 有 active command 的 gateway → 跳過，回傳 skipped
- [ ] 無歷史排程的 gateway → 安全預設值填入
- [ ] batch_id 分組查詢歷史 → 正確聚合
- [ ] P2 進入 P4 剛推過的 gateway → 讀到 P4 的排程

### Phase 2
- [ ] Gateway MQTT deviceList 帶 maxPower → assets.rated_max_power_kw 正確寫入
- [ ] P2 提交 maxChargeCurrent > rated_max_power_kw → 400 拒絕
- [ ] P2 提交 maxChargeCurrent ≤ rated_max_power_kw → 通過
- [ ] rated_max_power_kw 為 NULL → 跳過校驗（向後兼容）
- [ ] P2 前端輸入超過額定功率 → 前端提示錯誤

---

## 8. 約束

- M1、M3 管線不動
- `dispatch_commands` 表不動（VPP 交易鏈獨立處理，未來再統一）
- 現有 P2 行為不變（source='p2'，batch_id=NULL）
- 額定校驗為 soft guard：rated 值為 NULL 時跳過（不阻塞現有設備）
