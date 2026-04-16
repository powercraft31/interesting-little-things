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
        "backfill_requests",
        "gateway_alarm_events",
        "ems_health",
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
      },
      existingIndexes: [
        "idx_backfill_active",
        "idx_telemetry_unique_asset_time",
        "idx_gae_gateway_event",
        "idx_gae_org",
        "idx_gae_status_active",
        "idx_gae_event_create_time",
      ],
      schemaCreatePrivilege: true,
      asset5MinOwner: "solfacil_service",
      assetTypeConstraintDef:
        "CHECK (((asset_type)::text = ANY ((ARRAY['INVERTER_BATTERY'::character varying, 'SMART_METER'::character varying, 'HVAC'::character varying, 'EV_CHARGER'::character varying, 'SOLAR_PANEL'::character varying, 'ESS'::character varying])::text[])))",
      fiveMinPartitionProbeSucceeded: true,
      ...overrides,
    };
  }

  it("passes when the canonical local DB contract is satisfied", () => {
    const result = verifyLocalDbContract(buildFacts());

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks).toHaveLength(25);
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
        },
        existingIndexes: ["idx_backfill_active"],
        schemaCreatePrivilege: false,
        asset5MinOwner: "postgres",
        assetTypeConstraintDef: "CHECK ((asset_type)::text = ANY ((ARRAY['INVERTER_BATTERY'::text, 'SMART_METER'::text])))",
        fiveMinPartitionProbeSucceeded: false,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      "missing table: gateway_alarm_events",
      "missing table: ems_health",
      "missing column: asset_hourly_metrics.grid_export_kwh",
      "missing column: asset_hourly_metrics.load_consumption_kwh",
      "missing column: asset_hourly_metrics.avg_battery_soc",
      "missing column: asset_hourly_metrics.peak_battery_power_kw",
      "missing column: device_command_logs.acked_at",
      "missing index: idx_telemetry_unique_asset_time",
      "missing index: idx_gae_gateway_event",
      "missing index: idx_gae_org",
      "missing index: idx_gae_status_active",
      "missing index: idx_gae_event_create_time",
      "missing privilege: solfacil_service lacks CREATE on schema public",
      "wrong owner: asset_5min_metrics owner is postgres (expected solfacil_service)",
      "constraint mismatch: assets_asset_type_check does not include ESS",
      "runtime precondition failed: solfacil_service cannot create a probe partition for asset_5min_metrics",
    ]);
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
