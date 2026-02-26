/**
 * Dynamic Parser Adapter — Phase 6.4
 *
 * Converts raw IoT payloads into StandardTelemetry[] using ParserRule
 * definitions from the Global Data Dictionary. Supports:
 *   - Direct mode: one payload → one StandardTelemetry envelope
 *   - Iterator mode: one payload → N envelopes (e.g. battery array)
 */
import { castValue } from "./StandardTelemetry";
import { type StandardTelemetry } from "./StandardTelemetry";
import {
  type ParserRule,
  type ParserRuleMapping,
} from "../../shared/types/api";

// ---------------------------------------------------------------------------
// getNestedValue — dot-notation path resolver (no external deps)
// ---------------------------------------------------------------------------

export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
  const keys = normalizedPath.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ---------------------------------------------------------------------------
// DynamicAdapter
// ---------------------------------------------------------------------------

export class DynamicAdapter {
  parse(
    rawPayload: Record<string, unknown>,
    rule: ParserRule,
    orgId: string,
  ): StandardTelemetry[] {
    if (rule.iterator) {
      const items = getNestedValue(rawPayload, rule.iterator);
      if (!Array.isArray(items)) {
        throw new TypeError(
          `Iterator path "${rule.iterator}" did not resolve to an array`,
        );
      }
      const results: StandardTelemetry[] = [];
      items.forEach((item: unknown, index: number) => {
        const record = item as Record<string, unknown>;

        if (rule.deviceIdPath) {
          const rawId = getNestedValue(record, rule.deviceIdPath);
          if (rawId === null || rawId === undefined || rawId === "") {
            console.warn(
              `[DynamicAdapter] iterator index ${index}: deviceIdPath "${rule.deviceIdPath}" resolved to empty/null — record SKIPPED (no phantom IDs allowed)`,
            );
            return; // skip this record
          }
          results.push(
            this.buildEnvelope(record, rule.mappings, orgId, String(rawId)),
          );
        } else {
          // 沒有設定 deviceIdPath → 使用 index（有意為之，不是誤用）
          results.push(
            this.buildEnvelope(record, rule.mappings, orgId, String(index)),
          );
        }
      });
      return results;
    }

    // Direct mode: single envelope
    const deviceId = (rawPayload.deviceId as string) ?? "";
    return [this.buildEnvelope(rawPayload, rule.mappings, orgId, deviceId)];
  }

  private buildEnvelope(
    data: Record<string, unknown>,
    mappings: { readonly [fieldId: string]: ParserRuleMapping },
    orgId: string,
    deviceId: string,
  ): StandardTelemetry {
    const metering: Record<string, number> = {};
    const status: Record<string, number | string | boolean> = {};
    const config: Record<string, number | string> = {};

    for (const [fieldId, mapping] of Object.entries(mappings)) {
      const rawVal = getNestedValue(data, mapping.sourcePath);
      const castVal = castValue(rawVal, mapping.valueType);

      switch (mapping.domain) {
        case "metering":
          metering[fieldId] = castVal as number;
          break;
        case "status":
          status[fieldId] = castVal as number | string | boolean;
          break;
        case "config":
          config[fieldId] = castVal as number | string;
          break;
      }
    }

    return {
      deviceId,
      orgId,
      timestamp: new Date().toISOString(),
      source: "generic-rest",
      metering: Object.keys(metering).length > 0 ? metering : undefined,
      status: Object.keys(status).length > 0 ? status : undefined,
      config: Object.keys(config).length > 0 ? config : undefined,
    };
  }
}
