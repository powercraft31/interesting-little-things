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
  readonly result?: string; // "success" | "fail"
  readonly message?: string;
}

/**
 * Handle config/get_reply: log the received config snapshot.
 */
export async function handleGetReply(
  pool: Pool,
  gatewayId: string,
  clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const data = payload.data as GetReplyData;
  const configName = data.configname ?? "battery_schedule";
  const batterySchedule = data.battery_schedule ?? null;

  const deviceTimestamp = parseDeviceTimestamp(payload.timeStamp);

  await pool.query(
    `INSERT INTO device_command_logs
       (gateway_id, client_id, command_type, config_name, message_id,
        payload_json, result, device_timestamp)
     VALUES ($1, $2, 'get_reply', $3, $4, $5, 'success', $6)`,
    [
      gatewayId,
      clientId,
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
    `[CommandTracker] get_reply logged for ${clientId}, config=${configName}`,
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
  clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const data = payload.data as SetReplyData;
  const configName = data.configname ?? "battery_schedule";
  const result = data.result ?? "fail";
  const errorMessage = data.message ?? null;

  const deviceTimestamp = parseDeviceTimestamp(payload.timeStamp);

  // Resolve the latest pending 'set' command for this gateway + config
  const updateResult = await pool.query(
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
         AND result = 'pending'
       ORDER BY created_at DESC
       LIMIT 1
     )`,
    [result, errorMessage, deviceTimestamp, gatewayId, configName],
  );

  if (updateResult.rowCount === 0) {
    // No pending command found — log as standalone set_reply
    await pool.query(
      `INSERT INTO device_command_logs
         (gateway_id, client_id, command_type, config_name, message_id,
          result, error_message, device_timestamp, resolved_at)
       VALUES ($1, $2, 'set_reply', $3, $4, $5, $6, $7, NOW())`,
      [
        gatewayId,
        clientId,
        configName,
        payload.messageId,
        result,
        errorMessage,
        deviceTimestamp,
      ],
    );
  }

  if (result === "fail") {
    console.error(
      `[CommandTracker] set_reply FAIL for ${clientId}: ${errorMessage ?? "no message"}`,
    );
  } else {
    console.log(
      `[CommandTracker] set_reply SUCCESS for ${clientId}, config=${configName}`,
    );
  }
}

/** Parse device timestamp from epoch ms string. Returns null if invalid. */
function parseDeviceTimestamp(timeStampStr: string): Date | null {
  const ms = parseInt(timeStampStr, 10);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}
