import { execFileSync } from "child_process";

export type CheckConfig = {
  dbName: string;
  dbHost: string;
  dbPort: string;
  dbAdminUser: string;
  pgPassword: string;
  appDbPassword: string;
  serviceDbPassword: string;
  includeDemoSeed: boolean;
};

const DEFAULTS = {
  DB_NAME: "solfacil_vpp_rebuild_check",
  DB_HOST: "127.0.0.1",
  DB_PORT: "5433",
  DB_ADMIN_USER: "postgres",
  PGPASSWORD: "postgres_admin_2026",
  APP_DB_PASSWORD: "solfacil_vpp_2026",
  SERVICE_DB_PASSWORD: "solfacil_service_2026",
  APPLY_DEMO_SEED: "0",
} as const;

export function buildCheckConfig(env: NodeJS.ProcessEnv): CheckConfig {
  return {
    dbName: env.DB_NAME ?? DEFAULTS.DB_NAME,
    dbHost: env.DB_HOST ?? DEFAULTS.DB_HOST,
    dbPort: env.DB_PORT ?? DEFAULTS.DB_PORT,
    dbAdminUser: env.DB_ADMIN_USER ?? DEFAULTS.DB_ADMIN_USER,
    pgPassword: env.PGPASSWORD ?? DEFAULTS.PGPASSWORD,
    appDbPassword: env.APP_DB_PASSWORD ?? DEFAULTS.APP_DB_PASSWORD,
    serviceDbPassword: env.SERVICE_DB_PASSWORD ?? DEFAULTS.SERVICE_DB_PASSWORD,
    includeDemoSeed: (env.APPLY_DEMO_SEED ?? DEFAULTS.APPLY_DEMO_SEED) === "1",
  };
}

export function buildBootstrapArgs(config: CheckConfig): string[] {
  return config.includeDemoSeed ? ["--drop-existing", "--with-demo-seed"] : ["--drop-existing"];
}

export function buildVerifierUrl(config: CheckConfig): string {
  return `postgresql://solfacil_service:${config.serviceDbPassword}@${config.dbHost}:${config.dbPort}/${config.dbName}`;
}

export function buildSmokeFixtureSql(): string {
  return `
INSERT INTO organizations (org_id, name, plan_tier)
VALUES ('ORG_SMOKE_001', 'Smoke Org', 'standard')
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO assets (asset_id, org_id, name, capacity_kwh, asset_type, is_active)
VALUES ('ASSET_SMOKE_001', 'ORG_SMOKE_001', 'Smoke Asset', 13.5, 'INVERTER_BATTERY', true)
ON CONFLICT (asset_id) DO NOTHING;

INSERT INTO telemetry_history (asset_id, recorded_at, battery_soc, pv_power, battery_power, grid_power_kw, load_power, grid_import_kwh, grid_export_kwh)
SELECT
  'ASSET_SMOKE_001',
  '2026-04-15T14:00:00Z'::timestamptz + (n * interval '25 seconds'),
  70.0,
  6.0,
  CASE WHEN n % 2 = 0 THEN 1.2 ELSE -0.8 END,
  0.5,
  4.0,
  0.2,
  0.1
FROM generate_series(0, 11) AS n
ON CONFLICT (asset_id, recorded_at) DO NOTHING;
`.trim();
}

export function buildSummarySql(): string {
  return `
SELECT
  (SELECT COUNT(*) FROM telemetry_history) AS telemetry_history_count,
  (SELECT COUNT(*) FROM asset_5min_metrics) AS asset_5min_metrics_count,
  (SELECT COUNT(*) FROM asset_hourly_metrics) AS asset_hourly_metrics_count;
`.trim();
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(command, args, {
    env,
    stdio: "inherit",
  });
}

function runPsql(config: CheckConfig, sql: string): void {
  runCommand(
    "psql",
    [
      "-h",
      config.dbHost,
      "-p",
      config.dbPort,
      "-U",
      config.dbAdminUser,
      "-d",
      config.dbName,
      "-c",
      sql,
    ],
    {
      ...process.env,
      PGPASSWORD: config.pgPassword,
    },
  );
}

export function runLocalDbRebuildCheck(config: CheckConfig): void {
  const bootstrapEnv = {
    ...process.env,
    DB_NAME: config.dbName,
    DB_HOST: config.dbHost,
    DB_PORT: config.dbPort,
    DB_ADMIN_USER: config.dbAdminUser,
    PGPASSWORD: config.pgPassword,
    APP_DB_PASSWORD: config.appDbPassword,
    SERVICE_DB_PASSWORD: config.serviceDbPassword,
  };

  console.log(`[local-db-rebuild-check] Rebuilding database '${config.dbName}' via canonical bootstrap...`);
  runCommand("./scripts/bootstrap.sh", buildBootstrapArgs(config), bootstrapEnv);

  const verifierUrl = buildVerifierUrl(config);
  console.log("[local-db-rebuild-check] Re-running contract verifier explicitly...");
  runCommand(
    "npx",
    ["ts-node", "scripts/verify-local-db-contract.ts"],
    {
      ...process.env,
      SERVICE_DATABASE_URL: verifierUrl,
    },
  );

  console.log("[local-db-rebuild-check] Seeding deterministic telemetry smoke fixture...");
  runPsql(config, buildSmokeFixtureSql());

  console.log("[local-db-rebuild-check] Running 5-minute aggregation smoke check...");
  runCommand(
    "npx",
    [
      "ts-node",
      "scripts/backfill-asset-5min-metrics.ts",
      "--from",
      "2026-04-15T14:00:00Z",
      "--to",
      "2026-04-15T14:00:00Z",
      "--max-windows",
      "1",
    ],
    {
      ...process.env,
      SERVICE_DATABASE_URL: verifierUrl,
    },
  );

  console.log("[local-db-rebuild-check] Running hourly aggregation smoke check...");
  runCommand(
    "npx",
    [
      "ts-node",
      "scripts/backfill-asset-hourly-metrics.ts",
      "--from",
      "2026-04-15T14:00:00Z",
      "--to",
      "2026-04-15T14:00:00Z",
      "--max-hours",
      "1",
    ],
    {
      ...process.env,
      SERVICE_DATABASE_URL: verifierUrl,
    },
  );

  console.log("[local-db-rebuild-check] Final aggregate summary:");
  runPsql(config, buildSummarySql());
}

function main(): void {
  const config = buildCheckConfig(process.env);
  runLocalDbRebuildCheck(config);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("[local-db-rebuild-check] Fatal error:", error);
    process.exitCode = 1;
  }
}
