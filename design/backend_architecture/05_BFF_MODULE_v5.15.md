# M5: BFF Module -- Real SC/TOU Savings Attribution

> **Module Version**: v5.15
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: get-performance-savings removes fake 55%/30%/15% ratios, reads real SC/TOU from revenue_daily
> **Core Theme**: Replace fabricated savings split with physically attributed values

---

## Changes from v5.14

| Aspect | v5.14 | v5.15 |
|--------|-------|-------|
| get-performance-savings SC | `SUM(client_savings) * 0.55` (FAKE) | **`SUM(sc_savings_reais)`** (real from DB) |
| get-performance-savings TOU | `SUM(client_savings) * 0.30` (FAKE) | **`SUM(tou_savings_reais)`** (real from DB) |
| get-performance-savings PS | `SUM(client_savings) * 0.15` (FAKE) | **`null`** (not computed until v5.16) |
| get-performance-savings alpha | `AVG(actual_self_consumption_pct)` | **REMOVED** (replaced by real attribution) |
| API response shape | `{ home, total, alpha, sc, tou, ps }` | `{ home, total, sc, tou, ps }` |
| All other BFF handlers | v5.14 | **Unchanged** |

---

## 1. Endpoint Changes

### S1.1 GET `/api/performance/savings` -- SC/TOU Real Values

#### Current Implementation (v5.14 -- FAKE)

```typescript
// Lines 57-59 of get-performance-savings.ts
ROUND(COALESCE(SUM(rd.client_savings_reais), 0) * 0.55, 2) AS sc,
ROUND(COALESCE(SUM(rd.client_savings_reais), 0) * 0.30, 2) AS tou,
ROUND(COALESCE(SUM(rd.client_savings_reais), 0) * 0.15, 2) AS ps
```

These are hardcoded multipliers with no physical basis. They always sum to 100% regardless of actual battery behavior.

#### v5.15 Implementation (REAL)

```typescript
// v5.15: Read real attributed values from revenue_daily
const { rows } = await queryWithOrg(
  `SELECT
     h.name AS home,
     COALESCE(SUM(rd.client_savings_reais), 0) AS total,
     COALESCE(SUM(rd.sc_savings_reais), 0) AS sc,
     COALESCE(SUM(rd.tou_savings_reais), 0) AS tou
   FROM revenue_daily rd
   JOIN assets a ON rd.asset_id = a.asset_id
   JOIN homes h ON a.home_id = h.home_id
   WHERE rd.date >= date_trunc($1::text, CURRENT_DATE)
     AND a.is_active = true
   GROUP BY h.home_id, h.name
   ORDER BY total DESC`,
  [dateTrunc],
  rlsOrgId,
);

const savings = rows.map((r: Record<string, unknown>) => ({
  home: r.home as string,
  total: Math.round(parseFloat(String(r.total)) * 100) / 100,
  sc: Math.round(parseFloat(String(r.sc)) * 100) / 100,
  tou: Math.round(parseFloat(String(r.tou)) * 100) / 100,
  ps: null,  // Not computed until v5.16
}));
```

#### API Response Comparison

**Before (v5.14):**
```json
{
  "savings": [
    {
      "home": "Casa 001",
      "total": 150.00,
      "alpha": 75.2,
      "sc": 82.50,
      "tou": 45.00,
      "ps": 22.50
    }
  ]
}
```

**After (v5.15):**
```json
{
  "savings": [
    {
      "home": "Casa 001",
      "total": 150.00,
      "sc": 98.30,
      "tou": 51.70,
      "ps": null
    }
  ]
}
```

**Breaking changes:**
- `alpha` field removed (no longer meaningful with real attribution)
- `sc` and `tou` values no longer derived from `total` -- they come from separate DB columns
- `sc + tou` may not equal `total` exactly (total includes baseline-actual which covers unattributed periods)
- `ps` is `null` (not a number) -- frontend should display "N/A" or "--"

---

## 2. Query Changes

### S2.1 get-performance-savings -- New Query

**v5.14 (DELETE):**
```sql
SELECT
  h.name AS home,
  COALESCE(SUM(rd.client_savings_reais), 0) AS total,
  ROUND(COALESCE(AVG(rd.actual_self_consumption_pct), 0), 1) AS alpha,
  ROUND(COALESCE(SUM(rd.client_savings_reais), 0) * 0.55, 2) AS sc,
  ROUND(COALESCE(SUM(rd.client_savings_reais), 0) * 0.30, 2) AS tou,
  ROUND(COALESCE(SUM(rd.client_savings_reais), 0) * 0.15, 2) AS ps
FROM revenue_daily rd
JOIN assets a ON rd.asset_id = a.asset_id
JOIN homes h ON a.home_id = h.home_id
WHERE rd.date >= date_trunc(..., CURRENT_DATE)
  AND a.is_active = true
GROUP BY h.home_id, h.name
ORDER BY total DESC
```

**v5.15 (REPLACE WITH):**
```sql
SELECT
  h.name AS home,
  COALESCE(SUM(rd.client_savings_reais), 0) AS total,
  COALESCE(SUM(rd.sc_savings_reais), 0) AS sc,
  COALESCE(SUM(rd.tou_savings_reais), 0) AS tou
FROM revenue_daily rd
JOIN assets a ON rd.asset_id = a.asset_id
JOIN homes h ON a.home_id = h.home_id
WHERE rd.date >= date_trunc($1::text, CURRENT_DATE)
  AND a.is_active = true
GROUP BY h.home_id, h.name
ORDER BY total DESC
```

**Key changes:**
1. Removed `alpha` column (no longer needed)
2. Replaced `* 0.55` with `SUM(rd.sc_savings_reais)` (real value)
3. Replaced `* 0.30` with `SUM(rd.tou_savings_reais)` (real value)
4. Removed `* 0.15` PS calculation (returns null in code)
5. Used parameterized `date_trunc($1::text, ...)` instead of string interpolation (SQL injection fix)

### S2.2 SQL Injection Fix

The current implementation uses string interpolation in the SQL:
```typescript
// v5.14 VULNERABLE:
`WHERE rd.date >= date_trunc('${dateTrunc}', CURRENT_DATE)`
```

v5.15 fixes this:
```typescript
// v5.15 SAFE: parameterized
`WHERE rd.date >= date_trunc($1::text, CURRENT_DATE)`, [dateTrunc]
```

The `dateTrunc` value is validated to be one of `'month' | 'quarter' | 'year'` by the switch statement, but parameterized queries are still preferred as defense-in-depth.

---

## 3. Query Routing Red Line (from v5.13 -- UNCHANGED)

BFF read queries must follow routing rules:

| Query Type | Allowed Source | Forbidden Source | Reason |
|-----------|---------------|-----------------|--------|
| **Long-period aggregation** (Scorecard, Revenue, Dashboard) | `asset_hourly_metrics`, `revenue_daily`, `device_state` | ~~`telemetry_history`~~, ~~`asset_5min_metrics`~~ | Raw/5-min tables too large for App Pool |
| **Near-24h high-res** (P3 Energy Behavior) | `telemetry_history` (only exception) | -- | 24h window, compound index |
| **Real-time device state** | `device_state` | ~~`telemetry_history`~~ | O(1) snapshot |

**v5.15 Compliance:** `get-performance-savings` reads from `revenue_daily` (pre-computed by M4). **No** direct access to `asset_5min_metrics` from BFF. **COMPLIANT.**

---

## 4. App Pool Isolation Constraints (unchanged from v5.14)

```
+----------------------------------------------------+
|                     BFF HANDLER                     |
|                                                     |
|  1. extractTenantContext(event)  -> ctx.orgId        |
|  2. rlsOrgId = isAdmin ? null : ctx.orgId           |
|  3. queryWithOrg(sql, params, rlsOrgId)              |
|       |                                              |
|       +-- orgId provided -> App Pool                 |
|       |     SET LOCAL app.current_org_id = orgId      |
|       |     RLS ENFORCED                              |
|       |                                              |
|       +-- orgId null (ADMIN) -> Service Pool         |
|             BYPASSRLS -> sees all tenants            |
|                                                     |
|  4. NEVER import getServicePool() in BFF handlers   |
|  5. NEVER direct pool.query() -- always queryWithOrg|
+----------------------------------------------------+
```

### v5.15 Violation Check

| Handler | Pool Usage | Status |
|---------|-----------|--------|
| get-performance-savings.ts | queryWithOrg() x1 (was x1) | **COMPLIANT** |
| get-dashboard.ts | queryWithOrg() x10 | COMPLIANT (unchanged) |
| get-performance-scorecard.ts | queryWithOrg() x7 | COMPLIANT (unchanged) |
| All other 16 handlers | unchanged | COMPLIANT |

All 19 BFF endpoints remain App Pool compliant.

---

## 5. What Stays Unchanged in v5.15

| Handler | v5.14 Status | v5.15 Status |
|---------|-------------|-------------|
| get-dashboard.ts | v5.14 (selfSufficiency + 10 queries) | **Unchanged** |
| get-performance-scorecard.ts | v5.14 (Actual Savings + Opt Efficiency + Self-Sufficiency) | **Unchanged** |
| get-revenue-trend.ts | v5.12 | Unchanged |
| get-home-energy.ts | v5.12 | Unchanged |
| All other 14 handlers | v5.12 | Unchanged |

Only `get-performance-savings.ts` changes in v5.15.

---

## 6. Frontend Impact Assessment

| Change | Frontend Impact | Action Required |
|--------|----------------|-----------------|
| `alpha` field removed from savings response | Field no longer present | **Minor** -- remove alpha display |
| `sc` value changes from fake to real | Different numeric values | None -- already rendered |
| `tou` value changes from fake to real | Different numeric values | None -- already rendered |
| `ps` changes from fake number to `null` | Display "N/A" or "--" | **Minor** -- null handling |
| `sc + tou` may not equal `total` | Unattributed savings exist | **Minor** -- don't assert equality |

**Conclusion: Frontend minor-change.** Three adjustments: remove alpha display, handle ps=null, don't assert sc+tou=total.

---

## 7. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `bff/handlers/get-performance-savings.ts` | **MODIFY** | Replace fake 0.55/0.30/0.15 with real SC/TOU from revenue_daily; remove alpha; ps=null; fix SQL injection |
| All other BFF handlers (18) | **unchanged** | No impact |

---

## 8. Test Strategy

| Test | Scope | Technique |
|------|-------|-----------|
| SC value from DB | Seeded sc_savings_reais = 98.30 | Integration: verify response.sc = 98.30 |
| TOU value from DB | Seeded tou_savings_reais = 51.70 | Integration: verify response.tou = 51.70 |
| PS returns null | No ps_savings column | Snapshot: verify response.ps === null |
| Alpha removed | Not in response | Snapshot: verify response.alpha === undefined |
| No fake ratios | sc != total * 0.55 | Assert sc + tou <= total (not strict equality) |
| Period filter | period=quarter | SQL uses date_trunc('quarter', ...) |
| SQL injection | period injection attempt | Parameterized query blocks injection |
| App Pool enforcement | All queries via queryWithOrg | Unit test: mock queryWithOrg |
| Empty data | No revenue_daily rows | sc=0, tou=0, total=0, ps=null |
| RLS enforcement | Non-admin user | Only sees own org's homes |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: BFF Gateway + 4 endpoints |
| v5.3 | 2026-02-27 | HEMS single-home control |
| v5.5 | 2026-02-28 | Dual-layer revenue KPI |
| v5.9 | 2026-03-02 | BFF de-hardcoding round 1 |
| v5.10 | 2026-03-05 | Dashboard 7 queries de-hardcoded |
| v5.12 | 2026-03-05 | API Contract Alignment -- 15 new endpoints |
| v5.13 | 2026-03-05 | Scorecard 2 metrics de-hardcoded; Dashboard revenue -> Tarifa Branca |
| v5.14 | 2026-03-06 | KPI Replacement: Savings Alpha -> Actual Savings + Opt Efficiency + Self-Sufficiency |
| **v5.15** | **2026-03-07** | **SC/TOU Real Attribution: get-performance-savings removes fake 0.55/0.30/0.15 multipliers; reads sc_savings_reais and tou_savings_reais from revenue_daily (pre-computed by M4); alpha field removed; ps returns null; SQL injection fix (parameterized date_trunc); all from pre-computed revenue_daily; no asset_5min_metrics access; App Pool compliant** |
