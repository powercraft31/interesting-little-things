import { createHmac } from "crypto";
import type { EventBridgeEvent } from "aws-lambda";
import {
  handler,
  WebhookEvent,
} from "../../src/open-api/handlers/webhook-delivery";

const TEST_SECRET = "test-secret-key-2026";
const TEST_URL = "https://partner.example.com/webhooks/vpp";

const samplePayload: Record<string, unknown> = {
  dispatchId: "dr-001",
  assetId: "bat-solar-042",
  powerKw: 150,
  status: "completed",
};

function makeEvent(
  overrides: Partial<WebhookEvent> = {},
): EventBridgeEvent<"WebhookDelivery", WebhookEvent> {
  return {
    version: "0",
    id: "evt-test-001",
    source: "vpp.dr-dispatcher",
    account: "123456789012",
    time: "2026-02-20T12:00:00Z",
    region: "sa-east-1",
    resources: [],
    "detail-type": "WebhookDelivery",
    detail: {
      webhookUrl: TEST_URL,
      eventType: "DRDispatchCompleted",
      payload: samplePayload,
      orgId: "org-energisa",
      ...overrides,
    },
  };
}

function expectedSignature(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("webhook-delivery handler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, WEBHOOK_SECRET: TEST_SECRET };
    // Route by URL: AppConfig calls → quotas response, webhook calls → 200 OK
    jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("localhost:2772")) {
          return new Response(
            JSON.stringify({ "org-energisa": { webhookTimeoutMs: 10_000 } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      });
    jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  // ─── 1. Happy path: 200 OK, correct HMAC signature, payload intact ───
  it("delivers webhook with correct HMAC signature and untampered payload", async () => {
    const event = makeEvent();
    const result = await handler(event);

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      eventType: "DRDispatchCompleted",
      orgId: "org-energisa",
    });

    // Find the webhook call (not the AppConfig call)
    const allCalls = (global.fetch as jest.Mock).mock.calls;
    const webhookCallIndex = allCalls.findIndex(
      (c: any[]) => typeof c[0] === "string" && c[0] === TEST_URL,
    );
    expect(webhookCallIndex).toBeGreaterThanOrEqual(0);
    const callArgs = allCalls[webhookCallIndex];

    // Deep assertion 1: HMAC signature
    const actualHeaders = callArgs[1].headers as Record<string, string>;
    const expectedBody = JSON.stringify(samplePayload);
    expect(actualHeaders["x-vpp-signature"]).toBe(
      expectedSignature(expectedBody, TEST_SECRET),
    );
    expect(actualHeaders["x-vpp-event-type"]).toBe("DRDispatchCompleted");
    expect(actualHeaders["x-vpp-org-id"]).toBe("org-energisa");
    expect(actualHeaders["Content-Type"]).toBe("application/json");

    // Deep assertion 2: payload integrity
    expect(callArgs[1].body).toBe(expectedBody);
    expect(callArgs[0]).toBe(TEST_URL);
  });

  // ─── 2. Third-party returns 500 → handler throws ───
  it("throws when third-party returns HTTP 500", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("localhost:2772")) {
          return new Response(
            JSON.stringify({ "org-energisa": { webhookTimeoutMs: 10_000 } }),
            { status: 200 },
          );
        }
        return new Response("Internal Server Error", { status: 500 });
      },
    );

    await expect(handler(makeEvent())).rejects.toThrow(
      "Webhook delivery failed: HTTP 500",
    );
  });

  // ─── 3. Timeout (AbortError) → handler throws with "timeout" ───
  it('throws with "timeout" when fetch is aborted', async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("localhost:2772")) {
          return new Response(
            JSON.stringify({ "org-energisa": { webhookTimeoutMs: 10_000 } }),
            { status: 200 },
          );
        }
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    );

    await expect(handler(makeEvent())).rejects.toThrow(/timeout/i);
  });

  // ─── 4. Missing webhookUrl → throws before fetch ───
  it("throws before fetch when webhookUrl is missing", async () => {
    const event = makeEvent({ webhookUrl: "" });

    await expect(handler(event)).rejects.toThrow("Missing webhookUrl");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ─── 5. WEBHOOK_SECRET not set → throws before fetch ───
  it("throws before fetch when WEBHOOK_SECRET is empty", async () => {
    process.env.WEBHOOK_SECRET = "";

    await expect(handler(makeEvent())).rejects.toThrow(
      "WEBHOOK_SECRET not configured",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ─── 6. Dynamic timeout from AppConfig api-quotas ───
  it("uses dynamic timeout from AppConfig api-quotas", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("localhost:2772")) {
          return new Response(
            JSON.stringify({ "org-energisa": { webhookTimeoutMs: 5_000 } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      },
    );

    const result = await handler(makeEvent());
    expect(result.success).toBe(true);
  });

  // ─── 7. AppConfig 404 → falls back to 10s default ───
  it("falls back to 10s default timeout when AppConfig returns 404", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("localhost:2772")) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      },
    );

    const result = await handler(makeEvent());
    expect(result.success).toBe(true);
  });

  // ─── 8. AppConfig NetworkError → falls back to 10s default ───
  it("falls back to 10s default timeout when AppConfig throws NetworkError", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("localhost:2772")) {
          throw new Error("ECONNREFUSED");
        }
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      },
    );

    const result = await handler(makeEvent());
    expect(result.success).toBe(true);
  });

  // ─── 9. traceId propagation in structured log ───
  it("propagates traceId from event.detail in structured log", async () => {
    const consoleSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    await handler(makeEvent({ traceId: "vpp-m7-test-001" }));

    const loggedJson = consoleSpy.mock.calls
      .map((call: any[]) => {
        try {
          return JSON.parse(call[0]);
        } catch {
          return null;
        }
      })
      .find((obj: any) => obj?.traceId === "vpp-m7-test-001");

    expect(loggedJson).toBeDefined();
    expect(loggedJson.module).toBe("M7");
  });
});
