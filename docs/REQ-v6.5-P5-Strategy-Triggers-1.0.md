# REQ-v6.5-P5-Strategy-Triggers-1.0

## Status
Draft 1.0 — product definition stabilized after P5 audit, market framing debate, and design-stage four-state mock validation on 2026-03-22.

## Goal
Define Page 5 as **Strategy Triggers** — Solfacil's governed strategy trigger layer.

Page 5 exists to answer one question:

**Given the current portfolio state, is there any strategy intent that should move forward now — and if so, under what governance mode?**

This page must transform upstream signals and emerging conditions into **governable strategy intents** that can be:
- observed
- approved
- auto-governed under protective logic
- escalated to P4 for manual orchestration

---

## Product Positioning

### The five-page chain
Solfacil's product chain should now be understood as:

- **P1 Fleet** — Observe fleet posture and gateway health
- **P2 Devices** — Inspect gateways, devices, and configuration
- **P3 Energy** — Understand energy behavior and historical context
- **P4 HEMS Control Workbench** — Act through human-initiated strategy execution
- **P5 Strategy Triggers** — Govern event-initiated strategy entry

### P5's place in the chain
P5 sits **above execution** and **below raw sensing / analytics**.
It is not the page that explains every signal, and not the page that manually configures every dispatch.
It is the page that decides whether a strategy intent should meaningfully enter the execution chain.

### Boundary with P4
- **P5** decides whether a strategy intent should move forward.
- **P4** decides how to execute once orchestration, scope tuning, or envelope rewriting is required.

Preserved doctrine:

**P4 is human-initiated strategy entry; P5 is event-initiated strategy entry.**

---

## Primary User
The primary user is the **dispatcher / operations operator**.

P5 is not designed primarily for:
- executives
- auditors
- market researchers
- product analysts

These users may consume downstream reports later, but the page itself is an **operator governance surface**.

---

## Primary Mission
P5 must let the operator do three things well:

1. **Observe current strategic posture**
2. **Govern strategy intents**
   - approve
   - defer
   - suppress
   - allow protective auto-governance to continue
3. **Escalate to P4** when manual orchestration is required

### Secondary mission
Provide low-noise context that explains:
- why the platform formed the intent
- why the platform did not form an intent
- why protection is suppressing revenue intents
- why a conflict cannot be safely auto-resolved inside P5

---

## Explicit Non-Goals
P5 must **not** become any of the following:

- a fleet dashboard
- an energy analytics page
- a manual dispatch builder
- a rule editor
- an event waterfall
- an audit-only timeline
- a KPI wall
- a market intelligence board
- a P4-lite execution console

If a piece of information does not help the operator govern whether a strategy intent should advance, it does not belong on P5.

---

## Page Philosophy

### Low-noise by design
P5 should be quiet unless governance is needed.
The page must not try to prove its value by surfacing every twitch in the system.

### Triage first
The page's job is not exhaustive visibility.
The page's job is to help the operator answer, quickly:
- What needs attention now?
- What is the platform already doing?
- What is worth watching next?

### Explainable governance
Every surfaced intent must explain:
- why now
- why this strategy basis
- what scope is affected
- what constraints apply
- what happens next if the operator acts or refuses to act

---

## Core Object Model

### Internal core object
**Strategic Condition Instance**

This is the platform's internal representation of a strategy-relevant situation.
It is not a raw signal and not an execution event.

### Operator-facing object
**Strategy Intent Card**

This is the human-readable, governable wrapper shown in P5.
It presents a Strategic Condition Instance as an actionable governance unit.

### Semantic separation
- **Signals** = raw world facts
- **Strategic Condition Instance** = strategy-relevant interpreted condition
- **Strategy Intent** = candidate governance object surfaced to operator
- **Execution event** = downstream artifact after handoff / dispatch

---

## P5 Logical Pipeline
P5 should be defined through four internal steps:

### 1. Interpret
Translate upstream signals into strategy-relevant conditions.

Examples:
- peak risk is forming
- reserve is becoming dominant constraint
- tariff opportunity is emerging
- two eligible intents are colliding on scope

### 2. Qualify
Decide whether the condition is eligible to become a surfaced strategy intent.

Qualification depends on:
- telemetry freshness
- confidence
- boundedness of impact
- protection constraints
- playbook maturity
- operator relevance

### 3. Arbitrate
If more than one intent exists, decide which one dominates, which one is suppressed, and which one requires escalation.

### 4. Handoff
Choose the correct outcome path:
- observe only
- approval required
- guardrailed auto-governance
- escalate to P4

---

## Core Condition Families for v6.5

### Core families
These should define v6.5's first-class strategy trigger vocabulary:

1. **Peak Shaving Risk**
2. **Tariff / Arbitrage Opportunity**
3. **Reserve Protection / SoC Protection**

### Secondary families
These may exist in reduced or secondary presentation:
- Curtailment Mitigation Opportunity
- Outage / Resilience Preparation

### Shadow / observe-only family
- External DR Candidate

### Anti-pattern
External DR / mature-market VPP semantics must not dominate v6.5 in Brazil-first framing.

---

## Governance Doctrine
P5 should preserve the following operating doctrine:

- **Protective things can auto**
- **Economic things need approval**
- **Ambiguous things stay observe**
- **Complex things escalate**

This doctrine applies through a combination of:
- family baseline policy
- instance-level promotion / demotion based on live context

### Promotion / demotion factors
An instance may move between Observe / Approval / Auto / Escalate depending on:
- protective vs economic nature
- reserve condition
- telemetry freshness
- confidence
- conflict complexity
- playbook maturity
- boundedness / reversibility

---

## Operating Modes / Postures
P5 is one page with multiple postures, not four separate product pages.

The four validated archetypal modes are:

### 1. Calm Baseline
Meaning:
- no surfaced governance-required intent
- system posture is balanced
- operator does not need to act

### 2. Approval-Gated
Meaning:
- a strategy intent has formed
- the platform recommends advancement
- human approval is required before execution path continues

### 3. Protective
Meaning:
- a protective condition is dominant
- revenue intents may be deferred or suppressed
- platform may already be acting under guardrails

### 4. Escalation to P4
Meaning:
- qualification succeeded, but safe automatic arbitration is not possible
- scope split / envelope rewrite / manual orchestration is required
- handoff to P4 is the correct next path

These four modes are design archetypes that define P5's operating language.
They are not necessarily the final implementation enum set.

---

## Homepage Information Architecture
P5 homepage should follow a stable triage-first layout.

### Hero purpose
The hero is not a KPI banner.
Its job is to express **Platform Intent Posture**.

### Hero must answer
- current posture
- dominant driver
- governance mode
- override / conflict state
- whether operator action is needed now

### Main flow sections
The homepage should use three stable sections:

1. **Need decision now**
2. **Platform acting**
3. **Watch next**

### Why this structure
- **Need decision now** isolates governance-required intents
- **Platform acting** shows what the system is already doing under guardrails
- **Watch next** gives forward context without flooding the screen

### Right rail role
Right rail should remain low-noise context, not a second main column.
Recommended fixed card families:
- Operating posture
- Dominant protector
- Recent handoffs
- Suppressed / deferred

---

## Strategy Intent Card Requirements
Each surfaced intent card must support a two-level interaction model:

### Level 1 — Triage card
Operator sees:
- title
- urgency / time pressure
- short reason
- posture / governance badge

### Level 2 — Inline decision panel
Panel must support a stable decision grammar:
- Why now
- Decision basis
- Scope & impact
- Constraints & confidence
- Next path
- Actions

### Why this matters
P5 should not force operators to leave context just to understand why the platform is asking for governance.

---

## Operator Actions
The first version of P5 should support these operator actions conceptually:

### Approval-gated intent
- Approve
- Defer
- Suppress
- Open in P4

### Protective posture
- Keep posture
- Review in P4 when override / exception handling is needed

### Conflict / escalation
- Escalate to P4
- Defer
- Suppress one side if policy allows

### Important boundary
P5 actions are governance actions, not direct device command authoring.
P5 should never become a device-level manual control surface.

---

## P4 Handoff Requirements
When P5 escalates or transfers an intent to P4, the handoff must feel explicit and bounded.

The operator should understand:
- which playbook is being proposed
- what scope is affected
- what envelope / constraints are prefilled
- why P4 is needed instead of P5 resolving it internally

P5 must not look like it is punting the problem away.
It must look like a governed transfer of responsibility.

---

## v6.5 Acceptance Criteria
P5 v6.5 should be considered product-definition complete if it satisfies the following:

### Positioning acceptance
- P5 has a clear identity distinct from P1–P4
- P5 is understood as a strategy trigger governance layer, not as a dashboard or dispatch console

### UX / IA acceptance
- homepage is triage-first
- hero expresses posture, not KPI summary
- four archetypal operating modes are coherent within one page grammar
- operator can answer "what now?" within a few seconds on each mode

### Object-model acceptance
- the page centers on strategy intents, not raw events
- operator-facing intent cards are explainable and governable

### Governance acceptance
- protective / approval / observe / escalation logic is explicit
- P5 / P4 boundary is clear and preserved

### Scope acceptance
- no regression into analytics wall, rule editor, or manual dispatch page

---

## Out of Scope for REQ 1.0
This document does **not** yet define:
- final backend API contract
- final DB schema
- final event/state machine implementation
- final visual component library choice
- runtime deployment plan

Those belong to DESIGN / PLAN after backend gap assessment.

---

## Immediate Next Step
After REQ 1.0, the next required artifact is:

**BACKEND-GAP-v6.5-P5-Strategy-Triggers-0.1.md**

Purpose:
- measure current backend support against this REQ
- identify semantic mismatches
- separate reusable plumbing from missing product logic
