# M3: DR Dispatcher -- Peak Shaving Command Dispatch

> **Module Version**: v5.16
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: command-dispatcher.ts adds handling for target_mode = 'peak_shaving'
> **Core Theme**: PS command payload dispatch to gateway via MQTT

---

## Changes from v5.15

| Aspect | v5.15 | v5.16 |
|--------|-------|-------|
| PS command handling | Not implemented | **NEW**: emit PS MQTT payload when target_mode = 'peak_shaving' |
| dispatch_records.target_mode | Writes 'self_consumption' or 'peak_valley_arbitrage' | **+`peak_shaving`** |
| MQTT payload | SC/TOU payloads only | **+PS payload** with `peak_limit_kva` |
| tariff_schedules read | Not read by M3 | **Read** `billing_power_factor` for kW->kVA conversion |

---

## 1. PS Command Payload Structure

### File: `dr-dispatcher/services/command-dispatcher.ts`

When `trade_schedules.target_mode = 'peak_shaving'`:

```typescript
interface PeakShavingCommand {
  readonly mode: 'peak_shaving';
  readonly peak_limit_kva: number;  // contracted_demand_kw / billing_power_factor
  readonly asset_id: string;
  readonly dispatched_at: string;   // ISO 8601
}
```

### Payload Construction

```typescript
// Read contracted demand and billing power factor
const home = await getHomeForAsset(pool, assetId);
const tariff = await getActiveTariff(pool, orgId);

const peakLimitKva = home.contractedDemandKw
  / COALESCE(tariff.billingPowerFactor, 0.92);

const payload: PeakShavingCommand = {
  mode: 'peak_shaving',
  peak_limit_kva: Math.round(peakLimitKva * 1000) / 1000,  // 3 decimal places
  asset_id: assetId,
  dispatched_at: new Date().toISOString(),
};
```

### MQTT Payload Example

```json
{
  "mode": "peak_shaving",
  "peak_limit_kva": 108.696,
  "asset_id": "WKRD24070202100141I",
  "dispatched_at": "2026-03-07T21:00:00.000Z"
}
```

The gateway receives this and ensures the site's instantaneous demand stays below `peak_limit_kva` by discharging the battery and/or triggering DO relays.

---

## 2. MQTT Publish Topic

Reuse the existing dispatch topic pattern:

```
xuheng/{orgId}/{assetId}/command
```

Same topic structure as SC/TOU dispatch commands. The gateway distinguishes commands by the `mode` field in the JSON payload.

---

## 3. dispatch_records.target_mode

When a PS command is dispatched, the dispatcher writes to `dispatch_records`:

```sql
INSERT INTO dispatch_records
  (trade_id, asset_id, org_id, action, volume_kwh, status,
   target_mode, dispatched_at)
VALUES
  ($1, $2, $3, 'discharge', $4, 'dispatched',
   'peak_shaving', NOW())
```

This record is later read by M4 to identify PS-active windows for savings attribution.

---

## 4. Command Flow

```
M2 schedule-generator
  | Inserts trade_schedules row:
  |   target_mode = 'peak_shaving'
  |   action = 'discharge'
  |   status = 'scheduled'
  |
  v
M3 command-dispatcher (cron, every minute)
  | Reads: trade_schedules WHERE status = 'scheduled' AND planned_time <= NOW()
  | Detects: target_mode = 'peak_shaving'
  |
  +-- 1. Read homes.contracted_demand_kw (via asset -> home JOIN)
  +-- 2. Read tariff_schedules.billing_power_factor (via asset -> org JOIN)
  +-- 3. Compute: peak_limit_kva = contracted_demand_kw / billing_power_factor
  +-- 4. MQTT publish: { mode: 'peak_shaving', peak_limit_kva, asset_id, dispatched_at }
  +-- 5. UPDATE trade_schedules SET status = 'executing'
  +-- 6. INSERT dispatch_records (target_mode = 'peak_shaving')
  |
  v
Gateway (EMS box)
  | Receives command, enters peak_shaving mode
  | Maintains instantaneous demand <= peak_limit_kva
  | Triggers DO relays if battery insufficient
```

---

## 5. Error Handling

| Scenario | Behavior |
|----------|----------|
| `contracted_demand_kw IS NULL` | Skip dispatch, log error, set trade_schedule status = 'failed' |
| `billing_power_factor IS NULL` | Use default 0.92 via COALESCE |
| `billing_power_factor = 0` | Skip dispatch (division by zero), log error |
| MQTT publish fails | Existing retry logic (3 retries, exponential backoff) applies |
| Gateway offline | Command queued in MQTT broker (QoS 1), delivered on reconnect |

---

## 6. Pool Assignment

| Component | Pool | Change |
|-----------|------|--------|
| command-dispatcher (cron) | **Service Pool** | Unchanged (v5.11) |
| timeout-checker (cron) | **Service Pool** | Unchanged |
| collect-response (HTTP) | **App Pool** | Unchanged |

No pool changes. PS dispatch runs within the existing `command-dispatcher` cron context.

---

## 7. What Stays Unchanged

| Component | v5.15 Status | v5.16 Status |
|-----------|-------------|-------------|
| SC command dispatch | v5.9 | Unchanged |
| TOU command dispatch | v5.9 | Unchanged |
| Timeout checker | v5.11 | Unchanged |
| ACK handshake (collect-response) | v5.9 | Unchanged |
| Retry logic | v5.9 | Unchanged |
| allow_export enforcement | v5.15 | Unchanged |

---

## 8. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `dr-dispatcher/services/command-dispatcher.ts` | **MODIFY** | Add: PS command branch when target_mode='peak_shaving'; read contracted_demand_kw and billing_power_factor; compute peak_limit_kva; MQTT publish PS payload; write dispatch_records with target_mode='peak_shaving' |

---

## 9. Test Strategy

| Test | Input | Expected |
|------|-------|----------|
| PS command dispatched | trade_schedule target_mode='peak_shaving', contracted=100kW, pf=0.92 | MQTT payload: peak_limit_kva=108.696 |
| NULL contracted_demand | contracted_demand_kw IS NULL | Dispatch skipped, status='failed' |
| Default billing PF | billing_power_factor IS NULL | Uses 0.92 default |
| Zero billing PF | billing_power_factor = 0 | Dispatch skipped, error logged |
| dispatch_records written | PS command dispatched | target_mode = 'peak_shaving' in dispatch_records |
| MQTT topic correct | orgId='org1', assetId='asset1' | Topic: xuheng/org1/asset1/command |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: DR dispatch + SQS timeout |
| v5.6 | 2026-02-28 | MQTT send integration |
| v5.9 | 2026-03-02 | Command Dispatcher polling worker, async ACK |
| v5.11 | 2026-03-05 | Dual Pool: Service Pool for cron, App Pool for ACK |
| **v5.16** | **2026-03-07** | **PS command dispatch: peak_shaving mode handling; compute peak_limit_kva from contracted_demand_kw / billing_power_factor; MQTT publish PS payload; dispatch_records.target_mode = 'peak_shaving'; error handling for NULL contracted demand and zero PF** |
