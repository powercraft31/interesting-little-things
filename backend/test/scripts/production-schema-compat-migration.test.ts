import { existsSync, readFileSync } from "fs";
import path from "path";

const MIGRATION_PATH = path.join(
  __dirname,
  "../../migrations/migration_v7.1_production_schema_compat.sql",
);

describe("production schema compatibility migration", () => {
  it("exists as a committed additive migration artifact", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("codifies the production P2/M1/P4/P5 schema drift fixes", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    for (const column of [
      "rated_max_power_kw",
      "rated_max_current_a",
      "rated_min_power_kw",
      "rated_min_current_a",
    ]) {
      expect(migration).toMatch(
        new RegExp(`ALTER\\s+TABLE\\s+public\\.assets[\\s\\S]*ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${column}\\s+REAL`, "i"),
      );
    }

    expect(migration).toMatch(
      /ALTER\s+TABLE\s+public\.device_command_logs[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+batch_id\s+VARCHAR\(100\)/i,
    );
    expect(migration).toMatch(
      /ALTER\s+TABLE\s+public\.device_command_logs[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+source\s+VARCHAR\(50\)/i,
    );
    expect(migration).toMatch(/idx_device_command_logs_batch_id/i);
    expect(migration).toMatch(/idx_device_command_logs_gateway_batch/i);

    expect(migration).toMatch(/\\ir\s+\.\.\/src\/shared\/migrations\/001_p5_strategy_triggers\.sql/i);
    expect(migration).toMatch(/GRANT\s+SELECT,\s+INSERT,\s+UPDATE,\s+DELETE\s+ON\s+public\.strategy_intents\s+TO\s+solfacil_app,\s+solfacil_service/i);
    expect(migration).toMatch(/GRANT\s+SELECT,\s+USAGE\s+ON\s+SEQUENCE\s+public\.strategy_intents_id_seq\s+TO\s+solfacil_app,\s+solfacil_service/i);
    expect(migration).toMatch(/GRANT\s+SELECT,\s+INSERT,\s+UPDATE,\s+DELETE\s+ON\s+public\.posture_overrides\s+TO\s+solfacil_app,\s+solfacil_service/i);
    expect(migration).toMatch(/GRANT\s+SELECT,\s+USAGE\s+ON\s+SEQUENCE\s+public\.posture_overrides_id_seq\s+TO\s+solfacil_app,\s+solfacil_service/i);

    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
