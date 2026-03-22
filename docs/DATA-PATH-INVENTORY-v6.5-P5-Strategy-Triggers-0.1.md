# DATA-PATH-INVENTORY-v6.5-P5-Strategy-Triggers-0.1

## Status
Draft 0.1 — replaces capability-first thinking with **source / database / path inventory** for the new P5 architecture.

This document assumes:
- P5 frontend is effectively a redesign
- P5 backend is also effectively a redesign
- the main question is no longer "can legacy P5 support this?"
- the main question is now:

**What data sources, database entities, and existing runtime paths should the new P5 plug into?**

---

## Core Framing
Alan's clarification is important:

**Current first-party operational data fundamentally comes from Gateway-up streams, i.e. the current M1 IoT module and its downstream persisted state.**

However, P5 should not model its source universe as only:
- gateway data
- external data

That split is too coarse.

For the new P5, the real source model should be:

1. **Gateway-up operational truth**
2. **Platform-side internal control-plane truth**
3. **External context truth**
4. **Operator-supplied truth**

This four-plane model is the correct architectural lens for P5.

---

## Source Plane 1 — Gateway-up Operational Truth
This is the physical/runtime truth flowing upward from the fleet.
It is the most important source plane and should remain the default foundation for v6.5.

### What it provides
- live or latest-known SoC
- battery power / grid power / load power / PV power
- freshness / recent telemetry continuity
- gateway online/offline state
- active command state
- latest applied schedule / current strategy mode
- recent dispatch outcomes

### Primary source paths discovered
#### MQTT / ingestion / state update
- `/tmp/solfacil/backend/src/iot-hub/handlers/mqtt-subscriber.ts`
- `/tmp/solfacil/backend/src/iot-hub/services/fragment-assembler.ts`
- `/tmp/solfacil/backend/src/iot-hub/handlers/telemetry-handler.ts`
- `/tmp/solfacil/backend/src/iot-hub/handlers/telemetry-webhook.ts`
- `/tmp/solfacil/backend/src/iot-hub/services/message-buffer.ts`

#### Aggregation paths
- `/tmp/solfacil/backend/src/iot-hub/services/telemetry-5min-aggregator.ts`
- `/tmp/solfacil/backend/src/iot-hub/services/telemetry-aggregator.ts`

### Database entities on this plane
- `telemetry_history`
- `device_state`
- `asset_5min_metrics`
- `asset_hourly_metrics`
- `gateways.status`
- `gateways.last_seen_at`
- `device_command_logs` (for active / recent command state)

### Why this plane matters to P5
This plane is where P5 learns whether the fleet is actually in a condition that could justify:
- peak concern
- reserve stress
- execution ineligibility
- cooldown / recent action
- low confidence due to stale telemetry

### Architectural rule
For v6.5, P5's **physical truth** should default to this plane unless a stronger source is explicitly defined.

---

## Source Plane 2 — Platform-side Internal Control-Plane Truth
This is not Gateway-up telemetry, but it is also not external.
It is the platform's own reference / policy / metadata layer.

This plane is critical.
Without it, P5 can observe the world but cannot govern it.

### What it provides
- gateway / asset / org topology
- contracted demand context
- tariff schedule context
- strategy defaults / SoC guardrails
- active schedule interpretation
- role / tenant / operator permissions
- targetability / scope metadata

### Primary source paths discovered
#### Metadata / topology / targeting
- `/tmp/solfacil/backend/src/bff/handlers/get-gateways.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-gateway-detail.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-gateway-schedule.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-hems-targeting.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-assets.ts`
- `/tmp/solfacil/backend/src/bff/handlers/get-device-detail.ts`

#### Policy / tariff / config
- `/tmp/solfacil/backend/src/bff/handlers/get-tariffs.ts`
- `/tmp/solfacil/backend/src/admin-control-plane/handlers/get-vpp-strategies.ts`
- `/tmp/solfacil/backend/src/admin-control-plane/handlers/update-vpp-strategy.ts`
- `/tmp/solfacil/backend/src/admin-control-plane/schema.sql`
- `/tmp/solfacil/backend/src/market-billing/schema.sql`

### Database entities on this plane
- `assets`
- `gateways`
- `organizations`
- `tariff_schedules`
- `vpp_strategies`
- latest successful schedules encoded in `device_command_logs.payload_json`
- auth / tenant context via middleware and role model

### Important fields already visible in code
- `gateways.contracted_demand_kw`
- `tariff_schedules.billing_power_factor`
- `vpp_strategies.min_soc`
- `vpp_strategies.max_soc`
- `vpp_strategies.emergency_soc`
- `vpp_strategies.profit_margin`
- `vpp_strategies.active_hours`

### Why this plane matters to P5
This plane gives P5 the platform-side logic required to interpret gateway truth.
Example:
- high demand only matters as **peak risk** if compared against contracted demand and tariff context
- low SoC only matters as **protective reserve pressure** if interpreted against strategy guardrails
- a candidate action only matters if gateway scope is operationally eligible

### Architectural rule
P5 should not pretend all truth comes from gateways.
For governance, **gateway truth must be interpreted through platform-side control-plane truth**.

---

## Source Plane 3 — External Context Truth
This is optional and additive.
It should not dominate v6.5 core, but it should be designed as a future-compatible plane.

### What it may provide
- market price feeds
- utility tariff APIs
- DR event feeds
- grid emergency feeds
- weather / outage context
- third-party planning context

### Current state
No first-class external API integration was identified as the basis for current P5.
That is acceptable.

### P5 implication
For v6.5 core, this plane should be treated as:
- optional
- secondary
- often shadow / observe-only

This aligns with the product doctrine that **external DR candidate** should not dominate first version P5.

### Architectural rule
External APIs should be integrated as **evidence sources**, not as the only source of truth for core P5 operation.

---

## Source Plane 4 — Operator-supplied Truth
This is the plane Alan explicitly proposed as the second non-gateway acquisition mode.
It is valid and important.

However, it must be handled correctly.

### What it should provide
This plane should capture structured human-supplied context that the system cannot reliably infer from Gateway-up truth alone.

Examples:
- manually declared external DR candidate
- temporary posture override
- manual reserve-priority instruction
- temporary suppression request
- manual escalation rationale
- short-lived operational context the platform does not yet observe automatically

### Critical architectural warning
**This must not live only in frontend-local state.**
If operator input exists only as an on-screen field with no backend record, then P5 becomes:
- non-auditable
- session-fragile
- non-shareable across operators
- logically fake

### Therefore
Even if the UI first exposes these as operator input controls, they should eventually become a backend-managed object with at least:
- actor
- timestamp
- scope
- type
- payload
- validity window / TTL
- reason / note

### Recommended first operator-supplied object types
1. **Temporary posture override**
2. **Manual external signal intake**
3. **Manual escalation note**

### Architectural rule
Human input is valid P5 input — but only if it becomes part of the platform's governable state, not a frontend-only illusion.

---

## Canonical P5 Source Mix for v6.5
For first real implementation, the safest core mix is:

### Core required
- Gateway-up operational truth
- Platform-side internal control-plane truth

### Optional / Phase 2
- External context truth

### Controlled exception layer
- Operator-supplied truth

This means the first real P5 does **not** need external APIs to become meaningful.
It can already become valuable if it combines:
- gateway runtime state
- platform tariff / guardrail / targeting context
- selective structured operator input

---

## Family-to-Source Mapping

## A. Peak Shaving Risk
### Likely source mix
- `device_state` / telemetry-derived load and power state
- `asset_5min_metrics` / `asset_hourly_metrics` for smoothed behavior
- `gateways.contracted_demand_kw`
- `tariff_schedules.billing_power_factor`
- latest/current schedule from `device_command_logs.payload_json`
- active command state from `device_command_logs`

### Interpretation need
Peak is not just telemetry.
It is telemetry interpreted against demand contract and existing dispatch state.

---

## B. Tariff / Arbitrage Opportunity
### Likely source mix
- `tariff_schedules`
- energy behavior from telemetry / aggregated metrics
- current mode / current schedule
- optionally future external price feeds later

### Interpretation need
This family depends more heavily on control-plane tariff context than on raw gateway telemetry alone.

---

## C. Reserve Protection / SoC Protection
### Likely source mix
- `device_state.battery_soc`
- battery power and recent load behavior
- `vpp_strategies.min_soc / max_soc / emergency_soc`
- current schedule / active command state

### Interpretation need
This is the strongest example of gateway truth plus platform guardrails producing a protective governance decision.

---

## D. External DR Candidate
### Likely source mix
- external API feed or manual operator intake
- gateway eligibility / availability context
- current strategy / active command state

### Interpretation need
This family should remain secondary or observe-only until external integration becomes concrete.

---

## Existing Reusable Read Paths
These are not the new P5 itself, but they are useful arteries.

### Gateway readiness / targeting
- `get-hems-targeting.ts`
- useful for gateway eligibility, current mode, active blocking command state

### Gateway / device / topology context
- `get-gateways.ts`
- `get-gateway-detail.ts`
- `get-assets.ts`
- `get-device-detail.ts`

### Tariff / config context
- `get-tariffs.ts`
- `get-vpp-strategies.ts`

### Historical behavior context
- `get-asset-telemetry.ts`
- `get-gateway-energy.ts`
- `get-hems-batch-history.ts`
- `get-vpp-dr-events.ts` (legacy reporting only; not identity model)

---

## Existing Reusable Execution Paths
These are downstream handoff arteries worth preserving.

### P4 entry / dispatch path
- `/tmp/solfacil/backend/src/bff/handlers/post-hems-batch-dispatch.ts`

### Command lifecycle path
- `/tmp/solfacil/backend/src/dr-dispatcher/services/command-dispatcher.ts`
- `/tmp/solfacil/backend/src/iot-hub/services/command-publisher.ts`

### Command persistence / audit path
- `device_command_logs`
- related timeout / accepted / success states

### Meaning for new P5
P5 should likely hand off into these execution paths after governance is resolved.
It should not reinvent downstream dispatch plumbing unless semantics force it.

---

## Canonical Future Flow Shape
The future architecture should read like this:

### Step 1 — Gather evidence
Evidence can come from:
- Gateway-up truth
- internal control-plane truth
- external truth
- operator-supplied truth

### Step 2 — Build interpreted condition
A new P5 decision layer assembles a **Strategic Condition** from those inputs.

### Step 3 — Form / reject / suppress intent
The decision layer qualifies and arbitrates whether a **Strategy Intent** should be surfaced.

### Step 4 — Governance action
Operator or platform posture determines:
- observe
- approve
- suppress
- defer
- escalate
- guardrailed auto

### Step 5 — Handoff if needed
If the result requires execution planning, P5 hands off into P4 / execution plumbing.

### Step 6 — Downstream execution
Existing schedule / command / MQTT pipeline performs the actual fleet action.

---

## Architectural Opinions Added on Top of Alan's Model
Alan proposed two non-gateway acquisition modes:
- external API
- operator reverse input

That is good.
My addition is:

### Important addition 1
There is a third category between gateway and external:

**platform-side internal control-plane truth**

This is not optional.
Without it, P5 cannot become a governance layer.

### Important addition 2
Operator input should be **structured**, not free-form by default.

Good operator inputs for v6.5 are likely:
- structured temporary override
- structured external-signal intake
- structured escalation rationale

Not endless note-taking boxes.

### Important addition 3
External APIs should not be mandatory for v6.5 core value.
P5 can already become real by combining gateway truth with internal control-plane truth.

---

## Suggested Next DESIGN Questions
1. What is the minimal Strategy Intent assembler input contract across the four source planes?
2. Which operator-supplied inputs deserve first-class backend objects in v6.5?
3. Should temporary posture override have TTL / expiry by default?
4. Which read paths can be composed into a first P5 read model without inventing duplicate fetch layers?
5. What is the smallest handoff payload from P5 to existing P4 dispatch path?

---

## Bottom Line
The new P5 should not be designed around legacy VPP endpoints.
It should be designed around a **four-plane source model**:

- Gateway-up operational truth
- Platform-side internal control-plane truth
- External context truth
- Operator-supplied truth

From there, P5's real job is to insert a new decision layer between **evidence gathering** and **execution handoff**.
