/* ============================================
   SOLFACIL Admin Portal — P6: Alarm Center
   Real-time device alerts and events.
   ============================================ */

var AlertsPage = {
  _summary: null,
  _alerts: null,
  _filters: { status: "all", levels: new Set(["2", "1", "0"]), gateway: "all", period: "all" },
  _sortAsc: false,

  init: async function () {
    var self = this;
    var container = document.getElementById("alerts-content");
    if (!container) return;

    // Reset filters
    self._filters = { status: "all", levels: new Set(["2", "1", "0"]), gateway: "all", period: "all" };
    self._sortAsc = false;

    container.innerHTML = self._buildSkeleton();

    try {
      var results = await Promise.all([
        DataSource.alerts.summary(),
        DataSource.alerts.list(),
      ]);
      self._summary = results[0];
      self._alerts = results[1];
    } catch (err) {
      showErrorBoundary("alerts-content", err);
      return;
    }

    container.innerHTML = self._buildContent();
    self._setupEventListeners();
  },

  onRoleChange: function () {
    this.init();
  },

  // =========================================================
  // SKELETON
  // =========================================================
  _buildSkeleton: function () {
    return [
      Components.skeletonKPIs(4),
      Components.skeletonTable(5),
    ].join("");
  },

  // =========================================================
  // REAL CONTENT
  // =========================================================
  _buildContent: function () {
    return [
      this._buildPageHeader(),
      this._buildAlertBanner(),
      this._buildSummaryStrip(),
      this._buildFilterBar(),
      this._buildAlertTable(),
    ].join("");
  },

  _buildPageHeader: function () {
    return '<div class="vu-page-header">' +
      '<div class="vu-page-title">' + t("alerts.pageTitle") + '</div>' +
      '<div class="vu-page-mission">' + t("alerts.pageMission") + '</div>' +
      '</div>';
  },

  _buildAlertBanner: function () {
    var s = this._summary;
    if (!s || s.severeCount <= 0) return "";

    return '<div class="vu-alert-banner vu-alert-severe">' +
      '<span class="vu-alert-icon">\u26A0\uFE0F</span>' +
      '<span class="vu-alert-text"><strong>' + s.severeCount + '</strong> ' + t("alerts.severeActive") +
      (s.severeDetails ? ' \u2014 ' + s.severeDetails : '') +
      '</span>' +
      '</div>';
  },

  _buildSummaryStrip: function () {
    var s = this._summary || {};
    var cards = [
      Components.kpiCard({
        value: s.activeCount != null ? s.activeCount : "\u2014",
        label: t("alerts.kpi.active"),
        color: "negative",
      }),
      Components.kpiCard({
        value: s.severeCount != null ? s.severeCount : "\u2014",
        label: t("alerts.kpi.severe"),
        color: "warning",
      }),
      Components.kpiCard({
        value: s.recoveredTodayCount != null ? s.recoveredTodayCount : "\u2014",
        label: t("alerts.kpi.recovered"),
        color: "positive",
      }),
      Components.kpiCard({
        value: s.affectedGateways != null
          ? s.affectedGateways + "/" + (s.totalGateways || 0)
          : "\u2014",
        label: t("alerts.kpi.affected"),
        color: "",
      }),
    ];

    return '<div class="kpi-grid kpi-grid-6 vu-kpi-grid">' + cards.join("") + '</div>';
  },

  _buildFilterBar: function () {
    var gateways = this._getUniqueGateways();

    var gwOptions = '<option value="all">' + t("alerts.filter.allGateways") + '</option>';
    gateways.forEach(function (gw) {
      gwOptions += '<option value="' + gw.id + '">' + gw.name + '</option>';
    });

    return '<div class="vu-filter-bar">' +
      // Status group (single select)
      '<div class="vu-filter-group" data-filter="status">' +
        '<button class="vu-filter-btn active" data-value="all">' + t("alerts.filter.all") + '</button>' +
        '<button class="vu-filter-btn" data-value="active">' + t("alerts.filter.active") + '</button>' +
        '<button class="vu-filter-btn" data-value="recovered">' + t("alerts.filter.recovered") + '</button>' +
      '</div>' +
      '<div class="vu-filter-sep"></div>' +
      // Level group (multi toggle)
      '<div class="vu-filter-group" data-filter="level">' +
        '<button class="vu-filter-btn active-red" data-value="2">' + t("alerts.filter.severe") + '</button>' +
        '<button class="vu-filter-btn active-orange" data-value="1">' + t("alerts.filter.general") + '</button>' +
        '<button class="vu-filter-btn active-blue" data-value="0">' + t("alerts.filter.notify") + '</button>' +
      '</div>' +
      '<div class="vu-filter-sep"></div>' +
      // Gateway select
      '<select class="vu-filter-select" id="alerts-gw-filter">' + gwOptions + '</select>' +
      // Period select
      '<select class="vu-filter-select" id="alerts-period-filter">' +
        '<option value="all">' + t("alerts.filter.allTime") + '</option>' +
        '<option value="24h">' + t("alerts.filter.24h") + '</option>' +
        '<option value="7d">' + t("alerts.filter.7d") + '</option>' +
        '<option value="30d">' + t("alerts.filter.30d") + '</option>' +
      '</select>' +
      '</div>';
  },

  _buildAlertTable: function () {
    var filtered = this._getFilteredAlerts();
    var self = this;
    var sortArrow = this._sortAsc ? ' \u25B2' : ' \u25BC';

    var headerRight = '<span id="alerts-result-count" class="alerts-result-count">' +
      filtered.length + ' ' + t("alerts.results") + '</span>';

    var tableHtml = '<div class="alerts-table"><div class="data-table-wrapper"><table class="data-table">' +
      '<thead><tr>' +
        '<th class="sortable" id="alerts-sort-time">' + t("alerts.table.time") + sortArrow + '</th>' +
        '<th>' + t("alerts.table.gateway") + '</th>' +
        '<th>' + t("alerts.table.device") + '</th>' +
        '<th>' + t("alerts.table.event") + '</th>' +
        '<th>' + t("alerts.table.type") + '</th>' +
        '<th>' + t("alerts.table.level") + '</th>' +
        '<th>' + t("alerts.table.status") + '</th>' +
        '<th>' + t("alerts.table.value") + '</th>' +
      '</tr></thead>' +
      '<tbody id="alerts-table-body">';

    if (filtered.length === 0) {
      tableHtml += '<tr><td colspan="8" class="table-empty">' + t("alerts.empty") + '</td></tr>';
    } else {
      filtered.forEach(function (alert) {
        tableHtml += self._buildAlertRow(alert);
      });
    }

    tableHtml += '</tbody></table></div></div>';

    return Components.sectionCard(t("alerts.table.title"), tableHtml, { headerRight: headerRight });
  },

  _buildAlertRow: function (alert) {
    var isRecovered = alert.status === "1";
    var rowClass = isRecovered ? ' class="alert-recovered"' : '';

    // Level badge
    var levelMap = { "2": "severe", "1": "general", "0": "notify" };
    var levelKey = levelMap[alert.level] || "general";
    var levelBadge = '<span class="alert-badge alert-badge-' + levelKey + '">' + t("alerts.level." + levelKey) + '</span>';

    // Status badge
    var statusKey = isRecovered ? "recovered" : "active";
    var dotClass = isRecovered ? "alert-dot-green" : "alert-dot-red";
    var statusBadge = '<span class="alert-badge alert-badge-' + statusKey + '">' +
      '<span class="alert-dot ' + dotClass + '"></span>' +
      t("alerts.status." + statusKey) + '</span>';

    // Type tag
    var typeClass = "alert-type-" + (alert.eventType || "alarm").toLowerCase();
    var typeTag = '<span class="alert-type-tag ' + typeClass + '">' + (alert.eventType || "") + '</span>';

    // Device display
    var deviceDisplay = alert.subDevName || alert.deviceSn || "\u2014";

    return '<tr' + rowClass + '>' +
      '<td><div class="alert-time-main">' + this._formatTime(alert.eventCreateTime) + '</div>' +
        '<div class="alert-time-ago">' + this._formatTimeAgo(alert.eventCreateTime) + '</div></td>' +
      '<td><div class="alert-gw-name">' + (alert.gatewayName || "") + '</div>' +
        '<div class="alert-gw-id">' + (alert.gatewayId || "") + '</div></td>' +
      '<td>' + deviceDisplay + '</td>' +
      '<td><div class="alert-event-name">' + (alert.eventName || "") + '</div>' +
        '<div class="alert-event-desc">' + (alert.description || "") + '</div></td>' +
      '<td>' + typeTag + '</td>' +
      '<td>' + levelBadge + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td><span class="alert-prop-value">' + (alert.propValue || "\u2014") + '</span></td>' +
      '</tr>';
  },

  _buildEmptyState: function () {
    return '<tr><td colspan="8" class="table-empty">' + t("alerts.empty") + '</td></tr>';
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================
  _setupEventListeners: function () {
    var self = this;

    // Status buttons (single select)
    var statusGroup = document.querySelector('[data-filter="status"]');
    if (statusGroup) {
      statusGroup.addEventListener("click", function (e) {
        var btn = e.target.closest(".vu-filter-btn");
        if (!btn) return;
        statusGroup.querySelectorAll(".vu-filter-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        self._filters.status = btn.dataset.value;
        self._applyFilters();
      });
    }

    // Level buttons (multi toggle)
    var levelGroup = document.querySelector('[data-filter="level"]');
    if (levelGroup) {
      levelGroup.addEventListener("click", function (e) {
        var btn = e.target.closest(".vu-filter-btn");
        if (!btn) return;
        var val = btn.dataset.value;
        var colorMap = { "2": "active-red", "1": "active-orange", "0": "active-blue" };
        var cls = colorMap[val] || "active";

        if (self._filters.levels.has(val)) {
          // Don't allow removing the last level
          if (self._filters.levels.size > 1) {
            self._filters.levels.delete(val);
            btn.classList.remove(cls);
          }
        } else {
          self._filters.levels.add(val);
          btn.classList.add(cls);
        }
        self._applyFilters();
      });
    }

    // Gateway select
    var gwSelect = document.getElementById("alerts-gw-filter");
    if (gwSelect) {
      gwSelect.addEventListener("change", function () {
        self._filters.gateway = gwSelect.value;
        self._applyFilters();
      });
    }

    // Period select
    var periodSelect = document.getElementById("alerts-period-filter");
    if (periodSelect) {
      periodSelect.addEventListener("change", function () {
        self._filters.period = periodSelect.value;
        self._applyFilters();
      });
    }

    // Sort by time header
    var sortHeader = document.getElementById("alerts-sort-time");
    if (sortHeader) {
      sortHeader.addEventListener("click", function () {
        self._sortAsc = !self._sortAsc;
        sortHeader.textContent = t("alerts.table.time") + (self._sortAsc ? " \u25B2" : " \u25BC");
        self._applyFilters();
      });
    }
  },

  // =========================================================
  // FILTER LOGIC
  // =========================================================
  _applyFilters: function () {
    var filtered = this._getFilteredAlerts();
    var self = this;

    var tbody = document.getElementById("alerts-table-body");
    if (tbody) {
      if (filtered.length === 0) {
        tbody.innerHTML = self._buildEmptyState();
      } else {
        var rows = "";
        filtered.forEach(function (alert) {
          rows += self._buildAlertRow(alert);
        });
        tbody.innerHTML = rows;
      }
    }

    var countEl = document.getElementById("alerts-result-count");
    if (countEl) {
      countEl.textContent = filtered.length + " " + t("alerts.results");
    }
  },

  _getFilteredAlerts: function () {
    var self = this;
    var alerts = this._alerts || [];

    // Status filter
    if (self._filters.status === "active") {
      alerts = alerts.filter(function (a) { return a.status === "0"; });
    } else if (self._filters.status === "recovered") {
      alerts = alerts.filter(function (a) { return a.status === "1"; });
    }

    // Level filter
    alerts = alerts.filter(function (a) {
      return self._filters.levels.has(a.level);
    });

    // Gateway filter
    if (self._filters.gateway !== "all") {
      alerts = alerts.filter(function (a) {
        return a.gatewayId === self._filters.gateway;
      });
    }

    // Period filter
    if (self._filters.period !== "all") {
      var now = new Date();
      var cutoff;
      if (self._filters.period === "24h") {
        cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (self._filters.period === "7d") {
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (self._filters.period === "30d") {
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      if (cutoff) {
        alerts = alerts.filter(function (a) {
          return new Date(a.eventCreateTime) >= cutoff;
        });
      }
    }

    // Sort by time
    alerts.sort(function (a, b) {
      var tA = new Date(a.eventCreateTime).getTime();
      var tB = new Date(b.eventCreateTime).getTime();
      return self._sortAsc ? tA - tB : tB - tA;
    });

    return alerts;
  },

  // =========================================================
  // FORMATTERS
  // =========================================================
  _formatTime: function (isoStr) {
    if (!isoStr) return "\u2014";
    var d = new Date(isoStr);
    var b = toBRT(d);
    if (!b) return "\u2014";
    var dd = String(b.day).padStart(2, "0");
    var mm = String(b.month).padStart(2, "0");
    var hh = String(b.hour).padStart(2, "0");
    var min = String(b.minute).padStart(2, "0");
    return dd + "/" + mm + " " + hh + ":" + min;
  },

  _formatTimeAgo: function (isoStr) {
    if (!isoStr) return "";
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    var diffMs = Date.now() - d.getTime();
    var diffMin = Math.floor(diffMs / 60000);
    var diffH = Math.floor(diffMin / 60);

    if (diffMin < 1) return t("alerts.timeAgo.just");
    if (diffH < 1) return diffMin + t("alerts.timeAgo.m");
    return diffH + t("alerts.timeAgo.h");
  },

  _getUniqueGateways: function () {
    var alerts = this._alerts || [];
    var seen = {};
    var result = [];
    alerts.forEach(function (a) {
      if (a.gatewayId && !seen[a.gatewayId]) {
        seen[a.gatewayId] = true;
        result.push({ id: a.gatewayId, name: a.gatewayName || a.gatewayId });
      }
    });
    return result;
  },
};
