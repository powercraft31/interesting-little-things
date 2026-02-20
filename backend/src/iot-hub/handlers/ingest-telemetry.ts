/**
 * IoT Hub — Ingest Telemetry Handler
 *
 * Receives IoT Rule events from the MQTT topic `solfacil/+/+/telemetry`.
 * Skeleton only — will write to Timestream in Phase 2b.
 */
export async function handler(event: unknown): Promise<void> {
  console.log('ingest-telemetry received:', JSON.stringify(event));
  // TODO: parse device_id, asset_type, payload; write to Timestream
}
