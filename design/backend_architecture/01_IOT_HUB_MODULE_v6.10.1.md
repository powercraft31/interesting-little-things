# M1: IoT Hub Module — v6.10.1 Storage-Retention Hardening

> **Module Version**: v6.10.1
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.1.md](./00_MASTER_ARCHITECTURE_v6.10.1.md)
> **Baseline**: [01_IOT_HUB_MODULE_v6.10.md](./01_IOT_HUB_MODULE_v6.10.md)
> **Date**: 2026-04-19
> **Description**: Canonical M1 storage-governance delta for alarm/event residue and backfill queue history

---

## 1. Module Judgment

v6.10 made M1 a participant in runtime governance.
v6.10.1 does not broaden M1's runtime semantics.
It corrects M1's storage posture.

The key rule is:

> M1's domain/event tables must stop behaving like permanent append buckets by omission.

---

## 2. Surfaces in Scope

### 2.1 `gateway_alarm_events`
Current role:
- audit-complete append-only domain alarm/event history
- written by `iot-hub/handlers/alarm-handler.ts` via pure `INSERT`

### 2.2 `backfill_requests`
Current role:
- queue/history surface for ingest gap recovery
- written by `iot-hub/handlers/telemetry-handler.ts`

These two surfaces have different semantics and therefore cannot share one lazy policy.

---

## 3. `gateway_alarm_events` Design Posture

### 3.1 Classification
`gateway_alarm_events` is **operational/domain event history**, not runtime-governance projection state.

### 3.2 Hot-storage rule
Committed rule in v6.10.1:
- retain `gateway_alarm_events` in hot PostgreSQL for **180 days**
- after 180 days, move rows into `gateway_alarm_events_archive`
- after successful archive insert, delete the moved rows from the hot table
- active/recent alarm queries continue to target the hot table only

### 3.3 Architectural consequence
M1 must preserve:
- current query behavior for recent active/relevant alarms
- audit readability for near-term diagnosis

M1 must not assume:
- hot PostgreSQL is the forever-home for all historical alarm rows

---

## 4. `backfill_requests` Design Posture

### 4.1 Classification
`backfill_requests` is **queue/state residue with short-lived diagnostic value**.

### 4.2 Lifecycle rule
Committed rule in v6.10.1:
- active rows (`pending`, `in_progress`) stay fully queryable with no time-based sweep
- terminal rows are defined as `completed` or `failed`
- terminal rows are retained for **14 days** after `completed_at` when present, otherwise after `created_at`
- terminal rows are then **direct-deleted** by scheduled executor; no archive lane is used

### 4.3 Why this is different from alarm history
Backfill rows are operational control residue, not domain history of customer-visible device alarms.
So a much shorter retention lane is correct.

---

## 5. Ownership Boundary

M1 owns:
- the meaning of alarm and backfill rows
- what recent history must stay queryable for M1 flows
- archive payload fidelity requirements for `gateway_alarm_events`

M1 does **not** own:
- global retention scheduling
- cross-table budgeting
- Docker/container log policy
- platform-wide storage classification taxonomy

Those remain M9/shared and master-level concerns.

---

## 6. Non-Goals

v6.10.1 M1 hardening does **not**:
- collapse `gateway_alarm_events` into runtime-governance tables
- rewrite alarm business semantics
- replace queue behavior of `backfill_requests`
- require frontend redesign

It only makes the storage lifecycle explicit.
