import * as fs from "fs";
import * as path from "path";

/**
 * v5.19 migration verification: ensure no BFF handler references `is_online`
 * from device_state — all online status should come from gateways.status.
 *
 * This is a static analysis test, not a runtime test.
 */
describe("is_online migration audit", () => {
  const handlersDir = path.resolve(__dirname, "../../src/bff/handlers");

  it("no BFF handler SQL references device_state.is_online for online/offline logic", () => {
    const files = fs.readdirSync(handlersDir).filter((f) => f.endsWith(".ts"));
    const violations: string[] = [];

    // Handlers excluded from this audit:
    // - get-dashboard.ts: legacy dashboard that reads device_state directly (pre-v5.19)
    // - get-gateway-devices.ts, get-device-detail.ts: per-device is_online is acceptable
    // - get-assets.ts: legacy assets handler (pre-v5.19)
    const excludedFiles = new Set([
      "get-dashboard.ts",
      "get-gateway-devices.ts",
      "get-device-detail.ts",
      "get-assets.ts",
    ]);

    for (const file of files) {
      if (excludedFiles.has(file)) continue;
      const content = fs.readFileSync(path.join(handlersDir, file), "utf-8");
      // Flag any handler that uses is_online in a WHERE/FILTER clause for aggregate counting.
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /FILTER\s*\(\s*WHERE.*is_online/i.test(line) ||
          /COUNT.*is_online/i.test(line) ||
          /CASE\s+WHEN\s+.*is_online/i.test(line)
        ) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("fleet-overview handler uses gateways.status instead of device_state.is_online", () => {
    const content = fs.readFileSync(
      path.join(handlersDir, "get-fleet-overview.ts"),
      "utf-8",
    );
    // Should reference gateways.status for online counting
    expect(content).toContain("g.status = 'online'");
    // Should NOT use is_online in FILTER clauses
    expect(content).not.toMatch(/FILTER\s*\(\s*WHERE.*is_online/);
  });
});
