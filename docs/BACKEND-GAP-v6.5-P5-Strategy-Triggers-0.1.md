# BACKEND-GAP-v6.5-P5-Strategy-Triggers-0.1

## Status
Draft 0.1 — backend readiness inventory against `REQ-v6.5-P5-Strategy-Triggers-1.0.md`.

This document is intentionally blunt.
Its purpose is not to defend the legacy backend, but to measure whether current source-level capability can support the new P5 product definition.

---

## Executive Summary
Current backend support for legacy P5 is **insufficient** for the newly defined Strategy Triggers page.

What exists today is mainly:
- read-only VPP summary endpoints
- legacy dispatch history grouped for reporting
- a schedule-centric execution pipeline built around `device_command_logs`
- a strong P4 batch-dispatch path that may offer partial reuse downstream

What does **not** clearly exist today is the actual P5 product brain:
- no Strategy Intent model
- no Strategic Condition model
- no qualification layer
- no arbitration layer
- no operator governance action lifecycle for P5
- no explicit P4 handoff contract for trigger-born intents

Therefore:

**Legacy P5 can supply some read-side ingredients and some downstream execution plumbing, but it cannot yet support P5 as a governed strategy trigger layer.**

---

## Scope of Inventory
This assessment is based on direct inspection of the following source areas:

### Frontend / adapter / legacy page
- `/tmp/solfacil/frontend-v2/js/p5-vpp.js`
- `/tmp/solfacil/frontend-v2/js/data-source.js`

### BFF / local server
- `/tmp/solfacil/backend/scripts/local-server.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-vpp-capacity.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-vpp-latency.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-vpp-dr-events.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-hems-targeting.ts`
- `/tmp/solfacil/backend/src/bff/handlers/post-hems-batch-dispatch.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-hems-batch-history.ts`

### Execution pipeline
- `/tmp/solfacil/backend/src/dr-dispatcher/services/command-dispatcher.ts`
- `/tmp/solfacil/backend/src/iot-hub/services/command-publisher.ts`

### Tests / artifacts
- `/tmp/solfacil/backend/test/bff/v5.12-handlers.test.ts`
- `/tmp/solfacil/backend/test/bff/post-hems-batch-dispatch.test.ts`
- stale artifact presence check for `/tmp/solfacil/backend/dist/src/bff/handlers/post-vpp-dispatch.js`

---

## Current Legacy P5 Reality

### What the legacy page actually loads
`p5-vpp.js` initializes by loading only:
- aggregate capacity
- DR event history
- dispatch latency tiers

From `data-source.js`, legacy VPP exposes only:
- `DataSource.vpp.capacity()` → `GET /api/vpp/capacity`
- `DataSource.vpp.latency()` → `GET /api/vpp/latency`
- `DataSource.vpp.drEvents()` → `GET /api/vpp/dr-events`

### What the local server exposes for VPP
`local-server.ts` exposes only three VPP routes:
- `GET /api/vpp/capacity`
- `GET /api/vpp/latency`
- `GET /api/vpp/dr-events`

There is no source-level `POST /api/vpp/dispatch` route in the inspected local server.

### What the legacy page does on trigger
`p5-vpp.js` includes `_executeDREvent()`, but this is a local progress simulation, not a real backend write path.
It updates a progress panel through staged percentages and re-enables the button after a timer.

### Conclusion
Legacy P5 is a **read-oriented summary shell with simulated trigger UX**, not a real governed closed-loop strategy page.

---

## Capability Assessment by Layer

## 1. Signal / Read Layer
### Status: **PARTIAL / USABLE AS INPUT ONLY**

Current source already supports some read-side ingredients:
- aggregate capacity via `get-vpp-capacity.ts`
- latency tier summary via `get-vpp-latency.ts`
- DR-ish historical event summaries via `get-vpp-dr-events.ts`
- HEMS targeting fleet state via `get-hems-targeting.ts`
- HEMS batch history via `get-hems-batch-history.ts`

### Usefulness to new P5
Usable as **input context**, not as final product objects.

### Main limitation
These endpoints describe:
- aggregates
- schedules
- history
- gateway eligibility

They do **not** describe:
- interpreted strategic conditions
- qualified strategy intents
- suppression / arbitration decisions
- governance status transitions

---

## 2. Strategic Condition Model
### Status: **MISSING**

The new P5 definition depends on an internal object like:
- Strategic Condition Instance

No inspected backend source exposes or persists such an object.

No evidence was found for source-level concepts such as:
- strategic condition
- strategy intent
- intent decision
- intent status
- handoff state

### Consequence
Today, backend has no native representation of:
- "peak risk is now active"
- "tariff opportunity qualified but suppressed by reserve"
- "two valid intents are colliding on scope"

This is the largest semantic gap in the entire stack.

---

## 3. Strategy Intent Model
### Status: **MISSING**

P5 REQ defines the operator-facing unit as a **Strategy Intent Card**.
No inspected API returns such an object.

What exists instead:
- aggregated capacity numbers
- dispatch history summaries
- schedule payloads
- gateway targeting rows

### Consequence
There is currently no backend contract that can answer:
- what the intent is
- why it formed now
- which governance mode applies
- what the bounded next path is

Without a Strategy Intent contract, frontend can only fake P5 through demo data or ad-hoc assembly.

---

## 4. Qualification Layer
### Status: **MISSING / ONLY IMPLICIT IN OTHER FLOWS**

New P5 requires qualification judgments such as:
- telemetry freshness
- confidence
- reserve floor status
- boundedness
- playbook maturity
- operator relevance

No inspected VPP or HEMS endpoint currently returns an explicit qualification result object.

Some of the raw ingredients may exist across telemetry, schedules, and gateway status, but there is no source-level qualification layer that turns those into a stable product contract.

### Consequence
If P5 were built today on live backend, qualification would have to be:
- hard-coded in frontend, or
- hidden inside ad-hoc backend logic not yet modeled as product contract

Both are unacceptable for a durable P5 design.

---

## 5. Arbitration Layer
### Status: **MISSING**

New P5 requires arbitration when multiple valid intents coexist.
Examples:
- peak vs tariff
- revenue vs reserve protection
- scope collision requiring escalation

No inspected backend source appears to implement a first-class arbitration layer.

No evidence was found for source-level concepts like:
- suppress reason
- overridden_by
- merged_into
- defer reason
- escalation reason

### Consequence
Current backend cannot truthfully explain:
- why one intent beat another
- why an economic intent was suppressed
- why a conflict could not be auto-resolved

This directly blocks the explainability promised by P5.

---

## 6. Governance Action Layer
### Status: **MISSING FOR P5**

P5 needs operator-facing governance actions such as:
- approve intent
- defer intent
- suppress intent
- escalate to P4

No source-level VPP action endpoints were found for these semantics.

There is no inspected route shaped like:
- POST approve intent
- POST defer intent
- POST suppress intent
- POST escalate / handoff intent

### Important nuance
Existing HEMS write path does exist:
- `POST /api/hems/batch-dispatch`

But that endpoint is a **P4 execution path**, not a P5 governance path.
It assumes the operator has already chosen mode, parameters, and gateway scope.

### Consequence
P5 currently has no authentic write-side governance lifecycle.
The page can maybe visualize a recommendation, but cannot honestly govern it.

---

## 7. Handoff to P4
### Status: **SEMANTICALLY MISSING, MECHANICALLY PARTIAL**

### What exists
`post-hems-batch-dispatch.ts` proves there is a downstream execution path that can:
- validate a dispatch request
- build schedules
- insert `device_command_logs`
- create `batchId`
- return per-gateway pending/skipped results

This is useful.

### What is missing
There is no inspected source-level contract for a P5-to-P4 handoff object that says:
- this trigger-born intent was accepted for manual orchestration
- these candidate playbooks are proposed
- this scope collision needs manual split
- this bounded envelope should be prefilled in P4

### Consequence
The current system may be able to **execute** once a P4-like payload exists, but it cannot yet truthfully represent the **responsible transfer of governance** from P5 to P4.

---

## 8. Execution Plumbing
### Status: **PARTIAL / REUSABLE DOWNSTREAM**

### What exists
There is meaningful downstream plumbing in:
- `post-hems-batch-dispatch.ts`
- `command-dispatcher.ts`
- `command-publisher.ts`

Capabilities include:
- batched schedule creation
- validation through schedule translator
- insertion into `device_command_logs`
- transition from pending → dispatched
- MQTT publish to gateway topic
- timeout handling

### Critical limitation
This plumbing is fundamentally **schedule-centric** and **command-log-centric**.
`command-publisher.ts` validates a `DomainSchedule`, builds a config-set payload, and publishes to:
- `platform/ems/{gateway_id}/config/set`

This is good execution plumbing, but it is not a P5 semantics layer.

### Consequence
The system can probably reuse parts of the execution chain **after** governance is resolved, but cannot use execution plumbing as a substitute for Strategy Trigger logic.

---

## 9. History / Audit Closure
### Status: **PARTIAL BUT MISALIGNED**

### Legacy VPP history issue
`get-vpp-dr-events.ts` groups records by:
- `date_trunc('hour', dr.dispatched_at)`

This creates hourly reporting summaries, not identity-stable strategy intent history.

### Why this matters
P5 needs to answer lifecycle questions like:
- what intent was formed
- when it was approved / deferred / suppressed / escalated
- what downstream path it took
- what final outcome it reached

Hourly grouped dispatch history cannot serve as a true Strategy Intent lifecycle store.

### What may be reusable
`get-hems-batch-history.ts` is more structured than legacy VPP history because it groups by `batch_id`.
This may help downstream execution review, but it still does not represent the governance lifecycle that P5 needs.

---

## 10. Tests and Confidence Level
### Status: **LOW CONFIDENCE ON P5 WRITE SIDE**

What we found:
- test coverage exists for `GET /api/vpp/capacity`
- test coverage exists for `GET /api/vpp/latency`
- test coverage exists for `GET /api/vpp/dr-events`
- test coverage exists for `POST /api/hems/batch-dispatch`

What we did **not** find in inspected source-level areas:
- meaningful P5 governance write tests
- intent lifecycle tests
- qualification / arbitration tests
- P4 handoff tests originating from P5 semantics

### Additional signal
A stale compiled artifact exists at:
- `/tmp/solfacil/backend/dist/src/bff/handlers/post-vpp-dispatch.js`

But source file is missing at:
- `/tmp/solfacil/backend/src/bff/handlers/post-vpp-dispatch.ts`

This lowers confidence further, because it suggests legacy dispatch semantics once existed or were partially generated, but are not currently represented as trustworthy source code.

---

## Reuse Candidates
These are the backend pieces most worth preserving when designing real P5 support.

### A. Fleet / gateway readiness context
`get-hems-targeting.ts`
- useful for gateway-level availability / active command context
- likely reusable as part of downstream scope validation

### B. Execution handoff plumbing
`post-hems-batch-dispatch.ts`
- useful as downstream execution entry once governance has already produced a bounded execution request

### C. Command lifecycle plumbing
- `device_command_logs`
- `command-dispatcher.ts`
- `command-publisher.ts`
- timeout handling

Useful for execution and audit, not for strategy-trigger reasoning.

### D. Gateway protocol pipeline
Existing gateway schedule command path is real and valuable.
It should be treated as downstream infrastructure, not as P5's core model.

---

## Hard Gaps
These are the gaps that must be solved before P5 can be honestly implemented as defined in the REQ.

### Gap 1 — No Strategy Intent contract
Need a canonical backend object for surfaced P5 intents.

### Gap 2 — No Strategic Condition layer
Need a backend representation of interpreted strategy-relevant conditions.

### Gap 3 — No qualification contract
Need a way to explain why an intent is surfaced, blocked, auto-governed, or suppressed.

### Gap 4 — No arbitration contract
Need a way to represent dominance, suppression, defer reasons, and conflict context.

### Gap 5 — No governance write path
Need endpoints / state transitions for approve, defer, suppress, escalate.

### Gap 6 — No P5-origin handoff contract to P4
Need an explicit transfer object that P4 can open and continue.

### Gap 7 — No intent lifecycle history
Need history keyed by intent identity, not just hourly dispatch grouping or execution batch grouping.

---

## Semantic Mismatches
These are not just missing files; they are places where existing backend logic is shaped around the wrong product concept.

### Legacy VPP concept mismatch
Legacy P5 thinks in terms of:
- capacity cards
- DR trigger panel
- latency chart
- DR event history

New P5 thinks in terms of:
- strategic conditions
- strategy intents
- governance decisions
- arbitration outcomes
- handoff paths

### HEMS path mismatch
Existing HEMS path thinks in terms of:
- chosen mode
- chosen parameters
- chosen gateways
- submit schedule batch

That is a good P4 execution workbench model, but not a P5 governance model.

### Execution mismatch
Existing execution layer thinks in terms of:
- schedule payload
- device command log
- MQTT publish
- ACK / timeout

Again useful, but too low-level to define P5.

---

## Backend Readiness Verdict
### Read-side support
**Partial**
There are enough read-side building blocks to inform a future P5, but not enough to directly power the product definition without heavy transformation.

### Governance-side support
**Missing**
The product's core operator actions and lifecycle semantics are not represented.

### Handoff-side support
**Partial downstream plumbing, missing upstream semantics**
Execution plumbing exists, but P5-to-P4 transfer semantics do not.

### Overall verdict
**Current backend cannot yet support P5 as Strategy Triggers without significant DESIGN work.**

---

## Recommended Next Step for DESIGN
The next DESIGN phase should not start from screens or routes first.
It should start by defining a minimal backend model for:

1. **Strategic Condition Instance**
2. **Strategy Intent**
3. **Intent governance decision**
4. **Intent status / lifecycle**
5. **P5 → P4 handoff payload**
6. **Intent history / audit model**

Only after those objects are defined should the final BFF/API contract be designed.

---

## Questions to Resolve in DESIGN
1. What is the minimal canonical Strategy Intent object for v6.5?
2. Does Strategic Condition need persistence, or can first version assemble it transiently?
3. Where should qualification logic live: service layer, BFF assembler, or dedicated trigger engine?
4. What is the smallest viable governance state machine for approve / defer / suppress / escalate?
5. Should P4 consume a generic handoff payload or family-specific playbook payloads?
6. How should intent history be stored so operator actions and downstream outcomes remain linked?

---

## Bottom Line
If REQ 1.0 defines **what P5 must be**, then current backend inventory shows this clearly:

**We have some of the pipes, but not yet the brain.**

That is acceptable — but it must be acknowledged before DESIGN begins.
