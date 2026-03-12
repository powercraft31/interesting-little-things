# v5.21 Implementation Plan — Step-by-Step

**Date:** 2026-03-12
**Status:** PENDING GEMINI REVIEW
**Design Reference:** `_task_v5.21_design.md`
**Execution Order:** Req 3 → Req 2 → Req 1

---

## Phase 1: M3→M1 Command Pipeline (Requirement 3)

### Step 1.1 — Add publishToGateway() to GatewayConnectionManager

**File:** `backend/src/iot-hub/services/gateway-connection-manager.ts`

**Changes:**
- Add public method `publishToGateway(gatewayId: string, topic: string, message: string): boolean`
- Access `this.gatewayClients.get(gatewayId)` → check `client.connected` → `client.publish(topic, message)` → return true/false

**Verification:**
- TypeScript compiles without error
- Unit test: `manager.publishToGateway('nonexistent', 'topic', 'msg')` returns `false`
- Unit test: After connecting a gateway, `publishToGateway(gwId, topic, msg)` returns `true`

---

### Step 1.2 — Create CommandPublisher

**File:** New `backend/src/iot-hub/services/command-publisher.ts`

**Changes:**
- Class `CommandPublisher` with constructor `(pool: Pool, gcm: GatewayConnectionManager)`
- `start()`: setInterval 10s → `pollAndPublish()`
- `stop()`: clearInterval
- `pollAndPublish()`:
  - BEGIN transaction
  - SELECT dispatched commands (LIMIT 10, FOR UPDATE SKIP LOCKED)
  - For each: check gateway connected → build protocol msg via `buildConfigSetPayload()` → publish → UPDATE message_id
  - If gateway offline → UPDATE result='failed', error_message='gateway_offline'
  - COMMIT
- Phase 1 payload conversion: `startHour*60→startMinute`, `mode→purpose`, hardcoded defaults for SOC/current/grid

**Verification:**
- TypeScript compiles without error
- Insert a test row: `INSERT INTO device_command_logs (gateway_id, command_type, config_name, payload_json, result) VALUES ('WKRD24070202100141I', 'set', 'battery_schedule', '{"slots":[{"startHour":0,"endHour":8,"mode":"self_consumption"},{"startHour":8,"endHour":17,"mode":"peak_valley_arbitrage"},{"startHour":17,"endHour":24,"mode":"peak_shaving"}]}', 'dispatched')`
- Run M1 → CommandPublisher picks it up → publishes to MQTT → check M1 log for `[CommandPublisher] Published config/set`
- Check DB: `message_id` populated on the row
- If Test Gateway is online: check for `set_reply` in M1 log → row updated to `success`/`fail`

---

### Step 1.3 — Simplify M3 command-dispatcher.ts

**File:** `backend/src/dr-dispatcher/services/command-dispatcher.ts`

**Changes:**
- Remove `import { publishMqtt } from "../../iot-hub/mqtt-client"`
- Simplify `runPendingCommandDispatcher()`:
  - Remove message-building logic (commandLogId/commandType/payload/timestamp)
  - Remove `publishMqtt()` call
  - Keep: SELECT pending → UPDATE to dispatched → COMMIT
- No changes to `runCommandDispatcher()` (Job 1) or `runTimeoutCheck()`

**Verification:**
- TypeScript compiles without error
- `grep -r "mqtt-client" backend/src/dr-dispatcher/` returns 0 hits
- M3 module has zero imports from `iot-hub/`

---

### Step 1.4 — Fix command-tracker.ts WHERE clause

**File:** `backend/src/iot-hub/handlers/command-tracker.ts`

**Changes:**
- In `handleSetReply()`, change:
  ```sql
  WHERE result = 'pending' → WHERE result = 'dispatched'
  ```

**Verification:**
- TypeScript compiles
- Manual test: insert a dispatched+set row → simulate set_reply → row updates to success

---

### Step 1.5 — Delete mqtt-client.ts stub

**File:** `backend/src/iot-hub/mqtt-client.ts`

**Changes:**
- Delete the file entirely

**Verification:**
- `grep -r "mqtt-client" backend/src/` returns 0 hits
- TypeScript compiles (`npx tsc --noEmit`)

---

### Step 1.6 — Add DB index for dispatched commands

**SQL:**
```sql
CREATE INDEX CONCURRENTLY idx_cmd_logs_dispatched
  ON device_command_logs (result)
  WHERE result = 'dispatched';
```

**Verification:**
- `\di device_command_logs` shows both `idx_cmd_logs_pending` and `idx_cmd_logs_dispatched`

---

### Step 1.7 — Wire CommandPublisher into run-m1-local.ts

**File:** `backend/scripts/run-m1-local.ts`

**Changes:**
- Import `CommandPublisher`
- After `manager.start()`: create `new CommandPublisher(pool, manager)` → `publisher.start()`
- On SIGINT: `publisher.stop()` before `manager.stop()`

**Verification:**
- Run `npx tsx backend/scripts/run-m1-local.ts`
- Logs show `[CommandPublisher] Started (10s interval)`
- Insert a pending row via BFF PUT → M3 marks dispatched → M1 publishes → gateway replies → DB shows success
- Full end-to-end test

---

### Step 1.8 — Commit & Push Phase 1

**Commit message:** `feat(v5.21): M3→M1 command pipeline — real MQTT publish`

**Files changed:**
- `backend/src/iot-hub/services/gateway-connection-manager.ts` (add publishToGateway)
- `backend/src/iot-hub/services/command-publisher.ts` (new)
- `backend/src/dr-dispatcher/services/command-dispatcher.ts` (simplify, remove mqtt-client)
- `backend/src/iot-hub/handlers/command-tracker.ts` (WHERE fix)
- `backend/src/iot-hub/mqtt-client.ts` (deleted)
- `backend/scripts/run-m1-local.ts` (wire CommandPublisher)

---

## Phase 2: Config + Schedule Card Merge (Requirement 2)

### Step 2.1 — Update BFF put-gateway-schedule.ts

**File:** `backend/src/bff/handlers/put-gateway-schedule.ts`

**Changes:**
- Accept full DomainSchedule body (socMinLimit, socMaxLimit, maxChargeCurrent, maxDischargeCurrent, gridImportLimitKw, slots with startMinute/endMinute/purpose/direction/exportPolicy)
- Use `validateSchedule()` from schedule-translator.ts for validation
- Store complete DomainSchedule as payload_json
- Remove old startHour/endHour validation

**Verification:**
- curl PUT with full body → 202 response
- Check DB: payload_json contains complete DomainSchedule
- curl PUT with invalid SOC (min > max) → 400 error

---

### Step 2.2 — Update BFF get-gateway-schedule.ts

**File:** `backend/src/bff/handlers/get-gateway-schedule.ts`

**Changes:**
- Query latest `get_reply` row from device_command_logs
- Use `parseGetReply()` to translate protocol → domain format
- Return full config (SOC limits + slots) to frontend

**Verification:**
- curl GET → returns full config object
- If no get_reply exists → returns default/empty config

---

### Step 2.3 — Remove CommandPublisher Phase 1 conversion

**File:** `backend/src/iot-hub/services/command-publisher.ts`

**Changes:**
- Remove startHour→startMinute conversion and hardcoded defaults
- Read payload_json as DomainSchedule directly
- Pass to `buildConfigSetPayload()` unchanged

**Verification:**
- Insert dispatched row with DomainSchedule payload → M1 publishes correct protocol message

---

### Step 2.4 — Update frontend data-source.js

**File:** `frontend-v2/js/data-source.js`

**Changes:**
- `putSchedule(gatewayId, config)`: send full config object, not just slots

**Verification:**
- Network tab shows PUT body contains socMinLimit, socMaxLimit, etc.

---

### Step 2.5 — Merge Config + Schedule UI

**File:** `frontend-v2/js/p2-devices.js`

**Changes:**
- Replace `_pendingSlots` with `_pendingConfig` (full state tree)
- New `_buildBatteryScheduleCard(config, schedule)`: single card with parameters + timeline + slots + one Apply button
- Mode dropdown adds `tariff` option with conditional `direction` and `exportPolicy` sub-fields
- Time selectors: 00:00-24:00 in 1-hour increments (mapping to 0-1440 minutes)
- Remove `_buildDeviceConfigGW()`, `_buildScheduleCardEditable()`, `_handleApplyConfig()`, `_handleApplyGW()`
- Add `_handleApplySchedule()`: validates full config → calls `DataSource.devices.putSchedule(gwId, config)`

**Verification:**
- Browser: Layer 3 shows single merged card
- All fields populated from API response
- Apply sends full object
- Timeline preview updates correctly
- Add/delete slot works with tariff mode sub-fields

---

### Step 2.6 — Add i18n keys

**File:** `frontend-v2/js/i18n.js`

**Changes:**
- Add 12 new keys × 3 languages (see design doc §2.7)

**Verification:**
- Switch to each language → all new labels translated correctly

---

### Step 2.7 — Commit & Push Phase 2

**Commit message:** `feat(v5.21): config+schedule card merge — single Apply, full battery_schedule`

**Files changed:**
- `backend/src/bff/handlers/put-gateway-schedule.ts`
- `backend/src/bff/handlers/get-gateway-schedule.ts`
- `backend/src/iot-hub/services/command-publisher.ts` (remove Phase 1 conversion)
- `frontend-v2/js/data-source.js`
- `frontend-v2/js/p2-devices.js`
- `frontend-v2/js/i18n.js`

---

## Phase 3: SSE Real-time Push (Requirement 1)

### Step 3.1 — Add pg_notify to M1 handlers

**Files:**
- `backend/src/iot-hub/services/fragment-assembler.ts`: Add `pg_notify('telemetry_update', clientId)` after `updateDeviceState()` and `pg_notify('gateway_health', clientId)` after `writeEmsHealth()`
- `backend/src/iot-hub/handlers/heartbeat-handler.ts`: Add `pg_notify('gateway_health', gatewayId)` after UPDATE gateways

**Verification:**
- `psql LISTEN telemetry_update; LISTEN gateway_health;` in separate terminal
- Run M1 → see NOTIFY messages when telemetry arrives

---

### Step 3.2 — Create BFF SSE endpoint

**File:** New `backend/src/bff/handlers/sse-events.ts`

**Changes:**
- Singleton LISTEN pg.Client (not from pool)
- SSE response with proper headers
- Keepalive every 30s
- Cleanup on client disconnect

**Verification:**
- `curl -N http://localhost:3000/api/events` → receives SSE events when telemetry updates
- Multiple clients can connect simultaneously
- Disconnect → LISTEN connection cleaned up if last client

---

### Step 3.3 — Add SSE route to local-server.ts

**File:** `backend/scripts/local-server.ts`

**Changes:**
- `app.get("/api/events", sseHandler)` — raw handler, not wrapped in Lambda adapter

**Verification:**
- Route accessible at `http://localhost:3000/api/events`

---

### Step 3.4 — Update file server proxy for SSE

**File:** `/tmp/ashe_file_server/main.py`

**Changes:**
- Proxy `/api/events` with streaming (no response buffering)
- Set `X-Accel-Buffering: no` header

**Verification:**
- `curl -N https://152.42.235.155:8443/api/events` → receives SSE events

---

### Step 3.5 — Add frontend EventSource

**File:** `frontend-v2/js/p2-devices.js`

**Changes:**
- Create EventSource on P2 init
- On message: refresh current layer data
- On page leave: close EventSource
- Handle reconnection gracefully

**Verification:**
- Open P2 in browser → M1 receives telemetry → UI updates automatically without manual refresh
- Disconnect network briefly → EventSource reconnects → updates resume

---

### Step 3.6 — Commit & Push Phase 3

**Commit message:** `feat(v5.21): SSE real-time push — pg_notify + EventSource auto-refresh`

**Files changed:**
- `backend/src/iot-hub/services/fragment-assembler.ts` (add pg_notify)
- `backend/src/iot-hub/handlers/heartbeat-handler.ts` (add pg_notify)
- `backend/src/bff/handlers/sse-events.ts` (new)
- `backend/scripts/local-server.ts` (add route)
- `/tmp/ashe_file_server/main.py` (proxy update)
- `frontend-v2/js/p2-devices.js` (EventSource)

---

## Summary

| Phase | Steps | Files | Blocked By |
|-------|-------|-------|------------|
| Phase 1: M3→M1 Pipeline | 1.1–1.8 | 6 files | Nothing |
| Phase 2: Config Card Merge | 2.1–2.7 | 6 files | Phase 1 |
| Phase 3: SSE Push | 3.1–3.6 | 6 files | Nothing (can parallel Phase 2) |

**Total: 18 files across 3 phases, 20 steps.**
