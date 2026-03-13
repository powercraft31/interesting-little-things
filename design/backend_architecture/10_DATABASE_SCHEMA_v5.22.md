# Database Schema — Gateways Merge, Backfill Requests & Telemetry Uniqueness

> **Version**: v5.22
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-13
> **Description**: gateways 吸收 homes 欄位、backfill_requests 新資料表、telemetry_history UNIQUE INDEX、device_command_logs 擴充
> **Core Theme**: 閘道器為中心的資料模型整合 + 遙測回補（backfill）基礎設施

---

## 1. Version History

| Version | Date | Description |
|---------|------|-------------|
| v5.16 | 2026-03-07 | Peak Shaving — DO telemetry, demand charge rate, PS savings, MonthlyTrueUp |
| v5.18 | 2026-03-09 | +gateways table (MQTT config, status, indexes, RLS), +device_command_logs table (config get/set tracking), assets +gateway_id, telemetry_history +11 columns (telemetry_extra, flload_power, etc.) |
| v5.18-hotfix | 2026-03-09 | gateways +ems_health JSONB +ems_health_at TIMESTAMPTZ |
| v5.19 | 2026-03-10 | homes→gateways merge (homes DROPPED, gateways 吸收 name/address/contracted_demand_kw, gateway_id→SN, DROP client_id/home_id, RLS rls_gateways_tenant) |
| v5.20 | 2026-03-11 | permissions fix (GRANT solfacil_app/solfacil_service), device_command_logs +dispatched_at +acked_at, idx_dcl_pending_dispatch |
| v5.21 | 2026-03-11 | idx_dcl_dispatched_set index (created_at WHERE result='dispatched' AND command_type='set') |
| v5.22-phase1 | 2026-03-12 | idx_dcl_accepted_set index (created_at WHERE result='accepted' AND command_type='set') |
| v5.22-phase2 | 2026-03-12 | CREATE backfill_requests + idx_backfill_active + GRANTs |
| **v5.22-phase3** | **2026-03-13** | **UNIQUE INDEX idx_telemetry_unique_asset_time on telemetry_history** |

---

## 2. Migration DDL

### 2.1 `migration_v5.18.sql` — 閘道器與裝置命令基礎表

```sql
-- ============================================================
-- migration_v5.18.sql — M1 IoT Hub: gateways, device_command_logs,
--                        assets.gateway_id, telemetry_history extensions
-- Date: 2026-03-09
-- Depends on: ddl_base.sql (v5.10), migration_v5.16.sql
-- ============================================================

-- 1. NEW TABLE: gateways (gateway registry for MQTT connections)

CREATE TABLE IF NOT EXISTS gateways (
  gateway_id        VARCHAR(50)  PRIMARY KEY,
  client_id         VARCHAR(100) NOT NULL UNIQUE,  -- MQTT clientId = device serial
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  home_id           VARCHAR(50)  REFERENCES homes(home_id),
  mqtt_broker_host  VARCHAR(255) NOT NULL DEFAULT '18.141.63.142',
  mqtt_broker_port  INTEGER      NOT NULL DEFAULT 1883,
  mqtt_username     VARCHAR(100) NOT NULL DEFAULT 'xuheng',
  mqtt_password     VARCHAR(255) NOT NULL DEFAULT 'xuheng8888!',
  device_name       VARCHAR(100) DEFAULT 'EMS_N2',
  product_key       VARCHAR(50)  DEFAULT 'ems',
  status            VARCHAR(20)  NOT NULL DEFAULT 'online'
                      CHECK (status IN ('online', 'offline', 'decommissioned')),
  last_seen_at      TIMESTAMPTZ,
  commissioned_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_home ON gateways(home_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY rls_gateways_tenant ON gateways
    USING (org_id = current_setting('app.current_org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. NEW TABLE: device_command_logs (config get/set tracking)

CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(50)  NOT NULL REFERENCES gateways(gateway_id),
  client_id         VARCHAR(100) NOT NULL,
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),       -- 'success' | 'fail' | 'pending' | 'timeout'
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,       -- parsed from payload.timeStamp
  resolved_at       TIMESTAMPTZ,       -- when reply received
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmd_logs_gateway ON device_command_logs(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_message ON device_command_logs(gateway_id, message_id);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_pending ON device_command_logs(result) WHERE result = 'pending';

-- 3. assets: add gateway_id FK

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(50) REFERENCES gateways(gateway_id);

CREATE INDEX IF NOT EXISTS idx_assets_gateway ON assets(gateway_id);

-- 4. telemetry_history: add columns for full protocol support

ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS telemetry_extra JSONB;
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_soh DECIMAL(5,2);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_voltage DECIMAL(6,2);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_current DECIMAL(8,3);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS battery_temperature DECIMAL(5,2);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS flload_power DECIMAL(8,3);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS inverter_temp DECIMAL(5,2);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS pv_daily_energy_kwh DECIMAL(10,3);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_charge_current DECIMAL(8,3);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_discharge_current DECIMAL(8,3);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS daily_charge_kwh DECIMAL(10,3);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS daily_discharge_kwh DECIMAL(10,3);
```

### 2.2 `migration_v5.18_hotfix.sql` — ems_health JSONB + ems_health_at

```sql
-- ============================================================
-- migration_v5.18_hotfix.sql — Add ems_health JSONB to gateways
-- Date: 2026-03-09
-- Depends on: migration_v5.18.sql
-- ============================================================

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health JSONB;

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health_at TIMESTAMPTZ;

COMMENT ON COLUMN gateways.ems_health IS
  'Latest emsList payload from MSG#1 (firmware version, WiFi signal, uptime, errors). Written by FragmentAssembler.';
COMMENT ON COLUMN gateways.ems_health_at IS
  'Device-side timestamp of the last emsList message (from payload.timeStamp, NOT server clock).';
```

### 2.3 `migration_v5.19.sql` — homes→gateways 合併

```sql
-- ============================================================
-- SOLFACIL VPP — Migration v5.19
-- Schema consolidation: homes → gateways, gateway_id → SN
-- Date: 2026-03-10
-- Depends on: migration_v5.18_hotfix.sql
-- ============================================================

BEGIN;

-- PHASE 1: 擴展 gateways 表（新增 homes 欄位）

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS contracted_demand_kw REAL;

-- v5.18 新增: ems_health JSONB + timestamp（若 hotfix 未 apply）
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health JSONB DEFAULT '{}';
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS ems_health_at TIMESTAMPTZ;

-- PHASE 2: 從 homes 表遷移數據到 gateways

UPDATE gateways g
SET name = h.name, address = h.address, contracted_demand_kw = h.contracted_demand_kw
FROM homes h WHERE g.home_id = h.home_id;

UPDATE assets a SET gateway_id = g.gateway_id
FROM gateways g WHERE a.home_id = g.home_id AND a.gateway_id IS NULL AND a.home_id IS NOT NULL;

-- PHASE 3: gateway_id PK 值 → SN（解除 FK → 改值 → 重建 FK）

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_gateway_id_fkey;
ALTER TABLE device_command_logs DROP CONSTRAINT IF EXISTS device_command_logs_gateway_id_fkey;

-- 3b-3d: 更新 gateways / assets / device_command_logs 中的 gateway_id 值
-- (GW-SF-001 → WKRD24070202100144F, GW-SF-002 → WKRD24070202100228G, etc.)

-- 3e: 更新 device_command_logs.client_id（SN 就是 client_id）
UPDATE device_command_logs SET client_id = gateway_id;

-- 3f: 重建 FK 約束
ALTER TABLE assets
  ADD CONSTRAINT assets_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES gateways(gateway_id);
ALTER TABLE device_command_logs
  ADD CONSTRAINT device_command_logs_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES gateways(gateway_id);

-- PHASE 4: 刪除冗餘欄位

ALTER TABLE gateways DROP COLUMN IF EXISTS client_id;
ALTER TABLE gateways DROP CONSTRAINT IF EXISTS gateways_home_id_fkey;
ALTER TABLE gateways DROP COLUMN IF EXISTS home_id;
DROP INDEX IF EXISTS idx_gateways_home;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_home_id_fkey;
ALTER TABLE assets DROP COLUMN IF EXISTS home_id;
DROP INDEX IF EXISTS idx_assets_home;
ALTER TABLE device_command_logs DROP COLUMN IF EXISTS client_id;

-- PHASE 5: 刪除 homes 表

DROP POLICY IF EXISTS rls_homes_tenant ON homes;
DROP INDEX IF EXISTS idx_homes_org;
DROP TABLE IF EXISTS homes;

-- PHASE 6: RLS for gateways

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'gateways' AND policyname = 'rls_gateways_tenant'
  ) THEN
    EXECUTE 'CREATE POLICY rls_gateways_tenant ON gateways USING (org_id = current_setting(''app.current_org_id'', true))';
  END IF;
END $$;
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;

-- PHASE 7: 更新 gateways name 為含客戶名的格式

COMMIT;
```

### 2.4 `migration_v5.20.sql` — 權限修正 + device_command_logs 擴充

```sql
-- ============================================================
-- SOLFACIL VPP — Migration v5.20
-- Permissions fix + schema updates
-- Date: 2026-03-11
-- Depends on: migration_v5.19.sql
-- ============================================================

BEGIN;

-- PHASE 1: Permission GRANTs missing from v5.19

GRANT SELECT, INSERT, UPDATE ON gateways TO solfacil_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateways TO solfacil_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_command_logs TO solfacil_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_command_logs TO solfacil_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solfacil_service;

-- PHASE 2: device_command_logs schema updates for M3

ALTER TABLE device_command_logs
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acked_at      TIMESTAMPTZ;

-- Index for M3 polling query
CREATE INDEX IF NOT EXISTS idx_dcl_pending_dispatch
  ON device_command_logs (status, created_at)
  WHERE status = 'pending_dispatch';

COMMIT;
```

### 2.5 `migration_v5.21.sql` — 已派送命令索引

```sql
-- v5.21: Index for CommandPublisher polling (dispatched + set commands)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dcl_dispatched_set
  ON device_command_logs (created_at ASC)
  WHERE result = 'dispatched' AND command_type = 'set';
```

### 2.6 `migration_v5.22_phase1.sql` — 已接受命令索引

```sql
-- v5.22 Phase 1: Two-phase set_reply support
-- Index for accepted set commands (timeout check + reply matching)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dcl_accepted_set
  ON device_command_logs (created_at ASC)
  WHERE result = 'accepted' AND command_type = 'set';
```

### 2.7 `migration_v5.22_phase2.sql` — backfill_requests 資料表

```sql
-- v5.22 Phase 2: Backfill request queue
CREATE TABLE IF NOT EXISTS backfill_requests (
  id                  BIGSERIAL PRIMARY KEY,
  gateway_id          VARCHAR NOT NULL REFERENCES gateways(gateway_id),
  gap_start           TIMESTAMPTZ NOT NULL,
  gap_end             TIMESTAMPTZ NOT NULL,
  current_chunk_start TIMESTAMPTZ,
  last_chunk_sent_at  TIMESTAMPTZ,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  CONSTRAINT chk_backfill_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
);

CREATE INDEX idx_backfill_active
  ON backfill_requests (created_at ASC)
  WHERE status IN ('pending', 'in_progress');

-- Grant permissions (same pattern as device_command_logs)
GRANT SELECT, INSERT, UPDATE ON backfill_requests TO solfacil_service;
GRANT USAGE ON SEQUENCE backfill_requests_id_seq TO solfacil_service;
```

### 2.8 `migration_v5.22_phase3.sql` — 遙測唯一性索引

```sql
-- v5.22 Phase 3: Unique index for backfill dedup
-- MUST use CONCURRENTLY to avoid locking the partitioned telemetry table
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_unique_asset_time
  ON telemetry_history (asset_id, recorded_at);
```

---

## 3. `ddl_base.sql` Changes

### 3.1 `gateways` — 完整 CREATE TABLE（v5.19 合併後）

```sql
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id              VARCHAR(50) PRIMARY KEY,          -- v5.19: 改為裝置序號 SN
  org_id                  VARCHAR(50) NOT NULL REFERENCES organizations(org_id),
  mqtt_broker_host        VARCHAR(255) NOT NULL DEFAULT '18.141.63.142',
  mqtt_broker_port        INTEGER NOT NULL DEFAULT 1883,
  mqtt_username           VARCHAR(100) NOT NULL DEFAULT 'xuheng',
  mqtt_password           VARCHAR(255) NOT NULL DEFAULT 'xuheng8888!',
  device_name             VARCHAR(100) DEFAULT 'EMS_N2',
  product_key             VARCHAR(50) DEFAULT 'ems',
  status                  VARCHAR(20) NOT NULL DEFAULT 'online'
                            CHECK (status IN ('online', 'offline', 'decommissioned')),
  last_seen_at            TIMESTAMPTZ,
  commissioned_at         TIMESTAMPTZ DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name                    VARCHAR(200),                     -- v5.19: 原 homes.name
  address                 TEXT,                             -- v5.19: 原 homes.address
  contracted_demand_kw    REAL,                             -- v5.19: 原 homes.contracted_demand_kw
  ems_health              JSONB DEFAULT '{}',               -- v5.18-hotfix: EMS 健康狀態
  ems_health_at           TIMESTAMPTZ                       -- v5.18-hotfix: 裝置側時間戳
);

-- v5.19 PHASE 4 已移除：client_id (= gateway_id)、home_id

CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_gateways_tenant ON gateways
  USING (org_id = current_setting('app.current_org_id', true));
```

### 3.2 `device_command_logs` — 完整 CREATE TABLE（v5.20 擴充後）

```sql
CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(50)  NOT NULL REFERENCES gateways(gateway_id),
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),                            -- 'success' | 'fail' | 'pending' | 'timeout'
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,                            -- parsed from payload.timeStamp
  resolved_at       TIMESTAMPTZ,                            -- when reply received
  dispatched_at     TIMESTAMPTZ,                            -- v5.20: 派送時間
  acked_at          TIMESTAMPTZ,                            -- v5.20: 確認時間
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- v5.19 PHASE 4 已移除：client_id (= gateway_id)
```

### 3.3 `backfill_requests` — 完整 CREATE TABLE（v5.22 新增）

```sql
CREATE TABLE IF NOT EXISTS backfill_requests (
  id                  BIGSERIAL PRIMARY KEY,
  gateway_id          VARCHAR NOT NULL REFERENCES gateways(gateway_id),
  gap_start           TIMESTAMPTZ NOT NULL,
  gap_end             TIMESTAMPTZ NOT NULL,
  current_chunk_start TIMESTAMPTZ,
  last_chunk_sent_at  TIMESTAMPTZ,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  CONSTRAINT chk_backfill_status CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
);
```

### 3.4 `assets` — gateway_id 外鍵新增

```sql
-- 在 assets CREATE TABLE 中新增：
    gateway_id    VARCHAR(50) REFERENCES gateways(gateway_id),  -- v5.18: 所屬閘道器

-- v5.19 PHASE 4 已移除：home_id (改用 gateway_id)
-- 索引：
CREATE INDEX IF NOT EXISTS idx_assets_gateway ON assets(gateway_id);
```

### 3.5 `homes` — DROPPED (v5.19)

```sql
-- homes table 已於 v5.19 移除。
-- 所有欄位（name, address, contracted_demand_kw）已併入 gateways。
```

---

## 4. Table Count

| Category | v5.16 Count | v5.18 Delta | v5.19 Delta | v5.22 Delta | v5.22 Count |
|----------|------------|-------------|-------------|-------------|-------------|
| M6 Identity | 3 | — | — | — | 3 |
| M1 IoT Hub | 7 | +2 (gateways, device_command_logs) | — | +1 (backfill_requests) | 10 |
| M2 Optimization | 2 | — | — | — | 2 |
| M3 DR Dispatcher | 2 | — | — | — | 2 |
| M4 Market & Billing | 5 | — | — | — | 5 |
| M8 Admin Control | 4 | — | — | — | 4 |
| Housing (v5.12) | 1 | — | -1 (homes DROPPED) | — | 0 |
| Shared Contract | 1 | — | — | — | 1 |
| **Total** | **25** | **+2** | **-1** | **+1** | **26** |

### 完整資料表清單（26 張，按字母排序）

| # | Table | Version Added | Notes |
|---|-------|--------------|-------|
| 1 | algorithm_metrics | v5.4 | |
| 2 | asset_5min_metrics | v5.15 | PARTITION BY RANGE (daily) |
| 3 | asset_hourly_metrics | v5.4 | |
| 4 | assets | v5.4 | v5.18: +gateway_id |
| 5 | **backfill_requests** | **v5.22** | **NEW — 遙測回補請求** |
| 6 | daily_uptime_snapshots | v5.4 | |
| 7 | data_dictionary | v5.4 | |
| 8 | device_command_logs | v5.18 | v5.20: +dispatched_at, +acked_at |
| 9 | device_state | v5.4 | |
| 10 | dispatch_commands | v5.4 | |
| 11 | dispatch_records | v5.4 | v5.15: +target_mode |
| 12 | feature_flags | v5.4 | |
| 13 | **gateways** | **v5.18** | **v5.19: 吸收 homes 欄位 (name, address, contracted_demand_kw)** |
| 14 | offline_events | v5.4 | |
| 15 | organizations | v5.4 | |
| 16 | parser_rules | v5.4 | |
| 17 | pld_horario | v5.7 | |
| 18 | revenue_daily | v5.4 | v5.15: +sc/tou; v5.16: +ps/true-up |
| 19 | tariff_schedules | v5.4 | v5.16: +demand_charge_rate_per_kva, +billing_power_factor |
| 20 | telemetry_history | v5.4 | PARTITION BY RANGE; v5.16: +do0/do1; v5.18: +telemetry_extra, +flload_power, +11 cols; v5.22: UNIQUE INDEX |
| 21 | trade_schedules | v5.4 | v5.16: +target_mode |
| 22 | trades | v5.4 | |
| 23 | user_org_roles | v5.4 | |
| 24 | users | v5.4 | |
| 25 | vpp_strategies | v5.4 | |
| 26 | weather_cache | v5.4 | |

> **Note:** `homes` table 已於 v5.19 移除（DROPPED），其欄位併入 `gateways`。

---

## 5. Index Analysis

### 5.1 新增索引一覽（v5.16 → v5.22）

| Index | Table | Columns | Type | Version | 用途 |
|-------|-------|---------|------|---------|------|
| `idx_dcl_pending_dispatch` | device_command_logs | (status, created_at) WHERE status='pending_dispatch' | Partial B-tree | v5.20 | 快速查詢待派送命令 |
| `idx_dcl_dispatched_set` | device_command_logs | (created_at ASC) WHERE result='dispatched' AND command_type='set' | Partial B-tree | v5.21 | CommandPublisher polling（已派送的 set 命令） |
| `idx_dcl_accepted_set` | device_command_logs | (created_at ASC) WHERE result='accepted' AND command_type='set' | Partial B-tree | v5.22 | Two-phase set_reply（逾時檢查 + 回覆匹配） |
| `idx_backfill_active` | backfill_requests | (created_at ASC) WHERE status IN ('pending','in_progress') | Partial B-tree | v5.22 | 快速查詢活躍回補請求 |
| `idx_telemetry_unique_asset_time` | telemetry_history | (asset_id, recorded_at) | UNIQUE B-tree | v5.22 | 遙測去重 + 回補 UPSERT 支援 |

### 5.2 device_command_logs 索引策略

三個 partial index 分別覆蓋命令生命週期的不同階段：

```
pending_dispatch → dispatched (set) → accepted (set)
       │                  │                  │
  idx_dcl_           idx_dcl_          idx_dcl_
  pending_           dispatched_       accepted_
  dispatch           set               set
  (status col)       (result+type)     (result+type)
```

- **Partial index 優勢**：每個索引只包含對應狀態的列，大幅減少索引大小
- **查詢模式**：`idx_dcl_pending_dispatch` 篩選 `status` 欄位；`idx_dcl_dispatched_set` 和 `idx_dcl_accepted_set` 篩選 `result` + `command_type` 欄位
- **寫入影響**：狀態/結果變更時舊索引自動移除、新索引自動新增（PostgreSQL 自動處理）
- **CONCURRENTLY**：v5.21 和 v5.22 索引使用 `CREATE INDEX CONCURRENTLY` 避免鎖表

### 5.3 idx_telemetry_unique_asset_time 影響分析

- **目的**：確保 `(asset_id, recorded_at)` 唯一性，支援 `INSERT ... ON CONFLICT` (UPSERT)
- **回補流程**：閘道器重送歷史資料時，使用 UPSERT 避免重複寫入
- **效能考量**：telemetry_history 為分區表，UNIQUE INDEX 建立於各分區上
- **與 v5.16 §6 的關聯**：此索引即為 v5.16 文件中預告的 v6.0 先決條件（提前至 v5.22 實施）

---

## 6. homes → gateways 合併詳解（v5.19）

### 合併原因

- `homes` 表與 `gateways` 表存在 1:1 關係（每個家戶恰好有一個閘道器）
- 分開兩張表導致 JOIN 開銷及外鍵維護複雜度
- 合併後 `gateways` 成為唯一的場域（site）代表

### 欄位對應

| 原 homes 欄位 | 合併後 gateways 欄位 | 型別 | 說明 |
|---------------|---------------------|------|------|
| `home_id` | （已移除） | — | gateway_id 取代 home_id 作為場域識別 |
| `name` | `gateways.name` | `VARCHAR(200)` | 場域名稱 |
| `address` | `gateways.address` | `TEXT` | 場域地址 |
| `contracted_demand_kw` | `gateways.contracted_demand_kw` | `REAL` | 契約容量 (kW) |
| `org_id` | `gateways.org_id` | `VARCHAR(50)` | 已存在於 gateways |

### gateway_id 語意變更

- v5.18：`gateway_id` 為系統生成的 ID (e.g. GW-SF-001)
- v5.19：`gateway_id` 改為裝置序號 (SN, e.g. WKRD24070202100144F)，與 MQTT clientId 一致
- 優勢：無需額外查表即可從 MQTT 訊息直接定位閘道器

### v5.19 欄位移除

| 表 | 移除欄位 | 原因 |
|---|---------|------|
| `gateways` | `client_id` | 與 gateway_id (SN) 完全相同，冗餘 |
| `gateways` | `home_id` | homes 表已 DROP |
| `assets` | `home_id` | 改用 gateway_id 關聯 |
| `device_command_logs` | `client_id` | 與 gateway_id (SN) 完全相同，冗餘 |

---

## 7. backfill_requests 操作流程

```
Gap Detection (M1 watchdog)
  │ 偵測到遙測間隙 (gap_start, gap_end)
  │
  v
INSERT backfill_requests (status='pending')
  │
  v
Backfill Dispatcher (M3)
  │ 查詢 idx_backfill_active
  │ 按 chunk 發送回補命令至閘道器
  │ UPDATE status='in_progress', current_chunk_start, last_chunk_sent_at
  │
  v
Gateway 回傳歷史遙測
  │ INSERT ... ON CONFLICT (asset_id, recorded_at) DO UPDATE
  │ (使用 idx_telemetry_unique_asset_time)
  │
  v
All chunks completed
  │ UPDATE status='completed', completed_at=NOW()
```

### 狀態機

```
pending ──→ in_progress ──→ completed
                │
                └──→ failed (逾時或閘道器離線)
```

---

## 8. Migration Safety Notes

1. **所有 CREATE TABLE / INDEX 使用 `IF NOT EXISTS`** — 可安全重複執行（冪等）
2. **所有 ALTER TABLE ADD COLUMN 使用 `IF NOT EXISTS`** — 冪等
3. **DROP TABLE homes** — 不可逆操作，需確認資料已遷移至 gateways
4. **UNIQUE INDEX on telemetry_history** — 若存在重複的 `(asset_id, recorded_at)` 組合，建立索引將失敗；需先清理重複資料
5. **backfill_requests GRANT** — 需確認 `solfacil_service` 角色已存在（v5.20 GRANTs 使用 `solfacil_app` 和 `solfacil_service`）
6. **Partial index** — 僅索引符合 WHERE 條件的列，不影響其他查詢效能

### COALESCE Rules for New Columns

| Column | COALESCE Default | Used By |
|--------|-----------------|---------|
| `gateways.name` | NULL (optional) | M5 BFF 顯示 |
| `gateways.address` | NULL (optional) | M5 BFF 顯示 |
| `gateways.contracted_demand_kw` | `COALESCE(contracted_demand_kw, 0)` | M4 PS 計算 |
| `gateways.ems_health` | `'{}'::jsonb` (DEFAULT) | M8 Admin 監控 |
| `gateways.ems_health_at` | NULL (未收到 emsList) | M8 Admin 監控 |
| `device_command_logs.dispatched_at` | NULL (未派送) | M3 查詢 |
| `device_command_logs.acked_at` | NULL (未確認) | M3 查詢 |
| `device_command_logs.result` | NULL (尚無結果) | M3 查詢 |
| `backfill_requests.current_chunk_start` | NULL (尚未開始) | M3 回補派送 |
| `backfill_requests.completed_at` | NULL (未完成) | M1 監控 |

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
| v5.13 | 2026-03-05 | CREATE ems_health + ALTER asset_hourly_metrics +6 cols; 23->24 tables |
| v5.14 | 2026-03-06 | ALTER 4 tables +15 cols (telemetry deep + DP billing + DP params) |
| v5.15 | 2026-03-07 | CREATE asset_5min_metrics (PARTITION BY RANGE daily); ALTER dispatch_records +target_mode; ALTER assets +allow_export; ALTER homes +contracted_demand_kw; ALTER revenue_daily +sc/tou; 24->25 tables |
| v5.15-R1 | 2026-03-07 | Defence patches: partition pre-creation buffer, UTC-first billing, NULL fallback |
| v5.16 | 2026-03-07 | ALTER telemetry_history +do0_active +do1_active; ALTER tariff_schedules +demand_charge_rate_per_kva +billing_power_factor; ALTER revenue_daily +ps_savings_reais +ps_avoided_peak_kva +do_shed_confidence +true_up_adjustment_reais; 0 new tables; date_bin 15-min demand; DO telemetry chain; orphan fallback; true-up auditability |
| **v5.22** | **2026-03-13** | **CREATE gateways (v5.18) + device_command_logs (v5.18); homes→gateways merge (v5.19, homes DROPPED); device_command_logs +dispatched_at +acked_at (v5.20); 3 partial indexes on device_command_logs (v5.20/v5.21/v5.22); CREATE backfill_requests + idx_backfill_active (v5.22); UNIQUE INDEX idx_telemetry_unique_asset_time (v5.22); 25→26 tables** |
