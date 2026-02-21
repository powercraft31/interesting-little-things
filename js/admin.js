/* ═══════════════════════════════════════════════════════════════════
   SOLFACIL VPP — 控制平面管理界面
   Phase 1: 骨架 + 静态展示
   Phase 2: M2 算法引擎 — VPP 策略 + 批量操作
   Phase 3: M1 IoT Hub — 解析规则编辑器
   Phase 4: M3/M4/M5/M6/M7 编辑器 + 全局审计日志
   Phase 5: 统一输入验证 + M8 API 集成
   i18n:  EN/ZH 国际化支持
   ═══════════════════════════════════════════════════════════════════ */

/* ─── UUID 辅助函数 ──────────────────────────────────────────── */

// 生成 UUID，用于注入 x-trace-id 请求头
function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ─── 第0节：常量与配置 ──────────────────────────────────────── */

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
    editable: true,
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

/* ─── 共享输入验证 ───────────────────────────────────────────── */

// 校验指定模块编辑器中所有数字输入的有效性
function validateModuleInputs(moduleId) {
  var editor = document.querySelector("." + moduleId + "-editor");
  if (!editor) return true;
  var inputs = editor.querySelectorAll('input[type="number"]');
  var allValid = true;

  for (var i = 0; i < inputs.length; i++) {
    var input = inputs[i];
    var valid = input.checkValidity();
    var warnId = input.id + "-warn";
    var warnEl = document.getElementById(warnId);
    if (!warnEl) {
      warnEl = document.createElement("div");
      warnEl.id = warnId;
      warnEl.className = "cp-validation-warn";
      input.parentNode.appendChild(warnEl);
    }
    if (!valid) {
      allValid = false;
      var min = input.getAttribute("min");
      var max = input.getAttribute("max");
      var rangeText = "";
      if (min !== null && max !== null) {
        rangeText = " (Range: " + min + "\u2013" + max + ")";
      } else if (min !== null) {
        rangeText = " (Min: " + min + ")";
      } else if (max !== null) {
        rangeText = " (Max: " + max + ")";
      }
      warnEl.textContent = t("rangeError") + rangeText;
      warnEl.style.display = "block";
      input.classList.add("cp-input--invalid");
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
      input.classList.remove("cp-input--invalid");
    }
  }

  var btn = document.getElementById(moduleId + "-btn-deploy");
  if (btn) {
    btn.disabled = !allValid;
  }
  return allValid;
}

/* ─── 共享 API 部署 ──────────────────────────────────────────── */

// 通过 fetch 向后端发送配置部署请求，附带 x-trace-id
function apiDeploy(moduleId, profile, payload) {
  var mod = MODULE_REGISTRY[moduleId] || {};
  var moduleName = moduleId.toUpperCase() + " " + (mod.name || "");
  var traceId = generateUUID();

  fetch("/api/admin/configs/" + profile, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-trace-id": traceId,
    },
    body: JSON.stringify({
      config: payload,
      deployedBy: "admin@solfacil.com.br",
    }),
  })
    .then(function (res) {
      if (res.ok) {
        showToast(
          tpl("deploySuccess", { module: moduleName.trim() }),
          "success",
          3000,
        );
        addAuditEntry(
          moduleId.toUpperCase(),
          mod.name || moduleId,
          "DEPLOY",
          profile + " \u2192 BAKED (trace: " + traceId.slice(0, 8) + ")",
        );
      } else if (res.status >= 400 && res.status < 500) {
        showToast(
          tpl("deployFail403", { code: res.status }),
          "error",
          5000,
        );
      } else {
        showToast(
          tpl("deployFail500", { code: res.status }),
          "error",
          5000,
        );
      }
    })
    .catch(function () {
      showToast(t("deployFailNetwork"), "error", 5000);
    });
}

/* ═══════════════════════════════════════════════════════════════════
   第2节：M1 IoT Hub — 解析规则编辑器
   ═══════════════════════════════════════════════════════════════════ */

/* ─── M1 厂牌 JSON 模板 ──────────────────────────────────────── */

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
  { value: "Custom", labelKey: "customVendor" },
];

/* ─── M1 状态 ────────────────────────────────────────────────── */

var m1State = {
  selectedVendor: "Huawei",
  jsonText: M1_VENDOR_TEMPLATES.Huawei,
  originalJson: M1_VENDOR_TEMPLATES.Huawei,
  validationStatus: "neutral", // "neutral" | "valid" | "error"
  validationMessage: "",
  debounceTimer: null,
};

/* ─── M1 渲染器 ──────────────────────────────────────────────── */

function renderM1ParserRules(container, mod) {
  var accent = mod.accent;

  // 构建厂牌下拉选项
  var optionsHtml = "";
  for (var i = 0; i < M1_VENDOR_OPTIONS.length; i++) {
    var opt = M1_VENDOR_OPTIONS[i];
    var selected = opt.value === m1State.selectedVendor ? " selected" : "";
    var label = opt.labelKey ? t(opt.labelKey) : opt.label;
    optionsHtml +=
      '<option value="' +
      opt.value +
      '"' +
      selected +
      ">" +
      label +
      "</option>";
  }

  // 验证消息：根据当前状态决定显示内容
  var validationMsg = m1State.validationMessage || t("pressValidate");

  container.innerHTML =
    '<div class="fade-in m1-editor">' +
    // 模块标题
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    M1 IoT Hub &mdash; " +
    t("parserRulesEditor") +
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
    // 厂牌选择区
    '<div class="m1-section m1-vendor-section">' +
    '  <div class="m1-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">factory</i>' +
    "    " +
    t("manufacturer") +
    "  </div>" +
    '  <select class="m1-select" id="m1-vendor-select">' +
    optionsHtml +
    "  </select>" +
    "</div>" +
    // JSON 编辑器区
    '<div class="m1-section m1-json-section">' +
    '  <div class="m1-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">code</i>' +
    "    " +
    t("jsonEditor") +
    "  </div>" +
    '  <textarea class="m1-textarea" id="m1-json-editor" spellcheck="false">' +
    m1EscapeHtml(m1State.jsonText) +
    "</textarea>" +
    "</div>" +
    // 验证反馈
    '<div class="m1-validation" id="m1-validation">' +
    '  <span class="m1-validation-text m1-validation--' +
    m1State.validationStatus +
    '">' +
    m1EscapeHtml(validationMsg) +
    "  </span>" +
    "</div>" +
    // 操作按钮栏
    '<div class="m1-action-bar">' +
    '  <button class="btn btn-secondary m1-btn-validate" id="m1-btn-validate" style="border-color:' +
    accent +
    ";color:" +
    accent +
    '">' +
    '    <i class="material-icons">check_circle</i> ' +
    t("validateJson") +
    "  </button>" +
    '  <button class="btn btn-primary m1-btn-deploy" id="m1-btn-deploy" disabled style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> ' +
    t("deployParserRule") +
    "  </button>" +
    "</div>" +
    "</div>";

  m1BindEvents();
  m1UpdateDeployButton();
}

/* ─── M1 辅助函数 ────────────────────────────────────────────── */

// HTML 实体转义，防止 XSS
function m1EscapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── M1 事件绑定 ────────────────────────────────────────────── */

function m1BindEvents() {
  var vendorSelect = document.getElementById("m1-vendor-select");
  var jsonEditor = document.getElementById("m1-json-editor");
  var btnValidate = document.getElementById("m1-btn-validate");
  var btnDeploy = document.getElementById("m1-btn-deploy");

  // 厂牌切换时加载对应 JSON 模板
  if (vendorSelect) {
    vendorSelect.addEventListener("change", function () {
      m1State.selectedVendor = this.value;
      var template =
        M1_VENDOR_TEMPLATES[this.value] || M1_VENDOR_TEMPLATES.Custom;
      m1State.jsonText = template;
      m1State.originalJson = template;
      m1State.validationStatus = "neutral";
      m1State.validationMessage = t("pressValidate");
      var editor = document.getElementById("m1-json-editor");
      if (editor) editor.value = template;
      m1UpdateValidationDisplay();
      m1UpdateDeployButton();
    });
  }

  if (jsonEditor) {
    // Tab 键插入两个空格
    jsonEditor.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;
        var value = this.value;
        this.value = value.substring(0, start) + "  " + value.substring(end);
        this.selectionStart = start + 2;
        this.selectionEnd = start + 2;
        // 触发 input 事件同步状态
        m1OnEditorInput.call(this);
      }
    });

    // 输入时防抖自动验证
    jsonEditor.addEventListener("input", m1OnEditorInput);
  }

  if (btnValidate) btnValidate.addEventListener("click", m1ValidateJson);
  if (btnDeploy) btnDeploy.addEventListener("click", m1ShowConfirmModal);
}

// 编辑器输入处理：同步状态 + 防抖验证
function m1OnEditorInput() {
  m1State.jsonText = this.value;
  // 防抖自动验证 (800ms)
  if (m1State.debounceTimer) clearTimeout(m1State.debounceTimer);
  m1State.debounceTimer = setTimeout(function () {
    m1ValidateJson();
  }, 800);
  m1UpdateDeployButton();
}

/* ─── M1 JSON 验证 ───────────────────────────────────────────── */

function m1ValidateJson() {
  var text = m1State.jsonText.trim();
  if (!text) {
    m1State.validationStatus = "error";
    m1State.validationMessage = t("invalidJsonEmpty");
    m1UpdateValidationDisplay();
    m1UpdateDeployButton();
    return;
  }

  try {
    var parsed = JSON.parse(text);

    // 统计寄存器数量
    var registerCount = 0;
    if (parsed.registers && typeof parsed.registers === "object") {
      registerCount = Object.keys(parsed.registers).length;
    }
    var pollMs = parsed.poll_interval_ms || "N/A";

    m1State.validationStatus = "valid";
    m1State.validationMessage = tpl("validJsonDetail", {
      registers: registerCount,
      poll: pollMs,
    });
  } catch (err) {
    m1State.validationStatus = "error";
    m1State.validationMessage = tpl("invalidJsonError", {
      error: err.message,
    });
  }

  m1UpdateValidationDisplay();
  m1UpdateDeployButton();
}

// 更新验证状态 DOM 显示
function m1UpdateValidationDisplay() {
  var el = document.getElementById("m1-validation");
  if (!el) return;
  el.innerHTML =
    '<span class="m1-validation-text m1-validation--' +
    m1State.validationStatus +
    '">' +
    m1EscapeHtml(m1State.validationMessage || t("pressValidate")) +
    "</span>";
}

/* ─── M1 部署按钮状态 ───────────────────────────────────────── */

// 仅当验证通过且内容有变更时启用部署按钮
function m1UpdateDeployButton() {
  var btn = document.getElementById("m1-btn-deploy");
  if (!btn) return;
  var isValid = m1State.validationStatus === "valid";
  var hasChanges = m1State.jsonText !== m1State.originalJson;
  btn.disabled = !isValid || !hasChanges;
}

/* ─── M1 确认弹窗 ───────────────────────────────────────────── */

function m1ShowConfirmModal() {
  var vendor = m1State.selectedVendor;

  // 移除已存在的弹窗
  var existing = document.getElementById("m1-confirm-modal");
  if (existing) existing.parentNode.removeChild(existing);

  var overlay = document.createElement("div");
  overlay.id = "m1-confirm-modal";
  overlay.className = "m1-modal-overlay";
  overlay.innerHTML =
    '<div class="m1-modal">' +
    '  <div class="m1-modal-header">' +
    '    <i class="material-icons" style="color:#06b6d4">warning</i>' +
    "    " +
    t("confirmDeploy") +
    "  </div>" +
    '  <div class="m1-modal-body">' +
    tpl("confirmDeployBody", { vendor: m1EscapeHtml(vendor) }) +
    "  </div>" +
    '  <div class="m1-modal-footer">' +
    '    <button class="btn btn-secondary" id="m1-modal-cancel">' +
    t("cancel") +
    "</button>" +
    '    <button class="btn btn-primary" id="m1-modal-confirm" style="background:#06b6d4">' +
    '      <i class="material-icons">check</i> ' +
    t("confirm") +
    "    </button>" +
    "  </div>" +
    "</div>";

  document.body.appendChild(overlay);

  // 点击遮罩层关闭
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

// 关闭 M1 确认弹窗（带动画）
function m1CloseConfirmModal() {
  var modal = document.getElementById("m1-confirm-modal");
  if (modal) {
    modal.classList.add("m1-modal-closing");
    setTimeout(function () {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }, 200);
  }
}

// M1 部署成功：保存当前 JSON 为基准，调用 API
function m1DeploySuccess() {
  m1State.originalJson = m1State.jsonText;
  m1UpdateDeployButton();
  var parsed;
  try {
    parsed = JSON.parse(m1State.jsonText);
  } catch (e) {
    parsed = {};
  }
  apiDeploy("m1", "parser-rules", {
    vendor: parsed.vendor,
    protocol: parsed.protocol,
    registers: parsed.registers,
    poll_interval_ms: parsed.poll_interval_ms,
  });
}

/* ─── 第3节：导航与布局 ──────────────────────────────────────── */

// 初始化左侧导航栏：根据 MODULE_REGISTRY 渲染模块列表
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

  // 绑定导航点击事件
  var items = navList.querySelectorAll(".nav-item");
  for (var j = 0; j < items.length; j++) {
    items[j].addEventListener("click", handleNavClick);
  }
}

// 导航点击处理
function handleNavClick(e) {
  var item = e.currentTarget;
  var moduleId = item.getAttribute("data-module");
  if (moduleId && moduleId !== activeModuleId) {
    switchModule(moduleId);
  }
}

// 切换当前活动模块
function switchModule(moduleId) {
  var mod = MODULE_REGISTRY[moduleId];
  if (!mod) return;

  activeModuleId = moduleId;

  // 更新导航栏选中状态
  var items = document.querySelectorAll("#nav-modules .nav-item");
  for (var i = 0; i < items.length; i++) {
    var id = items[i].getAttribute("data-module");
    if (id === moduleId) {
      items[i].classList.add("active");
    } else {
      items[i].classList.remove("active");
    }
  }

  // 更新面包屑
  renderBreadcrumb(mod);

  // 渲染模块内容
  renderModuleContent(mod);
}

// 渲染面包屑导航
function renderBreadcrumb(mod) {
  var el = document.getElementById("breadcrumb-module");
  if (el) {
    el.textContent = mod.id.toUpperCase() + " " + mod.name;
  }
}

// 根据模块 ID 路由到对应渲染函数
function renderModuleContent(mod) {
  var container = document.getElementById("module-content");
  if (!container) return;

  // 路由到各模块专属渲染器
  if (mod.id === "m1") {
    renderM1ParserRules(container, mod);
    return;
  }
  if (mod.id === "m2") {
    renderM2VppStrategies(container, mod);
    return;
  }
  if (mod.id === "m3") {
    renderM3DispatchPolicies(container, mod);
    return;
  }
  if (mod.id === "m4") {
    renderM4BillingRules(container, mod);
    return;
  }
  if (mod.id === "m5") {
    renderM5FeatureFlags(container, mod);
    return;
  }
  if (mod.id === "m6") {
    renderM6RbacPolicies(container, mod);
    return;
  }
  if (mod.id === "m7") {
    renderM7ApiQuotas(container, mod);
    return;
  }

  // 其他模块显示占位符
  renderModulePlaceholder(container, mod);
}

// 语言切换后重新渲染当前模块（由 i18n.js 的 setLang 调用）
function renderCurrentModule() {
  var mod = MODULE_REGISTRY[activeModuleId];
  if (mod) {
    renderBreadcrumb(mod);
    renderModuleContent(mod);
  }
  // 重新渲染审计面板标题（静态 HTML 中的标题不变，但模块内容已刷新）
}

// 模块占位符（未实现的模块）
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
   第4节：M2 算法引擎 — VPP 策略 + 批量操作
   ═══════════════════════════════════════════════════════════════════ */

/* ─── M2 模拟数据 ────────────────────────────────────────────── */

var M2_TENANTS = [
  { id: "tenant-a", name: "Tenant A", region: "S\u00e3o Paulo Fleet", devices: 12 },
  { id: "tenant-b", name: "Tenant B", region: "Rio de Janeiro", devices: 5 },
  { id: "fleet-c", name: "Fleet C", region: "Minas Gerais", devices: 8 },
  { id: "tenant-d", name: "Tenant D", region: "Bras\u00edlia", devices: 3 },
  { id: "fleet-e", name: "Fleet E", region: "Curitiba", devices: 7 },
];

/* ─── M2 状态 ────────────────────────────────────────────────── */

var m2State = {
  min_soc: 20,
  max_soc: 90,
  emergency_reserve: 10,
  selectedTenants: {},
  errors: {},
  previewVisible: false,
};

// 重置 M2 状态到默认值
function m2ResetState() {
  m2State.min_soc = 20;
  m2State.max_soc = 90;
  m2State.emergency_reserve = 10;
  m2State.selectedTenants = {};
  m2State.errors = {};
  m2State.previewVisible = false;
}

/* ─── M2 验证 ────────────────────────────────────────────────── */

function m2Validate() {
  var errors = {};
  var min = m2State.min_soc;
  var max = m2State.max_soc;
  var emr = m2State.emergency_reserve;

  if (isNaN(min) || min < 0 || min > 100) {
    errors.min_soc = t("errMinSocRange");
  }
  if (isNaN(max) || max < 0 || max > 100) {
    errors.max_soc = t("errMaxSocRange");
  }
  if (isNaN(emr) || emr < 0 || emr > 50) {
    errors.emergency_reserve = t("errEmergencyRange");
  }

  if (!errors.min_soc && !errors.max_soc && min >= max) {
    errors.min_soc = t("errMinGteMax");
    errors.max_soc = t("errMaxLteMin");
  }
  if (!errors.emergency_reserve && !errors.min_soc && emr > min) {
    errors.emergency_reserve = t("errEmergencyGtMin");
  }

  m2State.errors = errors;
  return Object.keys(errors).length === 0;
}

/* ─── M2 选择辅助 ────────────────────────────────────────────── */

// 获取已选租户数量
function m2GetSelectedCount() {
  var count = 0;
  for (var i = 0; i < M2_TENANTS.length; i++) {
    if (m2State.selectedTenants[M2_TENANTS[i].id]) count++;
  }
  return count;
}

// 获取已选租户的总设备数
function m2GetSelectedDevices() {
  var total = 0;
  for (var i = 0; i < M2_TENANTS.length; i++) {
    if (m2State.selectedTenants[M2_TENANTS[i].id])
      total += M2_TENANTS[i].devices;
  }
  return total;
}

/* ─── M2 渲染器 ──────────────────────────────────────────────── */

function renderM2VppStrategies(container, mod) {
  var accent = mod.accent;

  container.innerHTML =
    '<div class="fade-in m2-editor">' +
    // 模块标题
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    " +
    t("algorithmEngine") +
    " &mdash; " +
    t("vppStrategies") +
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
    // SoC 阈值表单
    '<div class="m2-section">' +
    '  <div class="m2-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">tune</i>' +
    "    " +
    t("socThresholds") +
    "  </div>" +
    '  <div class="m2-form-grid">' +
    '    <div class="m2-field">' +
    '      <label class="m2-label" for="m2-min-soc">' +
    t("minSoc") +
    "</label>" +
    '      <input type="number" id="m2-min-soc" class="m2-input" min="0" max="100" step="1" value="' +
    m2State.min_soc +
    '">' +
    '      <div class="m2-error" id="m2-err-min-soc"></div>' +
    "    </div>" +
    '    <div class="m2-field">' +
    '      <label class="m2-label" for="m2-max-soc">' +
    t("maxSoc") +
    "</label>" +
    '      <input type="number" id="m2-max-soc" class="m2-input" min="0" max="100" step="1" value="' +
    m2State.max_soc +
    '">' +
    '      <div class="m2-error" id="m2-err-max-soc"></div>' +
    "    </div>" +
    '    <div class="m2-field">' +
    '      <label class="m2-label" for="m2-emergency-reserve">' +
    t("emergencyReserve") +
    "</label>" +
    '      <input type="number" id="m2-emergency-reserve" class="m2-input" min="0" max="50" step="1" value="' +
    m2State.emergency_reserve +
    '">' +
    '      <div class="m2-error" id="m2-err-emergency-reserve"></div>' +
    "    </div>" +
    "  </div>" +
    // SoC 可视化仪表
    '  <div class="m2-gauge" id="m2-gauge"></div>' +
    "</div>" +
    // 批量操作 — 目标范围
    '<div class="m2-section">' +
    '  <div class="m2-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">groups</i>' +
    "    " +
    t("targetScope") +
    "  </div>" +
    '  <div class="m2-select-all">' +
    '    <label class="m2-checkbox-label">' +
    '      <input type="checkbox" id="m2-select-all">' +
    "      <span>" +
    t("selectAll") +
    "</span>" +
    "    </label>" +
    "  </div>" +
    '  <div class="m2-tenant-list" id="m2-tenant-list"></div>' +
    '  <div class="m2-summary" id="m2-summary"></div>' +
    "</div>" +
    // 预览面板（默认隐藏）
    '<div class="m2-section m2-preview-panel" id="m2-preview-panel" style="display:none">' +
    '  <div class="m2-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">preview</i>' +
    "    " +
    t("previewImpact") +
    "  </div>" +
    '  <div class="m2-preview-content" id="m2-preview-content"></div>' +
    "</div>" +
    // M2 操作按钮栏
    '<div class="m2-action-bar">' +
    '  <button class="btn btn-secondary m2-btn-preview" id="m2-btn-preview" style="border-color:' +
    accent +
    ";color:" +
    accent +
    '">' +
    '    <i class="material-icons">visibility</i> ' +
    t("previewImpact") +
    "  </button>" +
    '  <button class="btn btn-primary m2-btn-deploy" id="m2-btn-deploy" disabled style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> ' +
    t("deployStrategy") +
    "  </button>" +
    "</div>" +
    "</div>";

  // DOM 就绪后绑定事件
  m2BindEvents();
  m2RenderTenantList();
  m2UpdateSummary();
  m2UpdateGauge();
  m2Validate();
  m2UpdateErrors();
  m2UpdateDeployButton();
}

/* ─── M2 事件绑定 ────────────────────────────────────────────── */

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

  // 全选/取消全选
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

// 表单变更时触发验证、仪表更新、部署按钮状态
function m2OnFormChange() {
  m2Validate();
  m2UpdateErrors();
  m2UpdateGauge();
  m2UpdateDeployButton();
  if (m2State.previewVisible) m2UpdatePreviewContent();
}

/* ─── M2 租户列表 ────────────────────────────────────────────── */

function m2RenderTenantList() {
  var listEl = document.getElementById("m2-tenant-list");
  if (!listEl) return;

  var html = "";
  for (var i = 0; i < M2_TENANTS.length; i++) {
    var tenant = M2_TENANTS[i];
    var checked = m2State.selectedTenants[tenant.id] ? " checked" : "";
    html +=
      '<label class="m2-tenant-row">' +
      '  <input type="checkbox" class="m2-tenant-cb" data-tenant-id="' +
      tenant.id +
      '"' +
      checked +
      ">" +
      '  <span class="m2-tenant-info">' +
      '    <span class="m2-tenant-name">' +
      tenant.name +
      " \u2014 " +
      tenant.region +
      "</span>" +
      '    <span class="m2-device-badge">' +
      tenant.devices +
      " " +
      t("devices") +
      "</span>" +
      "  </span>" +
      "</label>";
  }
  listEl.innerHTML = html;

  // 绑定单个租户复选框事件
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

// 同步全选复选框状态
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

// 更新选择摘要
function m2UpdateSummary() {
  var el = document.getElementById("m2-summary");
  if (!el) return;
  var tenantCount = m2GetSelectedCount();
  var deviceCount = m2GetSelectedDevices();
  el.textContent = tpl("tenantsSummary", {
    sel: tenantCount,
    total: M2_TENANTS.length,
    devices: deviceCount,
  });
}

/* ─── M2 错误显示 ────────────────────────────────────────────── */

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

/* ─── M2 SoC 可视化仪表 ──────────────────────────────────────── */

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

/* ─── M2 部署按钮状态 ───────────────────────────────────────── */

// 仅当无验证错误且已选择租户时启用
function m2UpdateDeployButton() {
  var btn = document.getElementById("m2-btn-deploy");
  if (!btn) return;
  var hasErrors = Object.keys(m2State.errors).length > 0;
  var hasSelection = m2GetSelectedCount() > 0;
  btn.disabled = hasErrors || !hasSelection;
}

/* ─── M2 预览影响 ────────────────────────────────────────────── */

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
        M2_TENANTS[i].name + " (" + M2_TENANTS[i].devices + " " + t("devices") + ")",
      );
    }
  }

  var html =
    '<div class="m2-preview-row">' +
    '  <span class="m2-preview-label">' +
    t("strategyParams") +
    "</span>" +
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
      : ' <i class="material-icons" style="font-size:14px;color:var(--status-error)">error</i> ' +
        t("validationFailed")) +
    "  </span>" +
    "</div>" +
    '<div class="m2-preview-row">' +
    '  <span class="m2-preview-label">' +
    t("targetScope") +
    "</span>" +
    '  <span class="m2-preview-value">' +
    tpl("tenantsCount", { n: tenantCount }) +
    "\uFF0C" +
    tpl("devicesCount", { n: deviceCount }) +
    "</span>" +
    "</div>";

  if (selectedNames.length > 0) {
    html +=
      '<div class="m2-preview-row"><span class="m2-preview-label">' +
      t("selectedTenants") +
      '</span><ul class="m2-preview-list">';
    for (var j = 0; j < selectedNames.length; j++) {
      html += "<li>" + selectedNames[j] + "</li>";
    }
    html += "</ul></div>";
  }

  el.innerHTML = html;
}

/* ─── M2 确认弹窗 ────────────────────────────────────────────── */

function m2ShowConfirmModal() {
  var tenantCount = m2GetSelectedCount();
  var deviceCount = m2GetSelectedDevices();

  // 移除已存在的弹窗
  var existing = document.getElementById("m2-confirm-modal");
  if (existing) existing.parentNode.removeChild(existing);

  var overlay = document.createElement("div");
  overlay.id = "m2-confirm-modal";
  overlay.className = "m2-modal-overlay";
  overlay.innerHTML =
    '<div class="m2-modal">' +
    '  <div class="m2-modal-header">' +
    '    <i class="material-icons" style="color:#8b5cf6">warning</i>' +
    "    " +
    t("confirmStrategy") +
    "  </div>" +
    '  <div class="m2-modal-body">' +
    tpl("confirmStrategyBody", {
      tenants: tenantCount,
      devices: deviceCount,
    }) +
    "  </div>" +
    '  <div class="m2-modal-footer">' +
    '    <button class="btn btn-secondary" id="m2-modal-cancel">' +
    t("cancel") +
    "</button>" +
    '    <button class="btn btn-primary" id="m2-modal-confirm" style="background:#8b5cf6">' +
    '      <i class="material-icons">check</i> ' +
    t("confirm") +
    "    </button>" +
    "  </div>" +
    "</div>";

  document.body.appendChild(overlay);

  // 点击遮罩层关闭
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

// 关闭 M2 确认弹窗（带动画）
function m2CloseConfirmModal() {
  var modal = document.getElementById("m2-confirm-modal");
  if (modal) {
    modal.classList.add("m2-modal-closing");
    setTimeout(function () {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }, 200);
  }
}

// M2 部署成功：收集目标租户并调用 API
function m2DeploySuccess() {
  var targets = [];
  for (var i = 0; i < M2_TENANTS.length; i++) {
    if (m2State.selectedTenants[M2_TENANTS[i].id])
      targets.push(M2_TENANTS[i].id);
  }
  apiDeploy("m2", "vpp-strategies", {
    min_soc: m2State.min_soc,
    max_soc: m2State.max_soc,
    emergency_reserve: m2State.emergency_reserve,
    targets: targets,
  });
}

/* ═══════════════════════════════════════════════════════════════════
   第5节：M3 DR 调度器 — 调度策略
   ═══════════════════════════════════════════════════════════════════ */

var m3State = {
  max_retries: 3,
  dispatch_timeout_ms: 5000,
  priority_order: "SOC\u4F18\u5148",
};

function renderM3DispatchPolicies(container, mod) {
  var accent = mod.accent;

  // 优先级选项映射
  var priorities = [
    { value: "SOC\u4F18\u5148", key: "prioritySoc" },
    { value: "\u5BB9\u91CF\u4F18\u5148", key: "priorityCapacity" },
    { value: "\u54CD\u5E94\u901F\u5EA6\u4F18\u5148", key: "prioritySpeed" },
  ];
  var priorityOptions = "";
  for (var i = 0; i < priorities.length; i++) {
    var p = priorities[i];
    var sel = m3State.priority_order === p.value ? " selected" : "";
    priorityOptions +=
      '<option value="' + p.value + '"' + sel + ">" + t(p.key) + "</option>";
  }

  container.innerHTML =
    '<div class="fade-in m3-editor">' +
    // 模块标题
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    " +
    t("drDispatcher") +
    " &mdash; " +
    t("dispatchPolicies") +
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
    // 表单区
    '<div class="cp-section">' +
    '  <div class="cp-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">tune</i>' +
    "    " +
    t("dispatchParams") +
    "  </div>" +
    '  <div class="cp-form-grid">' +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m3-max-retries">' +
    t("maxRetries") +
    "</label>" +
    '      <input type="number" id="m3-max-retries" class="cp-input" min="1" max="10" step="1" value="' +
    m3State.max_retries +
    '">' +
    '      <div class="cp-hint">Range: 1 \u2013 10</div>' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m3-dispatch-timeout">' +
    t("dispatchTimeout") +
    "</label>" +
    '      <input type="number" id="m3-dispatch-timeout" class="cp-input" min="1000" max="30000" step="100" value="' +
    m3State.dispatch_timeout_ms +
    '">' +
    '      <div class="cp-hint">Range: 1000 \u2013 30000</div>' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m3-priority-order">' +
    t("priorityOrder") +
    "</label>" +
    '      <select class="cp-select" id="m3-priority-order">' +
    priorityOptions +
    "      </select>" +
    "    </div>" +
    "  </div>" +
    "</div>" +
    // 操作按钮栏
    '<div class="cp-action-bar">' +
    '  <button class="btn btn-primary cp-btn-deploy" id="m3-btn-deploy" style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> ' +
    t("deployDispatch") +
    "  </button>" +
    "</div>" +
    "</div>";

  m3BindEvents();
  validateModuleInputs("m3");
}

// M3 事件绑定
function m3BindEvents() {
  var retryInput = document.getElementById("m3-max-retries");
  var timeoutInput = document.getElementById("m3-dispatch-timeout");
  var prioritySelect = document.getElementById("m3-priority-order");
  var btnDeploy = document.getElementById("m3-btn-deploy");

  if (retryInput)
    retryInput.addEventListener("input", function () {
      m3State.max_retries = parseInt(this.value, 10) || 3;
      validateModuleInputs("m3");
    });
  if (timeoutInput)
    timeoutInput.addEventListener("input", function () {
      m3State.dispatch_timeout_ms = parseInt(this.value, 10) || 5000;
      validateModuleInputs("m3");
    });
  if (prioritySelect)
    prioritySelect.addEventListener("change", function () {
      m3State.priority_order = this.value;
    });
  if (btnDeploy) btnDeploy.addEventListener("click", m3ShowConfirmModal);
}

// M3 确认弹窗
function m3ShowConfirmModal() {
  showGenericConfirmModal({
    id: "m3-confirm-modal",
    accent: "#f97316",
    title: t("confirmDispatch"),
    body: tpl("confirmDispatchBody", {
      retries: m3State.max_retries,
      timeout: m3State.dispatch_timeout_ms,
      priority: m3State.priority_order,
    }),
    onConfirm: function () {
      apiDeploy("m3", "dispatch-policies", {
        max_retries: m3State.max_retries,
        dispatch_timeout_ms: m3State.dispatch_timeout_ms,
        priority_order: m3State.priority_order,
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════
   第6节：M4 市场与计费 — 计费规则
   ═══════════════════════════════════════════════════════════════════ */

var m4State = {
  tariff_penalty_multiplier: 1.5,
  base_rate_kwh: 0.18,
  peak_multiplier: 1.8,
};

function renderM4BillingRules(container, mod) {
  var accent = mod.accent;

  container.innerHTML =
    '<div class="fade-in m4-editor">' +
    // 模块标题
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    " +
    t("marketBilling") +
    " &mdash; " +
    t("billingRules") +
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
    // 警告横幅
    '<div class="cp-warning-banner">' +
    '  <i class="material-icons">warning</i>' +
    "  <span>" +
    t("billingWarning") +
    "</span>" +
    "</div>" +
    // 表单区
    '<div class="cp-section">' +
    '  <div class="cp-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">tune</i>' +
    "    " +
    t("billingParams") +
    "  </div>" +
    '  <div class="cp-form-grid">' +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m4-penalty-multiplier">' +
    t("penaltyMultiplier") +
    "</label>" +
    '      <input type="number" id="m4-penalty-multiplier" class="cp-input" min="1.0" max="5.0" step="0.1" value="' +
    m4State.tariff_penalty_multiplier +
    '">' +
    '      <div class="cp-hint">Range: 1.0 \u2013 5.0</div>' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m4-base-rate">' +
    t("baseRate") +
    "</label>" +
    '      <input type="number" id="m4-base-rate" class="cp-input" min="0" step="0.001" value="' +
    m4State.base_rate_kwh +
    '">' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m4-peak-multiplier">' +
    t("peakMultiplier") +
    "</label>" +
    '      <input type="number" id="m4-peak-multiplier" class="cp-input" min="1.0" max="3.0" step="0.1" value="' +
    m4State.peak_multiplier +
    '">' +
    '      <div class="cp-hint">Range: 1.0 \u2013 3.0</div>' +
    "    </div>" +
    "  </div>" +
    "</div>" +
    // 操作按钮栏
    '<div class="cp-action-bar">' +
    '  <button class="btn btn-primary cp-btn-deploy" id="m4-btn-deploy" style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> ' +
    t("deployBilling") +
    "  </button>" +
    "</div>" +
    "</div>";

  m4BindEvents();
  validateModuleInputs("m4");
}

// M4 事件绑定
function m4BindEvents() {
  var penaltyInput = document.getElementById("m4-penalty-multiplier");
  var baseInput = document.getElementById("m4-base-rate");
  var peakInput = document.getElementById("m4-peak-multiplier");
  var btnDeploy = document.getElementById("m4-btn-deploy");

  if (penaltyInput)
    penaltyInput.addEventListener("input", function () {
      m4State.tariff_penalty_multiplier = parseFloat(this.value) || 1.5;
      validateModuleInputs("m4");
    });
  if (baseInput)
    baseInput.addEventListener("input", function () {
      m4State.base_rate_kwh = parseFloat(this.value) || 0.18;
      validateModuleInputs("m4");
    });
  if (peakInput)
    peakInput.addEventListener("input", function () {
      m4State.peak_multiplier = parseFloat(this.value) || 1.8;
      validateModuleInputs("m4");
    });
  if (btnDeploy) btnDeploy.addEventListener("click", m4ShowConfirmModal);
}

// M4 确认弹窗
function m4ShowConfirmModal() {
  showGenericConfirmModal({
    id: "m4-confirm-modal",
    accent: "#10b981",
    title: t("confirmBilling"),
    body: tpl("confirmBillingBody", {
      penalty: m4State.tariff_penalty_multiplier,
      base: m4State.base_rate_kwh,
      peak: m4State.peak_multiplier,
    }),
    onConfirm: function () {
      apiDeploy("m4", "billing-rules", {
        tariff_penalty_multiplier: m4State.tariff_penalty_multiplier,
        base_rate_kwh: m4State.base_rate_kwh,
        peak_multiplier: m4State.peak_multiplier,
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════
   第7节：M5 前端 BFF — 功能开关
   ═══════════════════════════════════════════════════════════════════ */

var m5State = {
  flags: [
    { key: "show-roi-metrics", labelKey: "showROI", enabled: true },
    { key: "enable-dr-notifications", labelKey: "drNotifications", enabled: true },
    { key: "show-battery-forecast", labelKey: "batteryForecast", enabled: false },
    { key: "enable-export-csv", labelKey: "exportCsv", enabled: false },
  ],
  originalFlags: null,
};

// 保存初始状态快照
function m5InitOriginal() {
  m5State.originalFlags = [];
  for (var i = 0; i < m5State.flags.length; i++) {
    m5State.originalFlags.push({
      key: m5State.flags[i].key,
      enabled: m5State.flags[i].enabled,
    });
  }
}

// 获取相对原始状态有变更的标志
function m5GetChangedFlags() {
  if (!m5State.originalFlags) return [];
  var changed = [];
  for (var i = 0; i < m5State.flags.length; i++) {
    if (m5State.flags[i].enabled !== m5State.originalFlags[i].enabled) {
      changed.push(m5State.flags[i]);
    }
  }
  return changed;
}

function renderM5FeatureFlags(container, mod) {
  var accent = mod.accent;
  if (!m5State.originalFlags) m5InitOriginal();

  var flagsHtml = "";
  for (var i = 0; i < m5State.flags.length; i++) {
    var f = m5State.flags[i];
    var checkedAttr = f.enabled ? " checked" : "";
    var statusText = f.enabled ? t("enabled") : t("disabled");
    var statusClass = f.enabled
      ? "cp-toggle-status--on"
      : "cp-toggle-status--off";
    flagsHtml +=
      '<div class="cp-flag-row">' +
      '  <div class="cp-flag-info">' +
      '    <div class="cp-flag-label">' +
      t(f.labelKey) +
      "</div>" +
      '    <div class="cp-flag-key">' +
      f.key +
      "</div>" +
      "  </div>" +
      '  <div class="cp-flag-controls">' +
      '    <span class="cp-toggle-status ' +
      statusClass +
      '" id="m5-status-' +
      i +
      '">' +
      statusText +
      "</span>" +
      '    <label class="cp-toggle-switch">' +
      '      <input type="checkbox" class="cp-toggle-input" data-flag-idx="' +
      i +
      '"' +
      checkedAttr +
      ">" +
      '      <span class="cp-toggle-slider"></span>' +
      "    </label>" +
      "  </div>" +
      "</div>";
  }

  container.innerHTML =
    '<div class="fade-in m5-editor">' +
    // 模块标题
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    " +
    t("bffFeatureFlags") +
    " &mdash; " +
    t("featureFlags") +
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
    // 功能开关区
    '<div class="cp-section">' +
    '  <div class="cp-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">toggle_on</i>' +
    "    " +
    t("featureFlags") +
    "  </div>" +
    '  <div class="cp-flag-list" id="m5-flag-list">' +
    flagsHtml +
    "  </div>" +
    "</div>" +
    // 操作按钮栏
    '<div class="cp-action-bar">' +
    '  <button class="btn btn-primary cp-btn-deploy" id="m5-btn-deploy" style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> ' +
    t("deployFeatureFlags") +
    "  </button>" +
    "</div>" +
    "</div>";

  m5BindEvents();
}

// M5 事件绑定
function m5BindEvents() {
  var toggles = document.querySelectorAll(".cp-toggle-input");
  for (var i = 0; i < toggles.length; i++) {
    toggles[i].addEventListener("change", function () {
      var idx = parseInt(this.getAttribute("data-flag-idx"), 10);
      m5State.flags[idx].enabled = this.checked;
      var statusEl = document.getElementById("m5-status-" + idx);
      if (statusEl) {
        statusEl.textContent = this.checked ? t("enabled") : t("disabled");
        statusEl.className =
          "cp-toggle-status " +
          (this.checked ? "cp-toggle-status--on" : "cp-toggle-status--off");
      }
    });
  }

  var btnDeploy = document.getElementById("m5-btn-deploy");
  if (btnDeploy) btnDeploy.addEventListener("click", m5ShowConfirmModal);
}

// M5 确认弹窗
function m5ShowConfirmModal() {
  var changed = m5GetChangedFlags();
  var changedHtml = "";
  if (changed.length > 0) {
    changedHtml =
      "<br><br><strong>" +
      t("changedItems") +
      '</strong><ul style="margin:4px 0 0 16px;">';
    for (var i = 0; i < changed.length; i++) {
      changedHtml +=
        "<li>" +
        changed[i].key +
        " \u2192 " +
        (changed[i].enabled ? "ON" : "OFF") +
        "</li>";
    }
    changedHtml += "</ul>";
  } else {
    changedHtml = "<br><br><em>" + t("noChangesDetected") + "</em>";
  }

  showGenericConfirmModal({
    id: "m5-confirm-modal",
    accent: "#ec4899",
    title: t("confirmFeatureFlags"),
    body:
      t("confirmFeatureFlagsBody") +
      changedHtml +
      "<br>" +
      t("confirmEffective"),
    onConfirm: function () {
      m5InitOriginal();
      var flagPayload = {};
      for (var j = 0; j < m5State.flags.length; j++) {
        flagPayload[m5State.flags[j].key] = m5State.flags[j].enabled;
      }
      apiDeploy("m5", "feature-flags", flagPayload);
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════
   第7b节：M6 身份与租户 — RBAC 策略
   ═══════════════════════════════════════════════════════════════════ */

var m6State = {
  session_timeout_min: 60,
  max_failed_logins: 5,
  default_tenant_role: "viewer",
  mfa_required: false,
};

function renderM6RbacPolicies(container, mod) {
  var accent = mod.accent;

  // 角色下拉选项
  var roleOptions =
    '<option value="viewer"' +
    (m6State.default_tenant_role === "viewer" ? " selected" : "") +
    ">" +
    t("roleViewer") +
    "</option>" +
    '<option value="operator"' +
    (m6State.default_tenant_role === "operator" ? " selected" : "") +
    ">" +
    t("roleOperator") +
    "</option>" +
    '<option value="admin"' +
    (m6State.default_tenant_role === "admin" ? " selected" : "") +
    ">" +
    t("roleAdmin") +
    "</option>";

  var mfaChecked = m6State.mfa_required ? " checked" : "";
  var mfaStatusText = m6State.mfa_required ? t("enabled") : t("disabled");
  var mfaStatusClass = m6State.mfa_required
    ? "cp-toggle-status--on"
    : "cp-toggle-status--off";

  container.innerHTML =
    '<div class="fade-in m6-editor">' +
    // 模块标题
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    " +
    t("identityTenant") +
    " &mdash; " +
    t("rbacPolicies") +
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
    // 表单区
    '<div class="cp-section">' +
    '  <div class="cp-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">security</i>' +
    "    " +
    t("rbacSettings") +
    "  </div>" +
    '  <div class="cp-form-grid m6-form-grid">' +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m6-session-timeout">' +
    t("sessionTimeout") +
    "</label>" +
    '      <input type="number" id="m6-session-timeout" class="cp-input" min="5" max="480" step="1" value="' +
    m6State.session_timeout_min +
    '">' +
    '      <div class="cp-hint">Range: 5 \u2013 480</div>' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m6-max-failed-logins">' +
    t("maxFailedLogins") +
    "</label>" +
    '      <input type="number" id="m6-max-failed-logins" class="cp-input" min="3" max="10" step="1" value="' +
    m6State.max_failed_logins +
    '">' +
    '      <div class="cp-hint">Range: 3 \u2013 10</div>' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m6-default-role">' +
    t("defaultTenantRole") +
    "</label>" +
    '      <select class="cp-select" id="m6-default-role">' +
    roleOptions +
    "      </select>" +
    "    </div>" +
    '    <div class="cp-field m6-mfa-field">' +
    '      <label class="cp-label">' +
    t("mfaRequired") +
    "</label>" +
    '      <div class="cp-flag-controls m6-mfa-row">' +
    '        <span class="cp-toggle-status ' +
    mfaStatusClass +
    '" id="m6-mfa-status">' +
    mfaStatusText +
    "</span>" +
    '        <label class="cp-toggle-switch">' +
    '          <input type="checkbox" class="cp-toggle-input" id="m6-mfa-toggle"' +
    mfaChecked +
    ">" +
    '          <span class="cp-toggle-slider"></span>' +
    "        </label>" +
    "      </div>" +
    "    </div>" +
    "  </div>" +
    "</div>" +
    // 操作按钮栏
    '<div class="cp-action-bar">' +
    '  <button class="btn btn-primary cp-btn-deploy" id="m6-btn-deploy" style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> ' +
    t("deployRbac") +
    "  </button>" +
    "</div>" +
    "</div>";

  m6BindEvents();
  validateModuleInputs("m6");
}

// M6 事件绑定
function m6BindEvents() {
  var timeoutInput = document.getElementById("m6-session-timeout");
  var failedInput = document.getElementById("m6-max-failed-logins");
  var roleSelect = document.getElementById("m6-default-role");
  var mfaToggle = document.getElementById("m6-mfa-toggle");
  var btnDeploy = document.getElementById("m6-btn-deploy");

  if (timeoutInput)
    timeoutInput.addEventListener("input", function () {
      m6State.session_timeout_min = parseInt(this.value, 10) || 60;
      validateModuleInputs("m6");
    });
  if (failedInput)
    failedInput.addEventListener("input", function () {
      m6State.max_failed_logins = parseInt(this.value, 10) || 5;
      validateModuleInputs("m6");
    });
  if (roleSelect)
    roleSelect.addEventListener("change", function () {
      m6State.default_tenant_role = this.value;
    });
  // MFA 开关切换
  if (mfaToggle)
    mfaToggle.addEventListener("change", function () {
      m6State.mfa_required = this.checked;
      var statusEl = document.getElementById("m6-mfa-status");
      if (statusEl) {
        statusEl.textContent = this.checked ? t("enabled") : t("disabled");
        statusEl.className =
          "cp-toggle-status " +
          (this.checked ? "cp-toggle-status--on" : "cp-toggle-status--off");
      }
    });
  if (btnDeploy) btnDeploy.addEventListener("click", m6ShowConfirmModal);
}

// M6 确认弹窗
function m6ShowConfirmModal() {
  showGenericConfirmModal({
    id: "m6-confirm-modal",
    accent: "#6366f1",
    title: t("confirmRbac"),
    body: tpl("confirmRbacBody", {
      timeout: m6State.session_timeout_min,
      logins: m6State.max_failed_logins,
      role: m6State.default_tenant_role,
      mfa: m6State.mfa_required ? "ON" : "OFF",
    }),
    onConfirm: function () {
      apiDeploy("m6", "rbac-policies", {
        session_timeout_min: m6State.session_timeout_min,
        max_failed_logins: m6State.max_failed_logins,
        default_tenant_role: m6State.default_tenant_role,
        mfa_required: m6State.mfa_required,
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════
   第8节：M7 Open API — API 配额与 Webhook
   ═══════════════════════════════════════════════════════════════════ */

var m7State = {
  webhook_timeout_ms: 5000,
  rate_limit_rpm: 100,
  max_payload_kb: 256,
};

function renderM7ApiQuotas(container, mod) {
  var accent = mod.accent;

  container.innerHTML =
    '<div class="fade-in m7-editor">' +
    // 模块标题
    '<div class="module-header">' +
    '  <div class="module-header-title" style="color:' +
    accent +
    '">' +
    '    <i class="material-icons">' +
    mod.icon +
    "</i>" +
    "    " +
    t("openApi") +
    " &mdash; " +
    t("apiQuotas") +
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
    // 表单区
    '<div class="cp-section">' +
    '  <div class="cp-section-title">' +
    '    <i class="material-icons" style="color:' +
    accent +
    '">tune</i>' +
    "    " +
    t("apiSettings") +
    "  </div>" +
    '  <div class="cp-form-grid">' +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m7-webhook-timeout">' +
    t("webhookTimeout") +
    "</label>" +
    '      <input type="number" id="m7-webhook-timeout" class="cp-input" min="1000" max="30000" step="100" value="' +
    m7State.webhook_timeout_ms +
    '">' +
    '      <div class="cp-hint">Range: 1000 \u2013 30000</div>' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m7-rate-limit">' +
    t("rateLimitRpm") +
    "</label>" +
    '      <input type="number" id="m7-rate-limit" class="cp-input" min="10" max="1000" step="10" value="' +
    m7State.rate_limit_rpm +
    '">' +
    '      <div class="cp-hint">Range: 10 \u2013 1000</div>' +
    "    </div>" +
    '    <div class="cp-field">' +
    '      <label class="cp-label" for="m7-max-payload">' +
    t("maxPayloadKb") +
    "</label>" +
    '      <input type="number" id="m7-max-payload" class="cp-input" min="16" max="1024" step="16" value="' +
    m7State.max_payload_kb +
    '">' +
    '      <div class="cp-hint">Range: 16 \u2013 1024</div>' +
    "    </div>" +
    "  </div>" +
    "</div>" +
    // 操作按钮栏
    '<div class="cp-action-bar">' +
    '  <button class="btn btn-primary cp-btn-deploy" id="m7-btn-deploy" style="background:' +
    accent +
    '">' +
    '    <i class="material-icons">rocket_launch</i> ' +
    t("deployApiQuotas") +
    "  </button>" +
    "</div>" +
    "</div>";

  m7BindEvents();
  validateModuleInputs("m7");
}

// M7 事件绑定
function m7BindEvents() {
  var whInput = document.getElementById("m7-webhook-timeout");
  var rlInput = document.getElementById("m7-rate-limit");
  var mpInput = document.getElementById("m7-max-payload");
  var btnDeploy = document.getElementById("m7-btn-deploy");

  if (whInput)
    whInput.addEventListener("input", function () {
      m7State.webhook_timeout_ms = parseInt(this.value, 10) || 5000;
      validateModuleInputs("m7");
    });
  if (rlInput)
    rlInput.addEventListener("input", function () {
      m7State.rate_limit_rpm = parseInt(this.value, 10) || 100;
      validateModuleInputs("m7");
    });
  if (mpInput)
    mpInput.addEventListener("input", function () {
      m7State.max_payload_kb = parseInt(this.value, 10) || 256;
      validateModuleInputs("m7");
    });
  if (btnDeploy) btnDeploy.addEventListener("click", m7ShowConfirmModal);
}

// M7 确认弹窗
function m7ShowConfirmModal() {
  showGenericConfirmModal({
    id: "m7-confirm-modal",
    accent: "#14b8a6",
    title: t("confirmApiQuotas"),
    body: tpl("confirmApiQuotasBody", {
      timeout: m7State.webhook_timeout_ms,
      rpm: m7State.rate_limit_rpm,
      payload: m7State.max_payload_kb,
    }),
    onConfirm: function () {
      apiDeploy("m7", "api-quotas", {
        webhook_timeout_ms: m7State.webhook_timeout_ms,
        rate_limit_rpm: m7State.rate_limit_rpm,
        max_payload_kb: m7State.max_payload_kb,
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════
   第9节：通用确认弹窗（M3/M4/M5/M7 共享）
   ═══════════════════════════════════════════════════════════════════ */

function showGenericConfirmModal(opts) {
  var existing = document.getElementById(opts.id);
  if (existing) existing.parentNode.removeChild(existing);

  var overlay = document.createElement("div");
  overlay.id = opts.id;
  overlay.className = "cp-modal-overlay";
  overlay.innerHTML =
    '<div class="cp-modal">' +
    '  <div class="cp-modal-header">' +
    '    <i class="material-icons" style="color:' +
    opts.accent +
    '">warning</i>' +
    "    " +
    opts.title +
    "  </div>" +
    '  <div class="cp-modal-body">' +
    opts.body +
    "</div>" +
    '  <div class="cp-modal-footer">' +
    '    <button class="btn btn-secondary" id="' +
    opts.id +
    '-cancel">' +
    t("cancel") +
    "</button>" +
    '    <button class="btn btn-primary" id="' +
    opts.id +
    '-confirm" style="background:' +
    opts.accent +
    '">' +
    '      <i class="material-icons">check</i> ' +
    t("confirm") +
    "    </button>" +
    "  </div>" +
    "</div>";

  document.body.appendChild(overlay);

  // 关闭弹窗辅助函数
  function closeModal() {
    overlay.classList.add("cp-modal-closing");
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 200);
  }

  // 点击遮罩层关闭
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });
  document
    .getElementById(opts.id + "-cancel")
    .addEventListener("click", closeModal);
  document
    .getElementById(opts.id + "-confirm")
    .addEventListener("click", function () {
      closeModal();
      if (typeof opts.onConfirm === "function") opts.onConfirm();
    });
}

/* ═══════════════════════════════════════════════════════════════════
   第10节：全局实时审计日志
   ═══════════════════════════════════════════════════════════════════ */

var auditLog = [
  {
    time: "16:45",
    type: "DEPLOY",
    module: "M2",
    detail: "vpp-strategies \u2192 BAKED",
    user: "admin@solfacil.com.br",
  },
  {
    time: "16:42",
    type: "EDIT",
    module: "M2",
    detail: "min_soc 20 \u2192 15",
    user: "admin@solfacil.com.br",
  },
  {
    time: "16:38",
    type: "ROLLBACK",
    module: "M4",
    detail: "billing-rules \u2192 AUTO ROLLBACK\nCW Alarm (Error>1%)",
    user: "",
  },
  {
    time: "16:30",
    type: "LOGIN",
    module: "",
    detail: "admin@solfacil.com.br",
    user: "",
  },
];

// 根据类型返回对应的 CSS 类名
function auditBadgeClass(type) {
  switch (type) {
    case "DEPLOY":
      return "audit-badge--deploy";
    case "EDIT":
      return "audit-badge--edit";
    case "ROLLBACK":
      return "audit-badge--rollback";
    case "LOGIN":
      return "audit-badge--login";
    default:
      return "audit-badge--neutral";
  }
}

// 渲染单条审计条目
function renderAuditEntry(entry, highlight) {
  var detailLines = (entry.detail || "").split("\n");
  var detailHtml = detailLines[0];
  for (var i = 1; i < detailLines.length; i++) {
    detailHtml += "<br>" + detailLines[i];
  }
  var moduleTag = entry.module ? "<strong>" + entry.module + "</strong> " : "";
  var userHtml = entry.user
    ? '<div class="audit-user">' + entry.user + "</div>"
    : "";
  var highlightClass = highlight ? " audit-entry--new" : "";

  return (
    '<div class="audit-entry' +
    highlightClass +
    '">' +
    '<div class="audit-time">' +
    entry.time +
    "</div>" +
    '<div class="audit-badge ' +
    auditBadgeClass(entry.type) +
    '">' +
    entry.type +
    "</div>" +
    '<div class="audit-detail">' +
    moduleTag +
    detailHtml +
    userHtml +
    "</div>" +
    "</div>"
  );
}

// 渲染完整审计面板
function renderAuditPanel() {
  var container = document.getElementById("audit-entries");
  if (!container) return;
  var html = "";
  for (var i = 0; i < auditLog.length; i++) {
    html += renderAuditEntry(auditLog[i], false);
  }
  container.innerHTML = html;
}

// 新增审计条目并插入到面板顶部（带高亮动画）
function addAuditEntry(moduleId, moduleName, action, detail) {
  var now = new Date();
  var hh =
    String(now.getHours()).length < 2
      ? "0" + now.getHours()
      : String(now.getHours());
  var mm =
    String(now.getMinutes()).length < 2
      ? "0" + now.getMinutes()
      : String(now.getMinutes());
  var ss =
    String(now.getSeconds()).length < 2
      ? "0" + now.getSeconds()
      : String(now.getSeconds());
  var timeStr = hh + ":" + mm + ":" + ss;

  var entry = {
    time: timeStr,
    type: action || "DEPLOY",
    module: moduleId.toUpperCase(),
    detail: detail,
    user: "admin@solfacil.com.br",
  };

  auditLog.unshift(entry);

  // 将新条目带高亮动画插入面板顶部
  var container = document.getElementById("audit-entries");
  if (!container) return;

  var entryHtml = renderAuditEntry(entry, true);
  var temp = document.createElement("div");
  temp.innerHTML = entryHtml;
  var newNode = temp.firstChild;
  container.insertBefore(newNode, container.firstChild);
}

/* ─── 第3b节：面板折叠切换 ──────────────────────────────────── */

// 初始化左侧导航折叠按钮
function initToggleNav() {
  var btn = document.getElementById("btn-toggle-nav");
  var nav = document.getElementById("left-nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      nav.classList.toggle("collapsed");
    });
  }
}

// 初始化审计面板折叠按钮
function initToggleAudit() {
  var btn = document.getElementById("btn-toggle-audit");
  var panel = document.getElementById("audit-panel");
  if (btn && panel) {
    btn.addEventListener("click", function () {
      // 大屏幕 (>=1440px) 切换 collapsed，中等屏幕 (<1440px) 切换 expanded
      if (window.innerWidth >= 1440) {
        panel.classList.toggle("collapsed");
      } else {
        panel.classList.toggle("expanded");
      }
    });
  }
}

/* ─── 工具函数 ───────────────────────────────────────────────── */

// 显示 Toast 通知
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

/* ─── 键盘快捷键 ─────────────────────────────────────────────── */

function initKeyboardShortcuts() {
  document.addEventListener("keydown", function (e) {
    // 焦点在输入控件时不触发
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    // 数字键 1-7 切换模块
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 7 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      switchModule(MODULE_ORDER[num - 1]);
      return;
    }

    // Ctrl+[ 切换审计面板
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

/* ─── 初始化入口 ─────────────────────────────────────────────── */

function init() {
  initNavigation();
  initToggleNav();
  initToggleAudit();
  initKeyboardShortcuts();

  // 渲染默认模块
  var defaultMod = MODULE_REGISTRY[activeModuleId];
  if (defaultMod) {
    renderBreadcrumb(defaultMod);
    renderModuleContent(defaultMod);
  }

  // 初始化审计日志面板
  renderAuditPanel();

  // 更新语言切换按钮状态
  updateTopBarLangButtons();

  // 欢迎提示
  showToast(t("uiLoaded"), "success");
}

document.addEventListener("DOMContentLoaded", init);
