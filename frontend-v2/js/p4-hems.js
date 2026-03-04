/* ============================================
   SOLFACIL Admin Portal — P4: HEMS Control
   Optimization mode selection, batch dispatch,
   Tarifa Branca rates, rule application status.
   ============================================ */

var HEMSPage = {
  _selectedMode: null,
  _previewDone: false,
  _previewResult: null,

  // Mode metadata (keys → i18n)
  _modeKeys: {
    self_consumption: {
      icon: "\u2600\uFE0F",
      titleKey: "hems.mode.selfCons",
      descKey: "hems.mode.selfCons.desc",
      borderColor: "var(--positive)",
    },
    peak_valley_arbitrage: {
      icon: "\uD83D\uDCCA",
      titleKey: "hems.mode.arb",
      descKey: "hems.mode.arb.desc",
      borderColor: "var(--accent)",
    },
    peak_shaving: {
      icon: "\u26A1",
      titleKey: "hems.mode.peak",
      descKey: "hems.mode.peak.desc",
      borderColor: "var(--neutral)",
    },
  },

  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  init: function () {
    var container = document.getElementById("hems-content");
    if (!container) return;

    var skeletonHTML = this._buildSkeleton();
    var realHTML = this._buildContent();

    Components.renderWithSkeleton(
      container,
      skeletonHTML,
      realHTML,
      function () {
        HEMSPage._setupEventListeners();
      },
    );
  },

  onRoleChange: function (role) {
    var container = document.getElementById("hems-content");
    if (!container) return;
    // Re-render to update disabled states
    container.innerHTML = this._buildContent();
    this._setupEventListeners();
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return [
      '<div class="p4-mode-cards">',
      '<div class="skeleton" style="height:180px;border-radius:10px"></div>',
      '<div class="skeleton" style="height:180px;border-radius:10px"></div>',
      '<div class="skeleton" style="height:180px;border-radius:10px"></div>',
      "</div>",
      Components.skeletonTable(4),
      '<div class="two-col">',
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonChart(),
      "</div></div>",
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonTable(3),
      "</div></div>",
      "</div>",
    ].join("");
  },

  // =========================================================
  // REAL CONTENT
  // =========================================================

  _buildContent: function () {
    var isAdmin = typeof currentRole !== "undefined" && currentRole === "admin";
    return [
      this._buildModeCards(isAdmin),
      this._buildBatchDispatch(isAdmin),
      '<div class="two-col">',
      this._buildTarifaCard(isAdmin),
      this._buildAckStatusCard(),
      "</div>",
    ].join("");
  },

  // ---- T4.1: Mode Selection Cards ----
  _buildModeCards: function (isAdmin) {
    var dist = DemoStore.get("targetModeDistribution") || MODE_DISTRIBUTION;
    var total =
      dist.self_consumption + dist.peak_valley_arbitrage + dist.peak_shaving;
    var modes = Object.keys(this._modeKeys);
    var self = this;

    var cards = modes
      .map(function (modeKey) {
        var meta = self._modeKeys[modeKey];
        var count = dist[modeKey] || 0;
        var pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
        var selectedAttr = self._selectedMode === modeKey ? " selected" : "";
        var disabledClass = isAdmin ? "" : " p4-mode-disabled";

        return [
          '<div class="p4-mode-card' + disabledClass + selectedAttr + '"',
          ' data-mode="' + modeKey + '"',
          ' style="--mode-border: ' + meta.borderColor + '">',
          '<div class="p4-mode-icon">' + meta.icon + "</div>",
          '<div class="p4-mode-title">' + t(meta.titleKey) + "</div>",
          '<div class="p4-mode-desc">' + t(meta.descKey) + "</div>",
          '<div class="p4-mode-count">',
          '<span class="p4-mode-num">' + count + "</span>",
          '<span class="p4-mode-pct">(' + pct + "%)</span>",
          "</div>",
          '<div class="p4-mode-label">' + t("shared.devices") + "</div>",
          self._selectedMode === modeKey
            ? '<div class="p4-mode-check">\u2713</div>'
            : "",
          "</div>",
        ].join("");
      })
      .join("");

    return [
      '<div class="section-card">',
      '<div class="section-card-header">',
      "<h3>" + t("hems.optMode") + "</h3>",
      !isAdmin ? '<span class="p4-readonly-badge">' + t("hems.readonly") + "</span>" : "",
      "</div>",
      '<div class="section-card-body">',
      '<div class="p4-mode-cards">' + cards + "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  // ---- T4.2: Batch Dispatch ----
  _buildBatchDispatch: function (isAdmin) {
    var disabledAttr = isAdmin ? "" : " disabled";
    var tooltip = isAdmin ? "" : ' title="' + t("hems.requiresAdmin") + '"';

    // Build integrador options
    var intOptions = INTEGRADORES.map(function (ig) {
      return '<option value="' + ig.orgId + '">' + ig.name + "</option>";
    }).join("");

    // Build home options
    var homeOptions = HOMES.map(function (h) {
      return '<option value="' + h.id + '">' + h.name + "</option>";
    }).join("");

    // Build mode options for Current Mode filter
    var self = this;
    var modeFilterOpts = Object.keys(this._modeKeys)
      .map(function (k) {
        return (
          '<option value="' + k + '">' + t(self._modeKeys[k].titleKey) + "</option>"
        );
      })
      .join("");

    // Build target mode radio buttons
    var targetRadios = Object.keys(this._modeKeys)
      .map(function (k) {
        return [
          '<label class="p4-radio-label"' + tooltip + ">",
          "<input",
          ' type="radio"',
          ' name="target-mode"',
          ' value="' + k + '"',
          disabledAttr,
          ">",
          '<span class="p4-radio-text">' +
            self._modeKeys[k].icon +
            " " +
            t(self._modeKeys[k].titleKey) +
            "</span>",
          "</label>",
        ].join("");
      })
      .join("");

    return [
      '<div class="section-card">',
      '<div class="section-card-header">',
      "<h3>" + t("hems.batchDispatch") + "</h3>",
      !isAdmin
        ? '<span class="p4-readonly-badge">' + t("hems.requiresAdmin") + "</span>"
        : "",
      "</div>",
      '<div class="section-card-body">',

      // Filters row
      '<div class="p4-filter-row">',
      '<select id="p4-filter-integrador"' + disabledAttr + tooltip + ">",
      '<option value="">' + t("hems.filter.allInt") + "</option>",
      intOptions,
      "</select>",
      '<select id="p4-filter-home"' + disabledAttr + tooltip + ">",
      '<option value="">' + t("hems.filter.allHomes") + "</option>",
      homeOptions,
      "</select>",
      '<select id="p4-filter-type"' + disabledAttr + tooltip + ">",
      '<option value="">' + t("hems.filter.allTypes") + "</option>",
      '<option value="Inverter + Battery">' + t("dtype.Inverter + Battery") + "</option>",
      '<option value="Smart Meter">' + t("dtype.Smart Meter") + "</option>",
      '<option value="AC">' + t("dtype.AC") + "</option>",
      '<option value="EV Charger">' + t("dtype.EV Charger") + "</option>",
      "</select>",
      '<select id="p4-filter-mode"' + disabledAttr + tooltip + ">",
      '<option value="">' + t("hems.filter.allModes") + "</option>",
      modeFilterOpts,
      "</select>",
      "</div>",

      // Target mode
      '<div class="p4-target-section">',
      '<div class="p4-target-label">' + t("hems.targetMode") + "</div>",
      '<div class="p4-target-radios">' + targetRadios + "</div>",
      "</div>",

      // Action buttons
      '<div class="p4-dispatch-actions">',
      '<button id="p4-btn-preview" class="btn btn-primary"' +
        disabledAttr +
        tooltip +
        ">" + t("hems.preview") + "</button>",
      '<button id="p4-btn-apply" class="btn btn-primary p4-btn-apply" disabled' +
        tooltip +
        ">" + t("hems.apply") + "</button>",
      "</div>",

      // Preview result area
      '<div id="p4-preview-result" class="p4-preview-result"></div>',
      "</div>",
      "</div>",
    ].join("");
  },

  // ---- T4.3: Tarifa Branca Rate Table ----
  _buildTarifaCard: function (isAdmin) {
    var rates = DemoStore.get("tarifaRates") || TARIFA_RATES;

    var body = [
      '<div class="p4-tarifa-table">',
      '<div class="p4-tarifa-row">',
      '<span class="p4-tarifa-label">' + t("hems.disco") + "</span>",
      '<span class="p4-tarifa-value">' + rates.disco + "</span>",
      "</div>",
      '<div class="p4-tarifa-row p4-tarifa-peak">',
      '<span class="p4-tarifa-label">' + t("hems.peak") + " (" + rates.peakHours + ")</span>",
      '<span class="p4-tarifa-value font-data">R$ ' +
        rates.peak.toFixed(2).replace(".", ",") +
        "/kWh</span>",
      "</div>",
      '<div class="p4-tarifa-row p4-tarifa-inter">',
      '<span class="p4-tarifa-label">' + t("hems.intermediate") + " (" +
        rates.intermediateHours +
        ")</span>",
      '<span class="p4-tarifa-value font-data">R$ ' +
        rates.intermediate.toFixed(2).replace(".", ",") +
        "/kWh</span>",
      "</div>",
      '<div class="p4-tarifa-row p4-tarifa-offpeak">',
      '<span class="p4-tarifa-label">' + t("hems.offpeak") + "</span>",
      '<span class="p4-tarifa-value font-data">R$ ' +
        rates.offPeak.toFixed(2).replace(".", ",") +
        "/kWh</span>",
      "</div>",
      '<div class="p4-tarifa-row">',
      '<span class="p4-tarifa-label">' + t("hems.effectiveDate") + "</span>",
      '<span class="p4-tarifa-value">' + rates.effectiveDate + "</span>",
      "</div>",
      "</div>",
      isAdmin
        ? '<button id="p4-btn-edit-tarifa" class="btn" style="margin-top:var(--space-md)">' + t("hems.editRates") + "</button>"
        : "",
    ].join("");

    return Components.sectionCard(t("hems.tarifa"), body);
  },

  // ---- T4.4: ACK Status Panel ----
  _buildAckStatusCard: function () {
    var dispatch = LAST_DISPATCH;
    var self = this;

    var fromLabel = this._modeKeys[dispatch.fromMode]
      ? t(this._modeKeys[dispatch.fromMode].titleKey)
      : dispatch.fromMode;
    var toLabel = this._modeKeys[dispatch.toMode]
      ? t(this._modeKeys[dispatch.toMode].titleKey)
      : dispatch.toMode;

    var summary = [
      '<div class="p4-dispatch-summary">',
      '<div class="p4-dispatch-info">',
      '<span class="p4-dispatch-time">' + t("hems.lastChange") + " " +
        dispatch.timestamp +
        "</span>",
      '<span class="p4-dispatch-detail">' +
        fromLabel +
        " \u2192 " +
        toLabel +
        "</span>",
      '<span class="p4-dispatch-detail">' + t("hems.affected") + " " +
        dispatch.affectedDevices +
        " " + t("shared.devices") + "</span>",
      '<span class="p4-dispatch-detail">' + t("hems.successRate") + " " +
        dispatch.successRate +
        "% (" +
        dispatch.ackList.filter(function (a) {
          return a.status === "ack";
        }).length +
        "/" +
        dispatch.affectedDevices +
        ")</span>",
      "</div>",
      "</div>",
    ].join("");

    var table = Components.dataTable({
      columns: [
        { key: "deviceId", label: t("hems.col.deviceId"), mono: true },
        {
          key: "mode",
          label: t("hems.col.mode"),
          format: function (val) {
            var meta = self._modeKeys[val];
            return meta ? t(meta.titleKey) : val;
          },
        },
        {
          key: "status",
          label: t("hems.col.ack"),
          format: function (val) {
            if (val === "ack")
              return '<span class="p4-ack-ok">' + t("hems.ack.ack") + "</span>";
            if (val === "pending")
              return '<span class="p4-ack-pending">' + t("hems.ack.pending") + "</span>";
            return '<span class="p4-ack-timeout">' + t("hems.ack.timeout") + "</span>";
          },
        },
        {
          key: "responseTime",
          label: t("hems.col.responseTime"),
          align: "right",
          mono: true,
        },
      ],
      rows: dispatch.ackList,
    });

    var link =
      '<div class="p4-view-link"><a href="#energy" id="p4-link-energy">' + t("hems.viewBehavior") + "</a></div>";

    return Components.sectionCard(
      t("hems.ackStatus"),
      summary + table + link,
    );
  },

  // =========================================================
  // MODE CARD LISTENER (shared helper — avoids duplication)
  // =========================================================

  _attachModeCardListeners: function () {
    var self = this;
    document
      .querySelectorAll(".p4-mode-card:not(.p4-mode-disabled)")
      .forEach(function (card) {
        card.addEventListener("click", function () {
          var mode = card.dataset.mode;
          self._selectedMode = mode;

          // Update card visuals
          document.querySelectorAll(".p4-mode-card").forEach(function (c) {
            c.removeAttribute("selected");
            var check = c.querySelector(".p4-mode-check");
            if (check) check.remove();
          });
          card.setAttribute("selected", "");
          var checkEl = document.createElement("div");
          checkEl.className = "p4-mode-check";
          checkEl.textContent = "\u2713";
          card.appendChild(checkEl);

          // Sync: also select the matching target-mode radio
          var radio = document.querySelector(
            'input[name="target-mode"][value="' + mode + '"]',
          );
          if (radio) radio.checked = true;
        });
      });
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupEventListeners: function () {
    var self = this;
    var isAdmin = typeof currentRole !== "undefined" && currentRole === "admin";

    // Mode card clicks (admin only) — also syncs target radio
    if (isAdmin) {
      self._attachModeCardListeners();
    }

    // Preview button
    var previewBtn = document.getElementById("p4-btn-preview");
    if (previewBtn && isAdmin) {
      previewBtn.addEventListener("click", function () {
        self._handlePreview();
      });
    }

    // Apply button
    var applyBtn = document.getElementById("p4-btn-apply");
    if (applyBtn && isAdmin) {
      applyBtn.addEventListener("click", function () {
        self._handleApply();
      });
    }

    // Edit tarifa button
    var editBtn = document.getElementById("p4-btn-edit-tarifa");
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        self._showTarifaModal();
      });
    }

    // Energy link
    var energyLink = document.getElementById("p4-link-energy");
    if (energyLink) {
      energyLink.addEventListener("click", function (e) {
        e.preventDefault();
        navigateTo("energy");
      });
    }
  },

  // =========================================================
  // BATCH DISPATCH LOGIC
  // =========================================================

  _getSelectedTargetMode: function () {
    var checked = document.querySelector('input[name="target-mode"]:checked');
    return checked ? checked.value : null;
  },

  _getFilteredDevices: function () {
    var filtOrg = document.getElementById("p4-filter-integrador");
    var filtHome = document.getElementById("p4-filter-home");
    var filtType = document.getElementById("p4-filter-type");
    var filtMode = document.getElementById("p4-filter-mode");

    var orgVal = filtOrg ? filtOrg.value : "";
    var homeVal = filtHome ? filtHome.value : "";
    var typeVal = filtType ? filtType.value : "";
    var modeVal = filtMode ? filtMode.value : "";

    var devices = DEVICES.slice();

    if (orgVal) {
      devices = devices.filter(function (d) {
        return d.orgId === orgVal;
      });
    }
    if (homeVal) {
      devices = devices.filter(function (d) {
        return d.homeId === homeVal;
      });
    }
    if (typeVal) {
      devices = devices.filter(function (d) {
        return d.type === typeVal;
      });
    }
    // Mode filter: we simulate device modes by distributing across devices
    // For demo, assign modes round-robin based on MODE_DISTRIBUTION
    if (modeVal) {
      var modeAssignment = this._getDeviceModeAssignment();
      devices = devices.filter(function (d) {
        return modeAssignment[d.deviceId] === modeVal;
      });
    }

    return devices;
  },

  _getDeviceModeAssignment: function () {
    // Assign modes to devices based on distribution
    var dist = DemoStore.get("targetModeDistribution") || MODE_DISTRIBUTION;
    var assignment = {};
    var modes = [];

    // Build flat array of modes matching distribution counts
    var modeKeysList = [
      "self_consumption",
      "peak_valley_arbitrage",
      "peak_shaving",
    ];
    modeKeysList.forEach(function (m) {
      for (var i = 0; i < (dist[m] || 0); i++) {
        modes.push(m);
      }
    });

    // Assign to devices in order
    DEVICES.forEach(function (d, idx) {
      assignment[d.deviceId] = modes[idx % modes.length] || "self_consumption";
    });

    return assignment;
  },

  _handlePreview: function () {
    var targetMode = this._getSelectedTargetMode();
    if (!targetMode) {
      this._showToast(t("hems.toast.selectMode"), "warning");
      return;
    }

    var devices = this._getFilteredDevices();
    if (devices.length === 0) {
      this._showToast(t("hems.toast.noDevices"), "warning");
      return;
    }

    // Group by home
    var homeGroups = {};
    devices.forEach(function (d) {
      if (!homeGroups[d.homeName]) homeGroups[d.homeName] = 0;
      homeGroups[d.homeName]++;
    });

    var offlineCount = devices.filter(function (d) {
      return d.status === "offline";
    }).length;

    var targetTitle = t(this._modeKeys[targetMode].titleKey);

    var html = [
      '<div class="p4-preview-box">',
      '<div class="p4-preview-summary">',
      t("hems.previewWillChange") + " <strong>" +
        devices.length +
        "</strong> " + t("hems.previewDevicesTo") + " <strong>" +
        targetTitle +
        "</strong>.",
      "</div>",
      '<div class="p4-preview-breakdown">',
    ];

    Object.keys(homeGroups).forEach(function (home) {
      html.push(
        "<div>" +
          home +
          ": <strong>" +
          homeGroups[home] +
          " " + t("shared.devices") + "</strong></div>",
      );
    });

    html.push("</div>");

    if (offlineCount > 0) {
      html.push(
        '<div class="p4-preview-warning">\u26A0\uFE0F ' +
          offlineCount +
          " " + t("hems.previewOfflineWarn") + "</div>",
      );
    }

    html.push("</div>");

    var resultEl = document.getElementById("p4-preview-result");
    if (resultEl) resultEl.innerHTML = html.join("");

    this._previewDone = true;
    this._previewResult = { devices: devices, targetMode: targetMode };

    var applyBtn = document.getElementById("p4-btn-apply");
    if (applyBtn) applyBtn.disabled = false;
  },

  _handleApply: function () {
    if (!this._previewDone || !this._previewResult) return;

    var self = this;
    var count = this._previewResult.devices.length;
    var targetTitle = t(this._modeKeys[this._previewResult.targetMode].titleKey);

    // Show confirm dialog
    this._showConfirmDialog(
      t("hems.confirmTitle"),
      t("hems.confirmMsg").replace("{n}", count).replace("{mode}", targetTitle),
      function () {
        // Mock 2s delay then success
        self._showToast(t("hems.toast.dispatching"), "info");

        var applyBtn = document.getElementById("p4-btn-apply");
        if (applyBtn) {
          applyBtn.disabled = true;
          applyBtn.textContent = t("hems.applying");
        }

        setTimeout(function () {
          // Update DemoStore distribution
          var newDist = Object.assign(
            {},
            DemoStore.get("targetModeDistribution") || MODE_DISTRIBUTION,
          );
          // Move all filtered devices to target mode
          var perMode = {};
          var assignment = self._getDeviceModeAssignment();
          self._previewResult.devices.forEach(function (d) {
            var oldMode = assignment[d.deviceId];
            if (!perMode[oldMode]) perMode[oldMode] = 0;
            perMode[oldMode]++;
          });

          Object.keys(perMode).forEach(function (m) {
            newDist[m] = Math.max(0, (newDist[m] || 0) - perMode[m]);
          });
          newDist[self._previewResult.targetMode] =
            (newDist[self._previewResult.targetMode] || 0) + count;

          DemoStore.set("targetModeDistribution", newDist);

          self._showToast(
            t("hems.toast.success").replace("{mode}", targetTitle).replace("{n}", count),
            "success",
          );

          if (applyBtn) applyBtn.textContent = t("hems.apply");

          // Reset preview
          self._previewDone = false;
          self._previewResult = null;
          var resultEl = document.getElementById("p4-preview-result");
          if (resultEl) resultEl.innerHTML = "";

          // Re-render mode cards to show updated counts
          self._refreshModeCards();
        }, 2000);
      },
    );
  },

  _refreshModeCards: function () {
    var isAdmin = typeof currentRole !== "undefined" && currentRole === "admin";
    var container = document.querySelector(".p4-mode-cards");
    if (!container) return;

    var parent = container.closest(".section-card");
    if (parent) {
      parent.outerHTML = this._buildModeCards(isAdmin);
      if (isAdmin) this._attachModeCardListeners();
    }
  },

  // =========================================================
  // TARIFA EDIT MODAL
  // =========================================================

  _showTarifaModal: function () {
    var rates = DemoStore.get("tarifaRates") || TARIFA_RATES;
    var self = this;

    var modalHTML = [
      '<div id="p4-tarifa-modal" class="modal-overlay active">',
      '<div class="modal-content">',
      "<h3>" + t("hems.editTarifaTitle") + "</h3>",
      '<div class="p4-modal-form">',

      '<div class="p4-form-group">',
      "<label>" + t("hems.modal.disco") + "</label>",
      '<input type="text" id="p4-edit-disco" value="' + rates.disco + '">',
      "</div>",

      '<div class="p4-form-group">',
      "<label>" + t("hems.modal.peak") + "</label>",
      '<input type="number" id="p4-edit-peak" step="0.01" value="' +
        rates.peak +
        '">',
      "</div>",

      '<div class="p4-form-group">',
      "<label>" + t("hems.modal.inter") + "</label>",
      '<input type="number" id="p4-edit-inter" step="0.01" value="' +
        rates.intermediate +
        '">',
      "</div>",

      '<div class="p4-form-group">',
      "<label>" + t("hems.modal.offpeak") + "</label>",
      '<input type="number" id="p4-edit-offpeak" step="0.01" value="' +
        rates.offPeak +
        '">',
      "</div>",

      '<div class="p4-form-group">',
      "<label>" + t("hems.modal.date") + "</label>",
      '<input type="text" id="p4-edit-date" value="' +
        rates.effectiveDate +
        '">',
      "</div>",

      "</div>",

      '<div class="modal-actions">',
      '<button class="btn" id="p4-modal-cancel">' + t("shared.cancel") + "</button>",
      '<button class="btn btn-primary" id="p4-modal-save">' + t("shared.save") + "</button>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");

    document.body.insertAdjacentHTML("beforeend", modalHTML);

    document
      .getElementById("p4-modal-cancel")
      .addEventListener("click", function () {
        self._closeTarifaModal();
      });

    document
      .getElementById("p4-modal-save")
      .addEventListener("click", function () {
        var newRates = {
          disco: document.getElementById("p4-edit-disco").value,
          peak: parseFloat(document.getElementById("p4-edit-peak").value) || 0,
          intermediate:
            parseFloat(document.getElementById("p4-edit-inter").value) || 0,
          offPeak:
            parseFloat(document.getElementById("p4-edit-offpeak").value) || 0,
          effectiveDate: document.getElementById("p4-edit-date").value,
          peakHours: rates.peakHours,
          intermediateHours: rates.intermediateHours,
        };

        DemoStore.set("tarifaRates", newRates);
        self._closeTarifaModal();
        self._showToast(t("hems.toast.tarifaUpdated"), "success");

        // Re-render tarifa card
        self._refreshTarifaCard();
      });

    // Close on overlay click
    document
      .getElementById("p4-tarifa-modal")
      .addEventListener("click", function (e) {
        if (e.target.id === "p4-tarifa-modal") {
          self._closeTarifaModal();
        }
      });
  },

  _closeTarifaModal: function () {
    var modal = document.getElementById("p4-tarifa-modal");
    if (modal) modal.remove();
  },

  _refreshTarifaCard: function () {
    var isAdmin = typeof currentRole !== "undefined" && currentRole === "admin";
    // Find the tarifa section card in the two-col layout
    var twoCols = document.querySelectorAll(
      "#hems-content .two-col .section-card",
    );
    if (twoCols.length > 0) {
      twoCols[0].outerHTML = this._buildTarifaCard(isAdmin);
      // Re-attach edit button listener
      var editBtn = document.getElementById("p4-btn-edit-tarifa");
      if (editBtn) {
        var self = this;
        editBtn.addEventListener("click", function () {
          self._showTarifaModal();
        });
      }
    }
  },

  // =========================================================
  // CONFIRM DIALOG
  // =========================================================

  _showConfirmDialog: function (title, message, onConfirm) {
    var html = [
      '<div id="p4-confirm-modal" class="modal-overlay active">',
      '<div class="modal-content">',
      "<h3>" + title + "</h3>",
      "<p>" + message + "</p>",
      '<div class="modal-actions">',
      '<button class="btn" id="p4-confirm-cancel">' + t("shared.cancel") + "</button>",
      '<button class="btn btn-primary" id="p4-confirm-ok">' + t("shared.confirm") + "</button>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");

    document.body.insertAdjacentHTML("beforeend", html);

    document
      .getElementById("p4-confirm-cancel")
      .addEventListener("click", function () {
        var m = document.getElementById("p4-confirm-modal");
        if (m) m.remove();
      });

    document
      .getElementById("p4-confirm-ok")
      .addEventListener("click", function () {
        var m = document.getElementById("p4-confirm-modal");
        if (m) m.remove();
        if (onConfirm) onConfirm();
      });

    // Close on overlay click
    document
      .getElementById("p4-confirm-modal")
      .addEventListener("click", function (e) {
        if (e.target.id === "p4-confirm-modal") {
          var m = document.getElementById("p4-confirm-modal");
          if (m) m.remove();
        }
      });
  },

  // =========================================================
  // TOAST NOTIFICATIONS
  // =========================================================

  _showToast: function (message, type) {
    type = type || "info";

    var toast = document.createElement("div");
    toast.className = "p4-toast p4-toast-" + type;

    var icons = {
      success: "\u2705",
      warning: "\u26A0\uFE0F",
      info: "\u2139\uFE0F",
      error: "\u274C",
    };

    toast.innerHTML =
      '<span class="p4-toast-icon">' +
      (icons[type] || "") +
      "</span>" +
      '<span class="p4-toast-msg">' +
      message +
      "</span>";

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(function () {
      toast.classList.add("p4-toast-show");
    });

    // Auto-remove after 3s
    setTimeout(function () {
      toast.classList.remove("p4-toast-show");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3000);
  },
};
