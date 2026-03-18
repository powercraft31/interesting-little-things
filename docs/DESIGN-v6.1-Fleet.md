# DESIGN-v6.1-Fleet

**Version:** 6.1
**Date:** 2026-03-17
**REQ:** REQ-v6.1-Fleet.md
**Status:** Draft

---

## 1. 概述

Fleet v6.1 將現有 Fleet 頁面從 **device-first 混合視圖** 重構為 **Gateway-first 運營儀表板**。

**核心語義轉換：**
- KPI 主體：device → gateway
- 線上率計算：device online → gateway heartbeat within 15 min
- 離線事件流：device offline_events → gateway-level outage（含 5 分鐘 flap 合併）
- 回填狀態：與連線狀態分離為獨立維度

**一句話定義（引自 REQ）：**
> Fleet v6.1 is a Gateway-first operations dashboard that surfaces connectivity health, outage recovery, and organization-level operational status, with inverter brand structure shown only as secondary context.

---

## 2. 架構與數據流

### 2.1 頁面資訊架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         KPI Strip                               │
│  [Total GW] [Offline GW] [Online GW] [Online%] [Backfill] [Org]│
└─────────────────────────────────────────────────────────────────┘
┌──────────────────────────┐  ┌──────────────────────────────────┐
│  Left Chart              │  │  Right Chart                     │
│  Gateway Status Dist.    │  │  Inverter Brand Dist.            │
│  (online / offline)      │  │  (device count per brand)        │
└──────────────────────────┘  └──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Organization Summary Table                                     │
│  [Org | GW Count | GW Online Rate | Backfill P/F | Last Comm.] │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Recent Gateway Outage Table (7d)                               │
│  [GW Name | Org | Offline Start | Duration | Backfill Status]   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 數據流概覽

```
                     MQTT heartbeat
Gateway ──────────────────────────────► IoT Hub (heartbeat-handler)
   │                                        │
   │                                        ├─► UPDATE gateways.status = 'online'
   │                                        │   UPDATE gateways.last_seen_at
   │                                        │
   │  MQTT telemetry (primary stream)       │
   ├──────────────────────────────────► IoT Hub (telemetry-handler)
   │                                        │
   │                                        └─► Telemetry gap > 5 min detected?
   │                                              └─► INSERT backfill_requests
   │
   │  (watchdog every 60s)
   │  last_seen_at < NOW() - 15 min ──────► UPDATE gateways.status = 'offline'
   │                                        INSERT gateway_outage_events (或 soft-compute)
   │
   └─► Browser ─── GET /api/fleet/overview ────► BFF ─── SQL aggregate ──► Response
       Browser ─── GET /api/fleet/integradores ► BFF ─── SQL aggregate ──► Response
       Browser ─── GET /api/fleet/offline-events ► BFF ─ SQL query ──────► Response
```

### 2.3 後端 vs 前端責任分工

| 責任 | 後端 | 前端 |
|------|------|------|
| Gateway 線上/離線判定 | ✅ heartbeat watchdog（15 min threshold） | ❌ 不得自行推算 |
| Gateway online rate 計算 | ✅ SQL COUNT + FILTER | 僅顯示後端回傳值 |
| Backfill 狀態聚合 | ✅ 從 backfill_requests 表聚合 | 僅顯示後端回傳值 |
| Outage 事件合併（5 min flap） | ✅ SQL window function 或 application-level | ❌ |
| Inverter brand 分佈計算 | ✅ SQL GROUP BY brand | 僅顯示 |
| 時間戳時區轉換 | 回傳 epoch 或 ISO 8601 with timezone | 轉為瀏覽器本地時區顯示 |
| 排序邏輯 | ✅ SQL ORDER BY | 僅接受後端排序結果 |
| 空狀態判斷 | 回傳 total counts | 根據 count 顯示空狀態 UI |

---

## 3. 數據契約

### 3.1 EP-1: GET /api/fleet/overview（KPI Strip）

**改造方向：** 現有 `get-fleet-overview.ts` 以 device 為主體，需重寫為 gateway-first。

**Response:**
```typescript
interface FleetOverviewResponse {
  success: true;
  data: {
    totalGateways: number;
    offlineGateways: number;
    onlineGateways: number;
    gatewayOnlineRate: number;       // integer 0-100, no decimal
    backfillPressure: {
      count: number;                 // GW count in not_started + in_progress + failed
      hasFailure: boolean;           // true if any GW has status='failed'
    };
    organizationCount: number;
  };
}
```

**SQL 核心（單次查詢）：**
```sql
SELECT
  COUNT(*)                                                    AS total_gateways,
  COUNT(*) FILTER (WHERE g.status = 'online')                 AS online_gateways,
  COUNT(*) FILTER (WHERE g.status != 'online'
                      OR g.status IS NULL)                    AS offline_gateways,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE g.status = 'online') / COUNT(*))
    ELSE 0
  END                                                         AS gateway_online_rate,
  COUNT(DISTINCT br.gateway_id) FILTER
    (WHERE br.status IN ('not_started','in_progress','failed'))  AS backfill_pressure_count,
  BOOL_OR(br.status = 'failed')                                  AS has_backfill_failure,
  COUNT(DISTINCT g.org_id)                                       AS organization_count
FROM gateways g
LEFT JOIN backfill_requests br
  ON br.gateway_id = g.gateway_id
  AND br.status IN ('not_started','in_progress','failed');

-- NOTE: If the current runtime schema uses 'pending' as column value,
-- treat 'pending' as the implementation mapping for REQ state 'not_started'.
-- Migration should rename 'pending' → 'not_started' to align with REQ.
```

**設計決策：**
- Gateway denominator = **DB 中存在的全部 gateway**（REQ 確認：registration 目前為受控內部動作）
- 目前系統**沒有獨立的退役 / 下線生命周期語義**；因此只要 gateway 仍存在於 DB 中，就必須計入 denominator
- 若 gateway 真正退出 Fleet，當前做法是**直接從 DB 移除**，而不是保留並做 lifecycle exclusion
- Backfill pressure 用 LEFT JOIN backfill_requests，一次查詢完成所有 KPI

### 3.2 EP-2: GET /api/fleet/integradores（Organization Table）

**改造方向：** 現有 `get-fleet-integradores.ts` 回傳 device count + device online rate，需改為 gateway-first。

**Response:**
```typescript
interface FleetIntegradoresResponse {
  success: true;
  data: {
    integradores: Array<{
      orgId: string;
      name: string;
      gatewayCount: number;
      gatewayOnlineRate: number;     // integer 0-100
      backfillPendingFailed: number; // GW count in not_started + in_progress + failed
      lastCommissioning: string | null; // ISO 8601 or null
    }>;
  };
}
```

**SQL 核心：**
```sql
SELECT
  o.org_id,
  o.name,
  COUNT(g.gateway_id)                                          AS gateway_count,
  CASE WHEN COUNT(g.gateway_id) > 0
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE g.status = 'online')
                     / COUNT(g.gateway_id))
    ELSE 0
  END                                                          AS gateway_online_rate,
  COUNT(DISTINCT br.gateway_id) FILTER
    (WHERE br.status IN ('not_started','in_progress','failed'))  AS backfill_pending_failed,
  MAX(COALESCE(g.commissioned_at, g_first_telem.first_ts))     AS last_commissioning
FROM organizations o
INNER JOIN gateways g ON g.org_id = o.org_id
LEFT JOIN backfill_requests br
  ON br.gateway_id = g.gateway_id
  AND br.status IN ('not_started','in_progress','failed')
LEFT JOIN LATERAL (
  SELECT MIN(th.recorded_at) AS first_ts
  FROM telemetry_history th
  JOIN assets a ON a.asset_id = th.asset_id
  WHERE a.gateway_id = g.gateway_id
) g_first_telem ON true
GROUP BY o.org_id, o.name
HAVING COUNT(g.gateway_id) > 0
ORDER BY gateway_online_rate ASC, gateway_count DESC;
```

**設計決策：**
- `INNER JOIN gateways` + `HAVING COUNT > 0` 確保不顯示 0-gateway 組織（REQ §Organization Table: Display scope）
- `last_commissioning` 使用 `COALESCE(commissioned_at, first_telemetry_ts)` 符合 REQ 的 fallback 規則
- 排序遵循 REQ：primary = online rate ASC, secondary = gateway count DESC
- `LATERAL` subquery 用於 first telemetry fallback，僅在 `commissioned_at` 為 NULL 時有效

### 3.3 EP-3: GET /api/fleet/offline-events（Outage Table）

**改造方向：** 現有 `get-fleet-offline-events.ts` 以 device (`asset_id`) 為單位，需改為 gateway-level outage events。

**重大變更：** 目前 `offline_events` 表以 `asset_id` 為主鍵。Gateway-level outage 需要新的數據來源。

**方案選擇：**

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A: 新表 `gateway_outage_events`** | 獨立表記錄 gateway 級別 outage | 語義清晰、查詢簡單 | 需要 DDL + 寫入邏輯 |
| **B: 從 gateways 表狀態變化推算** | 利用 `status` + `last_seen_at` 歷史推算 | 無 DDL | gateways 表只存最新狀態，無歷史 |
| **C: 從 backfill_requests 反推** | backfill = reconnect gap = outage | 無 DDL | 語義不完全等價；backfill 可能遲於 outage |

**選擇方案 A：新建 `gateway_outage_events` 表。**

理由：
- REQ 要求 outage 具備 start time、duration、backfill status 等結構化欄位
- Outage consolidation（5 分鐘 flap 合併）需要可追溯的事件記錄
- 現有 `offline_events` 是 device 粒度，不適合混用

**Response:**
```typescript
interface FleetOfflineEventsResponse {
  success: true;
  data: {
    events: Array<{
      gatewayId: string;
      gatewayName: string;
      orgName: string;
      offlineStart: string;           // ISO 8601 with timezone
      durationMinutes: number | null; // null if still offline
      backfillStatus: 'not_started' | 'in_progress' | 'completed' | 'failed' | null;
    }>;
  };
}
```

**Outage Consolidation（5 分鐘 flap 合併）邏輯：**

在 gateway watchdog 將 gateway 設為 offline 時寫入 outage event。在 heartbeat handler 將 gateway 設回 online 時：
1. 查詢該 gateway 最近的 open outage（`ended_at IS NULL`）
2. 設定 `ended_at = NOW()`
3. 下次 gateway 再次斷線時，檢查上一次 outage 的 `ended_at`：若距今 < 5 分鐘，重新打開同一事件（`ended_at = NULL`）而非建新事件

**Backfill Status 關聯：**
- 查詢時 LEFT JOIN `backfill_requests` on `gateway_id` 且 `gap_start` 與 outage `started_at` 時間窗重疊
- 取最新相關 backfill_request 的 status

### 3.4 EP-4: GET /api/fleet/charts（圖表數據）

**新增端點，** 將兩張圖表的數據合併為單一請求。

**Response:**
```typescript
interface FleetChartsResponse {
  success: true;
  data: {
    gatewayStatus: {
      online: number;
      offline: number;
    };
    inverterBrandDistribution: Array<{
      brand: string;
      deviceCount: number;
    }>;
  };
}
```

**SQL — Gateway Status：**
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'online')                AS online,
  COUNT(*) FILTER (WHERE status != 'online' OR status IS NULL) AS offline
FROM gateways;
```

**SQL — Inverter Brand Distribution：**
```sql
SELECT
  COALESCE(a.brand, 'Unknown') AS brand,
  COUNT(*)                     AS device_count
FROM assets a
JOIN gateways g ON g.gateway_id = a.gateway_id
WHERE a.asset_type = 'INVERTER_BATTERY'
  AND a.is_active = true
GROUP BY a.brand
ORDER BY device_count DESC;
```

**設計決策：**
- REQ 明確要求 inverter brand distribution 按 **device count** 計算，不使用 gateway-majority 或 capacity-weighted 邏輯
- Gateway status chart 僅顯示 online/offline 兩類（REQ §Charts: 2 categories only），不包含 backfill 狀態
- 兩張圖表合併為一個 endpoint 減少前端請求數

---

## 4. Online/Offline 與 Backfill 共存設計

### 4.1 兩個獨立維度

```
           ┌──────────────────┐
           │   Connectivity   │  ← heartbeat within 15 min?
           │   online/offline │
           └──────────────────┘
                    ↕ 獨立
           ┌──────────────────┐
           │ Data Completeness│  ← telemetry gap > 5 min?
           │   backfill state │
           └──────────────────┘
```

**合法組合矩陣：**

| Gateway Status | Backfill State | 場景 | 頁面呈現 |
|---------------|---------------|------|---------|
| online | null (no gap) | 正常運行 | KPI: online; Backfill: 不計入 |
| online | not_started | 剛重連，gap 偵測中 | KPI: online; Backfill: 計入 pressure |
| online | in_progress | 重連後正在回填 | KPI: online; Backfill: 計入 pressure |
| online | completed | 回填完成 | KPI: online; Backfill: 不計入 |
| online | failed | 回填失敗（數據無法恢復） | KPI: online; Backfill: 計入 pressure + risk color |
| offline | not_started | 斷線中，尚未觸發回填 | KPI: offline; Backfill: 不計入（斷線中無法回填） |
| offline | in_progress | 回填中途又斷線 | KPI: offline; Backfill: 計入 pressure |
| offline | failed | 之前回填失敗 | KPI: offline; Backfill: 計入 pressure + risk color |

**關鍵規則：**
- Gateway status chart 只反映 connectivity（online/offline），**不混入 backfill 狀態**（REQ §Charts: Explicit exclusion）
- Backfill KPI card 反映 **當前未完成的回填壓力**：`not_started + in_progress + failed`
- 同一 gateway 可能有多筆 backfill_requests（不同時段的 gap），KPI 按 gateway 去重計算

### 4.2 Heartbeat Threshold 調整

**現狀：** `gateway-connection-manager.ts` watchdog 使用 10 分鐘（600,000 ms）threshold。
**REQ 要求：** 15 分鐘。

**變更：** 修改 `HEARTBEAT_TIMEOUT_MS` 從 `600_000` → `900_000`（15 min）。

**影響分析：**
- 降低 false-positive offline 判定（gateway 短暫網路波動不會立即標記 offline）
- 與 backfill trigger 完全分離：backfill 偵測依據 REQ 定義為 Gateway primary telemetry stream 的數據間隙 > 5 min（見 §4.3），不受 watchdog timeout 影響

### 4.3 Backfill Trigger — Telemetry Gap Detection

**REQ 定義：** A Gateway enters backfill-needed territory when the platform detects a **Gateway data gap > 5 minutes** on the **Gateway primary telemetry stream**.

**語義區分（重要）：**
- **Online/offline** 由 heartbeat 驅動（§4.2，15 min threshold）
- **Backfill trigger** 由 Gateway 主要遙測流的數據間隙驅動（5 min threshold）
- 這是兩個不同的偵測路徑，不可混為一談

**正式實作（v6.1 phase 1）：**
Backfill trigger 直接落在 `backend/src/iot-hub/handlers/telemetry-handler.ts`。

在處理 Gateway primary telemetry stream 時：
1. 取得該 Gateway 上一筆 primary telemetry timestamp
2. 比較 `current_ts - previous_ts`
3. 若間隙 `> 300_000 ms`（5 分鐘），INSERT `backfill_requests`
   - `gap_start = previous_ts`
   - `gap_end = current_ts`
   - `status = 'not_started'`
4. 更新該 Gateway 的最近 primary telemetry timestamp

**實作要求：**
- 這不是 heartbeat reconnect 的代理方案，而是 v6.1 phase 1 的正式 trigger 路徑
- `heartbeat-handler.ts` 只負責 connectivity recovery（將 gateway 設回 online）與 outage close，不再承擔 backfill trigger 語義
- 若現有 runtime 仍有 heartbeat-based backfill 觸發邏輯，v6.1 phase 1 施工時應移除或停用，避免與 telemetry-gap trigger 重複觸發

---

## 5. DDL 變更

### 5.1 新表：gateway_outage_events

```sql
-- Migration: 008_gateway_outage_events.sql

CREATE TABLE IF NOT EXISTS gateway_outage_events (
  id            BIGSERIAL PRIMARY KEY,
  gateway_id    VARCHAR(50) NOT NULL REFERENCES gateways(gateway_id),
  org_id        VARCHAR(50) NOT NULL REFERENCES organizations(org_id),
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,              -- NULL = still offline
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goe_gateway_started
  ON gateway_outage_events (gateway_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_goe_org_started
  ON gateway_outage_events (org_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_goe_open
  ON gateway_outage_events (gateway_id)
  WHERE ended_at IS NULL;

COMMENT ON TABLE gateway_outage_events
  IS 'Gateway-level outage events for Fleet v6.1. Consolidates flaps < 5 min into single event.';
```

**設計決策：**
- 不在此表存 `cause` 欄位（REQ §Offline Events: Explicit exclusion — v6.1 phase 1 不顯示 Cause）
- 不在此表存 `backfill_status`，改為查詢時 JOIN `backfill_requests`（避免數據冗餘，backfill 狀態會異步變化）
- `org_id` 冗餘存儲（可從 gateways JOIN 獲得），但利於 RLS policy 和直接查詢效能

### 5.2 現有表不動

| 表 | 動作 | 說明 |
|---|------|------|
| `gateways` | **不動** | status, last_seen_at 欄位已存在 |
| `backfill_requests` | **不動** | 4-state model 已符合 REQ |
| `offline_events` | **不動** | device-level，繼續服務其他用途 |
| `organizations` | **不動** | org_id, name 已足夠 |
| `assets` | **不動** | brand 欄位已存在，用於 inverter brand chart |

---

## 6. 時間戳處理策略

### 6.1 規則總結（源自 REQ §Timestamp Handling）

| 層級 | 規則 | 實作 |
|------|------|------|
| **Gateway → Backend** | 設備報告的 timestamp 為 canonical machine timestamp | `heartbeat-handler` 已使用 `payload.timeStamp`（epoch ms）直接存入 `last_seen_at` |
| **Backend ingestion** | 不做額外時區轉換 | ✅ 現有行為正確，`last_seen_at` 存為 TIMESTAMPTZ |
| **Backend → API** | 回傳 epoch 或 ISO 8601 with timezone | 所有 timestamp 欄位回傳 `Date.toISOString()` |
| **API → Frontend** | 前端顯示為瀏覽器本地時區 | 前端使用 `new Date(isoString).toLocaleString()` |

### 6.2 需注意的欄位

| 欄位 | 來源 | 格式 | 說明 |
|------|------|------|------|
| `gateways.last_seen_at` | Gateway device clock | TIMESTAMPTZ（epoch from device） | Heartbeat handler 已正確處理 |
| `gateways.commissioned_at` | 業務操作時間 | TIMESTAMPTZ | 用於 Last Commissioning |
| `gateway_outage_events.started_at` | Server `NOW()` at watchdog detection | TIMESTAMPTZ | 偵測時間 ≠ 實際斷線時間（最多延遲 60s） |
| `gateway_outage_events.ended_at` | Server `NOW()` at heartbeat recovery | TIMESTAMPTZ | |
| `backfill_requests.gap_start/gap_end` | Calculated from device timestamps | TIMESTAMPTZ | |

### 6.3 API 回傳格式

統一使用 ISO 8601 with timezone offset：
```
"offlineStart": "2026-03-17T14:30:00.000+08:00"
```

前端不得接收 naive datetime string（如 `"2026-03-17 14:30:00"`）。

---

## 7. 現有 Handler 改造矩陣

| Handler 文件 | 現狀 | v6.1 動作 | 變更幅度 |
|-------------|------|---------|---------|
| `get-fleet-overview.ts` | device-first KPI | **重寫** → gateway-first，加 backfill pressure | 高 |
| `get-fleet-integradores.ts` | device count + device online rate | **重寫** → gateway count + GW online rate + backfill + last commissioning | 高 |
| `get-fleet-offline-events.ts` | device-level offline_events | **重寫** → gateway_outage_events + backfill JOIN | 高 |
| `get-fleet-uptime-trend.ts` | daily_uptime_snapshots (device-based) | **不動** — REQ v6.1 不包含 uptime trend chart | 無 |
| `get-gateways.ts` | gateway list | **不動** — REQ 不在 Fleet 頁面顯示 gateway list | 無 |
| `get-gateways-summary.ts` | cross-gateway daily metrics | **不動** — 非 Fleet 頁面需求 | 無 |

**新增 Handler：**

| Handler | 端點 | 用途 |
|---------|------|------|
| `get-fleet-charts.ts` | `GET /api/fleet/charts` | Gateway status dist. + Inverter brand dist. |

### 路由註冊

以下端點需在 `bff-stack.ts` 中註冊：

```typescript
// Fleet v6.1 routes
this.addRoute(httpApi, "GET", "/api/fleet/overview",       getFleetOverview);
this.addRoute(httpApi, "GET", "/api/fleet/integradores",   getFleetIntegradores);
this.addRoute(httpApi, "GET", "/api/fleet/offline-events", getFleetOfflineEvents);
this.addRoute(httpApi, "GET", "/api/fleet/charts",         getFleetCharts);
```

---

## 8. IoT Hub 改動

### 8.1 gateway-connection-manager.ts

| 項目 | 現值 | 新值 | 說明 |
|------|------|------|------|
| `HEARTBEAT_TIMEOUT_MS` | 600,000 (10 min) | 900,000 (15 min) | REQ 要求 15 分鐘 heartbeat threshold |

**Watchdog 邏輯增強：** 在將 gateway 設為 offline 時，同時寫入 `gateway_outage_events`：

```typescript
// 現有：UPDATE gateways SET status = 'offline' WHERE ...
// 新增：INSERT gateway_outage_events
//   先查是否有最近 5 分鐘內結束的 outage（flap consolidation）
//   有 → UPDATE ended_at = NULL（重新打開）
//   無 → INSERT 新 outage event
```

### 8.2 heartbeat-handler.ts

**Recovery 邏輯增強：** 在 heartbeat 將 gateway 設回 online 時，關閉對應 outage event：

```typescript
// 在 handleHeartbeat 中，status 從 non-online 變為 online 後：
// UPDATE gateway_outage_events SET ended_at = NOW()
// WHERE gateway_id = $1 AND ended_at IS NULL
```

**職責邊界：**
- `heartbeat-handler.ts` 只負責 connectivity recovery
- 不負責 backfill trigger
- 不應再以 `RECONNECT_THRESHOLD_MS` 近似遙測間隙來建立 backfill_requests

### 8.3 telemetry-handler.ts（正式 backfill trigger 路徑）

**正式設計：** 在 `backend/src/iot-hub/handlers/telemetry-handler.ts` 中增加 Gateway-level 數據間隙偵測：

```typescript
// 在處理 Gateway primary telemetry stream 時：
// 1. 取得該 Gateway 上一筆 primary telemetry timestamp（可由快取或 DB 取得）
// 2. 若 current_ts - previous_ts > 5 min（300_000 ms）：
//    INSERT backfill_requests (gateway_id, gap_start = previous_ts, gap_end = current_ts, status = 'not_started')
// 3. 更新該 Gateway 的 recent primary telemetry timestamp
```

**v6.1 phase 1 要求：**
- 這是本版的正式實作，不延期到後續版本
- 若現有 heartbeat-handler 仍保留 backfill trigger 邏輯，需在 v6.1 phase 1 中移除或停用，確保系統只存在一條 backfill trigger 真相路徑

---

## 9. 前端設計要點

### 9.1 頁面為唯讀儀表板

REQ 明確定義 v6.1 phase 1 為 **read-only dashboard**：
- 無圖表/表格點擊 drill-down
- 無 gateway list 展開
- 無 top-issues 列表
- 無任何寫入操作

### 9.2 KPI Strip 視覺語義

| KPI Card | 值 | 顏色規則 |
|----------|---|---------|
| Total Gateways | 數字 | 中性 |
| Offline Gateways | 數字 | **risk color** (紅/橙) |
| Online Gateways | 數字 | **healthy color** (綠) |
| Gateway Online Rate | `XX%`（整數） | 中性 |
| Backfill Pending/Failed | 數字 | **warning** (僅 not_started/in_progress)；**risk** (有 failed) |
| Organizations | 數字 | 中性 |

### 9.3 圖表

- **左圖（Gateway Status Distribution）：** Donut/Pie chart，2 segments: online (healthy color), offline (risk color)
- **右圖（Inverter Brand Distribution）：** Donut/Pie or bar chart，N segments per brand

### 9.4 空狀態處理

| 場景 | 呈現 |
|------|------|
| 0 gateways registered | 所有 KPI 顯示 0，圖表顯示空狀態佔位 |
| All gateways online | Offline KPI = 0（顯示 0，不隱藏） |
| No backfill events | Backfill KPI = 0（中性色，不顯示 warning） |
| No outage in 7 days | Outage table 顯示 "No outage events in the last 7 days" |
| No inverter assets | Right chart 顯示空狀態佔位 |
| Org with 0 gateways | **不顯示在 Organization table**（REQ 明確排除） |

### 9.5 前端 API 調用策略

頁面載入時並行發起：
1. `GET /api/fleet/overview` → KPI strip
2. `GET /api/fleet/charts` → 兩張圖表
3. `GET /api/fleet/integradores` → Organization table
4. `GET /api/fleet/offline-events?limit=50` → Outage table

無自動刷新（v6.1 phase 1），用戶手動刷新頁面獲取最新數據。

---

## 10. 邊界情況

| 場景 | 處理 | 說明 |
|------|------|------|
| Gateway 快速 flap (斷線 < 5 min 又上線) | 合併為同一 outage event | REQ §Outage Consolidation Rule |
| Gateway 多次 flap | 每次 recovery < 5 min 持續合併同一 outage | 直到 recovery > 5 min 才算獨立事件 |
| Backfill request 跨越多個 outage | 按 gateway_id + 時間窗匹配最相關的 outage | JOIN 條件：gap_start BETWEEN started_at AND COALESCE(ended_at, NOW()) |
| Gateway commissioned_at 為 NULL | Fallback to first telemetry timestamp | REQ §Last Commissioning source rule |
| 首次 telemetry 也不存在 | Last Commissioning 顯示 null / "—" | 極端 edge case：gateway 已註冊但從未上線 |
| Gateway 已從 Fleet 退出 | 直接自 DB 移除，因此不再被任何 KPI 或表格統計 | 當前系統不使用獨立 decommissioned lifecycle |
| Brand 欄位為 NULL 或空字串 | 歸類為 "Unknown" | `COALESCE(brand, 'Unknown')` |
| 同一 gateway 多筆 not_started backfill | KPI 按 gateway 去重（COUNT DISTINCT） | 不重複計算同一 gateway |

---

## 11. 明確非目標（v6.1 Phase 1）

以下項目 **不在本設計範圍內**，引自 REQ：

1. Device-level outage stream on Fleet homepage
2. Device-level backfill state on Fleet homepage
3. Capacity-weighted brand distribution
4. Delta/trend-heavy KPI styling（online rate 不顯示趨勢）
5. Interactive drill-down dashboard behavior
6. Full gateway registry table on Fleet page
7. Uptime trend chart（daily_uptime_snapshots 不用於 v6.1 Fleet）
8. Auto-refresh / real-time push
9. Backfill retry mechanism
10. Cause column in outage table

---

## 12. 模塊影響矩陣

| 模塊 | 文件路徑 | 動作 | 風險 | 說明 |
|------|----------|------|------|------|
| **DB — gateway_outage_events** | `db-init/02_schema.sql` | **新增** | 低 | 新表 + 索引 |
| **IoT — gateway-connection-manager** | `backend/src/iot-hub/services/gateway-connection-manager.ts` | **改** | 中 | 15 min threshold + outage event 寫入 |
| **IoT — heartbeat-handler** | `backend/src/iot-hub/handlers/heartbeat-handler.ts` | **改** | 中 | outage close on reconnect + connectivity recovery |
| **IoT — telemetry-handler** | `backend/src/iot-hub/handlers/telemetry-handler.ts` | **改** | 高 | primary telemetry gap > 5 min → backfill trigger |
| **BFF — get-fleet-overview** | `backend/src/bff/handlers/get-fleet-overview.ts` | **重寫** | 高 | gateway-first KPI |
| **BFF — get-fleet-integradores** | `backend/src/bff/handlers/get-fleet-integradores.ts` | **重寫** | 高 | gateway-first org table |
| **BFF — get-fleet-offline-events** | `backend/src/bff/handlers/get-fleet-offline-events.ts` | **重寫** | 高 | gateway outage events |
| **BFF — get-fleet-charts** | `backend/src/bff/handlers/get-fleet-charts.ts` | **新增** | 低 | 兩張圖表數據 |
| **BFF — bff-stack.ts** | `backend/lib/bff-stack.ts` | **改** | 低 | 註冊 4 條 Fleet routes |
| **Frontend — fleet page** | `frontend-v2/js/p5-fleet.js`（新建或重寫） | **新增/重寫** | 高 | 完整 Fleet dashboard UI |
| **Frontend — data-source.js** | `frontend-v2/js/data-source.js` | **改** | 低 | 新增 fleet API 方法 |

### 風險等級定義

| 等級 | 定義 |
|------|------|
| 高 | 核心語義轉換（device→gateway），錯誤會導致 KPI 語義不正確 |
| 中 | 修改現有 IoT pipeline threshold，影響 offline 判定和 backfill 觸發 |
| 低 | 增量式新增，不影響現有行為 |
