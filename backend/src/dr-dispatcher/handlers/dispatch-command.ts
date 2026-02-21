/**
 * DR 调度器 — 下发调度指令 Handler
 *
 * 由 EventBridge 规则触发，匹配来自 BFF 的 DRCommandIssued 事件。
 * 实现类事务流程：
 *   1. 将调度记录写入 DynamoDB（状态：EXECUTING）
 *   2. 通过 IoT Data Plane 发布 MQTT 指令到设备
 *   3. 将超时追踪消息入队到 SQS
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface DRCommandDetail {
  readonly dispatchId: string;
  readonly assetId: string;
  readonly targetMode: string;
  readonly orgId: string;
  readonly traceId?: string;
}

interface DRCommandEvent {
  readonly 'detail-type': string;
  readonly detail: DRCommandDetail;
}

// ---------------------------------------------------------------------------
// 环境变量
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const QUEUE_URL = process.env.QUEUE_URL ?? '';
const IOT_ENDPOINT = process.env.IOT_ENDPOINT ?? '';

// ---------------------------------------------------------------------------
// SDK 客户端（每次 Lambda 冷启动实例化一次）
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
  const { dispatchId, assetId, targetMode, orgId, traceId } = event.detail;
  const now = new Date().toISOString();

  console.info(JSON.stringify({
    level: 'INFO',
    traceId,
    module: 'M3',
    action: 'dr_command_received',
    dispatchId, assetId, targetMode, orgId,
  }));

  // ── 步骤 1：将调度记录写入 DynamoDB ───────────────────────────────────
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
    console.info(JSON.stringify({
      level: 'INFO',
      traceId,
      module: 'M3',
      action: 'dispatch_record_created',
      dispatchId,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR',
      traceId,
      module: 'M3',
      action: 'dispatch_record_write_failed',
      dispatchId,
      error: String(err),
    }));
    throw err;
  }

  // ── 步骤 2：通过 MQTT 发布指令到设备 ──────────────────────────────────
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
    console.info(JSON.stringify({
      level: 'INFO',
      traceId,
      module: 'M3',
      action: 'mqtt_command_published',
      dispatchId, topic,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR',
      traceId,
      module: 'M3',
      action: 'mqtt_publish_failed',
      dispatchId,
      error: String(err),
    }));

    // 回滚：将调度记录标记为 FAILED
    await markFailed(dispatchId, assetId, traceId);
    throw err;
  }

  // ── 步骤 3：将超时追踪消息入队到 SQS ──────────────────────────────────
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ dispatchId, assetId, traceId }),
      }),
    );
    console.info(JSON.stringify({
      level: 'INFO',
      traceId,
      module: 'M3',
      action: 'timeout_message_enqueued',
      dispatchId,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR',
      traceId,
      module: 'M3',
      action: 'sqs_send_failed',
      dispatchId,
      error: String(err),
    }));
    throw err;
  }

  console.info(JSON.stringify({
    level: 'INFO',
    traceId,
    module: 'M3',
    action: 'all_steps_completed',
    dispatchId,
  }));
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

async function markFailed(dispatchId: string, assetId: string, traceId?: string): Promise<void> {
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
    console.info(JSON.stringify({
      level: 'INFO',
      traceId,
      module: 'M3',
      action: 'dispatch_record_marked_failed',
      dispatchId,
    }));
  } catch (updateErr) {
    console.error(JSON.stringify({
      level: 'ERROR',
      traceId,
      module: 'M3',
      action: 'mark_failed_error',
      dispatchId,
      error: String(updateErr),
    }));
  }
}
