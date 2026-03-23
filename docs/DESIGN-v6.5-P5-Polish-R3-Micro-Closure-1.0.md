# DESIGN-v6.5-P5-Polish-R3-Micro-Closure-1.0

## Status
Design 1.0 — aligned against REQ-v6.5-P5-Polish-R3-Micro-Closure-0.1.

---

## Scope

This document defines three micro frontend fixes to close the remaining P5 homepage semantic gaps after R2. All changes are frontend-only. No backend, no schema, no new endpoints.

---

## D1. Deferred Card Grammar in `watch_next`

### Current behavior (`p5-strategy.js:344-381`)

The `_buildIntentCard` function renders **one governance badge** per card:

```javascript
metaBadges.push('<span class="p5-strategy-badge p5-strategy-badge-governance">'
  + t("p5.strategy.governance." + (intent.governance_mode || "observe")) + "</span>");
```

When a card has `status: "deferred"` but `governance_mode: "escalate"` (e.g., a peak_shaving intent dominated by reserve_protection during arbitration and originally governed as escalate), the **primary badge reads "ESCALAR"** (Escalate).

### Why this creates semantic tension

The card sits in the `watch_next` lane, whose meaning is: *observe / deferred / not actionable now*. But the primary badge screams "Escalate" — implying the operator should act on it urgently. The lane says "wait," the badge says "act." This is a low-severity contradiction (R2 fixed the critical ones), but it makes the card grammar unclean.

### Root cause

The badge always renders `governance_mode` as the primary signal. But for deferred cards, the **status** (`deferred`) is the more important signal — it tells the operator *what happened to this intent*. The `governance_mode` is historical context (how it *was* governed before arbitration deferred it).

### Fix specification

**Rule:** For any card with `status === "deferred"`, the primary badge must show the deferred status, not the governance mode.

Specifically, in `_buildIntentCard`:

1. **Primary badge** — If `intent.status === "deferred"`, render a `Deferred` badge (using `p5-strategy-status-deferred` CSS class, which already exists at `pages.css:5282`). Otherwise, render the governance mode badge as today.

2. **Governance mode as secondary** — When the primary badge shows `Deferred`, render the governance mode as a smaller secondary badge or inline text so the operator can still see the original governance context. This uses the existing `p5-strategy-badge-governance` class but at reduced visual weight.

3. **Helper text** — Add a one-line secondary explanation below the reason_summary for deferred cards. The text should come from the `arbitration_note` field (already present on deferred intents after R2). If `arbitration_note` is non-null, render it as a `p5-strategy-intent-arb-note` line. This tells the operator *why* the intent was deferred.

### Badge grammar table

| `status` | `governance_mode` | Primary badge | Secondary info |
|----------|-------------------|---------------|----------------|
| `active` | `approval_required` | Approval Required | (urgency badge) |
| `active` | `escalate` | Escalate | (urgency badge) |
| `active` | `auto_governed` | Auto-Governed | (urgency badge) |
| `active` | `observe` | Observe | (urgency badge) |
| `deferred` | any | **Deferred** | governance mode (muted) + arbitration_note |

### Scope of rule

This is a **generic rule for all deferred cards**, not P5-specific or watch_next-specific. Any card with `status === "deferred"` follows this grammar regardless of which lane it appears in. This is correct because `deferred` is an arbitration outcome that supersedes the original governance mode as the primary operator signal.

### i18n keys needed

No new i18n keys needed. Existing keys cover this:
- `p5.strategy.ctx.deferred` → "Deferred" / "Adiados" / "已延迟" (reusable for badge text)
- Or add a dedicated badge key `p5.strategy.status.deferred` if the badge label should differ from the counter label

**Recommendation:** Add one new key for the badge label:

| Key | EN | PT-BR | ZH-CN |
|-----|-----|-------|-------|
| `p5.strategy.badge.deferred` | `Deferred` | `Adiado` | `已延迟` |
| `p5.strategy.badge.deferredBy` | `Originally: {mode}` | `Original: {mode}` | `原治理: {mode}` |

---

## D2. P5 Page Naming / Navigation Label

### Current state

The P5 page uses these labels across three files:

| Key | EN | PT-BR | ZH-CN | File |
|-----|-----|-------|-------|------|
| `nav.vpp` | `VPP` | `VPP` | `VPP & DR` | `i18n.js:20,893,1795` |
| `page.vpp` | `VPP & DR` | `VPP & DR` | `VPP & DR` | `i18n.js:28,901,1803` |

Additionally, `app.js:75-81` defines the page entry:
```javascript
{ id: "vpp", hash: "#vpp", labelKey: "page.vpp", icon: "🔋", navKey: "nav.vpp", roles: ["admin"] }
```

### Why `VPP & DR` is wrong

P5 was redefined in v6.5 as the **Strategy Trigger Layer** — a governance/posture-aware workbench where the platform evaluates conditions, resolves intent governance, and presents a triage view. It is no longer about "Virtual Power Plant" or "Demand Response" as standalone concepts. The current label:
- Misleads operators into expecting a VPP dispatch panel
- Conflicts with the posture-first hero narrative that R1/R2 established
- Creates a navigation → content mismatch

### Naming decision

**New labels:**

| Key | EN | PT-BR | ZH-CN |
|-----|-----|-------|-------|
| `nav.vpp` | `Strategy` | `Estratégia` | `策略` |
| `page.vpp` | `Strategy Triggers` | `Gatilhos de Estratégia` | `策略触发` |

### Why this wording

1. **"Strategy"** is short enough for the sidebar nav (where space is limited)
2. **"Strategy Triggers"** as the page title matches the internal P5 definition and the hero content
3. It does **not** attempt a full IA rename — the page `id` stays `"vpp"`, the hash stays `#vpp`, the CSS classes keep their `p5-` prefix. Only the user-visible text changes.
4. This is the right R3 compromise: minimal change surface, maximum semantic alignment

### What does NOT change

- Page `id` remains `"vpp"` in `app.js` PAGES array
- Hash route remains `#vpp`
- All CSS class names keep `p5-strategy-*` prefix (already correct)
- Backend endpoint remains `/api/p5/overview`
- The `StrategyPage` JS object name stays the same

---

## D3. Deferred Counter Explainability

### Current behavior (`p5-strategy.js:586-597`)

The context section renders:
```
Pending Counts
Suppressed: N    Deferred: N
```

No explanation of what these numbers mean. The operator sees a count but has no way to understand:
- What "deferred" means in this context
- Why the count might not match visible cards
- Whether this is a problem or normal governance behavior

### Root cause

The counter was added as a raw number projection. It was never given helper text because R2 focused on backend contract closure, not counter explainability.

### Fix specification

Add a single-line helper text below the deferred/suppressed counts.

**New rendering structure:**
```
Pending Counts
Suppressed: N    Deferred: N
{helper text}
```

**Helper text content:**

| Key | EN | PT-BR | ZH-CN |
|-----|-----|-------|-------|
| `p5.strategy.ctx.countsHelper` | `Strategy intents deferred or suppressed by governance rules. Not all may appear in triage lanes above.` | `Intenções estratégicas adiadas ou suprimidas por regras de governança. Nem todas aparecem nas faixas de triagem acima.` | `被治理规则延迟或抑制的策略意图。并非全部显示在上方的分诊通道中。` |

### Design constraints

- **Static text**, not conditional. It always appears when the counts block is visible (i.e., when `suppressed_count > 0 || deferred_count > 0`).
- Rendered as a `<div class="p5-strategy-ctx-counts-helper">` with muted styling
- One line maximum — this is not a verbose audit explanation
- The text answers two questions: "what are these numbers?" and "why don't I see them all on screen?"

---

## D4. Frontend Change Surface

### Files that change

| File | What changes | Why |
|------|-------------|-----|
| `frontend-v2/js/p5-strategy.js` | `_buildIntentCard`: add deferred badge logic; `_buildContextSection`: add helper text line | D1 card grammar + D3 counter helper |
| `frontend-v2/js/i18n.js` | Add 3 new keys per language (badge.deferred, badge.deferredBy, ctx.countsHelper); update `nav.vpp` and `page.vpp` values | D1 i18n + D2 naming + D3 helper text |
| `frontend-v2/css/pages.css` | Add `p5-strategy-ctx-counts-helper` class; optionally add `p5-strategy-badge-deferred` class (or reuse existing `p5-strategy-status-deferred`) | D3 styling + D1 badge styling |

### Files that must NOT change

| File | Reason |
|------|--------|
| `frontend-v2/js/app.js` | Page `id`, hash, and PAGES structure unchanged |
| `backend/**` | No backend changes in R3 |
| `docker-compose.yml` | Infrastructure unchanged |
| `frontend-v2/js/p5-strategy.js` (detail panel, override section, hero section, derived cards) | Only card badge and context counter areas are touched |
| All P1-P4 frontend/backend files | Out of scope |

---

## D5. Acceptance Examples

### Example 1: Deferred card grammar (D1)

**Before:**
```
┌─ watch_next lane ─────────────────────────┐
│ ⚡ Peak Shaving Opportunity               │
│ [ESCALAR]  [Soon]                         │
│ Tariff delta detected...                  │
└───────────────────────────────────────────┘
```
Badge says "Escalate" → operator thinks action is needed, contradicting the `watch_next` lane.

**After:**
```
┌─ watch_next lane ─────────────────────────┐
│ ⚡ Peak Shaving Opportunity               │
│ [DEFERRED]                                │
│ Originally: Escalate                      │
│ Tariff delta detected...                  │
│ ⌞ Dominated by reserve_protection         │
│   (protective > economic). Deferred.      │
└───────────────────────────────────────────┘
```
Primary badge says "Deferred" → matches lane. Original governance shown as muted secondary. Arbitration note explains why.

### Example 2: Page naming (D2)

**Before:**
- Sidebar nav: `VPP`
- Page title bar: `VPP & DR`

**After:**
- Sidebar nav: `Strategy` (EN) / `Estratégia` (PT-BR) / `策略` (ZH-CN)
- Page title bar: `Strategy Triggers` (EN) / `Gatilhos de Estratégia` (PT-BR) / `策略触发` (ZH-CN)

### Example 3: Deferred counter explanation (D3)

**Before:**
```
Pending Counts
Suppressed: 0    Deferred: 2
```
Operator wonders: "Where are the 2 deferred items? Is data missing?"

**After:**
```
Pending Counts
Suppressed: 0    Deferred: 2
Strategy intents deferred or suppressed by governance rules.
Not all may appear in triage lanes above.
```
Operator understands: these are governance outcomes, not missing data.
