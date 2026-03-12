import { Pool } from "pg";
import type { SolfacilMessage } from "../../shared/types/solfacil-protocol";

/**
 * PR5: HeartbeatHandler
 *
 * Processes `device/ems/{clientId}/status` messages.
 * Updates `gateways.last_seen_at` using payload.timeStamp (device clock, NOT server clock).
 * v5.22: Detects reconnect gaps and queues backfill requests via atomic CTE.
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

  // Reconnect detection: only when transitioning from non-online to online
  if (result.rows.length > 0) {
    const { prev_last_seen, prev_status } = result.rows[0];

    if (prev_last_seen && prev_status !== "online") {
      const newTime = new Date(deviceTimestamp);
      const gapMs = newTime.getTime() - new Date(prev_last_seen).getTime();
      const RECONNECT_THRESHOLD_MS = 120_000; // 2 minutes

      if (gapMs > RECONNECT_THRESHOLD_MS) {
        await pool.query(
          `INSERT INTO backfill_requests (gateway_id, gap_start, gap_end)
           VALUES ($1, $2, to_timestamp($3::bigint / 1000.0))`,
          [gatewayId, prev_last_seen, deviceTimestamp],
        );
        console.log(
          `[HeartbeatHandler] Reconnect: ${gatewayId}, gap=${Math.round(gapMs / 60000)}min, backfill queued`,
        );
      }
    }
  }

  // Existing pg_notify
  await pool.query("SELECT pg_notify('gateway_health', $1)", [gatewayId]);
}
