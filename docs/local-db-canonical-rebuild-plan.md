# Solfacil Local DB Canonical Rebuild Plan

> For Hermes: this is a rebuild-truth plan, not a feature plan. Goal is to converge local database creation onto one deterministic path so schema drift stops recurring.

Goal: make local Solfacil DB rebuildable from empty state to current expected schema/data contract through one canonical, repeatable path.

Architecture:
- Replace the current mixed model (bootstrap stops at v5.10, later state patched manually) with a single ordered rebuild chain.
- Separate concerns cleanly: base schema, additive migrations, seed data, post-migration grants/ownership normalization, verification.
- Treat local rebuild as an engineering product: deterministic inputs, explicit ordering, machine-verifiable outputs.

Tech stack:
- PostgreSQL
- psql-based migration execution
- existing SQL migrations under `backend/migrations/`
- existing base/seed scripts under `backend/scripts/` and `db-init/`

---

## Current Truth Summary

Observed facts from live local DB and repo:
1. `backend/scripts/bootstrap.sh` currently rebuilds only through:
   - `scripts/ddl_base.sql`
   - `scripts/seed_v5.4.sql`
   - `scripts/seed_v5.5.sql`
   - `scripts/migration_v5.10.sql`
2. Live DB already contains many later-era objects and columns because it has been hand-patched over time.
3. Confirmed historic drift items included:
   - missing `asset_5min_metrics` future partitions
   - missing ownership/CREATE privileges for runtime partition maintenance
   - missing `asset_hourly_metrics` aggregation columns
4. Residual live drift still present:
   - `ems_health` table missing, while old MQTT subscriber path still references it
   - `device_command_logs.dispatched_at` / `acked_at` missing from live DB despite `migration_v5.20.sql`
5. Therefore the root problem is not one broken migration; it is absence of one canonical rebuild path.

---

## Target End State

A new local rebuild path must guarantee all of the following from an empty DB:

1. Roles and grants are created deterministically.
2. Base schema is applied once.
3. All forward migrations under `backend/migrations/` are applied in a defined order.
4. Any compatibility fix needed for runtime jobs is included in that ordered chain.
5. Seed data is explicitly classified:
   - required baseline seed
   - optional demo/dev seed
6. Verification script proves the rebuilt DB matches expected contract.
7. Re-running the rebuild path is idempotent or explicitly reset-based.

---

## Design Decision

Use this canonical model:

1. Role/bootstrap prelude
   - create DB roles
   - grant baseline schema access
2. Base schema load
   - apply the current canonical base DDL exactly once
3. Ordered migrations
   - execute every file in `backend/migrations/` in version order
   - keep local v6.9 compatibility migrations in that same chain
4. Seed phase
   - apply only explicitly chosen local/demo seeds
5. Post-migration normalization
   - grants
   - owner fixes where runtime DDL requires ownership
6. Verification phase
   - fail if required tables/columns/constraints/privileges are absent

Do not keep the current model where bootstrap ends at v5.10 and later state is implied to be “someone probably ran more things later”.

---

## Deliverables

1. New canonical rebuild entrypoint script
2. Ordered migration manifest or deterministic file discovery rule
3. Verification script for local DB contract
4. Decision on obsolete/legacy objects:
   - either restore them into canonical contract
   - or delete their dead code references
5. Documentation for operators/agents

---

## Task Plan

### Task 1: Freeze the canonical migration inventory

Objective: define exactly which SQL files are part of the local rebuild contract.

Files:
- Modify: `backend/scripts/bootstrap.sh`
- Create: `backend/scripts/run-local-migrations.sh`
- Create: `docs/local-db-migration-inventory.md`

Steps:
1. Enumerate all files under `backend/migrations/`.
2. Sort them by intended version order, not filesystem accident.
3. Explicitly mark each as one of:
   - schema migration
   - seed migration
   - compatibility migration
   - deprecated/one-off patch
4. Write the inventory to `docs/local-db-migration-inventory.md`.

Verification:
- inventory lists every current migration file exactly once
- inventory records whether each file belongs in canonical local rebuild

### Task 2: Decide legacy-object policy

Objective: stop carrying ambiguous half-dead schema expectations.

Files:
- Modify: `docs/local-db-migration-inventory.md`
- Possibly modify later: code paths referencing `ems_health`

Steps:
1. Decide whether `ems_health` is still canonical.
2. If canonical:
   - ensure local rebuild creates it
   - keep old writer path legitimate
3. If obsolete:
   - remove old code paths that write/read it
   - document `gateways.ems_health` as the only truth
4. Do the same classification for `device_command_logs.dispatched_at` and `acked_at`.

Verification:
- no object remains in “maybe required” limbo
- every drift item is classified as canonical, obsolete, or deferred

### Task 3: Build one canonical migration runner

Objective: replace ad-hoc rebuild logic with one ordered execution path.

Files:
- Create: `backend/scripts/run-local-migrations.sh`
- Modify: `backend/scripts/bootstrap.sh`

Implementation requirements:
1. `bootstrap.sh` should stop pretending v5.10 is the end state.
2. After base DDL, it should call the canonical migration runner.
3. Migration runner should execute approved migration files in deterministic order.
4. Fail fast on first SQL error.
5. Emit clear progress logs.

Suggested structure:
- Step 1: roles/grants prelude
- Step 2: base schema
- Step 3: migration runner
- Step 4: optional seeds
- Step 5: verification

Verification:
- dropping and recreating local DB followed by bootstrap produces the same final schema every time

### Task 4: Normalize runtime ownership and grants into canonical rebuild

Objective: ensure runtime jobs do not rely on manual post-fix steps.

Files:
- Modify: `backend/scripts/bootstrap.sh`
- Modify or keep: `backend/migrations/migration_v6.9_5min_partition_maintenance.sql`
- Modify: `db-init/03_grants.sql`

Requirements:
1. `solfacil_service` must have schema CREATE where runtime partition creation is required.
2. `asset_5min_metrics` ownership must be deterministic after rebuild.
3. Any required ownership/grant fix must be part of canonical rebuild, not a one-off shell command.

Verification:
- after rebuild, these checks must pass:
  - `has_schema_privilege('solfacil_service', 'public', 'CREATE') = true`
  - parent owner for `asset_5min_metrics` is `solfacil_service`

### Task 5: Add contract verification script

Objective: make drift mechanically detectable.

Files:
- Create: `backend/scripts/verify-local-db-contract.ts` or `.sh`

The verifier should check:
1. required tables exist
2. required columns exist
3. required constraints/indexes exist
4. required privileges/owners exist
5. critical runtime paths can execute without schema error

Minimum assertions:
- `asset_5min_metrics` exists and has parent ownership/grant setup
- `asset_hourly_metrics` contains all aggregator columns
- `gateways`, `device_command_logs`, `backfill_requests`, `gateway_alarm_events` exist
- whichever `ems_health` policy is chosen is enforced
- whichever `device_command_logs` policy is chosen is enforced

Verification:
- verifier exits non-zero on mismatch
- verifier prints exact failing contract item

### Task 6: Rebuild from empty DB and prove determinism

Objective: validate the canonical rebuild path, not just write it.

Files:
- No code design change required beyond scripts above

Steps:
1. drop local DB
2. run canonical bootstrap from empty state
3. run contract verifier
4. run targeted runtime checks:
   - 5-min aggregation
   - hourly aggregation
   - auth login path if relevant to seed choice
5. if rebuild differs from current hand-fixed DB, document why

Verification:
- empty-to-ready rebuild succeeds in one command sequence
- no manual SQL patching required afterward

### Task 7: Remove or document known non-canonical residue

Objective: close the gap between repo truth and operator truth.

Files:
- Modify: docs under `docs/`
- Possibly modify dead code paths in `backend/src/`

Examples:
- if `ems_health` table is obsolete, remove old `mqtt-subscriber.ts` dependency or explicitly retire that path
- if `device_command_logs.acked_at` is intentionally unused, either still keep schema compatibility or document deprecation

Verification:
- no “surprise” object remains that only exists because someone remembered to patch it once

---

## Proposed Canonical Verification Checklist

Run after every local rebuild:

```bash
psql "$LOCAL_DB_URL" -c "SELECT to_regclass('public.asset_5min_metrics');"
psql "$LOCAL_DB_URL" -c "SELECT to_regclass('public.asset_hourly_metrics');"
psql "$LOCAL_DB_URL" -c "SELECT to_regclass('public.gateways');"
psql "$LOCAL_DB_URL" -c "SELECT to_regclass('public.backfill_requests');"
psql "$LOCAL_DB_URL" -c "SELECT has_schema_privilege('solfacil_service', 'public', 'CREATE');"
psql "$LOCAL_DB_URL" -c "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname='asset_5min_metrics';"
```

And runtime checks:

```bash
cd backend
./node_modules/.bin/tsc --noEmit
npm test -- --runInBand test/iot-hub/telemetry-5min-aggregator.test.ts test/iot-hub/telemetry-aggregator.test.ts
npx ts-node -e "import { getServicePool, closeAllPools } from './src/shared/db'; import { runFiveMinAggregation } from './src/iot-hub/services/telemetry-5min-aggregator'; (async () => { try { await runFiveMinAggregation(getServicePool()); } finally { await closeAllPools(); } })().catch(err => { console.error(err); process.exit(1); });"
npx ts-node -e "import { getServicePool, closeAllPools } from './src/shared/db'; import { runHourlyAggregation } from './src/iot-hub/services/telemetry-aggregator'; (async () => { try { await runHourlyAggregation(getServicePool()); } finally { await closeAllPools(); } })().catch(err => { console.error(err); process.exit(1); });"
```

---

## Risks and Tradeoffs

1. Risk: codifying all migrations may expose old SQL assumptions that never really worked on clean DB.
- This is good. It reveals truth.

2. Risk: some migrations are environment-specific or one-off hotfixes.
- Then classify them explicitly instead of letting them silently drift in and out.

3. Risk: demo seed and production-like schema concerns are currently mixed.
- Solve by separating schema/migration path from optional seed path.

4. Risk: old code paths like `mqtt-subscriber.ts -> ems_health` may force a product decision.
- Correct. That ambiguity must be resolved, not tolerated.

---

## Recommended Execution Order

If executing now, do it in this order:
1. Inventory + classification of migrations
2. Decide `ems_health` / `device_command_logs` policy
3. Build canonical migration runner
4. Move ownership/grant fixes into rebuild path
5. Add verifier
6. Drop and rebuild from empty DB
7. Run runtime checks
8. Clean legacy residue

---

## Final Judgment

The local DB problem is not “one more migration to apply”.
It is “no single source of rebuild truth”.

Until rebuild truth is canonicalized, future local debugging will keep wasting time on false negatives caused by environment drift rather than real product defects.
