# M5: BFF Module — v6.10.1 Storage-Retention Hardening

> **Module Version**: v6.10.1
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.10.1.md](./00_MASTER_ARCHITECTURE_v6.10.1.md)
> **Baseline**: [05_BFF_MODULE_v6.10.md](./05_BFF_MODULE_v6.10.md)
> **Date**: 2026-04-19
> **Description**: BFF/storage hardening delta — Docker log-cap posture and `device_command_logs` lifecycle boundary

---

## 1. Module Judgment

M5 remains a read/write edge, not a governance brain.

For v6.10.1, M5 picks up two storage-governance responsibilities:
1. stop container stdout/stderr from being implicitly unbounded
2. stop `device_command_logs` from remaining an ungoverned append sink

---

## 2. Container Log Posture

### 2.1 Problem being corrected
Observed runtime posture showed `solfacil-bff` running on Docker `json-file` with no `max-size` or `max-file` limits.
That means BFF/container logs were effectively bounded only by remaining host disk.

### 2.2 Design rule
v6.10.1 keeps Docker logging simple but explicit:
- stay on `json-file`
- apply a uniform cap of `max-size: 10m` and `max-file: 5`
- use the same policy for `solfacil-bff`, `solfacil-db`, `solfacil-m1`, and `solfacil-redis`
- treat container stdout/stderr as volatile operational output, not retained archive

### 2.3 Architectural consequence
Container stdout/stderr becomes a **hard-capped volatile surface**, not a silent long-term archive.

---

## 3. `device_command_logs` Posture

### 3.1 Classification
`device_command_logs` is **operational command history**, not system-of-record finance data and not runtime-governance projection state.

### 3.2 Lifecycle rule
Committed rule in v6.10.1:
- keep `device_command_logs` in hot PostgreSQL for **90 days**
- rows newer than 90 days remain queryable in the hot table
- rows older than 90 days move into `device_command_logs_archive`
- after successful archive insert, delete the moved rows from the hot table
- rows with `result = 'pending'` are never archived/deleted by age alone; archive eligibility requires terminal state (`success`, `fail`, `timeout`) or a non-null `resolved_at`

### 3.3 Why this matters
This table grows from real operator/device command activity and already behaves much more like a log/history sink than a stable dimension table.
Leaving it uncapped would contradict the entire purpose of the hardening release.

---

## 4. M5 Boundary Rule

M5 owns:
- command-log write semantics at BFF entry points
- compatibility of user/operator flows with any retention or archive cut line
- container runtime config integration in local/deploy composition where M5 services are declared

M5 does **not** own:
- global policy classification of all tables
- archive execution orchestration across modules
- runtime-governance projection cleanup semantics

---

## 5. Non-Goals

v6.10.1 M5 hardening does **not**:
- redesign `/api/runtime/*`
- add new operator pages for storage monitoring
- move BFF business logs into runtime-governance tables
- turn BFF into a storage dashboard

It only makes M5-related growth surfaces bounded and explicit.
