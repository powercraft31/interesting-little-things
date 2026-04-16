/* ============================================
   SOLFACIL Admin Portal — P4: HEMS Control Workbench (v6.4)
   Four-step single-page workbench:
     Step 1: Strategy selector + parameters
     Step 2: Impact counter strip
     Step 3: Targeting table (selection enabled)
     Step 4: Review panel (Phase 1: dormant placeholder)
   ============================================ */

var HEMSPage = {
  // ── State ──────────────────────────────────────────────
  _mode: null, // 'self_consumption' | 'peak_shaving' | 'peak_valley_arbitrage'
  _socMin: 20,
  _socMax: 95,
  _gridImportLimitKw: 50,
  _arbGrid: null,
  _arbBrush: "charge",

  _gateways: [],
  _selected: {},
  _filters: { integrator: "all", home: "all", status: "all", mode: "all" },
  _batchHistory: [],

  // Mode metadata — i18n keys mapped per mode
  _modeKeys: {
    self_consumption: {
      icon: "\u2600\uFE0F",
      i18nKey: "p4.mode.selfConsumption",
      color: "var(--positive, #2bcc5a)",
    },
    peak_shaving: {
      icon: "\u26A1",
      i18nKey: "p4.mode.peakShaving",
      color: "var(--amber, #f0a820)",
    },
    peak_valley_arbitrage: {
      icon: "\uD83D\uDCCA",
      i18nKey: "p4.mode.peakValleyArbitrage",
      color: "var(--accent, #8b6cf5)",
    },
  },

  // ── Lifecycle ──────────────────────────────────────────
  init: function () {
    this._stopResultsPolling();
    var self = this;
    var container = document.getElementById("hems-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();
    self._arbGrid = [];
    for (var i = 0; i < 24; i++) self._arbGrid.push(null);
    self._selected = {};
    self._mode = null;

    Promise.all([
      DataSource.hems.gatewayTargeting(),
      DataSource.hems.batchHistory(20),
    ])
      .then(function (results) {
        self._gateways = results[0] ? results[0].gateways || [] : [];
        self._batchHistory = results[1] ? results[1].batches || [] : [];
        self._render();
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

  _buildSkeleton: function () {
    return [
      '<div class="hems-wb-skeleton">',
      '<div class="skeleton sk-60 sk-mb-16"></div>',
      '<div class="skeleton sk-120 sk-mb-16"></div>',
      '<div class="skeleton sk-48 sk-mb-16"></div>',
      Components.skeletonTable(5),
      "</div>",
    ].join("");
  },

  // ── Escape helper ─────────────────────────────────────
  _esc: function (str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  // ── Status display helper (A3 rollback to current business rule) ──────
  _normalizedStatus: function (status) {
    return status === "online" ? "online" : "offline";
  },

  _statusLabel: function (status) {
    return t("p4.status." + this._normalizedStatus(status));
  },

  _statusBadgeHtml: function (status) {
    var normalized = this._normalizedStatus(status);
    var label = this._statusLabel(status);
    return '<span class="status-badge-' + normalized + '">' + label + "</span>";
  },

  // ── Full page render ──────────────────────────────────
  _render: function () {
    var container = document.getElementById("hems-content");
    if (!container) return;
    container.innerHTML = [
      this._renderHeader(),
      this._renderStrategy(),
      this._renderImpact(),
      this._renderTargeting(),
      this._renderReview(),
    ].join("");
    this._setupListeners();
  },

  // ── Header ────────────────────────────────────────────
  _renderHeader: function () {
    var modeChip = "";
    if (this._mode) {
      var m = this._modeKeys[this._mode];
      modeChip =
        '<span class="hems-mode-chip" data-mode="' +
        this._mode +
        '">' +
        m.icon +
        " " +
        t(m.i18nKey) +
        "</span>";
    }
    return [
      '<div class="hems-header">',
      "<h2>" + t("p4.title") + "</h2>",
      modeChip,
      "</div>",
      '<div class="hems-instruction">' + t("p4.instruction") + "</div>",
    ].join("");
  },

  // ── Step 1: Strategy Selector ──────────────────────────
  _renderStrategy: function () {
    var self = this;
    var modes = ["self_consumption", "peak_shaving", "peak_valley_arbitrage"];
    var cards = modes
      .map(function (key) {
        var m = self._modeKeys[key];
        var active = self._mode === key ? " active" : "";
        return [
          '<div class="s-card' +
            active +
            '" data-mode="' +
            key +
            '">',
          '<div class="s-card-icon">' + m.icon + "</div>",
          '<div class="s-card-label">' + t(m.i18nKey) + "</div>",
          active ? '<div class="s-card-dot"></div>' : "",
          "</div>",
        ].join("");
      })
      .join("");

    // Parameter strip
    var params = "";
    if (this._mode) {
      var gridSlider = "";
      if (this._mode === "peak_shaving") {
        gridSlider = [
          '<div class="param-item">',
          "<label>" +
            t("p4.grid.importLimit") +
            ': <strong id="hems-grid-val">' +
            this._gridImportLimitKw +
            "</strong></label>",
          '<input type="range" id="hems-grid-limit" min="10" max="80" value="' +
            this._gridImportLimitKw +
            '">',
          "</div>",
        ].join("");
      }
      params = [
        '<div class="params-strip">',
        '<div class="param-item">',
        "<label>" +
          t("p4.soc.min") +
          ': <strong id="hems-soc-min-val">' +
          this._socMin +
          "</strong></label>",
        '<input type="range" id="hems-soc-min" min="5" max="50" value="' +
          this._socMin +
          '">',
        "</div>",
        '<div class="param-item">',
        "<label>" +
          t("p4.soc.max") +
          ': <strong id="hems-soc-max-val">' +
          this._socMax +
          "</strong></label>",
        '<input type="range" id="hems-soc-max" min="70" max="100" value="' +
          this._socMax +
          '">',
        "</div>",
        gridSlider,
        "</div>",
      ].join("");
    }

    // Arb editor
    var arbHtml = "";
    if (this._mode === "peak_valley_arbitrage") {
      arbHtml = this._buildArbEditor();
    }

    return [
      '<div class="hems-step">',
      '<div class="step-num">\u2460</div>',
      "<h3>" + t("p4.step1") + "</h3>",
      '<div class="hems-strategy-row">' + cards + "</div>",
      params,
      arbHtml,
      "</div>",
    ].join("");
  },

  // ── Arb Editor ────────────────────────────────────────
  _buildArbEditor: function () {
    var self = this;
    var cells = [];
    var filledCount = 0;
    for (var h = 0; h < 24; h++) {
      var val = self._arbGrid[h];
      var cls = "arb-cell";
      if (val === "charge") {
        cls += " charge";
        filledCount++;
      } else if (val === "discharge") {
        cls += " discharge";
        filledCount++;
      }
      var label = h < 10 ? "0" + h : "" + h;
      cells.push(
        '<div class="' + cls + '" data-hour="' + h + '">' + label + "</div>",
      );
    }

    return [
      '<div class="arb-section">',
      '<div class="arb-header">',
      "<span>" + t("p4.arb.schedule") + " (" + filledCount + "/24)</span>",
      '<div class="arb-brush-group">',
      '<label class="arb-brush-label' +
        (self._arbBrush === "charge" ? " active" : "") +
        '">',
      '<input type="radio" name="hems-brush" value="charge"' +
        (self._arbBrush === "charge" ? " checked" : "") +
        "> " +
        t("p4.arb.charge"),
      "</label>",
      '<label class="arb-brush-label' +
        (self._arbBrush === "discharge" ? " active" : "") +
        '">',
      '<input type="radio" name="hems-brush" value="discharge"' +
        (self._arbBrush === "discharge" ? " checked" : "") +
        "> " +
        t("p4.arb.discharge"),
      "</label>",
      "</div>",
      "</div>",
      '<div class="arb-grid">' + cells.join("") + "</div>",
      '<div class="arb-templates">',
      '<button class="btn btn-sm" data-template="enel">' +
        t("p4.arb.tpl.enelSp") +
        "</button>",
      '<button class="btn btn-sm" data-template="night">' +
        t("p4.arb.tpl.night") +
        "</button>",
      '<button class="btn btn-sm" data-template="double">' +
        t("p4.arb.tpl.double") +
        "</button>",
      '<button class="btn btn-sm" data-template="clear">' +
        t("p4.arb.tpl.clear") +
        "</button>",
      "</div>",
      filledCount < 24
        ? '<div class="arb-hint">' + t("p4.arb.hint") + "</div>"
        : "",
      "</div>",
    ].join("");
  },

  _applyArbTemplate: function (name) {
    var grid = this._arbGrid;
    var i;
    if (name === "clear") {
      for (i = 0; i < 24; i++) grid[i] = null;
    } else if (name === "enel") {
      for (i = 0; i < 24; i++) {
        if ((i >= 0 && i < 6) || (i >= 9 && i < 17)) grid[i] = "charge";
        else grid[i] = "discharge";
      }
    } else if (name === "night") {
      for (i = 0; i < 24; i++) {
        grid[i] = i < 6 ? "charge" : "discharge";
      }
    } else if (name === "double") {
      for (i = 0; i < 24; i++) {
        if ((i >= 0 && i < 6) || (i >= 12 && i < 17)) grid[i] = "charge";
        else grid[i] = "discharge";
      }
    }
    this._render();
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

  _isArbComplete: function () {
    for (var i = 0; i < 24; i++) {
      if (!this._arbGrid[i]) return false;
    }
    return true;
  },

  // ── Target schedule computation ────────────────────────
  _targetSchedule: function () {
    if (this._mode === "self_consumption") {
      return [{ mode: "self_consumption", startMinute: 0, endMinute: 1440 }];
    }
    if (this._mode === "peak_shaving") {
      return [{ mode: "peak_shaving", startMinute: 0, endMinute: 1440 }];
    }
    if (this._mode === "peak_valley_arbitrage") {
      var slots = [];
      var grid = this._arbGrid;
      var i = 0;
      while (i < 24) {
        if (!grid[i]) {
          i++;
          continue;
        }
        var action = grid[i];
        var start = i;
        while (i < 24 && grid[i] === action) i++;
        slots.push({
          mode: "peak_valley_arbitrage",
          action: action,
          startMinute: start * 60,
          endMinute: i * 60,
        });
      }
      return slots;
    }
    return [];
  },

  // ── Eligibility classification ─────────────────────────
  _classify: function (gw) {
    if (gw.status !== "online") return "offline";
    if (!this._mode) return "no_strategy";
    if (gw.hasActiveCommand) return "conflict";
    if (this._currentMatchesTarget(gw)) return "same";
    return "eligible";
  },

  _currentMatchesTarget: function (gw) {
    if (!this._mode) return false;
    if (!gw.currentMode) return false;
    if (this._mode === "self_consumption" || this._mode === "peak_shaving") {
      return gw.currentMode === this._mode;
    }
    // Arb: deep compare slots
    var target = this._targetSchedule();
    var current = gw.currentSlots;
    if (!current || !target) return false;
    if (current.length !== target.length) return false;
    for (var i = 0; i < current.length; i++) {
      if (current[i].action !== target[i].action) return false;
      if (current[i].startMinute !== target[i].startMinute) return false;
      if (current[i].endMinute !== target[i].endMinute) return false;
    }
    return true;
  },

  _impactCounters: function () {
    var self = this;
    var c = {
      eligible: 0,
      same: 0,
      conflict: 0,
      offline: 0,
      no_strategy: 0,
      selected: 0,
      willChange: 0,
    };
    (this._gateways || []).forEach(function (gw) {
      var cls = self._classify(gw);
      c[cls]++;
      if (self._selected[gw.gatewayId]) {
        c.selected++;
        if (cls === "eligible") c.willChange++;
      }
    });
    return c;
  },

  // ── Step 2: Impact Counter Strip ───────────────────────
  _renderImpact: function () {
    var c = this._impactCounters();
    var onlineCount = (this._gateways || []).filter(function (gw) {
      return gw.status === "online";
    }).length;
    var offlineCount = (this._gateways || []).length - onlineCount;

    // Pre-strategy: show only online/offline totals + hint
    if (!this._mode) {
      return [
        '<div class="hems-step">',
        '<div class="step-num">\u2461</div>',
        "<h3>" + t("p4.step2") + "</h3>",
        '<div class="impact-strip">',
        '<div class="impact-cell"><div class="ic-val">' +
          (this._gateways || []).length +
          '</div><div class="ic-label">Total</div></div>',
        '<div class="impact-cell ic-online"><div class="ic-val">' +
          onlineCount +
          '</div><div class="ic-label">' +
          t("p4.status.online") +
          "</div></div>",
        '<div class="impact-cell ic-offline"><div class="ic-val">' +
          offlineCount +
          '</div><div class="ic-label">' +
          t("p4.status.offline") +
          "</div></div>",
        "</div>",
        '<div class="impact-hint">' + t("p4.noStrategy.hint") + "</div>",
        "</div>",
      ].join("");
    }

    return [
      '<div class="hems-step">',
      '<div class="step-num">\u2461</div>',
      "<h3>" + t("p4.step2") + "</h3>",
      '<div class="impact-strip">',
      '<div class="impact-cell ic-eligible"><div class="ic-val">' +
        c.eligible +
        '</div><div class="ic-label">' +
        t("p4.impact.eligible") +
        "</div></div>",
      '<div class="impact-cell ic-same"><div class="ic-val">' +
        c.same +
        '</div><div class="ic-label">' +
        t("p4.impact.same") +
        "</div></div>",
      '<div class="impact-cell ic-conflict"><div class="ic-val">' +
        c.conflict +
        '</div><div class="ic-label">' +
        t("p4.impact.conflict") +
        "</div></div>",
      '<div class="impact-cell ic-offline"><div class="ic-val">' +
        c.offline +
        '</div><div class="ic-label">' +
        t("p4.impact.offline") +
        "</div></div>",
      '<div class="impact-sep"></div>',
      '<div class="impact-cell ic-selected"><div class="ic-val">' +
        c.selected +
        '</div><div class="ic-label">' +
        t("p4.impact.selected") +
        "</div></div>",
      '<div class="impact-cell ic-willchange"><div class="ic-val">' +
        c.willChange +
        '</div><div class="ic-label">' +
        t("p4.impact.willChange") +
        "</div></div>",
      "</div>",
      "</div>",
    ].join("");
  },

  // ── Mini schedule bar ─────────────────────────────────
  _segmentClass: function (slot) {
    if (slot.mode === "self_consumption") return "seg-self";
    if (slot.mode === "peak_shaving") return "seg-peak";
    if (slot.action === "charge") return "seg-charge";
    if (slot.action === "discharge") return "seg-discharge";
    return "seg-self";
  },

  _segTitle: function (slot) {
    if (slot.mode === "self_consumption") return t("p4.legend.selfConsumption");
    if (slot.mode === "peak_shaving") return t("p4.legend.peakShaving");
    if (slot.action === "charge") return t("p4.legend.charge");
    if (slot.action === "discharge") return t("p4.legend.discharge");
    return "";
  },

  _buildMiniBar: function (slots) {
    if (!slots || slots.length === 0) {
      return '<div class="mini-bar"><span class="seg seg-empty"></span></div>';
    }
    var self = this;
    var totalMinutes = 1440;
    var segs = slots.map(function (s) {
      var hours = Math.max(1, Math.min(24, Math.round((s.endMinute - s.startMinute) / 60)));
      var cls = self._segmentClass(s);
      return (
        '<span class="seg ' +
        cls +
        ' seg-w-' +
        hours +
        '" title="' +
        self._segTitle(s) +
        '"></span>'
      );
    });
    return '<div class="mini-bar">' + segs.join("") + "</div>";
  },

  // ── Filter + visible gateways ─────────────────────────
  _visibleGateways: function () {
    var self = this;
    var f = this._filters;
    return (this._gateways || []).filter(function (gw) {
      if (f.integrator !== "all" && gw.integrator !== f.integrator)
        return false;
      var home = gw.homeAlias || gw.name;
      if (f.home !== "all" && home !== f.home) return false;
      if (f.status !== "all" && self._normalizedStatus(gw.status) !== f.status)
        return false;
      if (f.mode !== "all" && (gw.currentMode || "none") !== f.mode)
        return false;
      return true;
    });
  },

  _uniqueValues: function (key) {
    var self = this;
    var seen = {};
    (this._gateways || []).forEach(function (gw) {
      var val =
        key === "home"
          ? gw.homeAlias || gw.name
          : key === "mode"
            ? gw.currentMode || "none"
            : key === "status"
              ? self._normalizedStatus(gw.status)
              : gw[key];
      if (val) seen[val] = true;
    });
    return Object.keys(seen).sort();
  },

  // ── Selection helpers ─────────────────────────────────
  _getSelectedIds: function () {
    var self = this;
    return Object.keys(this._selected).filter(function (k) {
      return self._selected[k];
    });
  },

  _selectWillChange: function () {
    var self = this;
    this._visibleGateways().forEach(function (gw) {
      if (self._classify(gw) === "eligible") {
        self._selected[gw.gatewayId] = true;
      }
    });
    this._render();
  },

  _selectAllSelectable: function () {
    var self = this;
    this._visibleGateways().forEach(function (gw) {
      var cls = self._classify(gw);
      if (cls === "eligible" || cls === "same") {
        self._selected[gw.gatewayId] = true;
      }
    });
    this._render();
  },

  _clearSelection: function () {
    this._selected = {};
    this._render();
  },

  // ── Reset filters (A2) ────────────────────────────────
  _resetFilters: function () {
    this._filters = {
      integrator: "all",
      home: "all",
      status: "all",
      mode: "all",
    };
    this._render();
  },

  // ── Eligibility badge ─────────────────────────────────
  _badgeHtml: function (cls) {
    var map = {
      eligible:
        '<span class="sb-eligible">' + t("p4.badge.eligible") + "</span>",
      same: '<span class="sb-same">' + t("p4.badge.same") + "</span>",
      conflict:
        '<span class="sb-conflict">' + t("p4.badge.conflict") + "</span>",
      offline: '<span class="sb-offline">' + t("p4.badge.offline") + "</span>",
      no_strategy: "",
    };
    return map[cls] || "";
  },

  _modeLabel: function (mode) {
    var m = this._modeKeys[mode];
    return m ? t(m.i18nKey) : mode || "\u2014";
  },

  // ── Step 3: Targeting Table ───────────────────────────
  _renderTargeting: function () {
    var self = this;
    var gws = this._visibleGateways();
    var targetSlots = this._mode ? this._targetSchedule() : null;

    // Filter controls
    var makeSelect = function (id, label, values, current) {
      var opts = '<option value="all">' + t("p4.filter.all") + "</option>";
      values.forEach(function (v) {
        var sel = v === current ? " selected" : "";
        opts +=
          '<option value="' +
          self._esc(v) +
          '"' +
          sel +
          ">" +
          self._esc(v) +
          "</option>";
      });
      return (
        '<label class="hems-filter-label">' +
        label +
        '<select id="' +
        id +
        '">' +
        opts +
        "</select></label>"
      );
    };

    var bulkDisabled = !self._mode ? " disabled" : "";

    var filters = [
      '<div class="hems-filters">',
      makeSelect(
        "hf-integrator",
        t("p4.filter.integrator"),
        this._uniqueValues("integrator"),
        this._filters.integrator,
      ),
      makeSelect(
        "hf-home",
        t("p4.filter.home"),
        this._uniqueValues("home"),
        this._filters.home,
      ),
      makeSelect(
        "hf-status",
        t("p4.filter.status"),
        this._uniqueValues("status"),
        this._filters.status,
      ),
      makeSelect(
        "hf-mode",
        t("p4.filter.mode"),
        this._uniqueValues("mode"),
        this._filters.mode,
      ),
      '<div class="hems-filter-actions">',
      '<button class="btn btn-sm" id="hems-reset-filters">' +
        t("p4.filter.reset") +
        "</button>",
      '<button class="btn btn-sm btn-primary" id="hems-sel-change"' +
        bulkDisabled +
        ">" +
        t("p4.bulk.selectWillChange") +
        "</button>",
      '<button class="btn btn-sm" id="hems-sel-all"' +
        bulkDisabled +
        ">" +
        t("p4.bulk.selectAllSelectable") +
        "</button>",
      '<button class="btn btn-sm" id="hems-sel-clear"' +
        bulkDisabled +
        ">" +
        t("p4.bulk.clear") +
        "</button>",
      "</div>",
      "</div>",
    ].join("");

    // Legend
    var legend = [
      '<div class="sched-legend">',
      "<span>" + t("p4.legend.title") + "</span>",
      '<span class="sched-legend-item"><span class="swatch swatch-self"></span>' +
        t("p4.legend.selfConsumption") +
        "</span>",
      '<span class="sched-legend-item"><span class="swatch swatch-peak"></span>' +
        t("p4.legend.peakShaving") +
        "</span>",
      '<span class="sched-legend-item"><span class="swatch swatch-charge"></span>' +
        t("p4.legend.charge") +
        "</span>",
      '<span class="sched-legend-item"><span class="swatch swatch-discharge"></span>' +
        t("p4.legend.discharge") +
        "</span>",
      "</div>",
    ].join("");

    // Table rows
    var rows = gws
      .map(function (gw) {
        var cls = self._classify(gw);
        var isSelectable = self._mode && (cls === "eligible" || cls === "same");
        var checked = self._selected[gw.gatewayId] ? " checked" : "";
        var disabled = isSelectable ? "" : " disabled";
        var rowCls = "";
        if (cls === "conflict") rowCls = ' class="row-conflict"';
        else if (cls === "offline") rowCls = ' class="row-offline"';
        else if (self._selected[gw.gatewayId]) rowCls = ' class="sel"';

        var conflictInfo = "";
        if (cls === "conflict") {
          conflictInfo = [
            '<div class="conflict-reason">',
            '<span class="conflict-inline">' +
              t("p4.conflict.executing") +
              "</span>",
            '<span class="conflict-toggle" data-batch="' +
              self._esc(gw.activeCommandBatchId) +
              '">' +
              t("p4.conflict.details") +
              "</span>",
            '<div class="conflict-popover">',
            "<div>" + t("p4.conflict.reason") + "</div>",
            "<div>" +
              t("p4.conflict.batch") +
              ": " +
              self._esc(gw.activeCommandBatchId) +
              "</div>",
            "<div>" + t("p4.conflict.suggestion") + "</div>",
            "</div>",
            "</div>",
          ].join("");
        }

        var home = self._esc(gw.homeAlias || gw.name);
        var statusBadge = self._statusBadgeHtml(gw.status);

        return [
          "<tr" + rowCls + ">",
          '<td><input type="checkbox" class="hems-gw-cb" data-gw="' +
            gw.gatewayId +
            '"' +
            checked +
            disabled +
            "></td>",
          "<td>" + self._esc(gw.gatewayId) + conflictInfo + "</td>",
          "<td>" + home + "</td>",
          "<td>" + statusBadge + "</td>",
          "<td>" + self._modeLabel(gw.currentMode) + "</td>",
          "<td>" + self._badgeHtml(cls) + "</td>",
          "<td>" +
            (gw.deviceCount != null ? gw.deviceCount : "\u2014") +
            "</td>",
          "<td>" + self._buildMiniBar(gw.currentSlots) + "</td>",
          "<td>" + self._buildMiniBar(targetSlots) + "</td>",
          "</tr>",
        ].join("");
      })
      .join("");

    var emptyMsg =
      gws.length === 0
        ? '<tr><td colspan="9" class="hems-empty">' +
          t("p4.empty") +
          "</td></tr>"
        : "";

    return [
      '<div class="hems-step">',
      '<div class="step-num">\u2462</div>',
      "<h3>" + t("p4.step3") + "</h3>",
      filters,
      legend,
      '<div class="table-wrapper"><table class="gw-table">',
      "<thead><tr>",
      '<th class="col-cb"></th>',
      "<th>" + t("p4.table.gateway") + "</th>",
      "<th>" + t("p4.table.site") + "</th>",
      "<th>" + t("p4.table.status") + "</th>",
      "<th>" + t("p4.table.currentStrategy") + "</th>",
      "<th>" + t("p4.table.eligibility") + "</th>",
      "<th>" + t("p4.table.devices") + "</th>",
      '<th class="col-sched">' + t("p4.table.currentSchedule") + "</th>",
      '<th class="col-sched">' + t("p4.table.targetSchedule") + "</th>",
      "</tr></thead>",
      "<tbody>" + rows + emptyMsg + "</tbody>",
      "</table></div>",
      "</div>",
    ].join("");
  },

  // ── Step 4: Review Panel ──────────────────────────────
  _dispatchResults: null,
  _dispatching: false,
  _currentBatchId: null,
  _resultsPollTimer: null,

  // ── Terminal-status polling helpers ───────────────────
  _isTerminalResult: function (status) {
    return (
      status === "success" ||
      status === "fail" ||
      status === "failed" ||
      status === "timeout" ||
      status === "skipped"
    );
  },

  _startResultsPolling: function (batchId) {
    var self = this;
    this._stopResultsPolling();
    this._currentBatchId = batchId;
    this._resultsPollTimer = setInterval(function () {
      DataSource.hems
        .batchHistory(20)
        .then(function (hist) {
          var batches = hist ? hist.batches || [] : [];
          self._batchHistory = batches;
          var batch = null;
          for (var i = 0; i < batches.length; i++) {
            if (batches[i].batchId === self._currentBatchId) {
              batch = batches[i];
              break;
            }
          }
          if (batch) {
            var changed = self._mergeBatchHistoryIntoResults(batch);
            if (changed) self._rerenderResultsPanel();
            if (self._allResultsTerminal()) self._stopResultsPolling();
          }
        })
        .catch(function () {});
    }, 3000);
  },

  _stopResultsPolling: function () {
    if (this._resultsPollTimer) {
      clearInterval(this._resultsPollTimer);
      this._resultsPollTimer = null;
    }
    this._currentBatchId = null;
  },

  _mergeBatchHistoryIntoResults: function (batch) {
    if (!this._dispatchResults || !this._dispatchResults.results) return false;
    var gateways = batch.gateways || [];
    var gwMap = {};
    for (var i = 0; i < gateways.length; i++) {
      gwMap[gateways[i].gatewayId] = gateways[i].result;
    }
    var changed = false;
    var items = this._dispatchResults.results;
    for (var j = 0; j < items.length; j++) {
      // Never overwrite skipped rows from original POST response
      if (items[j].status === "skipped") continue;
      var liveStatus = gwMap[items[j].gatewayId];
      if (liveStatus && liveStatus !== items[j].status) {
        items[j].status = liveStatus;
        changed = true;
      }
    }
    return changed;
  },

  _allResultsTerminal: function () {
    if (!this._dispatchResults || !this._dispatchResults.results) return true;
    var items = this._dispatchResults.results;
    for (var i = 0; i < items.length; i++) {
      if (!this._isTerminalResult(items[i].status)) return false;
    }
    return true;
  },

  _rerenderResultsPanel: function () {
    var panel = document.querySelector(".review-panel.results");
    if (!panel) return;
    var wrapper = document.createElement("div");
    wrapper.innerHTML = this._buildResultsPanel();
    var newPanel = wrapper.firstChild;
    panel.parentNode.replaceChild(newPanel, panel);
    this._bindResultsPanelEvents();
  },

  _bindResultsPanelEvents: function () {
    var self = this;
    var retryBtn = document.getElementById("hems-retry-failed");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        self._retryFailed();
      });
    }
    var doneBtn = document.getElementById("hems-results-done");
    if (doneBtn) {
      doneBtn.addEventListener("click", function () {
        self._resetToStep1();
      });
    }
  },

  _renderReview: function () {
    var self = this;
    var selIds = this._getSelectedIds();
    var header = [
      '<div class="hems-step">',
      '<div class="step-num">\u2463</div>',
      "<h3>" + t("p4.step4") + "</h3>",
    ].join("");

    // Dormant state
    if (selIds.length === 0 && !this._dispatchResults) {
      return [
        header,
        '<div class="review-panel dormant">',
        "<p>" + t("p4.review.placeholder") + "</p>",
        "</div>",
        "</div>",
      ].join("");
    }

    // Post-dispatch results mode
    if (this._dispatchResults) {
      return header + this._buildResultsPanel() + "</div>";
    }

    // Active review mode
    var cards = selIds
      .map(function (id) {
        return self._buildReviewCard(id);
      })
      .join("");
    var summary = this._buildDispatchSummary();
    var arbIncomplete =
      this._mode === "peak_valley_arbitrage" && !this._isArbComplete();
    var btnDisabled = selIds.length === 0 || arbIncomplete ? " disabled" : "";
    var btnLabel = arbIncomplete
      ? t("p4.review.dispatchBtnDisabled")
      : t("p4.review.dispatchBtn");

    return [
      header,
      '<div class="review-panel active">',
      '<div class="review-layout">',
      '<div class="review-cards">' + cards + "</div>",
      '<div class="dispatch-summary">' + summary + "</div>",
      "</div>",
      '<div class="review-actions">',
      '<button class="btn btn-primary" id="hems-dispatch-btn"' +
        btnDisabled +
        ">" +
        btnLabel +
        "</button>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  _buildReviewCard: function (gwId) {
    var self = this;
    var gw = null;
    (this._gateways || []).forEach(function (g) {
      if (g.gatewayId === gwId) gw = g;
    });
    if (!gw) return "";

    var cls = this._classify(gw);
    var changeLabel =
      cls === "eligible"
        ? '<span class="rc-change">' + t("p4.review.willChange") + "</span>"
        : '<span class="rc-same">' + t("p4.review.alreadySame") + "</span>";
    var targetSlots = this._mode ? this._targetSchedule() : [];

    return [
      '<div class="review-card">',
      '<div class="rc-header">',
      "<strong>" + self._esc(gw.gatewayId) + "</strong>",
      changeLabel,
      "</div>",
      '<div class="rc-mode">' + self._modeLabel(gw.currentMode) + "</div>",
      '<div class="rc-bars">',
      '<div class="rc-bar-row"><span class="rc-bar-label">' +
        t("p4.table.currentSchedule") +
        "</span>" +
        self._buildMiniBar(gw.currentSlots) +
        "</div>",
      '<div class="rc-bar-row"><span class="rc-bar-label">' +
        t("p4.table.targetSchedule") +
        "</span>" +
        self._buildMiniBar(targetSlots) +
        "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  _buildDispatchSummary: function () {
    var c = this._impactCounters();
    var m = this._modeKeys[this._mode];
    var modeIcon = m ? m.icon : "";
    var modeLabel = m ? t(m.i18nKey) : "";
    var gridLine =
      this._mode === "peak_shaving"
        ? '<div class="ds-row"><span>' +
          t("p4.review.gridLimit") +
          ":</span><strong>" +
          this._gridImportLimitKw +
          " kW</strong></div>"
        : "";

    // Count blocked among selected
    var self = this;
    var blockedCount = 0;
    this._getSelectedIds().forEach(function (id) {
      (self._gateways || []).forEach(function (gw) {
        if (gw.gatewayId === id && self._classify(gw) === "conflict") {
          blockedCount++;
        }
      });
    });

    return [
      '<div class="ds-title">' + t("p4.review.summary") + "</div>",
      '<div class="ds-mode">' + modeIcon + " " + modeLabel + "</div>",
      '<div class="ds-row"><span>' +
        t("p4.review.socRange") +
        ":</span><strong>" +
        this._socMin +
        "% \u2014 " +
        this._socMax +
        "%</strong></div>",
      gridLine,
      '<div class="ds-sep"></div>',
      '<div class="ds-row"><span>' +
        t("p4.modal.selected") +
        ":</span><strong>" +
        c.selected +
        "</strong></div>",
      '<div class="ds-row"><span>' +
        t("p4.modal.willChange") +
        ":</span><strong>" +
        c.willChange +
        "</strong></div>",
      '<div class="ds-row"><span>' +
        t("p4.modal.alreadySame") +
        ":</span><strong>" +
        (c.selected - c.willChange - blockedCount) +
        "</strong></div>",
      '<div class="ds-row"><span>' +
        t("p4.modal.blockedSkip") +
        ":</span><strong>" +
        blockedCount +
        "</strong></div>",
    ].join("");
  },

  // ── Confirmation Modal ──────────────────────────────
  _buildConfirmModal: function () {
    var self = this;
    var c = this._impactCounters();
    var m = this._modeKeys[this._mode];
    var modeIcon = m ? m.icon : "";
    var modeLabel = m ? t(m.i18nKey) : "";
    var targetSlots = this._mode ? this._targetSchedule() : [];
    var gridLine =
      this._mode === "peak_shaving"
        ? "<div>" +
          t("p4.review.gridLimit") +
          ": " +
          this._gridImportLimitKw +
          " kW</div>"
        : "";

    // Find blocked gateways among selected
    var blockedGws = [];
    this._getSelectedIds().forEach(function (id) {
      (self._gateways || []).forEach(function (gw) {
        if (gw.gatewayId === id && self._classify(gw) === "conflict") {
          blockedGws.push(gw);
        }
      });
    });

    var warningHtml = "";
    if (blockedGws.length > 0) {
      var blockedList = blockedGws
        .map(function (gw) {
          return (
            "<li>" +
            self._esc(gw.gatewayId) +
            " \u2014 " +
            t("p4.conflict.executing") +
            " (batch: " +
            self._esc(gw.activeCommandBatchId) +
            ")</li>"
          );
        })
        .join("");
      warningHtml = [
        '<div class="modal-warning">',
        "\u26A0\uFE0F " + blockedGws.length + " " + t("p4.modal.warning"),
        "<ul>" + blockedList + "</ul>",
        "</div>",
      ].join("");
    }

    return [
      '<div class="hems-modal-overlay" id="hems-modal-overlay">',
      '<div class="hems-modal">',
      "<h3>" + t("p4.modal.title") + "</h3>",
      '<div class="modal-section">',
      '<div class="ds-mode">' + modeIcon + " " + modeLabel + "</div>",
      "<div>" +
        t("p4.review.socRange") +
        ": " +
        this._socMin +
        "% \u2014 " +
        this._socMax +
        "%</div>",
      gridLine,
      "</div>",
      '<div class="modal-section">',
      "<div><strong>" + t("p4.modal.targetSchedule") + "</strong></div>",
      '<div class="modal-bar">' + this._buildMiniBar(targetSlots) + "</div>",
      "</div>",
      '<div class="modal-section">',
      "<div>" +
        t("p4.modal.selected") +
        ": <strong>" +
        c.selected +
        "</strong></div>",
      "<div>" +
        t("p4.modal.willChange") +
        ": <strong>" +
        c.willChange +
        "</strong></div>",
      "<div>" +
        t("p4.modal.alreadySame") +
        ": <strong>" +
        (c.selected - c.willChange - blockedGws.length) +
        "</strong></div>",
      "<div>" +
        t("p4.modal.blockedSkip") +
        ": <strong>" +
        blockedGws.length +
        "</strong></div>",
      "</div>",
      warningHtml,
      '<div class="modal-actions">',
      '<button class="btn" id="hems-cancel-dispatch">' +
        t("p4.modal.cancel") +
        "</button>",
      '<button class="btn danger" id="hems-confirm-dispatch">' +
        t("p4.modal.confirm") +
        "</button>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  _openConfirmModal: function () {
    var self = this;
    var existing = document.getElementById("hems-modal-overlay");
    if (existing) existing.parentNode.removeChild(existing);

    var wrapper = document.createElement("div");
    wrapper.innerHTML = this._buildConfirmModal();
    document.body.appendChild(wrapper.firstChild);

    // Focus cancel button by default
    var cancelBtn = document.getElementById("hems-cancel-dispatch");
    if (cancelBtn) cancelBtn.focus();

    // Event: cancel
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        self._closeConfirmModal();
      });
    }
    // Event: confirm
    var confirmBtn = document.getElementById("hems-confirm-dispatch");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        self._executeDispatch();
      });
    }
    // Event: backdrop click
    var overlay = document.getElementById("hems-modal-overlay");
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) self._closeConfirmModal();
      });
    }
    // Event: ESC key
    self._modalEscHandler = function (e) {
      if (e.key === "Escape") self._closeConfirmModal();
    };
    document.addEventListener("keydown", self._modalEscHandler);
  },

  _closeConfirmModal: function () {
    var overlay = document.getElementById("hems-modal-overlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (this._modalEscHandler) {
      document.removeEventListener("keydown", this._modalEscHandler);
      this._modalEscHandler = null;
    }
  },

  // ── Dispatch Execution ──────────────────────────────
  _executeDispatch: function () {
    var self = this;
    var confirmBtn = document.getElementById("hems-confirm-dispatch");
    var cancelBtn = document.getElementById("hems-cancel-dispatch");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML =
        '<span class="spinner-sm"></span> ' + t("p4.modal.confirm");
    }
    if (cancelBtn) cancelBtn.disabled = true;

    var params = {
      mode: this._mode,
      socMinLimit: this._socMin,
      socMaxLimit: this._socMax,
      gatewayIds: this._getSelectedIds(),
    };
    if (this._mode === "peak_shaving") {
      params.gridImportLimitKw = this._gridImportLimitKw;
    }
    if (this._mode === "peak_valley_arbitrage") {
      params.slots = this._buildArbSlots();
    }

    DataSource.hems
      .batchDispatch(params)
      .then(function (result) {
        self._closeConfirmModal();
        self._dispatchResults = result;
        self._render();
        var dispatched = result && result.summary ? result.summary.pending : 0;
        self._showToast(dispatched + " " + t("p4.result.toast"), "success");
        // Start polling for terminal status updates
        var batchId = result && result.batchId ? result.batchId : null;
        if (batchId && !self._allResultsTerminal()) {
          self._startResultsPolling(batchId);
        }
      })
      .catch(function (err) {
        self._showToast((err && err.message) || "Dispatch failed", "error");
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = t("p4.modal.confirm");
        }
        if (cancelBtn) cancelBtn.disabled = false;
      });
  },

  // ── Post-dispatch Results Panel ─────────────────────
  _buildResultsPanel: function () {
    var self = this;
    var results = this._dispatchResults;
    var items = results && results.results ? results.results : [];
    var retryableIds = [];

    var statusMeta = {
      pending: { icon: "\u23F3", i18n: "p4.result.pending", css: "dr-pending" },
      dispatched: {
        icon: "\uD83D\uDCE4",
        i18n: "p4.result.dispatched",
        css: "dr-pending",
      },
      accepted: {
        icon: "\uD83D\uDD04",
        i18n: "p4.result.accepted",
        css: "dr-accepted",
      },
      success: { icon: "\u2705", i18n: "p4.result.success", css: "dr-success" },
      fail: { icon: "\u274C", i18n: "p4.result.failed", css: "dr-fail" },
      failed: { icon: "\u274C", i18n: "p4.result.failed", css: "dr-fail" },
      timeout: { icon: "\u23F0", i18n: "p4.result.timeout", css: "dr-fail" },
      skipped: { icon: "\u23ED", i18n: "p4.result.skipped", css: "dr-skipped" },
    };
    var defaultMeta = {
      icon: "\u2753",
      i18n: "p4.result.pending",
      css: "dr-pending",
    };

    var cards = items
      .map(function (r) {
        var meta = statusMeta[r.status] || defaultMeta;
        var reason =
          r.status === "skipped" && r.reason
            ? '<div class="result-reason">' + self._esc(r.reason) + "</div>"
            : "";
        if (r.status === "skipped" && r.reason !== "active_command") {
          retryableIds.push(r.gatewayId);
        }
        return [
          '<div class="dispatch-result ' + meta.css + '">',
          "<span>" + meta.icon + "</span>",
          "<strong>" + self._esc(r.gatewayId) + "</strong>",
          "<span>" + t(meta.i18n) + "</span>",
          reason,
          "</div>",
        ].join("");
      })
      .join("");

    var retryBtn = "";
    if (retryableIds.length > 0) {
      retryBtn =
        '<button class="btn" id="hems-retry-failed">' +
        t("p4.result.retryBtn") +
        " (" +
        retryableIds.length +
        ")</button>";
    }
    var doneBtn =
      '<button class="btn btn-primary" id="hems-results-done">' +
      t("p4.status.online") +
      " \u2192 " +
      t("p4.step1") +
      "</button>";

    return [
      '<div class="review-panel results">',
      '<div class="results-grid">' + cards + "</div>",
      '<div class="results-actions">' + retryBtn + doneBtn + "</div>",
      "</div>",
    ].join("");
  },

  _retryFailed: function () {
    var self = this;
    this._stopResultsPolling();
    var results = this._dispatchResults;
    var items = results && results.results ? results.results : [];
    var retryIds = [];
    items.forEach(function (r) {
      if (r.status === "skipped" && r.reason !== "active_command") {
        retryIds.push(r.gatewayId);
      }
    });
    if (retryIds.length === 0) return;

    // Build same params but with only retry IDs
    var params = {
      mode: this._mode,
      socMinLimit: this._socMin,
      socMaxLimit: this._socMax,
      gatewayIds: retryIds,
    };
    if (this._mode === "peak_shaving") {
      params.gridImportLimitKw = this._gridImportLimitKw;
    }
    if (this._mode === "peak_valley_arbitrage") {
      params.slots = this._buildArbSlots();
    }

    DataSource.hems
      .batchDispatch(params)
      .then(function (result) {
        self._dispatchResults = result;
        self._render();
        var dispatched = result && result.summary ? result.summary.pending : 0;
        self._showToast(dispatched + " " + t("p4.result.toast"), "success");
        // Start polling for the new retry batch
        var batchId = result && result.batchId ? result.batchId : null;
        if (batchId && !self._allResultsTerminal()) {
          self._startResultsPolling(batchId);
        }
      })
      .catch(function (err) {
        self._showToast((err && err.message) || "Retry failed", "error");
      });
  },

  _resetToStep1: function () {
    this._stopResultsPolling();
    this._dispatchResults = null;
    this._selected = {};
    this._render();
  },

  // ── Event listeners ───────────────────────────────────
  _setupListeners: function () {
    var self = this;

    // Mode card clicks
    document.querySelectorAll(".s-card").forEach(function (card) {
      card.addEventListener("click", function () {
        self._mode = card.dataset.mode;
        self._render();
      });
    });

    // SoC sliders
    var socMin = document.getElementById("hems-soc-min");
    if (socMin) {
      socMin.addEventListener("input", function () {
        self._socMin = parseInt(this.value, 10);
        var d = document.getElementById("hems-soc-min-val");
        if (d) d.textContent = self._socMin;
      });
    }
    var socMax = document.getElementById("hems-soc-max");
    if (socMax) {
      socMax.addEventListener("input", function () {
        self._socMax = parseInt(this.value, 10);
        var d = document.getElementById("hems-soc-max-val");
        if (d) d.textContent = self._socMax;
      });
    }
    var gridLimit = document.getElementById("hems-grid-limit");
    if (gridLimit) {
      gridLimit.addEventListener("input", function () {
        self._gridImportLimitKw = parseInt(this.value, 10) || 50;
        var d = document.getElementById("hems-grid-val");
        if (d) d.textContent = self._gridImportLimitKw;
      });
    }

    // Arb brush radio
    document
      .querySelectorAll('input[name="hems-brush"]')
      .forEach(function (radio) {
        radio.addEventListener("change", function () {
          self._arbBrush = this.value;
        });
      });

    // Arb grid cells — click + drag to paint
    var isMouseDown = false;
    document.querySelectorAll(".arb-cell").forEach(function (cell) {
      cell.addEventListener("mousedown", function (e) {
        e.preventDefault();
        isMouseDown = true;
        var h = parseInt(cell.dataset.hour, 10);
        self._arbGrid[h] = self._arbBrush;
        self._render();
      });
      cell.addEventListener("mouseenter", function () {
        if (!isMouseDown) return;
        var h = parseInt(cell.dataset.hour, 10);
        self._arbGrid[h] = self._arbBrush;
        // Quick visual update without full re-render
        cell.classList.remove("charge", "discharge");
        cell.classList.add(self._arbBrush);
      });
    });
    document.addEventListener("mouseup", function () {
      if (isMouseDown) {
        isMouseDown = false;
        self._render();
      }
    });

    // Arb templates
    document.querySelectorAll("[data-template]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        self._applyArbTemplate(btn.dataset.template);
      });
    });

    // Filter controls
    ["hf-integrator", "hf-home", "hf-status", "hf-mode"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", function () {
          var key = id.replace("hf-", "");
          self._filters[key] = this.value;
          self._render();
        });
      }
    });

    // Reset filters button (A2)
    var resetBtn = document.getElementById("hems-reset-filters");
    if (resetBtn)
      resetBtn.addEventListener("click", function () {
        self._resetFilters();
      });

    // Selection action buttons
    var selChange = document.getElementById("hems-sel-change");
    if (selChange)
      selChange.addEventListener("click", function () {
        self._selectWillChange();
      });
    var selAll = document.getElementById("hems-sel-all");
    if (selAll)
      selAll.addEventListener("click", function () {
        self._selectAllSelectable();
      });
    var selClear = document.getElementById("hems-sel-clear");
    if (selClear)
      selClear.addEventListener("click", function () {
        self._clearSelection();
      });

    // Gateway checkboxes
    document.querySelectorAll(".hems-gw-cb").forEach(function (cb) {
      cb.addEventListener("change", function () {
        self._selected[cb.dataset.gw] = cb.checked;
        self._render();
      });
    });

    // Conflict popover toggles
    document.querySelectorAll(".conflict-toggle").forEach(function (toggle) {
      toggle.addEventListener("click", function (e) {
        e.stopPropagation();
        var popover = toggle.parentElement.querySelector(".conflict-popover");
        if (popover) {
          popover.classList.toggle("open");
        }
      });
    });

    // Phase 2: Dispatch button
    var dispatchBtn = document.getElementById("hems-dispatch-btn");
    if (dispatchBtn) {
      dispatchBtn.addEventListener("click", function () {
        self._openConfirmModal();
      });
    }

    // Phase 2: Results panel buttons
    var retryBtn = document.getElementById("hems-retry-failed");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        self._retryFailed();
      });
    }
    var doneBtn = document.getElementById("hems-results-done");
    if (doneBtn) {
      doneBtn.addEventListener("click", function () {
        self._resetToStep1();
      });
    }
  },

  // ── Toast (ported from v6.0) ──────────────────────────
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
