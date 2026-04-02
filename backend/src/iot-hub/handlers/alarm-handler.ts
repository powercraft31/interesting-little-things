import type { Pool } from "pg";
import type { SolfacilMessage, SolfacilAlarmPayload } from "../../shared/types/solfacil-protocol";
import { parseProtocolTimestamp } from "../../shared/protocol-time";

/**
 * V2.4: Alarm handler — processes device/ems/{clientId}/alarm messages.
 * Writes to gateway_alarm_events table using pure INSERT (audit-complete, no UPSERT).
 * Sends pg_notify('alarm_event') for real-time consumers.
 */
export async function handleAlarm(
  pool: Pool,
  gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const alarmData = payload.data as unknown as SolfacilAlarmPayload | undefined;
  const ei = alarmData?.eventinfo;

  if (!ei || typeof ei !== "object") {
    console.warn(`[Alarm] ${gatewayId}: missing eventinfo, skipping`);
    return;
  }

  // Query org_id (gateway_alarm_events.org_id NOT NULL)
  const orgResult = await pool.query(
    "SELECT org_id FROM public.gateways WHERE gateway_id = $1",
    [gatewayId],
  );
  if (orgResult.rowCount === 0) {
    console.warn(`[Alarm] ${gatewayId}: gateway not found, skipping`);
    return;
  }
  const orgId: string = orgResult.rows[0].org_id;

  let eventCreateTime: Date;
  let eventUpdateTime: Date | null = null;
  try {
    eventCreateTime = parseProtocolTimestamp(ei.createTime);
    if (ei.updateTime) eventUpdateTime = parseProtocolTimestamp(ei.updateTime);
  } catch {
    console.warn(`[Alarm] ${gatewayId}: invalid createTime/updateTime "${ei.createTime}"/"${ei.updateTime}", skipping`);
    return;
  }

  // Pure INSERT (DESIGN-10 decision: audit completeness, no UPSERT)
  await pool.query(
    `INSERT INTO public.gateway_alarm_events (
      gateway_id, org_id, device_sn, sub_dev_id, sub_dev_name,
      product_type, event_id, event_name, event_type, level,
      status, prop_id, prop_name, prop_value, description,
      event_create_time, event_update_time
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17
    )`,
    [
      gatewayId, orgId, ei.deviceSn, ei.subDevId || null, ei.subDevName || null,
      ei.productType, ei.eventId, ei.eventName, ei.eventType, ei.level,
      ei.status, ei.propId, ei.propName, ei.propValue, ei.description || null,
      eventCreateTime.toISOString(), eventUpdateTime?.toISOString() ?? null,
    ],
  );

  // pg_notify for real-time consumers
  await pool.query(
    `SELECT pg_notify('alarm_event', $1)`,
    [JSON.stringify({
      gatewayId,
      orgId,
      eventId: ei.eventId,
      status: ei.status,
      level: ei.level,
      subDevId: ei.subDevId,
    })],
  );

  console.log(`[Alarm] ${gatewayId}: processed alarm event=${ei.eventId} status=${ei.status}`);
}
