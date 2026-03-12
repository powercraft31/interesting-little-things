# v5.21 Implementation Plan — Step-by-Step Checkpoints

**Date:** 2026-03-12
**Execution Order:** Phase 1 (Req 3) → Phase 2 (Req 2) → Phase 3 (Req 1)
**Design Reference:** `_task_v5.21_design.md`

---

## Phase 1: M3→M1 Command Dispatch Pipeline (Requirement 3)

### Step 1.1 — Simplify M3 `command-dispatcher.ts`

**File:** `backend/src/dr-dispatcher/services/command-dispatcher.ts`

**Changes:**
1. Remove line 4: `import { publishMqtt } from "../../iot-hub/mqtt-client";`
2. In `runPendingCommandDispatcher()` (lines 122-177):
   - Keep the SELECT query (lines 127-139) and the UPDATE (lines 148-153)
   - DELETE the entire `for (const cmd of pendingResult.rows)` loop (lines 155-164) — this is the message-building + publishMqtt code
   - Keep the COMMIT (line 166) and console.log (lines 168-170)

**Verification:**
- `grep -r "mqtt-client" backend/src/dr-dispatcher/` → zero hits
- `grep -r "publishMqtt" backend/src/dr-dispatcher/` → zero hits
- `npx tsx --eval "import './backend/src/dr-dispatcher/services/command-dispatcher'"` → no import errors

### Step 1.2 — Delete `mqtt-client.ts` Stub

**File:** `backend/src/iot-hub/mqtt-client.ts`

**Action:** Delete the entire file.

**Verification:**
- `grep -r "mqtt-client" backend/src/` → zero hits (all imports removed in Step 1.1)
- File no longer exists: `ls backend/src/iot-hub/mqtt-client.ts` → not found

### Step 1.3 — Add `publishToGateway()` and `isGatewayConnected()` to GatewayConnectionManager

**File:** `backend/src/iot-hub/services/gateway-connection-manager.ts`

**Changes:** Add two public methods after `hasGateway()` (line 311):

```typescript
/** Publish a message to a specific gateway's MQTT broker. Returns true if sent. */
publishToGateway(gatewayId: string, topic: string, message: string): boolean {
  const gc = this.gatewayClients.get(gatewayId);
  if (!gc) return false;
  const client = gc.mqttClient as { connected?: boolean; publish: (t: string, m: string) => void };
  if (!client.connected) return false;
  client.publish(topic, message);
  return true;
}

/** Check if a specific gateway has an active MQTT connection. */
isGatewayConnected(gatewayId: string): boolean {
  const gc = this.gatewayClients.get(gatewayId);
  if (!gc) return false;
  const client = gc.mqttClient as { connected?: boolean };
  return client.connected === true;
}
```

**Verification:**
- TypeScript compiles without errors
- Methods are accessible: `manager.isGatewayConnected('test')` returns boolean
- Consistent with existing cast pattern at lines 100, 287-289

### Step 1.4 — Create CommandPublisher Service

**File:** New `backend/src/iot-hub/services/command-publisher.ts`

**Contents (~80 lines):**

```typescript
import { Pool } from 'pg';
import { GatewayConnectionManager } from './gateway-connection-manager';
import { validateSchedule, buildConfigSetPayload } from '../handlers/schedule-translator';
import type { DomainSchedule } from '../handlers/schedule-translator';

export class CommandPublisher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly connectionManager: GatewayConnectionManager,
  ) {}

  start(): void {
    console.log('[CommandPublisher] Starting (10s poll interval)');
    this.timer = setInterval(() => this.poll(), 10_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[CommandPublisher] Stopped');
  }

  private async poll(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{
        id: number;
        gateway_id: string;
        command_type: string;
        config_name: string;
        payload_json: Record<string, unknown> | null;
      }>(`
        SELECT id, gateway_id, command_type, config_name, payload_json
        FROM device_command_logs
        WHERE result = 'dispatched'
          AND command_type = 'set'
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      `);

      for (const cmd of rows) {
        await this.processCommand(client, cmd);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[CommandPublisher] Poll error:', err);
    } finally {
      client.release();
    }
  }

  private async processCommand(
    client: import('pg').PoolClient,
    cmd: { id: number; gateway_id: string; config_name: string; payload_json: Record<string, unknown> | null },
  ): Promise<void> {
    // 1. Gateway offline check
    if (!this.connectionManager.isGatewayConnected(cmd.gateway_id)) {
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = 'gateway_offline', resolved_at = NOW() WHERE id = $1`,
        [cmd.id],
      );
      console.warn(`[CommandPublisher] Gateway ${cmd.gateway_id} offline, command ${cmd.id} failed`);
      return;
    }

    // 2. Parse and validate schedule
    if (!cmd.payload_json) {
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = 'empty_payload', resolved_at = NOW() WHERE id = $1`,
        [cmd.id],
      );
      return;
    }

    const schedule = cmd.payload_json as unknown as DomainSchedule;

    try {
      validateSchedule(schedule);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'validation_error';
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = $1, resolved_at = NOW() WHERE id = $2`,
        [`validation: ${msg}`, cmd.id],
      );
      console.error(`[CommandPublisher] Validation failed for command ${cmd.id}: ${msg}`);
      return;
    }

    // 3. Build protocol message
    const messageId = String(Date.now());
    const protocolMessage = buildConfigSetPayload(cmd.gateway_id, schedule, messageId);

    // 4. Publish via MQTT
    const topic = `platform/ems/${cmd.gateway_id}/config/set`;
    const published = this.connectionManager.publishToGateway(
      cmd.gateway_id, topic, JSON.stringify(protocolMessage),
    );

    if (!published) {
      await client.query(
        `UPDATE device_command_logs SET result = 'failed', error_message = 'publish_failed', resolved_at = NOW() WHERE id = $1`,
        [cmd.id],
      );
      console.warn(`[CommandPublisher] Publish failed for command ${cmd.id} (gateway disconnected during publish)`);
      return;
    }

    // 5. Update message_id for audit trail
    await client.query(
      `UPDATE device_command_logs SET message_id = $1 WHERE id = $2`,
      [messageId, cmd.id],
    );

    console.log(`[CommandPublisher] Published command ${cmd.id} to ${cmd.gateway_id}, messageId=${messageId}`);
  }
}
```

**Verification:**
- TypeScript compiles without errors
- No circular dependencies (command-publisher → schedule-translator is OK, same iot-hub module)
- `grep -r "command-publisher" backend/src/dr-dispatcher/` → zero hits (M3 doesn't know about it)

### Step 1.5 — Fix command-tracker.ts WHERE Clause

**File:** `backend/src/iot-hub/handlers/command-tracker.ts`

**Change line 99:**
```
- AND result = 'pending'
+ AND result = 'dispatched'
```

**Verification:**
- `grep "result = 'dispatched'" backend/src/iot-hub/handlers/command-tracker.ts` → matches line 99
- `grep "result = 'pending'" backend/src/iot-hub/handlers/command-tracker.ts` → zero hits

### Step 1.6 — Wire CommandPublisher into `run-m1-local.ts`

**File:** `backend/scripts/run-m1-local.ts`

**Changes:**
1. Add import (after line 10):
   ```typescript
   import { CommandPublisher } from '../src/iot-hub/services/command-publisher';
   ```

2. After `await manager.start()` (after line 54), add:
   ```typescript
   const publisher = new CommandPublisher(pool, manager);
   publisher.start();
   console.log('[M1 Local] CommandPublisher started (10s poll)');
   ```

3. In SIGINT handler (line 65), add before `manager.stop()`:
   ```typescript
   publisher.stop();
   ```

**Verification:**
- `npx tsx backend/scripts/run-m1-local.ts` starts without errors
- Console shows: `[CommandPublisher] Starting (10s poll interval)`
- With a gateway connected + a 'dispatched' row in DB, the command gets published

### Step 1.7 — DB Index for Dispatched Commands

**SQL Migration:**
```sql
CREATE INDEX CONCURRENTLY idx_dcl_dispatched_set
ON device_command_logs (created_at ASC)
WHERE result = 'dispatched' AND command_type = 'set';
```

**Verification:**
- `\di idx_dcl_dispatched_set` in psql shows the index
- `EXPLAIN` on CommandPublisher's SELECT shows Index Scan

### Step 1.8 — Phase 1 Integration Test

**Manual test procedure:**
1. Start M1: `npx tsx backend/scripts/run-m1-local.ts`
2. Start BFF: `npx tsx backend/scripts/local-server.ts`
3. Ensure a gateway is connected (check M1 logs for "Connected")
4. Insert a test pending command:
   ```sql
   INSERT INTO device_command_logs (gateway_id, command_type, config_name, payload_json, result)
   VALUES ('WKRD24070202100141I', 'set', 'battery_schedule',
     '{"socMinLimit":10,"socMaxLimit":95,"maxChargeCurrent":100,"maxDischargeCurrent":100,"gridImportLimitKw":3000,"slots":[{"mode":"self_consumption","startMinute":0,"endMinute":1440}]}',
     'pending');
   ```
5. Wait ~10s for M3 to pick up pending → dispatched
6. Wait ~10s for M1 CommandPublisher to pick up dispatched → publish
7. Check logs: `[CommandPublisher] Published command X to WKRD...`
8. Check gateway response: `[CommandTracker] set_reply SUCCESS for WKRD...`
9. Verify in DB: `SELECT result FROM device_command_logs WHERE id = X` → `success`

---

## Phase 2: Config + Schedule Card Merge (Requirement 2)

### Step 2.1 — Update `get-gateway-schedule.ts` to Return Full Battery Schedule

**File:** `backend/src/bff/handlers/get-gateway-schedule.ts`

**Changes:**
1. Add import: `import { parseGetReply, type ProtocolSchedule } from '../../iot-hub/handlers/schedule-translator';`
2. Replace the current query (lines 47-57) with two queries:
   - **Query 1:** Latest `get_reply` for ground truth battery_schedule
   - **Query 2:** Latest `set` for sync status
3. Use `parseGetReply()` to convert protocol format → domain format
4. Map domain slots to response format (purpose-based naming)
5. Return full `{ batterySchedule: {...}, syncStatus, lastAckAt }`

**New response shape:**
```json
{
  "success": true,
  "data": {
    "batterySchedule": {
      "socMinLimit": 10,
      "socMaxLimit": 95,
      "maxChargeCurrent": 100,
      "maxDischargeCurrent": 100,
      "gridImportLimitKw": 3000,
      "slots": [
        { "startMinute": 0, "endMinute": 300, "purpose": "tariff", "direction": "charge" },
        { "startMinute": 300, "endMinute": 1020, "purpose": "self_consumption" }
      ]
    },
    "syncStatus": "synced",
    "lastAckAt": "2026-03-12T09:30:00.000Z"
  }
}
```

**Verification:**
- `curl http://localhost:3000/api/gateways/WKRD24070202100141I/schedule` returns full batterySchedule
- Response includes socMinLimit, socMaxLimit, etc. from latest get_reply
- syncStatus correctly reflects latest set command state

### Step 2.2 — Rewrite `put-gateway-schedule.ts` to Accept Full DomainSchedule

**File:** `backend/src/bff/handlers/put-gateway-schedule.ts`

**Changes:**
1. Add import: `import { validateSchedule } from '../../iot-hub/handlers/schedule-translator';`
2. Remove old `ScheduleSlot` interface (line 14-18) and `VALID_MODES` (line 20)
3. New request body interface:
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
4. Map request body to DomainSchedule format (purpose → mode mapping)
5. Replace manual validation (lines 58-91) with `validateSchedule()` call wrapped in try/catch
6. Store full DomainSchedule as payload_json:
   ```typescript
   JSON.stringify(schedule)  // not JSON.stringify({ slots })
   ```

**Verification:**
- `curl -X PUT -d '{"socMinLimit":10,"socMaxLimit":95,"maxChargeCurrent":100,...}' http://localhost:3000/api/gateways/WKRD.../schedule` → 202
- Invalid schedule returns 400 with validation error message
- DB row has full DomainSchedule in payload_json (not just slots)
- Phase 1 pipeline still works: pending → dispatched → published → success

### Step 2.3 — Update `schedule-translator.ts` Slot Mode Names

**File:** `backend/src/iot-hub/handlers/schedule-translator.ts`

**Current DomainSlot.mode:** `"self_consumption" | "peak_valley_arbitrage" | "peak_shaving"`

The frontend will send `purpose` values: `"self_consumption"`, `"peak_shaving"`, `"tariff"`.

The BFF PUT handler (Step 2.2) maps `"tariff" → "peak_valley_arbitrage"` before calling `validateSchedule()`.

**No changes needed** to schedule-translator.ts itself — the mapping happens at the BFF boundary.

**Verification:**
- Existing `validateSchedule()` tests still pass
- `buildConfigSetPayload()` correctly translates `peak_valley_arbitrage` → `tariff` in protocol output

### Step 2.4 — Frontend: Update DataSource `putSchedule()` and `getSchedule()`

**File:** `frontend-v2/js/data-source.js`

**`putSchedule()`** (lines 237-248):
```javascript
// Before:
putSchedule: function(gatewayId, slots) {
  return apiPut('/api/gateways/' + gatewayId + '/schedule', { slots: slots });
}
// After:
putSchedule: function(gatewayId, config) {
  return apiPut('/api/gateways/' + gatewayId + '/schedule', config);
}
```

**`getSchedule()`** (lines 225-236): No change needed — already returns the full API response.

**Verification:**
- `DataSource.devices.getSchedule('WKRD...')` returns `{ batterySchedule: {...}, syncStatus, lastAckAt }`
- `DataSource.devices.putSchedule('WKRD...', fullConfig)` sends full DomainSchedule to API

### Step 2.5 — Frontend: Merge Config + Schedule into `_buildBatteryScheduleCard()`

**File:** `frontend-v2/js/p2-devices.js`

**Changes:**
1. Remove `_buildDeviceConfigGW()` function (lines 568-667)
2. Remove `_buildScheduleCardEditable()` function (lines 673-724)
3. Remove `_handleConfigApply()` function (lines 967-1004)
4. Remove `_handleApplyGW()` function (lines 921-965)

5. Add new `_pendingConfig` state (replaces `_pendingSlots`):
   ```javascript
   _pendingConfig: null,
   ```

6. Add `_buildBatteryScheduleCard(devices, schedule)`:
   - **Parameters section:** 5 input fields (socMinLimit, socMaxLimit, maxChargeCurrent, maxDischargeCurrent, gridImportLimitKw) with numeric inputs
   - **Schedule section:** Timeline bar + slot table with:
     - Start time selector: 00:00→23:00 (values 0..1380, step 60, display as HH:MM)
     - End time selector: 01:00→24:00 (values 60..1440, step 60, display as HH:MM)
     - Purpose selector: self_consumption, peak_shaving, tariff
     - Direction selector: charge/discharge (only visible when purpose=tariff)
     - Export policy selector: allow/forbid (only visible when purpose=tariff AND direction=discharge)
     - Delete button per slot
     - "+ Add Slot" button
   - **Sync status bar** (same as current)
   - **Single "Apply to Gateway" button**

7. Update `_buildSlotRow()` to use minute-based times and include direction/export_policy columns

8. Add `_handleApplySchedule()`:
   ```javascript
   _handleApplySchedule: async function() {
     var gwId = self._currentGatewayId;
     if (!gwId || !self._pendingConfig) return;
     // Client-side validation
     var cfg = self._pendingConfig;
     if (cfg.socMinLimit >= cfg.socMaxLimit) { self._showToast('SOC Min must be < SOC Max', 'warning'); return; }
     if (!cfg.slots || cfg.slots.length === 0) { self._showToast('At least one slot required', 'warning'); return; }
     // Submit full config
     await DataSource.devices.putSchedule(gwId, self._pendingConfig);
   }
   ```

9. Update the call site (line 558-559):
   ```javascript
   // Before:
   this._buildDeviceConfigGW(devices, config) +
   this._buildScheduleCardEditable(schedule) +
   // After:
   this._buildBatteryScheduleCard(devices, schedule) +
   ```

10. Initialize `_pendingConfig` from schedule API response:
    ```javascript
    var schedData = await DataSource.devices.getSchedule(gwId);
    self._pendingConfig = {
      socMinLimit: schedData.batterySchedule?.socMinLimit ?? 10,
      socMaxLimit: schedData.batterySchedule?.socMaxLimit ?? 95,
      maxChargeCurrent: schedData.batterySchedule?.maxChargeCurrent ?? 100,
      maxDischargeCurrent: schedData.batterySchedule?.maxDischargeCurrent ?? 100,
      gridImportLimitKw: schedData.batterySchedule?.gridImportLimitKw ?? 3000,
      slots: (schedData.batterySchedule?.slots || []).map(function(s) {
        return {
          startMinute: s.startMinute, endMinute: s.endMinute,
          purpose: s.purpose, direction: s.direction || null,
          exportPolicy: s.exportPolicy || null
        };
      })
    };
    ```

11. Update `_renderTimelinePreview()` and `_attachSlotListeners()` for minute-based slots

**Verification:**
- Single card renders with both Parameters and Schedule sections
- Editing SOC Min and changing a slot mode, then clicking "Apply to Gateway" sends ONE PUT request with complete config
- Timeline bar renders correctly with tariff slots showing different colors for charge/discharge
- Direction/exportPolicy dropdowns only appear when purpose=tariff
- Adding/removing slots works correctly
- Slot time selectors show hours (00:00–24:00) but store minutes (0–1440)

### Step 2.6 — Frontend: Add i18n Keys

**File:** `frontend-v2/js/i18n.js`

Add to all 3 language blocks (en, pt-BR, zh-CN):

**English block** (add after existing `devices.*` keys):
```javascript
"devices.schedule.title": "Battery Schedule Configuration",
"devices.schedule.socMin": "SOC Min (%)",
"devices.schedule.socMax": "SOC Max (%)",
"devices.schedule.maxCharge": "Max Charge Current (A)",
"devices.schedule.maxDischarge": "Max Discharge Current (A)",
"devices.schedule.gridImportLimit": "Grid Import Limit (kW)",
"devices.schedule.tariff": "Tariff",
"devices.schedule.direction": "Direction",
"devices.schedule.charge": "Charge",
"devices.schedule.discharge": "Discharge",
"devices.schedule.exportPolicy": "Export Policy",
"devices.schedule.allow": "Allow",
"devices.schedule.forbid": "Forbid",
```

**PT-BR and ZH-CN** blocks: add corresponding translations per design doc table.

**Verification:**
- `I18n.t('devices.schedule.title')` returns correct string in each language
- Switch language → card title updates
- No missing translation warnings in console

### Step 2.7 — Frontend: Update CSS for Merged Card

**File:** `frontend-v2/css/pages.css`

Add styles for:
- `.battery-schedule-card` — wrapper for the merged card
- `.config-params-section` — the parameters area (SOC, current, grid limit)
- `.schedule-section` — the schedule area (timeline + table)
- `.slot-sub-fields` — direction/exportPolicy dropdowns (hidden by default, shown when tariff)
- `.tariff-charge .schedule-segment` — blue color for tariff+charge
- `.tariff-discharge .schedule-segment` — orange color for tariff+discharge

**Verification:**
- Card renders cleanly at desktop width (>960px)
- Card stacks vertically at mobile width (<768px)
- Direction/export sub-fields animate in/out smoothly

### Step 2.8 — Phase 2 End-to-End Test

**Manual test procedure:**
1. Start M1 + BFF
2. Ensure gateway has a recent get_reply in device_command_logs
3. Navigate to P2 → click a gateway → open Layer 3
4. Verify merged card shows current config (SOC limits + slots from get_reply)
5. Change SOC Min to 15, change first slot to tariff/charge
6. Click "Apply to Gateway"
7. Verify single PUT request in browser network tab
8. Verify DB: new row in device_command_logs with result='pending', payload_json contains full DomainSchedule
9. Wait for M3 + M1 pipeline: pending → dispatched → published → success
10. Verify set_reply arrives and resolves command

---

## Phase 3: SSE Real-time Push (Requirement 1)

### Step 3.1 — Add `pg_notify` to FragmentAssembler

**File:** `backend/src/iot-hub/services/fragment-assembler.ts`

**Changes:**
1. After `updateDeviceState()` call (line 323), add:
   ```typescript
   await this.pool.query("SELECT pg_notify('telemetry_update', $1)", [clientId]);
   ```

2. After `writeEmsHealth()` call succeeds (after line 212, at end of method):
   ```typescript
   await this.pool.query("SELECT pg_notify('gateway_health', $1)", [clientId]);
   ```

**Verification:**
- With M1 running, open psql and run `LISTEN telemetry_update;` — notifications arrive every ~10s per gateway
- `LISTEN gateway_health;` — notifications arrive with EMS health updates

### Step 3.2 — Add `pg_notify` to HeartbeatHandler

**File:** `backend/src/iot-hub/handlers/heartbeat-handler.ts`

After the `UPDATE gateways` query (after line 32), add:
```typescript
await pool.query("SELECT pg_notify('gateway_health', $1)", [gatewayId]);
```

**Verification:**
- `LISTEN gateway_health;` in psql — heartbeat notifications arrive every ~30s per gateway

### Step 3.3 — Create BFF SSE Endpoint

**File:** New `backend/src/bff/handlers/sse-events.ts`

Create the `createSseHandler()` function as specified in the design doc §1.3.

Key implementation points:
- Use `pg.Client` (NOT from pool) for LISTEN connection
- Set response headers for SSE (Content-Type, Cache-Control, Connection, X-Accel-Buffering)
- `LISTEN telemetry_update` and `LISTEN gateway_health`
- On notification: `res.write('data: ${JSON.stringify(...)}\n\n')`
- Keepalive: `:keepalive\n\n` every 30s
- On `req.close`: UNLISTEN, end client, clear interval

**Verification:**
- `curl -N http://localhost:3000/api/events` → receives SSE events
- Events arrive as `data: {"type":"telemetry_update","gatewayId":"WKRD..."}\n\n`
- Keepalive `:keepalive` appears every 30s
- Ctrl+C → connection cleanly closed, no leaked DB connections

### Step 3.4 — Register SSE Route in `local-server.ts`

**File:** `backend/scripts/local-server.ts`

**Changes:**
1. Add import (after line 49):
   ```typescript
   import { createSseHandler } from '../src/bff/handlers/sse-events';
   ```

2. Add route BEFORE the `wrapHandler` routes (SSE uses raw express, not Lambda emulation). Add after the CORS middleware (after line 157):
   ```typescript
   // SSE endpoint — raw express handler, not Lambda wrapper
   app.get('/api/events', createSseHandler(servicePool));
   ```

3. Add to route listing console.log section:
   ```typescript
   console.log("  GET  /api/events (SSE)              (v5.21)");
   ```

**Verification:**
- BFF starts without errors
- `curl -N http://localhost:3000/api/events` works
- SSE events flow when M1 is processing telemetry

### Step 3.5 — Frontend: Add EventSource

**File:** `frontend-v2/js/p2-devices.js`

**Changes:**
1. Add `_sseSource: null` and `_sseDebounceTimer: null` to DevicesPage state
2. Add `_connectSSE()` method — creates EventSource to `/api/events`
3. Add `_handleSSEEvent(data)` — with 2s debounce:
   - If viewing Layer 1 (gateway list) → re-fetch gateway list
   - If viewing Layer 3 and gatewayId matches → re-fetch detail data
4. Add `_cleanupSSE()` method — closes EventSource
5. Call `_connectSSE()` at end of `init()`
6. Call `_cleanupSSE()` when navigating away from P2

**Verification:**
- Open P2 in browser → SSE connection established (check Network tab, EventSource type)
- View Layer 3 for a gateway → telemetry auto-refreshes (battery SOC changes visible without manual refresh)
- Navigate away from P2 → SSE connection closed
- Kill BFF → SSE reconnects automatically when BFF restarts

### Step 3.6 — File Server Proxy (Optional)

**File:** `/tmp/ashe_file_server/main.py`

Add streaming proxy for `/api/events` to BFF.

**Verification:**
- Access via file server port → SSE events flow through proxy
- No buffering (events arrive in real-time, not batched)

### Step 3.7 — Phase 3 End-to-End Test

**Manual test procedure:**
1. Start M1 + BFF
2. Open browser to P2 → verify SSE connection in Network tab
3. View Layer 1 (gateway list):
   - Wait for telemetry cycle (~10s)
   - Gateway status should update without refresh
4. Click into Layer 3 (gateway detail):
   - Battery SOC, power values should update live
   - EMS health should update live
5. Open a second browser tab on P2:
   - Both tabs receive SSE events
   - Changes visible in both tabs simultaneously
6. Kill BFF → verify EventSource auto-reconnects
7. Restart BFF → SSE resumes, events flow again
8. Navigate to P1 (Fleet) → SSE connection closes
9. Navigate back to P2 → SSE connection re-established

---

## Summary Checklist

| Step | Phase | File(s) | Status |
|------|-------|---------|--------|
| 1.1 | P1 | command-dispatcher.ts | ☐ |
| 1.2 | P1 | mqtt-client.ts (DELETE) | ☐ |
| 1.3 | P1 | gateway-connection-manager.ts | ☐ |
| 1.4 | P1 | command-publisher.ts (NEW) | ☐ |
| 1.5 | P1 | command-tracker.ts | ☐ |
| 1.6 | P1 | run-m1-local.ts | ☐ |
| 1.7 | P1 | SQL migration | ☐ |
| 1.8 | P1 | Integration test | ☐ |
| 2.1 | P2 | get-gateway-schedule.ts | ☐ |
| 2.2 | P2 | put-gateway-schedule.ts | ☐ |
| 2.3 | P2 | schedule-translator.ts (verify) | ☐ |
| 2.4 | P2 | data-source.js | ☐ |
| 2.5 | P2 | p2-devices.js | ☐ |
| 2.6 | P2 | i18n.js | ☐ |
| 2.7 | P2 | pages.css | ☐ |
| 2.8 | P2 | End-to-end test | ☐ |
| 3.1 | P3 | fragment-assembler.ts | ☐ |
| 3.2 | P3 | heartbeat-handler.ts | ☐ |
| 3.3 | P3 | sse-events.ts (NEW) | ☐ |
| 3.4 | P3 | local-server.ts | ☐ |
| 3.5 | P3 | p2-devices.js | ☐ |
| 3.6 | P3 | main.py (optional) | ☐ |
| 3.7 | P3 | End-to-end test | ☐ |
