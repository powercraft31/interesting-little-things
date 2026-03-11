/* ============================================
   SOLFACIL Admin Portal — App Logic
   Hash router + Role switching + DemoStore + Page init + i18n
   ============================================ */

// =========================================================
// DemoStore — sessionStorage-backed cross-page state
// =========================================================
window.DemoStore = {
  get(key) {
    var val = sessionStorage.getItem("ds_" + key);
    if (val === null) return null;
    try {
      return JSON.parse(val);
    } catch (e) {
      return null;
    }
  },
  set(key, val) {
    sessionStorage.setItem("ds_" + key, JSON.stringify(val));
  },
  reset() {
    Object.keys(sessionStorage)
      .filter(function (k) {
        return k.startsWith("ds_");
      })
      .forEach(function (k) {
        sessionStorage.removeItem(k);
      });
  },
};

// =========================================================
// PAGE DEFINITIONS (with i18n keys)
// =========================================================
var PAGES = [
  {
    id: "fleet",
    hash: "#fleet",
    labelKey: "page.fleet",
    icon: "\u{1F4CA}",
    navKey: "nav.fleet",
    roles: ["admin", "integrador"],
  },
  {
    id: "devices",
    hash: "#devices",
    labelKey: "page.devices",
    icon: "\u{1F50C}",
    navKey: "nav.devices",
    roles: ["admin", "integrador"],
  },
  {
    id: "energy",
    hash: "#energy",
    labelKey: "page.energy",
    icon: "\u{26A1}",
    navKey: "nav.energy",
    roles: ["admin", "integrador"],
  },
  {
    id: "hems",
    hash: "#hems",
    labelKey: "page.hems",
    icon: "\u{2699}\u{FE0F}",
    navKey: "nav.hems",
    roles: ["admin", "integrador"],
  },
  {
    id: "vpp",
    hash: "#vpp",
    labelKey: "page.vpp",
    icon: "\u{1F50B}",
    navKey: "nav.vpp",
    roles: ["admin"],
  },
  {
    id: "performance",
    hash: "#performance",
    labelKey: "page.performance",
    icon: "\u{1F3AF}",
    navKey: "nav.performance",
    roles: ["admin", "integrador", "customer"],
  },
];

// =========================================================
// STATE
// =========================================================
var currentPage = "fleet";
var currentRole = "admin";
var pageInitialized = {};

// =========================================================
// ROUTER
// =========================================================
function navigateTo(pageId) {
  var page = PAGES.find(function (p) {
    return p.id === pageId;
  });
  if (!page) return;

  // Role access check — redirect to fleet if page not allowed
  if (!page.roles.includes(currentRole)) {
    if (pageId !== "fleet") {
      navigateTo("fleet");
    }
    return;
  }

  currentPage = pageId;

  // Update hash without triggering hashchange loop
  if (location.hash !== page.hash) {
    history.pushState(null, "", page.hash);
  }

  // Hide all page sections, show target
  document.querySelectorAll(".page-section").forEach(function (el) {
    el.classList.remove("active");
  });
  var section = document.getElementById("page-" + pageId);
  if (section) {
    section.classList.add("active");
    // Add fade animation
    section.classList.remove("page-fade-active");
    section.classList.add("page-fade-enter");
    requestAnimationFrame(function () {
      section.classList.remove("page-fade-enter");
      section.classList.add("page-fade-active");
    });
  }

  // Update sidebar nav highlighting
  document.querySelectorAll(".nav-item").forEach(function (el) {
    el.classList.toggle("active", el.dataset.page === pageId);
  });

  // Update top bar title (translated)
  var titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = t(page.labelKey);

  // Initialize page content if first visit
  if (!pageInitialized[pageId]) {
    pageInitialized[pageId] = true;
    initPage(pageId);
  } else {
    // Activate charts for revisited page
    Charts.activatePageCharts(pageId);
  }
}

function initPage(pageId) {
  var promise;
  switch (pageId) {
    case "fleet":
      if (typeof FleetPage !== "undefined") promise = FleetPage.init();
      break;
    case "devices":
      if (typeof DevicesPage !== "undefined") promise = DevicesPage.init();
      break;
    case "energy":
      if (typeof EnergyPage !== "undefined") promise = EnergyPage.init();
      break;
    case "hems":
      if (typeof HEMSPage !== "undefined") promise = HEMSPage.init();
      break;
    case "vpp":
      if (typeof VPPPage !== "undefined") promise = VPPPage.init();
      break;
    case "performance":
      if (typeof PerformancePage !== "undefined")
        promise = PerformancePage.init();
      break;
  }
  // Handle rejected promises (error already displayed by page's error boundary)
  if (promise && typeof promise.catch === "function") {
    promise.catch(function (err) {
      console.error("[initPage] " + pageId + " init failed:", err);
    });
  }
}

// =========================================================
// ERROR BOUNDARY
// =========================================================
function showErrorBoundary(containerId, err) {
  var container = document.getElementById(containerId);
  if (!container) return;
  console.error("[ErrorBoundary] " + containerId + ":", err);
  container.innerHTML = Components.errorBanner(t("shared.apiError"));
}

// =========================================================
// DATE FORMAT UTILITIES (ISO → Brazilian DD/MM format)
// =========================================================
function formatISODate(iso) {
  if (iso == null || iso === "") return "—";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  var dd = String(d.getDate()).padStart(2, "0");
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var yyyy = d.getFullYear();
  return dd + "/" + mm + "/" + yyyy;
}

function formatISODateTime(iso) {
  if (iso == null || iso === "") return "—";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  var dd = String(d.getDate()).padStart(2, "0");
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var yyyy = d.getFullYear();
  var hh = String(d.getHours()).padStart(2, "0");
  var min = String(d.getMinutes()).padStart(2, "0");
  return dd + "/" + mm + "/" + yyyy + " " + hh + ":" + min;
}

function formatShortDate(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return (
    String(d.getDate()).padStart(2, "0") +
    "/" +
    String(d.getMonth() + 1).padStart(2, "0")
  );
}

// Listen for hash changes (back/forward navigation)
window.addEventListener("hashchange", function () {
  var hash = location.hash || "#fleet";
  var page = PAGES.find(function (p) {
    return p.hash === hash;
  });
  if (page) navigateTo(page.id);
});

// =========================================================
// ROLE SWITCHING
// =========================================================
function switchRole(role) {
  currentRole = role;

  // Update body data-theme
  if (role === "integrador") {
    document.body.dataset.theme = "light";
  } else {
    document.body.dataset.theme = "dark";
  }

  // Update role badge in top bar (translated)
  var badgeEl = document.getElementById("role-badge");
  if (badgeEl) {
    var roleKeys = {
      admin: "role.admin",
      integrador: "role.integrador",
      customer: "role.customer",
    };
    var roleClasses = {
      admin: "role-badge-admin",
      integrador: "role-badge-integrador",
      customer: "role-badge-customer",
    };
    badgeEl.className = "role-badge " + (roleClasses[role] || "");
    badgeEl.textContent = t(roleKeys[role]) || role;
  }

  // Show/hide elements based on data-role attribute
  document.querySelectorAll("[data-role]").forEach(function (el) {
    var requiredRole = el.dataset.role;
    var visible = false;
    if (requiredRole === "admin") {
      visible = role === "admin";
    } else if (requiredRole === "integrador") {
      visible = role === "admin" || role === "integrador";
    } else if (requiredRole === "customer") {
      visible = true;
    }
    el.style.display = visible ? "" : "none";
  });

  // Show/hide nav items based on role
  document.querySelectorAll(".nav-item").forEach(function (el) {
    var pageId = el.dataset.page;
    var page = PAGES.find(function (p) {
      return p.id === pageId;
    });
    if (page) {
      el.style.display = page.roles.includes(role) ? "" : "none";
    }
  });

  // If current page is not accessible for this role, redirect
  var currentPageDef = PAGES.find(function (p) {
    return p.id === currentPage;
  });
  if (currentPageDef && !currentPageDef.roles.includes(role)) {
    // Customer → Performance; others → Fleet
    var fallback = role === "customer" ? "performance" : "fleet";
    navigateTo(fallback);
    return;
  }

  // Notify all page modules about role change
  var pageModules = {
    fleet: typeof FleetPage !== "undefined" ? FleetPage : null,
    devices: typeof DevicesPage !== "undefined" ? DevicesPage : null,
    energy: typeof EnergyPage !== "undefined" ? EnergyPage : null,
    hems: typeof HEMSPage !== "undefined" ? HEMSPage : null,
    vpp: typeof VPPPage !== "undefined" ? VPPPage : null,
    performance:
      typeof PerformancePage !== "undefined" ? PerformancePage : null,
  };

  var mod = pageModules[currentPage];
  if (mod && mod.onRoleChange) {
    mod.onRoleChange(role);
  }

  // Invalidate ALL other pages — force re-init on next visit with new role
  invalidateHiddenPages();

  // Refresh chart theme colors after theme change
  requestAnimationFrame(function () {
    Charts.refreshTheme();
  });
}

/**
 * Dispose charts and clear pageInitialized for all pages except currentPage.
 * Next navigation to those pages will trigger full re-init with correct role/lang.
 */
function invalidateHiddenPages() {
  PAGES.forEach(function (p) {
    if (p.id !== currentPage && pageInitialized[p.id]) {
      Charts.disposePageCharts(p.id);
      delete pageInitialized[p.id];
    }
  });
}

// =========================================================
// i18n: UPDATE UI LABELS
// =========================================================
function updateSidebarLabels() {
  // Update nav item labels
  document.querySelectorAll(".nav-item").forEach(function (el) {
    var pageId = el.dataset.page;
    var page = PAGES.find(function (p) {
      return p.id === pageId;
    });
    if (page) {
      var navLabel = el.querySelector(".nav-label");
      if (navLabel) navLabel.textContent = t(page.navKey);
    }
  });

  // Update role switcher label
  var roleLabel = document.querySelector(".role-switcher label");
  if (roleLabel) roleLabel.textContent = t("role.label");

  // Update role select option text
  var roleSelect = document.getElementById("role-select");
  if (roleSelect) {
    roleSelect.options[0].textContent = t("role.admin");
    roleSelect.options[1].textContent = t("role.integrador");
    roleSelect.options[2].textContent = t("role.customer");
  }
}

// =========================================================
// INITIALIZATION
// =========================================================
document.addEventListener("DOMContentLoaded", function () {
  // Initialize mock data (runs once, memoized)
  initMockData();

  // Set up role switcher
  var roleSelect = document.getElementById("role-select");
  if (roleSelect) {
    roleSelect.addEventListener("change", function (e) {
      switchRole(e.target.value);
    });
  }

  // Set up sidebar nav clicks
  document.querySelectorAll(".nav-item").forEach(function (el) {
    el.addEventListener("click", function () {
      var pageId = el.dataset.page;
      if (pageId) navigateTo(pageId);
    });
  });

  // Set default theme
  document.body.dataset.theme = "dark";

  // ---- i18n setup ----
  // Set initial html lang attribute
  document.documentElement.lang = I18n.getLang();

  // Initialize lang switcher
  var langSwitcher = document.getElementById("lang-switcher");
  if (langSwitcher) {
    langSwitcher.value = I18n.getLang();
    langSwitcher.addEventListener("change", function () {
      I18n.setLang(langSwitcher.value);
    });
  }

  // Update sidebar labels on load (for non-EN default)
  updateSidebarLabels();

  // Listen for language changes
  window.addEventListener("langchange", function () {
    // Update html lang attribute
    document.documentElement.lang = I18n.getLang();

    // Update sidebar nav labels + role switcher
    updateSidebarLabels();

    // Update role badge text
    switchRole(currentRole);

    // Update page title
    var page = PAGES.find(function (p) {
      return p.id === currentPage;
    });
    if (page) {
      var titleEl = document.getElementById("page-title");
      if (titleEl) titleEl.textContent = t(page.labelKey);
    }

    // Dispose all hidden pages' charts (prevents ResizeObserver orphans on re-visit)
    invalidateHiddenPages();

    // Dispose + re-init CURRENT page with translated content
    Charts.disposePageCharts(currentPage);
    delete pageInitialized[currentPage];
    initPage(currentPage);
  });

  // Navigate to initial page
  var hash = location.hash || "#fleet";
  var page = PAGES.find(function (p) {
    return p.hash === hash;
  });
  navigateTo(page ? page.id : "fleet");
});
