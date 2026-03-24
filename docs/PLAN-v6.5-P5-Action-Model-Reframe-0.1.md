# PLAN-v6.5-P5-Action-Model-Reframe-0.1

## Status
Plan 0.1b — amended to include Phases 7–15 for the ongoing case model, defer-until state machine, review-later interaction, and escalation CTA correction. Aligned against DESIGN-v6.5-P5-Action-Model-Reframe-0.1 v0.1b and REQ-v6.5-P5-Action-Model-Reframe-0.1 v0.1b (2026-03-24). Supersedes Plan 0.1a. Phases 0–4 are complete. Phases 5–6 from the original plan are preserved at their prior status.

## Scope
Restructures the P5 homepage rendering within `p5-strategy.js` and related i18n/CSS. Three minor backend prerequisite changes (type additions and field enrichments) are completed in Phase 0. Phases 7–10 add backend support for defer-until persistence, ongoing case fingerprint grouping, and worsening-condition breakout. Phases 11–14 add the frontend review-later interaction and deferred-state rendering. Phase 15 is integration testing. One minor schema migration (single column addition). No new API routes. No new files unless strictly necessary.

---

## Phase 0: Backend Prerequisites ✅ COMPLETE

### Goal
Complete the 3 minor backend changes that enable the reframed homepage to function correctly. These are additive, low-risk changes — no new API routes, no database migrations, no schema changes.

### Task 0.1 — Add `suppress_alerts` override type

| File | Change |
|------|--------|
| `backend/src/shared/types/p5.ts` | Add `\| 'suppress_alerts'` to the `OverrideType` union type. |
| `backend/src/bff/handlers/post-p5-posture-override.ts` | Add `"suppress_alerts"` to the `VALID_OVERRIDE_TYPES` array. |
| `backend/src/optimization-engine/services/posture-resolver.ts` | Add `case 'suppress_alerts': return intent;` to the `applyOverride()` switch. This override type does NOT change posture — it returns the intent unchanged. |

### Task 0.2 — Add `recovery_condition` to IntentCard

| File | Change |
|------|--------|
| `backend/src/shared/types/p5.ts` | Add `readonly recovery_condition: string \| null` to the `IntentCard` interface. |
| `backend/src/bff/handlers/get-p5-overview.ts` | Update `intentToCard()` to compute `recovery_condition` from the intent's `evidence_snapshot`. Logic: for `reserve_protection` with SoC below threshold → `"SoC > 30%"`; for deferred/suppressed economic intents → `"SoC > 30%"` (depends on dominant protector); for `peak_shaving` → `"Demanda < contratada"`; otherwise → `null`. |

### Task 0.3 — Add `current_soc` and `threshold` to ProtectorSummary

| File | Change |
|------|--------|
| `backend/src/shared/types/p5.ts` | Add `readonly current_soc: number \| null` and `readonly threshold: number \| null` to the `ProtectorSummary` interface. |
| `backend/src/bff/handlers/get-p5-overview.ts` | When building `dominantProtectorSummary`, extract `current_soc` from `dominantProtector.evidence_snapshot.avg_soc` and `threshold` from the reserve warning constant (30). If no dominant protector exists, both remain `null`. |

### Acceptance criteria
- All existing P5 backend tests still pass.
- `POST /api/p5/posture-override` with `override_type: "suppress_alerts"` returns 200 (not 400 validation error).
- `suppress_alerts` override does NOT change platform posture — intents remain unmodified after posture resolution.
- `GET /api/p5/overview` response includes `recovery_condition` on each intent card in `need_decision_now[]`, `platform_acting[]`, and `watch_next[]`.
- `GET /api/p5/overview` response includes `current_soc` and `threshold` on `context.dominant_protector` when a reserve protector is active.

### Verification
- Run existing P5 test suite — all green.
- Call `POST /api/p5/posture-override` with `{ "override_type": "suppress_alerts", "reason": "test", "duration_minutes": 30 }` → verify 200 response.
- Call `GET /api/p5/overview` → verify `recovery_condition` field exists on intent cards.
- Call `GET /api/p5/overview` when reserve protection is active → verify `context.dominant_protector.current_soc` and `context.dominant_protector.threshold` are populated.

---

## Phase 1: Homepage Shell + Hero + Impact Strip ✅ COMPLETE

### Goal
Replace the existing triage-lane layout (Need Decision Now / Platform Acting / Watch Next) with the new single-decision cockpit layout. Hero renders posture-first. Impact strip renders downstream consequences.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | Rewrite `render()` to call new helper methods: `_renderHero()`, `_renderImpactStrip()`. Remove old `_renderNeedDecisionNow()`, `_renderPlatformActing()`, `_renderWatchNext()` lane renderers. Keep data fetching and state management intact. |
| `frontend-v2/css/p5-strategy.css` | Add hero banner styles (`.hero`, `.hero-top`, `.hero-icon`, `.hero-body`, `.hero-rec`, `.hero-narrative`, `.hero-metrics`, `.hero-metric`). Add impact strip styles (`.impact-strip`, `.impact-icon`, `.impact-reason`). Remove old lane-specific styles if they conflict. |
| `frontend-v2/js/i18n.js` | Add hero recommendation keys (`p5.strategy.hero.rec.*`) and impact strip keys (`p5.strategy.impact.*`). |

### Acceptance criteria
- Page loads and shows hero banner with posture-specific recommendation title.
- Hero narrative explains why the platform is in this posture.
- Hero metrics show SoC, threshold, and posture badge as chips.
- Impact strip shows affected downstream strategy with causal link and recovery condition.
- Impact strip is hidden when no downstream strategy is affected.
- No JavaScript errors in console.
- Other pages (P1–P4, P6) are not affected.

### Verification
- Load `#vpp` page. Hero should render with current posture data.
- Check mock/demo mode: hero should show `Recomendação: manter proteção de reserva ativa` for the low-reserve scenario.
- Impact strip should show `Arbitragem tarifária: suspensa`.
- Navigate to other pages and back — no stale state.

---

## Phase 2: Main CTA Pair with Visual Hierarchy ✅ COMPLETE

### Goal
Render the asymmetric CTA pair below the impact strip. Primary CTA (decision confirmation) dominates visually. Secondary CTA (manual adjustment navigation) is clear but subordinate.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | Add `_renderCtaPair(data)` method. Primary CTA label varies by posture. Secondary CTA always shows `Abrir painel HEMS para ajustar`. Wire click handlers: primary → sets `selectedAction = 'keep'`, calls `_updatePreview()`, shows toast. Secondary → sets `selectedAction = 'adjust'`, writes handoff context to `DemoStore`, navigates to `#hems`. |
| `frontend-v2/css/p5-strategy.css` | Add CTA pair styles (`.cta-pair`, `.cta-primary`, `.cta-secondary`, hover/clicked states). Asymmetric flex: primary `flex: 1.3`, secondary `flex: 1`. |
| `frontend-v2/js/i18n.js` | Add CTA label keys (`p5.strategy.cta.keep.*`, `p5.strategy.cta.adjust`). |

### Acceptance criteria
- Two CTAs render side-by-side with clear visual hierarchy.
- Primary CTA has green border, gradient background, "Recomendado" badge.
- Secondary CTA has blue border, arrow icon, less visual weight.
- Clicking primary CTA shows confirmation toast.
- Clicking secondary CTA navigates to `#hems` with `p5_handoff` context in `DemoStore`.
- On screens < 900px, CTAs stack vertically.

### Verification
- Click primary CTA → toast appears at bottom center → auto-dismisses after 3.5s.
- Click secondary CTA → page navigates to HEMS → `DemoStore.get('p5_handoff')` contains posture + SoC data.
- Resize browser below 900px → CTAs stack.

---

## Phase 3: Override Section with Staged Confirmation ✅ COMPLETE

### Goal
Render the override section with the three-step confirmation gate. Card starts collapsed. Expanding reveals duration chips and risk warning. Selecting a duration reveals the confirm button. Confirming calls the override API.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | Add `_renderOverrideSection(data)` method. Add state fields: `_overrideExpanded`, `_overrideDuration`, `_overrideConfirmVisible`. Add handlers: `_toggleOverride()`, `_selectOverrideDuration(value)`, `_confirmOverride()`. Wire `POST /api/p5/posture-override` on confirm. After confirm, refresh overview data. |
| `frontend-v2/css/p5-strategy.css` | Add override styles (`.override-card`, `.override-expand`, `.dur-row`, `.dur-chip`, `.override-warning`, `.override-confirm-btn`, `.override-risk-tag`). |
| `frontend-v2/js/i18n.js` | Add override keys (`p5.strategy.override.*`). |

### Acceptance criteria
- Override section renders below CTAs, separated by a divider.
- Section header shows "Override temporário" with ⚠ icon.
- Override card shows label + description + "Risco" badge.
- Clicking card expands it: duration chips + risk warning appear.
- Clicking a duration chip highlights it and reveals the confirm button with the selected duration.
- Clicking confirm button calls API, shows toast, refreshes page data.
- Clicking outside or re-clicking the card collapses it and resets gate state.
- Override section is hidden when posture is `calm` or `approval_gated`.

### Verification
- Expand override card → select "30 min" → confirm button appears with text "Confirmar override por 30 min".
- Click confirm → toast: `⚠ Override ativo por 30 min. Arbitragem liberada temporariamente.`
- After confirm, page refreshes and hero shows override-active indicator.
- Click card, then click outside → card collapses, no API call.

---

## Phase 4: Alert Control Section ✅ COMPLETE

### Goal
Render the alert silence section. Simpler than override: expand → select duration → auto-confirm.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | Add `_renderAlertSection()` method. Add state fields: `_alertExpanded`, `_alertDuration`. Add handlers: `_toggleAlert()`, `_selectAlertDuration(value)`. Selecting a duration auto-confirms: calls API, shows toast. |
| `frontend-v2/css/p5-strategy.css` | Add alert styles (`.alert-card`, `.alert-expand`, `.alert-note`). |
| `frontend-v2/js/i18n.js` | Add alert keys (`p5.strategy.alert.*`). |

### Acceptance criteria
- Alert section renders below override section.
- Section header shows "Controle de alertas" with 🔔 icon.
- Alert card shows label + description.
- Clicking card expands it: duration chips + severity note appear.
- Selecting a duration auto-confirms: toast shows, card gets checkmark.
- Alert section is always visible regardless of posture.
- Alert card visually reads as notification management, not strategy action.

### Verification
- Expand alert card → select "2 h" → toast: `🔕 Alertas repetidos silenciados por 2 h.`
- Card gets checkmark after selection.
- Verify visual weight is clearly lighter than override section.

---

## Phase 5: Result Preview Panel with Dynamic Content

### Goal
Render the result preview area that updates dynamically based on the currently selected action. Shows tagged consequence items per action type.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | Add `_renderResultPreview()` method. Add `_updatePreview(actionKey)` method that swaps preview content based on `selectedAction`. Define preview content map (tag + items per action type). Wire all action handlers to call `_updatePreview()`. |
| `frontend-v2/css/p5-strategy.css` | Add preview styles (`.preview-area`, `.preview-header`, `.preview-default`, `.preview-body`, `.preview-tag`, `.preview-items`, `.preview-item`, tag variants). |
| `frontend-v2/js/i18n.js` | Add preview keys (`p5.strategy.preview.*`). |

### Acceptance criteria
- Preview area renders at the bottom with header "O que acontece a seguir".
- Default state shows italic placeholder text.
- Clicking any action (primary CTA, secondary CTA, override, alert) updates preview content.
- Preview shows correct tag per action type (green/blue/amber/gray).
- Preview shows bulleted consequence items.
- Preview border color changes per action type.
- Duration placeholder (`{dur}`) in override/alert previews is filled with selected duration.

### Verification
- Click primary CTA → preview shows green "Decisão confirmada" tag + 4 consequence items.
- Click secondary CTA → preview shows blue "Navegação" tag + 3 items.
- Expand override + select duration → preview shows amber "Override ativo" tag with duration filled.
- Expand alert + select duration → preview shows gray "Alertas" tag with duration filled.

---

## Phase 6: Polish + Integration Verification

### Goal
Final pass: verify all components work together, fix visual inconsistencies, ensure no regressions, and verify the page passes the REQ acceptance criteria.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | Clean up removed code (old lane renderers, old intent card renderers that are no longer called). Ensure no dead code remains. |
| `frontend-v2/css/p5-strategy.css` | Remove orphaned styles from old layout. Verify dark theme consistency across all new components. |
| `frontend-v2/js/i18n.js` | Verify all new keys have PT-BR values. Remove orphaned keys from old layout if any. |

### Acceptance criteria (from REQ)

**5-second test — operator must be able to answer:**
1. What is the platform recommending right now? → Hero banner
2. Why is it recommending that? → Hero narrative
3. What important downstream strategy is currently affected? → Impact strip
4. What is the default action if I agree? → Primary CTA
5. Where do I go if I disagree and need to adjust manually? → Secondary CTA
6. Which control is risky override? → Override section with "Risco" badge
7. Which control only silences repeated notifications? → Alert section

**Negative criteria — page must NOT feel like:**
- Four peer buttons with improved wording
- A governance-state control panel
- An alert management page with strategy language
- A second independent strategy ticket below the main card

### Verification checklist
- [ ] Page loads without errors in all supported browsers
- [ ] Hero renders correctly for each posture (test by switching mock data)
- [ ] Impact strip shows/hides correctly per posture
- [ ] CTA pair has correct visual hierarchy (primary > secondary)
- [ ] Override staged confirmation works end-to-end
- [ ] Alert silence works end-to-end
- [ ] Result preview updates correctly for all 4 action types
- [ ] Toast appears and auto-dismisses for all actions
- [ ] Navigation to HEMS passes context correctly
- [ ] Responsive layout works at 900px breakpoint
- [ ] Dark theme is consistent (no white flashes, no broken borders)
- [ ] Other pages (P1–P4, P6) still work correctly
- [ ] Existing test suite passes

---

## Phase 7: Backend — `defer_until` column + migration | Complexity: S

> Cross-reference: DESIGN 0.1b §11.2 (The `defer_until` field), §9 Change 5

### Goal
Add the `defer_until` and `deferred_by` columns to the `strategy_intents` table and update TypeScript types accordingly. This is the single schema migration required by the ongoing case model.

### Files modified

| File | Change |
|------|--------|
| `backend/src/shared/db.ts` | Add migration: `ALTER TABLE strategy_intents ADD COLUMN defer_until TIMESTAMPTZ DEFAULT NULL; ALTER TABLE strategy_intents ADD COLUMN deferred_by TEXT DEFAULT NULL;` — two nullable columns, no data migration, no index needed. |
| `backend/src/shared/types/p5.ts` | Add `readonly defer_until: string \| null;` and `readonly deferred_by: string \| null;` to the `StrategyIntent` interface. |

### Acceptance criteria
- Migration runs without error on a fresh database and on the existing production schema.
- `strategy_intents` table has `defer_until` (TIMESTAMPTZ, nullable) and `deferred_by` (TEXT, nullable) columns.
- `StrategyIntent` TypeScript interface includes `defer_until` and `deferred_by` fields.
- All existing P5 backend tests still pass (new columns are nullable, no existing code touches them).
- `GET /api/p5/overview` continues to work unchanged (new columns are `null` for all existing rows).

### Verification
- Start backend service → migration log shows column additions.
- Query `SELECT defer_until, deferred_by FROM strategy_intents LIMIT 1;` → both `null`.
- Run existing P5 test suite — all green.

---

## Phase 8: Backend — defer action enhancement | Complexity: S

> Cross-reference: DESIGN 0.1b §9 Change 4, §11.1 (How defer works as an intent action), §12.3 (API call)

### Goal
Enable the `defer` action for escalation-class intents and persist the `defer_until` + `deferred_by` fields when the defer action is taken. This makes the `POST /api/p5/intents/:id/defer` endpoint functional for the review-later CTA.

### Files modified

| File | Change |
|------|--------|
| `backend/src/bff/handlers/post-p5-intent-action.ts` | 1. In `getAllowedActions()`: change `case "escalate": return ["escalate"];` → `case "escalate": return ["defer", "escalate"];`. 2. When action is `defer`: read `body.defer_until` from request, validate it is a future ISO 8601 timestamp, pass `defer_until` and `deferred_by` (from auth context or `"operator"`) to the status update function. |
| `backend/src/shared/db.ts` (or `p5-db.ts`) | Update `updateIntentStatus()` to accept optional `defer_until` and `deferred_by` parameters and write them to the DB alongside the `status: 'deferred'` transition. |

### Acceptance criteria
- `POST /api/p5/intents/:id/defer` with `{ "reason": "test", "defer_until": "<future_ISO8601>" }` returns 200 for an intent with `governance_mode: 'escalate'`.
- After the call, the intent row has `status = 'deferred'`, `defer_until = <the provided timestamp>`, and `deferred_by` populated.
- `POST /api/p5/intents/:id/defer` with a past timestamp returns 400 validation error.
- `POST /api/p5/intents/:id/defer` for a non-escalation intent still returns 400 (defer not in allowed actions for other governance modes — existing behavior unless already allowed).
- All existing P5 backend tests still pass.

### Verification
- Call `POST /api/p5/intents/:id/defer` with a valid future timestamp on an escalation intent → 200.
- Query `SELECT status, defer_until, deferred_by FROM strategy_intents WHERE id = :id;` → verify fields populated.
- Call with past timestamp → 400.
- Run existing test suite — all green.

---

## Phase 9: Backend — ongoing case fingerprint + overview grouping | Complexity: M

> Cross-reference: DESIGN 0.1b §10 (Ongoing Case Data Model), §11.3 (Overview handler behavior during defer window), §9 Change 6

### Goal
Implement case fingerprint computation in the overview handler, group intents by fingerprint, suppress deferred cases from `need_decision_now[]`, derive `case_state` for each fingerprint group, and return `defer_context` in the overview response. This is the largest backend change in 0.1b.

### Files modified

| File | Change |
|------|--------|
| `backend/src/bff/handlers/get-p5-overview.ts` | 1. Add `computeCaseFingerprint(intent)` function: returns `${family}:${sorted_scope_ids}:${driver_type}` (~10 lines). 2. After loading non-terminal intents, compute fingerprints and group by fingerprint (~5 lines). 3. For each fingerprint group, check for active deferral (`status === 'deferred' && defer_until > NOW()`). If found: move intents from `needDecisionNow` to `watchNext` with `status: 'deferred'` annotation (~15 lines). 4. Compute and return `defer_context` when an active deferral exists (~10 lines). 5. Adjust hero posture derivation: if all escalation-class intents are covered by active deferrals, drop to next applicable posture (~5 lines). |
| `backend/src/shared/types/p5.ts` | Add `defer_context` field to `P5Overview` response type. Add `case_state` field to `IntentCard`. |

### Acceptance criteria
- `GET /api/p5/overview` returns `defer_context: null` when no active deferrals exist (existing behavior preserved).
- When an escalation intent has been deferred (via Phase 8) with `defer_until` in the future:
  - The intent is NOT in `need_decision_now[]`.
  - The intent appears in `watch_next[]` with `status: 'deferred'`.
  - `defer_context` is populated with `case_fingerprint`, `deferred_intent_id`, `defer_until`, `original_reason`, `deferred_at`.
  - `hero.posture` drops from `escalation` to the next applicable posture (e.g., `protective` or `calm`).
- When `defer_until` is in the past (expired), the intent flows back into `need_decision_now[]` normally.
- Intents with the same fingerprint are treated as one ongoing case — a new intent generated during a defer window for the same fingerprint does NOT appear in `need_decision_now[]`.
- All existing P5 backend tests still pass.

### Verification
- Defer an escalation intent (Phase 8), then call `GET /api/p5/overview` → verify intent moved to `watch_next[]`, `defer_context` populated, hero posture adjusted.
- Wait for `defer_until` to pass (or use a short duration like 1 minute), call overview again → intent returns to `need_decision_now[]`, `defer_context: null`.
- Trigger a new evaluation cycle while a defer is active → new intent for same fingerprint does NOT appear in `need_decision_now[]`.

---

## Phase 10: Backend — worsening-condition breakout | Complexity: M

> Cross-reference: DESIGN 0.1b §11.4 (Worsening-condition breakout)

### Goal
Implement the material worsening detection logic in the overview handler. When conditions worsen beyond defined thresholds during an active defer window, the defer is logically voided and the intent is presented as an active escalation again.

### Files modified

| File | Change |
|------|--------|
| `backend/src/bff/handlers/get-p5-overview.ts` | Add `detectMaterialWorsening(deferredIntent, newestIntent)` function that compares evidence snapshots. Worsening criteria: (a) SoC drop ≥ 10 percentage points from defer-time snapshot, (b) SoC falls below `RESERVE_EMERGENCY_SOC` (15%), (c) grid demand ratio crosses from `soon` (80%) to `immediate` (90%), (d) new family enters collision on same scope. When worsening detected: skip the defer suppression, let intent flow into `need_decision_now[]` at full escalation intensity. (~12 lines for detection function, ~5 lines for integration into fingerprint-group processing.) |

### Acceptance criteria
- With an active defer: if a new intent for the same fingerprint has SoC ≥ 10pp lower than the deferred intent's evidence snapshot → intent appears in `need_decision_now[]` despite active defer.
- With an active defer: if SoC drops below 15% (emergency threshold) → defer broken regardless of pp delta.
- With an active defer: if conditions do NOT materially worsen → defer remains honored, intent stays in `watch_next[]`.
- The overview handler does NOT modify the DB to void the deferral — it only ignores it when building the response.
- All existing P5 backend tests still pass.

### Verification
- Defer an escalation intent at SoC = 20%. Simulate new evaluation with SoC = 9% → overview returns intent in `need_decision_now[]` with `escalation` posture (defer broken).
- Defer at SoC = 20%. Simulate new evaluation with SoC = 18% → overview keeps intent in `watch_next[]` (2pp drop, below 10pp threshold — defer honored).
- Defer at SoC = 20%. Simulate new evaluation with SoC = 14% → overview breaks defer (below emergency 15%).

---

## Phase 11: Frontend — replace Reconhecer with Pular por agora | Complexity: S

> Cross-reference: DESIGN 0.1b §14 (Escalation CTA Correction), §4.3 (Main CTAs rendering)

### Goal
Update the CTA rendering for escalation posture. Replace the old `Reconhecer situação` / acknowledge binding with the three-CTA escalation layout: act now (primary), review later (secondary), manual adjust (tertiary link).

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | Update `_buildCtaPair()` (or `_renderCtaPair()`): when `posture === 'escalation'`, render three CTAs — (1) `Ajustar manualmente →` as primary (red border, navigate to HEMS), (2) `Pular por agora` as secondary (amber border, triggers defer flow), (3) `Abrir painel HEMS para ajustar` as tertiary text link. Remove old `Reconhecer` / acknowledge binding for escalation. |
| `frontend-v2/js/i18n.js` | Add keys: `p5.strategy.cta.actnow.escalation`, `p5.strategy.cta.defer.escalation`. |
| `frontend-v2/css/pages.css` | Add styles for escalation CTA triple: `.cta-escalation-primary` (red border + gradient), `.cta-escalation-secondary` (amber border), `.cta-tertiary-link`. |

### Acceptance criteria
- When posture is `escalation` (active, no defer): primary CTA shows `Ajustar manualmente →`, secondary shows `Pular por agora`, tertiary link shows `Abrir painel HEMS para ajustar`.
- Clicking `Ajustar manualmente →` navigates to `#hems` with context (same behavior as manual adjust in other postures).
- Clicking `Pular por agora` does NOT immediately defer — it opens the defer duration picker (Phase 12 wires this; for now, a click handler placeholder that sets `deferExpanded = true` and calls `_updatePreview('defer')` is sufficient).
- No `Reconhecer` or `Acknowledge` text appears anywhere on the page.
- Non-escalation postures still render the original two-CTA pair (no regression).

### Verification
- Load page with escalation posture mock data → three CTAs visible with correct labels and visual hierarchy.
- Click `Ajustar manualmente →` → navigates to `#hems`.
- Click `Pular por agora` → `deferExpanded` state toggles (visible in console/debugger for now).
- Switch to `protective` posture → two CTAs render as before (no regression).
- Canonical ingress: `http://152.42.235.155/#vpp`

---

## Phase 12: Frontend — defer flow UI (duration picker + API call) | Complexity: M

> Cross-reference: DESIGN 0.1b §12 (Review-Later Interaction Contract), §2.4b (Defer state)

### Goal
Implement the defer duration picker that opens when the operator clicks `Pular por agora`. Selection auto-confirms (matches alert silence pattern). On confirmation, calls the defer API and refreshes the page.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | 1. Add `_renderDeferPicker()` method: inline duration picker below the secondary CTA, matching the existing `dur-chip` pattern. Chips: `30 min` / `1 h` / `2 h` / `4 h`. 2. On chip selection: compute `defer_until = new Date(Date.now() + minutes * 60000).toISOString()`, call `POST /api/p5/intents/:id/defer` with `{ reason: "Operador adiou revisão via homepage", defer_until }`. 3. On success: show toast `⏸ Revisão adiada por {duration}. Retorna às {HH:MM} ou antes se condições piorarem.`, refresh overview data. 4. On error: show inline error toast, keep CTA clickable. 5. Wire `_updatePreview('defer')` with duration context on chip selection. |
| `frontend-v2/js/i18n.js` | Add keys: `p5.strategy.defer.label`, `p5.strategy.defer.toast`, `p5.strategy.preview.tag.defer`. |
| `frontend-v2/css/pages.css` | Add `.defer-picker` styles (reuse `.dur-row` / `.dur-chip` pattern from override section). |

### Acceptance criteria
- Clicking `Pular por agora` reveals an inline duration picker with 4 chips: `30 min`, `1 h`, `2 h`, `4 h`.
- Selecting a chip immediately fires the API call (no separate confirm button — auto-confirm pattern).
- On success: toast appears with defer duration and return time, page refreshes to deferred state.
- On API error: toast shows error message, defer picker remains interactive.
- Result preview updates to show `⏸ Revisão adiada` amber tag with consequence items when a chip is selected.
- Clicking outside the defer picker collapses it without firing API.
- Duration picker label shows `Adiar revisão por:`.

### Verification
- Click `Pular por agora` → picker appears with 4 duration chips.
- Select `1 h` → API call fires → toast shows `⏸ Revisão adiada por 1 h. Retorna às {HH:MM}...` → page refreshes.
- Select chip while backend is down → error toast, picker remains.
- Click outside picker → collapses, no API call.
- Canonical ingress: `http://152.42.235.155/#vpp`

---

## Phase 13: Frontend — deferred state rendering | Complexity: M

> Cross-reference: DESIGN 0.1b §13.2 (Deferred — within defer window), Appendix A (Posture ↔ Component Visibility Matrix)

### Goal
When the overview response includes an active `defer_context` (case state = deferred), render the homepage in the muted deferred visual state. This replaces the red escalation urgency with a calm amber acknowledgment.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | 1. In `_renderHero()`: when `data.defer_context` is populated and `defer_until > now`: render amber border, ⏸ icon, title `Revisão adiada até {HH:MM}`, narrative `{reason}. Condição ainda ativa — revisão agendada.`, badge `Adiado`. 2. Add client-side countdown: `Retorna em {remaining_time}` computed from `defer_context.defer_until`. 3. In `_renderCtaPair()`: when deferred, primary CTA = `Retomar agora` (blue outline, cancels defer via `POST /api/p5/intents/:id/escalate`), secondary = `Ajustar manualmente →` (blue text link). 4. In `_renderImpactStrip()`: render with muted styles (lighter border, muted text). 5. Hide override section during defer. |
| `frontend-v2/js/i18n.js` | Add keys: `p5.strategy.hero.deferred.title`, `p5.strategy.hero.deferred.narrative`, `p5.strategy.defer.badge`, `p5.strategy.cta.resume.escalation`, `p5.strategy.defer.resume.toast`. |
| `frontend-v2/css/pages.css` | Add `.hero--deferred` styles (amber border, muted text weight). Add `.impact-strip--muted` styles. Add `.cta-resume` styles (blue outline button). |

### Acceptance criteria
- When overview returns `defer_context` with `defer_until` in the future:
  - Hero shows amber border, ⏸ icon, `Revisão adiada até HH:MM` title, `Adiado` badge.
  - Countdown shows `Retorna em Xh Ym`.
  - Primary CTA is `Retomar agora`, secondary is `Ajustar manualmente →`.
  - Impact strip is present but visually muted.
  - Override section is hidden.
  - Alert section remains visible.
- Clicking `Retomar agora`:
  - Calls `POST /api/p5/intents/:id/escalate` with `{ reason: "Operador retomou revisão via homepage" }`.
  - Toast: `Revisão retomada. Escalação ativa novamente.`
  - Page refreshes to active escalation state.
- Visual intensity is clearly calmer than active escalation (amber vs red, no bold urgency).

### Verification
- Defer an escalation (Phase 12), page refreshes → deferred state renders: amber hero, ⏸ icon, countdown.
- Click `Retomar agora` → toast, page refreshes to red active escalation.
- Verify muted impact strip (lighter colors than active state).
- Verify override section is hidden, alert section is visible.
- Canonical ingress: `http://152.42.235.155/#vpp`

---

## Phase 14: Frontend — defer expired + resolved states | Complexity: S

> Cross-reference: DESIGN 0.1b §13.3 (Defer expired), §13.4 (Condition resolved), §11.5 (Defer expiry)

### Goal
Handle the two remaining case state transitions on the frontend: (a) defer expires and condition persists → return to active escalation rendering, (b) condition resolves → return to calm homepage. Both are driven by the backend overview response — the frontend simply renders what the overview returns.

### Files modified

| File | Change |
|------|--------|
| `frontend-v2/js/p5-strategy.js` | 1. In the deferred-state branch of `_renderHero()`: add a `setInterval` or `requestAnimationFrame` check that compares `Date.now()` against `defer_context.defer_until`. When the countdown reaches zero, auto-refresh overview data (the backend will return the intent as active escalation if condition persists, or calm if resolved). 2. Add i18n key for re-escalation narrative hint: `Revisão expirou — condição ainda ativa.` (displayed when the overview returns escalation posture and the intent was previously deferred — detectable by comparing against prior `defer_context`). |
| `frontend-v2/js/i18n.js` | Add key: `p5.strategy.hero.reescalated`. |

### Acceptance criteria
- When a defer window expires (countdown reaches 0): the page auto-refreshes overview data without operator interaction.
- If the backend returns `escalation` posture (condition persists): homepage transitions to active escalation state (Section 13.1 rendering). Hero narrative may include `Revisão expirou — condição ainda ativa.` hint.
- If the backend returns `calm` posture (condition resolved during defer window): homepage transitions to calm state. No special "resolved" banner — the absence of escalation is sufficient.
- No infinite refresh loop — auto-refresh triggers once on expiry, not repeatedly.
- The countdown timer is cleaned up properly on page navigation away from `#vpp`.

### Verification
- Defer an escalation for 1 minute. Wait for countdown to reach 0 → page auto-refreshes → active escalation returns (if condition persists in mock data).
- Simulate condition resolution (modify mock to return calm) → defer expires → page shows calm homepage.
- Navigate away from `#vpp` during defer → return → page fetches fresh data, no stale timer.
- Canonical ingress: `http://152.42.235.155/#vpp`

---

## Phase 15: Integration testing + runtime acceptance | Complexity: L

> Cross-reference: REQ 0.1b §Homepage Acceptance Criteria, §Simplicity As Design Guardrail

### Goal
End-to-end validation of the full ongoing case + defer-until lifecycle. Verify all state transitions work correctly across both admin and org account perspectives. Confirm the homepage passes the expanded REQ 0.1b acceptance criteria.

### Test scenarios

| # | Scenario | Expected outcome |
|---|----------|-----------------|
| 1 | Active escalation → click `Pular por agora` → select 1h | Toast, page transitions to deferred state, amber hero, countdown |
| 2 | Deferred state → wait for defer expiry | Page auto-refreshes, returns to active escalation |
| 3 | Deferred state → click `Retomar agora` | Toast, page returns to active escalation immediately |
| 4 | Deferred state → condition worsens (SoC drop ≥ 10pp) | Overview breaks defer, page shows active escalation at full intensity |
| 5 | Deferred state → condition resolves | Overview returns calm, page shows calm homepage |
| 6 | Active escalation → click `Ajustar manualmente →` | Navigates to HEMS with context |
| 7 | Same ongoing case across multiple evaluation cycles | Operator sees one continuous case, not repeated fresh alerts |
| 8 | Full cycle: escalation → skip → deferred → expires → re-escalation → skip again → manual adjust → resolved | All state transitions render correctly |

### Acceptance criteria (from REQ 0.1b)

**5-second test — operator must be able to answer:**
1. What is the platform recommending right now? → Hero banner
2. Why is it recommending that? → Hero narrative
3. What important downstream strategy is currently affected? → Impact strip
4. What is the default action if I agree? → Primary CTA
5. Where do I go if I disagree and need to adjust manually? → Manual adjust CTA
6. Can I defer this and come back to it later? For how long? → `Pular por agora` + duration picker
7. Which control is risky override? → Override section with "Risco" badge
8. Which control only silences repeated notifications? → Alert section

**Simplicity guardrail (REQ 0.1b §Simplicity As Design Guardrail):**
- The deferred state must feel calmer than active escalation.
- Adding review-later must NOT make the homepage feel like it has more buttons, more states to parse, or more cognitive load than the previous two-CTA model.
- If the implementation feels like added complexity rather than a replacement of a broken interaction, it fails.

**Negative criteria — page must NOT feel like:**
- Four peer buttons with improved wording
- A governance-state control panel
- An alert management page with strategy language
- A second independent strategy ticket below the main card

### Verification
- All 8 test scenarios pass on canonical ingress `http://152.42.235.155`.
- Both admin and org account perspectives tested.
- No JavaScript console errors during any state transition.
- Dark theme consistent across all new states (amber deferred, red active, green calm).
- Other pages (P1–P4, P6) still work correctly.

---

## Constraints

1. **Minimal backend changes in Phase 0, then frontend changes in Phases 1–6.** No new backend API routes. Three additive backend changes (type additions and field enrichments) are completed in Phase 0 as prerequisites. The existing `GET /api/p5/overview`, `POST /api/p5/intents/:id/{action}`, and `POST /api/p5/posture-override` endpoints are sufficient — Phase 0 only enriches their type contracts and response payloads.

2. **Phases 7–10 are additive backend changes.** One minor schema migration (single `defer_until` + `deferred_by` column addition). No new API routes — the existing `POST /api/p5/intents/:id/{action}` endpoint already supports the `defer` action verb. The overview handler is enriched with fingerprint grouping and defer awareness.

3. **Must not break existing P5 functionality.** The overview data fetching, intent detail views, and posture override API calls remain intact. New columns are nullable. New overview fields default to `null`. Fingerprint grouping is additive logic layered on top of existing lane partitioning.

4. **Must not break other pages.** P1–P4 and P6 are not modified. Shared resources (`app.js`, `data-source.js`, `i18n.js`) receive only additive changes.

5. **PT-BR visible language.** All operator-facing text is in Brazilian Portuguese. Internal variable names and comments remain in English.

6. **Dark operator theme consistency.** All new CSS uses the existing CSS custom properties (`--bg`, `--surface`, `--border`, `--text`, `--muted`, etc.). No hardcoded colors outside the variable system.

7. **Existing test suite must pass.** No tests should be broken by the reframe. If existing P5 tests assert on old lane structure, those test assertions are updated to match the new structure.

8. **Simplicity guardrail (0.1b).** The review-later interaction must feel as simple as the existing duration-chip pattern. The deferred visual state must feel calmer than active escalation. Adding ongoing-case semantics must NOT increase homepage cognitive load.

---

## Risk Items

### R1: Alert silence override type
**Risk:** The `posture_overrides` table may not accept `suppress_alerts` as an `override_type` value. The current design only validates `force_protective`, `suppress_economic`, `force_approval_gate`, `manual_escalation_note`.
**Mitigation:** ~~Add `suppress_alerts` to the type validation in `posture-resolver.ts`. This is a one-line change. If this is blocked, alert silence can use a frontend-only `sessionStorage` fallback for v0.1, with backend support added later.~~ **Addressed in Phase 0 (Task 0.1).** The `suppress_alerts` type is added to the `OverrideType` union, `VALID_OVERRIDE_TYPES` array, and posture resolver switch. No sessionStorage fallback needed.

### R2: Override persistence scope
**Risk:** The override is persisted server-side via `posture_overrides` table. The frontend needs to know whether an active override exists on page load to render the correct hero state.
**Mitigation:** `GET /api/p5/overview` already returns `hero.override_active: boolean`. This is sufficient for hero rendering. For richer override display (who created it, when, expiry), the frontend can read `context.active_overrides` if the overview response includes it, or fall back to a minimal display.

### R3: P4/HEMS navigation integration
**Risk:** The handoff context (`DemoStore.set('p5_handoff', ...)`) depends on P4/HEMS reading this key. If P4 does not implement the handoff reader, the navigation still works but without context highlighting.
**Mitigation:** The secondary CTA navigation works regardless of whether P4 reads the handoff context. The context is additive. P4 handoff reading can be implemented as a separate task.

### R4: State management complexity
**Risk:** The page now manages multiple local state fields (override expanded, duration selected, alert expanded, selected action). Interaction between these states (e.g., expanding override should collapse alert) must be carefully handled.
**Mitigation:** All state resets go through a `_clearAllInteractionState()` method that resets all expandable sections and selections. Each expand action calls this first, then sets its own state. This prevents conflicting open panels.

### R5: Evidence snapshot availability in overview
**Risk:** Hero metrics (SoC percentage, threshold) require data from the evidence snapshot or dominant protector context. If the overview API does not expose these fields at the top level, the hero cannot render metrics.
**Mitigation:** ~~Check `context.dominant_protector` fields on first implementation. If insufficient, add a `hero.evidence` field to the overview response.~~ **Addressed in Phase 0 (Task 0.3).** The `ProtectorSummary` is enriched with `current_soc` and `threshold` fields, populated from the dominant protector's evidence snapshot. No separate `hero.evidence` field needed.

### R6: Posture-specific CTA labels
**Risk:** The primary CTA label changes per posture (e.g., `Manter proteção de reserva` vs `Aprovar {title}` vs `Confirmar: sistema operando normalmente`). The current `GET /api/p5/overview` returns posture but not a pre-computed CTA label.
**Mitigation:** CTA labels are computed client-side from posture + i18n keys. No backend change needed. The i18n key structure supports posture-specific labels: `p5.strategy.cta.keep.{posture}`.

### R7: Fingerprint collision (0.1b)
**Risk:** The case fingerprint `family:scope_ids:driver_type` could collide if two genuinely different conditions produce the same fingerprint components. This would cause unrelated issues to be grouped as one ongoing case.
**Mitigation:** The fingerprint dimensions (family + scope + driver type) are broad enough that collision is unlikely for the current condition families. The driver type derivation rules (DESIGN §10.3) produce distinct categories (`low_soc`, `peak_demand`, `tariff_window`, `scope_conflict`). If collision is observed in production, the fingerprint can be extended with additional evidence snapshot fields without schema changes (it is computed at read time, not stored).

### R8: Defer-until clock skew (0.1b)
**Risk:** The `defer_until` timestamp is computed by the frontend (`Date.now() + duration`) but evaluated by the backend (`defer_until > NOW()`). Clock skew between the operator's browser and the server could cause early or late defer expiry.
**Mitigation:** The defer durations (30m–4h) are large relative to expected clock skew (seconds to low minutes). For v0.1b, this is acceptable. If precision becomes important, the backend can compute `defer_until` server-side from a `duration_minutes` parameter instead.

### R9: Worsening detection false positives (0.1b)
**Risk:** The material worsening detection compares evidence snapshots. Noisy sensor data (e.g., SoC fluctuating around a threshold) could trigger false breakouts, re-escalating issues the operator intentionally deferred.
**Mitigation:** The worsening thresholds are deliberately set high (≥ 10pp SoC drop, or crossing from 80% to 90% demand ratio). This provides a wide margin that should not be triggered by normal sensor noise. If false positives occur, the thresholds can be tuned without changing the model.

---

## Dependency Chain

```
Phase 0  ✅ →  Phase 1  ✅ →  Phase 2  ✅ →  Phase 3  ✅ →  Phase 4  ✅
                                                                    ↓
Phase 5  ←  (depends on Phases 2–4: needs all action types wired)
Phase 6  ←  (depends on all Phases 0–5)

--- 0.1b additions ---

Phase 7  →  Phase 8  →  Phase 9  →  Phase 10     (backend chain, sequential)
                  ↓            ↓           ↓
              Phase 11     Phase 13    Phase 14
              Phase 12
                  ↓            ↓           ↓
              Phase 15  ←  (depends on all Phases 7–14)
```

### Detailed dependencies

| Phase | Depends on | Reason |
|-------|-----------|--------|
| **7** | None (can start immediately) | New columns only — no dependency on Phases 5–6 |
| **8** | Phase 7 | Needs `defer_until` column to exist |
| **9** | Phase 8 | Needs defer action functional to test grouping with deferred intents |
| **10** | Phase 9 | Builds on fingerprint grouping; needs `defer_context` to test breakout |
| **11** | Phase 8 | Needs `defer` in allowed actions so the CTA click handler target exists |
| **12** | Phase 8 | Needs `POST /api/p5/intents/:id/defer` to accept `defer_until` |
| **13** | Phase 9 | Needs `defer_context` and `case_state` in overview response |
| **14** | Phase 9 + 10 | Needs defer expiry logic (9) and worsening breakout (10) in overview |
| **15** | All of 7–14 | Full cycle integration |

### Parallelization opportunities
- **Phases 11 + 12** can be parallelized (both depend on Phase 8, independent of each other).
- **Phase 10** can be parallelized with **Phases 11 + 12** (Phase 10 depends on 9; Phases 11–12 depend on 8; these are independent branches).
- **Phases 5–6** (original plan) can be completed in parallel with Phases 7–8 (new backend work).

---

## Implementation Order Summary

```
--- Original action model reframe (0.1a) ---
Phase 0   ✅  Backend Prerequisites         (type + field enrichments, ~18 lines)
Phase 1   ✅  Hero + Impact Strip           (homepage shell restructure)
Phase 2   ✅  CTA Pair                      (primary interaction surface)
Phase 3   ✅  Override Section              (staged risk control)
Phase 4   ✅  Alert Section                 (notification management)
Phase 5   ⬜  Result Preview                (consequence feedback)
Phase 6   ⬜  Polish + Integration          (quality gate — original scope)

--- Ongoing case + defer-until model (0.1b) ---
Phase 7   ⬜  Backend: defer_until column   (schema migration)             [S]
Phase 8   ⬜  Backend: defer action         (escalation defer support)     [S]
Phase 9   ⬜  Backend: fingerprint + group  (ongoing case in overview)     [M]
Phase 10  ⬜  Backend: worsening breakout   (defer breakout logic)         [M]
Phase 11  ⬜  Frontend: escalation CTAs     (Pular por agora replaces Reconhecer)  [S]
Phase 12  ⬜  Frontend: defer flow UI       (duration picker + API call)   [M]
Phase 13  ⬜  Frontend: deferred rendering  (amber hero, countdown, resume) [M]
Phase 14  ⬜  Frontend: expiry + resolved   (auto-refresh, calm transition) [S]
Phase 15  ⬜  Integration + acceptance      (full cycle E2E)               [L]
```

### Complexity legend
- **S** = small (< 30 min Claude Code task)
- **M** = medium (30–90 min)
- **L** = large (90+ min)

### Recommended execution order
1. Complete Phases 5–6 (original plan remainder) — can proceed immediately.
2. Start Phase 7 → 8 → 9 → 10 (backend chain).
3. After Phase 8: start Phases 11 + 12 in parallel.
4. After Phase 9: start Phase 13.
5. After Phases 9 + 10: start Phase 14.
6. After all above: Phase 15 integration testing.
