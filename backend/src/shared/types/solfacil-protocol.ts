/**
 * Solfacil Protocol v1.1 — MQTT message envelope and payload types.
 * All protocol values are strings; parsing to numbers happens in the ACL handlers.
 */

/** Protocol envelope for all Solfacil MQTT messages (subscribe + publish). */
export interface SolfacilMessage {
  readonly DS: number;
  readonly ackFlag: number;
  readonly clientId: string;
  readonly deviceName: string;
  readonly productKey: string;
  readonly messageId: string;
  readonly timeStamp: string; // epoch ms as string
  readonly data: Record<string, unknown>;
}

/** A sub-device entry in the deviceList payload. */
export interface SolfacilDevice {
  readonly bindStatus: boolean;
  readonly connectStatus: string; // "online" | "offline"
  readonly deviceBrand: string;
  readonly deviceSn: string;
  readonly fatherSn: string;
  readonly name: string;
  readonly nodeType: string; // "major" | "minor"
  readonly productType: string; // "meter" | "inverter" | "ems"
  readonly vendor: string;
  readonly modelId?: string;
  readonly portName?: string;
  readonly protocolAddr?: string;
  readonly subDevId?: string;
  readonly subDevIntId?: number;
  readonly maxCurrent?: string;
  readonly maxPower?: string;
  readonly minCurrent?: string;
  readonly minPower?: string;
}

/** A telemetry list item (batList, gridList, pvList, etc.) */
export interface SolfacilListItem {
  readonly deviceSn: string;
  readonly fatherSn?: string;
  readonly name: string;
  readonly properties: Record<string, string>;
  readonly subDevId?: string;
  readonly bindStatus?: boolean;
  readonly connectStatus?: string;
  readonly deviceBrand?: string;
  readonly productType?: string;
  readonly modelId?: string;
  readonly portName?: string;
  readonly protocolAddr?: string;
  readonly protocolType?: string;
  readonly vendor?: string;
}

/** Alarm eventinfo payload from device/ems/{cid}/alarm topic. */
export interface SolfacilAlarmPayload {
  readonly eventinfo: {
    readonly deviceSn: string;
    readonly subDevId?: string;
    readonly subDevName?: string;
    readonly productType: string;
    readonly eventId: string;
    readonly eventName: string;
    readonly eventType: string;
    readonly level: string;
    readonly status: string;
    readonly propId: string;
    readonly propName: string;
    readonly propValue: string;
    readonly description?: string;
    readonly createTime: string;
    readonly updateTime?: string;
  };
}

/** Gateway row from the gateways table. */
export interface GatewayRecord {
  readonly gateway_id: string;
  readonly org_id: string;
  readonly mqtt_broker_host: string;
  readonly mqtt_broker_port: number;
  readonly mqtt_username: string;
  readonly mqtt_password: string;
  readonly name: string;
  readonly status: "online" | "offline" | "decommissioned";
  readonly last_seen_at: Date | null;
}

/** Fragment types for the 5 messages in a telemetry cycle. */
export type FragmentType = "ems" | "dido" | "meter" | "core";

/** Accumulated fragments for one gateway's telemetry cycle. */
export interface GatewayFragments {
  readonly clientId: string;
  readonly recordedAt: Date;
  readonly ems?: SolfacilListItem;
  readonly dido?: {
    readonly do: ReadonlyArray<{
      readonly id: string;
      readonly type: string;
      readonly value: string;
      readonly gpionum?: string;
    }>;
    readonly di?: ReadonlyArray<{
      readonly id: string;
      readonly type: string;
      readonly value: string;
      readonly gpionum?: string;
    }>;
  };
  readonly meters?: ReadonlyArray<SolfacilListItem>;
  readonly core?: Record<string, unknown>;
}

/** Domain asset type enum matching assets.asset_type column. */
export type AssetType = "SMART_METER" | "INVERTER_BATTERY" | "EMS";

/** Map protocol productType to domain AssetType. */
export function mapProductType(productType: string): AssetType {
  switch (productType) {
    case "meter":
      return "SMART_METER";
    case "inverter":
      return "INVERTER_BATTERY";
    default:
      return "INVERTER_BATTERY";
  }
}
