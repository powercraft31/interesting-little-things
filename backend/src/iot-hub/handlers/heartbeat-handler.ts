import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";

/**
 * PR5 / v6.1: HeartbeatHandler
 *
 * Processes `device/ems/{clientId}/status` messages.
 * Updates `gateways.last_seen_at` using payload.timeStamp (device clock, NOT server clock).
 *
 * v6.1: Connectivity recovery only — closes open outage events on reconnect.
 * Backfill trigger responsibility moved to telemetry-handler.ts (gap > 5 min on primary stream).
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

  // Single atomic CTE: read previous state + update in ONE query (no extra SELECT)
  const result = await pool.query(
    `WITH prev AS (
       SELECT last_seen_at, status FROM gateways WHERE gateway_id = $2
     )
     UPDATE gateways
     SET last_seen_at = to_timestamp($1::bigint / 1000.0),
         status = 'online',
         updated_at = NOW()
     WHERE gateway_id = $2
     RETURNING
       (SELECT last_seen_at FROM prev) AS prev_last_seen,
       (SELECT status FROM prev) AS prev_status`,
    [deviceTimestamp, gatewayId],
  );

  // v6.1: Close open outage event on reconnect (connectivity recovery)
  if (result.rows.length > 0) {
    const { prev_status } = result.rows[0];

    if (prev_status && prev_status !== "online") {
      await pool.query(
        `UPDATE gateway_outage_events SET ended_at = NOW()
         WHERE gateway_id = $1 AND ended_at IS NULL`,
        [gatewayId],
      );
      console.log(
        `[HeartbeatHandler] Reconnect: ${gatewayId}, outage closed`,
      );
    }
  }

  // Existing pg_notify
  await pool.query("SELECT pg_notify('gateway_health', $1)", [gatewayId]);
}
