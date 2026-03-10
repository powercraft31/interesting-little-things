/* ============================================
   SOLFACIL Admin Portal — P3: Energy Behavior
   Most chart-intensive page. Main 24hr energy flow chart
   + per-device behavior tabs + before/after comparison.
   ============================================ */

var EnergyPage = {
  _currentGateway: null,
  _activeDeviceTab: "battery",

  _gatewayKeys: [],

  _baCompare: {
    0: {
      before: { selfCons: 82, peakKw: 3.2, gridImport: 18.5 },
      after: { selfCons: 97, peakKw: 1.8, gridImport: 4.2 },
    },
    1: {
      before: { selfCons: 78, peakKw: 3.5, gridImport: 22.1 },
      after: { selfCons: 95, peakKw: 2.0, gridImport: 6.8 },
    },
    2: {
      before: { selfCons: 85, peakKw: 3.0, gridImport: 16.2 },
      after: { selfCons: 98, peakKw: 1.6, gridImport: 3.1 },
    },
  },

  _crossGatewaySummary: [],

  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  init: async function () {
    var self = this;
    var container = document.getElementById("energy-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      var results = await Promise.all([
        DataSource.devices.gateways(),
        DataSource.energy.summary(),
      ]);
      self._gateways = results[0];
      self._crossGatewaySummary =
        results[1] && results[1].length
          ? results[1]
          : self._crossGatewaySummary;
      self._currentGateway = self._gateways.length
        ? self._gateways[0].gatewayId
        : null;

      var energyData = self._currentGateway
        ? await DataSource.energy.gatewayEnergy(self._currentGateway)
        : {};
      self._currentEnergyData = energyData;
    } catch (err) {
      showErrorBoundary("energy-content", err);
      return;
    }

    container.innerHTML = self._buildContent();
    self._setupEventListeners();
    self._initCharts();
  },

  onRoleChange: function () {},

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return [
      '<div class="p3-home-selector-wrap"><div class="skeleton" style="width:260px;height:40px;border-radius:6px"></div></div>',
      Components.skeletonChart(),
      '<div style="margin-top:16px">' + Components.skeletonChart() + "</div>",
      '<div class="two-col" style="margin-top:16px">',
      '<div class="section-card"><div class="section-card-body">' +
        Components.skeletonChart() +
        "</div></div>",
      '<div class="section-card"><div class="section-card-body">' +
        Components.skeletonChart() +
        "</div></div>",
      "</div>",
      Components.skeletonTable(3),
    ].join("");
  },

  // =========================================================
  // CONTENT BUILDER
  // =========================================================

  _buildContent: function () {
    return [
      this._buildGatewaySelector(),
      this._buildMainChartCard(),
      this._buildDeviceTabsCard(),
      this._buildBeforeAfterCard(),
      this._buildCrossGatewaySummaryCard(),
    ].join("");
  },

  _buildGatewaySelector: function () {
    var gateways = this._gateways || [];
    var currentGw = this._currentGateway;
    var options = gateways
      .map(function (gw) {
        var selected = gw.gatewayId === currentGw ? " selected" : "";
        return (
          '<option value="' +
          gw.gatewayId +
          '"' +
          selected +
          ">" +
          gw.name +
          " (" +
          gw.gatewayId +
          ")</option>"
        );
      })
      .join("");

    return (
      '<div class="p3-home-selector-wrap">' +
      '<label class="p3-selector-label">' +
      t("energy.gatewayLabel") +
      "</label>" +
      '<select id="p3-home-select" class="p3-home-select">' +
      options +
      "</select>" +
      "</div>"
    );
  },

  _buildMainChartCard: function () {
    return Components.sectionCard(
      t("energy.mainChart"),
      '<div id="chart-energy-main" class="chart-container p3-main-chart"></div>',
      {
        headerRight:
          '<span class="p3-chart-legend-hint">' +
          t("energy.legendHint") +
          "</span>",
      },
    );
  },

  _buildDeviceTabsCard: function () {
    var tabs = [
      { id: "battery", labelKey: "energy.tab.battery" },
      { id: "ac", labelKey: "energy.tab.ac" },
      { id: "ev", labelKey: "energy.tab.ev" },
    ];

    var tabHTML =
      '<div class="p3-device-tabs">' +
      tabs
        .map(function (tab) {
          var cls = tab.id === EnergyPage._activeDeviceTab ? " active" : "";
          return (
            '<button class="p3-device-tab' +
            cls +
            '" data-tab="' +
            tab.id +
            '">' +
            t(tab.labelKey) +
            "</button>"
          );
        })
        .join("") +
      "</div>";

    var panels = [
      '<div class="p3-tab-panel" id="p3-panel-battery" style="display:block"><div id="chart-energy-battery" class="chart-container p3-device-chart"></div></div>',
      '<div class="p3-tab-panel" id="p3-panel-ac" style="display:none"><div id="chart-energy-ac" class="chart-container p3-device-chart"></div></div>',
      '<div class="p3-tab-panel" id="p3-panel-ev" style="display:none"><div id="chart-energy-ev" class="chart-container p3-device-chart"></div></div>',
    ].join("");

    return Components.sectionCard(t("energy.perDevice"), tabHTML + panels);
  },

  _buildBeforeAfterCard: function () {
    var gateways = this._gateways || [];
    var gwIdx = gateways.findIndex(function (gw) {
      return gw.gatewayId === EnergyPage._currentGateway;
    });
    if (gwIdx < 0) gwIdx = 0;
    var ba = this._baCompare[gwIdx] || this._baCompare[0];

    var html =
      '<div class="p3-ba-header">' +
      '<div class="p3-ba-date"><label>' +
      t("energy.ba.beforeOpt") +
      '</label><input type="date" value="2026-03-02" disabled></div>' +
      '<div class="p3-ba-arrow">\u2192</div>' +
      '<div class="p3-ba-date"><label>' +
      t("energy.ba.afterOpt") +
      '</label><input type="date" value="2026-03-04" disabled></div>' +
      "</div>" +
      '<div class="p3-ba-cards" id="p3-ba-cards">' +
      this._buildBACards(ba) +
      "</div>";

    return Components.sectionCard(t("energy.beforeAfter"), html);
  },

  _buildBACards: function (ba) {
    var cards = [
      {
        label: t("energy.ba.selfCons"),
        before: ba.before.selfCons + "%",
        after: ba.after.selfCons + "%",
        delta: "+" + (ba.after.selfCons - ba.before.selfCons) + "%",
        positive: true,
      },
      {
        label: t("energy.ba.peakUsage"),
        before: ba.before.peakKw.toFixed(1) + " kW",
        after: ba.after.peakKw.toFixed(1) + " kW",
        delta: (ba.after.peakKw - ba.before.peakKw).toFixed(1) + " kW",
        positive: false,
      },
      {
        label: t("energy.ba.gridImport"),
        before: ba.before.gridImport.toFixed(1) + " kWh",
        after: ba.after.gridImport.toFixed(1) + " kWh",
        delta: (ba.after.gridImport - ba.before.gridImport).toFixed(1) + " kWh",
        positive: false,
      },
    ];

    return cards
      .map(function (c) {
        var deltaClass = "positive";
        return (
          '<div class="p3-ba-card">' +
          '<div class="p3-ba-label">' +
          c.label +
          "</div>" +
          '<div class="p3-ba-values">' +
          '<div class="p3-ba-before"><span class="p3-ba-dim">' +
          t("energy.ba.before") +
          '</span><span class="p3-ba-val">' +
          c.before +
          "</span></div>" +
          '<div class="p3-ba-after"><span class="p3-ba-dim">' +
          t("energy.ba.after") +
          '</span><span class="p3-ba-val ' +
          deltaClass +
          '">' +
          c.after +
          "</span></div>" +
          "</div>" +
          '<div class="p3-ba-delta no-prefix ' +
          deltaClass +
          '">' +
          c.delta +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  },

  _buildCrossGatewaySummaryCard: function () {
    var table = Components.dataTable({
      columns: [
        { key: "name", label: t("energy.col.gateway") },
        {
          key: "selfCons",
          label: t("energy.col.selfCons"),
          align: "right",
          mono: true,
          format: function (v) {
            return (
              '<span class="no-prefix positive">' + formatPercent(v) + "</span>"
            );
          },
        },
        {
          key: "gridExport",
          label: t("energy.col.export"),
          align: "right",
          mono: true,
          format: function (v) {
            return formatNumber(v, 1);
          },
        },
        {
          key: "gridImport",
          label: t("energy.col.import"),
          align: "right",
          mono: true,
          format: function (v) {
            return formatNumber(v, 1);
          },
        },
        {
          key: "peakLoad",
          label: t("energy.col.peak"),
          align: "right",
          mono: true,
          format: function (v) {
            return formatNumber(v, 1);
          },
        },
        {
          key: "mode",
          label: t("energy.col.targetMode"),
          format: function (v) {
            var lbl = t("energy.mode." + v);
            var modeBadgeClass = {
              self_consumption: "mode-self",
              peak_valley_arbitrage: "mode-arb",
              peak_shaving: "mode-peak",
            };
            var cls = modeBadgeClass[v] || "";
            return '<span class="p3-mode-badge ' + cls + '">' + lbl + "</span>";
          },
        },
      ],
      rows: EnergyPage._crossGatewaySummary,
    });

    return Components.sectionCard(t("energy.crossGateway"), table);
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupEventListeners: function () {
    var select = document.getElementById("p3-home-select");
    if (select) {
      select.addEventListener("change", function () {
        EnergyPage._switchGateway(select.value);
      });
    }

    document.querySelectorAll(".p3-device-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        EnergyPage._switchDeviceTab(btn.dataset.tab);
      });
    });
  },

  _switchGateway: async function (gatewayId) {
    var self = this;
    self._currentGateway = gatewayId;
    try {
      self._currentEnergyData =
        await DataSource.energy.gatewayEnergy(gatewayId);
      self._initMainChart();
      self._initActiveDeviceChart();
    } catch (err) {
      console.error("[Energy] Gateway switch failed:", err);
    }
    var gateways = self._gateways || [];
    var gwIdx = gateways.findIndex(function (gw) {
      return gw.gatewayId === gatewayId;
    });
    if (gwIdx < 0) gwIdx = 0;
    var ba = self._baCompare[gwIdx];
    var cardsEl = document.getElementById("p3-ba-cards");
    if (cardsEl && ba) {
      cardsEl.innerHTML = self._buildBACards(ba);
    }
  },

  _switchDeviceTab: function (tab) {
    this._activeDeviceTab = tab;

    document.querySelectorAll(".p3-device-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    var panels = ["battery", "ac", "ev"];
    panels.forEach(function (p) {
      var panel = document.getElementById("p3-panel-" + p);
      if (panel) panel.style.display = p === tab ? "block" : "none";
    });

    this._initActiveDeviceChart();
  },

  _initActiveDeviceChart: function () {
    var tab = this._activeDeviceTab;
    try {
      if (tab === "battery") this._initBatteryChart();
      else if (tab === "ac") this._initACChart();
      else if (tab === "ev") this._initEVChart();
    } catch (e) {
      console.error("[Energy] Device chart error:", e);
    }
  },

  // =========================================================
  // HELPERS
  // =========================================================

  _getHomeData: function () {
    if (this._currentEnergyData) return this._currentEnergyData;
    var allData = DemoStore.get("homeData");
    if (!allData) return null;
    return allData[this._currentHome] || null;
  },

  // =========================================================
  // CHART INITIALIZATION
  // =========================================================

  _initCharts: function () {
    try {
      this._initMainChart();
    } catch (e) {
      console.error("[Energy] Main chart error:", e);
    }
    try {
      this._initBatteryChart();
    } catch (e) {
      console.error("[Energy] Battery chart error:", e);
    }
    requestAnimationFrame(function () {
      Charts.activatePageCharts("energy");
    });
  },

  _initMainChart: function () {
    var data = this._getHomeData();
    if (!data) return;

    var pv = data.pv;
    var load = data.load;
    var battery = data.battery;
    var grid = data.grid;
    var baseline = data.baseline;

    var gridFloor = grid.map(function (v) {
      return Math.max(0, v);
    });
    var savingsBand = baseline.map(function (b, i) {
      return Math.max(0, +(b - gridFloor[i]).toFixed(2));
    });

    var option = {
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1a1d27",
        borderColor: "#2a2d3a",
        borderWidth: 1,
        textStyle: { color: "#e4e4e7", fontSize: 12 },
        extraCssText:
          "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); max-width: 280px;",
        formatter: function (params) {
          var timeLabel = params[0].axisValue;
          var hour = parseInt(timeLabel.split(":")[0], 10);
          var tariff = getTariffForHour(hour);
          var tierColor =
            tariff.tier === "peak"
              ? "#ef4444"
              : tariff.tier === "intermediate"
                ? "#f59e0b"
                : "#3b82f6";
          var html =
            "<strong>" +
            timeLabel +
            '</strong> <span style="color:' +
            tierColor +
            '">(' +
            tariff.tier +
            " R$" +
            tariff.price.toFixed(2) +
            ")</span><br/>";

          params.forEach(function (p) {
            if (
              p.seriesName.charAt(0) === "_" ||
              p.seriesName === "Savings Area"
            )
              return;
            var val =
              typeof p.value === "number"
                ? p.value
                : Array.isArray(p.value)
                  ? p.value[1]
                  : null;
            if (val === null || val === undefined) return;
            var suffix = "";
            if (p.seriesName === t("energy.chart.battery")) {
              suffix =
                val >= 0
                  ? " " + t("energy.tooltip.charging")
                  : " " + t("energy.tooltip.discharging");
            } else if (p.seriesName === t("energy.chart.grid")) {
              suffix =
                val >= 0
                  ? " " + t("energy.tooltip.importing")
                  : " " + t("energy.tooltip.exporting");
            }
            html +=
              '<span style="color:' +
              p.color +
              '">\u25CF</span> ' +
              p.seriesName +
              ": <strong>" +
              val.toFixed(2) +
              " kW</strong>" +
              suffix +
              "<br/>";
          });
          return html;
        },
      },
      legend: {
        data: [
          t("energy.chart.pv"),
          t("energy.chart.load"),
          t("energy.chart.battery"),
          t("energy.chart.grid"),
          t("energy.chart.baseline"),
        ],
        top: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
      },
      grid: { left: 12, right: 20, top: 50, bottom: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: (data && data.timeLabels) || TIME_LABELS_15MIN,
        boundaryGap: false,
        axisLabel: { interval: 7, fontSize: 10, color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
        axisTick: { lineStyle: { color: "#2a2d3a" } },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { color: "#9ca3af", fontSize: 11 },
        axisLabel: { fontSize: 11, color: "#9ca3af" },
        splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
      },
      series: [
        {
          name: "_floor",
          type: "line",
          data: gridFloor,
          stack: "savings",
          areaStyle: { color: "transparent" },
          lineStyle: { width: 0, opacity: 0 },
          symbol: "none",
          z: 0,
          silent: true,
        },
        {
          name: "Savings Area",
          type: "line",
          data: savingsBand,
          stack: "savings",
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(34, 197, 94, 0.25)" },
                { offset: 1, color: "rgba(34, 197, 94, 0.02)" },
              ],
            },
          },
          lineStyle: { width: 0, opacity: 0 },
          symbol: "none",
          z: 1,
          silent: true,
        },
        {
          name: t("energy.chart.baseline"),
          type: "line",
          data: baseline,
          lineStyle: { type: "dashed", width: 1.5, color: "#6b7280" },
          itemStyle: { color: "#6b7280" },
          symbol: "none",
          z: 2,
          markArea: {
            silent: true,
            data: [
              [
                {
                  xAxis: "00:00",
                  itemStyle: { color: "rgba(59, 130, 246, 0.05)" },
                  label: {
                    show: true,
                    position: "insideTop",
                    color: "rgba(59, 130, 246, 0.6)",
                    fontSize: 10,
                    formatter: t("energy.tariff.offpeak") + " R$0,41",
                  },
                },
                { xAxis: "15:45" },
              ],
              [
                {
                  xAxis: "16:00",
                  itemStyle: { color: "rgba(245, 158, 11, 0.08)" },
                  label: {
                    show: true,
                    position: "insideTop",
                    color: "rgba(245, 158, 11, 0.7)",
                    fontSize: 9,
                    formatter: t("energy.tariff.intermediate") + " R$0,62",
                  },
                },
                { xAxis: "16:45" },
              ],
              [
                {
                  xAxis: "17:00",
                  itemStyle: { color: "rgba(239, 68, 68, 0.08)" },
                  label: {
                    show: true,
                    position: "insideTop",
                    color: "rgba(239, 68, 68, 0.7)",
                    fontSize: 10,
                    formatter: t("energy.tariff.peak") + " R$0,89",
                  },
                },
                { xAxis: "19:45" },
              ],
              [
                {
                  xAxis: "20:00",
                  itemStyle: { color: "rgba(245, 158, 11, 0.08)" },
                  label: { show: false },
                },
                { xAxis: "20:45" },
              ],
              [
                {
                  xAxis: "21:00",
                  itemStyle: { color: "rgba(59, 130, 246, 0.05)" },
                  label: { show: false },
                },
                { xAxis: "23:45" },
              ],
            ],
          },
        },
        {
          name: t("energy.chart.pv"),
          type: "line",
          data: pv,
          lineStyle: { color: "#22c55e", width: 2 },
          itemStyle: { color: "#22c55e" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(34, 197, 94, 0.25)" },
                { offset: 1, color: "rgba(34, 197, 94, 0.02)" },
              ],
            },
          },
          symbol: "none",
          smooth: true,
          z: 3,
        },
        {
          name: t("energy.chart.load"),
          type: "line",
          data: load,
          lineStyle: { color: "rgba(228, 228, 231, 0.8)", width: 2 },
          itemStyle: { color: "#e4e4e7" },
          symbol: "none",
          z: 4,
        },
        {
          name: t("energy.chart.battery"),
          type: "line",
          data: battery,
          lineStyle: { color: "#a855f7", width: 2 },
          itemStyle: { color: "#a855f7" },
          symbol: "none",
          z: 5,
        },
        {
          name: t("energy.chart.grid"),
          type: "line",
          data: grid,
          lineStyle: { width: 2 },
          symbol: "none",
          z: 6,
        },
      ],
      visualMap: [
        {
          show: false,
          seriesIndex: 6,
          pieces: [
            { lt: 0, color: "#22c55e" },
            { gte: 0, color: "#ef4444" },
          ],
        },
      ],
    };

    Charts.createChart("chart-energy-main", option, { pageId: "energy" });
  },

  _initBatteryChart: function () {
    var data = this._getHomeData();
    if (!data) return;

    var option = {
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1a1d27",
        borderColor: "#2a2d3a",
        borderWidth: 1,
        textStyle: { color: "#e4e4e7", fontSize: 12 },
        extraCssText:
          "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);",
        formatter: function (params) {
          var time = params[0].axisValue;
          var html = "<strong>" + time + "</strong><br/>";
          params.forEach(function (p) {
            var val = p.value;
            var unit = p.seriesName === t("energy.chart.soc") ? "%" : " kW";
            var suffix = "";
            if (p.seriesName === t("energy.chart.chargeDischarge")) {
              suffix =
                val >= 0
                  ? " " + t("energy.tooltip.charging")
                  : " " + t("energy.tooltip.discharging");
            }
            html +=
              '<span style="color:' +
              p.color +
              '">\u25CF</span> ' +
              p.seriesName +
              ": <strong>" +
              (typeof val === "number" ? val.toFixed(1) : val) +
              unit +
              "</strong>" +
              suffix +
              "<br/>";
          });
          return html;
        },
      },
      legend: {
        data: [t("energy.chart.chargeDischarge"), t("energy.chart.soc")],
        top: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
      },
      grid: { left: 12, right: 12, top: 50, bottom: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: (data && data.timeLabels) || TIME_LABELS_15MIN,
        boundaryGap: false,
        axisLabel: { interval: 7, fontSize: 10, color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
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
          name: "SoC %",
          min: 0,
          max: 100,
          nameTextStyle: { color: "#f59e0b", fontSize: 11 },
          axisLabel: { fontSize: 11, color: "#f59e0b", formatter: "{value}%" },
          splitLine: { show: false },
          axisLine: { lineStyle: { color: "#f59e0b" } },
        },
      ],
      series: [
        {
          name: t("energy.chart.chargeDischarge"),
          type: "line",
          yAxisIndex: 0,
          data: data.battery,
          lineStyle: { color: "#a855f7", width: 2 },
          itemStyle: { color: "#a855f7" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(168, 85, 247, 0.2)" },
                { offset: 1, color: "rgba(168, 85, 247, 0.02)" },
              ],
            },
          },
          symbol: "none",
          smooth: true,
        },
        {
          name: t("energy.chart.soc"),
          type: "line",
          yAxisIndex: 1,
          data: data.soc,
          lineStyle: { color: "#f59e0b", width: 2, type: "dashed" },
          itemStyle: { color: "#f59e0b" },
          symbol: "none",
          smooth: true,
        },
      ],
    };

    Charts.createChart("chart-energy-battery", option, { pageId: "energy" });
  },

  _initACChart: function () {
    var data = this._getHomeData();
    if (!data) return;
    var acPower = data.acPower;

    var barData = acPower.map(function (power, i) {
      var hour = i * 0.25;
      var isPeakZone = hour >= 17 && hour < 20;
      if (isPeakZone) {
        return { value: 0.15, itemStyle: { color: "rgba(239, 68, 68, 0.4)" } };
      }
      if (power > 0) {
        return { value: power, itemStyle: { color: "#3b82f6" } };
      }
      return { value: 0, itemStyle: { color: "transparent" } };
    });

    var option = {
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1a1d27",
        borderColor: "#2a2d3a",
        borderWidth: 1,
        textStyle: { color: "#e4e4e7", fontSize: 12 },
        extraCssText:
          "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);",
        formatter: function (params) {
          var p = params[0];
          var hour = parseInt(p.axisValue.split(":")[0], 10);
          var isPeak = hour >= 17 && hour < 20;
          var status =
            p.value > 0.2
              ? t("energy.ac.running") + " (" + p.value.toFixed(2) + " kW)"
              : isPeak
                ? t("energy.ac.offPeakShaving")
                : t("energy.ac.off");
          var color =
            p.value > 0.2 ? "#3b82f6" : isPeak ? "#ef4444" : "#9ca3af";
          return (
            "<strong>" +
            p.axisValue +
            "</strong><br/>" +
            '<span style="color:' +
            color +
            '">\u25CF</span> ' +
            t("dtype.AC") +
            ": " +
            status
          );
        },
      },
      grid: { left: 12, right: 20, top: 30, bottom: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: (data && data.timeLabels) || TIME_LABELS_15MIN,
        axisLabel: { interval: 7, fontSize: 10, color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { color: "#9ca3af", fontSize: 11 },
        axisLabel: { fontSize: 11, color: "#9ca3af" },
        splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
      },
      series: [
        {
          type: "bar",
          data: barData,
          barWidth: "90%",
          markArea: {
            silent: true,
            data: [
              [
                {
                  xAxis: "17:00",
                  itemStyle: { color: "rgba(239, 68, 68, 0.06)" },
                  label: {
                    show: true,
                    position: "insideTop",
                    color: "#ef4444",
                    fontSize: 10,
                    formatter: t("energy.ac.peakShavingOff"),
                  },
                },
                { xAxis: "19:45" },
              ],
            ],
          },
        },
      ],
    };

    Charts.createChart("chart-energy-ac", option, { pageId: "energy" });
  },

  _initEVChart: function () {
    var data = this._getHomeData();
    if (!data) return;
    var evCharge = data.evCharge;

    var barData = evCharge.map(function (rate, i) {
      var hour = i * 0.25;
      var isPeakRate = hour >= 17 && hour < 20;
      if (rate > 0) {
        return {
          value: rate,
          itemStyle: { color: isPeakRate ? "#ef4444" : "#22c55e" },
        };
      }
      return { value: 0, itemStyle: { color: "transparent" } };
    });

    var option = {
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1a1d27",
        borderColor: "#2a2d3a",
        borderWidth: 1,
        textStyle: { color: "#e4e4e7", fontSize: 12 },
        extraCssText:
          "border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);",
        formatter: function (params) {
          var p = params[0];
          var hour = parseInt(p.axisValue.split(":")[0], 10);
          var tariff = getTariffForHour(hour);
          if (p.value > 0) {
            var tierColor = tariff.tier === "peak" ? "#ef4444" : "#22c55e";
            return (
              "<strong>" +
              p.axisValue +
              "</strong><br/>" +
              '<span style="color:' +
              tierColor +
              '">\u25CF</span> ' +
              t("energy.ev.charging") +
              ": <strong>" +
              p.value.toFixed(1) +
              " kW</strong>" +
              " (" +
              tariff.tier +
              " R$" +
              tariff.price.toFixed(2) +
              ")"
            );
          }
          return (
            "<strong>" + p.axisValue + "</strong><br/>" + t("energy.ev.idle")
          );
        },
      },
      grid: { left: 12, right: 20, top: 30, bottom: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: (data && data.timeLabels) || TIME_LABELS_15MIN,
        axisLabel: { interval: 7, fontSize: 10, color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
      },
      yAxis: {
        type: "value",
        name: "kW",
        max: 10,
        nameTextStyle: { color: "#9ca3af", fontSize: 11 },
        axisLabel: { fontSize: 11, color: "#9ca3af" },
        splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
        axisLine: { lineStyle: { color: "#2a2d3a" } },
      },
      series: [
        {
          type: "bar",
          data: barData,
          barWidth: "90%",
        },
      ],
    };

    Charts.createChart("chart-energy-ev", option, { pageId: "energy" });
  },
};
