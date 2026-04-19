import type { RuntimeFlags } from "./flags";
import {
  emitRuntimeGovernanceEvent,
  type EmitRuntimeGovernanceResult,
} from "./emit";
import {
  fetchActiveRuntimeIssues,
  runWithServicePool,
  upsertRuntimeIssue,
  type RuntimeQueryable,
} from "./persistence";
import { applyOperatorClose } from "./projection";
import {
  getStoragePolicy,
  STORAGE_RETENTION_BATCH_LIMIT,
} from "./storage-policy";
import type { RuntimeIssue } from "../types/runtime";

export interface RetentionDefaults {
  readonly recoveredAutoCloseMs: number;
  readonly staleAutoCloseMs: number;
  readonly eventRetentionMs: number;
  readonly snapshotRetentionMs: number;
  readonly closedIssueRetentionMs: number;
  readonly deviceCommandHotRetentionMs: number;
  readonly gatewayAlarmHotRetentionMs: number;
  readonly backfillTerminalRetentionMs: number;
  readonly batchLimit: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const runtimeEventsPolicy = getStoragePolicy("runtime_events");
const snapshotsPolicy = getStoragePolicy("runtime_health_snapshots");
const closedIssuesPolicy = getStoragePolicy("runtime_issues_closed");
const deviceCommandPolicy = getStoragePolicy("device_command_logs");
const gatewayAlarmPolicy = getStoragePolicy("gateway_alarm_events");
const backfillPolicy = getStoragePolicy("backfill_requests_terminal");

export const DEFAULT_RETENTION: RetentionDefaults = Object.freeze({
  recoveredAutoCloseMs: 24 * HOUR_MS,
  staleAutoCloseMs: 72 * HOUR_MS,
  eventRetentionMs: (runtimeEventsPolicy?.deleteAfterDays ?? 90) * DAY_MS,
  snapshotRetentionMs: (snapshotsPolicy?.deleteAfterDays ?? 30) * DAY_MS,
  closedIssueRetentionMs: (closedIssuesPolicy?.deleteAfterDays ?? 30) * DAY_MS,
  deviceCommandHotRetentionMs: (deviceCommandPolicy?.hotWindowDays ?? 90) * DAY_MS,
  gatewayAlarmHotRetentionMs: (gatewayAlarmPolicy?.hotWindowDays ?? 180) * DAY_MS,
  backfillTerminalRetentionMs: (backfillPolicy?.deleteAfterDays ?? 14) * DAY_MS,
  batchLimit: STORAGE_RETENTION_BATCH_LIMIT,
});

export interface RetentionCutoffs {
  readonly recoveredAutoCloseAt: Date;
  readonly staleAutoCloseAt: Date;
  readonly eventCutoffAt: Date;
  readonly snapshotCutoffAt: Date;
  readonly closedIssueCutoffAt: Date;
  readonly deviceCommandCutoffAt: Date;
  readonly gatewayAlarmCutoffAt: Date;
  readonly backfillCutoffAt: Date;
}

export function computeRetentionCutoffs(
  now: Date,
  defaults: RetentionDefaults = DEFAULT_RETENTION,
): RetentionCutoffs {
  const t = now.getTime();
  return Object.freeze({
    recoveredAutoCloseAt: new Date(t - defaults.recoveredAutoCloseMs),
    staleAutoCloseAt: new Date(t - defaults.staleAutoCloseMs),
    eventCutoffAt: new Date(t - defaults.eventRetentionMs),
    snapshotCutoffAt: new Date(t - defaults.snapshotRetentionMs),
    closedIssueCutoffAt: new Date(t - defaults.closedIssueRetentionMs),
    deviceCommandCutoffAt: new Date(t - defaults.deviceCommandHotRetentionMs),
    gatewayAlarmCutoffAt: new Date(t - defaults.gatewayAlarmHotRetentionMs),
    backfillCutoffAt: new Date(t - defaults.backfillTerminalRetentionMs),
  });
}

export function selectRecoveredForAutoClose(
  issues: readonly RuntimeIssue[],
  cutoff: Date,
): readonly RuntimeIssue[] {
  const cutoffMs = cutoff.getTime();
  return issues.filter((issue) => {
    if (issue.state !== "recovered") {
      return false;
    }
    if (issue.recovered_at === null) {
      return false;
    }
    const ts = Date.parse(issue.recovered_at);
    if (Number.isNaN(ts)) {
      return false;
    }
    return ts < cutoffMs;
  });
}

export function selectStaleForAutoClose(
  issues: readonly RuntimeIssue[],
  cutoff: Date,
): readonly RuntimeIssue[] {
  const cutoffMs = cutoff.getTime();
  return issues.filter((issue) => {
    if (issue.state !== "detected" && issue.state !== "ongoing") {
      return false;
    }
    const ts = Date.parse(issue.last_observed_at);
    if (Number.isNaN(ts)) {
      return false;
    }
    return ts < cutoffMs;
  });
}

export interface RetentionOptions {
  readonly flags: RuntimeFlags;
  readonly now?: Date;
  readonly cutoffs?: RetentionCutoffs;
  readonly defaults?: RetentionDefaults;
  readonly client?: RuntimeQueryable;
  readonly logger?: (line: string) => void;
}

export type RetentionPhase =
  | "fetch_active"
  | "auto_close_recovered"
  | "auto_close_stale"
  | "delete_events"
  | "delete_snapshots"
  | "delete_closed_runtime_issues"
  | "archive_device_command_logs"
  | "archive_gateway_alarm_events"
  | "delete_terminal_backfill_requests"
  | "orchestrator";

export interface RetentionPhaseError {
  readonly phase: RetentionPhase;
  readonly error: string;
  readonly fingerprint?: string;
}

export type RetentionRunStatus = "disabled" | "completed" | "degraded_fallback";

export interface RetentionRunResult {
  readonly status: RetentionRunStatus;
  readonly recoveredAutoClosed: number;
  readonly staleAutoClosed: number;
  readonly eventsDeleted: number;
  readonly snapshotsDeleted: number;
  readonly closedIssuesDeleted: number;
  readonly deviceCommandLogsArchived: number;
  readonly deviceCommandLogsDeleted: number;
  readonly gatewayAlarmEventsArchived: number;
  readonly gatewayAlarmEventsDeleted: number;
  readonly backfillRequestsDeleted: number;
  readonly errors: readonly RetentionPhaseError[];
}

interface ArchivePhaseCounts {
  readonly archived: number;
  readonly deleted: number;
}

const DEVICE_COMMAND_ARCHIVE_REASON = "storage_retention_v6_10_1_hot_window_elapsed";
const GATEWAY_ALARM_ARCHIVE_REASON = "storage_retention_v6_10_1_hot_window_elapsed";
const EXECUTOR_FAILED_EVENT_CODE = "storage.retention.executor.failed";
const EXECUTOR_FAILED_SOURCE = "shared.runtime";

function zeroResult(status: RetentionRunStatus, errors: readonly RetentionPhaseError[] = []): RetentionRunResult {
  return Object.freeze({
    status,
    recoveredAutoClosed: 0,
    staleAutoClosed: 0,
    eventsDeleted: 0,
    snapshotsDeleted: 0,
    closedIssuesDeleted: 0,
    deviceCommandLogsArchived: 0,
    deviceCommandLogsDeleted: 0,
    gatewayAlarmEventsArchived: 0,
    gatewayAlarmEventsDeleted: 0,
    backfillRequestsDeleted: 0,
    errors: Object.freeze([...errors]),
  });
}

function coerceErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return typeof err === "string" ? err : "runtime-retention: unknown error";
}

function emitFallbackLog(
  logger: ((line: string) => void) | undefined,
  payload: Record<string, unknown>,
): void {
  const line = `[runtime-retention:fallback] ${JSON.stringify(payload)}`;
  if (logger) {
    try {
      logger(line);
    } catch {
      // never let a logger bug bubble up
    }
    return;
  }
  // eslint-disable-next-line no-console
  console.error(line);
}

const RECOVERED_AUTO_CLOSE_NOTE =
  "auto-closed by runtime retention (recovered TTL elapsed)";
const STALE_AUTO_CLOSE_NOTE =
  "auto-closed by runtime retention (stale: no new observation within TTL)";
const AUTO_CLOSE_ACTOR = "system.retention";

async function autoCloseIssues(
  client: RuntimeQueryable,
  issues: readonly RuntimeIssue[],
  note: string,
  now: Date,
  phase: "auto_close_recovered" | "auto_close_stale",
  errors: RetentionPhaseError[],
  logger: ((line: string) => void) | undefined,
): Promise<number> {
  let closed = 0;
  for (const issue of issues) {
    try {
      const next = applyOperatorClose(issue, {
        actor: AUTO_CLOSE_ACTOR,
        note,
        now,
      });
      await upsertRuntimeIssue(client, next);
      closed += 1;
    } catch (err) {
      const message = coerceErrorMessage(err);
      errors.push({ phase, error: message, fingerprint: issue.fingerprint });
      emitFallbackLog(logger, {
        phase,
        fingerprint: issue.fingerprint,
        event_code: issue.event_code,
        source: issue.source,
        error: message,
      });
    }
  }
  return closed;
}

async function deleteEventsOlderThan(
  client: RuntimeQueryable,
  cutoff: Date,
): Promise<number> {
  const { rows } = await client.query(
    "DELETE FROM runtime_events WHERE observed_at < $1 RETURNING 1",
    [cutoff.toISOString()],
  );
  return rows.length;
}

async function deleteSnapshotsOlderThan(
  client: RuntimeQueryable,
  cutoff: Date,
): Promise<number> {
  const { rows } = await client.query(
    "DELETE FROM runtime_health_snapshots WHERE captured_at < $1 RETURNING 1",
    [cutoff.toISOString()],
  );
  return rows.length;
}

async function deleteClosedRuntimeIssuesOlderThan(
  client: RuntimeQueryable,
  cutoff: Date,
  batchLimit: number,
): Promise<number> {
  const { rows } = await client.query<{ deleted_count: number | string }>(
    `WITH candidate AS (
       SELECT fingerprint
       FROM runtime_issues
       WHERE state = 'closed'
         AND closed_at IS NOT NULL
         AND closed_at < $1
       ORDER BY closed_at ASC, fingerprint ASC
       LIMIT $2
     ), deleted AS (
       DELETE FROM runtime_issues r
       USING candidate c
       WHERE r.fingerprint = c.fingerprint
       RETURNING 1
     )
     SELECT COUNT(*)::int AS deleted_count FROM deleted`,
    [cutoff.toISOString(), batchLimit],
  );
  return Number(rows[0]?.deleted_count ?? 0);
}

async function archiveDeviceCommandLogs(
  client: RuntimeQueryable,
  cutoff: Date,
  now: Date,
  batchLimit: number,
): Promise<ArchivePhaseCounts> {
  const { rows } = await client.query<{
    archived_count: number | string;
    deleted_count: number | string;
  }>(
    `WITH candidate AS (
       SELECT
         id,
         gateway_id,
         command_type,
         config_name,
         message_id,
         payload_json,
         result,
         error_message,
         device_timestamp,
         resolved_at,
         created_at,
         dispatched_at,
         acked_at
       FROM device_command_logs
       WHERE created_at < $1
         AND (
           result IN ('success', 'fail', 'timeout')
           OR resolved_at IS NOT NULL
         )
       ORDER BY created_at ASC, id ASC
       LIMIT $2
     ), archived AS (
       INSERT INTO device_command_logs_archive (
         id,
         gateway_id,
         command_type,
         config_name,
         message_id,
         payload_json,
         result,
         error_message,
         device_timestamp,
         resolved_at,
         created_at,
         dispatched_at,
         acked_at,
         archived_at,
         archive_reason
       )
       SELECT
         id,
         gateway_id,
         command_type,
         config_name,
         message_id,
         payload_json,
         result,
         error_message,
         device_timestamp,
         resolved_at,
         created_at,
         dispatched_at,
         acked_at,
         $3,
         $4
       FROM candidate
       ON CONFLICT (id) DO NOTHING
       RETURNING id
     ), deleted AS (
       DELETE FROM device_command_logs hot
       USING candidate c
       WHERE hot.id = c.id
         AND EXISTS (
           SELECT 1
           FROM device_command_logs_archive archive
           WHERE archive.id = hot.id
         )
       RETURNING hot.id
     )
     SELECT
       (SELECT COUNT(*)::int FROM archived) AS archived_count,
       (SELECT COUNT(*)::int FROM deleted) AS deleted_count`,
    [
      cutoff.toISOString(),
      batchLimit,
      now.toISOString(),
      DEVICE_COMMAND_ARCHIVE_REASON,
    ],
  );
  return {
    archived: Number(rows[0]?.archived_count ?? 0),
    deleted: Number(rows[0]?.deleted_count ?? 0),
  };
}

async function archiveGatewayAlarmEvents(
  client: RuntimeQueryable,
  cutoff: Date,
  now: Date,
  batchLimit: number,
): Promise<ArchivePhaseCounts> {
  const { rows } = await client.query<{
    archived_count: number | string;
    deleted_count: number | string;
  }>(
    `WITH candidate AS (
       SELECT
         id,
         gateway_id,
         org_id,
         device_sn,
         sub_dev_id,
         sub_dev_name,
         product_type,
         event_id,
         event_name,
         event_type,
         level,
         status,
         prop_id,
         prop_name,
         prop_value,
         description,
         event_create_time,
         event_update_time,
         created_at
       FROM gateway_alarm_events
       WHERE event_create_time < $1
       ORDER BY event_create_time ASC, id ASC
       LIMIT $2
     ), archived AS (
       INSERT INTO gateway_alarm_events_archive (
         id,
         gateway_id,
         org_id,
         device_sn,
         sub_dev_id,
         sub_dev_name,
         product_type,
         event_id,
         event_name,
         event_type,
         level,
         status,
         prop_id,
         prop_name,
         prop_value,
         description,
         event_create_time,
         event_update_time,
         created_at,
         archived_at,
         archive_reason
       )
       SELECT
         id,
         gateway_id,
         org_id,
         device_sn,
         sub_dev_id,
         sub_dev_name,
         product_type,
         event_id,
         event_name,
         event_type,
         level,
         status,
         prop_id,
         prop_name,
         prop_value,
         description,
         event_create_time,
         event_update_time,
         created_at,
         $3,
         $4
       FROM candidate
       ON CONFLICT (id) DO NOTHING
       RETURNING id
     ), deleted AS (
       DELETE FROM gateway_alarm_events hot
       USING candidate c
       WHERE hot.id = c.id
         AND EXISTS (
           SELECT 1
           FROM gateway_alarm_events_archive archive
           WHERE archive.id = hot.id
         )
       RETURNING hot.id
     )
     SELECT
       (SELECT COUNT(*)::int FROM archived) AS archived_count,
       (SELECT COUNT(*)::int FROM deleted) AS deleted_count`,
    [
      cutoff.toISOString(),
      batchLimit,
      now.toISOString(),
      GATEWAY_ALARM_ARCHIVE_REASON,
    ],
  );
  return {
    archived: Number(rows[0]?.archived_count ?? 0),
    deleted: Number(rows[0]?.deleted_count ?? 0),
  };
}

async function deleteTerminalBackfillRequests(
  client: RuntimeQueryable,
  cutoff: Date,
  batchLimit: number,
): Promise<number> {
  const { rows } = await client.query<{ deleted_count: number | string }>(
    `WITH candidate AS (
       SELECT id
       FROM backfill_requests
       WHERE status IN ('completed', 'failed')
         AND COALESCE(completed_at, created_at) < $1
       ORDER BY COALESCE(completed_at, created_at) ASC, id ASC
       LIMIT $2
     ), deleted AS (
       DELETE FROM backfill_requests b
       USING candidate c
       WHERE b.id = c.id
       RETURNING 1
     )
     SELECT COUNT(*)::int AS deleted_count FROM deleted`,
    [cutoff.toISOString(), batchLimit],
  );
  return Number(rows[0]?.deleted_count ?? 0);
}

async function runWithClient(
  options: RetentionOptions,
  fn: (client: RuntimeQueryable) => Promise<RetentionRunResult>,
): Promise<RetentionRunResult> {
  if (options.client) {
    return fn(options.client);
  }
  return runWithServicePool((client) => fn(client));
}

async function reportExecutorFailure(
  options: RetentionOptions,
  phase: RetentionPhase,
  error: string,
  now: Date,
): Promise<EmitRuntimeGovernanceResult> {
  try {
    return await emitRuntimeGovernanceEvent(
      {
        event_code: EXECUTOR_FAILED_EVENT_CODE,
        source: EXECUTOR_FAILED_SOURCE,
        summary: `Storage retention executor failed during ${phase}: ${error}`,
        detail: {
          phase,
          error,
          storage_retention_executor: true,
        },
        dedup_keys: { phase },
      },
      {
        flags: options.flags,
        client: options.client,
        logger: options.logger,
        now,
      },
    );
  } catch (emitErr) {
    emitFallbackLog(options.logger, {
      phase: "emit_executor_failure",
      failed_phase: phase,
      error,
      emit_error: coerceErrorMessage(emitErr),
    });
    return { status: "degraded_fallback" };
  }
}

async function capturePhaseFailure(
  options: RetentionOptions,
  errors: RetentionPhaseError[],
  phase: RetentionPhase,
  err: unknown,
  now: Date,
): Promise<void> {
  const message = coerceErrorMessage(err);
  errors.push({ phase, error: message });
  emitFallbackLog(options.logger, { phase, error: message });
  await reportExecutorFailure(options, phase, message, now);
}

export async function runRuntimeRetention(
  options: RetentionOptions,
): Promise<RetentionRunResult> {
  if (!options.flags.governanceEnabled) {
    return zeroResult("disabled");
  }

  const now = options.now ?? new Date();
  const defaults = options.defaults ?? DEFAULT_RETENTION;
  const cutoffs = options.cutoffs ?? computeRetentionCutoffs(now, defaults);

  try {
    return await runWithClient(options, async (client) => {
      const errors: RetentionPhaseError[] = [];

      let recoveredAutoClosed = 0;
      let staleAutoClosed = 0;
      let eventsDeleted = 0;
      let snapshotsDeleted = 0;
      let closedIssuesDeleted = 0;
      let deviceCommandLogsArchived = 0;
      let deviceCommandLogsDeleted = 0;
      let gatewayAlarmEventsArchived = 0;
      let gatewayAlarmEventsDeleted = 0;
      let backfillRequestsDeleted = 0;

      let active: readonly RuntimeIssue[] = [];
      try {
        active = await fetchActiveRuntimeIssues(client);
      } catch (err) {
        await capturePhaseFailure(options, errors, "fetch_active", err, now);
      }

      const recoveredToClose = selectRecoveredForAutoClose(
        active,
        cutoffs.recoveredAutoCloseAt,
      );
      recoveredAutoClosed = await autoCloseIssues(
        client,
        recoveredToClose,
        RECOVERED_AUTO_CLOSE_NOTE,
        now,
        "auto_close_recovered",
        errors,
        options.logger,
      );

      const staleToClose = selectStaleForAutoClose(active, cutoffs.staleAutoCloseAt);
      staleAutoClosed = await autoCloseIssues(
        client,
        staleToClose,
        STALE_AUTO_CLOSE_NOTE,
        now,
        "auto_close_stale",
        errors,
        options.logger,
      );

      try {
        eventsDeleted = await deleteEventsOlderThan(client, cutoffs.eventCutoffAt);
      } catch (err) {
        await capturePhaseFailure(options, errors, "delete_events", err, now);
      }

      try {
        snapshotsDeleted = await deleteSnapshotsOlderThan(client, cutoffs.snapshotCutoffAt);
      } catch (err) {
        await capturePhaseFailure(options, errors, "delete_snapshots", err, now);
      }

      try {
        closedIssuesDeleted = await deleteClosedRuntimeIssuesOlderThan(
          client,
          cutoffs.closedIssueCutoffAt,
          defaults.batchLimit,
        );
      } catch (err) {
        await capturePhaseFailure(options, errors, "delete_closed_runtime_issues", err, now);
      }

      try {
        const counts = await archiveDeviceCommandLogs(
          client,
          cutoffs.deviceCommandCutoffAt,
          now,
          defaults.batchLimit,
        );
        deviceCommandLogsArchived = counts.archived;
        deviceCommandLogsDeleted = counts.deleted;
      } catch (err) {
        await capturePhaseFailure(options, errors, "archive_device_command_logs", err, now);
      }

      try {
        const counts = await archiveGatewayAlarmEvents(
          client,
          cutoffs.gatewayAlarmCutoffAt,
          now,
          defaults.batchLimit,
        );
        gatewayAlarmEventsArchived = counts.archived;
        gatewayAlarmEventsDeleted = counts.deleted;
      } catch (err) {
        await capturePhaseFailure(options, errors, "archive_gateway_alarm_events", err, now);
      }

      try {
        backfillRequestsDeleted = await deleteTerminalBackfillRequests(
          client,
          cutoffs.backfillCutoffAt,
          defaults.batchLimit,
        );
      } catch (err) {
        await capturePhaseFailure(options, errors, "delete_terminal_backfill_requests", err, now);
      }

      return Object.freeze({
        status: errors.length === 0 ? "completed" : "degraded_fallback",
        recoveredAutoClosed,
        staleAutoClosed,
        eventsDeleted,
        snapshotsDeleted,
        closedIssuesDeleted,
        deviceCommandLogsArchived,
        deviceCommandLogsDeleted,
        gatewayAlarmEventsArchived,
        gatewayAlarmEventsDeleted,
        backfillRequestsDeleted,
        errors: Object.freeze([...errors]),
      });
    });
  } catch (err) {
    const message = coerceErrorMessage(err);
    emitFallbackLog(options.logger, {
      phase: "orchestrator",
      error: message,
    });
    await reportExecutorFailure(options, "orchestrator", message, now);
    return zeroResult("degraded_fallback", [{ phase: "orchestrator", error: message }]);
  }
}
