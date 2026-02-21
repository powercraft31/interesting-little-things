/* ═══════════════════════════════════════════════════════════════════
   SOLFACIL VPP — Control Plane i18n
   国际化模块：支持英文 (EN) 与简体中文 (ZH)
   ═══════════════════════════════════════════════════════════════════ */

var I18N_DICT = {
  en: {
    // ─── M1: IoT Hub ───────────────────────────────────────────
    manufacturer: "Manufacturer",
    jsonEditor: "JSON Editor",
    validateJson: "Validate JSON",
    deployParserRule: "Deploy Parser Rule",
    validJson: "\u2713 Valid JSON",
    invalidJson: "\u2717 Invalid JSON",
    pressValidate: "Press Validate to check syntax",
    deploying: "Deploying...",
    deploySuccess: "\u2713 {module} strategy deployed to AppConfig successfully",
    deployFail403: "\u2717 Deploy failed ({code}): check backend permissions and AppConfig settings",
    deployFail500: "\u2717 Backend error ({code}): check Lambda logs or service status",
    deployFailNetwork: "\u2717 Network error: backend not started or unreachable",
    confirmDeploy: "Confirm Deploy Parser Rule",
    confirmDeployBody: "About to update <strong>{vendor}</strong> parser rules to AppConfig. Changes take effect immediately. Confirm?",
    confirmCancel: "Cancel",
    confirmOk: "Confirm",

    // ─── M2: Algorithm Engine ──────────────────────────────────
    algorithmEngine: "Algorithm Engine",
    vppStrategies: "VPP Strategies",
    socThresholds: "SoC Thresholds",
    minSoc: "Min SoC (%)",
    maxSoc: "Max SoC (%)",
    emergencyReserve: "Emergency Reserve (%)",
    targetScope: "Target Scope",
    selectAll: "Select All",
    deployStrategy: "Deploy Strategy",
    confirmStrategy: "Confirm Deploy Strategy",
    confirmStrategyBody: "About to apply new VPP strategy to <strong>{tenants}</strong> tenants, <strong>{devices}</strong> devices total. Takes effect immediately. Confirm?",
    selected: "selected",
    devices: "devices",
    devicesCount: "{n} devices total",
    tenantsCount: "{n} tenants selected",
    tenantsSummary: "Selected {sel} / {total} tenants, {devices} devices total",
    previewImpact: "Preview Impact",
    strategyParams: "Strategy Parameters",
    validationFailed: "Validation failed",

    // ─── M2 Validation Messages ────────────────────────────────
    errMinSocRange: "Min SoC must be between 0-100",
    errMaxSocRange: "Max SoC must be between 0-100",
    errEmergencyRange: "Emergency reserve must be between 0-50",
    errMinGteMax: "Min SoC must be less than Max SoC",
    errMaxLteMin: "Max SoC must be greater than Min SoC",
    errEmergencyGtMin: "Emergency reserve cannot exceed Min SoC",

    // ─── M3: DR Dispatcher ─────────────────────────────────────
    drDispatcher: "DR Dispatcher",
    dispatchPolicies: "Dispatch Policies",
    dispatchParams: "Dispatch Parameters",
    maxRetries: "Max Retries",
    dispatchTimeout: "Timeout (ms)",
    priorityOrder: "Priority Order",
    deployDispatch: "Deploy Dispatch Policy",
    confirmDispatch: "Confirm Deploy Dispatch Policy",
    confirmDispatchBody: "About to update DR Dispatcher dispatch policy to AppConfig.<br>Max Retries: <strong>{retries}</strong> | Timeout: <strong>{timeout}ms</strong> | Priority: <strong>{priority}</strong><br>Takes effect immediately. Confirm?",
    prioritySoc: "SOC Priority",
    priorityCapacity: "Capacity Priority",
    prioritySpeed: "Response Speed Priority",

    // ─── M4: Market & Billing ──────────────────────────────────
    marketBilling: "Market & Billing",
    billingRules: "Billing Rules",
    billingParams: "Billing Parameters",
    penaltyMultiplier: "Penalty Multiplier",
    baseRate: "Base Rate ($/kWh)",
    peakMultiplier: "Peak Multiplier",
    deployBilling: "Deploy Billing Rules",
    confirmBilling: "Confirm Deploy Billing Rules",
    confirmBillingBody: "About to update Market & Billing rules to AppConfig.<br>Penalty: <strong>{penalty}x</strong> | Base: <strong>${base}/kWh</strong> | Peak: <strong>{peak}x</strong><br><em style=\"color:#ef4444\">\u26A0 This affects billing calculations for all tenants</em><br>Takes effect immediately. Confirm?",
    billingWarning: "Warning: modifying billing rules affects billing calculations for all tenants. Proceed with caution.",

    // ─── M5: Frontend BFF ──────────────────────────────────────
    bffFeatureFlags: "Frontend BFF",
    featureFlags: "Feature Flags",
    showROI: "Show ROI Metrics",
    drNotifications: "DR Event Notifications",
    batteryForecast: "Battery Forecast Charts",
    exportCsv: "Export CSV Reports",
    enabled: "ON",
    disabled: "OFF",
    deployFeatureFlags: "Deploy Feature Flags",
    confirmFeatureFlags: "Confirm Deploy Feature Flags",
    confirmFeatureFlagsBody: "About to update Frontend BFF Feature Flags to AppConfig.",
    changedItems: "Changed Items:",
    noChangesDetected: "No changes detected.",
    confirmEffective: "Takes effect immediately. Confirm?",

    // ─── M6: Identity & Tenant ─────────────────────────────────
    identityTenant: "Identity & Tenant",
    rbacPolicies: "RBAC Policies",
    rbacSettings: "RBAC Authentication Settings",
    sessionTimeout: "Session Timeout (min)",
    maxFailedLogins: "Max Failed Logins",
    defaultTenantRole: "Default Tenant Role",
    mfaRequired: "MFA Required",
    deployRbac: "Deploy RBAC Policies",
    confirmRbac: "Confirm Deploy RBAC Policies",
    confirmRbacBody: "About to update rbac-policies to AppConfig.<br>Session Timeout: <strong>{timeout} min</strong> | Max Failed Logins: <strong>{logins}</strong> | Default Role: <strong>{role}</strong> | MFA: <strong>{mfa}</strong><br>Takes effect immediately. Confirm?",
    roleViewer: "viewer (Read-Only)",
    roleOperator: "operator (Operator)",
    roleAdmin: "admin (Admin)",

    // ─── M7: Open API ──────────────────────────────────────────
    openApi: "Open API",
    apiQuotas: "API Quotas",
    apiSettings: "API Quotas & Webhook Settings",
    webhookTimeout: "Webhook Timeout (ms)",
    rateLimitRpm: "Rate Limit (req/min)",
    maxPayloadKb: "Max Payload (KB)",
    deployApiQuotas: "Deploy API Quotas",
    confirmApiQuotas: "Confirm Deploy API Quotas",
    confirmApiQuotasBody: "About to update Open API Quotas & Webhook settings to AppConfig.<br>Webhook Timeout: <strong>{timeout}ms</strong> | Rate Limit: <strong>{rpm} req/min</strong> | Max Payload: <strong>{payload} KB</strong><br>Takes effect immediately. Confirm?",

    // ─── Common ────────────────────────────────────────────────
    validate: "Validate",
    deploy: "Deploy",
    previewDiff: "Preview Diff",
    deployToAppConfig: "Deploy to AppConfig",
    noChanges: "No changes",
    auditLog: "Audit Log",
    confirm: "Confirm",
    cancel: "Cancel",
    rangeError: "\u26A0 Value out of allowed range",
    controlPlane: "Control Plane",
    uiLoaded: "Control Plane UI loaded \u2014 All Modules Active",
    parserRulesEditor: "Parser Rules Editor",
    validJsonDetail: "\u2713 Valid JSON \u2014 {registers} registers, poll interval {poll}ms",
    invalidJsonEmpty: "\u2717 Invalid JSON: empty input",
    invalidJsonError: "\u2717 Invalid JSON: {error}",
    selectedTenants: "Selected Tenants",
    customVendor: "[Custom]",
  },

  zh: {
    // ─── M1: IoT Hub ───────────────────────────────────────────
    manufacturer: "\u5382\u724C",
    jsonEditor: "JSON \u7F16\u8F91\u5668",
    validateJson: "\u9A8C\u8BC1 JSON",
    deployParserRule: "\u90E8\u7F72\u89E3\u6790\u89C4\u5219",
    validJson: "\u2713 JSON \u683C\u5F0F\u6B63\u786E",
    invalidJson: "\u2717 JSON \u683C\u5F0F\u9519\u8BEF",
    pressValidate: "\u70B9\u51FB\u201C\u9A8C\u8BC1\u201D\u68C0\u67E5\u8BED\u6CD5",
    deploying: "\u90E8\u7F72\u4E2D...",
    deploySuccess: "\u2713 {module} \u7B56\u7565\u5DF2\u6210\u529F\u53D1\u5E03\u81F3 AppConfig",
    deployFail403: "\u2717 \u53D1\u5E03\u5931\u8D25 ({code})\uFF1A\u8BF7\u786E\u8BA4\u540E\u7AEF\u6743\u9650\u4E0E AppConfig \u8BBE\u7F6E",
    deployFail500: "\u2717 \u540E\u7AEF\u5F02\u5E38 ({code})\uFF1A\u8BF7\u68C0\u67E5 Lambda \u65E5\u5FD7\u6216\u670D\u52A1\u72B6\u6001",
    deployFailNetwork: "\u2717 \u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF1A\u540E\u7AEF\u672A\u542F\u52A8\u6216\u4E0D\u53EF\u8FBE",
    confirmDeploy: "\u786E\u8BA4\u90E8\u7F72\u89E3\u6790\u89C4\u5219",
    confirmDeployBody: "\u5373\u5C06\u66F4\u65B0 <strong>{vendor}</strong> \u7684\u89E3\u6790\u89C4\u5219\u81F3 AppConfig\uFF0C\u786E\u8BA4\u540E\u7ACB\u5373\u751F\u6548\u3002\u662F\u5426\u786E\u8BA4\uFF1F",
    confirmCancel: "\u53D6\u6D88",
    confirmOk: "\u786E\u8BA4",

    // ─── M2: Algorithm Engine ──────────────────────────────────
    algorithmEngine: "\u7B97\u6CD5\u5F15\u64CE",
    vppStrategies: "VPP \u7B56\u7565",
    socThresholds: "SoC \u9608\u503C",
    minSoc: "\u6700\u4F4E\u7535\u91CF (%)",
    maxSoc: "\u6700\u9AD8\u7535\u91CF (%)",
    emergencyReserve: "\u5907\u7528\u7535\u91CF (%)",
    targetScope: "\u76EE\u6807\u5957\u7528\u8303\u56F4",
    selectAll: "\u5168\u9009",
    deployStrategy: "\u90E8\u7F72\u7B56\u7565",
    confirmStrategy: "\u786E\u8BA4\u90E8\u7F72\u7B56\u7565",
    confirmStrategyBody: "\u5373\u5C06\u628A\u65B0 VPP \u7B56\u7565\u5957\u7528\u81F3 <strong>{tenants}</strong> \u4E2A\u79DF\u6237\uFF0C\u5171 <strong>{devices}</strong> \u53F0\u8BBE\u5907\u3002\u6B64\u64CD\u4F5C\u5C06\u7ACB\u5373\u751F\u6548\uFF0C\u662F\u5426\u786E\u8BA4\uFF1F",
    selected: "\u5DF2\u9009",
    devices: "\u8BBE\u5907",
    devicesCount: "\u5171 {n} \u53F0\u8BBE\u5907",
    tenantsCount: "\u5DF2\u9009 {n} \u4E2A\u79DF\u6237",
    tenantsSummary: "\u5DF2\u9009 {sel} / {total} \u4E2A\u79DF\u6237\uFF0C\u5171 {devices} \u53F0\u8BBE\u5907",
    previewImpact: "\u9884\u89C8\u5F71\u54CD",
    strategyParams: "\u7B56\u7565\u53C2\u6570",
    validationFailed: "\u9A8C\u8BC1\u5931\u8D25",

    // ─── M2 Validation Messages ────────────────────────────────
    errMinSocRange: "\u6700\u4F4E\u7535\u91CF\u5FC5\u987B\u5728 0\u201C100 \u4E4B\u95F4",
    errMaxSocRange: "\u6700\u9AD8\u7535\u91CF\u5FC5\u987B\u5728 0\u2013100 \u4E4B\u95F4",
    errEmergencyRange: "\u5907\u7528\u7535\u91CF\u5FC5\u987B\u5728 0\u201350 \u4E4B\u95F4",
    errMinGteMax: "\u6700\u4F4E\u7535\u91CF\u5FC5\u987B\u5C0F\u4E8E\u6700\u9AD8\u7535\u91CF",
    errMaxLteMin: "\u6700\u9AD8\u7535\u91CF\u5FC5\u987B\u5927\u4E8E\u6700\u4F4E\u7535\u91CF",
    errEmergencyGtMin: "\u5907\u7528\u7535\u91CF\u4E0D\u53EF\u8D85\u8FC7\u6700\u4F4E\u7535\u91CF",

    // ─── M3: DR Dispatcher ─────────────────────────────────────
    drDispatcher: "DR \u8C03\u5EA6\u5668",
    dispatchPolicies: "\u8C03\u5EA6\u7B56\u7565",
    dispatchParams: "\u8C03\u5EA6\u53C2\u6570",
    maxRetries: "\u6700\u5927\u91CD\u8BD5\u6B21\u6570",
    dispatchTimeout: "\u8C03\u5EA6\u8D85\u65F6 (ms)",
    priorityOrder: "\u8C03\u5EA6\u4F18\u5148\u987A\u5E8F",
    deployDispatch: "\u90E8\u7F72\u8C03\u5EA6\u7B56\u7565",
    confirmDispatch: "\u786E\u8BA4\u90E8\u7F72\u8C03\u5EA6\u7B56\u7565",
    confirmDispatchBody: "\u5373\u5C06\u66F4\u65B0 DR Dispatcher \u8C03\u5EA6\u7B56\u7565\u81F3 AppConfig\u3002<br>Max Retries: <strong>{retries}</strong> | Timeout: <strong>{timeout}ms</strong> | Priority: <strong>{priority}</strong><br>\u786E\u8BA4\u540E\u7ACB\u5373\u751F\u6548\u3002\u662F\u5426\u786E\u8BA4\uFF1F",
    prioritySoc: "SOC\u4F18\u5148",
    priorityCapacity: "\u5BB9\u91CF\u4F18\u5148",
    prioritySpeed: "\u54CD\u5E94\u901F\u5EA6\u4F18\u5148",

    // ─── M4: Market & Billing ──────────────────────────────────
    marketBilling: "\u5E02\u573A\u4E0E\u8BA1\u8D39",
    billingRules: "\u8BA1\u8D39\u89C4\u5219",
    billingParams: "\u8BA1\u8D39\u53C2\u6570",
    penaltyMultiplier: "\u8FDD\u7EA6\u60E9\u7F5A\u500D\u7387",
    baseRate: "\u57FA\u51C6\u7535\u8D39 ($/kWh)",
    peakMultiplier: "\u5C16\u5CF0\u65F6\u6BB5\u500D\u7387",
    deployBilling: "\u90E8\u7F72\u8BA1\u8D39\u89C4\u5219",
    confirmBilling: "\u786E\u8BA4\u90E8\u7F72\u8BA1\u8D39\u89C4\u5219",
    confirmBillingBody: "\u5373\u5C06\u66F4\u65B0 Market & Billing \u8BA1\u8D39\u89C4\u5219\u81F3 AppConfig\u3002<br>Penalty: <strong>{penalty}x</strong> | Base: <strong>${base}/kWh</strong> | Peak: <strong>{peak}x</strong><br><em style=\"color:#ef4444\">\u26A0 \u6B64\u64CD\u4F5C\u5F71\u54CD\u6240\u6709\u79DF\u6237\u8D26\u5355\u8BA1\u7B97</em><br>\u786E\u8BA4\u540E\u7ACB\u5373\u751F\u6548\u3002\u662F\u5426\u786E\u8BA4\uFF1F",
    billingWarning: "\u8B66\u544A\uFF1A\u4FEE\u6539\u8BA1\u8D39\u89C4\u5219\u5C06\u5F71\u54CD\u6240\u6709\u79DF\u6237\u7684\u8D26\u5355\u8BA1\u7B97\uFF0C\u8BF7\u8C28\u614E\u64CD\u4F5C",

    // ─── M5: Frontend BFF ──────────────────────────────────────
    bffFeatureFlags: "\u524D\u7AEF BFF",
    featureFlags: "\u529F\u80FD\u5F00\u5173",
    showROI: "\u663E\u793A\u6295\u8D44\u56DE\u62A5\u7387",
    drNotifications: "\u542F\u7528 DR \u4E8B\u4EF6\u901A\u77E5",
    batteryForecast: "\u663E\u793A\u7535\u6C60\u9884\u6D4B\u56FE\u8868",
    exportCsv: "\u5141\u8BB8\u5BFC\u51FA CSV \u62A5\u8868",
    enabled: "\u5DF2\u542F\u7528",
    disabled: "\u5DF2\u505C\u7528",
    deployFeatureFlags: "\u90E8\u7F72\u529F\u80FD\u5F00\u5173",
    confirmFeatureFlags: "\u786E\u8BA4\u90E8\u7F72 Feature Flags",
    confirmFeatureFlagsBody: "\u5373\u5C06\u66F4\u65B0 Frontend BFF Feature Flags \u81F3 AppConfig\u3002",
    changedItems: "\u53D8\u66F4\u9879\u76EE\uFF1A",
    noChangesDetected: "\u672A\u68C0\u6D4B\u5230\u53D8\u66F4\u3002",
    confirmEffective: "\u786E\u8BA4\u540E\u7ACB\u5373\u751F\u6548\u3002\u662F\u5426\u786E\u8BA4\uFF1F",

    // ─── M6: Identity & Tenant ─────────────────────────────────
    identityTenant: "\u8EAB\u4EFD\u4E0E\u79DF\u6237",
    rbacPolicies: "RBAC \u7B56\u7565",
    rbacSettings: "RBAC \u8BA4\u8BC1\u8BBE\u7F6E",
    sessionTimeout: "\u767B\u5F55\u8D85\u65F6 (Session Timeout, min)",
    maxFailedLogins: "\u6700\u5927\u5931\u8D25\u767B\u5F55\u6B21\u6570",
    defaultTenantRole: "\u9884\u8BBE\u79DF\u6237\u89D2\u8272",
    mfaRequired: "\u5F3A\u5236\u53CC\u56E0\u5B50\u9A8C\u8BC1 (MFA Required)",
    deployRbac: "\u90E8\u7F72 RBAC \u7B56\u7565",
    confirmRbac: "\u786E\u8BA4\u90E8\u7F72 RBAC Policies",
    confirmRbacBody: "\u5373\u5C06\u66F4\u65B0 rbac-policies \u81F3 AppConfig\u3002<br>Session Timeout: <strong>{timeout} min</strong> | Max Failed Logins: <strong>{logins}</strong> | Default Role: <strong>{role}</strong> | MFA: <strong>{mfa}</strong><br>\u786E\u8BA4\u540E\u7ACB\u5373\u751F\u6548\u3002\u662F\u5426\u786E\u8BA4\uFF1F",
    roleViewer: "viewer (\u53EA\u8BFB)",
    roleOperator: "operator (\u64CD\u4F5C\u5458)",
    roleAdmin: "admin (\u7BA1\u7406\u5458)",

    // ─── M7: Open API ──────────────────────────────────────────
    openApi: "Open API",
    apiQuotas: "API \u914D\u989D",
    apiSettings: "API \u914D\u989D\u4E0E Webhook \u8BBE\u7F6E",
    webhookTimeout: "Webhook \u8D85\u65F6 (ms)",
    rateLimitRpm: "API \u901F\u7387\u9650\u5236 (req/min)",
    maxPayloadKb: "\u6700\u5927 Payload (KB)",
    deployApiQuotas: "\u90E8\u7F72 API \u914D\u989D",
    confirmApiQuotas: "\u786E\u8BA4\u90E8\u7F72 API Quotas",
    confirmApiQuotasBody: "\u5373\u5C06\u66F4\u65B0 Open API Quotas & Webhook \u8BBE\u7F6E\u81F3 AppConfig\u3002<br>Webhook Timeout: <strong>{timeout}ms</strong> | Rate Limit: <strong>{rpm} req/min</strong> | Max Payload: <strong>{payload} KB</strong><br>\u786E\u8BA4\u540E\u7ACB\u5373\u751F\u6548\u3002\u662F\u5426\u786E\u8BA4\uFF1F",

    // ─── Common ────────────────────────────────────────────────
    validate: "\u9A8C\u8BC1",
    deploy: "\u90E8\u7F72",
    previewDiff: "\u9884\u89C8\u5DEE\u5F02",
    deployToAppConfig: "\u90E8\u7F72\u81F3 AppConfig",
    noChanges: "\u65E0\u53D8\u66F4",
    auditLog: "\u5BA1\u8BA1\u65E5\u5FD7",
    confirm: "\u786E\u8BA4",
    cancel: "\u53D6\u6D88",
    rangeError: "\u26A0 \u6570\u503C\u8D85\u51FA\u5141\u8BB8\u8303\u56F4",
    controlPlane: "\u63A7\u5236\u5E73\u9762",
    uiLoaded: "\u63A7\u5236\u5E73\u9762 UI \u5DF2\u52A0\u8F7D \u2014 \u6240\u6709\u6A21\u5757\u5DF2\u6FC0\u6D3B",
    parserRulesEditor: "\u89E3\u6790\u89C4\u5219\u7F16\u8F91\u5668",
    validJsonDetail: "\u2713 JSON \u6B63\u786E \u2014 {registers} \u4E2A\u5BC4\u5B58\u5668\uFF0C\u8F6E\u8BE2\u95F4\u9694 {poll}ms",
    invalidJsonEmpty: "\u2717 JSON \u683C\u5F0F\u9519\u8BEF\uFF1A\u8F93\u5165\u4E3A\u7A7A",
    invalidJsonError: "\u2717 JSON \u683C\u5F0F\u9519\u8BEF\uFF1A{error}",
    selectedTenants: "\u5DF2\u9009\u79DF\u6237",
    customVendor: "[\u81EA\u5B9A\u4E49]",
  },
};

// 默认语言：简体中文
var i18nLang = "zh";

/**
 * 根据 key 获取当前语言的翻译文本，回退到英文，再回退到 key 本身
 */
function t(key) {
  return (
    (I18N_DICT[i18nLang] && I18N_DICT[i18nLang][key]) ||
    I18N_DICT["en"][key] ||
    key
  );
}

/**
 * 模板替换：将 {varName} 替换为 vars 中对应的值
 * 用法：tpl('deploySuccess', { module: 'M1 IoT Hub' })
 */
function tpl(key, vars) {
  var s = t(key);
  for (var k in vars) {
    if (vars.hasOwnProperty(k)) {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
    }
  }
  return s;
}

/**
 * 切换语言并重新渲染当前模块
 */
function setLang(lang) {
  i18nLang = lang;
  if (typeof renderCurrentModule === "function") renderCurrentModule();
  updateTopBarLangButtons();
}

/**
 * 更新顶栏语言切换按钮的激活状态
 */
function updateTopBarLangButtons() {
  var enBtn = document.getElementById("lang-en");
  var zhBtn = document.getElementById("lang-zh");
  if (enBtn) enBtn.classList.toggle("active", i18nLang === "en");
  if (zhBtn) zhBtn.classList.toggle("active", i18nLang === "zh");
}
