# M1: IoT Hub Module — MQTT 協議接入層

> **Module Version**: v5.18
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-09
> **Description**: Full Solfacil Protocol v1.1 integration — 5 subscribe + 2 publish topics, anti-corruption layer, gateway registry
> **Core Theme**: Replace single-topic Xuheng bridge with complete protocol-aware IoT Hub

---

## Changes from v5.16

| Component | Before (v5.16) | After (v5.18) |
|-----------|---------------|---------------|
| MQTT Topics | 1 wildcard `xuheng/+/+/data` | 5 subscribe + 2 publish per gateway (Solfacil Protocol v1.1) |
| Connection | Single broker, single subscription | Per-gateway subscriptions read from `gateways` table |
| XuhengAdapter | Parses batList partial fields | Full ACL: 6 Lists × all fields |
| Device Discovery | None (manual assets insert) | `DeviceListHandler`: deviceList → assets UPSERT |
| Config Management | None | `ScheduleTranslator`: battery_schedule ↔ domain model bidirectional |
| Heartbeat | None | `HeartbeatHandler`: status → gateways.last_seen_at |
| Command Tracking | None | `CommandTracker`: set_reply → device_command_logs |
| DB | assets + telemetry_history | +gateways table, +device_command_logs table, assets +gateway_id |

---

## 1. Architecture Overview

```
                  ┌────────────────────────────────────────────┐
                  │              MQTT Broker                    │
                  │         18.141.63.142:1883                  │
                  └──┬──────┬──────┬──────┬──────┬─────────────┘
                     │S1    │S2    │S3    │S4    │S5
                     ▼      ▼      ▼      ▼      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    M1 IoT Hub (v5.18)                            │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Gateway       │  │ Anti-Corruption Layer (ACL)              │ │
│  │ Connection    │  │                                          │ │
│  │ Manager       │  │  S1 → DeviceListHandler  → assets       │ │
│  │               │  │  S2 → TelemetryHandler   → telemetry_*  │ │
│  │  reads        │  │  S3 → CommandTracker     → cmd_logs     │ │
│  │  gateways     │  │  S4 → CommandTracker     → cmd_logs     │ │
│  │  table        │  │  S5 → HeartbeatHandler   → gateways     │ │
│  └──────┬───────┘  │                                          │ │
│         │          │  P1 ← ScheduleTranslator  ← BFF         │ │
│         │          │  P2 ← ScheduleTranslator  ← BFF/M2      │ │
│         ▼          └──────────────────────────────────────────┘ │
│    ┌─────────┐                                                  │
│    │gateways │                                                  │
│    │  table  │                                                  │
│    └─────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐         ┌──────────┐         ┌──────────┐
    │   BFF   │         │   M2     │         │   M3     │
    │ (API)   │         │ (Optim)  │         │ (DR)     │
    └─────────┘         └──────────┘         └──────────┘
```

### Module Interactions

| Caller | Direction | M1 Function | Trigger |
|--------|-----------|-------------|---------|
| BFF | → M1 | `publishConfigGet(clientId)` | User opens schedule editor |
| BFF | → M1 | `publishConfigSet(clientId, schedule)` | User clicks "Apply to Gateway" |
| M2 | → M1 | `publishConfigSet(clientId, schedule)` | Algorithm auto-schedule |
| M3 | → M1 | Reads `gateways` + `device_state` | DR dispatch decisions |
| M4 | ← M1 | Reads `telemetry_history` | Billing calculations |

---

## 2. MQTT Connection Manager

### 2.1 Startup Flow

```
M1 startMqttSubscriber(pool)
  │
  ├─ SELECT * FROM gateways WHERE status != 'decommissioned'
  │
  ├─ For each gateway:
  │    ├─ mqtt.connect(broker_host:broker_port, {username, password})
  │    ├─ Subscribe to 5 topics (S1–S5)
  │    └─ Store client handle in gatewayClients Map
  │
  └─ Start heartbeat watchdog (60s interval)
       └─ For each gateway: if NOW() - last_seen_at > 90s → status='offline'
```

### 2.2 Per-Gateway Topic Subscriptions

For each gateway with `client_id = {cid}`:

| # | Topic Pattern | Handler |
|---|---------------|---------|
| S1 | `device/ems/{cid}/deviceList` | `DeviceListHandler.handle()` |
| S2 | `device/ems/{cid}/data` | `TelemetryHandler.handle()` |
| S3 | `device/ems/{cid}/config/get_reply` | `CommandTracker.handleGetReply()` |
| S4 | `device/ems/{cid}/config/set_reply` | `CommandTracker.handleSetReply()` |
| S5 | `device/ems/{cid}/status` | `HeartbeatHandler.handle()` |

### 2.3 Connection Configuration

```
interface GatewayConnection {
  gatewayId: string;
  clientId: string;           // MQTT clientId (device serial)
  brokerHost: string;         // 18.141.63.142
  brokerPort: number;         // 1883
  username: string;           // xuheng
  password: string;           // xuheng8888!
  mqttClient: MqttClient;     // runtime handle
}
```

- **Reconnect**: `reconnectPeriod: 5000` (existing pattern)
- **QoS**: 1 for all subscriptions
- **Clean session**: true (no persistent sessions needed for MVP)
- **No wildcard**: Each gateway subscribes individually (shared broker with other services)

### 2.4 Dynamic Gateway Addition

MVP approach: M1 polls `gateways` table every 60s for new records. If a new gateway is found (not in `gatewayClients` Map), subscribe to its 5 topics.

No event bus or message queue — direct DB polling is sufficient for 3 gateways.

---

## 3. Topic Handlers (Anti-Corruption Layer)

### 3.1 DeviceListHandler

**Subscribe**: `device/ems/{clientId}/deviceList`
**Persistence**: `assets` table UPSERT

```
Function Signature:
  handleDeviceList(pool: Pool, gatewayId: string, payload: SolfacilMessage): Promise<void>

Input:  payload.data.deviceList[]
Output: assets table rows (INSERT or UPDATE)
```

**Processing Logic:**

1. Parse `payload.data.deviceList[]` — each element is a major (一級) sub-device
2. For each device in list:
   - Build `asset_id` from `deviceSn` (deterministic, idempotent)
   - UPSERT into `assets`:
     - `serial_number` = `deviceSn`
     - `name` = `device.name`
     - `brand` = `device.vendor`
     - `model` = `device.deviceBrand`
     - `asset_type` = map `productType` → enum (`meter` → `SMART_METER`, `inverter` → `INVERTER_BATTERY`)
     - `gateway_id` = FK to gateways table
     - `home_id` = from `gateways.home_id`
     - `org_id` = from `gateways.org_id`
     - `is_active` = true
     - `commissioned_at` = NOW() (only on INSERT, not UPDATE)
3. **Soft-delete reconciliation** (鐵律):
   - Query all `assets WHERE gateway_id = $1 AND is_active = true`
   - Compare against incoming `deviceList[].deviceSn`
   - Any DB device NOT in the incoming list → `UPDATE assets SET is_active = false WHERE serial_number = $sn`
   - **ABSOLUTELY NO DELETE** — historical financial trails must survive

**Protocol Field → Domain Mapping (deviceList):**

| Protocol Field | DB Column | Notes |
|---------------|-----------|-------|
| `deviceSn` | `assets.serial_number` | Primary lookup key |
| `name` | `assets.name` | e.g. "GoodWe-1" |
| `vendor` | `assets.brand` | e.g. "GoodWe" |
| `deviceBrand` | `assets.model` | e.g. "inverter-goodwe-Energystore" |
| `productType` | `assets.asset_type` | meter→SMART_METER, inverter→INVERTER_BATTERY |
| `connectStatus` | `assets.is_active` | "online"→true (but soft-delete logic overrides) |
| `bindStatus` | (logged only) | true/false, informational |
| `protocolAddr` | (stored in telemetry_json or ignored) | Modbus address |
| `nodeType` | (filter: only process "major") | major/minor |
| `subDevId` | (ignored) | Auto-generated by gateway |
| `fatherSn` | (used for hierarchy, not stored directly) | Parent device SN |

### 3.2 TelemetryHandler

**Subscribe**: `device/ems/{clientId}/data`
**Persistence**: `telemetry_history` (via MessageBuffer), `device_state` (via updateDeviceState)

```
Function Signature:
  handleTelemetry(pool: Pool, gatewayId: string, payload: SolfacilMessage): Promise<void>

Input:  payload.data.{meterList, gridList, pvList, batList, loadList, flloadList}
Output: telemetry_history rows, device_state updates
```

**鐵律 — TimeStamp Rule:**
All `recorded_at` values MUST be parsed from `payload.timeStamp` (epoch ms string). Server-side `NOW()` is FORBIDDEN for telemetry writes. This ensures backfill idempotency and M4 billing window accuracy.

```
const recordedAt = new Date(parseInt(payload.timeStamp, 10));
```

**Processing Logic:**

1. Parse `payload.timeStamp` → `recordedAt`
2. For each List present in `payload.data`:
   - Extract device-level fields from `properties`
   - Convert all string values to numbers via `safeFloat()`
   - Build `ParsedTelemetry` record
3. Route through existing `MessageBuffer` (2s debounce) → `telemetry_history` INSERT
4. Update `device_state` for real-time dashboard

#### 3.2.1 Complete Field Mappings per List

**batList (Battery) — 13 fields:**

| Protocol Field (`properties.*`) | ParsedTelemetry Field | DB Column (`telemetry_history`) | Unit | Notes |
|------|------|------|------|------|
| `total_bat_soc` | `batterySoc` | `battery_soc` | % | |
| `total_bat_soh` | `batterySoh` | `battery_soh` | % | BMS direct |
| `total_bat_power` | `batteryPowerKw` | `battery_power` | W | discharge=positive, charge=negative |
| `total_bat_current` | `batteryCurrent` | `battery_current` | A | positive=discharge, negative=charge |
| `total_bat_vlotage` | `batteryVoltage` | `battery_voltage` | V | **Typo in protocol: vlotage** |
| `total_bat_temperature` | `batteryTemperature` | `battery_temperature` | ℃ | |
| `total_bat_maxChargeVoltage` | `maxChargeVoltage` | `max_charge_voltage` | V | BMS limit |
| `total_bat_maxChargeCurrent` | `maxChargeCurrent` | `max_charge_current` | A | BMS limit |
| `total_bat_maxDischargeCurrent` | `maxDischargeCurrent` | `max_discharge_current` | A | BMS limit |
| `total_bat_dailyChargedEnergy` | `dailyChargeKwh` | `daily_charge_kwh` | kWh | |
| `total_bat_dailyDischargedEnergy` | `dailyDischargeKwh` | `daily_discharge_kwh` | kWh | |
| `total_bat_totalChargedEnergy` | `totalChargeKwh` | `total_charge_kwh` | kWh | Lifetime |
| `total_bat_totalDischargedEnergy` | `totalDischargeKwh` | `total_discharge_kwh` | kWh | Lifetime |

**gridList (Inverter Grid-Side) — 27 fields:**

| Protocol Field | ParsedTelemetry Field | DB Column | Unit |
|------|------|------|------|
| `grid_voltA` | `gridVoltA` | `grid_volt_a` | V |
| `grid_voltB` | `gridVoltB` | `grid_volt_b` | V |
| `grid_voltC` | `gridVoltC` | `grid_volt_c` | V |
| `grid_currentA` | `gridCurrentA` | `grid_current_a` | A |
| `grid_currentB` | `gridCurrentB` | `grid_current_b` | A |
| `grid_currentC` | `gridCurrentC` | `grid_current_c` | A |
| `grid_activePowerA` | `gridActivePowerA` | `grid_active_power_a` | W |
| `grid_activePowerB` | `gridActivePowerB` | `grid_active_power_b` | W |
| `grid_activePowerC` | `gridActivePowerC` | `grid_active_power_c` | W |
| `grid_totalActivePower` | `gridPowerKw` | `grid_power_kw` | W |
| `grid_reactivePowerA` | `gridReactivePowerA` | `grid_reactive_power_a` | Var |
| `grid_reactivePowerB` | `gridReactivePowerB` | `grid_reactive_power_b` | Var |
| `grid_reactivePowerC` | `gridReactivePowerC` | `grid_reactive_power_c` | Var |
| `grid_totalReactivePower` | `gridTotalReactivePower` | `grid_total_reactive_power` | Var |
| `grid_apparentPowerA` | `gridApparentPowerA` | `grid_apparent_power_a` | VA |
| `grid_apparentPowerB` | `gridApparentPowerB` | `grid_apparent_power_b` | VA |
| `grid_apparentPowerC` | `gridApparentPowerC` | `grid_apparent_power_c` | VA |
| `grid_totalApparentPower` | `gridTotalApparentPower` | `grid_total_apparent_power` | VA |
| `grid_factorA` | `gridFactorA` | `grid_factor_a` | - |
| `grid_factorB` | `gridFactorB` | `grid_factor_b` | - |
| `grid_factorC` | `gridFactorC` | `grid_factor_c` | - |
| `grid_frequency` | `gridFrequency` | `grid_frequency` | Hz |
| `grid_dailyBuyEnergy` | `gridDailyBuyKwh` | `grid_import_kwh` | kWh |
| `grid_dailySellEnergy` | `gridDailySellKwh` | `grid_export_kwh` | kWh |
| `grid_totalBuyEnergy` | `gridTotalBuyKwh` | `grid_total_buy_kwh` | kWh |
| `grid_totalSellEnergy` | `gridTotalSellKwh` | `grid_total_sell_kwh` | kWh |
| `grid_temp` | `inverterTemp` | `inverter_temp` | ℃ |

**meterList (Smart Meter) — Single-phase 6 fields / Three-phase 29 fields:**

| Protocol Field | ParsedTelemetry Field | DB Column | Unit | Phase |
|------|------|------|------|------|
| `grid_voltA` | `meterVoltA` | `meter_volt_a` | V | Single/Three |
| `grid_voltB` | `meterVoltB` | `meter_volt_b` | V | Three only |
| `grid_voltC` | `meterVoltC` | `meter_volt_c` | V | Three only |
| `grid_lineABVolt` | `meterLineABVolt` | `meter_line_ab_volt` | V | Three only |
| `grid_lineBCVolt` | `meterLineBCVolt` | `meter_line_bc_volt` | V | Three only |
| `grid_lineCAVolt` | `meterLineCAVolt` | `meter_line_ca_volt` | V | Three only |
| `grid_currentA` | `meterCurrentA` | `meter_current_a` | A | Single/Three |
| `grid_currentB` | `meterCurrentB` | `meter_current_b` | A | Three only |
| `grid_currentC` | `meterCurrentC` | `meter_current_c` | A | Three only |
| `grid_activePowerA` | `meterActivePowerA` | `meter_active_power_a` | W | Single/Three |
| `grid_activePowerB` | `meterActivePowerB` | `meter_active_power_b` | W | Three only |
| `grid_activePowerC` | `meterActivePowerC` | `meter_active_power_c` | W | Three only |
| `grid_totalActivePower` | `meterTotalActivePower` | `meter_total_active_power` | W | Three only |
| `grid_reactivePowerA` | `meterReactivePowerA` | `meter_reactive_power_a` | Var | Single/Three |
| `grid_reactivePowerB` | `meterReactivePowerB` | `meter_reactive_power_b` | Var | Three only |
| `grid_reactivePowerC` | `meterReactivePowerC` | `meter_reactive_power_c` | Var | Three only |
| `grid_totalReactivePower` | `meterTotalReactivePower` | `meter_total_reactive_power` | Var | Three only |
| `grid_factor` | `meterFactor` | `meter_factor` | - | Three only |
| `grid_factorA` | `meterFactorA` | `meter_factor_a` | - | Single/Three |
| `grid_factorB` | `meterFactorB` | `meter_factor_b` | - | Three only |
| `grid_factorC` | `meterFactorC` | `meter_factor_c` | - | Three only |
| `grid_frequency` | `meterFrequency` | `meter_frequency` | Hz | Single/Three |
| `grid_positiveEnergy` | `meterPositiveEnergy` | `meter_positive_energy` | kWh | Three only |
| `grid_positiveEnergyA` | `meterPositiveEnergyA` | `meter_positive_energy_a` | kWh | Three only |
| `grid_positiveEnergyB` | `meterPositiveEnergyB` | `meter_positive_energy_b` | kWh | Three only |
| `grid_positiveEnergyC` | `meterPositiveEnergyC` | `meter_positive_energy_c` | kWh | Three only |
| `grid_netForwardActiveEnergy` | `meterNetForwardEnergy` | `meter_net_forward_energy` | kWh | Three only |
| `grid_negativeEnergyA` | `meterNegativeEnergyA` | `meter_negative_energy_a` | kWh | Three only |
| `grid_negativeEnergyB` | `meterNegativeEnergyB` | `meter_negative_energy_b` | kWh | Three only |
| `grid_negativeEnergyC` | `meterNegativeEnergyC` | `meter_negative_energy_c` | kWh | Three only |
| `grid_netReverseActiveEnergy` | `meterNetReverseEnergy` | `meter_net_reverse_energy` | kWh | Three only |

**pvList (Solar PV) — 9 fields:**

| Protocol Field | ParsedTelemetry Field | DB Column | Unit |
|------|------|------|------|
| `pv_totalPower` | `pvPowerKw` | `pv_power` | W |
| `pv_totalEnergy` | `pvTotalEnergyKwh` | `pv_total_energy_kwh` | kWh |
| `pv_dailyEnergy` | `pvDailyEnergyKwh` | `pv_daily_energy_kwh` | kWh |
| `pv1_voltage` | `pv1Voltage` | `pv1_voltage` | V |
| `pv1_current` | `pv1Current` | `pv1_current` | A |
| `pv1_power` | `pv1Power` | `pv1_power` | W |
| `pv2_voltage` | `pv2Voltage` | `pv2_voltage` | V |
| `pv2_current` | `pv2Current` | `pv2_current` | A |
| `pv2_power` | `pv2Power` | `pv2_power` | W |

**loadList (Backup Load) — 13 fields:**

| Protocol Field | ParsedTelemetry Field | DB Column | Unit |
|------|------|------|------|
| `load1_voltA` | `loadVoltA` | `load_volt_a` | V |
| `load1_voltB` | `loadVoltB` | `load_volt_b` | V |
| `load1_voltC` | `loadVoltC` | `load_volt_c` | V |
| `load1_currentA` | `loadCurrentA` | `load_current_a` | A |
| `load1_currentB` | `loadCurrentB` | `load_current_b` | A |
| `load1_currentC` | `loadCurrentC` | `load_current_c` | A |
| `load1_activePowerA` | `loadActivePowerA` | `load_active_power_a` | W |
| `load1_activePowerB` | `loadActivePowerB` | `load_active_power_b` | W |
| `load1_activePowerC` | `loadActivePowerC` | `load_active_power_c` | W |
| `load1_frequencyA` | `loadFrequencyA` | `load_frequency_a` | Hz |
| `load1_frequencyB` | `loadFrequencyB` | `load_frequency_b` | Hz |
| `load1_frequencyC` | `loadFrequencyC` | `load_frequency_c` | Hz |
| `load1_totalPower` | `loadPowerKw` | `load_power` | W |

**flloadList (Home Total Load) — 5 fields:**

| Protocol Field | ParsedTelemetry Field | DB Column | Unit |
|------|------|------|------|
| `flload_totalPower` | `flloadPowerKw` | `flload_power` | W |
| `flload_dailyEnergy` | `flloadDailyEnergyKwh` | `flload_daily_energy_kwh` | kWh |
| `flload_activePowerA` | `flloadActivePowerA` | `flload_active_power_a` | W |
| `flload_activePowerB` | `flloadActivePowerB` | `flload_active_power_b` | W |
| `flload_activePowerC` | `flloadActivePowerC` | `flload_active_power_c` | W |

### 3.3 ScheduleTranslator (Bidirectional)

```
Function Signatures:

  // Read direction: protocol → domain model
  parseGetReply(payload: SolfacilMessage): DomainSchedule | null

  // Write direction: domain model → protocol message
  buildConfigSet(clientId: string, schedule: DomainSchedule): SolfacilConfigSetMessage

  // Validate before publish (hard crash on failure)
  validateSchedule(schedule: DomainSchedule): ValidationResult
```

#### 3.3.1 Read Direction (get_reply → Domain Model)

| Protocol (`battery_schedule`) | Domain Model | Translation Rule |
|------|------|------|
| `soc_min_limit` (string) | `socMinLimit` (number) | `parseInt()` |
| `soc_max_limit` (string) | `socMaxLimit` (number) | `parseInt()` |
| `max_charge_current` (string) | `maxChargeCurrent` (number) | `parseInt()` |
| `max_discharge_current` (string) | `maxDischargeCurrent` (number) | `parseInt()` |
| `grid_import_limit` (string) | `gridImportLimitKw` (number) | `parseInt()` |
| `slots[]` | `slots[]` | Per-slot translation below |

**Per-Slot Translation:**

| Protocol Slot | Domain Slot | Translation |
|------|------|------|
| `purpose:"tariff"` + `direction:"charge"` | `mode: "peak_valley_arbitrage"`, `action: "charge"` | Valley charge window |
| `purpose:"tariff"` + `direction:"discharge"` | `mode: "peak_valley_arbitrage"`, `action: "discharge"` | Peak discharge window |
| `purpose:"tariff"` + `direction:"discharge"` + `export_policy:"allow"` | `mode: "peak_valley_arbitrage"`, `action: "discharge"`, `allowExport: true` | VPP export allowed |
| `purpose:"tariff"` + `direction:"discharge"` + `export_policy:"forbid"` | `mode: "peak_valley_arbitrage"`, `action: "discharge"`, `allowExport: false` | Self-use only |
| `purpose:"self_consumption"` | `mode: "self_consumption"` | Self-consumption |
| `purpose:"peak_shaving"` | `mode: "peak_shaving"` | Peak shaving |
| `start` (string) | `startMinute` (number) | `parseInt()`, minutes from 00:00 |
| `end` (string) | `endMinute` (number) | `parseInt()`, minutes from 00:00 |

#### 3.3.2 Write Direction (Domain Model → config/set)

Reverse of read direction. All numeric values converted to strings. The output message structure:

```
{
  DS: 0,
  ackFlag: 0,
  data: {
    configname: "battery_schedule",
    battery_schedule: {
      soc_min_limit: String(schedule.socMinLimit),
      soc_max_limit: String(schedule.socMaxLimit),
      max_charge_current: String(schedule.maxChargeCurrent),
      max_discharge_current: String(schedule.maxDischargeCurrent),
      grid_import_limit: String(schedule.gridImportLimitKw),
      slots: schedule.slots.map(s => translateSlotToProcotol(s))
    }
  },
  clientId: clientId,
  deviceName: "EMS_N2",
  productKey: "ems",
  messageId: String(Date.now()),
  timeStamp: String(Date.now())
}
```

#### 3.3.3 Validation Rules (Hard Crash — No Publish on Failure)

| Rule | Constraint | Action on Failure |
|------|------|------|
| `soc_min_limit` | 0 ≤ val ≤ 100, val < `soc_max_limit` | Throw `ScheduleValidationError` |
| `soc_max_limit` | 0 ≤ val ≤ 100, val > `soc_min_limit` | Throw |
| `max_charge_current` | ≥ 0, ≤ BMS `total_bat_maxChargeCurrent` | Throw |
| `max_discharge_current` | ≥ 0, ≤ BMS `total_bat_maxDischargeCurrent` | Throw |
| `grid_import_limit` | ≥ 0 (KW) | Throw |
| `slot.start` | 0–1380, multiple of 60 | Throw |
| `slot.end` | 60–1440, multiple of 60, > start | Throw |
| Slot coverage | Union of all slots must equal [0, 1440) | Throw |
| Slot overlap | No two slots may cover the same minute | Throw |

**BMS limit lookup**: Read latest `max_charge_current` and `max_discharge_current` from `telemetry_history` for the gateway's inverter asset, ordered by `recorded_at DESC LIMIT 1`.

### 3.4 HeartbeatHandler

**Subscribe**: `device/ems/{clientId}/status`
**Persistence**: `gateways.last_seen_at`, `gateways.status`

```
Function Signature:
  handleHeartbeat(pool: Pool, clientId: string, payload: SolfacilMessage): Promise<void>

Logic:
  UPDATE gateways
    SET last_seen_at = to_timestamp($1::bigint / 1000.0),
        status = 'online',
        updated_at = NOW()
    WHERE client_id = $2
```

- Lightest handler — single UPDATE per message
- `payload.timeStamp` used for `last_seen_at` (device clock, not server clock)
- Heartbeat interval: 30s (per protocol)
- Offline threshold: 90s (3 missed heartbeats) — enforced by the watchdog timer in Connection Manager

### 3.5 CommandTracker

**Subscribe**: `device/ems/{clientId}/config/get_reply` + `device/ems/{clientId}/config/set_reply`
**Persistence**: `device_command_logs` table

```
Function Signatures:
  handleGetReply(pool: Pool, clientId: string, payload: SolfacilMessage): Promise<void>
  handleSetReply(pool: Pool, clientId: string, payload: SolfacilMessage): Promise<void>
```

**get_reply handling:**
1. Parse `payload.data.battery_schedule` via `ScheduleTranslator.parseGetReply()`
2. Insert into `device_command_logs`:
   - `command_type = 'get_reply'`
   - `config_name = payload.data.configname`
   - `payload_json = payload.data.battery_schedule` (raw JSON)
   - `result = 'success'`
   - `device_timestamp` = parsed from `payload.timeStamp`
3. Optionally cache the schedule in memory for BFF polling

**set_reply handling (異步閉環鐵律):**
1. Parse `payload.data.result` and `payload.data.message`
2. Update `device_command_logs`:
   - Find matching pending command by `client_id + configname` (latest unresolved)
   - Set `result = payload.data.result` ("success" or "fail")
   - Set `error_message = payload.data.message`
   - Set `resolved_at = NOW()`
   - Set `device_timestamp` = parsed from `payload.timeStamp`
3. If `result = "fail"`, log error with full context for debugging

---

## 4. Publish Functions

### 4.1 publishConfigGet

**Topic**: `platform/ems/{clientId}/config/get`
**Caller**: BFF (user opens schedule editor)

```
Function Signature:
  publishConfigGet(clientId: string): Promise<string>
    // Returns: messageId for tracking

Logic:
  1. Generate messageId = String(Date.now())
  2. Build message: { DS:0, ackFlag:0, data:{configname:"battery_schedule"}, clientId, deviceName:"EMS_N2", productKey:"ems", messageId, timeStamp:String(Date.now()) }
  3. INSERT into device_command_logs: command_type='get', config_name='battery_schedule', status='pending'
  4. Publish to MQTT topic
  5. Return messageId
```

### 4.2 publishConfigSet

**Topic**: `platform/ems/{clientId}/config/set`
**Caller**: BFF (user clicks Apply) or M2 (algorithm auto-schedule)

```
Function Signature:
  publishConfigSet(clientId: string, schedule: DomainSchedule): Promise<string>
    // Returns: messageId for tracking
    // Throws: ScheduleValidationError if validation fails

Logic:
  1. validateSchedule(schedule) — HARD CRASH on failure, never publish invalid config
  2. Generate messageId
  3. Build protocol message via ScheduleTranslator.buildConfigSet()
  4. INSERT into device_command_logs: command_type='set', config_name='battery_schedule', status='pending', payload_json=schedule
  5. Publish to MQTT topic
  6. Return messageId
```

---

## 5. DB DDL Design

### 5.1 New Table: `gateways`

```sql
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id        VARCHAR(50)  PRIMARY KEY,
  client_id         VARCHAR(100) NOT NULL UNIQUE,  -- MQTT clientId = device serial
  org_id            VARCHAR(50)  NOT NULL REFERENCES organizations(org_id),
  home_id           VARCHAR(50)  REFERENCES homes(home_id),
  mqtt_broker_host  VARCHAR(255) NOT NULL DEFAULT '18.141.63.142',
  mqtt_broker_port  INTEGER      NOT NULL DEFAULT 1883,
  mqtt_username     VARCHAR(100) NOT NULL DEFAULT 'xuheng',
  mqtt_password     VARCHAR(255) NOT NULL DEFAULT 'xuheng8888!',
  device_name       VARCHAR(100) DEFAULT 'EMS_N2',
  product_key       VARCHAR(50)  DEFAULT 'ems',
  status            VARCHAR(20)  NOT NULL DEFAULT 'online'
                      CHECK (status IN ('online', 'offline', 'decommissioned')),
  last_seen_at      TIMESTAMPTZ,
  commissioned_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateways_org ON gateways(org_id);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);

-- RLS: tenant isolation
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_gateways_tenant ON gateways
  USING (org_id = current_setting('app.current_org_id', true));
```

### 5.2 New Table: `device_command_logs`

```sql
CREATE TABLE IF NOT EXISTS device_command_logs (
  id                BIGSERIAL    PRIMARY KEY,
  gateway_id        VARCHAR(50)  NOT NULL REFERENCES gateways(gateway_id),
  client_id         VARCHAR(100) NOT NULL,
  command_type      VARCHAR(20)  NOT NULL
                      CHECK (command_type IN ('get', 'get_reply', 'set', 'set_reply')),
  config_name       VARCHAR(100) NOT NULL DEFAULT 'battery_schedule',
  message_id        VARCHAR(50),
  payload_json      JSONB,
  result            VARCHAR(20),       -- 'success' | 'fail' | 'pending' | 'timeout'
  error_message     TEXT,
  device_timestamp  TIMESTAMPTZ,       -- parsed from payload.timeStamp
  resolved_at       TIMESTAMPTZ,       -- when reply received
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmd_logs_gateway ON device_command_logs(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_pending ON device_command_logs(result) WHERE result = 'pending';
```

### 5.3 `assets` Table Extension

```sql
-- Add gateway_id FK to assets
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(50) REFERENCES gateways(gateway_id);

CREATE INDEX IF NOT EXISTS idx_assets_gateway ON assets(gateway_id);
```

### 5.4 `telemetry_history` Table Extension

The current `telemetry_history` has 15 columns (v5.16). To accommodate the full protocol, add columns for the complete set of telemetry fields. The approach: store expanded data in a JSONB `telemetry_extra` column rather than adding 80+ individual columns.

```sql
-- Core numeric columns kept for fast queries (used by M2/M3/M4):
--   battery_soc, battery_power, pv_power, grid_power_kw, load_power
--   battery_soh, battery_voltage, battery_current, battery_temperature
--   grid_import_kwh, grid_export_kwh, do0_active, do1_active

-- New: JSONB column for full protocol data (meter/grid/pv/load/flload detail)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS telemetry_extra JSONB;

-- New: flload total power (used by dashboard, worth a dedicated column)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS flload_power DECIMAL(8,3);

-- New: inverter temperature (used by health monitoring)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS inverter_temp DECIMAL(5,2);

-- New: PV daily energy (used by M4 revenue)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS pv_daily_energy_kwh DECIMAL(10,3);

-- New: BMS limits (used by ScheduleTranslator validation)
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_charge_current DECIMAL(8,3);
ALTER TABLE telemetry_history
  ADD COLUMN IF NOT EXISTS max_discharge_current DECIMAL(8,3);
```

**Design Decision — Hybrid Column + JSONB Strategy:**
- **Dedicated columns** for fields actively queried by M2/M3/M4 (battery, grid totals, PV totals, DO state)
- **JSONB `telemetry_extra`** for three-phase detail fields (meterList per-phase, gridList per-phase, loadList per-phase) that are only needed for diagnostics/drill-down
- This avoids adding 60+ columns to a time-series partitioned table while keeping hot-path queries efficient

**telemetry_extra JSONB Structure:**

```json
{
  "meter": {
    "volt_a": 230, "volt_b": 230, "volt_c": 230,
    "line_ab_volt": 398, "line_bc_volt": 398, "line_ca_volt": 398,
    "current_a": 10, "current_b": 10, "current_c": 10,
    "active_power_a": 2300, "active_power_b": 2300, "active_power_c": 2300,
    "total_active_power": 6900,
    "reactive_power_a": 20, "reactive_power_b": 20, "reactive_power_c": 20,
    "total_reactive_power": 60,
    "factor": 0.99, "factor_a": 0.99, "factor_b": 0.99, "factor_c": 0.99,
    "frequency": 60,
    "positive_energy": 1234, "positive_energy_a": 411,
    "positive_energy_b": 412, "positive_energy_c": 411,
    "net_forward_energy": 1200,
    "negative_energy_a": 10, "negative_energy_b": 10, "negative_energy_c": 10,
    "net_reverse_energy": 30
  },
  "grid": {
    "volt_a": 230, "volt_b": 230, "volt_c": 230,
    "current_a": 5, "current_b": 5, "current_c": 5,
    "active_power_a": 1150, "active_power_b": 1150, "active_power_c": 1150,
    "reactive_power_a": 50, "reactive_power_b": 50, "reactive_power_c": 50,
    "total_reactive_power": 150,
    "apparent_power_a": 1155, "apparent_power_b": 1155, "apparent_power_c": 1155,
    "total_apparent_power": 3465,
    "factor_a": 0.99, "factor_b": 0.99, "factor_c": 0.99,
    "frequency": 60,
    "total_buy_kwh": 5000, "total_sell_kwh": 200
  },
  "pv": {
    "pv1_voltage": 380, "pv1_current": 8.5, "pv1_power": 3230,
    "pv2_voltage": 375, "pv2_current": 8.3, "pv2_power": 3112,
    "total_energy_kwh": 12345
  },
  "load": {
    "volt_a": 230, "volt_b": 230, "volt_c": 230,
    "current_a": 3, "current_b": 3, "current_c": 3,
    "active_power_a": 690, "active_power_b": 690, "active_power_c": 690,
    "frequency_a": 60, "frequency_b": 60, "frequency_c": 60
  },
  "flload": {
    "active_power_a": 800, "active_power_b": 800, "active_power_c": 800,
    "daily_energy_kwh": 18.5
  }
}
```

---

## 6. Domain Model Types

### 6.1 SolfacilMessage (Protocol Envelope)

```
interface SolfacilMessage {
  readonly DS: number;
  readonly ackFlag: number;
  readonly clientId: string;
  readonly deviceName: string;
  readonly productKey: string;
  readonly messageId: string;
  readonly timeStamp: string;          // epoch ms as string
  readonly data: Record<string, unknown>;
}
```

### 6.2 DomainSchedule

```
interface DomainSchedule {
  readonly socMinLimit: number;        // 0-100
  readonly socMaxLimit: number;        // 0-100
  readonly maxChargeCurrent: number;   // A, ≥0
  readonly maxDischargeCurrent: number; // A, ≥0
  readonly gridImportLimitKw: number;  // KW, ≥0
  readonly slots: ReadonlyArray<DomainSlot>;
}

interface DomainSlot {
  readonly mode: 'self_consumption' | 'peak_valley_arbitrage' | 'peak_shaving';
  readonly action?: 'charge' | 'discharge' | 'neutral';
  readonly allowExport?: boolean;
  readonly startMinute: number;        // 0-1380, multiple of 60
  readonly endMinute: number;          // 60-1440, multiple of 60
}
```

---

## 7. What Stays Unchanged from v5.16

| Component | Status | Notes |
|-----------|--------|-------|
| `message-buffer.ts` | Retained, extended | Add new columns to INSERT |
| `device-asset-cache.ts` | Retained | Still resolves serial_number → asset_id |
| `telemetry-5min-aggregator.ts` | Unchanged | Uses existing hot-path columns only |
| `telemetry-aggregator.ts` (hourly) | Unchanged | Uses existing hot-path columns only |
| `state-updater.ts` | Unchanged | |
| All M2/M3/M4 modules | Unchanged | They consume existing columns; new fields are additive |

---

## 8. Error Handling

| Scenario | Behavior |
|----------|----------|
| MQTT parse error (malformed JSON) | Log error, skip message, continue |
| Unknown clientId (not in gateways table) | Log warning, skip message |
| deviceList UPSERT failure | Log error, skip batch, continue |
| Telemetry INSERT failure | Log error (MessageBuffer existing behavior) |
| Schedule validation failure | Throw `ScheduleValidationError`, DO NOT publish |
| MQTT broker disconnect | Auto-reconnect (reconnectPeriod: 5000ms) |
| DB connection failure | Crash + systemd restart (existing behavior) |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: IoT Hub Lambda + IoT Core |
| v5.13 | 2026-03-05 | Block 1: mqtt-subscriber + XuhengAdapter |
| v5.14 | 2026-03-06 | XuhengAdapter +9 bat.properties |
| v5.15 | 2026-03-07 | 5-min aggregator |
| v5.16 | 2026-03-07 | DO telemetry |
| **v5.18** | **2026-03-09** | **Full Solfacil Protocol v1.1: 5 subscribe + 2 publish, DeviceListHandler, TelemetryHandler (6 Lists full fields), ScheduleTranslator (bidirectional), HeartbeatHandler, CommandTracker, gateways table, device_command_logs table, hybrid column+JSONB telemetry storage** |
