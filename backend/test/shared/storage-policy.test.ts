import {
  getStoragePolicy,
  STORAGE_POLICY_REGISTRY,
  STORAGE_RETENTION_BATCH_LIMIT,
  STORAGE_RETENTION_EXECUTOR,
  STORAGE_RETENTION_PHASES,
} from "../../src/shared/runtime/storage-policy";

describe("storage-policy registry", () => {
  it("pins the committed executor phases and shared batch ceiling", () => {
    expect(STORAGE_RETENTION_PHASES).toEqual([
      "runtime_core",
      "runtime_issue_cleanup",
      "device_command_archive",
      "gateway_alarm_archive",
      "backfill_terminal_cleanup",
    ]);
    expect(STORAGE_RETENTION_BATCH_LIMIT).toBe(5_000);
    expect(STORAGE_RETENTION_EXECUTOR).toBe("shared.runtime.retention-job");
  });

  it("contains the committed governed surfaces and preserves revenue_daily as hot business history", () => {
    const keys = STORAGE_POLICY_REGISTRY.map((entry) => entry.key);
    expect(keys).toEqual([
      "docker_logs",
      "runtime_events",
      "runtime_health_snapshots",
      "runtime_issues_closed",
      "device_command_logs",
      "gateway_alarm_events",
      "backfill_requests_terminal",
      "revenue_daily",
    ]);

    const revenue = getStoragePolicy("revenue_daily");
    expect(revenue?.storageClass).toBe("business_history");
    expect(revenue?.executorPhase).toBeNull();
    expect(revenue?.retentionRule).toMatch(/no retention executor action/i);
  });

  it("pins the exact device-command eligibility rule and archive tables", () => {
    const device = getStoragePolicy("device_command_logs");
    const gateway = getStoragePolicy("gateway_alarm_events");
    const backfill = getStoragePolicy("backfill_requests_terminal");
    const closedIssues = getStoragePolicy("runtime_issues_closed");

    expect(device).toBeDefined();
    expect(device?.hotWindowDays).toBe(90);
    expect(device?.archiveTable).toBe("device_command_logs_archive");
    expect(device?.retentionRule).toContain(
      "result IN ('success','fail','timeout') OR resolved_at IS NOT NULL",
    );
    expect(device?.retentionRule).not.toMatch(/pending|dispatched|accepted/i);

    expect(gateway?.hotWindowDays).toBe(180);
    expect(gateway?.archiveTable).toBe("gateway_alarm_events_archive");

    expect(backfill?.deleteAfterDays).toBe(14);
    expect(backfill?.archiveTable).toBeNull();
    expect(backfill?.retentionRule).toMatch(/COALESCE\(completed_at, created_at\)/i);

    expect(closedIssues?.deleteAfterDays).toBe(30);
    expect(closedIssues?.archiveTable).toBeNull();
  });
});
