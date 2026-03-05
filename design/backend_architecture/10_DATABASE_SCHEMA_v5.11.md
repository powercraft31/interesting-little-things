# 10. Database Schema — v5.11

> **版本**: v5.11 | **建立日期**: 2026-03-05 | **負責人**: Shared Infrastructure
>
> **變更說明**: v5.11 RLS Scope Formalization — 正式文件化 v5.10 設計文件 §RLS.3 與實際 DDL 之間的差異。
> 明確三張缺少 `org_id` 的表（`trades`、`revenue_daily`、`dispatch_records`）不啟用 RLS。
> 記錄 `dispatch_commands` 表代碼 DDL 與設計 DDL 的欄位差異。
> 表格總數：19（不變）。

---

## §1 v5.10→v5.11 差異摘要

### 問題陳述

v5.10 設計文件 `10_DATABASE_SCHEMA_v5.10.md` §RLS.3 定義了 11 張表的 RLS 策略，包括：

```sql
-- v5.10 設計文件中的 RLS 策略（§RLS.3）
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_trades_tenant ON trades
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE revenue_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_revenue_daily_tenant ON revenue_daily
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE dispatch_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_dispatch_records_tenant ON dispatch_records
  USING (org_id = current_setting('app.current_org_id', true));
```

**但這三張表的 DDL 定義中不包含 `org_id` 欄位：**

| 表名 | 有 `org_id`? | 備註 |
|------|-------------|------|
| `trades` | **No** | 僅有 `asset_id` FK → assets |
| `revenue_daily` | **No** | 僅有 `asset_id` FK → assets |
| `dispatch_records` | **No** | 僅有 `asset_id` FK → assets |

實際 `ddl_base.sql`（v5.10）已正確跳過這三張表的 RLS，但設計文件未同步。

### v5.11 決策

| 表名 | 決策 | 理由 |
|------|------|------|
| `trades` | **不啟用 RLS** (Option B) | 新增 `org_id` 欄位是 Breaking DDL change（需 backfill + ALTER TABLE），風險與收益不對稱。`trades` 僅由 M4 cron job（service pool, BYPASSRLS）讀寫，BFF 不直接查詢此表。租戶隔離由 `asset_id` JOIN `assets`（有 RLS）間接保證。 |
| `revenue_daily` | **不啟用 RLS** (Option B) | 同上。`revenue_daily` 由 M4 cron job 寫入，BFF dashboard 查詢時透過 `asset_id` JOIN `assets`（有 RLS）間接隔離。 |
| `dispatch_records` | **不啟用 RLS** (Option B) | 同上。`dispatch_records` 僅由 M3 cron job 寫入，無 BFF 直接查詢路徑。 |

> **v6.0 考量：** 若未來 BFF 新增直接查詢 `trades`/`revenue_daily` 的 API（不經 JOIN assets），
> 則必須回到 Option A（新增 `org_id` + 啟用 RLS）。在 v5.11 scope 內，所有 BFF 查詢都經過
> `assets` 表 JOIN，RLS 在 `assets` 表層級生效，間接保證租戶隔離。

---

## §2 RLS 啟用表完整清單 (v5.11)

| 表名 | 有 `org_id`? | RLS 啟用? | 策略 | 說明 |
|------|-------------|----------|------|------|
| `assets` | Yes | Yes | `org_id = current_setting('app.current_org_id')` | M1 主表 |
| `dispatch_commands` | Yes | Yes | `org_id = current_setting('app.current_org_id')` | M3 指令表 |
| `tariff_schedules` | Yes | Yes | `org_id = current_setting('app.current_org_id')` | M4 電價表 |
| `vpp_strategies` | Yes | Yes | `org_id = current_setting('app.current_org_id')` | M8 策略表 |
| `parser_rules` | Yes | Yes | `org_id IS NULL OR org_id = current_setting(...)` | M8 解析規則（NULL = 全局） |
| `feature_flags` | Yes | Yes | `org_id IS NULL OR org_id = current_setting(...)` | M8 功能開關（NULL = 全局） |
| `trade_schedules` | Yes | Yes | `org_id::TEXT = current_setting(...)` | M2 排程表 |
| `algorithm_metrics` | Yes | Yes | `org_id::TEXT = current_setting(...)` | M2 KPI 表 |
| **`trades`** | **No** | **No** | — | v5.11: 確認不啟用 RLS（缺少 org_id） |
| **`revenue_daily`** | **No** | **No** | — | v5.11: 確認不啟用 RLS（缺少 org_id） |
| **`dispatch_records`** | **No** | **No** | — | v5.11: 確認不啟用 RLS（缺少 org_id） |
| `organizations` | N/A | No | — | 頂層表，不需 RLS |
| `users` | N/A | No | — | 透過 user_org_roles 關聯 |
| `user_org_roles` | N/A | No | — | 關聯表 |
| `device_state` | No | No | — | 透過 asset_id FK 間接隔離 |
| `telemetry_history` | No | No | — | M1 內部表，不對外暴露 |
| `asset_hourly_metrics` | No | No | — | Shared Contract，cron job 寫入 |
| `weather_cache` | No | No | — | 全局快取 |
| `pld_horario` | No | No | — | 全局參考表 |
| `data_dictionary` | No | No | — | 全局字典 |

---

## §3 dispatch_commands 表 — DDL 與代碼差異 (v5.11 記載)

### 設計 DDL (ddl_base.sql — BFF 面向)

```sql
CREATE TABLE dispatch_commands (
  id              SERIAL PRIMARY KEY,
  asset_id        VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
  org_id          VARCHAR(50) NOT NULL REFERENCES organizations(org_id),
  action          VARCHAR(20) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 代碼 DDL (M3 Command Dispatcher 實際 INSERT 欄位)

```sql
-- command-dispatcher.ts 實際 INSERT：
INSERT INTO dispatch_commands
  (trade_id, asset_id, org_id, action, volume_kwh, status, m1_boundary)
VALUES ($1, $2, $3, $4, $5, 'dispatched', true)
```

### 差異欄位

| 欄位 | ddl_base.sql | 代碼使用 | 說明 |
|------|-------------|---------|------|
| `trade_id` | **不存在** | INSERT | M3 需要追蹤對應的 trade_schedule |
| `volume_kwh` | **不存在** | INSERT | 排程預計充放電量 |
| `m1_boundary` | **不存在** | INSERT | v5.6 邊界標記（是否到 M1 停止） |
| `status` default | `'scheduled'` | `'dispatched'` | 代碼使用 `dispatched` 作為初始狀態 |

### v5.11 決策

`ddl_base.sql` 需要擴充以下欄位，使其與代碼實際使用對齊：

```sql
-- v5.11 migration: 擴充 dispatch_commands 表（對齊代碼實際使用）
ALTER TABLE dispatch_commands ADD COLUMN IF NOT EXISTS trade_id INTEGER REFERENCES trade_schedules(id);
ALTER TABLE dispatch_commands ADD COLUMN IF NOT EXISTS volume_kwh NUMERIC(8,2);
ALTER TABLE dispatch_commands ADD COLUMN IF NOT EXISTS m1_boundary BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE dispatch_commands ALTER COLUMN status SET DEFAULT 'dispatched';
```

---

## §4 trade_schedules 表 — 缺少 status 欄位 (v5.11 記載)

### 問題

`ddl_base.sql` 中的 `trade_schedules` 表定義不包含 `status` 欄位：

```sql
CREATE TABLE trade_schedules (
    id                  SERIAL PRIMARY KEY,
    asset_id            VARCHAR(50) NOT NULL REFERENCES assets(asset_id),
    org_id              VARCHAR(50) NOT NULL,
    planned_time        TIMESTAMPTZ NOT NULL,
    action              VARCHAR(10) NOT NULL CHECK (...),
    expected_volume_kwh NUMERIC(8,2) NOT NULL,
    target_pld_price    NUMERIC(10,2),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

但代碼中大量使用 `status` 欄位（`scheduled` → `executing` → `executed` / `failed`）。

### v5.11 決策

```sql
-- v5.11 migration: 補充 trade_schedules.status 欄位
ALTER TABLE trade_schedules ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'scheduled';
CREATE INDEX IF NOT EXISTS idx_trade_schedules_status ON trade_schedules (status, planned_time);
```

---

## §5 雙角色架構

（與 v5.10 相同。參見 `10_DATABASE_SCHEMA_v5.10.md` §RLS.1 — 角色建立。）

**v5.11 強調：代碼層現在也正確使用雙角色。**

| 角色 | 代碼層 Pool | 使用場景 |
|------|-----------|---------|
| `solfacil_app` | `getAppPool()` | BFF handlers、ACK endpoint |
| `solfacil_service` | `getServicePool()` | M2/M3/M4/M1 cron jobs |

---

## §6 其他章節

§1 表清單與模組所有權、§2 ER 關聯圖、§3 完整 DDL、§4 Migration 管理原則 — 與 v5.10 相同，不重複。

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.4 | 2026-02-27 | PostgreSQL 全面取代 DynamoDB/Timestream，15 張表確認 |
| v5.5 | 2026-02-28 | 雙層經濟模型：+3 表，18 張表 |
| v5.7 | 2026-02-28 | External Ingestion：pld_horario/weather_cache 由 M7 Webhook 更新 |
| v5.8 | 2026-03-02 | Closed-loop Billing via Data Contract: asset_hourly_metrics 新增，19 張表 |
| v5.10 | 2026-03-05 | DB Bootstrap Fix & Dual-Role RLS Architecture |
| **v5.11** | **2026-03-05** | **RLS Scope Formalization: (1) trades/revenue_daily/dispatch_records 確認不啟用 RLS（缺少 org_id，v6.0 考量加入）; (2) dispatch_commands 表 DDL 擴充（trade_id, volume_kwh, m1_boundary）對齊代碼; (3) trade_schedules 表補充 status 欄位對齊代碼; (4) 完整 RLS 啟用表清單（8 張表啟用，11 張表不啟用）** |
