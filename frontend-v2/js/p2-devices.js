/* ============================================
   SOLFACIL Admin Portal — P2: Device Management (v6.2)
   Home-first workbench architecture:
   Left  — Object Locator (always visible, gateway list with Home alias)
   Right — Workbench: Data Lane (50%) + Control Lane (50%)
   ============================================ */

function parseChineseRuntime(str) {
  if (!str) return "--";
  var d = str.match(/(\d+)天/);
  var h = str.match(/(\d+)小时/);
  var m = str.match(/(\d+)分钟/);
  var parts = [];
  if (d) parts.push(d[1] + "d");
  if (h) parts.push(h[1] + "h");
  if (m) parts.push(m[1] + "min");
  return parts.length > 0 ? parts.join(" ") : str;
}

function parseSignalStrength(str) {
  if (!str) return "--";
  var match = str.match(/([\d.-]+)\s*dBm/i);
  return match ? match[1] + " dBm" : str;
}

function parseFirmwareStatus(str) {
  if (!str) return "--";
  var map = {
    未插入: "N/A",
    已插入: "OK",
    打开: "On",
    关闭: "Off",
    无信号: "No signal",
  };
  return map[str] || str;
}

var DevicesPage = {
  _gateways: null,
  _selectedGwId: null,
  _currentDetail: null,
  _currentSchedule: null,
  _pendingConfig: null,
  _currentGatewayId: null,
  _ratedMaxPowerKw: null,
  _sseSource: null,
  _sseDebounceTimer: null,

  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  init: async function () {
    var self = this;
    var container = document.getElementById("devices-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      self._gateways = await DataSource.devices.gateways();
    } catch (err) {
      showErrorBoundary("devices-content", err);
      return;
    }

    if (!self._gateways || self._gateways.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><div class="empty-state-title">' +
        t("shared.noData") +
        '</div><div class="empty-state-detail">' +
        t("devices.noDevicesUnderGw") +
        "</div></div>";
      return;
    }

    // v6.2: Three-segment layout — Locator (left) + Workbench (right)
    container.innerHTML =
      '<div class="devices-layout">' +
      '<div class="devices-locator" id="devices-locator">' +
      self._buildLocator() +
      "</div>" +
      '<div class="devices-workbench" id="devices-workbench">' +
      self._buildWorkbenchEmpty() +
      "</div>" +
      "</div>";

    self._setupLocatorEvents();
    self._setupDiagnosticsAccordionEvents();

    // Restore workbench if it was open before language switch
    if (self._currentGatewayId) {
      setTimeout(function () {
        self._selectGateway(self._currentGatewayId);
      }, 100);
    }

    // v5.21: Connect SSE for real-time push
    self._connectSSE();
  },

  onRoleChange: function () {
    this._selectedGwId = null;
    this._currentDetail = null;
    this._currentSchedule = null;
    this._pendingConfig = null;
    this._currentGatewayId = null;
    this.init();
  },

  // =========================================================
  // SSE REAL-TIME PUSH (v5.21)
  // =========================================================

  _connectSSE: function () {
    var self = this;
    if (self._sseSource) {
      self._sseSource.close();
      self._sseSource = null;
    }

    var base = DataSource.API_BASE;
    self._sseSource = new EventSource(base + "/api/events");

    self._sseSource.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data);
        self._handleSSEEvent(data);
      } catch (e) {
        console.warn("[SSE] Parse error:", e);
      }
    };

    self._sseSource.onerror = function () {
      console.warn("[SSE] Connection error, will auto-reconnect");
    };
  },

  _handleSSEEvent: function (data) {
    var self = this;
    if (!data || !data.gatewayId) return;
    if (!self._currentGatewayId || self._currentGatewayId !== data.gatewayId)
      return;

    // Command status events: re-enable Apply button on terminal results
    if (data.type === "command_status") {
      var terminalResults = ["success", "fail", "timeout"];
      if (terminalResults.indexOf(data.result) >= 0) {
        var applyBtn = document.getElementById("schedule-apply");
        if (applyBtn) {
          applyBtn.textContent = t("devices.applyToGateway");
          applyBtn.disabled = false;
        }
        var infoEl = document.getElementById("schedule-inflight-info");
        if (infoEl) { infoEl.classList.remove("visible"); }
        // Refresh schedule card to show updated status
        self._refreshScheduleCard(data.gatewayId);
      }
      return;
    }

    if (self._sseDebounceTimer) clearTimeout(self._sseDebounceTimer);
    self._sseDebounceTimer = setTimeout(function () {
      self._sseDebounceTimer = null;
      if (data.type === "telemetry_update") {
        self._refreshTelemetryValues(data.gatewayId);
      } else if (data.type === "gateway_health") {
        self._refreshHealthValues(data.gatewayId);
      }
    }, 2000);
  },

  _refreshTelemetryValues: async function (gatewayId) {
    var self = this;
    try {
      var detail = await DataSource.devices.gatewayDetail(gatewayId);
      if (!detail) return;
      self._currentDetail = detail;
      var state = detail.state || {};
      var extra = detail.telemetryExtra || {};

      function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
      }

      // Energy Flow SVG values
      setText(
        "tv-pvPower",
        state.pvPower != null
          ? formatNumber(state.pvPower, 1) + " kW"
          : "\u2014",
      );
      setText(
        "tv-batteryPower",
        state.batteryPower != null
          ? formatNumber(Math.abs(state.batteryPower), 1) + " kW"
          : "\u2014",
      );
      setText(
        "tv-loadPower",
        state.loadPower != null
          ? formatNumber(state.loadPower, 1) + " kW"
          : "\u2014",
      );
      setText(
        "tv-gridPowerKw",
        state.gridPowerKw != null
          ? formatNumber(Math.abs(state.gridPowerKw), 1) + " kW"
          : "\u2014",
      );

      // Battery sub-label
      var batSub =
        "SoC " + (state.batterySoc || 0) + "% \u00b7 " + t("devices.ef.idle");
      if (state.batteryPower > 0.05)
        batSub =
          "SoC " +
          (state.batterySoc || 0) +
          "% \u00b7 " +
          t("devices.ef.charging");
      else if (state.batteryPower < -0.05)
        batSub =
          "SoC " +
          (state.batterySoc || 0) +
          "% \u00b7 " +
          t("devices.ef.discharging");
      setText("tv-batterySub", batSub);

      // Grid sub-label
      var gridSub =
        state.gridPowerKw > 0
          ? t("devices.ef.importing")
          : state.gridPowerKw < 0
            ? t("devices.ef.exporting")
            : t("devices.ef.idle");
      setText("tv-gridSub", gridSub);

      // Battery Status card
      setText(
        "tv-batterySoc",
        state.batterySoc != null ? state.batterySoc + "%" : "--",
      );
      setText(
        "tv-batteryVoltage",
        state.batteryVoltage != null
          ? formatNumber(state.batteryVoltage, 1) + " V"
          : "--",
      );
      setText(
        "tv-batteryCurrent",
        state.batteryCurrent != null
          ? formatNumber(state.batteryCurrent, 1) + " A"
          : "--",
      );
      setText(
        "tv-batteryPowerRate",
        state.batteryPower != null
          ? formatNumber(state.batteryPower, 2) + " kW"
          : "--",
      );
      setText(
        "tv-maxChargeCurrent",
        state.maxChargeCurrent != null ? state.maxChargeCurrent + " A" : "--",
      );
      setText(
        "tv-maxDischargeCurrent",
        state.maxDischargeCurrent != null
          ? state.maxDischargeCurrent + " A"
          : "--",
      );

      // Inverter & Grid card
      setText(
        "tv-pvPowerDetail",
        state.pvPower != null ? formatNumber(state.pvPower, 2) + " kW" : "--",
      );
      setText(
        "tv-inverterTemp",
        state.inverterTemp != null ? state.inverterTemp + "\u00b0C" : "--",
      );
      setText(
        "tv-gridPowerDetail",
        state.gridPowerKw != null
          ? formatNumber(state.gridPowerKw, 2) + " kW"
          : "--",
      );
      setText(
        "tv-loadPowerDetail",
        state.loadPower != null
          ? formatNumber(state.loadPower, 2) + " kW"
          : "--",
      );
      setText(
        "tv-gridVoltageR",
        extra.gridVoltageR != null
          ? formatNumber(extra.gridVoltageR, 1) + " V"
          : "--",
      );
      setText(
        "tv-gridCurrentR",
        extra.gridCurrentR != null
          ? formatNumber(extra.gridCurrentR, 1) + " A"
          : "--",
      );
      setText(
        "tv-gridPf",
        extra.gridPf != null ? formatNumber(extra.gridPf, 2) : "--",
      );
      setText(
        "tv-totalBuyKwh",
        extra.totalBuyKwh != null
          ? formatNumber(extra.totalBuyKwh, 1) + " kWh"
          : "--",
      );
      setText(
        "tv-totalSellKwh",
        extra.totalSellKwh != null
          ? formatNumber(extra.totalSellKwh, 1) + " kWh"
          : "--",
      );
    } catch (err) {
      console.warn("[P2] refreshTelemetry error:", err);
    }
  },

  _refreshHealthValues: async function (gatewayId) {
    var self = this;
    try {
      var detail = await DataSource.devices.gatewayDetail(gatewayId);
      if (!detail) return;
      self._currentDetail = detail;
      var h = (detail.gateway && detail.gateway.emsHealth) || {};

      function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
      }

      setText("hv-cpuTemp", h.cpuTemp || h.CPU_temp || "--");
      setText("hv-cpuUsage", h.cpuUsage || h.CPU_usage || "--");
      setText("hv-memoryUsage", h.memoryUsage || h.memory_usage || "--");
      setText("hv-diskUsage", h.diskUsage || h.disk_usage || "--");
      setText(
        "hv-wifiSignalStrength",
        parseSignalStrength(
          h.wifi_signal_strength || h.wifiSignalStrength || "",
        ),
      );
      setText(
        "hv-systemRuntime",
        parseChineseRuntime(h.system_runtime || h.systemRuntime || ""),
      );
      setText("hv-emsTemp", h.emsTemp || h.ems_temp || "--");
      setText("hv-phoneStatus", h.phoneStatus || h.phone_status || "--");
      setText("hv-phoneSignalStrength", parseSignalStrength(h.phoneSignalStrength || h.phone_signal_strength || ""));
      setText("hv-humidity", h.humidity || "--");
      setText("hv-systemTime", h.systemTime || h.system_time || "--");
      setText("hv-hardwareTime", h.hardwareTime || h.hardware_time || "--");
      setText(
        "hv-simStatus",
        parseFirmwareStatus(h.SIM_status || h.simStatus || ""),
      );
    } catch (err) {
      console.warn("[P2] refreshHealth error:", err);
    }
  },

  _refreshScheduleCard: async function (gatewayId) {
    var self = this;
    try {
      var schedule = await DataSource.devices.getSchedule(gatewayId);
      if (schedule) {
        self._currentSchedule = schedule;
      }
    } catch (err) {
      console.warn("[P2] refreshSchedule error:", err);
    }
  },

  _cleanupSSE: function () {
    if (this._sseDebounceTimer) {
      clearTimeout(this._sseDebounceTimer);
      this._sseDebounceTimer = null;
    }
    if (this._sseSource) {
      this._sseSource.close();
      this._sseSource = null;
    }
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return (
      '<div class="devices-layout">' +
      '<div class="devices-locator">' +
      '<div class="skeleton sk-40 sk-mb-12"></div>' +
      '<div class="skeleton sk-60 sk-mb-8"></div>' +
      '<div class="skeleton sk-60 sk-mb-8"></div>' +
      '<div class="skeleton sk-60 sk-mb-8"></div>' +
      "</div>" +
      '<div class="devices-workbench">' +
      '<div class="skeleton sk-200"></div>' +
      "</div>" +
      "</div>"
    );
  },

  // =========================================================
  // OBJECT LOCATOR (left panel, v6.2)
  // =========================================================

  _buildLocator: function () {
    var gateways = this._gateways || [];

    // Stable sort by Home alias
    var sorted = gateways.slice().sort(function (a, b) {
      var aLabel = (a.homeAlias || a.name || "").toLowerCase();
      var bLabel = (b.homeAlias || b.name || "").toLowerCase();
      return aLabel < bLabel ? -1 : aLabel > bLabel ? 1 : 0;
    });

    var searchHtml =
      '<div class="locator-search">' +
      '<input type="text" class="locator-search-input" id="locator-search"' +
      ' placeholder="' +
      t("devices.searchPlaceholder") +
      '">' +
      "</div>";

    var countHtml =
      '<div class="locator-count">' +
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
      '<div class="locator-list" id="locator-list">' +
      items +
      "</div>"
    );
  },

  _buildLocatorItem: function (gw) {
    var statusClass = gw.status === "online" ? "online" : "offline";
    var homeAlias = gw.homeAlias || gw.name || gw.gatewayId;
    // Avoid duplicate: if homeAlias fell back to gw.name, show gatewayId as secondary
    var gatewayIdentity =
      gw.homeAlias && gw.homeAlias !== gw.name
        ? gw.name || gw.gatewayId
        : gw.gatewayId;
    var isSelected = this._selectedGwId === gw.gatewayId;

    // Only show battery SoC when gateway is online AND has battery data
    var socHtml = "";
    if (gw.status === "online" && gw.batterySoc != null) {
      socHtml =
        '<span class="locator-soc">SoC ' +
        Math.round(gw.batterySoc) +
        "%</span>";
    }

    // Anomaly badge: pending/failed/warning (DESIGN §3.3)
    var badgeHtml = "";
    if (gw.syncStatus === "pending") {
      badgeHtml =
        '<span class="locator-badge badge-pending">' +
        t("devices.wb.syncPending") +
        "</span>";
    } else if (gw.syncStatus === "failed") {
      badgeHtml =
        '<span class="locator-badge badge-failed">' +
        t("devices.wb.syncFailed") +
        "</span>";
    }

    var statusLabel =
      gw.status === "online" ? t("devices.online") : t("devices.offline");

    return (
      '<div class="locator-item' +
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
      badgeHtml +
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

    // Gateway item click → select and load workbench
    document.querySelectorAll(".locator-item").forEach(function (item) {
      item.addEventListener("click", function () {
        var gwId = item.dataset.gwId;
        self._selectGateway(gwId);
      });
    });

    // Search input → client-side filter
    var searchInput = document.getElementById("locator-search");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        self._filterLocator(searchInput.value);
      });
    }
  },

  _filterLocator: function (query) {
    var q = (query || "").toLowerCase().trim();
    var items = document.querySelectorAll(".locator-item");
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

    // Update count
    var countEl = document.querySelector(".locator-count");
    if (countEl) {
      var total = (this._gateways || []).length;
      countEl.textContent = q
        ? visibleCount + " / " + total + " " + t("fleet.gateways")
        : total + " " + t("fleet.gateways");
    }
  },

  _updateLocatorSelection: function (gwId) {
    document.querySelectorAll(".locator-item").forEach(function (item) {
      if (item.dataset.gwId === gwId) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });
  },

  // =========================================================
  // WORKBENCH (right panel, v6.2)
  // =========================================================

  _buildWorkbenchEmpty: function () {
    return (
      '<div class="workbench-empty">' +
      '<div class="workbench-empty-icon">&#9776;</div>' +
      '<div class="workbench-empty-title">' +
      t("devices.selectGateway") +
      "</div>" +
      '<div class="workbench-empty-detail">' +
      t("devices.selectGatewayHint") +
      "</div>" +
      "</div>"
    );
  },

  _selectGateway: async function (gatewayId) {
    var self = this;
    var workbench = document.getElementById("devices-workbench");
    if (!workbench) return;

    self._selectedGwId = gatewayId;
    self._currentGatewayId = gatewayId;
    self._updateLocatorSelection(gatewayId);

    // v6.3: Share gateway context with Energy page via DemoStore
    DemoStore.set("selectedGatewayId", gatewayId);
    var gwObj = (self._gateways || []).find(function (g) {
      return g.gatewayId === gatewayId;
    });
    DemoStore.set(
      "selectedGatewayName",
      gwObj ? gwObj.homeAlias || gwObj.name || gatewayId : gatewayId,
    );

    workbench.innerHTML =
      '<div class="detail-loading">' +
      '<div class="skeleton sk-300"></div>' +
      "</div>";

    var detail;
    try {
      detail = await DataSource.devices.gatewayDetail(gatewayId);
      self._currentDetail = detail;
      self._ratedMaxPowerKw =
        detail && detail.config && detail.config.ratedMaxPowerKw != null
          ? detail.config.ratedMaxPowerKw
          : null;

      // Fetch schedule from dedicated endpoint (v5.21)
      var schedData = null;
      try {
        schedData = await DataSource.devices.getSchedule(gatewayId);
      } catch (schedErr) {
        console.warn("[P2] getSchedule error, using defaults:", schedErr);
      }

      self._currentSchedule = {
        syncStatus: (schedData && schedData.syncStatus) || "unknown",
        lastAckAt: (schedData && schedData.lastAckAt) || null,
        batterySchedule:
          schedData && schedData.batterySchedule
            ? schedData.batterySchedule
            : null,
      };

      var bs = self._currentSchedule.batterySchedule;
      self._pendingConfig = {
        socMinLimit: bs && bs.socMinLimit != null ? bs.socMinLimit : 10,
        socMaxLimit: bs && bs.socMaxLimit != null ? bs.socMaxLimit : 95,
        maxChargeCurrent:
          bs && bs.maxChargeCurrent != null ? bs.maxChargeCurrent : 100,
        maxDischargeCurrent:
          bs && bs.maxDischargeCurrent != null ? bs.maxDischargeCurrent : 100,
        gridImportLimitKw:
          bs && bs.gridImportLimitKw != null ? bs.gridImportLimitKw : 3000,
        slots: (bs && bs.slots ? bs.slots : []).map(function (s) {
          return {
            startMinute: s.startMinute,
            endMinute: s.endMinute,
            purpose: s.purpose,
            direction: s.direction || null,
            exportPolicy: s.exportPolicy || null,
          };
        }),
      };
    } catch (err) {
      workbench.innerHTML =
        '<div class="error-boundary"><div class="error-icon">&#9888;</div>' +
        '<div class="error-title">Error</div>' +
        '<div class="error-detail">' +
        t("devices.loadFailed") +
        "</div></div>";
      console.error("[P2] gatewayDetail error:", err);
      return;
    }

    if (!detail || !detail.gateway) {
      workbench.innerHTML =
        '<div class="empty-state"><div class="empty-state-icon">&#9888;</div>' +
        '<div class="empty-state-title">' +
        t("shared.noData") +
        "</div></div>";
      return;
    }

    workbench.innerHTML = self._buildWorkbenchContent();
    self._setupWorkbenchEvents();
  },

  _buildWorkbenchContent: function () {
    var detail = this._currentDetail;
    var gw = detail.gateway;
    var state = detail.state || {};
    var extra = detail.telemetryExtra || {};
    var devices = detail.devices || [];

    var schedule = this._currentSchedule || {};
    var isOnline = gw.status === "online";
    var syncStatus = schedule.syncStatus || "unknown";
    var isPending = syncStatus === "pending";
    var hasSchedule = schedule.batterySchedule != null;
    var isOfflineNoSnapshot = !isOnline && !hasSchedule;

    // Determine control lane editability (DESIGN §6.1 state matrix)
    // online+idle → editable, online+pending → locked, offline+snapshot → readonly, offline+no-snapshot → unavailable
    var controlEditable = isOnline && !isPending;
    var controlReadonly = (!isOnline && hasSchedule) || isPending;
    var controlUnavailable = isOfflineNoSnapshot;

    // Object Hero Bar (SUMMARY LAYER — non-authoritative)
    var objectHero = this._buildObjectHero(gw, state, syncStatus);

    // Scene narrative (SUMMARY LAYER — client-side only)
    var sceneNarrative = this._buildSceneNarrative(state, isOnline);

    // Data Lane (left, 50%): energy flow + live metrics
    var dataLane =
      '<div class="workbench-data-lane">' +
      this._buildEnergyFlow(state) +
      "</div>";

    // Control Lane (right, 50%): mode summary → config params → schedule → confirmation → apply
    var controlLane =
      '<div class="workbench-control-lane"' +
      (controlReadonly ? ' data-control-state="readonly"' : "") +
      (controlUnavailable ? ' data-control-state="unavailable"' : "") +
      (isPending ? ' data-control-state="pending"' : "") +
      ">" +
      this._buildControlStateNotice(isOnline, isPending, hasSchedule) +
      this._buildModeSummary() +
      this._buildBatteryScheduleCard(devices, controlEditable) +
      this._buildConfirmationArea() +
      "</div>";

    // Diagnostics accordion (AUTHORITATIVE data in SUMMARY presentation)
    var diagnostics = this._buildDiagnosticsAccordion(state, extra, devices, gw.emsHealth);

    return objectHero + sceneNarrative +
      '<div class="workbench-content">' + dataLane + controlLane + "</div>" +
      diagnostics;
  },

  // ---- Object Hero Bar (SUMMARY LAYER) ----
  _buildObjectHero: function (gw, state, syncStatus) {
    var homeAlias = gw.homeAlias || gw.name || gw.gatewayId;
    var statusClass = gw.status === "online" ? "positive" : "negative";
    var statusLabel = gw.status === "online" ? t("devices.online") : t("devices.offline");

    var chips = '<span class="vu-chip ' + statusClass + '">' + statusLabel + '</span>';

    if (state.batterySoc != null) {
      chips += '<span class="vu-chip accent">SoC ' + Math.round(state.batterySoc) + '%</span>';
    }

    // Mode chip from pending config
    var cfg = this._pendingConfig;
    if (cfg && cfg.slots && cfg.slots.length > 0) {
      var purposes = {};
      cfg.slots.forEach(function (s) { purposes[s.purpose] = true; });
      var uniquePurposes = Object.keys(purposes);
      var modeLabels = {
        self_consumption: t("devices.selfConsumption"),
        peak_shaving: t("devices.peakShaving"),
        tariff: t("devices.schedule.tariff"),
      };
      var modeDisplay = uniquePurposes.length === 1
        ? modeLabels[uniquePurposes[0]] || uniquePurposes[0]
        : t("devices.wb.modeMixed");
      chips += '<span class="vu-chip neutral">' + modeDisplay + '</span>';
    }

    // Sync chip
    if (syncStatus === "pending") {
      chips += '<span class="vu-chip warning">' + t("devices.wb.syncPending") + '</span>';
    } else if (syncStatus === "failed") {
      chips += '<span class="vu-chip negative">' + t("devices.wb.syncFailed") + '</span>';
    }

    chips += '<span class="vu-chip">' + gw.gatewayId + '</span>';

    return '<div class="vu-object-hero">' +
      '<div class="vu-object-hero-title">' + homeAlias + '</div>' +
      '<div class="vu-object-hero-chips">' + chips + '</div>' +
      '</div>';
  },

  // ---- Scene Narrative (SUMMARY LAYER — client-side derived) ----
  _buildSceneNarrative: function (state, isOnline) {
    if (!isOnline) {
      return '<div class="vu-scene-narrative">' + t("devices.sceneOffline") + '</div>';
    }
    var parts = [];
    if (state.pvPower > 0.01) {
      parts.push(t("devices.sceneSolar") + ' ' + formatNumber(state.pvPower, 1) + ' kW');
    }
    if (state.batteryPower > 0.05) {
      parts.push(t("devices.sceneCharging"));
    } else if (state.batteryPower < -0.05) {
      parts.push(t("devices.sceneDischarging"));
    }
    if (state.gridPowerKw > 0) {
      parts.push(t("devices.sceneImporting") + ' ' + formatNumber(state.gridPowerKw, 1) + ' kW');
    } else if (state.gridPowerKw < 0) {
      parts.push(t("devices.sceneExporting") + ' ' + formatNumber(Math.abs(state.gridPowerKw), 1) + ' kW');
    }
    var text = parts.length > 0 ? parts.join(' · ') : t("devices.sceneIdle");
    return '<div class="vu-scene-narrative">' + text + '</div>';
  },

  // ---- Live Metrics Row (SUMMARY LAYER — derived from existing state) ----
  _buildLiveMetrics: function (state, extra) {
    var metrics = [
      { label: 'SoC', value: state.batterySoc != null ? state.batterySoc + '%' : '--' },
      { label: t("devices.pvPower"), value: state.pvPower != null ? formatNumber(state.pvPower, 1) + ' kW' : '--' },
      { label: t("devices.batteryPower"), value: state.batteryPower != null ? formatNumber(Math.abs(state.batteryPower), 1) + ' kW' : '--' },
      { label: t("devices.homeLoad"), value: state.loadPower != null ? formatNumber(state.loadPower, 1) + ' kW' : '--' },
      { label: t("devices.gridPower"), value: state.gridPowerKw != null ? formatNumber(state.gridPowerKw, 1) + ' kW' : '--' },
    ];
    return '<div class="vu-live-metrics">' +
      metrics.map(function (m) {
        return '<div class="vu-live-metric">' +
          '<span class="vu-live-metric-value">' + m.value + '</span>' +
          '<span class="vu-live-metric-label">' + m.label + '</span>' +
          '</div>';
      }).join('') +
      '</div>';
  },

  // =========================================================
  // DEVICE COMPOSITION (Data Lane, v6.2)
  // =========================================================

  _buildDeviceComposition: function (devices) {
    if (!devices || devices.length === 0) {
      return Components.sectionCard(
        t("shared.devices"),
        '<div class="config-empty">' + t("devices.noDevicesUnderGw") + "</div>",
      );
    }

    var rows = devices
      .map(function (dev) {
        var st = dev.state || {};
        var typeIcons = {
          INVERTER_BATTERY: "\ud83d\udd0b",
          SMART_METER: "\ud83d\udcca",
          AC: "\u2744\ufe0f",
          HVAC: "\u2744\ufe0f",
          EV_CHARGER: "\ud83d\udd0c",
          SOLAR_PANEL: "\u2600\ufe0f",
        };
        var icon = typeIcons[dev.assetType] || "\ud83d\udd0c";
        var statusClass = st.isOnline ? "online" : "offline";

        // Only show SoC for battery devices that actually have SoC data
        var statsHtml = "";
        if (dev.assetType === "INVERTER_BATTERY" && st.batterySoc != null) {
          statsHtml =
            '<span class="dev-stat">SoC ' + st.batterySoc + "%</span>";
        } else if (dev.assetType === "SMART_METER" && st.gridPowerKw != null) {
          statsHtml =
            '<span class="dev-stat">Grid ' +
            formatNumber(st.gridPowerKw, 1) +
            " kW</span>";
        }

        return (
          '<div class="device-comp-row">' +
          '<span class="dev-icon">' +
          icon +
          "</span>" +
          '<div class="dev-comp-info">' +
          '<span class="dev-comp-name">' +
          (dev.name || dev.assetId) +
          "</span>" +
          '<span class="dev-comp-type">' +
          (dev.brand || "") +
          " " +
          (dev.model || "") +
          "</span>" +
          "</div>" +
          '<div class="dev-comp-status">' +
          '<span class="gw-status ' +
          statusClass +
          '"></span>' +
          statsHtml +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    return Components.sectionCard(
      t("shared.devices") + " (" + devices.length + ")",
      '<div class="device-comp-list">' + rows + "</div>",
    );
  },

  // =========================================================
  // CONTROL LANE: STATE NOTICE (v6.2)
  // =========================================================

  _buildControlStateNotice: function (isOnline, isPending, hasSchedule) {
    if (isPending) {
      return (
        '<div class="control-state-notice pending">' +
        '<span class="control-state-icon">&#9203;</span>' +
        '<span class="control-state-text">' +
        t("devices.wb.pendingNotice") +
        "</span></div>"
      );
    }
    if (!isOnline && hasSchedule) {
      return (
        '<div class="control-state-notice readonly">' +
        '<span class="control-state-icon">&#128274;</span>' +
        '<span class="control-state-text">' +
        t("devices.wb.offlineReadonly") +
        "</span></div>"
      );
    }
    if (!isOnline && !hasSchedule) {
      return (
        '<div class="control-state-notice unavailable">' +
        '<span class="control-state-icon">&#9888;</span>' +
        '<span class="control-state-text">' +
        t("devices.wb.offlineNoSnapshot") +
        "</span></div>"
      );
    }
    return "";
  },

  // =========================================================
  // CONTROL LANE: MODE SUMMARY (v6.2, REQ §9.1)
  // =========================================================

  _buildModeSummary: function () {
    var cfg = this._pendingConfig;
    if (!cfg || !cfg.slots || cfg.slots.length === 0) return "";

    // Determine mode: if all slots share the same purpose, show it; otherwise "Mixed"
    var purposes = {};
    cfg.slots.forEach(function (s) {
      purposes[s.purpose] = true;
    });
    var uniquePurposes = Object.keys(purposes);
    var modeLabels = {
      self_consumption: t("devices.selfConsumption"),
      peak_shaving: t("devices.peakShaving"),
      tariff: t("devices.schedule.tariff"),
    };
    var modeDisplay =
      uniquePurposes.length === 1
        ? modeLabels[uniquePurposes[0]] || uniquePurposes[0]
        : t("devices.wb.modeMixed");

    return (
      '<div class="control-mode-summary">' +
      '<span class="control-mode-label">' +
      t("devices.schedMode") +
      '</span><span class="control-mode-value">' +
      modeDisplay +
      "</span></div>"
    );
  },

  // =========================================================
  // CONTROL LANE: CONFIRMATION AREA (v6.2, REQ §10)
  // =========================================================

  _buildConfirmationArea: function () {
    // Container rendered always; populated dynamically when changes exist
    return '<div class="confirmation-area" id="confirmation-area"></div>';
  },

  _updateConfirmationArea: function () {
    var el = document.getElementById("confirmation-area");
    if (!el) return;

    var cfg = this._pendingConfig;
    var schedule = this._currentSchedule;
    if (!cfg || !schedule) {
      el.innerHTML = "";
      return;
    }

    var bs = schedule.batterySchedule;
    var diffs = [];

    // Compare top-level config values
    var fields = [
      { key: "socMinLimit", label: t("devices.schedule.socMin") },
      { key: "socMaxLimit", label: t("devices.schedule.socMax") },
      { key: "maxChargeCurrent", label: t("devices.schedule.maxCharge") },
      {
        key: "maxDischargeCurrent",
        label: t("devices.schedule.maxDischarge"),
      },
      {
        key: "gridImportLimitKw",
        label: t("devices.schedule.gridImportLimit"),
      },
    ];
    fields.forEach(function (f) {
      var original = bs ? bs[f.key] : null;
      var current = cfg[f.key];
      if (original != null && current != null && original !== current) {
        diffs.push(f.label + ": " + original + " → " + current);
      }
    });

    // Compare slot count
    var origSlotCount = bs && bs.slots ? bs.slots.length : 0;
    if (cfg.slots.length !== origSlotCount) {
      diffs.push(
        t("devices.wb.slotCount") +
          ": " +
          origSlotCount +
          " → " +
          cfg.slots.length,
      );
    }

    if (diffs.length === 0) {
      el.innerHTML = "";
      return;
    }

    // Show Home alias + Gateway ID + diffs
    var gw = (this._currentDetail && this._currentDetail.gateway) || {};
    var homeAlias = gw.homeAlias || gw.name || gw.gatewayId || "";
    var gwId = this._currentGatewayId || "";

    el.innerHTML =
      '<div class="confirmation-card">' +
      '<div class="confirmation-header">' +
      t("devices.wb.confirmTitle") +
      "</div>" +
      '<div class="confirmation-target">' +
      homeAlias +
      " &middot; " +
      gwId +
      "</div>" +
      '<div class="confirmation-diffs">' +
      diffs
        .map(function (d) {
          return '<div class="confirmation-diff-row">' + d + "</div>";
        })
        .join("") +
      "</div></div>";
  },

  // =========================================================
  // BATTERY SCHEDULE CARD (v5.21 — merged Config + Schedule)
  // =========================================================

  _buildBatteryScheduleCard: function (devices, editable) {
    var self = this;
    var isEditable = editable !== false;
    var inverters = devices.filter(function (d) {
      return d.assetType === "INVERTER_BATTERY";
    });

    if (inverters.length === 0) {
      return Components.sectionCard(
        t("devices.schedule.title"),
        '<div class="config-empty">' +
          t("devices.noConfigurableDevices") +
          "</div>",
      );
    }

    var cfg = self._pendingConfig || {};
    var schedule = self._currentSchedule || {};
    var disabledAttr = isEditable ? "" : " disabled";

    // Sync status
    var syncBadgeClass =
      schedule.syncStatus === "synced"
        ? "synced"
        : schedule.syncStatus === "pending"
          ? "sync-pending"
          : schedule.syncStatus === "failed"
            ? "sync-failed"
            : "sync-unknown";
    var syncLabel =
      schedule.syncStatus === "synced"
        ? t("devices.wb.synced")
        : schedule.syncStatus === "pending"
          ? t("devices.wb.syncPending")
          : schedule.syncStatus === "failed"
            ? t("devices.wb.syncFailed")
            : t("devices.unknown");
    var lastAck = schedule.lastAckAt
      ? formatISODateTime(schedule.lastAckAt)
      : "--";

    // Check if schedule data is null (no historical snapshot)
    if (!schedule.batterySchedule) {
      var defaultNote =
        '<div class="config-defaults-note">' +
        t("devices.wb.defaultValues") +
        "</div>";
      var defaultCfg =
        (self._currentDetail && self._currentDetail.config) || {};
      var defaultRows = [
        {
          label: t("devices.schedule.socMin"),
          value: defaultCfg.socMin != null ? defaultCfg.socMin + "%" : "--",
        },
        {
          label: t("devices.schedule.socMax"),
          value: defaultCfg.socMax != null ? defaultCfg.socMax + "%" : "--",
        },
      ];
      var defaultHtml = defaultRows
        .map(function (r) {
          return (
            '<div class="config-row"><span class="config-label">' +
            r.label +
            '</span><span class="config-value-ro">' +
            r.value +
            "</span></div>"
          );
        })
        .join("");

      return Components.sectionCard(
        t("devices.schedule.title"),
        defaultNote +
          '<div class="config-params-section">' +
          defaultHtml +
          "</div>" +
          '<div class="schedule-empty">' +
          t("devices.wb.noScheduleData") +
          "</div>",
      );
    }

    // Parameters section
    var configFields = [
      {
        key: "socMinLimit",
        label: t("devices.schedule.socMin"),
        value: cfg.socMinLimit,
        min: 0,
        max: 100,
      },
      {
        key: "socMaxLimit",
        label: t("devices.schedule.socMax"),
        value: cfg.socMaxLimit,
        min: 0,
        max: 100,
      },
      {
        key: "maxChargeCurrent",
        label: t("devices.schedule.maxCharge"),
        value: cfg.maxChargeCurrent,
        min: 0,
      },
      {
        key: "maxDischargeCurrent",
        label: t("devices.schedule.maxDischarge"),
        value: cfg.maxDischargeCurrent,
        min: 0,
      },
      {
        key: "gridImportLimitKw",
        label: t("devices.schedule.gridImportLimit"),
        value: cfg.gridImportLimitKw,
        min: 0,
      },
    ];

    var paramsHtml = configFields
      .map(function (f) {
        var val = f.value != null ? f.value : "";
        var attrs =
          ' type="number" class="config-input" data-cfg-key="' +
          f.key +
          '" step="1" value="' +
          val +
          '"' +
          disabledAttr;
        if (f.min != null) attrs += ' min="' + f.min + '"';
        if (f.max != null) attrs += ' max="' + f.max + '"';
        return (
          '<div class="config-row"><span class="config-label">' +
          f.label +
          '</span><div class="config-field">' +
          "<input" +
          attrs +
          ">" +
          "</div></div>"
        );
      })
      .join("");

    var applyDisabled = !isEditable || schedule.syncStatus === "pending";
    var applyLabel =
      schedule.syncStatus === "pending"
        ? t("devices.wb.waiting")
        : t("devices.applyToGateway");

    var body =
      '<div class="config-params-section">' +
      paramsHtml +
      "</div>" +
      '<div class="schedule-section">' +
      '<div class="schedule-bar" id="schedule-bar-preview"></div>' +
      '<div class="schedule-markers"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>' +
      '<table class="schedule-table">' +
      "<thead><tr><th>" +
      t("devices.schedStart") +
      "</th><th>" +
      t("devices.schedEnd") +
      "</th><th>" +
      t("devices.schedMode") +
      "</th><th>" +
      t("devices.schedule.direction") +
      "</th><th>" +
      t("devices.schedule.exportPolicy") +
      "</th><th></th></tr></thead>" +
      '<tbody id="schedule-rows"></tbody>' +
      "</table>" +
      "" + // v6.2: "Add Slot" removed — use Split on existing slots instead
      "</div>" +
      '<div class="vu-sync-status ' +
      syncBadgeClass +
      '">' +
      '<span class="vu-sync-dot"></span> ' +
      syncLabel +
      '<span class="sync-ack">' +
      t("devices.syncedLastAck") +
      ": " +
      lastAck +
      "</span>" +
      "</div>" +
      '<div class="vu-apply-row">' +
      '<button class="btn btn-primary" id="schedule-apply"' +
      (applyDisabled ? " disabled" : "") +
      ">" +
      applyLabel +
      "</button>" +
      '<div class="schedule-inflight-info' + (schedule.syncStatus === "pending" ? " visible" : "") + '" id="schedule-inflight-info">' +
      t("devices.wb.inflightInfo") +
      "</div>" +
      "</div>";

    return Components.sectionCard(t("devices.schedule.title"), body);
  },

  // v6.2 Phase 3A: Structure-preserving slot row.
  // Start is always read-only (derived from boundary chain).
  // End is an editable boundary select (except last slot, locked at 24:00).
  // "Add" replaced by Split; "Delete" replaced by Merge.
  _buildSlotRow: function (slot, index, totalSlots) {
    var purposeOptions = ["self_consumption", "peak_shaving", "tariff"];
    var purposeLabels = {
      self_consumption: t("devices.selfConsumption"),
      peak_shaving: t("devices.peakShaving"),
      tariff: t("devices.schedule.tariff"),
    };
    var purposeColors = {
      self_consumption: "#22c55e",
      peak_shaving: "#a855f7",
      tariff_charge: "#3b82f6",
      tariff_discharge: "#f97316",
    };

    var slots = this._pendingConfig ? this._pendingConfig.slots : [];
    var isLast = index === totalSlots - 1;

    // Start: always read-only (first slot locked 00:00, others derived from prev boundary)
    var startH = String(Math.floor(slot.startMinute / 60)).padStart(2, "0");
    var startHtml = '<span class="slot-time-fixed">' + startH + ":00</span>";

    // End: constrained boundary select or locked display
    var endHtml = "";
    if (isLast) {
      // Last slot end is locked at 24:00
      endHtml = '<span class="slot-time-fixed">24:00</span>';
    } else {
      // Editable boundary: min = start+60, max = nextSlot.end-60
      var nextSlot = slots[index + 1];
      var minEnd = slot.startMinute + 60;
      var maxEnd = nextSlot ? nextSlot.endMinute - 60 : 1380;
      var endOptions = "";
      for (var m = minEnd; m <= maxEnd; m += 60) {
        var hh = String(Math.floor(m / 60)).padStart(2, "0");
        endOptions +=
          '<option value="' +
          m +
          '"' +
          (slot.endMinute === m ? " selected" : "") +
          ">" +
          hh +
          ":00</option>";
      }
      endHtml =
        '<select class="slot-end config-input">' + endOptions + "</select>";
    }

    // Purpose selector
    var purposeSelect = purposeOptions
      .map(function (p) {
        return (
          '<option value="' +
          p +
          '"' +
          (slot.purpose === p ? " selected" : "") +
          ">" +
          purposeLabels[p] +
          "</option>"
        );
      })
      .join("");

    var colorKey =
      slot.purpose === "tariff"
        ? slot.direction === "discharge"
          ? "tariff_discharge"
          : "tariff_charge"
        : slot.purpose;
    var color = purposeColors[colorKey] || "#6b7280";

    // Direction dropdown (only for tariff)
    var dirHtml = "";
    if (slot.purpose === "tariff") {
      dirHtml =
        '<select class="slot-direction config-input">' +
        '<option value="charge"' +
        (slot.direction === "charge" ? " selected" : "") +
        ">" +
        t("devices.schedule.charge") +
        "</option>" +
        '<option value="discharge"' +
        (slot.direction === "discharge" ? " selected" : "") +
        ">" +
        t("devices.schedule.discharge") +
        "</option>" +
        "</select>";
    } else {
      dirHtml = '<span class="slot-na">--</span>';
    }

    // Export policy dropdown (only for tariff + discharge)
    var exportHtml = "";
    if (slot.purpose === "tariff" && slot.direction === "discharge") {
      exportHtml =
        '<select class="slot-export config-input">' +
        '<option value="allow"' +
        (slot.exportPolicy === "allow" ? " selected" : "") +
        ">" +
        t("devices.schedule.allow") +
        "</option>" +
        '<option value="forbid"' +
        (slot.exportPolicy !== "allow" ? " selected" : "") +
        ">" +
        t("devices.schedule.forbid") +
        "</option>" +
        "</select>";
    } else {
      exportHtml = '<span class="slot-na">--</span>';
    }

    // Split: only if slot duration >= 2h (each half needs >= 1h)
    var canSplit = slot.endMinute - slot.startMinute >= 120;
    var splitHtml = canSplit
      ? '<button class="btn-icon btn-split-slot" title="' +
        t("devices.splitSlot") +
        '"><span class="split-icon" aria-hidden="true">&#x2759;&#x2795;</span></button>'
      : "";

    // Merge: only if more than 1 slot exists
    var canMerge = totalSlots > 1;
    var mergeHtml = canMerge
      ? '<button class="btn-icon btn-merge-slot" title="' +
        t("devices.mergeSlot") +
        '">&times;</button>'
      : "";

    return (
      '<tr data-slot-index="' +
      index +
      '">' +
      "<td>" +
      startHtml +
      "</td>" +
      "<td>" +
      endHtml +
      "</td>" +
      '<td><span class="schedule-mode-badge" data-purpose="' +
      colorKey +
      '">' +
      '<select class="slot-purpose config-input schedule-mode-select">' +
      purposeSelect +
      "</select>" +
      "</span></td>" +
      "<td>" +
      dirHtml +
      "</td>" +
      "<td>" +
      exportHtml +
      "</td>" +
      '<td class="slot-actions">' +
      splitHtml +
      mergeHtml +
      "</td>" +
      "</tr>"
    );
  },

  _renderScheduleRows: function () {
    var self = this;
    var tbody = document.getElementById("schedule-rows");
    if (!tbody || !self._pendingConfig) return;
    var totalSlots = self._pendingConfig.slots.length;
    tbody.innerHTML = self._pendingConfig.slots
      .map(function (slot, i) {
        return self._buildSlotRow(slot, i, totalSlots);
      })
      .join("");
    self._renderTimelinePreview();
  },

  _renderTimelinePreview: function () {
    var bar = document.getElementById("schedule-bar-preview");
    if (!bar || !this._pendingConfig) return;
    var purposeLabels = {
      self_consumption: t("devices.selfConsumption"),
      peak_shaving: t("devices.peakShaving"),
      tariff: t("devices.schedule.tariff"),
    };
    bar.innerHTML = this._pendingConfig.slots
      .map(function (slot) {
        var durationHours = Math.max(
          1,
          Math.round((slot.endMinute - slot.startMinute) / 60),
        );
        var modeKey =
          slot.purpose === "tariff"
            ? slot.direction === "discharge"
              ? "tariff_discharge"
              : "tariff_charge"
            : slot.purpose;
        var startH = String(Math.floor(slot.startMinute / 60)).padStart(2, "0");
        var endH = String(Math.floor(slot.endMinute / 60)).padStart(2, "0");
        var modeLabel = purposeLabels[slot.purpose] || slot.purpose;
        return (
          '<div class="schedule-segment" data-mode="' +
          modeKey +
          '" data-hours="' +
          durationHours +
          '" title="' +
          startH +
          ":00-" +
          endH +
          ":00 " +
          modeLabel +
          '"></div>'
        );
      })
      .join("");
  },

  // v6.2 Phase 3A: Structure-preserving slot listeners.
  // End select edits a shared boundary (this.end = next.start).
  // Split/merge buttons replace add/delete.
  _attachSlotListeners: function () {
    var self = this;
    var tbody = document.getElementById("schedule-rows");
    if (!tbody || !self._pendingConfig) return;

    // Split buttons
    tbody.querySelectorAll(".btn-split-slot").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("tr");
        var idx = parseInt(row.dataset.slotIndex, 10);
        self._splitSlot(idx);
      });
    });

    // Merge buttons
    tbody.querySelectorAll(".btn-merge-slot").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("tr");
        var idx = parseInt(row.dataset.slotIndex, 10);
        self._mergeSlot(idx);
      });
    });

    // Per-row change listeners
    tbody.querySelectorAll("tr").forEach(function (row) {
      var idx = parseInt(row.dataset.slotIndex, 10);
      var endSel = row.querySelector(".slot-end");
      var purposeSel = row.querySelector(".slot-purpose");
      var dirSel = row.querySelector(".slot-direction");
      var exportSel = row.querySelector(".slot-export");

      function updateSlot(updater) {
        self._pendingConfig = Object.assign({}, self._pendingConfig, {
          slots: self._pendingConfig.slots.map(function (s, i) {
            return i === idx ? updater(s) : s;
          }),
        });
      }

      // End select: shared boundary — updates this slot's end AND next slot's start
      if (endSel) {
        endSel.addEventListener("change", function () {
          var newEnd = parseInt(endSel.value, 10);
          self._pendingConfig = Object.assign({}, self._pendingConfig, {
            slots: self._pendingConfig.slots.map(function (s, i) {
              if (i === idx) {
                return Object.assign({}, s, { endMinute: newEnd });
              }
              if (i === idx + 1) {
                return Object.assign({}, s, { startMinute: newEnd });
              }
              return s;
            }),
          });
          self._renderScheduleRows();
          self._attachSlotListeners();
          self._updateConfirmationArea();
        });
      }
      if (purposeSel) {
        purposeSel.addEventListener("change", function () {
          var newPurpose = purposeSel.value;
          updateSlot(function (s) {
            var updated = {
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              purpose: newPurpose,
              direction: null,
              exportPolicy: null,
            };
            if (newPurpose === "tariff") {
              updated.direction = "charge";
            }
            return updated;
          });
          self._renderScheduleRows();
          self._attachSlotListeners();
          self._updateConfirmationArea();
        });
      }
      if (dirSel) {
        dirSel.addEventListener("change", function () {
          updateSlot(function (s) {
            return Object.assign({}, s, {
              direction: dirSel.value,
              exportPolicy: dirSel.value === "discharge" ? "forbid" : null,
            });
          });
          self._renderScheduleRows();
          self._attachSlotListeners();
          self._updateConfirmationArea();
        });
      }
      if (exportSel) {
        exportSel.addEventListener("change", function () {
          updateSlot(function (s) {
            return Object.assign({}, s, { exportPolicy: exportSel.value });
          });
        });
      }
    });
  },

  // v6.2 Phase 3A: Split a slot into two at the midpoint (hour-snapped).
  // Preserves 24h coverage: both halves inherit the original slot's properties.
  _splitSlot: function (index) {
    var self = this;
    if (!self._pendingConfig) return;
    var slots = self._pendingConfig.slots;
    var slot = slots[index];
    if (!slot) return;

    var duration = slot.endMinute - slot.startMinute;
    if (duration < 120) return; // Need at least 2h to split (1h each)

    // Midpoint snapped to hour boundary
    var mid = slot.startMinute + Math.floor(duration / 2 / 60) * 60;
    if (mid <= slot.startMinute) mid = slot.startMinute + 60;
    if (mid >= slot.endMinute) mid = slot.endMinute - 60;

    var first = {
      startMinute: slot.startMinute,
      endMinute: mid,
      purpose: slot.purpose,
      direction: slot.direction,
      exportPolicy: slot.exportPolicy,
    };
    var second = {
      startMinute: mid,
      endMinute: slot.endMinute,
      purpose: slot.purpose,
      direction: slot.direction,
      exportPolicy: slot.exportPolicy,
    };

    var newSlots = slots
      .slice(0, index)
      .concat([first, second])
      .concat(slots.slice(index + 1));
    self._pendingConfig = Object.assign({}, self._pendingConfig, {
      slots: newSlots,
    });
    self._renderScheduleRows();
    self._attachSlotListeners();
    self._updateConfirmationArea();
  },

  // v6.2 Phase 3A: Merge a slot into its neighbor.
  // Prefers merging into previous slot; if first slot, merges into next.
  // Preserves 24h coverage: neighbor expands to cover the removed slot's time range.
  _mergeSlot: function (index) {
    var self = this;
    if (!self._pendingConfig) return;
    var slots = self._pendingConfig.slots;
    if (slots.length <= 1) return; // Must keep at least 1 slot

    var slot = slots[index];
    if (!slot) return;

    var newSlots;
    if (index > 0) {
      // Merge into previous: extend prev's end to cover this slot
      newSlots = slots
        .map(function (s, i) {
          if (i === index - 1) {
            return Object.assign({}, s, { endMinute: slot.endMinute });
          }
          return s;
        })
        .filter(function (_, i) {
          return i !== index;
        });
    } else {
      // Merge into next: extend next's start to cover this slot
      newSlots = slots
        .map(function (s, i) {
          if (i === index + 1) {
            return Object.assign({}, s, { startMinute: slot.startMinute });
          }
          return s;
        })
        .filter(function (_, i) {
          return i !== index;
        });
    }

    self._pendingConfig = Object.assign({}, self._pendingConfig, {
      slots: newSlots,
    });
    self._renderScheduleRows();
    self._attachSlotListeners();
    self._updateConfirmationArea();
  },

  _validateSchedule: function (cfg) {
    // SOC range validation
    var socMin = parseInt(cfg.socMinLimit, 10);
    var socMax = parseInt(cfg.socMaxLimit, 10);
    if (!Number.isInteger(socMin) || socMin < 0 || socMin > 100) {
      return t("devices.val.socRange");
    }
    if (!Number.isInteger(socMax) || socMax < 0 || socMax > 100) {
      return t("devices.val.socRange");
    }
    if (socMin >= socMax) {
      return t("devices.val.socMinLtMax");
    }

    // Current/power limits
    var chargeCurrent = parseInt(cfg.maxChargeCurrent, 10);
    if (!Number.isInteger(chargeCurrent) || chargeCurrent < 0) {
      return t("devices.val.chargeNonNeg");
    }
    var dischargeCurrent = parseInt(cfg.maxDischargeCurrent, 10);
    if (!Number.isInteger(dischargeCurrent) || dischargeCurrent < 0) {
      return t("devices.val.dischargeNonNeg");
    }

    // Hardware rated capacity validation
    if (this._ratedMaxPowerKw != null) {
      if (chargeCurrent > this._ratedMaxPowerKw) {
        return (
          t("devices.val.exceedsCapacity") +
          " (" +
          this._ratedMaxPowerKw +
          " kW)"
        );
      }
      if (dischargeCurrent > this._ratedMaxPowerKw) {
        return (
          t("devices.val.exceedsCapacity") +
          " (" +
          this._ratedMaxPowerKw +
          " kW)"
        );
      }
    }
    var gridLimit = parseInt(cfg.gridImportLimitKw, 10);
    if (!Number.isInteger(gridLimit) || gridLimit < 0) {
      return t("devices.val.gridLimitNonNeg");
    }

    // Slot validation
    if (!cfg.slots || cfg.slots.length === 0) {
      return t("devices.val.cover24h");
    }

    for (var i = 0; i < cfg.slots.length; i++) {
      var slot = cfg.slots[i];
      if (
        !Number.isInteger(slot.startMinute) ||
        slot.startMinute < 0 ||
        slot.startMinute > 1380 ||
        slot.startMinute % 60 !== 0
      ) {
        return t("devices.val.invalidStart") + " " + (i + 1);
      }
      if (
        !Number.isInteger(slot.endMinute) ||
        slot.endMinute < 60 ||
        slot.endMinute > 1440 ||
        slot.endMinute % 60 !== 0
      ) {
        return t("devices.val.invalidEnd") + " " + (i + 1);
      }
      if (slot.endMinute <= slot.startMinute) {
        return t("devices.val.endAfterStart") + " " + (i + 1);
      }
    }

    // Coverage validation: sort by start, check full 24h
    var sorted = cfg.slots.slice().sort(function (a, b) {
      return a.startMinute - b.startMinute;
    });

    if (
      sorted[0].startMinute !== 0 ||
      sorted[sorted.length - 1].endMinute !== 1440
    ) {
      return t("devices.val.cover24h");
    }

    for (var j = 1; j < sorted.length; j++) {
      if (sorted[j].startMinute < sorted[j - 1].endMinute) {
        return t("devices.val.overlap");
      }
      if (sorted[j].startMinute > sorted[j - 1].endMinute) {
        return t("devices.val.gap");
      }
    }

    return null; // valid
  },

  _handleApplySchedule: async function () {
    var self = this;
    var gwId = self._currentGatewayId;
    if (!gwId || !self._pendingConfig) return;

    // Client-side validation (matches BFF validateSchedule rules)
    var validationError = self._validateSchedule(self._pendingConfig);
    if (validationError) {
      self._showToast(validationError, "warning");
      return;
    }

    var applyBtn = document.getElementById("schedule-apply");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = t("devices.wb.submitting");
    }

    try {
      await DataSource.devices.putSchedule(gwId, self._pendingConfig);

      // Keep button disabled — waiting for gateway confirmation via SSE
      if (applyBtn) {
        applyBtn.textContent = t("devices.wb.waiting");
        applyBtn.disabled = true;
      }
      var infoEl = document.getElementById("schedule-inflight-info");
      if (infoEl) { infoEl.classList.add("visible"); }
      self._showToast(t("devices.scheduleSubmitted"), "success");
    } catch (err) {
      console.error("[P2] putSchedule error:", err);
      if (err.status === 409) {
        self._showToast(t("devices.wb.conflictError"), "warning");
      } else {
        self._showToast(t("devices.loadFailed"), "error");
      }
      if (applyBtn) {
        applyBtn.textContent = t("devices.applyToGateway");
        applyBtn.disabled = false;
      }
    }
  },

  // =========================================================
  // GATEWAY HEALTH
  // =========================================================

  _buildGatewayHealth: function (emsHealth) {
    var h = emsHealth || {};

    var indicators = [
      {
        id: "hv-wifiSignalStrength",
        icon: "\ud83d\udce1",
        label: t("devices.health.wifi"),
        value: parseSignalStrength(
          h.wifi_signal_strength || h.wifiSignalStrength || "",
        ),
      },
      {
        id: "hv-cpuTemp",
        icon: "\ud83c\udf21",
        label: t("devices.health.cpuTemp"),
        value: h.cpuTemp || h.CPU_temp || "--",
      },
      {
        id: "hv-cpuUsage",
        icon: "\ud83d\udcbb",
        label: t("devices.health.cpuUsage"),
        value: h.cpuUsage || h.CPU_usage || "--",
      },
      {
        id: "hv-memoryUsage",
        icon: "\ud83d\udcbe",
        label: t("devices.health.memory"),
        value: h.memoryUsage || h.memory_usage || "--",
      },
      {
        id: "hv-diskUsage",
        icon: "\ud83d\udcbf",
        label: t("devices.health.disk"),
        value: h.diskUsage || h.disk_usage || "--",
      },
      {
        id: "hv-systemRuntime",
        icon: "\u23f1",
        label: t("devices.health.uptime"),
        value: parseChineseRuntime(h.system_runtime || h.systemRuntime || ""),
      },
      {
        id: "hv-emsTemp",
        icon: "\ud83c\udf21",
        label: t("devices.health.emsTemp"),
        value: h.emsTemp || h.ems_temp || "--",
      },
      {
        id: "hv-phoneStatus",
        icon: "\ud83d\udcf1",
        label: t("devices.health.phoneStatus"),
        value: h.phoneStatus || h.phone_status || "--",
      },
      {
        id: "hv-phoneSignalStrength",
        icon: "\ud83d\udcf6",
        label: t("devices.health.phoneSignal"),
        value: parseSignalStrength(h.phoneSignalStrength || h.phone_signal_strength || ""),
      },
      {
        id: "hv-humidity",
        icon: "\ud83d\udca7",
        label: t("devices.health.humidity"),
        value: h.humidity || "--",
      },
      {
        id: "hv-systemTime",
        icon: "\ud83d\udd52",
        label: t("devices.health.systemTime"),
        value: h.systemTime || h.system_time || "--",
      },
      {
        id: "hv-hardwareTime",
        icon: "\u23f0",
        label: t("devices.health.hardwareTime"),
        value: h.hardwareTime || h.hardware_time || "--",
      },
      {
        id: "hv-simStatus",
        icon: "\ud83d\udcf6",
        label: t("devices.health.sim"),
        value: parseFirmwareStatus(h.SIM_status || h.simStatus || ""),
      },
    ];

    var body =
      '<div class="ems-health-grid">' +
      indicators
        .map(function (ind) {
          return (
            '<div class="ems-health-item">' +
            '<span class="ems-icon">' +
            ind.icon +
            "</span>" +
            '<span class="ems-value" id="' +
            ind.id +
            '">' +
            ind.value +
            "</span>" +
            '<span class="ems-label">' +
            ind.label +
            "</span>" +
            "</div>"
          );
        })
        .join("") +
      "</div>";

    return Components.sectionCard(t("devices.gatewayHealth"), body);
  },

  // =========================================================
  // DATA LANE BUILDERS (reused from Layer 3, unchanged)
  // =========================================================

  // ---- Energy Flow Diamond ----
  _buildEnergyFlow: function (state) {
    var pvVal =
      state.pvPower != null ? formatNumber(state.pvPower, 1) + " kW" : "\u2014";
    var batVal =
      state.batteryPower != null
        ? formatNumber(Math.abs(state.batteryPower), 1) + " kW"
        : "\u2014";
    var loadVal =
      state.loadPower != null
        ? formatNumber(state.loadPower, 1) + " kW"
        : "\u2014";
    var gridVal =
      state.gridPowerKw != null
        ? formatNumber(Math.abs(state.gridPowerKw), 1) + " kW"
        : "\u2014";

    var batSub =
      "SoC " + (state.batterySoc || 0) + "% \u00b7 " + t("devices.ef.idle");
    if (state.batteryPower > 0.05)
      batSub =
        "SoC " +
        (state.batterySoc || 0) +
        "% \u00b7 " +
        t("devices.ef.charging");
    else if (state.batteryPower < -0.05)
      batSub =
        "SoC " +
        (state.batterySoc || 0) +
        "% \u00b7 " +
        t("devices.ef.discharging");
    else
      batSub =
        "SoC " + (state.batterySoc || 0) + "% \u00b7 " + t("devices.ef.idle");

    var gridClass =
      state.gridPowerKw > 0
        ? "importing"
        : state.gridPowerKw < 0
          ? "exporting"
          : "";
    var gridSub =
      state.gridPowerKw > 0
        ? t("devices.ef.importing")
        : state.gridPowerKw < 0
          ? t("devices.ef.exporting")
          : t("devices.ef.idle");

    var showTop = state.pvPower > 0.01;
    var showLeft = Math.abs(state.batteryPower || 0) > 0.01;
    var showRight = (state.loadPower || 0) > 0.01;
    var showBottom = Math.abs(state.gridPowerKw || 0) > 0.01;

    // Build SVG overlay with directional arrows
    var svgLines = [];

    var markerDefs =
      "<defs>" +
      '<marker id="arrow-pv" markerWidth="4" markerHeight="3" refX="1" refY="1.5" orient="auto">' +
      '<path d="M0,0 L4,1.5 L0,3 Z" class="ef-arrow-positive"/></marker>' +
      '<marker id="arrow-bat" markerWidth="4" markerHeight="3" refX="1" refY="1.5" orient="auto">' +
      '<path d="M0,0 L4,1.5 L0,3 Z" class="ef-arrow-neutral"/></marker>' +
      '<marker id="arrow-load" markerWidth="4" markerHeight="3" refX="1" refY="1.5" orient="auto">' +
      '<path d="M0,0 L4,1.5 L0,3 Z" class="ef-arrow-text"/></marker>' +
      '<marker id="arrow-grid" markerWidth="4" markerHeight="3" refX="1" refY="1.5" orient="auto">' +
      '<path d="M0,0 L4,1.5 L0,3 Z" class="ef-arrow-accent"/></marker>' +
      "</defs>";

    // 4-corner diamond using percentage-based coords for fluid sizing
    // PV always supplies → ef-supply
    // Load always consumes → ef-demand
    // Battery: charging(>0) = demand, discharging(<0) = supply
    // Grid: importing(>0) = supply, exporting(<0) = demand
    var batGroup = (state.batteryPower > 0.05) ? 'ef-demand' : 'ef-supply';
    var gridGroup = (state.gridPowerKw > 0) ? 'ef-supply' : 'ef-demand';

    // PV line: PV→Hub (always supply)
    if (showTop) {
      svgLines.push(
        '<line x1="22" y1="22" x2="42" y2="42" class="ef-line-pv ef-supply" marker-end="url(#arrow-pv)"/>',
      );
    }

    // Battery line: direction depends on charge/discharge
    if (showLeft) {
      if (state.batteryPower > 0.05) {
        // Charging: Hub→Battery (demand)
        svgLines.push(
          '<line x1="42" y1="58" x2="22" y2="78" class="ef-line-bat ' + batGroup + '" marker-end="url(#arrow-bat)"/>',
        );
      } else {
        // Discharging: Battery→Hub (supply)
        svgLines.push(
          '<line x1="22" y1="78" x2="42" y2="58" class="ef-line-bat ' + batGroup + '" marker-end="url(#arrow-bat)"/>',
        );
      }
    }

    // Load line: Hub→Load (always demand)
    if (showRight) {
      svgLines.push(
        '<line x1="58" y1="42" x2="78" y2="22" class="ef-line-load ef-demand" marker-end="url(#arrow-load)"/>',
      );
    }

    // Grid line: direction depends on import/export
    if (showBottom) {
      if (state.gridPowerKw > 0) {
        // Importing: Grid→Hub (supply)
        svgLines.push(
          '<line x1="78" y1="78" x2="58" y2="58" class="ef-line-grid ' + gridGroup + '" marker-end="url(#arrow-grid)"/>',
        );
      } else {
        // Exporting: Hub→Grid (demand)
        svgLines.push(
          '<line x1="58" y1="58" x2="78" y2="78" class="ef-line-grid ' + gridGroup + '" marker-end="url(#arrow-grid)"/>',
        );
      }
    }

    var svgOverlay =
      '<svg class="ef-svg-overlay" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
      markerDefs +
      svgLines.join("") +
      "</svg>";

    var body =
      '<div class="energy-flow-diamond">' +
      svgOverlay +
      '<div class="ef-pv ef-node"><div class="ef-node-icon">\u2600\ufe0f</div><div class="ef-node-value" id="tv-pvPower">' +
      pvVal +
      '</div><div class="ef-node-label">' +
      t("devices.ef.solarPv") +
      "</div></div>" +
      '<div class="ef-battery ef-node"><div class="ef-node-icon">\ud83d\udd0b</div><div class="ef-node-value" id="tv-batteryPower">' +
      batVal +
      '</div><div class="ef-node-sub" id="tv-batterySub">' +
      batSub +
      "</div></div>" +
      '<div class="ef-center"><div class="ef-center-hub"></div></div>' +
      '<div class="ef-load ef-node"><div class="ef-node-icon">\ud83c\udfe0</div><div class="ef-node-value" id="tv-loadPower">' +
      loadVal +
      '</div><div class="ef-node-label">' +
      t("devices.ef.load") +
      "</div></div>" +
      '<div class="ef-grid ef-node ' +
      gridClass +
      '"><div class="ef-node-icon">\u26a1</div><div class="ef-node-value" id="tv-gridPowerKw">' +
      gridVal +
      '</div><div class="ef-node-sub" id="tv-gridSub">' +
      gridSub +
      "</div></div>" +
      "</div>";

    // Stop breathing after 3 cycles (12s), set all lines to full opacity
    setTimeout(function () {
      var lines = document.querySelectorAll('.ef-svg-overlay line');
      lines.forEach(function (l) {
        l.classList.add('ef-lines-static');
      });
    }, 12000);

    return Components.sectionCard(t("devices.ef.title"), body);
  },

  // ---- Battery Status ----
  _buildBatteryStatus: function (state) {
    var rows = [
      {
        id: "tv-batterySoc",
        label: t("devices.soc"),
        value: state.batterySoc != null ? state.batterySoc + "%" : "--",
      },
      {
        id: "tv-batSoh",
        label: t("devices.soh"),
        value: state.batSoh != null ? state.batSoh + "%" : "--",
      },
      {
        id: "tv-batteryVoltage",
        label: t("devices.voltage"),
        value:
          state.batteryVoltage != null
            ? formatNumber(state.batteryVoltage, 1) + " V"
            : "--",
      },
      {
        id: "tv-batteryCurrent",
        label: t("devices.current"),
        value:
          state.batteryCurrent != null
            ? formatNumber(state.batteryCurrent, 1) + " A"
            : "--",
      },
      {
        id: "tv-batteryTemperature",
        label: t("devices.temperature"),
        value:
          state.batteryTemperature != null
            ? state.batteryTemperature + "\u00b0C"
            : "--",
      },
      {
        id: "tv-batteryPowerRate",
        label: t("devices.chargeRate"),
        value:
          state.batteryPower != null
            ? formatNumber(state.batteryPower, 2) + " kW"
            : "--",
      },
      {
        id: "tv-maxChargeCurrent",
        label: t("devices.maxChargeCurrent"),
        value:
          state.maxChargeCurrent != null ? state.maxChargeCurrent + " A" : "--",
      },
      {
        id: "tv-maxDischargeCurrent",
        label: t("devices.maxDischargeCurrent"),
        value:
          state.maxDischargeCurrent != null
            ? state.maxDischargeCurrent + " A"
            : "--",
      },
    ];
    var body = rows
      .map(function (r) {
        return (
          '<div class="tele-row"><span class="tele-label">' +
          r.label +
          '</span><span class="tele-value" id="' +
          r.id +
          '">' +
          r.value +
          "</span></div>"
        );
      })
      .join("");
    return Components.sectionCard(t("devices.batteryStatus"), body);
  },

  // ---- Inverter & Grid ----
  _buildInverterGrid: function (state, extra) {
    var rows = [
      {
        id: "tv-pvPowerDetail",
        label: t("devices.pvPower"),
        value:
          state.pvPower != null ? formatNumber(state.pvPower, 2) + " kW" : "--",
      },
      {
        id: "tv-inverterTemp",
        label: t("devices.inverterTemp"),
        value:
          state.inverterTemp != null ? state.inverterTemp + "\u00b0C" : "--",
      },
      {
        id: "tv-gridPowerDetail",
        label: t("devices.gridPower"),
        value:
          state.gridPowerKw != null
            ? formatNumber(state.gridPowerKw, 2) + " kW"
            : "--",
      },
      {
        id: "tv-gridVoltageR",
        label: t("devices.gridVoltage"),
        value:
          extra.gridVoltageR != null
            ? formatNumber(extra.gridVoltageR, 1) + " V"
            : "--",
      },
      {
        id: "tv-gridCurrentR",
        label: t("devices.gridCurrent"),
        value:
          extra.gridCurrentR != null
            ? formatNumber(extra.gridCurrentR, 1) + " A"
            : "--",
      },
      {
        id: "tv-gridPf",
        label: t("devices.powerFactor"),
        value: extra.gridPf != null ? formatNumber(extra.gridPf, 2) : "--",
      },
      {
        id: "tv-loadPowerDetail",
        label: t("devices.homeLoad"),
        value:
          state.loadPower != null
            ? formatNumber(state.loadPower, 2) + " kW"
            : "--",
      },
      {
        id: "tv-totalBuyKwh",
        label: t("devices.totalBuy"),
        value:
          extra.totalBuyKwh != null
            ? formatNumber(extra.totalBuyKwh, 1) + " kWh"
            : "--",
      },
      {
        id: "tv-totalSellKwh",
        label: t("devices.totalSell"),
        value:
          extra.totalSellKwh != null
            ? formatNumber(extra.totalSellKwh, 1) + " kWh"
            : "--",
      },
    ];
    var body = rows
      .map(function (r) {
        return (
          '<div class="tele-row"><span class="tele-label">' +
          r.label +
          '</span><span class="tele-value" id="' +
          r.id +
          '">' +
          r.value +
          "</span></div>"
        );
      })
      .join("");
    return Components.sectionCard(t("devices.inverterGrid"), body);
  },

  // =========================================================
  // WORKBENCH EVENTS (adapted from Layer 3 events)
  // =========================================================

  _setupWorkbenchEvents: function () {
    var self = this;

    // --- Battery schedule editor events (v5.21 merged card) ---
    self._renderScheduleRows();

    // Config parameter inputs — update _pendingConfig on change
    document
      .querySelectorAll(".config-params-section .config-input")
      .forEach(function (input) {
        input.addEventListener("change", function () {
          var key = input.dataset.cfgKey;
          if (key && self._pendingConfig) {
            self._pendingConfig = Object.assign({}, self._pendingConfig);
            self._pendingConfig[key] = parseInt(input.value, 10) || 0;
            self._updateConfirmationArea();
          }
        });
      });

    // v6.2: "Add Slot" button removed — split/merge handled in _attachSlotListeners

    var scheduleApplyBtn = document.getElementById("schedule-apply");
    if (scheduleApplyBtn) {
      scheduleApplyBtn.addEventListener("click", function () {
        self._handleApplySchedule();
      });
    }

    self._attachSlotListeners();
    self._updateConfirmationArea();
  },

  // =========================================================
  // TOAST
  // =========================================================

  // =========================================================
  // DIAGNOSTICS ACCORDION (v6.x — AUTHORITATIVE data, SUMMARY presentation)
  // All data from current flat rendering preserved; accessible via expand.
  // =========================================================

  _buildDiagnosticsAccordion: function (state, extra, devices, emsHealth) {
    var panels = [];

    // 1. Battery Telemetry
    var batTags = [];
    if (state.batterySoc != null) batTags.push('SoC ' + state.batterySoc + '%');
    if (state.batteryVoltage != null) batTags.push(formatNumber(state.batteryVoltage, 1) + ' V');
    if (state.batteryPower != null) batTags.push(formatNumber(state.batteryPower, 2) + ' kW');
    var batItems = [
      { label: t("devices.soc"), value: state.batterySoc != null ? state.batterySoc + '%' : '--', id: 'tv-batterySoc' },
      { label: t("devices.soh"), value: state.batSoh != null ? state.batSoh + '%' : '--', id: 'tv-batSoh' },
      { label: t("devices.voltage"), value: state.batteryVoltage != null ? formatNumber(state.batteryVoltage, 1) + ' V' : '--', id: 'tv-batteryVoltage' },
      { label: t("devices.current"), value: state.batteryCurrent != null ? formatNumber(state.batteryCurrent, 1) + ' A' : '--', id: 'tv-batteryCurrent' },
      { label: t("devices.temperature"), value: state.batteryTemperature != null ? state.batteryTemperature + '\u00b0C' : '--', id: 'tv-batteryTemperature' },
      { label: t("devices.chargeRate"), value: state.batteryPower != null ? formatNumber(state.batteryPower, 2) + ' kW' : '--', id: 'tv-batteryPowerRate' },
      { label: t("devices.maxChargeCurrent"), value: state.maxChargeCurrent != null ? state.maxChargeCurrent + ' A' : '--', id: 'tv-maxChargeCurrent' },
      { label: t("devices.maxDischargeCurrent"), value: state.maxDischargeCurrent != null ? state.maxDischargeCurrent + ' A' : '--', id: 'tv-maxDischargeCurrent' },
    ];
    panels.push({ icon: '\ud83d\udd0b', title: t("devices.diagBattery"), tags: batTags, items: batItems });

    // 2. Inverter & Grid Detail
    var invTags = [];
    if (state.pvPower != null) invTags.push('PV ' + formatNumber(state.pvPower, 1) + ' kW');
    if (state.gridPowerKw != null) invTags.push('Grid ' + formatNumber(state.gridPowerKw, 1) + ' kW');
    var invItems = [
      { label: t("devices.pvPower"), value: state.pvPower != null ? formatNumber(state.pvPower, 2) + ' kW' : '--', id: 'tv-pvPowerDetail' },
      { label: t("devices.inverterTemp"), value: state.inverterTemp != null ? state.inverterTemp + '\u00b0C' : '--', id: 'tv-inverterTemp' },
      { label: t("devices.gridPower"), value: state.gridPowerKw != null ? formatNumber(state.gridPowerKw, 2) + ' kW' : '--', id: 'tv-gridPowerDetail' },
      { label: t("devices.homeLoad"), value: state.loadPower != null ? formatNumber(state.loadPower, 2) + ' kW' : '--', id: 'tv-loadPowerDetail' },
      { label: t("devices.gridVoltage"), value: extra.gridVoltageR != null ? formatNumber(extra.gridVoltageR, 1) + ' V' : '--', id: 'tv-gridVoltageR' },
      { label: t("devices.gridCurrent"), value: extra.gridCurrentR != null ? formatNumber(extra.gridCurrentR, 1) + ' A' : '--', id: 'tv-gridCurrentR' },
      { label: t("devices.powerFactor"), value: extra.gridPf != null ? formatNumber(extra.gridPf, 2) : '--', id: 'tv-gridPf' },
      { label: t("devices.totalBuy"), value: extra.totalBuyKwh != null ? formatNumber(extra.totalBuyKwh, 1) + ' kWh' : '--', id: 'tv-totalBuyKwh' },
      { label: t("devices.totalSell"), value: extra.totalSellKwh != null ? formatNumber(extra.totalSellKwh, 1) + ' kWh' : '--', id: 'tv-totalSellKwh' },
    ];
    panels.push({ icon: '\u26a1', title: t("devices.diagInverter"), tags: invTags, items: invItems });

    // 3. Gateway Health
    var h = emsHealth || {};
    var healthTags = [];
    if (h.cpuUsage || h.CPU_usage) healthTags.push('CPU ' + (h.cpuUsage || h.CPU_usage));
    if (h.memoryUsage || h.memory_usage) healthTags.push('Mem ' + (h.memoryUsage || h.memory_usage));
    var healthItems = [
      { label: t("devices.health.wifi"), value: parseSignalStrength(h.wifi_signal_strength || h.wifiSignalStrength || ''), id: 'hv-wifiSignalStrength' },
      { label: t("devices.health.cpuTemp"), value: h.cpuTemp || h.CPU_temp || '--', id: 'hv-cpuTemp' },
      { label: t("devices.health.cpuUsage"), value: h.cpuUsage || h.CPU_usage || '--', id: 'hv-cpuUsage' },
      { label: t("devices.health.memory"), value: h.memoryUsage || h.memory_usage || '--', id: 'hv-memoryUsage' },
      { label: t("devices.health.disk"), value: h.diskUsage || h.disk_usage || '--', id: 'hv-diskUsage' },
      { label: t("devices.health.uptime"), value: parseChineseRuntime(h.system_runtime || h.systemRuntime || ''), id: 'hv-systemRuntime' },
      { label: t("devices.health.emsTemp"), value: h.emsTemp || h.ems_temp || '--', id: 'hv-emsTemp' },
      { label: t("devices.health.phoneStatus"), value: h.phoneStatus || h.phone_status || '--', id: 'hv-phoneStatus' },
      { label: t("devices.health.phoneSignal"), value: parseSignalStrength(h.phoneSignalStrength || h.phone_signal_strength || ''), id: 'hv-phoneSignalStrength' },
      { label: t("devices.health.humidity"), value: h.humidity || '--', id: 'hv-humidity' },
      { label: t("devices.health.systemTime"), value: h.systemTime || h.system_time || '--', id: 'hv-systemTime' },
      { label: t("devices.health.hardwareTime"), value: h.hardwareTime || h.hardware_time || '--', id: 'hv-hardwareTime' },
      { label: t("devices.health.sim"), value: parseFirmwareStatus(h.SIM_status || h.simStatus || ''), id: 'hv-simStatus' },
    ];
    panels.push({ icon: '\ud83d\udcf6', title: t("devices.diagHealth"), tags: healthTags, items: healthItems });

    // 3b. Digital I/O (DIDO)
    var dido = extra.dido || null;
    var didoTags = [];
    var didoItems = [];
    if (dido && typeof dido === 'object') {
      var didoKeys = Object.keys(dido);
      var doCount = didoKeys.filter(function (k) { return k.indexOf('DO') === 0; }).length;
      var diCount = didoKeys.filter(function (k) { return k.indexOf('DI') === 0; }).length;
      if (doCount > 0) didoTags.push(doCount + ' DO');
      if (diCount > 0) didoTags.push(diCount + ' DI');
      didoItems = didoKeys.map(function (key) {
        var val = dido[key];
        var displayVal = (val === 1 || val === '1' || val === true) ? 'ON' : 'OFF';
        return { label: key, value: displayVal, id: 'dido-' + key };
      });
    }
    if (didoItems.length === 0) {
      didoItems = [{ label: t("devices.diag.dido.noData"), value: '', id: 'dido-empty' }];
    }
    panels.push({ icon: '\ud83d\udd00', title: t("devices.diag.dido"), tags: didoTags, items: didoItems });

    // 4. Device Composition
    var devTags = [];
    if (devices && devices.length > 0) {
      var onlineCount = devices.filter(function (d) { return d.state && d.state.isOnline; }).length;
      devTags.push(devices.length + ' ' + t("shared.devices"));
      devTags.push(onlineCount + ' ' + t("devices.online"));
    }
    panels.push({ icon: '\ud83d\udd0c', title: t("devices.diagDevices"), tags: devTags, devices: devices });

    // 5. Full Schedule Detail (read-only rendering)
    var schedTags = [];
    var bs = this._currentSchedule ? this._currentSchedule.batterySchedule : null;
    if (bs && bs.slots) schedTags.push(bs.slots.length + ' slots');
    panels.push({ icon: '\ud83d\udcc5', title: t("devices.diagSchedule"), tags: schedTags, scheduleData: bs });

    // Render accordion
    var html = '<div class="vu-diagnostics">' +
      '<div class="vu-diagnostics-header">' +
        '<span class="vu-diagnostics-title">' + t("devices.diagTitle") + '</span>' +
        '<span class="vu-diagnostics-count">' + panels.length + ' ' + t("devices.diagSections") + '</span>' +
      '</div>';

    panels.forEach(function (panel, idx) {
      var tagsHtml = (panel.tags || []).map(function (tag) {
        return '<span class="vu-diag-tag">' + tag + '</span>';
      }).join('');

      var bodyHtml = '';
      if (panel.items) {
        bodyHtml = '<div class="vu-diag-grid">' +
          panel.items.map(function (item) {
            return '<div class="vu-diag-item">' +
              '<span class="vu-diag-item-label">' + item.label + '</span>' +
              '<span class="vu-diag-item-value" id="' + item.id + '">' + item.value + '</span>' +
              '</div>';
          }).join('') +
          '</div>';
      } else if (panel.devices) {
        if (!panel.devices || panel.devices.length === 0) {
          bodyHtml = '<div class="vu-priority-empty">' + t("devices.noDevicesUnderGw") + '</div>';
        } else {
          var typeIcons = {
            INVERTER_BATTERY: '\ud83d\udd0b', SMART_METER: '\ud83d\udcca',
            AC: '\u2744\ufe0f', HVAC: '\u2744\ufe0f', EV_CHARGER: '\ud83d\udd0c', SOLAR_PANEL: '\u2600\ufe0f',
          };
          bodyHtml = '<div class="device-comp-list">' +
            panel.devices.map(function (dev) {
              var st = dev.state || {};
              var icon = typeIcons[dev.assetType] || '\ud83d\udd0c';
              var statusClass = st.isOnline ? 'online' : 'offline';
              var statsHtml = '';
              if (dev.assetType === 'INVERTER_BATTERY' && st.batterySoc != null) {
                statsHtml = '<span class="dev-stat">SoC ' + st.batterySoc + '%</span>';
              } else if (dev.assetType === 'SMART_METER' && st.gridPowerKw != null) {
                statsHtml = '<span class="dev-stat">Grid ' + formatNumber(st.gridPowerKw, 1) + ' kW</span>';
              }
              return '<div class="device-comp-row">' +
                '<span class="dev-icon">' + icon + '</span>' +
                '<div class="dev-comp-info"><span class="dev-comp-name">' + (dev.name || dev.assetId) + '</span>' +
                '<span class="dev-comp-type">' + (dev.brand || '') + ' ' + (dev.model || '') + '</span></div>' +
                '<div class="dev-comp-status"><span class="gw-status ' + statusClass + '"></span>' + statsHtml + '</div>' +
                '</div>';
            }).join('') +
            '</div>';
        }
      } else if (panel.scheduleData) {
        var sched = panel.scheduleData;
        var schedItems = [
          { label: t("devices.schedule.socMin"), value: sched.socMinLimit != null ? sched.socMinLimit + '%' : '--' },
          { label: t("devices.schedule.socMax"), value: sched.socMaxLimit != null ? sched.socMaxLimit + '%' : '--' },
          { label: t("devices.schedule.maxCharge"), value: sched.maxChargeCurrent != null ? sched.maxChargeCurrent + ' A' : '--' },
          { label: t("devices.schedule.maxDischarge"), value: sched.maxDischargeCurrent != null ? sched.maxDischargeCurrent + ' A' : '--' },
          { label: t("devices.schedule.gridImportLimit"), value: sched.gridImportLimitKw != null ? sched.gridImportLimitKw + ' W' : '--' },
        ];
        bodyHtml = '<div class="vu-diag-grid">' +
          schedItems.map(function (si) {
            return '<div class="vu-diag-item"><span class="vu-diag-item-label">' + si.label + '</span><span class="vu-diag-item-value">' + si.value + '</span></div>';
          }).join('') +
          '</div>';
        if (sched.slots && sched.slots.length > 0) {
          var purposeLabels = {
            self_consumption: t("devices.selfConsumption"),
            peak_shaving: t("devices.peakShaving"),
            tariff: t("devices.schedule.tariff"),
          };
          bodyHtml += '<table class="data-table vu-diag-detail-table"><thead><tr>' +
            '<th>' + t("devices.schedStart") + '</th><th>' + t("devices.schedEnd") + '</th><th>' + t("devices.schedMode") + '</th>' +
            '<th>' + t("devices.schedule.direction") + '</th><th>' + t("devices.schedule.exportPolicy") + '</th></tr></thead><tbody>' +
            sched.slots.map(function (slot) {
              var sH = String(Math.floor(slot.startMinute / 60)).padStart(2, '0');
              var eH = String(Math.floor(slot.endMinute / 60)).padStart(2, '0');
              return '<tr><td>' + sH + ':00</td><td>' + eH + ':00</td><td>' + (purposeLabels[slot.purpose] || slot.purpose) + '</td>' +
                '<td>' + (slot.direction || '--') + '</td><td>' + (slot.exportPolicy || '--') + '</td></tr>';
            }).join('') +
            '</tbody></table>';
        }
      } else {
        bodyHtml = '<div class="vu-priority-empty">--</div>';
      }

      html += '<div class="vu-diag-panel" data-diag-index="' + idx + '">' +
        '<button class="vu-diag-panel-header" type="button" data-action="toggle-diag-panel">' +
          '<span class="vu-diag-chevron">\u25b6</span>' +
          '<span class="vu-diag-panel-icon">' + panel.icon + '</span>' +
          '<span class="vu-diag-panel-title">' + panel.title + '</span>' +
          '<div class="vu-diag-tags">' + tagsHtml + '</div>' +
        '</button>' +
        '<div class="vu-diag-panel-body">' + bodyHtml + '</div>' +
        '</div>';
    });

    html += '</div>';
    return html;
  },

  _toggleDiagPanel: function (headerEl) {
    if (!headerEl) return;
    var panel = headerEl.closest('.vu-diag-panel');
    if (panel) {
      panel.classList.toggle('expanded');
    }
  },

  _setupDiagnosticsAccordionEvents: function () {
    var self = this;
    var workbench = document.getElementById("devices-workbench");
    if (!workbench || workbench.dataset.diagHandlersBound === "1") return;

    workbench.addEventListener("click", function (event) {
      var headerEl = event.target.closest('[data-action="toggle-diag-panel"]');
      if (!headerEl || !workbench.contains(headerEl)) return;
      self._toggleDiagPanel(headerEl);
    });

    workbench.dataset.diagHandlersBound = "1";
  },

  _showToast: function (message, type) {
    type = type || "info";
    var toast = document.createElement("div");
    toast.className = "p4-toast p4-toast-" + type;
    var icons = {
      success: "\u2705",
      warning: "\u26a0\ufe0f",
      info: "\u2139\ufe0f",
      error: "\u274c",
    };
    toast.innerHTML =
      '<span class="p4-toast-icon">' +
      (icons[type] || "") +
      '</span><span class="p4-toast-msg">' +
      message +
      "</span>";
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add("p4-toast-show");
    });
    setTimeout(function () {
      toast.classList.remove("p4-toast-show");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3000);
  },
};
