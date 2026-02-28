# Module 2: Optimization Engine (Algorithm Engine)

> **模組版本**: v5.2
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.2.md](./00_MASTER_ARCHITECTURE_v5.2.md)
> **最後更新**: 2026-02-27
> **說明**: 4 種策略演算法、AppConfig Strategy Profiles、成本最佳化、SOC 約束、排程輸出

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
│   ├── forecast-engine.ts        # Load & PV forecast (MAPE tracking)
│   └── baseline-calculator.ts    # Shadow benchmark (dumb baseline)
└── __tests__/
    ├── tariff-optimizer.test.ts
    └── baseline-calculator.test.ts
```

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | Timestream 查詢 SoC 數據、消費 `TelemetryReceived` |
| **依賴** | M4 (Market & Billing) | 查詢當前電價、消費 `TariffUpdated` |
| **依賴** | M8 (Admin Control) | AppConfig `vpp-strategies` 讀取策略參數 |
| **被依賴** | M1 (IoT Hub) | 發佈 `ScheduleGenerated` → Device Shadow |
| **被依賴** | M3 (DR Dispatcher) | 發佈 `ScheduleGenerated` → 執行即時調度 |
| **被依賴** | M4 (Market & Billing) | 發佈 `ScheduleGenerated` → 記錄預期收益 |
| **被依賴** | M5 (BFF) | 發佈 `ForecastUpdated` → 儀表板展示 |
