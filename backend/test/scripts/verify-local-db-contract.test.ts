import {
  formatContractReport,
  type LocalDbContractFacts,
  verifyLocalDbContract,
} from "../../scripts/verify-local-db-contract";

describe("verify-local-db-contract", () => {
  function buildFacts(overrides: Partial<LocalDbContractFacts> = {}): LocalDbContractFacts {
    return {
      existingTables: [
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
      ],
      existingColumns: {
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
      },
      existingIndexes: [
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
      ],
      schemaCreatePrivilege: true,
      runtimeTablesDmlPrivilege: true,
      runtimeHealthSnapshotSequencePrivilege: true,
      asset5MinOwner: "solfacil_service",
      assetTypeConstraintDef:
        "CHECK (((asset_type)::text = ANY ((ARRAY['INVERTER_BATTERY'::character varying, 'SMART_METER'::character varying, 'HVAC'::character varying, 'EV_CHARGER'::character varying, 'SOLAR_PANEL'::character varying, 'ESS'::character varying])::text[])))",
      fiveMinPartitionProbeSucceeded: true,
      runtimeEventsPartitions: [
        "runtime_events_default",
        "runtime_events_202604",
        "runtime_events_202605",
      ],
      ...overrides,
    };
  }

  it("passes when the canonical local DB contract is satisfied", () => {
    const result = verifyLocalDbContract(buildFacts());

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("reports exact failing contract items", () => {
    const result = verifyLocalDbContract(
      buildFacts({
        existingTables: [
          "asset_5min_metrics",
          "asset_hourly_metrics",
          "gateways",
          "device_command_logs",
          "backfill_requests",
        ],
        existingColumns: {
          asset_hourly_metrics: ["pv_generation_kwh", "grid_import_kwh"],
          device_command_logs: ["dispatched_at"],
          device_command_logs_archive: ["archived_at"],
        },
        existingIndexes: ["idx_backfill_active"],
        schemaCreatePrivilege: false,
        runtimeTablesDmlPrivilege: false,
        runtimeHealthSnapshotSequencePrivilege: false,
        asset5MinOwner: "postgres",
        assetTypeConstraintDef: "CHECK ((asset_type)::text = ANY ((ARRAY['INVERTER_BATTERY'::text, 'SMART_METER'::text])))",
        fiveMinPartitionProbeSucceeded: false,
        runtimeEventsPartitions: [],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      "missing table: device_command_logs_archive",
      "missing table: gateway_alarm_events",
      "missing table: gateway_alarm_events_archive",
      "missing table: ems_health",
      "missing table: runtime_events",
      "missing table: runtime_issues",
      "missing table: runtime_self_checks",
      "missing table: runtime_health_snapshots",
      "missing column: asset_hourly_metrics.grid_export_kwh",
      "missing column: asset_hourly_metrics.load_consumption_kwh",
      "missing column: asset_hourly_metrics.avg_battery_soc",
      "missing column: asset_hourly_metrics.peak_battery_power_kw",
      "missing column: device_command_logs.acked_at",
      "missing column: device_command_logs_archive.archive_reason",
      "missing column: gateway_alarm_events_archive.archived_at",
      "missing column: gateway_alarm_events_archive.archive_reason",
      "missing index: idx_backfill_requests_terminal_cutoff",
      "missing index: idx_device_command_logs_retention_eligibility",
      "missing index: idx_device_command_logs_archive_archived_at",
      "missing index: device_command_logs_archive_pkey",
      "missing index: idx_gateway_alarm_events_retention_cutoff",
      "missing index: idx_gateway_alarm_events_archive_archived_at",
      "missing index: gateway_alarm_events_archive_pkey",
      "missing index: idx_telemetry_unique_asset_time",
      "missing index: idx_gae_gateway_event",
      "missing index: idx_gae_org",
      "missing index: idx_gae_status_active",
      "missing index: idx_gae_event_create_time",
      "missing index: idx_runtime_events_observed_at",
      "missing index: idx_runtime_events_fingerprint_observed",
      "missing index: idx_runtime_events_source_observed",
      "missing index: idx_runtime_events_severity_observed",
      "missing index: idx_runtime_issues_state_last_observed",
      "missing index: idx_runtime_issues_source_state",
      "missing index: idx_runtime_issues_tenant_scope_state",
      "missing index: idx_runtime_issues_active",
      "missing index: idx_runtime_issues_closed_at",
      "missing index: idx_runtime_health_snapshots_captured_at",
      "missing privilege: solfacil_service lacks CREATE on schema public",
      "missing privilege: runtime tables are not granted to solfacil_app/solfacil_service",
      "missing privilege: runtime_health_snapshots_id_seq is not granted to solfacil_app/solfacil_service",
      "wrong owner: asset_5min_metrics owner is postgres (expected solfacil_service)",
      "constraint mismatch: assets_asset_type_check does not include ESS",
      "runtime precondition failed: solfacil_service cannot create a probe partition for asset_5min_metrics",
      "missing runtime_events partition: runtime_events_default",
      "missing runtime_events partition: at least one monthly partition (runtime_events_YYYYMM)",
    ]);
  });

  it("reports the default partition separately from the monthly partition bootstrap check", () => {
    const withOnlyMonth = verifyLocalDbContract(
      buildFacts({
        runtimeEventsPartitions: ["runtime_events_202604"],
      }),
    );

    expect(withOnlyMonth.ok).toBe(false);
    expect(withOnlyMonth.failures).toContain(
      "missing runtime_events partition: runtime_events_default",
    );
    expect(withOnlyMonth.failures).not.toContain(
      "missing runtime_events partition: at least one monthly partition (runtime_events_YYYYMM)",
    );
  });

  it("reports missing monthly partition when only the default partition is bootstrapped", () => {
    const withOnlyDefault = verifyLocalDbContract(
      buildFacts({
        runtimeEventsPartitions: ["runtime_events_default"],
      }),
    );

    expect(withOnlyDefault.ok).toBe(false);
    expect(withOnlyDefault.failures).toContain(
      "missing runtime_events partition: at least one monthly partition (runtime_events_YYYYMM)",
    );
  });

  it("formats a readable report with PASS/FAIL markers", () => {
    const report = formatContractReport(
      verifyLocalDbContract(
        buildFacts({
          schemaCreatePrivilege: false,
        }),
      ),
    );

    expect(report).toContain("[FAIL] local DB contract check failed");
    expect(report).toContain("✗ schema privilege: solfacil_service has CREATE on public");
    expect(report).toContain(
      "missing privilege: solfacil_service lacks CREATE on schema public",
    );
  });
});
