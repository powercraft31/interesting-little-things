import fs from "fs";
import path from "path";

describe("frontend CSP regression guard", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const shippedFiles = [
    "frontend-v2/index.html",
    "frontend-v2/login.html",
    "frontend-v2/js/app.js",
    "frontend-v2/js/components.js",
    "frontend-v2/js/data-source.js",
    "frontend-v2/js/login.js",
    "frontend-v2/js/p1-fleet.js",
    "frontend-v2/js/p2-devices.js",
    "frontend-v2/js/p3-energy.js",
    "frontend-v2/js/p3-asset-energy.js",
    "frontend-v2/js/p3-asset-health.js",
    "frontend-v2/js/p4-hems.js",
    "frontend-v2/js/p5-strategy.js",
    "frontend-v2/js/p6-alerts.js",
  ];

  test("shipped frontend surface does not emit inline style attributes", () => {
    const offenders = shippedFiles.filter((relativePath) => {
      const content = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
      return content.includes('style="');
    });

    expect(offenders).toEqual([]);
  });
});
