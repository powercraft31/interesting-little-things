import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";

/**
 * PR5: HeartbeatHandler
 *
 * Processes `device/ems/{clientId}/status` messages.
 * Updates `gateways.last_seen_at` using payload.timeStamp (device clock, NOT server clock).
 * Lightest handler — single UPDATE per message.
 */
export async function handleHeartbeat(
  pool: Pool,
  gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const deviceTimestamp = parseInt(payload.timeStamp, 10);

  if (!Number.isFinite(deviceTimestamp) || deviceTimestamp <= 0) {
    console.warn(
      `[HeartbeatHandler] Invalid timeStamp from ${gatewayId}: ${payload.timeStamp}`,
    );
    return;
  }

  await pool.query(
    `UPDATE gateways
     SET last_seen_at = to_timestamp($1::bigint / 1000.0),
         status = 'online',
         updated_at = NOW()
     WHERE gateway_id = $2`,
    [deviceTimestamp, gatewayId],
  );
}
