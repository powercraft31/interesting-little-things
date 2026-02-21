/**
 * DR 调度器 — 收集设备响应 Handler
 *
 * 由 AWS IoT Topic Rule 触发，拦截设备在
 * 'solfacil/+/+/response/mode-change' 主题上的模式切换响应。
 *
 * 职责：
 *   1. 将 dispatch_tracker DynamoDB 记录从 EXECUTING 更新为 COMPLETED | ERROR
 *   2. 发布 DRDispatchCompleted 事件到 EventBridge，供下游消费者使用
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

// ---------------------------------------------------------------------------
// 类型定义
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
// 环境变量
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.TABLE_NAME ?? "";
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "";

// ---------------------------------------------------------------------------
// SDK 客户端（每次 Lambda 冷启动实例化一次）
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

  // ── 步骤 1：更新 DynamoDB 中的调度记录 ─────────────────────────────────
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
    // ConditionalCheckFailedException 表示记录已不处于 EXECUTING 状态
    //（已被处理或已超时）— 记录日志并继续，保持幂等性
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

  // ── 步骤 2：发布 DRDispatchCompleted 到 EventBridge ────────────────────
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

    // 回滚：将数据库状态恢复为 EXECUTING，防止永久数据不一致
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
