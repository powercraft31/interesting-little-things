/**
 * Module 4 — calculate-profit handler tests
 *
 * Deep assertions on Tarifa Branca profit calculation:
 *   1. Standard calculation — hand-verified numbers
 *   2. High peak rate — verifies weighted distribution
 *   3. energyKwh = 0 — returns all zeros, no error
 *   4. Missing orgId → 401
 *   5. Missing tariff → throws Error
 *   6. Invalid tariff hours (≠24) → throws Error
 *   7. Negative energyKwh → returns all zeros
 *   8. Penalty multiplier from AppConfig
 *   9. AppConfig 404 → fallback to default (1.0)
 *  10. AppConfig NetworkError → fallback to default (1.0)
 */

import { handler } from '../../src/market-billing/handlers/calculate-profit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const ASSET_ID = 'asset-solar-001';
const DATE = '2026-02-20';

/** Standard Tarifa Branca: 3h peak, 7h intermediate, 14h off-peak */
const STANDARD_TARIFF = {
  peakRate: 1.50,        // R$/kWh
  offPeakRate: 0.40,     // R$/kWh
  intermediateRate: 0.80, // R$/kWh
  peakHours: 3,
  offPeakHours: 14,
  intermediateHours: 7,
} as const;

const mockFetch = jest.fn();

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    assetId: ASSET_ID,
    date: DATE,
    energyKwh: 240,
    tariff: STANDARD_TARIFF,
    operatingCostPerKwh: 0.10,
    role: 'ORG_MANAGER',
    ...overrides,
  };
}

function parseBody(result: { body: string }) {
  return JSON.parse(result.body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculate-profit handler', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ [ORG_ID]: { tariffPenaltyMultiplier: 1.0 } }),
    });
    global.fetch = mockFetch as any;
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Test 1: Standard calculation — deep numeric assertions ────────────
  it('computes correct grossRevenue / operatingCost / profit for 240 kWh', async () => {
    /**
     * Hand-calculated:
     *   peakEnergy       = 240 × (3/24)  = 30 kWh
     *   offPeakEnergy    = 240 × (14/24) = 140 kWh
     *   intermediateEnergy = 240 × (7/24) = 70 kWh
     *
     *   peakRevenue       = 30  × 1.50 = 45.00
     *   offPeakRevenue    = 140 × 0.40 = 56.00
     *   intermediateRevenue = 70 × 0.80 = 56.00
     *
     *   grossRevenue  = 45 + 56 + 56     = 157.00
     *   operatingCost = 240 × 0.10 × 1.0 = 24.00
     *   profit        = 157.00 - 24.00   = 133.00
     */
    const result = await handler(makeEvent(), {} as any, () => {});

    expect(result.statusCode).toBe(200);

    const body = parseBody(result);
    expect(body.success).toBe(true);

    const d = body.data;
    expect(d.orgId).toBe(ORG_ID);
    expect(d.assetId).toBe(ASSET_ID);
    expect(d.date).toBe(DATE);
    expect(d.energyKwh).toBe(240);

    // ── Deep numeric assertions (hand-verified) ──────────────────────
    expect(d.grossRevenue).toBe(157.00);
    expect(d.operatingCost).toBe(24.00);
    expect(d.profit).toBe(133.00);

    // ── Breakdown assertions ─────────────────────────────────────────
    expect(d.breakdown.peakEnergy).toBe(30);
    expect(d.breakdown.peakRevenue).toBe(45.00);
    expect(d.breakdown.offPeakEnergy).toBe(140);
    expect(d.breakdown.offPeakRevenue).toBe(56.00);
    expect(d.breakdown.intermediateEnergy).toBe(70);
    expect(d.breakdown.intermediateRevenue).toBe(56.00);

    // ── Tenant metadata ──────────────────────────────────────────────
    expect(d._tenant).toEqual({ orgId: ORG_ID, role: 'ORG_MANAGER' });
  });

  // ── Test 2: High peak rate — weighted distribution verification ───────
  it('correctly weights revenue when peakRate is disproportionately high', async () => {
    /**
     * Hand-calculated with high peak:
     *   energyKwh = 120
     *   peakRate = 5.00, offPeakRate = 0.30, intermediateRate = 0.60
     *
     *   peakEnergy       = 120 × (3/24)  = 15 kWh
     *   offPeakEnergy    = 120 × (14/24) = 70 kWh
     *   intermediateEnergy = 120 × (7/24) = 35 kWh
     *
     *   peakRevenue       = 15 × 5.00 = 75.00  ← dominates
     *   offPeakRevenue    = 70 × 0.30 = 21.00
     *   intermediateRevenue = 35 × 0.60 = 21.00
     *
     *   grossRevenue  = 75 + 21 + 21 = 117.00
     *   operatingCost = 120 × 0.15 × 1.0 = 18.00
     *   profit        = 117.00 - 18.00 = 99.00
     */
    const event = makeEvent({
      energyKwh: 120,
      tariff: {
        peakRate: 5.00,
        offPeakRate: 0.30,
        intermediateRate: 0.60,
        peakHours: 3,
        offPeakHours: 14,
        intermediateHours: 7,
      },
      operatingCostPerKwh: 0.15,
    });

    const result = await handler(event, {} as any, () => {});
    const d = parseBody(result).data;

    expect(d.grossRevenue).toBe(117.00);
    expect(d.operatingCost).toBe(18.00);
    expect(d.profit).toBe(99.00);

    // Peak revenue should dominate (75 of 117 = ~64%)
    expect(d.breakdown.peakRevenue).toBe(75.00);
    expect(d.breakdown.peakRevenue).toBeGreaterThan(d.breakdown.offPeakRevenue);
    expect(d.breakdown.peakRevenue).toBeGreaterThan(d.breakdown.intermediateRevenue);
  });

  // ── Test 3: energyKwh = 0 → all zeros, no error ──────────────────────
  it('returns all zeros when energyKwh is 0 (not an error)', async () => {
    const result = await handler(makeEvent({ energyKwh: 0 }), {} as any, () => {});

    expect(result.statusCode).toBe(200);

    const d = parseBody(result).data;
    expect(d.grossRevenue).toBe(0);
    expect(d.operatingCost).toBe(0);
    expect(d.profit).toBe(0);
    expect(d.breakdown).toEqual({
      peakEnergy: 0, peakRevenue: 0,
      offPeakEnergy: 0, offPeakRevenue: 0,
      intermediateEnergy: 0, intermediateRevenue: 0,
    });
  });

  // ── Test 4: Missing orgId → 401 ──────────────────────────────────────
  it('returns 401 when orgId is missing', async () => {
    const result = await handler(makeEvent({ orgId: undefined }), {} as any, () => {});

    expect(result.statusCode).toBe(401);

    const body = parseBody(result);
    expect(body.success).toBe(false);
    expect(body.error).toContain('missing orgId');
  });

  // ── Test 5: Missing tariff → throws Error ─────────────────────────────
  it('throws "Missing tariff data" when tariff is absent', async () => {
    await expect(
      handler(makeEvent({ tariff: undefined }), {} as any, () => {}),
    ).rejects.toThrow('Missing tariff data');
  });

  // ── Test 6: Hours sum ≠ 24 → throws Error ────────────────────────────
  it('throws "Invalid tariff hours" when hours do not sum to 24', async () => {
    const badTariff = {
      ...STANDARD_TARIFF,
      peakHours: 5,       // 5 + 14 + 7 = 26 ≠ 24
    };

    await expect(
      handler(makeEvent({ tariff: badTariff }), {} as any, () => {}),
    ).rejects.toThrow('Invalid tariff hours: must sum to 24');
  });

  // ── Test 7: Negative energyKwh → all zeros (same as 0) ───────────────
  it('returns all zeros when energyKwh is negative', async () => {
    const result = await handler(makeEvent({ energyKwh: -50 }), {} as any, () => {});

    expect(result.statusCode).toBe(200);

    const d = parseBody(result).data;
    expect(d.profit).toBe(0);
    expect(d.grossRevenue).toBe(0);
    expect(d.operatingCost).toBe(0);
  });

  // ── Test 8: Penalty multiplier from AppConfig billing-rules ───────────
  it('applies penalty multiplier from AppConfig billing-rules', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ [ORG_ID]: { tariffPenaltyMultiplier: 2.0 } }),
    });

    const result = await handler(makeEvent(), {} as any, () => {});
    const d = parseBody(result).data;

    // operatingCost = 240 × 0.10 × 2.0 = 48.00
    // profit = 157.00 − 48.00 = 109.00
    expect(d.operatingCost).toBe(48.00);
    expect(d.profit).toBe(109.00);
  });

  // ── Test 9: AppConfig returns 404 → fallback to 1.0 multiplier ────────
  it('falls back to default billing rules (1.0 multiplier) when AppConfig returns 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await handler(makeEvent(), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    const d = parseBody(result).data;
    expect(d.operatingCost).toBe(24.00);
    expect(d.profit).toBe(133.00);
  });

  // ── Test 10: AppConfig throws NetworkError → fallback to 1.0 ──────────
  it('falls back to default billing rules when AppConfig throws NetworkError', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await handler(makeEvent(), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    const d = parseBody(result).data;
    expect(d.operatingCost).toBe(24.00);
    expect(d.profit).toBe(133.00);
  });
});
