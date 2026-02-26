/**
 * 标准遥测数据格式 — 所有厂商适配器统一规范化为此结构。
 * 设计为不可变（每一层都使用 readonly）。
 *
 * v5.2 "Business Trinity" — 三个灵活容器取代平坦业务字段：
 *   metering  — 计量指标（数值型，可聚合）
 *   status    — 设备状态（数值/字符串/布尔）
 *   config    — 配置参数（数值/字符串）
 */

// ---------------------------------------------------------------------------
// castValue — 安全类型转换，杜绝盲目 `as` 强制转换
// ---------------------------------------------------------------------------

export function castValue(raw: unknown, type: "number"): number;
export function castValue(raw: unknown, type: "string"): string;
export function castValue(raw: unknown, type: "boolean"): boolean;
export function castValue(
  raw: unknown,
  type: "number" | "string" | "boolean",
): number | string | boolean;
export function castValue(
  raw: unknown,
  type: "number" | "string" | "boolean",
): number | string | boolean {
  switch (type) {
    case "number": {
      if (raw === null || raw === undefined || raw === "") {
        throw new TypeError(
          `castValue: received null/undefined/empty string for number field`,
        );
      }
      const n = Number(raw);
      if (Number.isNaN(n))
        throw new TypeError(`Cannot cast ${JSON.stringify(raw)} to number`);
      return n;
    }
    case "string":
      return String(raw);
    case "boolean":
      return Boolean(raw);
  }
}

// ---------------------------------------------------------------------------
// StandardTelemetry 接口
// ---------------------------------------------------------------------------

export interface StandardTelemetry {
  // ── 身份字段（不可变）──────────────────────────────────────────
  readonly orgId: string;
  readonly deviceId: string;
  readonly timestamp: string; // ISO 8601 UTC
  readonly source: "mqtt" | "huawei" | "sungrow" | "generic-rest";
  readonly isOnline?: boolean;
  readonly errorCode?: string;

  // ── Business Trinity 灵活容器 ─────────────────────────────────
  readonly metering?: Readonly<Record<string, number>>;
  readonly status?: Readonly<Record<string, number | string | boolean>>;
  readonly config?: Readonly<Record<string, number | string>>;

  // ── 原始负载（审计用）─────────────────────────────────────────
  readonly rawPayload?: unknown;
}
