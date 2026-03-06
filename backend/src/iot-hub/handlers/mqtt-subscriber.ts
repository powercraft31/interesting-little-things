import { Pool } from "pg";
import { XuhengAdapter } from "../parsers/XuhengAdapter";
import { DeviceAssetCache } from "../services/device-asset-cache";
import { MessageBuffer } from "../services/message-buffer";
import type {
  XuhengRawMessage,
  XuhengMessageType,
  ParsedTelemetry,
} from "../../shared/types/telemetry";

export interface MqttSubscriberConfig {
  readonly brokerUrl: string;
  readonly topic: string;
  readonly clientId: string;
}

const DEFAULT_CONFIG: MqttSubscriberConfig = {
  brokerUrl: process.env.MQTT_BROKER_URL ?? "mqtt://broker.emqx.io:1883",
  topic: process.env.MQTT_TOPIC ?? "xuheng/+/+/data",
  clientId: `solfacil-vpp-${process.pid}`,
};

/**
 * Start MQTT subscriber for Xuheng EMS telemetry.
 * Routes MSG#4 -> XuhengAdapter -> MessageBuffer -> telemetry_history
 * Routes MSG#0 -> updateEmsHealth
 * Uses Service Pool (no JWT, no RLS for device writes).
 *
 * Returns a stop function for graceful shutdown.
 */
export function startMqttSubscriber(
  pool: Pool,
  config: MqttSubscriberConfig = DEFAULT_CONFIG,
): { stop: () => void } {
  // Lazy-require mqtt to avoid hard dependency when not used
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mqtt = require("mqtt");

  const adapter = new XuhengAdapter();
  const cache = new DeviceAssetCache(pool);
  const buffer = new MessageBuffer(pool, 2000);

  const client = mqtt.connect(config.brokerUrl, {
    clientId: config.clientId,
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    console.log(`[MqttSubscriber] Connected to ${config.brokerUrl}`);
    client.subscribe(
      config.topic,
      { qos: 1 },
      (err: Error | null) => {
        if (err) console.error("[MqttSubscriber] Subscribe error:", err);
        else console.log(`[MqttSubscriber] Subscribed to ${config.topic}`);
      },
    );
  });

  client.on("message", async (_topic: string, payload: Buffer) => {
    try {
      const raw: XuhengRawMessage = JSON.parse(payload.toString());
      const msgType = classifyMessage(raw);

      if (msgType === 4) {
        const parsed = adapter.parse(raw);
        if (!parsed) return;

        const assetId = await cache.resolve(parsed.deviceSn);
        if (!assetId) {
          console.warn(
            `[MqttSubscriber] Unknown device: ${parsed.deviceSn}`,
          );
          return;
        }

        buffer.enqueue(assetId, parsed);
        await updateDeviceState(pool, assetId, parsed);
      } else if (msgType === 0) {
        await updateEmsHealth(pool, raw);
      }
    } catch (err) {
      console.error("[MqttSubscriber] Message processing error:", err);
    }
  });

  client.on("error", (err: Error) => {
    console.error("[MqttSubscriber] Connection error:", err);
  });

  const stop = () => {
    console.log("[MqttSubscriber] Shutting down...");
    buffer.flush();
    client.end();
  };

  process.on("SIGTERM", stop);

  return { stop };
}

export function classifyMessage(raw: XuhengRawMessage): XuhengMessageType {
  const data = raw.data as Record<string, unknown>;
  if (data.batList && data.pvList && data.gridList) return 4;
  if (data.emsList) return 0;
  if (data.didoList) return 1;
  if (data.meterList) return 2;
  return 4;
}

export async function updateDeviceState(
  pool: Pool,
  assetId: string,
  t: ParsedTelemetry,
): Promise<void> {
  await pool.query(
    `INSERT INTO device_state
       (asset_id, battery_soc, battery_power, pv_power, grid_power_kw, load_power, is_online, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
     ON CONFLICT (asset_id) DO UPDATE SET
       battery_soc    = EXCLUDED.battery_soc,
       battery_power  = EXCLUDED.battery_power,
       pv_power       = EXCLUDED.pv_power,
       grid_power_kw  = EXCLUDED.grid_power_kw,
       load_power     = EXCLUDED.load_power,
       is_online      = true,
       updated_at     = NOW()`,
    [
      assetId,
      t.batterySoc,
      t.batteryPowerKw,
      t.pvPowerKw,
      t.gridPowerKw,
      t.loadPowerKw,
    ],
  );
}

export async function updateEmsHealth(
  pool: Pool,
  raw: XuhengRawMessage,
): Promise<void> {
  const emsList = raw.data.emsList;
  if (!emsList?.length) return;

  const ems = emsList[0];
  const props = ems.properties;
  if (!props) return;

  await pool.query(
    `INSERT INTO ems_health
       (asset_id, client_id, firmware_version, wifi_signal_dbm, uptime_seconds, error_codes, last_heartbeat, updated_at)
     SELECT a.asset_id, $1, $2, $3, $4, $5, NOW(), NOW()
     FROM assets a WHERE a.serial_number = $6 AND a.is_active = true
     LIMIT 1
     ON CONFLICT (asset_id) DO UPDATE SET
       client_id        = EXCLUDED.client_id,
       firmware_version = EXCLUDED.firmware_version,
       wifi_signal_dbm  = EXCLUDED.wifi_signal_dbm,
       uptime_seconds   = EXCLUDED.uptime_seconds,
       error_codes      = EXCLUDED.error_codes,
       last_heartbeat   = EXCLUDED.last_heartbeat,
       updated_at       = NOW()`,
    [
      raw.clientId,
      props.firmware_version ?? null,
      props.wifi_signal_dbm ? parseInt(props.wifi_signal_dbm, 10) : null,
      props.uptime_seconds ? parseInt(props.uptime_seconds, 10) : null,
      JSON.stringify(
        props.error_codes ? JSON.parse(props.error_codes) : [],
      ),
      raw.clientId,
    ],
  );
}
