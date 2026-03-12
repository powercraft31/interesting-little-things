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
        '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><div class="empty-state-title">' +
        t("shared.noData") +
        '</div><div class="empty-state-detail">' +
        t("devices.noDevicesUnderGw") +
        "</div></div>";
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
    var wifiRaw =
      health.wifi_signal_strength || health.wifiSignalStrength || "--";
    var rssi = wifiRaw !== "--" ? wifiRaw.replace(/\s*\(.*\)/, "") : "--";
    var cpuTemp = health.CPU_temp || health.cpuTemp || "--";
    var memUsage = health.memory_usage || health.memoryUsage || "--";
    var uptime = health.system_runtime || health.systemRuntime || "--";
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
    // Device rows are now info-only — no click → Layer 3
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
    this._pendingSlots = [];
    this._currentGatewayId = null;
  },

  // =========================================================
  // LAYER 3: Gateway-Level Detail (Fix #3)
  // =========================================================

  _pendingSlots: [],
  _currentGatewayId: null,

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
      self._currentSchedule = detail.schedule || {
        syncStatus: "unknown",
        slots: [],
      };
      self._pendingSlots = JSON.parse(
        JSON.stringify(self._currentSchedule.slots || []),
      );
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
      this._buildDeviceConfigGW(devices, config) +
      this._buildScheduleCardEditable(schedule) +
      this._buildGatewayHealth(gw.emsHealth) +
      "</div>" +
      "</div>"
    );
  },

  _selectedConfigDevice: null,

  _buildDeviceConfigGW: function (devices, config) {
    var self = this;
    // Default to first INVERTER_BATTERY if no selection
    if (!self._selectedConfigDevice) {
      var firstInverter = devices.filter(function (d) {
        return d.assetType === "INVERTER_BATTERY";
      })[0];
      self._selectedConfigDevice = firstInverter
        ? firstInverter.assetId
        : (devices[0] && devices[0].assetId) || null;
    }
    var selectedId = self._selectedConfigDevice;
    var selectedDev = devices.filter(function (d) {
      return d.assetId === selectedId;
    })[0];
    var isInverter =
      selectedDev && selectedDev.assetType === "INVERTER_BATTERY";

    var deviceChips = devices
      .map(function (d) {
        var onlineClass = d.isOnline ? "tag-online" : "tag-offline";
        var activeClass = d.assetId === selectedId ? " active" : "";
        return (
          '<span class="device-chip ' +
          onlineClass +
          activeClass +
          '" data-asset-id="' +
          d.assetId +
          '" data-asset-type="' +
          d.assetType +
          '">' +
          (d.name || d.assetId) +
          "</span>"
        );
      })
      .join("");

    var configFields = [
      { key: "socMin", label: t("devices.socMin"), value: config.socMin },
      { key: "socMax", label: t("devices.socMax"), value: config.socMax },
      {
        key: "maxChargeRateKw",
        label: t("devices.maxChargeRateKw"),
        value: config.maxChargeRateKw,
      },
      {
        key: "maxDischargeRateKw",
        label: t("devices.maxDischargeRateKw"),
        value: config.maxDischargeRateKw,
      },
      {
        key: "gridImportLimitKw",
        label: t("devices.gridImportLimitKw"),
        value: config.gridImportLimitKw,
      },
    ];

    var fieldsHtml;
    if (isInverter) {
      fieldsHtml =
        configFields
          .map(function (f) {
            var val = f.value != null ? f.value : "";
            return (
              '<div class="config-row"><span class="config-label">' +
              f.label +
              '</span><div class="config-field">' +
              '<input type="number" class="config-input" data-cfg-key="' +
              f.key +
              '" step="0.1" value="' +
              val +
              '">' +
              "</div></div>"
            );
          })
          .join("") +
        '<div class="schedule-apply-row">' +
        '<button class="btn btn-primary" id="config-apply">' +
        t("devices.applyConfig") +
        "</button></div>";
    } else {
      fieldsHtml = configFields
        .map(function (f) {
          var val = f.value != null ? f.value : "--";
          return (
            '<div class="tele-row"><span class="tele-label">' +
            f.label +
            '</span><span class="tele-value">' +
            val +
            "</span></div>"
          );
        })
        .join("");
    }

    var body =
      '<div class="device-chips-row">' +
      deviceChips +
      "</div>" +
      '<div id="config-fields-container">' +
      fieldsHtml +
      "</div>";

    return Components.sectionCard(t("devices.gatewayDetail"), body);
  },

  // =========================================================
  // SCHEDULE EDITOR (Fix #1)
  // =========================================================

  _buildScheduleCardEditable: function (schedule) {
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
          : t("devices.unknown");
    var lastAck = schedule.lastAckAt
      ? formatISODateTime(schedule.lastAckAt)
      : "--";

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
      '<div class="schedule-bar" id="schedule-bar-preview"></div>' +
      '<div class="schedule-markers"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>' +
      '<table class="schedule-table">' +
      "<thead><tr><th>" +
      t("devices.schedStart") +
      "</th><th>" +
      t("devices.schedEnd") +
      "</th><th>" +
      t("devices.schedMode") +
      "</th><th></th></tr></thead>" +
      '<tbody id="schedule-rows"></tbody>' +
      "</table>" +
      '<button class="btn btn-outline btn-sm" id="schedule-add-slot">' +
      t("devices.addSlot") +
      "</button>" +
      '<div class="schedule-apply-row">' +
      '<button class="btn btn-primary" id="schedule-apply">' +
      t("devices.applyToGateway") +
      "</button>" +
      "</div>";

    return Components.sectionCard(t("devices.dailySchedule"), body);
  },

  _buildSlotRow: function (slot, index) {
    var modeOptions = [
      "self_consumption",
      "peak_valley_arbitrage",
      "peak_shaving",
    ];
    var modeLabels = {
      self_consumption: t("devices.selfConsumption"),
      peak_valley_arbitrage: t("devices.peakValleyArbitrage"),
      peak_shaving: t("devices.peakShaving"),
    };
    var modeColors = {
      self_consumption: "#22c55e",
      peak_valley_arbitrage: "#3b82f6",
      peak_shaving: "#a855f7",
    };

    var startOptions = "";
    for (var h = 0; h < 24; h++) {
      startOptions +=
        '<option value="' +
        h +
        '"' +
        (slot.startHour === h ? " selected" : "") +
        ">" +
        String(h).padStart(2, "0") +
        ":00</option>";
    }

    var endOptions = "";
    for (var h2 = 1; h2 <= 24; h2++) {
      endOptions +=
        '<option value="' +
        h2 +
        '"' +
        (slot.endHour === h2 ? " selected" : "") +
        ">" +
        String(h2).padStart(2, "0") +
        ":00</option>";
    }

    var modeSelect = modeOptions
      .map(function (m) {
        return (
          '<option value="' +
          m +
          '"' +
          (slot.mode === m ? " selected" : "") +
          ">" +
          modeLabels[m] +
          "</option>"
        );
      })
      .join("");

    var color = modeColors[slot.mode] || "#6b7280";

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
      '<select class="slot-mode config-input schedule-mode-select">' +
      modeSelect +
      "</select>" +
      "</span></td>" +
      '<td><button class="btn-icon btn-delete-slot" title="' +
      t("devices.deleteSlot") +
      '">\ud83d\uddd1</button></td>' +
      "</tr>"
    );
  },

  _renderScheduleRows: function () {
    var self = this;
    var tbody = document.getElementById("schedule-rows");
    if (!tbody) return;
    tbody.innerHTML = self._pendingSlots
      .map(function (slot, i) {
        return self._buildSlotRow(slot, i);
      })
      .join("");
    self._renderTimelinePreview();
  },

  _renderTimelinePreview: function () {
    var bar = document.getElementById("schedule-bar-preview");
    if (!bar) return;
    var modeColors = {
      self_consumption: "#22c55e",
      peak_valley_arbitrage: "#3b82f6",
      peak_shaving: "#a855f7",
    };
    bar.innerHTML = this._pendingSlots
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
          String(slot.startHour).padStart(2, "0") +
          ":00-" +
          String(slot.endHour).padStart(2, "0") +
          ":00 " +
          slot.mode +
          '"></div>'
        );
      })
      .join("");
  },

  _attachSlotListeners: function () {
    var self = this;
    var tbody = document.getElementById("schedule-rows");
    if (!tbody) return;

    // Delete buttons
    tbody.querySelectorAll(".btn-delete-slot").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("tr");
        var idx = parseInt(row.dataset.slotIndex, 10);
        self._pendingSlots = self._pendingSlots.filter(function (_, i) {
          return i !== idx;
        });
        self._renderScheduleRows();
        self._attachSlotListeners();
      });
    });

    // Select change listeners
    tbody.querySelectorAll("tr").forEach(function (row) {
      var idx = parseInt(row.dataset.slotIndex, 10);
      var startSel = row.querySelector(".slot-start");
      var endSel = row.querySelector(".slot-end");
      var modeSel = row.querySelector(".slot-mode");

      if (startSel) {
        startSel.addEventListener("change", function () {
          self._pendingSlots = self._pendingSlots.map(function (s, i) {
            return i === idx
              ? {
                  startHour: parseInt(startSel.value, 10),
                  endHour: s.endHour,
                  mode: s.mode,
                }
              : s;
          });
          self._renderTimelinePreview();
        });
      }
      if (endSel) {
        endSel.addEventListener("change", function () {
          self._pendingSlots = self._pendingSlots.map(function (s, i) {
            return i === idx
              ? {
                  startHour: s.startHour,
                  endHour: parseInt(endSel.value, 10),
                  mode: s.mode,
                }
              : s;
          });
          self._renderTimelinePreview();
        });
      }
      if (modeSel) {
        modeSel.addEventListener("change", function () {
          self._pendingSlots = self._pendingSlots.map(function (s, i) {
            return i === idx
              ? {
                  startHour: s.startHour,
                  endHour: s.endHour,
                  mode: modeSel.value,
                }
              : s;
          });
          self._renderScheduleRows();
          self._attachSlotListeners();
        });
      }
    });
  },

  _handleApplyGW: async function () {
    var self = this;
    var gwId = self._currentGatewayId;
    if (!gwId) return;

    // Validation: startHour < endHour, valid range
    var valid = self._pendingSlots.every(function (s) {
      return s.startHour < s.endHour && s.startHour >= 0 && s.endHour <= 24;
    });
    if (!valid) {
      self._showToast(t("devices.invalidSchedule"), "warning");
      return;
    }

    var applyBtn = document.getElementById("schedule-apply");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = "Submitting...";
    }

    try {
      await DataSource.devices.putSchedule(gwId, self._pendingSlots);

      if (applyBtn) {
        applyBtn.textContent = "Submitted \u2713";
        applyBtn.classList.add("btn-success");
      }
      self._showToast(t("devices.scheduleSubmitted"), "success");

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

  _handleConfigApply: async function () {
    var self = this;
    var assetId = self._selectedConfigDevice;
    if (!assetId) return;

    var inputs = document.querySelectorAll(
      "#config-fields-container .config-input",
    );
    var configPayload = {};
    inputs.forEach(function (input) {
      var key = input.dataset.cfgKey;
      if (key) {
        configPayload[key] = parseFloat(input.value) || 0;
      }
    });

    var applyBtn = document.getElementById("config-apply");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = "...";
    }

    try {
      await DataSource.devices.putDevice(assetId, configPayload);
      self._showToast(t("devices.configApplied"), "success");
      if (applyBtn) {
        applyBtn.textContent = "\u2713";
        applyBtn.classList.add("btn-success");
        setTimeout(function () {
          applyBtn.textContent = t("devices.applyConfig");
          applyBtn.disabled = false;
          applyBtn.classList.remove("btn-success");
        }, 3000);
      }
    } catch (err) {
      console.error("[P2] putDevice error:", err);
      self._showToast(t("devices.configFailed"), "error");
      if (applyBtn) {
        applyBtn.textContent = t("devices.applyConfig");
        applyBtn.disabled = false;
      }
    }
  },

  // =========================================================
  // GATEWAY HEALTH (Fix #4)
  // =========================================================

  _buildGatewayHealth: function (emsHealth) {
    var h = emsHealth || {};

    var wifiRaw = h.wifiSignalStrength || h.wifi_signal_strength || "--";
    var wifiVal = wifiRaw !== "--" ? wifiRaw.replace(/\s*\(.*\)/, "") : "--";
    var indicators = [
      {
        icon: "\ud83d\udce1",
        label: t("devices.wifi"),
        value: wifiVal,
      },
      {
        icon: "\ud83c\udf21",
        label: "CPU Temp",
        value: h.cpuTemp || h.CPU_temp || "--",
      },
      {
        icon: "\ud83d\udcbb",
        label: "CPU Usage",
        value: h.cpuUsage || h.CPU_usage || "--",
      },
      {
        icon: "\ud83d\udcbe",
        label: "Memory",
        value: h.memoryUsage || h.memory_usage || "--",
      },
      {
        icon: "\ud83d\udcbf",
        label: "Disk",
        value: h.diskUsage || h.disk_usage || "--",
      },
      {
        icon: "\u23f1",
        label: t("devices.uptime"),
        value: h.systemRuntime || h.system_runtime || "--",
      },
      {
        icon: "\ud83c\udf21",
        label: "EMS Temp",
        value: h.emsTemp || h.ems_temp || "--",
      },
      {
        icon: "\ud83d\udcf6",
        label: "SIM",
        value: h.simStatus || h.SIM_status || "--",
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
            '<span class="ems-value">' +
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
        '<line x1="140" y1="56" x2="140" y2="120" class="ef-line-pv" marker-end="url(#arrow-pv)"/>',
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
      '<div class="ef-pv ef-node"><div class="ef-node-icon">\u2600\ufe0f</div><div class="ef-node-value">' +
      pvVal +
      '</div><div class="ef-node-label">' +
      t("devices.ef.solarPv") +
      "</div></div>" +
      '<div class="ef-battery ef-node"><div class="ef-node-icon">\ud83d\udd0b</div><div class="ef-node-value">' +
      batVal +
      '</div><div class="ef-node-sub">' +
      batSub +
      "</div></div>" +
      '<div class="ef-center"><div class="ef-center-hub"></div></div>' +
      '<div class="ef-load ef-node"><div class="ef-node-icon">\ud83c\udfe0</div><div class="ef-node-value">' +
      loadVal +
      '</div><div class="ef-node-label">' +
      t("devices.ef.load") +
      "</div></div>" +
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
        label: t("devices.soc"),
        value: state.batterySoc != null ? state.batterySoc + "%" : "--",
      },
      {
        label: t("devices.soh"),
        value: state.batSoh != null ? state.batSoh + "%" : "--",
      },
      {
        label: t("devices.voltage"),
        value:
          state.batteryVoltage != null
            ? formatNumber(state.batteryVoltage, 1) + " V"
            : "--",
      },
      {
        label: t("devices.current"),
        value:
          state.batteryCurrent != null
            ? formatNumber(state.batteryCurrent, 1) + " A"
            : "--",
      },
      {
        label: t("devices.temperature"),
        value:
          state.batteryTemperature != null
            ? state.batteryTemperature + "\u00b0C"
            : "--",
      },
      {
        label: t("devices.chargeRate"),
        value:
          state.batteryPower != null
            ? formatNumber(state.batteryPower, 2) + " kW"
            : "--",
      },
      {
        label: t("devices.maxChargeCurrent"),
        value:
          state.maxChargeCurrent != null ? state.maxChargeCurrent + " A" : "--",
      },
      {
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
          '</span><span class="tele-value">' +
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
        label: t("devices.pvPower"),
        value:
          state.pvPower != null ? formatNumber(state.pvPower, 2) + " kW" : "--",
      },
      {
        label: t("devices.inverterTemp"),
        value:
          state.inverterTemp != null ? state.inverterTemp + "\u00b0C" : "--",
      },
      {
        label: t("devices.gridPower"),
        value:
          state.gridPowerKw != null
            ? formatNumber(state.gridPowerKw, 2) + " kW"
            : "--",
      },
      {
        label: t("devices.gridVoltage"),
        value:
          extra.gridVoltageR != null
            ? formatNumber(extra.gridVoltageR, 1) + " V"
            : "--",
      },
      {
        label: t("devices.gridCurrent"),
        value:
          extra.gridCurrentR != null
            ? formatNumber(extra.gridCurrentR, 1) + " A"
            : "--",
      },
      {
        label: t("devices.powerFactor"),
        value: extra.gridPf != null ? formatNumber(extra.gridPf, 2) : "--",
      },
      {
        label: t("devices.homeLoad"),
        value:
          state.loadPower != null
            ? formatNumber(state.loadPower, 2) + " kW"
            : "--",
      },
      {
        label: t("devices.totalBuy"),
        value:
          extra.totalBuyKwh != null
            ? formatNumber(extra.totalBuyKwh, 1) + " kWh"
            : "--",
      },
      {
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
          '</span><span class="tele-value">' +
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
        ? "sync-ok"
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

    // --- Schedule editor events (gateway Layer 3) ---
    self._renderScheduleRows();

    var addBtn = document.getElementById("schedule-add-slot");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        var lastEnd =
          self._pendingSlots.length > 0
            ? self._pendingSlots[self._pendingSlots.length - 1].endHour
            : 0;
        if (lastEnd >= 24) lastEnd = 0;
        var newSlot = {
          startHour: lastEnd,
          endHour: Math.min(lastEnd + 6, 24),
          mode: "self_consumption",
        };
        self._pendingSlots = self._pendingSlots.concat([newSlot]);
        self._renderScheduleRows();
        self._attachSlotListeners();
      });
    }

    var scheduleApplyBtn = document.getElementById("schedule-apply");
    if (scheduleApplyBtn) {
      scheduleApplyBtn.addEventListener("click", function () {
        self._handleApplyGW();
      });
    }

    // --- Device chip tab clicks (config card) ---
    document
      .querySelectorAll(".device-chip[data-asset-id]")
      .forEach(function (chip) {
        chip.addEventListener("click", function () {
          self._selectedConfigDevice = chip.dataset.assetId;
          var detail = self._currentDetail;
          var devices = detail.devices || [];
          var config = detail.config || {};
          var container = document.getElementById("config-fields-container");
          if (!container) return;
          // Re-render config card content
          var layer3 = document.getElementById("layer3");
          if (layer3) {
            layer3.innerHTML = self._buildLayer3GW();
            self._setupLayer3Events();
          }
        });
      });

    // --- Config apply button ---
    var configApplyBtn = document.getElementById("config-apply");
    if (configApplyBtn) {
      configApplyBtn.addEventListener("click", function () {
        self._handleConfigApply();
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
