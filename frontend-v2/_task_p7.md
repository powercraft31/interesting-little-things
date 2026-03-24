# Task: Phase 7 — Integration, Polish & Cross-Page Navigation

## Working Directory
`/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/frontend-v2/`

## Context
All 6 pages (P1-P6) are complete and working independently. This phase focuses on:
1. Cross-page navigation links
2. Role switching completeness
3. Visual consistency
4. Skeleton loading on every page
5. Smooth page transitions

## Existing Code
All JS/CSS files are populated and working. Read the existing code before modifying.

---

## T7.1 Cross-Page Navigation Links

### P4 → P3 Link
In `p4-hems.js`, the "View behavior changes →" link at the bottom of Rule Application Status should navigate to `#energy` when clicked. Verify this works.

### P1 → P2 Link
In `p1-fleet.js`, clicking a device in the offline events table could navigate to `#devices` and filter to that device. Optional enhancement.

### Sidebar Active State
- Current page should be highlighted in sidebar (check this already works)
- Verify hash changes update sidebar highlight

## T7.2 Role Switching Completeness

Test and fix these role behaviors:

### SOLFACIL Admin (Full Access)
- All 6 pages visible in sidebar
- All controls enabled
- Theme: dark

### Integrador
- P4 (HEMS) and P5 (VPP): controls disabled with visual indicator "Requires Admin"
- P2 (Devices): filtered to own org's devices only (org-001 = Solar São Paulo)
- P1 (Fleet): Integrador table filtered to own org
- Theme: light mode (data-theme="light")

### Customer
- Sidebar: only Fleet + Performance visible
- All other pages show "Coming Soon" or redirect to Fleet
- Or show a "Customer Portal — Coming Soon" overlay

## T7.3 Visual Polish

### ECharts Theme Consistency
- All charts should have consistent:
  - Dark background matching `var(--card)`
  - Grid lines matching `var(--border)`
  - Tooltip style: dark bg, white text, rounded corners
  - Text colors matching `var(--text)` and `var(--muted)`
- Check all charts render correctly in Light Mode (Integrador) too

### Page Transition Animation
- When switching pages via sidebar, add a subtle fade-in effect:
```css
.page-section {
  animation: fadeIn 200ms ease-in;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### Empty States
- Any table with no data should show "No data available" centered message
- This is mainly for filtered views (e.g., Integrador with status filter showing 0 results)

### KPI Card Sparklines (P1)
- If sparklines are placeholder divs, either add simple CSS sparklines or remove the placeholder space
- Keep it clean — no empty boxes

## T7.4 Responsive Basics
- Sidebar: at width < 768px, collapse to icon-only mode (60px wide)
- Main content: reduce padding to 16px on narrow screens
- KPI cards: stack to 2 columns on tablet, 1 column on mobile
- Tables: add horizontal scroll wrapper on narrow screens

## T7.5 Bug Fixes from Verification

### Known Issue: Uptime Chart markLine
The P1 uptime chart has a `visualMap` + `markLine` conflict that causes `coord` errors. The `visualMap` was already removed, but verify the markLine (90% target line) still renders correctly.

### Known Issue: P3 Energy Chart markArea
The P3 energy flow chart uses `markArea` for tariff zones. Verify these render without `coord` errors (same ECharts bug pattern).

### Chart Initialization Pattern
Ensure ALL pages follow this pattern for chart init:
```js
try { this._initSomeChart(); } catch(e) { console.error('[PageName] Chart error:', e); }
```
This prevents one chart failure from blocking other charts.

---

## Acceptance Criteria
1. All 6 pages navigable via sidebar — no broken links
2. Page transitions have subtle fade animation
3. Role switch Admin→Integrador→Customer all work correctly:
   - Integrador: light theme, filtered data, disabled controls
   - Customer: limited sidebar, coming soon overlay
4. No console errors on any page (chart coord errors must be fixed)
5. Tables show "No data" for empty filtered results
6. Sidebar collapses on narrow viewport
7. All ECharts responsive (resize when sidebar collapses)

## Completion Signal
```
openclaw system event --text "Phase 7 DONE: Integration and polish complete. Full Admin Portal ready for P8 review." --mode now
```
