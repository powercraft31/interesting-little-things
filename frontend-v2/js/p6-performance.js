/* ============================================
   SOLFACIL Admin Portal — P6: Performance Scorecard
   Pilot acceptance metrics, savings chart.
   ============================================ */

var PerformancePage = {
  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  init: async function () {
    var self = this;
    var container = document.getElementById("performance-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      var results = await Promise.all([
        DataSource.performance.scorecard(),
        DataSource.performance.savings(),
      ]);
      self._scorecard = results[0];
      self._savings = results[1];
    } catch (err) {
      showErrorBoundary("performance-content", err);
      return;
    }

    container.innerHTML = self._buildContent();
    self._initCharts();
  },

  onRoleChange: function () {
    var container = document.getElementById("performance-content");
    if (!container) return;
    container.innerHTML = this._buildContent();
    this._initCharts();
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return [
      '<div class="p6-scorecard-grid">',
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonTable(4),
      "</div></div>",
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonTable(4),
      "</div></div>",
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonTable(4),
      "</div></div>",
      "</div>",
      '<div class="section-card"><div class="section-card-body">',
      Components.skeletonChart(),
      "</div></div>",
    ].join("");
  },

  // =========================================================
  // REAL CONTENT
  // =========================================================

  _buildContent: function () {
    return [this._buildScorecard(), this._buildSavingsChart()].join("");
  },

  // ---- T6.1: Pilot Acceptance Scorecard ----
  _buildScorecard: function () {
    var self = this;
    var sections = [
      { titleKey: "perf.obj1", key: "hardware", icon: "\uD83D\uDD27" },
      { titleKey: "perf.obj2", key: "optimization", icon: "\uD83D\uDCCA" },
      { titleKey: "perf.obj3", key: "operations", icon: "\u2699\uFE0F" },
    ];
    var scorecard = self._scorecard || {};

    var columns = sections
      .map(function (sec) {
        var metrics = scorecard[sec.key];
        var rows = metrics
          .map(function (m) {
            var statusIcon, statusClass;
            if (m.status === "pass") {
              statusIcon = "\u2705";
              statusClass = "p6-status-pass";
            } else if (m.status === "near") {
              statusIcon = "\uD83D\uDFE1";
              statusClass = "p6-status-near";
            } else {
              statusIcon = "\u26A0\uFE0F";
              statusClass = "p6-status-warn";
            }

            var nearClass = m.status === "near" ? " p6-metric-near" : "";

            return [
              '<div class="p6-metric-row' + nearClass + '">',
              '<div class="p6-metric-info">',
              '<div class="p6-metric-name">' +
                t("perf.metric." + m.name) +
                "</div>",
              '<div class="p6-metric-target">' +
                t("perf.target") +
                " " +
                m.target +
                "</div>",
              "</div>",
              '<div class="p6-metric-result">',
              '<div class="p6-metric-value">' +
                formatNumber(m.value, m.unit === "%" ? 1 : 0) +
                (m.unit ? " " + m.unit : "") +
                "</div>",
              '<div class="p6-metric-status ' +
                statusClass +
                '">' +
                statusIcon +
                "</div>",
              "</div>",
              "</div>",
            ].join("");
          })
          .join("");

        return [
          '<div class="p6-scorecard-column">',
          '<div class="section-card">',
          '<div class="section-card-header">',
          "<h3>" + sec.icon + " " + t(sec.titleKey) + "</h3>",
          "</div>",
          '<div class="section-card-body">',
          rows,
          "</div>",
          "</div>",
          "</div>",
        ].join("");
      })
      .join("");

    return '<div class="p6-scorecard-grid">' + columns + "</div>";
  },

  // ---- T6.2: Savings Chart ----
  _buildSavingsChart: function () {
    var body = '<div id="p6-savings-chart" class="p6-savings-chart"></div>';
    return Components.sectionCard(t("perf.savingsChart"), body);
  },

  // =========================================================
  // CHARTS
  // =========================================================

  _initCharts: function () {
    try {
      this._renderSavingsChart();
    } catch (e) {
      console.warn("[PerformancePage] Chart error:", e);
    }
  },

  _renderSavingsChart: function () {
    // Customer sees only their own home (Casa Silva); Admin/Integrador see all
    var role = typeof currentRole !== "undefined" ? currentRole : "admin";
    var allSavings = this._savings || [];
    var savingsData =
      role === "customer"
        ? allSavings.filter(function (h) {
            return h.home === "Casa Silva";
          })
        : allSavings;

    var homes = savingsData.map(function (h) {
      return h.home;
    });
    var scData = savingsData.map(function (h) {
      return h.sc;
    });
    var touData = savingsData.map(function (h) {
      return h.tou;
    });
    var psData = savingsData.map(function (h) {
      return h.ps;
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
          var homeIdx = params[0].dataIndex;
          var home = savingsData[homeIdx];
          var totalFormatted = formatBRL(home.total);
          var lines = [
            "<strong>" + home.home + "</strong>",
            "Total: <strong>" + totalFormatted + "</strong>",
            "",
          ];
          params.forEach(function (p) {
            lines.push(
              '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' +
                p.color +
                ';margin-right:6px"></span>' +
                p.seriesName +
                ": <strong>R$ " +
                p.value.toFixed(2).replace(".", ",") +
                "</strong>",
            );
          });
          return lines.join("<br/>");
        },
      },
      legend: {
        data: [
          t("perf.legend.selfCons"),
          t("perf.legend.tou"),
          t("perf.legend.peakShaving"),
        ],
        textStyle: { color: "#9ca3af", fontSize: 12 },
        top: 0,
      },
      grid: {
        containLabel: true,
        left: 12,
        right: 12,
        top: 50,
        bottom: 12,
      },
      xAxis: {
        type: "category",
        data: homes,
        axisLine: { lineStyle: { color: "#2a2d3a" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#e4e4e7",
          fontSize: 12,
          fontWeight: 600,
        },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: "#2a2d3a" } },
        axisLabel: {
          color: "#9ca3af",
          fontSize: 11,
          formatter: function (v) {
            return "R$ " + v;
          },
        },
        splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
      },
      series: [
        {
          name: t("perf.legend.selfCons"),
          type: "bar",
          stack: "total",
          data: scData,
          itemStyle: {
            color: "#22c55e",
            borderRadius: [0, 0, 0, 0],
          },
          barWidth: "45%",
        },
        {
          name: t("perf.legend.tou"),
          type: "bar",
          stack: "total",
          data: touData,
          itemStyle: {
            color: "#3b82f6",
          },
        },
        {
          name: t("perf.legend.peakShaving"),
          type: "bar",
          stack: "total",
          data: psData,
          itemStyle: {
            color: "#a855f7",
            borderRadius: [4, 4, 0, 0],
          },
          // Alpha % label on top of stack
          label: {
            show: true,
            position: "top",
            color: "#e4e4e7",
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            formatter: function (params) {
              var home = savingsData[params.dataIndex];
              return formatBRL(home.total);
            },
          },
        },
      ],
    };

    Charts.createChart("p6-savings-chart", option, { pageId: "performance" });
  },
};
