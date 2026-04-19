/* ============================================
   SOLFACIL Admin Portal — P7: Runtime Governance (v6.10, admin-only)

   Minimal internal-ops surface. Consumes /api/runtime/* directly; no page-local
   inference. Five required sections only: overall posture, component state row,
   active issues table, issue detail drawer, self-check panel. Manual refresh +
   soft poll only — no SSE.
   ============================================ */

var RuntimePage = {
  _health: null,
  _issues: null,
  _selfChecks: null,
  _selectedFingerprint: null,
  _selectedDetail: null,
  _pollTimer: null,
  _refreshing: false,

  POLL_INTERVAL_MS: 30000,

  init: function () {
    var self = this;
    var container = document.getElementById("runtime-content");
    if (!container) return Promise.resolve();

    // Admin-only guard: the router already gates by role, but double-check
    // here so the page never renders operator semantics for non-admin roles.
    if (typeof currentRole !== "undefined" && currentRole !== "admin") {
      container.innerHTML =
        '<div class="runtime-admin-guard">' +
        "Runtime governance is restricted to SOLFACIL Admin." +
        "</div>";
      self._stopPolling();
      return Promise.resolve();
    }

    container.innerHTML = self._buildSkeleton();
    return self._refresh(container).then(function () {
      self._startPolling(container);
    });
  },

  onRoleChange: function () {
    this._stopPolling();
    this.init();
  },

  // =========================================================
  // DATA REFRESH
  // =========================================================
  _refresh: function (container) {
    var self = this;
    if (self._refreshing) return Promise.resolve();
    self._refreshing = true;

    return Promise.all([
      DataSource.runtime.health(),
      DataSource.runtime.issues(),
      DataSource.runtime.selfChecks(),
    ])
      .then(function (results) {
        self._health = results[0] || null;
        self._issues =
          results[1] && Array.isArray(results[1].issues)
            ? results[1].issues
            : [];
        self._selfChecks =
          results[2] && Array.isArray(results[2].checks)
            ? results[2].checks
            : [];

        // Keep selected fingerprint resolvable on repoll; otherwise clear it.
        if (self._selectedFingerprint) {
          var stillPresent = self._issues.some(function (i) {
            return i.fingerprint === self._selectedFingerprint;
          });
          if (!stillPresent) {
            self._selectedFingerprint = null;
            self._selectedDetail = null;
          }
        }

        container.innerHTML = self._buildContent();
        self._setupEventListeners(container);
      })
      .catch(function (err) {
        showErrorBoundary("runtime-content", err);
      })
      .finally(function () {
        self._refreshing = false;
      });
  },

  _startPolling: function (container) {
    var self = this;
    self._stopPolling();
    self._pollTimer = setInterval(function () {
      if (document.hidden) return;
      self._refresh(container);
    }, self.POLL_INTERVAL_MS);
  },

  _stopPolling: function () {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  // =========================================================
  // SKELETON
  // =========================================================
  _buildSkeleton: function () {
    return (
      Components.skeletonKPIs(4) +
      Components.skeletonTable(6) +
      Components.skeletonTable(4)
    );
  },

  // =========================================================
  // LAYOUT
  // =========================================================
  _buildContent: function () {
    return [
      this._buildHeader(),
      this._buildOverallPosture(),
      this._buildComponentRow(),
      this._buildIssuesTable(),
      this._buildSelfCheckPanel(),
      this._buildIssueDrawer(),
    ].join("");
  },

  _buildHeader: function () {
    var lastCaptured =
      this._health && this._health.capturedAt
        ? formatISODateTime(this._health.capturedAt)
        : "\u2014";
    return (
      '<div class="vu-page-header runtime-header" data-role="admin">' +
      '<div class="vu-page-title">Runtime Governance <span class="runtime-admin-chip">Internal / Admin</span></div>' +
      '<div class="vu-page-mission">' +
      "Platform runtime posture \u2014 backend-derived facts only. Not a replacement for Alerts (P6)." +
      "</div>" +
      '<div class="runtime-actions">' +
      '<span class="runtime-captured-at">Captured: ' +
      lastCaptured +
      "</span>" +
      '<button class="vu-filter-btn" type="button" id="runtime-refresh-btn">Refresh</button>' +
      "</div>" +
      "</div>"
    );
  },

  _buildOverallPosture: function () {
    var overall = this._health && this._health.overall ? this._health.overall : "unknown";
    var critCount =
      this._health && typeof this._health.criticalOpenCount === "number"
        ? this._health.criticalOpenCount
        : 0;
    var selfCheckPass =
      this._health && typeof this._health.selfCheckAllPass === "boolean"
        ? this._health.selfCheckAllPass
        : false;

    var postureClass = "runtime-posture-" + overall;
    var activeCount = (this._issues || []).filter(function (i) {
      return i.state === "detected" || i.state === "ongoing";
    }).length;

    var cards = [
      '<div class="kpi-card runtime-posture-card ' +
        postureClass +
        '"><div class="kpi-value runtime-posture-value">' +
        overall.toUpperCase() +
        '</div><div class="kpi-label">Overall posture</div></div>',
      Components.kpiCard({
        value: critCount,
        label: "Critical open",
        color: critCount > 0 ? "negative" : "",
      }),
      Components.kpiCard({
        value: activeCount,
        label: "Active issues",
        color: activeCount > 0 ? "warning" : "",
      }),
      Components.kpiCard({
        value: selfCheckPass ? "Pass" : "Fail",
        label: "Self-checks",
        color: selfCheckPass ? "positive" : "negative",
      }),
    ];

    return '<div class="kpi-grid kpi-grid-6 runtime-kpi-grid">' + cards.join("") + "</div>";
  },

  _buildComponentRow: function () {
    var components = (this._health && this._health.components) || {};
    var keys = Object.keys(components).sort();
    var body;
    if (keys.length === 0) {
      body = '<div class="runtime-empty">No component state available.</div>';
    } else {
      body =
        '<div class="runtime-components-row">' +
        keys
          .map(function (k) {
            var state = components[k] || "unknown";
            return (
              '<div class="runtime-component runtime-component-' +
              state +
              '"><div class="runtime-component-name">' +
              k +
              '</div><div class="runtime-component-state">' +
              state +
              "</div></div>"
            );
          })
          .join("") +
        "</div>";
    }
    return Components.sectionCard("Component states", body);
  },

  _buildIssuesTable: function () {
    var self = this;
    var issues = this._issues || [];
    var body;
    if (issues.length === 0) {
      body = '<div class="runtime-empty">No active runtime issues.</div>';
    } else {
      var rows = issues
        .map(function (issue) {
          return self._buildIssueRow(issue);
        })
        .join("");
      body =
        '<div class="data-table-wrapper"><table class="data-table runtime-issues-table">' +
        "<thead><tr>" +
        "<th>State</th>" +
        "<th>Severity</th>" +
        "<th>Source</th>" +
        "<th>Event code</th>" +
        "<th>Summary</th>" +
        "<th>First detected</th>" +
        "<th>Last observed</th>" +
        "<th>Cycles</th>" +
        "<th>Actions</th>" +
        "</tr></thead><tbody>" +
        rows +
        "</tbody></table></div>";
    }
    return Components.sectionCard("Active issues", body, {
      headerRight:
        '<span class="runtime-count">' + issues.length + " issue(s)</span>",
    });
  },

  _buildIssueRow: function (issue) {
    var state = issue.state || "unknown";
    var severity = issue.current_severity || "info";
    return (
      "<tr>" +
      '<td><span class="runtime-state runtime-state-' +
      state +
      '">' +
      state +
      "</span></td>" +
      '<td><span class="runtime-sev runtime-sev-' +
      severity +
      '">' +
      severity +
      "</span></td>" +
      "<td>" +
      (issue.source || "\u2014") +
      "</td>" +
      "<td>" +
      (issue.event_code || "\u2014") +
      "</td>" +
      "<td>" +
      (issue.summary || "\u2014") +
      "</td>" +
      "<td>" +
      formatISODateTime(issue.first_detected_at) +
      "</td>" +
      "<td>" +
      formatISODateTime(issue.last_observed_at) +
      "</td>" +
      "<td>" +
      (issue.cycle_count != null ? issue.cycle_count : 0) +
      "</td>" +
      '<td><button class="vu-filter-btn runtime-row-detail" data-fp="' +
      encodeURIComponent(issue.fingerprint) +
      '" type="button">Detail</button></td>' +
      "</tr>"
    );
  },

  _buildSelfCheckPanel: function () {
    var checks = this._selfChecks || [];
    var body;
    if (checks.length === 0) {
      body = '<div class="runtime-empty">No self-check state available.</div>';
    } else {
      var rows = checks
        .map(function (c) {
          var status = c.last_status || "unknown";
          return (
            "<tr>" +
            "<td>" +
            (c.check_id || "\u2014") +
            "</td>" +
            "<td>" +
            (c.source || "\u2014") +
            "</td>" +
            '<td><span class="runtime-check runtime-check-' +
            status +
            '">' +
            status +
            "</span></td>" +
            "<td>" +
            (c.last_run_at ? formatISODateTime(c.last_run_at) : "\u2014") +
            "</td>" +
            "<td>" +
            (c.consecutive_failures != null ? c.consecutive_failures : 0) +
            "</td>" +
            "<td>" +
            (c.cadence_seconds != null ? c.cadence_seconds + "s" : "\u2014") +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
      body =
        '<div class="data-table-wrapper"><table class="data-table runtime-check-table">' +
        "<thead><tr><th>Check</th><th>Source</th><th>Status</th><th>Last run</th><th>Consecutive fails</th><th>Cadence</th></tr></thead>" +
        "<tbody>" +
        rows +
        "</tbody></table></div>";
    }
    return Components.sectionCard("Self-checks", body);
  },

  _buildIssueDrawer: function () {
    if (!this._selectedFingerprint) return "";

    var detail = this._selectedDetail;
    var issue = detail && detail.issue;
    var events = (detail && detail.events) || [];

    var inner;
    if (!detail) {
      inner = '<div class="runtime-drawer-loading">Loading issue detail\u2026</div>';
    } else if (!issue) {
      inner = '<div class="runtime-empty">Issue no longer available.</div>';
    } else {
      var eventsHtml = events
        .map(function (e) {
          return (
            '<li class="runtime-event-item">' +
            '<span class="runtime-event-time">' +
            formatISODateTime(e.observed_at) +
            "</span> " +
            '<span class="runtime-sev runtime-sev-' +
            (e.severity || "info") +
            '">' +
            (e.severity || "info") +
            "</span> " +
            '<span class="runtime-event-code">' +
            (e.event_code || "") +
            "</span> " +
            '<span class="runtime-event-summary">' +
            (e.summary || "") +
            "</span>" +
            "</li>"
          );
        })
        .join("");

      inner =
        '<div class="runtime-drawer-body">' +
        '<dl class="runtime-drawer-dl">' +
        "<dt>Fingerprint</dt><dd>" +
        issue.fingerprint +
        "</dd>" +
        "<dt>Event code</dt><dd>" +
        issue.event_code +
        "</dd>" +
        "<dt>Source</dt><dd>" +
        issue.source +
        "</dd>" +
        "<dt>State</dt><dd>" +
        issue.state +
        "</dd>" +
        "<dt>Severity</dt><dd>" +
        issue.current_severity +
        "</dd>" +
        "<dt>First detected</dt><dd>" +
        formatISODateTime(issue.first_detected_at) +
        "</dd>" +
        "<dt>Last observed</dt><dd>" +
        formatISODateTime(issue.last_observed_at) +
        "</dd>" +
        "<dt>Cycle count</dt><dd>" +
        (issue.cycle_count != null ? issue.cycle_count : 0) +
        "</dd>" +
        "<dt>Observations</dt><dd>" +
        (issue.observation_count != null ? issue.observation_count : 0) +
        "</dd>" +
        "<dt>Operator note</dt><dd>" +
        (issue.operator_note || "\u2014") +
        "</dd>" +
        "</dl>" +
        '<div class="runtime-drawer-actions">' +
        '<input type="text" id="runtime-action-note" class="runtime-note-input" placeholder="Operator note (optional for close; required for note; optional for suppress)" />' +
        '<input type="datetime-local" id="runtime-action-until" class="runtime-until-input" />' +
        '<button class="vu-filter-btn runtime-action-btn" type="button" data-runtime-action="close">Close</button>' +
        '<button class="vu-filter-btn runtime-action-btn" type="button" data-runtime-action="suppress">Suppress</button>' +
        '<button class="vu-filter-btn runtime-action-btn" type="button" data-runtime-action="note">Note</button>' +
        '<span class="runtime-action-feedback" id="runtime-action-feedback"></span>' +
        "</div>" +
        '<h4 class="runtime-events-title">Recent events (' +
        events.length +
        ")</h4>" +
        '<ul class="runtime-events-list">' +
        (events.length === 0
          ? '<li class="runtime-empty">No retained events.</li>'
          : eventsHtml) +
        "</ul>" +
        "</div>";
    }

    return (
      '<div class="runtime-drawer" id="runtime-drawer" role="dialog" aria-label="Runtime issue detail">' +
      '<div class="runtime-drawer-header">' +
      '<h3>Issue detail</h3>' +
      '<button class="vu-filter-btn" type="button" id="runtime-drawer-close">Close drawer</button>' +
      "</div>" +
      inner +
      "</div>"
    );
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================
  _setupEventListeners: function (container) {
    var self = this;

    var refreshBtn = document.getElementById("runtime-refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        self._refresh(container);
      });
    }

    container.querySelectorAll(".runtime-row-detail").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var fp = decodeURIComponent(btn.dataset.fp || "");
        if (!fp) return;
        self._openDetail(fp, container);
      });
    });

    var drawerCloseBtn = document.getElementById("runtime-drawer-close");
    if (drawerCloseBtn) {
      drawerCloseBtn.addEventListener("click", function () {
        self._selectedFingerprint = null;
        self._selectedDetail = null;
        container.innerHTML = self._buildContent();
        self._setupEventListeners(container);
      });
    }

    container.querySelectorAll(".runtime-action-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.dataset.runtimeAction;
        if (!action || !self._selectedFingerprint) return;
        self._executeAction(action, container);
      });
    });
  },

  _openDetail: function (fingerprint, container) {
    var self = this;
    self._selectedFingerprint = fingerprint;
    self._selectedDetail = null;
    container.innerHTML = self._buildContent();
    self._setupEventListeners(container);

    DataSource.runtime
      .issueDetail(fingerprint)
      .then(function (detail) {
        if (self._selectedFingerprint !== fingerprint) return;
        self._selectedDetail = detail;
        container.innerHTML = self._buildContent();
        self._setupEventListeners(container);
      })
      .catch(function (err) {
        if (self._selectedFingerprint !== fingerprint) return;
        self._selectedDetail = { issue: null, events: [] };
        container.innerHTML = self._buildContent();
        self._setupEventListeners(container);
        var fb = document.getElementById("runtime-action-feedback");
        if (fb) fb.textContent = "Failed to load detail: " + (err && err.message ? err.message : err);
      });
  },

  _executeAction: function (action, container) {
    var self = this;
    var fp = self._selectedFingerprint;
    if (!fp) return;

    var noteEl = document.getElementById("runtime-action-note");
    var untilEl = document.getElementById("runtime-action-until");
    var feedbackEl = document.getElementById("runtime-action-feedback");

    var note = noteEl && noteEl.value ? noteEl.value : "";
    var body = {};
    var op;

    if (action === "close") {
      if (note) body.note = note;
      op = DataSource.runtime.closeIssue(fp, body);
    } else if (action === "suppress") {
      if (!untilEl || !untilEl.value) {
        if (feedbackEl) feedbackEl.textContent = "Suppress requires 'until' timestamp.";
        return;
      }
      body.until = new Date(untilEl.value).toISOString();
      if (note) body.note = note;
      op = DataSource.runtime.suppressIssue(fp, body);
    } else if (action === "note") {
      if (!note) {
        if (feedbackEl) feedbackEl.textContent = "Note cannot be empty.";
        return;
      }
      body.note = note;
      op = DataSource.runtime.noteIssue(fp, body);
    } else {
      return;
    }

    if (feedbackEl) feedbackEl.textContent = "Submitting " + action + "\u2026";

    op.then(function () {
      if (feedbackEl) feedbackEl.textContent = action + " submitted.";
      self._refresh(container).then(function () {
        if (self._selectedFingerprint) {
          self._openDetail(self._selectedFingerprint, container);
        }
      });
    }).catch(function (err) {
      if (feedbackEl)
        feedbackEl.textContent =
          action + " failed: " + (err && err.message ? err.message : err);
    });
  },
};

// Expose for smoke test (node 'require') and browser global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { RuntimePage: RuntimePage };
}
