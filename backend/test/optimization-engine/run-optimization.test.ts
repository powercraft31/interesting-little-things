// Mock global.fetch for AppConfig Sidecar BEFORE module import
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

// ---------------------------------------------------------------------------
// Mock SDK client BEFORE importing handler (module-level singleton)
// ---------------------------------------------------------------------------

const ebMock = mockClient(EventBridgeClient);

// Set env vars before importing handler
process.env.EVENT_BUS_NAME = 'solfacil-vpp-bus';

import { handler } from '../../src/optimization-engine/handlers/run-optimization';

// ---------------------------------------------------------------------------
// Test event factory
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<{
    orgId: string;
    assetId: string;
    soc: number;
    currentTariffPeriod: 'peak' | 'off-peak' | 'intermediate';
  }> = {},
) {
  return {
    orgId: overrides.orgId ?? 'ORG_ENERGIA_001',
    assetId: overrides.assetId ?? 'ASSET_SP_001',
    soc: overrides.soc ?? 50,
    currentTariffPeriod: overrides.currentTariffPeriod ?? 'peak',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first Entries[0].Detail from PutEventsCommand, parsed as JSON */
function extractPublishedDetail(): Record<string, unknown> {
  const calls = ebMock.commandCalls(PutEventsCommand);
  expect(calls).toHaveLength(1);
  const entries = calls[0].args[0].input.Entries!;
  expect(entries).toHaveLength(1);
  return JSON.parse(entries[0].Detail!);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('run-optimization handler', () => {
  beforeEach(() => {
    ebMock.reset();
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
    // Mock AppConfig returning default strategy (minSoc:20, maxSoc:90)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ORG_ENERGIA_001: { minSoc: 20, maxSoc: 90, emergencySoc: 10, profitMargin: 0.15 },
      }),
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Core arbitrage scenarios ──────────────────────────────────────────

  it('peak + high SOC → discharge (sell expensive energy)', async () => {
    const result = await handler(
      makeEvent({ currentTariffPeriod: 'peak', soc: 80 }),
    );

    expect(result.success).toBe(true);
    expect(result.data.targetMode).toBe('discharge');

    // Deep assertion on EventBridge payload
    const detail = extractPublishedDetail();
    expect(detail.targetMode).toBe('discharge');
    expect(detail.dispatchId).toBeDefined();
    expect(detail.assetId).toBe('ASSET_SP_001');
    expect(detail.orgId).toBe('ORG_ENERGIA_001');
    expect(detail.soc).toBe(80);
    expect(detail.tariffPeriod).toBe('peak');
    expect(detail.timestamp).toBeDefined();
  });

  it('off-peak + low SOC → charge (buy cheap energy)', async () => {
    const result = await handler(
      makeEvent({ currentTariffPeriod: 'off-peak', soc: 30 }),
    );

    expect(result.success).toBe(true);
    expect(result.data.targetMode).toBe('charge');

    const detail = extractPublishedDetail();
    expect(detail.targetMode).toBe('charge');
    expect(detail.dispatchId).toBeDefined();
    expect(detail.soc).toBe(30);
    expect(detail.tariffPeriod).toBe('off-peak');
  });

  it('peak + low SOC → idle (battery protection, no discharge)', async () => {
    const result = await handler(
      makeEvent({ currentTariffPeriod: 'peak', soc: 15 }),
    );

    expect(result.success).toBe(true);
    expect(result.data.targetMode).toBe('idle');

    const detail = extractPublishedDetail();
    expect(detail.targetMode).toBe('idle');
    expect(detail.dispatchId).toBeDefined();
    expect(detail.soc).toBe(15);
  });

  // ── Boundary value tests ──────────────────────────────────────────────

  it('off-peak + soc=90 → idle (stop charging, avoid overcharge)', async () => {
    const result = await handler(
      makeEvent({ currentTariffPeriod: 'off-peak', soc: 90 }),
    );

    expect(result.success).toBe(true);
    expect(result.data.targetMode).toBe('idle');

    const detail = extractPublishedDetail();
    expect(detail.targetMode).toBe('idle');
    expect(detail.dispatchId).toBeDefined();
    expect(detail.soc).toBe(90);
  });

  // ── Validation tests ──────────────────────────────────────────────────

  it('missing orgId → throws "Missing required field"', async () => {
    await expect(
      handler(makeEvent({ orgId: '' })),
    ).rejects.toThrow('Missing required field');

    // No EventBridge call should have been made
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('soc=150 (out of range) → throws "Invalid SOC value"', async () => {
    await expect(
      handler(makeEvent({ soc: 150 })),
    ).rejects.toThrow('Invalid SOC value');

    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  // ── AppConfig dynamic thresholds ──────────────────────────────────────

  it('uses dynamic thresholds from AppConfig (custom minSoc=30, maxSoc=85)', async () => {
    // Override mock: return custom strategy
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ORG_ENERGIA_001: { minSoc: 30, maxSoc: 85, emergencySoc: 15, profitMargin: 0.20 },
      }),
    });

    // SOC=25 is above default minSoc(20) but below custom minSoc(30)
    // → should be idle with custom strategy, not discharge
    const result = await handler(makeEvent({ currentTariffPeriod: 'peak', soc: 25 }));
    expect(result.data.targetMode).toBe('idle');
  });

  it('falls back to default strategy when AppConfig is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    // Default minSoc=20, so soc=80 peak → discharge
    const result = await handler(makeEvent({ currentTariffPeriod: 'peak', soc: 80 }));
    expect(result.success).toBe(true);
    expect(result.data.targetMode).toBe('discharge');
  });

  it('publishes traceId in EventBridge detail', async () => {
    await handler(makeEvent({ currentTariffPeriod: 'peak', soc: 80 }));
    const detail = extractPublishedDetail();
    expect(detail.traceId).toMatch(/^vpp-[0-9a-f-]{36}$/);
  });
});
