# M5: BFF Module -- Gateway 整合 + SSE 即時推送 + Dispatch Guard

> **模組版本**: v5.22
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **最後更新**: 2026-03-13
> **說明**: homes→gateways 整合、7 個新 handler、SSE 即時事件推送、Dispatch 409 衝突防護
> **核心主題**: 將 BFF 從 home-centric 模型遷移至 gateway-centric 模型，新增即時推送與指令衝突防護

---

## v5.16 → v5.22 變更總覽

| 版本 | 變更內容 | 影響範圍 |
|------|----------|----------|
| **v5.19** | homes→gateways 整合：get-homes.ts → get-gateways.ts、get-homes-summary.ts → get-gateways-summary.ts；新增 7 個 gateway handler；Demo auth org_id = ORG_ENERGIA_001 | 新增 7 檔案，舊 homes handler 保留向後相容 |
| **v5.20** | Gateway-level detail + device list + energy flow + schedule 讀寫；EMS health 顯示 via gateways.ems_health JSONB | get-gateway-detail.ts、get-gateway-devices.ts、get-gateway-energy.ts、get-gateway-schedule.ts、put-gateway-schedule.ts |
| **v5.21** | SSE 即時推送端點 sse-events.ts：LISTEN telemetry_update / gateway_health；30s keepalive ping；專用 pg.Client（非連接池）；前端 Config + Schedule card 合併 | 新增 1 檔案 |
| **v5.22** | put-gateway-schedule.ts 新增 409 Conflict 防護：同一 gateway+config 有 pending/dispatched/accepted 指令時拒絕；前端 dispatch 按鈕在 pending 狀態禁用 | 修改 1 檔案 |

---

## 1. 完整端點列表（32 handler + 1 middleware = 33 檔案）

### GET handlers（27 個）

| # | Handler 檔案 | 路由 | 版本 | 說明 |
|---|-------------|------|------|------|
| 1 | get-assets.ts | GET /assets | v5.12 | 資產列表 |
| 2 | get-dashboard.ts | GET /dashboard | v5.14 | 儀表板 10 項查詢 |
| 3 | get-device-detail.ts | GET /api/devices/:assetId | v5.12 | 設備詳細資訊 |
| 4 | get-device-schedule.ts | GET /api/devices/:assetId/schedule | v5.12 | 設備排程讀取 |
| 5 | get-devices.ts | GET /api/devices | v5.12 | 設備列表 |
| 6 | get-fleet-integradores.ts | GET /api/fleet/integradores | v5.12 | 整合商列表 |
| 7 | get-fleet-offline-events.ts | GET /api/fleet/offline-events | v5.12 | 離線事件 |
| 8 | get-fleet-overview.ts | GET /api/fleet/overview | v5.12 | 車隊總覽 |
| 9 | get-fleet-uptime-trend.ts | GET /api/fleet/uptime-trend | v5.12 | 28 天 uptime 趨勢 |
| 10 | **get-gateway-detail.ts** | GET /api/gateways/:gatewayId/detail | **v5.20** | Gateway 級聚合詳情 + 設備狀態 + EMS health |
| 11 | **get-gateway-devices.ts** | GET /api/gateways/:gatewayId/devices | **v5.20** | Gateway 下設備列表 + device_state 遙測 |
| 12 | **get-gateway-energy.ts** | GET /api/gateways/:gatewayId/energy | **v5.20** | Gateway 級 24hr 能量流 (96×15min) |
| 13 | **get-gateway-schedule.ts** | GET /api/gateways/:gatewayId/schedule | **v5.20** | Gateway 排程讀取（get_reply + set 同步狀態） |
| 14 | **get-gateways-summary.ts** | GET /api/gateways/summary | **v5.19** | 跨 Gateway 比較表 |
| 15 | **get-gateways.ts** | GET /api/gateways | **v5.19** | Gateway 列表 + device_count + ems_health |
| 16 | get-hems-overview.ts | GET /api/hems/overview | v5.12 | HEMS 總覽 |
| 17 | get-home-energy.ts | GET /api/homes/:homeId/energy | v5.12 | Home 級能量流（向後相容，local-server 未註冊） |
| 18 | get-homes-summary.ts | GET /api/homes/summary | v5.12 | Home 摘要（向後相容，local-server 未註冊） |
| 19 | get-homes.ts | GET /api/homes | v5.12 | Home 列表（向後相容，local-server 未註冊） |
| 20 | get-performance-savings.ts | GET /api/performance/savings | v5.16 | 績效儲蓄（SC/TOU/PS 實際值） |
| 21 | get-performance-scorecard.ts | GET /api/performance/scorecard | v5.14 | 績效計分卡 |
| 22 | get-revenue-trend.ts | GET /revenue-trend | v5.12 | 營收趨勢 |
| 23 | get-tariffs.ts | GET /api/tariffs | v5.12 | 電價費率 |
| 24 | get-trades.ts | GET /trades | v5.12 | 交易記錄 |
| 25 | get-vpp-capacity.ts | GET /api/vpp/capacity | v5.12 | VPP 容量 |
| 26 | get-vpp-dr-events.ts | GET /api/vpp/dr-events | v5.12 | DR 事件列表 |
| 27 | get-vpp-latency.ts | GET /api/vpp/latency | v5.12 | VPP 延遲分層 |

### POST/PUT handlers（4 個）

| # | Handler 檔案 | 路由 | 版本 | 說明 |
|---|-------------|------|------|------|
| 28 | post-hems-dispatch.ts | POST /api/hems/dispatch | v5.12 | 批次調度（dispatch_commands 寫入，無 409 guard） |
| 29 | put-device-schedule.ts | PUT /api/devices/:assetId/schedule | v5.12 | 設備排程寫入 |
| 30 | put-device.ts | PUT /api/devices/:assetId | v5.12 | 設備更新 |
| 31 | **put-gateway-schedule.ts** | PUT /api/gateways/:gatewayId/schedule | **v5.20** | Gateway 排程寫入（含 409 防護） |

### SSE handler（1 個）

| # | Handler 檔案 | 路由 | 版本 | 說明 |
|---|-------------|------|------|------|
| 32 | **sse-events.ts** | GET /api/events | **v5.21** | SSE 即時推送（telemetry_update + gateway_health） |

### Middleware（1 個）

| 檔案 | 說明 |
|------|------|
| auth.ts | BFF HTTP 適配器：extractTenantContext（委派 shared verifyTenantToken）+ re-export requireRole + apiError；Demo auth 由 local-server 注入 ORG_ENERGIA_001 |

---

## 2. 新增/修改端點詳情

### 2.1 GET `/api/gateways` -- Gateway 列表（v5.19）

從 `gateways` 表讀取，JOIN `organizations` 取得組織名稱，LEFT JOIN `assets` 計算設備數量。回傳 `ems_health` JSONB 欄位。

```sql
SELECT g.gateway_id, g.name, g.org_id, o.name AS org_name,
       g.status, g.last_seen_at, g.ems_health, g.contracted_demand_kw,
       COUNT(a.asset_id)::int AS device_count
FROM gateways g
JOIN organizations o ON g.org_id = o.org_id
LEFT JOIN assets a ON a.gateway_id = g.gateway_id AND a.is_active = true
GROUP BY g.gateway_id, g.name, g.org_id, o.name, g.status, g.last_seen_at,
         g.ems_health, g.contracted_demand_kw
ORDER BY g.name
```

**回應格式：**
```json
{
  "gateways": [
    {
      "gatewayId": "GW-001",
      "name": "Gateway Residencia Silva",
      "orgId": "ORG_ENERGIA_001",
      "orgName": "Energia Solar SP",
      "status": "online",
      "lastSeenAt": "2026-03-13T12:00:00.000Z",
      "deviceCount": 5,
      "emsHealth": { "CPU_temp": "45", "CPU_usage": "12%", "memory_usage": "38%" },
      "contractedDemandKw": 15.0
    }
  ]
}
```

### 2.2 GET `/api/gateways/summary` -- 跨 Gateway 比較（v5.19）

跨 Gateway 比較表：self-consumption %、grid export/import、peak load、operation mode。

```sql
SELECT
  g.gateway_id, g.name,
  COALESCE(SUM(rd.grid_export_kwh), 0) AS grid_export,
  COALESCE(SUM(rd.grid_import_kwh), 0) AS grid_import,
  COALESCE(AVG(rd.actual_self_consumption_pct), 0) AS self_cons,
  COALESCE(MAX(ds.load_power), 0) AS peak_load,
  a2.operation_mode AS mode
FROM gateways g
LEFT JOIN assets a ON a.gateway_id = g.gateway_id AND a.is_active = true
LEFT JOIN revenue_daily rd ON rd.asset_id = a.asset_id AND rd.date = $1::DATE
LEFT JOIN device_state ds ON ds.asset_id = a.asset_id
LEFT JOIN LATERAL (
  SELECT a3.operation_mode
  FROM assets a3
  WHERE a3.gateway_id = g.gateway_id AND a3.is_active = true
    AND a3.asset_type = 'INVERTER_BATTERY'
  LIMIT 1
) a2 ON true
GROUP BY g.gateway_id, g.name, a2.operation_mode
ORDER BY g.name
```

**查詢參數：** `date` (ISO，預設 today)

### 2.3 GET `/api/gateways/:gatewayId/detail` -- Gateway 詳情（v5.20）

三路並行查詢（Promise.all）：

**Q1: Gateway 資訊 + 所有設備 + device_state**
```sql
SELECT
  g.gateway_id, g.name, g.status, g.last_seen_at,
  g.contracted_demand_kw, g.ems_health,
  a.asset_id, a.name AS device_name, a.asset_type,
  a.brand, a.model, a.serial_number,
  a.capacidade_kw, a.capacity_kwh, a.operation_mode, a.allow_export,
  ds.battery_soc, ds.bat_soh, ds.battery_voltage,
  ds.battery_power, ds.pv_power,
  ds.grid_power_kw, ds.load_power,
  ds.inverter_temp, ds.is_online, ds.updated_at
FROM gateways g
LEFT JOIN assets a ON a.gateway_id = g.gateway_id AND a.is_active = true
LEFT JOIN device_state ds ON ds.asset_id = a.asset_id
WHERE g.gateway_id = $1
ORDER BY a.asset_type, a.name
```

**Q2: 最新遙測擴展資料（inverter 優先，smart meter fallback）**
```sql
SELECT th.telemetry_extra,
       th.battery_soh, th.battery_voltage, th.battery_current,
       th.battery_temperature, th.flload_power, th.inverter_temp,
       th.max_charge_current, th.max_discharge_current
FROM telemetry_history th
JOIN assets a ON a.asset_id = th.asset_id
WHERE a.gateway_id = $1 AND a.is_active = true
ORDER BY
  CASE a.asset_type WHEN 'INVERTER_BATTERY' THEN 1 ELSE 2 END,
  th.recorded_at DESC
LIMIT 1
```

**Q4: 最新排程指令（device_command_logs）**
```sql
SELECT id, payload_json, result, resolved_at, created_at
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
ORDER BY created_at DESC
LIMIT 1
```

**關鍵邏輯：**
- Grid 資料優先順序：inverter > smart meter > null（Fix #2）
- EMS health 從 `gateways.ems_health` JSONB 解析：CPU_temp、CPU_usage、memory_usage、disk_usage、wifi_signal_strength、system_runtime、SIM_status、ems_temp
- Config defaults：socMin=10, socMax=100, source="hardcoded"（gateway-level 未查詢 vpp_strategies，Q3 skipped；device-level 使用 vpp_strategies）

### 2.4 GET `/api/gateways/:gatewayId/devices` -- Gateway 設備列表（v5.20）

```sql
-- Q1: 驗證 Gateway 存在
SELECT g.gateway_id, g.name, g.status
FROM gateways g
WHERE g.gateway_id = $1

-- Q2: 設備列表 + device_state
SELECT a.asset_id, a.name, a.asset_type, a.brand, a.model, a.serial_number,
       a.capacidade_kw, a.capacity_kwh, a.operation_mode, a.allow_export, a.is_active,
       ds.battery_soc, ds.battery_power, ds.pv_power, ds.grid_power_kw,
       ds.load_power, ds.inverter_temp, ds.bat_soh,
       ds.telemetry_json, ds.is_online
FROM assets a
LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
WHERE a.gateway_id = $1 AND a.is_active = true
ORDER BY a.asset_type, a.name
```

**回應格式：** 每個設備包含 state 子物件（batterySoc, batteryPower, pvPower, gridPowerKw, loadPower, inverterTemp, batSoh, batteryTemperature, isOnline）

### 2.5 GET `/api/gateways/:gatewayId/energy` -- Gateway 能量流（v5.20）

24hr 時序資料，96 個 15 分鐘桶。兩路並行查詢：

**Q1: 遙測時序彙總**
```sql
SELECT
  date_trunc('minute', th.recorded_at)
    - (EXTRACT(MINUTE FROM th.recorded_at)::INT % 15) * INTERVAL '1 minute' AS time_bucket,
  COALESCE(SUM(th.pv_power), 0) AS pv,
  COALESCE(SUM(th.load_power), 0) AS load,
  COALESCE(SUM(th.battery_power), 0) AS battery,
  COALESCE(SUM(th.grid_power_kw), 0) AS grid,
  COALESCE(AVG(th.battery_soc), 0) AS soc,
  COALESCE(AVG(th.flload_power), 0) AS flload
FROM telemetry_history th
JOIN assets a ON th.asset_id = a.asset_id
WHERE a.gateway_id = $1
  AND a.is_active = true
  AND th.recorded_at >= $2::DATE
  AND th.recorded_at < $2::DATE + INTERVAL '1 day'
GROUP BY time_bucket
ORDER BY time_bucket
```

**Q2: 電價費率**
```sql
SELECT peak_rate, offpeak_rate,
       COALESCE(intermediate_rate, (peak_rate + offpeak_rate) / 2.0) AS intermediate_rate,
       peak_start, peak_end, intermediate_start, intermediate_end
FROM tariff_schedules
ORDER BY effective_from DESC LIMIT 1
```

**關鍵邏輯：**
- baseline = load + max(0, grid)
- savingsBrl 使用 Tarifa Branca 三段費率（peak/intermediate/offpeak）計算
- acPower、evCharge 目前為 placeholder（全 0 陣列），待個別設備遙測整合

### 2.6 GET `/api/gateways/:gatewayId/schedule` -- Gateway 排程讀取（v5.20）

三段查詢，優先順序：successful set payload > get_reply > null

**Q1: 最新成功的 set 指令**
```sql
SELECT payload_json
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
  AND result = 'success'
  AND payload_json IS NOT NULL
ORDER BY created_at DESC
LIMIT 1
```

**Q2: Fallback — 最新 get_reply（gateway 回報的設定）**
```sql
SELECT payload_json
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'get_reply'
  AND config_name = 'battery_schedule'
  AND payload_json IS NOT NULL
ORDER BY created_at DESC
LIMIT 1
```

**Q3: 最新 set 指令（任意狀態）— 用於 syncStatus**
```sql
SELECT result, resolved_at, created_at
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
ORDER BY created_at DESC
LIMIT 1
```

**syncStatus 映射：**
- `success` → `"synced"`
- `pending` / `dispatched` / `accepted` → `"pending"`
- `failed` / `timeout` → `"failed"`
- 其他 → `"unknown"`

**Slot 格式轉換：** domain mode → frontend purpose
- `self_consumption` → purpose: `"self_consumption"`
- `peak_shaving` → purpose: `"peak_shaving"`
- `peak_valley_arbitrage` → purpose: `"tariff"` + direction + exportPolicy

### 2.7 PUT `/api/gateways/:gatewayId/schedule` -- Gateway 排程寫入（v5.20）

最低角色：`ORG_MANAGER`

接受 DomainSchedule body，驗證後存入 device_command_logs 為 pending 指令。回傳 202 Accepted。

**前端 purpose → domain mode 映射：**
- `"self_consumption"` → `self_consumption`
- `"peak_shaving"` → `peak_shaving`
- `"tariff"` → `peak_valley_arbitrage`

**驗證流程：**
1. JSON body 解析 + slots 非空驗證
2. purpose → mode 映射
3. `validateSchedule()` 調用（schedule-translator）
4. Gateway 存在性驗證

**v5.22 新增 409 Guard（見第 4 節）**

---

## 3. SSE 端點詳情（v5.21）

### GET `/api/events` -- Server-Sent Events 即時推送

**架構要點：**

```
+----------------------------------------------------+
|             SSE Connection Lifecycle                |
|                                                     |
|  1. Browser → GET /api/events                        |
|  2. Response headers:                               |
|     Content-Type: text/event-stream                 |
|     Cache-Control: no-cache                         |
|     Connection: keep-alive                          |
|     X-Accel-Buffering: no                           |
|  3. 建立專用 pg.Client（非連接池！）               |
|  4. LISTEN telemetry_update                         |
|     LISTEN gateway_health                           |
|  5. pg notification → SSE data 事件                 |
|  6. 30s keepalive ping（:keepalive\n\n）            |
|  7. Client 斷線 → UNLISTEN * → client.end()        |
+----------------------------------------------------+
```

**關鍵設計決策：**

| 決策 | 原因 |
|------|------|
| 使用專用 `pg.Client`，不使用連接池 | LISTEN 連線需持續存活，放回 pool 會造成 LISTEN 遺失 |
| 每個 SSE 客戶端一個 LISTEN 連線 | 簡化實作，避免多路復用複雜度 |
| 30s keepalive | 防止 Nginx/ALB 等 reverse proxy 的閒置超時 |
| 連線失敗時回傳 error SSE 事件 | 客戶端可自行重連 |

**SSE 事件格式：**
```
data: {"type":"telemetry_update","gatewayId":"GW-001"}

data: {"type":"gateway_health","gatewayId":"GW-001"}

:keepalive
```

**注意：** `sse-events.ts` 使用 Express `(req, res)` 簽名（非 Lambda handler），由 `createSseHandler(_pool)` 工廠函式建立（pool 參數未使用，因 LISTEN 使用獨立 pg.Client）。

---

## 4. Dispatch Guard 邏輯（v5.22）

### put-gateway-schedule.ts — 409 Conflict 防護

在寫入新的 `device_command_logs` 之前，檢查同一 gateway + config_name 是否存在進行中的指令。

```sql
SELECT id, result FROM device_command_logs
WHERE gateway_id = $1 AND command_type = 'set' AND config_name = 'battery_schedule'
  AND result IN ('pending', 'dispatched', 'accepted')
ORDER BY created_at DESC LIMIT 1
```

**防護邏輯：**

```
if (activeCheck.rows.length > 0) {
  return 409 Conflict:
    "Command already in progress (id=<id>, status=<result>). Wait for completion."
}
```

**衝突回應格式：**
```json
{
  "success": false,
  "data": null,
  "error": "Command already in progress (id=42, status=pending). Wait for completion.",
  "timestamp": "2026-03-13T12:00:00.000Z"
}
```

**重要：** 衝突檢查使用 `rlsOrgId = null`（跨 org 可見），確保同一 gateway 即使跨租戶也不會產生衝突指令。

### 前端配合

前端在收到 202 Accepted 後，dispatch 按鈕進入 disabled 狀態，直到 SSE 推送 `gateway_health` 事件或排程查詢回傳 syncStatus !== `"pending"` 時才重新啟用。

---

## 5. Query Routing Red Line

| 查詢類型 | 允許來源 | 禁止來源 |
|----------|----------|----------|
| 長期聚合（Scorecard, Revenue, Dashboard, Savings） | `revenue_daily`, `asset_hourly_metrics`, `device_state` | ~~`telemetry_history`~~, ~~`asset_5min_metrics`~~ |
| 近 24h 高解析度（P3 Energy / Gateway Energy） | `telemetry_history`（唯一例外） | -- |
| 即時設備狀態 | `device_state` | ~~`telemetry_history`~~ |
| 指令歷史/排程狀態 | `device_command_logs` | -- |
| Gateway 列表/摘要 | `gateways`, `organizations`, `assets` | -- |

**v5.22 合規：**
- `get-gateways.ts`: `gateways` + `organizations` + `assets` -- **COMPLIANT**
- `get-gateways-summary.ts`: `gateways` + `revenue_daily` + `device_state` + `assets` -- **COMPLIANT**
- `get-gateway-detail.ts`: `gateways` + `assets` + `device_state` + `telemetry_history`(latest 1 row) -- **COMPLIANT**（單筆 latest，非 bulk scan）
- `get-gateway-devices.ts`: `gateways` + `assets` + `device_state` -- **COMPLIANT**
- `get-gateway-energy.ts`: `telemetry_history`(24h window) + `tariff_schedules` -- **COMPLIANT**（24h 例外）
- `get-gateway-schedule.ts`: `device_command_logs` -- **COMPLIANT**
- `put-gateway-schedule.ts`: `gateways` + `device_command_logs` -- **COMPLIANT**
- `sse-events.ts`: pg LISTEN（無 table scan） -- **COMPLIANT**
- `post-hems-dispatch.ts`: `assets` + `dispatch_commands` -- **COMPLIANT**

---

## 6. App Pool Isolation

所有 32 個 BFF handler 維持 App Pool 合規。所有查詢透過 `queryWithOrg()` 執行。

```
+----------------------------------------------------+
|                     BFF HANDLER                     |
|                                                     |
|  1. extractTenantContext(event)  -> ctx.orgId        |
|  2. rlsOrgId = isAdmin ? null : ctx.orgId           |
|  3. queryWithOrg(sql, params, rlsOrgId)              |
|       |                                              |
|       +-- orgId provided -> App Pool                 |
|       |     SET LOCAL app.current_org_id = orgId      |
|       |     RLS ENFORCED                              |
|       |                                              |
|       +-- orgId null (ADMIN) -> Service Pool         |
|             BYPASSRLS -> sees all tenants            |
|                                                     |
|  4. NEVER import getServicePool() in BFF handlers   |
|  5. NEVER direct pool.query() -- always queryWithOrg|
+----------------------------------------------------+
```

### v5.22 Pool 合規檢查

| Handler | Pool 使用 | 狀態 |
|---------|----------|------|
| get-gateways.ts | queryWithOrg() x1 | **COMPLIANT** |
| get-gateways-summary.ts | queryWithOrg() x1 | **COMPLIANT** |
| get-gateway-detail.ts | queryWithOrg() x3 (Promise.all) | **COMPLIANT** |
| get-gateway-devices.ts | queryWithOrg() x2 | **COMPLIANT** |
| get-gateway-energy.ts | queryWithOrg() x2 (Promise.all) | **COMPLIANT** |
| get-gateway-schedule.ts | queryWithOrg() x3 | **COMPLIANT** |
| put-gateway-schedule.ts | queryWithOrg() x2 + null x1 (conflict check) = 3 total | **COMPLIANT** |
| sse-events.ts | 專用 pg.Client (非 pool) | **COMPLIANT**（SSE 例外） |
| post-hems-dispatch.ts | queryWithOrg() xN | **COMPLIANT** |
| 其餘 23 handler | 未變更 | COMPLIANT |

**注意：** `put-gateway-schedule.ts` 的 409 衝突檢查使用 `rlsOrgId = null` 以跨 org 檢查，此為安全設計（防止不同租戶對同一 gateway 發送衝突指令）。

---

## 7. What Stays Unchanged in v5.22

| Handler | 最後變更版本 | v5.22 狀態 |
|---------|-------------|-----------|
| get-dashboard.ts | v5.14 | Unchanged |
| get-performance-scorecard.ts | v5.14 | Unchanged |
| get-performance-savings.ts | v5.16 | Unchanged |
| get-revenue-trend.ts | v5.12 | Unchanged |
| get-home-energy.ts | v5.12 | Unchanged（向後相容） |
| get-homes.ts | v5.12 | Unchanged（向後相容） |
| get-homes-summary.ts | v5.12 | Unchanged（向後相容） |
| get-devices.ts | v5.12 | Unchanged |
| get-device-detail.ts | v5.12 | Unchanged |
| get-device-schedule.ts | v5.12 | Unchanged |
| put-device-schedule.ts | v5.12 | Unchanged |
| put-device.ts | v5.12 | Unchanged |
| get-assets.ts | v5.12 | Unchanged |
| get-tariffs.ts | v5.12 | Unchanged |
| get-trades.ts | v5.12 | Unchanged |
| get-hems-overview.ts | v5.12 | Unchanged |
| get-fleet-overview.ts | v5.12 | Unchanged |
| get-fleet-integradores.ts | v5.12 | Unchanged |
| get-fleet-offline-events.ts | v5.12 | Unchanged |
| get-fleet-uptime-trend.ts | v5.12 | Unchanged |
| get-vpp-capacity.ts | v5.12 | Unchanged |
| get-vpp-dr-events.ts | v5.12 | Unchanged |
| get-vpp-latency.ts | v5.12 | Unchanged |
| auth.ts (middleware) | v5.19 | Unchanged（HTTP 適配器：extractTenantContext + requireRole + apiError） |

---

## 8. Code Change List

| 檔案 | 動作 | 版本 | 說明 |
|------|------|------|------|
| `bff/handlers/get-gateways.ts` | **NEW** | v5.19 | Gateway 列表，含 device_count + ems_health JSONB |
| `bff/handlers/get-gateways-summary.ts` | **NEW** | v5.19 | 跨 Gateway 比較表，替代 get-homes-summary |
| `bff/handlers/get-gateway-detail.ts` | **NEW** | v5.20 | Gateway 詳情，3 路並行查詢，grid 資料 inverter > meter fallback |
| `bff/handlers/get-gateway-devices.ts` | **NEW** | v5.20 | Gateway 下設備列表 + device_state 遙測 |
| `bff/handlers/get-gateway-energy.ts` | **NEW** | v5.20 | Gateway 級 24hr 能量流，96×15min 桶，Tarifa Branca 儲蓄計算 |
| `bff/handlers/get-gateway-schedule.ts` | **NEW** | v5.20 | Gateway 排程讀取，set 成功 > get_reply > null 優先順序 |
| `bff/handlers/put-gateway-schedule.ts` | **NEW** | v5.20 | Gateway 排程寫入，DomainSchedule 驗證，202 Accepted |
| `bff/handlers/sse-events.ts` | **NEW** | v5.21 | SSE 端點，專用 pg.Client LISTEN，30s keepalive |
| `bff/handlers/post-hems-dispatch.ts` | **unchanged** | v5.12 | 批次調度（注：409 guard 僅在 put-gateway-schedule.ts） |
| `bff/middleware/auth.ts` | **unchanged** | v5.19 | Demo auth adapter |
| 其餘 23 handler | **unchanged** | v5.12-v5.16 | 無影響 |

---

## 9. Test Strategy

| 測試 | 範圍 | 技術 |
|------|------|------|
| Gateway 列表 RLS | 非 admin 使用者僅看到自己 org 的 gateways | Integration: 兩個 org 各有 gateway，驗證 RLS 過濾 |
| Gateway device_count | 3 active + 1 inactive assets | 驗證 device_count = 3 |
| Gateway ems_health JSONB | Seeded ems_health JSON | 驗證 cpuTemp, memoryUsage 等欄位正確解析 |
| Gateway summary self_cons | revenue_daily 有 actual_self_consumption_pct | 驗證 selfCons 值正確 |
| Gateway detail grid fallback | Inverter grid_power_kw = null, meter grid_power_kw = 3.5 | 驗證 state.gridPowerKw = 3.5 |
| Gateway detail 3 queries | Gateway + devices + telemetry_history | 驗證 Promise.all 三路回傳正確 |
| Gateway energy 96 buckets | 24h telemetry data seeded | 驗證 pv/load/battery/grid 長度 = 96 |
| Gateway energy savings | Tariff rates + energy data | 驗證 savingsBrl 計算正確 |
| Gateway schedule priority | set success + get_reply 均存在 | 驗證回傳 set success payload（非 get_reply） |
| Gateway schedule syncStatus | result = 'pending' | 驗證 syncStatus = "pending" |
| Put schedule validation | 缺少 slots | 驗證 400 Bad Request |
| Put schedule 409 guard | 已有 pending 指令 | 驗證 409 Conflict + 錯誤訊息含 command id |
| Put schedule 202 | 無衝突指令 | 驗證 202 + commandId 回傳 |
| SSE 連線建立 | Mock pg.Client | 驗證 LISTEN telemetry_update + LISTEN gateway_health |
| SSE keepalive | 30s timer | 驗證 `:keepalive\n\n` 寫入 |
| SSE 斷線清理 | req.close 事件 | 驗證 UNLISTEN * + client.end() |
| SSE notification 轉發 | pg notification msg | 驗證 SSE data 格式正確 |
| Backward compat homes | GET /api/homes | 驗證舊端點仍回傳正確（unchanged） |
| App Pool 全端點 | 所有 32 handler | 驗證無 direct pool.query()，全部使用 queryWithOrg |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: BFF Gateway + 4 endpoints |
| v5.3 | 2026-02-27 | HEMS single-home control |
| v5.5 | 2026-02-28 | Dual-layer revenue KPI |
| v5.9 | 2026-03-02 | BFF de-hardcoding round 1 |
| v5.10 | 2026-03-05 | Dashboard 7 queries de-hardcoded |
| v5.12 | 2026-03-05 | API Contract Alignment -- 15 new endpoints |
| v5.13 | 2026-03-05 | Scorecard 2 metrics de-hardcoded; Dashboard revenue -> Tarifa Branca |
| v5.14 | 2026-03-06 | KPI Replacement: Savings Alpha -> Actual Savings + Opt Efficiency + Self-Sufficiency |
| v5.15 | 2026-03-07 | SC/TOU Real Attribution: remove fake ratios; ps=null |
| v5.16 | 2026-03-07 | PS Real Value: ps:null -> COALESCE(SUM(ps_savings_reais),0) |
| v5.19 | 2026-03-10 | homes→gateways 整合：7 個新 gateway handler；get-homes/get-homes-summary 保留向後相容；Demo auth org_id=ORG_ENERGIA_001 |
| v5.20 | 2026-03-11 | Gateway-level detail (3 路並行 + grid fallback) + devices + energy flow (96×15min + Tarifa Branca savings) + schedule 讀寫 (set>get_reply 優先順序 + syncStatus)；EMS health JSONB 解析 |
| v5.21 | 2026-03-12 | SSE 即時推送：sse-events.ts 專用 pg.Client LISTEN telemetry_update + gateway_health；30s keepalive；前端 Config+Schedule card 合併 |
| **v5.22** | **2026-03-13** | **Dispatch Guard：put-gateway-schedule.ts 新增 409 Conflict 防護，同一 gateway+config 有 pending/dispatched/accepted 指令時拒絕寫入；前端 dispatch 按鈕 pending 狀態禁用；BFF 總計 32 handler + 1 middleware = 33 檔案；所有端點 App Pool compliant** |
