# DESIGN-v6.5-P5-Action-Model-Reframe-0.1

## Status
Design 0.1b — amended to incorporate ongoing case model, defer-until state machine, review-later interaction contract, and escalation CTA correction as required by REQ v0.1b (2026-03-24). Supersedes 0.1a (backend prerequisites). Original design aligned against REQ-v6.5-P5-Action-Model-Reframe-0.1 and validated against R3 mock.

## Scope
This design covers the **homepage reframe** for P5 Strategy Triggers. It replaces the existing triage-lane homepage with a single-decision operator cockpit as defined in the REQ. The 0.1b amendment adds: (a) an ongoing case identity model for persistent unresolved conditions, (b) a defer-until state machine for the review-later operator decision, (c) homepage rendering per case state, and (d) corrected escalation CTAs replacing the previous acknowledge pattern. Backend changes are additive — see Section 9 for specifications.

---

## 1. Component Structure

### Component tree

```
StrategyPage (p5-strategy.js — rewrite)
├── PageHeader
│   └── timestamp badge
├── HeroBanner
│   ├── posture icon (per posture type)
│   ├── recommendation title
│   ├── narrative sentence (why + what is protected/suppressed)
│   └── metric chips (SoC, threshold, posture badge)
├── ImpactStrip
│   ├── impact icon
│   ├── affected strategy label + causal link
│   └── recovery condition
├── MainCtaPair
│   ├── PrimaryCta (act now / decision confirmation — posture-dependent)
│   ├── SecondaryCta (review later — escalation only; manual adjust — others)
│   └── TertiaryCta (manual adjustment navigation — escalation only, when SecondaryCta is review-later)
├── OverrideSection
│   ├── section header ("Override temporário")
│   └── OverrideCard
│       ├── collapsed: label + risk tag
│       └── expanded:
│           ├── DurationChips (30 min / 2h / Até pico)
│           ├── RiskWarning
│           └── ConfirmButton (staged — appears after duration selection)
├── AlertSection
│   ├── section header ("Controle de alertas")
│   └── AlertCard
│       ├── collapsed: label + description
│       └── expanded:
│           ├── DurationChips
│           └── severity escalation note
├── ResultPreview
│   ├── preview header ("O que acontece a seguir")
│   ├── default placeholder (when no action selected)
│   └── preview body (tag + consequence items, per action type)
└── Toast (fixed position, bottom center)
```

### Composition rules
- **HeroBanner** always renders. Its content is driven by platform posture and case state (see Section 11).
- **ImpactStrip** renders when at least one downstream strategy is affected by the current recommendation. Hidden during `calm` posture. During deferred case state, renders in muted style.
- **MainCtaPair** always renders. CTA labels change per posture type. For `escalation` posture, the pair becomes a triple: act-now + review-later + manual-adjust (see Section 4.3).
- **OverrideSection** renders when the current posture has an overridable protective constraint. Hidden during `calm` posture with no active protection.
- **AlertSection** always renders (alert silence is always available).
- **ResultPreview** always renders. Shows placeholder until an action is selected.
- **Toast** renders on action confirmation, then auto-dismisses after 3.5s.

### File mapping
All components live within the existing `p5-strategy.js` file. The reframe restructures the `render()` method's output, not the file structure. Helper render functions are defined as private methods on the `StrategyPage` object.

```
frontend-v2/js/p5-strategy.js
  StrategyPage.render()
    → _renderHero(data)
    → _renderImpactStrip(data)
    → _renderCtaPair(data)
    → _renderOverrideSection(data)
    → _renderAlertSection(data)
    → _renderResultPreview(selectedAction)
```

---

## 2. State Model

### 2.1 Platform recommendation state
Derived from `GET /api/p5/overview` response. Not stored locally — fetched on page load and refresh.

| Field | Source | Purpose |
|-------|--------|---------|
| `posture` | `hero.posture` | Drives hero rendering: `calm` / `approval_gated` / `protective` / `escalation` |
| `dominant_driver` | `hero.dominant_driver` | Hero narrative — what condition is dominant |
| `governance_mode` | `hero.governance_mode` | Badge display |
| `operator_action_needed` | `hero.operator_action_needed` | Whether CTAs should be visually emphasized |
| `override_active` | `hero.override_active` | Whether to show active override indicator |
| `need_decision_now` | `need_decision_now[]` | Approval-gated intents (used to derive recommendation CTA label) |
| `platform_acting` | `platform_acting[]` | Auto-governed intents (used for impact strip) |
| `watch_next` | `watch_next[]` | Observe-only intents (used for impact strip if relevant) |
| `context.dominant_protector` | `context.dominant_protector` | Override section context |

### 2.2 Override state (local + server)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `overrideExpanded` | `boolean` | `false` | Whether override card is expanded |
| `overrideDuration` | `string \| null` | `null` | Selected duration chip value |
| `overrideConfirmVisible` | `boolean` | `false` | Whether confirm button is showing |
| `overrideActivated` | `boolean` | `false` | Whether override was just confirmed (triggers toast) |
| `activeOverride` | `PostureOverride \| null` | from API | Server-side active override, if any |

**Override state machine:**
```
collapsed → [click card] → expanded (duration=null, confirm=hidden)
expanded  → [select duration] → expanded (duration=X, confirm=visible)
expanded  → [click confirm] → POST /api/p5/posture-override → activated → toast → refresh overview
expanded  → [click outside / click card again] → collapsed (duration reset, confirm hidden)
```

### 2.3 Alert silence state (local + server)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `alertExpanded` | `boolean` | `false` | Whether alert card is expanded |
| `alertDuration` | `string \| null` | `null` | Selected silence duration |
| `alertActivated` | `boolean` | `false` | Whether silence was just confirmed |

**Alert state machine:**
```
collapsed → [click card] → expanded (duration=null)
expanded  → [select duration] → POST alert silence → activated → toast
expanded  → [click outside] → collapsed
```

### 2.4 Selected action state (local only)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `selectedAction` | `'keep' \| 'adjust' \| 'defer' \| 'override' \| 'alert' \| null` | `null` | Currently selected/hovered action |

This drives the ResultPreview panel content. Updated on:
- Click primary CTA → `'keep'` (non-escalation) or `'adjust'` (escalation act-now)
- Click secondary CTA → `'adjust'` (non-escalation) or `'defer'` (escalation review-later)
- Click/expand override card → `'override'`
- Click/expand alert card → `'alert'`
- Expand override + select duration → `'override'` (with duration context)
- Select defer duration → `'defer'` (with duration context)

### 2.4b Defer state (local + server) *(0.1b addition)*

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `deferExpanded` | `boolean` | `false` | Whether defer duration picker is showing |
| `deferDuration` | `number \| null` | `null` | Selected defer duration in minutes |
| `deferActivated` | `boolean` | `false` | Whether defer was just confirmed (triggers toast) |

**Defer state machine (frontend):**
```
hidden       → [click "Pular por agora"] → expanded (duration=null)
expanded     → [select duration chip] → expanded (duration=X, confirm visible)
expanded     → [click confirm] → POST /api/p5/intents/:id/defer → activated → toast → refresh overview
expanded     → [click outside] → hidden (duration reset)
```

This state only exists when `posture === 'escalation'`. For other postures, defer is not available.

### 2.5 Duration selection state

Shared interface for override and alert duration chips:

```
DurationOption = { label: string, value_minutes: number | 'until_peak' }
```

Available options (hardcoded, matching mock R3):
- `{ label: '30 min', value_minutes: 30 }`
- `{ label: '2 h', value_minutes: 120 }`
- `{ label: 'Até pico', value_minutes: 'until_peak' }`

### 2.6 Override confirmation gate state

The override flow has a three-step gate to prevent accidental activation:

| Step | Trigger | UI Change |
|------|---------|-----------|
| 1 — Expand | Click override card | Card expands, shows duration chips + risk warning |
| 2 — Select duration | Click a duration chip | Confirm button appears with selected duration in label |
| 3 — Confirm | Click confirm button | POST to server, toast, refresh |

If the operator clicks away without completing step 3, the card collapses and all gate state resets.

---

## 3. Action Type Taxonomy

### Type 1 — Act Now / Decision Confirmation

> **0.1b correction:** For `escalation` posture, Type 1 is **not** "acknowledge" (the old `Reconhecer situação` binding). Escalation posture has no cosmetic acknowledge CTA. Instead, the primary CTA is "Act now" — navigate to manual adjustment. See Section 4.3 and Section 14 for the full correction.

| Aspect | Definition |
|--------|------------|
| **Semantic meaning** | **Non-escalation postures:** Operator accepts the platform's current recommendation. **Escalation posture:** Operator decides to act now — navigate to HEMS for manual adjustment. |
| **Visual weight** | Primary — largest, brightest CTA. Green border + gradient for non-escalation; red border + gradient for escalation. "Recomendado" badge (non-escalation) or "Ação necessária" badge (escalation). |
| **Interaction pattern** | Single click → immediate confirmation (non-escalation) or navigation (escalation) |
| **Outcome** | **Non-escalation:** If approval-gated intent exists: `POST /api/p5/intents/:id/approve`. If protective posture with no pending intent: no server call, display confirmation toast. **Escalation:** `window.location.hash = '#hems'` with context params in `DemoStore` (same as Type 2 navigation). |
| **Toast** | Non-escalation: `✓ Proteção de reserva mantida. Despachos suspensos até SoC > 30%.` (varies by posture). Escalation: `⚙ Abrindo painel HEMS com contexto carregado…` |
| **Preview tag** | Non-escalation: `Decisão confirmada` (green). Escalation: `Navegação` (red) |

### Type 1b — Review Later (escalation only) *(0.1b addition)*

| Aspect | Definition |
|--------|------------|
| **Semantic meaning** | Operator has assessed the escalation and decided: "not now — remind me later." This is a **formal, recorded decision**, not an absence of action. REQ 0.1b §Escalation Review-Later Requirement. |
| **Visual weight** | Secondary — slightly smaller than primary CTA. Amber border. "Pular" badge. Positioned alongside the primary act-now CTA. |
| **Interaction pattern** | Click → duration picker (30 min / 1h / 2h / 4h) → confirm. Two-step flow matching the existing duration-chip pattern. See Section 12 for full interaction contract. |
| **Outcome** | `POST /api/p5/intents/:id/defer` with `{ reason, defer_until }` body. Sets the dominant escalation intent to `deferred` status with a `defer_until` timestamp. |
| **Toast** | `⏸ Revisão adiada por {duration}. Retorna às {HH:MM} ou antes se condições piorarem.` |
| **Preview tag** | `Revisão adiada` (amber) |

### Type 2 — Manual Adjustment Navigation

| Aspect | Definition |
|--------|------------|
| **Semantic meaning** | Operator wants to adjust parameters in P4/HEMS rather than accept current recommendation |
| **Visual weight** | Secondary — smaller, blue-bordered. Arrow icon indicates navigation. |
| **Interaction pattern** | Single click → navigate to P4 HEMS page with context |
| **Outcome** | `window.location.hash = '#hems'` with context params in `DemoStore` |
| **Toast** | `⚙ Abrindo painel HEMS com contexto carregado…` |
| **Preview tag** | `Navegação` (blue) |

### Type 3 — Risk Override

| Aspect | Definition |
|--------|------------|
| **Semantic meaning** | Operator temporarily relaxes a protective constraint to allow economic operation |
| **Visual weight** | Separated section. Amber/red risk signaling. "Risco" badge on card. |
| **Interaction pattern** | Three-step staged: expand → select duration → confirm |
| **Outcome** | `POST /api/p5/posture-override` with `override_type: 'suppress_economic'`, `duration_minutes` |
| **Toast** | `⚠ Override ativo por {dur}. Arbitragem liberada temporariamente.` |
| **Preview tag** | `Override ativo` (amber) |

### Type 4 — Alert Management

| Aspect | Definition |
|--------|------------|
| **Semantic meaning** | Suppress repeated equivalent notifications without changing platform behavior |
| **Visual weight** | Lightest. Muted colors. Clearly reads as notification control, not strategy action. |
| **Interaction pattern** | Expand → select duration → auto-confirm on selection |
| **Outcome** | `POST /api/p5/posture-override` with `override_type: 'suppress_alerts'`, `duration_minutes`. Note: alert silence uses the same posture-override API with a different `override_type`. |
| **Toast** | `🔕 Alertas repetidos silenciados por {dur}.` |
| **Preview tag** | `Alertas` (gray) |

**Backend contract for alert silence:** The frontend calls `POST /api/p5/posture-override` with the following request body:
```json
{
  "override_type": "suppress_alerts",
  "reason": "Operador silenciou alertas repetidos via homepage",
  "duration_minutes": 30
}
```
This requires `suppress_alerts` to be a valid `OverrideType` in the backend. The `suppress_alerts` override does NOT change platform posture — it only marks that alerts are suppressed for the duration. The posture resolver must pass through intents unchanged when encountering this override type.

---

## 4. Homepage Decision Grammar

### 4.1 Hero rendering by posture

| Posture | Icon | Border color | Recommendation title | Narrative |
|---------|------|-------------|---------------------|-----------|
| `protective` | 🛡 | amber | `Recomendação: manter proteção de reserva ativa` | `Reserva em {soc}% SoC — abaixo do limite de {threshold}%. Despachos econômicos suspensos para proteger capacidade de backup.` |
| `approval_gated` | ⚡ | blue | `Recomendação: avaliar {family_label}` | `{intent_title}. {reason_summary}. Requer aprovação do operador.` |
| `calm` | ✓ | green | `Sistema operando normalmente` | `{calm_explanation.detail}` |
| `escalation` | ⚠ | red | `Recomendação: avaliar situação em HEMS` | `{reason_summary}. Resolução automática não é possível — ajuste manual recomendado.` |

### 4.2 Impact strip rendering

The impact strip renders when `platform_acting[]` or `watch_next[]` contains an intent whose `status` is `suppressed` or `deferred` due to the dominant condition.

| Element | Content |
|---------|---------|
| Icon | ⚠ (amber) |
| Label | `{affected_strategy}: suspensa` (e.g., `Arbitragem tarifária: suspensa`) |
| Causal link | `— proteção de reserva ativa impede despachos econômicos` |
| Recovery | `Retorna quando {recovery_condition}` (e.g., `SoC > 30%`) |

If no downstream strategies are affected, the impact strip is hidden.

### 4.3 Main CTAs rendering

> **0.1b correction:** Escalation posture now renders three CTAs, not two. The old `Reconhecer situação` primary CTA has been removed — see Section 14.

For non-escalation postures, the CTA pair renders with posture-specific labels:

| Posture | Primary CTA label | Secondary CTA label |
|---------|-------------------|---------------------|
| `protective` | `Manter proteção de reserva` | `Abrir painel HEMS para ajustar` |
| `approval_gated` | `Aprovar {intent_title_short}` | `Abrir painel HEMS para ajustar` |
| `calm` | `Confirmar: sistema operando normalmente` | `Abrir painel HEMS para ajustar` |

For `escalation` posture, three CTAs render:

| CTA | Label | Style | Behavior |
|-----|-------|-------|----------|
| Primary (act now) | `Ajustar manualmente →` | Red border + arrow icon. Largest CTA. | Navigate to P4/HEMS with context (Type 1 escalation behavior) |
| Secondary (review later) | `Pular por agora` | Amber border. Slightly smaller. | Opens defer duration picker (Type 1b behavior — see Section 12) |
| Tertiary (manual adjust) | `Abrir painel HEMS para ajustar` | Blue text link, not a button. Below the CTA pair. | Same navigation as non-escalation secondary CTA |

**Escalation deferred state:** When an ongoing case is in deferred state (within the defer window), the CTA section renders differently — see Section 13.

The secondary CTA label for non-escalation postures is always `Abrir painel HEMS para ajustar`. The secondary CTA description may vary to provide posture-specific context.

### 4.4 Override section rendering

| Posture | Override visible | Override label |
|---------|-----------------|----------------|
| `protective` | Yes | `Liberar arbitragem por tempo limitado` |
| `approval_gated` | No (no protective constraint to override) | — |
| `calm` | No | — |
| `escalation` | Conditional (only if a protective constraint is the escalation cause) | `Liberar {constraint} por tempo limitado` |

### 4.5 Alert section rendering

Always visible. Label is always `Silenciar alertas repetidos`. Description clarifies that platform behavior is unchanged.

### 4.6 Result preview rendering

Renders for the currently selected action. See Section 7 for full preview content specification.

---

## 5. Override Interaction Contract

### Step 1 — Expand
- **Trigger:** Operator clicks the override card.
- **UI change:** Card border changes to amber. Expand panel slides down revealing:
  - Duration label: `1. Escolha a duração:`
  - Duration chips: `30 min` / `2 h` / `Até pico`
  - Risk warning box with red border listing consequences
- **Preview update:** ResultPreview switches to override preview (without duration filled in).

### Step 2 — Select duration
- **Trigger:** Operator clicks a duration chip.
- **UI change:**
  - Selected chip gets amber highlight.
  - Confirm section appears below the warning: `2. Confirme a liberação:`
  - Confirm button shows with text: `Confirmar override por {duration}`
- **Preview update:** ResultPreview updates override preview with selected duration.

### Step 3 — Confirm
- **Trigger:** Operator clicks the confirm button.
- **API call:** `POST /api/p5/posture-override` with:
  ```json
  {
    "override_type": "suppress_economic",
    "reason": "Operador liberou arbitragem temporariamente via homepage",
    "duration_minutes": 30
  }
  ```
  For `Até pico`, `duration_minutes` is computed from current time to next peak window end (or falls back to 120 if no peak window is active).

> **Override type distinction:** The risk override (Type 3) uses `override_type: 'suppress_economic'` — this changes platform posture by suppressing protective constraints to allow economic dispatch. The alert silence (Type 4) uses `override_type: 'suppress_alerts'` — this does NOT change platform posture; it only suppresses repeated notifications. Both flows use the same `POST /api/p5/posture-override` endpoint but with different override types and different backend behavior in the posture resolver.
- **UI change:**
  - Override card gets confirmation checkmark.
  - Toast: `⚠ Override ativo por {duration}. Arbitragem liberada temporariamente.`
  - After toast, page refreshes overview data (hero will now reflect override-active state).

### Abandon without confirming
- **Trigger:** Operator clicks outside the override card, or clicks the card header again.
- **UI change:** Card collapses. Duration selection and confirm button are hidden. All override gate state resets to defaults.
- **No API call.**

### Auto-restoration after expiry
- Override has a server-side `expires_at`. When the override expires:
  - Next page load/refresh will show the hero without override-active indicator.
  - Protective posture returns to its pre-override state.
  - No client-side timer is needed; the server handles expiry.

---

## 6. P5 ↔ P4/HEMS Navigation Contract

### What happens when operator clicks "Abrir painel HEMS para ajustar"

1. **Context preparation:** Before navigating, P5 writes a context object to `window.DemoStore` (sessionStorage-backed):
   ```javascript
   DemoStore.set('p5_handoff', {
     source: 'p5_strategy',
     posture: data.hero.posture,
     dominant_driver: data.hero.dominant_driver,
     active_soc: evidenceSnapshot.battery_soc,
     reserve_threshold: evidenceSnapshot.reserve_threshold,
     active_intent_id: dominantIntent?.id || null,
     timestamp: Date.now()
   });
   ```

2. **Navigation:** `window.location.hash = '#hems'` — standard SPA hash navigation.

3. **P4/HEMS reads context:** On mount, P4 checks `DemoStore.get('p5_handoff')`. If present and fresh (< 5 min old):
   - P4 can highlight the relevant parameters (SoC threshold, dispatch limits).
   - P4 can show a subtle banner: `Contexto: vindo de Estratégia — proteção de reserva ativa`.

4. **Returning to P5:** Operator uses sidebar navigation to return to `#vpp` (Strategy Triggers). On remount, P5 calls `GET /api/p5/overview` fresh. No stale state from the previous view.

5. **"Adjustment in progress" indicator:** Not implemented in v0.1. The P5 page does not track whether the operator is currently in HEMS. If the operator navigates away and back, P5 simply shows the current platform state.

### Context staleness rule
The `p5_handoff` context is consumed once by P4. After P4 reads it, P4 clears the key. If the operator navigates directly to P4 without going through P5, no handoff context exists and P4 behaves normally.

---

## 7. Result Preview Contract

### Default state (no action selected)
```
Header: ▶ O que acontece a seguir
Body:   Selecione uma ação acima para ver o impacto na operação.
```
Preview area has default border color. No tag. Italic muted text.

### Preview content by action type

#### Type 1 — Decision Confirmation (`keep`)
- **Tag:** `✔ Decisão confirmada` (green tag)
- **Border accent:** green
- **Items:**
  - Proteção de reserva **mantida**
  - Despachos econômicos permanecem **suspensos**
  - Arbitragem tarifária continua bloqueada
  - Retomada automática quando SoC ultrapassar {threshold}%

#### Type 2 — Manual Adjustment Navigation (`adjust`)
- **Tag:** `→ Navegação` (blue tag)
- **Border accent:** blue
- **Items:**
  - Painel HEMS abre com **contexto carregado** (SoC atual, limites, gatilho ativo)
  - Ajuste parâmetros de despacho ou limites de reserva
  - Ao salvar, a estratégia será **reavaliada automaticamente**

#### Type 3 — Risk Override (`override`)
- **Tag:** `⚠ Override ativo` (amber tag)
- **Border accent:** amber
- **Items:**
  - Proteção de reserva **desativada por {duration}**
  - Despachos econômicos e arbitragem tarifária **liberados** durante a janela
  - Proteção retorna automaticamente ao expirar

#### Type 1b — Review Later (`defer`) *(0.1b addition)*
- **Tag:** `⏸ Revisão adiada` (amber tag)
- **Border accent:** amber
- **Items:**
  - Escalação **adiada por {duration}**
  - Condição subjacente permanece ativa — **não resolvida**
  - Homepage retorna ao estado de escalação às **{HH:MM}** ou antes se condições piorarem
  - Decisão registrada para auditoria

#### Type 4 — Alert Management (`alert`)
- **Tag:** `🔕 Alertas` (gray tag)
- **Border accent:** default (subtle)
- **Items:**
  - Alertas repetidos de mesmo nível silenciados por **{duration}**
  - Nenhuma mudança na operação da plataforma
  - Alertas de maior severidade continuam ativos

### Preview update trigger
Preview updates on **click**, not on hover. This prevents jittery preview updates during mouse movement. The selected action is set when:
- Operator clicks either main CTA
- Operator clicks/expands the override or alert card
- Operator selects a duration chip (updates preview with duration)
- Operator confirms an override (updates preview to reflect activation)

---

## 8. Downstream Impact Rendering

### Consequence rows
The impact strip renders affected strategies as a compact inline row, not as independent cards.

**Structure:**
```
[⚠ icon] [strategy: status] — [causal link to recommendation] [recovery condition]
```

**Example:**
```
⚠  Arbitragem tarifária: suspensa — proteção de reserva ativa impede despachos econômicos    Retorna quando SoC > 30%
```

### When to show multiple consequence rows
If multiple strategies are affected, render them as stacked impact strips:

```
⚠  Arbitragem tarifária: suspensa — proteção de reserva ativa       Retorna quando SoC > 30%
⚠  Peak shaving: em espera — reserva insuficiente para participar    Retorna quando SoC > 50%
```

Maximum 3 consequence rows. If more exist, show count: `+ 2 estratégias adicionais afetadas`.

### Dependency linkage
Each consequence row must be causally linked to the dominant recommendation. The causal link uses the format: `— {dominant_condition} {blocks/defers/suspends} {affected_strategy}`.

### Recovery condition display
Each row ends with a recovery condition in muted text: `Retorna quando {condition}`.

Recovery conditions come from the `recovery_condition` field on each `IntentCard` in the overview response. The frontend does NOT compute recovery conditions — they are computed server-side from the intent's `evidence_snapshot` and returned as a pre-formatted string. Expected patterns:
- SoC-based: `"SoC > {threshold}%"` (e.g., `"SoC > 30%"`)
- Time-based: `"Após {time}"` (e.g., `"Após fim do pico"`)
- Manual: `"Requer ajuste manual"`
- No recovery determinable: `null` (frontend hides the recovery condition text)

### When impact strip hides
- `calm` posture with no suppressed/deferred intents
- No downstream strategies are affected by the current recommendation

---

## 9. Data Requirements

### Data consumed from `GET /api/p5/overview`

| Data needed | API field | Usage |
|-------------|-----------|-------|
| Platform posture | `hero.posture` | Hero rendering, CTA labels |
| Dominant driver | `hero.dominant_driver` | Hero narrative |
| Governance mode | `hero.governance_mode` | Badge display |
| Override active | `hero.override_active` | Override section state |
| Action needed | `hero.operator_action_needed` | CTA emphasis |
| Calm explanation | `calm_explanation` | Hero narrative in calm posture |
| Approval-gated intents | `need_decision_now[]` | Primary CTA label, decision target |
| Auto-governed intents | `platform_acting[]` | Impact strip content |
| Observe intents | `watch_next[]` | Impact strip (if suppressed/deferred) |
| Dominant protector | `context.dominant_protector` | Override card label, hero narrative |
| Suppressed count | `context.suppressed_count` | Impact strip visibility |
| Defer context | `defer_context` | Deferred hero rendering, countdown, resume CTA target *(0.1b)* |

### Data consumed from dominant intent (inline, not separate API call)

| Data needed | Source | Usage |
|-------------|--------|-------|
| Intent ID | `need_decision_now[0].id` | Approve action target |
| Intent family | `need_decision_now[0].family` | CTA label variation |
| Evidence snapshot | embedded in overview or via `GET /api/p5/intents/:id` | Hero metrics, recovery conditions |

### Data for override/alert actions

| Action | API endpoint | Body |
|--------|-------------|------|
| Confirm recommendation | `POST /api/p5/intents/:id/approve` | `{ reason: "Operador confirmou recomendação via homepage" }` |
| Review later (defer) | `POST /api/p5/intents/:id/defer` | `{ reason: "Operador adiou revisão via homepage", defer_until: "ISO8601" }` *(0.1b)* |
| Resume (cancel defer) | `POST /api/p5/intents/:id/escalate` | `{ reason: "Operador retomou revisão via homepage" }` *(0.1b)* |
| Create override | `POST /api/p5/posture-override` | `{ override_type, reason, duration_minutes }` |
| Alert silence | `POST /api/p5/posture-override` | `{ override_type: "suppress_alerts", reason, duration_minutes }` |

### Backend Change Specification

> **0.1b update:** Three original backend changes from 0.1a are preserved (Changes 1–3). Three additional changes are added for the ongoing case model, defer-until persistence, and review-later interaction (Changes 4–6). One minor schema migration is required (Change 5).

Six additive backend changes are required. One minor schema migration (single column addition). No new API routes.

#### Change 1: New OverrideType `suppress_alerts`

**Problem:** The "Silenciar alertas repetidos" action calls `POST /api/p5/posture-override` with `override_type: 'suppress_alerts'`, but this type does not currently exist in the backend validation.

**Current state:**
- `backend/src/shared/types/p5.ts` — `OverrideType` union: `'force_protective' | 'suppress_economic' | 'force_approval_gate' | 'manual_escalation_note'`
- `backend/src/bff/handlers/post-p5-posture-override.ts` — `VALID_OVERRIDE_TYPES` array mirrors the same 4 values
- `backend/src/optimization-engine/services/posture-resolver.ts` — `applyOverride()` switch has cases for the same 4 types

**Required changes:**
1. **`backend/src/shared/types/p5.ts`** — Add `| 'suppress_alerts'` to the `OverrideType` union type (~1 line).
2. **`backend/src/bff/handlers/post-p5-posture-override.ts`** — Add `"suppress_alerts"` to the `VALID_OVERRIDE_TYPES` array (~1 line).
3. **`backend/src/optimization-engine/services/posture-resolver.ts`** — Add a `case 'suppress_alerts'` to the `applyOverride()` switch. This case returns the intent unchanged — `suppress_alerts` does NOT modify platform posture or intent state. It only exists as a tracked, bounded, auditable record that alert suppression is active. (~3 lines).

**Complexity:** ~5 lines total across 3 files.

#### Change 2: Add `recovery_condition` to IntentCard

**Problem:** The impact strip needs to display when a blocked strategy will resume (e.g., "Retorna quando SoC > 30%"). This data must come from the server, not be hardcoded in the frontend.

**Current state:**
- `backend/src/shared/types/p5.ts` — `IntentCard` interface has 10 fields, no `recovery_condition`
- `backend/src/bff/handlers/get-p5-overview.ts` — `intentToCard()` function maps `StrategyIntent` → `IntentCard` without recovery logic
- `backend/src/optimization-engine/services/strategy-evaluator.ts` — `evidence_snapshot` contains the raw data needed (e.g., `avg_soc`, threshold constants like `RESERVE_WARNING_SOC = 30`)

**Required changes:**
1. **`backend/src/shared/types/p5.ts`** — Add `readonly recovery_condition: string | null` to `IntentCard` interface (~1 line).
2. **`backend/src/bff/handlers/get-p5-overview.ts`** — Update `intentToCard()` to compute `recovery_condition` from the intent's `evidence_snapshot`. Logic:
   - If intent family is `reserve_protection`: read `evidence_snapshot.avg_soc`; if below threshold (30), set `recovery_condition = "SoC > 30%"`.
   - If intent family is `tariff_arbitrage` and status is `deferred`/`suppressed`: `recovery_condition = "SoC > 30%"` (recovery depends on the dominant protector's threshold).
   - If intent family is `peak_shaving`: `recovery_condition = "Demanda < contratada"`.
   - Otherwise: `recovery_condition = null`.

   Note: `intentToCard()` currently receives only a `StrategyIntent`. The `evidence_snapshot` is already available on `StrategyIntent` but is not currently used in the card projection. The function should read it to compute the recovery condition.

**Complexity:** ~8 lines total across 2 files.

#### Change 3: Add `current_soc` and `threshold` to ProtectorSummary

**Problem:** The hero banner renders metric chips showing current SoC and the reserve threshold. The current `ProtectorSummary` interface returns only `family`, `title`, `scope_summary`, and `governance_mode` — it does not include SoC or threshold values.

**Current state:**
- `backend/src/shared/types/p5.ts` — `ProtectorSummary` has 4 fields, no SoC/threshold
- `backend/src/bff/handlers/get-p5-overview.ts` — `dominantProtectorSummary` is built from the `dominantProtector` intent (line ~269-276) but only extracts 4 fields. The intent's `evidence_snapshot` contains `avg_soc` and the evaluator uses `RESERVE_WARNING_SOC = 30` as the threshold.

**Required changes:**
1. **`backend/src/shared/types/p5.ts`** — Add two fields to `ProtectorSummary`:
   ```typescript
   readonly current_soc: number | null;
   readonly threshold: number | null;
   ```
   (~2 lines)
2. **`backend/src/bff/handlers/get-p5-overview.ts`** — When building `dominantProtectorSummary`, extract `current_soc` from `dominantProtector.evidence_snapshot.avg_soc` and `threshold` from `dominantProtector.evidence_snapshot.reserve_threshold` or fall back to `30` (the `RESERVE_WARNING_SOC` constant). (~3 lines)

**Complexity:** ~5 lines total across 2 files.

#### Change 4: Allow `defer` action for escalation intents *(0.1b addition)*

**Problem:** The review-later CTA calls `POST /api/p5/intents/:id/defer` on escalation-class intents, but `getAllowedActions()` currently returns only `["escalate"]` for `governance_mode: 'escalate'`.

**Current state:**
- `backend/src/bff/handlers/post-p5-intent-action.ts` — `getAllowedActions()` switch: `case "escalate": return ["escalate"];`

**Required changes:**
1. **`backend/src/bff/handlers/post-p5-intent-action.ts`** — Change the `"escalate"` case in `getAllowedActions()` to return `["defer", "escalate"]` (~1 line).

**Complexity:** ~1 line in 1 file.

#### Change 5: Add `defer_until` column to `strategy_intents` *(0.1b addition)*

**Problem:** The review-later decision needs to persist a `defer_until` timestamp on the intent record. This timestamp drives the overview handler's deferred-case logic and the frontend's countdown display.

**Current state:**
- `strategy_intents` table has `expires_at` (intent TTL) but no `defer_until` (operator-chosen review-later boundary).
- `StrategyIntent` TypeScript interface has no `defer_until` field.
- `updateIntentStatus()` in `p5-db.ts` does not write `defer_until`.

**Required changes:**
1. **DB migration:** `ALTER TABLE strategy_intents ADD COLUMN defer_until TIMESTAMPTZ DEFAULT NULL;` — single column addition, no data migration, nullable, no index needed (queried only through the overview handler which already loads all non-terminal intents).
2. **`backend/src/shared/types/p5.ts`** — Add `readonly defer_until: string | null;` to `StrategyIntent` interface (~1 line).
3. **`backend/src/shared/p5-db.ts`** — Update `updateIntentStatus()` to accept an optional `defer_until` parameter and write it to the DB alongside the status change. When action is `defer` and `defer_until` is provided, set the column. (~4 lines).
4. **`backend/src/bff/handlers/post-p5-intent-action.ts`** — When action is `defer`, read `body.defer_until`, validate it is a future ISO 8601 timestamp, and pass it to `updateIntentStatus()`. (~5 lines).

**Complexity:** ~11 lines across 3 files + 1 migration statement.

#### Change 6: Overview handler — case fingerprint grouping and defer awareness *(0.1b addition)*

**Problem:** The overview handler must (a) group intents by case fingerprint to support ongoing case identity, (b) suppress deferred cases from `need_decision_now[]`, (c) detect material worsening to break deferrals, and (d) return defer context to the frontend.

**Current state:**
- `backend/src/bff/handlers/get-p5-overview.ts` — partitions intents into lanes without fingerprint awareness. Does not check `defer_until`.

**Required changes:**
1. **Case fingerprint function:** Add `computeCaseFingerprint(intent: StrategyIntent): string` — returns `${family}:${sorted_scope_ids}:${driver_type}`. Driver type derived from evidence snapshot (see Section 10.3). (~10 lines).
2. **Defer-aware lane partitioning:** After computing fingerprints, before building lanes, check each fingerprint group for an active deferral (`status === 'deferred' && defer_until > NOW()`). If found:
   - Move all intents in that fingerprint group out of `needDecisionNow` and into `watchNext` with a `deferred` status annotation.
   - Compute `defer_context` for the overview response.
   (~15 lines).
3. **Worsening-condition detection:** For each deferred fingerprint group, compare the newest intent's `evidence_snapshot` against the deferred intent's snapshot. If worsening thresholds are crossed (Section 11.4), ignore the deferral and let the intent flow into `needDecisionNow` normally. (~12 lines).
4. **New response field:** Add `defer_context` to the `P5Overview` response:
   ```typescript
   readonly defer_context: {
     readonly case_fingerprint: string;
     readonly deferred_intent_id: number;
     readonly defer_until: string;
     readonly original_reason: string;
     readonly deferred_at: string;
   } | null;
   ```
   (~6 lines in types, ~4 lines in handler to populate).
5. **Hero posture adjustment:** If all escalation-class intents are deferred (no undeferred escalation intents remain), derive hero posture from the next applicable tier (protective → approval_gated → calm). (~5 lines).

**Complexity:** ~52 lines across 2 files (handler + types). This is the largest single change in 0.1b.

---

## 10. Ongoing Case Data Model *(0.1b addition)*

> Cross-reference: REQ 0.1b §Persistent Issue Identity Requirement

### 10.1 What is an ongoing case

An **ongoing case** is a logical grouping that represents a persistent unresolved condition across multiple evaluation cycles. The current backend generates a new `StrategyIntent` each evaluation cycle (via `upsertIntent` in `strategy-evaluator.ts`). When an underlying condition persists (e.g., low SoC remains below threshold), the system creates intents that are semantically identical from the operator's perspective. An ongoing case groups these into a single continuous situation.

### 10.2 Design decision: logical grouping, not a new table

The ongoing case is implemented as a **logical grouping in the overview handler**, not as a new database table. This is the simplest model that satisfies the REQ.

**Rationale:**
- The `strategy_intents` table already has `family`, `scope_gateway_ids`, and `evidence_snapshot` — all the data needed to compute case identity.
- A new table would add schema migration complexity with no functional benefit at this stage.
- The overview handler already partitions intents into lanes — adding fingerprint-based grouping is a natural extension.

### 10.3 Case fingerprint

A case fingerprint is computed from three dimensions:

```
case_fingerprint = hash(family + sorted(scope_gateway_ids) + dominant_driver_type)
```

| Component | Source | Example |
|-----------|--------|---------|
| `family` | `StrategyIntent.family` | `"reserve_protection"` |
| `scope_gateway_ids` | `StrategyIntent.scope_gateway_ids`, sorted | `["gw-001"]` |
| `dominant_driver_type` | Derived from `evidence_snapshot` — the category of condition, not the exact metric value | `"low_soc"` (not `"soc=20%"`) |

**Dominant driver type derivation rules:**
- `reserve_protection` + `avg_soc < threshold` → `"low_soc"`
- `peak_shaving` + `ratio > threshold` → `"peak_demand"`
- `tariff_arbitrage` + period-based → `"tariff_window"`
- Scope collision → `"scope_conflict"`

The fingerprint is **not** stored in the database. It is computed at read time in the overview handler. Two intents with the same fingerprint belong to the same ongoing case.

### 10.4 Case lifecycle

An ongoing case has four logical states:

```
open → deferred → re-escalated → resolved
       ↑                    |
       └────────────────────┘  (re-defer possible)
```

| State | Meaning | Trigger |
|-------|---------|---------|
| `open` | Condition is active, presented as active escalation on homepage | Evaluator detects condition, no active deferral for this fingerprint |
| `deferred` | Operator chose "review later" with a time boundary | Operator clicks "Pular por agora" + selects duration |
| `re-escalated` | Defer window expired OR conditions materially worsened | Timer expiry + re-evaluation, or worsening-condition breakout |
| `resolved` | Underlying condition no longer present | Evaluator no longer generates intents with this fingerprint |

**State is derived, not stored.** The overview handler determines case state by examining:
1. Whether any active intent exists with this fingerprint → `open`
2. Whether the most recent intent with this fingerprint has `status: 'deferred'` and `defer_until > NOW()` → `deferred`
3. Whether a previously deferred intent's `defer_until` has passed and the condition still exists → `re-escalated` (presents as `open`)
4. Whether no intents with this fingerprint exist or all are terminal → `resolved`

### 10.5 Relationship between intents and cases

Many intents may belong to one case across evaluation cycles. The overview handler must:
1. Compute fingerprints for all non-terminal intents.
2. Group intents by fingerprint.
3. For each fingerprint group, check if any intent is in `deferred` status with a valid `defer_until`.
4. If yes and `defer_until > NOW()`: treat the entire case as deferred — do not present as active escalation.
5. If a new intent is generated for the same fingerprint during a defer window: the evaluator creates it, but the overview handler suppresses it from the `need_decision_now` lane.

---

## 11. Defer-Until State Machine *(0.1b addition)*

> Cross-reference: REQ 0.1b §Escalation Review-Later Requirement

### 11.1 How defer works as an intent action

`defer` already exists as a valid action in `post-p5-intent-action.ts` (`VALID_ACTIONS = ["approve", "defer", "suppress", "escalate"]`). It transitions an intent from `active` → `deferred` status. Currently available for `approval_required` and `auto_governed` governance modes.

**Required change for 0.1b:** The `getAllowedActions()` function must also return `"defer"` for `governance_mode: 'escalate'` intents, since the review-later CTA on the homepage targets escalation-class intents. See Section 9 Change 4.

### 11.2 The `defer_until` field

`defer_until` is a **timestamp** stored on the `StrategyIntent` record. It represents the moment after which the system should re-evaluate and potentially re-escalate the issue.

**Storage:** New nullable column `defer_until TIMESTAMPTZ` on the `strategy_intents` table. This is the one schema addition required by 0.1b — a single column, not a new table.

**Computation:** `defer_until = NOW() + selected_duration_minutes`.

**Who writes it:** The `POST /api/p5/intents/:id/defer` handler writes `defer_until` alongside the `status: 'deferred'` transition. The `defer_until` value comes from the request body.

### 11.3 Overview handler behavior during defer window

When building the overview response, the handler must check for active deferrals:

1. **Compute case fingerprints** for all non-terminal intents.
2. **For each fingerprint group**, find the most recent deferred intent with `defer_until > NOW()`.
3. **If an active deferral exists for a fingerprint:**
   - Do NOT place new intents of the same fingerprint in `need_decision_now[]`.
   - Instead, place them in `watch_next[]` with a synthetic `status: 'deferred'`.
   - Add a `defer_context` object to the overview response (see Section 9 Change 5).
4. **Hero posture derivation:** If all escalation-class intents are covered by active deferrals, the hero posture should drop from `escalation` to the next applicable posture (e.g., `protective` if auto-governed intents remain, or `calm` if nothing else is active). If some escalation intents are deferred but others are not, the non-deferred ones still drive `escalation` posture.

### 11.4 Worsening-condition breakout

The defer window is not unconditional. If conditions **materially worsen**, the system breaks the defer and re-escalates.

**What constitutes material worsening:**
| Condition family | Worsening trigger |
|-----------------|-------------------|
| `reserve_protection` | SoC drops by ≥ 10 percentage points from the snapshot at defer time, OR SoC falls below `RESERVE_EMERGENCY_SOC` (15%) |
| `peak_shaving` | Grid demand ratio crosses from `soon` (80%) to `immediate` (90%) threshold |
| `tariff_arbitrage` | Not applicable — tariff arbitrage is not escalation-class |
| Scope collision | A new family enters collision on the same scope |

**Who decides:** The **overview handler** (not the evaluator). The evaluator creates intents without knowledge of deferrals. The overview handler compares the new intent's `evidence_snapshot` against the deferred intent's `evidence_snapshot` to detect material worsening.

**How a broken defer presents:** The deferred intent's `defer_until` is logically voided. The overview handler places the new (worse) intent in `need_decision_now[]` at full escalation intensity. The hero returns to `escalation` posture. The frontend renders the active escalation state (Section 13.1), not the deferred state.

**Implementation note:** The overview handler does NOT modify the DB to void the deferral. It simply ignores the deferral when building the response if worsening is detected. The deferred intent record remains in the DB for audit purposes.

### 11.5 Defer expiry

When `defer_until` passes and the underlying condition still exists:
1. The evaluator generates a new intent for the same condition (normal behavior — it does this every cycle).
2. The overview handler finds no valid deferral (`defer_until < NOW()`).
3. The new intent is placed in `need_decision_now[]` as a normal escalation.
4. Hero returns to `escalation` posture.
5. The operator sees the issue return as an active escalation — same ongoing case, re-escalated.

---

## 12. Review-Later Interaction Contract *(0.1b addition)*

> Cross-reference: REQ 0.1b §Escalation Review-Later Requirement

### 12.1 Frontend flow

1. **Trigger:** Operator clicks `Pular por agora` (review-later CTA, visible only in `escalation` posture).
2. **UI change:** A duration picker slides open below the CTA (inline, not a modal). Layout matches the existing duration-chip pattern used for overrides and alert silence.
   - Duration label: `Adiar revisão por:`
   - Duration chips: `30 min` / `1 h` / `2 h` / `4 h`
   - No confirm button — selection auto-confirms (matches the alert silence pattern, since review-later is lower-risk than override).
3. **Operator selects duration chip.**
4. **API call fires immediately on chip selection.**
5. **Toast:** `⏸ Revisão adiada por {duration}. Retorna às {HH:MM} ou antes se condições piorarem.`
6. **Page refreshes overview data.** Hero transitions from escalation to deferred visual state (Section 13.2).

### 12.2 Duration options

| Label | Value (minutes) |
|-------|-----------------|
| `30 min` | 30 |
| `1 h` | 60 |
| `2 h` | 120 |
| `4 h` | 240 |

These differ from the override/alert durations (30 min / 2h / Até pico) because defer is time-bounded by operator decision, not by system events.

### 12.3 API call

**Endpoint:** `POST /api/p5/intents/:id/defer` (reuses the existing defer action on the existing intent action endpoint).

**Request body:**
```json
{
  "reason": "Operador adiou revisão via homepage",
  "defer_until": "2026-03-24T15:30:00Z"
}
```

The `defer_until` field is an ISO 8601 timestamp computed by the frontend: `new Date(Date.now() + duration_minutes * 60000).toISOString()`.

**`:id` parameter:** The ID of the dominant escalation intent — `need_decision_now[0].id` (same intent that would be the target for other actions).

**Response:** Standard intent action response (updated intent with `status: 'deferred'`).

### 12.4 Error handling

| Condition | Behavior |
|-----------|----------|
| Intent no longer active (race condition) | Toast: `Situação já foi atualizada. Recarregando…` → refresh overview |
| Network error | Toast: `Erro ao adiar revisão. Tente novamente.` → CTA remains clickable |
| `defer` action not allowed for intent | Should not happen (frontend only shows CTA for escalation intents), but if it does: Toast with error, refresh overview |

### 12.5 "Retomar agora" (cancel defer)

While a case is in deferred state, the homepage shows a `Retomar agora` CTA (see Section 13.2). Clicking this:
1. Calls `POST /api/p5/intents/:id/defer` is NOT used — instead, the frontend simply refreshes the overview. The overview handler will see `defer_until` in the future but the operator wants to cancel.
2. **Better approach:** A dedicated cancel-defer endpoint or reusing the existing intent action flow. For 0.1b, the simplest approach: mark the deferred intent as `active` again via `POST /api/p5/intents/:id/escalate` (re-escalate). This transitions `deferred → escalated`, and the overview handler treats it as active escalation again.
3. Toast: `Revisão retomada. Escalação ativa novamente.`
4. Hero returns to active escalation state.

---

## 13. Homepage State Rendering by Case State *(0.1b addition)*

> Cross-reference: REQ 0.1b §System behavior during the defer window, §Persistent Issue Identity Requirement

### 13.1 Active escalation (no defer)

This is the existing escalation rendering, with the corrected CTAs.

| Element | Rendering |
|---------|-----------|
| **Hero border** | Red |
| **Hero icon** | ⚠ |
| **Hero title** | `Recomendação: avaliar situação em HEMS` |
| **Hero narrative** | `{reason_summary}. Resolução automática não é possível — ajuste manual recomendado.` |
| **Visual intensity** | Full — red accents, bold metrics |
| **Primary CTA** | `Ajustar manualmente →` (red, act now) |
| **Secondary CTA** | `Pular por agora` (amber, review later) |
| **Tertiary link** | `Abrir painel HEMS para ajustar` (blue text link) |
| **Impact strip** | Active, full intensity |
| **Override section** | Conditional (only if protective constraint is the cause) |

### 13.2 Deferred (within defer window)

| Element | Rendering |
|---------|-----------|
| **Hero border** | Amber (muted, not red) |
| **Hero icon** | ⏸ |
| **Hero title** | `Revisão adiada até {HH:MM}` |
| **Hero narrative** | `{original_reason_summary}. Condição ainda ativa — revisão agendada.` |
| **Visual intensity** | Muted — amber accents, normal weight text, no bold urgency |
| **Status badge** | `Adiado` (amber badge replacing "Ação necessária") |
| **Defer countdown** | `Retorna em {remaining_time}` (e.g., `Retorna em 1h 23min`) — computed client-side from `defer_until` |
| **Primary CTA** | `Retomar agora` (blue, outlined — cancels defer, returns to active escalation) |
| **Secondary CTA** | `Ajustar manualmente →` (blue text link — navigate to HEMS) |
| **Impact strip** | Present but muted — same content, reduced visual weight (lighter border, muted text color) |
| **Override section** | Hidden during defer (operator has already decided to wait) |
| **Alert section** | Still visible (alert management is independent of defer state) |

**Key design principle (REQ 0.1b §Simplicity As Design Guardrail):** The deferred state must feel **calmer** than active escalation. It replaces the red urgency treatment with a quiet amber acknowledgment. The operator should be able to glance at the homepage and see "I have a deferred item, it comes back at HH:MM" without feeling pressured.

### 13.3 Defer expired, condition still present

Returns to **active escalation state** (Section 13.1). The hero renders identically to a fresh escalation. From the operator's perspective, the issue has returned because the defer window elapsed.

No special "re-escalated" visual treatment is applied. The ongoing case identity ensures the operator recognizes this as the same issue, not a new one. The hero narrative may include a subtle indicator: `Revisão expirou — condição ainda ativa.`

### 13.4 Condition resolved

| Element | Rendering |
|---------|-----------|
| **Hero** | Returns to `calm` posture (green border, ✓ icon) |
| **Calm explanation** | `reason: "no_conditions_detected"` or appropriate calm reason |
| **Case** | Implicitly closed — no intents with this fingerprint are active or deferred |
| **No special "resolved" banner** | The homepage simply returns to calm. The operator does not need to be told that a previously escalated issue resolved — the absence of escalation is sufficient. |

### 13.5 Posture ↔ case state interaction

Case state only applies to `escalation` posture. Other postures (`calm`, `protective`, `approval_gated`) do not have the review-later path and are not affected by case state logic.

If the homepage is in `protective` posture and an escalation case is deferred, the hero shows `protective` (the dominant non-deferred posture), not `escalation`. The deferred case is tracked in `watch_next[]` but does not dominate the hero.

---

## 14. Escalation CTA Correction *(0.1b addition)*

> Cross-reference: REQ 0.1b §Correction E — Replace `Reconhecer / Acknowledge` with a real operator decision

### 14.1 What is removed

The following escalation CTA binding from Design 0.1a is **removed**:

| Removed | Reason |
|---------|--------|
| Primary CTA: `Reconhecer situação` → `approve` action | Acknowledge produces no meaningful system-state change. If the condition persists, the system regenerates an equivalent escalation immediately, creating a frustrating loop. REQ 0.1b §Why Pure Acknowledgement Is Insufficient. |

### 14.2 What replaces it

| New CTA | Action | Semantic |
|---------|--------|----------|
| `Ajustar manualmente →` (primary) | Navigate to P4/HEMS | Act now — the operator is going to resolve the issue |
| `Pular por agora` (secondary) | `POST /api/p5/intents/:id/defer` with `defer_until` | Review later — formal, time-bounded deferral |

### 14.3 No `approve` action for escalation intents

Escalation intents (`governance_mode: 'escalate'`) do NOT support the `approve` action. This is already the case in the current `getAllowedActions()` logic — escalation mode only returns `["escalate"]`. The 0.1b change adds `"defer"` to that list (see Section 9 Change 4) but does NOT add `"approve"`.

---

## 15. Responsive Behavior

### Desktop (primary — 960px+)
- Full sidebar visible.
- Main content column: `max-width: 960px`, `padding: 24px 32px`.
- CTA pair renders side-by-side with asymmetric sizing (primary: `flex: 1.3`, secondary: `flex: 1`).
- Override and alert cards render full-width within the main column.
- Result preview renders full-width below alert section.

### Tablet (600–900px)
- Sidebar hidden (CSS `display: none` below 900px, already implemented).
- Main content padding reduced to 16px.
- CTA pair stacks vertically (`flex-direction: column`).
- All other components render full-width, no layout change needed.

### Mobile (< 600px)
- Same as tablet.
- Hero metrics wrap (already handled by `flex-wrap: wrap`).
- Duration chips may need smaller padding. No other changes for v0.1.
- P5 is primarily a desktop operator surface. Mobile is functional but not optimized.

---

## Appendix A: Posture ↔ Component Visibility Matrix

> **0.1b update:** Escalation column updated to reflect act-now/review-later CTAs and deferred sub-state.

| Component | calm | approval_gated | protective | escalation (active) | escalation (deferred) |
|-----------|------|----------------|------------|--------------------|-----------------------|
| HeroBanner | ✓ | ✓ | ✓ | ✓ (red) | ✓ (amber, muted) |
| ImpactStrip | hidden | conditional | ✓ | conditional | conditional (muted) |
| PrimaryCta | ✓ (confirm calm) | ✓ (approve) | ✓ (keep protection) | ✓ (act now → HEMS) | ✓ (retomar agora) |
| SecondaryCta | ✓ (adjust) | ✓ (adjust) | ✓ (adjust) | ✓ (review later) | ✓ (adjust → HEMS) |
| DeferDurationPicker | hidden | hidden | hidden | conditional (on review-later click) | hidden |
| OverrideSection | hidden | hidden | ✓ | conditional | hidden |
| AlertSection | ✓ | ✓ | ✓ | ✓ | ✓ |
| ResultPreview | ✓ | ✓ | ✓ | ✓ | ✓ |

## Appendix B: i18n Key Mapping

New i18n keys needed (added to existing `p5.strategy.*` namespace):

```
p5.strategy.hero.rec.protective    = "Recomendação: manter proteção de reserva ativa"
p5.strategy.hero.rec.approval      = "Recomendação: avaliar {family}"
p5.strategy.hero.rec.calm          = "Sistema operando normalmente"
p5.strategy.hero.rec.escalation    = "Recomendação: avaliar situação em HEMS"

p5.strategy.cta.keep.protective    = "Manter proteção de reserva"
p5.strategy.cta.keep.approval      = "Aprovar {title}"
p5.strategy.cta.keep.calm          = "Confirmar: sistema operando normalmente"
p5.strategy.cta.actnow.escalation  = "Ajustar manualmente"
p5.strategy.cta.defer.escalation   = "Pular por agora"
p5.strategy.cta.resume.escalation  = "Retomar agora"
p5.strategy.cta.adjust             = "Abrir painel HEMS para ajustar"

p5.strategy.defer.label            = "Adiar revisão por:"
p5.strategy.defer.toast            = "Revisão adiada por {duration}. Retorna às {time} ou antes se condições piorarem."
p5.strategy.defer.resume.toast     = "Revisão retomada. Escalação ativa novamente."
p5.strategy.defer.badge            = "Adiado"

p5.strategy.hero.deferred.title    = "Revisão adiada até {time}"
p5.strategy.hero.deferred.narrative= "{reason}. Condição ainda ativa — revisão agendada."
p5.strategy.hero.reescalated       = "Revisão expirou — condição ainda ativa."

p5.strategy.impact.suspended       = "{strategy}: suspensa"
p5.strategy.impact.recovery        = "Retorna quando {condition}"

p5.strategy.override.label         = "Liberar arbitragem por tempo limitado"
p5.strategy.override.dur.label     = "1. Escolha a duração:"
p5.strategy.override.confirm.label = "2. Confirme a liberação:"
p5.strategy.override.confirm.btn   = "Confirmar override por {duration}"

p5.strategy.alert.silence          = "Silenciar alertas repetidos"
p5.strategy.alert.dur.label        = "Silenciar por:"

p5.strategy.preview.title          = "O que acontece a seguir"
p5.strategy.preview.default        = "Selecione uma ação acima para ver o impacto na operação."
p5.strategy.preview.tag.decision   = "Decisão confirmada"
p5.strategy.preview.tag.navigate   = "Navegação"
p5.strategy.preview.tag.defer      = "Revisão adiada"
p5.strategy.preview.tag.override   = "Override ativo"
p5.strategy.preview.tag.alert      = "Alertas"
```
