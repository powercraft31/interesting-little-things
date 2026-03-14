# PLAN: Responsive Layout Overhaul — Execution Steps

**Date:** 2026-03-14
**Companion:** docs/DESIGN-responsive-layout.md
**Strategy:** Each step is independently deployable. Steps are ordered by dependency and blast radius (lowest risk first).

---

## Step 1: Document breakpoints in `variables.css`

**Files:** `frontend-v2/css/variables.css` (line 53, before light theme block)
**Change:** Add comment block documenting the 5 standard breakpoints. No functional change.

```css
/* Breakpoints (used as literals in @media — CSS vars not supported in queries)
   --bp-xl: 1440px   (wide desktop — sidebar expands)
   --bp-lg: 1200px   (standard desktop)
   --bp-md: 1024px   (tablet landscape / small laptop — sidebar hidden)
   --bp-sm:  768px   (tablet portrait)
   --bp-xs:  480px   (mobile)
*/
```

**Verify:** No visual change. All pages render identically.
**Blast radius:** None. Comment only.

---

## Step 2: Add `max-width` to `.page-content`

**Files:** `frontend-v2/css/layout.css` (lines 237-241)
**Change:** Add `max-width: 1600px` and `margin: 0 auto` to `.page-content`:

```css
/* layout.css line 237 — modify .page-content */
.page-content {
  padding: var(--space-lg);
  min-width: 0;
  overflow-x: hidden;
  max-width: 1600px;      /* NEW */
  margin-left: auto;      /* NEW */
  margin-right: auto;     /* NEW */
}
```

**Also add** P2 opt-out in `pages.css` (after line 43, before P2 filter bar):

```css
/* P2 tables need full width */
#page-devices .page-content {
  max-width: none;
}
```

Note: If `#page-devices` doesn't wrap `.page-content`, check actual HTML structure. The selector may need to be `.page-section[data-page="devices"] .page-content` — verify in `index.html`.

**Verify:**
- Open at 1920px: content should be centered with ~40px margins on each side
- Open at 1440px: no visible change (content < 1600px)
- P2 Devices table: still stretches full width
- All other pages: content capped, centered

**Blast radius:** Low. Only activates above ~1840px viewport. P2 explicitly excluded.

---

## Step 3: Add `min-height` to `.kpi-card`

**Files:** `frontend-v2/css/components.css` (line 32-41, `.kpi-card` block)
**Change:** Add `min-height: 88px`:

```css
.kpi-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-lg) var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  transition: border-color var(--transition-fast);
  min-height: 88px;  /* NEW — prevents flat ribbon appearance */
}
```

**Verify:**
- KPI cards on all pages (P1, P3, P5) have comfortable vertical proportion
- Cards at 1920px are no taller than necessary (min-height, not fixed height)
- Cards at 768px still look normal

**Blast radius:** Low. Additive change. Cards may be slightly taller on some screens — never shorter.

---

## Step 4: Define `kpi-grid-4` and `kpi-grid-3` in `components.css`

**Files:** `frontend-v2/css/components.css` (insert after line 30, after `kpi-grid-6` block)
**Change:** Add proper grid definitions for 4-column and 3-column KPI grids:

```css
/* 4-column KPI grid (P3 Energy — 8 cards) */
.kpi-grid-4 {
  grid-template-columns: repeat(4, 1fr);
}
@media (max-width: 1024px) {
  .kpi-grid-4 { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 768px) {
  .kpi-grid-4 { grid-template-columns: repeat(2, 1fr); }
}

/* 3-column KPI grid (P3 Health — 3-6 cards) */
.kpi-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}
@media (max-width: 768px) {
  .kpi-grid-3 { grid-template-columns: repeat(2, 1fr); }
}
```

**Verify:**
- P3 Energy: 8 cards in 4x2 grid at desktop, 3+3+2 at <=1024px, 2x4 at <=768px
- P3 Health: 3 cards in 3x1 at desktop, 2+1 at <=768px
- The `!important` overrides in pages.css still apply (they have higher specificity) — this step is safe even before removing them

**Blast radius:** Low. These classes existed in JS but had no CSS. The `!important` overrides still win until Step 5.

---

## Step 5: Remove `!important` overrides from `pages.css`

**Files:** `frontend-v2/css/pages.css`
**Change:** Remove these blocks entirely:

**Lines 2526-2541** — `.p3ae-summary` grid overrides:
```css
/* DELETE these lines */
.p3ae-summary {
  margin-bottom: var(--space-md);
  grid-template-columns: repeat(4, 1fr) !important;
}
@media (max-width: 1000px) {
  .p3ae-summary {
    grid-template-columns: repeat(3, 1fr) !important;
  }
}
@media (max-width: 700px) {
  .p3ae-summary {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}
```

**Lines 2695-2704** — `.p3ah-summary` grid overrides:
```css
/* DELETE these lines */
.p3ah-summary {
  margin-bottom: var(--space-md);
  grid-template-columns: repeat(3, 1fr) !important;
}
@media (max-width: 700px) {
  .p3ah-summary {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}
```

**Keep** the following related styles (they are NOT hacks):
- Lines 2544-2562: `.p3ae-summary .kpi-card` / `.p3ah-summary .kpi-card` min-height and font sizing
- Lines 2564-2573: `@media (max-width: 1100px)` font size overrides (will be migrated in Step 8)

**Also keep** `.p3ae-summary { margin-bottom: var(--space-md); }` by adding it back without the grid override:
```css
.p3ae-summary,
.p3ah-summary {
  margin-bottom: var(--space-md);
}
```

**Verify:**
- P3 Energy: grid columns now controlled by `.kpi-grid-4` from Step 4
- P3 Health: grid columns now controlled by `.kpi-grid-3` from Step 4
- Breakpoints shifted: 1000px -> 1024px, 700px -> 768px
- No visual regression at 1200px, 1024px, 768px

**Blast radius:** Low. Direct replacement — Step 4 must be deployed first.

---

## Step 6: Update `kpi-grid-6` breakpoints in `components.css`

**Files:** `frontend-v2/css/components.css` (lines 14-30)
**Change:** Align breakpoints to standard values:

Replace:
```css
@media (min-width: 1200px) {
  .kpi-grid-6 { grid-template-columns: repeat(6, 1fr); }
}
@media (min-width: 768px) and (max-width: 1199px) {
  .kpi-grid-6 { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 767px) {
  .kpi-grid-6 { grid-template-columns: repeat(2, 1fr); }
}
```

With:
```css
@media (min-width: 1201px) {
  .kpi-grid-6 { grid-template-columns: repeat(6, 1fr); }
}
@media (min-width: 769px) and (max-width: 1200px) {
  .kpi-grid-6 { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 768px) {
  .kpi-grid-6 { grid-template-columns: repeat(2, 1fr); }
}
```

**Verify:**
- P1 Fleet: 6 cards at >=1201px, 3 cards at 769-1200px, 2 cards at <=768px
- Check at 768px exactly — should show 2 columns (was previously 3 due to 768px being in the middle range)

**Blast radius:** Low. 1px boundary shifts. Barely noticeable.

---

## Step 7: Update `two-col` collapse threshold

**Files:** `frontend-v2/css/components.css` (lines 298-302)
**Change:** Change collapse from 1439px to 1023px:

Replace:
```css
@media (max-width: 1439px) {
  .two-col { grid-template-columns: 1fr; }
}
```

With:
```css
@media (max-width: 1023px) {
  .two-col { grid-template-columns: 1fr; }
}
```

**Verify:**
- P1 Fleet at 1200px: two charts side by side (was single column before)
- P1 Fleet at 1023px: single column
- P5 VPP at 1300px: latency chart + event history side by side
- P4 HEMS at 1100px: two-col layout preserved
- All charts in two-col render correctly at ~500px width (half of 1060px minus sidebar/padding)

**Blast radius:** Medium. Users at 1024-1439px will see two-column layouts where they previously saw single-column. Most visible change in this plan. Deploy with confidence but verify charts don't feel cramped at ~500px width.

---

## Step 8: Update P5 VPP grid from 7 to 4 max columns

**Files:** `frontend-v2/css/pages.css` (lines 1369-1386)
**Change:** Replace 7-column grid with 4-column grid:

Replace:
```css
.p5-kpi-grid-7 {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}
@media (max-width: 1200px) {
  .p5-kpi-grid-7 { grid-template-columns: repeat(4, 1fr); }
}
@media (max-width: 700px) {
  .p5-kpi-grid-7 { grid-template-columns: repeat(2, 1fr); }
}
```

With:
```css
.p5-kpi-grid-7 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}
@media (max-width: 1024px) {
  .p5-kpi-grid-7 { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 768px) {
  .p5-kpi-grid-7 { grid-template-columns: repeat(2, 1fr); }
}
```

**Verify:**
- P5 VPP: 7 cards + 1 placeholder = 4x2 grid at desktop
- At 1024px: 3 columns, cards = 3+3+2
- At 768px: 2 columns, cards = 2x4
- Placeholder card (`.p5-kpi-disabled`) renders correctly in all layouts
- Cards have comfortable proportions (not too wide) at 1440px+ with content cap

**Blast radius:** Medium. Cards are wider than before on desktop. But content width cap (Step 2) limits total width to 1600px, so 4 cards at ~375px each — good proportion.

---

## Step 9: Update P6 chart height

**Files:** `frontend-v2/css/pages.css` (line 1651)
**Change:** Make P6 savings chart height responsive:

Replace:
```css
.p6-savings-chart {
  height: 380px;
}
```

With:
```css
.p6-savings-chart {
  height: min(420px, 50vh);
}
```

**Verify:**
- P6 Performance chart renders at 420px on large screens (viewport height > 840px)
- On short viewports (e.g. 760px tall), chart = 380px (50vh) — same as before
- ECharts resize works correctly on window drag

**Blast radius:** Low. Slight height increase on tall viewports. Consistent with P3 chart approach.

---

## Step 10: Migrate remaining non-standard breakpoints in `pages.css`

**Files:** `frontend-v2/css/pages.css`
**Changes:** Update each non-standard `@media` query to the nearest standard breakpoint.

### 10a: P2 wizard step labels (line 387)
```css
/* Change min-width: 640px -> min-width: 769px */
@media (min-width: 769px) {
```

### 10b: P4 HEMS mode cards (line 939)
```css
/* Change max-width: 800px -> max-width: 768px */
@media (max-width: 768px) {
```

### 10c: P6 scorecard grid (line 1559) — SKIP
Keep at `max-width: 900px`. Review found 3-col at 245px per column is too narrow.

### 10d: Detail columns (line 1916)
```css
/* Change max-width: 900px -> max-width: 768px */
@media (max-width: 768px) {
```

### 10e: P3AE KPI font sizes (line 2564)
```css
/* Change max-width: 1100px -> max-width: 1024px */
@media (max-width: 1024px) {
```

### 10f: P3AE chart responsive (line 2594)
```css
/* Change max-width: 900px -> max-width: 768px */
@media (max-width: 768px) {
```

### 10g: P3AE chart mobile (line 2604)
```css
/* Change max-width: 600px -> max-width: 480px */
@media (max-width: 480px) {
```

### 10h: P3AH chart responsive (line 2710)
```css
/* Change max-width: 900px -> max-width: 768px */
@media (max-width: 768px) {
```

**Verify per sub-step:**
- 10a: P2 wizard step labels at 640-768px range (labels may hide in this range)
- 10b: P4 mode cards stack at 768px instead of 800px
- 10c: SKIPPED — P6 scorecard kept at 900px
- 10d: Device detail columns at 769-900px
- 10e: P3AE KPI fonts at 1025-1100px (now use desktop font size)
- 10f: P3AE chart height at 769-900px
- 10g: P3AE chart mobile height at 481-600px
- 10h: P3AH chart height at 769-900px

**Blast radius:** Medium cumulative. Each sub-step shifts a breakpoint by 30-160px. Deploy all together as they form a coherent system, but test each page individually.

---

## Step 11: Final verification

**Files:** None (testing only)
**Verify at 5 standard widths: 1920px, 1440px, 1200px, 1024px, 768px**

| Page | 1920px | 1440px | 1200px | 1024px | 768px |
|------|--------|--------|--------|--------|-------|
| P1 Fleet | Content capped, 6 KPI cols, two-col charts | Same, sidebar collapsed | 3 KPI cols, two-col charts | 3 KPI cols, single-col charts | 2 KPI cols |
| P2 Devices | Full-width table | Same | Same | Same, sidebar hidden | Table scrolls horizontally |
| P3 Energy | 4x2 KPIs, full chart | Same | Same | 3+3+2 KPIs | 2x4 KPIs |
| P3 Health | 3x1 KPIs, 4 charts | Same | Same | Same | 2+1 KPIs |
| P4 HEMS | Two-col layout | Same, sidebar collapsed | Same | Single-col | Same |
| P5 VPP | 4+4 KPIs, two-col | Same | Same | 3+3+2 KPIs, single-col | 2x4 KPIs |
| P6 Perf | Responsive chart height | Same | Same | Same | Same |

**Additional checks:**
- [ ] Window resize (drag): no clipping (regression test for commit 4c2a6ba)
- [ ] ECharts charts resize smoothly on all pages
- [ ] Login page unaffected at all widths
- [ ] Light theme: no visual regressions
- [ ] Content is centered on ultrawide (2560px) monitors

---

## Dependency Graph

```
Step 1 (comment) ─── no deps ────────────────────────── deploy anytime
Step 2 (max-width) ─── no deps ──────────────────────── deploy anytime
Step 3 (min-height) ── no deps ──────────────────────── deploy anytime
Step 4 (grid defs) ─── no deps ──────────────────────── deploy anytime
Step 5 (remove !) ──── depends on Step 4 ────────────── deploy after 4
Step 6 (grid-6 bp) ─── no deps ──────────────────────── deploy anytime
Step 7 (two-col) ───── no deps ──────────────────────── deploy anytime
Step 8 (P5 grid) ───── no deps ──────────────────────── deploy anytime
Step 9 (P6 chart) ──── no deps ──────────────────────── deploy anytime
Step 10 (bp migrate) ─ no deps (but best after 5) ──── deploy after 5
Step 11 (verify) ───── depends on all above ─────────── last
```

Steps 1-4 and 6-9 can all be deployed in parallel. Step 5 must wait for Step 4. Step 10 is best done after Step 5 (so P3 breakpoints are clean). Step 11 is final verification.

---

## Rollback Strategy

Each step modifies only CSS (no JS changes, no DB changes, no API changes). Rollback = `git revert <commit>` for any individual step. The only dependency is Step 5 requires Step 4 — if reverting Step 4, also revert Step 5 to restore the `!important` overrides.
