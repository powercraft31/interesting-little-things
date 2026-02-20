import type { EventBridgeEvent } from 'aws-lambda';
import { createHmac } from 'crypto';

export interface WebhookEvent {
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly orgId: string;
}

export interface WebhookResult {
  readonly success: boolean;
  readonly statusCode: number;
  readonly eventType: string;
  readonly orgId: string;
}

export async function handler(
  event: EventBridgeEvent<'WebhookDelivery', WebhookEvent>,
): Promise<WebhookResult> {
  const { webhookUrl, eventType, payload, orgId } = event.detail;

  if (!webhookUrl) {
    throw new Error('Missing webhookUrl');
  }

  const secret = process.env.WEBHOOK_SECRET ?? '';
  if (!secret) {
    throw new Error('WEBHOOK_SECRET not configured');
  }

  const bodyStr = JSON.stringify(payload);
  const signature = createHmac('sha256', secret)
    .update(bodyStr)
    .digest('hex');

  const headers: Record<string, string> = {
    'x-vpp-signature': `sha256=${signature}`,
    'x-vpp-event-type': eventType,
    'x-vpp-org-id': orgId,
    'Content-Type': 'application/json',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Webhook delivery failed: HTTP ${response.status} from ${webhookUrl}`,
      );
    }

    return {
      success: true,
      statusCode: response.status,
      eventType,
      orgId,
    };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Webhook timeout: ${webhookUrl} did not respond within 10s`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
