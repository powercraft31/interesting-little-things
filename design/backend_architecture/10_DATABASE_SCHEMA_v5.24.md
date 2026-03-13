# Database Schema — P3 多粒度查詢模式文檔

> **Version**: v5.24
> **Parent**: [00_MASTER_ARCHITECTURE_v5.24.md](./00_MASTER_ARCHITECTURE_v5.24.md)
> **Last Updated**: 2026-03-13
> **Description**: 補充 telemetry_history 多粒度查詢模式文檔，無 DDL 變更
> **Core Theme**: P3 Asset History View 的 date_trunc 聚合查詢模式

---

## 1. Version History

| Version | Date | Description |
|---------|------|-------------|
| v5.22 | 2026-03-13 | gateways 吸收 homes 欄位、backfill_requests、telemetry_history UNIQUE INDEX |
| **v5.24** | **2026-03-13** | **無 DDL 變更。補充多粒度查詢模式文檔（P3 Asset History View）** |

---

## 2. Migration DDL

**v5.24 無新增 DDL 遷移。** 所有 v5.22 遷移維持不變。

---

## 3. telemetry_history 多粒度查詢模式（v5.24 NEW）

### 3.1 telemetry_history 完整欄位參考（25 欄位）

| # | 欄位名 | 型別 | P3-1 使用 | P3-2 使用 | 說明 |
|---|--------|------|-----------|-----------|------|
| 1 | `id` | `BIGINT` | — | — | 自增主鍵 |
| 2 | `asset_id` | `VARCHAR(200)` | ✅ WHERE | ✅ WHERE | 資產識別 |
| 3 | `recorded_at` | `TIMESTAMPTZ` | ✅ WHERE + ORDER | ✅ WHERE + ORDER | 記錄時間（分區鍵） |
| 4 | `battery_soc` | `NUMERIC(5,2)` | ✅ 日視圖右軸 | ✅ SOC 歷史 | 電池充電狀態 % |
| 5 | `pv_power` | `NUMERIC(8,3)` | ✅ 功率折線 | — | PV 發電功率 kW |
| 6 | `battery_power` | `NUMERIC(8,3)` | ✅ 功率折線 | — | 電池功率 kW（正=充，負=放） |
| 7 | `grid_power_kw` | `NUMERIC(8,3)` | ✅ 功率折線 | — | 電網功率 kW（正=進口，負=出口） |
| 8 | `load_power` | `NUMERIC(8,3)` | ✅ 功率折線 + summary | — | 負載功率 kW |
| 9 | `bat_work_status` | `VARCHAR(20)` | — | ✅ 當前狀態 | charging/discharging/standby |
| 10 | `grid_import_kwh` | `NUMERIC(10,3)` | ✅ 長條圖 + summary | — | 電網進口能量 kWh（5 分鐘增量） |
| 11 | `grid_export_kwh` | `NUMERIC(10,3)` | ✅ 長條圖 + summary | — | 電網出口能量 kWh（5 分鐘增量） |
| 12 | `battery_soh` | `REAL` | — | ✅ SOH 趨勢 | 電池健康度 % |
| 13 | `battery_voltage` | `REAL` | — | ✅ 電壓圖 | 電池電壓 V |
| 14 | `battery_current` | `REAL` | — | ✅ 電流圖 | 電池電流 A |
| 15 | `battery_temperature` | `REAL` | — | ✅ 溫度圖 | 電池溫度 °C |
| 16 | `do0_active` | `BOOLEAN` | — | ✅ DO 事件 | DO0 繼電器狀態 |
| 17 | `do1_active` | `BOOLEAN` | — | — | DO1 繼電器狀態 |
| 18 | `telemetry_extra` | `JSONB` | — | — | 額外診斷欄位 |
| 19 | `flload_power` | `NUMERIC(8,3)` | — | — | 家庭總負載功率 |
| 20 | `inverter_temp` | `NUMERIC(5,2)` | — | ✅ 溫度圖 | 逆變器溫度 °C |
| 21 | `pv_daily_energy_kwh` | `NUMERIC(10,3)` | ✅ summary (MAX) | — | PV 累計日發電 kWh |
| 22 | `max_charge_current` | `NUMERIC(8,3)` | — | — | BMS 最大充電電流 |
| 23 | `max_discharge_current` | `NUMERIC(8,3)` | — | — | BMS 最大放電電流 |
| 24 | `daily_charge_kwh` | `NUMERIC(10,3)` | ✅ 長條圖 (MAX) | — | 累計日充電能量 kWh |
| 25 | `daily_discharge_kwh` | `NUMERIC(10,3)` | ✅ 長條圖 (MAX) | ✅ 循環數 | 累計日放電能量 kWh |

### 3.2 聚合模式（date_trunc patterns）

P3 使用 4 種粒度查詢 telemetry_history，均利用 `date_trunc` 進行時間聚合：

| 粒度 | date_trunc | 典型數據點數 | 欄位聚合方式 | 前端圖表 |
|------|-----------|------------|-------------|----------|
| **5min** | 無（原始） | 288/天 | 原始值 | 日視圖折線 |
| **hour** | `date_trunc('hour', ...)` | 24/天 | AVG(power), SUM(energy) | 週/月視圖長條 |
| **day** | `date_trunc('day', ...)` | 7-31/期間 | MAX(daily_*), SUM(load/12), SUM(grid_*) | 週/月視圖長條 |
| **month** | `date_trunc('month', ...)` | 3-12/期間 | 先 per-day MAX，再跨日 SUM | 年視圖長條 |

### 3.3 聚合函式選擇理由

| 欄位類型 | 聚合函式 | 理由 |
|----------|----------|------|
| 瞬時功率（pv_power, load_power, battery_power, grid_power_kw） | `AVG` | 平均功率更能代表該時段的能量消耗 |
| 累計日能量（pv_daily_energy_kwh, daily_charge_kwh, daily_discharge_kwh） | `MAX` per day | 逆變器回報值為日累計遞增，同日取 MAX 即為當日總量 |
| 增量能量（grid_import_kwh, grid_export_kwh） | `SUM` | 每 5 分鐘為增量值，SUM 為區間總量 |
| 負載能量轉換 | `SUM(load_power) / 12` | load_power (kW) × 5min = kWh；1h = 12 個 5min |
| SOC / SOH | `AVG` | 取平均值代表時段中心值 |
| 溫度 | `AVG` 或原始 | 日視圖原始，長期取 AVG |

### 3.4 索引利用分析

P3 查詢均以 `WHERE asset_id = $1 AND recorded_at >= $2 AND recorded_at < $3` 過濾，完美命中以下索引：

| 索引 | 用途 |
|------|------|
| `idx_telemetry_unique_asset_time` (asset_id, recorded_at) UNIQUE | ✅ P3 所有查詢的主要索引，支援 asset 級時間範圍掃描 |
| 分區剪裁（PARTITION BY RANGE recorded_at） | ✅ 自動排除不在時間範圍內的分區 |

**效能預估（3 gateways × 90 days × 288 points/day = 77,760 rows total）：**

| 查詢 | 掃描範圍 | 預估時間 |
|------|----------|----------|
| 日視圖（1 天，1 asset） | ~288 rows | < 5ms |
| 週視圖（7 天） | ~2,016 rows | < 10ms |
| 月視圖（30 天） | ~8,640 rows | < 20ms |
| 年視圖（365 天） | ~105,120 rows | < 50ms |

### 3.5 telemetry_history 分區策略影響

telemetry_history 為 `PARTITION BY RANGE (recorded_at)` 月度分區：

```
telemetry_history
  ├── telemetry_history_2026_02  (2026-02-01 ~ 2026-02-28)
  ├── telemetry_history_2026_03  (2026-03-01 ~ 2026-03-31)
  ├── telemetry_history_2026_04  (2026-04-01 ~ 2026-04-30)
  └── telemetry_history_default  (fallback)
```

P3 跨月查詢時，PostgreSQL 自動進行分區剪裁（partition pruning）。例如查詢 2026-02-15 至 2026-03-15 僅掃描 `_2026_02` 和 `_2026_03` 兩個分區。

### 3.6 tariff_schedules JOIN 模式

P3 savings 計算 JOIN tariff_schedules 的標準模式：

```sql
-- 查詢 org 級有效電價（最新一筆）
SELECT peak_rate, offpeak_rate, feed_in_rate,
       COALESCE(intermediate_rate, (peak_rate + offpeak_rate) / 2.0) AS intermediate_rate,
       peak_start, peak_end, intermediate_start, intermediate_end
FROM tariff_schedules
WHERE org_id = $1
  AND (effective_to IS NULL OR effective_to > NOW())
ORDER BY effective_from DESC
LIMIT 1
```

**tariff_schedules 完整欄位（18 欄位）：**

| 欄位 | 型別 | P3 使用 | 說明 |
|------|------|---------|------|
| id | SERIAL | — | PK |
| org_id | VARCHAR | ✅ WHERE | 組織識別 |
| schedule_name | VARCHAR | — | 費率方案名稱 |
| peak_start | TIME | ✅ 時段分類 | 尖峰開始 |
| peak_end | TIME | ✅ 時段分類 | 尖峰結束 |
| peak_rate | NUMERIC(8,4) | ✅ 計算 | 尖峰費率 R$/kWh |
| offpeak_rate | NUMERIC(8,4) | ✅ 計算 | 離峰費率 R$/kWh |
| feed_in_rate | NUMERIC(8,4) | ✅ 出口計算 | 饋入費率 R$/kWh |
| intermediate_rate | NUMERIC(8,4) | ✅ 計算 | 中間費率 R$/kWh |
| intermediate_start | TIME | ✅ 時段分類 | 中間時段開始 |
| intermediate_end | TIME | ✅ 時段分類 | 中間時段結束 |
| disco | VARCHAR(50) | — | 配電公司 |
| currency | VARCHAR(3) | ✅ 回傳 | 幣別（BRL），DEFAULT 'BRL' |
| effective_from | DATE | ✅ ORDER BY | 生效日期 |
| effective_to | DATE | ✅ WHERE | 失效日期（NULL=永久有效） |
| created_at | TIMESTAMPTZ | — | 建立時間，DEFAULT now() |
| demand_charge_rate_per_kva | NUMERIC(8,4) | — | 需量費率（P3 不用） |
| billing_power_factor | NUMERIC(3,2) | — | 功率因數（P3 不用），DEFAULT 0.92 |

---

## 4-8. 其餘章節

(Same as v5.22 §2-8. 見 `10_DATABASE_SCHEMA_v5.22.md`.)

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.4 | 2026-02-27 | PostgreSQL full adoption — 19 initial tables |
| v5.5 | 2026-02-28 | revenue_daily dual-layer columns |
| v5.7 | 2026-02-28 | pld_horario import |
| v5.8 | 2026-03-02 | asset_hourly_metrics Data Contract |
| v5.10 | 2026-03-05 | RLS Scope Formalization |
| v5.11 | 2026-03-05 | DDL Fix — RLS scope |
| v5.13 | 2026-03-05 | CREATE ems_health + ALTER asset_hourly_metrics +6 cols |
| v5.14 | 2026-03-06 | ALTER 4 tables +15 cols |
| v5.15 | 2026-03-07 | CREATE asset_5min_metrics (PARTITION BY RANGE daily) |
| v5.16 | 2026-03-07 | DO telemetry, demand charge rate, PS savings |
| v5.22 | 2026-03-13 | CREATE gateways/device_command_logs/backfill_requests, homes→gateways merge, UNIQUE INDEX |
| **v5.24** | **2026-03-13** | **無 DDL 變更。補充 telemetry_history 多粒度查詢模式文檔：4 種 date_trunc 聚合模式（5min/hour/day/month）、聚合函式選擇理由（AVG vs MAX vs SUM）、索引利用分析（idx_telemetry_unique_asset_time + 分區剪裁）、效能預估、tariff_schedules JOIN 模式** |
