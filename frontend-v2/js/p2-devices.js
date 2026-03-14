/* ============================================
   SOLFACIL Admin Portal — P2: Device Management (v5.19)
   Gateway-first architecture:
   Layer 1 — Gateway card list with expandable device rows
   Layer 3 — Device detail (energy flow + telemetry + config + schedule)
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
  _expandedGw: null,
  _currentDetail: null,
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

    container.innerHTML = self._buildLayer1();
    self._setupLayer1Events();

    // Restore Layer 3 if it was open before language switch
    if (self._currentGatewayId) {
      setTimeout(function () {
        self._openLayer3GW(self._currentGatewayId);
      }, 100);
    }

    // v5.21: Connect SSE for real-time push
    self._connectSSE();
  },

  onRoleChange: function () {
    this._expandedGw = null;
    this._currentDetail = null;
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
        if (infoEl) infoEl.style.display = "none";
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
      '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="skeleton" style="height:90px;border-radius:10px"></div>' +
      '<div class="skeleton" style="height:90px;border-radius:10px"></div>' +
      '<div class="skeleton" style="height:90px;border-radius:10px"></div>' +
      '<div class="skeleton" style="height:90px;border-radius:10px"></div>' +
      "</div>"
    );
  },

  // =========================================================
  // LAYER 1: Gateway List
  // =========================================================

  _buildLayer1: function () {
    var gateways = this._gateways || [];
    var totalDevices = gateways.reduce(function (sum, g) {
      return sum + (g.deviceCount || 0);
    }, 0);

    var header =
      '<div class="p2-header">' +
      "<h2>" +
      t("page.devices") +
      "</h2>" +
      '<div class="p2-summary">' +
      gateways.length +
      " " +
      t("fleet.gateways") +
      " \u00b7 " +
      totalDevices +
      " " +
      t("shared.devices") +
      "</div>" +
      "</div>";

    var cards = gateways
      .map(function (gw) {
        return DevicesPage._buildGwCard(gw);
      })
      .join("");

    return (
      '<div id="layer1">' +
      header +
      '<div class="gw-list">' +
      cards +
      "</div></div>" +
      '<div id="layer3" style="display:none"></div>'
    );
  },

  _buildGwCard: function (gw) {
    var statusClass = gw.status === "online" ? "online" : "offline";
    var isExpanded = this._expandedGw === gw.gatewayId;
    var health = gw.emsHealth || {};
    var rssi = parseSignalStrength(
      health.wifi_signal_strength || health.wifiSignalStrength || "",
    );
    var cpuTemp = health.CPU_temp || health.cpuTemp || "--";
    var memUsage = health.memory_usage || health.memoryUsage || "--";
    var uptime = parseChineseRuntime(
      health.system_runtime || health.systemRuntime || "",
    );
    var lastSeen = gw.lastSeenAt ? formatISODateTime(gw.lastSeenAt) : "--";

    return (
      '<div class="gw-card" data-gw-id="' +
      gw.gatewayId +
      '">' +
      '<div class="gw-header">' +
      '<div class="gw-status ' +
      statusClass +
      '"></div>' +
      '<div class="gw-name-block">' +
      '<a href="#" class="gw-detail-link" data-gw-id="' +
      gw.gatewayId +
      '">' +
      '<div class="gw-name-primary">' +
      gw.name +
      " &#8250;</div>" +
      "</a>" +
      '<div class="gw-sn">' +
      gw.gatewayId +
      "</div>" +
      "</div>" +
      '<div class="gw-meta">' +
      "<span>" +
      (gw.deviceCount || 0) +
      " " +
      t("shared.devices") +
      "</span>" +
      "<span>" +
      t("devices.wifi") +
      " " +
      rssi +
      "</span>" +
      "<span>CPU " +
      cpuTemp +
      "</span>" +
      "<span>MEM " +
      memUsage +
      "</span>" +
      "<span>" +
      t("devices.uptime") +
      " " +
      uptime +
      "</span>" +
      "<span>" +
      t("devices.lastSeen") +
      " " +
      lastSeen +
      "</span>" +
      "</div>" +
      '<div class="gw-chevron' +
      (isExpanded ? " expanded" : "") +
      '">\u25B6</div>' +
      "</div>" +
      '<div class="device-list" id="gw-devices-' +
      gw.gatewayId +
      '" style="display:' +
      (isExpanded ? "block" : "none") +
      '">' +
      (isExpanded ? "" : "") +
      "</div>" +
      "</div>"
    );
  },

  _setupLayer1Events: function () {
    var self = this;

    // Chevron click → expand/collapse device list
    document.querySelectorAll(".gw-chevron").forEach(function (chevron) {
      chevron.addEventListener("click", function (e) {
        e.stopPropagation();
        var card = chevron.closest(".gw-card");
        var gwId = card.dataset.gwId;
        self._toggleGateway(gwId);
      });
    });

    // Gateway name click → open Layer 3 (Gateway-level)
    document.querySelectorAll(".gw-detail-link").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var gwId = link.dataset.gwId;
        self._openLayer3GW(gwId);
      });
    });
  },

  _toggleGateway: async function (gwId) {
    var self = this;
    var deviceList = document.getElementById("gw-devices-" + gwId);
    var chevron = document.querySelector(
      '.gw-card[data-gw-id="' + gwId + '"] .gw-chevron',
    );

    if (self._expandedGw === gwId) {
      // Collapse
      self._expandedGw = null;
      if (deviceList) deviceList.style.display = "none";
      if (chevron) chevron.classList.remove("expanded");
      return;
    }

    // Collapse previous
    if (self._expandedGw) {
      var prev = document.getElementById("gw-devices-" + self._expandedGw);
      var prevChev = document.querySelector(
        '.gw-card[data-gw-id="' + self._expandedGw + '"] .gw-chevron',
      );
      if (prev) prev.style.display = "none";
      if (prevChev) prevChev.classList.remove("expanded");
    }

    self._expandedGw = gwId;
    if (chevron) chevron.classList.add("expanded");
    if (deviceList) {
      deviceList.style.display = "block";
      deviceList.innerHTML =
        '<div class="device-loading">' + t("devices.loadingDevices") + "</div>";
    }

    try {
      var result = await DataSource.devices.gatewayDevices(gwId);
      var devices = result.devices || [];
      if (deviceList) {
        if (devices.length === 0) {
          deviceList.innerHTML =
            '<div class="device-empty">' +
            t("devices.noDevicesUnderGw") +
            "</div>";
        } else {
          deviceList.innerHTML = devices
            .map(function (dev) {
              return self._buildDeviceRow(dev, gwId);
            })
            .join("");
          self._attachDeviceRowListeners(deviceList);
        }
      }
    } catch (err) {
      if (deviceList) {
        deviceList.innerHTML =
          '<div class="device-error">' + t("devices.loadFailed") + "</div>";
      }
      console.error("[P2] gatewayDevices error:", err);
    }
  },

  _buildDeviceRow: function (dev, gatewayId) {
    var st = dev.state || {};

    var typeIcons = {
      "Inverter + Battery": "\ud83d\udd0b",
      INVERTER_BATTERY: "\ud83d\udd0b",
      "Smart Meter": "\ud83d\udcca",
      SMART_METER: "\ud83d\udcca",
      AC: "\u2744\ufe0f",
      HVAC: "\u2744\ufe0f",
      "EV Charger": "\ud83d\udd0c",
      EV_CHARGER: "\ud83d\udd0c",
      SOLAR_PANEL: "\u2600\ufe0f",
    };
    var icon = typeIcons[dev.assetType] || "\ud83d\udd0c";

    var statsHtml = "";
    if (dev.assetType === "INVERTER_BATTERY") {
      var socText = st.batterySoc != null ? st.batterySoc + "%" : "--";
      var bp = st.batteryPower != null ? st.batteryPower : 0;
      var batStatus =
        bp > 0.05
          ? t("devices.ef.charging")
          : bp < -0.05
            ? t("devices.ef.discharging")
            : t("devices.ef.idle");
      var batPowerText = Math.abs(bp).toFixed(1) + " kW";
      var pvText =
        st.pvPower != null ? formatNumber(st.pvPower, 1) + " kW" : "--";
      statsHtml =
        '<span class="dev-stat">SoC ' +
        socText +
        "</span>" +
        '<span class="dev-stat">' +
        batStatus +
        "</span>" +
        '<span class="dev-stat">Bat ' +
        batPowerText +
        "</span>" +
        '<span class="dev-stat">PV ' +
        pvText +
        "</span>";
    } else if (dev.assetType === "SMART_METER") {
      var gridText =
        st.gridPowerKw != null ? formatNumber(st.gridPowerKw, 1) + " kW" : "--";
      statsHtml = '<span class="dev-stat">Grid ' + gridText + "</span>";
    }

    return (
      '<div class="device-row" data-asset-id="' +
      dev.assetId +
      '">' +
      '<div class="dev-icon">' +
      icon +
      "</div>" +
      '<div class="dev-id-block">' +
      '<div class="dev-id">' +
      (dev.name || dev.assetId) +
      "</div>" +
      '<div class="dev-type">' +
      (dev.brand || "") +
      " " +
      (dev.model || "") +
      "</div>" +
      "</div>" +
      '<div class="dev-stats">' +
      statsHtml +
      "</div>" +
      (dev.assetType === "INVERTER_BATTERY"
        ? '<a class="p2-asset-energy-link" data-gw="' +
          (gatewayId || "") +
          '" href="#energy?gw=' +
          encodeURIComponent(gatewayId || "") +
          '&tab=energy">' +
          t("p3ae.viewEnergy") +
          " \u2192</a>" +
          '<a class="p2-asset-health-link" data-gw="' +
          (gatewayId || "") +
          '" href="#energy?gw=' +
          encodeURIComponent(gatewayId || "") +
          '&tab=health">' +
          t("p3ah.viewHealth") +
          " \u2192</a>"
        : "") +
      "</div>"
    );
  },

  _attachDeviceRowListeners: function (container) {
    // Energy link click handlers for INVERTER_BATTERY devices
    container
      .querySelectorAll(".p2-asset-energy-link")
      .forEach(function (link) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var gwId = link.dataset.gw;
          if (gwId) {
            // Force re-init of energy page with this gateway
            delete pageInitialized["energy"];
            window.location.hash =
              "#energy?gw=" + encodeURIComponent(gwId) + "&tab=energy";
          }
        });
      });

    // Health link click handlers for INVERTER_BATTERY devices
    container
      .querySelectorAll(".p2-asset-health-link")
      .forEach(function (link) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var gwId = link.dataset.gw;
          if (gwId) {
            delete pageInitialized["energy"];
            window.location.hash =
              "#energy?gw=" + encodeURIComponent(gwId) + "&tab=health";
          }
        });
      });
  },

  // =========================================================
  // LAYER 3: Device Detail
  // =========================================================

  _openLayer3: async function (assetId) {
    var self = this;
    var layer1 = document.getElementById("layer1");
    var layer3 = document.getElementById("layer3");
    if (!layer1 || !layer3) return;

    layer1.style.display = "none";
    layer3.style.display = "block";
    layer3.innerHTML =
      '<div class="detail-loading"><div class="skeleton" style="height:400px;border-radius:10px"></div></div>';

    try {
      var results = await Promise.all([
        DataSource.devices.deviceDetail(assetId),
        DataSource.devices.getSchedule(assetId),
      ]);
      self._currentDetail = results[0];
      self._currentSchedule = results[1];
    } catch (err) {
      layer3.innerHTML =
        '<div class="error-boundary"><div class="error-icon">&#9888;</div><div class="error-title">Error</div><div class="error-detail">' +
        t("devices.loadFailed") +
        '</div><button class="btn btn-secondary" onclick="DevicesPage._closeLayer3()">' +
        t("shared.back") +
        "</button></div>";
      console.error("[P2] deviceDetail error:", err);
      return;
    }

    if (!self._currentDetail || !self._currentDetail.device) {
      layer3.innerHTML =
        '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><div class="empty-state-title">' +
        t("shared.noData") +
        '</div><div class="empty-state-detail">' +
        t("devices.deviceNotFound") +
        '</div><button class="btn btn-secondary" onclick="DevicesPage._closeLayer3()">' +
        t("shared.back") +
        "</button></div>";
      return;
    }

    layer3.innerHTML = self._buildLayer3();
    self._setupLayer3Events();
  },

  _closeLayer3: function () {
    var layer1 = document.getElementById("layer1");
    var layer3 = document.getElementById("layer3");
    if (layer1) layer1.style.display = "block";
    if (layer3) layer3.style.display = "none";
    this._currentDetail = null;
    this._currentSchedule = null;
    this._pendingConfig = null;
    this._currentGatewayId = null;
  },

  // =========================================================
  // LAYER 3: Gateway-Level Detail (Fix #3)
  // =========================================================

  _pendingConfig: null,
  _currentGatewayId: null,
  _ratedMaxPowerKw: null,

  _openLayer3GW: async function (gatewayId) {
    var self = this;
    var layer1 = document.getElementById("layer1");
    var layer3 = document.getElementById("layer3");
    if (!layer1 || !layer3) return;

    self._currentGatewayId = gatewayId;
    layer1.style.display = "none";
    layer3.style.display = "block";
    layer3.innerHTML =
      '<div class="detail-loading"><div class="skeleton" style="height:400px;border-radius:10px"></div></div>';

    try {
      var detail = await DataSource.devices.gatewayDetail(gatewayId);
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
      layer3.innerHTML =
        '<div class="error-boundary"><div class="error-icon">&#9888;</div>' +
        '<div class="error-title">Error</div>' +
        '<div class="error-detail">' +
        t("devices.loadFailed") +
        "</div>" +
        '<button class="btn btn-secondary" onclick="DevicesPage._closeLayer3()">' +
        t("shared.back") +
        "</button></div>";
      console.error("[P2] gatewayDetail error:", err);
      return;
    }

    if (!detail || !detail.gateway) {
      layer3.innerHTML =
        '<div class="empty-state"><div class="empty-state-icon">&#9888;</div>' +
        '<div class="empty-state-title">' +
        t("shared.noData") +
        "</div>" +
        '<button class="btn btn-secondary" onclick="DevicesPage._closeLayer3()">' +
        t("shared.back") +
        "</button></div>";
      return;
    }

    layer3.innerHTML = self._buildLayer3GW();
    self._setupLayer3Events();
  },

  _buildLayer3GW: function () {
    var detail = this._currentDetail;
    var gw = detail.gateway;
    var state = detail.state || {};
    var extra = detail.telemetryExtra || {};
    var config = detail.config || {};
    var devices = detail.devices || [];
    var schedule = this._currentSchedule || {
      syncStatus: "unknown",
      slots: [],
    };

    var statusTag =
      gw.status === "online"
        ? '<span class="tag-online">' + t("devices.online") + "</span>"
        : '<span class="tag-offline">' + t("devices.offline") + "</span>";

    var devSummary = devices
      .map(function (d) {
        var icon = {
          INVERTER_BATTERY: "\ud83d\udd0b",
          SMART_METER: "\ud83d\udcca",
        };
        return (
          (icon[d.assetType] || "\ud83d\udd0c") + " " + (d.name || d.assetId)
        );
      })
      .join(" \u00b7 ");

    return (
      '<div class="detail-header">' +
      '<div class="breadcrumb">' +
      '<a href="#" class="bc-link" id="bc-back">' +
      t("nav.devices") +
      "</a>" +
      " \u203a <span>" +
      gw.name +
      "</span>" +
      "</div>" +
      "<h2>" +
      gw.name +
      " " +
      statusTag +
      "</h2>" +
      '<div class="detail-subtitle">' +
      gw.gatewayId +
      " \u00b7 " +
      devSummary +
      "</div>" +
      "</div>" +
      '<div class="detail-page">' +
      '<div class="left-col">' +
      this._buildEnergyFlow(state) +
      this._buildBatteryStatus(state) +
      this._buildInverterGrid(state, extra) +
      "</div>" +
      '<div class="right-col">' +
      this._buildBatteryScheduleCard(devices) +
      this._buildGatewayHealth(gw.emsHealth) +
      "</div>" +
      "</div>"
    );
  },

  // =========================================================
  // BATTERY SCHEDULE CARD (v5.21 — merged Config + Schedule)
  // =========================================================

  _buildBatteryScheduleCard: function (devices) {
    var self = this;
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
        ? "Synced"
        : schedule.syncStatus === "pending"
          ? "Pending"
          : schedule.syncStatus === "failed"
            ? "Failed"
            : t("devices.unknown");
    var lastAck = schedule.lastAckAt
      ? formatISODateTime(schedule.lastAckAt)
      : "--";

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
          '"';
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
      '<button class="btn btn-outline btn-sm" id="schedule-add-slot">' +
      t("devices.addSlot") +
      "</button>" +
      "</div>" +
      '<div class="sync-status ' +
      syncBadgeClass +
      '">' +
      '<span class="sync-dot"></span> ' +
      syncLabel +
      '<span class="sync-ack">' +
      t("devices.syncedLastAck") +
      ": " +
      lastAck +
      "</span>" +
      "</div>" +
      '<div class="schedule-apply-row">' +
      '<button class="btn btn-primary" id="schedule-apply"' +
      (schedule.syncStatus === "pending" ? " disabled" : "") +
      ">" +
      (schedule.syncStatus === "pending"
        ? "Aguardando..."
        : t("devices.applyToGateway")) +
      "</button>" +
      '<div class="schedule-inflight-info" id="schedule-inflight-info"' +
      (schedule.syncStatus === "pending" ? "" : ' style="display:none"') +
      ">Configura\u00e7\u00e3o em andamento...</div>" +
      "</div>";

    return Components.sectionCard(t("devices.schedule.title"), body);
  },

  _buildSlotRow: function (slot, index) {
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

    // Start time: 00:00 to 23:00 (0..1380 step 60)
    var startOptions = "";
    for (var m = 0; m <= 1380; m += 60) {
      var hh = String(Math.floor(m / 60)).padStart(2, "0");
      startOptions +=
        '<option value="' +
        m +
        '"' +
        (slot.startMinute === m ? " selected" : "") +
        ">" +
        hh +
        ":00</option>";
    }

    // End time: 01:00 to 24:00 (60..1440 step 60)
    var endOptions = "";
    for (var m2 = 60; m2 <= 1440; m2 += 60) {
      var hh2 = String(Math.floor(m2 / 60)).padStart(2, "0");
      endOptions +=
        '<option value="' +
        m2 +
        '"' +
        (slot.endMinute === m2 ? " selected" : "") +
        ">" +
        hh2 +
        ":00</option>";
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

    return (
      '<tr data-slot-index="' +
      index +
      '">' +
      '<td><select class="slot-start config-input">' +
      startOptions +
      "</select></td>" +
      '<td><select class="slot-end config-input">' +
      endOptions +
      "</select></td>" +
      '<td><span class="schedule-mode-badge" style="background:' +
      color +
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
      '<td><button class="btn-icon btn-delete-slot" title="' +
      t("devices.deleteSlot") +
      '">\ud83d\uddd1</button></td>' +
      "</tr>"
    );
  },

  _renderScheduleRows: function () {
    var self = this;
    var tbody = document.getElementById("schedule-rows");
    if (!tbody || !self._pendingConfig) return;
    tbody.innerHTML = self._pendingConfig.slots
      .map(function (slot, i) {
        return self._buildSlotRow(slot, i);
      })
      .join("");
    self._renderTimelinePreview();
  },

  _renderTimelinePreview: function () {
    var bar = document.getElementById("schedule-bar-preview");
    if (!bar || !this._pendingConfig) return;
    var purposeColors = {
      self_consumption: "#22c55e",
      peak_shaving: "#a855f7",
      tariff_charge: "#3b82f6",
      tariff_discharge: "#f97316",
    };
    bar.innerHTML = this._pendingConfig.slots
      .map(function (slot) {
        var widthPct = (
          ((slot.endMinute - slot.startMinute) / 1440) *
          100
        ).toFixed(2);
        var colorKey =
          slot.purpose === "tariff"
            ? slot.direction === "discharge"
              ? "tariff_discharge"
              : "tariff_charge"
            : slot.purpose;
        var color = purposeColors[colorKey] || "#6b7280";
        var startH = String(Math.floor(slot.startMinute / 60)).padStart(2, "0");
        var endH = String(Math.floor(slot.endMinute / 60)).padStart(2, "0");
        return (
          '<div class="schedule-segment" style="width:' +
          widthPct +
          "%;background:" +
          color +
          '" title="' +
          startH +
          ":00-" +
          endH +
          ":00 " +
          slot.purpose +
          '"></div>'
        );
      })
      .join("");
  },

  _attachSlotListeners: function () {
    var self = this;
    var tbody = document.getElementById("schedule-rows");
    if (!tbody || !self._pendingConfig) return;

    // Delete buttons
    tbody.querySelectorAll(".btn-delete-slot").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("tr");
        var idx = parseInt(row.dataset.slotIndex, 10);
        self._pendingConfig = Object.assign({}, self._pendingConfig, {
          slots: self._pendingConfig.slots.filter(function (_, i) {
            return i !== idx;
          }),
        });
        self._renderScheduleRows();
        self._attachSlotListeners();
      });
    });

    // Per-row change listeners
    tbody.querySelectorAll("tr").forEach(function (row) {
      var idx = parseInt(row.dataset.slotIndex, 10);
      var startSel = row.querySelector(".slot-start");
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

      if (startSel) {
        startSel.addEventListener("change", function () {
          updateSlot(function (s) {
            return Object.assign({}, s, {
              startMinute: parseInt(startSel.value, 10),
            });
          });
          self._renderTimelinePreview();
        });
      }
      if (endSel) {
        endSel.addEventListener("change", function () {
          updateSlot(function (s) {
            return Object.assign({}, s, {
              endMinute: parseInt(endSel.value, 10),
            });
          });
          self._renderTimelinePreview();
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

  _validateSchedule: function (cfg) {
    // SOC range validation
    var socMin = parseInt(cfg.socMinLimit, 10);
    var socMax = parseInt(cfg.socMaxLimit, 10);
    if (!Number.isInteger(socMin) || socMin < 0 || socMin > 100) {
      return "SOC Min deve ser entre 0 e 100";
    }
    if (!Number.isInteger(socMax) || socMax < 0 || socMax > 100) {
      return "SOC Max deve ser entre 0 e 100";
    }
    if (socMin >= socMax) {
      return "SOC Min deve ser menor que SOC Max";
    }

    // Current/power limits
    var chargeCurrent = parseInt(cfg.maxChargeCurrent, 10);
    if (!Number.isInteger(chargeCurrent) || chargeCurrent < 0) {
      return "Corrente de carga deve ser \u2265 0";
    }
    var dischargeCurrent = parseInt(cfg.maxDischargeCurrent, 10);
    if (!Number.isInteger(dischargeCurrent) || dischargeCurrent < 0) {
      return "Corrente de descarga deve ser \u2265 0";
    }

    // Phase 2: Hardware rated capacity validation
    if (this._ratedMaxPowerKw != null) {
      if (chargeCurrent > this._ratedMaxPowerKw) {
        return (
          "Corrente de carga excede capacidade do equipamento (" +
          this._ratedMaxPowerKw +
          " kW)"
        );
      }
      if (dischargeCurrent > this._ratedMaxPowerKw) {
        return (
          "Corrente de descarga excede capacidade do equipamento (" +
          this._ratedMaxPowerKw +
          " kW)"
        );
      }
    }
    var gridLimit = parseInt(cfg.gridImportLimitKw, 10);
    if (!Number.isInteger(gridLimit) || gridLimit < 0) {
      return "Limite de importa\u00e7\u00e3o deve ser \u2265 0";
    }

    // Slot validation
    if (!cfg.slots || cfg.slots.length === 0) {
      return "Os hor\u00e1rios devem cobrir 24h completas (00:00\u201324:00)";
    }

    for (var i = 0; i < cfg.slots.length; i++) {
      var slot = cfg.slots[i];
      if (
        !Number.isInteger(slot.startMinute) ||
        slot.startMinute < 0 ||
        slot.startMinute > 1380 ||
        slot.startMinute % 60 !== 0
      ) {
        return "Hor\u00e1rio de in\u00edcio inv\u00e1lido no slot " + (i + 1);
      }
      if (
        !Number.isInteger(slot.endMinute) ||
        slot.endMinute < 60 ||
        slot.endMinute > 1440 ||
        slot.endMinute % 60 !== 0
      ) {
        return "Hor\u00e1rio de fim inv\u00e1lido no slot " + (i + 1);
      }
      if (slot.endMinute <= slot.startMinute) {
        return "Fim deve ser posterior ao in\u00edcio no slot " + (i + 1);
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
      return "Os hor\u00e1rios devem cobrir 24h completas (00:00\u201324:00)";
    }

    for (var j = 1; j < sorted.length; j++) {
      if (sorted[j].startMinute < sorted[j - 1].endMinute) {
        return "Sobreposi\u00e7\u00e3o detectada entre hor\u00e1rios";
      }
      if (sorted[j].startMinute > sorted[j - 1].endMinute) {
        return "Intervalo detectado entre hor\u00e1rios";
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
      applyBtn.textContent = "Submitting...";
    }

    try {
      await DataSource.devices.putSchedule(gwId, self._pendingConfig);

      // Keep button disabled — waiting for gateway confirmation via SSE
      if (applyBtn) {
        applyBtn.textContent = "Aguardando...";
        applyBtn.disabled = true;
      }
      var infoEl = document.getElementById("schedule-inflight-info");
      if (infoEl) infoEl.style.display = "block";
      self._showToast(t("devices.scheduleSubmitted"), "success");
    } catch (err) {
      console.error("[P2] putSchedule error:", err);
      if (err.status === 409) {
        self._showToast("J\u00e1 existe um comando em andamento", "warning");
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
  // GATEWAY HEALTH (Fix #4)
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
  // LAYER 3: Device Detail (deprecated — kept for reference)
  // =========================================================

  _buildLayer3: function () {
    var detail = this._currentDetail;
    var dev = detail.device;
    var state = detail.state || {};
    var extra = detail.telemetryExtra || {};
    var config = detail.config || {};
    var schedule = this._currentSchedule || {
      syncStatus: "unknown",
      slots: [],
    };

    var statusTag = state.isOnline
      ? '<span class="tag-online">' + t("devices.online") + "</span>"
      : '<span class="tag-offline">' + t("devices.offline") + "</span>";

    var gwName = dev.gatewayName || dev.gatewayId || "--";

    return (
      '<div class="detail-header">' +
      '<div class="breadcrumb">' +
      '<a href="#" class="bc-link" id="bc-back">' +
      t("nav.devices") +
      "</a>" +
      " \u203a <span>" +
      gwName +
      "</span>" +
      " \u203a <span>" +
      (dev.name || dev.assetId) +
      "</span>" +
      "</div>" +
      "<h2>" +
      (dev.name || dev.assetId) +
      " " +
      statusTag +
      "</h2>" +
      '<div class="detail-subtitle">' +
      dev.brand +
      " " +
      dev.model +
      " \u00b7 " +
      dev.assetType +
      "</div>" +
      "</div>" +
      '<div class="detail-page">' +
      '<div class="left-col">' +
      this._buildEnergyFlow(state) +
      this._buildBatteryStatus(state) +
      this._buildInverterGrid(state, extra) +
      "</div>" +
      '<div class="right-col">' +
      this._buildDeviceConfig(dev, config) +
      this._buildScheduleCard(schedule) +
      "</div>" +
      "</div>" +
      '<div class="action-bar">' +
      '<button class="btn btn-secondary" id="detail-back">' +
      t("devices.backToList") +
      "</button>" +
      '<button class="btn btn-primary" id="detail-apply">' +
      t("devices.applyToGateway") +
      "</button>" +
      "</div>"
    );
  },

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

    var batSub = "Idle";
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
      '<marker id="arrow-pv" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
      '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-positive"/></marker>' +
      '<marker id="arrow-bat" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
      '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-neutral"/></marker>' +
      '<marker id="arrow-load" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
      '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-text"/></marker>' +
      '<marker id="arrow-grid" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
      '<path d="M0,0 L8,3 L0,6 Z" class="ef-arrow-accent"/></marker>' +
      "</defs>";

    // PV line: always PV→Hub (solar generates into hub)
    if (showTop) {
      svgLines.push(
        '<line x1="140" y1="76" x2="140" y2="108" class="ef-line-pv" marker-end="url(#arrow-pv)"/>',
      );
    }

    // Battery line: direction depends on charge/discharge
    if (showLeft) {
      if (state.batteryPower > 0.05) {
        // Charging: Hub→Battery
        svgLines.push(
          '<line x1="120" y1="140" x2="56" y2="140" class="ef-line-bat" marker-end="url(#arrow-bat)"/>',
        );
      } else {
        // Discharging: Battery→Hub
        svgLines.push(
          '<line x1="56" y1="140" x2="120" y2="140" class="ef-line-bat" marker-end="url(#arrow-bat)"/>',
        );
      }
    }

    // Load line: always Hub→Load (hub feeds load)
    if (showRight) {
      svgLines.push(
        '<line x1="160" y1="140" x2="224" y2="140" class="ef-line-load" marker-end="url(#arrow-load)"/>',
      );
    }

    // Grid line: direction depends on import/export
    if (showBottom) {
      if (state.gridPowerKw > 0) {
        // Importing: Grid→Hub
        svgLines.push(
          '<line x1="140" y1="224" x2="140" y2="160" class="ef-line-grid" marker-end="url(#arrow-grid)"/>',
        );
      } else {
        // Exporting: Hub→Grid
        svgLines.push(
          '<line x1="140" y1="160" x2="140" y2="224" class="ef-line-grid" marker-end="url(#arrow-grid)"/>',
        );
      }
    }

    var svgOverlay =
      '<svg class="ef-svg-overlay" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">' +
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

    return Components.sectionCard("Energy Flow", body);
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

  // ---- Device Configuration ----
  _buildDeviceConfig: function (dev, config) {
    var defaults = config.defaults || {};
    var modeOptions = [
      "self_consumption",
      "peak_valley_arbitrage",
      "peak_shaving",
    ];
    var modeLabels = {
      self_consumption: "Self Consumption",
      peak_valley_arbitrage: "Peak Valley Arbitrage",
      peak_shaving: "Peak Shaving",
    };

    var modeSelect =
      '<select id="cfg-mode" class="config-input">' +
      modeOptions
        .map(function (m) {
          return (
            '<option value="' +
            m +
            '"' +
            (dev.operationMode === m ? " selected" : "") +
            ">" +
            modeLabels[m] +
            "</option>"
          );
        })
        .join("") +
      "</select>";

    var rows = [
      { label: "Operation Mode", input: modeSelect },
      {
        label: "Capacity (kW)",
        input:
          '<input type="number" id="cfg-cap-kw" class="config-input" step="0.1" value="' +
          (dev.capacidadeKw || 5) +
          '">',
      },
      {
        label: "Capacity (kWh)",
        input:
          '<input type="number" id="cfg-cap-kwh" class="config-input" step="0.1" value="' +
          (dev.capacityKwh || 10) +
          '">',
      },
      {
        label: t("devices.socMin"),
        input:
          '<input type="number" id="cfg-soc-min" class="config-input" min="0" max="100" value="' +
          (config.socMin != null ? config.socMin : 10) +
          '">' +
          (defaults.socMin != null
            ? ' <span class="config-default">\u2190 Default ' +
              defaults.socMin +
              "</span>"
            : ""),
      },
      {
        label: t("devices.socMax"),
        input:
          '<input type="number" id="cfg-soc-max" class="config-input" min="0" max="100" value="' +
          (config.socMax != null ? config.socMax : 95) +
          '">' +
          (defaults.socMax != null
            ? ' <span class="config-default">\u2190 Default ' +
              defaults.socMax +
              "</span>"
            : ""),
      },
      {
        label: t("devices.maxChargeRateKw"),
        input:
          '<input type="number" id="cfg-charge" class="config-input" step="0.1" value="' +
          (config.maxChargeRateKw || 5) +
          '">',
      },
      {
        label: t("devices.maxDischargeRateKw"),
        input:
          '<input type="number" id="cfg-discharge" class="config-input" step="0.1" value="' +
          (config.maxDischargeRateKw || 5) +
          '">',
      },
      {
        label: "Allow Export",
        input:
          '<select id="cfg-export" class="config-input"><option value="false"' +
          (!dev.allowExport ? " selected" : "") +
          '>No</option><option value="true"' +
          (dev.allowExport ? " selected" : "") +
          ">Yes</option></select>",
      },
      {
        label: t("devices.gridImportLimitKw"),
        input:
          '<input type="number" id="cfg-grid-limit" class="config-input" step="0.1" min="0" value="' +
          (config.gridImportLimitKw || 3) +
          '">',
      },
    ];

    var body = rows
      .map(function (r) {
        return (
          '<div class="config-row"><span class="config-label">' +
          r.label +
          '</span><div class="config-field">' +
          r.input +
          "</div></div>"
        );
      })
      .join("");

    return Components.sectionCard(t("devices.gatewayDetail"), body);
  },

  // ---- Daily Schedule ----
  _buildScheduleCard: function (schedule) {
    var syncBadgeClass =
      schedule.syncStatus === "synced"
        ? "synced"
        : schedule.syncStatus === "pending"
          ? "sync-pending"
          : "sync-unknown";
    var syncLabel =
      schedule.syncStatus === "synced"
        ? "Synced"
        : schedule.syncStatus === "pending"
          ? "Pending"
          : t("devices.unknown");
    var lastAck = schedule.lastAckAt
      ? formatISODateTime(schedule.lastAckAt)
      : "--";

    var modeColors = {
      self_consumption: "#22c55e",
      peak_valley_arbitrage: "#3b82f6",
      peak_shaving: "#a855f7",
    };
    var modeLabels = {
      self_consumption: "Self Consumption",
      peak_valley_arbitrage: "Peak Valley Arb.",
      peak_shaving: "Peak Shaving",
    };

    // Timeline bar
    var barSegments = (schedule.slots || [])
      .map(function (slot) {
        var widthPct = (((slot.endHour - slot.startHour) / 24) * 100).toFixed(
          2,
        );
        var color = modeColors[slot.mode] || "#6b7280";
        return (
          '<div class="schedule-segment" style="width:' +
          widthPct +
          "%;background:" +
          color +
          '" title="' +
          slot.startHour +
          ":00-" +
          slot.endHour +
          ":00 " +
          (modeLabels[slot.mode] || slot.mode) +
          '"></div>'
        );
      })
      .join("");

    var timeMarkers =
      '<div class="schedule-markers"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>';

    // Table
    var tableRows = (schedule.slots || [])
      .map(function (slot, i) {
        var color = modeColors[slot.mode] || "#6b7280";
        return (
          "<tr>" +
          "<td>" +
          String(slot.startHour).padStart(2, "0") +
          ":00</td>" +
          "<td>" +
          String(slot.endHour).padStart(2, "0") +
          ":00</td>" +
          '<td><span class="schedule-mode-badge" style="background:' +
          color +
          '">' +
          (modeLabels[slot.mode] || slot.mode) +
          "</span></td>" +
          "</tr>"
        );
      })
      .join("");

    var body =
      '<div class="sync-status ' +
      syncBadgeClass +
      '">' +
      '<span class="sync-dot"></span> ' +
      syncLabel +
      '<span class="sync-ack">' +
      t("devices.syncedLastAck") +
      ": " +
      lastAck +
      "</span>" +
      "</div>" +
      '<div class="schedule-bar">' +
      barSegments +
      "</div>" +
      timeMarkers +
      '<table class="schedule-table"><thead><tr><th>' +
      t("devices.schedStart") +
      "</th><th>" +
      t("devices.schedEnd") +
      "</th><th>" +
      t("devices.schedMode") +
      "</th></tr></thead><tbody>" +
      tableRows +
      "</tbody></table>";

    return Components.sectionCard(t("devices.dailySchedule"), body);
  },

  // =========================================================
  // LAYER 3 EVENTS
  // =========================================================

  _setupLayer3Events: function () {
    var self = this;

    // Back navigation
    var bcBack = document.getElementById("bc-back");
    var detailBack = document.getElementById("detail-back");
    if (bcBack) {
      bcBack.addEventListener("click", function (e) {
        e.preventDefault();
        self._closeLayer3();
      });
    }
    if (detailBack) {
      detailBack.addEventListener("click", function () {
        self._closeLayer3();
      });
    }

    // Old device-level apply (deprecated path)
    var oldApplyBtn = document.getElementById("detail-apply");
    if (oldApplyBtn) {
      oldApplyBtn.addEventListener("click", function () {
        self._handleApply();
      });
    }

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
          }
        });
      });

    var addBtn = document.getElementById("schedule-add-slot");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        if (!self._pendingConfig) return;
        var slots = self._pendingConfig.slots;
        var lastEnd = slots.length > 0 ? slots[slots.length - 1].endMinute : 0;
        if (lastEnd >= 1440) lastEnd = 0;
        var newSlot = {
          startMinute: lastEnd,
          endMinute: Math.min(lastEnd + 360, 1440),
          purpose: "self_consumption",
          direction: null,
          exportPolicy: null,
        };
        self._pendingConfig = Object.assign({}, self._pendingConfig, {
          slots: slots.concat([newSlot]),
        });
        self._renderScheduleRows();
        self._attachSlotListeners();
      });
    }

    var scheduleApplyBtn = document.getElementById("schedule-apply");
    if (scheduleApplyBtn) {
      scheduleApplyBtn.addEventListener("click", function () {
        self._handleApplySchedule();
      });
    }

    self._attachSlotListeners();
  },

  _handleApply: async function () {
    var self = this;
    var dev = self._currentDetail ? self._currentDetail.device : null;
    if (!dev) return;

    var applyBtn = document.getElementById("detail-apply");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = "Submitting...";
    }

    try {
      // Gather schedule from current state
      var schedule = self._currentSchedule || { slots: [] };
      await DataSource.devices.putSchedule(dev.assetId, schedule.slots || []);

      if (applyBtn) {
        applyBtn.textContent = "Submitted \u2713";
        applyBtn.classList.add("btn-success");
      }

      // Show toast
      self._showToast(
        "Schedule submitted. Waiting for gateway confirmation.",
        "success",
      );

      setTimeout(function () {
        if (applyBtn) {
          applyBtn.textContent = t("devices.applyToGateway");
          applyBtn.disabled = false;
          applyBtn.classList.remove("btn-success");
        }
      }, 3000);
    } catch (err) {
      console.error("[P2] putSchedule error:", err);
      self._showToast(t("devices.loadFailed"), "error");
      if (applyBtn) {
        applyBtn.textContent = t("devices.applyToGateway");
        applyBtn.disabled = false;
      }
    }
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
