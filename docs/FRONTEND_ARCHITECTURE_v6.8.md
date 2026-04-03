# Frontend Architecture — SOLFACIL VPP Admin Portal

**Version:** v6.8
**Git HEAD:** `b94adf3`
**Date:** 2026-04-02

---

## 1. Technology Stack (技术栈)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Vanilla JavaScript (ES2017+) | No framework, no build step, no bundler |
| Charts | ECharts 5.x (CDN) | `echarts.min.js` via jsdelivr |
| Fonts | Inter (UI) + JetBrains Mono (data) | Google Fonts, preconnected |
| Icons | Unicode emoji glyphs | Inline in HTML (no icon library) |
| CSS | Custom Properties (CSS Variables) | 5-file modular architecture |
| Auth | JWT (localStorage) + HttpOnly cookie | Bearer token via `Authorization` header for fetch/XHR; HttpOnly `solfacil_jwt` cookie for browser-native SSE |
| State | sessionStorage (`DemoStore`) | Cross-page ephemeral state |
| Real-time | Server-Sent Events (SSE) | `EventSource` on `/api/events`, authenticated via same-origin auth cookie |
| i18n | Custom I18n module | 3 languages: pt-BR, en, zh-CN |

**Key design choice (关键设计决策):** Zero build tooling. All JS files are loaded via `<script>` tags in dependency order. Cache-busting via `?v=` query parameter on every asset.

---

## 2. File Structure (文件结构)

```
frontend-v2/
├── index.html              # Main SPA shell (app-shell layout)
├── login.html              # Standalone login page
├── css/
│   ├── variables.css       # Design tokens (colors, spacing, radii, surfaces)
│   ├── base.css            # CSS reset, typography, skeleton animations
│   ├── layout.css          # App shell: sidebar (240px fixed) + main content
│   ├── components.css      # Reusable: KPI cards, tables, badges, section cards
│   └── pages.css           # Page-specific styles (P1-P6, VU classes)
├── js/
│   ├── config.js           # BFF_API_URL + USE_MOCK toggle
│   ├── mock-data.js        # Hardcoded demo data (loaded first)
│   ├── data-source.js      # Dual-mode data adapter (mock ↔ live API)
│   ├── i18n.js             # Translation dictionaries + t() + langchange event
│   ├── components.js       # Shared UI component factory (Components object)
│   ├── charts.js           # ECharts singleton factory (Charts object)
│   ├── p1-fleet.js         # P1: Fleet Overview (FleetPage)
│   ├── p2-devices.js       # P2: Device Management (DevicesPage) + SSE
│   ├── p3-energy.js        # P3: Energy Behavior (EnergyPage)
│   ├── p3-asset-energy.js  # P3 sub: Asset-level energy detail
│   ├── p3-asset-health.js  # P3 sub: Asset-level health detail
│   ├── p4-hems.js          # P4: HEMS Control (HEMSPage)
│   ├── p5-strategy.js      # P5: Strategy Triggers (StrategyPage)
│   ├── p5-vpp.js           # P5 legacy: VPP capacity/latency/DR (not loaded in index.html, superseded by p5-strategy.js)
│   ├── p6-alerts.js        # P6: Alerts / Alarm Center (AlertsPage) [v6.8, replaces p6-performance.js]
│   ├── p6-performance.js   # P6: Performance (PerformancePage) [still in repo, NOT loaded in index.html — superseded by p6-alerts.js]
│   └── app.js              # Router, DemoStore, role switching, lifecycle
```

### Script Load Order (脚本加载顺序)

Order matters — each file depends on globals exported by predecessors:

```
mock-data.js → config.js → data-source.js → i18n.js → components.js → charts.js
→ p1-fleet.js → p2-devices.js → p3-*.js → p4-hems.js → p5-strategy.js → p6-alerts.js
→ app.js
```

`app.js` is loaded last because it references all page modules (`FleetPage`, `DevicesPage`, etc.) and kicks off the router.

---

## 3. Page Hierarchy (页面层级)

| Page | Hash | Module | Purpose |
|------|------|--------|---------|
| **P1 Fleet** | `#fleet` | `FleetPage` | Gateway-first operations dashboard — availability, outages, backfill pressure (网关运营总览) |
| **P2 Devices** | `#devices` | `DevicesPage` | Device inventory, gateway drill-down, telemetry, schedule management, SSE real-time push (设备管理) |
| **P3 Energy** | `#energy` | `EnergyPage` | 24h energy behavior curves, 7d/30d/12m statistics, B/A compare (能源行为) |
| **P4 HEMS** | `#hems` | `HEMSPage` | Home Energy Management — mode distribution, tariff rates, batch dispatch (家庭能源管理) |
| **P5 Strategy** | `#vpp` | `StrategyPage` | Posture-aware triage cockpit — intent cards, override management, alert control (策略触发) |
| **P6 Alerts** | `#alerts` | `AlertsPage` | Alarm Center — KPI cards (active/severe/recovered/affected gateways), filter bar (status, level, gateway, period), severity badges, alert table (告警中心). Replaces P6 Performance Scorecard in PAGES array and index.html |

> **Note:** `p6-performance.js` (PerformancePage) still exists in the repo but is NOT loaded in `index.html` — its `<script>` tag was replaced by `p6-alerts.js`. The `#performance` hash is no longer in the PAGES array. Performance BFF endpoints (`/api/performance/scorecard`, `/api/performance/savings`) remain functional but are unused by the current frontend.

### Role Visibility (角色可见性)

| Page | `admin` | `integrador` |
|------|---------|-------------|
| P1 Fleet | Yes | Yes |
| P2 Devices | Yes | Yes |
| P3 Energy | Yes | Yes |
| P4 HEMS | Yes | Yes |
| P5 Strategy | Yes | **No** |
| P6 Performance | Yes | Yes |

---

## 4. Hash Router and Page Lifecycle (路由与页面生命周期)

### Router (`app.js`)

The SPA uses a hash-based router with no external library:

```
URL: index.html#fleet   → navigateTo("fleet")
URL: index.html#devices → navigateTo("devices")
URL: index.html#energy  → navigateTo("energy")
```

**`navigateTo(pageId)` flow:**

1. Role access check — redirect to `#fleet` if page not allowed for current role
2. `history.pushState()` to update hash without loop
3. Hide all `.page-section`, show target via `.active` class
4. CSS fade animation (`page-fade-enter` → `page-fade-active`)
5. Update sidebar nav highlighting
6. Update top bar title via `t(page.labelKey)` (translated)
7. **First visit:** call `initPage(pageId)` → invokes the page module's `init()` method
8. **Revisit:** call `Charts.activatePageCharts(pageId)` to resize deferred charts

### Page Module Contract (页面模块契约)

Every page module exports an object with:

| Method | Required | Description |
|--------|----------|-------------|
| `init()` | Yes | Async. Fetch data, render content, init charts. Returns Promise. |
| `onRoleChange(role)` | Optional | Called when role switches while page is visible. |

Typical `init()` pattern:

```
1. Show skeleton (Components.skeletonKPIs / skeletonTable / skeletonChart)
2. Promise.all([ DataSource.xxx.yyy(), ... ])
3. On success: container.innerHTML = self._buildContent()
4. On error: showErrorBoundary(containerId, err)
5. Init charts (Charts.createChart)
```

### Page Invalidation (页面失效)

When role or language changes, `invalidateHiddenPages()` disposes charts and clears `pageInitialized` for all pages except the current one. The current page is disposed and re-initialized immediately.

---

## 5. Component Model (组件模型)

The `Components` object (`components.js`) provides factory functions that return HTML strings. There is no virtual DOM — components are rendered via `innerHTML`.

| Factory | Output | Usage |
|---------|--------|-------|
| `Components.kpiCard({ value, label, color, suffix, prefix })` | KPI card HTML | Metric display in KPI grids |
| `Components.dataTable({ columns, rows, emptyText })` | Full `<table>` HTML | Data tables with headers, formatting, alignment |
| `Components.sectionCard(title, bodyHTML, { headerRight, dataRole })` | Card with header + body | Content sections throughout all pages |
| `Components.statusBadge(status, text)` | Inline badge span | Online/offline/warning indicators |
| `Components.skeletonKPIs(count)` | Skeleton loading cards | Loading state before data arrives |
| `Components.skeletonTable(rows)` | Skeleton loading table | Loading state |
| `Components.skeletonChart()` | Skeleton loading chart | Loading state |
| `Components.errorBanner(message)` | Error banner with retry | API failure display |
| `Components.renderWithSkeleton(container, skeleton, real, cb)` | N/A (side effect) | 500ms skeleton → real content transition |

**Pattern (模式):** All page modules compose their UI by concatenating HTML strings from these factories, then assign to `container.innerHTML`. Event listeners are bound after render via query selectors.

---

## 6. Data Flow (数据流)

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│config.js │────▶│data-source.js│────▶│ BFF API      │────▶│ Database │
│USE_MOCK  │     │ withFallback │     │ /api/...     │     │ Postgres │
│BFF_API_URL│    │              │     │              │     │          │
└─────────┘     └──────────────┘     └─────────────┘     └──────────┘
                       │
                       │ (if USE_MOCK=true)
                       ▼
                ┌──────────────┐
                │ mock-data.js │
                │ (hardcoded)  │
                └──────────────┘
```

### config.js

```javascript
const CONFIG = {
  BFF_API_URL: "/api",   // relative path — works via nginx → BFF
  USE_MOCK: false,       // false = live API; true = mock data
};
```

### DataSource (data-source.js)

IIFE singleton exposing domain-grouped methods:

| Namespace | Methods | Page |
|-----------|---------|------|
| `DataSource.fleet` | `overview()`, `charts()`, `integradores()`, `offlineEvents(limit)`, `uptimeTrend()` | P1 |
| `DataSource.devices` | `list(filters)`, `gateways()`, `gatewayDevices(id)`, `deviceDetail(id)`, `gatewayDetail(id)`, `updateDevice(id, cfg)`, `putDevice(id, cfg)`, `getSchedule(id)`, `putSchedule(id, cfg)` | P2 |
| `DataSource.energy` | `gateway24h(id, date)`, `gatewayStats(id, window, endDate)`, `gatewayEnergy(id, date)`, `summary(date)`, `baCompare(id)` | P3 |
| `DataSource.hems` | `overview()`, `dispatch(mode, filters)`, `batchDispatch(params)`, `batchHistory(limit)`, `gatewayTargeting()` | P4 |
| `DataSource.tariffs` | `get()` | P4 |
| `DataSource.vpp` | `capacity()`, `latency()`, `drEvents()` | P5 |
| `DataSource.p5` | `overview()`, `intentDetail(id)`, `intentAction(id, action, body)`, `createOverride(body)`, `cancelOverride(id, body)` | P5 |
| `DataSource.alerts` | `summary()`, `list(filters)` | P6 |
| `DataSource.performance` | `scorecard()`, `savings(period)` | P6 (legacy, unused by current frontend) |
| `DataSource.asset` | `telemetry(assetId, from, to, resolution)`, `health(assetId, from, to)` | P3 sub |

### Dual-Mode Pattern (双模式模式)

The `withFallback(apiCall, mockData)` function enforces a strict separation:

- **`USE_MOCK=true`**: Returns `Promise.resolve(mockData)` — never calls API
- **`USE_MOCK=false`**: Calls API — errors propagate, **no fallback** to mock

### API Envelope (API 信封格式)

All BFF responses follow the envelope:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "message" }
```

`apiGet()` / `apiPost()` / `apiPut()` unwrap the envelope automatically. On HTTP 401, the JWT is cleared and the user is redirected to `login.html`.

---

## 7. Chart System (图表系统)

### Charts Singleton (`charts.js`)

The `Charts` object manages all ECharts instances with five critical rules:

1. **All charts MUST go through `Charts.createChart()`** — never direct `echarts.init()`
2. **Singleton per container** — `echarts.getInstanceByDom()` checks before init, reuses if exists
3. **ResizeObserver** bound to every chart container for auto-resize
4. **Deferred init** — if container is `display:none` (offscreen page), options are stored in `_pendingOptions` and initialized when page becomes visible
5. **`activatePageCharts(pageId)`** called by router after page switch triggers `requestAnimationFrame` double-rAF to wait for layout reflow

### Chart Registry (图表注册)

```
Charts._registry    = { pageId: [containerId, ...] }
Charts._observers   = { containerId: ResizeObserver }
Charts._pendingOptions = { containerId: { option, opts } }
```

### Theme Awareness (主题感知)

After every chart init/update, `Charts._getThemeOverrides()` applies theme-appropriate colors:

| Property | Dark Theme | Light Theme |
|----------|-----------|-------------|
| Tooltip bg | `#1a1d27` | `#ffffff` |
| Tooltip border | `#2a2d3a` | `#e2e4e9` |
| Tooltip text | `#e4e4e7` | `#1a1d27` |
| Legend text | `#9ca3af` | `#6b7280` |
| Axis line/tick | `#2a2d3a` | `#e2e4e9` |
| Axis label | `#9ca3af` | `#6b7280` |
| Split line | `rgba(42,45,58,0.6)` | `rgba(226,228,233,0.8)` |

`Charts.refreshTheme()` is called after role/theme switch to re-apply these overrides to all visible charts.

### Lifecycle Methods (生命周期方法)

| Method | When Called |
|--------|-------------|
| `Charts.createChart(id, option, { pageId })` | Page init — registers + initializes (or defers) |
| `Charts.activatePageCharts(pageId)` | Router navigates to a page (second+ visit) |
| `Charts.disposePageCharts(pageId)` | Before re-init, on role/lang change |
| `Charts.refreshTheme()` | After `switchRole()` changes `data-theme` |

---

## 8. i18n System (国际化系统)

### Architecture

`I18n` is an IIFE singleton (`i18n.js`) exposing:

- `I18n.t(key)` — lookup translation for current language
- `I18n.setLang(lang)` — persist to `localStorage`, dispatch `langchange` event
- `I18n.getLang()` — return current language code

Global shorthand: `var t = I18n.t;` — available everywhere after `i18n.js` loads.

### Languages (语言)

| Code | Label | Status |
|------|-------|--------|
| `pt-BR` | Portuguese (Brazil) | Default, fallback |
| `en` | English | Complete |
| `zh-CN` | Simplified Chinese | Complete |

### Fallback Chain (回退链)

```javascript
dict[currentLang][key] → translations["en"][key] → key (raw)
```

### Language Change Flow (语言切换流程)

1. User selects language in `<select id="lang-switcher">`
2. `I18n.setLang(lang)` persists to `localStorage("lang")`, sets `data-lang` attribute
3. Dispatches `window.CustomEvent("langchange")`
4. `app.js` listener:
   - Updates `<html lang>` attribute
   - Re-translates sidebar labels, role badge, page title
   - Calls `invalidateHiddenPages()` — disposes hidden page charts
   - Disposes + re-inits current page with translated content

### Number/Date Format Rule (数字/日期格式规则)

**CRITICAL:** Numbers, dates, and currency always use Brazilian format (`DD/MM/YYYY`, comma decimal separator) regardless of language. Utility functions `formatISODate()`, `formatISODateTime()`, `formatShortDate()` in `app.js` enforce this.

---

## 9. CSS Architecture (CSS 架构)

### 5-File Modular Structure

| File | Lines | Purpose |
|------|-------|---------|
| `variables.css` | 108 | Design tokens: colors, spacing, radii, surfaces, shadows, breakpoints |
| `base.css` | 193 | CSS reset, typography, data values, status badges, skeleton animations |
| `layout.css` | 443 | App shell (sidebar + main), top bar, responsive breakpoints |
| `components.css` | 406 | KPI cards, data tables, section cards, form elements, modals |
| `pages.css` | 7,195 | Page-specific styles (P1-P6), Visual Unification (VU) classes |

### Design Tokens (设计令牌)

#### Color Palette

| Token | Dark | Light | Semantic |
|-------|------|-------|----------|
| `--bg` | `#0f1117` | `#f8f9fa` | Page background |
| `--card` | `#1a1d27` | `#ffffff` | Card surfaces |
| `--border` | `#2a2d3a` | `#e2e4e9` | Borders |
| `--text` | `#e4e4e7` | `#1a1d27` | Primary text |
| `--muted` | `#9ca3af` | `#6b7280` | Secondary text |
| `--positive` | `#22c55e` | `#16a34a` | Green: online, savings, generation |
| `--negative` | `#ef4444` | `#dc2626` | Red: offline, cost, below target |
| `--neutral` | `#a855f7` | `#9333ea` | Purple: battery, VPP, system actions |
| `--accent` | `#3b82f6` | `#2563eb` | Blue: interactive elements, links |
| `--amber` | `#f59e0b` | `#d97706` | Amber: warnings, pending |
| `--cyan` | `#06b6d4` | `#0891b2` | Cyan |
| `--pink` | `#ec4899` | `#db2777` | Pink |

Every color has a `*-bg` variant at 10% opacity for background tints.

#### Surface Hierarchy (表面层级)

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--surface-0` | `#0f1117` | `#f8f9fa` | Page background |
| `--surface-1` | `#1a1d27` | `#ffffff` | Primary cards |
| `--surface-2` | `#1e2130` | `#f0f2f5` | Elevated / hero panels |
| `--surface-3` | `#252839` | `#e8eaee` | Nested / inset panels |

#### Shadow System

| Token | Dark | Light |
|-------|------|-------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.2)` | `0 1px 3px rgba(0,0,0,0.06)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.25)` | `0 4px 12px rgba(0,0,0,0.08)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.3)` | `0 8px 24px rgba(0,0,0,0.1)` |

#### Spacing (8px Base Grid)

| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |
| `--space-2xl` | 40px |
| `--space-3xl` | 56px |

#### Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-ui` | `'Inter', -apple-system, sans-serif` | All UI text |
| `--font-data` | `'JetBrains Mono', monospace` | Numeric values, tabular data |

Data values use `font-variant-numeric: tabular-nums` for aligned columns.

#### Border Radius

| Token | Value |
|-------|-------|
| `--radius-sm` | 6px |
| `--radius-md` | 10px |
| `--radius-lg` | 14px |

#### Breakpoints (断点)

| Name | Width | Usage |
|------|-------|-------|
| `--bp-xl` | 1440px | Wide desktop — sidebar expands |
| `--bp-lg` | 1200px | Standard desktop |
| `--bp-md` | 1024px | Tablet landscape — sidebar hidden |
| `--bp-sm` | 768px | Tablet portrait |
| `--bp-xs` | 480px | Mobile |

Note: Breakpoints are used as literal values in `@media` queries (CSS variables not supported in media queries).

---

## 10. Login Flow (登录流程)

`login.html` is a standalone page (not part of the SPA shell).

### Flow

```
1. Page load → check localStorage("solfacil_jwt")
   ├── Token exists → redirect to index.html
   └── No token → show login form

2. Form submit → POST /api/auth/login { email, password }
   ├── Success → { success: true, data: { token: "..." } }
   │   ├── Store JWT in localStorage("solfacil_jwt") for fetch/XHR Authorization header
   │   ├── Browser receives HttpOnly `solfacil_jwt` cookie for EventSource/SSE auth
   │   └── Redirect to index.html
   └── Failure → show translated error message

3. index.html (app.js) → check localStorage("solfacil_jwt")
   └── No token → redirect to login.html

4. Logout button → POST /api/auth/logout
   ├── BFF clears HttpOnly `solfacil_jwt` cookie
   ├── Frontend clears localStorage("solfacil_jwt")
   └── Redirect to login.html
```

### Auth Guard (认证守卫)

At the top of `app.js`:

```javascript
if (!localStorage.getItem("solfacil_jwt")) {
  window.location.href = "login.html";
}
```

Every `apiGet()` / `apiPost()` / `apiPut()` call in `data-source.js` attaches `Authorization: Bearer <token>`. On HTTP 401, the JWT is removed and the user is redirected to `login.html`.

### Logout

The sidebar logout button clears `localStorage("solfacil_jwt")` and redirects to `login.html`.

---

## 11. Role Switching (角色切换)

### Two Roles

| Role | Theme | VPP Access | Scope |
|------|-------|-----------|-------|
| `admin` | Dark (`data-theme="dark"`) | Yes | Full fleet visibility |
| `integrador` | Light (`data-theme="light"`) | No | Tenant-scoped via RLS |

### `switchRole(role)` Flow

1. Set `currentRole`
2. Toggle `document.body.dataset.theme` (dark ↔ light)
3. Update role badge text (translated)
4. Show/hide elements with `data-role` attribute
5. Show/hide nav items based on `page.roles` array
6. If current page not accessible → redirect to `#fleet`
7. Notify current page module via `onRoleChange(role)`
8. `invalidateHiddenPages()` — force re-init on next visit
9. `Charts.refreshTheme()` — re-apply chart theme colors

---

## 12. DemoStore (演示状态存储)

`DemoStore` is a thin wrapper over `sessionStorage` for cross-page ephemeral state:

```javascript
DemoStore.get(key)    // Read: JSON.parse(sessionStorage["ds_" + key])
DemoStore.set(key, v) // Write: JSON.stringify → sessionStorage["ds_" + key]
DemoStore.reset()     // Clear all ds_* keys
```

All keys are prefixed with `ds_` to avoid collisions. Data survives page reloads but not tab close. Used for things like uptime trend data fallbacks.

---

## 13. SSE Real-Time Updates (SSE 实时更新)

### Location

P2 Devices page (`p2-devices.js`) connects to SSE for real-time push:

```javascript
self._sseSource = new EventSource(base + "/api/events");
```

### Event Types

| Event Type | Behavior |
|------------|----------|
| `command_status` | Re-enable Apply button on terminal results (`success`, `fail`, `timeout`); refresh schedule card |
| `telemetry_update` | Update device telemetry display in real-time |

### Connection Management

- Connection established when gateway detail panel opens
- `onerror` logs warning — `EventSource` auto-reconnects per spec
- Previous connection closed before opening new one
- SSE events debounced with `setTimeout` to avoid rapid re-renders

---

## 14. v6.6 Visual Unification Changes (v6.6 视觉统一变更)

v6.6 introduced the **Visual Unification (VU)** layer, synchronizing P1/P2 visual treatment with the P3-P5 design language established in v6.3-v6.5.

### New CSS Classes

| Class | Purpose |
|-------|---------|
| `.vu-page-header` | Consistent page header with title + mission statement |
| `.vu-page-title` | Page title styling (larger, bolder) |
| `.vu-page-mission` | Subtitle describing page purpose |
| `.vu-hero` | Hero summary panel (elevated surface-2 background) |
| `.vu-hero-verdict` | Health verdict row (healthy/warning/critical) |
| `.vu-hero-badge` | Verdict indicator badge with color variants |
| `.vu-hero-narrative` | Human-readable summary paragraph |
| `.vu-hero-kpis` | Inline KPI strip within hero panel |
| `.vu-section-label` | Section divider label |
| `.vu-section` | Wrapper with consistent spacing and table styling |

### Surface Hierarchy Tokens

Added in `variables.css` as part of VU:

- `--surface-0` through `--surface-3` for depth layering
- `--shadow-sm`, `--shadow-md`, `--shadow-lg` for elevation
- `--space-2xl` (40px), `--space-3xl` (56px) for larger spacing

### P1 Fleet VU Integration

P1 Fleet adopted VU with:
- Page header (`vu-page-header`) with title + mission
- Hero summary panel (`vu-hero`) with health verdict badge + narrative
- Priority sites stack (operational triage)
- Section labels between content blocks

---

## 15. API Endpoints Consumed (消耗的 API 端点)

| Method | Endpoint | Page | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | Login | Authenticate, receive JWT + set HttpOnly `solfacil_jwt` cookie for SSE |
| POST | `/api/auth/logout` | Global | Clear HttpOnly auth cookie and terminate browser SSE auth |
| GET | `/api/fleet/overview` | P1 | Fleet-level KPIs |
| GET | `/api/fleet/charts` | P1 | Gateway status + inverter brand distribution |
| GET | `/api/fleet/integradores` | P1 | Organization list |
| GET | `/api/fleet/offline-events` | P1 | Recent outages |
| GET | `/api/fleet/uptime-trend` | P1 | 28-day uptime trend |
| GET | `/api/devices` | P2 | Device list (filterable) |
| GET | `/api/gateways` | P2 | Gateway list |
| GET | `/api/gateways/:id/devices` | P2 | Devices under a gateway |
| GET | `/api/gateways/:id/detail` | P2 | Gateway detail |
| GET | `/api/devices/:id` | P2 | Device detail |
| PUT | `/api/devices/:id` | P2 | Update device config |
| GET | `/api/gateways/:id/schedule` | P2 | Gateway schedule |
| PUT | `/api/gateways/:id/schedule` | P2 | Update schedule |
| SSE | `/api/events` | P2 | Real-time telemetry + command status, authenticated via same-origin HttpOnly auth cookie |
| GET | `/api/gateways/:id/energy-24h` | P3 | 288-point 5-min energy curve |
| GET | `/api/gateways/:id/energy-stats` | P3 | 7d/30d/12m energy statistics |
| GET | `/api/gateways/:id/energy` | P3 | Legacy gateway energy |
| GET | `/api/gateways/summary` | P3 | Gateway energy summary |
| GET | `/api/gateways/:id/ba-compare` | P3 | Before/after comparison |
| GET | `/api/assets/:id/telemetry` | P3 | Asset telemetry history |
| GET | `/api/assets/:id/health` | P3 | Asset health history |
| GET | `/api/hems/overview` | P4 | HEMS dashboard data |
| POST | `/api/hems/dispatch` | P4 | Single dispatch command |
| POST | `/api/hems/batch-dispatch` | P4 | Batch mode dispatch |
| GET | `/api/hems/batch-history` | P4 | Batch dispatch history |
| GET | `/api/hems/targeting` | P4 | Gateway targeting list |
| GET | `/api/tariffs` | P4 | Tariff rates |
| GET | `/api/vpp/capacity` | P5 | VPP capacity |
| GET | `/api/vpp/latency` | P5 | Latency tiers |
| GET | `/api/vpp/dr-events` | P5 | Demand response events |
| GET | `/api/p5/overview` | P5 | Strategy posture overview |
| GET | `/api/p5/intents/:id` | P5 | Intent detail |
| POST | `/api/p5/intents/:id/:action` | P5 | Intent action (approve/defer/etc.) |
| POST | `/api/p5/posture-override` | P5 | Create posture override |
| POST | `/api/p5/posture-override/:id/cancel` | P5 | Cancel override |
| GET | `/api/alerts/summary` | P6 | Alarm center KPI summary (active, severe, recovered, affected gateways) |
| GET | `/api/alerts` | P6 | Filtered alert list (status, level, gateway, period) |
| GET | `/api/performance/scorecard` | P6 (legacy) | Performance scorecard (unused by current frontend) |
| GET | `/api/performance/savings` | P6 (legacy) | Per-home savings (unused by current frontend) |

---

## 16. File Statistics (文件统计)

### JavaScript

| File | Lines |
|------|-------|
| `app.js` | 453 |
| `charts.js` | 244 |
| `components.js` | 173 |
| `config.js` | 11 |
| `data-source.js` | 634 |
| `i18n.js` | 3,227 |
| `mock-data.js` | 1,324 |
| `p1-fleet.js` | 501 |
| `p2-devices.js` | 2,487 |
| `p3-energy.js` | 1,763 |
| `p3-asset-energy.js` | 948 |
| `p3-asset-health.js` | 860 |
| `p4-hems.js` | 1,619 |
| `p5-strategy.js` | 2,163 |
| `p5-vpp.js` | 608 |
| `p6-performance.js` | 329 |
| **JS Total** | **17,344** |

### CSS

| File | Lines |
|------|-------|
| `variables.css` | 108 |
| `base.css` | 193 |
| `layout.css` | 443 |
| `components.css` | 406 |
| `pages.css` | 7,195 |
| **CSS Total** | **8,345** |

### HTML

| File | Purpose |
|------|---------|
| `index.html` | SPA shell (140 lines) |
| `login.html` | Standalone login (294 lines) |

### Grand Total

**~25,689 lines** across 16 JS files, 5 CSS files, and 2 HTML files.

---

## 17. Architecture Diagram (架构总览)

```
┌─────────────────────────────────────────────────────────┐
│                    login.html                            │
│  ┌─────────┐   POST /api/auth/login   ┌──────────┐     │
│  │Login Form│ ─────────────────────── ▶│ BFF API  │     │
│  └─────────┘   ◀─── JWT token ─────── └──────────┘     │
│       │                                                  │
│       ▼ localStorage("solfacil_jwt")                     │
└───────┼─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    index.html (SPA)                       │
│                                                          │
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │  Sidebar  │  │          Main Content               │   │
│  │           │  │                                      │   │
│  │ Fleet     │  │  ┌─────────┐  ┌──────────────────┐ │   │
│  │ Devices   │  │  │ Top Bar │  │  Components       │ │   │
│  │ Energy    │  │  │(title,  │  │  .kpiCard()       │ │   │
│  │ HEMS      │  │  │ lang,   │  │  .dataTable()     │ │   │
│  │ VPP       │  │  │ role)   │  │  .sectionCard()   │ │   │
│  │           │  │  └─────────┘  │  .statusBadge()   │ │   │
│  │ Role:     │  │               │  .errorBanner()   │ │   │
│  │ [admin ▼] │  │  ┌─────────┐  └──────────────────┘ │   │
│  │           │  │  │ Charts  │                        │   │
│  │ [Logout]  │  │  │ ECharts │  ┌──────────────────┐ │   │
│  │           │  │  │ factory │  │  DataSource       │ │   │
│  └──────────┘  │  └─────────┘  │  mock ↔ live API  │ │   │
│                │               └──────────────────┘ │   │
│                └────────────────────────────────────┘   │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  I18n    │  │ DemoStore│  │  Router  │               │
│  │ t() +    │  │ session  │  │ hash-    │               │
│  │ 3 langs  │  │ Storage  │  │ based    │               │
│  └──────────┘  └──────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────┘
        │
        │ fetch() + Authorization: Bearer <jwt>
        ▼
┌─────────────────────────────────────────────────────────┐
│              BFF API (Express 5.x, ts-node)              │
│              /api/* endpoints                            │
│              SSE: /api/events                            │
└─────────────────────────────────────────────────────────┘
```

---

## V2.4 Protocol Impact

**v6.8 frontend changes for V2.4 Health/DIDO display:**

- **P2 Devices (`p2-devices.js`)**: Gateway Health panel expanded with 5 new fields: Status 4G (`phoneStatus`), Sinal 4G (`phoneSignalStrength`), Umidade (`humidity`), Hora do Sistema (`systemTime`), Hora do Hardware (`hardwareTime`). New 6th diagnostic panel "I/O Digital" (DIDO) showing DO/DI state from `telemetryExtra.dido`.
- **i18n.js**: 7 new keys × 3 languages for health/DIDO fields.

> **Note (v6.7):** The v6.7 statement that "no frontend code changes required" was correct at that version. v6.8 added frontend UI to display the V2.4 Health and DIDO data that the BFF already exposed in v6.7.

### v6.8 CSS Changes

- **pages.css**: Added P6 alert styles — `.alert-banner`, `.alert-filter-bar`, `.alert-badge-*` (severity badges), `.alert-table` classes for the Alarm Center page.
