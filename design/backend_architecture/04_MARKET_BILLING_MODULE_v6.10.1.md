# M4: Market Billing Module — v6.10.1 Storage-Retention Hardening

> **Module Version**: v6.10.1
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.1.md](./00_MASTER_ARCHITECTURE_v6.10.1.md)
> **Baseline**: [04_MARKET_BILLING_MODULE_v6.10.md](./04_MARKET_BILLING_MODULE_v6.10.md)
> **Date**: 2026-04-19
> **Description**: Canonical M4 storage-classification delta for `revenue_daily`

---

## 1. Module Judgment

v6.10.1 does not redesign billing execution.
Its M4 impact is classificatory and important:

> `revenue_daily` is treated as business history first, not disposable runtime residue.

That explicit statement matters because storage hardening can easily become logically sloppy and start deleting records that still carry finance meaning.

---

## 2. Surface in Scope

### 2.1 `revenue_daily`
Current role:
- daily revenue/billing history per asset/date
- written by billing job paths in `market-billing/services/daily-billing-job.ts`
- unique key posture already reflects business-history identity rather than log spam identity

---

## 3. Storage Classification Rule

`revenue_daily` is classified as **business/system-of-record history** for v6.10.1 design purposes.

That means:
- it is not placed into the same deletion lane as command logs or transient queue residue
- hot-storage growth is accepted unless later archival work is explicitly approved
- if archival is added later, archive must preserve business readability and replay/audit utility

---

## 4. Architectural Consequences

### 4.1 What v6.10.1 may do
- document growth expectations
- include `revenue_daily` in capacity budgeting
- optionally prepare future archive hooks if they are additive and non-destructive

### 4.2 What v6.10.1 must not do by default
- attach a blind TTL to `revenue_daily`
- classify it as operational residue
- quietly drop older rows to satisfy a generic storage-cleanup goal

---

## 5. Boundary with Runtime Governance

M4 runtime-governance facts from v6.10 remain separate:
- billing-job heartbeat/error runtime facts belong to governed runtime spine
- `revenue_daily` belongs to business-history storage

These are related to the same module but not to the same storage class.

---

## 6. Non-Goals

v6.10.1 M4 hardening does **not**:
- change billing formulas
- change revenue calculation semantics
- introduce runtime-governance retention into business tables
- broaden frontend billing surfaces

It only prevents category error in storage governance.
