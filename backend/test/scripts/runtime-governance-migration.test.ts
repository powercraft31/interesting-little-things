import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "shared",
  "migrations",
  "002_runtime_governance.sql",
);

const MANIFEST_PATH = join(__dirname, "..", "..", "scripts", "local-migration-manifest.txt");

describe("002_runtime_governance.sql migration artifact", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  it("creates the four canonical runtime tables with IF NOT EXISTS idempotence", () => {
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS\s+runtime_events\b[\s\S]*PARTITION BY RANGE\s*\(\s*observed_at\s*\)/i,
    );
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS\s+runtime_issues\b/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS\s+runtime_self_checks\b/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS\s+runtime_health_snapshots\b/i);
  });

  it("declares canonical runtime_events indexes", () => {
    expect(migration).toMatch(/idx_runtime_events_observed_at/i);
    expect(migration).toMatch(/idx_runtime_events_fingerprint_observed/i);
    expect(migration).toMatch(/idx_runtime_events_source_observed/i);
    expect(migration).toMatch(/idx_runtime_events_severity_observed/i);
  });

  it("declares canonical runtime_issues indexes including the active partial index", () => {
    expect(migration).toMatch(/idx_runtime_issues_state_last_observed/i);
    expect(migration).toMatch(/idx_runtime_issues_source_state/i);
    expect(migration).toMatch(/idx_runtime_issues_tenant_scope_state/i);
    expect(migration).toMatch(/idx_runtime_issues_active[\s\S]*WHERE[\s\S]*state/i);
  });

  it("declares a captured_at index for runtime_health_snapshots", () => {
    expect(migration).toMatch(/idx_runtime_health_snapshots_captured_at/i);
  });

  it("bootstraps current + near-future runtime_events monthly partitions and a default partition", () => {
    expect(migration).toMatch(/runtime_events_default/i);
    expect(migration).toMatch(/PARTITION OF runtime_events DEFAULT/i);
    expect(migration).toMatch(/runtime_events_%s|FOR VALUES FROM/i);
    expect(migration).toMatch(/FOR i IN 0\.\.3/i);
  });

  it("grants runtime tables and snapshot sequence to runtime roles for in-place upgrades", () => {
    expect(migration).toMatch(/GRANT\s+SELECT,\s+INSERT,\s+UPDATE,\s+DELETE\s+ON TABLE public\.%I TO solfacil_app, solfacil_service/i);
    expect(migration).toMatch(/runtime_events_default/i);
    expect(migration).toMatch(/GRANT\s+USAGE,\s+SELECT\s+ON SEQUENCE public\.runtime_health_snapshots_id_seq TO solfacil_app, solfacil_service/i);
  });

  it("enforces that runtime_health_snapshots.overall cannot be the API-only 'disabled' value", () => {
    const match = migration.match(/overall[\s\S]*?CHECK\s*\([^)]*\)/i);
    expect(match).not.toBeNull();
    const checkDef = match ? match[0].toLowerCase() : "";
    expect(checkDef).toContain("ok");
    expect(checkDef).toContain("warning");
    expect(checkDef).toContain("degraded");
    expect(checkDef).toContain("critical");
    expect(checkDef).not.toContain("'disabled'");
  });

  it("enforces closed state enum on runtime_issues.state", () => {
    const match = migration.match(/state[\s\S]*?CHECK\s*\([^)]*\)/i);
    expect(match).not.toBeNull();
    const checkDef = match ? match[0].toLowerCase() : "";
    for (const stateName of ["detected", "ongoing", "recovered", "closed", "suppressed"]) {
      expect(checkDef).toContain(stateName);
    }
  });

  it("does not mutate any existing business/domain tables", () => {
    expect(migration).not.toMatch(/\bALTER TABLE\s+(asset|assets|telemetry|gateway|ems|dispatch|strategy|billing|organizations)/i);
    expect(migration).not.toMatch(/\bDROP TABLE\b/i);
  });
});

describe("local-migration-manifest.txt includes 002_runtime_governance.sql", () => {
  const manifest = readFileSync(MANIFEST_PATH, "utf8");

  it("registers the runtime governance migration as a schema entry under backend/src/shared/migrations", () => {
    expect(manifest).toMatch(/^schema\|backend\/src\/shared\/migrations\/002_runtime_governance\.sql\s*$/m);
  });

  it("keeps the migration after the v7.0 schema entry so local apply order is deterministic", () => {
    const v7Index = manifest.indexOf("migration_v7.0.sql");
    const runtimeIndex = manifest.indexOf("002_runtime_governance.sql");
    expect(v7Index).toBeGreaterThan(-1);
    expect(runtimeIndex).toBeGreaterThan(v7Index);
  });

  it("registers 003_storage_retention_hardening.sql immediately after 002_runtime_governance.sql", () => {
    const runtimeIndex = manifest.indexOf("002_runtime_governance.sql");
    const storageRetentionIndex = manifest.indexOf("003_storage_retention_hardening.sql");
    expect(storageRetentionIndex).toBeGreaterThan(runtimeIndex);
  });
});
