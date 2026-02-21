/* ═══════════════════════════════════════════════════════════════════
   SOLFACIL VPP — Control Plane Admin UI
   Phase 1: Skeleton + Static Display
   Phase 2: M2 Algorithm Engine — VPP Strategies + Batch Ops
   ═══════════════════════════════════════════════════════════════════ */

/* ─── SECTION 0: Constants & Configuration ─────────────────────── */

var MODULE_REGISTRY = {
  m1: {
    id: "m1",
    name: "IoT Hub",
    subtitle: "Parser Rules",
    icon: "sensors",
    accent: "#06b6d4",
    appConfigProfile: "parser-rules",
    m8Table: "device_parser_rules",
    apiPath: "/admin/parsers",
    schemaFile: "parser-rules.schema.json",
    cacheTTL: "5 min",
    editable: true,
    renderer: "renderM1ParserRules",
  },
  m2: {
    id: "m2",
    name: "Algorithm Engine",
    subtitle: "VPP Strategies",
    icon: "psychology",
    accent: "#8b5cf6",
    appConfigProfile: "vpp-strategies",
    m8Table: "vpp_strategies",
    apiPath: "/admin/strategies",
    schemaFile: "vpp-strategies.schema.json",
    cacheTTL: "1 min",
    editable: true,
    renderer: "renderM2VppStrategies",
    hasBatchOps: true,
  },
  m3: {
    id: "m3",
    name: "DR Dispatcher",
    subtitle: "Dispatch Policies",
    icon: "send",
    accent: "#f97316",
    appConfigProfile: "dispatch-policies",
    m8Table: "dispatch_policies",
    apiPath: "/admin/dispatch-policies",
    schemaFile: "dispatch-policies.schema.json",
    cacheTTL: "10 min",
    editable: true,
    renderer: "renderM3DispatchPolicies",
  },
  m4: {
    id: "m4",
    name: "Market & Billing",
    subtitle: "Billing Rules",
    icon: "payments",
    accent: "#10b981",
    appConfigProfile: "billing-rules",
    m8Table: "billing_rules",
    apiPath: "/admin/billing-rules",
    schemaFile: "billing-rules.schema.json",
    cacheTTL: "60 min",
    editable: true,
    renderer: "renderM4BillingRules",
  },
  m5: {
    id: "m5",
    name: "Frontend BFF",
    subtitle: "Feature Flags",
    icon: "flag",
    accent: "#ec4899",
    appConfigProfile: "feature-flags",
    m8Table: "feature_flags",
    apiPath: "/admin/feature-flags",
    schemaFile: "feature-flags.schema.json",
    cacheTTL: "5 min",
    editable: true,
    renderer: "renderM5FeatureFlags",
  },
  m6: {
    id: "m6",
    name: "Identity & Tenant",
    subtitle: "RBAC Policies",
    icon: "admin_panel_settings",
    accent: "#6366f1",
    appConfigProfile: "rbac-policies",
    m8Table: "rbac_policies",
    apiPath: "/admin/rbac-policies",
    schemaFile: "rbac-policies.schema.json",
    cacheTTL: "30 min",
    editable: false,
    renderer: "renderM6RbacPolicies",
  },
  m7: {
    id: "m7",
    name: "Open API",
    subtitle: "API Quotas",
    icon: "api",
    accent: "#14b8a6",
    appConfigProfile: "api-quotas",
    m8Table: "api_quotas",
    apiPath: "/admin/api-quotas",
    schemaFile: "api-quotas.schema.json",
    cacheTTL: "1 min",
    editable: true,
    renderer: "renderM7ApiQuotas",
  },
};

var MODULE_ORDER = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];

var activeModuleId = "m1";

/* ═══════════════════════════════════════════════════════════════════
   SECTION 2: M1 IoT Hub — Parser Rules Editor
   ═══════════════════════════════════════════════════════════════════ */

/* ─── M1 Sample JSON Templates ─────────────────────────────────── */

var M1_VENDOR_TEMPLATES = {
  Huawei: JSON.stringify(
    {
      vendor: "Huawei",
      protocol: "Modbus/TCP",
      registers: {
        soc: { address: 37004, scale: 0.1, unit: "%" },
        power_w: { address: 37001, scale: 1, unit: "W" },
        voltage: { address: 37006, scale: 0.1, unit: "V" },
      },
      poll_interval_ms: 5000,
    },
    null,
    2,
  ),
  Sungrow: JSON.stringify(
    {
      vendor: "Sungrow",
      protocol: "Modbus/TCP",
      registers: {
        soc: { address: 13022, scale: 1, unit: "%" },
        power_w: { address: 13033, scale: 1, unit: "W" },
      },
      poll_interval_ms: 3000,
    },
    null,
    2,
  ),
  Growatt: JSON.stringify(
    {
      vendor: "Growatt",
      protocol: "Modbus/TCP",
      registers: {
        soc: { address: 1014, scale: 0.01, unit: "%" },
        power_w: { address: 1009, scale: 0.1, unit: "W" },
      },
      poll_interval_ms: 5000,
    },
    null,
    2,
  ),
  SolarEdge: JSON.stringify(
    {
      vendor: "SolarEdge",
      protocol: "SunSpec/TCP",
      registers: {
        soc: { address: 62852, scale: 1, unit: "%" },
        power_w: { address: 62836, scale: 1, unit: "W" },
      },
      poll_interval_ms: 5000,
    },
    null,
    2,
  ),
  BYD: JSON.stringify(
    {
      vendor: "BYD",
      protocol: "CAN/RS485",
      registers: {
        soc: { address: 256, scale: 1, unit: "%" },
        power_w: { address: 258, scale: 1, unit: "W" },
      },
      poll_interval_ms: 5000,
    },
    null,
    2,
  ),
  Custom: JSON.stringify(
    {
      vendor: "",
      protocol: "",
      registers: {},
      poll_interval_ms: 5000,
    },
    null,
    2,
  ),
};

var M1_VENDOR_OPTIONS = [
  { value: "Huawei", label: "Huawei (LUNA2000 series)" },
  { value: "Sungrow", label: "Sungrow (SH series)" },
  { value: "Growatt", label: "Growatt (SPH series)" },
  { value: "SolarEdge", label: "SolarEdge (StorEdge)" },
  { value: "BYD", label: "BYD (Battery-Box)" },
  { value: "Custom", label: "[Custom / \u81EA\u5B9A\u7FA9]" },
];

/* ─── M1 State ─────────────────────────────────────────────────── */

var m1State = {
  selectedVendor: "Huawei",
  jsonText: M1_VENDOR_TEMPLATES.Huawei,
  originalJson: M1_VENDOR_TEMPLATES.Huawei,
  validationStatus: "neutral", // "neutral" | "valid" | "error"
  validationMessage: "Press Validate to check syntax",
  debounceTimer: null,
};

/* ─── M1 Renderer ──────────────────────────────────────────────── */

function renderM1ParserRules(container, mod) {
  var accent = mod.accent;

  // Build vendor <option> list
  var optionsHtml = "";
  for (var i = 0; i < M1_VENDOR_OPTIONS.length; i++) {
    var opt = M1_VENDOR_OPTIONS[i];
    var selected = opt.value === m1State.selectedVendor ? " selected" : "";
    optionsHtml +=
      '<option value="' +
      opt.value +
      '"' +
      selected +
      ">" +
      opt.label +
      "</option>";
  }

  container.innerHTML =
    '<div class="fade-in m1-editor">' +
    // Header
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    M1 IoT Hub &mdash; Parser Rules Editor" +
    "  </div>" +
    '  <div class="module-header-meta">' +
    '    <span class="meta-tag">Profile: ' +
    mod.appConfigProfile +
    "</span>" +
    '    <span class="meta-tag">TTL: ' +
    mod.cacheTTL +
    "</span>" +
    '    <span class="meta-tag">Table: ' +
    mod.m8Table +
    "</span>" +
    "  </div>" +
    "</div>" +
    // Vendor Selector Section
    '<div class="m1-section m1-vendor-section">' +
    '  <div class="m1-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">factory</i>' +
    "    \u5EE0\u724C (Manufacturer)" +
    "  </div>" +
    '  <select class="m1-select" id="m1-vendor-select">' +
    optionsHtml +
    "  </select>" +
    "</div>" +
    // JSON Editor Section
    '<div class="m1-section m1-json-section">' +
    '  <div class="m1-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">code</i>' +
    "    JSON Editor" +
    "  </div>" +
    '  <textarea class="m1-textarea" id="m1-json-editor" spellcheck="false">' +
    m1EscapeHtml(m1State.jsonText) +
    "</textarea>" +
    "</div>" +
    // Validation Feedback
    '<div class="m1-validation" id="m1-validation">' +
    '  <span class="m1-validation-text m1-validation--' +
    m1State.validationStatus +
    '">' +
    m1EscapeHtml(m1State.validationMessage) +
    "  </span>" +
    "</div>" +
    // Action Bar
    '<div class="m1-action-bar">' +
    '  <button class="btn btn-secondary m1-btn-validate" id="m1-btn-validate" style="border-color:' +
    accent +
    ";color:" +
    accent +
    '">' +
    '    <i class="material-icons">check_circle</i> Validate JSON' +
    "  </button>" +
    '  <button class="btn btn-primary m1-btn-deploy" id="m1-btn-deploy" disabled style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> Deploy Parser Rule' +
    "  </button>" +
    "</div>" +
    "</div>";

  m1BindEvents();
  m1UpdateDeployButton();
}

/* ─── M1 Helpers ───────────────────────────────────────────────── */

function m1EscapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── M1 Event Binding ─────────────────────────────────────────── */

function m1BindEvents() {
  var vendorSelect = document.getElementById("m1-vendor-select");
  var jsonEditor = document.getElementById("m1-json-editor");
  var btnValidate = document.getElementById("m1-btn-validate");
  var btnDeploy = document.getElementById("m1-btn-deploy");

  if (vendorSelect) {
    vendorSelect.addEventListener("change", function () {
      m1State.selectedVendor = this.value;
      var template =
        M1_VENDOR_TEMPLATES[this.value] || M1_VENDOR_TEMPLATES.Custom;
      m1State.jsonText = template;
      m1State.originalJson = template;
      m1State.validationStatus = "neutral";
      m1State.validationMessage = "Press Validate to check syntax";
      var editor = document.getElementById("m1-json-editor");
      if (editor) editor.value = template;
      m1UpdateValidationDisplay();
      m1UpdateDeployButton();
    });
  }

  if (jsonEditor) {
    // Tab key inserts 2 spaces
    jsonEditor.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;
        var value = this.value;
        this.value = value.substring(0, start) + "  " + value.substring(end);
        this.selectionStart = start + 2;
        this.selectionEnd = start + 2;
        // Trigger input event for state sync
        m1OnEditorInput.call(this);
      }
    });

    // Debounced validation on input
    jsonEditor.addEventListener("input", m1OnEditorInput);
  }

  if (btnValidate) btnValidate.addEventListener("click", m1ValidateJson);
  if (btnDeploy) btnDeploy.addEventListener("click", m1ShowConfirmModal);
}

function m1OnEditorInput() {
  m1State.jsonText = this.value;
  // Debounced auto-validation (800ms)
  if (m1State.debounceTimer) clearTimeout(m1State.debounceTimer);
  m1State.debounceTimer = setTimeout(function () {
    m1ValidateJson();
  }, 800);
  m1UpdateDeployButton();
}

/* ─── M1 JSON Validation ───────────────────────────────────────── */

function m1ValidateJson() {
  var text = m1State.jsonText.trim();
  if (!text) {
    m1State.validationStatus = "error";
    m1State.validationMessage = "\u2717 Invalid JSON: empty input";
    m1UpdateValidationDisplay();
    m1UpdateDeployButton();
    return;
  }

  try {
    var parsed = JSON.parse(text);

    // Count registers
    var registerCount = 0;
    if (parsed.registers && typeof parsed.registers === "object") {
      registerCount = Object.keys(parsed.registers).length;
    }
    var pollMs = parsed.poll_interval_ms || "N/A";

    m1State.validationStatus = "valid";
    m1State.validationMessage =
      "\u2713 Valid JSON \u2014 " +
      registerCount +
      " registers, poll interval " +
      pollMs +
      "ms";
  } catch (err) {
    m1State.validationStatus = "error";
    m1State.validationMessage = "\u2717 Invalid JSON: " + err.message;
  }

  m1UpdateValidationDisplay();
  m1UpdateDeployButton();
}

function m1UpdateValidationDisplay() {
  var el = document.getElementById("m1-validation");
  if (!el) return;
  el.innerHTML =
    '<span class="m1-validation-text m1-validation--' +
    m1State.validationStatus +
    '">' +
    m1EscapeHtml(m1State.validationMessage) +
    "</span>";
}

/* ─── M1 Deploy Button State ──────────────────────────────────── */

function m1UpdateDeployButton() {
  var btn = document.getElementById("m1-btn-deploy");
  if (!btn) return;
  var isValid = m1State.validationStatus === "valid";
  var hasChanges = m1State.jsonText !== m1State.originalJson;
  btn.disabled = !isValid || !hasChanges;
}

/* ─── M1 Confirm Modal ────────────────────────────────────────── */

function m1ShowConfirmModal() {
  var vendor = m1State.selectedVendor;

  var existing = document.getElementById("m1-confirm-modal");
  if (existing) existing.parentNode.removeChild(existing);

  var overlay = document.createElement("div");
  overlay.id = "m1-confirm-modal";
  overlay.className = "m1-modal-overlay";
  overlay.innerHTML =
    '<div class="m1-modal">' +
    '  <div class="m1-modal-header">' +
    '    <i class="material-icons" style="color:#06b6d4">warning</i>' +
    "    \u78BA\u8A8D\u90E8\u7F72\u89E3\u6790\u898F\u5247" +
    "  </div>" +
    '  <div class="m1-modal-body">' +
    "    \u5373\u5C07\u66F4\u65B0 <strong>" +
    m1EscapeHtml(vendor) +
    "</strong> \u7684\u89E3\u6790\u898F\u5247\u81F3 AppConfig\uFF0C\u78BA\u8A8D\u5F8C\u7ACB\u5373\u751F\u6548\u3002\u662F\u5426\u78BA\u8A8D\uFF1F" +
    "  </div>" +
    '  <div class="m1-modal-footer">' +
    '    <button class="btn btn-secondary" id="m1-modal-cancel">Cancel</button>' +
    '    <button class="btn btn-primary" id="m1-modal-confirm" style="background:#06b6d4">' +
    '      <i class="material-icons">check</i> Confirm' +
    "    </button>" +
    "  </div>" +
    "</div>";

  document.body.appendChild(overlay);

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) m1CloseConfirmModal();
  });

  document
    .getElementById("m1-modal-cancel")
    .addEventListener("click", m1CloseConfirmModal);
  document
    .getElementById("m1-modal-confirm")
    .addEventListener("click", function () {
      m1CloseConfirmModal();
      m1DeploySuccess();
    });
}

function m1CloseConfirmModal() {
  var modal = document.getElementById("m1-confirm-modal");
  if (modal) {
    modal.classList.add("m1-modal-closing");
    setTimeout(function () {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }, 200);
  }
}

function m1DeploySuccess() {
  var vendor = m1State.selectedVendor;
  // Update original to reflect deployed state
  m1State.originalJson = m1State.jsonText;
  m1UpdateDeployButton();
  showToast(
    "\u2713 " +
      vendor +
      " \u89E3\u6790\u898F\u5247\u5DF2\u767C\u4F48\u81F3 AppConfig",
    "success",
    3000,
  );
}

/* ─── SECTION 3: Navigation & Layout ───────────────────────────── */

function initNavigation() {
  var navList = document.getElementById("nav-modules");
  if (!navList) return;

  var html = "";
  for (var i = 0; i < MODULE_ORDER.length; i++) {
    var key = MODULE_ORDER[i];
    var mod = MODULE_REGISTRY[key];
    var label = mod.id.toUpperCase();
    var isActive = key === activeModuleId ? " active" : "";

    html +=
      '<li class="nav-item' +
      isActive +
      '" data-module="' +
      key +
      '" title="' +
      label +
      " " +
      mod.name +
      '">' +
      '<div class="nav-item-accent" style="background:' +
      mod.accent +
      '"></div>' +
      '<i class="material-icons nav-item-icon">' +
      mod.icon +
      "</i>" +
      '<div class="nav-item-text">' +
      '  <div class="nav-item-name">' +
      label +
      " " +
      mod.name +
      "</div>" +
      '  <div class="nav-item-subtitle">' +
      mod.subtitle +
      "</div>" +
      "</div>" +
      "</li>";
  }
  navList.innerHTML = html;

  // Attach click handlers
  var items = navList.querySelectorAll(".nav-item");
  for (var j = 0; j < items.length; j++) {
    items[j].addEventListener("click", handleNavClick);
  }
}

function handleNavClick(e) {
  var item = e.currentTarget;
  var moduleId = item.getAttribute("data-module");
  if (moduleId && moduleId !== activeModuleId) {
    switchModule(moduleId);
  }
}

function switchModule(moduleId) {
  var mod = MODULE_REGISTRY[moduleId];
  if (!mod) return;

  activeModuleId = moduleId;

  // Update nav active state
  var items = document.querySelectorAll("#nav-modules .nav-item");
  for (var i = 0; i < items.length; i++) {
    var id = items[i].getAttribute("data-module");
    if (id === moduleId) {
      items[i].classList.add("active");
    } else {
      items[i].classList.remove("active");
    }
  }

  // Update breadcrumb
  renderBreadcrumb(mod);

  // Render module content
  renderModuleContent(mod);
}

function renderBreadcrumb(mod) {
  var el = document.getElementById("breadcrumb-module");
  if (el) {
    el.textContent = mod.id.toUpperCase() + " " + mod.name;
  }
}

function renderModuleContent(mod) {
  var container = document.getElementById("module-content");
  if (!container) return;

  // Route M1 to its dedicated renderer
  if (mod.id === "m1") {
    renderM1ParserRules(container, mod);
    return;
  }

  // Route M2 to its dedicated renderer
  if (mod.id === "m2") {
    renderM2VppStrategies(container, mod);
    return;
  }

  // Default placeholder for other modules
  renderModulePlaceholder(container, mod);
}

function renderModulePlaceholder(container, mod) {
  var label = mod.id.toUpperCase();
  var readOnlyBadge = !mod.editable
    ? '<div style="margin-top:var(--space-2);display:inline-flex;align-items:center;gap:4px;' +
      "padding:2px 8px;background:rgba(245,158,11,0.12);color:#f59e0b;border-radius:4px;" +
      'font-size:11px;font-weight:600;"><i class="material-icons" style="font-size:14px">lock</i> READ-ONLY</div>'
    : "";

  var batchOpsTag = mod.hasBatchOps
    ? '<span class="meta-tag"><i class="material-icons" style="font-size:12px">bolt</i> Batch Ops</span>'
    : "";

  container.innerHTML =
    '<div class="fade-in">' +
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    mod.accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    " +
    label +
    " " +
    mod.name +
    " &mdash; " +
    mod.subtitle +
    "  </div>" +
    '  <div class="module-header-meta">' +
    '    <span class="meta-tag">Profile: ' +
    mod.appConfigProfile +
    "</span>" +
    '    <span class="meta-tag">TTL: ' +
    mod.cacheTTL +
    "</span>" +
    '    <span class="meta-tag">Table: ' +
    mod.m8Table +
    "</span>" +
    "    " +
    batchOpsTag +
    "  </div>" +
    "  " +
    readOnlyBadge +
    "</div>" +
    '<div class="module-placeholder">' +
    '  <i class="material-icons module-placeholder-icon">' +
    mod.icon +
    "</i>" +
    '  <div class="module-placeholder-text">' +
    mod.subtitle +
    " Editor</div>" +
    '  <div class="module-placeholder-sub">Coming in Phase 3...</div>' +
    '  <div class="info-cards">' +
    '    <div class="info-card">' +
    '      <div class="info-card-label">AppConfig Profile</div>' +
    '      <div class="info-card-value">' +
    mod.appConfigProfile +
    "</div>" +
    "    </div>" +
    '    <div class="info-card">' +
    '      <div class="info-card-label">Cache TTL</div>' +
    '      <div class="info-card-value">' +
    mod.cacheTTL +
    "</div>" +
    "    </div>" +
    '    <div class="info-card">' +
    '      <div class="info-card-label">M8 API Path</div>' +
    '      <div class="info-card-value">' +
    mod.apiPath +
    "</div>" +
    "    </div>" +
    "  </div>" +
    "</div>" +
    "</div>";
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 4: M2 Algorithm Engine — VPP Strategies + Batch Ops
   ═══════════════════════════════════════════════════════════════════ */

/* ─── M2 Mock Data ────────────────────────────────────────────────── */

var M2_TENANTS = [
  { id: "tenant-a", name: "Tenant A", region: "São Paulo Fleet", devices: 12 },
  { id: "tenant-b", name: "Tenant B", region: "Rio de Janeiro", devices: 5 },
  { id: "fleet-c", name: "Fleet C", region: "Minas Gerais", devices: 8 },
  { id: "tenant-d", name: "Tenant D", region: "Brasília", devices: 3 },
  { id: "fleet-e", name: "Fleet E", region: "Curitiba", devices: 7 },
];

/* ─── M2 State ────────────────────────────────────────────────────── */

var m2State = {
  min_soc: 20,
  max_soc: 90,
  emergency_reserve: 10,
  selectedTenants: {},
  errors: {},
  previewVisible: false,
};

function m2ResetState() {
  m2State.min_soc = 20;
  m2State.max_soc = 90;
  m2State.emergency_reserve = 10;
  m2State.selectedTenants = {};
  m2State.errors = {};
  m2State.previewVisible = false;
}

/* ─── M2 Validation ───────────────────────────────────────────────── */

function m2Validate() {
  var errors = {};
  var min = m2State.min_soc;
  var max = m2State.max_soc;
  var emr = m2State.emergency_reserve;

  if (isNaN(min) || min < 0 || min > 100) {
    errors.min_soc = "最低電量必須在 0-100 之間";
  }
  if (isNaN(max) || max < 0 || max > 100) {
    errors.max_soc = "最高電量必須在 0-100 之間";
  }
  if (isNaN(emr) || emr < 0 || emr > 50) {
    errors.emergency_reserve = "備用電量必須在 0-50 之間";
  }

  if (!errors.min_soc && !errors.max_soc && min >= max) {
    errors.min_soc = "最低電量必須小於最高電量";
    errors.max_soc = "最高電量必須大於最低電量";
  }
  if (!errors.emergency_reserve && !errors.min_soc && emr > min) {
    errors.emergency_reserve = "備用電量不可超過最低電量";
  }

  m2State.errors = errors;
  return Object.keys(errors).length === 0;
}

/* ─── M2 Selection Helpers ────────────────────────────────────────── */

function m2GetSelectedCount() {
  var count = 0;
  for (var i = 0; i < M2_TENANTS.length; i++) {
    if (m2State.selectedTenants[M2_TENANTS[i].id]) count++;
  }
  return count;
}

function m2GetSelectedDevices() {
  var total = 0;
  for (var i = 0; i < M2_TENANTS.length; i++) {
    if (m2State.selectedTenants[M2_TENANTS[i].id])
      total += M2_TENANTS[i].devices;
  }
  return total;
}

/* ─── M2 Renderer ─────────────────────────────────────────────────── */

function renderM2VppStrategies(container, mod) {
  var accent = mod.accent;

  container.innerHTML =
    '<div class="fade-in m2-editor">' +
    // Header
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    Algorithm Engine &mdash; VPP Strategies" +
    "  </div>" +
    '  <div class="module-header-meta">' +
    '    <span class="meta-tag">Profile: ' +
    mod.appConfigProfile +
    "</span>" +
    '    <span class="meta-tag">TTL: ' +
    mod.cacheTTL +
    "</span>" +
    '    <span class="meta-tag">Table: ' +
    mod.m8Table +
    "</span>" +
    '    <span class="meta-tag"><i class="material-icons" style="font-size:12px">bolt</i> Batch Ops</span>' +
    "  </div>" +
    "</div>" +
    // Strategy Form
    '<div class="m2-section">' +
    '  <div class="m2-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">tune</i>' +
    "    SoC Thresholds" +
    "  </div>" +
    '  <div class="m2-form-grid">' +
    '    <div class="m2-field">' +
    '      <label class="m2-label" for="m2-min-soc">最低電量 (%)</label>' +
    '      <input type="number" id="m2-min-soc" class="m2-input" min="0" max="100" step="1" value="' +
    m2State.min_soc +
    '">' +
    '      <div class="m2-error" id="m2-err-min-soc"></div>' +
    "    </div>" +
    '    <div class="m2-field">' +
    '      <label class="m2-label" for="m2-max-soc">最高電量 (%)</label>' +
    '      <input type="number" id="m2-max-soc" class="m2-input" min="0" max="100" step="1" value="' +
    m2State.max_soc +
    '">' +
    '      <div class="m2-error" id="m2-err-max-soc"></div>' +
    "    </div>" +
    '    <div class="m2-field">' +
    '      <label class="m2-label" for="m2-emergency-reserve">備用電量 (%)</label>' +
    '      <input type="number" id="m2-emergency-reserve" class="m2-input" min="0" max="50" step="1" value="' +
    m2State.emergency_reserve +
    '">' +
    '      <div class="m2-error" id="m2-err-emergency-reserve"></div>' +
    "    </div>" +
    "  </div>" +
    // SoC Visual Gauge
    '  <div class="m2-gauge" id="m2-gauge"></div>' +
    "</div>" +
    // Batch Ops — Target Scope
    '<div class="m2-section">' +
    '  <div class="m2-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">groups</i>' +
    "    目標套用範圍 (Target Scope)" +
    "  </div>" +
    '  <div class="m2-select-all">' +
    '    <label class="m2-checkbox-label">' +
    '      <input type="checkbox" id="m2-select-all">' +
    "      <span>全選</span>" +
    "    </label>" +
    "  </div>" +
    '  <div class="m2-tenant-list" id="m2-tenant-list"></div>' +
    '  <div class="m2-summary" id="m2-summary"></div>' +
    "</div>" +
    // Preview Panel (hidden by default)
    '<div class="m2-section m2-preview-panel" id="m2-preview-panel" style="display:none">' +
    '  <div class="m2-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">preview</i>' +
    "    Impact Preview" +
    "  </div>" +
    '  <div class="m2-preview-content" id="m2-preview-content"></div>' +
    "</div>" +
    // M2 Action Bar
    '<div class="m2-action-bar">' +
    '  <button class="btn btn-secondary m2-btn-preview" id="m2-btn-preview" style="border-color:' +
    accent +
    ";color:" +
    accent +
    '">' +
    '    <i class="material-icons">visibility</i> Preview Impact' +
    "  </button>" +
    '  <button class="btn btn-primary m2-btn-deploy" id="m2-btn-deploy" disabled style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> Deploy Strategy' +
    "  </button>" +
    "</div>" +
    "</div>";

  // Bind events after DOM is ready
  m2BindEvents();
  m2RenderTenantList();
  m2UpdateSummary();
  m2UpdateGauge();
  m2Validate();
  m2UpdateErrors();
  m2UpdateDeployButton();
}

/* ─── M2 Event Binding ────────────────────────────────────────────── */

function m2BindEvents() {
  var minInput = document.getElementById("m2-min-soc");
  var maxInput = document.getElementById("m2-max-soc");
  var emrInput = document.getElementById("m2-emergency-reserve");
  var selectAll = document.getElementById("m2-select-all");
  var btnPreview = document.getElementById("m2-btn-preview");
  var btnDeploy = document.getElementById("m2-btn-deploy");

  if (minInput)
    minInput.addEventListener("input", function () {
      m2State.min_soc = parseFloat(this.value);
      m2OnFormChange();
    });
  if (maxInput)
    maxInput.addEventListener("input", function () {
      m2State.max_soc = parseFloat(this.value);
      m2OnFormChange();
    });
  if (emrInput)
    emrInput.addEventListener("input", function () {
      m2State.emergency_reserve = parseFloat(this.value);
      m2OnFormChange();
    });

  if (selectAll)
    selectAll.addEventListener("change", function () {
      var checked = this.checked;
      for (var i = 0; i < M2_TENANTS.length; i++) {
        m2State.selectedTenants[M2_TENANTS[i].id] = checked;
      }
      m2RenderTenantList();
      m2UpdateSummary();
      m2UpdateDeployButton();
    });

  if (btnPreview) btnPreview.addEventListener("click", m2TogglePreview);
  if (btnDeploy) btnDeploy.addEventListener("click", m2ShowConfirmModal);
}

function m2OnFormChange() {
  m2Validate();
  m2UpdateErrors();
  m2UpdateGauge();
  m2UpdateDeployButton();
  if (m2State.previewVisible) m2UpdatePreviewContent();
}

/* ─── M2 Tenant List ──────────────────────────────────────────────── */

function m2RenderTenantList() {
  var listEl = document.getElementById("m2-tenant-list");
  if (!listEl) return;

  var html = "";
  for (var i = 0; i < M2_TENANTS.length; i++) {
    var t = M2_TENANTS[i];
    var checked = m2State.selectedTenants[t.id] ? " checked" : "";
    html +=
      '<label class="m2-tenant-row">' +
      '  <input type="checkbox" class="m2-tenant-cb" data-tenant-id="' +
      t.id +
      '"' +
      checked +
      ">" +
      '  <span class="m2-tenant-info">' +
      '    <span class="m2-tenant-name">' +
      t.name +
      " — " +
      t.region +
      "</span>" +
      '    <span class="m2-device-badge">' +
      t.devices +
      " devices</span>" +
      "  </span>" +
      "</label>";
  }
  listEl.innerHTML = html;

  // Bind individual tenant checkboxes
  var cbs = listEl.querySelectorAll(".m2-tenant-cb");
  for (var j = 0; j < cbs.length; j++) {
    cbs[j].addEventListener("change", function () {
      var tid = this.getAttribute("data-tenant-id");
      m2State.selectedTenants[tid] = this.checked;
      m2UpdateSelectAllState();
      m2UpdateSummary();
      m2UpdateDeployButton();
    });
  }
}

function m2UpdateSelectAllState() {
  var selectAll = document.getElementById("m2-select-all");
  if (!selectAll) return;
  var allChecked = true;
  for (var i = 0; i < M2_TENANTS.length; i++) {
    if (!m2State.selectedTenants[M2_TENANTS[i].id]) {
      allChecked = false;
      break;
    }
  }
  selectAll.checked = allChecked;
}

function m2UpdateSummary() {
  var el = document.getElementById("m2-summary");
  if (!el) return;
  var tenantCount = m2GetSelectedCount();
  var deviceCount = m2GetSelectedDevices();
  el.textContent =
    "已選 " +
    tenantCount +
    " / " +
    M2_TENANTS.length +
    " 個租戶，共 " +
    deviceCount +
    " 台設備";
}

/* ─── M2 Error Display ────────────────────────────────────────────── */

function m2UpdateErrors() {
  var fields = [
    { key: "min_soc", inputId: "m2-min-soc", errId: "m2-err-min-soc" },
    { key: "max_soc", inputId: "m2-max-soc", errId: "m2-err-max-soc" },
    {
      key: "emergency_reserve",
      inputId: "m2-emergency-reserve",
      errId: "m2-err-emergency-reserve",
    },
  ];

  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var errEl = document.getElementById(f.errId);
    var inputEl = document.getElementById(f.inputId);
    var errMsg = m2State.errors[f.key] || "";
    if (errEl) errEl.textContent = errMsg;
    if (inputEl) {
      if (errMsg) {
        inputEl.classList.add("m2-input--error");
      } else {
        inputEl.classList.remove("m2-input--error");
      }
    }
  }
}

/* ─── M2 SoC Visual Gauge ─────────────────────────────────────────── */

function m2UpdateGauge() {
  var el = document.getElementById("m2-gauge");
  if (!el) return;

  var emr = Math.max(0, Math.min(100, m2State.emergency_reserve || 0));
  var min = Math.max(0, Math.min(100, m2State.min_soc || 0));
  var max = Math.max(0, Math.min(100, m2State.max_soc || 0));

  el.innerHTML =
    '<div class="m2-gauge-bar">' +
    '  <div class="m2-gauge-zone m2-gauge-red" style="width:' +
    emr +
    '%"></div>' +
    '  <div class="m2-gauge-zone m2-gauge-orange" style="width:' +
    Math.max(0, min - emr) +
    '%"></div>' +
    '  <div class="m2-gauge-zone m2-gauge-green" style="width:' +
    Math.max(0, max - min) +
    '%"></div>' +
    '  <div class="m2-gauge-zone m2-gauge-gray" style="width:' +
    Math.max(0, 100 - max) +
    '%"></div>' +
    "</div>" +
    '<div class="m2-gauge-labels">' +
    "  <span>0%</span>" +
    '  <span class="m2-gauge-marker" style="left:' +
    emr +
    '%">Emergency(' +
    emr +
    ")</span>" +
    '  <span class="m2-gauge-marker" style="left:' +
    min +
    '%">Min(' +
    min +
    ")</span>" +
    '  <span class="m2-gauge-marker" style="left:' +
    max +
    '%">Max(' +
    max +
    ")</span>" +
    "  <span>100%</span>" +
    "</div>";
}

/* ─── M2 Deploy Button State ──────────────────────────────────────── */

function m2UpdateDeployButton() {
  var btn = document.getElementById("m2-btn-deploy");
  if (!btn) return;
  var hasErrors = Object.keys(m2State.errors).length > 0;
  var hasSelection = m2GetSelectedCount() > 0;
  btn.disabled = hasErrors || !hasSelection;
}

/* ─── M2 Preview Impact ──────────────────────────────────────────── */

function m2TogglePreview() {
  m2State.previewVisible = !m2State.previewVisible;
  var panel = document.getElementById("m2-preview-panel");
  if (panel) {
    panel.style.display = m2State.previewVisible ? "block" : "none";
  }
  if (m2State.previewVisible) m2UpdatePreviewContent();
}

function m2UpdatePreviewContent() {
  var el = document.getElementById("m2-preview-content");
  if (!el) return;

  var tenantCount = m2GetSelectedCount();
  var deviceCount = m2GetSelectedDevices();
  var valid = Object.keys(m2State.errors).length === 0;

  var selectedNames = [];
  for (var i = 0; i < M2_TENANTS.length; i++) {
    if (m2State.selectedTenants[M2_TENANTS[i].id]) {
      selectedNames.push(
        M2_TENANTS[i].name + " (" + M2_TENANTS[i].devices + " devices)",
      );
    }
  }

  var html =
    '<div class="m2-preview-row">' +
    '  <span class="m2-preview-label">Strategy Parameters</span>' +
    '  <span class="m2-preview-value' +
    (valid ? "" : " m2-preview-invalid") +
    '">' +
    "    min_soc: " +
    m2State.min_soc +
    "% | max_soc: " +
    m2State.max_soc +
    "% | emergency_reserve: " +
    m2State.emergency_reserve +
    "%" +
    (valid
      ? ' <i class="material-icons" style="font-size:14px;color:var(--status-success)">check_circle</i>'
      : ' <i class="material-icons" style="font-size:14px;color:var(--status-error)">error</i> Validation failed') +
    "  </span>" +
    "</div>" +
    '<div class="m2-preview-row">' +
    '  <span class="m2-preview-label">Target Scope</span>' +
    '  <span class="m2-preview-value">' +
    tenantCount +
    " 個租戶，" +
    deviceCount +
    " 台設備</span>" +
    "</div>";

  if (selectedNames.length > 0) {
    html +=
      '<div class="m2-preview-row"><span class="m2-preview-label">Selected Tenants</span><ul class="m2-preview-list">';
    for (var j = 0; j < selectedNames.length; j++) {
      html += "<li>" + selectedNames[j] + "</li>";
    }
    html += "</ul></div>";
  }

  el.innerHTML = html;
}

/* ─── M2 Confirm Modal ────────────────────────────────────────────── */

function m2ShowConfirmModal() {
  var tenantCount = m2GetSelectedCount();
  var deviceCount = m2GetSelectedDevices();

  // Remove existing modal if any
  var existing = document.getElementById("m2-confirm-modal");
  if (existing) existing.parentNode.removeChild(existing);

  var overlay = document.createElement("div");
  overlay.id = "m2-confirm-modal";
  overlay.className = "m2-modal-overlay";
  overlay.innerHTML =
    '<div class="m2-modal">' +
    '  <div class="m2-modal-header">' +
    '    <i class="material-icons" style="color:#8b5cf6">warning</i>' +
    "    確認部署策略" +
    "  </div>" +
    '  <div class="m2-modal-body">' +
    "    即將把新 VPP 策略套用至 <strong>" +
    tenantCount +
    "</strong> 個租戶，" +
    "    共 <strong>" +
    deviceCount +
    "</strong> 台設備。" +
    "    此操作將立即生效，是否確認？" +
    "  </div>" +
    '  <div class="m2-modal-footer">' +
    '    <button class="btn btn-secondary" id="m2-modal-cancel">Cancel</button>' +
    '    <button class="btn btn-primary" id="m2-modal-confirm" style="background:#8b5cf6">' +
    '      <i class="material-icons">check</i> Confirm' +
    "    </button>" +
    "  </div>" +
    "</div>";

  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) m2CloseConfirmModal();
  });

  document
    .getElementById("m2-modal-cancel")
    .addEventListener("click", m2CloseConfirmModal);
  document
    .getElementById("m2-modal-confirm")
    .addEventListener("click", function () {
      m2CloseConfirmModal();
      m2DeploySuccess();
    });
}

function m2CloseConfirmModal() {
  var modal = document.getElementById("m2-confirm-modal");
  if (modal) {
    modal.classList.add("m2-modal-closing");
    setTimeout(function () {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }, 200);
  }
}

function m2DeploySuccess() {
  var tenantCount = m2GetSelectedCount();
  showToast(
    "✓ 策略發佈成功！已套用至 " + tenantCount + " 個租戶",
    "success",
    3000,
  );
}

/* ─── SECTION 3b: Panel Toggles ────────────────────────────────── */

function initToggleNav() {
  var btn = document.getElementById("btn-toggle-nav");
  var nav = document.getElementById("left-nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      nav.classList.toggle("collapsed");
    });
  }
}

function initToggleAudit() {
  var btn = document.getElementById("btn-toggle-audit");
  var panel = document.getElementById("audit-panel");
  if (btn && panel) {
    btn.addEventListener("click", function () {
      // On large screens (>=1440), toggle 'collapsed'
      // On medium screens (<1440), toggle 'expanded'
      if (window.innerWidth >= 1440) {
        panel.classList.toggle("collapsed");
      } else {
        panel.classList.toggle("expanded");
      }
    });
  }
}

/* ─── SECTION 8: Utilities ─────────────────────────────────────── */

function showToast(message, type, duration) {
  var container = document.getElementById("toast-container");
  if (!container) return;
  var ms = typeof duration === "number" ? duration : 5000;

  var toast = document.createElement("div");
  toast.className = "toast" + (type ? " toast--" + type : "");
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(function () {
    toast.style.animation = "toast-out 0.3s ease forwards";
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, ms);
}

/* ─── SECTION 3c: Keyboard Shortcuts ───────────────────────────── */

function initKeyboardShortcuts() {
  document.addEventListener("keydown", function (e) {
    // Don't trigger when focused on inputs
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    // Number keys 1-7 → switch modules
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 7 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      switchModule(MODULE_ORDER[num - 1]);
      return;
    }

    // Ctrl+[ → toggle audit panel
    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      var panel = document.getElementById("audit-panel");
      if (panel) {
        if (window.innerWidth >= 1440) {
          panel.classList.toggle("collapsed");
        } else {
          panel.classList.toggle("expanded");
        }
      }
    }
  });
}

/* ─── SECTION 9: Initialization ────────────────────────────────── */

function init() {
  initNavigation();
  initToggleNav();
  initToggleAudit();
  initKeyboardShortcuts();

  // Render default module
  var defaultMod = MODULE_REGISTRY[activeModuleId];
  if (defaultMod) {
    renderBreadcrumb(defaultMod);
    renderModuleContent(defaultMod);
  }

  // Welcome toast
  showToast("Control Plane UI loaded — Phase 1 Skeleton", "success");
}

document.addEventListener("DOMContentLoaded", init);
