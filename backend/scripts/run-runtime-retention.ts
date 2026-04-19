/**
 * Ad-hoc runtime retention executor (v6.10 WS10).
 *
 * Invoked by operators during release smoke or on-call drills to force one
 * retention pass without waiting for the in-process scheduler. Respects the
 * global governance flag — if governance is off, this prints a disabled-mode
 * report and exits 0 without touching the DB.
 *
 * Usage:
 *   RUNTIME_GOVERNANCE_ENABLED=true ts-node scripts/run-runtime-retention.ts
 */

import { closeAllPools } from "../src/shared/db";
import { parseRuntimeFlags } from "../src/shared/runtime/flags";
import {
  runRuntimeRetention,
  type RetentionRunResult,
} from "../src/shared/runtime/retention-job";

export interface RuntimeRetentionCliReport {
  readonly runtime_retention: RetentionRunResult;
  readonly phases: {
    readonly issue_auto_close: {
      readonly recovered: number;
      readonly stale: number;
    };
    readonly runtime_cleanup: {
      readonly events_deleted: number;
      readonly snapshots_deleted: number;
      readonly closed_issues_deleted: number;
    };
    readonly storage_retention: {
      readonly device_command_logs: {
        readonly archived: number;
        readonly deleted: number;
      };
      readonly gateway_alarm_events: {
        readonly archived: number;
        readonly deleted: number;
      };
      readonly backfill_requests: {
        readonly deleted: number;
      };
    };
  };
}

export function buildRuntimeRetentionCliReport(
  result: RetentionRunResult,
): RuntimeRetentionCliReport {
  return Object.freeze({
    runtime_retention: result,
    phases: Object.freeze({
      issue_auto_close: Object.freeze({
        recovered: result.recoveredAutoClosed,
        stale: result.staleAutoClosed,
      }),
      runtime_cleanup: Object.freeze({
        events_deleted: result.eventsDeleted,
        snapshots_deleted: result.snapshotsDeleted,
        closed_issues_deleted: result.closedIssuesDeleted,
      }),
      storage_retention: Object.freeze({
        device_command_logs: Object.freeze({
          archived: result.deviceCommandLogsArchived,
          deleted: result.deviceCommandLogsDeleted,
        }),
        gateway_alarm_events: Object.freeze({
          archived: result.gatewayAlarmEventsArchived,
          deleted: result.gatewayAlarmEventsDeleted,
        }),
        backfill_requests: Object.freeze({
          deleted: result.backfillRequestsDeleted,
        }),
      }),
    }),
  });
}

function printJson(payload: unknown, stream: "stdout" | "stderr" = "stdout"): void {
  const line = `${JSON.stringify(payload)}\n`;
  if (stream === "stderr") {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

async function main(): Promise<void> {
  const flags = parseRuntimeFlags(process.env);
  const result = await runRuntimeRetention({ flags });
  printJson(buildRuntimeRetentionCliReport(result));
  await closeAllPools();
  process.exit(result.status === "degraded_fallback" ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    const error = err instanceof Error ? err.message : String(err);
    printJson(
      {
        runtime_retention: {
          status: "degraded_fallback",
          errors: [{ phase: "orchestrator", error }],
        },
      },
      "stderr",
    );
    void closeAllPools().finally(() => process.exit(1));
  });
}
