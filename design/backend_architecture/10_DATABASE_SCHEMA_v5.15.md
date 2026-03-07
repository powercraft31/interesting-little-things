# Database Schema -- v5.15 SC/TOU Attribution & 5-min Telemetry

> **Version**: v5.15
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: 1 new partitioned table (asset_5min_metrics), 4 tables altered; migration_v5.15.sql
> **Core Theme**: 5-min partitioned telemetry + dispatch mode attribution + SC/TOU savings columns

---

## Changes from v5.14

| Aspect | v5.14 | v5.15 |
|--------|-------|-------|
| New tables | 0 | 1 (asset_5min_metrics, partitioned) |
| Altered tables | 4 | 4 (dispatch_records, assets, homes, revenue_daily) |
| Total tables | 24 | **25** |
| Partitioning | None | asset_5min_metrics: PARTITION BY RANGE (recorded_at), daily |
| Retention policy | None | asset_5min_metrics: 30-day, DROP PARTITION |

---

## 1. New Table: `asset_5min_metrics` (Partitioned)

### Design Rationale

At scale (50,000 devices x 288 records/day = 14.4M rows/day), `DELETE`-based cleanup on a monolithic table causes:
- WAL bloat (each deleted row generates WAL entries)
- VACUUM lock risk (autovacuum competes with INSERT-heavy workload)
- I/O amplification from dead tuple reclamation

PostgreSQL native `PARTITION BY RANGE` with daily partitions solves all three:
- `DROP PARTITION` is an O(1) metadata-only operation -- no locks, no WAL
- Each partition is an independent physical table -- vacuum is partition-scoped
- Range scans on `recorded_at` hit only relevant partitions

### DDL

```sql
-- ============================================================
-- asset_5min_metrics -- 5-minute telemetry aggregation
-- Partitioned by day for 30-day retention with DROP PARTITION
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_5min_metrics (
    asset_id          VARCHAR(50)   NOT NULL,
    recorded_at       TIMESTAMPTZ   NOT NULL,
    pv_energy_kwh     REAL          NOT NULL DEFAULT 0,
    load_kwh          REAL          NOT NULL DEFAULT 0,
    grid_import_kwh   REAL          NOT NULL DEFAULT 0,
    grid_export_kwh   REAL          NOT NULL DEFAULT 0,
    bat_charge_kwh    REAL          NOT NULL DEFAULT 0,
    bat_discharge_kwh REAL          NOT NULL DEFAULT 0,
    battery_soc       REAL,
    battery_power_kw  REAL,
    data_points_count SMALLINT      NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (recorded_at);

-- Composite primary key within each partition
-- (asset_id, recorded_at) uniquely identifies a 5-min window for an asset
-- Index is created on each partition automatically
CREATE UNIQUE INDEX IF NOT EXISTS uq_5min_asset_time
    ON asset_5min_metrics (asset_id, recorded_at);
```

### Partition Creation (30 Days)

```sql
-- Create partitions for the next 30 days
-- Run once at setup, then daily cron creates tomorrow's partition

-- Example for a single day:
CREATE TABLE IF NOT EXISTS asset_5min_metrics_20260307
    PARTITION OF asset_5min_metrics
    FOR VALUES FROM ('2026-03-07 00:00:00+00') TO ('2026-03-08 00:00:00+00');

-- Automated partition creation (run daily at 23:00 via cron):
-- Creates partition for day-after-tomorrow to handle timezone edge cases
DO $$
DECLARE
    partition_date DATE := CURRENT_DATE + 2;
    partition_name TEXT := 'asset_5min_metrics_' || to_char(partition_date, 'YYYYMMDD');
    start_ts TEXT := partition_date::TEXT || ' 00:00:00+00';
    end_ts TEXT := (partition_date + 1)::TEXT || ' 00:00:00+00';
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF asset_5min_metrics
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_ts, end_ts
    );
    RAISE NOTICE 'Created partition: %', partition_name;
END $$;
```

### Partition Cleanup (DROP old partitions)

```sql
-- Drop partitions older than 30 days
-- Run daily at 01:00 via cron (before billing job at 02:00)

DO $$
DECLARE
    cutoff_date DATE := CURRENT_DATE - 30;
    partition_name TEXT := 'asset_5min_metrics_' || to_char(cutoff_date, 'YYYYMMDD');
BEGIN
    EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
    RAISE NOTICE 'Dropped partition: %', partition_name;
END $$;
```

### Index Strategy

```sql
-- Primary access pattern: M4 billing job reads all 5-min records for a given day
-- The partition key (recorded_at) already provides partition pruning.
-- Within each partition, the composite unique index (asset_id, recorded_at) covers:
--   WHERE recorded_at >= $1 AND recorded_at < $2 AND asset_id = $3

-- Secondary access pattern: M1 hourly aggregator reads last hour
-- Same index covers this (partition pruning + asset_id scan)

-- No additional indexes needed. The unique index on (asset_id, recorded_at) is sufficient.
```

### RLS Policy

```sql
-- asset_5min_metrics is written by M1 (Service Pool) and read by M1/M4 (Service Pool)
-- No BFF direct access -- BFF reads from revenue_daily and asset_hourly_metrics
-- Service Pool has BYPASSRLS, so no RLS policy needed on this table

-- However, add org_id for future audit/compliance needs:
-- NOTE: org_id is NOT included in v5.15 to avoid JOIN overhead in the 5-min aggregator.
-- The billing job JOINs through assets.org_id when needed.
```

---

## 2. Altered Tables

### 2.1 dispatch_records -- +1 Column

```sql
-- target_mode: what operational mode was dispatched
-- Written by M3 DR Dispatcher when sending a command
-- Read by M4 billing job for SC/TOU attribution

ALTER TABLE dispatch_records
    ADD COLUMN IF NOT EXISTS target_mode VARCHAR(50);

COMMENT ON COLUMN dispatch_records.target_mode IS
    'Dispatch mode: self_consumption | peak_valley_arbitrage | peak_shaving';

-- Backfill existing records as self_consumption (safe default for historical data)
UPDATE dispatch_records SET target_mode = 'self_consumption' WHERE target_mode IS NULL;
```

### 2.2 assets -- +1 Column

```sql
-- allow_export: grid export permission from interconnection agreement
-- Physical/regulatory constraint, NOT a software strategy option
-- false = site MUST NOT export power to grid (net_power <= 0 enforced by M3)
-- true = site may export surplus to grid

ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS allow_export BOOLEAN DEFAULT false;

COMMENT ON COLUMN assets.allow_export IS
    'Grid export permission from interconnection agreement. false = net export prohibited.';
```

### 2.3 homes -- +1 Column

```sql
-- contracted_demand_kw: site-level contracted demand from utility
-- Used by Peak Shaving mode (v5.16) to set discharge threshold
-- Demand is a site property (homes), not an asset property

ALTER TABLE homes
    ADD COLUMN IF NOT EXISTS contracted_demand_kw REAL;

COMMENT ON COLUMN homes.contracted_demand_kw IS
    'Contracted demand in kW from utility agreement. Used for peak shaving threshold (v5.16).';
```

### 2.4 revenue_daily -- +2 Columns

```sql
-- SC/TOU attributed savings from 5-min data + dispatch mode JOIN
-- Written by M4 daily-billing-job
-- Read by M5 BFF get-performance-savings

ALTER TABLE revenue_daily
    ADD COLUMN IF NOT EXISTS sc_savings_reais NUMERIC(10,2);

ALTER TABLE revenue_daily
    ADD COLUMN IF NOT EXISTS tou_savings_reais NUMERIC(10,2);

COMMENT ON COLUMN revenue_daily.sc_savings_reais IS
    'Self-consumption savings in BRL, attributed from 5-min windows where dispatch mode = self_consumption';
COMMENT ON COLUMN revenue_daily.tou_savings_reais IS
    'TOU arbitrage savings in BRL, attributed from 5-min windows where dispatch mode = peak_valley_arbitrage';
```

---

## 3. Complete `migration_v5.15.sql` Skeleton

```sql
-- ============================================================
-- migration_v5.15.sql -- SC/TOU Attribution & 5-min Telemetry
-- Date: 2026-03-07
-- ============================================================
-- IMPORTANT: Run partition creation AFTER this migration.
-- See section 1 for partition DDL.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. CREATE: asset_5min_metrics (partitioned by day)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_5min_metrics (
    asset_id          VARCHAR(50)   NOT NULL,
    recorded_at       TIMESTAMPTZ   NOT NULL,
    pv_energy_kwh     REAL          NOT NULL DEFAULT 0,
    load_kwh          REAL          NOT NULL DEFAULT 0,
    grid_import_kwh   REAL          NOT NULL DEFAULT 0,
    grid_export_kwh   REAL          NOT NULL DEFAULT 0,
    bat_charge_kwh    REAL          NOT NULL DEFAULT 0,
    bat_discharge_kwh REAL          NOT NULL DEFAULT 0,
    battery_soc       REAL,
    battery_power_kw  REAL,
    data_points_count SMALLINT      NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (recorded_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_5min_asset_time
    ON asset_5min_metrics (asset_id, recorded_at);

-- Create initial 30+2 day partitions (today - 1 through today + 31)
DO $$
DECLARE
    d DATE;
    pname TEXT;
    start_ts TEXT;
    end_ts TEXT;
BEGIN
    FOR d IN SELECT generate_series(
        CURRENT_DATE - 1,
        CURRENT_DATE + 31,
        '1 day'::interval
    )::date LOOP
        pname := 'asset_5min_metrics_' || to_char(d, 'YYYYMMDD');
        start_ts := d::TEXT || ' 00:00:00+00';
        end_ts := (d + 1)::TEXT || ' 00:00:00+00';
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF asset_5min_metrics
             FOR VALUES FROM (%L) TO (%L)',
            pname, start_ts, end_ts
        );
    END LOOP;
END $$;

-- Grant permissions (Service Pool only -- no BFF access)
GRANT SELECT, INSERT ON asset_5min_metrics TO solfacil_service;

-- ────────────────────────────────────────────────────────────
-- 2. ALTER: dispatch_records + target_mode
-- ────────────────────────────────────────────────────────────

ALTER TABLE dispatch_records
    ADD COLUMN IF NOT EXISTS target_mode VARCHAR(50);

-- Backfill: existing records default to self_consumption
UPDATE dispatch_records
    SET target_mode = 'self_consumption'
    WHERE target_mode IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. ALTER: assets + allow_export
-- ────────────────────────────────────────────────────────────

ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS allow_export BOOLEAN DEFAULT false;

-- ────────────────────────────────────────────────────────────
-- 4. ALTER: homes + contracted_demand_kw (PS pre-work)
-- ────────────────────────────────────────────────────────────

ALTER TABLE homes
    ADD COLUMN IF NOT EXISTS contracted_demand_kw REAL;

-- ────────────────────────────────────────────────────────────
-- 5. ALTER: revenue_daily + sc_savings_reais, tou_savings_reais
-- ────────────────────────────────────────────────────────────

ALTER TABLE revenue_daily
    ADD COLUMN IF NOT EXISTS sc_savings_reais NUMERIC(10,2);

ALTER TABLE revenue_daily
    ADD COLUMN IF NOT EXISTS tou_savings_reais NUMERIC(10,2);

COMMIT;
```

---

## 4. Updated Table Schemas (Post-Migration)

### 4.1 asset_5min_metrics (NEW)

| Column | Type | NULL | Default | Source |
|--------|------|------|---------|--------|
| asset_id | VARCHAR(50) | NOT NULL | | FK to assets |
| recorded_at | TIMESTAMPTZ | NOT NULL | | 5-min window start |
| pv_energy_kwh | REAL | NOT NULL | 0 | SUM(pv_power * 1/12) over 5-min window |
| load_kwh | REAL | NOT NULL | 0 | SUM(load_power * 1/12) over 5-min window |
| grid_import_kwh | REAL | NOT NULL | 0 | SUM(grid_power > 0 * 1/12) |
| grid_export_kwh | REAL | NOT NULL | 0 | SUM(ABS(grid_power < 0) * 1/12) |
| bat_charge_kwh | REAL | NOT NULL | 0 | SUM(battery_power > 0 * 1/12) |
| bat_discharge_kwh | REAL | NOT NULL | 0 | SUM(ABS(battery_power < 0) * 1/12) |
| battery_soc | REAL | YES | | AVG(battery_soc) over window |
| battery_power_kw | REAL | YES | | AVG(battery_power) over window |
| data_points_count | SMALLINT | NOT NULL | 0 | COUNT(*) of raw records in window |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | |

### 4.2 dispatch_records -- New Column

| Column | Type | NULL | Default | Purpose |
|--------|------|------|---------|---------|
| **target_mode** | **VARCHAR(50)** | **YES** | | **'self_consumption' / 'peak_valley_arbitrage' / 'peak_shaving'** |

### 4.3 assets -- New Column

| Column | Type | NULL | Default | Purpose |
|--------|------|------|---------|---------|
| **allow_export** | **BOOLEAN** | **NO** | **false** | **Grid export permission from interconnection agreement** |

### 4.4 homes -- New Column

| Column | Type | NULL | Default | Purpose |
|--------|------|------|---------|---------|
| **contracted_demand_kw** | **REAL** | **YES** | | **Site contracted demand for PS threshold (v5.16)** |

### 4.5 revenue_daily -- New Columns

| Column | Type | NULL | Default | Purpose |
|--------|------|------|---------|---------|
| **sc_savings_reais** | **NUMERIC(10,2)** | **YES** | | **Self-consumption attributed savings** |
| **tou_savings_reais** | **NUMERIC(10,2)** | **YES** | | **TOU arbitrage attributed savings** |

---

## 5. Table Count Update

| Category | v5.14 Count | v5.15 Delta | v5.15 Count |
|----------|------------|-------------|-------------|
| M6 Identity | 3 | -- | 3 |
| M1 IoT Hub | 6 | **+1** | **7** |
| M2 Optimization | 2 | -- | 2 |
| M3 DR Dispatcher | 2 | -- | 2 |
| M4 Market & Billing | 5 | -- | 5 |
| M8 Admin Control | 4 | -- | 4 |
| Housing (v5.12) | 1 | -- | 1 |
| Shared Contract | 1 | -- | 1 |
| **Total** | **24** | **+1** | **25** |

---

## 6. Partition Maintenance Cron

### Daily Cron Jobs (add to system crontab)

```cron
# Create tomorrow+1 partition (23:00 daily, before midnight)
0 23 * * * psql -U solfacil_service -d solfacil_vpp -c "
DO \$\$
DECLARE
    d DATE := CURRENT_DATE + 2;
    pname TEXT := 'asset_5min_metrics_' || to_char(d, 'YYYYMMDD');
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF asset_5min_metrics
         FOR VALUES FROM (%L) TO (%L)',
        pname, d::TEXT || ' 00:00:00+00', (d+1)::TEXT || ' 00:00:00+00'
    );
END \$\$;"

# Drop partition older than 30 days (01:00 daily, before billing at 02:00)
0 1 * * * psql -U solfacil_service -d solfacil_vpp -c "
DO \$\$
DECLARE
    d DATE := CURRENT_DATE - 30;
    pname TEXT := 'asset_5min_metrics_' || to_char(d, 'YYYYMMDD');
BEGIN
    EXECUTE format('DROP TABLE IF EXISTS %I', pname);
END \$\$;"
```

---

## 7. Index Analysis

### New Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `uq_5min_asset_time` | asset_5min_metrics | (asset_id, recorded_at) UNIQUE | UPSERT + range scan by asset and time |

### Existing Indexes (Unchanged)

| Index | Table | Still Valid? |
|-------|-------|-------------|
| `idx_telemetry_asset_time` | telemetry_history | Yes -- 5-min aggregator reads this |
| `idx_asset_hourly_asset_hour` | asset_hourly_metrics | Yes -- hourly aggregator writes this |
| `uq_asset_hourly` | asset_hourly_metrics | Yes -- UPSERT target |
| `revenue_daily (asset_id, date)` | revenue_daily | Yes -- billing UPSERT |
| `idx_dispatch_records_*` | dispatch_records | Yes -- M4 billing JOIN |

No new indexes needed on altered tables. The `target_mode` column is used in a JOIN condition with time-range filtering (which uses existing time indexes on dispatch_records).

---

## 8. Migration Safety Notes

1. **`asset_5min_metrics` CREATE** -- new table, no impact on existing tables.
2. **Partition DDL wrapped in DO block** -- `IF NOT EXISTS` makes it idempotent.
3. **All ALTER TABLE ADD COLUMN use `IF NOT EXISTS`** -- safe to re-run.
4. **`allow_export DEFAULT false`** -- safe default (no export until explicitly enabled).
5. **`contracted_demand_kw` NULL** -- not used until v5.16, no impact.
6. **Backfill `dispatch_records.target_mode`** -- UPDATE WHERE NULL, idempotent.
7. **`sc_savings_reais` / `tou_savings_reais` NULL** -- nullable columns, no table rewrite.

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.4 | 2026-02-27 | PostgreSQL full adoption -- 19 initial tables |
| v5.5 | 2026-02-28 | revenue_daily dual-layer columns |
| v5.7 | 2026-02-28 | pld_horario import |
| v5.8 | 2026-03-02 | asset_hourly_metrics Data Contract |
| v5.10 | 2026-03-05 | RLS Scope Formalization |
| v5.11 | 2026-03-05 | DDL Fix -- RLS scope |
| v5.13 | 2026-03-05 | CREATE ems_health + ALTER asset_hourly_metrics +6 cols; 23->24 tables |
| v5.14 | 2026-03-06 | ALTER 4 tables +15 cols (telemetry deep + DP billing + DP params) |
| **v5.15** | **2026-03-07** | **CREATE asset_5min_metrics (PARTITION BY RANGE daily, 30-day retention, DROP PARTITION cleanup); ALTER dispatch_records +target_mode; ALTER assets +allow_export; ALTER homes +contracted_demand_kw; ALTER revenue_daily +sc_savings_reais +tou_savings_reais; total 24->25 tables** |
