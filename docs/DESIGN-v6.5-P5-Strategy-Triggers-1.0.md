# DESIGN-v6.5-P5-Strategy-Triggers-1.0

## Status
Design 1.0 — aligned against REQ-v6.5-P5-Strategy-Triggers-1.0 and DATA-PATH-INVENTORY-v6.5-P5-Strategy-Triggers-0.1.

---

## 1. Context and Goals

### Why legacy P5 is being replaced
Legacy P5 was a VPP summary shell: capacity cards, latency charts, DR event history, and a simulated trigger button. It presented aggregated reporting artifacts but had no governance model, no strategy intent lifecycle, and no operator decision surface. It could not answer the question P5 must now answer:

**Given current portfolio state, is there a strategy intent that should move forward — and under what governance mode?**

### Why P5 is now Strategy Triggers
P5 is repositioned as a **governed strategy trigger layer**. Its job is not to display fleet metrics or replay history. Its job is to:

1. Interpret upstream signals into strategy-relevant conditions
2. Qualify and arbitrate those conditions into governable strategy intents
3. Surface intents to the operator with explainable context
4. Let the operator (or protective auto-governance) decide next path
5. Hand off to P4 or downstream execution when governance resolves

### How P5 fits the five-page chain
| Page | Role |
|------|------|
| P1 Fleet | Observe fleet posture and gateway health |
| P2 Devices | Inspect gateways, devices, configuration |
| P3 Energy | Understand energy behavior and history |
| P4 HEMS Control | Human-initiated strategy execution |
| **P5 Strategy Triggers** | **Event-initiated strategy entry and governance** |

P5 sits above execution and below raw sensing. It is the decision gate between observed conditions and execution commitment.

**Boundary with P4:** P5 decides *whether* a strategy intent should advance. P4 decides *how* to execute when orchestration, scope tuning, or envelope rewriting is needed. P4 is human-initiated entry; P5 is event-initiated entry.

---

## 2. Architecture Boundaries

### M1 — IoT Hub (`iot-hub/`)
**Role:** Operational truth provider.
- Ingests MQTT telemetry from gateways
- Persists `telemetry_history`, updates `device_state`
- Runs 5-min and hourly aggregation into `asset_5min_metrics` / `asset_hourly_metrics`
- Manages command publish via `command-publisher.ts`
- Tracks command lifecycle in `device_command_logs`

**P5 relationship:** M1 is a **read-only upstream source** for P5. P5 reads gateway-up operational truth from M1's persisted state. P5 never writes to M1 tables or publishes MQTT directly.

### M2 — Optimization Engine (`optimization-engine/`)
**Role:** Runtime decision logic — the P5 brain lives here.
- `schedule-generator.ts` — generates schedule payloads (existing)
- Strategy evaluation, qualification, and arbitration services (NEW for P5)

**P5 relationship:** M2 is the **home for P5's strategy evaluation logic**. The new intent evaluation, qualification, and arbitration functions are added as services within `optimization-engine/services/`. M2 already owns the decision-to-execution boundary. Adding strategy trigger evaluation here keeps the brain close to execution semantics without contaminating M5.

### M3 — DR Dispatcher (`dr-dispatcher/`)
**Role:** Dispatch progression toward execution boundary.
- `command-dispatcher.ts` — dispatches validated commands
- `dispatch-command.ts`, `collect-response.ts`, `timeout-checker.ts` — execution handlers

**P5 relationship:** M3 is **unchanged by P5**. P5 does not add services to `dr-dispatcher/`. When an approved intent reaches execution, it flows through existing M3 dispatch paths.

### M4 — Market Billing (`market-billing/`)
**Role:** Historical/economic context. Unchanged by P5.

### M5 — BFF (`bff/`)
**Role:** Frontend-serving API facade — the P5 face lives here.
- Exposes HTTP handlers for all pages
- Assembles read models from underlying data
- Routes operator actions to appropriate services

**P5 relationship:** M5 **exposes P5 APIs** and **assembles the P5 homepage read model**. M5 does not contain qualification or arbitration logic. M5 handlers call M2 services for evaluation, then shape responses for the frontend.

### M8 — Admin Control Plane (`admin-control-plane/`) — Excluded from P5 Core
**Role:** Platform configuration and admin.
- Owns `vpp_strategies` table (SoC guardrails, profit margins, active hours)
- Owns `device_parser_rules` table
- Strategy CRUD handlers

**P5 relationship:** M8 owns `vpp_strategies` and `device_parser_rules`. P5 reads `vpp_strategies` as **shared DB truth via direct SQL** — it queries the table for SoC guardrails (min_soc, max_soc, emergency_soc), profit_margin, and active_hours. P5 **never calls M8 handlers**, never imports M8 services, and has **no M8 runtime dependency**. This is a read dependency on a shared table, not an M8 integration.

---

## 3. Source and Data Path Architecture

P5 operates on a **four-plane source model** but only the first two planes are core-required for v6.5.

### Plane 1 — Gateway-up Operational Truth (core required)
| Data | Source Table/Entity | Purpose in P5 |
|------|-------------------|---------------|
| Live SoC | `device_state.battery_soc` | Reserve protection qualification |
| Power readings | `device_state` (battery/grid/load/PV power) | Peak risk detection |
| Smoothed metrics | `asset_5min_metrics`, `asset_hourly_metrics` | Trend context, noise reduction |
| Gateway liveness | `gateways.status`, `gateways.last_seen_at` | Telemetry freshness, confidence |
| Active commands | `device_command_logs` (pending/dispatched) | Cooldown, conflict detection |
| Recent schedules | `device_command_logs.payload_json` | Current strategy mode awareness |

### Plane 2 — Platform-side Internal Control-Plane Truth (core required)
| Data | Source Table/Entity | Purpose in P5 |
|------|-------------------|---------------|
| Contracted demand | `gateways.contracted_demand_kw` | Peak risk threshold |
| Tariff context | `tariff_schedules` | Arbitrage opportunity qualification |
| SoC guardrails | shared DB (M8-schema-owned `vpp_strategies.min_soc/max_soc/emergency_soc`) | Reserve protection thresholds |
| Profit margins | shared DB (M8-schema-owned `vpp_strategies.profit_margin`) | Economic intent viability |
| Active hours | shared DB (M8-schema-owned `vpp_strategies.active_hours`) | Scheduling eligibility |
| Topology | `assets`, `gateways`, `organizations` | Scope targeting |

### Plane 3 — External Context Truth (optional, not in v6.5 core)
Market price feeds, utility APIs, DR event feeds, weather context. Designed as a future-compatible evidence plane but not required for v6.5 core value.

### Plane 4 — Operator-supplied Truth (controlled exception layer)
Persisted in P5's own tables (`posture_overrides`). Includes temporary posture overrides, manual escalation rationale, and manual external signal intake (light/observe-first in v6.5).

### Why no external API dependency for v6.5 core
P5 becomes meaningful by combining gateway runtime state with platform tariff/guardrail/targeting context. The three core condition families (Peak Shaving Risk, Tariff/Arbitrage Opportunity, Reserve Protection) can all be evaluated from Plane 1 + Plane 2 data alone. External APIs are additive, not foundational.

---

## 4. Runtime Flow

### End-to-end P5 runtime cycle

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Gather Evidence                                     │
│  M2 service reads from M1 tables + shared DB + overrides    │
│  Assembles per-gateway / per-scope evidence snapshots        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Step 2: Evaluate Conditions                                 │
│  M2 service interprets evidence into Strategic Conditions    │
│  Per condition family: peak risk? tariff opportunity?         │
│  reserve stress? Conditions are transient, not persisted.    │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Step 3: Qualify & Arbitrate → Reconcile Strategy Intents    │
│  M2 service qualifies conditions (freshness, confidence,     │
│  boundedness, protection constraints).                       │
│  Arbitrates: which intent dominates, which is suppressed,    │
│  which requires escalation.                                  │
│  Result: a set of strategy_intents rows (upsert).           │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Step 4: Apply Active Posture Override                       │
│  If a valid posture_override exists, M2 adjusts governance   │
│  mode (e.g., force protective, suppress economic intents).   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Step 5: Project Homepage Read Model                         │
│  M5 handler (GET /api/p5/overview) calls M2 evaluation,      │
│  then assembles the triage-first read model:                 │
│  - hero posture                                              │
│  - need_decision_now (approval-gated intents)               │
│  - platform_acting (auto-governed protective intents)        │
│  - watch_next (observe-only, deferred)                      │
│  - right rail context cards                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Step 6: Operator Action Path                                │
│  Operator governs intent via POST actions (approve, defer,   │
│  suppress, escalate). M5 handler validates, calls M2         │
│  service to update strategy_intents status.                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Step 7: Handoff / Dispatch Continuation                     │
│  If approved → M2 produces bounded execution request →      │
│  existing post-hems-batch-dispatch path or direct            │
│  command-dispatcher path.                                    │
│  If escalated → strategy_intents row marked escalated,       │
│  handoff snapshot stored, P4 can read and continue.         │
└─────────────────────────────────────────────────────────────┘
```

### Strategic Condition: transient vs persisted
Strategic Conditions are **transient computation artifacts**. They do not need their own table in v6.5. They are assembled on each evaluation cycle from current evidence. Only the resulting Strategy Intents (the qualified, arbitrated outputs) are persisted.

This keeps persistence minimal and avoids a growing condition-history table that adds complexity without clear product value in v6.5.

### Evaluation trigger model
For v6.5, evaluation is **request-triggered** (computed when the P5 page is loaded or refreshed), not event-driven. This is simpler and sufficient for the operator triage use case. Event-driven push can be added later without changing the core model.

---

## 4.5. Governance Mode Assignment

This section operationalizes the REQ's Governance Doctrine into a formal baseline + promotion/demotion spec. The strategy-evaluator (M2) applies this spec after qualification and arbitration to assign each intent's `governance_mode`.

### A) Family Baseline Map

| Family | Default Governance Mode | Rationale |
|--------|------------------------|-----------|
| `reserve_protection` | `auto_governed` | Protective; error cost is high; bounded by SoC floor |
| `peak_shaving` | `approval_required` | Economic; operator should validate scope and timing |
| `tariff_arbitrage` | `approval_required` | Economic; depends on tariff context operator may know better |
| `curtailment_mitigation` | `observe` | Secondary family; insufficient playbook maturity in v6.5 |
| `resilience_preparation` | `observe` | Secondary; pre-storm/pre-outage preparation requires external context not available in v6.5 core |
| `external_dr` | `observe` | Shadow family; no first-class external integration in v6.5 |

### B) Instance-level Promotion/Demotion Rules (applied after baseline)

**Promotion (toward more autonomous):**
- If `reserve_protection` AND SoC < `emergency_soc` → promote to `auto_governed` even if baseline would be lower (emergency override)

**Demotion (toward more human oversight):**
- If telemetry freshness > staleness threshold → demote any family to `observe` (cannot qualify with stale data)
- If confidence is low (e.g., only 1 of 4 gateways in scope reporting) → demote to `observe` or `approval_required`
- If scope collision with another active intent exists → demote both to `escalate` (conflict requires operator)
- If playbook not available for the family → demote to `observe` (cannot act without playbook)
- If boundedness check fails (impact exceeds envelope) → demote to `escalate`

### C) Governing Principle

```
Final governance_mode = apply_promotions(apply_demotions(family_baseline, instance_context))
```

Demotion is always safe (more human oversight). Promotion requires explicit qualifying conditions.

---

## 5. Persistence Design

### New table: `strategy_intents`

This is the core P5 persistence object. Each row represents a qualified, arbitrated strategy intent that has been surfaced (or is being tracked) by the platform.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `BIGSERIAL` PRIMARY KEY | Auto-increment surrogate key (matches `ddl_base.sql` style) |
| `org_id` | `VARCHAR(50)` NOT NULL REFERENCES `organizations(org_id)` | Tenant scoping |
| `family` | `VARCHAR(50)` NOT NULL | Condition family: `peak_shaving`, `tariff_arbitrage`, `reserve_protection`, `curtailment_mitigation`, `resilience_preparation`, `external_dr` |
| `status` | `VARCHAR(30)` NOT NULL | Lifecycle: `active`, `approved`, `deferred`, `suppressed`, `escalated`, `expired`, `executed` |
| `governance_mode` | `VARCHAR(30)` NOT NULL | `observe`, `approval_required`, `auto_governed`, `escalate` |
| `urgency` | `VARCHAR(20)` NOT NULL | `immediate`, `soon`, `watch` |
| `title` | `text` NOT NULL | Human-readable intent title |
| `reason_summary` | `text` NOT NULL | Short explanation of why this intent formed |
| `evidence_snapshot` | `JSONB` NOT NULL | Frozen evidence at qualification time (SoC levels, power readings, tariff context, thresholds crossed) |
| `scope_gateway_ids` | `JSONB` DEFAULT '[]' | Affected gateway serial numbers (JSON array of VARCHAR strings) |
| `scope_summary` | `text` | Human-readable scope description |
| `constraints` | `JSONB` | Active constraints (reserve floors, cooldown, confidence) |
| `suggested_playbook` | `text` | Recommended playbook if approved |
| `handoff_snapshot` | `JSONB` | P4 handoff context if escalated (proposed scope, envelope, playbook) |
| `arbitration_note` | `text` | Why this intent won/lost vs competing intents |
| `actor` | `VARCHAR(100)` | Who last acted: `platform`, `operator:<user_id>` |
| `decided_at` | `TIMESTAMPTZ` | When operator/platform last changed status |
| `created_at` | `TIMESTAMPTZ` NOT NULL DEFAULT now() | |
| `updated_at` | `TIMESTAMPTZ` NOT NULL DEFAULT now() | |
| `expires_at` | `TIMESTAMPTZ` | Auto-expiry for time-bound intents |

**Key design choices:**
- `evidence_snapshot` as JSONB avoids normalizing every possible evidence field into columns. Evidence structure varies by family.
- `handoff_snapshot` lives inside `strategy_intents` rather than a separate `p4_handoffs` table. This keeps the handoff context co-located with the intent that produced it. P4 reads the handoff snapshot when the operator opens an escalated intent in P4.
- `status` covers the full governance lifecycle in one field. No need for a separate state-machine table.

### New table: `posture_overrides`

Operator-supplied temporary posture adjustments.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `BIGSERIAL` PRIMARY KEY | Auto-increment surrogate key |
| `org_id` | `VARCHAR(50)` NOT NULL REFERENCES `organizations(org_id)` | Tenant scoping |
| `override_type` | `VARCHAR(50)` NOT NULL | `force_protective`, `suppress_economic`, `force_approval_gate`, `manual_escalation_note` |
| `reason` | `text` NOT NULL | Operator-supplied rationale |
| `scope_gateway_ids` | `JSONB` DEFAULT '[]' | Scoped to specific gateways (JSON array of VARCHAR gateway SN strings), or empty array for org-wide |
| `actor` | `VARCHAR(100)` NOT NULL | `operator:<user_id>` |
| `active` | `boolean` NOT NULL DEFAULT true | |
| `starts_at` | `TIMESTAMPTZ` NOT NULL DEFAULT now() | |
| `expires_at` | `TIMESTAMPTZ` NOT NULL | TTL-based auto-expiry (required) |
| `cancelled_at` | `TIMESTAMPTZ` | If manually cancelled before expiry |
| `cancelled_by` | `VARCHAR(100)` | |
| `created_at` | `TIMESTAMPTZ` NOT NULL DEFAULT now() | |

**Key design choices:**
- `expires_at` is required, not optional. Posture overrides must be temporary. This prevents orphaned overrides silently distorting governance indefinitely.
- `active` + `expires_at` together determine current validity: `active = true AND expires_at > now()`.
- No additional tables beyond these two. This is intentional.

---

## 6. API Design

### Overview: `/api/p5/overview` is a homepage read model

This is the most important API in P5. It is **not** a raw table query. It is a **projected read model** assembled by M5 from M2 evaluation results.

The handler:
1. Calls M2 strategy evaluation service (gather evidence → evaluate → qualify → arbitrate)
2. Reads active `posture_overrides`
3. Assembles the triage-first homepage projection

### `GET /api/p5/overview`

**Response shape:**
```typescript
{
  hero: {
    posture: 'calm' | 'approval_gated' | 'protective' | 'escalation',
    dominant_driver: string,          // e.g. "Reserve protection active"
    governance_mode: 'observe' | 'approval_required' | 'auto_governed' | 'escalate',  // dominant governance mode across active intents
    governance_summary: string,       // e.g. "1 intent awaiting approval" (human-readable)
    override_active: boolean,
    conflict_active: boolean,         // whether unresolved intent conflicts exist requiring operator attention or escalation
    operator_action_needed: boolean
  },
  calm_explanation: {
    reason: 'no_conditions_detected' | 'telemetry_stale' | 'override_suppressing' | 'protection_dominant' | 'all_deferred',
    detail: string,                    // e.g. "All gateways within normal SoC range (45-85%). No peak risk or tariff opportunity detected."
    contributing_factors: string[]     // e.g. ["4/4 gateways reporting fresh telemetry", "No active posture override"]
  } | null,                            // null when P5 is NOT calm (i.e., intents exist in need_decision_now or platform_acting)
  need_decision_now: IntentCard[],    // approval-gated, active intents
  platform_acting: IntentCard[],      // auto-governed protective intents
  watch_next: IntentCard[],           // observe-only, deferred, expiring
  context: {
    operating_posture: PostureSummary,
    dominant_protector: ProtectorSummary | null,
    recent_handoffs: HandoffSummary[],
    suppressed_count: number,
    deferred_count: number
  }
}
```

**IntentCard shape (Level 1 — triage):**
```typescript
{
  id: number,
  family: string,
  title: string,
  urgency: 'immediate' | 'soon' | 'watch',
  governance_mode: string,
  status: string,
  reason_summary: string,
  scope_summary: string,
  time_pressure: string,             // e.g. "Peak window in ~20 min"
  created_at: string
}
```

### `GET /api/p5/intents/:intentId`

Returns full intent detail (Level 2 — decision panel):
```typescript
{
  ...IntentCard,
  evidence_snapshot: object,          // why now, decision basis
  constraints: object,                // confidence, reserve floors
  next_path: {                        // REQ Level 2 decision grammar: "Next path"
    if_approved: string,              // e.g. "Dispatch peak shaving schedule to 3 gateways"
    if_deferred: string,              // e.g. "Intent remains in watch_next, re-evaluated on next cycle"
    if_no_action: string,             // e.g. "Intent expires in ~45 min if peak window passes"
    suggested_playbook: string | null // recommended playbook if approved
  },
  arbitration_note: string | null,
  handoff_snapshot: object | null,
  available_actions: string[],        // contextual: ['approve','defer','suppress','escalate']
  history: IntentEvent[]              // status transitions on this intent
}
```

### `POST /api/p5/intents/:intentId/approve`

Operator approves an approval-gated intent. M5 validates, calls M2 to transition status to `approved`, then triggers downstream execution path (bounded execution request into existing dispatch plumbing).

**Body:** `{ reason?: string }`
**Response:** `{ success: boolean, intent: IntentCard, execution_ref?: string }`

### `POST /api/p5/intents/:intentId/defer`

Operator defers an intent. Status → `deferred`. Intent remains visible in watch_next.

**Body:** `{ reason?: string, defer_until?: string }`
**Response:** `{ success: boolean, intent: IntentCard }`

### `POST /api/p5/intents/:intentId/suppress`

Operator suppresses an intent. Status → `suppressed`. Intent moves to suppressed count.

**Body:** `{ reason: string }` (reason required for audit)
**Response:** `{ success: boolean, intent: IntentCard }`

### `POST /api/p5/intents/:intentId/escalate`

Operator escalates an intent to P4. Status → `escalated`. M2 builds `handoff_snapshot` with proposed playbook, scope, envelope constraints.

**Body:** `{ reason?: string }`
**Response:** `{ success: boolean, intent: IntentCard, handoff_snapshot: object }`

### `POST /api/p5/posture-override`

Operator creates a temporary posture override.

**Body:**
```typescript
{
  override_type: 'force_protective' | 'suppress_economic' | 'force_approval_gate' | 'manual_escalation_note',
  reason: string,
  scope_gateway_ids?: string[],
  duration_minutes: number            // converted to expires_at server-side
}
```
**Response:** `{ success: boolean, override: PostureOverride }`

### `POST /api/p5/posture-override/:overrideId/cancel`

Operator cancels an active posture override before expiry.

**Body:** `{ reason?: string }`
**Response:** `{ success: boolean, override: PostureOverride }`

---

## 7. Design Decisions and Tradeoffs

### Decision 1: The brain lives in M2, not M5

**Choice:** Strategy evaluation (interpret → qualify → arbitrate) runs as M2 services. M5 only calls these services and shapes responses.

**Why:** M5 is a frontend-serving facade. If qualification and arbitration logic lives in M5 handlers, then:
- M5 handlers become 500+ line decision engines masquerading as HTTP handlers
- Testing requires full HTTP context for pure logic
- Reuse from non-BFF contexts (background evaluation, future webhooks) requires duplicating logic
- The facade layer loses its architectural role

M2 (`optimization-engine/`) already owns decision logic (`schedule-generator.ts`). Adding strategy trigger evaluation is a natural extension of M2's domain.

### Decision 2: P5 reads M8-owned tables but has no M8 runtime dependency

**Choice:** P5 reads `vpp_strategies` (an M8-schema-owned shared DB table) via direct SQL. P5 does not call M8 handlers, import M8 services, or depend on M8 runtime.

**Why:** M8 (`admin-control-plane/`) manages platform-wide VPP strategies and admin configuration. `vpp_strategies` is defined in M8's `admin-control-plane/schema.sql`. P5 needs SoC guardrails, profit margins, and active hours from this table — that is a legitimate read dependency on shared data. However, P5's operator inputs (posture overrides, escalation rationale) are P5-scoped governance inputs, not platform-wide admin settings. Coupling P5 to M8 **runtime** would:
- Create a dependency on admin handler availability for real-time operational governance
- Blur the boundary between platform policy (M8) and operational triage (P5)
- Risk P5 becoming an admin panel rather than an operator governance surface

**What this means concretely:** P5 has a **shared-table read dependency** on `vpp_strategies`, not an M8 runtime dependency. P5 queries the table directly. M8 owns the schema and CRUD for that table; P5 only reads.

### Decision 3: External APIs not required for v6.5 core

**Choice:** The three core condition families (peak shaving, tariff arbitrage, reserve protection) are evaluable from Plane 1 + Plane 2 alone.

**Why:** No first-class external API integration exists today. Building P5 core on an external dependency that doesn't exist yet would make the entire feature speculative. Instead, external context is designed as an additive evidence plane that can be plugged in later without changing the core evaluation model.

### Decision 4: Persistence is intentionally minimal (2 tables)

**Choice:** Only `strategy_intents` and `posture_overrides`. No separate tables for conditions, arbitration results, or handoffs.

**Why:**
- Strategic Conditions are transient computation artifacts. Persisting them creates a growing history table with no clear v6.5 product use case.
- Arbitration results are captured as `arbitration_note` on the winning/losing intent rows.
- Handoff snapshots are stored as `handoff_snapshot` JSONB on the intent row itself.
- This avoids a 5+ table schema that would be premature for v6.5's scope.

**Tradeoff acknowledged:** If future versions need rich arbitration history or condition replay, a dedicated table may be warranted. But that is a v7+ concern, not a v6.5 concern.

### Decision 5: Handoff snapshot lives inside `strategy_intents`

**Choice:** No separate `p4_handoffs` table. Escalated intents carry their handoff context in `handoff_snapshot` JSONB.

**Why:**
- A handoff is a property of an intent's lifecycle, not a standalone entity
- Co-locating avoids join complexity and orphan risk
- P4 reads the handoff snapshot directly from the intent row
- If handoff becomes a rich entity later, extraction is straightforward

### Decision 6: Request-triggered evaluation, not event-driven

**Choice:** P5 evaluates on page load / refresh, not on every telemetry event.

**Why:** Event-driven evaluation requires a persistent evaluation loop, event bus, and careful debouncing. Request-triggered evaluation is simpler, sufficient for operator triage (operators don't need sub-second reactivity), and avoids premature infrastructure. The model is designed so that switching to periodic or event-driven evaluation later only requires changing the trigger mechanism, not the evaluation logic itself.

---

## 8. Risks and Open Questions

### Risks

**R1: Evaluation latency on page load.** If gathering evidence from multiple tables and running qualification/arbitration takes too long, the overview API will feel slow. Mitigation: profile early, consider caching evaluation results with short TTL (30-60s), or running evaluation periodically in background and serving from cache.

**R2: Intent identity stability.** When is a "peak shaving risk" intent the same intent across evaluations vs a new one? Without careful identity logic, the same condition could create duplicate intents on every refresh. Mitigation: define intent identity as (org_id, family, scope_gateway_ids hash, time window) and upsert rather than insert.

**R3: Posture override scope interactions.** An org-wide "force protective" override and a gateway-scoped "suppress economic" override could interact in non-obvious ways. Mitigation: define clear precedence rules (narrower scope wins within same override type; protective always wins over permissive).

**R4: Handoff snapshot staleness.** If an intent is escalated but P4 action is delayed, the evidence snapshot may become stale. Mitigation: include `evidence_snapshot.captured_at` timestamp; P4 UI should warn if snapshot is older than a configurable threshold.

### Open Questions (not reopening settled decisions)

**Q1:** What is the exact freshness threshold below which telemetry is considered too stale for confident intent qualification? (Likely configurable per family, but needs product input.)

**Q2:** Should deferred intents auto-resurface after a timeout, or only on next evaluation cycle? (Simpler: let evaluation cycle handle resurfacing naturally.)

**Q3:** For the tariff/arbitrage family, what is the minimum tariff schedule granularity needed for v6.5? (Current `tariff_schedules` table shape needs verification against actual qualification needs.)

**Q4:** Should `strategy_intents` rows be soft-deleted or hard-deleted after expiry/execution? (Recommend: keep rows with terminal status for audit, add periodic archival later.)

---

## Appendix A: Module Placement Summary

```
backend/src/
├── iot-hub/              (M1 — unchanged, read-only upstream)
├── optimization-engine/  (M2 — add P5 strategy evaluation services here)
│   ├── services/
│   │   ├── schedule-generator.ts        (existing)
│   │   ├── strategy-evaluator.ts        (NEW — gather + interpret + qualify + arbitrate + upsert)
│   │   └── posture-resolver.ts          (NEW — apply overrides)
│   └── ...
├── dr-dispatcher/        (M3 — unchanged, P5 routes approved intents through existing dispatch)
│   ├── services/
│   │   └── command-dispatcher.ts        (existing)
│   └── handlers/
│       ├── dispatch-command.ts          (existing)
│       ├── collect-response.ts          (existing)
│       └── timeout-checker.ts           (existing)
├── admin-control-plane/  (M8 — unchanged; P5 reads vpp_strategies via shared DB)
├── bff/                  (M5 — add P5 API handlers)
│   └── handlers/
│       ├── get-p5-overview.ts           (NEW — homepage read model)
│       ├── get-p5-intent-detail.ts      (NEW — intent detail)
│       ├── post-p5-intent-action.ts     (NEW — approve/defer/suppress/escalate)
│       └── post-p5-posture-override.ts  (NEW — create + cancel override)
├── market-billing/       (M4 — unchanged)
├── open-api/             (unchanged)
└── shared/               (unchanged)
```

## Appendix B: What P5 is NOT

| P5 is NOT | Why |
|-----------|-----|
| A fleet dashboard | That is P1 |
| An energy analytics page | That is P3 |
| A manual dispatch builder | That is P4 |
| A rule editor | Rules are platform policy, not operator triage |
| An event waterfall | P5 shows intents, not raw events |
| An M8-style admin center | Admin config is a different domain |
| A DR event console | External DR is secondary/shadow in v6.5 |
| A KPI wall | Hero expresses posture, not metrics |
