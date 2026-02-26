/* ═══════════════════════════════════════════════════════════════════
   SOLFACIL VPP — Data Dictionary Frontend Unit Tests
   Phase 6.3 Step 2
   ═══════════════════════════════════════════════════════════════════ */

/* ─── Mock Data ────────────────────────────────────────────────── */

var MOCK_FIELDS = [
  { fieldId: "metering.grid_power_kw", domain: "metering", valueType: "number", displayName: "\u96fb\u7db2\u529f\u7387 kW" },
  { fieldId: "status.battery_soc", domain: "status", valueType: "number", displayName: "\u96fb\u6c60 SOC" },
  { fieldId: "config.max_charge_rate", domain: "config", valueType: "number", displayName: "\u6700\u5927\u5145\u96fb\u901f\u7387" },
];

/* ─── Mock API Setup ───────────────────────────────────────────── */

SolfacilAPI.getDictionary = function () {
  return Promise.resolve({ ok: true, data: MOCK_FIELDS });
};

SolfacilAPI.createDictionaryField = function (data) {
  SolfacilAPI._lastCreateCall = data;
  return Promise.resolve({ ok: true, data: data });
};

/* ─── Lightweight Test Runner ──────────────────────────────────── */

var passed = 0;
var failed = 0;

function assert(condition, label) {
  var output = document.getElementById("test-output");
  var div = document.createElement("div");
  div.className = "test-result " + (condition ? "pass" : "fail");
  if (condition) {
    console.log("\u2705 PASS:", label);
    div.textContent = "\u2705 PASS: " + label;
    passed++;
  } else {
    console.error("\u274c FAIL:", label);
    div.textContent = "\u274c FAIL: " + label;
    failed++;
  }
  output.appendChild(div);
}

/* ─── Helper: ensure dict-panel-body exists ────────────────────── */

function ensureDictPanelBody() {
  var existing = document.getElementById("dict-panel-body");
  if (existing) {
    existing.innerHTML = "";
    return;
  }
  var container = document.getElementById("module-content");
  container.style.display = "block";
  container.innerHTML =
    '<div class="m1-columns">' +
    '  <div class="m1-col-right">' +
    '    <div class="dict-panel">' +
    '      <div class="dict-panel-header">' +
    '        <button class="btn btn-secondary dict-btn-add" id="dict-btn-add">+ Add Field</button>' +
    "      </div>" +
    '      <div class="dict-panel-body" id="dict-panel-body"></div>' +
    "    </div>" +
    "  </div>" +
    "</div>";
}

/* ─── Helper: clean up modal state ─────────────────────────────── */

function cleanupModal() {
  var modal = document.getElementById("dict-add-modal");
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Test 1: Dictionary Rendering
   ═══════════════════════════════════════════════════════════════════ */

function testDictionaryRendering() {
  return new Promise(function (resolve) {
    // Reset state
    ensureDictPanelBody();
    m1DictState.fields = [];
    m1DictState.loaded = false;
    m1DictState.error = null;

    // Call render directly with mock data
    dictRenderPanel(MOCK_FIELDS);

    var body = document.getElementById("dict-panel-body");
    var html = body.innerHTML;

    // Section existence checks (domain labels include both Chinese and English)
    var meteringSection = document.getElementById("dict-section-metering");
    var statusSection = document.getElementById("dict-section-status");
    var configSection = document.getElementById("dict-section-config");

    assert(!!meteringSection, "Metering section rendered");
    assert(!!statusSection, "Status section rendered");
    assert(!!configSection, "Config section rendered");

    // Check domain labels contain expected text
    assert(
      html.indexOf("Metering") !== -1,
      'Metering label contains "Metering"'
    );
    assert(
      html.indexOf("Status") !== -1,
      'Status label contains "Status"'
    );
    assert(
      html.indexOf("Config") !== -1,
      'Config label contains "Config"'
    );

    // Check specific fieldIds appear in correct sections
    var meteringSectionHtml = meteringSection ? meteringSection.innerHTML : "";
    var statusSectionHtml = statusSection ? statusSection.innerHTML : "";

    assert(
      meteringSectionHtml.indexOf("metering.grid_power_kw") !== -1,
      'fieldId "metering.grid_power_kw" in metering section'
    );
    assert(
      statusSectionHtml.indexOf("status.battery_soc") !== -1,
      'fieldId "status.battery_soc" in status section'
    );

    // Verify field count badges
    var meterCount = meteringSection
      ? meteringSection.querySelector(".dict-section-count")
      : null;
    var statusCount = statusSection
      ? statusSection.querySelector(".dict-section-count")
      : null;
    var configCount = configSection
      ? configSection.querySelector(".dict-section-count")
      : null;

    assert(
      meterCount && meterCount.textContent.trim() === "1",
      "Metering section count = 1"
    );
    assert(
      statusCount && statusCount.textContent.trim() === "1",
      "Status section count = 1"
    );
    assert(
      configCount && configCount.textContent.trim() === "1",
      "Config section count = 1"
    );

    resolve();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Test 2: Form Validation — invalid fieldId blocked
   ═══════════════════════════════════════════════════════════════════ */

function testFormValidationBlocked() {
  return new Promise(function (resolve) {
    // Reset state
    ensureDictPanelBody();
    cleanupModal();
    SolfacilAPI._lastCreateCall = undefined;

    // Open the Add Field modal
    dictShowAddFieldModal();

    // Set invalid fieldId (has spaces, wrong format)
    var fieldIdInput = document.getElementById("dict-field-id");
    var domainSelect = document.getElementById("dict-field-domain");
    var displayInput = document.getElementById("dict-field-display");
    var typeSelect = document.getElementById("dict-field-type");

    assert(!!fieldIdInput, "Field ID input exists in modal");
    assert(!!domainSelect, "Domain select exists in modal");

    // Fill form with invalid fieldId
    domainSelect.value = "metering";
    fieldIdInput.value = "bad format with spaces";
    displayInput.value = "Test Field";
    typeSelect.value = "number";

    // Trigger save (should be blocked by validation)
    dictSaveField();

    // Allow async to settle, then check
    setTimeout(function () {
      // Assert no API call was made
      assert(
        SolfacilAPI._lastCreateCall === undefined,
        "No API call made for invalid fieldId"
      );

      // Assert error message is shown
      var idError = document.getElementById("dict-field-id-error");
      assert(
        idError && idError.style.display === "block",
        "Error message displayed for invalid fieldId"
      );
      assert(
        idError && idError.textContent.indexOf("metering|status|config") !== -1,
        "Error text describes expected pattern"
      );

      cleanupModal();
      resolve();
    }, 50);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Test 3: Create Field — valid payload dispatched
   ═══════════════════════════════════════════════════════════════════ */

function testCreateFieldPayload() {
  return new Promise(function (resolve) {
    // Reset state
    ensureDictPanelBody();
    cleanupModal();
    SolfacilAPI._lastCreateCall = undefined;

    // Open the Add Field modal
    dictShowAddFieldModal();

    // Set valid form values
    var domainSelect = document.getElementById("dict-field-domain");
    var fieldIdInput = document.getElementById("dict-field-id");
    var displayInput = document.getElementById("dict-field-display");
    var typeSelect = document.getElementById("dict-field-type");

    domainSelect.value = "status";
    fieldIdInput.value = "status.chiller_temp";
    displayInput.value = "Chiller Temperature";
    typeSelect.value = "number";

    // Trigger save
    dictSaveField();

    // Allow promise to resolve
    setTimeout(function () {
      assert(
        SolfacilAPI._lastCreateCall !== undefined,
        "API createDictionaryField was called"
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.fieldId === "status.chiller_temp",
        'Payload fieldId === "status.chiller_temp"'
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.domain === "status",
        'Payload domain === "status"'
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.displayName === "Chiller Temperature",
        'Payload displayName === "Chiller Temperature"'
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.valueType === "number",
        'Payload valueType === "number"'
      );

      cleanupModal();
      resolve();
    }, 100);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Run All Tests
   ═══════════════════════════════════════════════════════════════════ */

async function runAllTests() {
  await testDictionaryRendering();
  await testFormValidationBlocked();
  await testCreateFieldPayload();

  console.log(
    "\n=== Results: " + passed + " passed, " + failed + " failed ==="
  );

  var resultsEl = document.getElementById("test-results");
  if (failed === 0) {
    resultsEl.innerHTML =
      '<h2 style="color:#155724">\u2705 ALL PASS \u2014 ' +
      passed +
      "/" +
      (passed + failed) +
      "</h2>";
  } else {
    resultsEl.innerHTML =
      '<h2 style="color:#721c24">\u274c ' +
      failed +
      " FAILED \u2014 " +
      passed +
      "/" +
      (passed + failed) +
      "</h2>";
  }
}

runAllTests();
