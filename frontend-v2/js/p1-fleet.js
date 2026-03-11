/* ============================================
   SOLFACIL Admin Portal — P1: Fleet Overview
   Landing page — sets the visual tone for the entire product.
   ============================================ */

const FleetPage = {
  async init() {
    const self = this;
    const container = document.getElementById("fleet-content");
    if (!container) return;

    const role = typeof currentRole !== "undefined" ? currentRole : "admin";
    container.innerHTML = this._buildSkeleton();

    try {
      const [overview, integradores, offlineEvents, uptimeTrend] =
        await Promise.all([
          DataSource.fleet.overview(),
          DataSource.fleet.integradores(),
          DataSource.fleet.offlineEvents(),
          DataSource.fleet.uptimeTrend(),
        ]);
      self._data = {
        fleet: overview,
        integradores: integradores,
        offlineEvents: offlineEvents,
        uptimeTrend: uptimeTrend,
        deviceTypes: overview.deviceTypes || [],
      };
    } catch (err) {
      showErrorBoundary("fleet-content", err);
      return;
    }

    container.innerHTML = self._buildContent(role);
    self._initCharts(role);
  },

  onRoleChange(role) {
    // Re-render entire page content to reflect tenant-scoped data
    const container = document.getElementById("fleet-content");
    if (!container) return;

    // Dispose stale charts before DOM replacement
    Charts.disposePageCharts("fleet");

    const realHTML = this._buildContent(role);
    container.innerHTML = realHTML;
    this._initCharts(role);
  },

  // =========================================================
  // SKELETON
  // =========================================================
  _buildSkeleton() {
    return `
      ${Components.skeletonKPIs(6)}
      <div class="two-col">
        <div class="section-card"><div class="section-card-body">${Components.skeletonChart()}</div></div>
        <div class="section-card"><div class="section-card-body">${Components.skeletonChart()}</div></div>
      </div>
      ${Components.skeletonTable(3)}
      ${Components.skeletonTable(3)}
    `;
  },

  // =========================================================
  // REAL CONTENT
  // =========================================================
  _buildContent(role) {
    return `
      ${this._buildKPICards(role)}
      <div class="two-col">
        ${this._buildUptimeChartCard()}
        ${this._buildDeviceDistCard()}
      </div>
      ${this._buildIntegradorCard(role)}
      ${this._buildOfflineEventsCard()}
    `;
  },

  // ---- KPI Cards ----
  /**
   * Compute tenant-scoped fleet stats.
   * Admin sees global fleet; Integrador sees only org-001 (Solar São Paulo).
   */
  /**
   * Tenant-scoped fleet stats.
   * Admin: full global view. Integrador: org-001 only. Customer: single home.
   */
  _getFleetStats(role) {
    var integradores = this._data ? this._data.integradores : [];
    var fleet = this._data ? this._data.fleet : {};
    if (role === "integrador") {
      var org = integradores.find(function (i) {
        return i.orgId === "org-001";
      });
      if (!org) return fleet;
      var online = Math.round((org.deviceCount * org.onlineRate) / 100);
      var offline = org.deviceCount - online;
      return {
        totalDevices: org.deviceCount,
        onlineCount: online,
        offlineCount: offline,
        onlineRate: org.onlineRate,
        totalGateways: 1,
        totalIntegradores: 1,
      };
    }
    if (role === "customer") {
      return {
        totalDevices: 8,
        onlineCount: 8,
        offlineCount: 0,
        onlineRate: 100,
        totalGateways: 1,
        totalIntegradores: 0,
      };
    }
    return fleet;
  },

  _buildKPICards(role) {
    const f = this._getFleetStats(role);
    const onlineColor = f.onlineRate >= 90 ? "positive" : "negative";

    const cards = [
      Components.kpiCard({
        value: f.totalDevices != null ? f.totalDevices : "\u2014",
        label: t("fleet.totalDevices"),
      }),
      Components.kpiCard({
        value: f.onlineCount != null ? f.onlineCount : "\u2014",
        label: t("fleet.online"),
        color: "positive",
      }),
      Components.kpiCard({
        value: f.offlineCount != null ? f.offlineCount : "\u2014",
        label: t("fleet.offline"),
        color: f.offlineCount > 0 ? "negative" : "",
      }),
      Components.kpiCard({
        value: formatPercent(f.onlineRate),
        label: t("fleet.onlineRate"),
        color: onlineColor,
      }),
      Components.kpiCard({
        value: f.totalGateways != null ? f.totalGateways : "\u2014",
        label: t("fleet.gateways"),
      }),
      Components.kpiCard({
        value: f.totalIntegradores != null ? f.totalIntegradores : "\u2014",
        label: t("fleet.integradores"),
      }),
    ];

    return `<div class="kpi-grid kpi-grid-6">${cards.join("")}</div>`;
  },

  // ---- Uptime Trend Chart Card ----
  _buildUptimeChartCard() {
    return Components.sectionCard(
      t("fleet.uptimeTrend"),
      '<div id="chart-uptime-trend" class="chart-container fleet-uptime-chart"></div>',
    );
  },

  // ---- Device Type Distribution Card ----
  _buildDeviceDistCard() {
    return Components.sectionCard(
      t("fleet.deviceDist"),
      '<div id="chart-device-dist" class="chart-container fleet-device-dist-chart"></div>',
    );
  },

  // ---- Integrador List Card ----
  _buildIntegradorCard(role) {
    return Components.sectionCard(
      t("fleet.integradoresTitle"),
      `<div id="fleet-integrador-table">${this._buildIntegradorTable(role)}</div>`,
      { dataRole: "integrador" },
    );
  },

  _buildIntegradorTable(role) {
    let rows = this._data ? this._data.integradores : [];
    if (role === "integrador") {
      rows = rows.filter((r) => r.orgId === "org-001");
    }

    return Components.dataTable({
      columns: [
        { key: "name", label: t("fleet.col.org") },
        {
          key: "deviceCount",
          label: t("fleet.col.devices"),
          align: "right",
          mono: true,
        },
        {
          key: "onlineRate",
          label: t("fleet.col.onlineRate"),
          align: "right",
          mono: true,
          format: (val) => {
            const color = val >= 90 ? "positive" : "negative";
            return `<span class="no-prefix ${color}">${formatPercent(val)}</span>`;
          },
        },
        {
          key: "lastCommission",
          label: t("fleet.col.lastCommission"),
          align: "right",
          format: (val) => formatISODate(val),
        },
      ],
      rows: rows,
    });
  },

  // ---- Offline Events Card ----
  _buildOfflineEventsCard() {
    return Components.sectionCard(
      t("fleet.offlineEvents"),
      Components.dataTable({
        columns: [
          {
            key: "deviceId",
            label: t("fleet.col.deviceId"),
            mono: true,
            format: (val) =>
              `<a href="#devices" class="p1-device-link" data-device="${val}">${val}</a>`,
          },
          {
            key: "start",
            label: t("fleet.col.offlineStart"),
            format: (val) => formatISODateTime(val),
          },
          {
            key: "durationHrs",
            label: t("fleet.col.duration"),
            align: "right",
            mono: true,
            format: (val) => (val != null ? val.toFixed(1) : "\u2014"),
          },
          {
            key: "cause",
            label: t("fleet.col.cause"),
            format: (val) => {
              const causeMap = {
                "WiFi dropout": "cause-wifi",
                "Power outage": "cause-power",
                Unknown: "cause-unknown",
              };
              const cls = causeMap[val] || "cause-unknown";
              return `<span class="cause-badge ${cls}">${t("fleet.cause." + val)}</span>`;
            },
          },
          {
            key: "backfill",
            label: t("fleet.col.backfill"),
            align: "center",
            format: (val) =>
              val
                ? '<span class="backfill-ok" title="Backfill complete">\u2705</span>'
                : '<span class="backfill-pending" title="Backfill pending">\u26A0\uFE0F</span>',
          },
        ],
        rows: this._data ? this._data.offlineEvents : [],
      }),
    );
  },

  // =========================================================
  // CHARTS
  // =========================================================
  _initCharts(role) {
    role = role || "admin";
    try {
      this._initUptimeChart();
    } catch (e) {
      console.error("[Fleet] Uptime chart error:", e);
    }
    try {
      this._initDeviceDistChart(role);
    } catch (e) {
      console.error("[Fleet] DeviceDist chart error:", e);
    }
    this._setupEventListeners();
    requestAnimationFrame(() => Charts.activatePageCharts("fleet"));
  },

  _setupEventListeners() {
    document.querySelectorAll(".p1-device-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo("devices");
      });
    });
  },

  _initUptimeChart() {
    const uptimeData = this._data
      ? this._data.uptimeTrend
      : DemoStore.get("uptimeTrend") || generateUptimeTrend();
    const dates = uptimeData.map((d) => formatShortDate(d.date));
    const values = uptimeData.map((d) => d.uptime);

    const option = {
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          const p = params[0];
          const val = p.value;
          const color = val >= 90 ? "#22c55e" : "#ef4444";
          return `<strong>${p.name}</strong><br/>
                  <span style="color:${color}">\u25CF</span> ${t("fleet.chart.uptime")}: <strong>${val.toFixed(1)}%</strong>`;
        },
      },
      grid: { left: 12, right: 20, top: 50, bottom: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { fontSize: 10, interval: 3 },
      },
      yAxis: {
        type: "value",
        min: 80,
        max: 100,
        axisLabel: {
          formatter: "{value}%",
          fontSize: 11,
        },
        splitLine: { lineStyle: { color: "rgba(42, 45, 58, 0.6)" } },
      },
      series: [
        {
          type: "line",
          data: values,
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2.5, color: "#22c55e" },
          itemStyle: {
            color: function (params) {
              return params.value >= 90 ? "#22c55e" : "#ef4444";
            },
          },
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
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: {
              color: "#f59e0b",
              type: "dashed",
              width: 1.5,
            },
            label: {
              formatter: t("fleet.chart.target"),
              position: "insideEndTop",
              color: "#f59e0b",
              fontSize: 11,
              fontWeight: 600,
            },
            data: [{ yAxis: 90 }],
          },
        },
      ],
    };

    Charts.createChart("chart-uptime-trend", option, { pageId: "fleet" });
  },

  _initDeviceDistChart(role) {
    var integradores = this._data ? this._data.integradores : [];
    var fleet = this._data ? this._data.fleet : {};
    var deviceTypes = this._data ? this._data.deviceTypes : [];
    // Color fallback for BFF responses missing color field
    var defaultColors = {
      "Inverter + Battery": "#3b82f6",
      "Smart Meter": "#8b5cf6",
      AC: "#06b6d4",
      "EV Charger": "#f59e0b",
    };
    // Tenant-scoped: Integrador sees proportional subset (org-001 = 26/47)
    var scale = 1;
    if (role === "integrador") {
      var org = integradores.find(function (i) {
        return i.orgId === "org-001";
      });
      scale = org ? org.deviceCount / fleet.totalDevices : 1;
    }
    const data = deviceTypes.map((d) => ({
      name: t("dtype." + d.type),
      total: Math.round(d.count * scale),
      online: Math.round(d.online * scale),
      offline: Math.max(
        0,
        Math.round(d.count * scale) - Math.round(d.online * scale),
      ),
      color: d.color || defaultColors[d.type] || "#6b7280",
    }));

    const option = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: function (params) {
          const name = params[0].name;
          let html = `<strong>${name}</strong><br/>`;
          params.forEach((p) => {
            html += `<span style="color:${p.color}">\u25CF</span> ${p.seriesName}: <strong>${p.value}</strong><br/>`;
          });
          return html;
        },
      },
      legend: {
        data: [t("fleet.chart.online"), t("fleet.chart.offline")],
        top: 4,
        right: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 12, right: 20, top: 40, bottom: 12, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: "category",
        data: data.map((d) => d.name),
        axisLabel: { fontSize: 11 },
        inverse: true,
      },
      series: [
        {
          name: t("fleet.chart.online"),
          type: "bar",
          stack: "total",
          data: data.map((d) => ({
            value: d.online,
            itemStyle: { color: d.color },
          })),
          barWidth: 24,
          itemStyle: { borderRadius: [0, 0, 0, 0] },
          label: {
            show: true,
            position: "inside",
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            formatter: "{c}",
          },
        },
        {
          name: t("fleet.chart.offline"),
          type: "bar",
          stack: "total",
          data: data.map((d) => ({
            value: d.offline,
            itemStyle: { color: "rgba(239, 68, 68, 0.6)" },
          })),
          barWidth: 24,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "inside",
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            formatter: function (p) {
              return p.value > 0 ? p.value : "";
            },
          },
        },
      ],
    };

    Charts.createChart("chart-device-dist", option, { pageId: "fleet" });
  },
};
