# Database Schema — Solfacil VPP Platform 完整資料庫結構

> **Version**: v6.6
> **Parent**: [00_MASTER_ARCHITECTURE_v6.6.md](./00_MASTER_ARCHITECTURE_v6.6.md)
> **Last Updated**: 2026-03-31
> **Git HEAD**: `4ec191a`
> **PostgreSQL**: 16.13
> **Tables**: 29 (excluding partition children)
> **Core Theme**: Comprehensive DDL reference — dual-pool RLS, native partitioning, P5 strategy triggers

---

## 1. Version History

| Version | Date | Description |
|---------|------|-------------|
| v5.22 | 2026-03-13 | gateways absorbs homes columns; backfill_requests; telemetry_history UNIQUE INDEX |
| v5.24 | 2026-03-13 | No DDL changes. Added multi-granularity query pattern docs (P3 Asset History View) |
| v6.1 | 2026-03-20 | gateway_outage_events table + RLS; partial index idx_goe_open |
| v6.2 | 2026-03-22 | gateways.home_alias column (VARCHAR(100), nullable) |
| v6.5 | 2026-03-28 | P5 Strategy Triggers: strategy_intents, posture_overrides (migration 001) |
| **v6.6** | **2026-03-31** | **Full schema document rewrite from DDL source of truth. 29 tables catalogued.** |

---

## 2. Dual-Pool Architecture (连接池双角色)

Source: `db-init/01_roles.sql`

| Role | LOGIN | BYPASSRLS | Purpose |
|------|-------|-----------|---------|
| `solfacil_app` | YES | NO | BFF / frontend connections. Subject to RLS — only sees rows matching `app.current_org_id` |
| `solfacil_service` | YES | YES | Background services (cron, MQTT ingestion, revenue engine). Bypasses RLS for cross-tenant operations |

**Connection handshake (连接握手)**: every `solfacil_app` connection must execute `SET app.current_org_id = '<org_id>'` before any query. RLS policies reference `current_setting('app.current_org_id', TRUE)`.

---

## 3. Complete Table Reference — 29 Tables

### 3.1 Core Entities (5 tables — 核心实体)

#### 3.1.1 `organizations` — 租户 (tenant root)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `org_id` | VARCHAR(50) | — | **PK** | Tenant identifier |
| `name` | VARCHAR(200) | — | NOT NULL | Organization display name |
| `plan_tier` | VARCHAR(20) | `'standard'` | NOT NULL | Subscription tier |
| `timezone` | VARCHAR(50) | `'America/Sao_Paulo'` | NOT NULL | IANA timezone for local display |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.1.2 `gateways` — EMS 网关注册 (IoT hub)

Each row = one MQTT connection to broker.

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `gateway_id` | VARCHAR(50) | — | **PK** | Device identifier |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | Owner tenant |
| `mqtt_broker_host` | VARCHAR(255) | `'18.141.63.142'` | NOT NULL | MQTT broker IP |
| `mqtt_broker_port` | INTEGER | `1883` | NOT NULL | MQTT broker port |
| `mqtt_username` | VARCHAR(100) | `'xuheng'` | NOT NULL | MQTT auth user |
| `mqtt_password` | VARCHAR(255) | `'xuheng8888!'` | NOT NULL | MQTT auth password |
| `device_name` | VARCHAR(100) | `'EMS_N2'` | | MQTT device topic prefix |
| `product_key` | VARCHAR(50) | `'ems'` | | Product line key |
| `status` | VARCHAR(20) | `'online'` | NOT NULL, CHECK(`online`,`offline`,`decommissioned`) | online = heartbeat within 90s, offline = missed 3 heartbeats |
| `last_seen_at` | TIMESTAMPTZ | — | | Last heartbeat timestamp |
| `commissioned_at` | TIMESTAMPTZ | `NOW()` | | Initial provisioning date |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `name` | VARCHAR(200) | — | | Gateway display name (v5.22: absorbed from homes) |
| `address` | TEXT | — | | Physical address |
| `contracted_demand_kw` | REAL | — | | Contracted demand per utility contract (kW) |
| `ems_health` | JSONB | `'{}'` | | Latest EMS health payload |
| `ems_health_at` | TIMESTAMPTZ | — | | Timestamp of last health payload |
| `home_alias` | VARCHAR(100) | — | | **[v6.2 NEW]** Human-readable alias for the Home site. Nullable — fallback to gateway name |

---

#### 3.1.3 `assets` — 资产台账 (energy assets)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `asset_id` | VARCHAR(200) | — | **PK** | Globally unique asset identifier |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | Owner tenant |
| `name` | VARCHAR(200) | — | NOT NULL | Display name |
| `region` | VARCHAR(10) | — | | Geographic region |
| `capacidade_kw` | NUMERIC(6,2) | — | | Rated power capacity (kW) |
| `capacity_kwh` | NUMERIC(6,2) | — | NOT NULL | Energy storage capacity (kWh) |
| `operation_mode` | VARCHAR(50) | — | | Current operation mode |
| `submercado` | VARCHAR(10) | `'SUDESTE'` | NOT NULL, CHECK(`SUDESTE`,`SUL`,`NORDESTE`,`NORTE`) | Brazilian electricity sub-market (电力子市场) |
| `retail_buy_rate_kwh` | NUMERIC(8,4) | `0.80` | NOT NULL | Grid import tariff (R$/kWh) |
| `retail_sell_rate_kwh` | NUMERIC(8,4) | `0.25` | NOT NULL | Grid export tariff (R$/kWh) |
| `asset_type` | VARCHAR(30) | `'INVERTER_BATTERY'` | NOT NULL, CHECK(5 values) | `INVERTER_BATTERY`, `SMART_METER`, `HVAC`, `EV_CHARGER`, `SOLAR_PANEL` |
| `brand` | VARCHAR(100) | — | | Manufacturer brand |
| `model` | VARCHAR(100) | — | | Device model |
| `serial_number` | VARCHAR(200) | — | | Serial number |
| `commissioned_at` | TIMESTAMPTZ | — | | Commissioning date |
| `is_active` | BOOLEAN | `true` | NOT NULL | Soft-delete flag |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `investimento_brl` | NUMERIC(14,2) | — | | Total investment (R$) |
| `roi_pct` | NUMERIC(5,2) | — | | Return on investment (%) |
| `payback_str` | VARCHAR(10) | — | | Payback period (formatted string) |
| `receita_mes_brl` | NUMERIC(12,2) | — | | Expected monthly revenue (R$) |
| `installation_cost_reais` | NUMERIC(12,2) | — | | Installation cost (R$) |
| `soc_min_pct` | REAL | `10` | | Minimum SOC threshold (%) |
| `max_charge_rate_kw` | REAL | — | | Software max charge rate limit (kW) |
| `max_discharge_rate_kw` | REAL | — | | Software max discharge rate limit (kW) |
| `allow_export` | BOOLEAN | `false` | NOT NULL | Whether grid export is permitted |
| `gateway_id` | VARCHAR(50) | — | **FK→gateways** | Parent gateway |
| `rated_max_power_kw` | REAL | — | | Hardware nameplate max power (kW) — from MQTT deviceList 硬體銘牌值 |
| `rated_max_current_a` | REAL | — | | Hardware nameplate max current (A) |
| `rated_min_power_kw` | REAL | — | | Hardware nameplate min power (kW) |
| `rated_min_current_a` | REAL | — | | Hardware nameplate min current (A) |

---

#### 3.1.4 `users` — 用户

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `user_id` | VARCHAR(50) | — | **PK** | |
| `email` | VARCHAR(255) | — | NOT NULL, **UNIQUE** | Login identifier |
| `name` | VARCHAR(200) | — | | Display name |
| `hashed_password` | VARCHAR(255) | — | | bcrypt hash |
| `is_active` | BOOLEAN | `true` | NOT NULL | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.1.5 `user_org_roles` — 用户-租户角色关联 (RBAC junction)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `user_id` | VARCHAR(50) | — | **PK (composite)**, **FK→users ON DELETE CASCADE** | |
| `org_id` | VARCHAR(50) | — | **PK (composite)**, **FK→organizations ON DELETE CASCADE** | |
| `role` | VARCHAR(30) | — | NOT NULL | Role name (admin, operator, viewer, ...) |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

### 3.2 Time-Series (3 tables, 2 partitioned — 时序数据)

#### 3.2.1 `telemetry_history` — 遥测历史 (PARTITIONED BY RANGE monthly)

**PK**: `(id, recorded_at)` — composite for partition compatibility.
**Partition key**: `recorded_at`
**Partitions**: `2026_02`, `2026_03`, `2026_04`, `default`

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `id` | BIGSERIAL | Auto-increment |
| 2 | `asset_id` | VARCHAR(200) | NOT NULL. Asset identifier |
| 3 | `recorded_at` | TIMESTAMPTZ | NOT NULL. Partition key (分区键) |
| 4 | `battery_soc` | NUMERIC(5,2) | Battery state-of-charge (%) 电池充电状态 |
| 5 | `pv_power` | NUMERIC(8,3) | PV generation power (kW) PV 发电功率 |
| 6 | `battery_power` | NUMERIC(8,3) | Battery power (kW). Positive = charge, negative = discharge 正=充，负=放 |
| 7 | `grid_power_kw` | NUMERIC(8,3) | Grid power (kW). Positive = import, negative = export 正=进口，负=出口 |
| 8 | `load_power` | NUMERIC(8,3) | Load power (kW) 负载功率 |
| 9 | `bat_work_status` | VARCHAR(20) | `charging` / `discharging` / `standby` |
| 10 | `grid_import_kwh` | NUMERIC(10,3) | Grid import energy (kWh, 5-min increment) 电网进口能量 |
| 11 | `grid_export_kwh` | NUMERIC(10,3) | Grid export energy (kWh, 5-min increment) 电网出口能量 |
| 12 | `battery_soh` | REAL | Battery state-of-health (%) 电池健康度 |
| 13 | `battery_voltage` | REAL | Battery voltage (V) 电池电压 |
| 14 | `battery_current` | REAL | Battery current (A) 电池电流 |
| 15 | `battery_temperature` | REAL | Battery temperature (C) 电池温度 |
| 16 | `do0_active` | BOOLEAN | DO0 relay state. true = closed (load shed active). NULL when dido message not received. DO0 继电器状态 |
| 17 | `do1_active` | BOOLEAN | DO1 relay state. DO1 继电器状态 |
| 18 | `telemetry_extra` | JSONB | Per-phase detail from meter/grid/pv/load/flload Lists. Diagnostics only 额外诊断栏位 |
| 19 | `flload_power` | NUMERIC(8,3) | Home total load power (W). From flloadList.flload_totalPower 家庭总负载功率 |
| 20 | `inverter_temp` | NUMERIC(5,2) | Inverter temperature (C) 逆变器温度 |
| 21 | `pv_daily_energy_kwh` | NUMERIC(10,3) | PV cumulative daily generation (kWh). Monotonically increasing per day PV 累计日发电 |
| 22 | `max_charge_current` | NUMERIC(8,3) | BMS max charge current (A). Used by ScheduleTranslator validation |
| 23 | `max_discharge_current` | NUMERIC(8,3) | BMS max discharge current (A) |
| 24 | `daily_charge_kwh` | NUMERIC(10,3) | Cumulative daily charge energy (kWh) 累计日充电能量 |
| 25 | `daily_discharge_kwh` | NUMERIC(10,3) | Cumulative daily discharge energy (kWh) 累计日放电能量 |

---

#### 3.2.2 `asset_5min_metrics` — 5分钟聚合指标 (PARTITIONED BY RANGE daily)

**Partition key**: `window_start`
**Partitions**: 32 daily partitions `20260306` through `20260406` (date boundaries aligned to `+08:00` timezone offset)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | BIGSERIAL | — | | Auto-increment |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets** | |
| `window_start` | TIMESTAMPTZ | — | NOT NULL | 5-minute window start |
| `pv_energy_kwh` | NUMERIC(10,4) | `0` | NOT NULL | PV energy in window |
| `bat_charge_kwh` | NUMERIC(10,4) | `0` | NOT NULL | Battery charge energy |
| `bat_discharge_kwh` | NUMERIC(10,4) | `0` | NOT NULL | Battery discharge energy |
| `grid_import_kwh` | NUMERIC(10,4) | `0` | NOT NULL | Grid import energy |
| `grid_export_kwh` | NUMERIC(10,4) | `0` | NOT NULL | Grid export energy |
| `load_kwh` | NUMERIC(10,4) | `0` | NOT NULL | Load consumption energy |
| `bat_charge_from_grid_kwh` | NUMERIC(10,4) | `0` | NOT NULL | Battery charge sourced from grid |
| `avg_battery_soc` | NUMERIC(5,2) | — | | Average SOC during window |
| `data_points` | INTEGER | `0` | NOT NULL | Telemetry samples aggregated |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.2.3 `asset_hourly_metrics` — 小时聚合指标 (NOT partitioned)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | BIGSERIAL | — | **PK** | |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets** | |
| `hour_timestamp` | TIMESTAMPTZ | — | NOT NULL, **UNIQUE(asset_id, hour_timestamp)** | Hour bucket |
| `total_charge_kwh` | NUMERIC(10,4) | `0` | NOT NULL | |
| `total_discharge_kwh` | NUMERIC(10,4) | `0` | NOT NULL | |
| `data_points_count` | INTEGER | `0` | NOT NULL | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `avg_battery_soh` | REAL | — | | Average SOH during hour |
| `avg_battery_voltage` | REAL | — | | Average voltage during hour |
| `avg_battery_temperature` | REAL | — | | Average temperature during hour |

---

### 3.3 Control & Dispatch (4 tables — 控制与调度)

#### 3.3.1 `device_command_logs` — 设备指令日志 (M1 IoT Hub)

Tracks config get/set commands and their async replies. 追踪配置读取/写入指令及其异步回复。

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | BIGSERIAL | — | **PK** | |
| `gateway_id` | VARCHAR(50) | — | NOT NULL, **FK→gateways** | Target gateway |
| `command_type` | VARCHAR(20) | — | NOT NULL, CHECK(`get`,`get_reply`,`set`,`set_reply`) | get = request sent, get_reply = response received, set = config pushed, set_reply = ack received |
| `config_name` | VARCHAR(100) | `'battery_schedule'` | NOT NULL | Config key being read/written |
| `message_id` | VARCHAR(50) | — | | MQTT correlation ID |
| `payload_json` | JSONB | — | | Full request/response payload |
| `result` | VARCHAR(20) | — | | Status: `pending`, `accepted`, `dispatched`, etc. |
| `error_message` | TEXT | — | | Error detail if command failed |
| `device_timestamp` | TIMESTAMPTZ | — | | Parsed from payload.timeStamp (epoch ms). Device clock, not server clock 设备端时钟 |
| `resolved_at` | TIMESTAMPTZ | — | | When reply was received |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `batch_id` | VARCHAR(50) | — | | P4 批量操作 ID. NULL = single operation (P2/auto) |
| `source` | VARCHAR(10) | `'p2'` | | Origin: `p2` = manual single, `p4` = batch, `auto` = M2 auto-schedule. 指令来源 |

---

#### 3.3.2 `dispatch_commands` — 调度命令

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `trade_id` | INTEGER | — | **FK→trade_schedules** | Originating trade schedule |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets** | Target asset |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `action` | VARCHAR(20) | — | NOT NULL | Dispatch action |
| `volume_kwh` | NUMERIC(8,2) | — | | Commanded energy volume |
| `status` | VARCHAR(20) | `'dispatched'` | NOT NULL | |
| `m1_boundary` | BOOLEAN | `true` | NOT NULL | Whether command respects M1 safety boundary |
| `dispatched_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `completed_at` | TIMESTAMPTZ | — | | |
| `error_message` | TEXT | — | | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.3.3 `dispatch_records` — 调度执行记录

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets** | |
| `dispatched_at` | TIMESTAMPTZ | — | NOT NULL | When command was sent |
| `dispatch_type` | VARCHAR(50) | — | | Type of dispatch action |
| `commanded_power_kw` | NUMERIC(8,3) | — | | Setpoint sent |
| `actual_power_kw` | NUMERIC(8,3) | — | | Measured response |
| `success` | BOOLEAN | — | | Whether dispatch succeeded |
| `response_latency_ms` | INTEGER | — | | Round-trip latency |
| `error_message` | TEXT | — | | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `target_mode` | VARCHAR(50) | — | | Intended operation mode |

---

#### 3.3.4 `trade_schedules` — 交易排程

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets** | |
| `org_id` | VARCHAR(50) | — | NOT NULL | |
| `planned_time` | TIMESTAMPTZ | — | NOT NULL | Scheduled execution time |
| `action` | VARCHAR(10) | — | NOT NULL, CHECK(`charge`,`discharge`,`idle`) | |
| `expected_volume_kwh` | NUMERIC(8,2) | — | NOT NULL | |
| `target_pld_price` | NUMERIC(10,2) | — | | Target PLD price for arbitrage |
| `status` | VARCHAR(20) | `'scheduled'` | NOT NULL | |
| `created_at` | TIMESTAMPTZ | `NOW()` | | |
| `target_mode` | VARCHAR(50) | — | | Target operation mode |

---

### 3.4 Operational (5 tables — 运营状态)

#### 3.4.1 `device_state` — 设备实时状态 (singleton per asset)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `asset_id` | VARCHAR(200) | — | **PK**, **FK→assets ON DELETE CASCADE** | |
| `battery_soc` | NUMERIC(5,2) | — | | Current SOC (%) |
| `bat_soh` | NUMERIC(5,2) | — | | Current SOH (%) |
| `bat_work_status` | VARCHAR(20) | — | | charging / discharging / standby |
| `battery_voltage` | NUMERIC(6,2) | — | | Voltage (V) |
| `bat_cycle_count` | INTEGER | — | | Lifetime cycle count |
| `pv_power` | NUMERIC(8,3) | — | | Current PV power (kW) |
| `battery_power` | NUMERIC(8,3) | — | | Current battery power (kW) |
| `grid_power_kw` | NUMERIC(8,3) | — | | Current grid power (kW) |
| `load_power` | NUMERIC(8,3) | — | | Current load power (kW) |
| `inverter_temp` | NUMERIC(5,2) | — | | Inverter temperature (C) |
| `is_online` | BOOLEAN | `false` | NOT NULL | |
| `grid_frequency` | NUMERIC(6,3) | — | | Grid frequency (Hz) |
| `telemetry_json` | JSONB | `'{}'` | | Full latest telemetry snapshot |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | Last telemetry ingest |
| `pv_daily_energy` | NUMERIC(10,3) | `0` | | PV cumulative daily (kWh) |
| `bat_charged_today` | NUMERIC(10,3) | `0` | | Battery charge cumulative daily (kWh) |
| `bat_discharged_today` | NUMERIC(10,3) | `0` | | Battery discharge cumulative daily (kWh) |
| `grid_import_kwh` | NUMERIC(10,3) | `0` | | Grid import cumulative daily (kWh) |
| `grid_export_kwh` | NUMERIC(10,3) | `0` | | Grid export cumulative daily (kWh) |

---

#### 3.4.2 `offline_events` — 离线事件

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `started_at` | TIMESTAMPTZ | — | NOT NULL | Offline start |
| `ended_at` | TIMESTAMPTZ | — | | NULL = still offline |
| `cause` | VARCHAR(50) | `'unknown'` | | Detected cause |
| `backfill` | BOOLEAN | `false` | | Whether data was backfilled |
| `created_at` | TIMESTAMPTZ | `NOW()` | | |

---

#### 3.4.3 `daily_uptime_snapshots` — 每日在线率快照

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `date` | DATE | — | NOT NULL, **UNIQUE(org_id, date)** | |
| `total_assets` | INTEGER | — | NOT NULL | Total asset count |
| `online_assets` | INTEGER | — | NOT NULL | Online count |
| `uptime_pct` | NUMERIC(5,2) | — | NOT NULL | Uptime percentage |
| `created_at` | TIMESTAMPTZ | `NOW()` | | |

---

#### 3.4.4 `gateway_outage_events` — 网关断线事件 **[v6.1 NEW]**

Consolidates flaps < 5 min into single event. 合并短于5分钟的抖动为单一事件。

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | BIGSERIAL | — | **PK** | |
| `gateway_id` | VARCHAR(50) | — | NOT NULL, **FK→gateways** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `started_at` | TIMESTAMPTZ | — | NOT NULL | Outage start |
| `ended_at` | TIMESTAMPTZ | — | | NULL = outage ongoing |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

**Indexes**: `idx_goe_gateway_started(gateway_id, started_at DESC)`, `idx_goe_org_started(org_id, started_at DESC)`, `idx_goe_open(gateway_id) WHERE ended_at IS NULL` (partial)

---

#### 3.4.5 `backfill_requests` — 数据回填请求

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | BIGSERIAL | — | **PK** | |
| `gateway_id` | VARCHAR | — | NOT NULL, **FK→gateways** | |
| `gap_start` | TIMESTAMPTZ | — | NOT NULL | Gap period start |
| `gap_end` | TIMESTAMPTZ | — | NOT NULL | Gap period end |
| `current_chunk_start` | TIMESTAMPTZ | — | | Current chunk being backfilled |
| `last_chunk_sent_at` | TIMESTAMPTZ | — | | Last chunk request timestamp |
| `status` | VARCHAR(20) | `'pending'` | NOT NULL, CHECK(`pending`,`in_progress`,`completed`,`failed`) | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `completed_at` | TIMESTAMPTZ | — | | |

---

### 3.5 Configuration (4 tables — 配置)

#### 3.5.1 `vpp_strategies` — VPP 策略配置

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `strategy_name` | VARCHAR(100) | — | NOT NULL | |
| `target_mode` | VARCHAR(50) | — | NOT NULL | |
| `min_soc` | NUMERIC(5,2) | `20` | NOT NULL | Floor SOC (%) 最低电量 |
| `max_soc` | NUMERIC(5,2) | `95` | NOT NULL | Ceiling SOC (%) 最高电量 |
| `charge_window_start` | TIME | — | | Charge window start (local) |
| `charge_window_end` | TIME | — | | |
| `discharge_window_start` | TIME | — | | |
| `max_charge_rate_kw` | NUMERIC(6,2) | — | | |
| `target_self_consumption_pct` | NUMERIC(5,2) | `80.0` | | Target self-consumption (%) |
| `is_default` | BOOLEAN | `false` | NOT NULL | |
| `is_active` | BOOLEAN | `true` | NOT NULL | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.5.2 `tariff_schedules` — 电价方案

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `schedule_name` | VARCHAR(100) | — | NOT NULL | |
| `peak_start` | TIME | — | NOT NULL | Peak period start 尖峰时段起 |
| `peak_end` | TIME | — | NOT NULL | |
| `peak_rate` | NUMERIC(8,4) | — | NOT NULL | R$/kWh peak |
| `offpeak_rate` | NUMERIC(8,4) | — | NOT NULL | R$/kWh off-peak |
| `feed_in_rate` | NUMERIC(8,4) | — | NOT NULL | R$/kWh feed-in |
| `intermediate_rate` | NUMERIC(8,4) | — | | R$/kWh shoulder period 半尖峰 |
| `intermediate_start` | TIME | — | | |
| `intermediate_end` | TIME | — | | |
| `disco` | VARCHAR(50) | — | | Distribution company (CPFL, Enel, etc.) 配电公司 |
| `currency` | VARCHAR(3) | `'BRL'` | NOT NULL | |
| `effective_from` | DATE | — | NOT NULL | Tariff effective start |
| `effective_to` | DATE | — | | NULL = open-ended |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `demand_charge_rate_per_kva` | NUMERIC(8,4) | — | | Monthly demand charge (R$/kVA). NULL = no demand charge billing 需量电费 |
| `billing_power_factor` | NUMERIC(3,2) | `0.92` | | Per ANEEL commercial billing power factor 功率因数 |

---

#### 3.5.3 `parser_rules` — 遥测解析规则

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `manufacturer` | VARCHAR(100) | — | | Device manufacturer filter |
| `model_version` | VARCHAR(100) | — | | Model version filter |
| `mapping_rule` | JSONB | — | NOT NULL | Field mapping rules |
| `unit_conversions` | JSONB | — | | Unit conversion factors |
| `is_active` | BOOLEAN | `true` | NOT NULL | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.5.4 `feature_flags` — 功能开关

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `flag_name` | VARCHAR(100) | — | NOT NULL | |
| `org_id` | VARCHAR(50) | — | **FK→organizations**, nullable | NULL = global flag 全局开关 |
| `is_enabled` | BOOLEAN | `false` | NOT NULL | |
| `description` | TEXT | — | | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

### 3.6 Financial (5 tables — 财务)

#### 3.6.1 `revenue_daily` — 每日收益

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets**, **UNIQUE(asset_id, date)** | |
| `date` | DATE | — | NOT NULL | |
| `pv_energy_kwh` | NUMERIC(10,3) | — | | PV generation |
| `grid_export_kwh` | NUMERIC(10,3) | — | | |
| `grid_import_kwh` | NUMERIC(10,3) | — | | |
| `bat_discharged_kwh` | NUMERIC(10,3) | — | | |
| `revenue_reais` | NUMERIC(12,2) | — | | Gross revenue (R$) 毛收入 |
| `cost_reais` | NUMERIC(12,2) | — | | Grid cost (R$) 电网成本 |
| `profit_reais` | NUMERIC(12,2) | — | | Net profit (R$) 净利润 |
| `vpp_arbitrage_profit_reais` | NUMERIC(12,2) | — | | VPP arbitrage contribution |
| `client_savings_reais` | NUMERIC(12,2) | — | | Client-facing savings |
| `actual_self_consumption_pct` | NUMERIC(5,2) | — | | Achieved self-consumption (%) |
| `tariff_schedule_id` | INTEGER | — | **FK→tariff_schedules** | Applied tariff |
| `calculated_at` | TIMESTAMPTZ | — | | Engine calculation timestamp |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `baseline_cost_reais` | NUMERIC(10,2) | — | | Counterfactual cost (no battery) 无电池基线成本 |
| `actual_cost_reais` | NUMERIC(10,2) | — | | Actual cost (with battery) |
| `best_tou_cost_reais` | NUMERIC(10,2) | — | | Optimal TOU cost |
| `self_sufficiency_pct` | REAL | — | | Self-sufficiency (%) |
| `sc_savings_reais` | NUMERIC(10,2) | — | | Self-consumption savings (R$) |
| `tou_savings_reais` | NUMERIC(10,2) | — | | Time-of-use arbitrage savings (R$) |
| `ps_savings_reais` | NUMERIC(10,2) | — | | Peak-shaving demand charge avoidance (R$) 需量节省 |
| `ps_avoided_peak_kva` | NUMERIC(8,3) | — | | Avoided peak demand (kVA): counterfactual - contracted |
| `do_shed_confidence` | VARCHAR(10) | — | | `high` = full telemetry; `low` = DO trigger detected but post-shed telemetry missing (backfill pending) |
| `true_up_adjustment_reais` | NUMERIC(10,2) | — | | Monthly true-up adjustment. Written by MonthlyTrueUpJob on 1st of month. Never modifies past daily rows |

---

#### 3.6.2 `trades` — 交易记录

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `asset_id` | VARCHAR(200) | — | NOT NULL, **FK→assets** | |
| `traded_at` | TIMESTAMPTZ | — | NOT NULL | Trade execution time |
| `trade_type` | VARCHAR(20) | — | NOT NULL | |
| `energy_kwh` | NUMERIC(10,3) | — | NOT NULL | |
| `price_per_kwh` | NUMERIC(8,4) | — | NOT NULL | |
| `total_reais` | NUMERIC(12,2) | — | NOT NULL | |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.6.3 `algorithm_metrics` — 算法指标

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **UNIQUE(org_id, date)** | |
| `date` | DATE | — | NOT NULL | |
| `self_consumption_pct` | NUMERIC(5,2) | — | | Achieved self-consumption (%) |

---

#### 3.6.4 `weather_cache` — 天气缓存

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | SERIAL | — | **PK** | |
| `location` | VARCHAR(100) | — | NOT NULL, **UNIQUE(location, recorded_at)** | |
| `recorded_at` | TIMESTAMPTZ | — | NOT NULL | |
| `temperature` | NUMERIC(5,2) | — | | Temperature (C) |
| `irradiance` | NUMERIC(8,2) | — | | Solar irradiance (W/m2) |
| `cloud_cover` | NUMERIC(5,2) | — | | Cloud cover (%) |
| `source` | VARCHAR(50) | — | | Weather data provider |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

#### 3.6.5 `pld_horario` — 小时级 PLD 电价 (CCEE hourly spot price)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `mes_referencia` | INTEGER | — | **PK (composite)** | Reference month (YYYYMM) |
| `dia` | SMALLINT | — | **PK (composite)** | Day of month |
| `hora` | SMALLINT | — | **PK (composite)** | Hour (0-23) |
| `submercado` | VARCHAR(10) | — | **PK (composite)** | Electricity sub-market 电力子市场 |
| `pld_hora` | NUMERIC(10,2) | — | NOT NULL | Hourly PLD price (R$/MWh) |

---

### 3.7 Reference (1 table — 参考数据)

#### 3.7.1 `data_dictionary` — 数据字典

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `field_id` | VARCHAR(100) | — | **PK** | |
| `domain` | VARCHAR(20) | — | NOT NULL | Domain group |
| `display_name` | VARCHAR(200) | — | NOT NULL | Human-readable label |
| `value_type` | VARCHAR(20) | — | NOT NULL | Data type descriptor |
| `unit` | VARCHAR(20) | — | | Unit of measure |
| `is_protected` | BOOLEAN | `false` | NOT NULL | Whether field is system-managed |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

### 3.8 P5 Strategy Triggers **[v6.5 NEW]** (2 tables — P5 策略触发)

Source: `backend/src/shared/migrations/001_p5_strategy_triggers.sql`

#### 3.8.1 `strategy_intents` — 策略意图

Captures system-detected opportunities and operator decisions for VPP strategy changes.
捕获系统侦测到的机会及操作员对 VPP 策略变更的决策。

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | BIGSERIAL | — | **PK** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `family` | VARCHAR(50) | — | NOT NULL, CHECK 6 values | `peak_shaving`, `tariff_arbitrage`, `reserve_protection`, `curtailment_mitigation`, `resilience_preparation`, `external_dr` |
| `status` | VARCHAR(30) | — | NOT NULL, CHECK 7 values | `active`, `approved`, `deferred`, `suppressed`, `escalated`, `expired`, `executed` |
| `governance_mode` | VARCHAR(30) | — | NOT NULL, CHECK 4 values | `observe`, `approval_required`, `auto_governed`, `escalate` |
| `urgency` | VARCHAR(20) | — | NOT NULL, CHECK 3 values | `immediate`, `soon`, `watch` |
| `title` | TEXT | — | NOT NULL | Human-readable intent summary |
| `reason_summary` | TEXT | — | NOT NULL | Why this intent was created |
| `evidence_snapshot` | JSONB | — | NOT NULL | Supporting data at creation time |
| `scope_gateway_ids` | JSONB | `'[]'` | | Targeted gateways (empty = all) |
| `scope_summary` | TEXT | — | | Human-readable scope |
| `constraints` | JSONB | — | | Execution constraints |
| `suggested_playbook` | TEXT | — | | Recommended playbook reference |
| `handoff_snapshot` | JSONB | — | | State snapshot at handoff |
| `arbitration_note` | TEXT | — | | Resolution notes |
| `actor` | VARCHAR(100) | — | | Who acted on this intent |
| `decided_at` | TIMESTAMPTZ | — | | When decision was made |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `expires_at` | TIMESTAMPTZ | — | | Auto-expiry deadline |
| `defer_until` | TIMESTAMPTZ | `NULL` | | **[v0.1b]** Deferred re-evaluation time 延迟重新评估时间 |
| `deferred_by` | TEXT | `NULL` | | **[v0.1b]** Actor who deferred |

---

#### 3.8.2 `posture_overrides` — 姿态覆盖 (manual stance overrides)

| Column | Type | Default | Constraints | Description |
|--------|------|---------|-------------|-------------|
| `id` | BIGSERIAL | — | **PK** | |
| `org_id` | VARCHAR(50) | — | NOT NULL, **FK→organizations** | |
| `override_type` | VARCHAR(50) | — | NOT NULL, CHECK 4 values | `force_protective`, `suppress_economic`, `force_approval_gate`, `manual_escalation_note` |
| `reason` | TEXT | — | NOT NULL | Why override was applied |
| `scope_gateway_ids` | JSONB | `'[]'` | | Targeted gateways |
| `actor` | VARCHAR(100) | — | NOT NULL | Who created override |
| `active` | BOOLEAN | `true` | NOT NULL | |
| `starts_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |
| `expires_at` | TIMESTAMPTZ | — | NOT NULL | Must have expiry 必须设定到期时间 |
| `cancelled_at` | TIMESTAMPTZ | — | | When manually cancelled |
| `cancelled_by` | VARCHAR(100) | — | | Who cancelled |
| `created_at` | TIMESTAMPTZ | `NOW()` | NOT NULL | |

---

## 4. Partition Strategy (分区策略)

### 4.1 `telemetry_history` — Monthly Range Partitioning (月度分区)

| Partition | Range (TIMESTAMPTZ) |
|-----------|---------------------|
| `telemetry_history_2026_02` | `[2026-02-01 00:00+08, 2026-03-01 00:00+08)` |
| `telemetry_history_2026_03` | `[2026-03-01 00:00+08, 2026-04-01 00:00+08)` |
| `telemetry_history_2026_04` | `[2026-04-01 00:00+08, 2026-05-01 00:00+08)` |
| `telemetry_history_default` | Catch-all for out-of-range data 兜底分区 |

**Maintenance**: create new monthly partition before month starts. Default partition catches any rows outside declared ranges.

### 4.2 `asset_5min_metrics` — Daily Range Partitioning (日度分区)

32 daily partitions from `20260306` through `20260406`, with boundaries aligned to `+08:00` timezone (e.g., `2026-03-06 11:00+08` to `2026-03-07 11:00+08` = one UTC day starting 03:00 UTC).

**Maintenance**: create new daily partitions via cron job. No default partition — rows outside range will fail to insert (INSERT 失败).

---

## 5. Index Catalog (索引目录)

Non-PK indexes (excluding per-partition child indexes):

| Index Name | Table | Type | Columns | Notes |
|------------|-------|------|---------|-------|
| `idx_5min_asset_window` | asset_5min_metrics | UNIQUE | `(asset_id, window_start)` | Partitioned — propagated to all daily children |
| `idx_5min_window` | asset_5min_metrics | B-TREE | `(window_start)` | Partitioned for time-range scans |
| `idx_asset_hourly_asset_hour` | asset_hourly_metrics | B-TREE | `(asset_id, hour_timestamp DESC)` | |
| `idx_asset_hourly_hour` | asset_hourly_metrics | B-TREE | `(hour_timestamp DESC)` | |
| `idx_assets_gateway` | assets | B-TREE | `(gateway_id)` | |
| `idx_assets_org` | assets | B-TREE | `(org_id)` | |
| `idx_assets_type` | assets | B-TREE | `(asset_type)` | |
| `idx_backfill_active` | backfill_requests | B-TREE | `(created_at)` | **Partial**: WHERE status IN ('pending','in_progress') |
| `idx_cmd_logs_gateway` | device_command_logs | B-TREE | `(gateway_id, created_at DESC)` | |
| `idx_cmd_logs_message` | device_command_logs | B-TREE | `(gateway_id, message_id)` | Correlation ID lookup |
| `idx_cmd_logs_pending` | device_command_logs | B-TREE | `(result)` | **Partial**: WHERE result = 'pending' |
| `idx_dcl_accepted_set` | device_command_logs | B-TREE | `(created_at)` | **Partial**: WHERE result = 'accepted' AND command_type = 'set' |
| `idx_dcl_dispatched_set` | device_command_logs | B-TREE | `(created_at)` | **Partial**: WHERE result = 'dispatched' AND command_type = 'set' |
| `idx_dcl_batch` | device_command_logs | B-TREE | `(batch_id)` | **Partial**: WHERE batch_id IS NOT NULL |
| `idx_dispatch_asset_time` | dispatch_records | B-TREE | `(asset_id, dispatched_at DESC)` | |
| `idx_dispatch_commands_org` | dispatch_commands | B-TREE | `(org_id)` | |
| `idx_dispatch_commands_status` | dispatch_commands | B-TREE | `(status, dispatched_at)` | |
| `idx_dispatch_commands_status_org` | dispatch_commands | B-TREE | `(org_id, status, dispatched_at DESC)` | |
| `idx_gateways_org` | gateways | B-TREE | `(org_id)` | |
| `idx_gateways_status` | gateways | B-TREE | `(status)` | |
| `idx_goe_gateway_started` | gateway_outage_events | B-TREE | `(gateway_id, started_at DESC)` | **[v6.1]** |
| `idx_goe_org_started` | gateway_outage_events | B-TREE | `(org_id, started_at DESC)` | **[v6.1]** |
| `idx_goe_open` | gateway_outage_events | B-TREE | `(gateway_id)` | **[v6.1] Partial**: WHERE ended_at IS NULL |
| `idx_offline_events_asset` | offline_events | B-TREE | `(asset_id, started_at DESC)` | |
| `idx_revenue_asset_date` | revenue_daily | B-TREE | `(asset_id, date DESC)` | |
| `idx_telemetry_asset_time` | telemetry_history | B-TREE | `(asset_id, recorded_at DESC)` | Partitioned index |
| `idx_telemetry_unique_asset_time` | telemetry_history | UNIQUE | `(asset_id, recorded_at)` | Partitioned — dedup guard 去重索引 |
| `idx_trade_schedules_status` | trade_schedules | B-TREE | `(status, planned_time)` | |
| `idx_trades_asset_time` | trades | B-TREE | `(asset_id, traded_at DESC)` | |
| `idx_strategy_intents_org` | strategy_intents | B-TREE | `(org_id)` | **[v6.5]** |
| `idx_strategy_intents_status` | strategy_intents | B-TREE | `(status)` | **[v6.5]** |
| `idx_posture_overrides_org_active` | posture_overrides | B-TREE | `(org_id, active)` | **[v6.5]** |
| `idx_uptime_org_date` | daily_uptime_snapshots | B-TREE | `(org_id, date DESC)` | |
| `idx_weather_location_time` | weather_cache | B-TREE | `(location, recorded_at DESC)` | |

**UNIQUE constraints acting as indexes** (唯一约束同时作为索引):

| Constraint | Table | Columns |
|-----------|-------|---------|
| `algorithm_metrics_org_id_date_key` | algorithm_metrics | `(org_id, date)` |
| `daily_uptime_snapshots_org_id_date_key` | daily_uptime_snapshots | `(org_id, date)` |
| `revenue_daily_asset_id_date_key` | revenue_daily | `(asset_id, date)` |
| `uq_feature_flags_name_org` | feature_flags | `(flag_name, COALESCE(org_id, ''))` |
| `uq_asset_hourly` | asset_hourly_metrics | `(asset_id, hour_timestamp)` |
| `users_email_key` | users | `(email)` |
| `weather_cache_location_recorded_at_key` | weather_cache | `(location, recorded_at)` |

---

## 6. RLS Policy Summary (行级安全策略)

All policies use `current_setting('app.current_org_id', TRUE)` as the tenant discriminator. The `solfacil_service` role (`BYPASSRLS`) skips all policies.

| Table | RLS Enabled | Policy Name | USING Clause |
|-------|-------------|-------------|-------------|
| `algorithm_metrics` | YES | `rls_algorithm_metrics_tenant` | `org_id = app.current_org_id` |
| `assets` | YES | `rls_assets_tenant` | `org_id = app.current_org_id` |
| `daily_uptime_snapshots` | YES | `rls_uptime_tenant` | `org_id = app.current_org_id` |
| `dispatch_commands` | YES | `rls_dispatch_commands_tenant` | `org_id = app.current_org_id` |
| `feature_flags` | YES | `rls_feature_flags_tenant` | `org_id IS NULL OR org_id = app.current_org_id` (global flags visible to all 全局开关对所有租户可见) |
| `gateways` | YES | `rls_gateways_tenant` | `org_id = app.current_org_id` |
| `gateway_outage_events` | YES | `rls_gateway_outage_events_tenant` | `org_id = app.current_org_id` |
| `offline_events` | YES | `rls_offline_events_tenant` | `org_id = app.current_org_id` |
| `parser_rules` | YES | `rls_parser_rules_tenant` | `org_id IS NULL OR org_id = app.current_org_id` (shared rules visible to all 共享规则对所有租户可见) |
| `revenue_daily` | policy only | `rls_revenue_daily_admin` | **SELECT only**: `app.current_org_id = '' OR IS NULL` (admin bypass — no tenant RLS enforced 管理员旁通) |
| `tariff_schedules` | YES | `rls_tariff_schedules_tenant` | `org_id = app.current_org_id` |
| `trade_schedules` | YES | `rls_trade_schedules_tenant` | `org_id = app.current_org_id` |
| `vpp_strategies` | YES | `rls_vpp_strategies_tenant` | `org_id = app.current_org_id` |
| `strategy_intents` | YES | `strategy_intents_org_isolation` | `app.current_org_id = 'SOLFACIL' OR org_id = app.current_org_id` (SOLFACIL super-tenant bypass 超级租户旁通) |
| `posture_overrides` | YES | `posture_overrides_org_isolation` | `app.current_org_id = 'SOLFACIL' OR org_id = app.current_org_id` (SOLFACIL super-tenant bypass 超级租户旁通) |

---

## 7. Foreign Key Map (外键关系图)

```
organizations (org_id)
├── gateways.org_id
│   ├── assets.gateway_id
│   │   ├── device_state.asset_id (ON DELETE CASCADE)
│   │   ├── asset_5min_metrics.asset_id
│   │   ├── asset_hourly_metrics.asset_id
│   │   ├── dispatch_commands.asset_id
│   │   ├── dispatch_records.asset_id
│   │   ├── offline_events.asset_id
│   │   ├── revenue_daily.asset_id
│   │   ├── trade_schedules.asset_id
│   │   └── trades.asset_id
│   ├── device_command_logs.gateway_id
│   ├── backfill_requests.gateway_id
│   └── gateway_outage_events.gateway_id
├── assets.org_id
├── dispatch_commands.org_id
├── daily_uptime_snapshots.org_id
├── feature_flags.org_id (nullable)
├── gateway_outage_events.org_id
├── offline_events.org_id
├── parser_rules.org_id
├── tariff_schedules.org_id
├── vpp_strategies.org_id
├── strategy_intents.org_id
└── posture_overrides.org_id

users (user_id)
└── user_org_roles.user_id (ON DELETE CASCADE)
    └── user_org_roles.org_id → organizations (ON DELETE CASCADE)

tariff_schedules (id)
└── revenue_daily.tariff_schedule_id

trade_schedules (id)
└── dispatch_commands.trade_id
```

---

## 8. Migration History (迁移历史)

| File | Version | Tables | Description |
|------|---------|--------|-------------|
| `db-init/01_roles.sql` | bootstrap | — | Creates `solfacil_app` and `solfacil_service` roles |
| `db-init/02_schema.sql` | bootstrap | 27 tables | Full schema dump (pg_dump). Includes gateway_outage_events (v6.1), home_alias (v6.2) |
| `backend/src/shared/migrations/001_p5_strategy_triggers.sql` | v6.5 | `strategy_intents`, `posture_overrides` | P5 Strategy Triggers. Idempotent (IF NOT EXISTS). Includes v0.1b ALTER for `defer_until`, `deferred_by` |

---

## 9. Multi-Granularity Query Patterns (多粒度查询模式)

All time-series queries filter on `WHERE asset_id = $1 AND recorded_at >= $2 AND recorded_at < $3`, hitting the `idx_telemetry_unique_asset_time` index with partition pruning (分区裁剪).

### 9.1 Granularity Levels (粒度级别)

| Granularity | date_trunc | Typical Points | Column Aggregation | Frontend Chart |
|-------------|-----------|----------------|-------------------|---------------|
| **5min** | None (raw) | 288/day | Raw values 原始值 | Day view line chart 日视图折线 |
| **hour** | `date_trunc('hour', ...)` | 24/day | AVG(power), SUM(energy) | Week/month bar chart 週/月长条图 |
| **day** | `date_trunc('day', ...)` | 7-31/period | MAX(daily_*), SUM(load/12), SUM(grid_*) | Week/month bar chart |
| **month** | `date_trunc('month', ...)` | 3-12/period | Per-day MAX then cross-day SUM 先日内MAX再跨日SUM | Year view bar chart 年视图长条 |

### 9.2 Aggregation Function Selection (聚合函式选择理由)

| Column Category | Function | Rationale |
|----------------|----------|-----------|
| Instantaneous power (`pv_power`, `load_power`, `battery_power`, `grid_power_kw`) | `AVG` | Average power better represents energy consumption over the period 平均功率更能代表该时段的能量消耗 |
| Cumulative daily energy (`pv_daily_energy_kwh`, `daily_charge_kwh`, `daily_discharge_kwh`) | `MAX` per day | Inverter reports monotonically increasing daily totals; MAX within same day = day total 逆变器回报值为日累计递增，同日取MAX即为当日总量 |
| Incremental energy (`grid_import_kwh`, `grid_export_kwh`) | `SUM` | Each 5-min row is an increment; SUM gives period total 每5分钟为增量值，SUM为区间总量 |
| Load energy conversion | `SUM(load_power) / 12` | load_power (kW) x 5min = kWh; 12 intervals per hour |
| SOC / SOH | `AVG` | Average represents mid-period state 取平均值代表时段中心值 |
| Temperature | `AVG` or raw | Raw for day view; AVG for longer aggregations 日视图原始，长期取AVG |

### 9.3 Performance Estimates (效能预估)

Based on 3 gateways x 90 days x 288 points/day = 77,760 rows total:

| Query | Scan Range | Estimated Time |
|-------|-----------|---------------|
| Day view (1 day, 1 asset) | ~288 rows | < 5ms |
| Week view (7 days) | ~2,016 rows | < 10ms |
| Month view (30 days) | ~8,640 rows | < 20ms |
| Year view (365 days) | ~105,120 rows | < 50ms |

### 9.4 Index Utilization (索引利用)

P3 queries all use `WHERE asset_id = $1 AND recorded_at >= $2 AND recorded_at < $3`, which maps directly to:

| Index | Purpose |
|------|------|
| `idx_telemetry_unique_asset_time` (asset_id, recorded_at) UNIQUE | Primary index for all P3 queries — asset-level time range scan |
| Partition pruning (PARTITION BY RANGE recorded_at) | Automatically excludes partitions outside the time range 自动排除不在时间范围内的分区 |

---

*End of document — 29 tables, 35 indexes, 15 RLS policies, 2 partition strategies.*
