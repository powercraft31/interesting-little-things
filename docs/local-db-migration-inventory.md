# Solfacil Local DB Migration Inventory

Purpose: define the canonical ordered migration set for local DB rebuilds, instead of relying on filesystem order or memory.

Status: canonical for local rebuild path as of v6.9 repair work.

## Why this exists

The previous local rebuild path stopped at `scripts/migration_v5.10.sql`, while the live local DB had later migrations applied only partially and manually. This caused repeated schema drift.

This inventory freezes one explicit ordered list for local rebuilds.

## Canonical ordered migration set

This inventory is defined relative to the current canonical base schema:
- `backend/scripts/ddl_base.sql`

Therefore, historical migrations whose effects are already baked into `ddl_base.sql` are not re-applied in the post-v5.10 runner.

| Order | File | Class | Included in canonical local rebuild | Reason |
|---|---|---|---|---|
| 1 | `backend/migrations/migration_v5.13.sql` | schema | yes | Adds `asset_hourly_metrics` aggregation columns, `ems_health`, and telemetry partition precreate not guaranteed by base DDL. |
| 2 | `backend/migrations/migration_v5.14.sql` | schema | yes | Adds deeper telemetry and hourly/revenue/assets columns used by later runtime and reporting logic. |
| 3 | `backend/migrations/migration_v5.15.sql` | schema | yes | Introduces `asset_5min_metrics` and SC/TOU fields. Required for M1/M4 chain. Homes pre-work is now guarded for post-homes schemas. |
| 4 | `backend/migrations/migration_v5.16.sql` | schema | yes | Peak-shaving attribution fields and schedule extensions. |
| 5 | `backend/migrations/migration_v5.20.sql` | schema | yes | Grants + `device_command_logs.dispatched_at/acked_at`, which are not in current base DDL. |
| 6 | `backend/migrations/migration_v5.21.sql` | schema | yes | Adds M3 polling index. |
| 7 | `backend/migrations/migration_v5.22_phase1.sql` | schema | yes | Adds accepted-set index for two-phase reply flow. |
| 8 | `backend/migrations/migration_v5.22_phase2.sql` | schema | yes | Adds `backfill_requests`. |
| 9 | `backend/migrations/migration_v5.22_phase3.sql` | schema | yes | Adds telemetry dedup unique index. |
| 10 | `backend/migrations/migration_v5.23.sql` | no-op | yes | Included for version continuity; currently no schema effect. |
| 11 | `backend/migrations/migration_v6.9_5min_partition_maintenance.sql` | compatibility | yes | Required so `solfacil_service` can maintain `asset_5min_metrics` partitions at runtime. |
| 12 | `backend/migrations/migration_v6.9_hourly_metrics_schema_compat.sql` | compatibility | yes | Required so `asset_hourly_metrics` matches runtime hourly aggregator contract. |
| 13 | `backend/migrations/migration_v6.9_gateway_home_alias_compat.sql` | compatibility | yes | Restores `gateways.home_alias`, which `/api/gateways` still queries and treats as nullable fallback metadata. |
| 14 | `backend/migrations/migration_v6.9_gateway_outage_events_compat.sql` | compatibility | yes | Restores `gateway_outage_events`, which `/api/fleet/offline-events` still queries for outage history. |
| 15 | `backend/migrations/migration_v7.0.sql` | schema | yes | Adds v7 protocol schema updates including `gateway_alarm_events` and `ESS` asset type support. |

### Historical migrations intentionally excluded from post-v5.10 runner

| File | Status | Reason |
|---|---|---|
| `backend/scripts/migration_v5.12.sql` | excluded | `homes` era migration. Current `ddl_base.sql` already reflects post-homes schema direction. Re-applying introduces transitional objects no longer present in final base. |
| `backend/migrations/migration_v5.18.sql` | excluded | Gateway/device-command transitional migration is already substantially baked into `ddl_base.sql`; re-applying against current base fails on dropped transitional columns like `gateways.home_id`. |
| `backend/migrations/migration_v5.18_hotfix.sql` | excluded | Superseded by current base schema and later gateway health fields. |
| `backend/migrations/migration_v5.19.sql` | excluded | Consolidation migration already folded into current base schema; rerunning against current base is conceptually wrong. |

Manifest file:
- `backend/scripts/local-migration-manifest.txt`

## Classification rules

- `schema`: additive/transformational migration that defines expected DB contract.
- `compatibility`: local repair migration required to make current runtime contract actually executable.
- `no-op`: tracked for continuity even if currently empty.

## Legacy-object policy (current default)

### `ems_health`
Current policy: keep as canonical local object for now.

Reason:
- `migration_v5.13.sql` explicitly creates it.
- Old MQTT subscriber code still contains `INSERT INTO ems_health`.
- Newer mainline also writes `gateways.ems_health`, so both truths currently coexist in repo.

Interpretation:
- This is not architecturally clean, but keeping `ems_health` in canonical local rebuild avoids breaking old code paths until they are explicitly retired.

Future cleanup option:
- remove old `ems_health` table dependency and retire legacy writer path,
- then reclassify `ems_health` out of canonical contract.

### `device_command_logs.dispatched_at` / `acked_at`
Current policy: keep as canonical local columns.

Reason:
- `migration_v5.20.sql` explicitly adds them.
- Missing them in local DB was confirmed drift.
- Even if not heavily used now, their presence is part of expected schema contract.

## Known seed/rebuild state

The rebuild path is now split into two layers:
- canonical schema+migrations path (`bootstrap.sh` default)
- optional demo seed layer (`bootstrap.sh --with-demo-seed` or `apply-demo-seeds.sh`)

This replaces the old mixed model where demo seeds were implicitly part of every rebuild.

Desired steady-state model is now active:
- base schema
- canonical migrations
- optional demo seed layer
- verification

## Minimum local contract checks after rebuild

Verifier script:
- `backend/scripts/verify-local-db-contract.ts`

Must exist:
- `asset_5min_metrics`
- `asset_hourly_metrics`
- `gateways`
- `device_command_logs`
- `backfill_requests`
- `gateway_alarm_events`
- `ems_health` (until legacy path is retired)

Must be true:
- `solfacil_service` has `CREATE` on schema `public`
- `asset_5min_metrics` owner is `solfacil_service`
- `assets_asset_type_check` includes `ESS`
- `solfacil_service` can create a rollback-scoped probe partition on `asset_5min_metrics`
- `asset_hourly_metrics` contains:
  - `pv_generation_kwh`
  - `grid_import_kwh`
  - `grid_export_kwh`
  - `load_consumption_kwh`
  - `avg_battery_soc`
  - `peak_battery_power_kw`
- `device_command_logs` contains:
  - `dispatched_at`
  - `acked_at`
- required indexes exist:
  - `idx_backfill_active`
  - `idx_telemetry_unique_asset_time`
  - `idx_gae_gateway_event`
  - `idx_gae_org`
  - `idx_gae_status_active`
  - `idx_gae_event_create_time`

Suggested commands:
- schema-only canonical rebuild:
  - `cd backend && PGPASSWORD=postgres_admin_2026 APP_DB_PASSWORD=solfacil_vpp_2026 SERVICE_DB_PASSWORD=solfacil_service_2026 ./scripts/bootstrap.sh --drop-existing`
- canonical rebuild with optional demo seed layer:
  - `cd backend && PGPASSWORD=postgres_admin_2026 APP_DB_PASSWORD=solfacil_vpp_2026 SERVICE_DB_PASSWORD=solfacil_service_2026 ./scripts/bootstrap.sh --drop-existing --with-demo-seed`
- contract only:
  - `SERVICE_DATABASE_URL=postgresql://solfacil_service:<password>@127.0.0.1:5433/<db_name> npx ts-node backend/scripts/verify-local-db-contract.ts`
- one-command rebuild + verifier + aggregation smoke:
  - `cd backend && npm run local-db:rebuild-check`

## Decision log

1. Do not rely on directory listing order.
2. Do not pretend v5.10 bootstrap is full truth.
3. Include v6.9 compatibility migrations in canonical rebuild because runtime now depends on them.
4. Keep `ems_health` canonical for now to preserve compatibility with legacy code paths.
