/**
 * IoT Hub — 遥测数据采集 Handler
 *
 * 接收来自 MQTT 主题 `solfacil/+/+/telemetry` 的 IoT Rule 事件。
 * 通过以下方式规范化厂商专属负载：
 *   1. AppConfig 动态解析规则（从 Lambda Extension Sidecar 获取）
 *   2. 反腐层（ACL）静态适配器（降级方案）
 * 然后将多指标记录写入 Amazon Timestream，并发布包含 traceId 的
 * TelemetryIngested 事件到 EventBridge，用于分布式追踪。
 *
 * v5.2: 支持 Business Trinity 灵活容器（metering/status/config）
 */
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  type _Record,
  type MeasureValue,
} from "@aws-sdk/client-timestream-write";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { resolveAdapter } from "../parsers/AdapterRegistry";
import { type StandardTelemetry } from "../parsers/StandardTelemetry";

interface IngestResult {
  success: true;
  recordsWritten: number;
  traceId: string;
}

// ---------------------------------------------------------------------------
// AppConfig 类型定义
// ---------------------------------------------------------------------------

interface ParserRule {
  readonly mappingRule: Record<string, string>;
  readonly unitConversions?: Record<
    string,
    { factor: number; offset?: number }
  >;
}

interface ParserRulesConfig {
  readonly [orgId: string]: Record<string, ParserRule>; // orgId → manufacturer → rule
}

// ---------------------------------------------------------------------------
// 冷启动：客户端与常量
// ---------------------------------------------------------------------------

const tsClient = new TimestreamWriteClient({});
const ebClient = new EventBridgeClient({});

const APPCONFIG_BASE =
  process.env.APPCONFIG_BASE_URL ?? "http://localhost:2772";
const APPCONFIG_APP = process.env.APPCONFIG_APP ?? "solfacil-vpp-dev";
const APPCONFIG_ENV = process.env.APPCONFIG_ENV ?? "dev";
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "";

// ---------------------------------------------------------------------------
// AppConfig 获取器
// ---------------------------------------------------------------------------

async function fetchParserRules(
  orgId: string,
): Promise<Record<string, ParserRule>> {
  try {
    const url = `${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/parser-rules`;
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return {};
    const configs = (await res.json()) as ParserRulesConfig;
    return configs[orgId] ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 动态映射引擎
// ---------------------------------------------------------------------------

function applyDynamicMapping(
  raw: Record<string, unknown>,
  rule: ParserRule,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [srcField, destField] of Object.entries(rule.mappingRule)) {
    if (raw[srcField] !== undefined) {
      mapped[destField] = raw[srcField];
    }
  }

  // 应用单位转换（例如 W → kW：factor = 0.001）
  if (rule.unitConversions) {
    for (const [destField, conv] of Object.entries(rule.unitConversions)) {
      if (typeof mapped[destField] === "number") {
        mapped[destField] =
          (mapped[destField] as number) * conv.factor + (conv.offset ?? 0);
      }
    }
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// 从 Business Trinity 容器构建 MeasureValues
// ---------------------------------------------------------------------------

function buildMeasureValues(telemetry: StandardTelemetry): MeasureValue[] {
  const values: MeasureValue[] = [];

  // metering — 全部为 DOUBLE 类型
  if (telemetry.metering) {
    for (const [key, val] of Object.entries(telemetry.metering)) {
      values.push({ Name: key, Value: String(val), Type: "DOUBLE" });
    }
  }

  // status — 根据值类型选择 Timestream 类型
  if (telemetry.status) {
    for (const [key, val] of Object.entries(telemetry.status)) {
      if (typeof val === "number") {
        values.push({ Name: key, Value: String(val), Type: "DOUBLE" });
      } else if (typeof val === "boolean") {
        values.push({ Name: key, Value: String(val), Type: "BOOLEAN" });
      } else {
        values.push({ Name: key, Value: String(val), Type: "VARCHAR" });
      }
    }
  }

  // config — 数值为 DOUBLE，字符串为 VARCHAR
  if (telemetry.config) {
    for (const [key, val] of Object.entries(telemetry.config)) {
      if (typeof val === "number") {
        values.push({ Name: key, Value: String(val), Type: "DOUBLE" });
      } else {
        values.push({ Name: key, Value: String(val), Type: "VARCHAR" });
      }
    }
  }

  return values;
}

// ---------------------------------------------------------------------------
// 从动态映射结果构建 StandardTelemetry（兼容层）
// ---------------------------------------------------------------------------

function dynamicMappedToTelemetry(
  mapped: Record<string, unknown>,
  orgId: string,
): StandardTelemetry {
  // TODO: 依赖 M8 Phase 6.2 的 structured parser rule 来决定归属，暂时全放入 status
  const status: Record<string, number | string | boolean> = {};

  for (const [key, val] of Object.entries(mapped)) {
    if (key === "deviceId" || key === "timestamp") continue;
    if (
      typeof val === "number" ||
      typeof val === "string" ||
      typeof val === "boolean"
    ) {
      status[`status.${key}`] = val;
    }
  }

  return {
    orgId,
    deviceId: (mapped.deviceId as string) ?? "",
    timestamp: (mapped.timestamp as string) ?? new Date().toISOString(),
    source: "generic-rest",
    status: Object.keys(status).length > 0 ? status : undefined,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: unknown): Promise<IngestResult> {
  const traceId = `vpp-${crypto.randomUUID()}`;
  const raw = event as Record<string, unknown>;
  const orgId = raw.orgId as string | undefined;

  // --- 验证（orgId 始终在顶层，由 IoT Rule 注入）----------------------------
  if (!orgId) {
    throw new Error("Missing required field: orgId");
  }

  // --- ACL：规范化厂商专属负载 -----------------------------------------------
  let telemetry: StandardTelemetry;

  // 优先尝试 AppConfig 动态解析规则
  const parserRules = await fetchParserRules(orgId);
  const manufacturer = (raw.manufacturer as string | undefined) ?? "native";
  const rule = parserRules[manufacturer];

  if (rule && Object.keys(rule.mappingRule).length > 0) {
    const mapped = applyDynamicMapping(raw, rule);
    telemetry = dynamicMappedToTelemetry(mapped, orgId);
  } else {
    // 降级使用现有 ACL resolveAdapter 逻辑
    try {
      const adapter = resolveAdapter(event);
      telemetry = adapter.normalize(event, orgId);
    } catch {
      // 最终降级：从 raw 构造最小 StandardTelemetry
      telemetry = {
        orgId,
        deviceId: (raw.deviceId as string) ?? "",
        timestamp: (raw.timestamp as string) ?? new Date().toISOString(),
        source: "generic-rest",
        metering:
          typeof raw.power === "number"
            ? { "metering.grid_power_kw": raw.power as number }
            : undefined,
      };
    }
  }

  if (!telemetry.deviceId) {
    throw new Error("Missing required field: deviceId");
  }

  // --- 构建 MeasureValues（从 Business Trinity 容器迭代）---------------------
  const measureValues = buildMeasureValues(telemetry);

  // 至少需要一个 measure 值
  if (measureValues.length === 0) {
    measureValues.push({
      Name: "metering.heartbeat",
      Value: "1",
      Type: "DOUBLE",
    });
  }

  // --- 构建 Timestream 记录 -------------------------------------------------
  const records: _Record[] = [
    {
      Dimensions: [
        { Name: "orgId", Value: orgId },
        { Name: "deviceId", Value: telemetry.deviceId },
      ],
      MeasureName: "telemetry",
      MeasureValueType: "MULTI",
      MeasureValues: measureValues,
      Time: String(new Date(telemetry.timestamp).getTime()),
      TimeUnit: "MILLISECONDS",
    },
  ];

  // --- 写入 Timestream ------------------------------------------------------
  const command = new WriteRecordsCommand({
    DatabaseName: process.env.TS_DATABASE_NAME,
    TableName: process.env.TS_TABLE_NAME,
    Records: records,
  });

  await tsClient.send(command);

  // --- 发布包含 traceId 的 TelemetryIngested 事件 ---------------------------
  if (EVENT_BUS_NAME) {
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: EVENT_BUS_NAME,
            Source: "solfacil.vpp.iot-hub",
            DetailType: "TelemetryIngested",
            Detail: JSON.stringify({
              orgId,
              deviceId: telemetry.deviceId,
              timestamp: telemetry.timestamp,
              metering: telemetry.metering,
              status: telemetry.status,
              traceId,
            }),
          },
        ],
      }),
    );
  }

  console.info(
    JSON.stringify({
      level: "INFO",
      traceId,
      module: "M1",
      action: "telemetry_ingested",
      orgId,
      deviceId: telemetry.deviceId,
      metering: telemetry.metering,
      status: telemetry.status,
    }),
  );

  return { success: true, recordsWritten: records.length, traceId };
}
