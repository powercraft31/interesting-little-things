/* ============================================
   SOLFACIL Admin Portal — P1: Fleet Overview (v6.1)
   Gateway-first operations dashboard.
   ============================================ */

const FleetPage = {
  async init() {
    const self = this;
    const container = document.getElementById("fleet-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      const [overview, charts, integradores, offlineEvents] = await Promise.all(
        [
          DataSource.fleet.overview(),
          DataSource.fleet.charts(),
          DataSource.fleet.integradores(),
          DataSource.fleet.offlineEvents(50),
        ],
      );
      self._data = {
        overview: overview,
        charts: charts,
        integradores: integradores,
        offlineEvents: offlineEvents,
      };
    } catch (err) {
      showErrorBoundary("fleet-content", err);
      return;
    }

    container.innerHTML = self._buildContent();
    self._initCharts();
  },

  onRoleChange() {
    // v6.1: Backend handles tenant scoping via RLS; just re-init
    Charts.disposePageCharts("fleet");
    this.init();
  },

  // =========================================================
  // SKELETON
  // =========================================================
  _buildSkeleton() {
    return [
      Components.skeletonKPIs(6),
      '<div class="two-col">',
      '<div class="section-card"><div class="section-card-body">' +
        Components.skeletonChart() +
        "</div></div>",
      '<div class="section-card"><div class="section-card-body">' +
        Components.skeletonChart() +
        "</div></div>",
      "</div>",
      Components.skeletonTable(3),
      Components.skeletonTable(3),
    ].join("");
  },

  // =========================================================
  // REAL CONTENT
  // =========================================================
  _buildContent() {
    return [
      this._buildKPIStrip(),
      '<div class="two-col">',
      this._buildGwStatusChartCard(),
      this._buildBrandDistChartCard(),
      "</div>",
      this._buildOrgTable(),
      this._buildOutageTable(),
    ].join("");
  },

  // ---- KPI Strip (6 cards, REQ order) ----
  _buildKPIStrip() {
    var d = this._data ? this._data.overview : {};
    var bp = d.backfillPressure || { count: 0, hasFailure: false };
    var backfillColor =
      bp.count === 0 ? "" : bp.hasFailure ? "negative" : "warning";

    var cards = [
      Components.kpiCard({
        value: d.totalGateways != null ? d.totalGateways : "\u2014",
        label: t("fleet.totalGateways"),
      }),
      Components.kpiCard({
        value: d.offlineGateways != null ? d.offlineGateways : "\u2014",
        label: t("fleet.offlineGateways"),
        color: d.offlineGateways > 0 ? "negative" : "",
      }),
      Components.kpiCard({
        value: d.onlineGateways != null ? d.onlineGateways : "\u2014",
        label: t("fleet.onlineGateways"),
        color: "positive",
      }),
      Components.kpiCard({
        value:
          d.gatewayOnlineRate != null ? d.gatewayOnlineRate + "%" : "\u2014",
        label: t("fleet.onlineRate"),
      }),
      Components.kpiCard({
        value: bp.count != null ? bp.count : "\u2014",
        label: t("fleet.backfillPressure"),
        color: backfillColor,
      }),
      Components.kpiCard({
        value: d.organizationCount != null ? d.organizationCount : "\u2014",
        label: t("fleet.organizations"),
      }),
    ];

    return '<div class="kpi-grid kpi-grid-6">' + cards.join("") + "</div>";
  },

  // ---- Left Chart: Gateway Status Distribution ----
  _buildGwStatusChartCard() {
    return Components.sectionCard(
      t("fleet.gwStatusDist"),
      '<div id="chart-gw-status" class="chart-container fleet-gw-status-chart"></div>',
    );
  },

  // ---- Right Chart: Inverter Brand Distribution ----
  _buildBrandDistChartCard() {
    return Components.sectionCard(
      t("fleet.inverterBrandDist"),
      '<div id="chart-brand-dist" class="chart-container fleet-brand-dist-chart"></div>',
    );
  },

  // ---- Organization Summary Table ----
  _buildOrgTable() {
    var rows = this._data ? this._data.integradores : [];

    return Components.sectionCard(
      t("fleet.integradoresTitle"),
      rows.length === 0
        ? '<p class="empty-state">' + t("fleet.noData") + "</p>"
        : Components.dataTable({
            columns: [
              { key: "name", label: t("fleet.col.org") },
              {
                key: "gatewayCount",
                label: t("fleet.col.gwCount"),
                align: "right",
                mono: true,
              },
              {
                key: "gatewayOnlineRate",
                label: t("fleet.col.gwOnlineRate"),
                align: "right",
                mono: true,
                format: function (val) {
                  var color = val >= 90 ? "positive" : "negative";
                  return (
                    '<span class="no-prefix ' + color + '">' + val + "%</span>"
                  );
                },
              },
              {
                key: "backfillPendingFailed",
                label: t("fleet.col.backfillPF"),
                align: "right",
                mono: true,
                format: function (val) {
                  if (!val || val === 0) return "0";
                  return '<span class="warning">' + val + "</span>";
                },
              },
              {
                key: "lastCommissioning",
                label: t("fleet.col.lastCommission"),
                align: "right",
                format: function (val) {
                  return formatISODate(val);
                },
              },
            ],
            rows: rows,
          }),
    );
  },

  // ---- Recent Gateway Outage Table (7 days) ----
  _buildOutageTable() {
    var events = this._data ? this._data.offlineEvents : [];

    return Components.sectionCard(
      t("fleet.offlineEvents"),
      events.length === 0
        ? '<p class="empty-state">' + t("fleet.noOutages") + "</p>"
        : Components.dataTable({
            columns: [
              {
                key: "gatewayName",
                label: t("fleet.col.gwName"),
                mono: true,
              },
              { key: "orgName", label: t("fleet.col.org") },
              {
                key: "offlineStart",
                label: t("fleet.col.offlineStart"),
                format: function (val) {
                  return formatISODateTime(val);
                },
              },
              {
                key: "durationMinutes",
                label: t("fleet.col.duration"),
                align: "right",
                mono: true,
                format: function (val) {
                  if (val == null) return t("fleet.status.ongoing");
                  if (val < 60) return val + "m";
                  var h = Math.floor(val / 60);
                  var m = val % 60;
                  return h + "h " + m + "m";
                },
              },
              {
                key: "backfillStatus",
                label: t("fleet.col.backfillStatus"),
                align: "center",
                format: function (val) {
                  if (!val) return "\u2014";
                  var colorMap = {
                    pending: "warning",
                    not_started: "warning",
                    in_progress: "warning",
                    completed: "positive",
                    failed: "negative",
                  };
                  var labelMap = {
                    pending: t("fleet.status.pending"),
                    not_started: t("fleet.status.pending"),
                    in_progress: t("fleet.status.inProgress"),
                    completed: t("fleet.status.completed"),
                    failed: t("fleet.status.failed"),
                  };
                  var cls = colorMap[val] || "";
                  var label = labelMap[val] || val;
                  return '<span class="' + cls + '">' + label + "</span>";
                },
              },
            ],
            rows: events,
          }),
    );
  },

  // =========================================================
  // CHARTS (ECharts via Charts factory)
  // =========================================================
  _initCharts() {
    try {
      this._initGwStatusChart();
    } catch (e) {
      console.error("[Fleet] GW status chart error:", e);
    }
    try {
      this._initBrandDistChart();
    } catch (e) {
      console.error("[Fleet] Brand dist chart error:", e);
    }
    requestAnimationFrame(function () {
      Charts.activatePageCharts("fleet");
    });
  },

  _initGwStatusChart() {
    var charts = this._data ? this._data.charts : {};
    var gs = charts.gatewayStatus || { online: 0, offline: 0 };

    if (gs.online === 0 && gs.offline === 0) {
      var el = document.getElementById("chart-gw-status");
      if (el)
        el.innerHTML = '<p class="empty-state">' + t("fleet.noData") + "</p>";
      return;
    }

    var option = {
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
      },
      legend: {
        bottom: 10,
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "70%"],
          avoidLabelOverlap: false,
          label: {
            show: true,
            formatter: "{b}\n{c}",
            fontSize: 12,
          },
          data: [
            {
              name: t("fleet.chart.online"),
              value: gs.online,
              itemStyle: { color: "#22c55e" },
            },
            {
              name: t("fleet.chart.offline"),
              value: gs.offline,
              itemStyle: { color: "#ef4444" },
            },
          ],
        },
      ],
    };

    Charts.createChart("chart-gw-status", option, { pageId: "fleet" });
  },

  _initBrandDistChart() {
    var charts = this._data ? this._data.charts : {};
    var brands = charts.inverterBrandDistribution || [];

    if (brands.length === 0) {
      var el = document.getElementById("chart-brand-dist");
      if (el)
        el.innerHTML = '<p class="empty-state">' + t("fleet.noData") + "</p>";
      return;
    }

    var brandColors = [
      "#3b82f6",
      "#8b5cf6",
      "#06b6d4",
      "#f59e0b",
      "#10b981",
      "#ec4899",
      "#6366f1",
      "#f97316",
    ];

    var option = {
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
      },
      legend: {
        bottom: 10,
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "70%"],
          avoidLabelOverlap: false,
          label: {
            show: true,
            formatter: "{b}\n{c}",
            fontSize: 12,
          },
          data: brands.map(function (b, i) {
            return {
              name: b.brand,
              value: b.deviceCount,
              itemStyle: { color: brandColors[i % brandColors.length] },
            };
          }),
        },
      ],
    };

    Charts.createChart("chart-brand-dist", option, { pageId: "fleet" });
  },
};
