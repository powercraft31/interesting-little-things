# M1: IoT Hub Module — v6.10 Runtime Governance Delta

> **Module Version**: v6.10
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.md](./00_MASTER_ARCHITECTURE_v6.10.md)
> **Baseline**: [01_IOT_HUB_MODULE_v6.8.md](./01_IOT_HUB_MODULE_v6.8.md)
> **Date**: 2026-04-18
> **Description**: Canonical M1 delta for phase-1 runtime-governance onboarding

---

## 1. Module Judgment

M1 is not re-architected in v6.10.
But it **is** canonically onboarded into the phase-1 runtime-governance spine.

That onboarding is real module-boundary change, so it must be documented here rather than only summarized in the master doc.

---

## 2. Phase-1 Runtime Emitter Boundary

M1 owns ingest-side runtime fact emission for platform health, distinct from domain alarms.

Phase-1 M1 emitter classes:
- `ingest.telemetry.stale`
- `ingest.fragment.backlog`
- `ingest.parser.failed`
- platform-facing heartbeat/freshness signals derived from ingest activity

These runtime facts answer:
- is platform ingest freshness healthy?
- is parser/backlog behavior degraded?

They do **not** replace domain alarm/event tables.

---

## 3. Strict Separation from Domain Alarm Surfaces

M1 already owns device/gateway alarm-related behavior in the business/domain sense.

v6.10 adds a second, distinct concern:
- platform runtime ingest health

Canonical rule:
- runtime-governance emitters do **not** rewrite or collapse `gateway_alarm_events`
- a site/device alarm and an ingest-runtime issue may coexist and mean different things

---

## 4. Ownership Boundary

M1 owns:
- deciding where ingest-side facts are emitted
- supplying structured detail payloads for ingest/runtime incidents

M1 does **not** own:
- issue lifecycle transitions
- dedup/fingerprint governance
- platform severity taxonomy policy
- health summary aggregation

Those remain M9 spine responsibilities.
