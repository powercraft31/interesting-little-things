# REQ-v6.5-P5-Action-Model-Reframe-0.1

## Status
Draft 0.1b — amended to incorporate the escalation review-later model discovered through runtime validation on 2026-03-23. Supersedes 0.1a (backend prerequisites). Original draft stabilized after product debate plus standalone mock validation across R1 / R2 / R2.5 / R3.

## Purpose
This document defines the **homepage action-model reframe** for P5 Strategy Triggers.

It does **not** replace the full product definition in `REQ-v6.5-P5-Strategy-Triggers-1.0.md`.
Instead, it corrects one specific but critical layer:

**how the P5 homepage asks the operator to act.**

The reframe exists because the previous homepage action grammar was still too close to:
- workflow verbs
- ticket handling
- governance-state exposure

and not yet close enough to:
- operator decision-making
- platform recommendation acceptance
- manual adjustment entry
- clearly separated risk / alert controls

---

## Problem Statement
P5's strategic positioning is already correct:
- P5 is the governed trigger layer
- P5 is event-initiated strategy entry
- P4 is manual orchestration / human-initiated execution entry

However, the homepage interaction contract was still semantically unstable.

### Observed mismatch
The homepage exposed actions that read too much like internal workflow or governance mechanics:
- approve
- defer
- suppress
- escalate

This created four product problems:

1. **The operator had to understand internal workflow semantics before understanding what to do.**
2. **Different interaction types were mixed together as peer actions.**
3. **The homepage looked closer to a ticket workflow screen than a decision gate.**
4. **`escalate` was semantically weak because it did not represent a true handoff target on the homepage layer.**

### Key correction
The homepage must stop asking:
- “Which governance verb do you want to apply?”

and instead ask:
- **”Do you accept the platform's current recommendation, or do you need to adjust manually?”**

### Refined understanding (0.1b)
The two-path model above is correct for most postures. However, for **escalation-class conditions** — where the platform cannot resolve the issue automatically and manual intervention is recommended — a strict binary of “accept” vs “adjust now” is insufficient.

Runtime testing revealed that a real operator facing an escalation needs a legitimate **third decision path**: **”not now — remind me later.”** The homepage remains a single-decision cockpit, but for escalation it must support three valid operator decisions:

1. **Act now** — open HEMS and adjust manually
2. **Review later** — formally defer the issue for a bounded window
3. **Override / advanced controls** — available where applicable

Homepage simplicity must be preserved while still respecting this real operator judgment pattern.

---

## Product Decision
P5 homepage is a **single-decision operator cockpit**, not an action gallery.

For any surfaced dominant condition, the homepage must first answer four questions in operator language:

1. What is the platform recommending right now?
2. Why is it recommending that?
3. What downstream strategy impact does that recommendation cause?
4. If the operator disagrees, where do they go next?

### Core homepage question
For the dominant surfaced situation, the homepage should reduce the operator's first decision to:

**Accept the platform recommendation**
vs
**Go adjust manually**

All other controls are secondary and must be clearly typed, not mixed into the same main action cluster.

---

## Why Pure Acknowledgement Is Insufficient

The original action model used `Reconhecer situação` ("Acknowledge situation") as the primary CTA for escalation posture. Runtime validation exposed why this is a product-level error:

1. **Acknowledge does not meaningfully change system state.** The operator clicks a button, but neither the platform posture nor the underlying condition changes. This is not a decision — it is a gesture.

2. **If the underlying condition remains unchanged, the system regenerates an equivalent escalation intent on the next evaluation cycle.** The operator acknowledged something, but the homepage immediately presents the same unresolved problem at the same intensity. This creates a frustrating loop that trains the operator to ignore escalations.

3. **The homepage forces a false binary.** Without a review-later path, the operator's only choices are "act now" (open HEMS) or "keep being loudly red forever." Real operators sometimes legitimately decide: "I see this, I understand it, but I will deal with it in 30 minutes." That decision must be formally supported.

4. **Repeatedly regenerating fresh equivalent escalation intents breaks operator trust.** When the operator sees the same issue reappear as if it were new, the homepage feels unreliable — like a fire alarm that re-triggers after you check and confirm the building is not on fire.

The correct product model replaces acknowledge with a real operator decision: **review later / skip for now**, with a time boundary and proper system behavior during the deferral window.

---

## Escalation Review-Later Requirement

For escalation-class conditions, the homepage must support a **review later / skip for now** operator decision alongside the existing act-now and override paths.

### Review-later decision semantics
- The operator has assessed the escalation and decided: "not now."
- This is a **formal, recorded decision**, not an absence of action.
- The system must treat it as a legitimate third path, not as ignoring the problem.

### Time-bounded deferral
- Every review-later decision must carry a **time boundary**.
- The homepage must offer duration presets: **30 min / 1h / 2h / 4h**.
- The operator selects a preset when choosing review-later. There is no indefinite deferral.

### System behavior during the defer window
- During the defer window, the homepage must **not** continue presenting the same unresolved issue with the same top-level urgency treatment (red/escalation visual intensity).
- Instead, the issue must move into a **lower-intensity "deferred / review scheduled" state** — still visible, but no longer dominating the homepage as an active escalation demanding immediate attention.
- The operator should be able to see that a deferred issue exists without being pressured by it during the agreed window.

### Defer window expiry
- When the defer window expires, if the underlying condition is **still unresolved**, the issue may return to active escalation status.
- The system should re-evaluate the condition at expiry, not blindly re-escalate.

### Worsening condition override
- If conditions **materially worsen** before the defer window expires (e.g., SoC drops further, a new constraint becomes active, urgency increases), the system may **break the defer** and re-escalate the issue immediately.
- This ensures that review-later is a bounded deferral, not a blind suppression.

### Audit trail
- Every review-later decision must be recorded with: operator identity, selected duration, timestamp, and the condition state at the time of deferral.
- This supports governance and post-incident review without exposing audit mechanics on the homepage surface.

---

## Persistent Issue Identity Requirement

The homepage must treat a continuing unresolved condition as the **same ongoing issue**, not as an endlessly new chain of equivalent fresh alerts.

### Why this matters
The current backend model generates a new `StrategyIntent` each evaluation cycle. When an underlying condition persists across cycles (e.g., low SoC remains below threshold), the system creates multiple intents that are semantically identical. From the operator's perspective, these are not separate problems — they are the same ongoing situation.

### Product requirement
- The homepage must present a **persistent unresolved condition** as a single **ongoing case** that continues until the condition resolves or materially changes.
- Operator actions — especially review-later / skip — must remain attached to that ongoing case across evaluation cycles.
- If the operator defers an issue for 2 hours, the system must not circumvent that deferral by generating a fresh equivalent intent 5 minutes later and presenting it at full escalation intensity.

### Continuity rules
- An ongoing case is identified by the **combination of condition type, affected resource scope, and dominant driver** — not by individual intent IDs.
- The ongoing case persists until:
  - the underlying condition resolves (e.g., SoC recovers above threshold), or
  - the condition materially changes (e.g., a different dominant driver emerges), or
  - the operator takes a definitive action (manual adjustment, override)
- Individual evaluation-cycle intents are implementation detail — the homepage must abstract above them to present a stable, continuous picture to the operator.

### Naming convention
This concept should be referred to as **ongoing case** or **persistent issue** in operator-facing language and product documentation. Avoid internal jargon like "intent chain" or "evaluation cycle" on the homepage surface.

---

## Preserved P5 Doctrine
This reframe preserves the existing P5 doctrine from `REQ-v6.5-P5-Strategy-Triggers-1.0.md`:

- P5 remains the governed trigger layer
- P5 remains above execution and below raw sensing / analytics
- P5 still governs event-initiated strategy entry
- backend/detail layers still preserve richer governance semantics
- protective logic may still auto-govern under guardrails
- complex cases may still require handoff into P4

### Important preservation rule
This reframe simplifies the **homepage surface**, not the **backend semantic model**.

That means:
- homepage actions may be fewer and more human-readable
- but detail views, audit trails, backend states, and governance rules must **not** be flattened into a fake two-state system

---

## Action Model Reframe
The homepage must explicitly separate four interaction types.

### Type 1 — Decision Confirmation
This is the platform-recommended path.

Operator-facing meaning:
- I have reviewed the current recommendation
- I accept the platform's current protective or governing posture
- continue under the current recommendation

Example label:
- `Manter proteção de reserva`

This is the **primary CTA** when the platform recommendation is stable and explainable.

### Type 2 — Manual Adjustment Navigation
This is not a policy action on the homepage itself.
It is the explicit path into manual adjustment.

Operator-facing meaning:
- I do not want to simply accept the current recommendation
- I want to adjust parameters, limits, priorities, or envelope settings in the execution/control surface

Example label:
- `Abrir painel HEMS para ajustar`

This must be visually present, but one rank below the primary recommendation CTA.

### Type 3 — Risk Override
This is not a normal alternative action.
It is a temporary override of the platform's current protective or governing logic.

Operator-facing meaning:
- I know the platform is currently protecting a constraint
- I want to temporarily relax that protection to allow a bounded economic path

Example labels:
- `Liberar arbitragem por tempo limitado`
- or equivalent PT-BR wording that makes the risk explicit

This must:
- live in a separate override section
- carry explicit risk signaling
- require a clearer confirmation step than normal decisions
- support bounded duration
- clearly state automatic restoration of protection after expiry

### Type 4 — Alert Management
This is not a strategy decision.
It only manages notification noise.

Operator-facing meaning:
- keep the current platform recommendation and operation unchanged
- suppress repeated equivalent alerts for a bounded window
- still allow more severe alerts to fire normally

Example label:
- `Silenciar alertas repetidos`

This must:
- live in a separate alert-control section
- never appear as a peer to strategy decisions
- clearly state that the platform continues operating unchanged

---

## Homepage Interaction Contract
The homepage should follow this decision grammar:

### Step 1 — Show the recommendation
The hero / main card must clearly say:
- current platform recommendation
- dominant condition
- why that recommendation exists now

### Step 2 — Show downstream impact
The homepage must immediately show the most relevant downstream strategy impact.

Example:
- `Arbitragem tarifária: suspensa`
- because reserve protection is active
- resumes when SoC recovers or manual adjustment changes the rule

This should be shown as a compact impact strip or consequence row,
not as a second independent ticket-like card.

### Step 3 — Offer the main operator paths
For most postures, the homepage must offer two main CTAs:

1. accept / confirm current recommendation
2. go adjust manually

These should dominate the page visually.

For **escalation posture**, the homepage must offer three main paths:

1. **Act now** — go adjust manually (`Ajustar manualmente`)
2. **Review later** — defer the issue for a bounded window (`Pular por agora`)
3. **Override / advanced controls** — available via secondary section where applicable

The review-later path replaces the previous `Reconhecer situação` CTA, which was insufficient because it did not produce a meaningful system-state change.

### Step 4 — Offer secondary typed controls
Secondary controls must be separated by type:
- risk override
- alert management

They must not visually or semantically compete with the two main CTAs.

### Step 5 — Show what happens next
The page must include a visible outcome preview area that answers:
- if I choose this, what happens next?

This should be dynamic or state-linked,
not a large static explanation matrix pasted under the actions.

---

## Visual Hierarchy Requirements
P5 homepage must visually reinforce the interaction contract.

### Requirement 1 — One dominant recommendation CTA
The recommendation acceptance CTA must be the strongest visual action on the page.

Desired signal:
- this is the platform-recommended path
- this is the default operator decision when no manual intervention is needed

### Requirement 2 — Manual adjustment CTA remains clear but subordinate
The manual-adjust CTA must remain discoverable and legitimate,
but should not compete equally with the primary recommendation CTA.

Desired signal:
- available path
- human intervention path
- not the platform default

### Requirement 3 — Override must feel risky
The override block must visibly feel more dangerous and more deliberate than standard actions.

Desired signal:
- not a casual alternative
- not a same-level button
- requires intention and bounded confirmation

### Requirement 4 — Alert control must feel lighter than strategy control
Alert silence controls must clearly read as notification-management tools,
not as energy strategy decisions.

### Requirement 5 — Impact must read as consequence, not second ticket
Downstream strategy impact must be compact and visibly dependent on the main recommendation.

---

## The Low-Reserve Example Scenario
This reframe is validated against the current dominant example:

- battery SoC = 20%
- reserve threshold = 30%
- reserve protection is active
- economic dispatch / tariff arbitrage is blocked while reserve protection dominates

For this scenario, the homepage must clearly communicate:

### Recommendation
- keep reserve protection active

### Why
- battery is below the safety threshold
- the platform is prioritizing backup capacity

### Impact
- tariff arbitrage is currently suspended

### Main operator paths
- accept current reserve protection
- go adjust thresholds / priorities in HEMS

### Secondary paths
- temporary override with bounded duration
- silence repeated alerts without changing platform behavior

---

## Explicit Non-Goals
This reframe must **not** turn the homepage into any of the following:

- a workflow button wall
- a ticket management page
- a manual dispatch console
- a settings editor
- a full governance audit page
- an alert center
- a second P4 page
- a fake two-state simplification that erases backend semantic richness

### Important non-goal
This reframe does **not** mean:
- “P5 only has two states now”

It only means:
- the homepage's first operator decision should be simpler and more truthful

---

## Simplicity As Design Guardrail

The addition of review-later semantics and persistent issue identity adds real product depth. This depth must **not** compromise homepage readability.

### Guardrail rules
- The homepage must remain intuitive even if this means hiding deeper governance rigor in secondary layers.
- Strict semantic correctness (ongoing case tracking, defer state machines, worsening-condition breakpoints) must not make the homepage harder to read or slower to understand.
- Deeper audit/governance details — defer history, case lifecycle, re-escalation triggers — belong below the fold or in detail views, not on the homepage surface.
- The review-later interaction must feel as simple as the existing duration-chip pattern used for overrides and alert silence. One click to choose “review later”, one click to pick a duration — done.
- The deferred state visual treatment must be calmer than active escalation, not a new kind of visual noise.

### Litmus test
If adding review-later or ongoing-case semantics makes the homepage feel like it has more buttons, more states to parse, or more cognitive load than the current two-CTA model, the implementation is wrong. The goal is to **replace** a broken interaction (acknowledge) with a better one (review later), not to **add** complexity on top.

---

## Required Corrections To Previous Homepage Semantics
The following corrections are mandatory.

### Correction A — Stop using governance verbs as homepage peer actions
`approve / defer / suppress / escalate` must no longer be the homepage's primary action grammar.

These concepts may still exist in:
- backend states
- audit model
- detail view
- governance history
- internal evaluator logic

But they should not define the operator's first homepage decision surface.

### Correction B — Do not present navigation as if it were the same type as policy action
`Abrir painel HEMS para ajustar` is navigation into adjustment work,
not the same interaction type as a strategy policy mutation.

It may remain as a main CTA,
but its semantic type must remain distinct.

### Correction C — Do not present alert silence as if it changes strategy
Silencing repeated alerts must never imply:
- dispatch changed
- protective posture changed
- economic strategy became eligible

### Correction D — Do not pretend `escalate` is a strong homepage action if no real handoff target exists
If the homepage cannot perform a true handoff with clear destination and context,
then `escalate` should not remain as a first-class homepage action label.

The truthful operator path is:
- open manual adjustment surface
- adjust there
- return to the governed strategy layer if needed

### Correction E — Replace `Reconhecer / Acknowledge` with a real operator decision
`Reconhecer situação` must be replaced with `Pular por agora` (or equivalent review-later wording) for escalation posture.

The acknowledge CTA:
- produced no meaningful system-state change
- did not prevent the same issue from immediately reappearing
- trained operators to click through rather than make a real decision

The review-later CTA:
- produces a formal time-bounded deferral
- prevents the same ongoing case from re-escalating during the defer window (unless conditions worsen)
- records the operator's decision for audit

This is not a wording change — it is a semantic correction to the interaction model.

---

## Homepage Acceptance Criteria
The homepage passes this reframe only if an operator can answer the following within ~5 seconds:

1. What is the platform recommending right now?
2. Why is it recommending that?
3. What important downstream strategy is currently affected?
4. What is the default action if I agree?
5. Where do I go if I disagree and need to adjust manually?
6. Can I defer this and come back to it later? For how long?
7. Which control is risky override?
8. Which control only silences repeated notifications?

### Product acceptance
- homepage reads as a decision gate, not a workflow board
- one primary recommendation CTA is visually dominant
- manual-adjust CTA is clear but subordinate
- override is visibly risky and bounded
- alert silence is clearly non-strategic
- downstream impact is compact and causally linked to the main recommendation
- result preview explains next-step consequences without turning the page back into a documentation wall
- escalation posture offers a meaningful **review-later / skip** decision with bounded duration
- the same unresolved issue does **not** immediately return as a fresh top-level escalation of equal intensity during the defer window
- worsening conditions may re-activate top-level escalation despite an active deferral
- a continuing unresolved condition is presented as the **same ongoing case**, not a fresh chain of equivalent alerts

### Backend readiness acceptance
- Alert silence action must successfully create a server-side override of type `suppress_alerts` that is tracked, bounded, and auto-expires
- Impact strip must show dynamic recovery conditions derived from real platform data (evidence snapshots), not hardcoded strings
- Hero metric chips must reflect real-time platform state (current SoC and threshold from the API response)

### Negative acceptance
The page fails this reframe if it still feels like:
- four peer buttons with improved wording
- a governance-state control panel
- an alert management page with strategy language pasted on top
- a second independent strategy ticket below the main card

---

## Scope Of This REQ
This REQ defines:
- homepage action grammar
- interaction-type separation
- hierarchy rules
- consequence framing
- operator-facing semantics
- backend prerequisites required to support the reframed homepage
- escalation review-later / skip decision model
- persistent issue / ongoing case identity requirement

This REQ does **not yet** define:
- exact ongoing case matching logic or schema
- exact defer state machine implementation
- exact audit/event model changes for review-later tracking
- exact routing contract between P5 and P4/HEMS
- final implementation component tree
- full detail-view governance grammar

Those belong in follow-up DESIGN / PLAN documents.

> **Note (amended 2026-03-23):** An impact audit identified 3 minor backend changes required as prerequisites for this reframe. These are small, additive changes (no new API routes, no schema migrations) that enable the homepage to function as specified. They are documented in the Backend Prerequisites section below.

---

## Backend Prerequisites

Three minor backend changes are required as prerequisites for this reframe. These are additive, low-risk changes — no new API routes, no database migrations, no architectural changes.

### Prerequisite 1 — Alert silence needs a tracked override type

The "Silenciar alertas repetidos" action (Type 4) must create a server-side posture override so the platform can:
- track when alert suppression started and when it expires
- auto-restore normal alert behavior after the bounded duration
- include the suppression in the operator audit trail

Without a dedicated `suppress_alerts` override type, the alert silence action would either be frontend-only (invisible to audit and not surviving page refreshes) or would need to misuse an existing override type that carries different semantic meaning.

### Prerequisite 2 — Impact strip needs dynamic recovery conditions

The downstream impact strip must show operators when a blocked strategy will resume (e.g., "Retorna quando SoC > 30%"). This recovery condition must come from real platform data — hardcoding it would make the homepage lie when thresholds or conditions change.

The intent cards returned in the overview response must include a `recovery_condition` field computed from the strategy evaluator's evidence snapshot. This allows the impact strip to display truthful, dynamic recovery information.

### Prerequisite 3 — Hero metrics must reflect real platform state

The hero recommendation banner displays concrete metrics (current SoC percentage, threshold value) as metric chips. These values must come from the API response, not be hardcoded in the frontend.

The dominant protector summary in the overview response must include current SoC and threshold values so the hero can render accurate metric chips that reflect real-time platform state.

---

## Next Step Recommendation
Recommended follow-up chain:

1. `DESIGN-v6.5-P5-Action-Model-Reframe-0.1.md` — amend to include:
   - review-later interaction flow and CTA rendering for escalation posture
   - deferred-state visual treatment on the homepage
   - ongoing case identity logic and its relationship to the existing intent model
   - component and state model changes for defer duration selection
2. `PLAN-v6.5-P5-Action-Model-Reframe-0.1.md` — amend to include:
   - backend phase: ongoing case tracking, defer state persistence, worsening-condition re-escalation logic
   - frontend phase: review-later CTA, deferred visual state, duration picker
3. implementation only after DESIGN / PLAN are aligned

---

## Reference Validation Artifacts
The following standalone mock sequence informed this REQ:

- R1: `http://152.42.235.155/p5-action-model-mock-r1.html`
- R2: `http://152.42.235.155/p5-action-model-mock-r2.html`
- R2.5: `http://152.42.235.155/p5-action-model-mock-r25.html`
- R3: `http://152.42.235.155/p5-action-model-mock-r3.html`

R3 is the current best validated direction for the homepage interaction contract.
