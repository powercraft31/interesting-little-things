/* ============================================
   SOLFACIL Admin Portal — P3-2: Asset Health
   SOC/SOH/Temperature/Voltage charts + DO events table.
   Accessed via #asset-health/:assetId
   ============================================ */

// eslint-disable-next-line no-unused-vars
var AssetHealthPage = (function () {
  // ── State ─────────────────────────────────────────────────
  var _assetId = null;
  var _containerId = "p3-sub-content";
  var _granularity = "day"; // day | week | month | year
  var _currentDate = null;
  var _data = null;
  var _fetchTimer = null;
  var _fetchAbort = null;

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

  var DATA_START = new Date("2025-12-13T03:00:00Z");
  var DATA_END = new Date("2026-03-12T03:00:00Z");

  // ── Helpers (same as P3-1) ────────────────────────────────
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
    var t2 =
      String(to.getDate()).padStart(2, "0") +
      "/" +
      String(to.getMonth() + 1).padStart(2, "0") +
      "/" +
      to.getFullYear();
    return f + " — " + t2 + " · BRT";
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
    var diff = day === 0 ? 6 : day - 1;
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
    var from, to;
    if (_granularity === "day") {
      from = toISOBRT(d);
      to = toISOBRT(addDays(d, 1));
    } else if (_granularity === "week") {
      var ws = startOfWeek(d);
      from = toISOBRT(ws);
      to = toISOBRT(addDays(ws, 7));
    } else if (_granularity === "month") {
      var ms = startOfMonth(d);
      var me = endOfMonth(d);
      from = toISOBRT(ms);
      to = toISOBRT(addDays(me, 1));
    } else {
      var ys = startOfYear(d);
      from = toISOBRT(ys);
      to = toISOBRT(new Date(d.getFullYear() + 1, 0, 1));
    }
    return { from: from, to: to };
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
    }
    return d.getFullYear() + " · BRT";
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

  function fmtTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var dd = String(d.getDate()).padStart(2, "0");
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var hh = String(d.getHours()).padStart(2, "0");
    var min = String(d.getMinutes()).padStart(2, "0");
    return dd + "/" + mm + " " + hh + ":" + min;
  }

  // ── Build HTML ────────────────────────────────────────────
  function _buildSkeleton() {
    return (
      '<div class="p3ah-page">' +
      '<div class="p3ae-header"><div class="skeleton" style="width:300px;height:28px;border-radius:6px"></div></div>' +
      '<div class="p3ae-controls"><div class="skeleton" style="width:100%;height:48px;border-radius:6px"></div></div>' +
      Components.skeletonKPIs(6) +
      Components.skeletonChart() +
      "</div>"
    );
  }

  function _buildPage() {
    return (
      '<div class="p3ah-page">' +
      '<div class="p3ae-header">' +
      '<span class="p3ae-date-display" id="p3ah-date-display">' +
      getDisplayDate() +
      "</span>" +
      "</div>" +
      _buildControls() +
      _buildSummaryCards() +
      _buildSOCChart() +
      _buildSOHChart() +
      _buildTempChart() +
      _buildVoltageChart() +
      _buildDOTable() +
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
          '<button class="p3ae-gran-btn p3ah-gran-btn' +
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
      '<button class="p3ae-shortcut p3ah-shortcut" data-shortcut="today">' +
      t("p3ae.today") +
      "</button>" +
      '<button class="p3ae-shortcut p3ah-shortcut" data-shortcut="yesterday">' +
      t("p3ae.yesterday") +
      "</button>" +
      '<button class="p3ae-shortcut p3ah-shortcut" data-shortcut="7d">' +
      t("p3ae.7days") +
      "</button>" +
      '<button class="p3ae-shortcut p3ah-shortcut" data-shortcut="30d">' +
      t("p3ae.30days") +
      "</button>";

    return (
      '<div class="p3ae-controls">' +
      '<div class="p3ae-controls-row">' +
      '<div class="p3ae-gran-group">' +
      granBtns +
      "</div>" +
      '<div class="p3ae-nav-group">' +
      '<button class="p3ae-nav-arrow" id="p3ah-prev">&larr;</button>' +
      '<input type="date" id="p3ah-date-input" class="p3ae-date-input" value="' +
      inputDateStr(_currentDate) +
      '" min="2025-12-13" max="2026-03-12" />' +
      '<button class="p3ae-nav-arrow" id="p3ah-next">&rarr;</button>' +
      "</div>" +
      '<div class="p3ae-shortcuts">' +
      shortcuts +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function _statusColor(status) {
    if (!status) return "";
    var s = String(status).toLowerCase();
    if (s === "charging") return "positive";
    if (s === "discharging") return "negative";
    return "";
  }

  function _statusLabel(status) {
    if (!status) return "—";
    var s = String(status).toLowerCase();
    if (s === "charging") return t("p3ah.charging");
    if (s === "discharging") return t("p3ah.discharging");
    if (s === "standby") return t("p3ah.standby");
    return status;
  }

  function _buildSummaryCards() {
    var c = (_data && _data.current) || {};
    var cards = [
      {
        label: t("p3ah.soc"),
        value: fmtNum(c.soc, 1) + "%",
        color: "positive",
      },
      { label: t("p3ah.soh"), value: fmtNum(c.soh, 1) + "%", color: "" },
      {
        label: t("p3ah.batTemp"),
        value: fmtNum(c.batTemp, 1) + " °C",
        color: "",
      },
      {
        label: t("p3ah.invTemp"),
        value: fmtNum(c.invTemp, 1) + " °C",
        color: "",
      },
      {
        label: t("p3ah.batteryCycles"),
        value: fmtNum(_data && _data.batteryCycles, 0),
        color: "",
      },
      {
        label: t("p3ah.status"),
        value: _statusLabel(c.status),
        color: _statusColor(c.status),
      },
    ];

    var html = '<div class="kpi-grid kpi-grid-3 p3ah-summary">';
    cards.forEach(function (card) {
      html += Components.kpiCard({
        value: card.value,
        label: card.label,
        color: card.color,
      });
    });
    html += "</div>";
    return html;
  }

  function _buildSOCChart() {
    return Components.sectionCard(
      t("p3ah.socHistory"),
      '<div id="p3ah-soc-chart" class="chart-container p3ah-chart"></div>',
    );
  }

  function _buildSOHChart() {
    var isDayView = _granularity === "day";
    var content = isDayView
      ? '<div class="p3ah-soh-hint">' + t("p3ah.sohHint") + "</div>"
      : '<div id="p3ah-soh-chart" class="chart-container p3ah-chart"></div>';
    return Components.sectionCard(t("p3ah.sohTrend"), content);
  }

  function _buildTempChart() {
    return Components.sectionCard(
      t("p3ah.tempHistory"),
      '<div id="p3ah-temp-chart" class="chart-container p3ah-chart"></div>',
    );
  }

  function _buildVoltageChart() {
    return Components.sectionCard(
      t("p3ah.voltageCurrent"),
      '<div id="p3ah-voltage-chart" class="chart-container p3ah-chart"></div>',
    );
  }

  function _buildDOTable() {
    var events = (_data && _data.doEvents) || [];
    if (events.length === 0) {
      return Components.sectionCard(
        t("p3ah.doEvents"),
        '<p class="p3ah-no-events">' + t("p3ah.noDoEvents") + "</p>",
      );
    }

    var rows = events
      .map(function (ev) {
        return (
          "<tr>" +
          "<td>" +
          fmtTime(ev.start) +
          "</td>" +
          "<td>" +
          fmtTime(ev.end) +
          "</td>" +
          "<td>" +
          fmtNum(ev.durationMin, 0) +
          " min</td>" +
          "</tr>"
        );
      })
      .join("");

    var table =
      '<table class="data-table p3ah-do-table">' +
      "<thead><tr>" +
      "<th>" +
      t("p3ah.doStart") +
      "</th>" +
      "<th>" +
      t("p3ah.doEnd") +
      "</th>" +
      "<th>" +
      t("p3ah.doDuration") +
      "</th>" +
      "</tr></thead>" +
      "<tbody>" +
      rows +
      "</tbody>" +
      "</table>";

    return Components.sectionCard(t("p3ah.doEvents"), table);
  }

  // ── Chart Rendering ───────────────────────────────────────
  function _darkTooltip() {
    return {
      trigger: "axis",
      backgroundColor: "#1a1d27",
      borderColor: "#2a2d3a",
      borderWidth: 1,
      textStyle: { color: "#e4e4e7", fontSize: 12 },
      extraCssText:
        "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);",
    };
  }

  function _darkAxis() {
    return {
      axisLabel: { fontSize: 11, color: "#9ca3af" },
      axisLine: { lineStyle: { color: "#2a2d3a" } },
      axisTick: { lineStyle: { color: "#2a2d3a" } },
      splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
    };
  }

  function _timeLabels(pts, field) {
    return pts.map(function (p) {
      var d = new Date(p[field || "t"]);
      return (
        String(d.getHours()).padStart(2, "0") +
        ":" +
        String(d.getMinutes()).padStart(2, "0")
      );
    });
  }

  function _renderSOCChart() {
    var pts = (_data && _data.socHistory) || [];
    if (pts.length === 0) return;

    var times = _timeLabels(pts, "t");
    var values = pts.map(function (p) {
      return p.soc;
    });

    var option = {
      tooltip: _darkTooltip(),
      legend: {
        data: ["SOC (%)"],
        top: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
      },
      grid: { left: 12, right: 20, top: 50, bottom: 12, containLabel: true },
      xAxis: Object.assign(
        {
          type: "category",
          data: times,
          boundaryGap: false,
        },
        _darkAxis(),
      ),
      yAxis: Object.assign(
        {
          type: "value",
          name: "%",
          min: 0,
          max: 100,
          nameTextStyle: { color: "#9ca3af", fontSize: 11 },
        },
        _darkAxis(),
      ),
      series: [
        {
          name: "SOC (%)",
          type: "line",
          data: values,
          lineStyle: { color: "#f59e0b", width: 2 },
          itemStyle: { color: "#f59e0b" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(245, 158, 11, 0.2)" },
                { offset: 1, color: "rgba(245, 158, 11, 0.02)" },
              ],
            },
          },
          symbol: "none",
          smooth: true,
        },
      ],
    };

    Charts.createChart("p3ah-soc-chart", option, { pageId: "asset-health" });
  }

  function _renderSOHChart() {
    if (_granularity === "day") return;

    var pts = (_data && _data.sohTrend) || [];
    if (pts.length === 0) return;

    var labels = pts.map(function (p) {
      var d = new Date(p.day);
      return (
        String(d.getDate()).padStart(2, "0") +
        "/" +
        String(d.getMonth() + 1).padStart(2, "0")
      );
    });
    var values = pts.map(function (p) {
      return p.soh;
    });

    var option = {
      tooltip: _darkTooltip(),
      legend: {
        data: ["SOH (%)"],
        top: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
      },
      grid: { left: 12, right: 20, top: 50, bottom: 12, containLabel: true },
      xAxis: Object.assign(
        {
          type: "category",
          data: labels,
          boundaryGap: false,
        },
        _darkAxis(),
      ),
      yAxis: Object.assign(
        {
          type: "value",
          name: "%",
          min: 95,
          max: 100,
          nameTextStyle: { color: "#9ca3af", fontSize: 11 },
        },
        _darkAxis(),
      ),
      series: [
        {
          name: "SOH (%)",
          type: "line",
          data: values,
          lineStyle: { color: "#8b5cf6", width: 2 },
          itemStyle: { color: "#8b5cf6" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(139, 92, 246, 0.2)" },
                { offset: 1, color: "rgba(139, 92, 246, 0.02)" },
              ],
            },
          },
          symbol: "circle",
          symbolSize: 4,
          smooth: true,
        },
      ],
    };

    Charts.createChart("p3ah-soh-chart", option, { pageId: "asset-health" });
  }

  function _renderTempChart() {
    var pts = (_data && _data.tempHistory) || [];
    if (pts.length === 0) return;

    var times = _timeLabels(pts, "t");
    var batTemp = pts.map(function (p) {
      return p.batTemp;
    });
    var invTemp = pts.map(function (p) {
      return p.invTemp;
    });

    var option = {
      tooltip: _darkTooltip(),
      legend: {
        data: [t("p3ah.batTemp"), t("p3ah.invTemp")],
        top: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
      },
      grid: { left: 12, right: 20, top: 50, bottom: 12, containLabel: true },
      xAxis: Object.assign(
        {
          type: "category",
          data: times,
          boundaryGap: false,
        },
        _darkAxis(),
      ),
      yAxis: Object.assign(
        {
          type: "value",
          name: "°C",
          nameTextStyle: { color: "#9ca3af", fontSize: 11 },
        },
        _darkAxis(),
      ),
      series: [
        {
          name: t("p3ah.batTemp"),
          type: "line",
          data: batTemp,
          lineStyle: { color: "#ef4444", width: 2 },
          itemStyle: { color: "#ef4444" },
          symbol: "none",
          smooth: true,
        },
        {
          name: t("p3ah.invTemp"),
          type: "line",
          data: invTemp,
          lineStyle: { color: "#f97316", width: 2 },
          itemStyle: { color: "#f97316" },
          symbol: "none",
          smooth: true,
        },
      ],
    };

    Charts.createChart("p3ah-temp-chart", option, { pageId: "asset-health" });
  }

  function _renderVoltageChart() {
    var pts = (_data && _data.voltageHistory) || [];
    if (pts.length === 0) return;

    var times = _timeLabels(pts, "t");
    var voltages = pts.map(function (p) {
      return p.voltage;
    });
    var currents = pts.map(function (p) {
      return p.current;
    });

    var option = {
      tooltip: _darkTooltip(),
      legend: {
        data: [t("p3ah.voltage"), t("p3ah.current")],
        top: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
      },
      grid: { left: 12, right: 50, top: 50, bottom: 12, containLabel: true },
      xAxis: Object.assign(
        {
          type: "category",
          data: times,
          boundaryGap: false,
        },
        _darkAxis(),
      ),
      yAxis: [
        Object.assign(
          {
            type: "value",
            name: "V",
            nameTextStyle: { color: "#9ca3af", fontSize: 11 },
          },
          _darkAxis(),
        ),
        Object.assign(
          {
            type: "value",
            name: "A",
            nameTextStyle: { color: "#9ca3af", fontSize: 11 },
            splitLine: { show: false },
          },
          _darkAxis(),
        ),
      ],
      series: [
        {
          name: t("p3ah.voltage"),
          type: "line",
          data: voltages,
          lineStyle: { color: "#3b82f6", width: 2 },
          itemStyle: { color: "#3b82f6" },
          symbol: "none",
          smooth: true,
        },
        {
          name: t("p3ah.current"),
          type: "line",
          yAxisIndex: 1,
          data: currents,
          lineStyle: { color: "#22c55e", width: 2 },
          itemStyle: { color: "#22c55e" },
          symbol: "none",
          smooth: true,
        },
      ],
    };

    Charts.createChart("p3ah-voltage-chart", option, {
      pageId: "asset-health",
    });
  }

  function _renderAllCharts() {
    _renderSOCChart();
    _renderSOHChart();
    _renderTempChart();
    _renderVoltageChart();
  }

  // ── Data Fetch & Refresh ──────────────────────────────────
  function _refresh() {
    var container = document.getElementById(_containerId);
    if (!container) return;

    var dateDisplay = document.getElementById("p3ah-date-display");
    if (dateDisplay) dateDisplay.textContent = getDisplayDate();

    var dateInput = document.getElementById("p3ah-date-input");
    if (dateInput) dateInput.value = inputDateStr(_currentDate);

    document.querySelectorAll(".p3ah-gran-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.gran === _granularity);
    });

    _fetchAndRender();
  }

  function _fetchAndRender() {
    if (_fetchTimer) clearTimeout(_fetchTimer);
    _fetchTimer = setTimeout(_doFetch, 250);
  }

  function _doFetch() {
    _fetchTimer = null;
    var range = getDateRange();
    var fetchId = Date.now();
    _fetchAbort = fetchId;

    DataSource.asset
      .health(_assetId, range.from, range.to)
      .then(function (data) {
        if (_fetchAbort !== fetchId) return;
        _data = data;
        var container = document.getElementById(_containerId);
        if (!container) return;
        Charts.disposePageCharts("asset-health");
        container.innerHTML = _buildPage();
        _setupEvents();
        _renderAllCharts();
      })
      .catch(function (err) {
        if (_fetchAbort !== fetchId) return;
        console.error("[AssetHealth] fetch failed:", err);
        showErrorBoundary(_containerId, err);
      });
  }

  // ── Event Binding ─────────────────────────────────────────
  function _setupEvents() {
    // Granularity buttons
    document.querySelectorAll(".p3ah-gran-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _granularity = btn.dataset.gran;
        _refresh();
      });
    });

    var prevBtn = document.getElementById("p3ah-prev");
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        navigatePeriod(-1);
      });
    }
    var nextBtn = document.getElementById("p3ah-next");
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        navigatePeriod(1);
      });
    }

    var dateInput = document.getElementById("p3ah-date-input");
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

    document.querySelectorAll(".p3ah-shortcut").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sc = btn.dataset.shortcut;
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
      _currentDate = new Date(2026, 0, 21);
      _granularity = "day";
      _data = null;

      var container = document.getElementById(_containerId);
      if (!container) return Promise.resolve();

      container.innerHTML = _buildSkeleton();

      var range = getDateRange();

      return DataSource.asset
        .health(_assetId, range.from, range.to)
        .then(function (data) {
          _data = data;
          container.innerHTML = _buildPage();
          _setupEvents();
          _renderAllCharts();
        })
        .catch(function (err) {
          showErrorBoundary(_containerId, err);
        });
    },

    dispose: function () {
      Charts.disposePageCharts("asset-health");
      _data = null;
    },

    onRoleChange: function () {},
  };
})();
