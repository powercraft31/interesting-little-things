# DESIGN-v6.5-P5-Polish-R2-Backend-Closure-1.0

## Status
Design 1.0 — aligned against REQ-v6.5-P5-Polish-R2-Backend-Closure-0.1.

---

## Scope

This document defines the precise backend read model fixes needed to close the P5 homepage semantic gap identified in Polish R2. All changes target the existing overview handler, with minimal adjustments to the strategy evaluator's arbitration output. No new tables, endpoints, or schema changes.

---

## D1. `calm_explanation` Gate

### Current behavior (`get-p5-overview.ts:191-224`)
`calm_explanation` is generated when `needDecisionNow.length === 0 && platformActing.length === 0`. This condition does NOT account for `escalate + active` intents. Result: escalation posture can co-exist with `calm_explanation.reason = no_conditions_detected`.

### Root cause
The calm gate checks only two lanes (approval_required, auto_governed) but ignores the third category — `escalate + active` intents — which are not assigned to any lane in the current partition logic (lines 130-140).

### Fix specification

Replace the calm gate condition at line 192:

**Current:**
```typescript
if (needDecisionNow.length === 0 && platformActing.length === 0)
```

**New:**
```typescript
if (posture === "calm")
```

This is the only correct gate: `calm_explanation` should exist **if and only if** the resolved posture is `calm`. The posture computation (lines 147-156) already accounts for all intent categories including escalation. Tying the gate to posture rather than lane counts makes the contract self-consistent by construction.

### Behavioral contract
| Posture | `calm_explanation` |
|---------|-------------------|
| `calm` | Non-null (with appropriate reason) |
| `approval_gated` | `null` |
| `protective` | `null` |
| `escalation` | `null` |

---

## D2. `governance_summary` Rewrite

### Current behavior (`get-p5-overview.ts:164-184`)
`governance_summary` is assembled from three lane counts: `needDecisionNow`, `platformActing`, `watchNext`. Since `escalate + active` intents are not placed in any lane, they contribute nothing to the summary. When only escalated intents exist, the summary reads `"No active strategy intents"`.

### Root cause
The summary generator only iterates over lane populations. Escalated intents fall outside all three lanes.

### Fix specification

Rewrite the summary generation block (lines 164-184) to be posture-driven rather than lane-count-driven:

**New logic (pseudo-code):**
```
escalateActive = resolvedIntents.filter(mode=escalate, status=active)

summaryParts = []

if escalateActive.length > 0:
  summaryParts.push("{n} intent(s) requiring operator arbitration")

if needDecisionNow.length > 0:
  summaryParts.push("{n} intent(s) awaiting approval")

if platformActing.length > 0:
  summaryParts.push("{n} auto-governed")

if watchNext.length > 0:
  summaryParts.push("{n} under observation")

governance_summary = summaryParts.join(", ")
  || "No active strategy intents"
```

### Key change
The `escalateActive` count is computed **before** the lane counts and placed **first** in the summary string. This ensures escalation posture never produces an empty/calm summary.

### Examples

| Scenario | Intents | governance_summary |
|----------|---------|-------------------|
| Calm (no intents) | none | `"No active strategy intents"` |
| Single approval_required | 1 peak_shaving active | `"1 intent awaiting approval"` |
| Protective only | 1 reserve_protection auto_governed | `"1 auto-governed"` |
| Escalation only | 2 escalate+active (scope collision) | `"2 intents requiring operator arbitration"` |
| Mixed: escalation + approval | 1 escalate + 1 approval_required | `"1 intent requiring operator arbitration, 1 intent awaiting approval"` |
| Mixed: protective + watch | 1 auto_governed + 1 observe | `"1 auto-governed, 1 under observation"` |

---

## D3. Triage Lane Allocation for Escalate Intents

### Current behavior (`get-p5-overview.ts:130-140`)
Lane partition rules:
- `need_decision_now`: `approval_required + active`
- `platform_acting`: `auto_governed + active`
- `watch_next`: `observe + active` OR `deferred`

`escalate + active` intents match **none** of these filters.

### Analysis: where should `escalate + active` go?

The REQ suggests `need_decision_now`. Evaluation:

| Option | Lane | Pros | Cons |
|--------|------|------|------|
| A | `need_decision_now` | Matches `operator_action_needed=true`; operator sees it where they act | Mixes "approve this" with "arbitrate this" — different action types |
| B | New `escalation` lane | Clean semantic separation | Breaks the existing 3-lane contract; frontend must add a 4th lane |
| C | `need_decision_now` with a distinguishing field | Operator sees it; card can render differently | Minimal contract change; frontend can style differently if desired |

### Decision: Option C — `need_decision_now` with semantic distinction

`escalate + active` intents go into `need_decision_now`. The `governance_mode` field on each `IntentCard` already carries `"escalate"`, which the frontend can use to render these cards with an escalation-specific appearance. This avoids breaking the 3-lane contract while ensuring escalated intents are never invisible.

### Updated lane partition rules

```typescript
// need_decision_now: intents that require operator action
const needDecisionNow = resolvedIntents.filter(
  (i) =>
    i.status === "active" &&
    (i.governance_mode === "approval_required" || i.governance_mode === "escalate")
);

// platform_acting: auto-governed protective intents
const platformActing = resolvedIntents.filter(
  (i) => i.governance_mode === "auto_governed" && i.status === "active"
);

// watch_next: observe-only or deferred
const watchNext = resolvedIntents.filter(
  (i) =>
    (i.governance_mode === "observe" && i.status === "active") ||
    i.status === "deferred"
);
```

### Full lane partition matrix

| governance_mode | status | Lane |
|----------------|--------|------|
| `approval_required` | `active` | `need_decision_now` |
| `escalate` | `active` | `need_decision_now` |
| `auto_governed` | `active` | `platform_acting` |
| `observe` | `active` | `watch_next` |
| any | `deferred` | `watch_next` |
| any | `suppressed` | (not in lanes; counted in `context.suppressed_count`) |
| any | `escalated` | (terminal; may appear in `context.recent_handoffs`) |
| any | `expired` | (not in lanes) |

---

## D4. Arbitration Outcome → Homepage-Ready State

### Current behavior (`strategy-evaluator.ts:515-577`)
The `arbitrate()` function produces `ArbitratedIntent[]` where dominated intents keep `status: "active"` but receive an `arbitration_note` (e.g., `"Dominated by reserve_protection (protective > economic). Deferred."`). The text says "Deferred" but the status field remains `"active"`.

### Problem
The overview handler's lane partition uses `status` and `governance_mode` to assign intents to lanes. A dominated intent with `status: "active"` and `governance_mode: "approval_required"` lands in `need_decision_now` — even though it has been effectively suppressed by a protective intent. This creates a misleading homepage: the operator sees a "needs approval" card for an intent that the platform has already overridden.

### Decision: Option (a) — Change evaluator to set explicit status

The fix belongs in `strategy-evaluator.ts` `arbitrate()`, not in the overview handler.

**Rationale:**
- The arbitration outcome IS the status decision. If an intent is dominated, the evaluator knows it and should express it in the status field.
- Having the overview handler parse `arbitration_note` text to infer status would be fragile and duplicate decision logic in M5.
- Setting an explicit status at arbitration time keeps the homepage handler a pure projection layer.

### Exact change

In `strategy-evaluator.ts` `arbitrate()` function (lines 549-559), where a dominated intent gets an `arbitration_note`:

**Current (line 558):**
```typescript
results[loseIdx] = {
  ...loser,
  arbitration_note: `Dominated by ${winner.family} (protective > economic). Deferred.`,
};
```

**New:**
```typescript
results[loseIdx] = {
  ...loser,
  status: "deferred" as const,
  arbitration_note: `Dominated by ${winner.family} (protective > economic). Deferred.`,
};
```

Similarly, for urgency-based losers (lines 568-571):

**Current:**
```typescript
results[loseIdx] = {
  ...loser,
  arbitration_note: `Lower urgency than competing intent on same scope.`,
};
```

**New:**
```typescript
results[loseIdx] = {
  ...loser,
  status: "deferred" as const,
  arbitration_note: `Lower urgency than competing intent on same scope. Deferred.`,
};
```

### Type adjustment

The `ArbitratedIntent` interface (line 496-498) currently types status as `"active" | "suppressed"`. Add `"deferred"`:

```typescript
interface ArbitratedIntent extends GovernedCondition {
  readonly arbitration_note: string | null;
  readonly status: "active" | "suppressed" | "deferred";
}
```

### Effect on homepage

Dominated intents now have `status: "deferred"`, so they:
- Are excluded from `need_decision_now` (requires `status === "active"`)
- Appear in `watch_next` (matches `status === "deferred"`)
- Are counted in `context.deferred_count`
- Carry their `arbitration_note` for frontend display

This makes the homepage truthful: the operator sees dominated intents in the observation lane, not the action lane.

---

## D5. `platform_acting` Representation

### Current rule (`get-p5-overview.ts:133-135`)
```typescript
const platformActing = resolvedIntents.filter(
  (i) => i.governance_mode === "auto_governed" && i.status === "active"
);
```

Only `auto_governed + active` intents appear here.

### REQ requirement (R4)
> If protective logic / override / dominant protector is actively influencing strategy decisions, the homepage must make this visible in `platform_acting`.

### Analysis

The current rule is **sufficient** for auto-governed intents themselves. The issue identified in R4 is different: when a `force_protective` override is active, the *effect* of that override (suppressing economic intents, constraining governance) is not visible in `platform_acting` because the override itself is not an intent.

However, the override effect IS already visible through:
1. `hero.override_active = true` (line 185)
2. `context.operating_posture.dominant_override_type` (line 247)
3. The posture-resolver already modifies intent governance_modes in response to overrides

### Decision: No change to the `platform_acting` filter

The lane filter stays as-is: `auto_governed + active`. The override visibility gap is handled by:

1. **The existing frontend derived card logic** (`_injectDerivedCards` line 89-92): if `override_active && platformActing.length === 0`, a derived card is injected. This is the correct fallback.
2. **The D2 governance_summary rewrite**: the summary now accurately describes what the platform is doing.
3. **The context rail**: `dominant_protector` and `operating_posture` already carry the override/protector details.

The frontend derived card for this case should transition from "primary workaround" to "edge-case fallback" once D1-D4 are implemented. The main scenarios where all three real lanes would be empty with an override active will be much rarer — the override's effect on intents will surface naturally through the corrected lane partition (D3) and arbitration status (D4).

### One enhancement: protective intents with arbitration context

When a `reserve_protection` intent is `auto_governed + active` AND it has dominated other intents (D4 gives them `status: deferred`), the `platform_acting` card already shows the protector. The `arbitration_note` on the dominated deferred intents in `watch_next` provides the causal link. No additional backend change is needed.

---

## D6. Frontend Alignment

### Changes needed after D1-D5

#### 6a. `calm_explanation` rendering (`p5-strategy.js:209-220`)
**No change needed.** The frontend already renders `calm_explanation` only when it's non-null. The fix is entirely backend (D1): the backend will send `null` for non-calm postures. The frontend code is already correct.

#### 6b. `governance_summary` display (`p5-strategy.js:266-277`)
**No change needed.** The frontend renders `hero.governance_summary` as the secondary narrative line. The fix is in the backend (D2): the summary string itself will now be accurate. The frontend display logic is already correct.

#### 6c. `need_decision_now` lane — escalation cards (`p5-strategy.js:344-381`)
**Minimal change.** Escalate intents will now appear in `need_decision_now` (D3). The existing `_buildIntentCard` function renders `governance_mode` as a badge. The frontend should:

1. Add an `escalate` variant to the governance badge styling in `pages.css`:
   ```css
   .p5-strategy-badge-governance[data-mode="escalate"] { ... }
   ```
   Or, since the badge text comes from `t("p5.strategy.governance.escalate")`, ensure that i18n key exists.

2. Verify that `i18n.js` has a translation for `p5.strategy.governance.escalate`. If missing, add it.

**Estimated scope:** 2-3 lines in CSS, 1 i18n key addition.

#### 6d. Derived cards (`p5-strategy.js:83-93`)
**Simplification possible but not required.** After D1-D4:
- The scenario where `hero.operator_action_needed=true` but `need_decision_now` is empty will be eliminated (D3 ensures escalated intents populate the lane).
- The derived decision card (`_buildDerivedDecisionCard`) should still fire as a defensive fallback, but it will rarely trigger.

**Recommendation:** Keep `_injectDerivedCards` as-is for defensive robustness. Do not remove it in this round. It becomes a true safety net rather than a primary workaround.

#### 6e. `watch_next` lane — deferred dominated intents
**No change needed.** Dominated intents will now appear in `watch_next` with `status: "deferred"` and an `arbitration_note` explaining why. The existing card renderer already shows `reason_summary` and the status badge.

#### 6f. Summary of frontend changes

| File | Change | Lines affected |
|------|--------|---------------|
| `frontend-v2/js/i18n.js` | Ensure `p5.strategy.governance.escalate` key exists | ~1 line |
| `frontend-v2/css/pages.css` | Optional: escalation badge color | ~3 lines |
| `frontend-v2/js/p5-strategy.js` | No structural changes needed | 0 lines |

---

## D7. Test Plan

### Existing tests (must not regress)
All 4 existing tests in `backend/test/bff/p5-overview.test.ts` must continue to pass.

### New test cases

#### T1. Escalation posture → `calm_explanation` is null
```
Scenario: "escalation posture does not produce calm_explanation"
Mock setup:
  - 2 intents: governance_mode=escalate, status=active (scope collision)
Expected:
  - hero.posture = "escalation"
  - calm_explanation = null
  - hero.operator_action_needed = true
```

#### T2. Escalation posture → `governance_summary` is meaningful
```
Scenario: "escalation posture produces meaningful governance_summary"
Mock setup:
  - 2 intents: governance_mode=escalate, status=active
Expected:
  - hero.governance_summary contains "requiring operator arbitration"
  - hero.governance_summary does NOT equal "No active strategy intents"
```

#### T3. Escalate+active intents populate `need_decision_now`
```
Scenario: "escalate active intents appear in need_decision_now lane"
Mock setup:
  - 1 intent: governance_mode=escalate, status=active
Expected:
  - need_decision_now.length >= 1
  - need_decision_now[0].governance_mode = "escalate"
```

#### T4. Mixed escalation + approval_required
```
Scenario: "mixed escalation and approval intents both appear in need_decision_now"
Mock setup:
  - 1 intent: governance_mode=escalate, status=active
  - 1 intent: governance_mode=approval_required, status=active
Expected:
  - need_decision_now.length = 2
  - hero.posture = "escalation" (escalation takes precedence)
  - hero.operator_action_needed = true
```

#### T5. Dominated intent gets deferred status
```
Scenario: "dominated economic intent appears in watch_next as deferred"
Mock setup:
  - 1 intent: family=reserve_protection, governance_mode=auto_governed, status=active
  - 1 intent: family=peak_shaving, governance_mode=approval_required, status=deferred,
             arbitration_note="Dominated by reserve_protection..."
Expected:
  - platform_acting.length = 1 (reserve_protection)
  - watch_next contains the peak_shaving intent
  - need_decision_now does NOT contain the peak_shaving intent
  - hero.posture = "protective"
```

#### T6. Protective dominance → platform_acting visible
```
Scenario: "auto_governed protective intent appears in platform_acting"
Mock setup:
  - 1 intent: family=reserve_protection, governance_mode=auto_governed, status=active
  - 1 intent: family=tariff_arbitrage, governance_mode=approval_required, status=deferred,
             arbitration_note="Dominated by reserve_protection..."
Expected:
  - platform_acting.length = 1
  - platform_acting[0].family = "reserve_protection"
  - context.dominant_protector is not null
  - hero.posture = "protective"
  - calm_explanation = null
```

#### T7. Approval_gated posture → `calm_explanation` is null
```
Scenario: "approval_gated posture does not produce calm_explanation"
Mock setup:
  - 1 intent: governance_mode=approval_required, status=active
Expected:
  - hero.posture = "approval_gated"
  - calm_explanation = null
```

#### T8. Protective posture → `calm_explanation` is null
```
Scenario: "protective posture does not produce calm_explanation"
Mock setup:
  - 1 intent: governance_mode=auto_governed, status=active
Expected:
  - hero.posture = "protective"
  - calm_explanation = null
```

### Strategy evaluator test cases (new file or extend existing)

#### T9. Arbitration: dominated intent gets status=deferred
```
Scenario: "arbitrate() sets status=deferred on dominated intent"
Setup:
  - 2 GovernedCondition: reserve_protection + peak_shaving, overlapping scope
Expected:
  - reserve_protection: status=active
  - peak_shaving: status=deferred
  - peak_shaving.arbitration_note contains "Dominated"
```

#### T10. Arbitration: urgency loser gets status=deferred
```
Scenario: "arbitrate() sets status=deferred on lower urgency intent"
Setup:
  - 2 GovernedCondition: same priority family, different urgency, overlapping scope
Expected:
  - higher urgency: status=active
  - lower urgency: status=deferred
```
