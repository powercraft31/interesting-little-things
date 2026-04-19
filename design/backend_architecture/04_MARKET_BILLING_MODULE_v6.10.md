# M4: Market Billing Module — v6.10 Runtime Governance Delta

> **Module Version**: v6.10
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.md](./00_MASTER_ARCHITECTURE_v6.10.md)
> **Baseline**: [04_MARKET_BILLING_MODULE_v6.8.md](./04_MARKET_BILLING_MODULE_v6.8.md)
> **Date**: 2026-04-18
> **Description**: Canonical M4 delta for billing-job runtime-governance participation

---

## 1. Module Judgment

M4 remains the owner of billing/revenue batch behavior.

For v6.10, its canonical runtime-governance participation is limited and explicit: billing-job liveness/error facts.

---

## 2. Phase-1 Runtime Emitter Boundary

M4 phase-1 emitter scope includes:
- `scheduler.billing_job.heartbeat`
- billing-job error facts
- billing-job missed-run / unhealthy runtime facts if emitted by the billing execution path

This keeps ownership clean:
- M4 owns billing-job runtime facts
- M2 owns optimization scheduler runtime facts
- the master doc should no longer blur these into one vague scheduler owner

---

## 3. Non-Goals

M4 v6.10 does **not** change:
- billing formulas
- market calculations
- schema ownership
- operator-facing product logic

It only joins the governed runtime-fact surface.
