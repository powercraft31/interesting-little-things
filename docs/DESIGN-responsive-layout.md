# DESIGN: Responsive Layout Overhaul

**Date:** 2026-03-14
**Author:** Auto-generated from REQ-responsive-layout.md audit
**Status:** Draft — pending review

---

## 1. Unified Breakpoint System

### Current State (12+ inconsistent values)

| File | Breakpoints Used |
|------|-----------------|
| `layout.css` | 1439px, 1023px |
| `components.css` | 1439px, 1200px, 1023px, 768px, 767px |
| `pages.css` | 1200px, 1100px, 1024px, 1000px, 939px, 900px, 800px, 700px, 640px, 600px |

### Proposed System (5 breakpoints)

| Token | Value | Rationale |
|-------|-------|-----------|
| `--bp-xl` | `1440px` | Wide desktop. Sidebar expands. Content gets max-width cap. |
| `--bp-lg` | `1200px` | Standard desktop. KPI grids reduce columns. |
| `--bp-md` | `1024px` | Tablet landscape / small laptop. Sidebar hidden. |
| `--bp-sm` | `768px` | Tablet portrait. KPI grids to 2 columns. |
| `--bp-xs` | `480px` | Mobile. Single column everything. |

**Note:** CSS custom properties cannot be used in `@media` queries (spec limitation). The values will be documented as constants in `variables.css` comments and applied as literal pixel values in `@media` rules.

### Migration Map

Each existing breakpoint maps to the nearest standard value:

| Current Value | Maps To | Notes |
|---------------|---------|-------|
| 1439px | `1440px` (bp-xl) | Off-by-one — use `max-width: 1439px` = `< 1440px` |
| 1200px | `1200px` (bp-lg) | Keep as-is |
| 1100px | `1200px` (bp-lg) | Round up — minor visual difference |
| 1024px | `1024px` (bp-md) | Keep as-is |
| 1023px | `1024px` (bp-md) | Off-by-one — use `max-width: 1023px` = `< 1024px` |
| 1000px | `1024px` (bp-md) | Round up |
| 939px | `1024px` (bp-md) | Round up |
| 900px | `768px` (bp-sm) | Collapse to next tier — 900 too close to 1024 |
| 800px | `768px` (bp-sm) | Round down |
| 767px | `768px` (bp-sm) | Off-by-one — use `max-width: 767px` = `< 768px` |
| 700px | `768px` (bp-sm) | Round up |
| 640px | `480px` (bp-xs) | Skip to mobile |
| 600px | `480px` (bp-xs) | Skip to mobile |

**Risk:** Medium. Some layouts currently change at 900px and will now change at 768px, causing a wider "desktop-like" range. Test P3 charts and detail columns at 800-900px to verify they still look acceptable.

---

## 2. Content Width Strategy

### Problem

On wide screens (>1440px), `.page-content` is `width: 100%` with no cap. KPI cards become flat ribbons, charts stretch to full viewport minus sidebar.

### Proposed Solution: Hybrid (Option C from REQ)

Add `max-width` to `.page-content` with a per-page opt-out:

```css
/* In layout.css, after existing .page-content block (line 237) */
.page-content {
  max-width: 1600px;
  margin-left: auto;
  margin-right: auto;
}
```

**Per-page exceptions:**

| Page | Selector | max-width | Rationale |
|------|----------|-----------|-----------|
| P2 (Devices) | `#page-devices .page-content` | `none` | Table-heavy — needs full width for many columns |
| All others | inherited from `.page-content` | `1600px` | Prevents over-stretch on 2560px+ monitors |

**Value rationale — 1600px:**
- At 1920px viewport with 240px sidebar, content area = 1680px -> capped at 1600px, leaving 40px margin each side. Natural centering.
- At 1440px viewport with 60px collapsed sidebar, content area = 1380px -> under cap, no effect.
- At 2560px ultrawide, content = 1600px centered with generous margins. Much better than 2300px stretch.

**Risk:** Low. The cap only activates above 1600px content width, meaning no change at viewports <= ~1840px. Most users won't notice until they go ultrawide.

---

## 3. KPI Card Proportion Fix

### 3.1 Base `.kpi-card` improvements

```css
/* In components.css, modify .kpi-card (line 32) — add min-height */
.kpi-card {
  /* existing properties kept */
  min-height: 88px;  /* Prevents flat ribbon appearance */
}
```

No `max-width` on individual cards — the grid system controls width. The `min-height` alone prevents the 6:1 aspect ratio problem.

### 3.2 Per-page grid column definitions

Replace `auto-fit` with explicit column counts per breakpoint. This eliminates ragged wrapping (5+1, 6+2, etc.).

#### P1 Fleet — 6 cards (`kpi-grid-6`)

Already defined in `components.css:14-30`. Current rules are correct but use non-standard breakpoints (768px/767px gap). Migrate:

```css
/* components.css — replace lines 14-30 */
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

Layout: 6 -> 3x2 -> 2x3. Always neat rows.

#### P3 Energy — 8 cards (`kpi-grid-4` + `p3ae-summary`)

**Current state:** `kpi-grid-4` has NO CSS definition. Falls back to `auto-fit` from `.kpi-grid`. The `.p3ae-summary` class in `pages.css:2526-2541` overrides with `!important`.

**Proposed:** Define `kpi-grid-4` properly in `components.css`, then remove `!important` hacks:

```css
/* components.css — new rules after kpi-grid-6 block */
.kpi-grid-4 {
  grid-template-columns: repeat(4, 1fr);
}
@media (max-width: 1024px) {
  .kpi-grid-4 { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 768px) {
  .kpi-grid-4 { grid-template-columns: repeat(2, 1fr); }
}
```

Layout: 4x2 -> 3+3+2 -> 2x4. The 8 cards divide evenly at 4 and 2.

#### P3 Health — 3-6 cards (`kpi-grid-3` + `p3ah-summary`)

**Current state:** `kpi-grid-3` has NO CSS definition. `.p3ah-summary` overrides with `!important` at `pages.css:2695-2704`.

**Proposed:** Define `kpi-grid-3` in `components.css`:

```css
/* components.css — new rules */
.kpi-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}
@media (max-width: 768px) {
  .kpi-grid-3 { grid-template-columns: repeat(2, 1fr); }
}
```

Layout: 3 per row (or 3+3 if 6 cards) -> 2 per row on small screens.

#### P5 VPP — 7 cards (`p5-kpi-grid-7`)

**Current state:** Defined in `pages.css:1369-1386`. Uses `repeat(7, 1fr)` on desktop, `repeat(4, 1fr)` at <=1200px, `repeat(2, 1fr)` at <=700px.

**Problem:** 7 columns on desktop creates very narrow cards on sub-1440px screens. At 4 columns, 7 cards = 4+3 (gap in last row).

**Proposed:** Max 4 columns. The JS (`p5-vpp.js:~138`) already creates a placeholder 8th card (`.p5-kpi-disabled`), giving 4+4 at 4 columns:

```css
/* pages.css — replace lines 1369-1386 */
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

Layout: 4+4 -> 3+3+2 -> 2+2+2+2. All neat rows because the placeholder fills the 8th slot.

**Risk:** Low for P1/P3. Medium for P5 — changing from 7 columns to 4 means cards are wider on large screens. Verify at 1440px+ that placeholder card logic still works.

---

## 4. Chart Proportion Fix

### Problem

Charts have fixed `height` values (280px-420px). On wide screens, a 1600px-wide chart at 320px tall has a ~5:1 aspect ratio — data appears flat.

### Proposed Solution

The **primary fix** is the content width cap (Section 2). With `max-width: 1600px`, full-width charts are naturally capped at ~1550px (minus padding). At 1550px x 420px = 3.7:1 ratio — acceptable.

For charts already using responsive heights, keep them. For fixed-height charts that render full-width, add `min()`:

| Chart | File:Line | Current | Proposed | Rationale |
|-------|-----------|---------|----------|-----------|
| `fleet-uptime-chart` | `pages.css:7` | `320px` | `320px` (keep) | Inside `two-col` — naturally constrained |
| `fleet-device-dist-chart` | `pages.css:11` | `280px` | `280px` (keep) | Inside `two-col` |
| `p3ae-chart` | `pages.css:2575` | `min(420px, 50vh)` | Keep | Already responsive |
| `p3ah-chart` | `pages.css:2706` | `min(320px, 45vh)` | Keep | Already responsive |
| `p5-latency-chart` | `pages.css:1515` | `320px` | `320px` (keep) | Inside `two-col` |
| `p6-savings-chart` | `pages.css:1651` | `380px` | `min(420px, 50vh)` | Full-width — needs responsive height |

### ECharts Compatibility

ECharts' `ResizeObserver` reads `clientWidth`/`clientHeight`. All proposed changes (changing `height`, adding `max-width` on parents, changing grid columns) produce resolved pixel dimensions that ResizeObserver can read. No compatibility issues.

**Unsafe CSS to avoid:** `display: none` on chart containers, `transform: scale()`, `visibility: hidden` with `height: 0`.

**Risk:** Low. Only P6 chart changes height. The content width cap does the heavy lifting.

---

## 5. `two-col` Collapse Threshold

### Current State

`components.css:298-302` — `.two-col` collapses to single column at `max-width: 1439px`.

With sidebar collapsed (60px) at 1300px viewport, each column = (1300 - 60 - 48px padding - 24px gap) / 2 ~ 584px. That's plenty of space for a chart.

### Proposed Change

```css
/* components.css — replace lines 298-302 */
@media (max-width: 1023px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
```

Collapse at `< 1024px` (bp-md boundary) instead of `< 1440px`. This means:
- 1024px-1439px: two columns with collapsed sidebar (60px). Each column ~ 450-660px. Charts render well.
- <=1023px: single column, sidebar hidden. Full width for each chart.

**Risk:** Medium. Users previously seeing single-column at 1200-1439px will now see two columns. Charts in those two columns will be narrower (~500px). Verify that ECharts renders acceptably at 450px width. The `min-width: 0` fix from commit `4c2a6ba` ensures no overflow.

---

## 6. What to REMOVE

### 6.1 `!important` grid overrides in `pages.css`

| Lines | Selector | Current Rule | Action |
|-------|----------|-------------|--------|
| 2528 | `.p3ae-summary` | `grid-template-columns: repeat(4, 1fr) !important` | **Remove.** Replaced by `.kpi-grid-4` in `components.css` |
| 2531-2535 | `@media <=1000px .p3ae-summary` | `repeat(3, 1fr) !important` | **Remove.** Replaced by `@media <=1024px .kpi-grid-4` |
| 2537-2541 | `@media <=700px .p3ae-summary` | `repeat(2, 1fr) !important` | **Remove.** Replaced by `@media <=768px .kpi-grid-4` |
| 2697 | `.p3ah-summary` | `repeat(3, 1fr) !important` | **Remove.** Replaced by `.kpi-grid-3` in `components.css` |
| 2700-2704 | `@media <=700px .p3ah-summary` | `repeat(2, 1fr) !important` | **Remove.** Replaced by `@media <=768px .kpi-grid-3` |

### 6.2 Non-standard breakpoints to migrate in `pages.css`

| Line | Current | Target | Selector |
|------|---------|--------|----------|
| 387 | `min-width: 640px` | `min-width: 769px` | `.wizard-step-label` (P2 commissioning wizard) |
| 939 | `max-width: 800px` | `max-width: 768px` | `.p4-mode-cards` (P4 HEMS mode cards) |
| 1382 | `max-width: 700px` | `max-width: 768px` | P5 kpi-grid |
| 1559 | `max-width: 900px` | Keep at `900px` | `.p6-scorecard-grid` (P6 — 3 cols at 245px too narrow, keep original) |
| 1916 | `max-width: 900px` | `max-width: 768px` | Detail columns |
| 2564 | `max-width: 1100px` | `max-width: 1024px` | P3AE kpi font size |
| 2594 | `max-width: 900px` | `max-width: 768px` | P3AE chart height |
| 2604 | `max-width: 600px` | `max-width: 480px` | P3AE chart height mobile |
| 2710 | `max-width: 900px` | `max-width: 768px` | P3AH chart height |

### 6.3 Keep as-is (already aligned or out of scope)

- Lines 1139-1145: `!important` on `.p4-btn-apply` — styling override, not layout. Out of scope.
- Lines 2139-2140: `!important` on `.schedule-mode-select` — UI component override. Out of scope.
- Lines 1376, 1876, 2587: Already at standard breakpoints (1200px, 1024px). Keep.

---

## 7. Risk Assessment Summary

| Change | Blast Radius | Risk | Mitigation |
|--------|-------------|------|------------|
| Breakpoint unification | All pages | **Medium** | Test each page at 800, 900, 1100px |
| `max-width: 1600px` on page-content | All except P2 | **Low** | Only activates above 1840px viewport |
| KPI card `min-height: 88px` | All KPI cards | **Low** | Additive — cards get taller, never shorter |
| `kpi-grid-4` / `kpi-grid-3` defs | P3 Energy, P3 Health | **Low** | Direct replacement for `!important` hacks |
| P5 grid: 7->4 max columns | P5 VPP | **Medium** | Cards wider on large screens. Verify placeholder logic |
| `two-col` threshold: 1439->1024 | P1, P4, P5 | **Medium** | Verify chart readability at ~500px width |
| P6 chart height change | P6 Performance | **Low** | Slight height increase at most viewports |
| Remove `!important` overrides | P3 Energy/Health | **Low** | New component rules take over |
| Breakpoint migration | Multiple pages | **Medium** | Deploy incrementally per page |
