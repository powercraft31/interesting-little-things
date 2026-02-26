/* ═══════════════════════════════════════════════════════════════════
   SOLFACIL VPP — Data Dictionary Frontend Unit Tests
   Phase 6.3 Step 2
   ═══════════════════════════════════════════════════════════════════ */

/* ─── Mock Data ────────────────────────────────────────────────── */

var MOCK_FIELDS = [
  {
    fieldId: "metering.grid_power_kw",
    domain: "metering",
    valueType: "number",
    displayName: "\u96fb\u7db2\u529f\u7387 kW",
  },
  {
    fieldId: "status.battery_soc",
    domain: "status",
    valueType: "number",
    displayName: "\u96fb\u6c60 SOC",
  },
  {
    fieldId: "config.max_charge_rate",
    domain: "config",
    valueType: "number",
    displayName: "\u6700\u5927\u5145\u96fb\u901f\u7387",
  },
];

/* ─── Mock API Setup ───────────────────────────────────────────── */

SolfacilAPI.getDictionary = function () {
  return Promise.resolve({ ok: true, data: MOCK_FIELDS });
};

SolfacilAPI.createDictionaryField = function (data) {
  SolfacilAPI._lastCreateCall = data;
  return Promise.resolve({ ok: true, data: data });
};

// deployParserRules mock — will be set per-test
SolfacilAPI._lastDeployCall = undefined;
SolfacilAPI.deployParserRules = function (rule) {
  SolfacilAPI._lastDeployCall = rule;
  return Promise.resolve({ ok: true, data: { ruleId: "default" } });
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

/* ─── Helper: build full mapping panel in DOM ───────────────────── */

function ensureDeployPanel() {
  // Remove existing
  var existing = document.getElementById("mapping-test-container");
  if (existing && existing.parentNode)
    existing.parentNode.removeChild(existing);

  var container = document.createElement("div");
  container.id = "mapping-test-container";

  // Iterator config inputs
  container.innerHTML =
    '<div class="dict-iterator-config">' +
    '  <input type="text" id="mapping-iterator-path" class="dict-iterator-input" value="">' +
    '  <input type="text" id="mapping-device-id-path" class="dict-iterator-input" value="">' +
    "</div>" +
    '<div id="dict-panel-body">' +
    // Field 1: metering.grid_power_kw — mapping-input FILLED
    '  <div class="dict-field-row"' +
    '    data-field-id="metering.grid_power_kw"' +
    '    data-domain="metering"' +
    '    data-value-type="number">' +
    '    <div class="dict-field-info">' +
    '      <span class="dict-field-id">metering.grid_power_kw</span>' +
    "    </div>" +
    '    <input type="text" class="mapping-input" value="properties.active_power">' +
    "  </div>" +
    // Field 2: status.battery_soc — mapping-input FILLED
    '  <div class="dict-field-row"' +
    '    data-field-id="status.battery_soc"' +
    '    data-domain="status"' +
    '    data-value-type="number">' +
    '    <div class="dict-field-info">' +
    '      <span class="dict-field-id">status.battery_soc</span>' +
    "    </div>" +
    '    <input type="text" class="mapping-input" value="properties.bat_soc">' +
    "  </div>" +
    // Field 3: config.max_charge_rate — mapping-input EMPTY (should be filtered)
    '  <div class="dict-field-row"' +
    '    data-field-id="config.max_charge_rate"' +
    '    data-domain="config"' +
    '    data-value-type="number">' +
    '    <div class="dict-field-info">' +
    '      <span class="dict-field-id">config.max_charge_rate</span>' +
    "    </div>" +
    '    <input type="text" class="mapping-input" value="">' +
    "  </div>" +
    "</div>" +
    // Deploy button
    '<div class="dict-deploy-bar">' +
    '  <button id="dict-btn-deploy">Deploy</button>' +
    "</div>";

  document.body.appendChild(container);
}

function cleanupDeployPanel() {
  var el = document.getElementById("mapping-test-container");
  if (el && el.parentNode) el.parentNode.removeChild(el);
  // Also clean up any stray dict-panel-body
  var dpb = document.getElementById("dict-panel-body");
  if (
    dpb &&
    dpb.id === "dict-panel-body" &&
    !dpb.closest("#mapping-test-container")
  ) {
    dpb.parentNode.removeChild(dpb);
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
      'Metering label contains "Metering"',
    );
    assert(html.indexOf("Status") !== -1, 'Status label contains "Status"');
    assert(html.indexOf("Config") !== -1, 'Config label contains "Config"');

    // Check specific fieldIds appear in correct sections
    var meteringSectionHtml = meteringSection ? meteringSection.innerHTML : "";
    var statusSectionHtml = statusSection ? statusSection.innerHTML : "";

    assert(
      meteringSectionHtml.indexOf("metering.grid_power_kw") !== -1,
      'fieldId "metering.grid_power_kw" in metering section',
    );
    assert(
      statusSectionHtml.indexOf("status.battery_soc") !== -1,
      'fieldId "status.battery_soc" in status section',
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
      "Metering section count = 1",
    );
    assert(
      statusCount && statusCount.textContent.trim() === "1",
      "Status section count = 1",
    );
    assert(
      configCount && configCount.textContent.trim() === "1",
      "Config section count = 1",
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
        "No API call made for invalid fieldId",
      );

      // Assert error message is shown
      var idError = document.getElementById("dict-field-id-error");
      assert(
        idError && idError.style.display === "block",
        "Error message displayed for invalid fieldId",
      );
      assert(
        idError && idError.textContent.indexOf("metering|status|config") !== -1,
        "Error text describes expected pattern",
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
        "API createDictionaryField was called",
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.fieldId === "status.chiller_temp",
        'Payload fieldId === "status.chiller_temp"',
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.domain === "status",
        'Payload domain === "status"',
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.displayName === "Chiller Temperature",
        'Payload displayName === "Chiller Temperature"',
      );
      assert(
        SolfacilAPI._lastCreateCall &&
          SolfacilAPI._lastCreateCall.valueType === "number",
        'Payload valueType === "number"',
      );

      cleanupModal();
      resolve();
    }, 100);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Test 4: Deploy — Assemble & Filter Mapping Payload
   ═══════════════════════════════════════════════════════════════════ */

function testDeployAssemblePayload() {
  return new Promise(function (resolve) {
    ensureDeployPanel();
    SolfacilAPI._lastDeployCall = undefined;

    // Set iterator config values
    document.getElementById("mapping-iterator-path").value = "data.batList";
    document.getElementById("mapping-device-id-path").value = "id";

    // Mock alert to prevent blocking
    var origAlert = window.alert;
    var alertCalled = false;
    window.alert = function () {
      alertCalled = true;
    };

    // Trigger deploy
    m1DeployMappingRules();

    // Allow promise to resolve
    setTimeout(function () {
      window.alert = origAlert;

      var rule = SolfacilAPI._lastDeployCall;

      assert(rule !== undefined, "Test 4: deployParserRules API was called");
      assert(
        rule && rule.parserType === "dynamic",
        'Test 4: parserType === "dynamic"',
      );
      assert(
        rule && rule.iterator === "data.batList",
        'Test 4: iterator === "data.batList"',
      );
      assert(
        rule && rule.deviceIdPath === "id",
        'Test 4: deviceIdPath === "id"',
      );

      // mappings should contain exactly 2 entries (3rd was empty, filtered out)
      var mappingKeys = rule && rule.mappings ? Object.keys(rule.mappings) : [];
      assert(
        mappingKeys.length === 2,
        "Test 4: 2 filled mappings included (empty field filtered)",
      );

      // Check metering field assembled correctly
      var meterField =
        rule && rule.mappings && rule.mappings["metering.grid_power_kw"];
      assert(!!meterField, 'Test 4: mappings["metering.grid_power_kw"] exists');
      assert(
        meterField && meterField.sourcePath === "properties.active_power",
        'Test 4: sourcePath === "properties.active_power"',
      );
      assert(
        meterField && meterField.domain === "metering",
        'Test 4: domain === "metering"',
      );
      assert(
        meterField && meterField.valueType === "number",
        'Test 4: valueType === "number" (from DOM data attr)',
      );

      // Check status field assembled correctly
      var statusField =
        rule && rule.mappings && rule.mappings["status.battery_soc"];
      assert(!!statusField, 'Test 4: mappings["status.battery_soc"] exists');
      assert(
        statusField && statusField.sourcePath === "properties.bat_soc",
        'Test 4: sourcePath === "properties.bat_soc"',
      );

      // config.max_charge_rate should NOT be in mappings (was empty)
      assert(
        !(rule && rule.mappings && rule.mappings["config.max_charge_rate"]),
        "Test 4: empty mapping-input field NOT included",
      );

      assert(!alertCalled, "Test 4: no alert fired (valid inputs provided)");

      cleanupDeployPanel();
      resolve();
    }, 100);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Test 5: Deploy — Empty Guard (no API call when all inputs are blank)
   ═══════════════════════════════════════════════════════════════════ */

function testDeployEmptyGuard() {
  return new Promise(function (resolve) {
    ensureDeployPanel();
    SolfacilAPI._lastDeployCall = undefined;

    // Leave ALL mapping-input empty (override the filled values)
    var inputs = document.querySelectorAll(".mapping-input");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].value = "";
    }

    // Also leave iterator config empty
    document.getElementById("mapping-iterator-path").value = "";
    document.getElementById("mapping-device-id-path").value = "";

    // Mock alert to capture the call
    var origAlert = window.alert;
    var alertCalled = false;
    var alertMessage = "";
    window.alert = function (msg) {
      alertCalled = true;
      alertMessage = msg || "";
    };

    // Trigger deploy
    m1DeployMappingRules();

    setTimeout(function () {
      window.alert = origAlert;

      assert(
        alertCalled,
        "Test 5: alert() was called when all inputs are empty",
      );
      assert(alertMessage.length > 0, "Test 5: alert message is non-empty");
      assert(
        SolfacilAPI._lastDeployCall === undefined,
        "Test 5: deployParserRules NOT called (empty guard prevented it)",
      );

      cleanupDeployPanel();
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
  await testDeployAssemblePayload();
  await testDeployEmptyGuard();

  console.log(
    "\n=== Results: " + passed + " passed, " + failed + " failed ===",
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
