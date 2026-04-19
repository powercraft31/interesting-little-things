import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "shared",
  "migrations",
  "003_storage_retention_hardening.sql",
);

describe("003_storage_retention_hardening.sql migration artifact", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  it("creates both archive tables with additive IF NOT EXISTS guards", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS\s+public\.device_command_logs_archive\b/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS\s+public\.gateway_alarm_events_archive\b/i);
  });

  it("adds archive metadata columns and preserved source-id primary keys", () => {
    expect(migration).toMatch(/device_command_logs_archive[\s\S]*id\s+BIGINT\s+PRIMARY KEY/i);
    expect(migration).toMatch(/device_command_logs_archive[\s\S]*archived_at\s+TIMESTAMPTZ\s+NOT NULL/i);
    expect(migration).toMatch(/device_command_logs_archive[\s\S]*archive_reason\s+TEXT\s+NOT NULL/i);
    expect(migration).toMatch(/gateway_alarm_events_archive[\s\S]*id\s+BIGINT\s+PRIMARY KEY/i);
    expect(migration).toMatch(/gateway_alarm_events_archive[\s\S]*archived_at\s+TIMESTAMPTZ\s+NOT NULL/i);
    expect(migration).toMatch(/gateway_alarm_events_archive[\s\S]*archive_reason\s+TEXT\s+NOT NULL/i);
  });

  it("defines helper indexes for all retention-scan surfaces", () => {
    expect(migration).toMatch(/idx_runtime_issues_closed_at/i);
    expect(migration).toMatch(/idx_device_command_logs_retention_eligibility/i);
    expect(migration).toMatch(/idx_gateway_alarm_events_retention_cutoff/i);
    expect(migration).toMatch(/idx_backfill_requests_terminal_cutoff/i);
  });

  it("stays additive and does not broaden into destructive schema changes", () => {
    expect(migration).not.toMatch(/\bDROP TABLE\b/i);
    expect(migration).not.toMatch(/\bDELETE FROM\b/i);
    expect(migration).not.toMatch(/\bALTER TABLE\s+public\.(device_command_logs|gateway_alarm_events|backfill_requests|revenue_daily)\b/i);
  });
});
