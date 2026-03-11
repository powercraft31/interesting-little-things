/* ============================================
   SOLFACIL Admin Portal — P5: VPP & DR
   Aggregate capacity, DR event trigger,
   dispatch latency chart, event history.
   ============================================ */

var VPPPage = {
  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  init: async function () {
    var self = this;
    var container = document.getElementById("vpp-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      var results = await Promise.all([
        DataSource.vpp.capacity(),
        DataSource.vpp.drEvents(),
        DataSource.vpp.latency(),
      ]);
      self._data = {
        capacity: results[0],
        drEvents: results[1],
        latency: results[2],
      };
    } catch (err) {
      showErrorBoundary("vpp-content", err);
      return;
    }

    container.innerHTML = self._buildContent();
    self._setupEventListeners();
    self._initCharts();
  },

  onRoleChange: function (role) {
    var container = document.getElementById("vpp-content");
    if (!container) return;
    container.innerHTML = this._buildContent();
    this._setupEventListeners();
    this._initCharts();
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return [
      Components.skeletonKPIs(7),
      '<div class="section-card"><div class="section-card-body">',
      '<div class="skeleton" style="height:200px;border-radius:10px"></div>',
      "</div></div>",
      '<div class="two-col">',
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonChart(),
      "</div></div>",
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonTable(5),
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
      this._buildCapacityCards(),
      this._buildDRTriggerPanel(isAdmin),
      '<div class="two-col">',
      this._buildLatencyChart(),
      this._buildEventHistory(),
      "</div>",
    ].join("");
  },

  // ---- T5.1: VPP Aggregate Capacity Cards ----
  _buildCapacityCards: function () {
    var cap = this._data.capacity;
    var cards = [
      Components.kpiCard({
        value: formatNumber(cap.totalCapacityKwh, 1),
        label: t("vpp.totalCap"),
        suffix: " kWh",
      }),
      Components.kpiCard({
        value: formatNumber(cap.availableKwh, 1),
        label: t("vpp.available"),
        suffix: " kWh",
        color: "text-positive",
      }),
      Components.kpiCard({
        value: cap.aggregateSoc != null ? cap.aggregateSoc : "\u2014",
        label: t("vpp.aggSoc"),
        suffix: cap.aggregateSoc != null ? "%" : "",
      }),
      Components.kpiCard({
        value: formatNumber(cap.maxDischargeKw, 1),
        label: t("vpp.maxDischarge"),
        suffix: " kW",
        color: "text-negative",
      }),
      Components.kpiCard({
        value: formatNumber(cap.maxChargeKw, 1),
        label: t("vpp.maxCharge"),
        suffix: " kW",
        color: "text-positive",
      }),
      Components.kpiCard({
        value:
          cap.dispatchableDevices != null ? cap.dispatchableDevices : "\u2014",
        label: t("vpp.dispatchable"),
        suffix:
          cap.dispatchableDevices != null ? " " + t("shared.devices") : "",
      }),
    ].join("");

    // 7th card — Net Dispatchable placeholder
    var placeholderCard = [
      '<div class="kpi-card p5-kpi-disabled">',
      '<div class="kpi-value no-prefix">--</div>',
      '<div class="kpi-label">' + t("vpp.netDispatchable") + "</div>",
      '<div class="p5-kpi-note">' + t("vpp.netNote") + "</div>",
      "</div>",
    ].join("");

    return (
      '<div class="kpi-grid p5-kpi-grid-7">' +
      cards +
      placeholderCard +
      "</div>"
    );
  },

  // ---- T5.2: DR Event Trigger Panel ----
  _buildDRTriggerPanel: function (isAdmin) {
    var disabledAttr = isAdmin ? "" : " disabled";
    var tooltip = isAdmin ? "" : ' title="' + t("hems.requiresAdmin") + '"';

    var body = [
      '<div class="p5-dr-form">',

      // Row 1: Event Type + Target Power + Duration
      '<div class="p5-form-row">',
      '<div class="p5-form-group">',
      "<label>" + t("vpp.eventType") + "</label>",
      '<select id="p5-event-type"' + disabledAttr + tooltip + ">",
      '<option value="Discharge">' + t("vpp.discharge") + "</option>",
      '<option value="Charge">' + t("vpp.charge") + "</option>",
      '<option value="Load Curtailment">' + t("vpp.curtailment") + "</option>",
      "</select>",
      "</div>",

      '<div class="p5-form-group">',
      "<label>" + t("vpp.targetPower") + "</label>",
      '<input type="number" id="p5-target-power" value="30" min="1" max="100"' +
        disabledAttr +
        tooltip +
        ">",
      "</div>",

      '<div class="p5-form-group">',
      "<label>" + t("vpp.duration") + "</label>",
      '<input type="number" id="p5-duration" value="30" min="1" max="480"' +
        disabledAttr +
        tooltip +
        ">",
      "</div>",

      '<div class="p5-form-group">',
      "<label>" + t("vpp.deviceScope") + "</label>",
      '<select id="p5-device-scope"' + disabledAttr + tooltip + ">",
      '<option value="all">' + t("vpp.scopeAll") + "</option>",
      '<option value="home">' + t("vpp.scopeHome") + "</option>",
      '<option value="integrador">' + t("vpp.scopeInt") + "</option>",
      "</select>",
      "</div>",
      "</div>",

      // Trigger button
      '<div class="p5-trigger-row">',
      '<button id="p5-btn-trigger" class="btn btn-primary p5-btn-trigger"' +
        disabledAttr +
        tooltip +
        ">" +
        t("vpp.triggerBtn") +
        "</button>",
      !isAdmin
        ? '<span class="p4-readonly-badge">' + t("vpp.intReadonly") + "</span>"
        : "",
      "</div>",

      // Progress area
      '<div id="p5-dr-progress" class="p5-dr-progress"></div>',
      "</div>",
    ].join("");

    return Components.sectionCard(t("vpp.drTrigger"), body);
  },

  // ---- T5.3: Dispatch Latency Chart ----
  _buildLatencyChart: function () {
    var body = '<div id="p5-latency-chart" class="p5-latency-chart"></div>';
    return Components.sectionCard(t("vpp.latencyChart"), body);
  },

  // ---- T5.4: DR Event History Table ----
  _buildEventHistory: function () {
    var table = Components.dataTable({
      columns: [
        { key: "id", label: t("vpp.col.eventId"), mono: true },
        {
          key: "type",
          label: t("vpp.col.type"),
          format: function (val) {
            var labels = {
              Discharge: t("vpp.discharge"),
              Charge: t("vpp.charge"),
              Curtailment: t("vpp.curtailment"),
              "Load Curtailment": t("vpp.curtailment"),
            };
            var classes = {
              Discharge: "p5-type-discharge",
              Charge: "p5-type-charge",
              Curtailment: "p5-type-curtail",
              "Load Curtailment": "p5-type-curtail",
            };
            return (
              '<span class="p5-type-badge ' +
              (classes[val] || "") +
              '">' +
              (labels[val] || val) +
              "</span>"
            );
          },
        },
        {
          key: "triggeredAt",
          label: t("vpp.col.triggeredAt"),
          format: function (v) {
            return formatISODateTime(v);
          },
        },
        {
          key: "targetKw",
          label: t("vpp.col.targetKw"),
          align: "right",
          mono: true,
          format: function (v) {
            return v != null ? v + " kW" : "\u2014";
          },
        },
        {
          key: "achievedKw",
          label: t("vpp.col.achievedKw"),
          align: "right",
          mono: true,
          format: function (v) {
            return v != null ? v + " kW" : "\u2014";
          },
        },
        {
          key: "accuracy",
          label: t("vpp.col.accuracy"),
          align: "right",
          mono: true,
          format: function (v) {
            var color =
              v >= 98
                ? "text-positive"
                : v >= 90
                  ? "text-amber"
                  : "text-negative";
            return (
              '<span class="' + color + '">' + formatNumber(v, 1) + "%</span>"
            );
          },
        },
        {
          key: "participated",
          label: t("vpp.col.participated"),
          align: "right",
          mono: true,
          format: function (v, row) {
            return v != null ? v + "/" + (v + (row.failed || 0)) : "\u2014";
          },
        },
        {
          key: "failed",
          label: t("vpp.col.failed"),
          align: "right",
          mono: true,
          format: function (v) {
            if (v === 0) return '<span class="text-positive">0</span>';
            return '<span class="text-negative">' + v + "</span>";
          },
        },
      ],
      rows: this._data.drEvents,
    });

    return Components.sectionCard(t("vpp.drHistory"), table);
  },

  // =========================================================
  // CHARTS
  // =========================================================

  _initCharts: function () {
    try {
      this._renderLatencyChart();
    } catch (e) {
      console.warn("[VPPPage] Chart error:", e);
    }
  },

  _renderLatencyChart: function () {
    var tiers = this._data.latency;
    var categories = tiers.map(function (tier) {
      return tier.tier;
    });
    var values = tiers.map(function (tier) {
      return tier.successRate;
    });
    var colors = values.map(function (v) {
      if (v >= 90) return "#22c55e"; // green
      if (v >= 80) return "#f59e0b"; // amber
      return "#ef4444"; // red
    });

    var option = {
      backgroundColor: "transparent",
      textStyle: {
        color: "#9ca3af",
        fontFamily: "'Inter', -apple-system, sans-serif",
      },
      tooltip: {
        backgroundColor: "#1a1d27",
        borderColor: "#2a2d3a",
        borderWidth: 1,
        textStyle: { color: "#e4e4e7", fontSize: 12 },
        extraCssText:
          "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);",
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: function (params) {
          var p = params[0];
          return (
            "<strong>" +
            p.name +
            "</strong><br/>" +
            t("vpp.chart.successRate") +
            ": <strong>" +
            p.value +
            "%</strong>"
          );
        },
      },
      grid: {
        containLabel: true,
        left: 16,
        right: 40,
        top: 20,
        bottom: 12,
      },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: {
          color: "#9ca3af",
          fontSize: 11,
          formatter: "{value}%",
        },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
        splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
      },
      yAxis: {
        type: "category",
        data: categories,
        inverse: true,
        axisLine: { lineStyle: { color: "#2a2d3a" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#e4e4e7",
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
        },
      },
      series: [
        {
          type: "bar",
          data: values.map(function (v, i) {
            return {
              value: v,
              itemStyle: { color: colors[i], borderRadius: [0, 4, 4, 0] },
            };
          }),
          barWidth: "55%",
          label: {
            show: true,
            position: "right",
            color: "#e4e4e7",
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            formatter: "{c}%",
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: {
              type: "dashed",
              color: "#e4e4e7",
              width: 1.5,
            },
            label: {
              show: true,
              position: "end",
              formatter: t("vpp.chart.target"),
              color: "#e4e4e7",
              fontSize: 11,
              fontFamily: "'Inter', sans-serif",
            },
            data: [{ xAxis: 90 }],
          },
        },
      ],
    };

    Charts.createChart("p5-latency-chart", option, { pageId: "vpp" });
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupEventListeners: function () {
    var self = this;
    var isAdmin = typeof currentRole !== "undefined" && currentRole === "admin";

    var triggerBtn = document.getElementById("p5-btn-trigger");
    if (triggerBtn && isAdmin) {
      triggerBtn.addEventListener("click", function () {
        self._handleDRTrigger();
      });
    }
  },

  // =========================================================
  // DR TRIGGER LOGIC
  // =========================================================

  _handleDRTrigger: function () {
    var self = this;
    var eventType = document.getElementById("p5-event-type").value;
    var targetPower = document.getElementById("p5-target-power").value;
    var duration = document.getElementById("p5-duration").value;

    // Show confirm dialog
    this._showConfirmDialog(
      t("vpp.confirmTitle"),
      t("vpp.confirmMsg")
        .replace("{type}", eventType)
        .replace("{power}", targetPower)
        .replace("{duration}", duration),
      function () {
        self._executeDREvent();
      },
    );
  },

  _executeDREvent: function () {
    var progressEl = document.getElementById("p5-dr-progress");
    if (!progressEl) return;

    var triggerBtn = document.getElementById("p5-btn-trigger");
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = t("vpp.executing");
    }

    var totalDevices = this._data.capacity.dispatchableDevices;
    var steps = [
      { pct: 0, responded: 0 },
      { pct: 25, responded: 12 },
      { pct: 55, responded: 28 },
      { pct: 85, responded: 38 },
      { pct: 100, responded: totalDevices },
    ];

    // Render initial progress
    progressEl.innerHTML = this._buildProgressHTML(0, 0, totalDevices, false);

    var stepIdx = 0;
    var self = this;

    var interval = setInterval(function () {
      stepIdx++;
      if (stepIdx >= steps.length) {
        clearInterval(interval);
        // Final state
        progressEl.innerHTML = self._buildProgressHTML(
          100,
          totalDevices,
          totalDevices,
          true,
        );
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.textContent = t("vpp.triggerBtn");
        }
        return;
      }

      var step = steps[stepIdx];
      progressEl.innerHTML = self._buildProgressHTML(
        step.pct,
        step.responded,
        totalDevices,
        false,
      );
    }, 750);
  },

  _buildProgressHTML: function (pct, responded, total, done) {
    var statusText = done
      ? '<div class="p5-progress-done">' +
        t("vpp.progress.complete")
          .replace("{n}", total)
          .replace("{total}", total) +
        "</div>"
      : '<div class="p5-progress-counter">' +
        t("vpp.progress.responded")
          .replace("{n}", responded)
          .replace("{total}", total) +
        "</div>";

    return [
      '<div class="p5-progress-box' +
        (done ? " p5-progress-complete" : "") +
        '">',
      '<div class="p5-progress-bar-track">',
      '<div class="p5-progress-bar-fill" style="width:' + pct + '%"></div>',
      "</div>",
      statusText,
      "</div>",
    ].join("");
  },

  // =========================================================
  // CONFIRM DIALOG (reuses P4 pattern)
  // =========================================================

  _showConfirmDialog: function (title, message, onConfirm) {
    var html = [
      '<div id="p5-confirm-modal" class="modal-overlay active">',
      '<div class="modal-content">',
      "<h3>" + title + "</h3>",
      "<p>" + message + "</p>",
      '<div class="modal-actions">',
      '<button class="btn" id="p5-confirm-cancel">' +
        t("shared.cancel") +
        "</button>",
      '<button class="btn btn-primary" id="p5-confirm-ok">' +
        t("shared.confirm") +
        "</button>",
      "</div>",
      "</div>",
      "</div>",
    ].join("");

    document.body.insertAdjacentHTML("beforeend", html);

    document
      .getElementById("p5-confirm-cancel")
      .addEventListener("click", function () {
        var m = document.getElementById("p5-confirm-modal");
        if (m) m.remove();
      });

    document
      .getElementById("p5-confirm-ok")
      .addEventListener("click", function () {
        var m = document.getElementById("p5-confirm-modal");
        if (m) m.remove();
        if (onConfirm) onConfirm();
      });

    document
      .getElementById("p5-confirm-modal")
      .addEventListener("click", function (e) {
        if (e.target.id === "p5-confirm-modal") {
          var m = document.getElementById("p5-confirm-modal");
          if (m) m.remove();
        }
      });
  },
};
