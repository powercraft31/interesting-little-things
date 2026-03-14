/* ============================================
   SOLFACIL Admin Portal — P3-1: Asset Energy Flow
   Date picker + granularity switch + day/week/month/year charts
   + summary cards. Accessed via #asset-energy/:assetId
   ============================================ */

// eslint-disable-next-line no-unused-vars
var AssetEnergyPage = (function () {
  // ── State ─────────────────────────────────────────────────
  var _assetId = null;
  var _containerId = "p3-sub-content"; // default container
  var _granularity = "day"; // day | week | month | year
  var _currentDate = null; // Date object (BRT-aware)
  var _data = null; // API response { points, summary }
  var _chartInstance = null;
  var _fetchTimer = null;
  var _fetchAbort = null;
  var _energyFlowMode = false; // false=simple load bars, true=source breakdown

  var BRT_TZ = "America/Sao_Paulo";
  var WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  var MONTHS_PT = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ];

  // Demo data range
  var DATA_START = new Date("2025-12-13T03:00:00Z");
  var DATA_END = new Date("2026-03-12T03:00:00Z");

  // ── Helpers ───────────────────────────────────────────────
  function toBRTDate(d) {
    return new Date(d.toLocaleString("en-US", { timeZone: BRT_TZ }));
  }

  function formatDateBRT(d) {
    var dd = String(d.getDate()).padStart(2, "0");
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var yyyy = d.getFullYear();
    var wd = WEEKDAYS_PT[d.getDay()];
    return yyyy + "-" + mm + "-" + dd + " (" + wd + ") · BRT";
  }

  function formatDateRange(from, to) {
    var f =
      String(from.getDate()).padStart(2, "0") +
      "/" +
      String(from.getMonth() + 1).padStart(2, "0") +
      "/" +
      from.getFullYear();
    var t =
      String(to.getDate()).padStart(2, "0") +
      "/" +
      String(to.getMonth() + 1).padStart(2, "0") +
      "/" +
      to.getFullYear();
    return f + " — " + t + " · BRT";
  }

  function toISOBRT(d) {
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd + "T03:00:00Z";
  }

  function inputDateStr(d) {
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function addDays(d, n) {
    var r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function startOfWeek(d) {
    var r = new Date(d);
    var day = r.getDay();
    var diff = day === 0 ? 6 : day - 1; // Monday start
    r.setDate(r.getDate() - diff);
    return r;
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  function startOfYear(d) {
    return new Date(d.getFullYear(), 0, 1);
  }

  function getDateRange() {
    var d = _currentDate;
    var from, to, resolution;
    if (_granularity === "day") {
      from = toISOBRT(d);
      to = toISOBRT(addDays(d, 1));
      resolution = "5min";
    } else if (_granularity === "week") {
      var ws = startOfWeek(d);
      from = toISOBRT(ws);
      to = toISOBRT(addDays(ws, 7));
      resolution = "day";
    } else if (_granularity === "month") {
      var ms = startOfMonth(d);
      var me = endOfMonth(d);
      from = toISOBRT(ms);
      to = toISOBRT(addDays(me, 1));
      resolution = "day";
    } else {
      // year
      var ys = startOfYear(d);
      from = toISOBRT(ys);
      to = toISOBRT(new Date(d.getFullYear() + 1, 0, 1));
      resolution = "month";
    }
    return { from: from, to: to, resolution: resolution };
  }

  function getDisplayDate() {
    var d = _currentDate;
    if (_granularity === "day") {
      return formatDateBRT(d);
    } else if (_granularity === "week") {
      var ws = startOfWeek(d);
      return formatDateRange(ws, addDays(ws, 6));
    } else if (_granularity === "month") {
      return MONTHS_PT[d.getMonth()] + " " + d.getFullYear() + " · BRT";
    } else {
      return d.getFullYear() + " · BRT";
    }
  }

  function navigatePeriod(dir) {
    var d = _currentDate;
    if (_granularity === "day") {
      _currentDate = addDays(d, dir);
    } else if (_granularity === "week") {
      _currentDate = addDays(d, dir * 7);
    } else if (_granularity === "month") {
      _currentDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
    } else {
      _currentDate = new Date(d.getFullYear() + dir, d.getMonth(), 1);
    }
    _refresh();
  }

  function fmtNum(v, dec) {
    if (v == null || isNaN(v)) return "—";
    return Number(v).toLocaleString("pt-BR", {
      minimumFractionDigits: dec || 0,
      maximumFractionDigits: dec || 0,
    });
  }

  function fmtCurrency(v) {
    if (v == null || isNaN(v)) return "—";
    return (
      "R$ " +
      Number(v).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  // ── Build HTML ────────────────────────────────────────────
  function _buildSkeleton() {
    return (
      '<div class="p3ae-page">' +
      '<div class="p3ae-header"><div class="skeleton" style="width:300px;height:28px;border-radius:6px"></div></div>' +
      '<div class="p3ae-controls"><div class="skeleton" style="width:100%;height:48px;border-radius:6px"></div></div>' +
      Components.skeletonKPIs(6) +
      Components.skeletonChart() +
      "</div>"
    );
  }

  function _buildPage() {
    return (
      '<div class="p3ae-page">' +
      '<div class="p3ae-header">' +
      '<span class="p3ae-date-display" id="p3ae-date-display">' +
      getDisplayDate() +
      "</span>" +
      "</div>" +
      _buildControls() +
      _buildSummaryCards() +
      _buildChartCard() +
      "</div>"
    );
  }

  function _buildControls() {
    var grans = [
      { id: "day", label: t("p3ae.gran.day") },
      { id: "week", label: t("p3ae.gran.week") },
      { id: "month", label: t("p3ae.gran.month") },
      { id: "year", label: t("p3ae.gran.year") },
    ];

    var granBtns = grans
      .map(function (g) {
        var cls = g.id === _granularity ? " active" : "";
        return (
          '<button class="p3ae-gran-btn' +
          cls +
          '" data-gran="' +
          g.id +
          '">' +
          g.label +
          "</button>"
        );
      })
      .join("");

    var shortcuts =
      '<button class="p3ae-shortcut" data-shortcut="today">' +
      t("p3ae.today") +
      "</button>" +
      '<button class="p3ae-shortcut" data-shortcut="yesterday">' +
      t("p3ae.yesterday") +
      "</button>" +
      '<button class="p3ae-shortcut" data-shortcut="7d">' +
      t("p3ae.7days") +
      "</button>" +
      '<button class="p3ae-shortcut" data-shortcut="30d">' +
      t("p3ae.30days") +
      "</button>";

    return (
      '<div class="p3ae-controls">' +
      '<div class="p3ae-controls-row">' +
      '<div class="p3ae-gran-group">' +
      granBtns +
      "</div>" +
      '<div class="p3ae-nav-group">' +
      '<button class="p3ae-nav-arrow" id="p3ae-prev">&larr;</button>' +
      '<input type="date" id="p3ae-date-input" class="p3ae-date-input" value="' +
      inputDateStr(_currentDate) +
      '" min="2025-12-13" max="2026-03-12" />' +
      '<button class="p3ae-nav-arrow" id="p3ae-next">&rarr;</button>' +
      "</div>" +
      '<div class="p3ae-shortcuts">' +
      shortcuts +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function _buildSummaryCards() {
    var s = (_data && _data.summary) || {};
    var cards = [
      {
        label: t("p3ae.pvTotal"),
        value: fmtNum(s.pvTotal, 1) + " kWh",
        color: "positive",
      },
      {
        label: t("p3ae.loadTotal"),
        value: fmtNum(s.loadTotal, 1) + " kWh",
        color: "",
      },
      {
        label: t("p3ae.gridImport"),
        value: fmtNum(s.gridImport, 1) + " kWh",
        color: "negative",
      },
      {
        label: t("p3ae.gridExport"),
        value: fmtNum(s.gridExport, 1) + " kWh",
        color: "positive",
      },
      {
        label: t("p3ae.selfConsumption"),
        value: fmtNum(s.selfConsumption, 1) + "%",
        color: "positive",
      },
      {
        label: t("p3ae.selfSufficiency"),
        value: fmtNum(s.selfSufficiency, 1) + "%",
        color: "positive",
      },
      {
        label: t("p3ae.peakDemand"),
        value: fmtNum(s.peakDemand, 2) + " kW",
        color: "",
      },
      {
        label: t("p3ae.savings"),
        value: fmtCurrency(s.savings),
        color: "positive",
      },
    ];

    var html = '<div class="kpi-grid kpi-grid-4 p3ae-summary">';
    cards.forEach(function (c) {
      html += Components.kpiCard({
        value: c.value,
        label: c.label,
        color: c.color,
      });
    });
    html += "</div>";
    return html;
  }

  function _buildChartCard() {
    var title =
      _granularity === "day"
        ? t("p3ae.chartTitle.day")
        : t("p3ae.chartTitle.period");
    // Eye icon for energy flow breakdown toggle
    var eyeBtn =
      '<button id="p3ae-flow-toggle" class="p3ae-flow-toggle' +
      (_energyFlowMode ? ' active' : '') +
      '" title="' + t("p3ae.energyFlow") + '">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>' +
      '<circle cx="12" cy="12" r="3"></circle>' +
      '</svg></button>';
    return (
      '<div class="section-card">' +
      '<div class="section-card-header" style="display:flex;align-items:center;justify-content:space-between">' +
      '<h3>' + title + '</h3>' +
      eyeBtn +
      '</div>' +
      '<div class="section-card-body">' +
      '<div id="p3ae-chart" class="chart-container p3ae-chart"></div>' +
      '</div></div>'
    );
  }

  // ── Chart Rendering ───────────────────────────────────────
  function _renderChart() {
    if (!_data || !_data.points || _data.points.length === 0) return;

    if (_granularity === "day") {
      _renderDayChart();
    } else {
      _renderBarChart();
    }
  }

  function _renderDayChart() {
    var pts = _data.points;

    var times = pts.map(function (p) {
      var d = new Date(p.t);
      return (
        String(d.getHours()).padStart(2, "0") +
        ":" +
        String(d.getMinutes()).padStart(2, "0")
      );
    });
    var pvData = pts.map(function (p) {
      return p.pv;
    });
    var loadData = pts.map(function (p) {
      return p.load;
    });
    var batData = pts.map(function (p) {
      return p.bat;
    });
    var gridData = pts.map(function (p) {
      return p.grid;
    });
    var socData = pts.map(function (p) {
      return p.soc;
    });

    var option = {
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1a1d27",
        borderColor: "#2a2d3a",
        borderWidth: 1,
        textStyle: { color: "#e4e4e7", fontSize: 12 },
        extraCssText:
          "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); max-width: 320px;",
        formatter: function (params) {
          var html = "<strong>" + params[0].axisValue + "</strong><br/>";
          params.forEach(function (p) {
            var val = typeof p.value === "number" ? p.value : null;
            if (val === null) return;
            var unit = p.seriesName === "SOC (%)" ? "%" : " kW";
            var suffix = "";
            if (p.seriesName === t("p3ae.series.bat")) {
              suffix =
                val >= 0
                  ? " (" + t("p3ae.charging") + ")"
                  : " (" + t("p3ae.discharging") + ")";
            } else if (p.seriesName === t("p3ae.series.grid")) {
              suffix =
                val >= 0
                  ? " (" + t("p3ae.importing") + ")"
                  : " (" + t("p3ae.exporting") + ")";
            }
            html +=
              '<span style="color:' +
              p.color +
              '">\u25CF</span> ' +
              p.seriesName +
              ": <strong>" +
              (typeof val === "number" ? val.toFixed(2) : val) +
              unit +
              "</strong>" +
              suffix +
              "<br/>";
          });
          return html;
        },
      },
      legend: {
        data: [
          t("p3ae.series.pv"),
          t("p3ae.series.load"),
          t("p3ae.series.bat"),
          t("p3ae.series.grid"),
          "SOC (%)",
        ],
        top: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
      },
      grid: { left: 12, right: 50, top: 50, bottom: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: times,
        boundaryGap: false,
        axisLabel: {
          interval: function (idx) {
            return idx % 12 === 0;
          },
          fontSize: 10,
          color: "#9ca3af",
        },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
        axisTick: { lineStyle: { color: "#2a2d3a" } },
      },
      yAxis: [
        {
          type: "value",
          name: "kW",
          nameTextStyle: { color: "#9ca3af", fontSize: 11 },
          axisLabel: { fontSize: 11, color: "#9ca3af" },
          splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
          axisLine: { lineStyle: { color: "#2a2d3a" } },
        },
        {
          type: "value",
          name: "SOC %",
          min: 0,
          max: 100,
          nameTextStyle: { color: "#9ca3af", fontSize: 11 },
          axisLabel: { fontSize: 11, color: "#9ca3af", formatter: "{value}%" },
          splitLine: { show: false },
          axisLine: { lineStyle: { color: "#f59e0b" } },
        },
      ],
      series: [
        {
          name: t("p3ae.series.pv"),
          type: "line",
          data: pvData,
          lineStyle: { color: "#eab308", width: 2 },
          itemStyle: { color: "#eab308" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(234, 179, 8, 0.2)" },
                { offset: 1, color: "rgba(234, 179, 8, 0.02)" },
              ],
            },
          },
          symbol: "none",
          smooth: true,
          z: 3,
        },
        {
          name: t("p3ae.series.load"),
          type: "line",
          data: loadData,
          lineStyle: { color: "#3b82f6", width: 2 },
          itemStyle: { color: "#3b82f6" },
          symbol: "none",
          smooth: true,
          z: 4,
        },
        {
          name: t("p3ae.series.bat"),
          type: "line",
          data: batData,
          lineStyle: { color: "#22c55e", width: 2 },
          itemStyle: { color: "#22c55e" },
          symbol: "none",
          smooth: true,
          z: 5,
        },
        {
          name: t("p3ae.series.grid"),
          type: "line",
          data: gridData,
          lineStyle: { width: 2, color: "#ef4444" },
          itemStyle: { color: "#ef4444" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(239, 68, 68, 0.15)" },
                { offset: 1, color: "rgba(239, 68, 68, 0.02)" },
              ],
            },
          },
          symbol: "none",
          smooth: true,
          z: 6,
        },
        {
          name: "SOC (%)",
          type: "line",
          yAxisIndex: 1,
          data: socData,
          lineStyle: { color: "#f59e0b", width: 1.5, type: "dashed" },
          itemStyle: { color: "#f59e0b" },
          symbol: "none",
          smooth: true,
          z: 2,
        },
      ],
      // Grid series color: red for import (>0), green for export (<0)
      // Using lineStyle.color function instead of visualMap to avoid coord errors
    };

    Charts.createChart("p3ae-chart", option, { pageId: "asset-energy" });
  }

  function _renderBarChart() {
    var pts = _data.points;

    var labels = pts.map(function (p) {
      var d = new Date(p.t);
      if (_granularity === "year") {
        return MONTHS_PT[d.getMonth()];
      }
      return (
        String(d.getDate()).padStart(2, "0") +
        "/" +
        String(d.getMonth() + 1).padStart(2, "0")
      );
    });

    // Load total for each period
    var loadData = pts.map(function (p) {
      return +(p.loadTotal || 0).toFixed(2);
    });

    var commonTooltip = {
      trigger: "axis",
      backgroundColor: "#1a1d27",
      borderColor: "#2a2d3a",
      borderWidth: 1,
      textStyle: { color: "#e4e4e7", fontSize: 12 },
      extraCssText:
        "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);",
    };
    var commonGrid = { left: 12, right: 20, top: 50, bottom: 12, containLabel: true };
    var commonXAxis = {
      type: "category",
      data: labels,
      axisLabel: { fontSize: 10, color: "#9ca3af" },
      axisLine: { lineStyle: { color: "#2a2d3a" } },
      axisTick: { lineStyle: { color: "#2a2d3a" } },
    };
    var commonYAxis = {
      type: "value",
      name: "kWh",
      nameTextStyle: { color: "#9ca3af", fontSize: 11 },
      axisLabel: { fontSize: 11, color: "#9ca3af" },
      splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
      axisLine: { lineStyle: { color: "#2a2d3a" } },
    };

    var option;

    if (!_energyFlowMode) {
      // === Simple mode: single blue bars (load total) ===
      option = {
        tooltip: commonTooltip,
        legend: {
          data: [t("p3ae.bar.load")],
          top: 0,
          textStyle: { color: "#9ca3af", fontSize: 11 },
        },
        grid: commonGrid,
        xAxis: commonXAxis,
        yAxis: commonYAxis,
        series: [
          {
            name: t("p3ae.bar.load"),
            type: "bar",
            data: loadData,
            itemStyle: {
              color: "#3b82f6",
              borderRadius: [3, 3, 0, 0],
            },
            barMaxWidth: 40,
          },
        ],
      };
    } else {
      // === Energy Flow mode: stacked source breakdown ===
      // Constraint: pvDirect + batDischarge + gridImport = loadTotal
      var batDischarge = pts.map(function (p) {
        return +(p.discharge || 0).toFixed(2);
      });
      var gridImport = pts.map(function (p) {
        return +(p.gridImport || 0).toFixed(2);
      });
      // PV direct = loadTotal - discharge - gridImport (residual, ensures sum = load)
      var pvDirect = pts.map(function (p, i) {
        var load = loadData[i];
        var bat = batDischarge[i];
        var grid = gridImport[i];
        return Math.max(0, +(load - bat - grid).toFixed(2));
      });

      option = {
        tooltip: commonTooltip,
        legend: {
          data: [
            t("p3ae.bar.pvDirect"),
            t("p3ae.bar.batDischarge"),
            t("p3ae.bar.gridImp"),
          ],
          top: 0,
          textStyle: { color: "#9ca3af", fontSize: 11 },
        },
        grid: commonGrid,
        xAxis: commonXAxis,
        yAxis: commonYAxis,
        series: [
          {
            name: t("p3ae.bar.pvDirect"),
            type: "bar",
            stack: "energy",
            data: pvDirect,
            itemStyle: { color: "#eab308" },
            barMaxWidth: 40,
          },
          {
            name: t("p3ae.bar.batDischarge"),
            type: "bar",
            stack: "energy",
            data: batDischarge,
            itemStyle: { color: "#22c55e" },
            barMaxWidth: 40,
          },
          {
            name: t("p3ae.bar.gridImp"),
            type: "bar",
            stack: "energy",
            data: gridImport,
            itemStyle: { color: "#ef4444", borderRadius: [3, 3, 0, 0] },
            barMaxWidth: 40,
          },
        ],
      };
    }

    Charts.createChart("p3ae-chart", option, { pageId: "asset-energy" });
  }

  // ── Data Fetch & Refresh ──────────────────────────────────
  function _refresh() {
    var container = document.getElementById(_containerId);
    if (!container) return;

    // Update display without full rebuild
    var dateDisplay = document.getElementById("p3ae-date-display");
    if (dateDisplay) dateDisplay.textContent = getDisplayDate();

    var dateInput = document.getElementById("p3ae-date-input");
    if (dateInput) dateInput.value = inputDateStr(_currentDate);

    // Update active granularity button
    document.querySelectorAll(".p3ae-gran-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.gran === _granularity);
    });

    _fetchAndRender();
  }

  function _fetchAndRender() {
    // Debounce: cancel pending fetch, wait 250ms before firing
    if (_fetchTimer) clearTimeout(_fetchTimer);
    _fetchTimer = setTimeout(_doFetch, 250);
  }

  function _doFetch() {
    _fetchTimer = null;
    var range = getDateRange();
    var fetchId = Date.now();
    _fetchAbort = fetchId;

    // Show loading state on chart
    var chartEl = document.getElementById("p3ae-chart");
    if (chartEl) {
      var existing = echarts.getInstanceByDom(chartEl);
      if (existing)
        existing.showLoading({
          color: "#3b82f6",
          maskColor: "rgba(15, 17, 23, 0.7)",
        });
    }

    DataSource.asset
      .telemetry(_assetId, range.from, range.to, range.resolution)
      .then(function (data) {
        // Stale response guard: ignore if a newer fetch was triggered
        if (_fetchAbort !== fetchId) return;
        _data = data;
        // Hide loading spinner before re-rendering
        var chartEl3 = document.getElementById("p3ae-chart");
        if (chartEl3) {
          var inst2 = echarts.getInstanceByDom(chartEl3);
          if (inst2) inst2.hideLoading();
        }
        _updateSummaryCards();
        _renderChart();

        var titleText =
          _granularity === "day"
            ? t("p3ae.chartTitle.day")
            : t("p3ae.chartTitle.period");
        var titleEl = document.querySelector(
          ".p3ae-page .section-card-header h3",
        );
        if (titleEl) titleEl.textContent = titleText;
      })
      .catch(function (err) {
        if (_fetchAbort !== fetchId) return;
        console.error("[AssetEnergy] fetch failed:", err);
        var chartEl2 = document.getElementById("p3ae-chart");
        if (chartEl2) {
          var inst = echarts.getInstanceByDom(chartEl2);
          if (inst) inst.hideLoading();
        }
      });
  }

  function _updateSummaryCards() {
    var container = document.querySelector(".p3ae-summary");
    if (!container) return;
    var s = (_data && _data.summary) || {};
    var cards = [
      {
        label: t("p3ae.pvTotal"),
        value: fmtNum(s.pvTotal, 1) + " kWh",
        color: "positive",
      },
      {
        label: t("p3ae.loadTotal"),
        value: fmtNum(s.loadTotal, 1) + " kWh",
        color: "",
      },
      {
        label: t("p3ae.gridImport"),
        value: fmtNum(s.gridImport, 1) + " kWh",
        color: "negative",
      },
      {
        label: t("p3ae.gridExport"),
        value: fmtNum(s.gridExport, 1) + " kWh",
        color: "positive",
      },
      {
        label: t("p3ae.selfConsumption"),
        value: fmtNum(s.selfConsumption, 1) + "%",
        color: "positive",
      },
      {
        label: t("p3ae.selfSufficiency"),
        value: fmtNum(s.selfSufficiency, 1) + "%",
        color: "positive",
      },
      {
        label: t("p3ae.peakDemand"),
        value: fmtNum(s.peakDemand, 2) + " kW",
        color: "",
      },
      {
        label: t("p3ae.savings"),
        value: fmtCurrency(s.savings),
        color: "positive",
      },
    ];

    var html = "";
    cards.forEach(function (c) {
      html += Components.kpiCard({
        value: c.value,
        label: c.label,
        color: c.color,
      });
    });
    container.innerHTML = html;
  }

  // ── Event Binding ─────────────────────────────────────────
  function _setupEvents() {
    // Energy Flow toggle (eye icon)
    var flowBtn = document.getElementById("p3ae-flow-toggle");
    if (flowBtn) {
      flowBtn.addEventListener("click", function () {
        _energyFlowMode = !_energyFlowMode;
        flowBtn.classList.toggle("active", _energyFlowMode);
        _renderChart(); // re-render without refetching
      });
    }

    // Granularity buttons
    document.querySelectorAll(".p3ae-gran-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _granularity = btn.dataset.gran;
        _refresh();
      });
    });

    // Prev/Next arrows
    var prevBtn = document.getElementById("p3ae-prev");
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        navigatePeriod(-1);
      });
    }
    var nextBtn = document.getElementById("p3ae-next");
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        navigatePeriod(1);
      });
    }

    // Date input
    var dateInput = document.getElementById("p3ae-date-input");
    if (dateInput) {
      dateInput.addEventListener("change", function () {
        var parts = dateInput.value.split("-");
        if (parts.length === 3) {
          _currentDate = new Date(
            parseInt(parts[0], 10),
            parseInt(parts[1], 10) - 1,
            parseInt(parts[2], 10),
          );
          _refresh();
        }
      });
    }

    // Shortcut buttons
    document.querySelectorAll(".p3ae-shortcut").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sc = btn.dataset.shortcut;
        // Use last day in demo data range as "today"
        var today = new Date(DATA_END);
        if (sc === "today") {
          _granularity = "day";
          _currentDate = today;
        } else if (sc === "yesterday") {
          _granularity = "day";
          _currentDate = addDays(today, -1);
        } else if (sc === "7d") {
          _granularity = "week";
          _currentDate = today;
        } else if (sc === "30d") {
          _granularity = "month";
          _currentDate = today;
        }
        _refresh();
      });
    });
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init: function (assetId, containerId) {
      _assetId = assetId;
      _containerId = containerId || "p3-sub-content";
      // Default to a date with known demo data
      _currentDate = new Date(2026, 0, 21); // Jan 21, 2026
      _granularity = "day";
      _data = null;

      var container = document.getElementById(_containerId);
      if (!container) return Promise.resolve();

      container.innerHTML = _buildSkeleton();

      var range = getDateRange();

      return DataSource.asset
        .telemetry(_assetId, range.from, range.to, range.resolution)
        .then(function (data) {
          _data = data;
          container.innerHTML = _buildPage();
          _setupEvents();
          _renderChart();
        })
        .catch(function (err) {
          showErrorBoundary(_containerId, err);
        });
    },

    dispose: function () {
      Charts.disposePageCharts("asset-energy");
      _data = null;
    },

    onRoleChange: function () {},
  };
})();
