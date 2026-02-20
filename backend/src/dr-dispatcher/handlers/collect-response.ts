/**
 * DR Dispatcher — Collect Response Handler
 *
 * Triggered by IoT Topic Rule intercepting device mode-change responses
 * on 'solfacil/+/+/response/mode-change'.
 * Skeleton only — will update DynamoDB dispatch record status in Phase 3.
 */
export async function handler(event: unknown): Promise<void> {
  console.log('collect-response received:', JSON.stringify(event));
  // TODO: update DynamoDB dispatch record status for responding device
}
