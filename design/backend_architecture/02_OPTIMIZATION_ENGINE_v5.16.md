# M2: Optimization Engine -- Peak Shaving Slot Generation

> **Module Version**: v5.16
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: schedule-generator.ts adds Peak Shaving slot generation based on demand risk evaluation
> **Core Theme**: PS mode scheduling for sites with contracted demand

---

## Changes from v5.15

| Aspect | v5.15 | v5.16 |
|--------|-------|-------|
| PS slot generation | Not implemented | **NEW**: evaluate demand risk, insert PS slots |
| Data reads | assets, device_state, vpp_strategies, pld_horario | **+homes** (contracted_demand_kw) |
| trade_schedules output | SC and TOU slots only | **+peak_shaving** slots |
| contracted_demand_kw usage | Column exists (pre-work) | **Used** for PS threshold evaluation |

---

## 1. PS Slot Generation Logic

### File: `optimization-engine/services/schedule-generator.ts`

Add PS slot generation after existing SC/TOU slot logic.

### 1.1 When to Generate PS Slots

| Condition | Requirement |
|-----------|------------|
| Time window | Billing cycle peak hours (configurable, default 18:00-22:00 BRT) |
| Demand threshold | Estimated peak demand from recent history > `contracted_demand_kw * 0.85` (85% early warning) |
| Asset eligibility | `is_active = true` AND `homes.contracted_demand_kw IS NOT NULL` |

### 1.2 Demand Risk Evaluation

```sql
-- Recent peak demand: highest 15-min average grid power in last 7 days during peak hours
SELECT
  a.asset_id,
  h.contracted_demand_kw,
  h.home_id,
  MAX(recent.avg_grid_kw) AS recent_peak_kw
FROM assets a
JOIN homes h ON h.home_id = a.home_id
LEFT JOIN LATERAL (
  SELECT
    date_bin('15 minutes', m.recorded_at, TIMESTAMP '2026-01-01 03:00:00Z') AS window_15,
    AVG(m.grid_import_kwh * 12) AS avg_grid_kw  -- kWh * 12 = avg kW for 5-min window
  FROM asset_5min_metrics m
  WHERE m.asset_id = a.asset_id
    AND m.recorded_at >= NOW() - INTERVAL '7 days'
    AND EXTRACT(HOUR FROM m.recorded_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 18 AND 21
  GROUP BY window_15
) recent ON true
WHERE a.is_active = true
  AND h.contracted_demand_kw IS NOT NULL
GROUP BY a.asset_id, h.contracted_demand_kw, h.home_id
HAVING MAX(recent.avg_grid_kw) > h.contracted_demand_kw * 0.85
```

### 1.3 PS Slot Insertion

For each asset that exceeds the 85% threshold:

```sql
INSERT INTO trade_schedules
  (asset_id, org_id, planned_time, duration_minutes, action,
   expected_volume_kwh, target_mode, status)
VALUES
  ($asset_id, $org_id, $peak_window_start, 240, 'discharge',
   $estimated_discharge_kwh, 'peak_shaving', 'scheduled')
```

- `duration_minutes = 240` (4 hours, 18:00-22:00 BRT default)
- `action = 'discharge'` (battery discharges to cover peak)
- `target_mode = 'peak_shaving'`
- `status = 'scheduled'` (M3 picks up and dispatches)

---

## 2. contracted_demand_kw Data Flow

### Query

```sql
SELECT a.asset_id, h.contracted_demand_kw, h.home_id
FROM assets a
JOIN homes h ON h.home_id = a.home_id
WHERE a.is_active = true AND h.contracted_demand_kw IS NOT NULL
```

### COALESCE Safety

If `contracted_demand_kw IS NULL` for a home:
- **Skip** PS slot generation for all assets at that home
- **Log warning**: `"Skipping PS for home ${homeId}: contracted_demand_kw is NULL"`
- This is expected for homes that don't have demand-based tariffs (residential, small commercial)

---

## 3. Configuration

### Peak Hours (Configurable)

```typescript
// Default: 18:00-22:00 BRT (configurable via vpp_strategies or env)
const PS_PEAK_START_HOUR_BRT = 18;
const PS_PEAK_END_HOUR_BRT = 22;
const PS_DEMAND_THRESHOLD_PCT = 0.85;  // 85% early warning
```

### Why 85% Threshold

- **Too low** (e.g., 50%): generates PS slots too aggressively, wasting battery capacity that could be used for TOU arbitrage
- **Too high** (e.g., 95%): may miss peak events, allowing demand to exceed contracted limit
- **85%**: provides ~15% safety margin, activated only when recent history shows genuine risk

---

## 4. Pool Assignment

| Component | Pool | Rationale |
|-----------|------|-----------|
| schedule-generator (existing) | **Service Pool** | Cross-tenant cron job (v5.11 decision) |
| PS slot generation (new) | **Service Pool** | Same cron context, reads homes/assets cross-tenant |

No pool changes needed. PS logic runs within the existing `runScheduleGenerator()` function.

---

## 5. What Stays Unchanged

| Component | v5.15 Status | v5.16 Status |
|-----------|-------------|-------------|
| SC slot generation | v5.9 | Unchanged |
| TOU (peak_valley_arbitrage) slot generation | v5.9 | Unchanged |
| SoC-aware scheduling | v5.9 | Unchanged |
| PLD dynamic pricing | v5.7 | Unchanged |
| Strategy profiles (vpp_strategies) | v5.6 | Unchanged |

---

## 6. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `optimization-engine/services/schedule-generator.ts` | **MODIFY** | Add: query homes.contracted_demand_kw; evaluate demand risk; insert PS slots to trade_schedules |

---

## 7. Test Strategy

| Test | Input | Expected |
|------|-------|----------|
| PS slot generated | recent peak = 90kW, contracted = 100kW (90% > 85%) | PS slot inserted |
| PS slot NOT generated | recent peak = 80kW, contracted = 100kW (80% < 85%) | No PS slot |
| NULL contracted_demand_kw | home has no contracted demand | Skipped with warning log |
| No recent data | New asset, no 7-day history | No PS slot (safe default) |
| Multiple assets same home | 2 assets, home contracted = 100kW | Both get PS slots |
| PS does not interfere with TOU | Asset has TOU slot at 19:00, PS risk detected | Both slots generated (M3 resolves priority) |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: 4 strategy algorithms |
| v5.5 | 2026-02-28 | Cost optimization, SoC constraints |
| v5.6 | 2026-02-28 | AppConfig Strategy Profiles |
| v5.7 | 2026-02-28 | Dynamic PLD pricing |
| v5.9 | 2026-03-02 | SoC-aware scheduling, schedule generator cron |
| v5.11 | 2026-03-05 | Service Pool for cross-tenant schedule generation |
| **v5.16** | **2026-03-07** | **PS slot generation: read homes.contracted_demand_kw; 7-day demand risk evaluation at 85% threshold; insert peak_shaving slots for peak hours (18:00-22:00 BRT); COALESCE safety for NULL contracted_demand** |
