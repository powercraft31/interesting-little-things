import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";

/**
 * PR5: CommandTracker
 *
 * Processes config/get_reply and config/set_reply messages.
 * - get_reply: logs the received config, stores raw battery_schedule as payload_json
 * - set_reply: resolves the matching pending command (pending → success/fail)
 *
 * 異步閉環鐵律: Every set command gets a reply tracked in device_command_logs.
 */

interface GetReplyData {
  readonly configname?: string;
  readonly battery_schedule?: Record<string, unknown>;
}

interface SetReplyData {
  readonly configname?: string;
  readonly result?: string; // "accepted" | "success" | "fail"
  readonly message?: string;
}

/**
 * Handle config/get_reply: log the received config snapshot.
 */
export async function handleGetReply(
  pool: Pool,
  gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const data = payload.data as GetReplyData;
  const configName = data.configname ?? "battery_schedule";
  const batterySchedule = data.battery_schedule ?? null;

  const deviceTimestamp = parseDeviceTimestamp(payload.timeStamp);

  await pool.query(
    `INSERT INTO device_command_logs
       (gateway_id, command_type, config_name, message_id,
        payload_json, result, device_timestamp)
     VALUES ($1, 'get_reply', $2, $3, $4, 'success', $5)`,
    [
      gatewayId,
      configName,
      payload.messageId,
      batterySchedule ? JSON.stringify(batterySchedule) : null,
      deviceTimestamp,
    ],
  );

  // Update gateways.current_config for BFF query convenience
  if (batterySchedule) {
    await pool.query(
      `UPDATE gateways
       SET updated_at = NOW()
       WHERE gateway_id = $1`,
      [gatewayId],
    );
  }

  console.log(
    `[CommandTracker] get_reply logged for ${gatewayId}, config=${configName}`,
  );
}

/**
 * Handle config/set_reply: resolve the matching pending set command.
 * Finds the latest pending 'set' command for this client_id + configname
 * and updates it with the result.
 */
export async function handleSetReply(
  pool: Pool,
  gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const data = payload.data as SetReplyData;
  const configName = data.configname ?? "battery_schedule";
  const result = data.result ?? "fail";
  const errorMessage = data.message ?? null;

  const deviceTimestamp = parseDeviceTimestamp(payload.timeStamp);

  // Two-phase set_reply: accepted (phase 1) → success/fail (phase 2)
  let updateResult;

  if (result === "accepted") {
    // Phase 1: gateway accepted the command, writing to device
    updateResult = await pool.query(
      `UPDATE device_command_logs
       SET result = 'accepted',
           device_timestamp = $1
       WHERE id = (
         SELECT id FROM device_command_logs
         WHERE gateway_id = $2
           AND config_name = $3
           AND command_type = 'set'
           AND result = 'dispatched'
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [deviceTimestamp, gatewayId, configName],
    );
  } else {
    // Phase 2 (or single-phase for v1.5 gateways): terminal result
    updateResult = await pool.query(
      `UPDATE device_command_logs
       SET result = $1,
           error_message = $2,
           device_timestamp = $3,
           resolved_at = NOW()
       WHERE id = (
         SELECT id FROM device_command_logs
         WHERE gateway_id = $4
           AND config_name = $5
           AND command_type = 'set'
           AND result IN ('dispatched', 'accepted')
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [result, errorMessage, deviceTimestamp, gatewayId, configName],
    );
  }

  if (updateResult.rowCount && updateResult.rowCount > 0) {
    // Notify SSE listeners of status change
    const notifyPayload = JSON.stringify({
      gatewayId,
      configName,
      result,
    });
    await pool.query(`SELECT pg_notify('command_status', $1)`, [notifyPayload]);
  } else {
    // No pending command found — log as standalone set_reply
    await pool.query(
      `INSERT INTO device_command_logs
         (gateway_id, command_type, config_name, message_id,
          result, error_message, device_timestamp, resolved_at)
       VALUES ($1, 'set_reply', $2, $3, $4, $5, $6, NOW())`,
      [
        gatewayId,
        configName,
        payload.messageId,
        result,
        errorMessage,
        deviceTimestamp,
      ],
    );
  }

  if (result === "accepted") {
    console.log(
      `[CommandTracker] set_reply ACCEPTED (phase 1) for ${gatewayId}`,
    );
  } else {
    console.log(
      `[CommandTracker] set_reply ${result.toUpperCase()} for ${gatewayId}`,
    );
  }
}

/** Parse device timestamp from epoch ms string. Returns null if invalid. */
function parseDeviceTimestamp(timeStampStr: string): Date | null {
  const ms = parseInt(timeStampStr, 10);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}
