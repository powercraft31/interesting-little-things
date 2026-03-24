/* ============================================
   SOLFACIL Admin Portal — P5: Strategy Triggers
   Posture-aware triage, intent cards, detail panel,
   posture override management.
   ============================================ */

var StrategyPage = {
  // P5 Strategy Homepage — single-decision cockpit layout
  // Render chain: _buildContent → hero → impact → CTA → context → override → alert → preview
  // Deferred state: _buildDeferredHero + timer management (_startDeferTimer / _clearDeferTimer)

  // =========================================================
  // INIT / LIFECYCLE
  // =========================================================

  _data: null,
  _expandedIntent: null,
  _overrideExpanded: false,
  _overrideDuration: null,
  _deferExpanded: false,
  _alertSilenceExpanded: false,
  _alertSilenceDuration: null,
  _deferTimerId: null,
  _previousDeferContext: null,
  _selectedPreviewAction: null,
  _lastDeferLabel: null,

  init: async function () {
    var self = this;
    this._clearDeferTimer();
    this._previousDeferContext = null;
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
      "</div>",
    ].join("");
  },

  // =========================================================
  // CONTENT
  // =========================================================

  _buildContent: function () {
    var hero = this._data.hero || {};
    var calm = this._data.calm_explanation;
    var lanes = {
      need_decision_now: (this._data.need_decision_now || []).slice(),
      platform_acting: (this._data.platform_acting || []).slice(),
      watch_next: (this._data.watch_next || []).slice(),
    };
    var ctx = this._data.context || {};

    // Phase 13: detect deferred state
    var deferContext = this._data.defer_context || null;
    var isDeferred =
      deferContext && new Date(deferContext.defer_until) > new Date();
    this._isDeferred = !!isDeferred;
    this._deferContext = deferContext;

    // Phase 14: manage defer countdown timer
    this._startDeferTimer();

    return [
      this._buildRecommendationHero(hero, calm, ctx, lanes),
      this._buildImpactStrip(hero, ctx, lanes),
      this._buildCtaPair(hero, ctx, lanes),
      this._buildContextSection(ctx, hero),
      this._buildOverrideSection(hero),
      this._buildAlertControl(hero),
      this._buildResultPreview(hero),
    ].join("");
  },

  // =========================================================
  // DERIVED CARDS (fix hero/lane contradiction)
  // =========================================================

  _injectDerivedCards: function (hero, ctx, lanes) {
    // Problem 2: if hero says action needed but decision lane is empty
    if (hero.operator_action_needed && lanes.need_decision_now.length === 0) {
      lanes.need_decision_now.push(this._buildDerivedDecisionCard(hero, ctx));
    }

    // If override is active, ensure platform_acting has a representation
    if (hero.override_active && lanes.platform_acting.length === 0) {
      lanes.platform_acting.push(this._buildDerivedActingCard(hero, ctx));
    }
  },

  _buildDerivedDecisionCard: function (hero, ctx) {
    var dp = ctx.dominant_protector || {};
    var postureLabel = t("p5.strategy.posture." + (hero.posture || "calm"));
    var trace = this._buildCausalTrace(hero, ctx);

    return {
      id: "derived-decision",
      family: dp.family || "reserve_protection",
      title: t("p5.strategy.derived.decisionTitle"),
      urgency: "soon",
      governance_mode: hero.governance_mode || "approval_required",
      status: "active",
      reason_summary: t("p5.strategy.derived.decisionReason").replace(
        "{posture}",
        postureLabel,
      ),
      scope_summary: dp.scope_summary || "",
      time_pressure: "",
      _derived: true,
      _causal_trace: trace,
    };
  },

  _buildDerivedActingCard: function (hero, ctx) {
    var dp = ctx.dominant_protector || {};
    var op = ctx.operating_posture || {};
    var overrideLabel = "";
    if (op.dominant_override_type) {
      overrideLabel =
        t(
          "p5.strategy.override.type." +
            this._overrideTypeKey(op.dominant_override_type),
        ) || op.dominant_override_type;
    }
    var trace = this._buildCausalTrace(hero, ctx);

    return {
      id: "derived-acting",
      family: dp.family || "reserve_protection",
      title: t("p5.strategy.derived.actingTitle"),
      urgency: "watch",
      governance_mode: "auto_governed",
      status: "active",
      reason_summary: overrideLabel
        ? t("p5.strategy.derived.actingReasonOverride").replace(
            "{override}",
            overrideLabel,
          )
        : t("p5.strategy.derived.actingReason"),
      scope_summary: dp.scope_summary || "",
      time_pressure: "",
      _derived: true,
      _causal_trace: trace,
    };
  },

  _overrideTypeKey: function (raw) {
    var map = {
      force_protective: "forceProtective",
      suppress_economic: "suppressEconomic",
      force_approval_gate: "forceApprovalGate",
      manual_escalation_note: "manualEscalation",
      force_calm: "forceCalm",
      suppress_all: "suppressAll",
      approve_all: "approveAll",
    };
    return map[raw] || raw;
  },

  // =========================================================
  // CAUSAL TRACE
  // =========================================================

  _buildCausalTrace: function (hero, ctx) {
    var parts = [];
    var dp = ctx.dominant_protector || {};
    var op = ctx.operating_posture || {};

    // Step 1: trigger
    if (hero.dominant_driver) {
      parts.push(escapeHtml(hero.dominant_driver));
    }

    // Step 2: constraint/governance
    if (hero.override_active && op.dominant_override_type) {
      var overrideKey = this._overrideTypeKey(op.dominant_override_type);
      var overrideLabel =
        t("p5.strategy.override.type." + overrideKey) ||
        op.dominant_override_type;
      parts.push(
        overrideLabel.toLowerCase() + " " + t("p5.strategy.trace.constrains"),
      );
    } else if (dp.family) {
      var famLabel = t("p5.strategy.family." + dp.family) || dp.family;
      parts.push(famLabel + " " + t("p5.strategy.trace.governs"));
    }

    // Step 3: outcome
    if (hero.operator_action_needed) {
      parts.push(t("p5.strategy.trace.operatorReview"));
    } else if (hero.posture === "calm") {
      parts.push(t("p5.strategy.trace.noAction"));
    } else {
      parts.push(t("p5.strategy.trace.platformHandling"));
    }

    return parts.join(" \u2192 ");
  },

  // =========================================================
  // HERO SECTION (posture-first rewrite)
  // =========================================================

  _POSTURE_CONFIG: {
    calm: { cssClass: "p5-strategy-posture-calm", icon: "\u2713" },
    approval_gated: {
      cssClass: "p5-strategy-posture-approval",
      icon: "\u23F3",
    },
    protective: {
      cssClass: "p5-strategy-posture-protective",
      icon: "\uD83D\uDEE1",
    },
    escalation: { cssClass: "p5-strategy-posture-escalation", icon: "\u26A0" },
  },

  // =========================================================
  // RECOMMENDATION HERO (Action Model Reframe — Phase 1)
  // =========================================================

  _REC_HERO_CONFIG: {
    calm: { cssMod: "calm", icon: "\u2713" },
    approval_gated: { cssMod: "approval", icon: "\u26A1" },
    protective: { cssMod: "protective", icon: "\uD83D\uDEE1" },
    escalation: { cssMod: "escalation", icon: "\u26A0" },
  },

  _buildRecommendationHero: function (hero, calmExplanation, ctx, lanes) {
    // Phase 13: deferred state rendering
    if (this._isDeferred) {
      return this._buildDeferredHero(hero, ctx);
    }

    var posture = hero.posture || "calm";
    var cfg = this._REC_HERO_CONFIG[posture] || this._REC_HERO_CONFIG.calm;
    var dp = ctx.dominant_protector || {};

    // Recommendation title
    var recTitle = this._getRecTitle(posture, lanes, dp);

    // Narrative
    var narrative = this._getRecNarrative(
      posture,
      hero,
      calmExplanation,
      ctx,
      lanes,
      dp,
    );

    // Phase 14: re-escalation hint after defer expiry
    if (posture === "escalation" && this._previousDeferContext) {
      narrative = t("p5.strategy.hero.reescalated") + " " + narrative;
      this._previousDeferContext = null;
    }

    // Metric chips
    var metricsHtml = this._buildRecMetrics(posture, dp, hero);

    return [
      '<div class="p5-rec-hero p5-rec-hero--' + cfg.cssMod + '">',
      '<div class="p5-rec-hero__top">',
      '<span class="p5-rec-hero__icon">' + cfg.icon + "</span>",
      '<div class="p5-rec-hero__body">',
      '<div class="p5-rec-hero__title">' + escapeHtml(recTitle) + "</div>",
      '<div class="p5-rec-hero__narrative">' + escapeHtml(narrative) + "</div>",
      metricsHtml,
      "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  _buildDeferredHero: function (hero, ctx) {
    var dc = this._deferContext;
    var returnTime = this._formatReturnTime(dc.defer_until);
    var countdown = this._formatCountdown(dc.defer_until);
    var reason = hero.dominant_driver || "";

    var title = t("p5.strategy.hero.deferred.title").replace(
      "{time}",
      returnTime,
    );
    var narrative = t("p5.strategy.hero.deferred.narrative").replace(
      "{reason}",
      reason,
    );
    var badge = t("p5.strategy.defer.badge");
    var countdownHtml = countdown
      ? '<span class="p5-hero-countdown">' +
        escapeHtml(
          t("p5.strategy.hero.deferred.countdown").replace(
            "{countdown}",
            countdown,
          ),
        ) +
        "</span>"
      : "";

    return [
      '<div class="p5-rec-hero p5-rec-hero--escalation p5-hero--deferred">',
      '<div class="p5-rec-hero__top">',
      '<span class="p5-rec-hero__icon p5-hero-icon">\u23F8</span>',
      '<div class="p5-rec-hero__body">',
      '<div class="p5-rec-hero__title">' + escapeHtml(title) + "</div>",
      '<div class="p5-rec-hero__narrative">' + escapeHtml(narrative) + "</div>",
      '<div class="p5-rec-hero__metrics">',
      '<span class="p5-rec-hero__chip p5-hero-badge--deferred">' +
        escapeHtml(badge) +
        "</span>",
      "</div>",
      countdownHtml,
      "</div>",
      "</div>",
      "</div>",
    ].join("");
  },

  _formatCountdown: function (deferUntil) {
    var diff = new Date(deferUntil).getTime() - Date.now();
    if (diff <= 0) return null;
    var hours = Math.floor(diff / 3600000);
    var minutes = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return hours + "h " + minutes + "min";
    return minutes + "min";
  },

  _formatReturnTime: function (deferUntil) {
    var d = new Date(deferUntil);
    return (
      d.getHours().toString().padStart(2, "0") +
      ":" +
      d.getMinutes().toString().padStart(2, "0")
    );
  },

  _getRecTitle: function (posture, lanes, dp) {
    if (posture === "protective") {
      return t("p5.strategy.hero.rec.protective");
    }
    if (posture === "approval_gated") {
      var pendingIntent = (lanes.need_decision_now || [])[0];
      var familyLabel = pendingIntent
        ? t("p5.strategy.family." + pendingIntent.family) ||
          pendingIntent.family
        : "";
      return t("p5.strategy.hero.rec.approval").replace(
        "{family}",
        familyLabel,
      );
    }
    if (posture === "escalation") {
      return t("p5.strategy.hero.rec.escalation");
    }
    return t("p5.strategy.hero.rec.calm");
  },

  _getRecNarrative: function (posture, hero, calmExplanation, ctx, lanes, dp) {
    if (posture === "protective") {
      var soc = dp.current_soc;
      var threshold = dp.threshold;
      if (soc != null && threshold != null) {
        return t("p5.strategy.hero.narrative.protective")
          .replace("{soc}", String(soc))
          .replace("{threshold}", String(threshold));
      }
      return t("p5.strategy.hero.narrative.protective.noMetrics");
    }
    if (posture === "approval_gated") {
      var intent = (lanes.need_decision_now || [])[0];
      if (intent) {
        return t("p5.strategy.hero.narrative.approval")
          .replace("{title}", intent.title || "")
          .replace("{reason}", intent.reason_summary || "");
      }
      return t("p5.strategy.hero.narrative.approval")
        .replace("{title}", "")
        .replace("{reason}", "");
    }
    if (posture === "escalation") {
      if (hero.dominant_driver) {
        return t("p5.strategy.hero.narrative.escalation").replace(
          "{reason}",
          hero.dominant_driver,
        );
      }
      return t("p5.strategy.hero.narrative.escalation.default");
    }
    // calm
    if (calmExplanation && calmExplanation.detail) {
      return calmExplanation.detail;
    }
    return t("p5.strategy.hero.narrative.calm.default");
  },

  _buildRecMetrics: function (posture, dp, hero) {
    var chips = [];

    // SoC chip
    if (dp.current_soc != null) {
      var isWarn = dp.threshold != null && dp.current_soc < dp.threshold;
      chips.push(
        '<span class="p5-rec-hero__chip' +
          (isWarn ? " p5-rec-hero__chip--warn" : "") +
          '">SoC ' +
          dp.current_soc +
          "%</span>",
      );
    }

    // Threshold chip
    if (dp.threshold != null) {
      chips.push(
        '<span class="p5-rec-hero__chip">Limite ' + dp.threshold + "%</span>",
      );
    }

    // Posture badge chip
    var postureLabel = t("p5.strategy.posture." + (hero.posture || "calm"));
    chips.push(
      '<span class="p5-rec-hero__chip p5-rec-hero__chip--posture">' +
        escapeHtml(postureLabel) +
        "</span>",
    );

    // Override active indicator
    if (hero.override_active) {
      chips.push(
        '<span class="p5-rec-hero__chip p5-rec-hero__chip--warn">' +
          t("p5.strategy.strip.overrideActive") +
          "</span>",
      );
    }

    if (chips.length === 0) return "";
    return '<div class="p5-rec-hero__metrics">' + chips.join("") + "</div>";
  },

  // =========================================================
  // IMPACT STRIP (Action Model Reframe — Phase 1)
  // =========================================================

  _buildImpactStrip: function (hero, ctx, lanes) {
    var affected = this._collectAffectedStrategies(lanes);
    if (affected.length === 0) return "";

    var dp = ctx.dominant_protector || {};
    var conditionLabel = dp.family
      ? t("p5.strategy.family." + dp.family) || dp.family
      : "";

    var MAX_ROWS = 3;
    var visible = affected.slice(0, MAX_ROWS);
    var overflow = affected.length - MAX_ROWS;

    var rows = visible.map(function (intent) {
      var strategyLabel =
        t("p5.strategy.family." + intent.family) ||
        intent.title ||
        intent.family;

      var statusLabel = t("p5.strategy.impact.label").replace(
        "{strategy}",
        strategyLabel,
      );

      var causalText = conditionLabel
        ? t("p5.strategy.impact.causal").replace("{condition}", conditionLabel)
        : t("p5.strategy.impact.causal.generic");

      var recoveryText = intent.recovery_condition
        ? t("p5.strategy.impact.recovery").replace(
            "{condition}",
            intent.recovery_condition,
          )
        : "";

      return [
        '<div class="p5-impact-row">',
        '<span class="p5-impact-row__icon">\u26A0</span>',
        '<span class="p5-impact-row__label">' +
          escapeHtml(statusLabel) +
          "</span>",
        '<span class="p5-impact-row__causal">' +
          escapeHtml(causalText) +
          "</span>",
        recoveryText
          ? '<span class="p5-impact-row__recovery">' +
            escapeHtml(recoveryText) +
            "</span>"
          : "",
        "</div>",
      ].join("");
    });

    var overflowHtml =
      overflow > 0
        ? '<div class="p5-impact-more">' +
          escapeHtml(
            t("p5.strategy.impact.moreStrategies").replace(
              "{count}",
              String(overflow),
            ),
          ) +
          "</div>"
        : "";

    var mutedClass = this._isDeferred ? " p5-impact-strip--muted" : "";
    return (
      '<div class="p5-impact-strip' +
      mutedClass +
      '">' +
      rows.join("") +
      overflowHtml +
      "</div>"
    );
  },

  _collectAffectedStrategies: function (lanes) {
    var affected = [];
    var all = (lanes.platform_acting || []).concat(lanes.watch_next || []);
    for (var i = 0; i < all.length; i++) {
      var intent = all[i];
      if (
        intent.status === "suppressed" ||
        intent.status === "deferred" ||
        intent.status === "suspended"
      ) {
        affected.push(intent);
      }
    }
    return affected;
  },

  // =========================================================
  // CTA PAIR (Action Model Reframe — Phase 2)
  // =========================================================

  _buildCtaPair: function (hero, ctx, lanes) {
    var posture = hero.posture || "calm";
    var dp = ctx.dominant_protector || {};

    // Phase 13: deferred state CTA pair
    if (this._isDeferred) {
      var dc = this._deferContext;
      var intentId = dc.deferred_intent_id || "";
      return [
        '<div class="p5-cta-pair p5-cta-pair--deferred">',
        '<button class="p5-cta-primary p5-cta-primary--resume"',
        ' id="p5-cta-resume"',
        ' data-intent-id="' + escapeHtml(String(intentId)) + '">',
        escapeHtml(t("p5.strategy.cta.resume")),
        "</button>",
        '<a class="p5-cta-tertiary" id="p5-cta-tertiary-deferred" href="#hems">',
        escapeHtml(t("p5.strategy.cta.resume.secondary")),
        " \u2192",
        "</a>",
        "</div>",
      ].join("");
    }

    // Calm state: only show secondary CTA
    if (posture === "calm") {
      return [
        '<div class="p5-cta-pair p5-cta-pair--calm-only">',
        '<button class="p5-cta-secondary" id="p5-cta-secondary" data-nav="hems">',
        escapeHtml(t("p5.strategy.cta.secondary.calm")),
        " \u2192",
        "</button>",
        "</div>",
      ].join("");
    }

    // Escalation state: triple CTA layout (act now / defer / tertiary link)
    if (posture === "escalation") {
      return [
        '<div class="p5-cta-pair p5-cta-pair--escalation">',
        '<button class="p5-cta-primary p5-cta-primary--escalation"',
        ' id="p5-cta-primary"',
        ' data-posture="escalation"',
        ' data-nav="hems">',
        escapeHtml(t("p5.strategy.cta.primary.escalation")),
        " \u2192",
        "</button>",
        '<button class="p5-cta-secondary p5-cta-secondary--defer"',
        ' id="p5-cta-defer">',
        escapeHtml(t("p5.strategy.cta.defer.escalation")),
        "</button>",
        '<a class="p5-cta-tertiary" id="p5-cta-tertiary" href="#hems">',
        escapeHtml(t("p5.strategy.cta.tertiary.escalation")),
        " \u2192",
        "</a>",
        this._deferExpanded ? this._renderDeferPicker() : "",
        "</div>",
      ].join("");
    }

    // Resolve the correct API action from backend governance semantics
    var resolved = this._resolvePrimaryAction(hero, lanes);

    // Determine primary CTA label
    var primaryLabel = this._getCtaPrimaryLabel(posture, lanes);

    // Determine posture CSS modifier for primary button color
    var postureMod = posture === "approval_gated" ? "approval" : posture;

    // Determine secondary CTA label
    var secondaryLabel = t(
      "p5.strategy.cta.secondary." +
        (posture === "approval_gated" ? "approval" : posture),
    );

    // Determine secondary navigation target
    var secondaryNav = posture === "approval_gated" ? "intent-detail" : "hems";

    return [
      '<div class="p5-cta-pair">',
      '<button class="p5-cta-primary p5-cta-primary--' + postureMod + '"',
      ' id="p5-cta-primary"',
      resolved.intentId
        ? ' data-intent-id="' + escapeHtml(resolved.intentId) + '"'
        : "",
      ' data-posture="' + escapeHtml(posture) + '"',
      resolved.apiAction
        ? ' data-api-action="' + escapeHtml(resolved.apiAction) + '"'
        : "",
      ">",
      escapeHtml(primaryLabel),
      "</button>",
      '<button class="p5-cta-secondary" id="p5-cta-secondary"',
      ' data-nav="' + escapeHtml(secondaryNav) + '"',
      ">",
      escapeHtml(secondaryLabel),
      " \u2192",
      "</button>",
      "</div>",
    ].join("");
  },

  // =========================================================
  // DEFER PICKER (Phase 12)
  // =========================================================

  _renderDeferPicker: function () {
    var chips = [
      { minutes: 30, label: "30 min" },
      { minutes: 60, label: "1 h" },
      { minutes: 120, label: "2 h" },
      { minutes: 240, label: "4 h" },
    ];
    var parts = [
      '<div class="p5-defer-picker">',
      '<span class="p5-defer-picker-label">',
      escapeHtml(t("p5.strategy.defer.label")),
      "</span>",
      '<div class="p5-defer-picker__chips">',
    ];
    chips.forEach(function (c) {
      parts.push(
        '<button class="p5-defer-picker__chip" data-defer-minutes="' +
          c.minutes +
          '">' +
          c.label +
          "</button>",
      );
    });
    parts.push("</div>", "</div>");
    return parts.join("");
  },

  _executeDeferAction: async function (minutes) {
    var lanes = this._data || {};
    var dominantIntent = (lanes.need_decision_now || [])[0];
    var intentId = dominantIntent ? String(dominantIntent.id) : null;

    if (!intentId || intentId === "null" || intentId === "derived-decision") {
      if (typeof showToast === "function") {
        showToast(t("p5.strategy.defer.error"), "error");
      }
      return;
    }

    var deferUntil = new Date(Date.now() + minutes * 60000);
    var durationLabels = { 30: "30 min", 60: "1 h", 120: "2 h", 240: "4 h" };
    var durLabel = durationLabels[minutes] || minutes + " min";
    var returnTime =
      String(deferUntil.getHours()).padStart(2, "0") +
      ":" +
      String(deferUntil.getMinutes()).padStart(2, "0");

    try {
      await DataSource.p5.intentAction(intentId, "defer", {
        reason: "Operador adiou revisão via homepage",
        defer_until: deferUntil.toISOString(),
      });

      var successMsg = t("p5.strategy.defer.toast")
        .replace("{duration}", durLabel)
        .replace("{time}", returnTime);
      if (typeof showToast === "function") {
        showToast(successMsg, "success");
      }

      this._deferExpanded = false;
      this._data = await DataSource.p5.overview();
      this._reRender();
    } catch (err) {
      console.error("[StrategyPage] defer action failed:", err);
      var errorMsg = (err && err.message) || t("p5.strategy.defer.error");
      if (typeof showToast === "function") {
        showToast(errorMsg, "error");
      }
    }
  },

  // Phase 13: resume from deferred state (cancel defer, re-escalate)
  _executeResumeAction: async function () {
    var dc = this._deferContext;
    var intentId =
      dc && dc.deferred_intent_id ? String(dc.deferred_intent_id) : null;

    if (!intentId) {
      if (typeof showToast === "function") {
        showToast(t("p5.strategy.defer.resume.error"), "error");
      }
      return;
    }

    try {
      await DataSource.p5.intentAction(intentId, "escalate", {
        reason: "Operador retomou revisão via homepage",
      });

      if (typeof showToast === "function") {
        showToast(t("p5.strategy.defer.resume.toast"), "success");
      }

      this._selectedPreviewAction = null;
      this._lastDeferLabel = null;
      this._deferExpanded = false;

      this._data = await DataSource.p5.overview();
      this._reRender();
    } catch (err) {
      console.error("[StrategyPage] resume action failed:", err);
      var errorMsg =
        (err && err.message) || t("p5.strategy.defer.resume.error");
      if (typeof showToast === "function") {
        showToast(errorMsg, "error");
      }
    }
  },

  // Resolve the correct API action for the primary CTA from backend semantics
  _resolvePrimaryAction: function (hero, lanes) {
    var posture = hero.posture || "calm";
    if (posture === "calm")
      return { apiAction: null, intentId: null, posture: posture };

    var dominantIntent = (lanes.need_decision_now || [])[0];
    var intentId = dominantIntent ? String(dominantIntent.id) : null;
    var govMode = dominantIntent
      ? dominantIntent.governance_mode
      : hero.governance_mode || null;

    var apiAction = null;
    if (intentId && intentId !== "null" && intentId !== "derived-decision") {
      if (govMode === "escalate") {
        apiAction = "escalate";
      } else if (govMode === "approval_required") {
        apiAction = "approve";
      }
    }

    return { apiAction: apiAction, intentId: intentId, posture: posture };
  },

  _getCtaPrimaryLabel: function (posture, lanes) {
    if (posture === "protective") {
      return t("p5.strategy.cta.primary.protective");
    }
    if (posture === "approval_gated") {
      var intent = (lanes.need_decision_now || [])[0];
      var familyLabel = intent
        ? t("p5.strategy.family." + intent.family) || intent.family
        : "";
      return t("p5.strategy.cta.primary.approval").replace(
        "{family}",
        familyLabel,
      );
    }
    if (posture === "escalation") {
      return t("p5.strategy.cta.primary.escalation");
    }
    return "";
  },

  _handlePrimaryCtaClick: async function () {
    var btn = document.getElementById("p5-cta-primary");
    if (!btn || btn.disabled) return;

    var intentId = btn.dataset.intentId;
    var posture = btn.dataset.posture;
    var apiAction = btn.dataset.apiAction || null;
    var originalLabel = btn.textContent;

    // Show loading state
    btn.disabled = true;
    btn.textContent = t("p5.strategy.cta.loading");

    try {
      if (
        apiAction &&
        intentId &&
        intentId !== "null" &&
        intentId !== "derived-decision"
      ) {
        // Real intent exists: call the governance-correct action (approve or escalate)
        await DataSource.p5.intentAction(intentId, apiAction, {
          reason: "operator_confirmed_from_homepage",
        });
      } else {
        // Derived or no intent (protective/escalation with no real intent ID):
        // Acknowledge is a client-side confirmation only — no server call needed.
        // Brief delay to show confirmation feedback.
        await new Promise(function (resolve) {
          setTimeout(resolve, 400);
        });
      }

      // Show success state
      btn.textContent = "\u2713 " + t("p5.strategy.cta.success");
      btn.classList.add("p5-cta-primary--success");

      // Refresh after brief pause
      var self = this;
      setTimeout(async function () {
        try {
          self._data = await DataSource.p5.overview();
          var container = document.getElementById("vpp-content");
          if (container) {
            self._expandedIntent = null;
            container.innerHTML = self._buildContent();
            self._setupEventListeners();
          }
        } catch (err) {
          console.error("[StrategyPage] refresh after CTA failed:", err);
        }
      }, 1200);
    } catch (err) {
      console.error("[StrategyPage] primary CTA action failed:", err);
      btn.textContent = t("p5.strategy.cta.error");
      btn.classList.add("p5-cta-primary--error");
      // Re-enable after showing error
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = originalLabel;
        btn.classList.remove("p5-cta-primary--error");
      }, 2500);
    }
  },

  _writeHandoffContext: function () {
    var hero = (this._data || {}).hero || {};
    var ctx = (this._data || {}).context || {};
    var dp = ctx.dominant_protector || {};
    var lanes = this._data || {};
    var dominantIntent = (lanes.need_decision_now || [])[0] || null;

    if (typeof DemoStore !== "undefined") {
      DemoStore.set("p5_handoff", {
        source: "p5_strategy",
        posture: hero.posture,
        dominant_driver: hero.dominant_driver,
        active_soc: dp.current_soc || null,
        reserve_threshold: dp.threshold || null,
        active_intent_id: dominantIntent ? dominantIntent.id : null,
        timestamp: Date.now(),
      });
    }
  },

  _handleSecondaryCtaClick: function () {
    var btn = document.getElementById("p5-cta-secondary");
    if (!btn) return;

    var nav = btn.dataset.nav;
    var lanes = this._data || {};
    var dominantIntent = (lanes.need_decision_now || [])[0] || null;

    this._writeHandoffContext();

    // Navigate
    if (nav === "intent-detail" && dominantIntent) {
      // For approval-gated: expand the intent detail inline
      this._loadIntentDetail(dominantIntent.id);
    } else {
      window.location.hash = "#hems";
    }
  },

  // =========================================================
  // INTENT DETAIL PANEL (kept for approval-gated secondary CTA)
  // =========================================================

  _loadIntentDetail: async function (intentId) {
    if (String(intentId).indexOf("derived") === 0) return;

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
    detailEl.innerHTML =
      '<div class="p5-strategy-detail-loading">' +
      t("shared.loading") +
      "</div>";

    try {
      var detail = await DataSource.p5.intentDetail(intentId);
      detailEl.innerHTML = this._buildDetailContent(detail);
      this._setupDetailListeners(intentId, detail);
    } catch (err) {
      detailEl.innerHTML =
        '<div class="p5-strategy-detail-error">' +
        t("shared.apiError") +
        "</div>";
    }
  },

  _buildDetailContent: function (detail) {
    var sections = [];

    // Evidence snapshot
    if (detail.evidence_snapshot) {
      sections.push(
        this._buildKeyValueSection(
          t("p5.strategy.detail.evidence"),
          detail.evidence_snapshot,
        ),
      );
    }

    // Constraints
    if (detail.constraints) {
      sections.push(
        this._buildKeyValueSection(
          t("p5.strategy.detail.constraints"),
          detail.constraints,
        ),
      );
    }

    // Next path (4 outcomes)
    if (detail.next_path) {
      var np = detail.next_path;
      var pathHtml = [
        '<div class="p5-strategy-next-path">',
        "<h4>" + t("p5.strategy.detail.nextPath") + "</h4>",
        this._buildPathOutcome(
          t("p5.strategy.detail.ifApproved"),
          np.if_approved,
        ),
        this._buildPathOutcome(
          t("p5.strategy.detail.ifDeferred"),
          np.if_deferred,
        ),
        this._buildPathOutcome(
          t("p5.strategy.detail.ifNoAction"),
          np.if_no_action,
        ),
        np.suggested_playbook
          ? this._buildPathOutcome(
              t("p5.strategy.detail.suggestedPlaybook"),
              np.suggested_playbook,
            )
          : "",
        "</div>",
      ].join("");
      sections.push(pathHtml);
    }

    // Arbitration note
    if (detail.arbitration_note) {
      sections.push(
        '<div class="p5-strategy-arb-note"><strong>' +
          t("p5.strategy.detail.arbitration") +
          ":</strong> " +
          escapeHtml(detail.arbitration_note) +
          "</div>",
      );
    }

    // Handoff snapshot
    if (detail.handoff_snapshot) {
      sections.push(
        this._buildKeyValueSection(
          t("p5.strategy.detail.handoff"),
          detail.handoff_snapshot,
        ),
      );
    }

    // Action buttons
    if (detail.available_actions && detail.available_actions.length > 0) {
      sections.push(this._buildActionButtons(detail));
    }

    // History timeline
    if (detail.history && detail.history.length > 0) {
      sections.push(this._buildHistoryTimeline(detail.history));
    }

    return (
      '<div class="p5-strategy-detail-body">' + sections.join("") + "</div>"
    );
  },

  _buildKeyValueSection: function (title, obj) {
    var rows = Object.keys(obj)
      .map(function (k) {
        var val = obj[k];
        var displayVal =
          typeof val === "object" ? JSON.stringify(val) : String(val);
        return (
          '<tr><td class="p5-strategy-kv-key">' +
          escapeHtml(k) +
          "</td><td>" +
          escapeHtml(displayVal) +
          "</td></tr>"
        );
      })
      .join("");
    return [
      '<div class="p5-strategy-kv-section">',
      "<h4>" + title + "</h4>",
      '<table class="p5-strategy-kv-table"><tbody>' + rows + "</tbody></table>",
      "</div>",
    ].join("");
  },

  _buildPathOutcome: function (label, text) {
    if (!text) return "";
    return (
      '<div class="p5-strategy-path-item"><strong>' +
      label +
      ":</strong> " +
      escapeHtml(String(text)) +
      "</div>"
    );
  },

  _buildActionButtons: function (detail) {
    var actionConfigs = {
      approve: {
        cssClass: "btn-positive",
        label: t("p5.strategy.action.approve"),
        requireReason: false,
      },
      defer: {
        cssClass: "btn-amber",
        label: t("p5.strategy.action.defer"),
        requireReason: false,
      },
      suppress: {
        cssClass: "btn-negative",
        label: t("p5.strategy.action.suppress"),
        requireReason: true,
      },
      escalate: {
        cssClass: "btn-warning",
        label: t("p5.strategy.action.escalate"),
        requireReason: false,
      },
    };

    var buttons = detail.available_actions
      .map(function (action) {
        var cfg = actionConfigs[action] || {
          cssClass: "btn",
          label: action,
          requireReason: false,
        };
        return (
          '<button class="btn ' +
          cfg.cssClass +
          ' p5-strategy-action-btn" data-action="' +
          action +
          '" data-require-reason="' +
          cfg.requireReason +
          '">' +
          cfg.label +
          "</button>"
        );
      })
      .join("");

    return [
      '<div class="p5-strategy-actions">',
      "<h4>" + t("p5.strategy.detail.actions") + "</h4>",
      '<div class="p5-strategy-action-row">' + buttons + "</div>",
      '<div class="p5-strategy-reason-input" id="p5-reason-area" style="display:none">',
      '<textarea id="p5-reason-text" class="p5-strategy-textarea" placeholder="' +
        t("p5.strategy.reasonPlaceholder") +
        '" rows="2"></textarea>',
      '<button class="btn btn-primary p5-strategy-submit-action" id="p5-submit-action">' +
        t("p5.strategy.submitAction") +
        "</button>",
      "</div>",
      "</div>",
    ].join("");
  },

  _buildHistoryTimeline: function (history) {
    var items = history
      .map(function (entry) {
        return [
          '<div class="p5-strategy-timeline-item">',
          '<div class="p5-strategy-timeline-time">' +
            formatISODateTime(entry.timestamp || entry.created_at) +
            "</div>",
          '<div class="p5-strategy-timeline-event">' +
            escapeHtml(entry.event || entry.action || "") +
            "</div>",
          entry.detail
            ? '<div class="p5-strategy-timeline-detail">' +
              escapeHtml(entry.detail) +
              "</div>"
            : "",
          "</div>",
        ].join("");
      })
      .join("");

    return [
      '<div class="p5-strategy-history">',
      "<h4>" + t("p5.strategy.detail.history") + "</h4>",
      '<div class="p5-strategy-timeline">' + items + "</div>",
      "</div>",
    ].join("");
  },

  // =========================================================
  // CONTEXT SECTION (tidied up — less duplication)
  // =========================================================

  _buildContextSection: function (ctx, hero) {
    var parts = [];

    // Operating posture — summary-like, not dump-like
    if (ctx.operating_posture) {
      var postureObj = ctx.operating_posture;
      var overrideTypeLabels = {
        force_protective:
          t("p5.strategy.override.type.forceProtective") || "Force Protective",
        suppress_economic:
          t("p5.strategy.override.type.suppressEconomic") ||
          "Suppress Economic",
        force_approval_gate:
          t("p5.strategy.override.type.forceApprovalGate") ||
          "Force Approval Gate",
        manual_escalation_note:
          t("p5.strategy.override.type.manualEscalation") ||
          "Manual Escalation Note",
      };
      // Only show override count and type — posture is already in hero
      var postureParts = [];
      if (postureObj.active_overrides && postureObj.active_overrides > 0) {
        postureParts.push(
          "<li>" +
            (t("p5.strategy.ctx.activeOverrides") || "Active Overrides") +
            ": <strong>" +
            postureObj.active_overrides +
            "</strong></li>",
        );
      }
      if (postureObj.dominant_override_type) {
        var domLabel =
          overrideTypeLabels[postureObj.dominant_override_type] ||
          postureObj.dominant_override_type;
        postureParts.push(
          "<li>" +
            (t("p5.strategy.ctx.dominantOverrideType") || "Dominant Override") +
            ": <strong>" +
            escapeHtml(domLabel) +
            "</strong></li>",
        );
      }
      if (postureObj.scope_description) {
        postureParts.push(
          "<li>" +
            (t("p5.strategy.ctx.scopeDescription") || "Scope") +
            ": " +
            escapeHtml(String(postureObj.scope_description)) +
            "</li>",
        );
      }
      if (postureParts.length > 0) {
        parts.push(
          '<div class="p5-strategy-ctx-block"><h4>' +
            t("p5.strategy.ctx.postureSummary") +
            "</h4><ul>" +
            postureParts.join("") +
            "</ul></div>",
        );
      }
    }

    // Dominant protector — keep, nicely formatted
    if (ctx.dominant_protector) {
      var dp = ctx.dominant_protector;
      var dpHtml = '<div class="p5-strategy-kv-table">';
      if (dp.family)
        dpHtml +=
          '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' +
          t("p5.strategy.detail.family") +
          '</span><span class="p5-strategy-kv-val">' +
          escapeHtml(t("p5.strategy.family." + dp.family) || dp.family) +
          "</span></div>";
      if (dp.title)
        dpHtml +=
          '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' +
          t("p5.strategy.detail.title") +
          '</span><span class="p5-strategy-kv-val">' +
          escapeHtml(dp.title) +
          "</span></div>";
      if (dp.scope_summary)
        dpHtml +=
          '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' +
          t("p5.strategy.detail.scope") +
          '</span><span class="p5-strategy-kv-val">' +
          escapeHtml(dp.scope_summary) +
          "</span></div>";
      if (dp.governance_mode)
        dpHtml +=
          '<div class="p5-strategy-kv-row"><span class="p5-strategy-kv-key">' +
          t("p5.strategy.detail.governance") +
          '</span><span class="p5-strategy-kv-val">' +
          escapeHtml(
            t("p5.strategy.governance." + dp.governance_mode) ||
              dp.governance_mode,
          ) +
          "</span></div>";
      dpHtml += "</div>";
      parts.push(
        '<div class="p5-strategy-ctx-block"><h4>' +
          t("p5.strategy.ctx.dominantProtector") +
          "</h4>" +
          dpHtml +
          "</div>",
      );
    }

    // Recent handoffs
    if (ctx.recent_handoffs && ctx.recent_handoffs.length > 0) {
      var handoffList = ctx.recent_handoffs
        .map(function (h) {
          return (
            "<li>" +
            escapeHtml(
              typeof h === "object"
                ? h.from +
                    " \u2192 " +
                    h.to +
                    (h.reason ? " (" + h.reason + ")" : "")
                : String(h),
            ) +
            "</li>"
          );
        })
        .join("");
      parts.push(
        '<div class="p5-strategy-ctx-block"><h4>' +
          t("p5.strategy.ctx.recentHandoffs") +
          "</h4><ul>" +
          handoffList +
          "</ul></div>",
      );
    }

    // Suppressed/deferred counts
    if (ctx.suppressed_count > 0 || ctx.deferred_count > 0) {
      parts.push(
        [
          '<div class="p5-strategy-ctx-block">',
          "<h4>" + t("p5.strategy.ctx.counts") + "</h4>",
          '<div class="p5-strategy-ctx-counts">',
          "<span>" +
            t("p5.strategy.ctx.suppressed") +
            ": <strong>" +
            (ctx.suppressed_count || 0) +
            "</strong></span>",
          "<span>" +
            t("p5.strategy.ctx.deferred") +
            ": <strong>" +
            (ctx.deferred_count || 0) +
            "</strong></span>",
          "</div>",
          '<div class="p5-strategy-ctx-counts-helper">' +
            t("p5.strategy.ctx.countsHelper") +
            "</div>",
          "</div>",
        ].join(""),
      );
    }

    if (parts.length === 0) return "";

    return Components.sectionCard(
      t("p5.strategy.ctx.title"),
      '<div class="p5-strategy-context">' + parts.join("") + "</div>",
    );
  },

  // =========================================================
  // POSTURE OVERRIDE SECTION
  // =========================================================

  // Duration options for override
  // =========================================================
  // RESULT PREVIEW PANEL (Phase 5)
  // =========================================================

  _buildResultPreview: function (hero) {
    var body;
    if (!this._selectedPreviewAction) {
      body =
        '<p class="p5-preview__default">' +
        t("p5.strategy.preview.default") +
        "</p>";
    } else {
      var content = this._getPreviewContent(this._selectedPreviewAction, hero);
      var tagHtml =
        '<div class="p5-preview__tag ' +
        content.tagClass +
        '">' +
        content.tag +
        "</div>";
      var itemsHtml = '<ul class="p5-preview__items">';
      content.items.forEach(function (item) {
        itemsHtml += '<li class="p5-preview__item">' + item + "</li>";
      });
      itemsHtml += "</ul>";
      body = tagHtml + itemsHtml;
    }

    var borderClass = "";
    if (this._selectedPreviewAction) {
      var c = this._getPreviewContent(this._selectedPreviewAction, hero);
      borderClass = " " + c.borderClass;
    }

    return [
      '<div class="p5-preview' + borderClass + '" id="p5-preview">',
      '<div class="p5-preview__header">\u25B6 ' +
        t("p5.strategy.preview.title") +
        "</div>",
      '<div class="p5-preview__body" id="p5-preview-body">',
      body,
      "</div>",
      "</div>",
    ].join("");
  },

  _getPreviewContent: function (actionKey, hero) {
    switch (actionKey) {
      case "keep":
        return {
          tag: "\u2714 " + t("p5.strategy.preview.tag.decision"),
          tagClass: "p5-preview__tag--green",
          borderClass: "p5-preview--green",
          items: [
            t("p5.strategy.preview.keep.item1"),
            t("p5.strategy.preview.keep.item2"),
            t("p5.strategy.preview.keep.item3"),
            t("p5.strategy.preview.keep.item4").replace(
              "{threshold}",
              hero.soc_threshold || "30",
            ),
          ],
        };
      case "adjust":
        return {
          tag: "\u2192 " + t("p5.strategy.preview.tag.navigate"),
          tagClass: "p5-preview__tag--blue",
          borderClass: "p5-preview--blue",
          items: [
            t("p5.strategy.preview.adjust.item1"),
            t("p5.strategy.preview.adjust.item2"),
            t("p5.strategy.preview.adjust.item3"),
          ],
        };
      case "defer":
        return {
          tag: "\u23F8 " + t("p5.strategy.preview.tag.defer"),
          tagClass: "p5-preview__tag--amber",
          borderClass: "p5-preview--amber",
          items: [
            t("p5.strategy.preview.defer.item1").replace(
              "{duration}",
              this._lastDeferLabel || "",
            ),
            t("p5.strategy.preview.defer.item2"),
            t("p5.strategy.preview.defer.item3"),
            t("p5.strategy.preview.defer.item4"),
          ],
        };
      case "override":
        return {
          tag: "\u26A0 " + t("p5.strategy.preview.tag.override"),
          tagClass: "p5-preview__tag--amber",
          borderClass: "p5-preview--amber",
          items: [
            t("p5.strategy.preview.override.item1").replace(
              "{duration}",
              this._overrideDuration ? this._overrideDuration + "h" : "",
            ),
            t("p5.strategy.preview.override.item2"),
            t("p5.strategy.preview.override.item3"),
          ],
        };
      case "alert":
        return {
          tag: "\uD83D\uDD15 " + t("p5.strategy.preview.tag.alert"),
          tagClass: "p5-preview__tag--gray",
          borderClass: "p5-preview--default",
          items: [
            t("p5.strategy.preview.alert.item1").replace(
              "{duration}",
              this._alertSilenceDuration
                ? this._alertSilenceDuration + "min"
                : "",
            ),
            t("p5.strategy.preview.alert.item2"),
            t("p5.strategy.preview.alert.item3"),
          ],
        };
      default:
        return { tag: "", tagClass: "", borderClass: "", items: [] };
    }
  },

  _updatePreview: function (actionKey) {
    this._selectedPreviewAction = actionKey;
    var previewBody = document.getElementById("p5-preview-body");
    var previewContainer = document.getElementById("p5-preview");
    if (!previewBody || !previewContainer) return;

    [
      "p5-preview--green",
      "p5-preview--blue",
      "p5-preview--amber",
      "p5-preview--default",
    ].forEach(function (cls) {
      previewContainer.classList.remove(cls);
    });

    if (!actionKey) {
      previewBody.innerHTML =
        '<p class="p5-preview__default">' +
        t("p5.strategy.preview.default") +
        "</p>";
      return;
    }

    var content = this._getPreviewContent(actionKey, this._data.hero || {});
    previewContainer.classList.add(content.borderClass);

    var html =
      '<div class="p5-preview__tag ' +
      content.tagClass +
      '">' +
      content.tag +
      "</div>";
    html += '<ul class="p5-preview__items">';
    content.items.forEach(function (item) {
      html += '<li class="p5-preview__item">' + item + "</li>";
    });
    html += "</ul>";
    previewBody.innerHTML = html;
  },

  _overrideDurations: [
    { label: "30 min", minutes: 30 },
    { label: "1 hora", minutes: 60 },
    { label: "2 horas", minutes: 120 },
    { label: "4 horas", minutes: 240 },
  ],

  _buildOverrideSection: function (hero) {
    // Phase 13: hide during deferred state
    if (this._isDeferred) return "";

    // Hide when posture is calm — nothing to override
    if (hero.posture === "calm") return "";

    var expanded = this._overrideExpanded;
    var selectedDur = this._overrideDuration;

    var parts = [
      '<div class="p5-override' +
        (expanded ? " p5-override--expanded" : " p5-override--collapsed") +
        '" id="p5-override-section">',
    ];

    // Collapsed trigger
    parts.push(
      '<div class="p5-override__trigger" id="p5-override-trigger">',
      '<span class="p5-override__trigger-icon">\u26A0</span>',
      '<span class="p5-override__trigger-label">' +
        t("p5.strategy.override.staged.trigger") +
        "</span>",
      '<span class="p5-override__trigger-chevron">' +
        (expanded ? "\u25B2" : "\u25BC") +
        "</span>",
      "</div>",
    );

    // Expanded panel
    if (expanded) {
      parts.push('<div class="p5-override__panel">');

      // Duration picker
      parts.push(
        '<div class="p5-override__duration-label">' +
          t("p5.strategy.override.staged.duration.label") +
          "</div>",
        '<div class="p5-override__duration-picker">',
      );

      var self = this;
      this._overrideDurations.forEach(function (opt) {
        var isSelected = selectedDur === opt.minutes;
        parts.push(
          '<button class="p5-override__duration-chip' +
            (isSelected ? " p5-override__duration-chip--selected" : "") +
            '" data-duration="' +
            opt.minutes +
            '">' +
            opt.label +
            "</button>",
        );
      });

      parts.push("</div>");

      // Warning
      parts.push(
        '<div class="p5-override__expiry-note">' +
          t("p5.strategy.override.staged.warning") +
          "</div>",
      );

      // Confirm button — only visible after duration selection
      if (selectedDur !== null) {
        var durLabel = "";
        this._overrideDurations.forEach(function (opt) {
          if (opt.minutes === selectedDur) durLabel = opt.label;
        });
        parts.push(
          '<button class="p5-override__confirm" id="p5-override-confirm">' +
            t("p5.strategy.override.staged.confirm").replace(
              "{duration}",
              durLabel,
            ) +
            "</button>",
        );
      }

      parts.push("</div>"); // end panel
    }

    parts.push("</div>"); // end section

    return parts.join("");
  },

  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  _setupEventListeners: function () {
    var self = this;

    // CTA pair (Phase 2)
    var primaryCta = document.getElementById("p5-cta-primary");
    if (primaryCta) {
      primaryCta.addEventListener("click", function () {
        // Escalation primary CTA navigates to HEMS instead of calling API
        if (primaryCta.dataset.nav === "hems") {
          self._updatePreview("adjust");
          self._writeHandoffContext();
          window.location.hash = "#hems";
          return;
        }
        self._updatePreview("keep");
        self._handlePrimaryCtaClick();
      });
    }

    var secondaryCta = document.getElementById("p5-cta-secondary");
    if (secondaryCta) {
      secondaryCta.addEventListener("click", function () {
        self._updatePreview("adjust");
        self._handleSecondaryCtaClick();
      });
    }

    // Defer button (escalation triple CTA — Phase 12)
    var deferBtn = document.getElementById("p5-cta-defer");
    if (deferBtn) {
      deferBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        self._deferExpanded = !self._deferExpanded;
        self._reRender();
      });
    }

    // Resume button (deferred state — Phase 13)
    var resumeBtn = document.getElementById("p5-cta-resume");
    if (resumeBtn) {
      resumeBtn.addEventListener("click", function () {
        self._executeResumeAction();
      });
    }

    // Defer duration chip selection (Phase 12)
    var deferPicker = document.querySelector(".p5-defer-picker");
    if (deferPicker) {
      deferPicker.addEventListener("click", function (e) {
        e.stopPropagation();
        var chip = e.target.closest("[data-defer-minutes]");
        if (!chip) return;
        var minutes = parseInt(chip.dataset.deferMinutes, 10);
        self._lastDeferLabel = chip.textContent.trim();
        self._updatePreview("defer");
        self._executeDeferAction(minutes);
      });
    }

    // Click outside to collapse defer picker (Phase 12)
    if (this._deferExpanded) {
      this._deferOutsideHandler = function (e) {
        var picker = document.querySelector(".p5-defer-picker");
        var btn = document.getElementById("p5-cta-defer");
        if (
          picker &&
          !picker.contains(e.target) &&
          btn &&
          !btn.contains(e.target)
        ) {
          self._deferExpanded = false;
          document.removeEventListener("click", self._deferOutsideHandler);
          self._reRender();
        }
      };
      document.addEventListener("click", this._deferOutsideHandler);
    }

    // Tertiary link handoff context (escalation triple CTA)
    var tertiaryCta = document.getElementById("p5-cta-tertiary");
    if (tertiaryCta) {
      tertiaryCta.addEventListener("click", function () {
        self._writeHandoffContext();
      });
    }

    // Override staged confirmation — expand/collapse trigger
    var overrideTrigger = document.getElementById("p5-override-trigger");
    if (overrideTrigger) {
      overrideTrigger.addEventListener("click", function () {
        self._handleOverrideExpand();
      });
    }

    // Override duration chip selection
    document
      .querySelectorAll(".p5-override__duration-chip")
      .forEach(function (chip) {
        chip.addEventListener("click", function (e) {
          e.stopPropagation();
          var minutes = parseInt(chip.dataset.duration, 10);
          self._overrideDuration = minutes;
          self._updatePreview("override");
          self._reRender();
        });
      });

    // Override confirm button
    var overrideConfirm = document.getElementById("p5-override-confirm");
    if (overrideConfirm) {
      overrideConfirm.addEventListener("click", function (e) {
        e.stopPropagation();
        self._handleOverrideConfirm();
      });
    }

    // Alert control — expand/collapse trigger
    var alertTrigger = document.getElementById("p5-alert-control-trigger");
    if (alertTrigger) {
      alertTrigger.addEventListener("click", function () {
        self._alertSilenceExpanded = !self._alertSilenceExpanded;
        if (!self._alertSilenceExpanded) {
          self._alertSilenceDuration = null;
        }
        self._reRender();
      });
    }

    // Alert control — duration chip selection
    document
      .querySelectorAll(".p5-alert-control__duration-chip")
      .forEach(function (chip) {
        chip.addEventListener("click", function (e) {
          e.stopPropagation();
          var minutes = parseInt(chip.dataset.alertDuration, 10);
          self._alertSilenceDuration = minutes;
          self._updatePreview("alert");
          self._reRender();
        });
      });

    // Alert control — confirm button
    var alertConfirm = document.getElementById("p5-alert-control-confirm");
    if (alertConfirm) {
      alertConfirm.addEventListener("click", function (e) {
        e.stopPropagation();
        self._handleAlertSilenceConfirm();
      });
    }

    // Click outside override/alert sections to collapse (attach once)
    if (!this._overrideOutsideClickBound) {
      this._overrideOutsideClickBound = true;
      document.addEventListener("click", function (e) {
        var changed = false;
        if (
          self._overrideExpanded &&
          !e.target.closest("#p5-override-section")
        ) {
          self._overrideExpanded = false;
          self._overrideDuration = null;
          changed = true;
        }
        if (
          self._alertSilenceExpanded &&
          !e.target.closest("#p5-alert-control-section")
        ) {
          self._alertSilenceExpanded = false;
          self._alertSilenceDuration = null;
          changed = true;
        }
        if (changed) self._reRender();
      });
    }
  },

  _setupDetailListeners: function (intentId, detail) {
    var self = this;
    var detailEl = document.getElementById("p5-detail-" + intentId);
    if (!detailEl) return;

    var pendingAction = null;

    detailEl
      .querySelectorAll(".p5-strategy-action-btn")
      .forEach(function (btn) {
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

  _handleOverrideExpand: function () {
    this._overrideExpanded = !this._overrideExpanded;
    if (!this._overrideExpanded) {
      this._overrideDuration = null;
    }
    this._reRender();
  },

  _handleOverrideConfirm: async function () {
    if (this._overrideDuration === null) return;

    var confirmBtn = document.getElementById("p5-override-confirm");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = t("p5.strategy.override.staged.loading");
    }

    var durLabel = "";
    var selectedMin = this._overrideDuration;
    this._overrideDurations.forEach(function (opt) {
      if (opt.minutes === selectedMin) durLabel = opt.label;
    });

    var payload = {
      override_type: "suppress_economic",
      reason: "operator_override_from_homepage",
      duration_minutes: this._overrideDuration,
      scope_gateway_ids: [],
    };

    try {
      await DataSource.p5.createOverride(payload);

      // Show success toast
      var successMsg = t("p5.strategy.override.staged.success").replace(
        "{time}",
        durLabel,
      );
      if (typeof showToast === "function") {
        showToast(successMsg, "success");
      }

      // Reset state and refresh
      this._overrideExpanded = false;
      this._overrideDuration = null;
      this._data = await DataSource.p5.overview();
      this._reRender();
    } catch (err) {
      console.error("[StrategyPage] override confirm failed:", err);
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = t("p5.strategy.override.staged.error");
        confirmBtn.classList.add("p5-override__confirm--error");
      }
      // Allow retry after 2s
      setTimeout(function () {
        if (confirmBtn) {
          confirmBtn.classList.remove("p5-override__confirm--error");
          var retryLabel = t("p5.strategy.override.staged.confirm").replace(
            "{duration}",
            durLabel,
          );
          confirmBtn.textContent = retryLabel;
        }
      }, 2000);
    }
  },

  // =========================================================
  // ALERT CONTROL SECTION (Phase 4)
  // =========================================================

  _alertSilenceDurations: [
    { label: "30 min", minutes: 30 },
    { label: "1 hora", minutes: 60 },
    { label: "2 horas", minutes: 120 },
    { label: "4 horas", minutes: 240 },
  ],

  _buildAlertControl: function (hero) {
    // Always available except during calm with no activity
    if (hero.posture === "calm") return "";

    var expanded = this._alertSilenceExpanded;
    var selectedDur = this._alertSilenceDuration;

    var parts = [
      '<div class="p5-alert-control' +
        (expanded ? " p5-alert-control--expanded" : "") +
        '" id="p5-alert-control-section">',
    ];

    // Collapsed trigger — small text link with bell-slash icon
    parts.push(
      '<div class="p5-alert-control__trigger" id="p5-alert-control-trigger">',
      '<span class="p5-alert-control__trigger-icon">\uD83D\uDD15</span>',
      '<span class="p5-alert-control__trigger-label">' +
        t("p5.strategy.alert.silence.trigger") +
        "</span>",
      '<span class="p5-alert-control__trigger-chevron">' +
        (expanded ? "\u25B2" : "\u25BC") +
        "</span>",
      "</div>",
    );

    // Expanded panel
    if (expanded) {
      parts.push('<div class="p5-alert-control__panel">');

      // Duration picker
      parts.push(
        '<div class="p5-alert-control__duration-label">' +
          t("p5.strategy.alert.silence.duration.label") +
          "</div>",
        '<div class="p5-alert-control__duration-picker">',
      );

      this._alertSilenceDurations.forEach(function (opt) {
        var isSelected = selectedDur === opt.minutes;
        parts.push(
          '<button class="p5-alert-control__duration-chip' +
            (isSelected ? " p5-alert-control__duration-chip--selected" : "") +
            '" data-alert-duration="' +
            opt.minutes +
            '">' +
            opt.label +
            "</button>",
        );
      });

      parts.push("</div>");

      // Warning note
      parts.push(
        '<div class="p5-alert-control__expiry-note">' +
          t("p5.strategy.alert.silence.warning") +
          "</div>",
      );

      // Confirm button — only after duration selection
      if (selectedDur !== null) {
        var durLabel = "";
        this._alertSilenceDurations.forEach(function (opt) {
          if (opt.minutes === selectedDur) durLabel = opt.label;
        });
        parts.push(
          '<button class="p5-alert-control__confirm" id="p5-alert-control-confirm">' +
            t("p5.strategy.alert.silence.confirm").replace(
              "{duration}",
              durLabel,
            ) +
            "</button>",
        );
      }

      parts.push("</div>"); // end panel
    }

    parts.push("</div>"); // end section

    return parts.join("");
  },

  _handleAlertSilenceConfirm: async function () {
    if (this._alertSilenceDuration === null) return;

    var confirmBtn = document.getElementById("p5-alert-control-confirm");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = t("p5.strategy.alert.silence.loading");
    }

    var durLabel = "";
    var selectedMin = this._alertSilenceDuration;
    this._alertSilenceDurations.forEach(function (opt) {
      if (opt.minutes === selectedMin) durLabel = opt.label;
    });

    var payload = {
      override_type: "suppress_alerts",
      reason: "operator_silenced_alerts_from_homepage",
      duration_minutes: this._alertSilenceDuration,
      scope_gateway_ids: [],
    };

    try {
      await DataSource.p5.createOverride(payload);

      // Show success toast
      var successMsg = t("p5.strategy.alert.silence.success").replace(
        "{duration}",
        durLabel,
      );
      if (typeof showToast === "function") {
        showToast(successMsg, "success");
      }

      // Reset state and refresh
      this._alertSilenceExpanded = false;
      this._alertSilenceDuration = null;
      this._data = await DataSource.p5.overview();
      this._reRender();
    } catch (err) {
      console.error("[StrategyPage] alert silence failed:", err);
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = t("p5.strategy.alert.silence.error");
        confirmBtn.classList.add("p5-alert-control__confirm--error");
      }
      // Allow retry after 2s
      setTimeout(function () {
        if (confirmBtn) {
          confirmBtn.classList.remove("p5-alert-control__confirm--error");
          var retryLabel = t("p5.strategy.alert.silence.confirm").replace(
            "{duration}",
            durLabel,
          );
          confirmBtn.textContent = retryLabel;
        }
      }, 2000);
    }
  },

  // Phase 14: clear defer countdown timer
  _clearDeferTimer: function () {
    if (this._deferTimerId) {
      clearInterval(this._deferTimerId);
      this._deferTimerId = null;
    }
  },

  // Phase 14: start defer countdown timer (auto-refresh on expiry)
  _startDeferTimer: function () {
    this._clearDeferTimer();

    if (!this._isDeferred) return;

    var self = this;
    var deferUntilMs = new Date(this._deferContext.defer_until).getTime();

    this._deferTimerId = setInterval(function () {
      var remaining = deferUntilMs - Date.now();

      if (remaining <= 0) {
        // Defer expired — auto-refresh once
        self._clearDeferTimer();
        self._previousDeferContext = self._deferContext;
        self._autoRefreshAfterDefer();
        return;
      }

      // Update countdown display without full re-render
      var countdownEl = document.querySelector(".p5-hero-countdown");
      if (countdownEl) {
        var countdown = self._formatCountdown(self._deferContext.defer_until);
        if (countdown) {
          countdownEl.textContent = t(
            "p5.strategy.hero.deferred.countdown",
          ).replace("{countdown}", countdown);
        }
      }
    }, 30000);
  },

  // Phase 14: fetch fresh overview after defer expiry
  _autoRefreshAfterDefer: async function () {
    try {
      this._data = await DataSource.p5.overview();
      this._reRender();
    } catch (err) {
      console.error(
        "[StrategyPage] auto-refresh after defer expiry failed:",
        err,
      );
    }
  },

  _reRender: function () {
    var container = document.getElementById("vpp-content");
    if (container) {
      container.innerHTML = this._buildContent();
      this._setupEventListeners();
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
