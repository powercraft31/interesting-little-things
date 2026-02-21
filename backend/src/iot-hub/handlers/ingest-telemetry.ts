/**
 * IoT Hub — Ingest Telemetry Handler
 *
 * Receives IoT Rule events from the MQTT topic `solfacil/+/+/telemetry`.
 * Normalises vendor-specific payloads via:
 *   1. AppConfig dynamic parser rules (fetched from Lambda Extension Sidecar)
 *   2. Anti-Corruption Layer (ACL) static adapters (fallback)
 * Then writes multi-measure records to Amazon Timestream and publishes
 * a TelemetryIngested event to EventBridge with a traceId for distributed tracing.
 */
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  type _Record,
  type MeasureValue,
} from '@aws-sdk/client-timestream-write';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { resolveAdapter } from '../parsers/AdapterRegistry';

export interface TelemetryEvent {
  orgId: string;
  deviceId: string;
  timestamp: string; // ISO 8601
  metrics: {
    power: number;    // kW
    voltage: number;  // V
    current: number;  // A
    soc?: number;     // % optional
  };
}

interface IngestResult {
  success: true;
  recordsWritten: number;
  traceId: string;
}

// ---------------------------------------------------------------------------
// AppConfig types
// ---------------------------------------------------------------------------

interface ParserRule {
  readonly mappingRule: Record<string, string>;
  readonly unitConversions?: Record<string, { factor: number; offset?: number }>;
}

interface ParserRulesConfig {
  readonly [orgId: string]: Record<string, ParserRule>; // orgId → manufacturer → rule
}

// ---------------------------------------------------------------------------
// Cold-start: clients & constants
// ---------------------------------------------------------------------------

const tsClient = new TimestreamWriteClient({});
const ebClient = new EventBridgeClient({});

const APPCONFIG_BASE = process.env.APPCONFIG_BASE_URL ?? 'http://localhost:2772';
const APPCONFIG_APP  = process.env.APPCONFIG_APP      ?? 'solfacil-vpp-dev';
const APPCONFIG_ENV  = process.env.APPCONFIG_ENV      ?? 'dev';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME     ?? '';

// ---------------------------------------------------------------------------
// AppConfig fetcher
// ---------------------------------------------------------------------------

async function fetchParserRules(orgId: string): Promise<Record<string, ParserRule>> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/parser-rules`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return {};
    const configs = (await res.json()) as ParserRulesConfig;
    return configs[orgId] ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Dynamic mapping engine
// ---------------------------------------------------------------------------

function applyDynamicMapping(
  raw: Record<string, unknown>,
  rule: ParserRule,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [srcField, destField] of Object.entries(rule.mappingRule)) {
    if (raw[srcField] !== undefined) {
      mapped[destField] = raw[srcField];
    }
  }

  // Apply unit conversions (e.g., W → kW: factor = 0.001)
  if (rule.unitConversions) {
    for (const [destField, conv] of Object.entries(rule.unitConversions)) {
      if (typeof mapped[destField] === 'number') {
        mapped[destField] = (mapped[destField] as number) * conv.factor + (conv.offset ?? 0);
      }
    }
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: unknown): Promise<IngestResult> {
  const traceId = `vpp-${crypto.randomUUID()}`;
  const raw = event as Record<string, unknown>;
  const orgId = raw.orgId as string | undefined;

  // --- Validation (orgId always at top level, injected by IoT Rule) --------
  if (!orgId) {
    throw new Error('Missing required field: orgId');
  }

  // --- ACL: normalize vendor-specific payloads -----------------------------
  let deviceId: string;
  let timestamp: string;
  let power: number;
  let voltage: number | undefined;
  let current: number | undefined;
  let soc: number | undefined;

  // Try AppConfig dynamic parser rules first
  const parserRules = await fetchParserRules(orgId);
  const manufacturer = (raw.manufacturer as string | undefined) ?? 'native';
  const rule = parserRules[manufacturer];

  if (rule && Object.keys(rule.mappingRule).length > 0) {
    const mapped = applyDynamicMapping(raw, rule);
    deviceId  = (mapped.deviceId as string) ?? '';
    timestamp = (mapped.timestamp as string) ?? new Date().toISOString();
    power     = (mapped.power as number) ?? 0;
    voltage   = mapped.voltage as number | undefined;
    current   = mapped.current as number | undefined;
    soc       = mapped.soc as number | undefined;
  } else {
    // Fall back to existing ACL resolveAdapter logic
    try {
      const adapter = resolveAdapter(event);
      const telemetry = adapter.normalize(event, orgId);
      deviceId  = telemetry.deviceId;
      timestamp = telemetry.timestamp;
      power     = telemetry.metrics.power;
      voltage   = telemetry.metrics.voltage;
      current   = telemetry.metrics.current;
      soc       = telemetry.metrics.soc;
    } catch {
      // Fallback: legacy TelemetryEvent shape (structured metrics object)
      const e = raw as unknown as TelemetryEvent;
      deviceId  = e.deviceId ?? '';
      timestamp = e.timestamp ?? new Date().toISOString();
      power     = e.metrics?.power ?? 0;
      voltage   = e.metrics?.voltage;
      current   = e.metrics?.current;
      soc       = e.metrics?.soc;
    }
  }

  if (!deviceId) {
    throw new Error('Missing required field: deviceId');
  }

  // --- Build MeasureValues ------------------------------------------------
  const measureValues: MeasureValue[] = [
    { Name: 'power', Value: String(power), Type: 'DOUBLE' },
  ];

  if (voltage !== undefined) {
    measureValues.push({ Name: 'voltage', Value: String(voltage), Type: 'DOUBLE' });
  }

  if (current !== undefined) {
    measureValues.push({ Name: 'current', Value: String(current), Type: 'DOUBLE' });
  }

  if (soc !== undefined) {
    measureValues.push({
      Name: 'soc',
      Value: String(soc),
      Type: 'DOUBLE',
    });
  }

  // --- Build Timestream record --------------------------------------------
  const records: _Record[] = [
    {
      Dimensions: [
        { Name: 'orgId', Value: orgId },
        { Name: 'deviceId', Value: deviceId },
      ],
      MeasureName: 'telemetry',
      MeasureValueType: 'MULTI',
      MeasureValues: measureValues,
      Time: String(new Date(timestamp).getTime()),
      TimeUnit: 'MILLISECONDS',
    },
  ];

  // --- Write to Timestream ------------------------------------------------
  const command = new WriteRecordsCommand({
    DatabaseName: process.env.TS_DATABASE_NAME,
    TableName: process.env.TS_TABLE_NAME,
    Records: records,
  });

  await tsClient.send(command);

  // --- Publish TelemetryIngested event with traceId -----------------------
  if (EVENT_BUS_NAME) {
    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EVENT_BUS_NAME,
        Source: 'solfacil.vpp.iot-hub',
        DetailType: 'TelemetryIngested',
        Detail: JSON.stringify({
          orgId,
          deviceId,
          power,
          soc,
          timestamp,
          traceId,
        }),
      }],
    }));
  }

  console.info(JSON.stringify({
    level: 'INFO',
    traceId,
    module: 'M1',
    action: 'telemetry_ingested',
    orgId,
    deviceId,
    power,
    soc,
  }));

  return { success: true, recordsWritten: records.length, traceId };
}
