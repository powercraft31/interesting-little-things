# PLAN-v6.5-P5-Polish-R3-Micro-Closure-1.0

## Status
Plan 1.0 — aligned against DESIGN-v6.5-P5-Polish-R3-Micro-Closure-1.0.

---

## P1. Ordered Steps

### Phase 1: i18n Keys + Page Naming (D2 + i18n for D1/D3)

**Files modified:**
- `frontend-v2/js/i18n.js`

**Changes:**
1. Update `nav.vpp` values in all three language blocks:
   - EN: `"VPP"` → `"Strategy"`
   - PT-BR: `"VPP"` → `"Estratégia"`
   - ZH-CN: `"VPP & DR"` → `"策略"`

2. Update `page.vpp` values in all three language blocks:
   - EN: `"VPP & DR"` → `"Strategy Triggers"`
   - PT-BR: `"VPP & DR"` → `"Gatilhos de Estratégia"`
   - ZH-CN: `"VPP & DR"` → `"策略触发"`

3. Add new keys in all three language blocks:
   - `p5.strategy.badge.deferred`: `"Deferred"` / `"Adiado"` / `"已延迟"`
   - `p5.strategy.badge.deferredBy`: `"Originally: {mode}"` / `"Original: {mode}"` / `"原治理: {mode}"`
   - `p5.strategy.ctx.countsHelper`: (full text as specified in DESIGN D3)

**Validation gate:**
- No syntax errors in i18n.js (load page, check console)
- Language switcher works for all three languages

---

### Phase 2: Card Grammar + Counter Helper (D1 + D3)

**Files modified:**
- `frontend-v2/js/p5-strategy.js`
- `frontend-v2/css/pages.css`

**Changes in `p5-strategy.js`:**

1. **`_buildIntentCard` (lines 344-381):** Modify badge logic:
   - If `intent.status === "deferred"`: render primary badge as `t("p5.strategy.badge.deferred")` with `p5-strategy-status-deferred` class
   - Add secondary muted badge: `t("p5.strategy.badge.deferredBy").replace("{mode}", t("p5.strategy.governance." + intent.governance_mode))`
   - If `intent.arbitration_note`: render as `<div class="p5-strategy-intent-arb-note">` below reason_summary
   - If `intent.status !== "deferred"`: keep existing badge rendering unchanged

2. **`_buildContextSection` (lines 586-597):** After the counts div, add:
   ```javascript
   '<div class="p5-strategy-ctx-counts-helper">' + t("p5.strategy.ctx.countsHelper") + '</div>',
   ```

**Changes in `pages.css`:**

1. Add helper text styling:
   ```css
   .p5-strategy-ctx-counts-helper {
     font-size: 0.75rem;
     color: var(--muted);
     margin-top: 6px;
     line-height: 1.4;
   }
   ```

2. Add arbitration note styling:
   ```css
   .p5-strategy-intent-arb-note {
     font-size: 0.72rem;
     color: var(--muted);
     font-style: italic;
     margin-top: 4px;
   }
   ```

**Validation gate:**
- Load P5 page, verify deferred cards show correct badge
- Verify counter helper text appears when counts are visible
- Switch languages, verify all three render correctly

---

## P2. Files Touched

### Files that WILL change

| File | Phase | Changes |
|------|-------|---------|
| `frontend-v2/js/i18n.js` | 1 | 6 key value updates + 9 new keys (3 per language) |
| `frontend-v2/js/p5-strategy.js` | 2 | ~15-20 lines in `_buildIntentCard` + ~2 lines in `_buildContextSection` |
| `frontend-v2/css/pages.css` | 2 | ~12 lines (2 new CSS rules) |

### Files that MUST NOT change

| File | Reason |
|------|--------|
| `frontend-v2/js/app.js` | PAGES array structure unchanged; page id/hash stay as `vpp`/`#vpp` |
| `backend/src/**` | No backend changes in R3 |
| `backend/test/**` | No test changes needed (frontend-only round) |
| `backend/src/shared/db.ts` | Shared infrastructure |
| `backend/src/optimization-engine/**` | Evaluator unchanged |
| `backend/src/bff/handlers/**` | Overview handler unchanged |
| `docker-compose.yml` | Infrastructure unchanged |
| `backend/deploy/**` | Deployment config unchanged |
| All P1-P4 page JS files | Out of scope |

---

## P3. Validation Sequence

### Step 1: Syntax Check
```bash
# Verify no JS syntax errors
node -c frontend-v2/js/i18n.js
node -c frontend-v2/js/p5-strategy.js
```
Expected: no errors.

### Step 2: Canonical Ingress Verification

On `http://152.42.235.155`:

#### 2a. Page naming (D2)
1. Navigate to the P5 page
2. **Verify sidebar nav** shows `Strategy` (EN), `Estratégia` (PT-BR), or `策略` (ZH-CN) — NOT `VPP`
3. **Verify page title** shows `Strategy Triggers` (EN), `Gatilhos de Estratégia` (PT-BR), or `策略触发` (ZH-CN) — NOT `VPP & DR`
4. Switch all three languages and verify each

#### 2b. Deferred card badge (D1)
1. Ensure test data produces at least one deferred card in `watch_next`
2. **Verify primary badge** reads `Deferred` / `Adiado` / `已延迟` — NOT the governance mode
3. **Verify secondary info** shows the original governance mode in muted text
4. **Verify arbitration note** appears if the intent has one

#### 2c. Deferred counter helper (D3)
1. Navigate to P5 with data that produces `deferred_count > 0`
2. **Verify helper text** appears below the counts: `"Strategy intents deferred or suppressed by governance rules. Not all may appear in triage lanes above."`
3. Switch languages and verify translations

### Step 3: Regression Smoke
- Verify P1-P4 pages render correctly (no shared code broken)
- Verify P5 hero section, triage lanes, and detail panel still work
- Verify no console errors on P5 page
- Verify language switcher works across all pages

---

## P4. Risk / Rollback

### Why this round is low-risk

1. **Frontend-only** — no backend, no schema, no API changes. The contract established in R2 is untouched.
2. **Three small, independent changes** — each can be implemented and verified separately. A bug in one does not affect the others.
3. **No structural changes** — existing rendering functions are modified minimally. No new modules, no new data flows.
4. **Additive i18n** — new keys are added; existing keys are updated in-place. No key deletions.
5. **CSS additions only** — new classes added, no existing classes modified.

### Rollback

If any change causes issues:
- `git revert` the single commit reverts all three changes cleanly
- No data migration, no backend state, no persistent side effects
- The page returns to its R2 state immediately

### Known non-risks
- The page `id` and hash route do NOT change, so bookmarks and deep links to `#vpp` continue to work
- The `StrategyPage` JS object name does NOT change, so `app.js` routing is unaffected
- Backend mock data already includes `status: "deferred"` and `arbitration_note` fields (established in R2), so the frontend changes will render correctly with existing data
