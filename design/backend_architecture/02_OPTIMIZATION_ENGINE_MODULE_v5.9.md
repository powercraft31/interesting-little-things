# Module 2: Optimization Engine (Algorithm Engine)

> **模組版本**: v5.9
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.9.md](./00_MASTER_ARCHITECTURE_v5.9.md)
> **最後更新**: 2026-03-02
> **說明**: 4 種策略演算法、AppConfig Strategy Profiles、成本最佳化、SOC 約束、排程輸出、雙目標最佳化框架、Schedule Generator Cron Job、動態電價優先策略、SoC-Aware Scheduling

---

## 1. 模組職責

M2 是 VPP 系統的「大腦」——負責根據電價時段、設備狀態和策略參數，計算最佳充放電排程。

核心職責：
- 每 15 分鐘觸發排程計算（EventBridge Scheduler）
- 從 AppConfig 讀取策略參數（min_soc, max_soc, emergency_soc, profit_margin）
- 查詢 M1 (Timestream) 獲取最新 SoC 數據
- 查詢 M4 獲取當前電價
- 計算最優充放電排程
- 輸出 `ScheduleGenerated` 推送到 EventBridge

---

## 2. CDK Stack: `AlgorithmStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| Scheduler | EventBridge Scheduler | Trigger every 15 min for schedule generation |
| Optimizer Lambda | Lambda (Python 3.12) | Run optimization algorithm |
| Forecast Model | SageMaker Endpoint (future) | Load & PV generation forecast |
| Config Store | SSM Parameter Store | Algorithm parameters, thresholds |

### IAM Grants

```
AlgorithmStack Lambda functions:
  ├─ timestream:Select         → solfacil_vpp/device_telemetry (read SoC data)
  ├─ events:PutEvents          → solfacil-vpp-events bus
  └─ ssm:GetParameter          → /solfacil/algorithm/* parameters
```

---

## 3. EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `ScheduleGenerated` | → M1 (Device Shadow), M3 (immediate dispatch), M4 (expected revenue) |
| **Publishes** | `ForecastUpdated` | → M5 (dashboard display) |
| **Consumes** | `TelemetryReceived` | ← M1 (update forecast model) |
| **Consumes** | `TariffUpdated` | ← M4 (recalculate schedule with new rates) |
| **Consumes** | `SchemaEvolved` | ← M8 (invalidate field-selector cache) |

---

## 4. 4 種策略演算法

### 4.1 peak_valley_arbitrage（峰谷套利）

巴西 Tarifa Branca 時段策略：

```
Tarifa Branca Time Blocks (Brazil ANEEL):
  Off-Peak:      00:00-06:00, 22:00-24:00  →  R$ 0.25/kWh
  Intermediate:  06:00-17:00, 20:00-22:00  →  R$ 0.45/kWh
  Peak:          17:00-20:00               →  R$ 0.82/kWh

Strategy:
  1. CHARGE during off-peak (lowest cost)
  2. HOLD during intermediate (wait for peak)
  3. DISCHARGE during peak (maximum spread: R$ 0.57/kWh)
  4. Optimization Alpha = actual_revenue / theoretical_max * 100
```

### 4.2 self_consumption（自發自用）

最大化太陽能自發自用率：
- 白天 PV 發電 → 優先自用 → 餘電充入電池
- 夜間 → 電池放電供負載
- 目標：最小化購電量

### 4.3 vpp_dispatch（VPP 調度）

響應電網調度指令：
- 接收電網需求響應信號
- 協調多設備同時充/放電
- 最大化電網服務收益

### 4.4 peak_shaving（削峰）

削減電力需求峰值：
- 監測負載曲線
- 在需求接近峰值時放電
- 避免觸發需量電價（Demand Charge）

---

## 5. AppConfig Strategy Profiles

M2 從 AppConfig `vpp-strategies` profile 讀取參數：

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `min_soc` | 20.0% | 10-50% | 最低放電 SOC 底線 |
| `max_soc` | 90.0% | 70-100% | 最高充電 SOC 上限 |
| `emergency_soc` | 10.0% | 5-20% | 緊急備用 SOC |
| `profit_margin` | 0.0 BRL/kWh | 0.01-0.5 | 最低利潤閾值 |
| `active_hours` | `{"start":"00:00","end":"23:59"}` | — | 策略活躍時段 |
| `active_weekdays` | `[0,1,2,3,4,5,6]` | — | 策略活躍日（0=Sunday） |

**讀取時機：** Before each EventBridge scheduled trigger + upon `ConfigUpdated{module:'M2'}` event

**SOC 約束：** `emergency_soc < min_soc < max_soc`

---

## 6. 成本最佳化函數

### Objective Function

```
Minimize: total_cost = Σ(grid_import_kwh[t] × tariff[t]) - Σ(grid_export_kwh[t] × sell_price[t])
```

### Constraints

- `emergency_soc ≤ soc[t] ≤ max_soc` for all time slots t
- `charge_rate[t] ≤ max_charge_rate_kw` (hardware limit)
- `discharge_rate[t] ≤ max_discharge_rate_kw` (hardware limit)
- `soc[t+1] = soc[t] + (charge[t] - discharge[t]) × efficiency / capacity`

### Revenue Calculation

```
revenue_per_cycle = (discharge_energy × peak_tariff) - (charge_energy × off_peak_tariff)
net_profit = revenue_per_cycle - operating_cost_per_kwh × total_energy
```

---

## § 雙目標最佳化框架 (v5.5)

### 最佳化問題定義

**目標函數（最大化 B端套利利潤）：**
```
maximize: Σ_{t=0}^{23} (PLD_t × discharge_t - PLD_t × charge_t)
```

**約束條件：**
```
1. 自發自用率約束（C端保底）：
   self_consumption_pct ≥ target_self_consumption_pct  (來自 vpp_strategies)

2. 電池 SOC 約束：
   SOC_min ≤ SOC_t ≤ SOC_max

3. 功率約束：
   0 ≤ charge_t ≤ max_charge_power
   0 ≤ discharge_t ≤ max_discharge_power

4. 能量守恆：
   SOC_{t+1} = SOC_t + charge_t × η_charge - discharge_t / η_discharge
```

**決策變數：**
- `charge_t`：第 t 小時的充電功率 (kW)
- `discharge_t`：第 t 小時的放電功率 (kW)

### 數據輸入
| 輸入 | 來源 | 說明 |
|------|------|------|
| `PLD_t` (t=0..23) | `pld_horario` 表 | 按 asset.submercado 查詢 |
| `target_self_consumption_pct` | `vpp_strategies` 表 | 策略設定的 C端門檻 |
| `SOC_current` | `device_state` 表 | 當前電池狀態 |
| `solar_forecast_t` | 預測模型輸出 | 太陽能預測（t+1 小時） |

### 排程輸出
最佳化結果寫入 `trade_schedules` 表（M2 → M5 BFF 的資料契約）：
- `action`: charge / discharge / idle
- `expected_volume_kwh`: 預計充放電量
- `target_pld_price`: 套利目標電價（R$/MWh）

### 為什麼不能只最大化套利？
純套利策略（只看 PLD 低買高賣）會讓電池長期滿充或滿放，
犧牲太陽能自發自用，損害 C端客戶體驗。
`target_self_consumption_pct` 約束確保 SOLFACIL 在賺取套利利潤的同時，
仍能向客戶兌現自發自用的承諾。

---

## § v5.6 Schedule Generator — Cron Job Design

> **重要聲明：** 此 Cron Job 為 v5.6 Mock 實作，使用 Rule-based 簡化邏輯。
> v6.0 將由真實優化引擎（LP/MPC 求解器）取代此段落的全部邏輯。

### 機制

| 項目 | 說明 |
|------|------|
| 觸發方式 | node-cron，每小時執行一次（`0 * * * *`） |
| 生成範圍 | 當下時刻起算的未來 24 小時排程 |
| 執行環境 | Express server 內嵌 cron task（非獨立 Lambda） |

### 輸入資料

| 資料來源 | 表名 | 查詢條件 | 用途 |
|---------|------|---------|------|
| CCEE 電價預測 | `pld_horario` | 未來 24 小時、各子市場（SUDESTE/SUL/NORDESTE/NORTE） | 判斷高低電價時段 |
| 資產清單 | `assets` | status = 'active' | 取得 submercado 歸屬、retail_buy_rate_kwh、capacity_kw |

> **v5.6 查詢策略（舊版）：**
> 用 `SELECT hora, AVG(pld_hora) as avg_pld FROM pld_horario GROUP BY hora` 取每小時平均電價作為代理值。

> **v5.7 升級：動態電價優先策略**
>
> 自 v5.7 起，M7 Webhook 會持續將最新電價寫入 pld_horario。
> Schedule Generator 的查詢策略升級為「最新電價優先」：
>
> ```sql
> -- 優先取近 2 小時內由 Webhook 寫入的最新電價
> -- 若無最新資料，fallback 到全歷史平均
> SELECT
>   hora,
>   CASE
>     WHEN MAX(mes_referencia) >= (
>       SELECT MAX(mes_referencia) FROM pld_horario
>     )
>     THEN AVG(pld_hora)  -- 用最新 mes_referencia 的資料
>     ELSE AVG(pld_hora)  -- fallback：全歷史平均
>   END AS effective_pld
> FROM pld_horario
> WHERE submercado = $1  -- 依 asset.submercado 篩選
> GROUP BY hora
> ORDER BY hora;
> ```
>
> 效果：當 Mock Publisher（或未來真實 CCEE）推送新電價後，M2 在下一個整點 cron 觸發時，
> 會自動讀到最新電價並可能改變充放電決策（例如尖峰電價突然飆升 → 多放電）。

### Mock Rule-based 邏輯

> **⚠️ v5.6 簡化版：此邏輯僅作為管線打通的 placeholder，不代表真實最佳化決策。**
> **v6.0 將替換為 LP/MPC 求解器，使用完整的雙目標最佳化框架（見上方 §雙目標最佳化框架）。**

決策規則：

```
FOR each active asset:
  FOR each hour in [NOW .. NOW+24h]:

    1. 離峰深夜強制充電（最高優先）：
       IF hour ∈ [00:00, 05:00) → action = 'charge'

    2. 高電價放電：
       ELSE IF pld_horario.pld_hora >= 300 (R$/MWh) → action = 'discharge'

    3. 預設充電：
       ELSE → action = 'charge'

  power_kw = asset.capacity_kw × 0.80  (固定取 80% 額定功率)
```

閾值配置：
| 參數 | 預設值 | 說明 |
|------|--------|------|
| PLD 放電閾值 | R$ 300/MWh | pld_hora >= 此值觸發 discharge |
| 深夜強制充電時段 | 00:00–05:00 | 不論電價均強制 charge |
| 功率係數 | 80% | capacity_kw × 0.80 |

### 輸出

寫入 `trade_schedules` 表：

```sql
-- 步驟 1：清除同一 asset 未來 24 小時內的舊排程（避免重複）
DELETE FROM trade_schedules
WHERE asset_id = $1
  AND status = 'scheduled'
  AND scheduled_at >= NOW()
  AND scheduled_at < NOW() + INTERVAL '24 hours';

-- 步驟 2：批次寫入新排程
INSERT INTO trade_schedules (
  asset_id, org_id, scheduled_at, action, power_kw, expected_pld, status
) VALUES (
  $1, $2, $3, $4, $5, $6, 'scheduled'
);
```

### 邊界限制（v5.6）

- 不呼叫任何外部 API（電價數據來自 DB 內的 pld_horario 表）
- 不實作 LP、MPC 或任何數學最佳化算法
- ~~不考慮 SOC 狀態~~、太陽能預測、負載預測 → **v5.9 已解除 SOC 盲點（見下方 §SoC-Aware Scheduling）**
- 不觸發 EventBridge 事件（排程寫入 DB 後由 M3 polling 接手）

---

## § SoC-Aware Scheduling (v5.9)

### 問題陳述

當前 `schedule-generator.ts` 的資產查詢僅讀取 `assets` 表：

```sql
-- v5.6~v5.8 查詢（SoC 盲點）
SELECT a.asset_id, a.org_id, a.submercado, a.capacity_kw
FROM assets a
WHERE a.status = 'active';
```

**問題：** `battery_soc` 存放在 `device_state` 表，`min_soc` / `max_soc` 存放在 `vpp_strategies` 表。
Schedule Generator 從未讀取這些數據，導致排程決策完全無視電池當前狀態——
電池已 95% 仍排 `charge`、電池已 15% 仍排 `discharge`。
這是**SoC 盲排程（SoC-blind scheduling）**。

### SQL 升級

```sql
-- v5.9 查詢（SoC-Aware）
SELECT
  a.asset_id,
  a.org_id,
  a.submercado,
  a.capacity_kw,
  a.operation_mode,
  d.battery_soc,
  vs.min_soc,
  vs.max_soc
FROM assets a
LEFT JOIN device_state d
  ON d.asset_id = a.asset_id
LEFT JOIN vpp_strategies vs
  ON vs.operation_mode = a.operation_mode
WHERE a.status = 'active';
```

**LEFT JOIN 理由：**
- `device_state` 可能尚無該 asset 的記錄（設備從未上報）→ `battery_soc = NULL`
- `vpp_strategies` 可能尚無該 operation_mode 的配置 → `min_soc = NULL`, `max_soc = NULL`

### Fallback 預設值

若 `device_state` 無該 asset 記錄（`battery_soc IS NULL`），使用安全預設值：

```typescript
const DEFAULT_SOC = 50;       // 假設半滿，允許充放電
const DEFAULT_MIN_SOC = 20;   // 保守下限
const DEFAULT_MAX_SOC = 90;   // 保守上限
```

### Guardrail 邏輯（偽代碼）

在 PLD-based 決策之前，插入 SoC 護欄檢查：

```typescript
function applySocGuardrail(
  pldBasedAction: 'charge' | 'discharge' | 'idle',
  battery_soc: number | null,
  min_soc: number | null,
  max_soc: number | null
): 'charge' | 'discharge' | 'idle' {
  const soc = battery_soc ?? DEFAULT_SOC;
  const minSoc = min_soc ?? DEFAULT_MIN_SOC;
  const maxSoc = max_soc ?? DEFAULT_MAX_SOC;

  // Block charge when battery is at or above max_soc
  if (soc >= maxSoc && pldBasedAction === 'charge') {
    return 'idle';  // Override: prevent overcharge
  }

  // Block discharge when battery is at or below min_soc
  if (soc <= minSoc && pldBasedAction === 'discharge') {
    return 'idle';  // Override: prevent deep discharge
  }

  // No guardrail triggered → proceed with PLD-based decision
  return pldBasedAction;
}
```

### 決策流程（v5.9 升級後）

```
FOR each active asset (with battery_soc, min_soc, max_soc from JOINs):

  effective_soc = battery_soc ?? DEFAULT_SOC (50)
  effective_min = min_soc ?? DEFAULT_MIN_SOC (20)
  effective_max = max_soc ?? DEFAULT_MAX_SOC (90)

  FOR each hour in [NOW .. NOW+24h]:

    Step 1: PLD-based decision (unchanged from v5.6)
      IF hour ∈ [00:00, 05:00) → pld_action = 'charge'
      ELSE IF pld_hora >= 300  → pld_action = 'discharge'
      ELSE                     → pld_action = 'charge'

    Step 2: SoC guardrail override (NEW in v5.9)
      final_action = applySocGuardrail(pld_action, effective_soc, effective_min, effective_max)

    Step 3: Write trade_schedule with final_action
```

### Acceptance Criteria

| Scenario | battery_soc | max_soc | min_soc | PLD action | Final action | Reason |
|----------|-------------|---------|---------|------------|--------------|--------|
| Overcharge prevention | 95 | 90 | 20 | charge | **idle** | soc(95) >= max_soc(90) |
| Deep discharge prevention | 15 | 90 | 20 | discharge | **idle** | soc(15) <= min_soc(20) |
| Normal charge | 50 | 90 | 20 | charge | charge | soc within range |
| Normal discharge | 60 | 90 | 20 | discharge | discharge | soc within range |
| No device_state row | NULL→50 | 90 | 20 | discharge | discharge | fallback soc(50) within range |
| No vpp_strategies row | 50 | NULL→90 | NULL→20 | charge | charge | fallback limits, soc within range |

**Key test case:** Asset with `battery_soc=95`, `max_soc=90` → no `'charge'` trade_schedule inserted for any hour.

---

## 7. org_id Integration

- All events published include `org_id` in detail
- Schedule generation queries Timestream with `WHERE org_id = ?`
- Optimization runs are per-org (one org's assets never influence another's schedule)
- AppConfig strategies are segmented by `org_id`

---

## 8. Lambda Handlers

```
src/optimization-engine/
├── handlers/
│   ├── run-schedule.ts           # EventBridge Scheduled → generate dispatch plan
│   ├── evaluate-forecast.ts      # TelemetryReceived → update forecast
│   └── compute-alpha.ts          # On-demand optimization alpha calculation
├── services/
│   ├── tariff-optimizer.ts       # Peak/valley arbitrage logic
│   ├── dual-objective-solver.ts  # v5.5: 雙目標最佳化求解器
│   ├── schedule-generator.ts     # v5.6: Cron Job — Mock rule-based 排程生成; v5.9: SoC-Aware guardrails
│   ├── pld-query.ts              # v5.7: 動態電價優先查詢策略
│   ├── forecast-engine.ts        # Load & PV forecast (MAPE tracking)
│   └── baseline-calculator.ts    # Shadow benchmark (dumb baseline)
└── __tests__/
    ├── tariff-optimizer.test.ts
    ├── dual-objective-solver.test.ts  # v5.5
    ├── schedule-generator.test.ts     # v5.6; v5.9: SoC guardrail tests
    ├── pld-query.test.ts              # v5.7
    └── baseline-calculator.test.ts
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：4 策略演算法、AppConfig、成本最佳化 |
| v5.5 | 2026-02-28 | 雙目標最佳化框架：B端套利 + C端自發自用約束 |
| v5.6 | 2026-02-28 | Schedule Generator Cron Job：Mock rule-based 排程生成，每小時寫入 trade_schedules |
| v5.7 | 2026-02-28 | 動態電價優先策略：M7 Webhook 持續更新 pld_horario，Schedule Generator 升級為「最新電價優先」查詢 |
| v5.9 | 2026-03-02 | SoC-Aware Scheduling with vpp_strategies guardrails |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | Timestream 查詢 SoC 數據、消費 `TelemetryReceived`；**v5.9: LEFT JOIN device_state 讀取 battery_soc** |
| **依賴** | M4 (Market & Billing) | 查詢當前電價、消費 `TariffUpdated` |
| **依賴** | M7 (Open API) | v5.7: M7 Inbound Webhook 更新 pld_horario，M2 讀取最新電價 |
| **依賴** | M8 (Admin Control) | AppConfig `vpp-strategies` 讀取策略參數；**v5.9: LEFT JOIN vpp_strategies 讀取 min_soc/max_soc** |
| **被依賴** | M1 (IoT Hub) | 發佈 `ScheduleGenerated` → Device Shadow |
| **被依賴** | M3 (DR Dispatcher) | 發佈 `ScheduleGenerated` → 執行即時調度；v5.6: trade_schedules DB polling |
| **被依賴** | M4 (Market & Billing) | 發佈 `ScheduleGenerated` → 記錄預期收益 |
| **被依賴** | M5 (BFF) | 發佈 `ForecastUpdated` → 儀表板展示；trade_schedules 查詢 |
