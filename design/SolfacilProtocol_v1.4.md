# Solfacil 协议定义

## 1. 设备列表定义

### 1.1 Topic

**Topic**: `device/ems/{clientId}/deviceList`

### 1.2 触发时机

设备数量/状态等发生变化时主动上报；网关连接到平台之后也需要上报一次完整设备列表。

- `data.deviceList` 不为空 → 设备列表消息

### 1.3 主动上报消息格式

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "data": {
    "deviceList": [
      {
        "bindStatus": true,
        "connectStatus": "offline",
        "deviceBrand": "Meter-Chint-DTSU666Three",
        "deviceSn": "Meter-Chint-DTSU666Three1772421079_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "maxCurrent": "",
        "maxPower": "",
        "minCurrent": "",
        "minPower": "",
        "modelId": "Meter-Chint-DTSU666Three",
        "name": "Chint-three-1",
        "nodeType": "major",
        "portName": "RS485-1",
        "productId": "meter",
        "productType": "meter",
        "protocolAddr": "01",
        "subDevId": "Meter-Chint-DTSU666Three1772421079",
        "subDevIntId": 1,
        "vendor": "Chint"
      },
      {
        "bindStatus": true,
        "connectStatus": "offline",
        "deviceBrand": "Meter-Chint-DTSU666Single",
        "deviceSn": "Meter-Chint-DTSU666Single1772421080_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "maxCurrent": "",
        "maxPower": "",
        "minCurrent": "",
        "minPower": "",
        "modelId": "Meter-Chint-DTSU666Single",
        "name": "Chint-single-1",
        "nodeType": "major",
        "portName": "RS485-1",
        "productId": "meter",
        "productType": "meter",
        "protocolAddr": "02",
        "subDevId": "Meter-Chint-DTSU666Single1772421080",
        "subDevIntId": 2,
        "vendor": "Chint"
      },
      {
        "bindStatus": true,
        "connectStatus": "offline",
        "deviceBrand": "inverter-goodwe-Energystore",
        "deviceSn": "inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "maxCurrent": "",
        "maxPower": "",
        "minCurrent": "",
        "minPower": "",
        "modelId": "inverter-goodwe-Energystore",
        "name": "GoodWe-1",
        "nodeType": "major",
        "portName": "RS485-0",
        "productId": "inverter",
        "productType": "inverter",
        "protocolAddr": "01",
        "subDevId": "inverter-goodwe-Energystore1772433273",
        "subDevIntId": 3,
        "vendor": "GoodWe"
      }
    ]
  },
  "deviceName": "EMS_N2",
  "messageId": "74881979540",
  "productKey": "ems",
  "timeStamp": "1773021874882"
}
```

### 1.4 字段说明

- **一级子设备**：直接跟网关通信的设备（inverter、meter 等）。
- **二级子设备**：挂载在逆变器上的 PV / 电池等逻辑子设备，不直接与网关通信。

| 字段          | 类型    | 描述                   | 用处                                                                                                              |
| ------------- | ------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DS            | int     | 是否加密               | 暂时未使用                                                                                                        |
| ackFlag       | int     | 是否需要回复           | 暂时未使用                                                                                                        |
| clientId      | string  | 网关 ID                | 网关唯一标识                                                                                                      |
| messageId     | string  | 消息 ID                |                                                                                                                   |
| productKey    | string  | 产品 key               | 标识产品                                                                                                          |
| timeStamp     | string  | 时间戳                 | 消息发送时间                                                                                                      |
| deviceList    | array   | 子设备数组             | 一级子设备列表                                                                                                    |
| bindStatus    | boolean | 是否启用               | 只有一级设备有这个字段                                                                                            |
| connectStatus | string  | 在线 / 离线            | online: 在线；offline: 离线                                                                                       |
| deviceBrand   | string  | 设备型号               | 只有一级设备有这个字段                                                                                            |
| deviceSn      | string  | 设备全局标识           | 一级设备：`一级子设备ID_网关ID`；二级设备：`二级子设备ID_一级子设备ID_网关ID`                                   |
| modelId       | string  | 模型 ID                | 只有一级设备有这个字段                                                                                            |
| modelVersion  | string  | 模型版本               | 只有一级设备有这个字段                                                                                            |
| name          | string  | 设备名称               |                                                                                                                   |
| portName      | string  | 端口名称               | 只有一级设备有这个字段                                                                                            |
| productType   | string  | 产品分类               | meter / inverter / ems                                                                                            |
| protocolAddr  | string  | Modbus 地址            | 16 进制字符串，只有一级设备有这个字段                                                                             |
| protocolType  | string  | 协议类型               | modbus，只有一级设备有这个字段                                                                                    |
| remoteIp      | string  | 远端 IP                | Modbus TCP 使用，只有一级设备有                                                                                   |
| remotePort    | string  | 远端端口               | Modbus TCP 使用，只有一级设备有                                                                                   |
| subDevId      | string  | 子设备 ID              | 自动生成                                                                                                          |
| nodeType      | string  | 一级/二级设备标识      | major: 一级子设备；minor: 二级子设备                                                                              |
| fatherSn      | string  | 父设备 sn              | 一级设备父 sn 是网关；二级设备父 sn 是一级设备                                                                    |

### 1.5 设备列表查询接口

**目的：** 平台主动发请求，查询当前网关的子设备列表；响应仍通过原有的 `device/ems/{clientId}/deviceList` 主题返回。

#### 1.5.1 请求 Topic

**Topic**: `platform/ems/{clientId}/subDevices/get`

#### 1.5.2 触发时机

平台需要主动拉取一次设备列表时发送，例如：

- 平台首次接入网关；
- 认为设备列表可能变化但还未收到主动上报时。

#### 1.5.3 请求内容示例

> 内容可以很简单，主要用于触发网关回复当前设备列表。`data` 内部结构目前不做强约束。

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "deviceName": "EMS_N2",
  "productKey": "ems",
  "messageId": "1234567890",
  "timeStamp": "1773025000000",
  "data": {
    "reason": "manual_query"
  }
}
```

#### 1.5.4 响应

- 网关收到 `platform/ems/{clientId}/subDevices/get` 请求后，应按当前已知的子设备列表，发送 `device/ems/{clientId}/deviceList` 消息；
- `deviceList` 的结构与 1.3 节中定义的主动上报格式完全一致。

> 约定：
> - `subDevices/get` 只是一个“触发查询”的接口，本身不携带复杂参数；
> - 所有设备列表的真实内容仍通过 `device/ems/{clientId}/deviceList` 上报，保证兼容已有的消费逻辑。

---

## 2. 实时数据上报

无论是子设备还是 EMS 本身的实时数据，都通过同一套 Topic + 结构上报。如果是 EMS 本身的实时数据（如 CPU 温度 / 使用率 / 磁盘空间等），则 `deviceSn` 为网关序列号，设备列表为空或使用独立的 `emsStatus` 对象。

根据设备层级：

- 逆变器作为一级子设备，其下挂载的 PV 和电池数据分别对应协议中的 `pvList`、`batList` 等；
- 每种设备共用 `device/ems/{clientId}/data` 这个 Topic，通过 `data` 中的不同 List 来区分设备类型。

### 2.1 Topic

**Topic**: `device/ems/{clientId}/data`

### 2.2 电表数据点定义（`meterList`, `productType: meter`）

#### 2.2.1 单相电表

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "data": {
    "meterList": [
      {
        "bindStatus": true,
        "connectStatus": "online",
        "deviceBrand": "Meter-Chint-DTSU666Single",
        "deviceSn": "Meter-Chint-DTSU666Single1772421080_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "modelId": "Meter-Chint-DTSU666Single",
        "name": "Chint-single-1",
        "portName": "RS485-1",
        "productType": "meter",
        "properties": {
          "connectStatus": "online",
          "grid_activePowerA": "60",
          "grid_currentA": "60",
          "grid_factorA": "60",
          "grid_frequency": "60",
          "grid_reactivePowerA": "60",
          "grid_voltA": "60"
        },
        "protocolAddr": "02",
        "protocolType": "modbus",
        "subDevId": "Meter-Chint-DTSU666Single1772421080",
        "vendor": "Chint"
      }
    ]
  },
  "deviceName": "EMS_N2",
  "messageId": "696691576970",
  "productKey": "ems",
  "timeStamp": "1772422069669"
}
```

| 字段                | 类型   | 描述         |
| ------------------- | ------ | ------------ |
| grid_voltA          | string | 单相电压     |
| grid_currentA       | string | 单相电流     |
| grid_activePowerA   | string | 单相有功功率 |
| grid_reactivePowerA | string | 单相无功功率 |
| grid_factorA        | string | 单相功率因数 |
| grid_frequency      | string | 频率         |

#### 2.2.2 三相电表

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "data": {
    "meterList": [
      {
        "bindStatus": true,
        "connectStatus": "online",
        "deviceBrand": "Meter-Chint-DTSU666Three",
        "deviceSn": "Meter-Chint-DTSU666Three1772421079_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "modelId": "Meter-Chint-DTSU666Three",
        "name": "Chint-three-1",
        "portName": "RS485-1",
        "productType": "meter",
        "properties": {
          "connectStatus": "online",
          "grid_voltA": "230",
          "grid_voltB": "230",
          "grid_voltC": "230",
          "grid_lineABVolt": "230",
          "grid_lineBCVolt": "230",
          "grid_lineCAVolt": "230",
          "grid_currentA": "10",
          "grid_currentB": "10",
          "grid_currentC": "10",
          "grid_totalActivePower": "2300",
          "grid_activePowerA": "2300",
          "grid_activePowerB": "2300",
          "grid_activePowerC": "2300",
          "grid_totalReactivePower": "2300",
          "grid_reactivePowerA": "20",
          "grid_reactivePowerB": "20",
          "grid_reactivePowerC": "20",
          "grid_factor": "1",
          "grid_factorA": "1",
          "grid_factorB": "1",
          "grid_factorC": "1",
          "grid_frequency": "50",
          "grid_positiveEnergy": "50",
          "grid_positiveEnergyA": "50",
          "grid_positiveEnergyB": "50",
          "grid_positiveEnergyC": "50",
          "grid_netForwardActiveEnergy": "50",
          "grid_negativeEnergyA": "50",
          "grid_negativeEnergyB": "50",
          "grid_negativeEnergyC": "50",
          "grid_netReverseActiveEnergy": "50"
        },
        "protocolAddr": "01",
        "protocolType": "modbus",
        "subDevId": "Meter-Chint-DTSU666Three1772421079",
        "vendor": "Chint"
      }
    ]
  },
  "deviceName": "EMS_N2",
  "messageId": "697937749051",
  "productKey": "ems",
  "timeStamp": "1772422069793"
}
```

| 字段                        | 类型   | 描述             |
| --------------------------- | ------ | ---------------- |
| grid_voltA                  | string | A 相电压         |
| grid_voltB                  | string | B 相电压         |
| grid_voltC                  | string | C 相电压         |
| grid_lineABVolt             | string | AB 线电压        |
| grid_lineBCVolt             | string | BC 线电压        |
| grid_lineCAVolt             | string | CA 线电压        |
| grid_currentA               | string | A 相电流         |
| grid_currentB               | string | B 相电流         |
| grid_currentC               | string | C 相电流         |
| grid_totalActivePower       | string | 总有功功率       |
| grid_activePowerA           | string | A 相有功功率     |
| grid_activePowerB           | string | B 相有功功率     |
| grid_activePowerC           | string | C 相有功功率     |
| grid_totalRecctivePower     | string | 总无功功率       |
| grid_reactivePowerA         | string | A 相无功功率     |
| grid_reactivePowerB         | string | B 相无功功率     |
| grid_reactivePowerC         | string | C 相无功功率     |
| grid_factor                 | string | 总功率因数       |
| grid_factorA                | string | A 相功率因数     |
| grid_factorB                | string | B 相功率因数     |
| grid_factorC                | string | C 相功率因数     |
| grid_frequency              | string | 频率             |
| grid_positiveEnergy         | string | 总正向有功电能   |
| grid_positiveEnergyA        | string | A 相正向有功电能 |
| grid_positiveEnergyB        | string | B 相正向有功电能 |
| grid_positiveEnergyC        | string | C 相正向有功电能 |
| grid_netForwardActiveEnergy | string | 净正向有功电能   |
| grid_negativeEnergyA        | string | A 相反向有功电能 |
| grid_negativeEnergyB        | string | B 相反向有功电能 |
| grid_negativeEnergyC        | string | C 相反向有功电能 |
| grid_netReverseActiveEnergy | string | 净反向有功电能   |

### 2.3 逆变器数据点定义（`gridList`, `pvList`, `batList`, `loadList`, `productType: inverter`）

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "data": {
    "batList": [
      {
        "deviceSn": "battery_inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "name": "battery",
        "properties": {
          "total_bat_current": "60",
          "total_bat_dailyChargedEnergy": "60",
          "total_bat_dailyDischargedEnergy": "60",
          "total_bat_maxChargeCurrent": "60",
          "total_bat_maxChargeVoltage": "60",
          "total_bat_maxDischargeCurrent": "60",
          "total_bat_power": "60",
          "total_bat_soc": "60",
          "total_bat_soh": "60",
          "total_bat_temperature": "60",
          "total_bat_totalChargedEnergy": "60",
          "total_bat_totalDischargedEnergy": "60",
          "total_bat_vlotage": "60"
        },
        "subDevId": "battery"
      }
    ],
    "flloadList": [
      {
        "deviceSn": "flload_inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "name": "flload",
        "properties": {
          "flload_activePowerA": "60",
          "flload_activePowerB": "60",
          "flload_activePowerC": "60",
          "flload_totalPower": "60"
        },
        "subDevId": "flload"
      }
    ],
    "gridList": [
      {
        "deviceSn": "grid_inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "name": "grid",
        "properties": {
          "grid_activePowerA": "60",
          "grid_activePowerB": "60",
          "grid_activePowerC": "60",
          "grid_apparentPowerA": "60",
          "grid_apparentPowerB": "60",
          "grid_apparentPowerC": "60",
          "grid_currentA": "60",
          "grid_currentB": "60",
          "grid_currentC": "60",
          "grid_dailyBuyEnergy": "60",
          "grid_dailySellEnergy": "60",
          "grid_frequency": "60",
          "grid_frequencyA": "60",
          "grid_frequencyB": "60",
          "grid_frequencyC": "60",
          "grid_reactivePowerA": "60",
          "grid_reactivePowerB": "60",
          "grid_reactivePowerC": "60",
          "grid_temp": "60",
          "grid_totalActivePower": "60",
          "grid_totalApparentPower": "60",
          "grid_totalBuyEnergy": "60",
          "grid_totalReactivePower": "60",
          "grid_totalSellEnergy": "60",
          "grid_voltA": "60",
          "grid_voltB": "60",
          "grid_voltC": "60"
        },
        "subDevId": "grid"
      }
    ],
    "loadList": [
      {
        "deviceSn": "load1_inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "name": "load1",
        "properties": {
          "load1_activePowerA": "60",
          "load1_activePowerB": "60",
          "load1_activePowerC": "60",
          "load1_currentA": "60",
          "load1_currentB": "60",
          "load1_currentC": "60",
          "load1_frequencyA": "60",
          "load1_frequencyB": "60",
          "load1_frequencyC": "60",
          "load1_totalPower": "60",
          "load1_voltA": "60",
          "load1_voltB": "60",
          "load1_voltC": "60"
        },
        "subDevId": "load1"
      }
    ],
    "pvList": [
      {
        "deviceSn": "pv_inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "name": "pv",
        "properties": {
          "pv_dailyEnergy": "60",
          "pv_totalEnergy": "60",
          "pv_totalPower": "60"
        },
        "subDevId": "pv"
      },
      {
        "deviceSn": "pv1_inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "name": "pv1",
        "properties": {
          "pv1_current": "60",
          "pv1_power": "60",
          "pv1_voltage": "60"
        },
        "subDevId": "pv1"
      },
      {
        "deviceSn": "pv2_inverter-goodwe-Energystore1772433273_WKRD24070202100141I",
        "fatherSn": "WKRD24070202100141I",
        "name": "pv2",
        "properties": {
          "pv2_current": "60",
          "pv2_power": "60",
          "pv2_voltage": "60"
        },
        "subDevId": "pv2"
      }
    ]
  },
  "deviceName": "EMS_N2",
  "messageId": "21032243540",
  "productKey": "ems",
  "timeStamp": "1772681002103"
}
```

#### 电池侧 (`batList`) 字段说明

- 总电池聚合数据（跨所有簇，`total_bat_*`，由 GoodWe 39870–39875、39898–39899 统计）

| 字段                            | 类型   | 描述                                    |
| ------------------------------- | ------ | --------------------------------------- |
| total_bat_power                 | string | 电池当前总功率 (W)，放电为正，充电为负 |
| total_bat_totalChargedEnergy    | string | 累计充电电量（自安装以来）              |
| total_bat_totalDischargedEnergy | string | 累计放电电量（自安装以来）              |
| total_bat_dailyChargedEnergy    | string | 当日充电电量                            |
| total_bat_dailyDischargedEnergy | string | 当日放电电量                            |
| total_bat_maxChargeVoltage      | string | 设备总最大充电电压 (V)，来自 BMS2      |
| total_bat_maxChargeCurrent      | string | 设备总最大充电电流 (A)，来自 BMS2      |
| total_bat_maxDischargeCurrent   | string | 设备总最大放电电流 (A)，来自 BMS2      |
| total_bat_vlotage               | string | 设备总电池电压 (V)                      |
| total_bat_current               | string | 设备总电池电流 (A)，正放电、负充电     |
| total_bat_temperature           | string | 设备总电池平均温度 (℃)                 |
| total_bat_soc                   | string | 设备总电池 SOC (%)                      |
| total_bat_soh                   | string | 设备总电池 SOH (%)                      |

> 说明：
> - `total_bat_*` 是 GoodWe 设备级聚合视角，用于调度约束和 KPI 统计；
> - 所有字段以字符串形式上传，网关和云端在内部可转换为数值进行运算。

#### 电网侧 (`gridList`) 字段说明

| 字段                    | 类型   | 描述                      |
| ----------------------- | ------ | ------------------------- |
| grid_voltA              | string | 并网侧 A 相电压 (V)       |
| grid_voltB              | string | 并网侧 B 相电压 (V)       |
| grid_voltC              | string | 并网侧 C 相电压 (V)       |
| grid_currentA           | string | 并网侧 A 相电流 (A)       |
| grid_currentB           | string | 并网侧 B 相电流 (A)       |
| grid_currentC           | string | 并网侧 C 相电流 (A)       |
| grid_activePowerA       | string | 并网侧 A 相有功功率 (W)   |
| grid_activePowerB       | string | 并网侧 B 相有功功率 (W)   |
| grid_activePowerC       | string | 并网侧 C 相有功功率 (W)   |
| grid_totalActivePower   | string | 并网侧总有功功率 (W)      |
| grid_reactivePowerA     | string | 并网侧 A 相无功功率 (Var) |
| grid_reactivePowerB     | string | 并网侧 B 相无功功率 (Var) |
| grid_reactivePowerC     | string | 并网侧 C 相无功功率 (Var) |
| grid_totalReactivePower | string | 并网侧总无功功率 (Var)    |
| grid_apparentPowerA     | string | 并网侧 A 相视在功率 (VA)  |
| grid_apparentPowerB     | string | 并网侧 B 相视在功率 (VA)  |
| grid_apparentPowerC     | string | 并网侧 C 相视在功率 (VA)  |
| grid_totalApparentPower | string | 并网侧总视在功率 (VA)     |
| grid_frequency          | string | 电网频率 (Hz)             |
| grid_frequencyA         | string | 并网侧 A 相频率           |
| grid_frequencyB         | string | 并网侧 B 相频率           |
| grid_frequencyC         | string | 并网侧 C 相频率           |
| grid_totalSellEnergy    | string | 累计卖电电量              |
| grid_totalBuyEnergy     | string | 累计买电电量              |
| grid_dailySellEnergy    | string | 当日卖电电量              |
| grid_dailyBuyEnergy     | string | 当日买电电量              |
| grid_temp               | string | 逆变器内部空气温度 (℃)    |

#### 负载侧 (`loadList`) 字段说明

- `load1`：逆变器 Backup 口（关键负载）

| 字段               | 类型   | 描述                                  |
| ------------------ | ------ | ------------------------------------- |
| load1_voltA        | string | 负载1 A 相电压 (V)                    |
| load1_voltB        | string | 负载1 B 相电压 (V)                    |
| load1_voltC        | string | 负载1 C 相电压 (V)                    |
| load1_currentA     | string | 负载1 A 相电流 (A)                    |
| load1_currentB     | string | 负载1 B 相电流 (A)                    |
| load1_currentC     | string | 负载1 C 相电流 (A)                    |
| load1_activePowerA | string | 负载1 A 相有功功率 (W)                |
| load1_activePowerB | string | 负载1 B 相有功功率 (W)                |
| load1_activePowerC | string | 负载1 C 相有功功率 (W)                |
| load1_frequencyA   | string | 负载1 A 相频率 (Hz)                   |
| load1_frequencyB   | string | 负载1 B 相频率 (Hz)                   |
| load1_frequencyC   | string | 负载1 C 相频率 (Hz)                   |
| load1_totalPower   | string | 负载1 侧总功率 (W)，对应 Backup 端口 |

- `flload`：除逆变器自身以外的家庭总负载（并网侧总负载）

| 字段                | 类型   | 描述                  |
| ------------------- | ------ | --------------------- |
| flload_totalPower   | string | 家庭总负载功率 (W)    |
| flload_dailyEnergy  | string | 家庭总负载当日用电量  |
| flload_activePowerA | string | 家庭 A 相有功功率 (W) |
| flload_activePowerB | string | 家庭 B 相有功功率 (W) |
| flload_activePowerC | string | 家庭 C 相有功功率 (W) |

#### 光伏侧 (`pvList`) 字段说明

- 汇总 PV（`pv`）、以及每个 MPPT（`pv1` / `pv2`）

| 字段           | 类型   | 描述                         |
| -------------- | ------ | ---------------------------- |
| pv_totalPower  | string | 光伏总功率 (W)               |
| pv_totalEnergy | string | 光伏发电总电量 (kWh)         |
| pv_dailyEnergy | string | 光伏当日电量 (kWh)           |
| pv1_voltage    | string | MPPT1 输入电压 (V)           |
| pv1_current    | string | MPPT1 输入电流 (A)           |
| pv1_power      | string | MPPT1 输入功率 (W)           |
| pv2_voltage    | string | MPPT2 输入电压 (V)           |
| pv2_current    | string | MPPT2 输入电流 (A)           |
| pv2_power      | string | MPPT2 输入功率 (W)           |

---

## 3. 配置项说明

### 3.1 配置项获取

**Topic**: `platform/ems/{clientId}/config/get`

### 3.2 触发时机

平台主动获取网关当前配置时发起。

### 3.3 请求内容

```json
{
  "DS": 0,
  "ackFlag": 0,
  "data": {
    "configname": "battery_schedule"
  },
  "clientId": "WKRD24070202100141I",
  "deviceName": "EMS_N2",
  "productKey": "ems",
  "messageId": "9163436",
  "timeStamp": "1747534429979"
}
```

| 字段       | 类型   | 描述         | 用处                                                          |
| ---------- | ------ | ------------ | ------------------------------------------------------------- |
| DS         | int    | 是否加密     | 暂时未使用                                                    |
| ackFlag    | int    | 是否需要回复 | 暂时未使用                                                    |
| clientId   | string | 网关 ID      | 网关唯一标识                                                  |
| deviceName | string | 网关名称     | 标识网关名称                                                  |
| productKey | string | 产品 key     | 标识产品                                                      |
| messageId  | string | 消息 ID      |                                                               |
| timeStamp  | string | 时间戳       | 消息发送时间                                                  |
| configname | string | 配置名称     | "" 表示获取所有配置；指定名称表示只获取某个配置（如电池调度） |

### 3.4 配置响应

**Topic**: `device/ems/{clientId}/config/get_reply`

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "data": {
    "battery_schedule": {
      "grid_import_limit": "3000",
      "max_charge_current": "100",
      "max_discharge_current": "100",
      "slots": [
        {
          "direction": "charge",
          "end": "300",
          "purpose": "tariff",
          "start": "0"
        },
        {
          "end": "1020",
          "purpose": "self_consumption",
          "start": "300"
        },
        {
          "end": "1200",
          "purpose": "peak_shaving",
          "start": "1020"
        },
        {
          "direction": "discharge",
          "end": "1440",
          "export_policy": "forbid",
          "purpose": "tariff",
          "start": "1200"
        }
      ],
      "soc_max_limit": "95",
      "soc_min_limit": "10"
    },
    "configname": "battery_schedule"
  },
  "deviceName": "EMS_N2",
  "messageId": "376915278899",
  "productKey": "ems",
  "timeStamp": "1773023237691"
}
```

### 3.5 `battery_schedule` 配置字段说明

- 所有字段以字符串形式传输，由网关/云端转为数值使用；
- 下表中给出的是**语义上的数值类型和推荐范围**，网关应按照这些范围进行校验。

#### 3.5.1 顶层字段

| 字段                  | 类型   | 数值类型 | 取值范围/约束                                 | 描述                                 |
| --------------------- | ------ | -------- | --------------------------------------------- | ------------------------------------ |
| soc_min_limit         | string | int      | 0–100，且 `< soc_max_limit`                   | 电池 SOC 下限 (%)，低于此值禁止放电  |
| soc_max_limit         | string | int      | 0–100，且 `> soc_min_limit`                   | 电池 SOC 上限 (%)，高于此值禁止充电  |
| max_charge_current    | string | int      | ≥0，单位 A，一般不超过设备 BMS 报告的上限    | 最大充电电流 (A)，调度层统一充电边界 |
| max_discharge_current | string | int      | ≥0，单位 A，一般不超过设备 BMS 报告的上限    | 最大放电电流 (A)，调度层统一放电边界 |
| grid_import_limit     | string | int      | ≥0，单位 KW                                   | 最大电网购电功率 (KW)，用于削峰/限流  |
| slots                 | array  | -        | 至少 1 个，所有 slot 合起来覆盖 0–1440 分钟  | 一天内的时间切片数组                 |

> 组合约束：
> - 常见配置中 `soc_min_limit` 建议在 5–20 之间，`soc_max_limit` 建议在 80–100 之间；
> - `max_charge_current` / `max_discharge_current` 建议不超过 BMS 报告的最大能力；
> - `grid_import_limit` 为 0 时削峰逻辑不生效，>0 时才启用削峰/限流控制。

#### 3.5.2 `slots[]` 时间切片字段

每个 slot 定义了一个时间段的策略模式。

| 字段          | 类型   | 数值类型 | 取值范围/约束                                                     | 描述                                                                   |
| ------------- | ------ | -------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| purpose       | string | -        | `"self_consumption"` / `"peak_shaving"` / `"tariff"`           | 模式：自用 / 削峰 / 电价窗口                                          |
| direction     | string | -        | 可选，`"charge"` / `"discharge"` / `"neutral"`                  | 行为方向，主要在 `purpose="tariff"` 时使用                           |
| export_policy | string | -        | 可选，`"allow"` / `"forbid"`，只在 `tariff + discharge` 下生效 | 卖电策略：允许卖电/参与 VPP，或只减购电不卖电                         |
| start         | string | int      | 0–1380中的60的整数倍，单位：分钟                                   | 开始时间，相对于当天 00:00                                             |
| end           | string | int      | 60–1440中的60的整数倍，且 `end > start`                            | 结束时间（不包含 end），时间段为 `[start, end)`                       |

额外约束：

- 所有 slot 合起来应覆盖整个 0–1440 区间，无未定义时间段；
- 推荐相邻 slot 在时间上首尾相接，避免重叠；
- 不允许同一时间点同时被多个 slot 覆盖；
- `purpose="tariff"` 时：
  - `direction="charge"`：低谷充电段；
  - `direction="discharge"`：高峰放电段，可通过 `export_policy` 区分：
    - `allow`：允许对外卖电/参与 VPP；
    - `forbid`：只减购电、不主动外送，行为更接近“自用+削峰”。

### 3.6 配置项下发

**Topic**: `platform/ems/{clientId}/config/set`

### 3.7 触发时机

平台/上位业务需要修改网关配置时发起，例如调整电池调度计划、修改削峰上限等。

### 3.8 下发请求内容

```json
{
  "DS": 0,
  "ackFlag": 0,
  "data": {
    "configname": "battery_schedule",
    "battery_schedule": {
      "grid_import_limit": "3000",
      "max_charge_current": "100",
      "max_discharge_current": "100",
      "slots": [
        {
          "direction": "charge",
          "end": "300",
          "purpose": "tariff",
          "start": "0"
        },
        {
          "end": "1020",
          "purpose": "self_consumption",
          "start": "300"
        },
        {
          "end": "1200",
          "purpose": "peak_shaving",
          "start": "1020"
        },
        {
          "direction": "discharge",
          "end": "1440",
          "export_policy": "forbid",
          "purpose": "tariff",
          "start": "1200"
        }
      ],
      "soc_max_limit": "90",
      "soc_min_limit": "10"
    }
  },
  "clientId": "QING-445c3c6416d2",
  "deviceName": "iotGateWay",
  "productKey": "QING-GATEWAY-4G",
  "messageId": "9163436",
  "timeStamp": "1747534429979"
}
```

#### 3.8.1 下发请求字段说明

与 `config/get` 相比，`config/set` 在 `data` 中多了目标配置对象：

| 字段             | 类型   | 描述                                   |
| ---------------- | ------ | -------------------------------------- |
| configname       | string | 配置名称，此处为 `"battery_schedule"` |
| battery_schedule | object | 要写入网关的调度配置内容               |

> 约定：
> - `battery_schedule` 的字段和值应满足 3.5 小节中给出的类型和范围约束；
> - 网关收到后应进行结构完整性和数值范围校验，失败时在 `set_reply` 中返回 `result = "fail"` 和错误信息。

### 3.9 配置下发响应

**Topic**: `device/ems/{clientId}/config/set_reply`

```json
{
  "DS": 0,
  "ackFlag": 1,
  "clientId": "WKRD24070202100141I",
  "data": {
    "configname": "battery_schedule",
    "result": "success",
    "message": ""
  },
  "deviceName": "EMS_N2",
  "messageId": "556230388593",
  "productKey": "ems",
  "timeStamp": "1773024455623"
}
```

#### 3.9.1 下发响应字段说明

| 字段       | 类型   | 描述                                         |
| ---------- | ------ | -------------------------------------------- |
| DS         | int    | 是否加密                                     |
| ackFlag    | int    | 是否为应答                                   |
| clientId   | string | 网关 ID                                      |
| deviceName | string | 网关名称                                     |
| productKey | string | 产品 key                                     |
| messageId  | string | 消息 ID                                      |
| timeStamp  | string | 时间戳                                       |
| configname | string | 配置名称，此处为 `"battery_schedule"`       |
| result     | string | `"success"` / `"fail"`，表示设置是否成功 |
| message    | string | 可选错误信息或备注，成功时可为空            |

> 行为约定：
> - 网关应用配置成功 → `result = "success"`；
> - 配置结构不合法或校验失败 → `result = "fail"`，`message` 中带原因描述。

---

## 4. 心跳包

### 4.1 Topic

**Topic**: `device/ems/{clientId}/status`

### 4.2 触发时机

定时主动上报（间隔由 `heartBeatFreq` 配置控制，默认 30 秒）。

### 4.3 字段说明

| 字段       | 类型   | 描述                | 用处                 |
| ---------- | ------ | ------------------- | -------------------- |
| DS         | int    | 是否加密            | 暂时未使用           |
| ackFlag    | int    | 是否需要回复        | 暂时未使用           |
| clientId   | string | 客户端 ID / 网关 ID | 网关唯一标识         |
| deviceName | string | 网关名称            | 标识网关             |
| productKey | string | 产品 key            | 标识产品             |
| messageId  | string | 消息 ID             |                      |
| timeStamp  | string | 时间戳              | 消息发送时间         |
| data       | object | 心跳附带状态        | 当前为空，可后续扩展 |

### 4.4 心跳包示例

```json
{
  "DS": 0,
  "ackFlag": 0,
  "data": {},
  "clientId": "WKRD24070202100141I",
  "deviceName": "EMS_N2",
  "productKey": "ems",
  "messageId": "9163436",
  "timeStamp": "1747534429979"
}
```

---

## 5. 实时数据补点与 ACK 扩展

为保证在网络抖动或短暂不可用的情况下实时数据可追溯，平台与网关之间增加一套基于现有实时数据通道的补点与确认机制。

### 5.1 实时数据 ACK（platform → ems）

#### 5.1.1 Topic

**Topic**: `platform/ems/{clientId}/data/ack`

#### 5.1.2 触发时机

- 平台成功处理一条或多条来自 `device/ems/{clientId}/data` 的实时数据后，用于通知网关这些数据可以标记为“已确认”；
- ACK 仅表示“平台已处理对应 `messageId` 的数据”，具体处理逻辑由平台内部决定。

#### 5.1.3 消息格式示例

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "deviceName": "EMS_N2",
  "productKey": "ems",
  "messageId": "9163436",
  "timeStamp": "1747534429979",
  "data": {
    "acks": [
      {
        "targetMessageId": "696691576970",
        "result": "success",
        "message": ""
      }
    ]
  }
}
```

#### 5.1.4 字段说明

外层字段与其他报文（如 `config/get_reply`）一致，此处只列出 `data.acks[]` 的字段：

| 字段            | 类型   | 描述                                   |
| --------------- | ------ | -------------------------------------- |
| targetMessageId | string | 被确认的实时数据消息 ID（即原上报的 `messageId`） |
| result          | string | `"success"` / `"fail"`              |
| message         | string | 可选错误信息或备注，成功时可为空      |

> 约定：
> - 平台可以在一次 ACK 报文中确认多条实时数据（`acks` 数组长度 ≥ 1）；
> - 网关收到 ACK 后，应根据 `targetMessageId` 在本地记录中标记对应实时数据已确认，以便后续补点查询时只针对未确认的数据。

---

### 5.2 实时数据补点请求（platform → ems）

当平台发现某段时间的实时数据缺失，或需要主动触发历史数据补点时，可通过 `data/get_missed` 接口向网关发起查询请求。

#### 5.2.1 Topic

**Topic**: `platform/ems/{clientId}/data/get_missed`

#### 5.2.2 模式一：获取所有未 ACK 数据

用于请求“当前所有未收到 ACK 应答的实时数据记录”，通常用于站点恢复上线后的全局补点。

请求示例：

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "deviceName": "EMS_N2",
  "productKey": "ems",
  "messageId": "1234567890",
  "timeStamp": "1773025000000",
  "data": {
    "mode": "all_unacked"
  }
}
```

| 字段   | 类型   | 描述                                           |
| ------ | ------ | ---------------------------------------------- |
| mode   | string | 固定为 `"all_unacked"`，表示请求所有未确认实时数据 |

网关行为（约定）：

- 收到 `mode = "all_unacked"` 请求后：
  - 按时间顺序，将当前本地标记为“未确认”的实时数据，逐条通过 `device/ems/{clientId}/data` 重新上报；
  - 重新上报时，沿用当时的 `timeStamp` 和 `messageId` 等字段；
  - 发送时可做速率限制，避免瞬时大量消息冲击。

#### 5.2.3 模式二：按时间范围获取未 ACK 数据

用于请求某个时间窗口内的“未确认实时数据”，适合在发现某一段时间的统计异常时做定向补点。

请求示例：

```json
{
  "DS": 0,
  "ackFlag": 0,
  "clientId": "WKRD24070202100141I",
  "deviceName": "EMS_N2",
  "productKey": "ems",
  "messageId": "1234567891",
  "timeStamp": "1773025005000",
  "data": {
    "mode": "time_range",
    "start": "1773028800000",
    "end": "1773036000000"
  }
}
```

> 说明：`start` / `end` 建议与 `timeStamp` 字段保持同一时间基准（Unix 时间戳毫秒）。

| 字段 | 类型   | 描述                                                         |
| ---- | ------ | ------------------------------------------------------------ |
| mode | string | 固定为 `"time_range"`，表示按时间范围请求历史实时数据     |
| start| string | 起始时间（含），Unix 时间戳（毫秒），字符串形式             |
| end  | string | 结束时间（含），Unix 时间戳（毫秒），字符串形式             |

网关行为（约定）：

- 收到 `mode = "time_range"` 请求后：
  - 按时间顺序，将本地记录中 **时间落在 `[start, end]` 且仍未确认** 的实时数据，逐条通过 `device/ems/{clientId}/data` 重新上报；
  - 重新上报时，沿用当时的 `timeStamp` 和 `messageId` 等字段；
  - 时间范围过长时，可分批次发送并做速率限制。

> 约定：
> - 平台可根据自身策略选择使用 `all_unacked` 或 `time_range` 模式；
> - 网关仅对“本地认为未确认”的实时数据做补点，上层不需要关心网关的内部存储实现细节。
