/**
 * DR Dispatcher — Dispatch Command Handler
 *
 * Triggered by EventBridge rule matching DRCommandIssued events from BFF.
 * Skeleton only — will write dispatch records to DynamoDB, broadcast MQTT
 * to devices, and enqueue timeout messages in Phase 3.
 */
export async function handler(event: unknown): Promise<void> {
  console.log('dispatch-command received:', JSON.stringify(event));
  // TODO: write dispatch record to DynamoDB, broadcast MQTT to devices, enqueue timeout message
}
