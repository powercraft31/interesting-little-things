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
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
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
      return items.map((item: unknown, index: number) => {
        const record = item as Record<string, unknown>;
        const deviceId = rule.deviceIdPath
          ? String(getNestedValue(record, rule.deviceIdPath) ?? index)
          : String(index);
        return this.buildEnvelope(record, rule.mappings, orgId, deviceId);
      });
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
