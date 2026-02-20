import { createHmac } from 'crypto';
import type { EventBridgeEvent } from 'aws-lambda';
import { handler, WebhookEvent } from '../../src/open-api/handlers/webhook-delivery';

const TEST_SECRET = 'test-secret-key-2026';
const TEST_URL = 'https://partner.example.com/webhooks/vpp';

const samplePayload: Record<string, unknown> = {
  dispatchId: 'dr-001',
  assetId: 'bat-solar-042',
  powerKw: 150,
  status: 'completed',
};

function makeEvent(
  overrides: Partial<WebhookEvent> = {},
): EventBridgeEvent<'WebhookDelivery', WebhookEvent> {
  return {
    version: '0',
    id: 'evt-test-001',
    source: 'vpp.dr-dispatcher',
    account: '123456789012',
    time: '2026-02-20T12:00:00Z',
    region: 'sa-east-1',
    resources: [],
    'detail-type': 'WebhookDelivery',
    detail: {
      webhookUrl: TEST_URL,
      eventType: 'DRDispatchCompleted',
      payload: samplePayload,
      orgId: 'org-energisa',
      ...overrides,
    },
  };
}

function expectedSignature(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('webhook-delivery handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, WEBHOOK_SECRET: TEST_SECRET };
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ received: true }), { status: 200 }),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  // ─── 1. Happy path: 200 OK, correct HMAC signature, payload intact ───
  it('delivers webhook with correct HMAC signature and untampered payload', async () => {
    const event = makeEvent();
    const result = await handler(event);

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      eventType: 'DRDispatchCompleted',
      orgId: 'org-energisa',
    });

    // Deep assertion 1: HMAC signature
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const actualHeaders = callArgs[1].headers as Record<string, string>;
    const expectedBody = JSON.stringify(samplePayload);
    expect(actualHeaders['x-vpp-signature']).toBe(
      expectedSignature(expectedBody, TEST_SECRET),
    );
    expect(actualHeaders['x-vpp-event-type']).toBe('DRDispatchCompleted');
    expect(actualHeaders['x-vpp-org-id']).toBe('org-energisa');
    expect(actualHeaders['Content-Type']).toBe('application/json');

    // Deep assertion 2: payload integrity
    expect(callArgs[1].body).toBe(expectedBody);
    expect(callArgs[0]).toBe(TEST_URL);
  });

  // ─── 2. Third-party returns 500 → handler throws ───
  it('throws when third-party returns HTTP 500', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(handler(makeEvent())).rejects.toThrow(
      'Webhook delivery failed: HTTP 500',
    );
  });

  // ─── 3. Timeout (AbortError) → handler throws with "timeout" ───
  it('throws with "timeout" when fetch is aborted', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    );

    await expect(handler(makeEvent())).rejects.toThrow(/timeout/i);
  });

  // ─── 4. Missing webhookUrl → throws before fetch ───
  it('throws before fetch when webhookUrl is missing', async () => {
    const event = makeEvent({ webhookUrl: '' });

    await expect(handler(event)).rejects.toThrow('Missing webhookUrl');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ─── 5. WEBHOOK_SECRET not set → throws before fetch ───
  it('throws before fetch when WEBHOOK_SECRET is empty', async () => {
    process.env.WEBHOOK_SECRET = '';

    await expect(handler(makeEvent())).rejects.toThrow(
      'WEBHOOK_SECRET not configured',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
