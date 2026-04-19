export type StorageClass =
  | "volatile_runtime_log"
  | "runtime_governance_history"
  | "runtime_governance_projection"
  | "operational_history"
  | "queue_residue"
  | "business_history"
  | "audit_archive";

export type StorageRetentionExecutorPhase =
  | "runtime_core"
  | "runtime_issue_cleanup"
  | "device_command_archive"
  | "gateway_alarm_archive"
  | "backfill_terminal_cleanup";

export interface StoragePolicyEntry {
  readonly key: string;
  readonly surface: string;
  readonly storageClass: StorageClass;
  readonly owner: string;
  readonly hotPosture: string;
  readonly archivePosture: string;
  readonly retentionRule: string;
  readonly executor: string;
  readonly executorPhase: StorageRetentionExecutorPhase | null;
  readonly rollbackBehavior: string;
  readonly hotWindowDays: number | null;
  readonly deleteAfterDays: number | null;
  readonly archiveTable: string | null;
}

export const STORAGE_RETENTION_BATCH_LIMIT = 5_000;
export const STORAGE_RETENTION_EXECUTOR = "shared.runtime.retention-job" as const;

export const STORAGE_RETENTION_PHASES: readonly StorageRetentionExecutorPhase[] = Object.freeze([
  "runtime_core",
  "runtime_issue_cleanup",
  "device_command_archive",
  "gateway_alarm_archive",
  "backfill_terminal_cleanup",
] as const);

export const STORAGE_POLICY_REGISTRY: readonly StoragePolicyEntry[] = Object.freeze([
  Object.freeze({
    key: "docker_logs",
    surface: "Docker container logs (solfacil-bff, solfacil-db, solfacil-m1, solfacil-redis)",
    storageClass: "volatile_runtime_log",
    owner: "platform.runtime",
    hotPosture: "bounded in-place rotation",
    archivePosture: "rotate in place; no DB archive",
    retentionRule: "json-file max-size=10m, max-file=5 on all four Solfacil containers",
    executor: "compose/runtime config",
    executorPhase: null,
    rollbackBehavior: "configuration-only rollback; no schema mutation",
    hotWindowDays: null,
    deleteAfterDays: null,
    archiveTable: null,
  }),
  Object.freeze({
    key: "runtime_events",
    surface: "runtime_events",
    storageClass: "runtime_governance_history",
    owner: "m9.shared",
    hotPosture: "time-window bounded hot history",
    archivePosture: "direct delete after cutoff",
    retentionRule: "delete rows where observed_at < now - 90 days",
    executor: STORAGE_RETENTION_EXECUTOR,
    executorPhase: "runtime_core",
    rollbackBehavior: "stop executor; retain additive schema/data already present",
    hotWindowDays: 90,
    deleteAfterDays: 90,
    archiveTable: null,
  }),
  Object.freeze({
    key: "runtime_health_snapshots",
    surface: "runtime_health_snapshots",
    storageClass: "runtime_governance_history",
    owner: "m9.shared",
    hotPosture: "time-window bounded hot history",
    archivePosture: "direct delete after cutoff",
    retentionRule: "delete rows where captured_at < now - 30 days",
    executor: STORAGE_RETENTION_EXECUTOR,
    executorPhase: "runtime_core",
    rollbackBehavior: "stop executor; retain additive schema/data already present",
    hotWindowDays: 30,
    deleteAfterDays: 30,
    archiveTable: null,
  }),
  Object.freeze({
    key: "runtime_issues_closed",
    surface: "runtime_issues (closed rows only)",
    storageClass: "runtime_governance_projection",
    owner: "m9.shared",
    hotPosture: "active/recovered/suppressed rows stay hot",
    archivePosture: "direct delete after closed-row cutoff",
    retentionRule: "delete rows where state='closed' and closed_at < now - 30 days",
    executor: STORAGE_RETENTION_EXECUTOR,
    executorPhase: "runtime_issue_cleanup",
    rollbackBehavior: "stop executor; retain additive schema/data already present",
    hotWindowDays: 30,
    deleteAfterDays: 30,
    archiveTable: null,
  }),
  Object.freeze({
    key: "device_command_logs",
    surface: "device_command_logs",
    storageClass: "operational_history",
    owner: "m5.bff",
    hotPosture: "90-day hot operational history",
    archivePosture: "archive-first to device_command_logs_archive then delete hot row",
    retentionRule:
      "created_at < now - 90 days AND (result IN ('success','fail','timeout') OR resolved_at IS NOT NULL)",
    executor: STORAGE_RETENTION_EXECUTOR,
    executorPhase: "device_command_archive",
    rollbackBehavior: "stop executor; retain archive tables and archived rows in place",
    hotWindowDays: 90,
    deleteAfterDays: 90,
    archiveTable: "device_command_logs_archive",
  }),
  Object.freeze({
    key: "gateway_alarm_events",
    surface: "gateway_alarm_events",
    storageClass: "operational_history",
    owner: "m1.iot-hub",
    hotPosture: "180-day hot operational history",
    archivePosture: "archive-first to gateway_alarm_events_archive then delete hot row",
    retentionRule: "event_create_time < now - 180 days",
    executor: STORAGE_RETENTION_EXECUTOR,
    executorPhase: "gateway_alarm_archive",
    rollbackBehavior: "stop executor; retain archive tables and archived rows in place",
    hotWindowDays: 180,
    deleteAfterDays: 180,
    archiveTable: "gateway_alarm_events_archive",
  }),
  Object.freeze({
    key: "backfill_requests_terminal",
    surface: "backfill_requests (terminal rows only)",
    storageClass: "queue_residue",
    owner: "m1.iot-hub",
    hotPosture: "active rows retained in hot queue",
    archivePosture: "direct delete only; no archive table",
    retentionRule:
      "status IN ('completed','failed') AND COALESCE(completed_at, created_at) < now - 14 days",
    executor: STORAGE_RETENTION_EXECUTOR,
    executorPhase: "backfill_terminal_cleanup",
    rollbackBehavior: "stop executor; retain additive schema/data already present",
    hotWindowDays: 14,
    deleteAfterDays: 14,
    archiveTable: null,
  }),
  Object.freeze({
    key: "revenue_daily",
    surface: "revenue_daily",
    storageClass: "business_history",
    owner: "m4.billing",
    hotPosture: "preserve in hot storage",
    archivePosture: "no archive or TTL in v6.10.1",
    retentionRule: "preserve in hot storage; no retention executor action in v6.10.1",
    executor: "none in this release",
    executorPhase: null,
    rollbackBehavior: "no-op; table remains untouched by storage retention hardening",
    hotWindowDays: null,
    deleteAfterDays: null,
    archiveTable: null,
  }),
] as const);

export const STORAGE_POLICY_BY_KEY: ReadonlyMap<string, StoragePolicyEntry> = new Map(
  STORAGE_POLICY_REGISTRY.map((entry) => [entry.key, entry]),
);

export function getStoragePolicy(key: string): StoragePolicyEntry | undefined {
  return STORAGE_POLICY_BY_KEY.get(key);
}
