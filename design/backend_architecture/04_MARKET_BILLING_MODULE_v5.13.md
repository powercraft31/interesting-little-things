# M4: Market & Billing Module — Tarifa Branca Deterministic Math

> **模組版本**: v5.13
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.13.md](./00_MASTER_ARCHITECTURE_v5.13.md)
> **最後更新**: 2026-03-05
> **說明**: Block 2 — Revenue/savings formulas using Tarifa Branca rates × real aggregated data
> **核心主題**: daily-billing-job.ts 升級為 Tarifa Branca C-side savings + Optimization Alpha

---

## v5.13 升版說明

### 問題陳述

The current `daily-billing-job.ts` calculates revenue using:
1. **VPP arbitrage profit** = discharge × PLD wholesale price (CCEE PLD) — but CCEE PLD wholesale market is **not yet regulated** for distributed storage (2028+ expected). The `pld_horario` table has placeholder data.
2. **Client savings** = discharge × `retail_buy_rate_kwh` — a flat rate from `assets` table, ignoring time-of-use.

Neither calculation uses the Tarifa Branca 3-tier rate structure that is **legally applicable today** for C-side bill savings. The formulas also lack PV generation, grid import/export, and self-consumption metrics.

### 解決方案

Enhance `daily-billing-job.ts` to:
1. Join `tariff_schedules` for per-org Tarifa Branca rates
2. Use hour-level charge/discharge from `asset_hourly_metrics` (with v5.13 new columns)
3. Calculate Tarifa Branca C-side savings per hour using `shared/tarifa.ts` pure functions
4. Calculate Optimization Alpha per asset
5. Calculate self-consumption ratio using PV and grid export data
6. Populate `revenue_daily` with all computed fields

---

## 1. Current vs. v5.13 Billing Logic

### Current (v5.12)

```
daily-billing-job.ts
  │
  ├── Read: asset_hourly_metrics (charge + discharge only)
  ├── Read: pld_horario (CCEE PLD wholesale — placeholder data)
  ├── Read: assets.retail_buy_rate_kwh (flat rate)
  │
  └── Write: revenue_daily
        ├── vpp_arbitrage_profit_reais = discharge × PLD / 1000
        └── client_savings_reais = discharge × flat_retail_rate
```

### v5.13 (Tarifa Branca)

```
daily-billing-job.ts
  │
  ├── Read: asset_hourly_metrics (charge + discharge + pv + grid + load + soc)
  ├── Read: tariff_schedules (peak_rate, offpeak_rate, intermediate_rate per org)
  ├── Read: assets (capacity_kwh for Alpha calculation)
  │
  ├── Calculate: Tarifa Branca savings per hour (shared/tarifa.ts)
  ├── Calculate: Optimization Alpha (shared/tarifa.ts)
  ├── Calculate: Self-consumption ratio (shared/tarifa.ts)
  │
  └── Write: revenue_daily
        ├── vpp_arbitrage_profit_reais = KEEP (PLD — future-proofing, still calculated)
        ├── client_savings_reais = Σ(discharge_h × rate_h - charge_h × offpeak_rate)
        ├── actual_self_consumption_pct = (pv - grid_export) / pv × 100
        ├── pv_energy_kwh = Σ pv_generation_kwh
        ├── grid_export_kwh = Σ grid_export_kwh
        ├── grid_import_kwh = Σ grid_import_kwh
        └── bat_discharged_kwh = Σ total_discharge_kwh
```

---

## 2. Enhanced daily-billing-job.ts

### 2.1 Main Query — Hour-Level Aggregation

```typescript
export async function runDailyBilling(pool: Pool): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  // Step 1: Fetch hour-level metrics for yesterday, per asset
  const hourlyResult = await pool.query<{
    asset_id: string;
    org_id: string;
    capacity_kwh: number;
    hour: number;
    total_charge_kwh: number;
    total_discharge_kwh: number;
    pv_generation_kwh: number;
    grid_import_kwh: number;
    grid_export_kwh: number;
  }>(
    `SELECT
       ahm.asset_id,
       a.org_id,
       a.capacity_kwh,
       EXTRACT(HOUR FROM ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo')::INT AS hour,
       ahm.total_charge_kwh,
       ahm.total_discharge_kwh,
       ahm.pv_generation_kwh,
       ahm.grid_import_kwh,
       ahm.grid_export_kwh
     FROM asset_hourly_metrics ahm
     JOIN assets a ON a.asset_id = ahm.asset_id
     WHERE DATE(ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo') = $1::date
     ORDER BY ahm.asset_id, ahm.hour_timestamp`,
    [dateStr],
  );

  // Step 2: Fetch tariff schedules per org (active as of yesterday)
  const tariffResult = await pool.query<{
    org_id: string;
    peak_rate: number;
    offpeak_rate: number;
    intermediate_rate: number | null;
  }>(
    `SELECT DISTINCT ON (org_id)
       org_id, peak_rate, offpeak_rate, intermediate_rate
     FROM tariff_schedules
     WHERE effective_from <= $1::date
       AND (effective_to IS NULL OR effective_to >= $1::date)
     ORDER BY org_id, effective_from DESC`,
    [dateStr],
  );

  const tariffByOrg = new Map(
    tariffResult.rows.map(r => [r.org_id, {
      peakRate: Number(r.peak_rate),
      offpeakRate: Number(r.offpeak_rate),
      intermediateRate: r.intermediate_rate ? Number(r.intermediate_rate) : null,
    }]),
  );

  // Step 3: Group hourly data by asset, compute daily totals
  const assetMap = new Map<string, {
    orgId: string;
    capacityKwh: number;
    hours: Array<{ hour: number; chargeKwh: number; dischargeKwh: number }>;
    totalPvKwh: number;
    totalGridImportKwh: number;
    totalGridExportKwh: number;
    totalDischargeKwh: number;
    totalChargeKwh: number;
  }>();

  for (const row of hourlyResult.rows) {
    let entry = assetMap.get(row.asset_id);
    if (!entry) {
      entry = {
        orgId: row.org_id,
        capacityKwh: Number(row.capacity_kwh),
        hours: [],
        totalPvKwh: 0,
        totalGridImportKwh: 0,
        totalGridExportKwh: 0,
        totalDischargeKwh: 0,
        totalChargeKwh: 0,
      };
      assetMap.set(row.asset_id, entry);
    }
    entry.hours.push({
      hour: row.hour,
      chargeKwh: Number(row.total_charge_kwh),
      dischargeKwh: Number(row.total_discharge_kwh),
    });
    entry.totalPvKwh += Number(row.pv_generation_kwh);
    entry.totalGridImportKwh += Number(row.grid_import_kwh);
    entry.totalGridExportKwh += Number(row.grid_export_kwh);
    entry.totalDischargeKwh += Number(row.total_discharge_kwh);
    entry.totalChargeKwh += Number(row.total_charge_kwh);
  }

  // Step 4: Calculate and UPSERT per asset
  for (const [assetId, entry] of assetMap) {
    const schedule = tariffByOrg.get(entry.orgId) ?? null;

    // Import shared pure functions
    const { calculateDailySavings, calculateOptimizationAlpha, calculateSelfConsumption }
      = await import("../../shared/tarifa");

    const clientSavings = calculateDailySavings(entry.hours, schedule ?? {
      peakRate: 0.82, offpeakRate: 0.25, intermediateRate: 0.55,
    });

    const alpha = calculateOptimizationAlpha(
      clientSavings,
      entry.capacityKwh,
      schedule ?? { peakRate: 0.82, offpeakRate: 0.25, intermediateRate: 0.55 },
      1, // 1 day
    );

    const selfConsumption = calculateSelfConsumption(
      entry.totalPvKwh,
      entry.totalGridExportKwh,
    );

    // PLD arbitrage (kept for future-proofing, same as v5.12)
    // ... (unchanged PLD query omitted for brevity — same JOIN to pld_horario)
    const arbitrageProfit = 0; // placeholder until PLD data is real

    await pool.query(
      `INSERT INTO revenue_daily
         (asset_id, date,
          vpp_arbitrage_profit_reais, client_savings_reais,
          revenue_reais, cost_reais, profit_reais,
          actual_self_consumption_pct,
          pv_energy_kwh, grid_export_kwh, grid_import_kwh, bat_discharged_kwh,
          calculated_at)
       VALUES ($1, $2, $3, $4, $4, 0, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (asset_id, date) DO UPDATE SET
         vpp_arbitrage_profit_reais  = EXCLUDED.vpp_arbitrage_profit_reais,
         client_savings_reais        = EXCLUDED.client_savings_reais,
         revenue_reais               = EXCLUDED.revenue_reais,
         profit_reais                = EXCLUDED.profit_reais,
         actual_self_consumption_pct = EXCLUDED.actual_self_consumption_pct,
         pv_energy_kwh               = EXCLUDED.pv_energy_kwh,
         grid_export_kwh             = EXCLUDED.grid_export_kwh,
         grid_import_kwh             = EXCLUDED.grid_import_kwh,
         bat_discharged_kwh          = EXCLUDED.bat_discharged_kwh,
         calculated_at               = EXCLUDED.calculated_at`,
      [
        assetId, dateStr,
        arbitrageProfit, clientSavings,
        selfConsumption,
        entry.totalPvKwh, entry.totalGridExportKwh, entry.totalGridImportKwh,
        entry.totalDischargeKwh,
      ],
    );
  }

  console.log(`[BillingJob] Settled ${assetMap.size} assets for ${dateStr}`);
}
```

---

## 3. Formula Reference

### 3.1 Tarifa Branca C-Side Savings (per day)

```
For each hour h in [0..23]:
  period = classifyHour(h)  →  'ponta' | 'intermediaria' | 'fora_ponta'
  rate_h = tariff_schedules[period]
  savings_h = discharge_kwh[h] × rate_h  −  charge_kwh[h] × offpeak_rate

daily_savings = Σ savings_h
```

**Business meaning:** Customer saves by discharging battery during peak hours (avoiding R$0.82/kWh grid purchase) and charging during off-peak (only R$0.25/kWh grid cost). The net savings is the difference.

### 3.2 Optimization Alpha

```
actual_savings = daily_savings (from 3.1)
theoretical_max = capacity_kwh × (peak_rate − offpeak_rate) × days
alpha = (actual_savings / theoretical_max) × 100

Where:
  capacity_kwh = assets.capacity_kwh (battery nameplate capacity)
  peak_rate = tariff_schedules.peak_rate (R$0.82)
  offpeak_rate = tariff_schedules.offpeak_rate (R$0.25)
```

**Interpretation:**
- Alpha = 100% → battery performed one full cycle per day at maximum rate spread
- Alpha = 50% → half the theoretical maximum was captured
- Alpha > 100% → possible via multiple cycles or intermediate rate exploitation

### 3.3 Self-Consumption Ratio

```
self_consumption = (pv_generation − grid_export) / pv_generation × 100

Where:
  pv_generation = Σ asset_hourly_metrics.pv_generation_kwh
  grid_export = Σ asset_hourly_metrics.grid_export_kwh
```

**Business meaning:** Percentage of solar energy consumed on-site vs. exported to grid.

---

## 4. revenue_daily Column Usage After v5.13

| Column | Source | v5.12 Status | v5.13 Status |
|--------|--------|-------------|-------------|
| `vpp_arbitrage_profit_reais` | PLD × discharge | Placeholder PLD | **Kept** (future-proofing) |
| `client_savings_reais` | Tarifa Branca formula | Flat rate × discharge | **UPGRADED** → hour-level Tarifa Branca |
| `revenue_reais` | = client_savings | = arbitrage_profit | **CHANGED** → = client_savings |
| `profit_reais` | = client_savings | = arbitrage_profit | **CHANGED** → = client_savings |
| `actual_self_consumption_pct` | PV - export / PV | NULL | **NEW** → calculated |
| `pv_energy_kwh` | Σ pv_generation_kwh | NULL | **NEW** → populated |
| `grid_export_kwh` | Σ grid_export_kwh | NULL | **NEW** → populated |
| `grid_import_kwh` | Σ grid_import_kwh | NULL | **NEW** → populated |
| `bat_discharged_kwh` | Σ total_discharge_kwh | NULL | **NEW** → populated |
| `tariff_schedule_id` | FK to tariff_schedules | NULL | Populated (future) |
| `calculated_at` | NOW() | NULL | **NEW** → populated |

---

## 5. Pool & Boundary Rules

| Rule | Enforcement |
|------|-------------|
| M4 reads `asset_hourly_metrics` only (never `telemetry_history`) | Code review + test assertion |
| M4 uses Service Pool (cross-tenant batch job) | `getServicePool()` at job startup |
| M4 reads `tariff_schedules` via Service Pool (no RLS needed for batch) | BYPASSRLS role |
| Pure functions from `shared/tarifa.ts` have no DB access | Type system — no Pool parameter |

---

## 6. What Stays Out of Scope

| Metric | Why Out of Scope | When |
|--------|-----------------|------|
| CCEE PLD wholesale arbitrage | Not regulated for distributed storage | v6.0+ (2028) |
| Demand charge savings (Peak Shaving) | Needs demand meter data integration | v6.0 |
| DR subsidy revenue | ANEEL DR framework not finalized | v6.0+ (2028) |
| Multi-cycle optimization | Requires M2 greedy algorithm (currently `hour%4`) | v6.0 |

---

## 7. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `market-billing/services/daily-billing-job.ts` | **MODIFY** | Replace flat-rate savings with hour-level Tarifa Branca; add self-consumption + Optimization Alpha |
| `market-billing/handlers/get-tariff-schedule.ts` | **unchanged** | Read-only tariff API, already correct |
| `market-billing/handlers/calculate-profit.ts` | **unchanged** | On-demand profit calculation (ad-hoc) |
| `shared/tarifa.ts` | **dependency** | Pure functions consumed by billing job |

---

## 8. 測試策略

| Test | Input | Expected Output |
|------|-------|-----------------|
| Tarifa Branca savings — peak-only discharge | 3h × 3kW discharge at peak | 9 × 0.82 = R$7.38 |
| Tarifa Branca savings — off-peak charge + peak discharge | 4h charge + 3h discharge | R$7.38 - (12 × 0.25) = R$4.38 |
| Optimization Alpha — perfect cycle | savings=5.70, cap=10kWh, 1 day | 5.70/(10×0.57) = 100% |
| Self-consumption — no export | pv=15kWh, export=0 | 100.0% |
| Self-consumption — 50% export | pv=15kWh, export=7.5 | 50.0% |
| revenue_daily UPSERT — idempotent | Run billing twice for same date | Same values, no duplicates |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：Lambda + DynamoDB billing |
| v5.5 | 2026-02-28 | 雙層經濟模型 — VPP arbitrage + client savings |
| v5.6 | 2026-02-28 | PLD hourly data import pipeline |
| v5.8 | 2026-03-02 | Data Contract — reads asset_hourly_metrics only |
| v5.11 | 2026-03-05 | Service Pool for daily billing batch job |
| **v5.13** | **2026-03-05** | **Block 2: Tarifa Branca C-side savings (hour-level 3-tier rates from tariff_schedules); Optimization Alpha per asset; self-consumption ratio from PV/grid data; revenue_daily fully populated (pv_energy_kwh, grid_import/export_kwh, bat_discharged_kwh, actual_self_consumption_pct); pure functions from shared/tarifa.ts** |
