/**
 * DR Dispatcher — Collect Response Handler
 *
 * Triggered by AWS IoT Topic Rule intercepting device mode-change responses
 * on 'solfacil/+/+/response/mode-change'.
 *
 * Responsibilities:
 *   1. Update the dispatch_tracker DynamoDB record from EXECUTING → COMPLETED | ERROR
 *   2. Publish DRDispatchCompleted event to EventBridge for downstream consumers
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeviceStatus = "COMPLETED" | "ERROR";

interface DeviceResponseEvent {
  readonly dispatchId: string;
  readonly assetId: string;
  readonly orgId: string;
  readonly status: DeviceStatus;
  readonly errorCode?: string;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.TABLE_NAME ?? "";
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "";

// ---------------------------------------------------------------------------
// SDK clients (instantiated once per Lambda cold-start)
// ---------------------------------------------------------------------------

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: DeviceResponseEvent): Promise<void> {
  const { dispatchId, assetId, orgId, status, errorCode } = event;
  const now = new Date().toISOString();

  console.info("[collect-response] Received device response", {
    dispatchId,
    assetId,
    orgId,
    status,
    ...(errorCode ? { errorCode } : {}),
  });

  // ── Step 1: Update dispatch record in DynamoDB ──────────────────────────
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { dispatchId, assetId },
        UpdateExpression: "SET #s = :status, updatedAt = :ts",
        ConditionExpression: "#s = :executing",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":status": status,
          ":executing": "EXECUTING",
          ":ts": now,
        },
      }),
    );
    console.info("[collect-response] Dispatch record updated", {
      dispatchId,
      status,
    });
  } catch (err) {
    // ConditionalCheckFailedException means the record is no longer EXECUTING
    // (already processed or timed out) — log and continue to keep idempotency
    const error = err as { name?: string };
    if (error.name === "ConditionalCheckFailedException") {
      console.info(
        "[collect-response] Record already transitioned — skipping",
        {
          dispatchId,
          assetId,
        },
      );
      return;
    }
    console.error("[collect-response] Failed to update dispatch record", {
      dispatchId,
      error: err,
    });
    throw err;
  }

  // ── Step 2: Publish DRDispatchCompleted to EventBridge ──────────────────
  try {
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: "solfacil.vpp.dr-dispatcher",
            DetailType: "DRDispatchCompleted",
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              dispatchId,
              assetId,
              orgId,
              status,
            }),
          },
        ],
      }),
    );
    console.info("[collect-response] DRDispatchCompleted event published", {
      dispatchId,
      status,
    });
  } catch (err) {
    console.error("[collect-response] EventBridge publish failed", {
      dispatchId,
      error: err,
    });

    // Rollback: revert DB status to EXECUTING to prevent permanent data inconsistency
    try {
      await ddbDoc.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { dispatchId, assetId },
          UpdateExpression: "SET #s = :s, updatedAt = :ts",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":s": "EXECUTING",
            ":ts": new Date().toISOString(),
          },
        }),
      );
      console.info("[collect-response] Rollback to EXECUTING succeeded", {
        dispatchId,
      });
    } catch (rollbackErr) {
      console.error("[collect-response] Rollback to EXECUTING failed", {
        dispatchId,
        error: rollbackErr,
      });
    }

    throw err;
  }

  console.info("[collect-response] All steps completed", {
    dispatchId,
    assetId,
    status,
  });
}
