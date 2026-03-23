# PLAN-v6.5-P5-Polish-R2-Backend-Closure-1.0

## Status
Plan 1.0 — aligned against DESIGN-v6.5-P5-Polish-R2-Backend-Closure-1.0.

---

## P1. Phase Breakdown

### Phase 1: Arbitration Status Fix (evaluator)

**Files modified:**
- `backend/src/optimization-engine/services/strategy-evaluator.ts`

**Changes:**
1. Update `ArbitratedIntent` type: add `"deferred"` to status union (line 497)
2. In `arbitrate()` function: set `status: "deferred"` on dominated intents (lines 558, 571)
3. Update arbitration_note text for urgency losers to include "Deferred." suffix

**Validation gate:**
- Run `npx jest backend/test` — all 39 existing tests must pass
- The `arbitrate()` internal export can be tested directly via `_internal.arbitrate`

---

### Phase 2: Overview Handler Fixes (BFF)

**Files modified:**
- `backend/src/bff/handlers/get-p5-overview.ts`

**Changes (in order):**
1. **Lane partition (D3):** Update `needDecisionNow` filter (line 130-132) to include `governance_mode === "escalate"` alongside `approval_required`
2. **Governance summary (D2):** Add `escalateActive` count before existing lane counts (lines 164-184); insert escalation-specific summary part
3. **Calm gate (D1):** Replace condition at line 192 from `needDecisionNow.length === 0 && platformActing.length === 0` to `posture === "calm"`

**Important ordering note:** The lane partition (step 1) must happen before the summary rewrite (step 2) because the summary references lane populations. The calm gate (step 3) references `posture`, which is already computed above the calm block, so it's independent of lane changes.

**Validation gate:**
- Run `npx jest backend/test/bff/p5-overview.test.ts` — existing 4 tests must pass
- Manually verify: the escalation test (test 4) should now also show escalation intents in `need_decision_now` once the new test is added in Phase 3

---

### Phase 3: Test Cases

**Files modified:**
- `backend/test/bff/p5-overview.test.ts`

**Changes:**
Add test cases T1-T8 as specified in DESIGN D7:
1. T1: escalation posture → calm_explanation null
2. T2: escalation posture → meaningful governance_summary
3. T3: escalate+active → populates need_decision_now
4. T4: mixed escalation + approval in need_decision_now
5. T5: dominated intent deferred → appears in watch_next
6. T6: protective dominance → platform_acting visible
7. T7: approval_gated → calm_explanation null
8. T8: protective → calm_explanation null

Optionally add T9-T10 as unit tests for `_internal.arbitrate` in a new or existing evaluator test file.

**Validation gate:**
- Run `npx jest backend/test` — all tests pass (existing 39 + new ~8-10)
- Zero regressions

---

### Phase 4: Minimal Frontend Alignment

**Files modified:**
- `frontend-v2/js/i18n.js` (if `p5.strategy.governance.escalate` key is missing)
- `frontend-v2/css/pages.css` (optional: escalation badge styling)

**Changes:**
1. Verify `p5.strategy.governance.escalate` exists in i18n. If missing, add it with value like `"Escalated"` / `"升級中"`
2. Optional: Add CSS for escalation badge differentiation

**No changes to `p5-strategy.js`** — the existing card rendering handles `governance_mode` generically via i18n lookup.

**Validation gate:**
- Load P5 page on canonical ingress
- Verify: no untranslated keys visible
- Verify: escalation cards render with readable badge text

---

## P2. Guard Rails

### Files that MUST NOT be modified

| File / Directory | Reason |
|-----------------|--------|
| `backend/src/shared/db.ts` | Shared DB infrastructure; P1-P4 dependency |
| `backend/src/shared/types/` | Type changes limited to `p5.ts` only; no other type files |
| `backend/src/iot-hub/` | M1 unchanged; read-only upstream |
| `backend/src/dr-dispatcher/` | M3 unchanged; downstream execution |
| `backend/src/admin-control-plane/` | M8 unchanged; P5 reads only |
| `backend/src/market-billing/` | M4 unchanged |
| `backend/src/bff/handlers/` (except `get-p5-overview.ts`) | Other page handlers unaffected |
| `backend/src/optimization-engine/services/posture-resolver.ts` | Override logic is correct; no changes needed |
| `backend/src/optimization-engine/services/schedule-generator.ts` | Existing M2 service; unrelated |
| `frontend-v2/js/p5-strategy.js` | No structural changes; only i18n/CSS touches if needed |
| All P1-P4 frontend files | Out of scope |
| All schema / migration files | No schema changes in this round |
| `docker-compose.yml` | Infrastructure unchanged |
| `backend/deploy/` | Deployment config unchanged |

### New guard rails for this fix

1. **No new API endpoints.** All changes go through the existing `GET /api/p5/overview` response shape.
2. **No new response fields.** The `P5Overview` type shape does not change. Existing fields get different values.
3. **No new database queries.** The overview handler's SQL query at lines 112-121 remains unchanged.
4. **Arbitration status expansion is additive only.** Adding `"deferred"` to `ArbitratedIntent.status` does not remove existing values.

---

## P3. Risk Assessment

### R1. Could these changes break existing P5 tests?

**Risk: LOW**

- Phase 1 (evaluator): Changes `arbitrate()` output. The 4 existing overview tests mock `evaluateStrategies` and `resolvePosture`, so they don't exercise `arbitrate()` directly. No regression expected.
- Phase 2 (overview handler): Changes lane partition and calm gate. Test 4 (escalation) currently asserts `hero.posture = "escalation"` but does NOT assert `need_decision_now` content — it will still pass. Tests 1-3 don't involve escalation — unaffected.
- After Phase 3 adds new tests, the full suite validates the new behavior.

**Mitigation:** Run full test suite after each phase.

### R2. Could these changes affect P1-P4?

**Risk: NONE**

- All changes are in P5-specific files (`get-p5-overview.ts`, `strategy-evaluator.ts`)
- No shared infrastructure changes
- No database schema changes
- P1-P4 do not call P5 evaluation services

### R3. What is the rollback strategy?

The changes are confined to 2-3 backend files and 1-2 frontend files. Rollback = `git revert` the single commit. Since no schema or data migration is involved, rollback is immediate and clean.

### R4. ArbitratedIntent type change risk

**Risk: LOW**

Adding `"deferred"` to the type union is additive. The `persistIntents` function (line 594) already maps `status: "suppressed"` → persist as `"suppressed"`, and `else` → `"active"`. The new `"deferred"` status will fall into the else branch and persist as `"active"` in the DB.

**Wait — this needs attention.** The `persistIntents` function line 594:
```typescript
status: intent.status === "suppressed" ? "suppressed" : "active",
```

This would override `"deferred"` back to `"active"` during persistence. However, for Polish R2, the deferred status only needs to exist **in the overview read model** (in-memory), not in the DB. The evaluator already re-evaluates on each page load.

**Two options:**
1. Fix `persistIntents` to preserve `"deferred"` status → persists correctly to DB
2. Leave `persistIntents` as-is → deferred intents persist as `"active"`, re-evaluation assigns correct status next cycle

**Recommended: Option 1** — update line 594 to:
```typescript
status: intent.status,
```
This is a one-line change with no risk, since `ArbitratedIntent.status` is already constrained to valid values.

---

## P4. Validation Sequence

### Step 1: Unit Tests
```bash
cd /tmp/solfacil/backend
npx jest test/bff/p5-overview.test.ts --verbose
```
Expected: all existing + new tests pass.

### Step 2: Full Backend Test Suite
```bash
cd /tmp/solfacil/backend
npx jest --verbose
```
Expected: 39 existing + ~10 new = ~49 tests, all pass. Zero regressions.

### Step 3: API Scenario Verification (curl)

#### 3a. Calm scenario (no intents)
```bash
curl -s http://localhost:3000/api/p5/overview \
  -H "Authorization: Bearer <token>" | jq '.data.hero.posture, .data.calm_explanation'
```
Expected: posture=`"calm"`, calm_explanation is non-null.

#### 3b. Escalation scenario (scope collision)
Requires mock data: two active intents with overlapping scope from different actionable families.
```bash
curl -s http://localhost:3000/api/p5/overview \
  -H "Authorization: Bearer <token>" | jq '{
    posture: .data.hero.posture,
    calm: .data.calm_explanation,
    summary: .data.hero.governance_summary,
    decision_lane: (.data.need_decision_now | length),
    action_needed: .data.hero.operator_action_needed
  }'
```
Expected:
- posture=`"escalation"`
- calm=`null`
- summary contains "arbitration"
- decision_lane >= 1
- action_needed=`true`

#### 3c. Protective dominance scenario
Requires: one reserve_protection auto_governed active + one economic intent deferred.
```bash
curl -s http://localhost:3000/api/p5/overview \
  -H "Authorization: Bearer <token>" | jq '{
    posture: .data.hero.posture,
    calm: .data.calm_explanation,
    acting: (.data.platform_acting | length),
    watch: (.data.watch_next | length)
  }'
```
Expected:
- posture=`"protective"`
- calm=`null`
- acting=1
- watch >= 1 (the deferred economic intent)

### Step 4: Frontend Visual Verification

On canonical ingress `http://152.42.235.155`:

1. **Calm state:** Hero shows calm posture with explanation. No contradictory badges.
2. **Escalation state:** Hero shows escalation posture. `need_decision_now` lane has escalation card(s). No "No active strategy intents" summary visible.
3. **Protective state:** Hero shows protective posture. `platform_acting` has protector card. Dominated intents appear in `watch_next`.
4. **No calm_explanation leak:** In any non-calm posture, verify the calm explanation block is absent from the DOM.
5. **Causal trace intact:** All postures show the trigger → constraint → outcome trace line.

### Step 5: Regression Smoke

- Navigate P1-P4 pages to confirm no visual/functional regression
- Confirm no console errors on P5 page
- Confirm API response time for `/api/p5/overview` is comparable to pre-fix (~same order of magnitude)
