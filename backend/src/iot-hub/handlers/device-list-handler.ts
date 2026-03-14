import { Pool } from "pg";
import type {
  SolfacilMessage,
  SolfacilDevice,
} from "../../shared/types/solfacil-protocol";
import { mapProductType } from "../../shared/types/solfacil-protocol";

/**
 * PR4: DeviceListHandler
 *
 * Processes `device/ems/{clientId}/deviceList` messages.
 * UPSERTs sub-devices into `assets` table.
 * Soft-delete reconciliation: devices in DB but not in incoming list → is_active=false.
 * ABSOLUTELY NO DELETE — financial audit trail must survive.
 */

/**
 * Handle a deviceList message from a gateway.
 * Uses getServicePool (BYPASSRLS) since this is a cross-tenant operation.
 */
export async function handleDeviceList(
  pool: Pool,
  gatewayId: string,
  _clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  const data = payload.data as { deviceList?: SolfacilDevice[] };
  const deviceList = data.deviceList;

  if (!deviceList || !Array.isArray(deviceList)) {
    console.warn(
      `[DeviceListHandler] No deviceList in payload from gateway ${gatewayId}`,
    );
    return;
  }

  // Look up gateway's org_id for asset FK population
  const gwResult = await pool.query<{
    org_id: string;
  }>(`SELECT org_id FROM gateways WHERE gateway_id = $1`, [gatewayId]);

  if (gwResult.rows.length === 0) {
    console.error(`[DeviceListHandler] Gateway not found: ${gatewayId}`);
    return;
  }

  const { org_id: orgId } = gwResult.rows[0];

  // Filter: only process "major" (一級) sub-devices
  const majorDevices = deviceList.filter((d) => d.nodeType === "major");

  // Track incoming serial numbers for soft-delete reconciliation
  const incomingSerials = new Set<string>();

  // UPSERT each device
  for (const device of majorDevices) {
    incomingSerials.add(device.deviceSn);

    const assetType = mapProductType(device.productType);

    await pool.query(
      `INSERT INTO assets
         (asset_id, serial_number, name, brand, model, asset_type,
          gateway_id, org_id, is_active, commissioned_at, capacity_kwh,
          rated_max_power_kw, rated_max_current_a, rated_min_power_kw, rated_min_current_a)
       VALUES (
         $1, $1, $2, $3, $4, $5, $6, $7, true, NOW(), 0,
         NULLIF($8, '')::REAL, NULLIF($9, '')::REAL, NULLIF($10, '')::REAL, NULLIF($11, '')::REAL
       )
       ON CONFLICT (asset_id) DO UPDATE SET
         name               = EXCLUDED.name,
         brand              = EXCLUDED.brand,
         model              = EXCLUDED.model,
         asset_type         = EXCLUDED.asset_type,
         gateway_id         = EXCLUDED.gateway_id,
         org_id             = EXCLUDED.org_id,
         is_active          = true,
         rated_max_power_kw = EXCLUDED.rated_max_power_kw,
         rated_max_current_a = EXCLUDED.rated_max_current_a,
         rated_min_power_kw = EXCLUDED.rated_min_power_kw,
         rated_min_current_a = EXCLUDED.rated_min_current_a,
         updated_at         = NOW()`,
      [
        device.deviceSn, // $1 asset_id = serial_number (deterministic)
        device.name, // $2 name
        device.vendor, // $3 brand
        device.deviceBrand, // $4 model
        assetType, // $5 asset_type
        gatewayId, // $6 gateway_id
        orgId, // $7 org_id
        device.maxPower ?? "", // $8 rated_max_power_kw
        device.maxCurrent ?? "", // $9 rated_max_current_a
        device.minPower ?? "", // $10 rated_min_power_kw
        device.minCurrent ?? "", // $11 rated_min_current_a
      ],
    );
  }

  // Soft-delete reconciliation:
  // Any active device in DB for this gateway NOT in the incoming list → is_active = false
  if (majorDevices.length > 0) {
    const existingResult = await pool.query<{ serial_number: string }>(
      `SELECT serial_number FROM assets
       WHERE gateway_id = $1 AND is_active = true`,
      [gatewayId],
    );

    for (const row of existingResult.rows) {
      if (!incomingSerials.has(row.serial_number)) {
        await pool.query(
          `UPDATE assets SET is_active = false, updated_at = NOW()
           WHERE serial_number = $1 AND gateway_id = $2`,
          [row.serial_number, gatewayId],
        );
        console.log(
          `[DeviceListHandler] Soft-deleted asset: ${row.serial_number}`,
        );
      }
    }
  }

  console.log(
    `[DeviceListHandler] Processed ${majorDevices.length} devices for gateway ${gatewayId}`,
  );
}
