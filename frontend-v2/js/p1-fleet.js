/* ============================================
   SOLFACIL Admin Portal — P1: Fleet Overview
   Landing page — sets the visual tone for the entire product.
   ============================================ */

const FleetPage = {
  init() {
    const container = document.getElementById("fleet-content");
    if (!container) return;

    const skeletonHTML = this._buildSkeleton();
    const realHTML = this._buildContent("admin");

    Components.renderWithSkeleton(container, skeletonHTML, realHTML, () => {
      this._initCharts();
    });
  },

  onRoleChange(role) {
    const tableContainer = document.getElementById("fleet-integrador-table");
    if (tableContainer) {
      tableContainer.innerHTML = this._buildIntegradorTable(role);
    }
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
      ${this._buildKPICards()}
      <div class="two-col">
        ${this._buildUptimeChartCard()}
        ${this._buildDeviceDistCard()}
      </div>
      ${this._buildIntegradorCard(role)}
      ${this._buildOfflineEventsCard()}
    `;
  },

  // ---- KPI Cards ----
  _buildKPICards() {
    const f = FLEET;
    const onlineColor = f.onlineRate >= 90 ? "positive" : "negative";

    const cards = [
      Components.kpiCard({ value: f.totalDevices, label: t("fleet.totalDevices") }),
      Components.kpiCard({
        value: f.onlineCount,
        label: t("fleet.online"),
        color: "positive",
      }),
      Components.kpiCard({
        value: f.offlineCount,
        label: t("fleet.offline"),
        color: f.offlineCount > 0 ? "negative" : "",
      }),
      Components.kpiCard({
        value: formatPercent(f.onlineRate),
        label: t("fleet.onlineRate"),
        color: onlineColor,
      }),
      Components.kpiCard({ value: f.totalHomes, label: t("fleet.homes") }),
      Components.kpiCard({ value: f.totalIntegradores, label: t("fleet.integradores") }),
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
    let rows = INTEGRADORES;
    if (role === "integrador") {
      rows = rows.filter((r) => r.orgId === "org-001");
    }

    return Components.dataTable({
      columns: [
        { key: "name", label: t("fleet.col.org") },
        { key: "deviceCount", label: t("fleet.col.devices"), align: "right", mono: true },
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
        { key: "lastCommission", label: t("fleet.col.lastCommission"), align: "right" },
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
          { key: "start", label: t("fleet.col.offlineStart") },
          {
            key: "durationHrs",
            label: t("fleet.col.duration"),
            align: "right",
            mono: true,
            format: (val) => val.toFixed(1),
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
        rows: OFFLINE_EVENTS,
      }),
    );
  },

  // =========================================================
  // CHARTS
  // =========================================================
  _initCharts() {
    try {
      this._initUptimeChart();
    } catch (e) {
      console.error("[Fleet] Uptime chart error:", e);
    }
    try {
      this._initDeviceDistChart();
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
    const uptimeData = DemoStore.get("uptimeTrend") || generateUptimeTrend();
    const dates = uptimeData.map((d) => d.date);
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

  _initDeviceDistChart() {
    const data = DEVICE_TYPES.map((d) => ({
      name: t("dtype." + d.type),
      total: d.count,
      online: d.online,
      offline: d.count - d.online,
      color: d.color,
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
