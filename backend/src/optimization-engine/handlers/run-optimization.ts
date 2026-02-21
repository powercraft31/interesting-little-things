/**
 * Optimization Engine — Run Optimization Handler
 *
 * Evaluates battery SOC + tariff period to determine optimal charge/discharge
 * mode (energy arbitrage). Publishes the decision to EventBridge so downstream
 * services (DR Dispatcher) can act on it.
 *
 * Arbitrage rules (evaluated in order):
 *   1. Peak + SOC > minSoc  → discharge (sell expensive energy)
 *   2. Off-peak + SOC < maxSoc → charge (buy cheap energy)
 *   3. Otherwise → idle (protect battery / intermediate period)
 *
 * Thresholds (minSoc, maxSoc) are fetched dynamically from AppConfig
 * via the Lambda Extension Sidecar (http://localhost:2772).
 * Falls back to DEFAULT_STRATEGY when AppConfig is unavailable.
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

interface VppStrategyConfig {
  readonly minSoc: number;
  readonly maxSoc: number;
  readonly emergencySoc: number;
  readonly profitMargin: number;
}

interface VppStrategiesConfig {
  readonly [orgId: string]: VppStrategyConfig;
}

// ---------------------------------------------------------------------------
// Environment & Constants
// ---------------------------------------------------------------------------

const EVENT_BUS_NAME  = process.env.EVENT_BUS_NAME      ?? '';
const APPCONFIG_BASE  = process.env.APPCONFIG_BASE_URL   ?? 'http://localhost:2772';
const APPCONFIG_APP   = process.env.APPCONFIG_APP        ?? 'solfacil-vpp-dev';
const APPCONFIG_ENV   = process.env.APPCONFIG_ENV        ?? 'dev';

const DEFAULT_STRATEGY: VppStrategyConfig = {
  minSoc:       20,
  maxSoc:       90,
  emergencySoc: 10,
  profitMargin: 0.15,
};

// ---------------------------------------------------------------------------
// SDK client (instantiated once per Lambda cold-start)
// ---------------------------------------------------------------------------

const eb = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// AppConfig fetcher
// ---------------------------------------------------------------------------

async function fetchVppStrategy(orgId: string): Promise<VppStrategyConfig> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/vpp-strategies`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return DEFAULT_STRATEGY;
    const configs = (await res.json()) as VppStrategiesConfig;
    return configs[orgId] ?? DEFAULT_STRATEGY;
  } catch {
    return DEFAULT_STRATEGY;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: OptimizationEvent): Promise<OptimizationResult> {
  const traceId = `vpp-${crypto.randomUUID()}`;
  const { orgId, assetId, soc, currentTariffPeriod } = event;

  // ── Validation ────────────────────────────────────────────────────────
  if (!orgId || !assetId) {
    throw new Error('Missing required field');
  }
  if (soc < 0 || soc > 100) {
    throw new Error('Invalid SOC value');
  }

  // ── Fetch dynamic strategy from AppConfig ─────────────────────────────
  const strategy = await fetchVppStrategy(orgId);

  // ── Arbitrage decision ────────────────────────────────────────────────
  const targetMode = resolveTargetMode(currentTariffPeriod, soc, strategy.minSoc, strategy.maxSoc);

  console.info(JSON.stringify({
    level: 'INFO',
    traceId,
    module: 'M2',
    action: 'optimization_result',
    assetId,
    orgId,
    targetMode,
    soc,
    tariffPeriod: currentTariffPeriod,
  }));

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
            traceId,
          }),
        },
      ],
    }),
  );

  console.info(JSON.stringify({
    level: 'INFO',
    traceId,
    module: 'M2',
    action: 'event_published',
    dispatchId,
  }));

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
  minSoc: number,
  maxSoc: number,
): TargetMode {
  if (period === 'peak' && soc > minSoc) return 'discharge';
  if (period === 'off-peak' && soc < maxSoc) return 'charge';
  return 'idle';
}
