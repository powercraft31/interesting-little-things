# M3: DR Dispatcher Module — v6.10 Runtime Governance Delta

> **Module Version**: v6.10
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.md](./00_MASTER_ARCHITECTURE_v6.10.md)
> **Baseline**: [03_DR_DISPATCHER_MODULE_v6.8.md](./03_DR_DISPATCHER_MODULE_v6.8.md)
> **Date**: 2026-04-18
> **Description**: Canonical M3 delta for dispatch-loop runtime-governance participation

---

## 1. Module Judgment

M3 remains the owner of dispatch-loop operational behavior.

v6.10 phase-1 canonically extends M3 to emit runtime facts about dispatch-loop liveness and ack-stall conditions.

---

## 2. Phase-1 Runtime Emitter Boundary

M3 phase-1 emitter scope includes:
- dispatcher heartbeat facts
- timeout-checker heartbeat facts
- dispatch ack-stall / loop-not-progressing facts

These answer platform-runtime questions such as:
- are dispatch loops alive?
- is the system silently failing to progress dispatch work?

They are not a redesign of dispatch state-machine semantics.

---

## 3. Ownership Split

M3 owns:
- dispatch-loop runtime fact emission points
- dispatch-specific structured detail payloads

M3 does not own:
- issue lifecycle governance
- platform health summary
- operator runtime API surface

Those remain outside M3.
