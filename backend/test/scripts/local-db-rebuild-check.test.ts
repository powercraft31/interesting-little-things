import {
  buildBootstrapArgs,
  buildCheckConfig,
  buildSmokeFixtureSql,
  buildSummarySql,
  buildVerifierUrl,
} from "../../scripts/local-db-rebuild-check";

describe("local-db-rebuild-check", () => {
  it("builds a deterministic config with docker-aligned defaults", () => {
    const config = buildCheckConfig({});

    expect(config.dbName).toBe("solfacil_vpp_rebuild_check");
    expect(config.dbHost).toBe("127.0.0.1");
    expect(config.dbPort).toBe("5433");
    expect(config.dbAdminUser).toBe("postgres");
    expect(config.pgPassword).toBe("postgres_admin_2026");
    expect(config.appDbPassword).toBe("solfacil_vpp_2026");
    expect(config.serviceDbPassword).toBe("solfacil_service_2026");
    expect(config.includeDemoSeed).toBe(false);
  });

  it("lets callers override the check database and credentials via env", () => {
    const config = buildCheckConfig({
      DB_NAME: "custom_db",
      DB_HOST: "db.internal",
      DB_PORT: "6543",
      DB_ADMIN_USER: "rooter",
      PGPASSWORD: "pgpw",
      APP_DB_PASSWORD: "app_pw",
      SERVICE_DB_PASSWORD: "svc_pw",
      APPLY_DEMO_SEED: "1",
    });

    expect(config).toEqual({
      dbName: "custom_db",
      dbHost: "db.internal",
      dbPort: "6543",
      dbAdminUser: "rooter",
      pgPassword: "pgpw",
      appDbPassword: "app_pw",
      serviceDbPassword: "svc_pw",
      includeDemoSeed: true,
    });
  });

  it("builds bootstrap args without demo seeds by default", () => {
    expect(buildBootstrapArgs(buildCheckConfig({}))).toEqual(["--drop-existing"]);
    expect(buildBootstrapArgs(buildCheckConfig({ APPLY_DEMO_SEED: "1" }))).toEqual([
      "--drop-existing",
      "--with-demo-seed",
    ]);
  });

  it("builds the service verifier URL for the target database", () => {
    const config = buildCheckConfig({ DB_NAME: "solfacil_ci" });

    expect(buildVerifierUrl(config)).toBe(
      "postgresql://solfacil_service:solfacil_service_2026@127.0.0.1:5433/solfacil_ci",
    );
  });

  it("builds smoke fixture SQL that seeds minimal org/asset data and one telemetry window", () => {
    const sql = buildSmokeFixtureSql();

    expect(sql).toContain("INSERT INTO organizations");
    expect(sql).toContain("INSERT INTO assets");
    expect(sql).toContain("INSERT INTO telemetry_history");
    expect(sql).toContain("ORG_SMOKE_001");
    expect(sql).toContain("ASSET_SMOKE_001");
    expect(sql).toContain("generate_series(0, 11)");
    expect(sql).toContain("2026-04-15T14:00:00Z");
    expect(sql).toContain("ON CONFLICT (asset_id, recorded_at) DO NOTHING");
  });

  it("builds a summary query that checks raw telemetry and both aggregate tables", () => {
    const sql = buildSummarySql();

    expect(sql).toContain("telemetry_history_count");
    expect(sql).toContain("asset_5min_metrics_count");
    expect(sql).toContain("asset_hourly_metrics_count");
  });
});
