/**
 * DR Dispatcher — Dispatch Command Handler
 *
 * Triggered by EventBridge rule matching DRCommandIssued events from BFF.
 * Implements a transaction-like flow:
 *   1. Write dispatch record to DynamoDB (status: EXECUTING)
 *   2. Publish MQTT command to device via IoT Data Plane
 *   3. Enqueue timeout tracker message to SQS
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DRCommandDetail {
  readonly dispatchId: string;
  readonly assetId: string;
  readonly targetMode: string;
  readonly orgId: string;
}

interface DRCommandEvent {
  readonly 'detail-type': string;
  readonly detail: DRCommandDetail;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const QUEUE_URL = process.env.QUEUE_URL ?? '';
const IOT_ENDPOINT = process.env.IOT_ENDPOINT ?? '';

// ---------------------------------------------------------------------------
// SDK clients (instantiated once per Lambda cold-start)
// ---------------------------------------------------------------------------

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const iot = new IoTDataPlaneClient({
  endpoint: IOT_ENDPOINT ? `https://${IOT_ENDPOINT}` : undefined,
});

const sqs = new SQSClient({});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: DRCommandEvent): Promise<void> {
  const { dispatchId, assetId, targetMode, orgId } = event.detail;
  const now = new Date().toISOString();

  console.info('[dispatch-command] Received DRCommandIssued', {
    dispatchId,
    assetId,
    targetMode,
    orgId,
  });

  // ── Step 1: Write dispatch record to DynamoDB ──────────────────────────
  try {
    await ddbDoc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          dispatchId,
          assetId,
          orgId,
          targetMode,
          status: 'EXECUTING',
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    console.info('[dispatch-command] Dispatch record created', { dispatchId });
  } catch (err) {
    console.error('[dispatch-command] Failed to write dispatch record', {
      dispatchId,
      error: err,
    });
    throw err;
  }

  // ── Step 2: Publish MQTT command to device ─────────────────────────────
  try {
    const topic = `solfacil/${orgId}/${assetId}/command/mode`;
    const payload = JSON.stringify({ targetMode, dispatchId });

    await iot.send(
      new PublishCommand({
        topic,
        qos: 1,
        payload: new TextEncoder().encode(payload),
      }),
    );
    console.info('[dispatch-command] MQTT command published', {
      dispatchId,
      topic,
    });
  } catch (err) {
    console.error('[dispatch-command] MQTT publish failed — marking FAILED', {
      dispatchId,
      error: err,
    });

    // Roll-back: mark the dispatch record as FAILED
    await markFailed(dispatchId, assetId);
    throw err;
  }

  // ── Step 3: Enqueue timeout tracker message to SQS ─────────────────────
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ dispatchId, assetId }),
      }),
    );
    console.info('[dispatch-command] Timeout message enqueued', { dispatchId });
  } catch (err) {
    console.error('[dispatch-command] SQS send failed', {
      dispatchId,
      error: err,
    });
    throw err;
  }

  console.info('[dispatch-command] All steps completed', { dispatchId });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markFailed(dispatchId: string, assetId: string): Promise<void> {
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { dispatchId, assetId },
        UpdateExpression: 'SET #s = :s, updatedAt = :ts',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':s': 'FAILED',
          ':ts': new Date().toISOString(),
        },
      }),
    );
    console.info('[dispatch-command] Dispatch record marked FAILED', { dispatchId });
  } catch (updateErr) {
    console.error('[dispatch-command] Failed to mark record as FAILED', {
      dispatchId,
      error: updateErr,
    });
  }
}
