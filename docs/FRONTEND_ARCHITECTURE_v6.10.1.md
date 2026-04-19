# SOLFACIL Frontend Architecture — v6.10.1 Storage-Retention Hardening

> **Version**: v6.10.1
> **Baseline**: v6.10 runtime-governance frontend architecture
> **Date**: 2026-04-19
> **Description**: Explicit frontend non-expansion stance for storage-retention hardening

---

## 1. Frontend Judgment

Frontend is even less central in v6.10.1 than it was in v6.10.

This release is a storage-governance hardening pass, not a UI release.

Therefore the canonical frontend statement is simple:
- no new page is required
- no storage dashboard is required
- no retention-control UI is required
- existing v6.10 `#runtime` page remains unchanged in role and scope

---

## 2. Why No New Frontend Surface

The defects being corrected live in:
- Docker/container runtime configuration
- append-heavy table lifecycle policy
- shared-layer retention/archive execution
- schema/storage semantics

A new page would be theater if those rules are not first fixed underneath.

---

## 3. Boundary with Existing UI

Existing runtime page (`#runtime`) continues to answer:
- is the platform healthy?
- what runtime issues are active?

It does **not** become the primary surface for:
- storage budgeting
- retention configuration
- archive browsing
- operational cleanup control

Those remain backend/ops concerns in v6.10.1.

Closed `runtime_issues` cleanup in v6.10.1 does **not** require a frontend change:
- `#runtime` remains a hot-state/operator-triage surface
- historical issue-cycle truth remains in backend/runtime history, not in permanently visible closed rows on the page

---

## 4. Non-Goals

v6.10.1 frontend does **not** include:
- storage charts
- retention policy editing controls
- archive browsing page
- new admin navigation section for storage governance
- redesign of `#runtime`

If storage visibility is needed later, it should follow after backend policy and enforcement are proven, not before.
