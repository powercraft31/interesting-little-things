/* ============================================
   SOLFACIL Admin Portal — P5: Strategy Triggers
   Posture-aware triage, intent cards, detail panel,
   posture override management.
   ============================================ */

var StrategyPage = {
  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  _data: null,
  _expandedIntent: null,

  init: async function () {
    var self = this;
    var container = document.getElementById("vpp-content");
    if (!container) return;

    container.innerHTML = this._buildSkeleton();

    try {
      self._data = await DataSource.p5.overview();
    } catch (err) {
      showErrorBoundary("vpp-content", err);
      return;
    }

    container.innerHTML = self._buildContent();
    self._setupEventListeners();
  },

  onRoleChange: function () {
    var container = document.getElementById("vpp-content");
    if (!container || !this._data) return;
    container.innerHTML = this._buildContent();
    this._setupEventListeners();
  },

  // =========================================================
  // SKELETON
  // =========================================================

  _buildSkeleton: function () {
    return [
      '<div class="p5-strategy-skeleton">',
      '<div class="skeleton" style="height:120px;border-radius:10px;margin-bottom:16px"></div>',
      Components.skeletonKPIs(3),
      Components.skeletonTable(4),
      '</div>',
    ].join("");
  },

  // =========================================================
  // CONTENT
  // =========================================================

  _buildContent: function () {
    var hero = this._data.hero || {};
    var calm = this._data.calm_explanation;
    var lanes = {
      need_decision_now: this._data.need_decision_now || [],
      platform_acting: this._data.platform_acting || [],
      watch_next: this._data.watch_next || [],
    };
    var ctx = this._data.context || {};

    return [
      this._buildHero(hero, calm),
      this._buildTriageLanes(lanes),
      this._buildContextSection(ctx),
      this._buildOverrideSection(hero),
    ].join("");
  },

  // =========================================================
  // HERO SECTION
  // =========================================================

  _POSTURE_CONFIG: {
    calm: { cssClass: "p5-strategy-posture-calm", icon: "\u2713" },
    approval_gated: { cssClass: "p5-strategy-posture-approval", icon: "\u23F3" },
    protective: { cssClass: "p5-strategy-posture-protective", icon: "\uD83D\uDEE1" },
    escalation: { cssClass: "p5-strategy-posture-escalation", icon: "\u26A0" },
  },

  _buildHero: function (hero, calmExplanation) {
    var posture = hero.posture || "calm";
    var cfg = this._POSTURE_CONFIG[posture] || this._POSTURE_CONFIG.calm;

    var indicators = [];
    if (hero.override_active) {
      indicators.push('<span class="p5-strategy-indicator p5-strategy-indicator-override">' + t("p5.strategy.overrideActive") + "</span>");
    }
    if (hero.conflict_active) {
      indicators.push('<span class="p5-strategy-indicator p5-strategy-indicator-conflict">' + t("p5.strategy.conflictActive") + "</span>");
    }
    if (hero.operator_action_needed) {
      indicators.push('<span class="p5-strategy-indicator p5-strategy-indicator-action">' + t("p5.strategy.actionNeeded") + "</span>");
    }

    var calmHtml = "";
    if (calmExplanation && calmExplanation.reason) {
      var factors = (calmExplanation.contributing_factors || []).map(function (f) {
        return "<li>" + escapeHtml(f) + "</li>";
      }).join("");
      calmHtml = [
        '<div class="p5-strategy-calm-explain">',
        '<div class="p5-strategy-calm-reason"><strong>' + t("p5.strategy.calmReason") + ":</strong> " + t("p5.strategy.calmReason." + calmExplanation.reason) + "</div>",
        '<div class="p5-strategy-calm-detail">' + escapeHtml(calmExplanation.detail || "") + "</div>",
        factors ? '<ul class="p5-strategy-calm-factors">' + factors + "</ul>" : "",
        "</div>",
      ].join("");
    }

    return [
      '<div class="p5-strategy-hero ' + cfg.cssClass + '">',
      '<div class="p5-strategy-hero-main">',
      '<span class="p5-strategy-hero-icon">' + cfg.icon + "</span>",
      '<div class="p5-strategy-hero-info">',
      '<div class="p5-strategy-hero-posture">' + t("p5.strategy.posture." + posture) + "</div>",
      hero.dominant_driver ? '<div class="p5-strategy-hero-driver">' + escapeHtml(hero.dominant_driver) + "</div>" : "",
      '<div class="p5-strategy-hero-badges">',
      '<span class="p5-strategy-badge p5-strategy-badge-governance">' + t("p5.strategy.governance." + (hero.governance_mode || "observe")) + "</span>",
      "</div>",
      '<div class="p5-strategy-hero-summary">' + escapeHtml(hero.governance_summary || "") + "</div>",
      "</div>",
      "</div>",
      indicators.length ? '<div class="p5-strategy-hero-indicators">' + indicators.join("") + "</div>" : "",
      calmHtml,
      "</div>",
    ].join("");
  },

  // =========================================================
  // TRIAGE LANES
  // =========================================================

  _LANE_CONFIG: {
    need_decision_now: { accent: "amber", titleKey: "p5.strategy.lane.needDecision" },
    platform_acting: { accent: "accent", titleKey: "p5.strategy.lane.platformActing" },
    watch_next: { accent: "muted", titleKey: "p5.strategy.lane.watchNext" },
  },

  _buildTriageLanes: function (lanes) {
    var self = this;
    var html = "";
    ["need_decision_now", "platform_acting", "watch_next"].forEach(function (laneKey) {
      var cfg = self._LANE_CONFIG[laneKey];
      var intents = lanes[laneKey] || [];
      var body;
      if (intents.length === 0) {
        body = '<div class="p5-strategy-lane-empty">' + t("p5.strategy.noIntents") + "</div>";
      } else {
        body = intents.map(function (intent) {
          return self._buildIntentCard(intent);
        }).join("");
      }
      html += '<div class="p5-strategy-lane p5-strategy-lane-' + cfg.accent + '">' +
        Components.sectionCard(t(cfg.titleKey), '<div class="p5-strategy-lane-cards">' + body + "</div>") +
        "</div>";
    });
    return html;
  },

  // =========================================================
  // INTENT CARD (Level 1)
  // =========================================================

  _FAMILY_ICONS: {
    peak_shaving: "\u26A1",
    reserve_protection: "\uD83D\uDEE1",
    tariff_optimization: "\uD83D\uDCB0",
    demand_response: "\uD83D\uDCE1",
    load_balancing: "\u2696",
  },

  _buildIntentCard: function (intent) {
    var familyIcon = this._FAMILY_ICONS[intent.family] || "\uD83D\uDD0B";
    var urgencyClass = "p5-strategy-urgency-" + (intent.urgency || "low");
    var statusClass = "p5-strategy-status-" + (intent.status || "new");

    return [
      '<div class="p5-strategy-intent-card" data-intent-id="' + escapeHtml(intent.id) + '">',
      '<div class="p5-strategy-intent-header">',
      '<span class="p5-strategy-intent-icon">' + familyIcon + "</span>",
      '<span class="p5-strategy-intent-title">' + escapeHtml(intent.title || "") + "</span>",
      '<span class="p5-strategy-badge ' + urgencyClass + '">' + t("p5.strategy.urgency." + (intent.urgency || "low")) + "</span>",
      "</div>",
      '<div class="p5-strategy-intent-meta">',
      '<span class="p5-strategy-badge p5-strategy-badge-governance">' + t("p5.strategy.governance." + (intent.governance_mode || "observe")) + "</span>",
      '<span class="p5-strategy-badge ' + statusClass + '">' + t("p5.strategy.status." + (intent.status || "new")) + "</span>",
      "</div>",
      '<div class="p5-strategy-intent-summary">' + escapeHtml(intent.reason_summary || "") + "</div>",
      intent.scope_summary ? '<div class="p5-strategy-intent-scope">' + t("p5.strategy.scope") + ": " + escapeHtml(intent.scope_summary) + "</div>" : "",
      intent.time_pressure ? '<div class="p5-strategy-intent-time">' + escapeHtml(intent.time_pressure) + "</div>" : "",
      '<div class="p5-strategy-intent-expand">' + t("p5.strategy.viewDetail") + " \u25B8</div>",
      '<div class="p5-strategy-intent-detail" id="p5-detail-' + escapeHtml(intent.id) + '" style="display:none"></div>',
      "</div>",
    ].join("");
  },

  // =========================================================
  // INTENT DETAIL PANEL (Level 2)
  // =========================================================

  _loadIntentDetail: async function (intentId) {
    var detailEl = document.getElementById("p5-detail-" + intentId);
    if (!detailEl) return;

    // Toggle collapse
    if (this._expandedIntent === intentId) {
      detailEl.style.display = "none";
      this._expandedIntent = null;
      return;
    }

    // Collapse previous
    if (this._expandedIntent) {
      var prev = document.getElementById("p5-detail-" + this._expandedIntent);
      if (prev) prev.style.display = "none";
    }

    this._expandedIntent = intentId;
    detailEl.style.display = "block";
    detailEl.innerHTML = '<div class="p5-strategy-detail-loading">' + t("shared.loading") + "</div>";

    try {
      var detail = await DataSource.p5.intentDetail(intentId);
      detailEl.innerHTML = this._buildDetailContent(detail);
      this._setupDetailListeners(intentId, detail);
    } catch (err) {
      detailEl.innerHTML = '<div class="p5-strategy-detail-error">' + t("shared.apiError") + "</div>";
    }
  },

  _buildDetailContent: function (detail) {
    var sections = [];

    // Evidence snapshot
    if (detail.evidence_snapshot) {
      sections.push(this._buildKeyValueSection(t("p5.strategy.detail.evidence"), detail.evidence_snapshot));
    }

    // Constraints
    if (detail.constraints) {
      sections.push(this._buildKeyValueSection(t("p5.strategy.detail.constraints"), detail.constraints));
    }

    // Next path (4 outcomes)
    if (detail.next_path) {
      var np = detail.next_path;
      var pathHtml = [
        '<div class="p5-strategy-next-path">',
        '<h4>' + t("p5.strategy.detail.nextPath") + "</h4>",
        this._buildPathOutcome(t("p5.strategy.detail.ifApproved"), np.if_approved),
        this._buildPathOutcome(t("p5.strategy.detail.ifDeferred"), np.if_deferred),
        this._buildPathOutcome(t("p5.strategy.detail.ifNoAction"), np.if_no_action),
        np.suggested_playbook ? this._buildPathOutcome(t("p5.strategy.detail.suggestedPlaybook"), np.suggested_playbook) : "",
        "</div>",
      ].join("");
      sections.push(pathHtml);
    }

    // Arbitration note
    if (detail.arbitration_note) {
      sections.push('<div class="p5-strategy-arb-note"><strong>' + t("p5.strategy.detail.arbitration") + ":</strong> " + escapeHtml(detail.arbitration_note) + "</div>");
    }

    // Handoff snapshot
    if (detail.handoff_snapshot) {
      sections.push(this._buildKeyValueSection(t("p5.strategy.detail.handoff"), detail.handoff_snapshot));
    }

    // Action buttons
    if (detail.available_actions && detail.available_actions.length > 0) {
      sections.push(this._buildActionButtons(detail));
    }

    // History timeline
    if (detail.history && detail.history.length > 0) {
      sections.push(this._buildHistoryTimeline(detail.history));
    }

    return '<div class="p5-strategy-detail-body">' + sections.join("") + "</div>";
  },

  _buildKeyValueSection: function (title, obj) {
    var rows = Object.keys(obj).map(function (k) {
      var val = obj[k];
      var displayVal = typeof val === "object" ? JSON.stringify(val) : String(val);
      return '<tr><td class="p5-strategy-kv-key">' + escapeHtml(k) + "</td><td>" + escapeHtml(displayVal) + "</td></tr>";
    }).join("");
    return [
      '<div class="p5-strategy-kv-section">',
      "<h4>" + title + "</h4>",
      '<table class="p5-strategy-kv-table"><tbody>' + rows + "</tbody></table>",
      "</div>",
    ].join("");
  },

  _buildPathOutcome: function (label, text) {
    if (!text) return "";
    return '<div class="p5-strategy-path-item"><strong>' + label + ":</strong> " + escapeHtml(String(text)) + "</div>";
  },

  _buildActionButtons: function (detail) {
    var actionConfigs = {
      approve: { cssClass: "btn-positive", label: t("p5.strategy.action.approve"), requireReason: false },
      defer: { cssClass: "btn-amber", label: t("p5.strategy.action.defer"), requireReason: false },
      suppress: { cssClass: "btn-negative", label: t("p5.strategy.action.suppress"), requireReason: true },
      escalate: { cssClass: "btn-warning", label: t("p5.strategy.action.escalate"), requireReason: false },
    };

    var buttons = detail.available_actions.map(function (action) {
      var cfg = actionConfigs[action] || { cssClass: "btn", label: action, requireReason: false };
      return '<button class="btn ' + cfg.cssClass + ' p5-strategy-action-btn" data-action="' + action + '" data-require-reason="' + cfg.requireReason + '">' + cfg.label + "</button>";
    }).join("");

    return [
      '<div class="p5-strategy-actions">',
      '<h4>' + t("p5.strategy.detail.actions") + "</h4>",
      '<div class="p5-strategy-action-row">' + buttons + "</div>",
      '<div class="p5-strategy-reason-input" id="p5-reason-area" style="display:none">',
      '<textarea id="p5-reason-text" class="p5-strategy-textarea" placeholder="' + t("p5.strategy.reasonPlaceholder") + '" rows="2"></textarea>',
      '<button class="btn btn-primary p5-strategy-submit-action" id="p5-submit-action">' + t("p5.strategy.submitAction") + "</button>",
      "</div>",
      "</div>",
    ].join("");
  },

  _buildHistoryTimeline: function (history) {
    var items = history.map(function (entry) {
      return [
        '<div class="p5-strategy-timeline-item">',
        '<div class="p5-strategy-timeline-time">' + formatISODateTime(entry.timestamp || entry.created_at) + "</div>",
        '<div class="p5-strategy-timeline-event">' + escapeHtml(entry.event || entry.action || "") + "</div>",
        entry.detail ? '<div class="p5-strategy-timeline-detail">' + escapeHtml(entry.detail) + "</div>" : "",
        "</div>",
      ].join("");
    }).join("");

    return [
      '<div class="p5-strategy-history">',
      "<h4>" + t("p5.strategy.detail.history") + "</h4>",
      '<div class="p5-strategy-timeline">' + items + "</div>",
      "</div>",
    ].join("");
  },

  // =========================================================
  // CONTEXT SECTION
  // =========================================================

  _buildContextSection: function (ctx) {
    var parts = [];

    // Operating posture summary
    if (ctx.operating_posture) {
      var postureObj = ctx.operating_posture;
      var postureLabels = {
        active_overrides: t("p5.strategy.ctx.activeOverrides") || "Active Overrides",
        dominant_override_type: t("p5.strategy.ctx.dominantOverrideType") || "Dominant Override",
        scope_description: t("p5.strategy.ctx.scopeDescription") || "Scope"
      };
      var overrideTypeLabels = {
        force_protective: t("p5.strategy.override.type.forceProtective") || "Force Protective",
        suppress_economic: t("p5.strategy.override.type.suppressEconomic") || "Suppress Economic",
        force_approval_gate: t("p5.strategy.override.type.forceApprovalGate") || "Force Approval Gate",
        manual_escalation_note: t("p5.strategy.override.type.manualEscalation") || "Manual Escalation Note"
      };
      var postureRows = Object.keys(postureObj).map(function (k) {
        var label = postureLabels[k] || k.replace(/_/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        var val = String(postureObj[k]);
        if (k === "dominant_override_type" && overrideTypeLabels[val]) val = overrideTypeLabels[val];
        return "<li><strong>" + escapeHtml(label) + ":</strong> " + escapeHtml(val) + "</li>";
      }).join("");
      if (postureRows) {
        parts.push('<div class="p5-strategy-ctx-block"><h4>' + t("p5.strategy.ctx.postureSummary") + "</h4><ul>" + postureRows + "</ul></div>");
      }
    }

    // Dominant protector
    if (ctx.dominant_protector) {
      var dp = ctx.dominant_protector;
      var dpHtml = '<div class="p5-strategy-kv-table">';
      if (dp.family) dpHtml += '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' + t("p5.strategy.detail.family") + '</span><span class="p5-strategy-kv-val">' + escapeHtml(t("p5.strategy.family." + dp.family) || dp.family) + '</span></div>';
      if (dp.title) dpHtml += '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' + t("p5.strategy.detail.title") + '</span><span class="p5-strategy-kv-val">' + escapeHtml(dp.title) + '</span></div>';
      if (dp.scope_summary) dpHtml += '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' + t("p5.strategy.detail.scope") + '</span><span class="p5-strategy-kv-val">' + escapeHtml(dp.scope_summary) + '</span></div>';
      if (dp.governance_mode) dpHtml += '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' + t("p5.strategy.detail.governance") + '</span><span class="p5-strategy-kv-val">' + escapeHtml(t("p5.strategy.governance." + dp.governance_mode) || dp.governance_mode) + '</span></div>';
      dpHtml += '</div>';
      parts.push('<div class="p5-strategy-ctx-block"><h4>' + t("p5.strategy.ctx.dominantProtector") + '</h4>' + dpHtml + "</div>");
    }

    // Recent handoffs
    if (ctx.recent_handoffs && ctx.recent_handoffs.length > 0) {
      var handoffList = ctx.recent_handoffs.map(function (h) {
        return "<li>" + escapeHtml(typeof h === "object" ? (h.from + " \u2192 " + h.to + (h.reason ? " (" + h.reason + ")" : "")) : String(h)) + "</li>";
      }).join("");
      parts.push('<div class="p5-strategy-ctx-block"><h4>' + t("p5.strategy.ctx.recentHandoffs") + "</h4><ul>" + handoffList + "</ul></div>");
    }

    // Suppressed/deferred counts
    if (ctx.suppressed_count > 0 || ctx.deferred_count > 0) {
      parts.push([
        '<div class="p5-strategy-ctx-block">',
        '<h4>' + t("p5.strategy.ctx.counts") + "</h4>",
        '<div class="p5-strategy-ctx-counts">',
        '<span>' + t("p5.strategy.ctx.suppressed") + ": <strong>" + (ctx.suppressed_count || 0) + "</strong></span>",
        '<span>' + t("p5.strategy.ctx.deferred") + ": <strong>" + (ctx.deferred_count || 0) + "</strong></span>",
        "</div>",
        "</div>",
      ].join(""));
    }

    if (parts.length === 0) return "";

    return Components.sectionCard(t("p5.strategy.ctx.title"), '<div class="p5-strategy-context">' + parts.join("") + "</div>");
  },

  // =========================================================
  // POSTURE OVERRIDE SECTION
  // =========================================================

  _buildOverrideSection: function (hero) {
    var isAdmin = typeof currentRole !== "undefined" && currentRole === "admin";
    if (!isAdmin) return "";

    var activeOverride = hero.override_active ? [
      '<div class="p5-strategy-override-active">',
      '<span class="p5-strategy-indicator p5-strategy-indicator-override">' + t("p5.strategy.override.activeLabel") + "</span>",
      '<button class="btn btn-negative p5-strategy-cancel-override" id="p5-cancel-override">' + t("p5.strategy.override.cancel") + "</button>",
      "</div>",
    ].join("") : "";

    var form = [
      '<div class="p5-strategy-override-form" id="p5-override-form" style="display:none">',
      '<div class="p5-strategy-form-row">',
      '<div class="p5-strategy-form-group">',
      "<label>" + t("p5.strategy.override.type") + "</label>",
      '<select id="p5-override-type">',
      '<option value="force_calm">' + t("p5.strategy.override.type.forceCalm") + "</option>",
      '<option value="force_protective">' + t("p5.strategy.override.type.forceProtective") + "</option>",
      '<option value="suppress_all">' + t("p5.strategy.override.type.suppressAll") + "</option>",
      '<option value="approve_all">' + t("p5.strategy.override.type.approveAll") + "</option>",
      "</select>",
      "</div>",
      '<div class="p5-strategy-form-group">',
      "<label>" + t("p5.strategy.override.duration") + "</label>",
      '<input type="number" id="p5-override-duration" value="60" min="1" max="480">',
      "</div>",
      "</div>",
      '<div class="p5-strategy-form-group">',
      "<label>" + t("p5.strategy.override.reason") + " *</label>",
      '<textarea id="p5-override-reason" class="p5-strategy-textarea" rows="2" required></textarea>',
      "</div>",
      '<div class="p5-strategy-form-group">',
      "<label>" + t("p5.strategy.override.scopeGateways") + "</label>",
      '<input type="text" id="p5-override-scope" placeholder="' + t("p5.strategy.override.scopePlaceholder") + '">',
      "</div>",
      '<div class="p5-strategy-form-actions">',
      '<button class="btn btn-primary" id="p5-override-submit">' + t("p5.strategy.override.submit") + "</button>",
      '<button class="btn" id="p5-override-cancel-form">' + t("shared.cancel") + "</button>",
      "</div>",
      "</div>",
    ].join("");

    var body = [
      activeOverride,
      '<button class="btn btn-primary p5-strategy-create-override" id="p5-create-override">' + t("p5.strategy.override.create") + "</button>",
      form,
    ].join("");

    return Components.sectionCard(t("p5.strategy.override.title"), body, { dataRole: "admin" });
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupEventListeners: function () {
    var self = this;

    // Intent card expand
    document.querySelectorAll(".p5-strategy-intent-card").forEach(function (card) {
      card.addEventListener("click", function (e) {
        // Don't expand if clicking action buttons inside detail
        if (e.target.closest(".p5-strategy-action-btn") || e.target.closest(".p5-strategy-submit-action") || e.target.closest("textarea") || e.target.closest("input")) return;
        var intentId = card.dataset.intentId;
        if (intentId) self._loadIntentDetail(intentId);
      });
    });

    // Override create toggle
    var createBtn = document.getElementById("p5-create-override");
    if (createBtn) {
      createBtn.addEventListener("click", function () {
        var form = document.getElementById("p5-override-form");
        if (form) {
          form.style.display = form.style.display === "none" ? "block" : "none";
        }
      });
    }

    // Override cancel form
    var cancelFormBtn = document.getElementById("p5-override-cancel-form");
    if (cancelFormBtn) {
      cancelFormBtn.addEventListener("click", function () {
        var form = document.getElementById("p5-override-form");
        if (form) form.style.display = "none";
      });
    }

    // Override submit
    var submitBtn = document.getElementById("p5-override-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        self._handleOverrideSubmit();
      });
    }

    // Cancel active override
    var cancelOverrideBtn = document.getElementById("p5-cancel-override");
    if (cancelOverrideBtn) {
      cancelOverrideBtn.addEventListener("click", function () {
        self._handleCancelOverride();
      });
    }
  },

  _setupDetailListeners: function (intentId, detail) {
    var self = this;
    var detailEl = document.getElementById("p5-detail-" + intentId);
    if (!detailEl) return;

    var pendingAction = null;

    detailEl.querySelectorAll(".p5-strategy-action-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        pendingAction = btn.dataset.action;
        var requireReason = btn.dataset.requireReason === "true";
        var reasonArea = detailEl.querySelector(".p5-strategy-reason-input");
        if (reasonArea) {
          reasonArea.style.display = "block";
          var textarea = reasonArea.querySelector("textarea");
          if (textarea && requireReason) {
            textarea.setAttribute("required", "required");
            textarea.placeholder = t("p5.strategy.reasonRequired");
          } else if (textarea) {
            textarea.removeAttribute("required");
            textarea.placeholder = t("p5.strategy.reasonPlaceholder");
          }
        }
      });
    });

    var submitBtn = detailEl.querySelector(".p5-strategy-submit-action");
    if (submitBtn) {
      submitBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!pendingAction) return;
        var textarea = detailEl.querySelector("textarea");
        var reason = textarea ? textarea.value.trim() : "";
        if (textarea && textarea.hasAttribute("required") && !reason) {
          textarea.classList.add("p5-strategy-input-error");
          return;
        }
        self._executeIntentAction(intentId, pendingAction, { reason: reason });
      });
    }
  },

  // =========================================================
  // ACTIONS
  // =========================================================

  _executeIntentAction: async function (intentId, action, body) {
    try {
      await DataSource.p5.intentAction(intentId, action, body);
      // Reload overview
      this._data = await DataSource.p5.overview();
      var container = document.getElementById("vpp-content");
      if (container) {
        this._expandedIntent = null;
        container.innerHTML = this._buildContent();
        this._setupEventListeners();
      }
    } catch (err) {
      console.error("[StrategyPage] action failed:", err);
      showErrorBoundary("vpp-content", err);
    }
  },

  _handleOverrideSubmit: async function () {
    var typeEl = document.getElementById("p5-override-type");
    var durationEl = document.getElementById("p5-override-duration");
    var reasonEl = document.getElementById("p5-override-reason");
    var scopeEl = document.getElementById("p5-override-scope");

    if (!reasonEl || !reasonEl.value.trim()) {
      if (reasonEl) reasonEl.classList.add("p5-strategy-input-error");
      return;
    }

    var duration = parseInt(durationEl ? durationEl.value : "60", 10);
    if (isNaN(duration) || duration < 1 || duration > 480) {
      if (durationEl) durationEl.classList.add("p5-strategy-input-error");
      return;
    }

    var scopeIds = scopeEl && scopeEl.value.trim()
      ? scopeEl.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
      : [];

    var payload = {
      override_type: typeEl ? typeEl.value : "force_calm",
      reason: reasonEl.value.trim(),
      duration_minutes: duration,
    };
    if (scopeIds.length > 0) {
      payload.scope_gateway_ids = scopeIds;
    }

    try {
      await DataSource.p5.createOverride(payload);
      this._data = await DataSource.p5.overview();
      var container = document.getElementById("vpp-content");
      if (container) {
        this._expandedIntent = null;
        container.innerHTML = this._buildContent();
        this._setupEventListeners();
      }
    } catch (err) {
      console.error("[StrategyPage] override submit failed:", err);
      showErrorBoundary("vpp-content", err);
    }
  },

  _handleCancelOverride: async function () {
    // For now use a placeholder override ID; in production this comes from state
    try {
      await DataSource.p5.cancelOverride("active", { reason: "Operator cancelled" });
      this._data = await DataSource.p5.overview();
      var container = document.getElementById("vpp-content");
      if (container) {
        this._expandedIntent = null;
        container.innerHTML = this._buildContent();
        this._setupEventListeners();
      }
    } catch (err) {
      console.error("[StrategyPage] cancel override failed:", err);
      showErrorBoundary("vpp-content", err);
    }
  },
};

// =========================================================
// HTML ESCAPE UTILITY
// =========================================================
function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
