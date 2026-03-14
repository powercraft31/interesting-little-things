# REQ: Responsive Layout Overhaul

**Date:** 2026-03-14
**Reporter:** Alan (正倫 金) + Ashe audit
**Priority:** P1 (user-reported, affects all pages)

---

## 1. Problem Statement

The portal's CSS layout was designed with a "don't overflow" mindset but never addressed "don't over-stretch." On wide screens (≥1400px), all content stretches to fill 100% of available width, causing:

1. **KPI cards become flat ribbons** — aspect ratio degrades to ~6:1 (width:height), numbers look tiny inside oversized cards
2. **Charts become horizontally squashed** — data peaks/troughs flatten, readability drops
3. **On narrow screens (≤1100px)**, KPI cards wrap unevenly (5+3 or 6+2 instead of neat rows)
4. **During window resize**, charts get cut off (root cause already fixed: flex `min-width:auto` trap — commit `4c2a6ba`)

Alan's exact feedback:
- "視窗會把字和圖片遮住" (window clips text and images)
- "很堅持要把視窗塞滿 導致畫面不協調" (insists on filling the window, causing visual disharmony)
- "每個頁面都是這樣" (every page has this problem)

## 2. Current State Audit

### 2.1 Pages & Components

| Page | KPI Grid | Card Count | Grid Class | Charts | Chart Heights | two-col |
|------|----------|------------|------------|--------|---------------|---------|
| P1 Fleet | ✅ | 6 | `kpi-grid-6` | 2 (uptime-trend 320px, device-dist 280px) | Fixed px | ✅ |
| P2 Devices | ❌ | 0 | — | 0 | — | ❌ |
| P3 Energy | ✅ | 8 | `kpi-grid-4` (custom) | 1 | min(420px, 50vh) | ❌ |
| P3 Health | ✅ | 3-6 | `kpi-grid-3` (custom) | 4 | min(320px, 45vh) | ❌ |
| P4 HEMS | ❌ | 0 | — | 0 | — | ✅ |
| P5 VPP | ✅ | 7 | `p5-kpi-grid-7` | 1 (320px) | Fixed px | ✅ |
| P6 Performance | ❌ | 0 | — | 1 (380px) | Fixed px | ❌ |

### 2.2 CSS Architecture

**Files:**
- `variables.css` (76 lines) — design tokens
- `layout.css` (382 lines) — app shell, sidebar, responsive breakpoints
- `components.css` (386 lines) — shared components (kpi-grid, section-card, chart-container, two-col, data-table)
- `pages.css` (2756 lines) — per-page overrides

**Current Breakpoints (inconsistent):**
- Layout: 1439px (sidebar collapse), 1023px (sidebar hidden)
- Components: 1200px / 768px / 767px (kpi-grid-6), 1439px (two-col → single col)
- Pages: 1200px, 1100px, 1024px, 1000px, 939px, 900px, 800px, 700px, 640px, 600px
- **Problem: 12+ different breakpoint values with no unified system**

**Current kpi-grid base:**
```css
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-md);
}
```
- `auto-fit` with `minmax(160px, 1fr)` means card count per row is unpredictable — depends on container width, causing ragged wrapping

**Current chart-container base:**
```css
.chart-container {
  width: 100%;
  min-width: 0;
  min-height: 300px;
  overflow: hidden;
}
```

**Current kpi-card base:**
```css
.kpi-card {
  padding: var(--space-lg) var(--space-md);  /* 24px 16px */
  /* No min-height, no max-width */
}
```

### 2.3 Already Fixed (commit 4c2a6ba)
- `.main-content` → `min-width: 0` + `overflow-x: hidden`
- `.page-content` → `min-width: 0` + `overflow-x: hidden`
- `.chart-container` → `min-width: 0` + `overflow: hidden`
- These fixes address the resize clipping. The remaining work is proportional balance.

## 3. Requirements

### R1: Unified Breakpoint System
Define a consistent set of breakpoints as CSS custom properties or documented constants. Suggested:
- `--bp-xl`: 1440px (wide desktop)
- `--bp-lg`: 1200px (desktop)
- `--bp-md`: 1024px (tablet landscape)
- `--bp-sm`: 768px (tablet portrait)
- `--bp-xs`: 480px (mobile)

All `@media` rules across all CSS files must use only these breakpoints.

### R2: Content Width Constraint
On wide screens (>1440px), the main content area should have a maximum effective width so elements don't stretch infinitely. Options to evaluate:
- A) `max-width` on `.page-content` with `margin: 0 auto` (centers content)
- B) `max-width` on individual sections (more granular control)
- C) A combination (e.g., max-width on content but let full-bleed tables stretch)

**Constraint:** P2 (Devices) is a table-heavy page. Tables may benefit from wider widths. The solution must not harm table-based pages.

### R3: KPI Card Proportions
KPI cards must maintain readable proportions at all viewport widths:
- Target aspect ratio: 2.5:1 to 4:1 (width:height)
- Minimum card height: ~80-100px
- Value font size must scale with card size (not fixed small)
- Cards must wrap into **neat complete rows** (no ragged 5+1 or 6+2)

Per-page card counts:
- P1: 6 cards → 3×2 or 2×3
- P3 Energy: 8 cards → 4×2
- P3 Health: 3-6 cards → 3×1 or 3×2
- P5: 7 cards → 4+3 or 3+3+1 (needs design decision for odd count)

### R4: Chart Proportions
Charts must not become too flat on wide screens:
- Consider `max-width` or `aspect-ratio` for chart containers
- Charts in `two-col` layouts (P1, P4, P5) are naturally narrower — those are probably fine
- Full-width charts (P3 Energy, P6) need height that scales with width

### R5: two-col Breakpoint
Currently `two-col` collapses to single column at 1439px. This is too aggressive — on a 1300px screen, two columns of ~600px each are perfectly readable. Evaluate raising the collapse threshold or using a content-aware approach.

### R6: No Regression
- Window resize (drag) must not clip charts or cards (already fixed, must not regress)
- ECharts ResizeObserver must continue to function
- Login page must not be affected
- Light theme must not be affected
- All 6 pages must be tested at: 1920px, 1440px, 1200px, 1024px, 768px

## 4. Reference

- **Normal screenshot:** (Alan's first image — properly proportioned dashboard at ~1400px)
- **Abnormal screenshot:** (Alan's second image — cards squished, chart cut off at ~1100px)
- **Wide screen screenshot:** (Alan's third image — everything stretched flat at ~1900px)
- **Tesla Powerwall reference:** https://www.tesla.com/support/energy/powerwall/mobile-app/energy-data

## 5. Files In Scope

```
frontend-v2/css/variables.css    (76 lines)
frontend-v2/css/layout.css       (382 lines)
frontend-v2/css/components.css   (386 lines)
frontend-v2/css/pages.css        (2756 lines)
```

**JS files** — only if HTML structure needs changing (e.g., kpi-grid class names):
```
frontend-v2/js/p1-fleet.js       (KPI grid, two-col charts)
frontend-v2/js/p3-asset-energy.js (KPI grid, single chart)
frontend-v2/js/p3-asset-health.js (KPI grid, 4 charts)
frontend-v2/js/p5-vpp.js         (KPI grid, two-col charts)
frontend-v2/js/p6-performance.js  (single chart)
frontend-v2/js/components.js      (kpiCard builder, sectionCard builder)
```

## 6. Constraints

- **CSS-only preferred.** Minimize JS changes.
- **No framework.** This is vanilla HTML/CSS/JS.
- **Dark theme is primary.** Light theme must not regress but is secondary.
- **ECharts integration.** Charts use `Charts.createChart()` with ResizeObserver. Any CSS change must not break resize behavior.
- **Must revert my ad-hoc P3 hacks** — the `!important` grid overrides on `.p3ae-summary` and `.p3ah-summary` in pages.css should be removed and replaced with the proper system.
