/**
 * IoT Hub — Ingest Telemetry Handler
 *
 * Receives IoT Rule events from the MQTT topic `solfacil/+/+/telemetry`.
 * Normalises vendor-specific payloads via the Anti-Corruption Layer (ACL),
 * then writes multi-measure records to Amazon Timestream.
 */
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  type _Record,
  type MeasureValue,
} from '@aws-sdk/client-timestream-write';
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
}

// Cold-start optimisation: client initialised once per Lambda container
const tsClient = new TimestreamWriteClient({});

export async function handler(event: unknown): Promise<IngestResult> {
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

  return { success: true, recordsWritten: records.length };
}
