/**
 * Optimization Engine — Run Optimization Handler
 *
 * Evaluates battery SOC + tariff period to determine optimal charge/discharge
 * mode (energy arbitrage). Publishes the decision to EventBridge so downstream
 * services (DR Dispatcher) can act on it.
 *
 * Arbitrage rules (evaluated in order):
 *   1. Peak + SOC > 20%  → discharge (sell expensive energy)
 *   2. Off-peak + SOC < 90% → charge (buy cheap energy)
 *   3. Otherwise → idle (protect battery / intermediate period)
 */
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OptimizationEvent {
  readonly orgId: string;
  readonly assetId: string;
  readonly soc: number;
  readonly currentTariffPeriod: 'peak' | 'off-peak' | 'intermediate';
}

type TargetMode = 'discharge' | 'charge' | 'idle';

interface OptimizationResult {
  readonly success: true;
  readonly data: {
    readonly assetId: string;
    readonly orgId: string;
    readonly targetMode: TargetMode;
    readonly soc: number;
    readonly tariffPeriod: string;
    readonly dispatchId: string;
    readonly eventPublished: true;
  };
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';

// ---------------------------------------------------------------------------
// SDK client (instantiated once per Lambda cold-start)
// ---------------------------------------------------------------------------

const eb = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: OptimizationEvent): Promise<OptimizationResult> {
  const { orgId, assetId, soc, currentTariffPeriod } = event;

  // ── Validation ────────────────────────────────────────────────────────
  if (!orgId || !assetId) {
    throw new Error('Missing required field');
  }
  if (soc < 0 || soc > 100) {
    throw new Error('Invalid SOC value');
  }

  // ── Arbitrage decision ────────────────────────────────────────────────
  const targetMode = resolveTargetMode(currentTariffPeriod, soc);

  console.info('[run-optimization] Decision', {
    assetId,
    orgId,
    targetMode,
    soc,
    tariffPeriod: currentTariffPeriod,
  });

  // ── Publish to EventBridge ────────────────────────────────────────────
  const dispatchId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: 'solfacil.optimization-engine',
          DetailType: 'DRCommandIssued',
          Detail: JSON.stringify({
            dispatchId,
            assetId,
            orgId,
            targetMode,
            soc,
            tariffPeriod: currentTariffPeriod,
            timestamp,
          }),
        },
      ],
    }),
  );

  console.info('[run-optimization] Event published', { dispatchId });

  return {
    success: true,
    data: {
      assetId,
      orgId,
      targetMode,
      soc,
      tariffPeriod: currentTariffPeriod,
      dispatchId,
      eventPublished: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTargetMode(
  period: 'peak' | 'off-peak' | 'intermediate',
  soc: number,
): TargetMode {
  if (period === 'peak' && soc > 20) return 'discharge';
  if (period === 'off-peak' && soc < 90) return 'charge';
  return 'idle';
}
