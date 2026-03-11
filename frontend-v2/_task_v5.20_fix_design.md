# v5.20 Fix — Frontend Design Document

**Date:** 2026-03-11
**Depends on:** `design/backend_architecture/14_v5.20_FIX_UPDATE.md` (backend), `design/v5.20_fix_requirements.md`
**Scope:** Fix #3 (Layer 3 Gateway-level), Fix #1 (Schedule Editor), Fix #4 (EMS Health)
**Files:** `frontend-v2/js/p2-devices.js`, `frontend-v2/js/data-source.js`, `frontend-v2/css/pages.css`

---

## 1. Fix #3: Layer 3 — Gateway-Level Navigation

### 1.1 Navigation Change

**Current flow:**
Gateway Card click → expand → device list → click device row → `_openLayer3(assetId)` → `DataSource.devices.deviceDetail(assetId)`

**New flow:**
Gateway Card → click Gateway name/arrow → enter Layer 3 (Gateway-level) via `_openLayer3GW(gatewayId)`
Device list remains expandable for quick glance. Device rows become **info-only** (no click → Layer 3).

### 1.2 DataSource Changes

**File:** `frontend-v2/js/data-source.js`

**ADD** new method `gatewayDetail` to the `devices` namespace (after L200):

```javascript
gatewayDetail: function (gatewayId) {
  return withFallback(
    function () {
      return apiGet("/api/gateways/" + gatewayId + "/detail");
    },
    function () {
      return typeof MOCK_GATEWAY_DETAIL !== "undefined"
        ? MOCK_GATEWAY_DETAIL
        : {};
    },
  );
},
```

**MODIFY** `getSchedule` (L207-217) — change from assetId to gatewayId:

```javascript
// BEFORE
getSchedule: function (assetId) {
  return withFallback(function () {
    return apiGet("/api/devices/" + assetId + "/schedule");
  }, /* ... */);
},

// AFTER
getSchedule: function (gatewayId) {
  return withFallback(function () {
    return apiGet("/api/gateways/" + gatewayId + "/schedule");
  }, /* ... */);
},
```

**MODIFY** `putSchedule` (L219-228) — change from assetId to gatewayId:

```javascript
// BEFORE
putSchedule: function (assetId, slots) {
  return apiPut("/api/devices/" + assetId + "/schedule", { slots: slots });
},

// AFTER
putSchedule: function (gatewayId, slots) {
  return apiPut("/api/gateways/" + gatewayId + "/schedule", { slots: slots });
},
```

### 1.3 Gateway Card — Add "Detail" Click Target

**File:** `frontend-v2/js/p2-devices.js` — `_buildGwCard()` (L108-175)

Add a clickable gateway name that opens Layer 3, separate from the chevron that toggles expand.

**BEFORE** (L128-135):
```javascript
'<div class="gw-name-block">' +
'<div class="gw-name-primary">' + gw.name + '</div>' +
'<div class="gw-sn">' + gw.gatewayId + '</div>' +
'</div>' +
```

**AFTER:**
```javascript
'<div class="gw-name-block">' +
'<a href="#" class="gw-detail-link" data-gw-id="' + gw.gatewayId + '">' +
'<div class="gw-name-primary">' + gw.name + ' &#8250;</div>' +
'</a>' +
'<div class="gw-sn">' + gw.gatewayId + '</div>' +
'</div>' +
```

### 1.4 Event Binding Changes

**File:** `frontend-v2/js/p2-devices.js` — `_setupLayer1Events()` (L178-187)

**BEFORE:**
```javascript
_setupLayer1Events: function () {
  var self = this;
  document.querySelectorAll(".gw-header").forEach(function (header) {
    header.addEventListener("click", function () {
      var card = header.closest(".gw-card");
      var gwId = card.dataset.gwId;
      self._toggleGateway(gwId);
    });
  });
},
```

**AFTER:**
```javascript
_setupLayer1Events: function () {
  var self = this;

  // Chevron click → expand/collapse device list (unchanged)
  document.querySelectorAll(".gw-chevron").forEach(function (chevron) {
    chevron.addEventListener("click", function (e) {
      e.stopPropagation();
      var card = chevron.closest(".gw-card");
      var gwId = card.dataset.gwId;
      self._toggleGateway(gwId);
    });
  });

  // Gateway name click → open Layer 3 (Gateway-level)
  document.querySelectorAll(".gw-detail-link").forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var gwId = link.dataset.gwId;
      self._openLayer3GW(gwId);
    });
  });
},
```

### 1.5 Remove Device Row → Layer 3 Navigation

**File:** `frontend-v2/js/p2-devices.js` — `_attachDeviceRowListeners()` (L306-313)

**BEFORE:**
```javascript
_attachDeviceRowListeners: function (container) {
  var self = this;
  container.querySelectorAll(".device-row").forEach(function (row) {
    row.addEventListener("click", function () {
      var assetId = row.dataset.assetId;
      self._openLayer3(assetId);
    });
  });
},
```

**AFTER:**
```javascript
_attachDeviceRowListeners: function (container) {
  // Device rows are now info-only — no click → Layer 3
  // Device list shows quick-glance stats only
},
```

Also: remove `cursor: pointer` from `.device-row` CSS (L1806).

### 1.6 New Method: `_openLayer3GW(gatewayId)`

**File:** `frontend-v2/js/p2-devices.js` — ADD after `_openLayer3` (L320)

```javascript
_openLayer3GW: async function (gatewayId) {
  var self = this;
  var layer1 = document.getElementById("layer1");
  var layer3 = document.getElementById("layer3");
  if (!layer1 || !layer3) return;

  self._currentGatewayId = gatewayId;
  layer1.style.display = "none";
  layer3.style.display = "block";
  layer3.innerHTML =
    '<div class="detail-loading"><div class="skeleton" style="height:400px;border-radius:10px"></div></div>';

  try {
    var detail = await DataSource.devices.gatewayDetail(gatewayId);
    self._currentDetail = detail;
    self._currentSchedule = detail.schedule || { syncStatus: "unknown", slots: [] };
    // _pendingSlots is the working copy for the editor (see Fix #1)
    self._pendingSlots = JSON.parse(JSON.stringify(self._currentSchedule.slots || []));
  } catch (err) {
    layer3.innerHTML =
      '<div class="error-boundary"><div class="error-icon">&#9888;</div>' +
      '<div class="error-title">Error</div>' +
      '<div class="error-detail">' + t("devices.loadFailed") + '</div>' +
      '<button class="btn btn-secondary" onclick="DevicesPage._closeLayer3()">' +
      t("shared.back") + '</button></div>';
    console.error("[P2] gatewayDetail error:", err);
    return;
  }

  if (!detail || !detail.gateway) {
    layer3.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">&#9888;</div>' +
      '<div class="empty-state-title">' + t("shared.noData") + '</div>' +
      '<button class="btn btn-secondary" onclick="DevicesPage._closeLayer3()">' +
      t("shared.back") + '</button></div>';
    return;
  }

  layer3.innerHTML = self._buildLayer3GW();
  self._setupLayer3Events();
},
```

### 1.7 New Method: `_buildLayer3GW()`

**File:** `frontend-v2/js/p2-devices.js` — Replaces `_buildLayer3()` for gateway-level

The response from `GET /api/gateways/{gatewayId}/detail` has a different shape than `GET /api/devices/{assetId}`. The new builder consumes the gateway-level response.

```javascript
_buildLayer3GW: function () {
  var detail = this._currentDetail;
  var gw = detail.gateway;
  var state = detail.state || {};
  var extra = detail.telemetryExtra || {};
  var config = detail.config || {};
  var devices = detail.devices || [];
  var schedule = this._currentSchedule || { syncStatus: "unknown", slots: [] };

  var statusTag = gw.status === "online"
    ? '<span class="tag-online">Online</span>'
    : '<span class="tag-offline">Offline</span>';

  // Sub-device summary line
  var devSummary = devices.map(function (d) {
    var icon = { "INVERTER_BATTERY": "\ud83d\udd0b", "SMART_METER": "\ud83d\udcca" };
    return (icon[d.assetType] || "\ud83d\udd0c") + " " + (d.name || d.assetId);
  }).join(" \u00b7 ");

  return (
    '<div class="detail-header">' +
    '<div class="breadcrumb">' +
    '<a href="#" class="bc-link" id="bc-back">' + t("nav.devices") + '</a>' +
    ' \u203a <span>' + gw.name + '</span>' +
    '</div>' +
    '<h2>' + gw.name + ' ' + statusTag + '</h2>' +
    '<div class="detail-subtitle">' + gw.gatewayId + ' \u00b7 ' + devSummary + '</div>' +
    '</div>' +
    '<div class="detail-page">' +
    '<div class="left-col">' +
    this._buildEnergyFlow(state) +       // unchanged — reads from merged state
    this._buildBatteryStatus(state) +     // unchanged
    this._buildInverterGrid(state, extra) + // unchanged
    '</div>' +
    '<div class="right-col">' +
    this._buildDeviceConfigGW(devices, config) +  // gateway-level config
    this._buildScheduleCardEditable(schedule) +   // Fix #1: editable
    this._buildGatewayHealth(gw.emsHealth) +      // Fix #4: EMS health
    '</div>' +
    '</div>'
  );
},
```

**Key difference:** No action-bar with Apply button at page bottom. The Apply button moves inside the Schedule card (Fix #1 requirement).

### 1.8 `_buildDeviceConfigGW()` — Gateway-Level Config Card

Shows the primary inverter config (from `detail.config`) and a sub-device list.

```javascript
_buildDeviceConfigGW: function (devices, config) {
  // Show device list as read-only chips
  var deviceChips = devices.map(function (d) {
    var onlineClass = d.isOnline ? "tag-online" : "tag-offline";
    return '<span class="device-chip ' + onlineClass + '">' +
      (d.name || d.assetId) + '</span>';
  }).join("");

  var rows = [
    { label: "SOC Min (%)", value: config.socMin != null ? config.socMin : "--" },
    { label: "SOC Max (%)", value: config.socMax != null ? config.socMax : "--" },
    { label: "Max Charge Rate (kW)", value: config.maxChargeRateKw || "--" },
    { label: "Max Discharge Rate (kW)", value: config.maxDischargeRateKw || "--" },
    { label: "Grid Import Limit (kW)", value: config.gridImportLimitKw != null ? config.gridImportLimitKw : "--" },
  ];

  var body =
    '<div class="device-chips-row">' + deviceChips + '</div>' +
    rows.map(function (r) {
      return '<div class="tele-row"><span class="tele-label">' + r.label +
        '</span><span class="tele-value">' + r.value + '</span></div>';
    }).join("");

  return Components.sectionCard("Gateway Configuration", body);
},
```

### 1.9 CSS Additions for Fix #3

**File:** `frontend-v2/css/pages.css` — ADD after `.gw-chevron` section (~L1792)

```css
/* Gateway detail link in card header */
.gw-detail-link {
  text-decoration: none;
  color: inherit;
}
.gw-detail-link:hover .gw-name-primary {
  color: var(--accent);
  text-decoration: underline;
}

/* Device chips (read-only device list in Gateway Layer 3) */
.device-chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-bottom: var(--space-md);
}
.device-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
}
.device-chip.tag-online { border-left: 3px solid var(--positive); }
.device-chip.tag-offline { border-left: 3px solid var(--negative); }
```

---

## 2. Fix #1: Daily Schedule Editor UI

### 2.1 Overview

Replace the read-only `_buildScheduleCard()` with an editable `_buildScheduleCardEditable()`. The editor uses:
- Native `<select>` dropdowns for hour and mode (no custom widgets)
- `_pendingSlots` array as the working copy (initialized from schedule.slots in `_openLayer3GW`)
- Real-time timeline bar preview on add/delete
- Apply button inside the card

### 2.2 State Management

**File:** `frontend-v2/js/p2-devices.js` — new properties on `DevicesPage`

```javascript
_pendingSlots: [],       // working copy for schedule editor
_currentGatewayId: null, // gatewayId for Layer 3
```

These are set in `_openLayer3GW()` (see Fix #3 §1.6):
```javascript
self._pendingSlots = JSON.parse(JSON.stringify(schedule.slots || []));
self._currentGatewayId = gatewayId;
```

### 2.3 `_buildScheduleCardEditable(schedule)`

**File:** `frontend-v2/js/p2-devices.js` — NEW method (replaces `_buildScheduleCard` for Layer 3 GW)

```javascript
_buildScheduleCardEditable: function (schedule) {
  var syncBadgeClass = schedule.syncStatus === "synced" ? "sync-ok"
    : schedule.syncStatus === "pending" ? "sync-pending" : "sync-unknown";
  var syncLabel = schedule.syncStatus === "synced" ? "Synced"
    : schedule.syncStatus === "pending" ? "Pending" : "Unknown";
  var lastAck = schedule.lastAckAt ? formatISODateTime(schedule.lastAckAt) : "--";

  var body =
    '<div class="sync-status ' + syncBadgeClass + '">' +
    '<span class="sync-dot"></span> ' + syncLabel +
    '<span class="sync-ack">Last ACK: ' + lastAck + '</span>' +
    '</div>' +
    '<div class="schedule-bar" id="schedule-bar-preview"></div>' +
    '<div class="schedule-markers"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>' +
    '<table class="schedule-table">' +
    '<thead><tr><th>Start</th><th>End</th><th>Mode</th><th></th></tr></thead>' +
    '<tbody id="schedule-rows"></tbody>' +
    '</table>' +
    '<button class="btn btn-outline btn-sm" id="schedule-add-slot">+ Add Slot</button>' +
    '<div class="schedule-apply-row">' +
    '<button class="btn btn-primary" id="schedule-apply">' +
    t("devices.applyToGateway") + '</button>' +
    '</div>';

  return Components.sectionCard("Daily Schedule", body);
},
```

### 2.4 Slot Row HTML (Editable)

Each row in `<tbody id="schedule-rows">` uses native `<select>`:

```javascript
_buildSlotRow: function (slot, index) {
  var modeOptions = ["self_consumption", "peak_valley_arbitrage", "peak_shaving"];
  var modeLabels = {
    self_consumption: "Self Consumption",
    peak_valley_arbitrage: "Peak Valley Arb.",
    peak_shaving: "Peak Shaving",
  };
  var modeColors = {
    self_consumption: "#22c55e",
    peak_valley_arbitrage: "#3b82f6",
    peak_shaving: "#a855f7",
  };

  // Start hour: 0-23
  var startOptions = "";
  for (var h = 0; h < 24; h++) {
    startOptions += '<option value="' + h + '"' +
      (slot.startHour === h ? " selected" : "") + '>' +
      String(h).padStart(2, "0") + ':00</option>';
  }

  // End hour: 1-24
  var endOptions = "";
  for (var h = 1; h <= 24; h++) {
    endOptions += '<option value="' + h + '"' +
      (slot.endHour === h ? " selected" : "") + '>' +
      String(h).padStart(2, "0") + ':00</option>';
  }

  // Mode select
  var modeSelect = modeOptions.map(function (m) {
    return '<option value="' + m + '"' +
      (slot.mode === m ? " selected" : "") + '>' +
      modeLabels[m] + '</option>';
  }).join("");

  var color = modeColors[slot.mode] || "#6b7280";

  return (
    '<tr data-slot-index="' + index + '">' +
    '<td><select class="slot-start config-input">' + startOptions + '</select></td>' +
    '<td><select class="slot-end config-input">' + endOptions + '</select></td>' +
    '<td><span class="schedule-mode-badge" style="background:' + color + '">' +
    '<select class="slot-mode config-input schedule-mode-select">' + modeSelect + '</select>' +
    '</span></td>' +
    '<td><button class="btn-icon btn-delete-slot" title="Delete">\ud83d\uddd1</button></td>' +
    '</tr>'
  );
},
```

### 2.5 Render & Refresh Helpers

```javascript
_renderScheduleRows: function () {
  var self = this;
  var tbody = document.getElementById("schedule-rows");
  if (!tbody) return;
  tbody.innerHTML = self._pendingSlots.map(function (slot, i) {
    return self._buildSlotRow(slot, i);
  }).join("");
  self._renderTimelinePreview();
},

_renderTimelinePreview: function () {
  var bar = document.getElementById("schedule-bar-preview");
  if (!bar) return;
  var modeColors = {
    self_consumption: "#22c55e",
    peak_valley_arbitrage: "#3b82f6",
    peak_shaving: "#a855f7",
  };
  bar.innerHTML = this._pendingSlots.map(function (slot) {
    var widthPct = (((slot.endHour - slot.startHour) / 24) * 100).toFixed(2);
    var color = modeColors[slot.mode] || "#6b7280";
    return '<div class="schedule-segment" style="width:' + widthPct +
      '%;background:' + color + '" title="' +
      String(slot.startHour).padStart(2, "0") + ':00-' +
      String(slot.endHour).padStart(2, "0") + ':00 ' +
      slot.mode + '"></div>';
  }).join("");
},
```

### 2.6 Event Binding for Schedule Editor

**File:** `frontend-v2/js/p2-devices.js` — ADD to `_setupLayer3Events()` (L947)

```javascript
// --- Schedule editor events ---
var self = this;

// Render initial rows
self._renderScheduleRows();

// Add Slot button
var addBtn = document.getElementById("schedule-add-slot");
if (addBtn) {
  addBtn.addEventListener("click", function () {
    // Default: next available hour slot
    var lastEnd = self._pendingSlots.length > 0
      ? self._pendingSlots[self._pendingSlots.length - 1].endHour
      : 0;
    if (lastEnd >= 24) lastEnd = 0; // wrap
    var newSlot = {
      startHour: lastEnd,
      endHour: Math.min(lastEnd + 6, 24),
      mode: "self_consumption"
    };
    self._pendingSlots = self._pendingSlots.concat([newSlot]);
    self._renderScheduleRows();
    self._attachSlotListeners();
  });
}

// Apply button (inside schedule card)
var applyBtn = document.getElementById("schedule-apply");
if (applyBtn) {
  applyBtn.addEventListener("click", function () {
    self._handleApplyGW();
  });
}

self._attachSlotListeners();
```

### 2.7 Slot Change & Delete Listeners

```javascript
_attachSlotListeners: function () {
  var self = this;
  var tbody = document.getElementById("schedule-rows");
  if (!tbody) return;

  // Delete buttons
  tbody.querySelectorAll(".btn-delete-slot").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var row = btn.closest("tr");
      var idx = parseInt(row.dataset.slotIndex, 10);
      self._pendingSlots = self._pendingSlots.filter(function (_, i) { return i !== idx; });
      self._renderScheduleRows();
      self._attachSlotListeners();
    });
  });

  // Select change listeners
  tbody.querySelectorAll("tr").forEach(function (row) {
    var idx = parseInt(row.dataset.slotIndex, 10);
    var startSel = row.querySelector(".slot-start");
    var endSel = row.querySelector(".slot-end");
    var modeSel = row.querySelector(".slot-mode");

    if (startSel) {
      startSel.addEventListener("change", function () {
        self._pendingSlots = self._pendingSlots.map(function (s, i) {
          return i === idx
            ? { startHour: parseInt(startSel.value, 10), endHour: s.endHour, mode: s.mode }
            : s;
        });
        self._renderTimelinePreview();
      });
    }
    if (endSel) {
      endSel.addEventListener("change", function () {
        self._pendingSlots = self._pendingSlots.map(function (s, i) {
          return i === idx
            ? { startHour: s.startHour, endHour: parseInt(endSel.value, 10), mode: s.mode }
            : s;
        });
        self._renderTimelinePreview();
      });
    }
    if (modeSel) {
      modeSel.addEventListener("change", function () {
        self._pendingSlots = self._pendingSlots.map(function (s, i) {
          return i === idx
            ? { startHour: s.startHour, endHour: s.endHour, mode: modeSel.value }
            : s;
        });
        self._renderScheduleRows();
        self._attachSlotListeners();
      });
    }
  });
},
```

### 2.8 `_handleApplyGW()` — Gateway-Level Schedule Submit

**File:** `frontend-v2/js/p2-devices.js` — NEW method (replaces `_handleApply`)

```javascript
_handleApplyGW: async function () {
  var self = this;
  var gwId = self._currentGatewayId;
  if (!gwId) return;

  // Validation: no overlapping slots, startHour < endHour
  var valid = self._pendingSlots.every(function (s) {
    return s.startHour < s.endHour && s.startHour >= 0 && s.endHour <= 24;
  });
  if (!valid) {
    self._showToast("Invalid schedule: check start/end hours", "warning");
    return;
  }

  var applyBtn = document.getElementById("schedule-apply");
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = "Submitting...";
  }

  try {
    await DataSource.devices.putSchedule(gwId, self._pendingSlots);

    if (applyBtn) {
      applyBtn.textContent = "Submitted \u2713";
      applyBtn.classList.add("btn-success");
    }
    self._showToast("Schedule submitted. Waiting for gateway confirmation.", "success");

    setTimeout(function () {
      if (applyBtn) {
        applyBtn.textContent = t("devices.applyToGateway");
        applyBtn.disabled = false;
        applyBtn.classList.remove("btn-success");
      }
    }, 3000);
  } catch (err) {
    console.error("[P2] putSchedule error:", err);
    self._showToast(t("devices.loadFailed"), "error");
    if (applyBtn) {
      applyBtn.textContent = t("devices.applyToGateway");
      applyBtn.disabled = false;
    }
  }
},
```

### 2.9 CSS for Schedule Editor

**File:** `frontend-v2/css/pages.css` — ADD after `.schedule-table` section (~L2090)

```css
/* Schedule editor controls */
.schedule-table select.config-input {
  padding: 2px 4px;
  font-size: 0.8rem;
  background: var(--card-bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.schedule-mode-select {
  background: transparent !important;
  border: none !important;
  color: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.btn-delete-slot {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--negative);
  transition: background 0.15s;
}
.btn-delete-slot:hover {
  background: rgba(239, 68, 68, 0.15);
}

#schedule-add-slot {
  margin-top: var(--space-sm);
  width: 100%;
}

.schedule-apply-row {
  margin-top: var(--space-md);
  display: flex;
  justify-content: flex-end;
}

.btn-outline {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--text-muted);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.82rem;
  transition: border-color 0.2s, color 0.2s;
}
.btn-outline:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

---

## 3. Fix #4: EMS Health Display

### 3.1 Overview

The BFF already returns `emsHealth` on the gateway object (via `GET /api/gateways` and now `GET /api/gateways/:gatewayId/detail`). Display key EMS health indicators in two locations:

1. **Gateway Card (Layer 1):** Compact inline (already partially shown — WiFi, firmware, uptime)
2. **Layer 3 right column:** New "Gateway Health" card with CSS Grid layout

### 3.2 Gateway Card Enhancement (Layer 1)

**File:** `frontend-v2/js/p2-devices.js` — `_buildGwCard()` (L108-175)

The current card already shows WiFi RSSI, firmware version, and uptime from `gw.emsHealth`. However, the current code reads `health.wifiRssi`, `health.firmwareVersion`, `health.uptimeSeconds` — these map to the **normalized** keys from `GET /api/gateways`.

The raw `ems_health` JSONB uses Chinese-format keys (`CPU_temp`, `wifi_signal_strength`, etc.) which the BFF normalizes to camelCase. The existing rendering is sufficient for Layer 1.

**Enhancement:** Add CPU temp and memory usage to the `.gw-meta` line:

**BEFORE** (L137-161):
```javascript
'<div class="gw-meta">' +
'<span>' + (gw.deviceCount || 0) + ' ' + t("shared.devices") + '</span>' +
'<span>' + t("devices.wifi") + ' ' + rssi + '</span>' +
'<span>' + t("devices.firmware") + ' ' + fw + '</span>' +
'<span>' + t("devices.uptime") + ' ' + uptime + '</span>' +
'<span>' + t("devices.lastSeen") + ' ' + lastSeen + '</span>' +
'</div>' +
```

**AFTER:**
```javascript
var cpuTemp = health.cpuTemp || "--";
var memUsage = health.memoryUsage || "--";

'<div class="gw-meta">' +
'<span>' + (gw.deviceCount || 0) + ' ' + t("shared.devices") + '</span>' +
'<span>' + t("devices.wifi") + ' ' + rssi + '</span>' +
'<span>CPU ' + cpuTemp + '</span>' +
'<span>MEM ' + memUsage + '</span>' +
'<span>' + t("devices.uptime") + ' ' + uptime + '</span>' +
'<span>' + t("devices.lastSeen") + ' ' + lastSeen + '</span>' +
'</div>' +
```

### 3.3 Layer 3 — `_buildGatewayHealth(emsHealth)`

**File:** `frontend-v2/js/p2-devices.js` — NEW method

```javascript
_buildGatewayHealth: function (emsHealth) {
  var h = emsHealth || {};

  var indicators = [
    { icon: "\ud83d\udce1", label: "WiFi Signal",   value: h.wifiSignalStrength || "--" },
    { icon: "\ud83c\udf21",  label: "CPU Temp",      value: h.cpuTemp || "--" },
    { icon: "\ud83d\udcbb", label: "CPU Usage",     value: h.cpuUsage || "--" },
    { icon: "\ud83d\udcbe", label: "Memory",        value: h.memoryUsage || "--" },
    { icon: "\ud83d\udcbf", label: "Disk",          value: h.diskUsage || "--" },
    { icon: "\u23f1",       label: "Uptime",        value: h.systemRuntime || "--" },
    { icon: "\ud83c\udf21",  label: "EMS Temp",      value: h.emsTemp || "--" },
    { icon: "\ud83d\udcf6", label: "SIM Status",    value: h.simStatus || "--" },
  ];

  var body =
    '<div class="ems-health-grid">' +
    indicators.map(function (ind) {
      return (
        '<div class="ems-health-item">' +
        '<span class="ems-icon">' + ind.icon + '</span>' +
        '<span class="ems-value">' + ind.value + '</span>' +
        '<span class="ems-label">' + ind.label + '</span>' +
        '</div>'
      );
    }).join("") +
    '</div>';

  return Components.sectionCard("Gateway Health", body);
},
```

### 3.4 CSS Grid for EMS Health

**File:** `frontend-v2/css/pages.css` — ADD new section

```css
/* ---- Fix #4: EMS Health Grid ---- */
.ems-health-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-sm);
}

.ems-health-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-sm);
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-sm);
}

.ems-icon {
  font-size: 1.2rem;
  margin-bottom: 2px;
}

.ems-value {
  font-family: var(--font-data);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}

.ems-label {
  font-size: 0.65rem;
  color: var(--text-muted);
  margin-top: 1px;
}

/* Responsive: 2-col on narrow */
@media (max-width: 1023px) {
  .ems-health-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

---

## 4. i18n Keys Required

| Key | PT-BR | EN |
|-----|-------|-----|
| `devices.addSlot` | + Adicionar Slot | + Add Slot |
| `devices.deleteSlot` | Remover | Delete |
| `devices.invalidSchedule` | Horario invalido: verifique inicio/fim | Invalid schedule: check start/end hours |
| `devices.gatewayHealth` | Saude do Gateway | Gateway Health |

---

## 5. File Mutation Matrix

| # | File | Action | Summary | Est. Lines Changed |
|---|------|--------|---------|-------------------|
| 1 | `js/data-source.js` | MODIFY | Add `gatewayDetail()`, change `getSchedule/putSchedule` to gatewayId | ~20 |
| 2 | `js/p2-devices.js` | MODIFY | Add `_openLayer3GW`, `_buildLayer3GW`, `_buildScheduleCardEditable`, `_buildSlotRow`, `_renderScheduleRows`, `_renderTimelinePreview`, `_attachSlotListeners`, `_handleApplyGW`, `_buildGatewayHealth`, `_buildDeviceConfigGW`; modify `_setupLayer1Events`, `_attachDeviceRowListeners`, `_setupLayer3Events` | ~250 |
| 3 | `css/pages.css` | MODIFY | Add `.gw-detail-link`, `.device-chip`, schedule editor styles, `.ems-health-grid` | ~80 |
| 4 | `js/i18n.js` | MODIFY | Add 4 new keys (3 languages) | ~12 |
| | | | **Total** | **~362** |

---

## 6. Deprecation

The old `_openLayer3(assetId)` and `_buildLayer3()` remain in the file but are no longer called. They should be removed in v5.21 cleanup.

The old `DataSource.devices.deviceDetail(assetId)` remains available but is no longer called from P2. Remove in v5.21.
