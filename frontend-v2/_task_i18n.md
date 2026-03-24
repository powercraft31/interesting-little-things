# Task: i18n — Three-Language Support (pt-BR / en / zh-CN)

## Working Directory
`/tmp/retired-solfacil/2026-02-15_SOLFACIL_VPP_Demo/frontend-v2/`

## Context
The Admin Portal has 6 working pages with hardcoded English UI labels. We need to add i18n support for 3 languages:
- **pt-BR** (Brazilian Portuguese) — production default
- **en** (English) — international
- **zh-CN** (Simplified Chinese) — internal review

## CRITICAL RULE: Numbers Stay Brazilian
**Currency, dates, and numeric formats ALWAYS use Brazilian format regardless of UI language:**
- Currency: `R$ 145,00` (comma decimal)
- Percentage: `93,6%` (comma decimal)
- Date: `01/03/2026 14:30` (DD/MM/YYYY HH:mm, 24h)
- These are NEVER translated or reformatted

**Only translate UI labels, titles, descriptions, button text, column headers, status text.**

## Existing Files to Read First
Read these files to understand the current code structure:
- `js/app.js` — routing, role switching, sidebar
- `js/components.js` — shared UI components
- `js/p1-fleet.js` through `js/p6-performance.js` — all 6 pages
- `css/layout.css` — header area where language switcher will go
- `index.html` — script loading order

---

## Step 1: Create `js/i18n.js`

Create a lightweight i18n module. Pattern:

```js
var I18n = (function() {
  var currentLang = localStorage.getItem('lang') || 'pt-BR';

  var translations = {
    'pt-BR': {
      // Sidebar
      'nav.fleet': 'Frota',
      'nav.devices': 'Dispositivos',
      'nav.energy': 'Energia',
      'nav.hems': 'HEMS',
      'nav.vpp': 'VPP',
      'nav.performance': 'Desempenho',
      // ... all keys
    },
    'en': {
      'nav.fleet': 'Fleet',
      'nav.devices': 'Devices',
      'nav.energy': 'Energy',
      'nav.hems': 'HEMS',
      'nav.vpp': 'VPP',
      'nav.performance': 'Performance',
      // ... all keys
    },
    'zh-CN': {
      'nav.fleet': '车队总览',
      'nav.devices': '设备管理',
      'nav.energy': '能源行为',
      'nav.hems': 'HEMS 控制',
      'nav.vpp': 'VPP & DR',
      'nav.performance': '绩效记分卡',
      // ... all keys
    }
  };

  function t(key) {
    var dict = translations[currentLang] || translations['pt-BR'];
    return dict[key] || translations['en'][key] || key;
  }

  function setLang(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    document.documentElement.setAttribute('data-lang', lang);
    // Trigger re-render of current page
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));
  }

  function getLang() { return currentLang; }

  return { t: t, setLang: setLang, getLang: getLang, translations: translations };
})();

// Shorthand
var t = I18n.t;
```

### Translation Keys — COMPLETE LIST

You MUST extract EVERY user-visible string from all 6 pages + app.js + components.js. Organize by section:

**Sidebar & Header:**
- nav items (fleet, devices, energy, hems, vpp, performance)
- role labels (SOLFACIL Admin, Integrador, Customer)
- header titles per page

**P1 Fleet Overview:**
- KPI labels: Total Devices, Online, Offline, Online Rate, Homes, Integradores
- Section titles: Uptime Trend, Device Type Distribution, Integradores, Recent Offline Events
- Table headers: Organization, Devices, Online Rate, Last Commission, Device ID, Offline Start, Duration, Cause, Backfill
- Device types: Inverter + Battery, Smart Meter, AC, EV Charger
- Cause labels: WiFi dropout, Power outage, Unknown

**P2 Device Management:**
- Filter labels, table headers, status labels (online/offline)
- Commissioning wizard step titles and button labels
- Drill-down panel labels

**P3 Energy Behavior:**
- Section titles, tab labels, chart legends
- Tariff zone labels (Peak, Intermediate, Off-Peak)
- Before/After comparison labels

**P4 HEMS Control:**
- Mode names and descriptions (Self-Consumption, Peak/Valley Arbitrage, Peak Shaving)
- Batch dispatch labels, filter labels
- Tarifa Branca section labels
- ACK status labels (ACK, Pending, Timeout)
- Button labels (Apply Changes, Preview Impact, Edit Rates, etc.)

**P5 VPP & DR:**
- Capacity card labels
- DR trigger form labels
- Event type labels (Discharge, Charge, Load Curtailment)
- Latency tier labels
- Event history table headers

**P6 Performance:**
- Objective titles (Hardware, Optimization, Operations)
- Metric names (Commissioning Time, Offline Resilience, Uptime, etc.)
- Chart title and legend labels

**Shared/Components:**
- Loading text, Coming Soon, No data available
- Confirm dialog buttons (Confirm, Cancel)
- Toast messages
- "Requires SOLFACIL Admin" tooltip

### Portuguese Translations (pt-BR)
Use natural Brazilian Portuguese. Key terms:
- Fleet Overview → Visão Geral da Frota
- Device Management → Gestão de Dispositivos
- Energy Behavior → Comportamento Energético
- HEMS Control → Controle HEMS
- Performance → Desempenho
- Total Devices → Total de Dispositivos
- Online Rate → Taxa Online
- Uptime Trend → Tendência de Uptime
- Recent Offline Events → Eventos Offline Recentes
- Self-Consumption → Autoconsumo
- Peak/Valley Arbitrage → Arbitragem Ponta/Fora-ponta
- Peak Shaving → Redução de Pico
- Demand Response → Resposta à Demanda
- Dispatch → Despacho
- Commissioning → Comissionamento
- Savings → Economia

### Chinese Translations (zh-CN)
Use simplified Chinese. Key terms:
- Fleet Overview → 车队总览
- Device Management → 设备管理
- Energy Behavior → 能源行为
- HEMS Control → HEMS 控制
- Performance → 绩效记分卡
- Total Devices → 设备总数
- Online Rate → 在线率
- Self-Consumption → 自发自用
- Peak/Valley Arbitrage → 峰谷套利
- Peak Shaving → 削峰
- Demand Response → 需求响应
- Commissioning → 调试入网
- Savings → 节费

---

## Step 2: Add Language Switcher to Header

In the header area (top-right, next to role badge), add a language dropdown:

```html
<select id="lang-switcher" class="lang-switcher">
  <option value="pt-BR">🇧🇷 PT</option>
  <option value="en">🇺🇸 EN</option>
  <option value="zh-CN">🇨🇳 中文</option>
</select>
```

Style it to match the existing header design (dark bg, small, unobtrusive).

Wire it: on change → `I18n.setLang(value)` → re-render current page.

---

## Step 3: Modify Each Page to Use `t()`

### Pattern for modification:
Replace hardcoded strings with `t('key')` calls. Example:

**Before:**
```js
html += '<h3>Recent Offline Events</h3>';
```

**After:**
```js
html += '<h3>' + t('fleet.offlineEvents') + '</h3>';
```

### Important rules:
1. **Do NOT break existing functionality** — if unsure, keep the original string as fallback
2. **Template literals with data stay as-is** — only extract the label part
3. **Chart axis labels and tooltips** — extract where possible, but don't break ECharts config
4. **Re-render on language change** — each page should listen for `langchange` event and re-init

Add to each page object:
```js
// In init():
window.addEventListener('langchange', function() { PageName.init(); });
```

### Sidebar re-render
The sidebar nav items in `app.js` must also use `t()` and re-render on language change.

---

## Step 4: Add i18n.js to index.html

Add `<script src="js/i18n.js"></script>` AFTER `mock-data.js` but BEFORE all page scripts.

Load order must be:
1. echarts CDN
2. mock-data.js
3. **i18n.js** ← NEW
4. components.js
5. charts.js
6. p1-fleet.js ... p6-performance.js
7. app.js

---

## Step 5: Test

After all changes, verify:
1. Default language is pt-BR (check localStorage empty state)
2. Switch to EN → all labels change to English
3. Switch to zh-CN → all labels change to Chinese
4. Numbers/dates/currency STAY in Brazilian format in ALL languages
5. Role switcher still works
6. All 6 pages render correctly in all 3 languages
7. Language preference persists across page reload (localStorage)
8. No console errors

---

## Acceptance Criteria
1. Language switcher visible in header, styled to match theme
2. All 3 languages complete — no missing translations (no raw keys shown)
3. Currency/dates/numbers ALWAYS Brazilian format
4. Language persists in localStorage
5. Every page re-renders correctly on language switch
6. Charts re-render with translated labels
7. No console errors in any language
8. pt-BR is the default language

## Completion Signal
```
openclaw system event --text "i18n DONE: 3 languages (pt-BR, en, zh-CN) complete. All pages translated." --mode now
```
