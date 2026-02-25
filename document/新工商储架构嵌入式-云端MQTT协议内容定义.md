# MQTT Topic 规范定义文档
**文档版本**: 1.0.0
**更新日期**: 2025-12-17
**协议版本**: 新工商储架构 MQTT 协议 v1.0

[TOC]


# 1. Topic 命名规范

## 1.1 命名规则

```
{direction}/{productKey}/{clientId}/{messageType}
```

| 字段        | 说明         | 示例                                         |
| ----------- | ------------ | -------------------------------------------- |
| direction   | 消息方向     | `device`（设备上报）/ `platform`（平台下发） |
| productKey  | 产品唯一标识 | 目前都是ems                                  |
| clientId    | 网关唯一标识 | `445c3c6416d2`                               |
| messageType | 消息类型     | `data`、`alarm`、`status` 、`config`         |

## 1.2 clientId 规范

- **格式**: `uniqueId`
- **示例**: `445c3c6416d2`
- **说明**: 由设备端生成，全局唯一

---

# 2.设备列表上报

## 1.主题：

**Topic**: `device/{productKey}/{clientId}/deviceList`

## 2.触发时机

设备数量/状态等发生变化主动上报，连接到平台之后上报（间隔由 `realTimeDataInterval` 配置控制，默认5秒）
- `data.deviceList` 不为空 → 设备列表消息

## 3.内容:

一级子设备:直接跟网关通信的设备。

二级子设备:挂载在逆变器上的光伏/电池，没有跟网关直接通信。

| 字段          | 类型    | 描述                   | 用处                                                                                                              |     |
| ------------- | ------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | --- |
| DS            | int     | 是否加密               | 暂时没有用到                                                                                                      |     |
| ackFlag       | int     | 是否需要回复           | 暂时没有用到                                                                                                      |     |
| clientId      | string  | 网关id                 | 网关唯一标识                                                                                                      |     |
| messageId     | string  | 消息ID                 |                                                                                                                   |     |
| productKey    | string  | 产品key                | 标识产品                                                                                                          |     |
| timeStamp     | string  | 时间戳                 | 消息发送时间                                                                                                      |     |
| subDevices    | array   | 子设备数组             |                                                                                                                   |     |
| bindStatus    | boolean | 是否启用               | 只有一级设备有这个字段                                                                                            |     |
| connectStatus | string  | 在线/离线              | 都有,online:在线  offline:离线                                                                                    |     |
| deviceBrand   | string  | 设备型号               | 只有一级设备有这个字段                                                                                            |     |
| deviceSn      | string  | 设备全局标识           | 如果是一级子设备:一级子设备ID**下划线**网关ID,如果是二级子设备:二级子设备ID**下划线**一级子设备ID**下划线网关ID** |     |
| modelId       | string  | 模型ID                 | 只有一级设备有这个字段                                                                                            |     |
| modelVersion  | string  | 模型版本               | 只有一级设备有这个字段                                                                                            |     |
| name          | string  | 设备名称               |                                                                                                                   |     |
| portName      | string  | 端口名称               | 只有一级设备有这个字段                                                                                            |     |
| productType   | string  | 产品分类               |                                                                                                                   |     |
| protocolAddr  | string  | modbus地址             | 16进制字符串，只有一级设备有这个字段                                                                              |     |
| protocolType  | string  | 协议类型               | modbus，只有一级设备有这个字段                                                                                    |     |
| remoteIp      | string  | 远端IP                 | modbustcp用到，只有一级设备有这个字段                                                                             |     |
| remotePort    | string  | 远端端口               | modbustcp用到，只有一级设备有这个字段                                                                             |     |
| subDevId      | string  | 子设备ID               | 自动生成                                                                                                          |     |
| nodeType      | string  | 一级设备还是二级子设备 | major:一级子设备  minor:二级子设备                                                                                |     |
| fatherSn      | string  | 父设备sn               | 一级设备的fatherSn是网关，二级设备的fatherSn是一级设备                                                            |     |

设备列表上报示例:

```
{
  "DS" : 0,
  "ackFlag" : 0,
  "data" : {
   "deviceList" : [
     {
      "bindStatus" : true,                                      //只有一级设备有这个字段
      "connectStatus" : "online",                               //都有
      "deviceBrand" : "SHT30",                                  //只有一级设备有这个字段
      "deviceSn" : "SHT301747457228_QING-445c3c6416d2",         //都有
      "modelId" : "SHT30",										//只有一级设备有这个字段
      "modelVersion" : "1.0.0",									//只有一级设备有这个字段
      "name" : "SHT30温湿度",									  //都有
      "portName" : "RS485-1",									//只有一级设备有这个字段
      "productType" : "温湿度传感器",								//都有
      "protocolAddr" : "01",									//只有一级设备有这个字段
      "protocolType" : "modbus",								//只有一级设备有这个字段
      "remoteIp" : "",											//只有一级设备有这个字段
      "remotePort" : "",										//只有一级设备有这个字段
      "subDevId" : "SHT301747457228",							//都有
      "nodeType":"",						 					//都有		
      "fatherSn":""												//都有
     }
   ]
  },
  "clientId" : "QING-445c3c6416d2",
  "deviceName" : "iotGateWay",
   "productKey" : "QING-GATEWAY-4G",
  "messageId" : "3469505",
  "timeStamp" : "1747536485472"
}
```



# 3.实时数据上报

无论是子设备还是EMS本身的实时数据都通过这种格式上传,如果是EMS本身的实时数据，如CPU温度，CPU使用率，磁盘空间等，只不过deviceSn就是网关的序列号。

当属性点过多，N2/N3网关上报实时数据时，不会一次性把所有设备所有属性点都上传上去，可能每次只上传一个或几个设备的数据。

## 1.主题：

**Topic**: `device/{productKey}/{clientId}/data`

## 2.触发时机

定时主动上报（间隔由 `realTimeDataInterval` 配置控制，默认5秒）
- `data.subDevices` 不为空 → 实时数据消息

## 3.内容:

| 字段              | 类型   | 描述            | 用处                                                                                                              |     |
| ----------------- | ------ | --------------- | ----------------------------------------------------------------------------------------------------------------- | --- |
| DS                | int    | 是否加密        | 暂时没有用到                                                                                                      |     |
| ackFlag           | int    | 是否需要回复    | 暂时没有用到                                                                                                      |     |
| clientId          | string | 客户端id/网关id | 网关唯一标识                                                                                                      |     |
| deviceName        | string | 网关名称        | 标识网关                                                                                                          |     |
| productKey        | string | 产品key         | 标识产品                                                                                                          |     |
| messageId         | string | 消息ID          |                                                                                                                   |     |
| timeStamp         | string | 时间戳          | 消息发送时间                                                                                                      |     |
| pvList            | array  | 光伏数据列表    |                                                                                                                   |     |
| evList            | string | 充电桩数据列表  |                                                                                                                   |     |
| loadList          | string | 负载数据列表    |                                                                                                                   |     |
| gridList          | array  | 电网数据列表    |                                                                                                                   |     |
| batList           | string | 电池数据列表    |                                                                                                                   |     |
| ctList            | string | CT数据列表      |                                                                                                                   |     |
| meterList         | string | 电表数据列表    |                                                                                                                   |     |
| liquidCoolingList | string | 液冷数据列表    |                                                                                                                   |     |
| fireList          | string | 消防数据列表    |                                                                                                                   |     |
| subDevId          | string | 子设备/网关ID   |                                                                                                                   |     |
| deviceSn          | string | 设备全局标识    | 如果是一级子设备:一级子设备ID**下划线**网关ID,如果是二级子设备:二级子设备ID**下划线**一级子设备ID**下划线网关ID** |     |
| name              | string | 子设备/网关名称 |                                                                                                                   |     |

示例1：上传子设备实时数据,**这个示例里面没有把所有属性点全部列出来**，properties里的属性点查看标准属性点与功能点identifier值定义.md文档去获取。

```
{
    "DS": 0,
    "ackFlag": 0,
    "data": {
         "pvList" : [
              {
              	"subDevId":"",
              	"name":"",
              	"deviceSn":"",
              	"properties":{
              		"pv1_voltage":"30"
              		"pv1_current":""
              	}
              	
              }
              ],
              
          "evList":[
          	{
          	"subDevId":"",
            "name":"",
            "deviceSn":"",
            "properties":{
              		"EvStatus":"30"
              	}
              }
          ],
          
          "loadList":[
          	{
          	"subDevId":"",
            "name":"",
            "deviceSn":"",
            "properties":{
              		"load1_voltA":"30"
              	}
             }
         ],

        "gridList":[
        {
			"subDevId":"",
            "name":"",
            "deviceSn":"",
            "properties":{
              		"grid_voltA":"30"
              	}
        }

        ],

        "batList":[
        	"subDevId":"",
            "name":"",
            "deviceSn":"",
           "properties":{
              		"bat_soc":"30"
              	}
        ]

        "ctList":[
        	"subDevId":"",
            "name":"",
            "deviceSn":"",
            "properties":{
              		"humidity":"30"
              	}
        ]
    },
    "clientId": "QING-445c3c6416d2",
    "deviceName": "iotGateWay",
    "productKey": "QING-GATEWAY-4G",
    "messageId": "9163435",
    "timeStamp": "1747534429156"
}
```

示例2：上传网关的实时数据（emsList虽然是数组，但是只有一个元素，为了保持结构一致）

```
{

  "DS" : 0,
  "ackFlag" : 0,
  "data" : {
        "emsList":[
        	"subDevId":"",
        	"deviceSn":"",
            "name":"",
            "properties":{
              		"CPU_temp":"30"		//CPU温度
              		"CPU_usage":"30"	//CPU使用率
              		"disk_usage":"",	//磁盘使用率
              		"ems_temp":"",		//ems温度
              		"humidity":"",		
              		"memory_usage":"",
              		"SIM_status":"",
              		"phone_status":"",
              		"phone_signal_strength":"",
              		"system_runtime":"",
              		"hardware_time":"",
              		"system_time":"",
              		"wifi_signal_strength":""
              		"wifi_status":"",
              	}
        ]
  },
 "clientId" : "QING-445c3c6416d2",
  "deviceName" : "iotGateWay",
  "productKey" : "QING-GATEWAY-4G",
  "messageId" : "9163435",
  "timeStamp" : "1747534429156"
}
```



# 4.心跳包

## 1.主题：
**Topic**: `device/{productKey}/{clientId}/status`

## 2.触发时机

定时主动上报（间隔由 `heartBeatFreq` 配置控制，默认30秒）

## 3.内容:

| 字段       | 类型   | 描述            | 用处         |     |
| ---------- | ------ | --------------- | ------------ | --- |
| DS         | int    | 是否加密        | 暂时没有用到 |     |
| ackFlag    | int    | 是否需要回复    | 暂时没有用到 |     |
| clientId   | string | 客户端id/网关id | 网关唯一标识 |     |
| deviceName | string | 网关名称        | 标识网关     |     |
| productKey | string | 产品key         | 标识产品     |     |
| messageId  | string | 消息ID          |              |     |
| timeStamp  | string | 时间戳          | 消息发送时间 |     |

2.心跳包示例:

```
{
    "DS": 0,
    "ackFlag": 0,
    "data": {

    },
    "clientId": "QING-445c3c6416d2",
    "deviceName": "iotGateWay",
    "productKey": "QING-GATEWAY-4G",
    "messageId": "9163436",
    "timeStamp": "1747534429979"
}
```

# 5.事件告警

## 1.主题：
**Topic**: `device/{productKey}/{clientId}/alarm`


## 2.触发时机

有事件/告警时触发

## 3.内容

| 字段        | 类型   | 描述                                                     | 用处                                |     |
| ----------- | ------ | -------------------------------------------------------- | ----------------------------------- | --- |
| DS          | int    | 是否加密                                                 | 暂时没有用到                        |     |
| ackFlag     | int    | 是否需要回复                                             | 暂时没有用到                        |     |
| clientId    | string | 网关id                                                   | 网关唯一标识                        |     |
| productKey  | string | 产品key                                                  | 标识产品                            |     |
| messageId   | string | 消息ID                                                   |                                     |     |
| timeStamp   | string | 时间戳                                                   | 消息发送时间                        |     |
| eventinfo   | Object | 事件信息                                                 |                                     |     |
| createTime  | string | 事件触发时间                                             |                                     |     |
| description | string | 事件描述                                                 |                                     |     |
| deviceSn    | string | 设备全局标识                                             |                                     |     |
| eventId     | string | 事件ID                                                   |                                     |     |
| eventName   | string | 事件名称                                                 |                                     |     |
| eventType   | string | 事件类型分为"Alarm"、"Fault"、"Notify"                   |                                     |     |
| level       | string | 告警级别                                                 |                                     |     |
| propId      | string | 属性ID                                                   |                                     |     |
| propName    | string | 属性名称                                                 |                                     |     |
| propValue   | string | 属性值                                                   |                                     |     |
| status      | string | 状态                                                     | 暂时没有用到,可以作为是否已处理字段 |     |
| subDevId    | string | 子设备ID                                                 |                                     |     |
| subDevName  | string | 子设备名称                                               |                                     |     |
| productType | string | 产品类型inverter,battery,meter,air,fire,ev,LiquidCooling |                                     |     |
| updateTime  | string | 记录更新时间                                             |                                     |     |

2.事件告警实例:

```
{
    "DS": 0,
    "ackFlag": 0,
    "data": {
        "eventinfo": {
            "createTime": "2025-05-18 11:09:26",
            "description": "",
            "deviceSn": "SHT301747457228_93406000cc0048140147445c3c6416d2",
            "eventId": "HumiHigh",
            "eventName": "湿度过高",
            "eventType": "Alarm",
            "level": "1",
            "propId": "humidity",
            "propName": "湿度值",
            "propValue": "87.2",
            "status": "0",
            "productType":"ev",
            "subDevId": "SHT301747457228",
            "subDevName": "SHT30温湿度",
            "updateTime": "2025-05-18 11:09:26"
        }
    },
    "clientId": "QING-445c3c6416d2",
    "deviceName": "iotGateWay",
    "productKey": "QING-GATEWAY-4G",
    "messageId": "1954267",
    "timeStamp": "1747537766842"
}
```

# 6.平台指令下发

## 1.主题：

**Topic**: `platform/{productKey}/{clientId}/command`



## 2.触发时机

平台目前用不到这个协议。

## 3.内容

| 字段        | 类型   | 描述           | 用处                                 |     |
| ----------- | ------ | -------------- | ------------------------------------ | --- |
| DS          | int    | 是否加密       | 暂时没有用到                         |     |
| ackFlag     | int    | 是否需要回复   | 暂时没有用到                         |     |
| clientId    | string | 网关id         | 网关唯一标识                         |     |
| deviceName  | string | 网关名称       | 用来标识网关名称                     |     |
| productKey  | string |                |                                      |     |
| messageId   | string | 消息ID         |                                      |     |
| timeStamp   | string | 时间戳         | 消息发送时间                         |     |
| deviceSn    | string | 设备全局唯一SN | 标识子设备                           |     |
| identifier  | string | 功能ID         | 功能ID属于标准字段，参考标准字段表   |     |
| name        | string | 设备名称       |                                      |     |
| inputParams | array  | 参数数组       |                                      |     |
| propId      | string | 参数名称       | 参数名称属于标准字段，参考标准字段表 |     |
| value       | string | 参数值         |                                      |     |
| type        | string | 参数类型       |                                      |     |

示例：

```
{
    "DS": 0,
    "ackFlag": 0,
    "data": {
        "subDevices": [
            {
                "deviceSn": "SHT301747457228_QING-445c3c6416d2",
                "name": "SHT30温湿度",
                "services": [
                    {
                        "identifier": "JCSetPower",
                        "name": "设置有功功率",
                        "inputParams": [
                            {
                                "propId": "vaildPower",
                                "value": "70",
                                "type": "int16"
                            }
                        ]
                    }
                ]
            }
        ]
    },
    "clientId": "QING-445c3c6416d2",
    "deviceName": "iotGateWay",
    "productKey": "QING-GATEWAY-4G",
    "messageId": "9163436",
    "timeStamp": "1747534429979"
}
```

# 7.DIDO数据上报

## 1.主题：

**Topic**: `device/{productKey}/{clientId}/data`



## 2.触发时机

DIDO数据走实时数据上报主题， 定时上报

## 3.内容

| 字段       | 类型   | 描述                                                                                                                               |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| DS         | int    | 是否加密                                                                                                                           |
| ackFlag    | int    | 是否需要回复                                                                                                                       |
| clientId   | string | 网关id                                                                                                                             |
| deviceName | string | 网关名称                                                                                                                           |
| productKey | string |                                                                                                                                    |
| messageId  | string | 消息ID                                                                                                                             |
| timeStamp  | string | 时间戳                                                                                                                             |
|            |        |                                                                                                                                    |
| dido       | Object |                                                                                                                                    |
| di         | Array  | 数字输入                                                                                                                           |
| id         | String | 唯一标识                                                                                                                           |
| type       | String | 类型，DI:数字输入，emergencyStopSwitch:急停开关, DO:数字输出，systemStatusLamp:系统指示灯,giveAnAlarmLamp:告警指示灯,fan:散热风扇, |
| name       | String | 名称                                                                                                                               |
| gpionum    | String | 文件描述符                                                                                                                         |
| value      | String | 数值,数字输入时，1:表示灯亮，0:表示灯灭。数字输出时，1:表示常闭，0:表示常开                                                        |



```
{

 "DS" : 0,
  "ackFlag" : 0,
  "data" : {
	"dido":{
		"di":[
		{
			"id":"DI0",
			"name":"EMS对运行灯",
			"gpionum":"/dev/DI0",
			"type":"emergencyStopSwitch",		//急停开关
			"value":"1"
		},
		{
			"id":"DI0",
			"name":"DI数字输入",
			"gpionum":"/dev/DI1",
			"type":"DI",	
			"value":"1"
		}
		],
		"do":[
		{
			"id":"DO0",
			"name":"散热风扇",
			"gpionum":"/dev/DO1",
			"type":"fan",
			"value":"0"
		}
		]
	},
	"clientId" : "QING-445c3c6416d2",
   "deviceName" : "iotGateWay",
   "productKey" : "QING-GATEWAY-4G"
   "messageId" : "9163436",
   "timeStamp" : "1747534429979"
}
```



# 8.配置项获取

所有的配置项，请看**9.4**

## 1.主题：

配置项获取使用同一个主题就可以

**Topic**: `platform/{productKey}/{clientId}/config/get`

## 2.触发时机

平台主动获取

## 3.内容

| 字段       | 类型   | 描述         | 用处                                                        |     |
| ---------- | ------ | ------------ | ----------------------------------------------------------- | --- |
| DS         | int    | 是否加密     | 暂时没有用到                                                |     |
| ackFlag    | int    | 是否需要回复 | 暂时没有用到                                                |     |
| clientId   | string | 网关id       | 网关唯一标识                                                |     |
| deviceName | string | 网关名称     | 用来标识网关名称                                            |     |
| productKey | string |              |                                                             |     |
| messageId  | string | 消息ID       |                                                             |     |
| timeStamp  | string | 时间戳       | 消息发送时间                                                |     |
| configname | string | 配置名称     | "":可以获取到所有配置项，单独的配置配置项表示获取单独的配置 |     |
|            |        |              |                                                             |     |
|            |        |              |                                                             |     |

1.例如：如下获取所有配置项的

```
{
  "DS" : 0,
  "ackFlag" : 0,
  "data" : {
  	configname:"",	//配置名,如果是"" 表示获取所有配置项，如果是具体的配置项名称，则表示是获取某一个单独的配置。
  },
   "clientId" : "QING-445c3c6416d2",
   "deviceName" : "iotGateWay",
   "productKey" : "QING-GATEWAY-4G"
   "messageId" : "9163436",
   "timeStamp" : "1747534429979"
}
```

EMS:回复：

## 4.响应主题：

**Topic**: `device/{productKey}/{clientId}/config/get_reply`

```
{
  "DS" : 0,
  "ackFlag" : 0,
  "data" : {
  	configname:"",	//配置名,如果是"" 表示获取所有配置项，如果是具体的配置项名称，则表示是获取某一个单独的配置。
  	"dido":{...},
  	"icebat":{...}
  },
   "clientId" : "QING-445c3c6416d2",
   "deviceName" : "iotGateWay",
   "productKey" : "QING-GATEWAY-4G"
   "messageId" : "9163436",
   "timeStamp" : "1747534429979"
}
```



# 9.配置项下发

## 1.主题：

配置项下发使用同一个主题就可以

**Topic**: `platform/{productKey}/{clientId}/config/set`

## 2.触发时机

平台主动下发

## 3.内容

| 字段       | 类型   | 描述         | 用处                         |     |
| ---------- | ------ | ------------ | ---------------------------- | --- |
| DS         | int    | 是否加密     | 暂时没有用到                 |     |
| ackFlag    | int    | 是否需要回复 | 暂时没有用到                 |     |
| clientId   | string | 网关id       | 网关唯一标识                 |     |
| deviceName | string | 网关名称     | 用来标识网关名称             |     |
| productKey | string |              |                              |     |
| messageId  | string | 消息ID       |                              |     |
| timeStamp  | string | 时间戳       | 消息发送时间                 |     |
|            |        |              |                              |     |
| configname | string | 配置名       | 具体参考4.配置名与配置项表格 |     |
|            |        |              |                              |     |
|            |        |              |                              |     |
|            |        |              |                              |     |
|            |        |              |                              |     |
|            |        |              |                              |     |

1.例如：如下是配置dido的

```
{
  "DS" : 0,
  "ackFlag" : 0,
  "data" : {
  	configname:"dido",	//配置名,例如dido，如果是多个配置一块下发就是mutiple
  						//具体配置项
  	"dido":{			
		"di":[
		{
			"id":"DI0",
			"name":"数字输入DI0",
			"gpionum":"/dev/DI1",
			"type":"DI",
			"value":"1"
		}
		],
		"do":[
		{
			"id":"DO0",
			"name":"数字输入DO0",
			"gpionum":"/dev/DO1",
			"type":"DO",
			"value":"0"
		}
		]
	}
  },
   "clientId" : "QING-445c3c6416d2",
   "deviceName" : "iotGateWay",
   "productKey" : "QING-GATEWAY-4G"
   "messageId" : "9163436",
   "timeStamp" : "1747534429979"
}
```

2.例如：如下是配置云端地址的

```
{
  "DS" : 0,
  "ackFlag" : 0,
  "data" : {
  	configname:"cloudServer",	//配置名,例如cloudServer,如果是多个配置一块下发就是mutiple
  								//具体配置项
  	"cloudServer":{			
	  "domain":"hems.alwayscontrol.net",
	  "port":"8083",
      "cleansession" : "1",
      "fconnMaxDelay" : "1",
      "keepalive" : "60",
      "ip":"47.121.136.99",
      "mode":"domain",
      "password" : "xuheng8888!",
      "reconnMaxDelay" : "6",
      "reconnMinDelay" : "1",
      "remoteUrl" : "ws://47.121.136.99:8083",
      "timeout" : "10000",
      "username" : "xuheng"
	}
  },
   "clientId" : "QING-445c3c6416d2",
   "deviceName" : "iotGateWay",
   "productKey" : "QING-GATEWAY-4G"
   "messageId" : "9163436",
   "timeStamp" : "1747534429979"
}
```

3.例如：同时配置dido与云端地址

```
{
  "DS" : 0,
  "ackFlag" : 0,
  "data" : {
  	configname:"mutiple",	//配置名,例如dido，如果是多个配置一块下发就是mutiple
  	"dido":{			
		"di":[
		...
		],
		"do":[
		...
		]
	},
	"cloudServer":{
		...
	}
  },
   "clientId" : "QING-445c3c6416d2",
   "deviceName" : "iotGateWay",
   "productKey" : "QING-GATEWAY-4G"
   "messageId" : "9163436",
   "timeStamp" : "1747534429979"
}
```

- 响应主题：**Topic**: `device/{productKey}/{clientId}/config/set_reply`

## 4.配置名与配置项表格

### (1)云端心跳时间间隔

配置名:heartBeatFreq

```
"heartBeatFreq" : 30
```

下发示例：
```
{
    "DS": 0,
    "ackFlag": 0,
    "data": {
        "configname": "heartBeatFreq",
        "heartBeatFreq": 30
    },
    "clientId": "QING-445c3c6416d2",
    "deviceName": "iotGateWay",
    "productKey": "QING-GATEWAY-4G",
    "messageId": "9163436",
    "timeStamp": "1747534429979"
}
```

回复示例：
```
{
    "DS": 0,
    "ackFlag": 0,
    "data": {
        "configname": "heartBeatFreq",
        "result": "success" //成功失败
    },
    "clientId": "QING-445c3c6416d2",
    "deviceName": "iotGateWay",
    "productKey": "QING-GATEWAY-4G",
    "messageId": "9163436",
    "timeStamp": "1747534429979"
}
```

| 字段          | 类型    | 描述                     |
| ------------- | ------- | ------------------------ |
| heartBeatFreq | Integer | 上传云端心跳包的时间间隔 |

### (2)实时数据上传间隔

配置名:realTimeDataInterval

配置项:

```
"realTimeDataInterval" : 5
```

| 字段                 | 类型    | 描述             |
| -------------------- | ------- | ---------------- |
| realTimeDataInterval | Integer | 实时数据上传间隔 |

### (3)工商储能电池配置项

配置名:icebat

配置项:

```
"icebat" : {
 	  "workMode" : "auto",		//工作模式
 	  "bat_workStatus":"charging", 		//电池工作状态(充电:charging/放电:discharging/不充不放:other)
      "times" : [
         {
            "end" : 60,
            "start" : 0,
            "type" : "charging"
         },
         {
            "end" : 120,
            "start" : 60,
            "type" : "charging"
         },
         {
            "end" : 180,
            "start" : 120,
            "type" : "charging"
         },
         {
            "end" : 240,
            "start" : 180,
            "type" : "charging"
         },
         {
            "end" : 300,
            "start" : 240,
            "type" : "charging"
         },
         {
            "end" : 360,
            "start" : 300,
            "type" : "charging"
         },
         {
            "end" : 420,
            "start" : 360,
            "type" : "charging"
         },
         {
            "end" : 600,
            "start" : 540,
            "type" : "discharging"
         },
         {
            "end" : 660,
            "start" : 600,
            "type" : "discharging"
         },
         {
            "end" : 720,
            "start" : 660,
            "type" : "discharging"
         },
         {
            "end" : 780,
            "start" : 720,
            "type" : "discharging"
         },
         {
            "end" : 840,
            "start" : 780,
            "type" : "discharging"
         },
         {
            "end" : 900,
            "start" : 840,
            "type" : "discharging"
         },
         {
            "end" : 960,
            "start" : 900,
            "type" : "discharging"
         },
         {
            "end" : 1020,
            "start" : 960,
            "type" : "discharging"
         },
         {
            "end" : 1080,
            "start" : 1020,
            "type" : "discharging"
         }
      ],
     "chargingStopSoc":"95",		//充电停止SOC
     "dischargingStopSoc":"10",		//放电停止SOC
     "chargingPower":"250",			//充电功率
     "dischargingPower":"250"		//放电功率
     "balancingControl":"active",			//均衡控制
   }


```

| 字段               | 类型   | 描述                                                                              |
| ------------------ | ------ | --------------------------------------------------------------------------------- |
| icebat             | Object | 工商储能电池配置                                                                  |
| workMode           | String | 运行模式,自动模式:auto，手动模式:manual                                           |
| bat_workStatus     | String | 电池工作状态,充电:charging/放电:discharging/不充不放:other,只有手动模式才使用这个 |
| times              | array  | 时间数组                                                                          |
| start              | String | 开始时间，转成分钟数                                                              |
| end                | String | 结束时间，转成分钟数                                                              |
| type               | String | 设置类型：充电-charging 放电-discharging                                          |
| chargingStopSoc    | String | 充电停止SOC                                                                       |
| dischargingStopSoc | String | 放电停止SOC                                                                       |
| chargingPower      | String | 充电功率                                                                          |
| dischargingPower   | String | 放电功率                                                                          |
| balancingControl   | String | 均衡控制,主动均衡 :active,被动均衡:passive                                        |
| fanControl         | String | 风扇控制，自动:auto,开启:enable 关闭:disable                                      |
| tempProtection     | String | 温度保护,开启:enable 关闭:disable                                                 |
|                    |        |                                                                                   |

### (4)消防配置项

配置名:fireFighting

配置项:

```
"fireFighting":{
	"fireStartMode":"auto",	//灭火启动方式 自动:auto,手动:manual
	"fireType":""			//灭火剂类型
	"soundLightAlarm":"enable",	//声光报警 启用:enable 禁用:disable
	"emergencyPowerOff":"auto",		//紧急断电 自动:auto 手动:manual
	"ventilationControl":"auto"		//通风控制英文 自动:auto  开启:enable  关闭:disable
}
```

| 字段               | 类型   | 描述                                              |
| ------------------ | ------ | ------------------------------------------------- |
| fireFighting       | Object | 消防控制配置对象                                  |
| fireStartMode      | String | 灭火启动方式 自动:auto,手动:manual                |
| fireType           | String | 灭火剂类型                                        |
| soundLightAlarm    | String | 声光报警 启用:enable 禁用:disable                 |
| emergencyPowerOff  | String | 紧急断电 自动:auto 手动:manual                    |
| ventilationControl | String | 通风控制英文 自动:auto  开启:enable  关闭:disable |

### (5)液冷配置项

配置名:liquidCooling

配置项:

```
"liquidCooling":{
    "mode": "standby",
    "workLoad": ""
}
```

| 字段          | 类型   | 描述                                                                          |
| ------------- | ------ | ----------------------------------------------------------------------------- |
| liquidCooling | Object | 液冷控制配置对象                                                              |
| mode          | String | 工作模式 制冷:cooling，制热：heating, 自循环:self_circulation， 待机：standby |
| workLoad      | String | 制冷专属字段：     full：全工况     half：半工况                              |

# 以下是网关本身相关配置项，云端可以暂不关注

### (1)方案配置项scheme

配置名:scheme

配置项:

```
"scheme":{
	"package":"house",
    "branch":"standard"
   }
```

| 字段    | 类型   | 描述                               |
| ------- | ------ | ---------------------------------- |
| scheme  | Object | 方案配置                           |
| package | String | house:户用方案，ice:工商储方案     |
| branch  | String | standard:标准方案，shanke:山克方案 |

### (2)充电桩配置项AutoControl

配置名:AutoControl

配置项:

```
"AutoControl" : {
	  "mode" : "DLB-SC",
      "EVControlMode" : 0,
      "inflowCurrMax" : 40
}
```

| 字段          | 类型   | 描述                                                                                                                 |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| AutoControl   | Object | 充电桩配置                                                                                                           |
| mode          | String | 模式配置项，OCPP:OCPP模式，OCPP-DLB:OCPP加动态负载平衡，DLB-SC:动态负载平衡启停模式，DLB-NSC:动态负载平衡不启停模式. |
| EVControlMode | String | 0:平均分配，1:排队模式，2:插队模式                                                                                   |
| inflowCurrMax | String | 家庭最大流入电流                                                                                                     |

### (3)数据上传平台

配置名:CloudDestination

配置项:

```
"CloudDestination" : "xuheng",
```

| 字段             | 类型   | 描述                                               |
| ---------------- | ------ | -------------------------------------------------- |
| CloudDestination | String | xuheng:数据上传旭衡云，ThirdCloud:数据上传第三方云 |

### (4)第三方平台mqtt客户端配置

配置名:ThirdCloud

配置项:

```
"ThirdCloud" : {
      "cleansession" : "1",
      "domain" : "hems.alwayscontrol.net",
      "fconnMaxDelay" : "0",
      "ip" : "47.121.136.99",
      "keepalive" : "60",
      "mode" : "ip",
      "password" : "xuheng8888!",
      "port" : "8083",
      "reconnMaxDelay" : "6",
      "reconnMinDelay" : "1",
      "remoteUrl" : "ws://47.106.120.119:8083",
      "timeout" : "10000",
      "username" : "xuheng"
   }
```

| 字段           | 类型   | 描述                           |
| -------------- | ------ | ------------------------------ |
| cleansession   | String | 1:**清除会话**‌  0:**持久会话** |
| domain         | String | 连接的域名                     |
| fconnMaxDelay  | String | 最大连接延时，毫秒             |
| ip             | String | 连接的IP                       |
| mode           | String | ip:使用IP，domain:使用域名     |
| keepalive      | String | 心跳保持时间                   |
| username       | String | 用户名                         |
| password       | String | 密码                           |
| port           | String | 端口                           |
| reconnMaxDelay | String | 最大连接延时                   |
| reconnMinDelay | String | 最小连接延时                   |
| remoteUrl      | String | 连接的URL                      |
| timeout        | String | 超时时间                       |

### (5)旭衡云平台mqtt客户端配置

配置名:cloudServer

配置项:

```
"cloudServer" : 
{
	  "domain":"hems.alwayscontrol.net",
	  "port":"8083",
      "cleansession" : "1",
      "fconnMaxDelay" : "1",
      "keepalive" : "60",
      "ip":"47.121.136.99",
      "mode":"domain",
      "password" : "xuheng8888!",
      "reconnMaxDelay" : "6",
      "reconnMinDelay" : "1",
      "remoteUrl" : "ws://47.121.136.99:8083",
      "timeout" : "10000",
      "username" : "xuheng"
  }
```

| 字段           | 类型   | 描述                           |
| -------------- | ------ | ------------------------------ |
| cleansession   | String | 1:**清除会话**‌  0:**持久会话** |
| domain         | String | 连接的域名                     |
| fconnMaxDelay  | String | 最大连接延时，毫秒             |
| ip             | String | 连接的IP                       |
| mode           | String | ip:使用IP，domain:使用域名     |
| keepalive      | String | 心跳保持时间                   |
| username       | String | 用户名                         |
| password       | String | 密码                           |
| port           | String | 端口                           |
| reconnMaxDelay | String | 最大连接延时                   |
| reconnMinDelay | String | 最小连接延时                   |
| remoteUrl      | String | 连接的URL                      |
| timeout        | String | 超时时间                       |

### (6)是否自动更新

配置名:autoUpdateSet

配置项:

```
"OTA" : {
      "autoUpdateSet" : 1		//1表示自动更新,0表示不自动更新
   },
```

### (7)本地IP黑白名单

配置名:blackwhitelist

配置项:

```
"blackwhitelist" : {
      "iplist" : ["192.168.0.1","192.168.0.2"],
      "type" : "white"
}
```

| 字段   | 类型   | 描述                      |
| ------ | ------ | ------------------------- |
| type   | String | white:白名单,black:黑名单 |
| iplist | array  | 黑白名单数组              |

### (8)can口配置项

配置名:can

配置项:

```
"can" : [
      {
         "canbaud" : "500000",
         "canname" : "can0"
      },
      {
         "canbaud" : "500000",
         "canname" : "can1"
      }
   ]
```

| 字段    | 类型   | 描述      |
| ------- | ------ | --------- |
| canbaud | String | can波特率 |
| canname | String | can名称   |

### (9)网关配置项

配置名:gate

配置项:

```
"gate" : {
      "gatewayId" : "00001",
      "gatewayName" : "EMS_N2",
      "gatewayNetworking" : "wifi",
      "gatewayVersion" : "1.0.0",
	  "gatewayMcuVersion":""
   }
```

| 字段              | 类型   | 描述           |
| ----------------- | ------ | -------------- |
| gatewayId         | String | 网关ID         |
| gatewayName       | String | 网关名称       |
| gatewayNetworking | String | 保留，暂时不用 |
| gatewayVersion    | String | 网关版本       |
| gatewayMcuVersion | String | 单片机版本     |



### (10)是否开启https

配置名:https

配置项:

```
"https" : "disable",
```

| 字段  | 类型   | 描述                                |
| ----- | ------ | ----------------------------------- |
| https | String | disable:禁用https  enable:开启https |

### (11)4G网络配置

配置名:phone

配置项:

```
"phone" : {
      "status" : "disable"
 }
```

| 字段   | 类型   | 描述                          |
| ------ | ------ | ----------------------------- |
| status | String | disable:禁用4G  enable:启用4G |

### (12)串口配置

配置名:serial

配置项:

```
"serial" : [
      {
         "checkbit" : "n",
         "databit" : "8",
         "flow" : "disable",
         "serialbaud" : "9600",
         "serialname" : "RS485-0",
         "stopbit" : "1"
      },
      {
         "checkbit" : "n",
         "databit" : "8",
         "flow" : "disable",
         "serialbaud" : "9600",
         "serialname" : "RS485-1",
         "stopbit" : "1"
      },
      {
         "checkbit" : "n",
         "databit" : "8",
         "flow" : "disable",
         "serialbaud" : "2400",
         "serialname" : "RS232-0",
         "stopbit" : "1"
      },
      {
         "checkbit" : "n",
         "databit" : "8",
         "flow" : "disable",
         "serialbaud" : "9600",
         "serialname" : "RS232-1",
         "stopbit" : "1"
      }
   ]
```

| 字段       | 类型   | 描述                                   |
| ---------- | ------ | -------------------------------------- |
| checkbit   | String | 校验位，n:无校验 e:偶校验 o:奇校验     |
| databit    | String | 数据位，值有7或8                       |
| flow       | String | 流控制,disable:禁止流控。true:开启流控 |
| serialbaud | String | 波特率                                 |
| serialname | String | 串口名，不可编辑                       |
| stopbit    | String | 停止位                                 |

### (13)本地用户配置

配置名:user

配置项:

```
 "user" : [
      {
         "group" : "admin",
         "uname" : "admin",
         "upass" : "xuheng8888"
      }
   ]
```

| 字段  | 类型   | 描述   |
| ----- | ------ | ------ |
| group | String | 用户组 |
| uname | String | 用户名 |
| upass | String | 密码   |

### (14)本地WIFI配置

配置名:wifi

配置项:

```
"wifi" : {
      "ap" : {
         "encrypt" : "0",
         "password" : "12345678",
         "ssid" : "ems_wifi"
      },
      "sta" : {
         "encrypt" : "1",
         "password" : "",
         "ssid" : "",
		 "dhcp":"enable",
		 "ip":"192.168.0.120",
		 "netmask":"255.255.255.0",
		 "gateway":"192.168.0.1",
		 "dns":"8.8.8.8",
		 "state":"enable"
      },
      "wifimode" : "ap"
 }
```

| 字段     | 类型   |     | 描述                                |
| -------- | ------ | --- | ----------------------------------- |
| ap       | Object |     | AP的配置                            |
| encrypt  | String |     | 加密方式,1:加密 0:不加密            |
| ssid     | String |     | SSID                                |
| password | String |     | 密码                                |
| sta      | Object |     | STA的配置                           |
| dhcp     | String |     | 是否开启DHCP                        |
| ip       | String |     | 静态IP时的IP地址                    |
| netmask  | String |     | 静态IP时的子网掩码                  |
| gateway  | String |     | 默认网关地址                        |
| dns      | String |     | 默认DNS                             |
| state    | String |     | 状态                                |
| wifimode | String |     | 当前WIFI模式,ap:ASP模式 sta:STA模式 |

### (15)本地语言

配置名:1ocalLanguage

配置项:

```
"1ocalLanguage":"English"
```

| 字段          | 类型   | 描述                      |
| ------------- | ------ | ------------------------- |
| 1ocalLanguage | String | English:英语 Chinese:中文 |

### (16)DIDO配置项

配置名:dido

配置项:

```
"dido":{
		"di":[
		{
			"id":"DI0",
			"name":"数字输入DI0",
			"gpionum":"/dev/DI1",
			"type":"DI",
			"value":"1"
		},
		{
			"id":"DI1",
			"name":"数字输入DI1",
			"gpionum":"/dev/DI2",
			"type":"DI",
			"value":"1"
		}
		],
		"do":[
		{
			"id":"DO0",
			"name":"数字输入DO0",
			"gpionum":"/dev/DO1",
			"type":"DO",
			"value":"0"
		},
		{
			"id":"DO1",
			"name":"数字输入DO1",
			"gpionum":"/dev/DO2",
			"type":"DO",
			"value":"0"
		}
		]
	}
```

| 字段    | 类型   | 描述                           |
| ------- | ------ | ------------------------------ |
| di      | Array  | di的配置项                     |
| id      | String | 标识哪一个输入或者输出         |
| name    | String | 输入或者输出的名称             |
| gpionum | String | 文件描述符                     |
| type    | String | 类型,DI:输入 DO:输出           |
| value   | String | 输出的电平，0:低电平，1:高电平 |
|         |        |                                |

### (17)安全配置

配置名:safety

配置项:

```
"safety":{
			"autoLock":"disable",
			"lockTime":"30",
			"ssh" : "enable"
}
```

| 字段     | 类型   | 描述                                         |
| -------- | ------ | -------------------------------------------- |
| autoLock | String | 是否开启自动锁定,disable:不开启，enable:开启 |
| lockTime | String | 页面停留时间                                 |
| ssh      | String | 是否开启ssh                                  |
|          |        |                                              |

