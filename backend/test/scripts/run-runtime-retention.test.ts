import {
  buildRuntimeRetentionCliReport,
  type RuntimeRetentionCliReport,
} from "../../scripts/run-runtime-retention";
import type { RetentionRunResult } from "../../src/shared/runtime/retention-job";

describe("run-runtime-retention script helpers", () => {
  it("builds a machine-readable report with the extended shared executor envelope", () => {
    const result: RetentionRunResult = Object.freeze({
      status: "degraded_fallback",
      recoveredAutoClosed: 1,
      staleAutoClosed: 2,
      eventsDeleted: 3,
      snapshotsDeleted: 4,
      closedIssuesDeleted: 5,
      deviceCommandLogsArchived: 6,
      deviceCommandLogsDeleted: 7,
      gatewayAlarmEventsArchived: 8,
      gatewayAlarmEventsDeleted: 9,
      backfillRequestsDeleted: 10,
      errors: Object.freeze([
        Object.freeze({ phase: "archive_device_command_logs", error: "archive failed" }),
      ]),
    });

    const report: RuntimeRetentionCliReport = buildRuntimeRetentionCliReport(result);

    expect(report.runtime_retention).toBe(result);
    expect(report.phases.issue_auto_close).toEqual({
      recovered: 1,
      stale: 2,
    });
    expect(report.phases.runtime_cleanup).toEqual({
      events_deleted: 3,
      snapshots_deleted: 4,
      closed_issues_deleted: 5,
    });
    expect(report.phases.storage_retention).toEqual({
      device_command_logs: { archived: 6, deleted: 7 },
      gateway_alarm_events: { archived: 8, deleted: 9 },
      backfill_requests: { deleted: 10 },
    });
    expect(report.runtime_retention.errors).toEqual([
      { phase: "archive_device_command_logs", error: "archive failed" },
    ]);
    expect(JSON.parse(JSON.stringify(report))).toEqual({
      runtime_retention: result,
      phases: {
        issue_auto_close: { recovered: 1, stale: 2 },
        runtime_cleanup: {
          events_deleted: 3,
          snapshots_deleted: 4,
          closed_issues_deleted: 5,
        },
        storage_retention: {
          device_command_logs: { archived: 6, deleted: 7 },
          gateway_alarm_events: { archived: 8, deleted: 9 },
          backfill_requests: { deleted: 10 },
        },
      },
    });
  });
});
