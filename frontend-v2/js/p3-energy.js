/* ============================================
   SOLFACIL Admin Portal — P3: Energy Page (v6.3)
   Gateway-first time-series & energy statistics page.
   Replaces the v6.2 asset-first Gateway selector + tab architecture.

   Semantic split:
   - 24h: Behavior layer — power flow over time (line chart + SoC)
   - 7d / 30d / 12m: Statistics layer — energy totals & structure (bar chart)

   Sign conventions:
   - Battery: positive = discharge, negative = charge
   - Grid: positive = import (buying), negative = export (selling)

   Gateway selection:
   - Energy page owns its own left Gateway locator (same pattern as Devices).
   - DemoStore is optional memory only, not a prerequisite.
   - Priority: hash param #energy?gw=... > DemoStore > first available gateway.
   ============================================ */

// eslint-disable-next-line no-unused-vars
var EnergyPage = {
  // -- Page-local state ---------------------------------------------------
  _state: {
    gateways: null, // loaded gateway list
    gatewayId: null,
    gatewayName: null,
    timeWindow: "24h", // '24h' | '7d' | '30d' | '12m'
    dateAnchor: null, // Date object (24h/7d/30d) or { year: N, month: N } (12m)
    energy24hData: null,
    energyStatsData: null,
    isLoading: false,
    refreshTimer: null,
  },

  // -- Constants ----------------------------------------------------------
  REFRESH_INTERVAL_MS: 60000,
  COLORS: {
    pv: "#f6c445", // gold/yellow
    load: "#60a5fa", // blue
    battery: "#34d399", // green
    grid: "#f87171", // red
    gridImport: "#f87171", // red
    gridExport: "#34d399", // green
    soc: "rgba(167,139,250,0.1)",
    socLine: "#a78bfa", // purple
  },

  // =========================================================
  // DATA HELPERS (v6.3-R2)
  // =========================================================

  _calc24hSummary: function (data) {
    var points = (data && data.points) || [];
    var summary = (data && data.summary) || {};
    var pvKwh = 0,
      loadKwh = 0;
    for (var i = 0; i < points.length; i++) {
      pvKwh += (points[i].pv || 0) * (5 / 60);
      loadKwh += (points[i].load || 0) * (5 / 60);
    }
    var gridImportKwh = summary.gridImportKwh || 0;
    var gridExportKwh = summary.gridExportKwh || 0;
    var batteryChargeKwh = summary.batteryChargeKwh || 0;
    var batteryDischargeKwh = summary.batteryDischargeKwh || 0;
    var pvVal = +pvKwh.toFixed(1);
    var loadVal = +loadKwh.toFixed(1);
    var impVal = +gridImportKwh.toFixed(1);
    var selfSuffPct =
      loadVal > 0
        ? Math.max(
            0,
            Math.min(100, Math.round(((loadVal - impVal) / loadVal) * 100)),
          )
        : 0;
    return {
      pvKwh: pvVal,
      loadKwh: loadVal,
      gridImportKwh: impVal,
      gridExportKwh: +gridExportKwh.toFixed(1),
      batteryChargeKwh: +batteryChargeKwh.toFixed(1),
      batteryDischargeKwh: +batteryDischargeKwh.toFixed(1),
      selfSufficiencyPct: selfSuffPct,
    };
  },

  _normalizeStatsTotals: function (totals) {
    var t_ = totals || {};
    return {
      pvKwh: +(t_.pvGenerationKwh || 0).toFixed(1),
      loadKwh: +(t_.loadConsumptionKwh || 0).toFixed(1),
      gridImportKwh: +(t_.gridImportKwh || 0).toFixed(1),
      gridExportKwh: +(t_.gridExportKwh || 0).toFixed(1),
      batteryChargeKwh: +(t_.batteryChargeKwh || 0).toFixed(1),
      batteryDischargeKwh: +(t_.batteryDischargeKwh || 0).toFixed(1),
      selfSufficiencyPct: Math.round(t_.selfSufficiencyPct || 0),
    };
  },

  _verdictGrade: function (pct) {
    if (pct >= 70)
      return { label: t("energy.verdict.good"), cls: "good", color: "#34d399" };
    if (pct >= 40)
      return { label: t("energy.verdict.fair"), cls: "fair", color: "#f6c445" };
    return { label: t("energy.verdict.low"), cls: "poor", color: "#f87171" };
  },

  _currentTimeStr: function () {
    var b = toBRT(new Date());
    return (
      String(b.hour).padStart(2, "0") +
      ":" +
      String(b.minute).padStart(2, "0")
    );
  },

  // =========================================================
  // NEW SECTION BUILDERS (v6.3-R2)
  // =========================================================

  _buildVerdict: function (summary) {
    var pct = summary.selfSufficiencyPct;
    var grade = this._verdictGrade(pct);
    return (
      '<div class="energy-verdict">' +
      '<div class="energy-verdict-metric">' +
      '<span class="energy-verdict-value ' +
      grade.cls +
      '">' +
      pct +
      '<span class="energy-verdict-unit">%</span>' +
      "</span>" +
      "</div>" +
      '<div class="energy-verdict-text">' +
      '<div class="energy-verdict-label">' +
      t("energy.selfSufficiency") +
      "</div>" +
      '<div class="energy-verdict-desc">' +
      pct +
      "% " +
      t("energy.verdict.desc") +
      "</div>" +
      "</div>" +
      '<div class="energy-verdict-sep"></div>' +
      '<span class="energy-verdict-grade ' +
      grade.cls +
      '">' +
      grade.label +
      "</span>" +
      "</div>"
    );
  },

  _buildSummaryStrip: function (summary) {
    var self = this;
    function cell(cls, dotColor, label, val, unit, hint) {
      return (
        '<div class="energy-sum-cell ' +
        cls +
        '">' +
        '<span class="energy-sum-label">' +
        '<span class="energy-sum-dot"></span>' +
        label +
        "</span>" +
        '<span class="energy-sum-value">' +
        val +
        '<span class="energy-sum-unit"> ' +
        unit +
        "</span>" +
        "</span>" +
        '<span class="energy-sum-hint">' +
        hint +
        "</span>" +
        "</div>"
      );
    }
    return (
      '<div class="energy-summary-strip">' +
      cell(
        "pv",
        self.COLORS.pv,
        t("energy.pvGeneration"),
        summary.pvKwh,
        "kWh",
        t("energy.desc.pvGen"),
      ) +
      cell(
        "load",
        self.COLORS.load,
        t("energy.loadConsumption"),
        summary.loadKwh,
        "kWh",
        t("energy.desc.loadCons"),
      ) +
      cell(
        "grid-imp",
        self.COLORS.gridImport,
        t("energy.gridImport"),
        summary.gridImportKwh,
        "kWh",
        t("energy.desc.gridImport"),
      ) +
      cell(
        "grid-exp",
        self.COLORS.gridExport,
        t("energy.gridExport"),
        summary.gridExportKwh,
        "kWh",
        t("energy.desc.gridExport"),
      ) +
      "</div>"
    );
  },

  _buildBatteryContext: function (summary) {
    var netBat = +(
      summary.batteryDischargeKwh - summary.batteryChargeKwh
    ).toFixed(1);
    var roleKey =
      netBat > 0
        ? "energy.battery.netSupplier"
        : netBat < 0
          ? "energy.battery.netAbsorber"
          : "energy.battery.balanced";
    return (
      '<div class="energy-battery-context">' +
      '<span class="energy-bat-icon">&#x1F50B;</span>' +
      '<span class="energy-bat-label">' +
      t("energy.batCharge") +
      "</span>" +
      '<span class="energy-bat-val">' +
      summary.batteryChargeKwh +
      " kWh</span>" +
      '<span class="energy-bat-sep"></span>' +
      '<span class="energy-bat-label">' +
      t("energy.batDischarge") +
      "</span>" +
      '<span class="energy-bat-val">' +
      summary.batteryDischargeKwh +
      " kWh</span>" +
      '<span class="energy-bat-sep"></span>' +
      '<span class="energy-bat-label">' +
      t("energy.battery.net") +
      "</span>" +
      '<span class="energy-bat-val">' +
      (netBat >= 0 ? "+" : "") +
      netBat +
      " kWh</span>" +
      '<span class="energy-bat-note">' +
      t(roleKey) +
      "</span>" +
      "</div>"
    );
  },

  _buildInterpretation: function (summary) {
    var s = summary;
    var pvCoverage =
      s.loadKwh > 0 ? Math.round((s.pvKwh / s.loadKwh) * 100) : 0;
    var netBat = +(s.batteryDischargeKwh - s.batteryChargeKwh).toFixed(1);
    var netGrid = +(s.gridImportKwh - s.gridExportKwh).toFixed(1);
    var gridVerb =
      netGrid > 0
        ? t("energy.interp.netBuyer")
        : netGrid < 0
          ? t("energy.interp.netSeller")
          : t("energy.interp.gridBalanced");
    var batVerb =
      netBat > 0
        ? t("energy.battery.netSupplier")
        : netBat < 0
          ? t("energy.battery.netAbsorber")
          : t("energy.battery.balanced");
    var energyIn = +(s.pvKwh + s.gridImportKwh + s.batteryDischargeKwh).toFixed(
      1,
    );
    var energyOut = +(s.loadKwh + s.gridExportKwh + s.batteryChargeKwh).toFixed(
      1,
    );

    function card(iconCls, icon, title, detail) {
      return (
        '<div class="energy-interp-item">' +
        '<div class="energy-interp-icon ' +
        iconCls +
        '">' +
        icon +
        "</div>" +
        '<div class="energy-interp-body">' +
        '<div class="energy-interp-title">' +
        title +
        "</div>" +
        '<div class="energy-interp-detail">' +
        detail +
        "</div>" +
        "</div>" +
        "</div>"
      );
    }

    var pvDetail =
      'Generated <span class="energy-val-pv">' +
      s.pvKwh +
      " kWh</span> against " +
      '<span class="energy-val-load">' +
      s.loadKwh +
      " kWh</span> demand. " +
      (pvCoverage >= 100
        ? "Surplus was exported or stored."
        : "Deficit covered by battery and grid.");

    var gridDetail =
      'Imported <span class="energy-val-grid">' +
      s.gridImportKwh +
      " kWh</span>, " +
      'exported <span class="energy-val-grid">' +
      s.gridExportKwh +
      " kWh</span>. " +
      "Net grid: <strong>" +
      (netGrid >= 0 ? "+" : "") +
      netGrid +
      " kWh</strong>.";

    var batDetail =
      'Charged <span class="energy-val-bat">' +
      s.batteryChargeKwh +
      " kWh</span>, " +
      'discharged <span class="energy-val-bat">' +
      s.batteryDischargeKwh +
      " kWh</span>. " +
      "Net: <strong>" +
      (netBat >= 0 ? "+" : "") +
      netBat +
      " kWh</strong> " +
      (netBat > 0 ? "released to site." : "absorbed from PV.");

    var balDetail =
      "PV + Grid Import + Bat Discharge = <strong>" +
      energyIn +
      " kWh</strong> in. " +
      "Load + Grid Export + Bat Charge = <strong>" +
      energyOut +
      " kWh</strong> out.";

    return (
      '<div class="energy-interpretation">' +
      '<div class="energy-interp-header">' +
      t("energy.interp.header") +
      "</div>" +
      '<div class="energy-interp-grid">' +
      card(
        "ic-pv",
        "&#x2600;&#xFE0F;",
        t("energy.interp.pvCoverage") + " " + pvCoverage + "%",
        pvDetail,
      ) +
      card(
        "ic-grid",
        "&#x26A1;",
        t("energy.interp.gridDep") + ": " + gridVerb,
        gridDetail,
      ) +
      card(
        "ic-battery",
        "&#x1F50B;",
        t("energy.interp.batteryRole") + ": " + batVerb,
        batDetail,
      ) +
      card("ic-soc", "&#x1F4CA;", t("energy.interp.energyBalance"), balDetail) +
      "</div>" +
      "</div>"
    );
  },

  _updateAutoRefreshText: function () {
    var el = document.getElementById("energy-auto-refresh");
    if (el) {
      el.innerHTML =
        '<span class="energy-pulse-dot"></span> ' +
        t("energy.autoRefresh") +
        " &middot; " +
        t("energy.updated") +
        " " +
        this._currentTimeStr();
    }
  },

  // =========================================================
  // LIFECYCLE
  // =========================================================

  init: async function () {
    var self = this;
    var container = document.getElementById("energy-content");
    if (!container) return;

    // Dispose previous state
    self._stopAutoRefresh();
    Charts.disposePageCharts("energy");

    container.innerHTML = self._buildSkeleton();

    // Load gateways independently (Energy page does not depend on Devices)
    try {
      self._state.gateways = await DataSource.devices.gateways();
    } catch (err) {
      console.error("[Energy] Failed to load gateways:", err);
      container.innerHTML = Components.errorBanner(t("shared.apiError"));
      return;
    }

    var gateways = self._state.gateways || [];

    if (gateways.length === 0) {
      container.innerHTML = self._buildEmptyStateNoGateways();
      return;
    }

    // Resolve gateway context: hash param > DemoStore > first in list
    var params = self._parseHashParams();
    var gwId = params.gw || DemoStore.get("selectedGatewayId") || null;

    // Validate that the resolved gwId exists in the loaded list
    if (gwId) {
      var found = gateways.some(function (g) {
        return g.gatewayId === gwId;
      });
      if (!found) gwId = null;
    }

    // Fallback to first available gateway
    if (!gwId) {
      gwId = gateways[0].gatewayId;
    }

    // Resolve gateway name
    var gwObj = gateways.find(function (g) {
      return g.gatewayId === gwId;
    });
    var gwName = gwObj ? gwObj.homeAlias || gwObj.name || gwId : gwId;

    self._state.gatewayId = gwId;
    self._state.gatewayName = gwName;
    self._state.timeWindow = "24h";
    // BRT midnight today: use toBRTDate to get BRT-aware midnight
    var _brtNow = toBRT(new Date());
    self._state.dateAnchor = new Date(Date.UTC(_brtNow.year, _brtNow.month - 1, _brtNow.day, 3, 0, 0));

    // Build two-panel layout: locator (left) + workbench (right)
    container.innerHTML =
      '<div class="energy-layout">' +
      '<div class="energy-locator" id="energy-locator">' +
      self._buildLocator() +
      "</div>" +
      '<div class="energy-workbench" id="energy-workbench">' +
      self._buildContent() +
      "</div>" +
      "</div>";

    self._setupLocatorEvents();
    self._setupEventListeners();
    self._updateLocatorSelection(gwId);
    await self._fetchData();
  },

  onRoleChange: function () {
    Charts.disposePageCharts("energy");
    this.init();
  },

  dispose: function () {
    this._stopAutoRefresh();
    Charts.disposePageCharts("energy");
  },

  // =========================================================
  // PUBLIC: select gateway from external navigation (P2 links)
  // =========================================================

  selectGateway: function (gatewayId) {
    var self = this;
    DemoStore.set("selectedGatewayId", gatewayId);
    DemoStore.set("selectedGatewayName", gatewayId);

    // If page is already initialized with locator, just switch selection
    var gateways = self._state.gateways || [];
    var gwObj = gateways.find(function (g) {
      return g.gatewayId === gatewayId;
    });

    self._state.gatewayId = gatewayId;
    self._state.gatewayName = gwObj
      ? gwObj.homeAlias || gwObj.name || gatewayId
      : gatewayId;

    // If locator exists, update it and re-render workbench
    var locator = document.getElementById("energy-locator");
    if (locator) {
      self._updateLocatorSelection(gatewayId);
      self._rerenderWorkbench();
    } else {
      // Full re-init if page not yet set up
      self.init();
    }
  },

  // =========================================================
  // GATEWAY LOCATOR (left panel)
  // =========================================================

  _buildLocator: function () {
    var gateways = this._state.gateways || [];

    // Stable sort by Home alias
    var sorted = gateways.slice().sort(function (a, b) {
      var aLabel = (a.homeAlias || a.name || "").toLowerCase();
      var bLabel = (b.homeAlias || b.name || "").toLowerCase();
      return aLabel < bLabel ? -1 : aLabel > bLabel ? 1 : 0;
    });

    var searchHtml =
      '<div class="locator-search">' +
      '<input type="text" class="locator-search-input" id="energy-locator-search"' +
      ' placeholder="' +
      t("energy.locator.search") +
      '">' +
      "</div>";

    var countHtml =
      '<div class="locator-count" id="energy-locator-count">' +
      sorted.length +
      " " +
      t("fleet.gateways") +
      "</div>";

    var self = this;
    var items = sorted
      .map(function (gw) {
        return self._buildLocatorItem(gw);
      })
      .join("");

    return (
      searchHtml +
      countHtml +
      '<div class="locator-list" id="energy-locator-list">' +
      items +
      "</div>"
    );
  },

  _buildLocatorItem: function (gw) {
    var statusClass = gw.status === "online" ? "online" : "offline";
    var homeAlias = gw.homeAlias || gw.name || gw.gatewayId;
    var gatewayIdentity =
      gw.homeAlias && gw.homeAlias !== gw.name
        ? gw.name || gw.gatewayId
        : gw.gatewayId;
    var isSelected = this._state.gatewayId === gw.gatewayId;

    var socHtml = "";
    if (gw.status === "online" && gw.batterySoc != null) {
      socHtml =
        '<span class="locator-soc">SoC ' +
        Math.round(gw.batterySoc) +
        "%</span>";
    }

    var statusLabel =
      gw.status === "online" ? t("devices.online") : t("devices.offline");

    return (
      '<div class="locator-item energy-locator-item' +
      (isSelected ? " selected" : "") +
      '" data-gw-id="' +
      gw.gatewayId +
      '" data-home-alias="' +
      (homeAlias || "").replace(/"/g, "&quot;") +
      '" data-gw-name="' +
      (gw.name || "").replace(/"/g, "&quot;") +
      '">' +
      '<div class="locator-status ' +
      statusClass +
      '"></div>' +
      '<div class="locator-info">' +
      '<div class="locator-home">' +
      homeAlias +
      "</div>" +
      '<div class="locator-gw-id">' +
      gatewayIdentity +
      "</div>" +
      "</div>" +
      '<div class="locator-badges">' +
      socHtml +
      '<span class="locator-status-label ' +
      statusClass +
      '">' +
      statusLabel +
      "</span>" +
      "</div>" +
      "</div>"
    );
  },

  _setupLocatorEvents: function () {
    var self = this;

    // Gateway item click → select and reload workbench
    document.querySelectorAll(".energy-locator-item").forEach(function (item) {
      item.addEventListener("click", function () {
        var gwId = item.dataset.gwId;
        if (gwId && gwId !== self._state.gatewayId) {
          self._onLocatorSelect(gwId);
        }
      });
    });

    // Search input → client-side filter
    var searchInput = document.getElementById("energy-locator-search");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        self._filterLocator(searchInput.value);
      });
    }
  },

  _onLocatorSelect: function (gwId) {
    var self = this;
    var gateways = self._state.gateways || [];
    var gwObj = gateways.find(function (g) {
      return g.gatewayId === gwId;
    });

    self._state.gatewayId = gwId;
    self._state.gatewayName = gwObj
      ? gwObj.homeAlias || gwObj.name || gwId
      : gwId;

    // Update DemoStore as optional memory
    DemoStore.set("selectedGatewayId", gwId);
    DemoStore.set("selectedGatewayName", self._state.gatewayName);

    self._updateLocatorSelection(gwId);
    self._rerenderWorkbench();
  },

  _filterLocator: function (query) {
    var q = (query || "").toLowerCase().trim();
    var items = document.querySelectorAll(".energy-locator-item");
    var visibleCount = 0;

    items.forEach(function (item) {
      var homeAlias = (item.dataset.homeAlias || "").toLowerCase();
      var gwName = (item.dataset.gwName || "").toLowerCase();
      var gwId = (item.dataset.gwId || "").toLowerCase();

      var match =
        !q ||
        homeAlias.indexOf(q) >= 0 ||
        gwName.indexOf(q) >= 0 ||
        gwId.indexOf(q) >= 0;

      item.classList.toggle("hidden", !match);
      if (match) visibleCount++;
    });

    var countEl = document.getElementById("energy-locator-count");
    if (countEl) {
      var total = (this._state.gateways || []).length;
      countEl.textContent = q
        ? visibleCount + " / " + total + " " + t("fleet.gateways")
        : total + " " + t("fleet.gateways");
    }
  },

  _updateLocatorSelection: function (gwId) {
    document.querySelectorAll(".energy-locator-item").forEach(function (item) {
      if (item.dataset.gwId === gwId) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });
  },

  // =========================================================
  // URL PARAM HELPERS
  // =========================================================

  _parseHashParams: function () {
    var hash = location.hash || "";
    var qIdx = hash.indexOf("?");
    if (qIdx === -1) return {};
    var qs = hash.substring(qIdx + 1);
    var params = {};
    qs.split("&").forEach(function (pair) {
      var parts = pair.split("=");
      if (parts.length === 2) {
        params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
      }
    });
    return params;
  },

  _todayStr: function () {
    var b = toBRT(new Date());
    return (
      b.year +
      "-" +
      String(b.month).padStart(2, "0") +
      "-" +
      String(b.day).padStart(2, "0")
    );
  },

  _dateToStr: function (d) {
    // dateAnchor is stored as BRT midnight in UTC (T03:00:00Z)
    // so getUTCDate/Month/FullYear returns the BRT calendar date
    return (
      d.getUTCFullYear() +
      "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getUTCDate()).padStart(2, "0")
    );
  },

  _monthToStr: function (d) {
    if (d.year != null) {
      return d.year + "-" + String(d.month).padStart(2, "0");
    }
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return [
      '<div class="energy-top-controls">',
      '<div class="skeleton skeleton-ctrl-sm"></div>',
      '<div class="skeleton skeleton-ctrl-md"></div>',
      "</div>",
      Components.skeletonChart(),
    ].join("");
  },

  // =========================================================
  // EMPTY STATES
  // =========================================================

  _buildEmptyStateNoGateways: function () {
    return (
      '<div class="energy-empty-state">' +
      '<div class="energy-empty-icon">&#9889;</div>' +
      '<div class="energy-empty-title">' +
      t("energy.noGateways") +
      "</div>" +
      '<div class="energy-empty-hint">' +
      t("energy.noGatewaysHint") +
      "</div>" +
      "</div>"
    );
  },

  // =========================================================
  // WORKBENCH (right panel)
  // =========================================================

  _rerenderWorkbench: function () {
    var self = this;
    self._stopAutoRefresh();
    Charts.disposePageCharts("energy");

    var workbench = document.getElementById("energy-workbench");
    if (workbench) {
      workbench.innerHTML = self._buildContent();
      self._setupEventListeners();
      self._fetchData();
    }
  },

  _buildContent: function () {
    return [
      this._buildTopControls(),
      '<div id="energy-main-area">',
      '<div class="energy-loading-area">',
      Components.skeletonChart(),
      "</div>",
      "</div>",
    ].join("");
  },

  _buildTopControls: function () {
    var self = this;
    var tw = self._state.timeWindow;
    var windows = ["24h", "7d", "30d", "12m"];
    var today = self._todayStr();

    var gwLabel = self._state.gatewayName || self._state.gatewayId || "";

    var windowBtns = windows
      .map(function (w) {
        var cls = w === tw ? "energy-window-btn active" : "energy-window-btn";
        return (
          '<button class="' +
          cls +
          '" data-window="' +
          w +
          '">' +
          w +
          "</button>"
        );
      })
      .join("");

    var dateInput;
    if (tw === "12m") {
      var monthVal =
        self._state.dateAnchor && self._state.dateAnchor.year
          ? self._monthToStr(self._state.dateAnchor)
          : today.slice(0, 7);
      dateInput =
        '<input type="month" class="energy-date-input" id="energy-date-picker" value="' +
        monthVal +
        '" max="' +
        today.slice(0, 7) +
        '">';
    } else {
      var dateVal = self._state.dateAnchor
        ? self._dateToStr(self._state.dateAnchor)
        : today;
      dateInput =
        '<input type="date" class="energy-date-input" id="energy-date-picker" value="' +
        dateVal +
        '" max="' +
        today +
        '">';
    }

    // Nav buttons
    var navBtns =
      '<button class="energy-nav-btn" id="energy-prev-btn">&larr; ' +
      t("energy.controls.prev") +
      "</button>" +
      '<button class="energy-nav-btn energy-today-btn" id="energy-today-btn">' +
      t("energy.controls.today") +
      "</button>" +
      '<button class="energy-nav-btn" id="energy-next-btn">' +
      t("energy.controls.next") +
      " &rarr;</button>";

    // Auto-refresh indicator (24h + today only)
    var isToday =
      tw === "24h" && self._dateToStr(self._state.dateAnchor) === today;
    var autoRefreshHtml = isToday
      ? '<span class="energy-auto-refresh" id="energy-auto-refresh">' +
        '<span class="energy-pulse-dot"></span> ' +
        t("energy.autoRefresh") +
        " &middot; " +
        t("energy.updated") +
        " " +
        self._currentTimeStr() +
        "</span>"
      : "";

    return (
      '<div class="energy-top-controls">' +
      '<div class="energy-gw-label" title="' +
      gwLabel +
      '">' +
      gwLabel +
      "</div>" +
      '<div class="energy-controls-right">' +
      '<div class="energy-window-group">' +
      windowBtns +
      "</div>" +
      dateInput +
      navBtns +
      '<button class="energy-refresh-btn" id="energy-refresh-btn" title="Refresh">&#8635;</button>' +
      "</div>" +
      autoRefreshHtml +
      "</div>"
    );
  },

  // =========================================================
  // 24h VIEW
  // =========================================================

  _build24hView: function (data) {
    var points = (data && data.points) || [];
    var summary = this._calc24hSummary(data);

    var hasSoc = points.some(function (p) {
      return p.soc != null;
    });

    return [
      this._buildVerdict(summary),
      this._buildSummaryStrip(summary),
      this._buildBatteryContext(summary),
      '<div id="energy-24h-chart" class="energy-chart-container' +
        (hasSoc ? " has-soc" : "") +
        '"></div>',
      this._buildInterpretation(summary),
    ].join("");
  },

  _init24hChart: function (data) {
    var self = this;
    var points = (data && data.points) || [];
    if (points.length === 0) return;

    var hasSoc = points.some(function (p) {
      return p.soc != null;
    });

    // Build data arrays
    var timestamps = [];
    var pvData = [];
    var loadData = [];
    var batteryData = [];
    var gridData = [];
    var socData = [];

    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      timestamps.push(p.ts);
      pvData.push(p.pv);
      loadData.push(p.load);
      batteryData.push(p.battery);
      gridData.push(p.grid);
      socData.push(p.soc);
    }

    // Day boundaries for x-axis
    var dateStr =
      (data && data.date) || self._dateToStr(self._state.dateAnchor);
    var dayStart = dateStr + "T03:00:00Z";
    var dayEnd = dateStr + "T03:00:00Z";
    // Shift dayEnd to next day BRT midnight (add 24h - 1s)
    var _de = new Date(dayEnd);
    _de.setUTCSeconds(_de.getUTCSeconds() + 86400 - 1);
    dayEnd = _de.toISOString();

    var grids = hasSoc
      ? [
          { top: "6%", height: "52%", left: 60, right: 30 },
          { top: "68%", height: "26%", left: 60, right: 30 },
        ]
      : [{ top: "8%", height: "78%", left: 60, right: 30 }];

    var axisColors = {
      axisLine: "#314155",
      axisLabel: "#95a3b8",
      splitLine: "rgba(255,255,255,0.07)",
    };

    var xAxes = [
      {
        gridIndex: 0,
        type: "time",
        min: dayStart,
        max: dayEnd,
        axisLabel: {
          color: axisColors.axisLabel,
          formatter: function (val) {
            var b = toBRT(new Date(val));
            return b ? String(b.hour).padStart(2, "0") + ":00" : "";
          },
        },
        axisLine: { lineStyle: { color: axisColors.axisLine } },
        splitLine: { lineStyle: { color: axisColors.splitLine } },
        splitNumber: 12,
      },
    ];

    var yAxes = [
      {
        gridIndex: 0,
        type: "value",
        name: "kW",
        nameLocation: "middle",
        nameGap: 45,
        axisLabel: { color: axisColors.axisLabel },
        axisLine: { lineStyle: { color: axisColors.axisLine } },
        splitLine: { lineStyle: { color: axisColors.splitLine } },
      },
    ];

    if (hasSoc) {
      xAxes.push({
        gridIndex: 1,
        type: "time",
        min: dayStart,
        max: dayEnd,
        show: false,
      });
      yAxes.push({
        gridIndex: 1,
        type: "value",
        name: "SoC %",
        min: 0,
        max: 100,
        nameLocation: "middle",
        nameGap: 45,
        axisLabel: { color: axisColors.axisLabel },
        axisLine: { lineStyle: { color: axisColors.axisLine } },
        splitLine: { lineStyle: { color: axisColors.splitLine } },
      });
    }

    var series = [
      {
        name: "PV",
        type: "line",
        smooth: true,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: timestamps.map(function (t, i) {
          return [t, pvData[i]];
        }),
        symbol: "none",
        lineStyle: { width: 2, color: "#f6c445" },
        itemStyle: { color: "#f6c445" },
      },
      {
        name: "Load",
        type: "line",
        smooth: true,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: timestamps.map(function (t, i) {
          return [t, loadData[i]];
        }),
        symbol: "none",
        lineStyle: { width: 2.5, color: "#60a5fa" },
        itemStyle: { color: "#60a5fa" },
      },
      {
        name: "Battery",
        type: "line",
        smooth: true,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: timestamps.map(function (t, i) {
          return [t, batteryData[i]];
        }),
        symbol: "none",
        lineStyle: { width: 2, color: "#34d399" },
        itemStyle: { color: "#34d399" },
        areaStyle: { color: "rgba(52,211,153,0.08)" },
      },
      {
        name: "Grid",
        type: "line",
        smooth: true,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: timestamps.map(function (t, i) {
          return [t, gridData[i]];
        }),
        symbol: "none",
        lineStyle: { width: 2, color: "#f87171" },
        itemStyle: { color: "#f87171" },
        areaStyle: { color: "rgba(248,113,113,0.15)" },
      },
    ];

    if (hasSoc) {
      series.push({
        name: "SoC",
        type: "line",
        smooth: true,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: timestamps.map(function (t, i) {
          return [t, socData[i]];
        }),
        symbol: "none",
        lineStyle: { width: 2, color: "#a78bfa" },
        itemStyle: { color: "#a78bfa" },
        areaStyle: { color: "rgba(167,139,250,0.1)" },
      });
    }

    var option = {
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      legend: {
        data: hasSoc
          ? ["PV", "Load", "Battery", "Grid", "SoC"]
          : ["PV", "Load", "Battery", "Grid"],
        top: 0,
        textStyle: { color: "#95a3b8" },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#09111c",
        borderColor: "#223041",
        textStyle: { color: "#e5ebf5" },
        formatter: function (params) {
          if (!params || !params.length) return "";
          var ts = new Date(params[0].value[0]);
          var brt = toBRT(ts);
          var timeStr = brt
            ? String(brt.hour).padStart(2, "0") + ":" + String(brt.minute).padStart(2, "0")
            : "--:--";
          var lines = ["<b>" + timeStr + "</b>"];
          for (var j = 0; j < params.length; j++) {
            var s = params[j];
            var val = s.value[1];
            if (val == null) continue;
            var extra = "";
            if (s.seriesName === "Battery") {
              extra =
                val >= 0
                  ? " (" + t("energy.discharge") + ")"
                  : " (" + t("energy.charge") + ")";
            } else if (s.seriesName === "Grid") {
              extra =
                val >= 0
                  ? " (" + t("energy.import") + ")"
                  : " (" + t("energy.export") + ")";
            }
            var unit = s.seriesName === "SoC" ? "%" : " kW";
            lines.push(
              s.marker +
                " " +
                s.seriesName +
                ": " +
                (typeof val === "number" ? val.toFixed(2) : val) +
                unit +
                extra,
            );
          }
          return lines.join("<br>");
        },
      },
      series: series,
    };

    // Zero-axis dashed line on the main power chart
    option.series[0].markLine = {
      silent: true,
      symbol: "none",
      lineStyle: { color: "rgba(255,255,255,0.22)", type: "dashed", width: 1 },
      data: [{ yAxis: 0 }],
      label: { show: false },
    };

    Charts.createChart("energy-24h-chart", option, { pageId: "energy" });
  },

  // =========================================================
  // STATS VIEW (7d / 30d / 12m)
  // =========================================================

  _buildStatsView: function (data) {
    var totals = (data && data.totals) || {};
    var summary = this._normalizeStatsTotals(totals);

    return [
      this._buildVerdict(summary),
      this._buildSummaryStrip(summary),
      this._buildBatteryContext(summary),
      '<div id="energy-stats-chart" class="energy-chart-container"></div>',
      this._buildSocInfoBlock(),
      this._buildMetricsHierarchy(totals),
      this._buildInterpretation(summary),
    ].join("");
  },

  _initStatsChart: function (data) {
    var self = this;
    var buckets = (data && data.buckets) || [];
    if (buckets.length === 0) return;

    var labels = buckets.map(function (b) {
      return b.label;
    });
    var pvData = buckets.map(function (b) {
      return b.pvKwh;
    });
    var loadData = buckets.map(function (b) {
      return b.loadKwh;
    });
    var gridImportData = buckets.map(function (b) {
      return b.gridImportKwh;
    });
    var gridExportData = buckets.map(function (b) {
      return b.gridExportKwh;
    });

    // Format labels for display
    var tw = self._state.timeWindow;
    var displayLabels = labels.map(function (l) {
      if (tw === "12m") return l; // YYYY-MM
      // YYYY-MM-DD → MM/DD
      var parts = l.split("-");
      return parts[1] + "/" + parts[2];
    });

    var xAxisInterval = tw === "30d" ? 4 : 0;

    var option = {
      grid: { top: "12%", bottom: "15%", left: 60, right: 30 },
      xAxis: {
        type: "category",
        data: displayLabels,
        axisLabel: {
          interval: xAxisInterval,
          rotate: tw === "30d" ? 45 : 0,
          fontSize: 11,
        },
      },
      yAxis: {
        type: "value",
        name: "kWh",
        nameLocation: "middle",
        nameGap: 45,
      },
      legend: {
        data: ["PV", "Load", "Grid Import", "Grid Export"],
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          if (!params || !params.length) return "";
          var label = params[0].axisValue;
          // Find original bucket for full data
          var idx = displayLabels.indexOf(label);
          var bucket = idx >= 0 ? buckets[idx] : null;
          var lines = ["<b>" + label + "</b>"];
          for (var j = 0; j < params.length; j++) {
            var s = params[j];
            lines.push(
              s.marker +
                " " +
                s.seriesName +
                ": " +
                s.value.toFixed(1) +
                " kWh",
            );
          }
          // Add battery info from bucket (not shown as bars, per DESIGN)
          if (bucket) {
            lines.push("--- Battery ---");
            lines.push(
              "Charge: " + bucket.batteryChargeKwh.toFixed(1) + " kWh",
            );
            lines.push(
              "Discharge: " + bucket.batteryDischargeKwh.toFixed(1) + " kWh",
            );
          }
          return lines.join("<br>");
        },
      },
      series: [
        {
          name: "PV",
          type: "bar",
          data: pvData,
          itemStyle: { color: self.COLORS.pv },
        },
        {
          name: "Load",
          type: "bar",
          data: loadData,
          itemStyle: { color: self.COLORS.load },
        },
        {
          name: "Grid Import",
          type: "bar",
          data: gridImportData,
          itemStyle: { color: self.COLORS.gridImport },
        },
        {
          name: "Grid Export",
          type: "bar",
          data: gridExportData,
          itemStyle: { color: self.COLORS.gridExport },
        },
      ],
    };

    Charts.createChart("energy-stats-chart", option, { pageId: "energy" });
  },

  // =========================================================
  // DIRECTIONAL SUMMARY (shared by 24h and stats views)
  // =========================================================

  _buildDirectionalSummary: function (summary) {
    var s = summary || {};
    var cards = [
      {
        label: t("energy.batCharge"),
        value: (s.batteryChargeKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "charge",
        desc: t("energy.desc.batCharge"),
      },
      {
        label: t("energy.batDischarge"),
        value: (s.batteryDischargeKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "discharge",
        desc: t("energy.desc.batDischarge"),
      },
      {
        label: t("energy.gridImport"),
        value: (s.gridImportKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "import",
        desc: t("energy.desc.gridImport"),
      },
      {
        label: t("energy.gridExport"),
        value: (s.gridExportKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "export",
        desc: t("energy.desc.gridExport"),
      },
    ];

    var html = '<div class="energy-dir-cards">';
    for (var i = 0; i < cards.length; i++) {
      html +=
        '<div class="stat-card metric ' +
        cards[i].cls +
        ' energy-dir-card">' +
        '<div class="stat-card-label">' +
        cards[i].label +
        "</div>" +
        '<div class="metric-value">' +
        cards[i].value +
        " " +
        cards[i].unit +
        "</div>" +
        (cards[i].desc
          ? '<div class="stat-card-desc">' + cards[i].desc + "</div>"
          : "") +
        "</div>";
    }
    html += "</div>";
    return html;
  },

  // =========================================================
  // SoC INFO BLOCK (for stats view)
  // =========================================================

  _buildSocInfoBlock: function () {
    return (
      '<div class="energy-soc-info">' +
      '<span class="energy-soc-info-icon">&#9432;</span> ' +
      t("energy.socOnlyIn24h") +
      "</div>"
    );
  },

  // =========================================================
  // METRICS HIERARCHY (for stats view)
  // =========================================================

  _buildMetricsHierarchy: function (totals) {
    var t_ = totals || {};

    // Primary metrics
    var primary = [
      {
        label: t("energy.pvGeneration"),
        value: (t_.pvGenerationKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "pv",
        desc: t("energy.desc.pvGen"),
      },
      {
        label: t("energy.loadConsumption"),
        value: (t_.loadConsumptionKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "load",
        desc: t("energy.desc.loadCons"),
      },
      {
        label: t("energy.gridImport"),
        value: (t_.gridImportKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "import",
        desc: t("energy.desc.gridImport"),
      },
      {
        label: t("energy.gridExport"),
        value: (t_.gridExportKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "export",
        desc: t("energy.desc.gridExport"),
      },
    ];

    // Secondary metrics
    var secondary = [
      {
        label: t("energy.batCharge"),
        value: (t_.batteryChargeKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "charge",
        desc: t("energy.desc.batCharge"),
      },
      {
        label: t("energy.batDischarge"),
        value: (t_.batteryDischargeKwh || 0).toFixed(1),
        unit: "kWh",
        cls: "discharge",
        desc: t("energy.desc.batDischarge"),
      },
    ];

    // Supporting metrics
    var supporting = [
      {
        label: t("energy.selfConsumption"),
        value: t_.selfConsumptionPct || 0,
        unit: "%",
        cls: "supporting",
        desc: t("energy.desc.selfCons"),
      },
      {
        label: t("energy.selfSufficiency"),
        value: t_.selfSufficiencyPct || 0,
        unit: "%",
        cls: "supporting",
        desc: t("energy.desc.selfSuff"),
      },
      {
        label: t("energy.peakDemand"),
        value: (t_.peakDemandKw || 0).toFixed(1),
        unit: "kW",
        cls: "supporting",
        desc: t("energy.desc.peakDemand"),
      },
    ];

    var html = "";

    // Helper: render a single stat card with optional description
    function cardHtml(c) {
      return (
        '<div class="stat-card metric ' +
        c.cls +
        '">' +
        '<div class="stat-card-label">' +
        c.label +
        "</div>" +
        '<div class="metric-value">' +
        c.value +
        " " +
        c.unit +
        "</div>" +
        (c.desc ? '<div class="stat-card-desc">' + c.desc + "</div>" : "") +
        "</div>"
      );
    }

    // Primary row
    html += '<div class="energy-metric-primary">';
    for (var i = 0; i < primary.length; i++) {
      html += cardHtml(primary[i]);
    }
    html += "</div>";

    // Secondary row
    html += '<div class="energy-metric-secondary">';
    for (var j = 0; j < secondary.length; j++) {
      html += cardHtml(secondary[j]);
    }
    html += "</div>";

    // Supporting row
    html += '<div class="energy-metric-supporting">';
    for (var k = 0; k < supporting.length; k++) {
      html += cardHtml(supporting[k]);
    }
    html += "</div>";

    return html;
  },

  // =========================================================
  // DATA FETCHING
  // =========================================================

  _fetchData: async function () {
    var self = this;
    if (self._state.isLoading) return;

    self._state.isLoading = true;
    var mainArea = document.getElementById("energy-main-area");
    if (mainArea) {
      mainArea.innerHTML =
        '<div class="energy-loading-area">' +
        Components.skeletonChart() +
        "</div>";
    }

    try {
      if (self._state.timeWindow === "24h") {
        var dateStr = self._dateToStr(self._state.dateAnchor);
        var data24h = await DataSource.energy.gateway24h(
          self._state.gatewayId,
          dateStr,
        );
        self._state.energy24hData = data24h;

        if (mainArea) {
          mainArea.innerHTML = self._build24hView(data24h);
          self._init24hChart(data24h);
        }

        // Start auto-refresh only for today
        self._stopAutoRefresh();
        if (dateStr === self._todayStr()) {
          self._startAutoRefresh();
          self._updateAutoRefreshText();
        }
      } else {
        var endDate;
        if (self._state.timeWindow === "12m") {
          endDate = self._monthToStr(self._state.dateAnchor);
        } else {
          endDate = self._dateToStr(self._state.dateAnchor);
        }
        var statsData = await DataSource.energy.gatewayStats(
          self._state.gatewayId,
          self._state.timeWindow,
          endDate,
        );
        self._state.energyStatsData = statsData;

        if (mainArea) {
          mainArea.innerHTML = self._buildStatsView(statsData);
          self._initStatsChart(statsData);
        }

        self._stopAutoRefresh();
      }
    } catch (err) {
      console.error("[Energy] Fetch error:", err);
      if (mainArea) {
        mainArea.innerHTML = Components.errorBanner(t("shared.apiError"));
      }
    } finally {
      self._state.isLoading = false;
    }
  },

  // =========================================================
  // AUTO-REFRESH (24h today only)
  // =========================================================

  _startAutoRefresh: function () {
    var self = this;
    self._stopAutoRefresh();
    self._state.refreshTimer = setInterval(function () {
      // Pause when page is not visible
      if (document.visibilityState !== "visible") return;
      self._fetchData();
    }, self.REFRESH_INTERVAL_MS);
  },

  _stopAutoRefresh: function () {
    if (this._state.refreshTimer) {
      clearInterval(this._state.refreshTimer);
      this._state.refreshTimer = null;
    }
  },

  // =========================================================
  // EVENT HANDLERS
  // =========================================================

  _setupEventListeners: function () {
    var self = this;

    // Window toggle buttons
    document.querySelectorAll(".energy-window-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var w = btn.dataset.window;
        if (w && w !== self._state.timeWindow) {
          self._onWindowChange(w);
        }
      });
    });

    // Date picker
    var datePicker = document.getElementById("energy-date-picker");
    if (datePicker) {
      datePicker.addEventListener("change", function () {
        self._onDateChange(datePicker.value);
      });
    }

    // Refresh button
    var refreshBtn = document.getElementById("energy-refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        self._fetchData();
      });
    }

    // Prev button
    var prevBtn = document.getElementById("energy-prev-btn");
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        self._onPrevClick();
      });
    }

    // Next button
    var nextBtn = document.getElementById("energy-next-btn");
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        self._onNextClick();
      });
    }

    // Today button
    var todayBtn = document.getElementById("energy-today-btn");
    if (todayBtn) {
      todayBtn.addEventListener("click", function () {
        self._onTodayClick();
      });
    }
  },

  // =========================================================
  // NAV HANDLERS (v6.3-R2)
  // =========================================================

  _onPrevClick: function () {
    var self = this;
    if (self._state.timeWindow === "12m") {
      var anchor = self._state.dateAnchor;
      var m = anchor.month - 1;
      var y = anchor.year;
      if (m < 1) {
        m = 12;
        y--;
      }
      self._state.dateAnchor = { year: y, month: m };
    } else {
      var d = new Date(self._state.dateAnchor);
      d.setDate(d.getDate() - 1);
      self._state.dateAnchor = d;
    }
    self._rerenderWorkbench();
  },

  _onNextClick: function () {
    var self = this;
    var _b = toBRT(new Date());
    var today = new Date(Date.UTC(_b.year, _b.month - 1, _b.day, 3, 0, 0));
    if (self._state.timeWindow === "12m") {
      var anchor = self._state.dateAnchor;
      var m = anchor.month + 1;
      var y = anchor.year;
      if (m > 12) {
        m = 1;
        y++;
      }
      var nowMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };
      if (y > nowMonth.year || (y === nowMonth.year && m > nowMonth.month))
        return;
      self._state.dateAnchor = { year: y, month: m };
    } else {
      var d = new Date(self._state.dateAnchor);
      d.setDate(d.getDate() + 1);
      if (d > today) return;
      self._state.dateAnchor = d;
    }
    self._rerenderWorkbench();
  },

  _onTodayClick: function () {
    var self = this;
    if (self._state.timeWindow === "12m") {
      var _bn = toBRT(new Date());
      self._state.dateAnchor = {
        year: _bn.year,
        month: _bn.month,
      };
    } else {
      var _bt = toBRT(new Date());
      var today = new Date(Date.UTC(_bt.year, _bt.month - 1, _bt.day, 3, 0, 0));
      self._state.dateAnchor = today;
    }
    self._rerenderWorkbench();
  },

  _onWindowChange: function (newWindow) {
    var self = this;
    var oldWindow = self._state.timeWindow;
    var oldAnchor = self._state.dateAnchor;

    // Convert date anchor per DESIGN ss8.1 rules
    var newAnchor;
    var _bw = toBRT(new Date());
    var today = new Date(Date.UTC(_bw.year, _bw.month - 1, _bw.day, 3, 0, 0));

    if (newWindow === "12m") {
      // Any -> 12m: use anchor's month
      if (oldAnchor && oldAnchor.year != null) {
        newAnchor = { year: oldAnchor.year, month: oldAnchor.month };
      } else if (oldAnchor instanceof Date) {
        newAnchor = {
          year: oldAnchor.getFullYear(),
          month: oldAnchor.getMonth() + 1,
        };
      } else {
        newAnchor = { year: today.getFullYear(), month: today.getMonth() + 1 };
      }
    } else {
      // Target is 24h / 7d / 30d → need a Date object
      if (oldWindow === "12m" && oldAnchor && oldAnchor.year != null) {
        // 12m -> 24h/7d/30d: clamp to min(last day of month, today) (REVIEW M1 fix)
        var lastDay = new Date(oldAnchor.year, oldAnchor.month, 0);
        newAnchor = lastDay > today ? new Date(today) : lastDay;
      } else if (oldAnchor instanceof Date) {
        newAnchor = new Date(oldAnchor);
      } else {
        newAnchor = new Date(today);
      }

      // Clamp to today
      if (newAnchor > today) {
        newAnchor = new Date(today);
      }
    }

    self._state.timeWindow = newWindow;
    self._state.dateAnchor = newAnchor;

    // Re-render workbench (top controls date picker type may change)
    self._rerenderWorkbench();
  },

  _onDateChange: function (value) {
    var self = this;
    if (!value) return;

    if (self._state.timeWindow === "12m") {
      var parts = value.split("-");
      self._state.dateAnchor = {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10),
      };
    } else {
      self._state.dateAnchor = new Date(value + "T03:00:00Z");
    }

    self._fetchData();
  },
};
