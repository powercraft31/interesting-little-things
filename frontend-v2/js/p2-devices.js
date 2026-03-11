/* ============================================
   SOLFACIL Admin Portal — P2: Device Management (v5.19)
   Gateway-first architecture:
   Layer 1 — Gateway card list with expandable device rows
   Layer 3 — Device detail (energy flow + telemetry + config + schedule)
   ============================================ */

var DevicesPage = {
  _gateways: null,
  _expandedGw: null,
  _currentDetail: null,

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
        '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><div class="empty-state-title">No Data</div><div class="empty-state-detail">No gateways found.</div></div>';
      return;
    }

    container.innerHTML = self._buildLayer1();
    self._setupLayer1Events();
  },

  onRoleChange: function () {
    this._expandedGw = null;
    this._currentDetail = null;
    this.init();
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
      " Gateways \u00b7 " +
      totalDevices +
      " Devices</div>" +
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
    var rssi = health.wifiRssi != null ? health.wifiRssi + " dBm" : "--";
    var fw = health.firmwareVersion || "--";
    var uptime =
      health.uptimeSeconds != null
        ? Math.round(health.uptimeSeconds / 3600) + "h"
        : "--";
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
      '<div class="gw-name-primary">' +
      gw.name +
      "</div>" +
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
      "<span>" +
      t("devices.firmware") +
      " " +
      fw +
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
    document.querySelectorAll(".gw-header").forEach(function (header) {
      header.addEventListener("click", function () {
        var card = header.closest(".gw-card");
        var gwId = card.dataset.gwId;
        self._toggleGateway(gwId);
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
              return self._buildDeviceRow(dev);
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

  _buildDeviceRow: function (dev) {
    var st = dev.state || {};
    var socText = st.batterySoc != null ? st.batterySoc + "%" : "--";
    var powerText =
      st.pvPower != null ? formatNumber(st.pvPower, 1) + " kW" : "--";
    var sohText = st.batSoh != null ? st.batSoh + "%" : "--";
    var tempText =
      st.batteryTemperature != null ? st.batteryTemperature + "\u00b0C" : "--";

    var typeIcons = {
      "Inverter + Battery": "\ud83d\udd0b",
      "Smart Meter": "\ud83d\udcca",
      AC: "\u2744\ufe0f",
      "EV Charger": "\ud83d\udd0c",
    };
    var icon = typeIcons[dev.assetType] || "\ud83d\udd0c";

    return (
      '<div class="device-row" data-asset-id="' +
      dev.assetId +
      '">' +
      '<div class="dev-icon">' +
      icon +
      "</div>" +
      '<div class="dev-id-block">' +
      '<div class="dev-id">' +
      dev.assetId +
      "</div>" +
      '<div class="dev-type">' +
      (dev.brand || "") +
      " " +
      (dev.model || "") +
      "</div>" +
      "</div>" +
      '<div class="dev-stats">' +
      '<span class="dev-stat">SoC ' +
      socText +
      "</span>" +
      '<span class="dev-stat">PV ' +
      powerText +
      "</span>" +
      '<span class="dev-stat">SoH ' +
      sohText +
      "</span>" +
      '<span class="dev-stat">Temp ' +
      tempText +
      "</span>" +
      "</div>" +
      "</div>"
    );
  },

  _attachDeviceRowListeners: function (container) {
    var self = this;
    container.querySelectorAll(".device-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var assetId = row.dataset.assetId;
        self._openLayer3(assetId);
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
        '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><div class="empty-state-title">No Data</div><div class="empty-state-detail">Device not found.</div><button class="btn btn-secondary" onclick="DevicesPage._closeLayer3()">Back</button></div>';
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
  },

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
      ? '<span class="tag-online">Online</span>'
      : '<span class="tag-offline">Offline</span>';

    var gwName = dev.gatewayName || dev.gatewayId || "--";

    return (
      '<div class="detail-header">' +
      '<div class="breadcrumb">' +
      '<a href="#" class="bc-link" id="bc-back">Devices</a>' +
      " \u203a <span>" +
      gwName +
      "</span>" +
      " \u203a <span>" +
      dev.assetId +
      "</span>" +
      "</div>" +
      "<h2>" +
      dev.assetId +
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
      state.pvPower != null ? formatNumber(state.pvPower, 1) + " kW" : "0 kW";
    var batVal =
      state.batteryPower != null
        ? formatNumber(Math.abs(state.batteryPower), 1) + " kW"
        : "0 kW";
    var loadVal =
      state.loadPower != null
        ? formatNumber(state.loadPower, 1) + " kW"
        : "0 kW";
    var gridVal =
      state.gridPowerKw != null
        ? formatNumber(Math.abs(state.gridPowerKw), 1) + " kW"
        : "0 kW";

    var batSub = "Idle";
    if (state.batteryPower > 0.05)
      batSub = "SoC " + (state.batterySoc || 0) + "% \u00b7 Charging";
    else if (state.batteryPower < -0.05)
      batSub = "SoC " + (state.batterySoc || 0) + "% \u00b7 Discharging";
    else batSub = "SoC " + (state.batterySoc || 0) + "% \u00b7 Idle";

    var gridClass =
      state.gridPowerKw > 0
        ? "importing"
        : state.gridPowerKw < 0
          ? "exporting"
          : "";
    var gridSub =
      state.gridPowerKw > 0
        ? "Importing"
        : state.gridPowerKw < 0
          ? "Exporting"
          : "Idle";

    var showTop = state.pvPower > 0.01;
    var showLeft = Math.abs(state.batteryPower || 0) > 0.01;
    var showRight = (state.loadPower || 0) > 0.01;
    var showBottom = Math.abs(state.gridPowerKw || 0) > 0.01;

    var body =
      '<div class="energy-flow-diamond">' +
      '<div class="ef-pv ef-node"><div class="ef-node-icon">\u2600\ufe0f</div><div class="ef-node-value">' +
      pvVal +
      '</div><div class="ef-node-label">Solar PV</div></div>' +
      '<div class="ef-line-top' +
      (showTop ? "" : " hidden") +
      '"></div>' +
      '<div class="ef-battery ef-node"><div class="ef-node-icon">\ud83d\udd0b</div><div class="ef-node-value">' +
      batVal +
      '</div><div class="ef-node-sub">' +
      batSub +
      "</div></div>" +
      '<div class="ef-line-left' +
      (showLeft ? "" : " hidden") +
      '"></div>' +
      '<div class="ef-center"><div class="ef-center-hub"></div></div>' +
      '<div class="ef-line-right' +
      (showRight ? "" : " hidden") +
      '"></div>' +
      '<div class="ef-load ef-node"><div class="ef-node-icon">\ud83c\udfe0</div><div class="ef-node-value">' +
      loadVal +
      '</div><div class="ef-node-label">Load</div></div>' +
      '<div class="ef-line-bottom' +
      (showBottom ? "" : " hidden") +
      '"></div>' +
      '<div class="ef-grid ef-node ' +
      gridClass +
      '"><div class="ef-node-icon">\u26a1</div><div class="ef-node-value">' +
      gridVal +
      '</div><div class="ef-node-sub">' +
      gridSub +
      "</div></div>" +
      "</div>";

    return Components.sectionCard("Energy Flow", body);
  },

  // ---- Battery Status ----
  _buildBatteryStatus: function (state) {
    var rows = [
      {
        label: "State of Charge",
        value: state.batterySoc != null ? state.batterySoc + "%" : "--",
      },
      {
        label: "State of Health",
        value: state.batSoh != null ? state.batSoh + "%" : "--",
      },
      {
        label: "Voltage",
        value:
          state.batteryVoltage != null
            ? formatNumber(state.batteryVoltage, 1) + " V"
            : "--",
      },
      {
        label: "Current",
        value:
          state.batteryCurrent != null
            ? formatNumber(state.batteryCurrent, 1) + " A"
            : "--",
      },
      {
        label: "Temperature",
        value:
          state.batteryTemperature != null
            ? state.batteryTemperature + "\u00b0C"
            : "--",
      },
      {
        label: "Charge/Discharge Rate",
        value:
          state.batteryPower != null
            ? formatNumber(state.batteryPower, 2) + " kW"
            : "--",
      },
      {
        label: "Max Charge Current",
        value:
          state.maxChargeCurrent != null ? state.maxChargeCurrent + " A" : "--",
      },
      {
        label: "Max Discharge Current",
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
          '</span><span class="tele-value">' +
          r.value +
          "</span></div>"
        );
      })
      .join("");
    return Components.sectionCard("Battery Status", body);
  },

  // ---- Inverter & Grid ----
  _buildInverterGrid: function (state, extra) {
    var rows = [
      {
        label: "PV Power",
        value:
          state.pvPower != null ? formatNumber(state.pvPower, 2) + " kW" : "--",
      },
      {
        label: "Inverter Temp",
        value:
          state.inverterTemp != null ? state.inverterTemp + "\u00b0C" : "--",
      },
      {
        label: "Grid Power",
        value:
          state.gridPowerKw != null
            ? formatNumber(state.gridPowerKw, 2) + " kW"
            : "--",
      },
      {
        label: "Grid Voltage",
        value:
          extra.gridVoltageR != null
            ? formatNumber(extra.gridVoltageR, 1) + " V"
            : "--",
      },
      {
        label: "Grid Current",
        value:
          extra.gridCurrentR != null
            ? formatNumber(extra.gridCurrentR, 1) + " A"
            : "--",
      },
      {
        label: "Power Factor",
        value: extra.gridPf != null ? formatNumber(extra.gridPf, 2) : "--",
      },
      {
        label: "Home Load",
        value:
          state.loadPower != null
            ? formatNumber(state.loadPower, 2) + " kW"
            : "--",
      },
      {
        label: "Total Buy",
        value:
          extra.totalBuyKwh != null
            ? formatNumber(extra.totalBuyKwh, 1) + " kWh"
            : "--",
      },
      {
        label: "Total Sell",
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
          '</span><span class="tele-value">' +
          r.value +
          "</span></div>"
        );
      })
      .join("");
    return Components.sectionCard("Inverter & Grid", body);
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
        label: "SOC Min (%)",
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
        label: "SOC Max (%)",
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
        label: "Max Charge Rate (kW)",
        input:
          '<input type="number" id="cfg-charge" class="config-input" step="0.1" value="' +
          (config.maxChargeRateKw || 5) +
          '">',
      },
      {
        label: "Max Discharge Rate (kW)",
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
        label: "Grid Import Limit (kW)",
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

    return Components.sectionCard("Device Configuration", body);
  },

  // ---- Daily Schedule ----
  _buildScheduleCard: function (schedule) {
    var syncBadgeClass =
      schedule.syncStatus === "synced"
        ? "sync-ok"
        : schedule.syncStatus === "pending"
          ? "sync-pending"
          : "sync-unknown";
    var syncLabel =
      schedule.syncStatus === "synced"
        ? "Synced"
        : schedule.syncStatus === "pending"
          ? "Pending"
          : "Unknown";
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
      '<span class="sync-ack">Last ACK: ' +
      lastAck +
      "</span>" +
      "</div>" +
      '<div class="schedule-bar">' +
      barSegments +
      "</div>" +
      timeMarkers +
      '<table class="schedule-table"><thead><tr><th>Start</th><th>End</th><th>Mode</th></tr></thead><tbody>' +
      tableRows +
      "</tbody></table>";

    return Components.sectionCard("Daily Schedule", body);
  },

  // =========================================================
  // LAYER 3 EVENTS
  // =========================================================

  _setupLayer3Events: function () {
    var self = this;
    var bcBack = document.getElementById("bc-back");
    var detailBack = document.getElementById("detail-back");
    var applyBtn = document.getElementById("detail-apply");

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
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        self._handleApply();
      });
    }
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
      self._showToast("Failed to submit schedule.", "error");
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
