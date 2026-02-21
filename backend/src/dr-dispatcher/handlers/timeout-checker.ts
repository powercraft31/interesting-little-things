/**
 * DR 调度器 — 超时检查 Handler
 *
 * 由 SQS 延迟队列消息在配置的超时窗口后触发。
 *
 * 对每条消息：
 *   1. 从 DynamoDB 读取调度记录
 *   2. 若仍为 EXECUTING → 标记为 TIMEOUT 并发布 DRDispatchCompleted
 *   3. 若已为 COMPLETED / ERROR / FAILED → 跳过（幂等处理）
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
// 类型定义
// ---------------------------------------------------------------------------

interface TimeoutMessage {
  readonly dispatchId: string;
  readonly assetId: string;
  readonly traceId?: string;
}

interface DispatchRecord {
  readonly dispatchId: string;
  readonly assetId: string;
  readonly orgId: string;
  readonly status: string;
}

// ---------------------------------------------------------------------------
// 终态 — 不允许再进行状态转换
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['COMPLETED', 'ERROR', 'FAILED', 'TIMEOUT']);

// ---------------------------------------------------------------------------
// 环境变量
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';

// ---------------------------------------------------------------------------
// SDK 客户端（每次 Lambda 冷启动实例化一次）
// ---------------------------------------------------------------------------

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: SQSEvent): Promise<void> {
  console.info(JSON.stringify({
    level: 'INFO',
    module: 'M3',
    action: 'timeout_batch_start',
    recordCount: event.Records.length,
  }));

  for (const record of event.Records) {
    const message: TimeoutMessage = JSON.parse(record.body);
    const { dispatchId, assetId, traceId: rawTraceId } = message;
    const traceId = rawTraceId ?? 'unknown';

    console.info(JSON.stringify({
      level: 'INFO',
      traceId,
      module: 'M3',
      action: 'timeout_checking_dispatch',
      dispatchId, assetId,
    }));

    // ── 步骤 1：读取当前调度记录 ─────────────────────────────────────────
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
      console.error(JSON.stringify({
        level: 'ERROR',
        traceId,
        module: 'M3',
        action: 'dispatch_record_read_failed',
        dispatchId, assetId,
        error: String(err),
      }));
      throw err;
    }

    if (!dispatch) {
      console.error(JSON.stringify({
        level: 'ERROR',
        traceId,
        module: 'M3',
        action: 'dispatch_record_not_found',
        dispatchId, assetId,
      }));
      continue;
    }

    // ── 步骤 2：幂等处理 — 若已为终态则跳过 ──────────────────────────────
    if (TERMINAL_STATUSES.has(dispatch.status)) {
      console.info(JSON.stringify({
        level: 'INFO',
        traceId,
        module: 'M3',
        action: 'dispatch_already_terminal',
        dispatchId,
        currentStatus: dispatch.status,
      }));
      continue;
    }

    // ── 步骤 3：标记为 TIMEOUT ──────────────────────────────────────────
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
      console.info(JSON.stringify({
        level: 'INFO',
        traceId,
        module: 'M3',
        action: 'dispatch_marked_timeout',
        dispatchId,
      }));
    } catch (err) {
      const error = err as { name?: string };
      if (error.name === 'ConditionalCheckFailedException') {
        console.info(JSON.stringify({
          level: 'INFO',
          traceId,
          module: 'M3',
          action: 'dispatch_race_condition',
          dispatchId,
        }));
        continue;
      }
      console.error(JSON.stringify({
        level: 'ERROR',
        traceId,
        module: 'M3',
        action: 'dispatch_update_failed',
        dispatchId,
        error: String(err),
      }));
      throw err;
    }

    // ── 步骤 4：发布 DRDispatchCompleted（TIMEOUT）到 EventBridge ────────
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
                traceId,
              }),
            },
          ],
        }),
      );
      console.info(JSON.stringify({
        level: 'INFO',
        traceId,
        module: 'M3',
        action: 'dispatch_completed_event_published',
        dispatchId,
        status: 'TIMEOUT',
      }));
    } catch (err) {
      console.error(JSON.stringify({
        level: 'ERROR',
        traceId,
        module: 'M3',
        action: 'eventbridge_publish_failed',
        dispatchId,
        error: String(err),
      }));
      throw err;
    }
  }

  console.info(JSON.stringify({
    level: 'INFO',
    module: 'M3',
    action: 'timeout_batch_complete',
    recordCount: event.Records.length,
  }));
}
