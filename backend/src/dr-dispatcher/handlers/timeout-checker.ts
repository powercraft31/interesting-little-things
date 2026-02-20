/**
 * DR Dispatcher — Timeout Checker Handler
 *
 * Triggered by SQS delay queue messages after the configured timeout window.
 *
 * For each message:
 *   1. Read the dispatch record from DynamoDB
 *   2. If still EXECUTING → mark as TIMEOUT and publish DRDispatchCompleted
 *   3. If already COMPLETED / ERROR / FAILED → skip (idempotent)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import type { SQSEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeoutMessage {
  readonly dispatchId: string;
  readonly assetId: string;
}

interface DispatchRecord {
  readonly dispatchId: string;
  readonly assetId: string;
  readonly orgId: string;
  readonly status: string;
}

// ---------------------------------------------------------------------------
// Terminal statuses — no further transitions allowed
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['COMPLETED', 'ERROR', 'FAILED', 'TIMEOUT']);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';

// ---------------------------------------------------------------------------
// SDK clients (instantiated once per Lambda cold-start)
// ---------------------------------------------------------------------------

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: SQSEvent): Promise<void> {
  console.info('[timeout-checker] Processing batch', {
    recordCount: event.Records.length,
  });

  for (const record of event.Records) {
    const message: TimeoutMessage = JSON.parse(record.body);
    const { dispatchId, assetId } = message;

    console.info('[timeout-checker] Checking dispatch', { dispatchId, assetId });

    // ── Step 1: Read current dispatch record ────────────────────────────
    let dispatch: DispatchRecord | undefined;
    try {
      const result = await ddbDoc.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { dispatchId, assetId },
        }),
      );
      dispatch = result.Item as DispatchRecord | undefined;
    } catch (err) {
      console.error('[timeout-checker] Failed to read dispatch record', {
        dispatchId,
        assetId,
        error: err,
      });
      throw err;
    }

    if (!dispatch) {
      console.error('[timeout-checker] Dispatch record not found', {
        dispatchId,
        assetId,
      });
      continue;
    }

    // ── Step 2: Idempotency — skip if already in terminal state ─────────
    if (TERMINAL_STATUSES.has(dispatch.status)) {
      console.info('[timeout-checker] Already in terminal state — skipping', {
        dispatchId,
        currentStatus: dispatch.status,
      });
      continue;
    }

    // ── Step 3: Mark as TIMEOUT ─────────────────────────────────────────
    const now = new Date().toISOString();
    try {
      await ddbDoc.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { dispatchId, assetId },
          UpdateExpression: 'SET #s = :timeout, updatedAt = :ts',
          ConditionExpression: '#s = :executing',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':timeout': 'TIMEOUT',
            ':executing': 'EXECUTING',
            ':ts': now,
          },
        }),
      );
      console.info('[timeout-checker] Dispatch marked TIMEOUT', { dispatchId });
    } catch (err) {
      const error = err as { name?: string };
      if (error.name === 'ConditionalCheckFailedException') {
        console.info('[timeout-checker] Race condition — record already transitioned', {
          dispatchId,
        });
        continue;
      }
      console.error('[timeout-checker] Failed to update dispatch record', {
        dispatchId,
        error: err,
      });
      throw err;
    }

    // ── Step 4: Publish DRDispatchCompleted (TIMEOUT) to EventBridge ────
    try {
      await eventBridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'solfacil.vpp.dr-dispatcher',
              DetailType: 'DRDispatchCompleted',
              EventBusName: EVENT_BUS_NAME,
              Detail: JSON.stringify({
                dispatchId,
                assetId,
                orgId: dispatch.orgId,
                status: 'TIMEOUT',
              }),
            },
          ],
        }),
      );
      console.info('[timeout-checker] DRDispatchCompleted event published', {
        dispatchId,
        status: 'TIMEOUT',
      });
    } catch (err) {
      console.error('[timeout-checker] EventBridge publish failed', {
        dispatchId,
        error: err,
      });
      throw err;
    }
  }

  console.info('[timeout-checker] Batch processing complete', {
    recordCount: event.Records.length,
  });
}
