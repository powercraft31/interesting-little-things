/* ============================================
   SOLFACIL Admin Portal — P4: HEMS Control (v6.0)
   Three-step batch dispatch flow:
     Step 1: Mode selection + parameters
     Step 2: Gateway selection
     Step 3: Preview + dispatch + history
   ============================================ */

var HEMSPage = {
  _currentStep: 1,
  _selectedMode: null,
  _socMinLimit: 20,
  _socMaxLimit: 95,
  _gridImportLimitKw: 50,
  _arbGrid: null, // 24-element array: 'charge'|'discharge'|null
  _arbBrush: "charge",
  _gateways: null,
  _selectedGateways: {},
  _batchHistory: null,
  _overview: null,

  // Mode metadata
  _modeKeys: {
    self_consumption: {
      icon: "\u2600\uFE0F",
      titleKey: "hems.mode.selfCons",
      descKey: "hems.mode.selfCons.desc",
      borderColor: "var(--positive)",
    },
    peak_shaving: {
      icon: "\u26A1",
      titleKey: "hems.mode.peak",
      descKey: "hems.mode.peak.desc",
      borderColor: "var(--neutral)",
    },
    peak_valley_arbitrage: {
      icon: "\uD83D\uDCCA",
      titleKey: "hems.mode.arb",
      descKey: "hems.mode.arb.desc",
      borderColor: "var(--accent)",
    },
  },

  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  init: function () {
    var self = this;
    var container = document.getElementById("hems-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();
    self._arbGrid = [];
    for (var i = 0; i < 24; i++) self._arbGrid.push(null);

    Promise.all([
      DataSource.hems.overview(),
      DataSource.devices.gateways(),
      DataSource.hems.batchHistory(20),
    ])
      .then(function (results) {
        self._overview = results[0];
        self._gateways = results[1];
        self._batchHistory = results[2] ? results[2].batches || [] : [];
        container.innerHTML = self._buildContent();
        self._setupStepListeners();
      })
      .catch(function (err) {
        if (typeof showErrorBoundary === "function") {
          showErrorBoundary("hems-content", err);
        }
      });
  },

  onRoleChange: function () {
    this.init();
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
    ].join("");
  },

  // =========================================================
  // MAIN CONTENT
  // =========================================================

  _buildContent: function () {
    return [
      this._buildStepIndicator(),
      '<div id="p4-step-container">',
      this._buildCurrentStep(),
      "</div>",
    ].join("");
  },

  _buildStepIndicator: function () {
    var steps = [
      { num: 1, label: t("hems.step1") || "Modo & Parâmetros" },
      { num: 2, label: t("hems.step2") || "Gateways" },
      { num: 3, label: t("hems.step3") || "Confirmar & Enviar" },
    ];
    var self = this;
    var items = steps
      .map(function (s) {
        var cls = "p4-step-item";
        if (s.num === self._currentStep) cls += " p4-step-active";
        if (s.num < self._currentStep) cls += " p4-step-done";
        return (
          '<div class="' +
          cls +
          '"><span class="p4-step-num">' +
          s.num +
          "</span><span>" +
          s.label +
          "</span></div>"
        );
      })
      .join('<div class="p4-step-divider"></div>');

    return '<div class="p4-step-indicator">' + items + "</div>";
  },

  _buildCurrentStep: function () {
    if (this._currentStep === 1) return this._buildStep1();
    if (this._currentStep === 2) return this._buildStep2();
    return this._buildStep3();
  },

  // =========================================================
  // STEP 1 — Mode Selection + Parameters
  // =========================================================

  _buildStep1: function () {
    var self = this;
    var modes = Object.keys(this._modeKeys);

    var cards = modes
      .map(function (modeKey) {
        var meta = self._modeKeys[modeKey];
        var selected = self._selectedMode === modeKey ? " selected" : "";
        return [
          '<div class="p4-mode-card' + selected + '"',
          ' data-mode="' + modeKey + '"',
          ' style="--mode-border: ' + meta.borderColor + '">',
          '<div class="p4-mode-icon">' + meta.icon + "</div>",
          '<div class="p4-mode-title">' + t(meta.titleKey) + "</div>",
          '<div class="p4-mode-desc">' + t(meta.descKey) + "</div>",
          self._selectedMode === modeKey
            ? '<div class="p4-mode-check">\u2713</div>'
            : "",
          "</div>",
        ].join("");
      })
      .join("");

    // SoC parameters
    var socPanel = [
      '<div class="p4-param-panel">',
      '<h4>' + (t("hems.socParams") || "Parâmetros SoC") + "</h4>",
      '<div class="p4-param-row">',
      '<label>SoC Mínimo (%): <strong id="p4-soc-min-val">' +
        this._socMinLimit +
        "</strong></label>",
      '<input type="range" id="p4-soc-min" min="5" max="50" value="' +
        this._socMinLimit +
        '">',
      "</div>",
      '<div class="p4-param-row">',
      '<label>SoC Máximo (%): <strong id="p4-soc-max-val">' +
        this._socMaxLimit +
        "</strong></label>",
      '<input type="range" id="p4-soc-max" min="70" max="100" value="' +
        this._socMaxLimit +
        '">',
      "</div>",
      "</div>",
    ].join("");

    // Peak shaving params (only shown when peak_shaving selected)
    var peakPanel = "";
    if (this._selectedMode === "peak_shaving") {
      peakPanel = [
        '<div class="p4-param-panel">',
        '<h4>' + (t("hems.peakParams") || "Limite de Demanda") + "</h4>",
        '<div class="p4-param-row">',
        '<label>Grid Import Limit (kW):</label>',
        '<input type="number" id="p4-grid-limit" min="0" step="1" value="' +
          this._gridImportLimitKw +
          '" style="width:100px">',
        "</div>",
        "</div>",
      ].join("");
    }

    // Arbitrage editor (only shown when arb selected)
    var arbEditor = "";
    if (this._selectedMode === "peak_valley_arbitrage") {
      arbEditor = this._buildArbEditor();
    }

    var nextDisabled = this._validateStep1() ? "" : " disabled";

    return [
      '<div class="section-card">',
      '<div class="section-card-header"><h3>' +
        (t("hems.step1Title") || "Selecionar Modo") +
        "</h3></div>",
      '<div class="section-card-body">',
      '<div class="p4-mode-cards">' + cards + "</div>",
      socPanel,
      peakPanel,
      arbEditor,
      '<div class="p4-nav-buttons">',
      '<button id="p4-btn-next" class="btn btn-primary"' +
        nextDisabled +
        ">" +
        (t("hems.next") || "Próximo") +
        "</button>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  _buildArbEditor: function () {
    var self = this;
    var hours = [];
    for (var h = 0; h < 24; h++) {
      var val = self._arbGrid[h];
      var cls = "p4-arb-cell";
      if (val === "charge") cls += " p4-arb-charge";
      if (val === "discharge") cls += " p4-arb-discharge";
      var label = h < 10 ? "0" + h : "" + h;
      hours.push(
        '<div class="' +
          cls +
          '" data-hour="' +
          h +
          '"><span>' +
          label +
          "</span></div>",
      );
    }

    var filledCount = 0;
    for (var j = 0; j < 24; j++) {
      if (self._arbGrid[j]) filledCount++;
    }

    var templates = [
      '<div class="p4-arb-templates">',
      '<button class="btn btn-sm" data-template="enel">' +
        (t("hems.tplEnel") || "Enel SP") +
        "</button>",
      '<button class="btn btn-sm" data-template="night">' +
        (t("hems.tplNight") || "Carga Noturna") +
        "</button>",
      '<button class="btn btn-sm" data-template="double">' +
        (t("hems.tplDouble") || "Dupla Carga") +
        "</button>",
      '<button class="btn btn-sm" data-template="clear">' +
        (t("hems.tplClear") || "Limpar") +
        "</button>",
      "</div>",
    ].join("");

    return [
      '<div class="p4-param-panel">',
      '<h4>' +
        (t("hems.arbTitle") || "Horários de Carga/Descarga") +
        " (" +
        filledCount +
        "/24)</h4>",
      '<div class="p4-arb-brush">',
      '<label><input type="radio" name="p4-brush" value="charge"' +
        (self._arbBrush === "charge" ? " checked" : "") +
        "> " +
        (t("hems.charge") || "Carga") +
        "</label>",
      '<label><input type="radio" name="p4-brush" value="discharge"' +
        (self._arbBrush === "discharge" ? " checked" : "") +
        "> " +
        (t("hems.discharge") || "Descarga") +
        "</label>",
      "</div>",
      '<div class="p4-arb-grid">' + hours.join("") + "</div>",
      templates,
      "</div>",
    ].join("");
  },

  _applyArbTemplate: function (name) {
    var grid = this._arbGrid;
    var i;
    if (name === "clear") {
      for (i = 0; i < 24; i++) grid[i] = null;
    } else if (name === "enel") {
      // Enel SP: charge 0-6, 9-17; discharge 6-9, 17-24
      for (i = 0; i < 24; i++) {
        if ((i >= 0 && i < 6) || (i >= 9 && i < 17)) grid[i] = "charge";
        else grid[i] = "discharge";
      }
    } else if (name === "night") {
      // Night charge: charge 0-6; discharge 6-24
      for (i = 0; i < 24; i++) {
        grid[i] = i < 6 ? "charge" : "discharge";
      }
    } else if (name === "double") {
      // Double charge: charge 0-6 & 12-17; discharge 6-12 & 17-24
      for (i = 0; i < 24; i++) {
        if ((i >= 0 && i < 6) || (i >= 12 && i < 17)) grid[i] = "charge";
        else grid[i] = "discharge";
      }
    }
    this._renderStep();
  },

  _validateStep1: function () {
    if (!this._selectedMode) return false;
    if (this._selectedMode === "peak_valley_arbitrage") {
      for (var i = 0; i < 24; i++) {
        if (!this._arbGrid[i]) return false;
      }
    }
    return true;
  },

  // =========================================================
  // STEP 2 — Gateway Selection
  // =========================================================

  _buildStep2: function () {
    var self = this;
    var gateways = this._gateways || [];

    var rows = gateways
      .map(function (gw) {
        var checked = self._selectedGateways[gw.gatewayId] ? " checked" : "";
        var statusCls =
          gw.status === "online"
            ? "status-badge-online"
            : "status-badge-offline";
        var statusText = gw.status === "online" ? "Online" : "Offline";
        return [
          "<tr>",
          '<td><input type="checkbox" class="p4-gw-check" data-gw="' +
            gw.gatewayId +
            '"' +
            checked +
            "></td>",
          "<td>" + gw.gatewayId + "</td>",
          "<td>" + (gw.name || "\u2014") + "</td>",
          '<td><span class="' +
            statusCls +
            '">' +
            statusText +
            "</span></td>",
          "<td>" + (gw.deviceCount != null ? gw.deviceCount : "\u2014") + "</td>",
          "<td>" +
            (gw.lastSeenAt
              ? typeof formatISODateTime === "function"
                ? formatISODateTime(gw.lastSeenAt)
                : gw.lastSeenAt
              : "\u2014") +
            "</td>",
          "</tr>",
        ].join("");
      })
      .join("");

    var allChecked =
      gateways.length > 0 &&
      gateways.every(function (gw) {
        return self._selectedGateways[gw.gatewayId];
      });

    var selectedCount = Object.keys(this._selectedGateways).filter(function (k) {
      return self._selectedGateways[k];
    }).length;

    return [
      '<div class="section-card">',
      '<div class="section-card-header"><h3>' +
        (t("hems.step2Title") || "Selecionar Gateways") +
        " (" +
        selectedCount +
        "/" +
        gateways.length +
        ")</h3></div>",
      '<div class="section-card-body">',
      '<div class="table-wrapper"><table class="data-table">',
      "<thead><tr>",
      '<th><input type="checkbox" id="p4-gw-all"' +
        (allChecked ? " checked" : "") +
        "></th>",
      "<th>Gateway ID</th>",
      "<th>" + (t("hems.home") || "Residência") + "</th>",
      "<th>Status</th>",
      "<th>" + (t("hems.devices") || "Dispositivos") + "</th>",
      "<th>" + (t("hems.lastSync") || "Último Sync") + "</th>",
      "</tr></thead>",
      "<tbody>" + rows + "</tbody>",
      "</table></div>",
      '<div class="p4-nav-buttons">',
      '<button id="p4-btn-prev" class="btn">' +
        (t("hems.prev") || "Anterior") +
        "</button>",
      '<button id="p4-btn-next" class="btn btn-primary"' +
        (selectedCount === 0 ? " disabled" : "") +
        ">" +
        (t("hems.next") || "Próximo") +
        "</button>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  // =========================================================
  // STEP 3 — Preview + Dispatch + History
  // =========================================================

  _buildStep3: function () {
    var self = this;
    var modeMeta = this._modeKeys[this._selectedMode] || {};
    var modeTitle = t(modeMeta.titleKey) || this._selectedMode;
    var selectedIds = this._getSelectedGatewayIds();

    // Config summary
    var configSummary = [
      '<div class="p4-config-summary">',
      "<div><strong>" +
        (t("hems.mode") || "Modo") +
        ":</strong> " +
        (modeMeta.icon || "") +
        " " +
        modeTitle +
        "</div>",
      "<div><strong>SoC:</strong> " +
        this._socMinLimit +
        "% \u2013 " +
        this._socMaxLimit +
        "%</div>",
    ];

    if (this._selectedMode === "peak_shaving") {
      configSummary.push(
        "<div><strong>Grid Import Limit:</strong> " +
          this._gridImportLimitKw +
          " kW</div>",
      );
    }

    if (this._selectedMode === "peak_valley_arbitrage") {
      configSummary.push(
        "<div><strong>" +
          (t("hems.arbSlots") || "Horários") +
          ":</strong> " +
          this._buildArbSummary() +
          "</div>",
      );
    }

    configSummary.push(
      "<div><strong>" +
        (t("hems.gwCount") || "Gateways") +
        ":</strong> " +
        selectedIds.length +
        "</div>",
      "</div>",
    );

    // Gateway list preview
    var gwPreview = selectedIds
      .map(function (gwId) {
        var gw = (self._gateways || []).filter(function (g) {
          return g.gatewayId === gwId;
        })[0];
        var name = gw ? gw.name || gwId : gwId;
        var status = gw ? gw.status : "unknown";
        return (
          "<div>" +
          name +
          ' <span class="' +
          (status === "online"
            ? "status-badge-online"
            : "status-badge-offline") +
          '">' +
          status +
          "</span></div>"
        );
      })
      .join("");

    // Batch history
    var historyHtml = this._buildBatchHistory();

    return [
      '<div class="section-card">',
      '<div class="section-card-header"><h3>' +
        (t("hems.step3Title") || "Confirmar & Enviar") +
        "</h3></div>",
      '<div class="section-card-body">',
      configSummary.join(""),
      '<div class="p4-gw-preview"><h4>' +
        (t("hems.selectedGw") || "Gateways Selecionados") +
        "</h4>" +
        gwPreview +
        "</div>",
      '<div class="p4-nav-buttons">',
      '<button id="p4-btn-prev" class="btn">' +
        (t("hems.prev") || "Anterior") +
        "</button>",
      '<button id="p4-btn-dispatch" class="btn btn-primary">' +
        (t("hems.dispatch") || "Enviar") +
        "</button>",
      "</div>",
      "</div>",
      "</div>",
      historyHtml,
    ].join("");
  },

  _buildArbSummary: function () {
    var slots = this._buildArbSlots();
    return slots
      .map(function (s) {
        var label = s.action === "charge" ? "Carga" : "Descarga";
        return (
          s.startHour + ":00\u2013" + s.endHour + ":00 " + label
        );
      })
      .join(", ");
  },

  _buildArbSlots: function () {
    var slots = [];
    var grid = this._arbGrid;
    var i = 0;
    while (i < 24) {
      var action = grid[i];
      if (!action) {
        i++;
        continue;
      }
      var start = i;
      while (i < 24 && grid[i] === action) i++;
      slots.push({ startHour: start, endHour: i, action: action });
    }
    return slots;
  },

  _buildBatchHistory: function () {
    var batches = this._batchHistory || [];
    if (batches.length === 0) {
      return [
        '<div class="section-card" style="margin-top:var(--space-lg)">',
        '<div class="section-card-header"><h3>' +
          (t("hems.history") || "Histórico de Operações") +
          "</h3></div>",
        '<div class="section-card-body">',
        '<div class="empty-state-detail">' +
          (t("hems.noHistory") || "Nenhuma operação anterior") +
          "</div>",
        "</div></div>",
      ].join("");
    }

    var rows = batches
      .map(function (b) {
        var modeLabel = "\u2014";
        if (b.samplePayload && b.samplePayload.slots) {
          var firstSlot = b.samplePayload.slots[0];
          if (firstSlot) modeLabel = firstSlot.mode || "\u2014";
        }
        var time =
          typeof formatISODateTime === "function"
            ? formatISODateTime(b.dispatchedAt)
            : b.dispatchedAt;
        return [
          "<tr>",
          "<td>" + time + "</td>",
          "<td>" + (b.source || "p4") + "</td>",
          "<td>" + modeLabel + "</td>",
          "<td>" + b.total + "</td>",
          "<td>" + b.successCount + "</td>",
          "<td>" + b.failedCount + "</td>",
          "</tr>",
        ].join("");
      })
      .join("");

    return [
      '<div class="section-card" style="margin-top:var(--space-lg)">',
      '<div class="section-card-header"><h3>' +
        (t("hems.history") || "Histórico de Operações") +
        "</h3></div>",
      '<div class="section-card-body">',
      '<div class="table-wrapper"><table class="data-table">',
      "<thead><tr>",
      "<th>" + (t("hems.time") || "Data/Hora") + "</th>",
      "<th>" + (t("hems.source") || "Origem") + "</th>",
      "<th>" + (t("hems.mode") || "Modo") + "</th>",
      "<th>Total</th>",
      "<th>" + (t("hems.success") || "Sucesso") + "</th>",
      "<th>" + (t("hems.failed") || "Falha") + "</th>",
      "</tr></thead>",
      "<tbody>" + rows + "</tbody>",
      "</table></div>",
      "</div></div>",
    ].join("");
  },

  // =========================================================
  // NAVIGATION
  // =========================================================

  _renderStep: function () {
    var container = document.getElementById("hems-content");
    if (!container) return;
    container.innerHTML = this._buildContent();
    this._setupStepListeners();
  },

  _nextStep: function () {
    if (this._currentStep === 1 && !this._validateStep1()) return;
    if (this._currentStep === 2 && this._getSelectedGatewayIds().length === 0)
      return;
    if (this._currentStep < 3) {
      this._currentStep++;
      this._renderStep();
    }
  },

  _prevStep: function () {
    if (this._currentStep > 1) {
      this._currentStep--;
      this._renderStep();
    }
  },

  _getSelectedGatewayIds: function () {
    var self = this;
    return Object.keys(this._selectedGateways).filter(function (k) {
      return self._selectedGateways[k];
    });
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupStepListeners: function () {
    var self = this;

    // Step navigation
    var nextBtn = document.getElementById("p4-btn-next");
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        self._nextStep();
      });
    }

    var prevBtn = document.getElementById("p4-btn-prev");
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        self._prevStep();
      });
    }

    // Step 1: Mode card clicks
    if (this._currentStep === 1) {
      document.querySelectorAll(".p4-mode-card").forEach(function (card) {
        card.addEventListener("click", function () {
          self._selectedMode = card.dataset.mode;
          self._renderStep();
        });
      });

      // SoC sliders
      var socMinSlider = document.getElementById("p4-soc-min");
      if (socMinSlider) {
        socMinSlider.addEventListener("input", function () {
          self._socMinLimit = parseInt(this.value, 10);
          var display = document.getElementById("p4-soc-min-val");
          if (display) display.textContent = self._socMinLimit;
        });
      }

      var socMaxSlider = document.getElementById("p4-soc-max");
      if (socMaxSlider) {
        socMaxSlider.addEventListener("input", function () {
          self._socMaxLimit = parseInt(this.value, 10);
          var display = document.getElementById("p4-soc-max-val");
          if (display) display.textContent = self._socMaxLimit;
        });
      }

      // Grid import limit
      var gridLimitInput = document.getElementById("p4-grid-limit");
      if (gridLimitInput) {
        gridLimitInput.addEventListener("change", function () {
          self._gridImportLimitKw = parseInt(this.value, 10) || 50;
        });
      }

      // Arb brush radio
      document
        .querySelectorAll('input[name="p4-brush"]')
        .forEach(function (radio) {
          radio.addEventListener("change", function () {
            self._arbBrush = this.value;
          });
        });

      // Arb grid cells — click to paint
      var isMouseDown = false;
      document.querySelectorAll(".p4-arb-cell").forEach(function (cell) {
        cell.addEventListener("mousedown", function (e) {
          e.preventDefault();
          isMouseDown = true;
          var h = parseInt(cell.dataset.hour, 10);
          self._arbGrid[h] = self._arbBrush;
          self._renderStep();
        });
        cell.addEventListener("mouseenter", function () {
          if (!isMouseDown) return;
          var h = parseInt(cell.dataset.hour, 10);
          self._arbGrid[h] = self._arbBrush;
          self._updateArbCellVisual(cell, self._arbBrush);
        });
      });
      document.addEventListener("mouseup", function () {
        if (isMouseDown) {
          isMouseDown = false;
          self._renderStep();
        }
      });

      // Arb templates
      document
        .querySelectorAll("[data-template]")
        .forEach(function (btn) {
          btn.addEventListener("click", function () {
            self._applyArbTemplate(btn.dataset.template);
          });
        });
    }

    // Step 2: Gateway checkboxes
    if (this._currentStep === 2) {
      var allCheck = document.getElementById("p4-gw-all");
      if (allCheck) {
        allCheck.addEventListener("change", function () {
          var checked = this.checked;
          (self._gateways || []).forEach(function (gw) {
            self._selectedGateways[gw.gatewayId] = checked;
          });
          self._renderStep();
        });
      }

      document.querySelectorAll(".p4-gw-check").forEach(function (cb) {
        cb.addEventListener("change", function () {
          self._selectedGateways[cb.dataset.gw] = cb.checked;
          // Update next button state
          var nextBtn2 = document.getElementById("p4-btn-next");
          if (nextBtn2) {
            nextBtn2.disabled =
              self._getSelectedGatewayIds().length === 0;
          }
        });
      });
    }

    // Step 3: Dispatch button
    if (this._currentStep === 3) {
      var dispatchBtn = document.getElementById("p4-btn-dispatch");
      if (dispatchBtn) {
        dispatchBtn.addEventListener("click", function () {
          self._handleDispatch();
        });
      }
    }
  },

  _updateArbCellVisual: function (cell, action) {
    cell.classList.remove("p4-arb-charge", "p4-arb-discharge");
    if (action === "charge") cell.classList.add("p4-arb-charge");
    if (action === "discharge") cell.classList.add("p4-arb-discharge");
  },

  // =========================================================
  // DISPATCH
  // =========================================================

  _handleDispatch: function () {
    var self = this;
    var selectedIds = this._getSelectedGatewayIds();
    if (selectedIds.length === 0) return;

    var modeMeta = this._modeKeys[this._selectedMode] || {};
    var modeTitle = t(modeMeta.titleKey) || this._selectedMode;

    this._showConfirmDialog(
      t("hems.confirmTitle") || "Confirmar Envio",
      (t("hems.confirmMsg") || "Enviar {mode} para {n} gateways?")
        .replace("{mode}", modeTitle)
        .replace("{n}", selectedIds.length),
      function () {
        self._executeDispatch(selectedIds);
      },
    );
  },

  _executeDispatch: function (gatewayIds) {
    var self = this;

    var dispatchBtn = document.getElementById("p4-btn-dispatch");
    if (dispatchBtn) {
      dispatchBtn.disabled = true;
      dispatchBtn.textContent = t("hems.dispatching") || "Enviando...";
    }

    self._showToast(t("hems.toast.dispatching") || "Enviando comandos...", "info");

    var params = {
      mode: self._selectedMode,
      socMinLimit: self._socMinLimit,
      socMaxLimit: self._socMaxLimit,
      gatewayIds: gatewayIds,
    };

    if (self._selectedMode === "peak_shaving") {
      params.gridImportLimitKw = self._gridImportLimitKw;
    }

    if (self._selectedMode === "peak_valley_arbitrage") {
      params.arbSlots = self._buildArbSlots();
    }

    DataSource.hems
      .batchDispatch(params)
      .then(function (data) {
        var summary = data.summary || { pending: 0, skipped: 0 };
        self._showToast(
          (t("hems.toast.dispatchDone") ||
            "Enviado! {p} pendente(s), {s} ignorado(s)")
            .replace("{p}", summary.pending)
            .replace("{s}", summary.skipped),
          summary.skipped > 0 ? "warning" : "success",
        );

        // Refresh history
        DataSource.hems
          .batchHistory(20)
          .then(function (histData) {
            self._batchHistory = histData ? histData.batches || [] : [];
            self._renderStep();
          })
          .catch(function () {
            self._renderStep();
          });
      })
      .catch(function (err) {
        self._showToast(
          (t("hems.toast.dispatchError") || "Erro: ") +
            (err.message || "falha no envio"),
          "error",
        );
        if (dispatchBtn) {
          dispatchBtn.disabled = false;
          dispatchBtn.textContent = t("hems.dispatch") || "Enviar";
        }
      });
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
      '<button class="btn" id="p4-confirm-cancel">' +
        (t("shared.cancel") || "Cancelar") +
        "</button>",
      '<button class="btn btn-primary" id="p4-confirm-ok">' +
        (t("shared.confirm") || "Confirmar") +
        "</button>",
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
