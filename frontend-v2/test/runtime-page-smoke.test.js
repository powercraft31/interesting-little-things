/* ==============================================================
   WS9 canonical frontend smoke test — v6.10 runtime governance
   Run directly with Node:
     node frontend-v2/test/runtime-page-smoke.test.js
   The repo has no JS test runner under frontend-v2, so this file
   is a self-contained Node script using `assert`. It validates the
   WS9 contract points without mocking a browser DOM:
     - #runtime route registered in PAGES and admin-only
     - index.html has runtime nav item + page section, admin-gated
     - p7-runtime.js exposes RuntimePage with required surface
     - DataSource.runtime.* API family exists and targets contract
     - no SSE / EventSource dependency in runtime JS
     - P5/P6 page modules are untouched
   ============================================================== */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function run(name, fn) {
  try {
    fn();
    console.log("  PASS  " + name);
    return true;
  } catch (err) {
    console.log("  FAIL  " + name);
    console.log("        " + (err && err.message ? err.message : err));
    return false;
  }
}

const results = [];

// ---------------------------------------------------------------
// 1. app.js router registers #runtime as admin-only
// ---------------------------------------------------------------
const appJs = readFile("js/app.js");

results.push(
  run("app.js registers #runtime page definition", function () {
    assert.ok(
      /id:\s*"runtime"[\s\S]*?hash:\s*"#runtime"/.test(appJs),
      "PAGES entry with id=runtime and hash=#runtime missing",
    );
  }),
);

results.push(
  run("#runtime is admin-only (roles: [\"admin\"])", function () {
    const match = appJs.match(
      /id:\s*"runtime",[\s\S]*?roles:\s*\[([^\]]*)\]/,
    );
    assert.ok(match, "roles array not found for runtime page");
    const inner = match[1].replace(/\s/g, "");
    assert.strictEqual(
      inner,
      '"admin"',
      "runtime roles must be exactly [\"admin\"], got: " + inner,
    );
  }),
);

results.push(
  run("initPage has a 'runtime' branch delegating to RuntimePage", function () {
    assert.ok(
      /case\s+"runtime":\s*[\s\S]*?RuntimePage/i.test(appJs),
      "initPage switch is missing the runtime case",
    );
  }),
);

// ---------------------------------------------------------------
// 2. index.html has nav item + page section, gated by data-role
// ---------------------------------------------------------------
const indexHtml = readFile("index.html");

results.push(
  run("index.html has admin-gated #runtime nav item", function () {
    assert.ok(
      /data-page="runtime"[\s\S]*?data-role="admin"/.test(indexHtml) ||
        /data-role="admin"[\s\S]*?data-page="runtime"/.test(indexHtml),
      "runtime nav item must have data-page=runtime and data-role=admin",
    );
  }),
);

results.push(
  run("index.html has <section id=\"page-runtime\"> gated by data-role=admin", function () {
    assert.ok(
      /id="page-runtime"[\s\S]*?data-role="admin"/.test(indexHtml),
      "runtime page section is missing or not admin-gated",
    );
  }),
);

results.push(
  run("index.html loads p7-runtime.js before app.js", function () {
    const p7Idx = indexHtml.indexOf("p7-runtime.js");
    const appIdx = indexHtml.indexOf("app.js?");
    assert.ok(p7Idx > 0, "p7-runtime.js <script> missing");
    assert.ok(appIdx > 0, "app.js <script> missing");
    assert.ok(p7Idx < appIdx, "p7-runtime.js must load before app.js");
  }),
);

// ---------------------------------------------------------------
// 3. p7-runtime.js exposes RuntimePage with required sections
// ---------------------------------------------------------------
const p7 = readFile("js/p7-runtime.js");

results.push(
  run("p7-runtime.js defines RuntimePage", function () {
    assert.ok(/var\s+RuntimePage\s*=\s*\{/.test(p7), "RuntimePage missing");
    assert.ok(/init:\s*function/.test(p7), "RuntimePage.init missing");
  }),
);

results.push(
  run("p7-runtime.js implements the 5 required sections", function () {
    [
      "_buildOverallPosture",
      "_buildComponentRow",
      "_buildIssuesTable",
      "_buildSelfCheckPanel",
      "_buildIssueDrawer",
    ].forEach(function (fn) {
      assert.ok(p7.indexOf(fn) >= 0, "missing section builder: " + fn);
    });
  }),
);

results.push(
  run("p7-runtime.js does NOT introduce SSE / EventSource", function () {
    assert.ok(
      p7.indexOf("EventSource") === -1,
      "SSE EventSource not allowed in phase-1",
    );
    assert.ok(
      /WebSocket/i.test(p7) === false,
      "WebSocket not allowed in phase-1",
    );
  }),
);

results.push(
  run("p7-runtime.js wires close/suppress/note operator actions", function () {
    ["close", "suppress", "note"].forEach(function (action) {
      assert.ok(
        p7.indexOf('data-runtime-action="' + action + '"') >= 0,
        "missing operator action button: " + action,
      );
    });
    ["closeIssue", "suppressIssue", "noteIssue"].forEach(function (fn) {
      assert.ok(
        p7.indexOf("DataSource.runtime." + fn) >= 0,
        "missing DataSource.runtime." + fn + " wiring",
      );
    });
  }),
);

// ---------------------------------------------------------------
// 4. DataSource.runtime.* family consumes backend contract
// ---------------------------------------------------------------
const ds = readFile("js/data-source.js");

results.push(
  run("DataSource exposes runtime namespace", function () {
    assert.ok(
      /runtime:\s*runtime/.test(ds) && /var\s+runtime\s*=\s*\{/.test(ds),
      "DataSource.runtime namespace not registered",
    );
  }),
);

results.push(
  run("DataSource.runtime has all required methods", function () {
    [
      "health:",
      "issues:",
      "issueDetail:",
      "events:",
      "selfChecks:",
      "closeIssue:",
      "suppressIssue:",
      "noteIssue:",
    ].forEach(function (token) {
      assert.ok(
        ds.indexOf(token) >= 0,
        "missing DataSource.runtime method: " + token,
      );
    });
  }),
);

results.push(
  run("DataSource.runtime hits /api/runtime/* endpoints", function () {
    [
      "/api/runtime/health",
      "/api/runtime/issues",
      "/api/runtime/events",
      "/api/runtime/self-checks",
      "/close",
      "/suppress",
      "/note",
    ].forEach(function (p) {
      assert.ok(ds.indexOf(p) >= 0, "missing endpoint path: " + p);
    });
  }),
);

// ---------------------------------------------------------------
// 4b. WS9 session-role projection: #runtime admin gating must be
//     derived from authenticated backend session truth, not from
//     the static currentRole="admin" placeholder. See app.js
//     mapSessionRoleToFrontendRole() + bootstrapApp().
// ---------------------------------------------------------------
results.push(
  run("app.js defines mapSessionRoleToFrontendRole helper", function () {
    assert.ok(
      /function\s+mapSessionRoleToFrontendRole\s*\(/.test(appJs),
      "mapSessionRoleToFrontendRole helper missing",
    );
  }),
);

results.push(
  run(
    "mapSessionRoleToFrontendRole: SOLFACIL_ADMIN → admin, others → integrador",
    function () {
      // Extract and evaluate the helper in isolation (no DOM required).
      const match = appJs.match(
        /function\s+mapSessionRoleToFrontendRole\s*\([\s\S]*?\n\}/,
      );
      assert.ok(match, "could not extract helper body");
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        match[0] + "\nreturn mapSessionRoleToFrontendRole;",
      )();
      assert.strictEqual(fn("SOLFACIL_ADMIN"), "admin");
      assert.strictEqual(fn("ORG_MANAGER"), "integrador");
      assert.strictEqual(fn("ORG_OPERATOR"), "integrador");
      assert.strictEqual(fn("ORG_VIEWER"), "integrador");
      assert.strictEqual(fn(null), "integrador");
      assert.strictEqual(fn(undefined), "integrador");
      assert.strictEqual(fn(""), "integrador");
    },
  ),
);

results.push(
  run(
    "bootstrapApp projects session role before initial navigation",
    function () {
      // The projection must happen inside bootstrapApp, and switchRole
      // must be invoked with the derived role BEFORE navigateTo() runs.
      const bootstrapMatch = appJs.match(
        /function\s+bootstrapApp\s*\(\)\s*\{[\s\S]*?\n\}\s*$/m,
      );
      assert.ok(bootstrapMatch, "could not locate bootstrapApp body");
      const body = bootstrapMatch[0];
      assert.ok(
        /window\.currentUser\s*&&\s*window\.currentUser\.role/.test(body),
        "bootstrapApp must read window.currentUser.role",
      );
      assert.ok(
        /mapSessionRoleToFrontendRole\s*\(/.test(body),
        "bootstrapApp must call mapSessionRoleToFrontendRole",
      );
      const switchIdx = body.indexOf("switchRole(initialRole)");
      const navIdx = body.search(/navigateTo\s*\(\s*page\s*\?/);
      assert.ok(
        switchIdx >= 0,
        "bootstrapApp must call switchRole(initialRole)",
      );
      assert.ok(
        navIdx >= 0 && switchIdx < navIdx,
        "switchRole(initialRole) must run before the initial navigateTo()",
      );
    },
  ),
);

results.push(
  run(
    "bootstrapApp locks role-switcher for non-admin sessions",
    function () {
      const bootstrapMatch = appJs.match(
        /function\s+bootstrapApp\s*\(\)\s*\{[\s\S]*?\n\}\s*$/m,
      );
      assert.ok(bootstrapMatch, "could not locate bootstrapApp body");
      const body = bootstrapMatch[0];
      assert.ok(
        /roleSelect\.disabled\s*=\s*true/.test(body),
        "role-switcher must be disabled when initialRole !== admin",
      );
    },
  ),
);

// ---------------------------------------------------------------
// 5. Separation rule: P6 Alerts module still intact and not fused
// ---------------------------------------------------------------
const p6 = readFile("js/p6-alerts.js");

results.push(
  run("P6 Alerts module does not reference runtime governance", function () {
    assert.ok(
      p6.indexOf("DataSource.runtime") === -1,
      "P6 must not consume runtime DataSource (separation violated)",
    );
    assert.ok(
      p6.indexOf("RuntimePage") === -1,
      "P6 must not reference RuntimePage",
    );
  }),
);

// ---------------------------------------------------------------
// 6. Light runtime module load — confirm require succeeds
// ---------------------------------------------------------------
results.push(
  run("p7-runtime.js is syntactically loadable via require()", function () {
    const loaded = require(path.join(ROOT, "js/p7-runtime.js"));
    assert.ok(loaded && loaded.RuntimePage, "require() did not expose RuntimePage");
    assert.strictEqual(
      typeof loaded.RuntimePage.init,
      "function",
      "RuntimePage.init must be a function",
    );
  }),
);

// ---------------------------------------------------------------
// Summary
// ---------------------------------------------------------------
const failed = results.filter(function (x) {
  return !x;
}).length;
const total = results.length;
console.log(
  "\nWS9 runtime-page-smoke: " +
    (total - failed) +
    "/" +
    total +
    " checks passed",
);

if (failed > 0) {
  process.exit(1);
}
