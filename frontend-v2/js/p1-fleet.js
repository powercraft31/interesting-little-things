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
      this._buildPageHeader(),
      this._buildHeroSummary(),
      this._buildPriorityStack(),
      '<div class="vu-section-label">' + t("fleet.realTimeKpis") + '</div>',
      this._buildKPIStrip(),
      '<div class="vu-section">',
      '<div class="two-col">',
      this._buildGwStatusChartCard(),
      this._buildBrandDistChartCard(),
      "</div>",
      "</div>",
      '<div class="vu-section">',
      this._buildOrgTable(),
      "</div>",
      '<div class="vu-section">',
      this._buildOutageTable(),
      "</div>",
    ].join("");
  },

  // ---- Page Header (SUMMARY LAYER, non-authoritative) ----
  _buildPageHeader() {
    return '<div class="vu-page-header">' +
      '<div class="vu-page-title">' + t("fleet.pageTitle") + '</div>' +
      '<div class="vu-page-mission">' + t("fleet.pageMission") + '</div>' +
      '</div>';
  },

  // ---- Hero Summary (SUMMARY LAYER, non-authoritative) ----
  // Derived from the same overview data as the real KPI strip.
  // Does NOT replace the 6 KPI strip below.
  _buildHeroSummary() {
    var d = this._data ? this._data.overview : {};
    var total = d.totalGateways || 0;
    var offline = d.offlineGateways || 0;
    var rate = d.gatewayOnlineRate != null ? d.gatewayOnlineRate : 0;
    var bp = d.backfillPressure || { count: 0, hasFailure: false };

    // Determine verdict
    var verdictClass = 'healthy';
    var verdictText = t("fleet.verdictHealthy");
    if (offline > 0 && bp.hasFailure) {
      verdictClass = 'critical';
      verdictText = t("fleet.verdictCritical");
    } else if (offline > 0 || bp.count > 0) {
      verdictClass = 'warning';
      verdictText = t("fleet.verdictWarning");
    }

    return '<div class="vu-hero">' +
      '<div class="vu-hero-verdict">' +
        '<span class="vu-hero-badge ' + verdictClass + '">' + verdictText + '</span>' +
      '</div>' +
      '<div class="vu-hero-kpis">' +
        '<div class="vu-hero-kpi"><span class="vu-hero-kpi-value">' + (rate != null ? rate + '%' : '\u2014') + '</span><span class="vu-hero-kpi-label">' + t("fleet.onlineRate") + '</span></div>' +
        '<div class="vu-hero-kpi"><span class="vu-hero-kpi-value' + (offline > 0 ? ' negative' : '') + '">' + offline + '</span><span class="vu-hero-kpi-label">' + t("fleet.offlineGateways") + '</span></div>' +
        '<div class="vu-hero-kpi"><span class="vu-hero-kpi-value' + (bp.count > 0 ? ' warning' : '') + '">' + bp.count + '</span><span class="vu-hero-kpi-label">' + t("fleet.backfillPressure") + '</span></div>' +
        '<div class="vu-hero-kpi"><span class="vu-hero-kpi-value">' + total + '</span><span class="vu-hero-kpi-label">' + t("fleet.totalGateways") + '</span></div>' +
      '</div>' +
      '</div>';
  },

  // ---- Priority Stack (SUMMARY LAYER, non-authoritative) ----
  // Client-side sorting only; labeled indicative, not authoritative.
  _buildPriorityStack() {
    var offlineEvents = this._data ? this._data.offlineEvents : [];
    var integradores = this._data ? this._data.integradores : [];

    // Priority Sites: gateways currently offline or with backfill issues
    var prioritySites = [];
    if (offlineEvents && offlineEvents.length > 0) {
      var seen = {};
      offlineEvents.forEach(function(ev) {
        if (!seen[ev.gatewayName]) {
          seen[ev.gatewayName] = true;
          prioritySites.push({
            name: ev.gatewayName,
            org: ev.orgName,
            status: ev.backfillStatus,
            duration: ev.durationMinutes,
          });
        }
      });
    }

    // Critical events: recent outages, limited to 5
    var critEvents = (offlineEvents || []).slice(0, 5);

    var sitesHtml = '';
    if (prioritySites.length === 0) {
      sitesHtml = '<div class="vu-priority-empty">' + t("fleet.noPrioritySites") + '</div>';
    } else {
      sitesHtml = '<div class="vu-priority-list">' +
        prioritySites.slice(0, 5).map(function(s) {
          var dotClass = s.status === 'failed' ? 'negative' : 'warning';
          var meta = s.duration != null ? (s.duration < 60 ? s.duration + 'm' : Math.floor(s.duration/60) + 'h') : t("fleet.status.ongoing");
          return '<div class="vu-priority-item">' +
            '<span class="vu-priority-dot ' + dotClass + '"></span>' +
            '<span class="vu-priority-label">' + s.name + ' &middot; ' + (s.org || '') + '</span>' +
            '<span class="vu-priority-meta">' + meta + '</span>' +
            '</div>';
        }).join('') +
        '</div>';
    }

    var eventsHtml = '';
    if (critEvents.length === 0) {
      eventsHtml = '<div class="vu-priority-empty">' + t("fleet.noOutages") + '</div>';
    } else {
      eventsHtml = '<div class="vu-priority-list">' +
        critEvents.map(function(ev) {
          var dotClass = ev.backfillStatus === 'failed' ? 'negative' : 'warning';
          var dur = ev.durationMinutes != null ? (ev.durationMinutes < 60 ? ev.durationMinutes + 'm' : Math.floor(ev.durationMinutes/60) + 'h') : t("fleet.status.ongoing");
          return '<div class="vu-priority-item">' +
            '<span class="vu-priority-dot ' + dotClass + '"></span>' +
            '<span class="vu-priority-label">' + (ev.gatewayName || '') + '</span>' +
            '<span class="vu-priority-meta">' + dur + '</span>' +
            '</div>';
        }).join('') +
        '</div>';
    }

    return '<div class="vu-priority-stack">' +
      '<div class="vu-priority-card">' +
        '<div class="vu-priority-card-header">' + t("fleet.prioritySites") + '<span class="vu-count">' + prioritySites.length + '</span></div>' +
        sitesHtml +
      '</div>' +
      '<div class="vu-priority-card">' +
        '<div class="vu-priority-card-header">' + t("fleet.criticalEvents") + '<span class="vu-count">' + critEvents.length + '</span></div>' +
        eventsHtml +
      '</div>' +
      '</div>';
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

    return '<div class="kpi-grid kpi-grid-6 vu-kpi-grid">' + cards.join("") + "</div>";
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
