# v5.21 Architecture Design — SSE Push + Config Card Merge + M3→M1 Command Pipeline

**Date:** 2026-03-12
**Author:** Claude Code (from Alan's architecture decisions + Ashe's requirements)
**Protocol Reference:** SolfacilProtocol_v1.5.md §3.6–§3.9

---

## Table of Contents

1. [Requirement 3: M3→M1 Command Dispatch Pipeline](#requirement-3-m3m1-command-dispatch-pipeline)
2. [Requirement 2: Config + Schedule Card Merge](#requirement-2-config--schedule-card-merge)
3. [Requirement 1: SSE Real-time Push](#requirement-1-sse-real-time-push)
4. [Cross-cutting Concerns](#cross-cutting-concerns)

---

## Requirement 3: M3→M1 Command Dispatch Pipeline

### Problem Statement

Config/set commands written by BFF never reach the gateway. The broken chain:

```
BFF writes device_command_logs (result='pending')
  → M3 polls pending → marks 'dispatched' → calls publishMqtt() ← THIS IS A STUB
  → Real MQTT lives in M1's GatewayConnectionManager, which M3 cannot access
```

Current `mqtt-client.ts` (line 7): `console.log('[MQTT STUB] → ...')` — does nothing.

### Architecture Decision

**M3 = business logic** (decide what/when). **M1 = infrastructure** (MQTT publish + subscribe + reply tracking). **DB = bridge** between M3 and M1. M3 must NOT have any MQTT dependency.

### Detailed Design

#### 3.1 M3 Simplification: `command-dispatcher.ts`

**Current state** (`command-dispatcher.ts:122-177`):
- `runPendingCommandDispatcher()` polls `device_command_logs WHERE result = 'pending'`
- Marks rows `dispatched`
- Builds protocol message (`commandLogId`, `commandType`, `payload`, `timestamp`) — **wrong format**
- Calls `publishMqtt(topic, message)` — **stub, does nothing**

**Target state:**
- Remove `import { publishMqtt } from "../../iot-hub/mqtt-client"` (line 4)
- `runPendingCommandDispatcher()` becomes trivial:
  1. `SELECT ... FROM device_command_logs WHERE result = 'pending' FOR UPDATE SKIP LOCKED LIMIT 50`
  2. `UPDATE ... SET result = 'dispatched' WHERE id = ANY($1)`
  3. That's it. No message building, no MQTT publishing.
- Remove the `for (const cmd of pendingResult.rows)` loop (lines 155-164) entirely
- Keep `runTimeoutCheck()` as-is (lines 179-194) — marks `dispatched → timeout` after 90s

**Rationale:** M3's only job for device commands is the state transition `pending → dispatched`. M1 owns the rest.

#### 3.2 GatewayConnectionManager: New `publishToGateway()` Method

**File:** `backend/src/iot-hub/services/gateway-connection-manager.ts`

Add two new public methods to the class:

```typescript
/** Publish a message to a specific gateway's MQTT broker. */
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

**Design notes:**
- `publishToGateway()` returns `boolean` (not Promise) because `mqtt.publish()` is fire-and-forget with QoS 1
- The existing `hasGateway()` method (line 310) only checks the Map key, NOT MQTT connection state. `isGatewayConnected()` checks `client.connected` which reflects the actual TCP/MQTT state.
- The `mqttClient` field is typed as `unknown` (line 35) — we cast at the method boundary, consistent with existing code (see lines 100, 287-289)

#### 3.3 New: CommandPublisher Service

**File:** New `backend/src/iot-hub/services/command-publisher.ts`

```
                   ┌─────────────────────────┐
                   │    CommandPublisher      │
                   │                          │
                   │  poll()  ──10s timer──►  │
                   │    │                     │
                   │    ▼                     │
                   │  SELECT dispatched       │
                   │  FOR UPDATE SKIP LOCKED  │
                   │    │                     │
                   │    ├─ gateway offline?   │
                   │    │   → result='failed' │
                   │    │                     │
                   │    ├─ build protocol msg │
                   │    │   (schedule-        │
                   │    │    translator)       │
                   │    │                     │
                   │    ├─ publishToGateway() │
                   │    │                     │
                   │    └─ UPDATE message_id  │
                   │       (for reply match)  │
                   └─────────────────────────┘
```

**Constructor:** `(pool: Pool, connectionManager: GatewayConnectionManager)`

**Polling query:**
```sql
SELECT id, gateway_id, command_type, config_name, payload_json
FROM device_command_logs
WHERE result = 'dispatched'
  AND command_type = 'set'
ORDER BY created_at ASC
LIMIT 10
FOR UPDATE SKIP LOCKED
```

**Per-command logic:**

1. **Gateway offline check:**
   ```typescript
   if (!connectionManager.isGatewayConnected(cmd.gateway_id)) {
     UPDATE device_command_logs
     SET result = 'failed', error_message = 'gateway_offline', resolved_at = NOW()
     WHERE id = $1
     → continue to next command
   }
   ```

2. **payload_json format gap — CRITICAL:**

   Current BFF (`put-gateway-schedule.ts:109`) stores:
   ```json
   { "slots": [{ "startHour": 0, "endHour": 5, "mode": "self_consumption" }] }
   ```

   But the protocol (`SolfacilProtocol_v1.5.md §3.8`) needs:
   ```json
   {
     "soc_min_limit": "10", "soc_max_limit": "95",
     "max_charge_current": "100", "max_discharge_current": "100",
     "grid_import_limit": "3000",
     "slots": [{ "purpose": "self_consumption", "start": "0", "end": "300" }]
   }
   ```

   **Resolution:** After Req 2 changes, BFF will store full `DomainSchedule` format:
   ```json
   {
     "socMinLimit": 10, "socMaxLimit": 95,
     "maxChargeCurrent": 100, "maxDischargeCurrent": 100,
     "gridImportLimitKw": 3000,
     "slots": [{ "startMinute": 0, "endMinute": 300, "mode": "self_consumption" }]
   }
   ```

   CommandPublisher reads `payload_json`, casts to `DomainSchedule`, calls:
   ```typescript
   import { validateSchedule, buildConfigSetPayload } from '../handlers/schedule-translator';

   const schedule = cmd.payload_json as DomainSchedule;
   validateSchedule(schedule);  // Hard crash = skip this command, mark failed
   const messageId = String(Date.now());
   const protocolMessage = buildConfigSetPayload(cmd.gateway_id, schedule, messageId);
   ```

3. **Publish:**
   ```typescript
   const topic = `platform/ems/${cmd.gateway_id}/config/set`;
   const published = connectionManager.publishToGateway(
     cmd.gateway_id, topic, JSON.stringify(protocolMessage)
   );
   if (!published) {
     // Race: gateway disconnected between check and publish
     UPDATE ... SET result = 'failed', error_message = 'publish_failed'
   }
   ```

4. **Update message_id for reply matching:**
   ```sql
   UPDATE device_command_logs
   SET message_id = $1
   WHERE id = $2
   ```
   This is critical — `command-tracker.ts` matches set_reply by `gateway_id + config_name + result='dispatched'` (not by message_id), so the message_id update is for audit trail, not for matching. The existing matching logic (command-tracker.ts:88-103) works correctly because it finds the latest dispatched 'set' command for the gateway.

**Polling interval:** 10s (matches M3's current interval)
**Batch size:** LIMIT 10 (config/set is rare — typically 0-1 per poll)

**Error handling:**
- Validation failure → `result = 'failed', error_message = 'validation: <error>'`
- Publish failure → `result = 'failed', error_message = 'publish_failed'`
- DB error → log + skip (will retry next poll since row wasn't updated)

#### 3.4 command-tracker.ts: WHERE Clause Fix

**File:** `backend/src/iot-hub/handlers/command-tracker.ts`

**Current** (line 99): `AND result = 'pending'`
**After:** `AND result = 'dispatched'`

**Reason:** When M1 publishes a config/set, the command log is in `dispatched` state (not `pending`). The set_reply needs to resolve a `dispatched` command.

**Full WHERE clause after fix:**
```sql
WHERE gateway_id = $4
  AND config_name = $5
  AND command_type = 'set'
  AND result = 'dispatched'
ORDER BY created_at DESC
LIMIT 1
```

#### 3.5 Delete `mqtt-client.ts` Stub

**File:** `backend/src/iot-hub/mqtt-client.ts` — DELETE ENTIRELY

**Verification:** After M3 cleanup removes the import, `grep -r "mqtt-client" backend/src/` must return zero hits.

#### 3.6 Wire Up in `run-m1-local.ts`

**File:** `backend/scripts/run-m1-local.ts`

After `await manager.start()` (line 54), add:
```typescript
import { CommandPublisher } from '../src/iot-hub/services/command-publisher';

const publisher = new CommandPublisher(pool, manager);
publisher.start();  // begins 10s polling
```

Add to graceful shutdown (line 65):
```typescript
publisher.stop();
```

#### 3.7 DB Index for Dispatched Commands

The existing partial index on `result='pending'` doesn't cover CommandPublisher's query (`result='dispatched'`).

**New index:**
```sql
CREATE INDEX CONCURRENTLY idx_dcl_dispatched_set
ON device_command_logs (created_at ASC)
WHERE result = 'dispatched' AND command_type = 'set';
```

This covers both CommandPublisher's polling query and the timeout check.

#### 3.8 Status Flow Summary

```
pending ──(M3 Job2)──► dispatched ──(M1 CommandPublisher)──► [awaiting reply]
                                                                    │
                                     set_reply arrives ────► success / fail
                                     90s no reply ─(M3)──► timeout
                                     gateway offline ─(M1)──► failed (gateway_offline)
                                     validation error ─(M1)──► failed (validation: ...)
```

---

## Requirement 2: Config + Schedule Card Merge

### Problem Statement

Frontend has two separate cards (Gateway Configuration + Daily Schedule) with two Apply buttons. In the protocol (§3.6), these are a SINGLE `battery_schedule` object. Two Apply buttons = two MQTT config/set calls = second overwrites the first.

### Detailed Design

#### 2.1 Unified `_pendingConfig` State Object

**Current state:**
- Config card reads from `config` parameter (SOC, charge/discharge, grid limit) → `_handleConfigApply()` → `PUT /api/devices/:assetId` (wrong endpoint)
- Schedule card reads from `_pendingSlots` (array of `{startHour, endHour, mode}`) → `_handleApplyGW()` → `PUT /api/gateways/:id/schedule` with `{ slots }`

**Target state — single state tree:**
```javascript
_pendingConfig: {
  socMinLimit: 10,        // from get_reply battery_schedule.soc_min_limit
  socMaxLimit: 95,        // from get_reply battery_schedule.soc_max_limit
  maxChargeCurrent: 100,  // from get_reply battery_schedule.max_charge_current
  maxDischargeCurrent: 100,// from get_reply battery_schedule.max_discharge_current
  gridImportLimitKw: 3000,// from get_reply battery_schedule.grid_import_limit
  slots: [
    { startMinute: 0, endMinute: 300, purpose: "tariff", direction: "charge" },
    { startMinute: 300, endMinute: 1020, purpose: "self_consumption" },
    { startMinute: 1020, endMinute: 1200, purpose: "peak_shaving" },
    { startMinute: 1200, endMinute: 1440, purpose: "tariff", direction: "discharge", exportPolicy: "forbid" }
  ]
}
```

**Key changes from current slot model:**
| Current | New | Notes |
|---------|-----|-------|
| `startHour` (0-24) | `startMinute` (0-1380, ×60) | Protocol uses minutes |
| `endHour` (0-24) | `endMinute` (60-1440, ×60) | Protocol uses minutes |
| `mode` (3 values) | `purpose` (3 values) | Renamed to match protocol |
| — | `direction` (charge/discharge) | For purpose=tariff only |
| — | `exportPolicy` (allow/forbid) | For tariff+discharge only |

**Mode name mapping:**
| Frontend Domain | Protocol Purpose | Direction | Export Policy |
|----------------|-----------------|-----------|---------------|
| self_consumption | self_consumption | — | — |
| peak_shaving | peak_shaving | — | — |
| tariff (charge) | tariff | charge | — |
| tariff (discharge, allow) | tariff | discharge | allow |
| tariff (discharge, forbid) | tariff | discharge | forbid |

#### 2.2 BFF: `put-gateway-schedule.ts` Rewrite

**Current** accepts: `{ slots: [{ startHour, endHour, mode }] }` (line 51, 109)
**After** accepts: Full DomainSchedule

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

**Validation strategy:**

Replace all the manual validation (lines 58-91) with `schedule-translator.ts::validateSchedule()`:

```typescript
import { validateSchedule, type DomainSchedule } from '../../iot-hub/handlers/schedule-translator';

// Map request body → DomainSchedule
const schedule: DomainSchedule = {
  socMinLimit: body.socMinLimit,
  socMaxLimit: body.socMaxLimit,
  maxChargeCurrent: body.maxChargeCurrent,
  maxDischargeCurrent: body.maxDischargeCurrent,
  gridImportLimitKw: body.gridImportLimitKw,
  slots: body.slots.map(s => ({
    mode: mapPurposeToMode(s.purpose),      // "tariff" → "peak_valley_arbitrage"
    action: s.direction as 'charge' | 'discharge' | undefined,
    allowExport: s.exportPolicy === 'allow' ? true : s.exportPolicy === 'forbid' ? false : undefined,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
  })),
};

try {
  validateSchedule(schedule);
} catch (err) {
  return apiError(400, err.message);
}
```

**Purpose-to-mode mapping:**
```typescript
function mapPurposeToMode(purpose: string): DomainSlot['mode'] {
  switch (purpose) {
    case 'self_consumption': return 'self_consumption';
    case 'peak_shaving': return 'peak_shaving';
    case 'tariff': return 'peak_valley_arbitrage';
    default: throw new Error(`Unknown purpose: ${purpose}`);
  }
}
```

**Store full DomainSchedule as payload_json:**
```sql
INSERT INTO device_command_logs (gateway_id, command_type, config_name, payload_json, result)
VALUES ($1, 'set', 'battery_schedule', $2, 'pending')
```
Where `$2 = JSON.stringify(schedule)` — the full DomainSchedule object, NOT just slots.

This is what CommandPublisher (Req 3) reads and passes to `buildConfigSetPayload()`.

#### 2.3 BFF: `get-gateway-schedule.ts` Rewrite

**Current** (lines 47-57): Queries latest `command_type = 'set'` — returns only `{ slots }`.

**After:** Queries latest `command_type = 'get_reply'` for the ground truth (what the gateway actually reports), PLUS latest `set` for sync status.

```sql
-- Ground truth: latest config/get_reply
SELECT payload_json
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'get_reply'
  AND config_name = 'battery_schedule'
  AND payload_json IS NOT NULL
ORDER BY created_at DESC
LIMIT 1

-- Sync status: latest set command
SELECT result, resolved_at, created_at
FROM device_command_logs
WHERE gateway_id = $1
  AND command_type = 'set'
  AND config_name = 'battery_schedule'
ORDER BY created_at DESC
LIMIT 1
```

**Response shape:**
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
        { "startMinute": 300, "endMinute": 1020, "purpose": "self_consumption" },
        ...
      ]
    },
    "syncStatus": "synced",
    "lastAckAt": "2026-03-12T09:30:00.000Z"
  }
}
```

**get_reply payload_json** is raw protocol format (stored by command-tracker.ts:49):
```json
{
  "soc_min_limit": "10", "soc_max_limit": "95",
  "max_charge_current": "100", "max_discharge_current": "100",
  "grid_import_limit": "3000",
  "slots": [{ "purpose": "tariff", "direction": "charge", "start": "0", "end": "300" }]
}
```

Use `schedule-translator.ts::parseGetReply()` to convert to domain format, then map to frontend format:
```typescript
import { parseGetReply, type ProtocolSchedule } from '../../iot-hub/handlers/schedule-translator';

const domain = parseGetReply(row.payload_json as ProtocolSchedule);
// Map domain → response (purpose-based naming for frontend)
```

**Domain-to-response slot mapping:**
```typescript
function domainSlotToResponse(slot: DomainSlot) {
  if (slot.mode === 'self_consumption') {
    return { startMinute: slot.startMinute, endMinute: slot.endMinute, purpose: 'self_consumption' };
  }
  if (slot.mode === 'peak_shaving') {
    return { startMinute: slot.startMinute, endMinute: slot.endMinute, purpose: 'peak_shaving' };
  }
  // peak_valley_arbitrage → tariff
  const result: any = { startMinute: slot.startMinute, endMinute: slot.endMinute, purpose: 'tariff', direction: slot.action };
  if (slot.action === 'discharge') {
    result.exportPolicy = slot.allowExport ? 'allow' : 'forbid';
  }
  return result;
}
```

#### 2.4 Frontend: Merged Battery Schedule Card

**File:** `frontend-v2/js/p2-devices.js`

Replace `_buildDeviceConfigGW()` (lines 568-667) and `_buildScheduleCardEditable()` (lines 673-724) with single `_buildBatteryScheduleCard()`.

**Card layout:**
```
┌─────────────────────────────────────────────────┐
│  Battery Schedule Configuration                  │
│                                                   │
│  ┌─ Parameters ──────────────────────────────┐   │
│  │ SOC Min (%)        [10  ]                 │   │
│  │ SOC Max (%)        [95  ]                 │   │
│  │ Max Charge (A)     [100 ]                 │   │
│  │ Max Discharge (A)  [100 ]                 │   │
│  │ Grid Import (kW)   [3000]                 │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌─ Daily Schedule ──────────────────────────┐   │
│  │ [====green====][===blue===][==purple==]    │   │
│  │ Start  | End   | Mode     | Dir | Policy  │   │
│  │ 00:00  | 05:00 | Tariff   | Chg | —       │   │
│  │ 05:00  | 17:00 | Self Con.| —   | —       │   │
│  │ 17:00  | 20:00 | Peak Shv.| —   | —       │   │
│  │ 20:00  | 24:00 | Tariff   | Dis | Forbid  │   │
│  │                        [+ Add Slot]        │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  Sync: ● Synced  Last: 2026-03-12 09:30         │
│                             [Apply to Gateway]    │
└─────────────────────────────────────────────────┘
```

**Slot time selectors:**
- Start: 00:00 → 23:00 (values 0..1380, step 60)
- End: 01:00 → 24:00 (values 60..1440, step 60)
- Display as `HH:MM` format

**Mode selector options:**
1. `self_consumption` — "Self Consumption"
2. `peak_shaving` — "Peak Shaving"
3. `tariff` — "Tariff" → shows sub-fields:
   - `direction`: dropdown [Charge, Discharge]
   - `exportPolicy`: dropdown [Allow, Forbid] (only when direction=discharge)

**Timeline bar colors:**
```javascript
var modeColors = {
  self_consumption: '#22c55e',  // green
  peak_shaving: '#a855f7',      // purple
  tariff_charge: '#3b82f6',     // blue (charge)
  tariff_discharge: '#f97316',  // orange (discharge)
};
```

**State initialization from API response:**
```javascript
// From DataSource.devices.getSchedule(gwId) response
_pendingConfig = {
  socMinLimit: data.batterySchedule.socMinLimit,
  socMaxLimit: data.batterySchedule.socMaxLimit,
  maxChargeCurrent: data.batterySchedule.maxChargeCurrent,
  maxDischargeCurrent: data.batterySchedule.maxDischargeCurrent,
  gridImportLimitKw: data.batterySchedule.gridImportLimitKw,
  slots: data.batterySchedule.slots.map(function(s) {
    return { startMinute: s.startMinute, endMinute: s.endMinute, purpose: s.purpose,
             direction: s.direction || null, exportPolicy: s.exportPolicy || null };
  })
};
```

**Apply handler** (`_handleApplySchedule`):
```javascript
_handleApplySchedule: async function() {
  var gwId = self._currentGatewayId;
  await DataSource.devices.putSchedule(gwId, self._pendingConfig);
  // _pendingConfig is the full DomainSchedule object
}
```

**Visibility rule:** Only show this card if gateway has at least one INVERTER_BATTERY device (same as current `_buildDeviceConfigGW` check on line 570-574).

#### 2.5 DataSource: `putSchedule()` Update

**File:** `frontend-v2/js/data-source.js`

**Current** (lines 237-248): Sends `{ slots: slots }` (array of `{startHour, endHour, mode}`)
**After:** Sends the full `_pendingConfig` object directly:

```javascript
putSchedule: function(gatewayId, config) {
  if (!USE_LIVE_API) {
    return Promise.resolve({ commandId: 99, status: 'pending', message: 'Submitted.' });
  }
  return apiPut('/api/gateways/' + gatewayId + '/schedule', config);
}
```

#### 2.6 i18n Keys

**File:** `frontend-v2/js/i18n.js`

New keys (all 3 languages):

| Key | EN | PT-BR | ZH-CN |
|-----|-----|-------|-------|
| `devices.schedule.title` | Battery Schedule Configuration | Configuração do Agendamento | 電池排程設定 |
| `devices.schedule.socMin` | SOC Min (%) | SOC Mín (%) | SOC 下限 (%) |
| `devices.schedule.socMax` | SOC Max (%) | SOC Máx (%) | SOC 上限 (%) |
| `devices.schedule.maxCharge` | Max Charge Current (A) | Corrente Máx Carga (A) | 最大充電電流 (A) |
| `devices.schedule.maxDischarge` | Max Discharge Current (A) | Corrente Máx Descarga (A) | 最大放電電流 (A) |
| `devices.schedule.gridImportLimit` | Grid Import Limit (kW) | Limite de Importação (kW) | 電網進口限制 (kW) |
| `devices.schedule.tariff` | Tariff | Tarifa | 電價 |
| `devices.schedule.direction` | Direction | Direção | 方向 |
| `devices.schedule.charge` | Charge | Carga | 充電 |
| `devices.schedule.discharge` | Discharge | Descarga | 放電 |
| `devices.schedule.exportPolicy` | Export Policy | Política de Exportação | 出口政策 |
| `devices.schedule.allow` | Allow | Permitir | 允許 |
| `devices.schedule.forbid` | Forbid | Proibir | 禁止 |

---

## Requirement 1: SSE Real-time Push

### Problem Statement

Frontend has no way to know when backend data changes. Users must manually refresh to see new telemetry, device state, or gateway health updates.

### Detailed Design

#### 1.1 M1: pg_notify in FragmentAssembler

**File:** `backend/src/iot-hub/services/fragment-assembler.ts`

**After `updateDeviceState()` succeeds** (line 323):
```typescript
await this.pool.query("SELECT pg_notify('telemetry_update', $1)", [clientId]);
```

**After `writeEmsHealth()` succeeds** (line 212):
```typescript
await this.pool.query("SELECT pg_notify('gateway_health', $1)", [clientId]);
```

**Design notes:**
- `pg_notify` payload is the `clientId` (= `gatewayId`) — enough for frontend to know which gateway changed
- `pg_notify` is transactional when inside a transaction, but here we're using standalone queries, so the notify fires immediately after the UPDATE succeeds
- Payload limit is 8000 bytes — a gatewayId is ~20 chars, well within limit

#### 1.2 M1: pg_notify in HeartbeatHandler

**File:** `backend/src/iot-hub/handlers/heartbeat-handler.ts`

After the `UPDATE gateways` succeeds (line 32):
```typescript
await pool.query("SELECT pg_notify('gateway_health', $1)", [gatewayId]);
```

This notifies frontends when a gateway comes online (status changes to 'online').

#### 1.3 BFF: SSE Endpoint

**File:** New `backend/src/bff/handlers/sse-events.ts`

**Route:** `GET /api/events`

```typescript
import { Pool, Client } from 'pg';

export function createSseHandler(pool: Pool) {
  return async (req: express.Request, res: express.Response) => {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // nginx proxy
    res.flushHeaders();

    // DEDICATED connection for LISTEN — NOT from main pool
    const listenClient = new Client({
      host: 'localhost', port: 5432,
      database: 'solfacil_vpp',
      user: 'solfacil_service',
      password: 'solfacil_service_2026',
    });
    await listenClient.connect();

    await listenClient.query('LISTEN telemetry_update');
    await listenClient.query('LISTEN gateway_health');

    listenClient.on('notification', (msg) => {
      const event = JSON.stringify({
        type: msg.channel,      // "telemetry_update" or "gateway_health"
        gatewayId: msg.payload,
      });
      res.write(`data: ${event}\n\n`);
    });

    // Keepalive every 30s to prevent proxy timeouts
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30_000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(keepalive);
      listenClient.query('UNLISTEN *').catch(() => {});
      listenClient.end().catch(() => {});
    });
  };
}
```

**Why a dedicated connection (not from pool):**
- `LISTEN` holds the connection for the lifetime of the SSE session
- Pool connections are meant for short-lived queries
- Pool exhaustion risk: if 5 SSE clients each hold a pool connection, and pool max is 10, only 5 left for queries
- Acceptable: this is an admin portal with <10 concurrent users

**Wire up in `local-server.ts`:**
```typescript
import { createSseHandler } from '../src/bff/handlers/sse-events';

// Add BEFORE the wrapHandler routes (SSE needs raw express, not Lambda emulation)
app.get('/api/events', createSseHandler(servicePool));
```

Note: `createSseHandler` receives `pool` but doesn't use it for LISTEN — the pool reference is passed in case the SSE handler needs to do non-LISTEN queries in the future. The LISTEN connection is created independently using direct `Client`.

#### 1.4 Frontend: EventSource

**File:** `frontend-v2/js/p2-devices.js`

In `init()` method:
```javascript
init: async function() {
  // ... existing code ...

  // SSE: subscribe to real-time updates
  this._connectSSE();
},

_sseSource: null,

_connectSSE: function() {
  var self = this;
  if (self._sseSource) {
    self._sseSource.close();
  }

  var base = DataSource.API_BASE;
  self._sseSource = new EventSource(base + '/api/events');

  self._sseSource.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      self._handleSSEEvent(data);
    } catch (e) {
      console.warn('[SSE] Parse error:', e);
    }
  };

  self._sseSource.onerror = function() {
    // EventSource auto-reconnects — just log
    console.warn('[SSE] Connection error, will auto-reconnect');
  };
},

_handleSSEEvent: function(data) {
  var self = this;
  if (!data.gatewayId) return;

  // If viewing Layer 1 (gateway list), refresh the list
  if (!self._currentDetail) {
    self._refreshGatewayList();
    return;
  }

  // If viewing Layer 3 and gatewayId matches, refresh detail
  if (self._currentGatewayId === data.gatewayId) {
    self._refreshCurrentDetail();
  }
},

_cleanupSSE: function() {
  if (this._sseSource) {
    this._sseSource.close();
    this._sseSource = null;
  }
}
```

Call `_cleanupSSE()` when navigating away from P2 (in the page lifecycle).

**Debounce consideration:** Telemetry arrives every ~10s per gateway. If the user is viewing the detail page, we don't want 6 re-fetches per minute. Add a simple debounce:

```javascript
_sseDebounceTimer: null,

_handleSSEEvent: function(data) {
  var self = this;
  if (self._sseDebounceTimer) clearTimeout(self._sseDebounceTimer);
  self._sseDebounceTimer = setTimeout(function() {
    // actual refresh logic
  }, 2000);  // 2s debounce
},
```

#### 1.5 File Server Proxy

**File:** `/tmp/ashe_file_server/main.py`

Add SSE proxy route with streaming support:
```python
@app.route('/api/events')
def proxy_sse():
    resp = requests.get(f'{BFF_URL}/api/events', stream=True)
    return Response(
        stream_with_context(resp.iter_content(chunk_size=None)),
        content_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        }
    )
```

Key: `stream=True` on the requests call, and `stream_with_context` on the response. No buffering.

---

## Cross-cutting Concerns

### Module Boundary Enforcement

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   M3 (DR)   │     │   DB Bridge  │     │   M1 (IoT Hub)  │
│             │     │              │     │                 │
│ Polls       │────►│ pending →    │────►│ CommandPublisher │
│ pending     │     │ dispatched   │     │ polls dispatched │
│ Marks       │     │              │     │ → publish MQTT   │
│ dispatched  │     │              │     │ → track reply    │
│             │     │              │     │                 │
│ NO MQTT     │     │              │     │ GatewayConn.Mgr │
│ imports     │     │              │     │ (real MQTT)      │
└─────────────┘     └──────────────┘     └─────────────────┘
```

**After Req 3:** `grep -r "iot-hub" backend/src/dr-dispatcher/` returns zero hits.

### Data Format Flow

```
Frontend _pendingConfig     →  BFF PUT body        →  DB payload_json (DomainSchedule)
{socMinLimit:10, slots:[    {socMinLimit:10,         {socMinLimit:10,
 {startMinute:0,             slots:[{startMinute:0,   slots:[{mode:"self_consumption",
  endMinute:300,              endMinute:300,            startMinute:0, endMinute:300}]}
  purpose:"self_consumption"  purpose:"self_consumption"
 }]}                         }]}

    ↓ M1 CommandPublisher reads DomainSchedule
    ↓ schedule-translator.ts::buildConfigSetPayload()

Protocol message to gateway:
{data: {configname: "battery_schedule", battery_schedule: {
  soc_min_limit: "10", ...,
  slots: [{purpose: "self_consumption", start: "0", end: "300"}]
}}}
```

### Error Budget

| Failure | Detection | Response | Recovery |
|---------|-----------|----------|----------|
| Gateway offline when publishing | `isGatewayConnected()` returns false | Immediately fail command | User re-submits after gateway online |
| Validation failure | `validateSchedule()` throws | Mark command failed | User fixes schedule and re-submits |
| MQTT publish fail (race) | `publishToGateway()` returns false | Mark command failed | Next poll picks up any remaining |
| No set_reply after 90s | M3 `runTimeoutCheck()` | Mark timeout | User can re-submit |
| SSE connection drop | EventSource auto-reconnect | Auto-reconnect (browser native) | No action needed |
| pg_notify missed | Not detectable | Frontend stale for ≤10s | Next telemetry cycle triggers another notify |
