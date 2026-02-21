/* ═══════════════════════════════════════════════════════════════════
   SOLFACIL VPP — Control Plane Admin UI
   Phase 1: Skeleton + Static Display
   ═══════════════════════════════════════════════════════════════════ */

/* ─── SECTION 0: Constants & Configuration ─────────────────────── */

var MODULE_REGISTRY = {
  m1: {
    id: 'm1', name: 'IoT Hub', subtitle: 'Parser Rules',
    icon: 'sensors', accent: '#06b6d4',
    appConfigProfile: 'parser-rules', m8Table: 'device_parser_rules',
    apiPath: '/admin/parsers', schemaFile: 'parser-rules.schema.json',
    cacheTTL: '5 min', editable: true, renderer: 'renderM1ParserRules',
  },
  m2: {
    id: 'm2', name: 'Algorithm Engine', subtitle: 'VPP Strategies',
    icon: 'psychology', accent: '#8b5cf6',
    appConfigProfile: 'vpp-strategies', m8Table: 'vpp_strategies',
    apiPath: '/admin/strategies', schemaFile: 'vpp-strategies.schema.json',
    cacheTTL: '1 min', editable: true, renderer: 'renderM2VppStrategies',
    hasBatchOps: true,
  },
  m3: {
    id: 'm3', name: 'DR Dispatcher', subtitle: 'Dispatch Policies',
    icon: 'send', accent: '#f97316',
    appConfigProfile: 'dispatch-policies', m8Table: 'dispatch_policies',
    apiPath: '/admin/dispatch-policies', schemaFile: 'dispatch-policies.schema.json',
    cacheTTL: '10 min', editable: true, renderer: 'renderM3DispatchPolicies',
  },
  m4: {
    id: 'm4', name: 'Market & Billing', subtitle: 'Billing Rules',
    icon: 'payments', accent: '#10b981',
    appConfigProfile: 'billing-rules', m8Table: 'billing_rules',
    apiPath: '/admin/billing-rules', schemaFile: 'billing-rules.schema.json',
    cacheTTL: '60 min', editable: true, renderer: 'renderM4BillingRules',
  },
  m5: {
    id: 'm5', name: 'Frontend BFF', subtitle: 'Feature Flags',
    icon: 'flag', accent: '#ec4899',
    appConfigProfile: 'feature-flags', m8Table: 'feature_flags',
    apiPath: '/admin/feature-flags', schemaFile: 'feature-flags.schema.json',
    cacheTTL: '5 min', editable: true, renderer: 'renderM5FeatureFlags',
  },
  m6: {
    id: 'm6', name: 'Identity & Tenant', subtitle: 'RBAC Policies',
    icon: 'admin_panel_settings', accent: '#6366f1',
    appConfigProfile: 'rbac-policies', m8Table: 'rbac_policies',
    apiPath: '/admin/rbac-policies', schemaFile: 'rbac-policies.schema.json',
    cacheTTL: '30 min', editable: false, renderer: 'renderM6RbacPolicies',
  },
  m7: {
    id: 'm7', name: 'Open API', subtitle: 'API Quotas',
    icon: 'api', accent: '#14b8a6',
    appConfigProfile: 'api-quotas', m8Table: 'api_quotas',
    apiPath: '/admin/api-quotas', schemaFile: 'api-quotas.schema.json',
    cacheTTL: '1 min', editable: true, renderer: 'renderM7ApiQuotas',
  },
};

var MODULE_ORDER = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];

var activeModuleId = 'm1';


/* ─── SECTION 3: Navigation & Layout ───────────────────────────── */

function initNavigation() {
  var navList = document.getElementById('nav-modules');
  if (!navList) return;

  var html = '';
  for (var i = 0; i < MODULE_ORDER.length; i++) {
    var key = MODULE_ORDER[i];
    var mod = MODULE_REGISTRY[key];
    var label = mod.id.toUpperCase();
    var isActive = key === activeModuleId ? ' active' : '';

    html += '<li class="nav-item' + isActive + '" data-module="' + key + '" title="' + label + ' ' + mod.name + '">'
      + '<div class="nav-item-accent" style="background:' + mod.accent + '"></div>'
      + '<i class="material-icons nav-item-icon">' + mod.icon + '</i>'
      + '<div class="nav-item-text">'
      + '  <div class="nav-item-name">' + label + ' ' + mod.name + '</div>'
      + '  <div class="nav-item-subtitle">' + mod.subtitle + '</div>'
      + '</div>'
      + '</li>';
  }
  navList.innerHTML = html;

  // Attach click handlers
  var items = navList.querySelectorAll('.nav-item');
  for (var j = 0; j < items.length; j++) {
    items[j].addEventListener('click', handleNavClick);
  }
}

function handleNavClick(e) {
  var item = e.currentTarget;
  var moduleId = item.getAttribute('data-module');
  if (moduleId && moduleId !== activeModuleId) {
    switchModule(moduleId);
  }
}

function switchModule(moduleId) {
  var mod = MODULE_REGISTRY[moduleId];
  if (!mod) return;

  activeModuleId = moduleId;

  // Update nav active state
  var items = document.querySelectorAll('#nav-modules .nav-item');
  for (var i = 0; i < items.length; i++) {
    var id = items[i].getAttribute('data-module');
    if (id === moduleId) {
      items[i].classList.add('active');
    } else {
      items[i].classList.remove('active');
    }
  }

  // Update breadcrumb
  renderBreadcrumb(mod);

  // Render module content
  renderModuleContent(mod);
}

function renderBreadcrumb(mod) {
  var el = document.getElementById('breadcrumb-module');
  if (el) {
    el.textContent = mod.id.toUpperCase() + ' ' + mod.name;
  }
}

function renderModuleContent(mod) {
  var container = document.getElementById('module-content');
  if (!container) return;

  var label = mod.id.toUpperCase();
  var readOnlyBadge = !mod.editable
    ? '<div style="margin-top:var(--space-2);display:inline-flex;align-items:center;gap:4px;'
      + 'padding:2px 8px;background:rgba(245,158,11,0.12);color:#f59e0b;border-radius:4px;'
      + 'font-size:11px;font-weight:600;"><i class="material-icons" style="font-size:14px">lock</i> READ-ONLY</div>'
    : '';

  var batchOpsTag = mod.hasBatchOps
    ? '<span class="meta-tag"><i class="material-icons" style="font-size:12px">bolt</i> Batch Ops</span>'
    : '';

  container.innerHTML = '<div class="fade-in">'
    + '<div class="module-header">'
    + '  <div class="module-header-title" style="color:' + mod.accent + '">'
    + '    <i class="material-icons">' + mod.icon + '</i>'
    + '    ' + label + ' ' + mod.name + ' &mdash; ' + mod.subtitle
    + '  </div>'
    + '  <div class="module-header-meta">'
    + '    <span class="meta-tag">Profile: ' + mod.appConfigProfile + '</span>'
    + '    <span class="meta-tag">TTL: ' + mod.cacheTTL + '</span>'
    + '    <span class="meta-tag">Table: ' + mod.m8Table + '</span>'
    + '    ' + batchOpsTag
    + '  </div>'
    + '  ' + readOnlyBadge
    + '</div>'
    + '<div class="module-placeholder">'
    + '  <i class="material-icons module-placeholder-icon">' + mod.icon + '</i>'
    + '  <div class="module-placeholder-text">' + mod.subtitle + ' Editor</div>'
    + '  <div class="module-placeholder-sub">Coming in Phase ' + (mod.hasBatchOps ? '2' : '3') + '...</div>'
    + '  <div class="info-cards">'
    + '    <div class="info-card">'
    + '      <div class="info-card-label">AppConfig Profile</div>'
    + '      <div class="info-card-value">' + mod.appConfigProfile + '</div>'
    + '    </div>'
    + '    <div class="info-card">'
    + '      <div class="info-card-label">Cache TTL</div>'
    + '      <div class="info-card-value">' + mod.cacheTTL + '</div>'
    + '    </div>'
    + '    <div class="info-card">'
    + '      <div class="info-card-label">M8 API Path</div>'
    + '      <div class="info-card-value">' + mod.apiPath + '</div>'
    + '    </div>'
    + '  </div>'
    + '</div>'
    + '</div>';
}


/* ─── SECTION 3b: Panel Toggles ────────────────────────────────── */

function initToggleNav() {
  var btn = document.getElementById('btn-toggle-nav');
  var nav = document.getElementById('left-nav');
  if (btn && nav) {
    btn.addEventListener('click', function() {
      nav.classList.toggle('collapsed');
    });
  }
}

function initToggleAudit() {
  var btn = document.getElementById('btn-toggle-audit');
  var panel = document.getElementById('audit-panel');
  if (btn && panel) {
    btn.addEventListener('click', function() {
      // On large screens (>=1440), toggle 'collapsed'
      // On medium screens (<1440), toggle 'expanded'
      if (window.innerWidth >= 1440) {
        panel.classList.toggle('collapsed');
      } else {
        panel.classList.toggle('expanded');
      }
    });
  }
}


/* ─── SECTION 8: Utilities ─────────────────────────────────────── */

function showToast(message, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;

  var toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast--' + type : '');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(function() {
    toast.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 5000);
}


/* ─── SECTION 3c: Keyboard Shortcuts ───────────────────────────── */

function initKeyboardShortcuts() {
  document.addEventListener('keydown', function(e) {
    // Don't trigger when focused on inputs
    var tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Number keys 1-7 → switch modules
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 7 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      switchModule(MODULE_ORDER[num - 1]);
      return;
    }

    // Ctrl+[ → toggle audit panel
    if (e.ctrlKey && e.key === '[') {
      e.preventDefault();
      var panel = document.getElementById('audit-panel');
      if (panel) {
        if (window.innerWidth >= 1440) {
          panel.classList.toggle('collapsed');
        } else {
          panel.classList.toggle('expanded');
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
  showToast('Control Plane UI loaded — Phase 1 Skeleton', 'success');
}

document.addEventListener('DOMContentLoaded', init);
