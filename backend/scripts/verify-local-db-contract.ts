import type { Pool } from "pg";
import { closeAllPools, getServicePool } from "../src/shared/db";

export type LocalDbContractFacts = {
  existingTables: string[];
  existingColumns: Record<string, string[]>;
  existingIndexes: string[];
  schemaCreatePrivilege: boolean;
  runtimeTablesDmlPrivilege: boolean;
  runtimeHealthSnapshotSequencePrivilege: boolean;
  asset5MinOwner: string | null;
  assetTypeConstraintDef: string | null;
  fiveMinPartitionProbeSucceeded: boolean;
  runtimeEventsPartitions: string[];
};

export type ContractCheck = {
  label: string;
  ok: boolean;
  failure?: string;
};

export type LocalDbContractResult = {
  ok: boolean;
  checks: ContractCheck[];
  failures: string[];
};

type Queryable = Pick<Pool, "query">;

type QueryRow = Record<string, unknown>;

const REQUIRED_TABLES = [
  "asset_5min_metrics",
  "asset_hourly_metrics",
  "gateways",
  "device_command_logs",
  "device_command_logs_archive",
  "backfill_requests",
  "gateway_alarm_events",
  "gateway_alarm_events_archive",
  "ems_health",
  "runtime_events",
  "runtime_issues",
  "runtime_self_checks",
  "runtime_health_snapshots",
] as const;

const RUNTIME_EVENTS_DEFAULT_PARTITION = "runtime_events_default";
const RUNTIME_EVENTS_MONTHLY_PATTERN = /^runtime_events_\d{6}$/;

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  asset_hourly_metrics: [
    "pv_generation_kwh",
    "grid_import_kwh",
    "grid_export_kwh",
    "load_consumption_kwh",
    "avg_battery_soc",
    "peak_battery_power_kw",
  ],
  device_command_logs: ["dispatched_at", "acked_at"],
  device_command_logs_archive: ["archived_at", "archive_reason"],
  gateway_alarm_events_archive: ["archived_at", "archive_reason"],
};

const REQUIRED_INDEXES = [
  "idx_backfill_active",
  "idx_backfill_requests_terminal_cutoff",
  "idx_device_command_logs_retention_eligibility",
  "idx_device_command_logs_archive_archived_at",
  "device_command_logs_archive_pkey",
  "idx_gateway_alarm_events_retention_cutoff",
  "idx_gateway_alarm_events_archive_archived_at",
  "gateway_alarm_events_archive_pkey",
  "idx_telemetry_unique_asset_time",
  "idx_gae_gateway_event",
  "idx_gae_org",
  "idx_gae_status_active",
  "idx_gae_event_create_time",
  "idx_runtime_events_observed_at",
  "idx_runtime_events_fingerprint_observed",
  "idx_runtime_events_source_observed",
  "idx_runtime_events_severity_observed",
  "idx_runtime_issues_state_last_observed",
  "idx_runtime_issues_source_state",
  "idx_runtime_issues_tenant_scope_state",
  "idx_runtime_issues_active",
  "idx_runtime_issues_closed_at",
  "idx_runtime_health_snapshots_captured_at",
] as const;

function toStringSet(items: readonly string[]): Set<string> {
  return new Set(items.map((item) => item.trim()).filter(Boolean));
}

function buildCheck(label: string, ok: boolean, failure?: string): ContractCheck {
  return ok ? { label, ok } : { label, ok, failure };
}

export function verifyLocalDbContract(facts: LocalDbContractFacts): LocalDbContractResult {
  const checks: ContractCheck[] = [];
  const existingTables = toStringSet(facts.existingTables);
  const existingIndexes = toStringSet(facts.existingIndexes);

  for (const tableName of REQUIRED_TABLES) {
    const ok = existingTables.has(tableName);
    checks.push(buildCheck(`table exists: ${tableName}`, ok, `missing table: ${tableName}`));
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const actualColumns = toStringSet(facts.existingColumns[tableName] ?? []);
    for (const columnName of requiredColumns) {
      const ok = actualColumns.has(columnName);
      checks.push(
        buildCheck(
          `column exists: ${tableName}.${columnName}`,
          ok,
          `missing column: ${tableName}.${columnName}`,
        ),
      );
    }
  }

  for (const indexName of REQUIRED_INDEXES) {
    const ok = existingIndexes.has(indexName);
    checks.push(buildCheck(`index exists: ${indexName}`, ok, `missing index: ${indexName}`));
  }

  checks.push(
    buildCheck(
      "schema privilege: solfacil_service has CREATE on public",
      facts.schemaCreatePrivilege,
      "missing privilege: solfacil_service lacks CREATE on schema public",
    ),
  );

  checks.push(
    buildCheck(
      "runtime DML privilege: solfacil_app/solfacil_service can read-write runtime tables",
      facts.runtimeTablesDmlPrivilege,
      "missing privilege: runtime tables are not granted to solfacil_app/solfacil_service",
    ),
  );

  checks.push(
    buildCheck(
      "runtime snapshot sequence privilege: solfacil_app/solfacil_service can use runtime_health_snapshots_id_seq",
      facts.runtimeHealthSnapshotSequencePrivilege,
      "missing privilege: runtime_health_snapshots_id_seq is not granted to solfacil_app/solfacil_service",
    ),
  );

  checks.push(
    buildCheck(
      "owner: asset_5min_metrics belongs to solfacil_service",
      facts.asset5MinOwner === "solfacil_service",
      `wrong owner: asset_5min_metrics owner is ${facts.asset5MinOwner ?? "<missing>"} (expected solfacil_service)`,
    ),
  );

  const assetTypeConstraintIncludesEss = (facts.assetTypeConstraintDef ?? "").includes("ESS");
  checks.push(
    buildCheck(
      "constraint: assets_asset_type_check includes ESS",
      assetTypeConstraintIncludesEss,
      "constraint mismatch: assets_asset_type_check does not include ESS",
    ),
  );

  checks.push(
    buildCheck(
      "runtime precondition: solfacil_service can create a probe partition for asset_5min_metrics",
      facts.fiveMinPartitionProbeSucceeded,
      "runtime precondition failed: solfacil_service cannot create a probe partition for asset_5min_metrics",
    ),
  );

  const runtimePartitions = toStringSet(facts.runtimeEventsPartitions);
  const hasDefaultPartition = runtimePartitions.has(RUNTIME_EVENTS_DEFAULT_PARTITION);
  const hasMonthlyPartition = facts.runtimeEventsPartitions.some((name) =>
    RUNTIME_EVENTS_MONTHLY_PATTERN.test(name),
  );

  checks.push(
    buildCheck(
      "runtime_events partition: default partition bootstrapped",
      hasDefaultPartition,
      `missing runtime_events partition: ${RUNTIME_EVENTS_DEFAULT_PARTITION}`,
    ),
  );

  checks.push(
    buildCheck(
      "runtime_events partition: at least one monthly partition bootstrapped",
      hasMonthlyPartition,
      "missing runtime_events partition: at least one monthly partition (runtime_events_YYYYMM)",
    ),
  );

  const failures = checks.flatMap((check) => (check.ok || !check.failure ? [] : [check.failure]));
  return {
    ok: failures.length === 0,
    checks,
    failures,
  };
}

export function formatContractReport(result: LocalDbContractResult): string {
  const lines: string[] = [
    result.ok ? "[PASS] local DB contract check passed" : "[FAIL] local DB contract check failed",
  ];

  for (const check of result.checks) {
    lines.push(`${check.ok ? "✓" : "✗"} ${check.label}`);
    if (!check.ok && check.failure) {
      lines.push(`  -> ${check.failure}`);
    }
  }

  if (!result.ok) {
    lines.push(`Summary: ${result.failures.length} failing contract item(s).`);
  }

  return lines.join("\n");
}

async function querySingleColumn(pool: Queryable, sql: string): Promise<string[]> {
  const result = await pool.query<QueryRow>(sql);
  return result.rows
    .map((row) => Object.values(row)[0])
    .filter((value): value is string => typeof value === "string");
}

async function collectExistingColumns(pool: Queryable): Promise<Record<string, string[]>> {
  const result = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'asset_hourly_metrics' AND column_name = ANY(ARRAY['pv_generation_kwh', 'grid_import_kwh', 'grid_export_kwh', 'load_consumption_kwh', 'avg_battery_soc', 'peak_battery_power_kw']))
        OR
        (table_name = 'device_command_logs' AND column_name = ANY(ARRAY['dispatched_at', 'acked_at']))
        OR
        (table_name = 'device_command_logs_archive' AND column_name = ANY(ARRAY['archived_at', 'archive_reason']))
        OR
        (table_name = 'gateway_alarm_events_archive' AND column_name = ANY(ARRAY['archived_at', 'archive_reason']))
      )
    ORDER BY table_name, column_name
  `);

  const grouped: Record<string, string[]> = {};
  for (const row of result.rows) {
    grouped[row.table_name] ??= [];
    grouped[row.table_name].push(row.column_name);
  }
  return grouped;
}

export async function probeFiveMinPartitionCreation(pool: Queryable): Promise<boolean> {
  const suffix = Date.now().toString(36);
  const partitionName = `verify_a5m_${suffix}`;
  try {
    await pool.query("BEGIN");
    await pool.query(`
      CREATE TABLE ${partitionName}
      PARTITION OF public.asset_5min_metrics
      FOR VALUES FROM ('2099-01-01T03:00:00.000Z') TO ('2099-01-02T03:00:00.000Z')
    `);
    await pool.query("ROLLBACK");
    return true;
  } catch {
    try {
      await pool.query("ROLLBACK");
    } catch {
      // ignore rollback failure; original failure is what matters
    }
    return false;
  }
}

export async function collectLocalDbContractFacts(pool: Queryable): Promise<LocalDbContractFacts> {
  const [
    existingTables,
    existingIndexes,
    existingColumns,
    schemaPrivilegeRows,
    runtimeTablePrivilegeRows,
    runtimeSnapshotSequencePrivilegeRows,
    ownerRows,
    constraintRows,
    fiveMinPartitionProbeSucceeded,
    runtimeEventsPartitions,
  ] = await Promise.all([
    querySingleColumn(
      pool,
      `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname = ANY(ARRAY[
           'asset_5min_metrics',
           'asset_hourly_metrics',
           'gateways',
           'device_command_logs',
           'device_command_logs_archive',
           'backfill_requests',
           'gateway_alarm_events',
           'gateway_alarm_events_archive',
           'ems_health',
           'runtime_events',
           'runtime_issues',
           'runtime_self_checks',
           'runtime_health_snapshots'
         ])
       ORDER BY c.relname`,
    ),
    querySingleColumn(
      pool,
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY(ARRAY[
           'idx_backfill_active',
           'idx_backfill_requests_terminal_cutoff',
           'idx_device_command_logs_retention_eligibility',
           'idx_device_command_logs_archive_archived_at',
           'device_command_logs_archive_pkey',
           'idx_gateway_alarm_events_retention_cutoff',
           'idx_gateway_alarm_events_archive_archived_at',
           'gateway_alarm_events_archive_pkey',
           'idx_telemetry_unique_asset_time',
           'idx_gae_gateway_event',
           'idx_gae_org',
           'idx_gae_status_active',
           'idx_gae_event_create_time',
           'idx_runtime_events_observed_at',
           'idx_runtime_events_fingerprint_observed',
           'idx_runtime_events_source_observed',
           'idx_runtime_events_severity_observed',
           'idx_runtime_issues_state_last_observed',
           'idx_runtime_issues_source_state',
           'idx_runtime_issues_tenant_scope_state',
           'idx_runtime_issues_active',
           'idx_runtime_issues_closed_at',
           'idx_runtime_health_snapshots_captured_at'
         ])
       ORDER BY indexname`,
    ),
    collectExistingColumns(pool),
    pool.query<{ has_create: boolean }>(
      "SELECT has_schema_privilege('solfacil_service', 'public', 'CREATE') AS has_create",
    ),
    pool.query<{ has_runtime_table_dml: boolean }>(`
      SELECT bool_and(
               has_table_privilege('solfacil_app', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE')
               AND has_table_privilege('solfacil_service', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE')
             ) AS has_runtime_table_dml
      FROM unnest(ARRAY['runtime_events', 'runtime_events_default', 'runtime_issues', 'runtime_self_checks', 'runtime_health_snapshots']) AS t(table_name)
    `),
    pool.query<{ has_runtime_snapshot_sequence_privilege: boolean }>(`
      SELECT (
        has_sequence_privilege('solfacil_app', 'public.runtime_health_snapshots_id_seq', 'USAGE,SELECT')
        AND has_sequence_privilege('solfacil_service', 'public.runtime_health_snapshots_id_seq', 'USAGE,SELECT')
      ) AS has_runtime_snapshot_sequence_privilege
    `),
    pool.query<{ owner_name: string | null }>(`
        SELECT pg_get_userbyid(c.relowner) AS owner_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'asset_5min_metrics'
        LIMIT 1
      `),
    pool.query<{ constraint_def: string | null }>(`
        SELECT pg_get_constraintdef(oid) AS constraint_def
        FROM pg_constraint
        WHERE conname = 'assets_asset_type_check'
        LIMIT 1
      `),
    probeFiveMinPartitionCreation(pool),
    querySingleColumn(
      pool,
      `SELECT child.relname AS partition_name
       FROM pg_inherits i
       JOIN pg_class parent ON parent.oid = i.inhparent
       JOIN pg_class child ON child.oid = i.inhrelid
       JOIN pg_namespace n ON n.oid = child.relnamespace
       WHERE n.nspname = 'public' AND parent.relname = 'runtime_events'
       ORDER BY child.relname`,
    ),
  ]);

  return {
    existingTables,
    existingColumns,
    existingIndexes,
    schemaCreatePrivilege: schemaPrivilegeRows.rows[0]?.has_create ?? false,
    runtimeTablesDmlPrivilege: runtimeTablePrivilegeRows.rows[0]?.has_runtime_table_dml ?? false,
    runtimeHealthSnapshotSequencePrivilege:
      runtimeSnapshotSequencePrivilegeRows.rows[0]?.has_runtime_snapshot_sequence_privilege ?? false,
    asset5MinOwner: ownerRows.rows[0]?.owner_name ?? null,
    assetTypeConstraintDef: constraintRows.rows[0]?.constraint_def ?? null,
    fiveMinPartitionProbeSucceeded,
    runtimeEventsPartitions,
  };
}

export async function runLocalDbContractVerification(pool: Queryable): Promise<LocalDbContractResult> {
  const facts = await collectLocalDbContractFacts(pool);
  return verifyLocalDbContract(facts);
}

async function main(): Promise<void> {
  const pool = getServicePool();
  try {
    const result = await runLocalDbContractVerification(pool);
    const report = formatContractReport(result);
    if (result.ok) {
      console.log(report);
    } else {
      console.error(report);
      process.exitCode = 1;
    }
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error("[verify-local-db-contract] Fatal error:", error);
    process.exitCode = 1;
  });
}
