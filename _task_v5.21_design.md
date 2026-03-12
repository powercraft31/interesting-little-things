# v5.21 Architecture Design Document

**Date:** 2026-03-12
**Status:** PENDING GEMINI REVIEW
**Prerequisite:** `design/v5.21_requirements.md`
**Protocol Reference:** `design/SolfacilProtocol_v1.5.md`

---

## Requirement 3: M3→M1 Command Dispatch Pipeline

### 3.1 Current Architecture (Broken)

```
BFF put-gateway-schedule.ts
  → INSERT device_command_logs (result='pending', payload_json={slots:[...]})
  → Returns 202

M3 command-dispatcher.ts (runPendingCommandDispatcher, 10s interval)
  → SELECT ... WHERE result='pending' FOR UPDATE SKIP LOCKED LIMIT 50
  → UPDATE result='dispatched'
  → publishMqtt(topic, message)  ← STUB: console.log only, no MQTT

mqtt-client.ts
  → export async function publishMqtt() { console.log(...) }  ← dead end
```

**Root cause:** M3 imports `mqtt-client.ts` which is a stub. Real MQTT lives in M1's `GatewayConnectionManager`.

### 3.2 Target Architecture

```
BFF → DB (pending) → M3 marks dispatched → DB → M1 CommandPublisher picks up
                                                      → builds protocol msg
                                                      → publishes via real MQTT
                                                      → gateway replies set_reply
                                                      → M1 command-tracker updates DB
```

**Principle:** M3 = business logic (when/what). M1 = infrastructure (MQTT lifecycle). DB = bridge.

### 3.3 M3 Changes — command-dispatcher.ts

**Remove import:**
```diff
- import { publishMqtt } from "../../iot-hub/mqtt-client";
```

**Simplify `runPendingCommandDispatcher()`:**
```typescript
export async function runPendingCommandDispatcher(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pendingResult = await client.query<{ id: number }>(`
      SELECT id
      FROM device_command_logs
      WHERE result = 'pending'
        AND command_type = 'set'
      ORDER BY created_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);

    if (pendingResult.rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    const ids = pendingResult.rows.map((r) => r.id);

    await client.query(
      `UPDATE device_command_logs SET result = 'dispatched' WHERE id = ANY($1)`,
      [ids],
    );

    await client.query("COMMIT");
    console.log(`[M3] Marked ${ids.length} commands as dispatched`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[M3] runPendingCommandDispatcher error:", err);
  } finally {
    client.release();
  }
}
```

**No other changes:** `runCommandDispatcher()` (Job 1, trade_schedules) and `runTimeoutCheck()` stay as-is.

### 3.4 M1 New Module — CommandPublisher

**File:** `backend/src/iot-hub/services/command-publisher.ts`

**Responsibilities:**
1. Poll `device_command_logs WHERE result = 'dispatched'` every 10s
2. For each command: check gateway online → build protocol message → publish → update message_id
3. If gateway offline → mark `failed` with `error_message = 'gateway_offline'`

**Interface with GatewayConnectionManager:**

New method needed on `GatewayConnectionManager`:
```typescript
/** Publish a message to a specific gateway's MQTT client. Returns false if gateway not connected. */
publishToGateway(gatewayId: string, topic: string, message: string): boolean {
  const gc = this.gatewayClients.get(gatewayId);
  if (!gc) return false;
  try {
    const client = gc.mqttClient as { publish: (t: string, m: string) => void; connected: boolean };
    if (!client.connected) return false;
    client.publish(topic, message);
    return true;
  } catch {
    return false;
  }
}
```

**CommandPublisher poll SQL:**
```sql
SELECT id, gateway_id, command_type, config_name, payload_json
FROM device_command_logs
WHERE result = 'dispatched'
  AND command_type = 'set'
ORDER BY created_at ASC
LIMIT 10
FOR UPDATE SKIP LOCKED
```

**Protocol message building:**
Uses existing `buildConfigSetPayload(gatewayId, domainSchedule, messageId)` from `schedule-translator.ts`.

**Critical detail — payload_json format gap:**
Current BFF stores `{ slots: [{ startHour, endHour, mode }] }` (frontend format).
`buildConfigSetPayload()` expects `DomainSchedule` (with `startMinute`, `endMinute`, `socMinLimit`, etc.).
CommandPublisher must handle this gap:
- **Phase 1 (Req 3 only):** CommandPublisher reads raw payload_json, converts `startHour→startMinute` (*60), maps `mode→purpose`, fills missing top-level fields with hardcoded defaults (`socMinLimit=10, socMaxLimit=100, maxChargeCurrent=100, maxDischargeCurrent=100, gridImportLimitKw=3000`).
- **Phase 2 (After Req 2):** BFF stores complete `DomainSchedule`. CommandPublisher reads it directly — no conversion needed.

**Message ID tracking:**
After successful MQTT publish, update the row:
```sql
UPDATE device_command_logs SET message_id = $1 WHERE id = $2
```
This enables `command-tracker.ts` to match the `set_reply`.

### 3.5 M1 command-tracker.ts Fix

**Change WHERE clause in `handleSetReply()`:**
```diff
- WHERE result = 'pending' AND command_type = 'set'
+ WHERE result = 'dispatched' AND command_type = 'set'
```

### 3.6 DB Index Consideration

Current partial index: `idx_cmd_logs_pending` on `result WHERE result = 'pending'`.
Need new partial index for M1 polling:
```sql
CREATE INDEX idx_cmd_logs_dispatched ON device_command_logs (result)
  WHERE result = 'dispatched';
```

### 3.7 Wire-up in run-m1-local.ts

```typescript
import { CommandPublisher } from "../src/iot-hub/services/command-publisher";

// After manager.start():
const publisher = new CommandPublisher(pool, manager);
publisher.start(); // starts 10s interval

// On SIGINT:
publisher.stop();
```

### 3.8 Delete mqtt-client.ts

After M3 no longer imports it, delete `backend/src/iot-hub/mqtt-client.ts`.
Verify: `grep -r "mqtt-client" backend/src/` must return 0 hits.

### 3.9 Module Dependency After Refactor

```
M3 (dr-dispatcher)
  └── depends on: pg only (no iot-hub imports)

M1 (iot-hub)
  ├── gateway-connection-manager.ts (MQTT lifecycle)
  ├── command-publisher.ts (polls DB, uses GCM to publish)
  ├── command-tracker.ts (processes set_reply)
  ├── fragment-assembler.ts (processes telemetry)
  ├── heartbeat-handler.ts (processes heartbeat)
  ├── device-list-handler.ts (processes deviceList)
  ├── publish-config.ts (publishConfigGet/Set/SubDevicesGet - used by hourly poll & BFF)
  └── schedule-translator.ts (domain ↔ protocol translation)
```

---

## Requirement 2: Config + Schedule Card Merge

### 2.1 Current State

**Frontend (p2-devices.js):**
- `_buildDeviceConfigGW()` (line 568): Renders SOC/current/grid inputs + "Apply Config" button. Calls `DataSource.devices.putDevice(assetId, config)`.
- `_buildScheduleCardEditable()` (line 673): Renders timeline + slot table + "Apply to Gateway" button. Calls `DataSource.devices.putSchedule(gatewayId, slots)`.
- `_pendingSlots` (line 446): Array of `{ startHour, endHour, mode }`.
- Two separate Apply buttons → two separate API calls → second overwrites first.

**BFF (put-gateway-schedule.ts):**
- Accepts `{ slots: [{ startHour, endHour, mode }] }`
- Validates hours 0-24, not minutes 0-1440
- Stores `{ slots }` in payload_json — missing SOC/current/gridImportLimit

### 2.2 Target State

**Single state tree `_pendingConfig`:**
```javascript
{
  socMinLimit: 10,          // int, 0-100
  socMaxLimit: 95,          // int, 0-100
  maxChargeCurrent: 100,    // int, ≥0, unit: A
  maxDischargeCurrent: 100, // int, ≥0, unit: A
  gridImportLimitKw: 3000,  // int, ≥0, unit: kW
  slots: [
    { startMinute: 0,    endMinute: 300,  purpose: "tariff", direction: "charge" },
    { startMinute: 300,  endMinute: 1020, purpose: "self_consumption" },
    { startMinute: 1020, endMinute: 1200, purpose: "peak_shaving" },
    { startMinute: 1200, endMinute: 1440, purpose: "tariff", direction: "discharge", exportPolicy: "forbid" }
  ]
}
```

### 2.3 Frontend Changes — p2-devices.js

**Replace** `_buildDeviceConfigGW()` + `_buildScheduleCardEditable()` with single `_buildBatteryScheduleCard(config, schedule)`:

Card layout (single card):
```
┌─ Battery Schedule Configuration ──────────────────────┐
│                                                        │
│  SOC Min (%)       [___10___]  SOC Max (%)  [___95___] │
│  Max Charge (A)    [__100___]  Max Discharge [__100__] │
│  Grid Import (kW)  [__3000__]                          │
│                                                        │
│  [══════ Timeline Bar (color-coded) ═══════════════]   │
│  START   │ END    │ MODE             │ DIR   │ EXPORT  │
│  00:00   │ 05:00  │ Tariff           │Charge │  —      │
│  05:00   │ 17:00  │ Self Consumption │  —    │  —      │
│  17:00   │ 20:00  │ Peak Shaving     │  —    │  —      │
│  20:00   │ 24:00  │ Tariff           │Disch. │ Forbid  │
│                                    [+ Add Slot]        │
│                                                        │
│  Status: ● Synced  Last: 2026-03-12             │
│                              [Apply to Gateway]        │
└────────────────────────────────────────────────────────┘
```

**Slot editing logic:**
- Time selectors: dropdown with 00:00, 01:00, ..., 24:00 (maps to 0, 60, ..., 1440 minutes)
- Mode selector: `self_consumption` | `peak_shaving` | `tariff`
- When `tariff` selected → show `direction` dropdown: `charge` | `discharge`
- When `tariff` + `discharge` → show `export_policy` dropdown: `allow` | `forbid`
- When NOT `tariff` → hide direction/exportPolicy fields

**Replace** `_pendingSlots` with `_pendingConfig` (full object).
**Replace** `_handleApplyGW()` with `_handleApplySchedule()`:
```javascript
_handleApplySchedule: async function () {
  var config = this._pendingConfig;
  // Client-side validation (same rules as schedule-translator.ts)
  // ...
  await DataSource.devices.putSchedule(gwId, config); // sends full object
}
```

**Populate _pendingConfig from API response:**
On Layer 3 open → `gatewayDetail()` returns `schedule.config` (full battery_schedule) → populate `_pendingConfig`.

### 2.4 BFF Changes — put-gateway-schedule.ts

**Accept full DomainSchedule:**
```typescript
interface RequestBody {
  socMinLimit: number;
  socMaxLimit: number;
  maxChargeCurrent: number;
  maxDischargeCurrent: number;
  gridImportLimitKw: number;
  slots: Array<{
    startMinute: number;
    endMinute: number;
    purpose: string;
    direction?: string;
    exportPolicy?: string;
  }>;
}
```

**Validate using schedule-translator.ts:**
```typescript
import { validateSchedule, DomainSchedule } from "../../iot-hub/handlers/schedule-translator";

// Map request body → DomainSchedule
const domainSchedule: DomainSchedule = {
  socMinLimit: body.socMinLimit,
  socMaxLimit: body.socMaxLimit,
  maxChargeCurrent: body.maxChargeCurrent,
  maxDischargeCurrent: body.maxDischargeCurrent,
  gridImportLimitKw: body.gridImportLimitKw,
  slots: body.slots.map(s => ({
    mode: mapPurposeToMode(s.purpose, s.direction), // tariff+charge→peak_valley_arbitrage
    action: s.direction,
    allowExport: s.exportPolicy === "allow",
    startMinute: s.startMinute,
    endMinute: s.endMinute,
  })),
};

validateSchedule(domainSchedule); // throws on invalid

// Store complete DomainSchedule as payload_json
await queryWithOrg(
  `INSERT INTO device_command_logs (gateway_id, command_type, config_name, payload_json, result)
   VALUES ($1, 'set', 'battery_schedule', $2, 'pending')
   RETURNING id`,
  [gatewayId, JSON.stringify(domainSchedule)],
  rlsOrgId,
);
```

**Helper — mapPurposeToMode():**
```typescript
function mapPurposeToMode(purpose: string, direction?: string): DomainSlot["mode"] {
  if (purpose === "self_consumption") return "self_consumption";
  if (purpose === "peak_shaving") return "peak_shaving";
  if (purpose === "tariff") return "peak_valley_arbitrage";
  throw new Error(`Unknown purpose: ${purpose}`);
}
```

### 2.5 BFF Changes — get-gateway-schedule.ts

Return full config from latest `get_reply`:
```sql
SELECT payload_json
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'get_reply'
  AND config_name = 'battery_schedule'
ORDER BY created_at DESC
LIMIT 1
```

Parse `payload_json` (protocol format) → translate to domain format using `parseGetReply()` from schedule-translator.ts → return to frontend.

### 2.6 data-source.js Changes

```javascript
putSchedule: function (gatewayId, config) {
  if (!USE_LIVE_API) {
    return Promise.resolve({ commandId: 99, status: "pending", message: "Mock" });
  }
  // Now sends full config object, not just slots
  return apiPut("/api/gateways/" + gatewayId + "/schedule", config);
},
```

### 2.7 i18n Additions — i18n.js

New keys (×3 languages: pt-BR, en, zh-CN):
- `devices.schedule.title`
- `devices.schedule.socMin`, `devices.schedule.socMax`
- `devices.schedule.maxCharge`, `devices.schedule.maxDischarge`
- `devices.schedule.gridImportLimit`
- `devices.schedule.tariff`, `devices.schedule.direction`
- `devices.schedule.charge`, `devices.schedule.discharge`
- `devices.schedule.exportPolicy`, `devices.schedule.allow`, `devices.schedule.forbid`

---

## Requirement 1: SSE Real-time Push

### 1.1 Architecture

```
M1 FragmentAssembler
  → writeTelemetry() succeeds
  → pool.query("SELECT pg_notify('telemetry_update', $1)", [clientId])

M1 HeartbeatHandler (or writeEmsHealth)
  → pool.query("SELECT pg_notify('gateway_health', $1)", [clientId])

BFF SSE Endpoint (GET /api/events)
  → Dedicated PostgreSQL connection (NOT from main pool)
  → LISTEN telemetry_update
  → LISTEN gateway_health
  → On notification → write SSE event to connected clients
  → Keepalive ping every 30s

Frontend (p2-devices.js)
  → new EventSource(BFF_BASE + '/api/events')
  → on message → re-fetch current view data
```

### 1.2 Connection Pool Isolation Strategy

**Problem:** PostgreSQL `LISTEN` requires a dedicated, long-lived connection. Using a connection from the pool would starve it.

**Solution:** BFF SSE handler creates ONE standalone `pg.Client` (not from pool) specifically for LISTEN. All connected SSE clients share this single LISTEN connection. When the last SSE client disconnects, the LISTEN connection is released.

```typescript
// Singleton LISTEN connection
let listenClient: pg.Client | null = null;
let sseClients: Set<http.ServerResponse> = new Set();

async function getListenClient(): Promise<pg.Client> {
  if (listenClient) return listenClient;
  listenClient = new pg.Client({
    host: "localhost", port: 5432,
    database: "solfacil_vpp",
    user: "solfacil_app",
    password: "solfacil_vpp_2026",
  });
  await listenClient.connect();
  await listenClient.query("LISTEN telemetry_update");
  await listenClient.query("LISTEN gateway_health");
  listenClient.on("notification", (msg) => {
    const event = JSON.stringify({ type: msg.channel, gatewayId: msg.payload });
    for (const res of sseClients) {
      res.write(`data: ${event}\n\n`);
    }
  });
  return listenClient;
}
```

### 1.3 SSE Endpoint — sse-events.ts

```typescript
export async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // nginx: disable buffering
  });

  await getListenClient();
  sseClients.add(res);

  // Keepalive every 30s
  const keepalive = setInterval(() => res.write(":keepalive\n\n"), 30_000);

  req.on("close", () => {
    sseClients.delete(res);
    clearInterval(keepalive);
    // If no more clients, close LISTEN connection
    if (sseClients.size === 0 && listenClient) {
      listenClient.end();
      listenClient = null;
    }
  });
}
```

### 1.4 Frontend EventSource — p2-devices.js

```javascript
// In init():
var self = this;
self._eventSource = null;

// When entering P2:
if (!self._eventSource) {
  self._eventSource = new EventSource(CONFIG.BFF_BASE + "/api/events");
  self._eventSource.onmessage = function (e) {
    var data = JSON.parse(e.data);
    if (self._currentLayer === 3 && data.gatewayId === self._currentGatewayId) {
      // Re-fetch gateway detail and update UI
      self._refreshLayer3();
    } else if (self._currentLayer === 1) {
      // Re-fetch gateway list
      self._refreshLayer1();
    }
  };
  self._eventSource.onerror = function () {
    // EventSource auto-reconnects; just log
    console.warn("[P2] SSE connection error, will auto-reconnect");
  };
}
```

### 1.5 File Server Proxy — main.py

Add SSE-aware proxy rule for `/api/events`:
- Disable response buffering
- Stream chunks directly
- Set `X-Accel-Buffering: no`

### 1.6 pg_notify Integration Points

**FragmentAssembler.writeTelemetry()** — after `updateDeviceState()`:
```typescript
await this.pool.query("SELECT pg_notify('telemetry_update', $1)", [clientId]);
```

**FragmentAssembler.writeEmsHealth()** — after UPDATE gateways:
```typescript
await this.pool.query("SELECT pg_notify('gateway_health', $1)", [clientId]);
```

**HeartbeatHandler.handleHeartbeat()** — after UPDATE gateways:
```typescript
await pool.query("SELECT pg_notify('gateway_health', $1)", [gatewayId]);
```

---

## Cross-Requirement Interactions

1. **Req 3 + Req 2:** After Req 2 lands, CommandPublisher's Phase 1 conversion logic (startHour→startMinute) can be removed. payload_json will already be DomainSchedule format.

2. **Req 1 + Req 3:** After a config/set_reply arrives and command-tracker updates the DB, we could pg_notify('command_update', gatewayId) so the frontend shows the result in real-time. This is optional enhancement.

3. **Req 2 alone:** `_buildDeviceConfigGW()` currently handles the "Apply Config" for individual device settings (putDevice). This is separate from battery_schedule. After merge, putDevice is still needed for inverter-specific config (if any). But the SOC/current/grid fields move into the schedule card.
