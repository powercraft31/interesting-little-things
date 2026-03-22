# PLAN-v6.5-P5-Strategy-Triggers-1.0

## Status
Plan 1.0 — implementation plan aligned against DESIGN-v6.5-P5-Strategy-Triggers-1.0.

---

## 1. Scope of Work

### 1A. Backend Schema Work
- Create `strategy_intents` table
- Create `posture_overrides` table
- Add migration script
- Add seed data for local development

### 1B. M2 Runtime Decision Work (extending `optimization-engine/`)
- `strategy-evaluator.ts` — evidence gathering + condition interpretation + qualification + arbitration + intent upsert/lifecycle (reconciliation is the tail end of evaluation, not a separate domain)
- `posture-resolver.ts` — active override resolution and governance mode adjustment

### 1C. M5 API Facade Work
- `get-p5-overview.ts` — homepage read model assembly
- `get-p5-intent-detail.ts` — single intent detail
- `post-p5-intent-action.ts` — approve / defer / suppress / escalate
- `post-p5-posture-override.ts` — create + cancel posture override (one handler, action by route suffix)
- Route registration in `local-server.ts`

### 1D. Frontend P5 Page Work
- P5 page skeleton and routing
- Hero posture component
- Triage sections: need_decision_now, platform_acting, watch_next
- Intent card (Level 1) component
- Intent detail panel (Level 2) component
- Operator action buttons and confirmation flows
- Posture override creation UI
- Right rail context cards
- Four-state visual treatment (calm, approval-gated, protective, escalation)

### 1E. Validation and Test Work
- M2 service unit tests (evaluation including reconciliation, posture resolution)
- M5 handler integration tests (API contract verification)
- Frontend visual/workflow validation against canonical ingress
- End-to-end runtime acceptance with real/mock data

---

## 2. Ordered Phases

### Phase 1: Schema + Persistence Contracts
**Goal:** Tables exist, migration runs, TypeScript types are defined.

**Tasks:**
1. Write SQL migration for `strategy_intents` and `posture_overrides` tables (using `BIGSERIAL` PKs, `VARCHAR(50)` for org_id/gateway refs, `JSONB` for scope_gateway_ids — matching `ddl_base.sql` style)
2. Define TypeScript interfaces: `StrategyIntent`, `PostureOverride`, `IntentCard`, `P5Overview` (intent/override `id` fields are `number` since BIGSERIAL maps to number in TS; `org_id` is `string`)
3. Add basic CRUD helpers in `shared/db.ts` or a new `shared/p5-db.ts` for intent and override operations
4. Write seed script with representative test intents across all families and statuses
5. Verify migration runs cleanly on local `solfacil-db`

**Deliverables:**
- Migration file applied to local DB
- TypeScript type definitions importable by M2 and M5
- Seed data producing at least one intent per family and one active override
- `SELECT * FROM strategy_intents` and `SELECT * FROM posture_overrides` return expected rows

**Estimated file changes:**
- `backend/src/shared/migrations/` — new migration file
- `backend/src/shared/types/p5.ts` — new type definitions
- `backend/src/shared/p5-db.ts` — new DB helpers
- `backend/scripts/seed-p5.ts` — new seed script

---

### Phase 2: M2 Intent Evaluation and Reconciliation
**Goal:** M2 (`optimization-engine/`) can evaluate current state, produce strategy intents, and persist them. This extends M2's existing decision capability (alongside `schedule-generator.ts`).

**Tasks:**
1. Implement `strategy-evaluator.ts`:
   - Evidence gatherer: reads from `device_state`, `asset_5min_metrics`, `gateways`, `tariff_schedules`, `vpp_strategies` (shared DB, M8-schema-owned), `device_command_logs`
   - Condition interpreter: per family (peak_shaving, tariff_arbitrage, reserve_protection), interprets evidence into typed condition objects
   - Qualifier: applies freshness, confidence, boundedness, protection constraint checks
   - Governance mode assigner: applies family baseline map from DESIGN Section 4.5, then instance-level promotion/demotion rules (telemetry freshness, confidence, scope collision, playbook availability, boundedness)
   - Arbitrator (reconciliation — tail end of evaluation, not a separate domain): applies dominance rules (protective > economic; higher urgency > lower; scope collision → escalate)
   - Upserts `strategy_intents` rows with stable identity logic (org_id + family + scope hash + time window)
   - Marks stale intents as expired
2. Implement `posture-resolver.ts`:
   - Reads active `posture_overrides`
   - Adjusts governance_mode on intents (e.g., force_protective override → economic intents get suppressed)
   - Returns resolved intent set
3. Write unit tests for each service with mock evidence data

**Deliverables:**
- Calling `strategyEvaluator.evaluate(orgId)` produces qualified conditions, arbitrates, and upserts correct `strategy_intents` rows
- Calling `postureResolver.resolve(orgId, intents)` returns governance-adjusted intents
- Unit tests pass for: normal calm state, single peak intent, tariff opportunity suppressed by reserve protection, scope collision escalation, posture override forcing protective mode

**File changes:**
- `backend/src/optimization-engine/services/strategy-evaluator.ts` — new
- `backend/src/optimization-engine/services/posture-resolver.ts` — new
- `backend/test/optimization-engine/strategy-evaluator.test.ts` — new (covers evaluation + reconciliation)
- `backend/test/optimization-engine/posture-resolver.test.ts` — new

---

### Phase 3: M5 P5 APIs
**Goal:** All P5 API endpoints are functional and return correct shaped responses.

**Tasks:**
1. Implement `get-p5-overview.ts`:
   - Calls M2 evaluation pipeline (evaluate → resolve)
   - Assembles hero posture from resolved intent set, including `governance_mode` (dominant enum), `governance_summary` (prose), and `conflict_active` (boolean from unresolved scope collisions)
   - Assembles `calm_explanation` when `need_decision_now` and `platform_acting` are both empty (reason enum + detail string + contributing_factors array)
   - Partitions intents into need_decision_now / platform_acting / watch_next
   - Builds context cards (dominant protector, recent handoffs, suppressed/deferred counts)
   - Returns `P5Overview` response
2. Implement `get-p5-intent-detail.ts`:
   - Reads single intent from DB
   - Enriches with available_actions based on current status and governance_mode
   - Assembles `next_path` object (if_approved, if_deferred, if_no_action, suggested_playbook) from intent family and context
   - Returns full detail with evidence_snapshot, constraints, next_path, history
3. Implement `post-p5-intent-action.ts`:
   - Single handler with action parameter (approve, defer, suppress, escalate)
   - Validates action is allowed for current intent state
   - Calls M2 service to transition status
   - For approve: triggers downstream execution via existing batch-dispatch path
   - For escalate: calls M2 to build handoff_snapshot, stores on intent
4. Implement `post-p5-posture-override.ts` (handles both create and cancel by route suffix)
5. Register all routes in `local-server.ts`
6. Write integration tests for each endpoint

**Deliverables:**
- `curl GET /api/p5/overview` returns valid P5Overview JSON
- `curl GET /api/p5/intents/:id` returns full intent detail
- `curl POST /api/p5/intents/:id/approve` transitions intent and returns success
- All governance actions produce correct status transitions
- Posture override CRUD works end-to-end
- Integration tests pass for happy path and key error cases

**File changes:**
- `backend/src/bff/handlers/get-p5-overview.ts` — new
- `backend/src/bff/handlers/get-p5-intent-detail.ts` — new
- `backend/src/bff/handlers/post-p5-intent-action.ts` — new
- `backend/src/bff/handlers/post-p5-posture-override.ts` — new (handles create + cancel)
- `backend/scripts/local-server.ts` — modified (add routes)
- `backend/test/bff/p5-overview.test.ts` — new
- `backend/test/bff/p5-intent-action.test.ts` — new
- `backend/test/bff/p5-posture-override.test.ts` — new

---

### Phase 4: Frontend P5 Integration
**Goal:** P5 page is functional in the browser, connected to real APIs.

**Tasks:**
1. Create P5 page entry point and navigation link
2. Implement hero posture component:
   - Visual treatment for four states (calm/approval-gated/protective/escalation)
   - Dominant driver, `governance_mode` badge (formal enum), `governance_summary` (prose), override indicator, `conflict_active` indicator
   - Calm state: render `calm_explanation` (reason, detail, contributing factors) in hero/main area when no active intents exist
3. Implement triage sections:
   - need_decision_now: intent cards with action buttons
   - platform_acting: intent cards with status badges
   - watch_next: intent cards with muted treatment
4. Implement intent card (Level 1):
   - Family icon, title, urgency badge, governance mode badge
   - Reason summary, scope summary, time pressure
   - Click to expand detail
5. Implement intent detail panel (Level 2):
   - Evidence breakdown (why now, decision basis)
   - Scope & impact
   - Constraints & confidence
   - Next path section: render `next_path.if_approved`, `next_path.if_deferred`, `next_path.if_no_action`, and `next_path.suggested_playbook`
   - Available actions with confirmation dialogs
6. Implement posture override UI:
   - Override creation form (type, reason, duration, scope)
   - Active override display with cancel action
7. Implement right rail context cards
8. Wire all components to P5 API via data-source layer
9. Visual QA across four operating states

**Deliverables:**
- P5 page loads via canonical ingress
- Hero correctly reflects current posture
- Intent cards display in correct triage sections
- Operator can approve/defer/suppress/escalate intents
- Posture override can be created and cancelled
- Page handles calm state (empty triage sections) gracefully
- Four operating modes visually distinguishable

**File changes:**
- `frontend-v2/js/p5-strategy.js` — new (replaces legacy `p5-vpp.js`)
- `frontend-v2/js/data-source.js` — modified (add P5 API methods)
- `frontend-v2/pages/` or equivalent — modified (P5 page template)
- `frontend-v2/css/` — modified (P5 styles)

---

### Phase 5: Runtime Validation and UX Acceptance
**Goal:** P5 works as a coherent product surface, not just a technical integration.

**Tasks:**
1. Backend correctness checks:
   - Verify evaluation produces correct intents from seed data
   - Verify arbitration precedence (protective > economic)
   - Verify posture override correctly adjusts governance modes
   - Verify intent expiry works
2. API contract verification:
   - Verify overview response shape matches TypeScript types
   - Verify all governance actions produce correct state transitions
   - Verify error responses for invalid actions (e.g., approve an already-suppressed intent)
3. Runtime checks against local flow:
   - With live `solfacil-db` data, verify evaluation picks up real gateway states
   - With seed overrides, verify hero posture changes
   - Verify approve → downstream execution path triggers correctly
4. Frontend visual/workflow validation:
   - Navigate to P5 via canonical ingress (`http://152.42.235.155`)
   - Verify hero state matches backend reality
   - Walk through operator approval flow end-to-end
   - Walk through escalation flow, verify handoff snapshot content
   - Verify calm state is quiet and clean
   - Verify posture override lifecycle (create → see effect → cancel → see removal)
5. Product behavior closure check:
   - Operator can answer "what now?" within seconds
   - Each intent card explains "why now" without leaving context
   - P4 handoff feels like a governed transfer, not a punt
   - Override creation feels deliberate, not accidental

**Deliverables:**
- All backend tests pass
- All API integration tests pass
- Browser walkthrough of all four operating modes documented (screenshots or notes)
- No silent errors in server logs during validation
- Product behavior closure checklist completed

---

## 3. Deliverables per Phase Summary

| Phase | Key Deliverable | Acceptance Signal |
|-------|----------------|-------------------|
| 1 | Tables + types + seed data | Migration runs, seed data queryable |
| 2 | M2 evaluation pipeline | Unit tests pass for all condition families |
| 3 | P5 API endpoints | curl returns correct responses for all endpoints |
| 4 | P5 frontend page | Page loads and is interactive via canonical ingress |
| 5 | Runtime acceptance | End-to-end product behavior validated |

---

## 4. Validation Strategy

### Backend Correctness
- Unit tests for each M2 service with controlled mock evidence
- Test each condition family independently: peak shaving, tariff arbitrage, reserve protection
- Test arbitration scenarios: single intent, competing intents, scope collision
- Test posture override effects on governance modes
- Test intent lifecycle transitions: active → approved → executed; active → deferred → re-evaluated; active → suppressed

### API Contract Verification
- Integration tests calling each endpoint with valid and invalid payloads
- Verify response shapes match TypeScript type definitions
- Verify HTTP status codes: 200 for success, 400 for invalid action, 404 for unknown intent, 409 for invalid state transition

### Runtime Checks Against Live/Local Flow
- Run evaluation against real `solfacil-db` with actual gateway data
- Verify intent formation makes sense given real fleet state
- Verify no SQL errors or type mismatches with real data shapes

### Frontend Visual/Workflow Validation
- Access via `http://152.42.235.155` (canonical ingress)
- Manual walkthrough of each operating mode
- Verify responsive behavior (hero, cards, detail panels)
- Verify operator action flows produce visible state changes on page

---

## 5. Non-Goals / Anti-Scope

### Explicitly out of scope for this plan

1. **Event-driven evaluation loop** — v6.5 uses request-triggered evaluation. Background/push evaluation is future work.

1a. **Active evaluation of secondary families** — `resilience_preparation` and `curtailment_mitigation` are defined in schema (family enum) but not actively evaluated in v6.5 Phase 2. They exist as vocabulary for future condition families.

2. **External API integration** — No market price feeds, utility APIs, DR event feeds, or weather APIs. Plane 3 is designed for but not implemented.

3. **M8 runtime integration** — No calling M8 handlers or importing M8 services. P5 reads M8-schema-owned `vpp_strategies` table via direct SQL as shared DB truth, but has no M8 runtime dependency.

4. **Rich arbitration history table** — Arbitration outcomes are captured as text notes on intents, not as a separate relational model.

5. **Condition persistence** — Strategic conditions are transient computation artifacts. No `strategic_conditions` table.

6. **Notification/alerting** — P5 does not push notifications to operators. It is a pull-based triage surface.

7. **Multi-tenant governance policy configuration** — All condition families share the same governance doctrine. Per-tenant policy customization is future work.

8. **P5-originated direct device commands** — P5 governance actions (approve, escalate) route through existing P4/M2 execution paths. P5 never publishes MQTT directly.

9. **Legacy P5 migration** — Legacy VPP page (`p5-vpp.js`) is replaced, not migrated. No data migration from legacy VPP reporting.

10. **Performance optimization** — No caching layer, no read replicas, no materialized views. If evaluation latency becomes a problem, it will be addressed as a separate focused fix after Phase 5.

---

## 6. Dependencies and Sequencing Constraints

```
Phase 1 (Schema) ──→ Phase 2 (M2 Services) ──→ Phase 3 (M5 APIs) ──→ Phase 4 (Frontend) ──→ Phase 5 (Validation)
                                                       │
                                                       └── Phase 2 must be complete before Phase 3
                                                           (M5 handlers call M2 services)
```

- Phase 1 is prerequisite for all subsequent phases (types and tables must exist)
- Phase 2 is prerequisite for Phase 3 (M5 calls M2 services)
- Phase 3 is prerequisite for Phase 4 (frontend calls M5 APIs)
- Phase 4 is prerequisite for Phase 5 (validation requires working frontend)
- Within each phase, tasks can be partially parallelized (e.g., multiple M2 services can be developed concurrently, but must share the same type definitions from Phase 1)

---

## 7. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Evaluation latency | Profile in Phase 3; add short-TTL cache if >2s response time |
| Intent identity duplication | Define identity key in Phase 2; add unique constraint; test upsert logic |
| Posture override precedence confusion | Document precedence rules in Phase 2; test edge cases |
| Handoff snapshot staleness | Include `captured_at` timestamp; P4 warns on old snapshots |
| Schema scope creep | Strictly 2 tables; any proposed addition requires explicit tradeoff discussion |
| Frontend scope creep into P4-like dispatch | P5 actions are governance actions only; approve routes to existing dispatch path |
