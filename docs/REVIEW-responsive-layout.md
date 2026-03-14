# REVIEW: Responsive Layout Overhaul — Second-Pass Audit

**Date:** 2026-03-14
**Reviewer:** Automated codebase verification
**Documents Reviewed:**
- `docs/REQ-responsive-layout.md`
- `docs/DESIGN-responsive-layout.md`
- `docs/PLAN-responsive-layout.md`

---

## Step-by-Step Verdict

| Step | Description | Verdict | Notes |
|------|-------------|---------|-------|
| 1 | Document breakpoints in `variables.css` | **PASS** | Line 53 is the closing `}` of `:root`. Inserting after it, before the light theme block at line 55, is correct. |
| 2 | Add `max-width` to `.page-content` | **PASS with caveats** | Line refs correct (237-241). P2 opt-out selector needs fixing — see errors below. |
| 3 | Add `min-height` to `.kpi-card` | **PASS with caveat** | Line refs correct (32-41). Specificity conflict with P3 cards — see risks. |
| 4 | Define `kpi-grid-4` and `kpi-grid-3` | **PASS** | Insert point (after line 30) correct. JS already emits these classes (`p3-asset-energy.js:315`, `p3-asset-health.js:313`). |
| 5 | Remove `!important` overrides | **PASS** | All line refs verified: 2526-2541 (p3ae-summary), 2695-2704 (p3ah-summary). Content matches. |
| 6 | Update `kpi-grid-6` breakpoints | **PASS** | Lines 14-30 correct. The "replace" block accurately reflects current code. |
| 7 | Update `two-col` collapse threshold | **PASS with caveat** | Lines 298-302 correct. Chart minimum width concern — see risks. |
| 8 | Update P5 VPP grid | **PASS** | Lines 1369-1386 correct. Placeholder card exists (`pages.css:1388`, `p5-vpp.js:128`). |
| 9 | Update P6 chart height | **PASS** | Selector at line 1650, `height: 380px` at line 1651. Functionally correct. |
| 10 | Migrate non-standard breakpoints | **FAIL** | 3 of 8 sub-steps have wrong selectors and/or wrong line-to-selector mappings. See errors. |
| 11 | Final verification | **PASS** | No code changes, test matrix is comprehensive. |

---

## Factual Errors

### ERROR 1: Step 10a — Line 387 is NOT `.login-card`

**DESIGN says:** Line 387 → `.login-card` layout, change `min-width: 640px` → `min-width: 769px`

**Actual code at `pages.css:387`:**
```css
@media (min-width: 640px) {
  .wizard-step-label {
    display: block;
    /* ... wizard step label styles for P2 device commissioning */
  }
}
```

This is the **P2 commissioning wizard step label**, not `.login-card`. The `.login-card` class is defined in `login.html` (inline `<style>` block at line 66), not in `pages.css` at all.

**Impact:** Changing this breakpoint affects when wizard step labels appear in the device commissioning flow, not the login page. The description "Login card (line 387)" is completely wrong. The PLAN should either:
- Remove this sub-step entirely (login styles are in `login.html`, out of scope)
- Correct the description to "P2 wizard step labels (line 387)"

### ERROR 2: Step 10b — Line 939 is NOT `.p2-filter-bar`

**DESIGN says:** Line 939 → P2 filter bar, change `max-width: 800px` → `max-width: 768px`

**Actual code at `pages.css:939`:**
```css
@media (max-width: 800px) {
  .p4-mode-cards {
    grid-template-columns: 1fr;
  }
}
```

This is the **P4 HEMS mode cards** grid collapse, not the P2 filter bar. The `.p2-filter-bar` class appears at lines 45-76 of pages.css and has **no `@media` query** of its own — it uses `flex-wrap: wrap` to handle narrow screens naturally.

**Impact:** Changing this breakpoint affects when P4 HEMS mode selection cards stack vertically. The description "P2 filter bar" is wrong. Correct to: "P4 mode cards (line 939)".

### ERROR 3: Step 10c — Line 1559 is NOT P5 event timeline

**DESIGN says:** Line 1559 → P5 event timeline, change `max-width: 900px` → `max-width: 768px`

**Actual code at `pages.css:1559`:**
```css
@media (max-width: 900px) {
  .p6-scorecard-grid {
    grid-template-columns: 1fr;
  }
}
```

This is the **P6 Performance scorecard grid** collapse, not a P5 event timeline. There is no CSS class matching "event-timeline" in `pages.css`.

**Impact:** Changing this breakpoint affects when the P6 scorecard 3-column grid collapses to single column. The description "P5 event timeline" is wrong. Correct to: "P6 scorecard grid (line 1559)".

### ERROR 4 (Minor): P2 opt-out selector mismatch between DESIGN and PLAN

**DESIGN Section 2** uses selector: `.page-section[data-page="devices"] .page-content`

**PLAN Step 2** uses selector: `#page-devices .page-content`

**Actual HTML (`index.html:97`):**
```html
<section id="page-devices" class="page-section">
  <div class="page-content" id="devices-content"></div>
</section>
```

The PLAN's `#page-devices .page-content` is **correct** and will match. The DESIGN's `.page-section[data-page="devices"]` is **wrong** — there is no `data-page="devices"` attribute on the section element. The `data-page` attributes exist on `.nav-item` elements (line 35), not on `.page-section` elements. The PLAN catches this ("verify in index.html"), but the DESIGN states it as the primary selector.

### ERROR 5 (Minor): DESIGN chart table line references off by one

**DESIGN Section 4, chart table:**
- `pages.css:2575` for `p3ae-chart` — actual selector `.p3ae-chart` is at line **2575**, height at line **2576**. Acceptable.
- `pages.css:2706` for `p3ah-chart` — actual selector `.p3ah-chart` is at line **2706**, height at line **2707**. Acceptable.
- `pages.css:1651` for `p6-savings-chart` — actual selector `.p6-savings-chart` is at line **1650**, the property `height: 380px` is at **1651**. Minor inconsistency in what "line" refers to (selector vs. property) but functionally harmless.

### ERROR 6: DESIGN Section 3.2 — `kpi-grid-4` line reference

**DESIGN says:** `kpi-grid-4` has NO CSS definition.

**Verified:** Correct — `kpi-grid-4` has no definition in `components.css`. The class is emitted by JS (`p3-asset-energy.js:315`: `'<div class="kpi-grid kpi-grid-4 p3ae-summary">'`) but relies entirely on the `.p3ae-summary` override. The DESIGN's statement is accurate.

---

## Risks the Design Missed

### RISK 1: `two-col` at 1024px — charts narrower than estimated

The DESIGN (Section 5) estimates two-col chart widths at "~450-660px" and says "Verify that ECharts renders acceptably at 450px width."

**Actual calculation at 1024px viewport:**
- Sidebar: collapsed at 60px (layout.css `@media max-width: 1439px`)
- Content area: 1024 - 60 = 964px
- `page-content` padding: `var(--space-md)` = 16px x 2 = 32px (layout.css:323)
- Available: 964 - 32 = 932px
- Two columns with gap `var(--space-lg)` = 24px: (932 - 24) / 2 = **454px per column**
- Section card body padding: `var(--space-lg)` = 24px x 2 = 48px
- **Actual chart render width: ~406px**

The DESIGN's "~450-660px" estimate is for the column width, not the chart render width. After section-card padding, charts render at **~406px** at 1024px — just barely above 400px. ECharts can handle this, but the margin is thinner than the DESIGN implies.

**Recommendation:** Add an explicit note that the minimum chart render width in two-col mode is ~406px (at 1024px), and verify ECharts legends and axis labels are readable at this width. Consider whether the collapse should be at `max-width: 1099px` (1100px breakpoint) instead of 1023px to give more breathing room (~460px chart width minimum).

### RISK 2: Specificity conflict — P3 card `min-height`

Step 3 adds `min-height: 88px` to `.kpi-card` (specificity 0-1-0).
`pages.css:2547` has `.p3ae-summary .kpi-card { min-height: 80px; }` (specificity 0-2-0).

The page-specific rule wins, so P3 Energy/Health cards stay at 80px, not 88px. This is probably intentional (P3 has 8 smaller cards with 1.1rem values), but the DESIGN and PLAN never acknowledge the specificity interaction. If someone later removes the P3 min-height, cards jump from 80px to 88px.

**Recommendation:** Add a note to Steps 3 and 5 that `.p3ae-summary .kpi-card` and `.p3ah-summary .kpi-card` override the global `min-height: 88px` with `min-height: 80px` (higher specificity), and this is intentional.

### RISK 3: P6 scorecard grid collapse moved from 900px to 768px

Error 3 shows that line 1559 is `.p6-scorecard-grid`, not P5 event timeline. The proposed change moves the 3-column to 1-column collapse from 900px to 768px. Between 769px and 900px, the P6 scorecard will now show 3 columns at a width where each column is only ~(768 - 0 - 32) / 3 = **245px** at the low end (sidebar hidden below 1024px). This may be too narrow for scorecard content (metric names, values, and status indicators).

**Recommendation:** Verify P6 scorecard readability at 769-900px before migrating this breakpoint. A 3-column layout at ~245px per column could clip scorecard labels.

### RISK 4: `.p3ae-summary` margin-bottom restoration

Step 5 removes the entire `.p3ae-summary` block (lines 2526-2541) including `margin-bottom: var(--space-md)`. The PLAN correctly notes to add it back, but this must be done atomically in the same commit. If the removal and re-addition are separated, there's a brief regression.

The proposed combined selector:
```css
.p3ae-summary,
.p3ah-summary {
  margin-bottom: var(--space-md);
}
```
This works, but note that `.p3ah-summary` at line 2695 also has `margin-bottom: var(--space-md)`, so the combined rule is slightly redundant for `.p3ah-summary` until line 2695-2698 is also removed. The PLAN does remove lines 2695-2704, so this is clean — just ensure both deletions happen in the same step.

### RISK 5: `kpi-grid-3` with odd card counts

Step 4 defines `.kpi-grid-3` as `repeat(3, 1fr)`. The REQ notes P3 Health has "3-6 cards." At 5 cards with 3 columns, the layout is 3+2 (one empty cell). At 4 cards: 3+1 (two empty cells). The DESIGN doesn't address whether ragged rows are acceptable for P3 Health the way it carefully handles P5's 7-card case with a placeholder.

**Recommendation:** Document that 3+2 and 3+1 layouts are acceptable for P3 Health, or consider if a placeholder should be added for visual consistency.

---

## Steps Out of Order or with Hidden Dependencies

### Dependency 1: Step 10 depends on correct selector identification (BLOCKED)

Steps 10a, 10b, and 10c have wrong selector descriptions. Before executing Step 10, the migration map must be corrected:
- 10a: Decide if `.wizard-step-label` at 640px should move to 769px (or stay as-is, since it's the P2 wizard, not login)
- 10b: Confirm `.p4-mode-cards` at 800px should move to 768px (this is P4, not P2)
- 10c: Confirm `.p6-scorecard-grid` at 900px should move to 768px (this is P6, not P5) — see Risk 3

### Dependency 2: Step 7 should be validated after Step 2

The PLAN says Step 7 (two-col collapse) has "no deps," but the chart width concern (Risk 1) is partially mitigated by Step 2's `max-width: 1600px` cap. Without Step 2, at very wide viewports the two-col layout looks fine, but the risk assessment changes. The dependency graph should note: "Step 7 risk assessment assumes Step 2 is deployed."

### Dependency 3: Step 5 has a write-order subtlety

Step 5 removes `!important` blocks and adds back `margin-bottom`. The PLAN lists the "add back" as part of Step 5, which is correct. But if a developer reads the PLAN too literally and only deletes without adding back the margin, P3 sections lose their bottom spacing. The step should make this atomic requirement more prominent (bold the "Also add back" instruction).

---

## Specific Recommendations

### R1: Fix the 3 wrong selectors in Step 10

Replace the migration map entries:

| Sub-step | Line | Wrong Description | Correct Description | Correct Selector |
|----------|------|-------------------|---------------------|------------------|
| 10a | 387 | `.login-card` layout | `.wizard-step-label` (P2 commissioning wizard) | `.wizard-step-label` |
| 10b | 939 | P2 filter bar | P4 HEMS mode cards | `.p4-mode-cards` |
| 10c | 1559 | P5 event timeline | P6 scorecard grid | `.p6-scorecard-grid` |

### R2: Fix the P2 opt-out selector in the DESIGN

Change `.page-section[data-page="devices"] .page-content` to `#page-devices .page-content` in DESIGN Section 2 to match the actual HTML structure and the PLAN.

### R3: Add chart width calculation to Step 7

Add explicit math showing the minimum chart render width at 1024px is ~406px (not "~500px"). Decide whether this is acceptable and document the decision.

### R4: Add P6 scorecard width check

Before migrating line 1559 from 900px to 768px, verify that the P6 scorecard's 3-column layout renders acceptably at 769px viewport width (~245px per column). If not, keep at 900px or use `bp-md` (1024px) instead.

### R5: Document P3 `min-height` specificity interaction

Add a note to Steps 3 and 5 that `.p3ae-summary .kpi-card` and `.p3ah-summary .kpi-card` override the global `min-height: 88px` with `min-height: 80px` (higher specificity), and this is intentional.

### R6: Clarify login page scope

The `.login-card` styles live in `login.html` (inline `<style>`) and are completely separate from `pages.css`. Step 10a should either:
- Be removed from scope (login page already handles its own responsive layout)
- Be rewritten to correctly target `login.html`'s inline styles (different file, different change)
- Be rewritten to correctly describe the actual target (`.wizard-step-label` in the P2 commissioning wizard)

---

## Summary

**Overall verdict:** The DESIGN and PLAN are structurally sound and address all 6 requirements from the REQ. The core changes (Steps 1-9) have accurate line references and correct CSS selectors. However, **Step 10 has 3 critical misidentifications** that would cause the wrong selectors to be migrated if followed literally. These must be corrected before implementation begins.

The risk assessment is generally accurate but underestimates chart width at the two-col boundary (406px actual vs. ~500px estimated) and misses the P6 scorecard column width concern. Neither is a showstopper, but both warrant explicit verification during implementation.

**Blocking issues (must fix before implementation):**
1. Step 10a/10b/10c wrong selectors — fix the migration map
2. DESIGN P2 opt-out selector uses non-existent `data-page` attribute

**Non-blocking issues (fix during implementation):**
3. Document P3 min-height specificity interaction
4. Verify chart width at 406px (two-col at 1024px)
5. Verify P6 scorecard at 769-900px if migrating that breakpoint
6. Clarify that `.login-card` is out of scope (lives in `login.html`)
