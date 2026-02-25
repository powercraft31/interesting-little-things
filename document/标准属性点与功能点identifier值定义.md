# 1.产品类型productType值定义

[TOC]

## 1.产品类型定义

- productType:字段值

| 字段值   | 英文翻译     | 中文翻译          |
| -------- | ------------ | ----------------- |
| inverter | inverter/PCS | 逆变器/储能逆变器 |
| battery  | battery      | 电池              |
| meter    | meter        | 电表              |
| air      | air          | 空调              |
| fire     | fire         | 消防              |

## 2.标准属性点identifier值定义

- identifier值定义,类型全是字符串

### 2.1.电池设备总数据

- **多个电池簇组合的数据**：以下是多个电池簇组合的数据。

| 字段值                          | 类型   | 中文翻译             |
| ------------------------------- | ------ | -------------------- |
| total_bat_vlotage               | String | 设备总电压           |
| total_bat_isoResPos             |        | 设备总绝缘正电阻     |
| total_bat_isoResNeg             |        | 设备总绝缘负电阻     |
| total_bat_chargeableCapacity    |        | 设备总可充电容量     |
| total_bat_dischargeableCapacity |        | 设备总可放电容量     |
| total_bat_maxChargeCurrent      |        | 设备允许最大充电电流 |
| total_bat_maxDischargeCurrent   |        | 设备允许最大放电电流 |
| total_bat_current               |        | 设备总电流           |
| total_bat_power                 |        | 设备总功率           |
| total_bat_soc                   |        | 设备总soc            |
| total_bat_soh                   |        | 设备总soh            |
| total_bat_pack                  |        | 设备簇数             |
| total_bat_cycleNumber           |        | 设备总循环次数       |
| total_bat_dailyChargedEnergy    |        | 设备日充电容量       |
| total_bat_dailyDischargedEnergy |        | 设备日放电容量       |
| total_bat_totalChargedEnergy    |        | 设备累计充电容量     |
| total_bat_totalDischargedEnergy |        | 设备累计放电容量     |
| total_bat_temperature           |        | 设备温度             |
| total_bat_workStatus            |        | 设备工作状态         |

- **电池簇相关数据** ：以下是单个电池簇的信息。

- **注意** 如果是单个设备那么就是`bat_`。 如果为多簇设备那么`bat_`默认的表示第一个, 第二个直接就是`bat2_`来区分多簇设备情况。

| 字段值                                 | 类型   | 中文翻译                                                               |
| -------------------------------------- | ------ | ---------------------------------------------------------------------- |
| bat_soc                                | String | 电池当前SOC                                                            |
| bat_soh                                |        | 电池当前SOH                                                            |
| bat_soe                                |        | 电池当前SOE                                                            |
| bat_workStatus                         |        | 电池工作状态(充电:"charging"/放电:"discharging"/不充不放:"other")      |
| bat_totalVoltage                       |        | 电池总电压                                                             |
| bat_totalPower                         |        | 电池总功率                                                             |
| bat_totalCurrent                       |        | 电池总电流                                                             |
| bat_cellVoltage                        |        | 电池单个电池电压                                                       |
| bat_designCap                          |        | 电池设计容量（AH）                                                     |
| bat_remainCap                          |        | 电池剩余容量（AH）                                                     |
| bat_fullCap                            |        | 电池满负荷（AH）                                                       |
| bat_cycleNumber                        |        | 电池循环次数                                                           |
| bat_balanceState                       |        | 电池的平衡状态                                                         |
| bat_envTemp                            |        | 电池环境温度                                                           |
| bat_MOSTemp                            |        | 电池MOS温度                                                            |
| bat_warnInfo                           |        | 电池告警信息                                                           |
| bat_maximumSingleCellVoltage           |        | 电池最高单体电压值                                                     |
| bat_minimumSingleCellVoltage           |        | 电池最低单体电压值                                                     |
| bat_maximumSingleCellVoltageDifference |        | 电池最大单体压差值                                                     |
| bat_averageSingleCellVoltage           |        | 电池平均单体电压                                                       |
| bat_maximumTemperature                 |        | 电池最高温度                                                           |
| bat_minimumTemperature                 |        | 电池最低温度                                                           |
| bat_averageTemperature                 |        | 电池平均温度                                                           |
| bat_temperatureDifference              |        | 电池包最大温度差                                                       |
| bat_totalChargedEnergy                 |        | 电池累计充电量                                                         |
| bat_totalDischargedEnergy              |        | 电池累计放电量                                                         |
| bat_socStatus                          |        | 电池SOC状态                                                            |
| bat_totalVoltageStatus                 |        | 电池总电压状态                                                         |
| bat_overCurrentStatus                  |        | 电池过流状态                                                           |
| bat_maxChargeCurrent                   |        | 电池最大充电电流                                                       |
| bat_maxDischargeCurrent                |        | 电池最大放电电流                                                       |
| bat_cellsNumber                        |        | 电芯个数（一簇有多少个单体电压）                                       |
| bat_tempsNumber                        |        | 温度个数（一簇有个多少个温度传感器）                                   |
| bat_cellVoltage1                       |        | 电池单体电压1,根据CellsNumber数量决定cellVoltage1,cellVoltage2         |
| bat_cellTemperature1                   |        | 电池单体温度1,根据TempsNumber数量决定cellTemperature1,cellTemperature2 |

### 2.2.电表/逆变器公共字段相关

identifier值定义,类型全是字符串

- 针对多PCS情况下， `identifier`值定义在对应`grid/load`基础上加上编号，如`grid2_voltA`,`grid2_voltB`
- **注意**：没有写编号就是单个PCS的情况, 第二个设备直接从`grid2_`开始。

| 字段值                        | 类型   | 中文翻译                            |
| ----------------------------- | ------ | ----------------------------------- |
| grid_voltA                    | 字符串 | 电网侧A相电压                       |
| grid_voltB                    |        | 电网侧B相电压                       |
| grid_voltC                    |        | 电网侧C相电压                       |
| grid_lineABVolt               |        | 电网侧AB线电压                      |
| grid_lineBCVolt               |        | 电网侧BC线电压                      |
| grid_lineCAVolt               |        | 电网侧CA线电压                      |
| grid_currentA                 |        | 电网侧A相电流                       |
| grid_currentB                 |        | 电网侧B相电流                       |
| grid_currentC                 |        | 电网侧C相电流                       |
| grid_activePowerA             |        | 电网侧A相有功功率                   |
| grid_activePowerB             |        | 电网侧B相有功功率                   |
| grid_activePowerC             |        | 电网侧C相有功功率                   |
| grid_reactivePowerA           |        | 电网侧A相无功功率                   |
| grid_reactivePowerB           |        | 电网侧B相无功功率                   |
| grid_reactivePowerC           |        | 电网侧C相无功功率                   |
| gird_apparentPowerA           |        | 电网侧A相视在功率                   |
| gird_apparentPowerB           |        | 电网侧B相视在功率                   |
| gird_apparentPowerC           |        | 电网侧C相视在功率                   |
| grid_factorA                  |        | 电网侧A相因数                       |
| grid_factorB                  |        | 电网侧B相因数                       |
| grid_factorC                  |        | 电网侧C相因数                       |
|                               |        |                                     |
| grid_frequency                |        | 电网侧频率                          |
| grid_direction                |        | 电网侧方向`input`, `output`,`other` |
|                               |        |                                     |
| grid_activePower              |        | 电网侧总有功电能                    |
| grid_reactivePower            |        | 电网侧总无功电能                    |
| grid_positiveEnergy           |        | 电网侧总正向电能                    |
| grid_negativeEnergy           |        | 电网侧总负向电能                    |
|                               |        |                                     |
| grid_totalActivePower         |        | 电网侧总有功功率                    |
| grid_totalRecctivePower       |        | 电网侧总无功功率                    |
| grid_totalApparentPower       |        | 电网侧总视在功率                    |
| grid_cumulativeActiveEnergy   |        | 电网侧累计有功电能                  |
| grid_cumulativeReactiveEnergy |        | 电网侧累计无功电能                  |
|                               |        |                                     |
| load_voltA                    |        | 负载侧A相电压                       |
| load_voltB                    |        | 负载侧B相电压                       |
| load_voltC                    |        | 负载侧C相电压                       |
|                               |        |                                     |
| load_currentA                 |        | 负载侧A相电流                       |
| load_currentB                 |        | 负载侧B相电流                       |
| load_currentC                 |        | 负载侧C相电流                       |
|                               |        |                                     |
| load_activePowerA             |        | 负载侧A相有功功率                   |
| load_activePowerB             |        | 负载侧B相有功功率                   |
| load_activePowerC             |        | 负载侧C相有功功率                   |
| load_reactivePowerA           |        | 负载侧A相无功功率                   |
| load_reactivePowerB           |        | 负载侧B相无功功率                   |
| load_reactivePowerC           |        | 负载侧C相无功功率                   |
|                               |        |                                     |
| load_factorA                  |        | 负载侧A相因数                       |
| load_factorB                  |        | 负载侧B相因数                       |
| load_factorC                  |        | 负载侧C相因数                       |
|                               |        |                                     |
| load_frequency                |        | 负载侧频率                          |
| load_direction                |        | 负载侧方向`input`, `output`,`other` |
| load_activePower              |        | 负载侧总有功电能                    |
| load_reactivePower            |        | 负载侧总无功电能                    |
| load_positiveEnergy           |        | 负载侧总正向电能                    |
| load_negativeEnergy           |        | 负载侧总负向电能                    |
|                               |        |                                     |
| load_totalActivePower         |        | 负载侧总有功功率                    |
| load_totalRecctivePower       |        | 负载侧总无功功率                    |
| load_totalApparentPower       |        | 负载侧总视在功率                    |
| load_cumulativeActiveEnergy   |        | 负载侧累计有功电能                  |
| load_cumulativeReactiveEnergy |        | 负载侧累计无功电能                  |
| 下面几个是针对电表采用的字段  |        |                                     |
| grid_daliyActiveEnergy        |        | 电网侧日有功电量                    |
| grid_daliyReactiveEnergy      |        | 电网侧日无功电量                    |

### 2.3.逆变器相关

identifier值定义,类型全是字符串

| 字段值                  | 类型   | 中文翻译            |
| ----------------------- | ------ | ------------------- |
| pv_totalPower           | string | 光伏PCS总功率       |
| battery_totalPower      |        | 电池PCS总功率       |
|                         |        |                     |
| flload_voltA            |        | 家庭负载A相电压     |
| flload_voltB            |        | 家庭负载B相电压     |
| flload_voltC            |        | 家庭负载C相电压     |
|                         |        |                     |
| flload_currentA         |        | 家庭负载A相电流     |
| flload_currentB         |        | 家庭负载B相电流     |
| flload_currentC         |        | 家庭负载C相电流     |
|                         |        |                     |
| flload_totalPower       |        | 家庭负载总功率      |
| flload_activePowerA     |        | 家庭负载A相有功功率 |
| flload_activePowerB     |        | 家庭负载B相有功功率 |
| flload_activePowerC     |        | 家庭负载C相有功功率 |
| fl_phase                |        | 家庭负载相数        |
| gridConnectionFrequency |        | AC输入频率/并网频率 |
| inverter_ambientTemp    |        | PCS环境温度         |
|                         |        |                     |
|                         |        |                     |

### 2.4.消防相关

| 字段值                         | 类型   | 中文翻译   |
| ------------------------------ | ------ | ---------- |
| fire_fireStatus                | string | 火警状态   |
| fire_extinguisherStatus        |        | 灭火器状态 |
| fire_smokeDetector             |        | 烟感探测器 |
| fire_tempSensor                |        | 温感探测器 |
| fire_extinguisherAgentPressure |        | 灭火器压力 |
| fire_audibleVisualAlarm        |        | 声光报警器 |

### 2.5.液冷机相关

| 字段值                     | 类型   | 中文翻译                       |
| -------------------------- | ------ | ------------------------------ |
| chiller_workmode           | string | 液冷机运行模式                 |
| chiller_runningStatus      | string | 液冷机运行状态                 |
| chiller_outdoorAmbientTemp | string | 液冷机环境温度(对应储能柜温度) |
| chiller_inletWaterTemp     | string | 液冷机进水温度                 |
| chiller_outletWaterTemp    | string | 液冷机出水温度                 |
| chiller_waterTempDiff      | string | 液冷机水温温差                 |
| chiller_coolantTemp        | string | 液冷机冷却液温度               |
| chiller_waterPressure      | string | 液冷机出水压力                 |
| chiller_inletWaterPressure | string | 液冷机进水压力                 |
| chiller_waterPumpSpeed     | string | 液冷机水泵转速                 |
| chiller_relativeHumidity   | string | 液冷机相对湿度                 |

### 2.6.充电桩相关

| 字段值               | 类型   | 中文翻译           |
| -------------------- | ------ | ------------------ |
| charge_version       | string | 充电桩版本号       |
| charge_phase         | string | 充电桩相位         |
| charge_EVStatus      | string | 充电桩设备工作状态 |
| charge_acVoltageL1   | string | 充电桩L1相电表电压 |
| charge_acCurrentL1   |        | 充电桩L1相电表电流 |
| charge_connectStatus |        | 充电桩连接状态     |
| charge_vendor        |        | 充电桩品牌         |
|                      |        |                    |

### 2.7.EMS属性点

| 字段值                | 类型   | 中文翻译                               |
| --------------------- | ------ | -------------------------------------- |
| CPU_usage             | string | CPU使用率,示例：80%                    |
| CPU_temp              | string | CPU温度   示例：40°C                   |
| memory_usage          | string | 内存使用率  示例：60%                  |
| disk_usage            | string | 磁盘使用率  示例：61.27%               |
| wifi_status           | String | wifi状态 示例：打开，示例：关闭        |
| wifi_signal_strength  | String | wifi信号强度 示例：12.00dBm (信号极强) |
| SIM_status            | String | SIM卡状态,示例：未插入                 |
| phone_signal_strength | String | SIM卡信号强度                          |
| phone_status          | String | 4G状态,  示例：开启，示例：关闭        |
| system_runtime        | String | 系统运行时长 10分钟                    |
| system_time           | String | 当前系统时间 2025-12-16 10:34          |
| hardware_time         | String | 当前硬件时间 2025-12-16 02:34          |

### 2.8.光伏属性点

| 字段值      | 类型   | 描述      |
| ----------- | ------ | --------- |
| pv1_voltage | String | 光伏1电压 |
| pv1_current | String | 光伏1电流 |
| pv1_power   | String | 光伏1功率 |
|             |        |           |
| pv2_voltage | String | 光伏2电压 |
| pv2_current | String | 光伏2电流 |
| pv2_power   | String | 光伏2功率 |
| .......     | String |           |
| pvn_voltage | String | 光伏n电压 |
| pvn_current | String | 光伏n电流 |
| pvn_current | String | 光伏n功率 |

### 2.9.CT数据

| 字段值            | 类型   | 描述        |
| ----------------- | ------ | ----------- |
| ct_voltA          | String | A相电压     |
| ct_voltB          | String | B相电压     |
| ct_voltC          | String | C相电压     |
|                   |        |             |
| ct_currentA       | String | A相电流     |
| ct_currentB       | String | B相电流     |
| ct_currentC       | String | C相电流     |
| .......           | String |             |
| ct_activePowerA   | String | A相有功功率 |
| ct_activePowerB   | String | B相有功功率 |
| ct_activePowerC   | String | C相有功功率 |
|                   |        |             |
| ct_apparentPowerA | String | A相视在功率 |
| ct_apparentPowerB | String | B相视在功率 |
| ct_apparentPowerC | String | C相视在功率 |
|                   |        |             |
| ct_reactivePowerA | String | A相功率因数 |
| ct_reactivePowerB | String | B相功率因数 |
| ct_reactivePowerC | String | C相功率因数 |
|                   |        |             |
| ct_frequency      | String | 频率        |

### 2.10.DIDO数据

| 字段值              | 类型   | 描述       |
| ------------------- | ------ | ---------- |
| emergencyStopSwitch | String | 急停开关   |
| systemStatusLamp    | String | 运行指示灯 |
| giveAnAlarmLamp     | String | 告警指示灯 |
| fan                 | string | 散热风扇   |
