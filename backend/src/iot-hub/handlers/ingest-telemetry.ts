/**
 * IoT Hub — Ingest Telemetry Handler
 *
 * Receives IoT Rule events from the MQTT topic `solfacil/+/+/telemetry`.
 * Writes multi-measure records to Amazon Timestream.
 */
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  type _Record,
  type MeasureValue,
} from '@aws-sdk/client-timestream-write';

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

export async function handler(event: TelemetryEvent): Promise<IngestResult> {
  // --- Validation -----------------------------------------------------------
  if (!event.orgId) {
    throw new Error('Missing required field: orgId');
  }
  if (!event.deviceId) {
    throw new Error('Missing required field: deviceId');
  }

  // --- Build MeasureValues --------------------------------------------------
  const measureValues: MeasureValue[] = [
    { Name: 'power', Value: String(event.metrics.power), Type: 'DOUBLE' },
    { Name: 'voltage', Value: String(event.metrics.voltage), Type: 'DOUBLE' },
    { Name: 'current', Value: String(event.metrics.current), Type: 'DOUBLE' },
  ];

  if (event.metrics.soc !== undefined) {
    measureValues.push({
      Name: 'soc',
      Value: String(event.metrics.soc),
      Type: 'DOUBLE',
    });
  }

  // --- Build Timestream record ----------------------------------------------
  const records: _Record[] = [
    {
      Dimensions: [
        { Name: 'orgId', Value: event.orgId },
        { Name: 'deviceId', Value: event.deviceId },
      ],
      MeasureName: 'telemetry',
      MeasureValueType: 'MULTI',
      MeasureValues: measureValues,
      Time: String(new Date(event.timestamp).getTime()),
      TimeUnit: 'MILLISECONDS',
    },
  ];

  // --- Write to Timestream --------------------------------------------------
  const command = new WriteRecordsCommand({
    DatabaseName: process.env.TS_DATABASE_NAME,
    TableName: process.env.TS_TABLE_NAME,
    Records: records,
  });

  await tsClient.send(command);

  return { success: true, recordsWritten: records.length };
}
