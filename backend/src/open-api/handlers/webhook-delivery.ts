import type { EventBridgeEvent } from 'aws-lambda';
import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly orgId: string;
  readonly traceId?: string;
}

export interface WebhookResult {
  readonly success: boolean;
  readonly statusCode: number;
  readonly eventType: string;
  readonly orgId: string;
}

// ---------------------------------------------------------------------------
// AppConfig — 动态 API 配额
// ---------------------------------------------------------------------------

const APPCONFIG_BASE = process.env.APPCONFIG_BASE_URL ?? 'http://localhost:2772';
const APPCONFIG_APP  = process.env.APPCONFIG_APP    ?? 'solfacil-vpp-dev';
const APPCONFIG_ENV  = process.env.APPCONFIG_ENV    ?? 'dev';

interface ApiQuotasConfig {
  readonly [partnerId: string]: {
    readonly webhookTimeoutMs?: number;
    readonly callsPerMinute?: number;
    readonly burstLimit?: number;
  };
}

async function fetchWebhookTimeout(orgId: string): Promise<number> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/api-quotas`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return 10_000;
    const quotas = await res.json() as ApiQuotasConfig;
    return quotas[orgId]?.webhookTimeoutMs ?? 10_000;
  } catch {
    return 10_000;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: EventBridgeEvent<'WebhookDelivery', WebhookEvent>,
): Promise<WebhookResult> {
  const { webhookUrl, eventType, payload, orgId, traceId } = event.detail;

  if (!webhookUrl) {
    throw new Error('Missing webhookUrl');
  }

  const secret = process.env.WEBHOOK_SECRET ?? '';
  if (!secret) {
    throw new Error('WEBHOOK_SECRET not configured');
  }

  const timeoutMs = await fetchWebhookTimeout(orgId);

  console.info(JSON.stringify({
    level: 'INFO',
    traceId,
    module: 'M7',
    action: 'webhook_delivery_start',
    webhookUrl, eventType, orgId, timeoutMs,
  }));

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
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
      throw new Error(`Webhook timeout: ${webhookUrl} did not respond within ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
