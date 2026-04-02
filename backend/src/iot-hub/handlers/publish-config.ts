import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";
import { validateSchedule, buildConfigSetPayload } from "./schedule-translator";
import type { DomainSchedule } from "./schedule-translator";
import { formatProtocolTimestamp } from "../../shared/protocol-time";

/**
 * PR5: Publish Functions
 *
 * publishConfigGet — request current config from gateway
 * publishConfigSet — push new schedule to gateway (validates first)
 *
 * These are called by BFF and M2, not by MQTT message handlers.
 */

type MqttPublishFn = (topic: string, message: string) => void;

/**
 * Publish a config/get request to retrieve current battery_schedule.
 * Logs a pending 'get' command in device_command_logs.
 * Returns the messageId for tracking.
 */
export async function publishConfigGet(
  pool: Pool,
  gatewayId: string,
  publish: MqttPublishFn,
): Promise<string> {
  const messageId = String(Date.now());
  const now = formatProtocolTimestamp();

  const message: SolfacilMessage = {
    DS: 0,
    ackFlag: 0,
    data: { configname: "battery_schedule" },
    clientId: gatewayId,
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId,
    timeStamp: now,
  };

  // Log the pending get command
  await pool.query(
    `INSERT INTO device_command_logs
       (gateway_id, command_type, config_name, message_id, result)
     VALUES ($1, 'get', 'battery_schedule', $2, 'pending')`,
    [gatewayId, messageId],
  );

  const topic = `platform/ems/${gatewayId}/config/get`;
  publish(topic, JSON.stringify(message));

  console.log(
    `[PublishConfig] config/get sent to ${gatewayId}, messageId=${messageId}`,
  );

  return messageId;
}

/**
 * Publish a config/set command to push a new battery schedule.
 * Validates the schedule FIRST — throws ScheduleValidationError on failure.
 * Logs a pending 'set' command in device_command_logs.
 * Returns the messageId for tracking.
 */
/**
 * Publish a subDevices/get request to query the gateway's sub-device list.
 * Topic: platform/ems/{clientId}/subDevices/get
 * No device_command_logs — response arrives on existing deviceList handler.
 */
export function publishSubDevicesGet(
  gatewayId: string,
  publish: MqttPublishFn,
): void {
  const messageId = String(Date.now());
  const now = formatProtocolTimestamp();

  const message: SolfacilMessage = {
    DS: 0,
    ackFlag: 0,
    data: { reason: "periodic_query" },
    clientId: gatewayId,
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId,
    timeStamp: now,
  };

  const topic = `platform/ems/${gatewayId}/subDevices/get`;
  publish(topic, JSON.stringify(message));

  console.log(
    `[PublishConfig] subDevices/get sent to ${gatewayId}, messageId=${messageId}`,
  );
}

export async function publishConfigSet(
  pool: Pool,
  gatewayId: string,
  schedule: DomainSchedule,
  publish: MqttPublishFn,
): Promise<string> {
  // HARD CRASH on validation failure — never publish invalid config
  validateSchedule(schedule);

  const messageId = String(Date.now());
  const protocolMessage = buildConfigSetPayload(gatewayId, schedule, messageId);

  // Log the pending set command
  await pool.query(
    `INSERT INTO device_command_logs
       (gateway_id, command_type, config_name, message_id,
        payload_json, result)
     VALUES ($1, 'set', 'battery_schedule', $2, $3, 'pending')`,
    [gatewayId, messageId, JSON.stringify(schedule)],
  );

  const topic = `platform/ems/${gatewayId}/config/set`;
  publish(topic, JSON.stringify(protocolMessage));

  console.log(
    `[PublishConfig] config/set sent to ${gatewayId}, messageId=${messageId}`,
  );

  return messageId;
}
