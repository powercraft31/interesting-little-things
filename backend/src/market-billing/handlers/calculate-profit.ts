/**
 * Market & Billing — Calculate Profit
 *
 * Pure computation Lambda: calculates revenue/cost/profit per asset per day
 * using Tarifa Branca weighted energy distribution.
 *
 * Input: ProfitRequest event (direct invocation, not API Gateway).
 * No DB connection required — tariff data is passed in the event.
 */
import type { Handler } from 'aws-lambda';
import { ok, fail } from '../../shared/types/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Tariff {
  readonly peakRate: number;
  readonly offPeakRate: number;
  readonly intermediateRate: number;
  readonly peakHours: number;
  readonly offPeakHours: number;
  readonly intermediateHours: number;
}

interface ProfitRequest {
  readonly orgId?: string;
  readonly assetId?: string;
  readonly date?: string;
  readonly energyKwh?: number;
  readonly tariff?: Partial<Tariff>;
  readonly operatingCostPerKwh?: number;
  readonly role?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOTAL_HOURS = 24;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isTariffComplete(t: Partial<Tariff> | undefined): t is Tariff {
  if (!t) return false;
  return (
    t.peakRate != null &&
    t.offPeakRate != null &&
    t.intermediateRate != null &&
    t.peakHours != null &&
    t.offPeakHours != null &&
    t.intermediateHours != null
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: Handler = async (event: ProfitRequest) => {
  // ── Auth gate: orgId required ─────────────────────────────────────────
  if (!event.orgId) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fail('Unauthorized: missing orgId')),
    };
  }

  const { orgId, assetId, date, energyKwh, tariff, operatingCostPerKwh, role } = event;

  // ── Zero / negative energy → all zeros (not an error) ────────────────
  if (!energyKwh || energyKwh <= 0) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ok({
        orgId, assetId, date,
        energyKwh: energyKwh ?? 0,
        grossRevenue: 0,
        operatingCost: 0,
        profit: 0,
        breakdown: {
          peakEnergy: 0, peakRevenue: 0,
          offPeakEnergy: 0, offPeakRevenue: 0,
          intermediateEnergy: 0, intermediateRevenue: 0,
        },
        _tenant: { orgId, role },
      })),
    };
  }

  // ── Validate tariff completeness ─────────────────────────────────────
  if (!isTariffComplete(tariff)) {
    throw new Error('Missing tariff data');
  }

  // ── Validate hours sum to 24 ─────────────────────────────────────────
  const hoursSum = tariff.peakHours + tariff.offPeakHours + tariff.intermediateHours;
  if (hoursSum !== TOTAL_HOURS) {
    throw new Error('Invalid tariff hours: must sum to 24');
  }

  // ── Energy distribution (weighted by time-of-use) ────────────────────
  const peakEnergy = round2(energyKwh * (tariff.peakHours / TOTAL_HOURS));
  const offPeakEnergy = round2(energyKwh * (tariff.offPeakHours / TOTAL_HOURS));
  const intermediateEnergy = round2(energyKwh * (tariff.intermediateHours / TOTAL_HOURS));

  // ── Revenue per period ───────────────────────────────────────────────
  const peakRevenue = round2(peakEnergy * tariff.peakRate);
  const offPeakRevenue = round2(offPeakEnergy * tariff.offPeakRate);
  const intermediateRevenue = round2(intermediateEnergy * tariff.intermediateRate);

  // ── Totals ───────────────────────────────────────────────────────────
  const grossRevenue = round2(peakRevenue + offPeakRevenue + intermediateRevenue);
  const operatingCost = round2(energyKwh * (operatingCostPerKwh ?? 0));
  const profit = round2(grossRevenue - operatingCost);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ok({
      orgId, assetId, date,
      energyKwh,
      grossRevenue,
      operatingCost,
      profit,
      breakdown: {
        peakEnergy, peakRevenue,
        offPeakEnergy, offPeakRevenue,
        intermediateEnergy, intermediateRevenue,
      },
      _tenant: { orgId, role },
    })),
  };
};
