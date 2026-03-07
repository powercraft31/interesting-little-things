# M5: BFF Module -- Peak Shaving Real Savings

> **Module Version**: v5.16
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: get-performance-savings replaces ps: null with real PS savings from revenue_daily
> **Core Theme**: Complete the SC/TOU/PS savings trifecta with real attributed values

---

## Changes from v5.15

| Aspect | v5.15 | v5.16 |
|--------|-------|-------|
| get-performance-savings PS | `ps: null` (not computed) | **`COALESCE(SUM(rd.ps_savings_reais), 0)`** (real value) |
| Response type for PS | `ps: null` | **`ps: number`** (0 if no PS active) |
| All other BFF handlers | v5.15 | **Unchanged** |

---

## 1. Endpoint Changes

### GET `/api/performance/savings` -- PS Real Value

#### v5.15 Implementation (ps: null)

```typescript
const savings = rows.map((r: Record<string, unknown>) => ({
  home: r.home as string,
  total: Math.round(parseFloat(String(r.total)) * 100) / 100,
  sc: Math.round(parseFloat(String(r.sc)) * 100) / 100,
  tou: Math.round(parseFloat(String(r.tou)) * 100) / 100,
  ps: null,  // Not computed until v5.16
}));
```

#### v5.16 Implementation (ps: real)

```typescript
const savings = rows.map((r: Record<string, unknown>) => ({
  home: r.home as string,
  total: Math.round(parseFloat(String(r.total)) * 100) / 100,
  sc: Math.round(parseFloat(String(r.sc)) * 100) / 100,
  tou: Math.round(parseFloat(String(r.tou)) * 100) / 100,
  ps: Math.round(parseFloat(String(r.ps)) * 100) / 100,  // v5.16: real value
}));
```

---

## 2. Updated Query

### v5.15 Query (DELETE)

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

### v5.16 Query (REPLACE WITH)

```sql
SELECT
  h.home_id,
  h.name AS home,
  COALESCE(SUM(rd.client_savings_reais), 0) AS total,
  COALESCE(SUM(rd.sc_savings_reais), 0)     AS sc,
  COALESCE(SUM(rd.tou_savings_reais), 0)    AS tou,
  COALESCE(SUM(rd.ps_savings_reais), 0)     AS ps
FROM revenue_daily rd
JOIN assets a ON rd.asset_id = a.asset_id
JOIN homes h ON a.home_id = h.home_id
WHERE rd.date >= date_trunc($1::text, CURRENT_DATE)
  AND a.is_active = true
GROUP BY h.home_id, h.name
ORDER BY total DESC
```

### Key Changes

1. Added `COALESCE(SUM(rd.ps_savings_reais), 0) AS ps` -- real PS savings from M4
2. Added `h.home_id` to SELECT (included in GROUP BY, useful for frontend keying)
3. PS value comes from `revenue_daily.ps_savings_reais` (pre-computed by M4 `runDailyPsSavings`)

### Note on true_up_adjustment_reais

The `true_up_adjustment_reais` column is **not included** in this query. True-up adjustments are a monthly correction that affects the financial reconciliation layer, not the daily performance dashboard. A separate endpoint or report may expose true-up data in the future.

---

## 3. Response Type Change

### API Response Comparison

**Before (v5.15):**
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

**After (v5.16):**
```json
{
  "savings": [
    {
      "home": "Casa 001",
      "total": 150.00,
      "sc": 85.20,
      "tou": 42.60,
      "ps": 22.20
    }
  ]
}
```

### Type Change

```typescript
// v5.15
ps: null

// v5.16
ps: number  // real value, 0 if no PS active for this home
```

### Frontend Impact

| Change | Impact | Action |
|--------|--------|--------|
| `ps` type: `null` -> `number` | Display changes from "N/A" to real value | **Minor** -- update null check to render number |
| `ps` value = 0 when no PS | Homes without PS show R$ 0.00 | Expected behavior |
| `sc + tou + ps` may not equal `total` | Unattributed savings exist (UNASSIGNED bucket) | No frontend change needed |

---

## 4. Query Routing Red Line (UNCHANGED)

| Query Type | Allowed Source | Forbidden Source |
|-----------|---------------|-----------------|
| Long-period aggregation | `revenue_daily`, `asset_hourly_metrics`, `device_state` | ~~`telemetry_history`~~, ~~`asset_5min_metrics`~~ |
| Near-24h high-res | `telemetry_history` (exception) | -- |
| Real-time device state | `device_state` | ~~`telemetry_history`~~ |

**v5.16 Compliance:** `get-performance-savings` reads from `revenue_daily` only. **COMPLIANT.**

---

## 5. App Pool Isolation (UNCHANGED)

All 19 BFF endpoints remain App Pool compliant. No new endpoints added.

| Handler | Pool Usage | Status |
|---------|-----------|--------|
| get-performance-savings.ts | queryWithOrg() x1 | **COMPLIANT** |
| All other 18 handlers | unchanged | COMPLIANT |

---

## 6. What Stays Unchanged in v5.16

| Handler | v5.15 Status | v5.16 Status |
|---------|-------------|-------------|
| get-dashboard.ts | v5.14 | Unchanged |
| get-performance-scorecard.ts | v5.14 | Unchanged |
| get-revenue-trend.ts | v5.12 | Unchanged |
| get-home-energy.ts | v5.12 | Unchanged |
| All other 14 handlers | v5.12-v5.15 | Unchanged |

Only `get-performance-savings.ts` changes in v5.16.

---

## 7. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `bff/handlers/get-performance-savings.ts` | **MODIFY** | Add `COALESCE(SUM(rd.ps_savings_reais), 0) AS ps` to SQL query; change `ps: null` to `ps: number` in response mapping |

---

## 8. Test Strategy

| Test | Scope | Technique |
|------|-------|-----------|
| PS value from DB | Seeded ps_savings_reais = 22.20 | Integration: verify response.ps = 22.20 |
| PS returns 0 when no data | No ps_savings rows | Verify response.ps === 0 (not null) |
| PS type is number | Any response | `typeof response.ps === 'number'` (not null) |
| SC/TOU unchanged | Same seeded data as v5.15 | sc and tou values identical to v5.15 |
| Total independence | sc + tou + ps != total | Assert no strict equality requirement |
| Period filter | period=quarter with PS data | PS correctly summed over quarter |
| Multi-home aggregation | 2 homes, different PS savings | GROUP BY h.home_id produces correct sums |
| Empty data | No revenue_daily rows | sc=0, tou=0, ps=0, total=0 |

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
| v5.13 | 2026-03-05 | Scorecard 2 metrics de-hardcoded |
| v5.14 | 2026-03-06 | KPI Replacement: Savings Alpha -> Actual Savings + Opt Efficiency + Self-Sufficiency |
| v5.15 | 2026-03-07 | SC/TOU Real Attribution: remove fake ratios; ps=null |
| **v5.16** | **2026-03-07** | **PS Real Value: replace ps:null with COALESCE(SUM(ps_savings_reais),0); ps type null->number; query adds ps column from revenue_daily; all other handlers unchanged; App Pool compliant** |
