# M2: Optimization Engine Module — v6.10 Runtime Governance Delta

> **Module Version**: v6.10
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.md](./00_MASTER_ARCHITECTURE_v6.10.md)
> **Baseline**: [02_OPTIMIZATION_ENGINE_MODULE_v6.8.md](./02_OPTIMIZATION_ENGINE_MODULE_v6.8.md)
> **Date**: 2026-04-18
> **Description**: Canonical M2 delta for scheduler-owned runtime-governance emitters

---

## 1. Module Judgment

M2 remains the owner of optimization/schedule-generation runtime concerns.

For v6.10, that means M2 owns the runtime fact boundary for the optimization-side scheduler path, not generic all-cron ownership.

---

## 2. Phase-1 Runtime Emitter Boundary

M2 phase-1 emitter scope is limited to optimization-owned scheduler/runtime facts, for example:
- `scheduler.schedule_generator.heartbeat`
- optimization-side scheduler error facts
- lag or missed-run facts tied to optimization scheduler responsibility

This makes M2 ownership crisp:
- M2 owns optimization scheduler/runtime emitters
- M4 owns billing-job runtime emitters
- M9 governs the shared lifecycle/aggregation semantics above them

---

## 3. Non-Goals

M2 v6.10 delta does **not** mean:
- M2 becomes the owner of every cron job in the system
- generic scheduler substrate is moved into M2
- optimization logic or scheduling algorithms are redesigned

The delta is bounded to runtime-governance participation.
