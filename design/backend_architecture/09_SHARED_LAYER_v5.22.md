# Shared Layer — Solfacil Protocol Types & Multi-Tenant Middleware

> **模組版本**: v5.22
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.14.md](./00_MASTER_ARCHITECTURE_v5.14.md)
> **最後更新**: 2026-03-13
> **說明**: 新增 solfacil-protocol.ts 型別定義（v5.18）、擴充 ParsedTelemetry +DO/PV/Inverter 欄位、新增 tenant-context 純函式
> **核心主題**: SolfacilMessage + GatewayRecord + ParsedTelemetry 完整欄位 + tenant-context 純函式

---

## Changes from v5.14

| Aspect | v5.14 | v5.22 |
|--------|-------|-------|
| `shared/db.ts` | Dual Pool Factory (getAppPool, getServicePool, queryWithOrg, withTransaction, closeAllPools) | **queryWithOrg signature changed**: no pool param, orgId nullable and last; added deprecated getPool/closePool aliases |
| `shared/tarifa.ts` | Tarifa Branca functions (classifyHour, getRateForHour, calculateSelfConsumption, calculateBaselineCost, calculateActualCost, calculateBestTouCost, calculateSelfSufficiency) | **UNCHANGED** since v5.14 |
| `shared/types/api.ts` | ok/fail envelope + domain types | **UNCHANGED** |
| `shared/types/auth.ts` | Role enum + TenantContext interface | **UNCHANGED** |
| `shared/types/telemetry.ts` | 23 fields ParsedTelemetry | **EXPANDED** → 25 required + 9 optional = 34 fields (+do0Active, +do1Active, +inverterTemp?, +pvTotalEnergyKwh?, +pv1Voltage?, +pv1Current?, +pv1Power?, +pv2Voltage?, +pv2Current?, +pv2Power?, +telemetryExtra?) |
| `shared/types/solfacil-protocol.ts` | N/A | **NEW** (v5.18) — Solfacil Protocol v1.1 型別 |
| `shared/middleware/tenant-context.ts` | N/A | **NEW** (~v5.19) — 純函式 verifyTenantToken + requireRole（零框架依賴） |

---

## 1. `shared/types/solfacil-protocol.ts` — NEW (v5.18)

> 新增於 v5.18，定義 Solfacil Protocol v1.1 的所有訊息信封、裝置清單、遙測項目、閘道器紀錄及資產型別。

### §1.1 `SolfacilMessage` — 訊息信封

```typescript
/** Protocol envelope for all Solfacil MQTT messages (subscribe + publish). */
export interface SolfacilMessage {
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

### §1.2 `SolfacilDevice` — 裝置清單項目

```typescript
/** A sub-device entry in the deviceList payload. */
export interface SolfacilDevice {
  readonly bindStatus: boolean;
  readonly connectStatus: string;      // "online" | "offline"
  readonly deviceBrand: string;
  readonly deviceSn: string;
  readonly fatherSn: string;
  readonly name: string;
  readonly nodeType: string;           // "major" | "minor"
  readonly productType: string;        // "meter" | "inverter" | "ems"
  readonly vendor: string;
  readonly modelId?: string;
  readonly portName?: string;
  readonly protocolAddr?: string;
  readonly subDevId?: string;
  readonly subDevIntId?: number;
  readonly maxCurrent?: string;
  readonly maxPower?: string;
  readonly minCurrent?: string;
  readonly minPower?: string;
}
```

### §1.3 `SolfacilListItem` — 遙測清單項目

```typescript
/** A telemetry list item (batList, gridList, pvList, etc.) */
export interface SolfacilListItem {
  readonly deviceSn: string;
  readonly fatherSn?: string;
  readonly name: string;
  readonly properties: Record<string, string>;
  readonly subDevId?: string;
  readonly bindStatus?: boolean;
  readonly connectStatus?: string;
  readonly deviceBrand?: string;
  readonly productType?: string;
  readonly modelId?: string;
  readonly portName?: string;
  readonly protocolAddr?: string;
  readonly protocolType?: string;
  readonly vendor?: string;
}
```

### §1.4 `GatewayRecord` — 資料庫列型別

```typescript
/** Gateway row from the gateways table. */
export interface GatewayRecord {
  readonly gateway_id: string;
  readonly org_id: string;
  readonly mqtt_broker_host: string;
  readonly mqtt_broker_port: number;
  readonly mqtt_username: string;
  readonly mqtt_password: string;
  readonly name: string;
  readonly status: "online" | "offline" | "decommissioned";
  readonly last_seen_at: Date | null;
}
```

### §1.5 `FragmentType` / `GatewayFragments`

```typescript
/** Fragment types for the 5 messages in a telemetry cycle. */
export type FragmentType = "ems" | "dido" | "meter" | "core";

/** Accumulated fragments for one gateway's telemetry cycle. */
export interface GatewayFragments {
  readonly clientId: string;
  readonly recordedAt: Date;
  readonly ems?: SolfacilListItem;
  readonly dido?: {
    readonly do: ReadonlyArray<{
      readonly id: string;
      readonly type: string;
      readonly value: string;
      readonly gpionum?: string;
    }>;
    readonly di?: ReadonlyArray<{
      readonly id: string;
      readonly type: string;
      readonly value: string;
      readonly gpionum?: string;
    }>;
  };
  readonly meters?: ReadonlyArray<SolfacilListItem>;
  readonly core?: Record<string, unknown>;
}
```

### §1.6 `AssetType` 型別 & `mapProductType`

```typescript
/** Domain asset type matching assets.asset_type column. */
export type AssetType = "SMART_METER" | "INVERTER_BATTERY" | "EMS";

/** Map protocol productType to domain AssetType. */
export function mapProductType(productType: string): AssetType;
// "meter" → "SMART_METER", "inverter" → "INVERTER_BATTERY", default → "INVERTER_BATTERY"
```

---

## 2. `shared/types/telemetry.ts` — ParsedTelemetry 擴充

> 同時匯出 `XuhengRawMessage`（原始 MQTT 訊息型別）及 `XuhengMessageType`（訊息類型辨別器）。

### §2.1 v5.14 → v5.22 欄位變更一覽

| 版本 | 新增欄位 | 累計欄位數 |
|------|----------|-----------|
| v5.13 | 14 基礎欄位 | 14 |
| v5.14 | +9 電池深度遙測欄位 | 23 |
| v5.16 | +do0Active, +do1Active | 25 |
| v5.18 | +inverterTemp?, +pvTotalEnergyKwh?, +pv1Voltage?, +pv1Current?, +pv1Power?, +pv2Voltage?, +pv2Current?, +pv2Power?, +telemetryExtra? (all optional) | 25 required + 9 optional = 34 total |
| **v5.22** | （無新增，與 v5.18 相同） | **34** |

### §2.2 完整 ParsedTelemetry 介面（v5.22）

```typescript
export interface ParsedTelemetry {
  // v5.13 基礎欄位 (14)
  readonly clientId: string;
  readonly deviceSn: string;
  readonly recordedAt: Date;
  readonly batterySoc: number;
  readonly batteryPowerKw: number;
  readonly dailyChargeKwh: number;
  readonly dailyDischargeKwh: number;
  readonly pvPowerKw: number;
  readonly pvDailyEnergyKwh: number;
  readonly gridPowerKw: number;
  readonly gridDailyBuyKwh: number;
  readonly gridDailySellKwh: number;
  readonly loadPowerKw: number;
  readonly flloadPowerKw: number;

  // v5.14 電池深度遙測 (9)
  readonly batterySoh: number;            // BMS 回報 SoH %
  readonly batteryVoltage: number;        // 電池組總電壓 (V)
  readonly batteryCurrent: number;        // 電池組電流 (A)，負值=放電
  readonly batteryTemperature: number;    // 電池組溫度 (°C)
  readonly maxChargeVoltage: number;      // 最大允許充電電壓 (V)
  readonly maxChargeCurrent: number;      // 最大允許充電電流 (A)
  readonly maxDischargeCurrent: number;   // 最大允許放電電流 (A)
  readonly totalChargeKwh: number;        // 累計終身充電量 (kWh)
  readonly totalDischargeKwh: number;     // 累計終身放電量 (kWh)

  // v5.16 數位輸出狀態 (2)
  readonly do0Active: boolean;            // DO0 繼電器狀態：true=閉合（負載切離啟動）
  readonly do1Active: boolean;            // DO1 繼電器狀態：true=閉合（負載切離啟動）

  // v5.18 逆變器 + PV 細分 + 額外欄位 (9, all OPTIONAL)
  readonly inverterTemp?: number;         // 逆變器溫度 (°C)
  readonly pvTotalEnergyKwh?: number;     // PV 累計總發電量 (kWh)
  readonly pv1Voltage?: number;           // PV 字串 1 電壓 (V)
  readonly pv1Current?: number;           // PV 字串 1 電流 (A)
  readonly pv1Power?: number;             // PV 字串 1 功率 (kW)
  readonly pv2Voltage?: number;           // PV 字串 2 電壓 (V)
  readonly pv2Current?: number;           // PV 字串 2 電流 (A)
  readonly pv2Power?: number;             // PV 字串 2 功率 (kW)
  readonly telemetryExtra?: Record<string, Record<string, number>> | null;  // JSONB per-phase diagnostic fields
}
```

### §2.3 其他匯出

```typescript
/** Xuheng message type discriminator */
export type XuhengMessageType = 0 | 1 | 2 | 3 | 4;

/** Raw Xuheng EMS MSG#4 as received from MQTT topic xuheng/+/+/data */
export interface XuhengRawMessage { ... }  // 見 telemetry.ts 完整定義
```

---

## 3. `shared/middleware/tenant-context.ts` — NEW (~v5.19)

> 新增於 v5.19 前後，提供多租戶上下文**純函式**（零框架依賴，不匯入 Express / AWS Lambda 型別）。
> BFF 透過 `bff/middleware/auth.ts` HTTP 適配器呼叫這些函式；M4/M8 直接匯入。

```typescript
import { Role, type TenantContext } from '../types/auth';

/**
 * 驗證原始租戶令牌並回傳 TenantContext。
 * 純函式：接受原始 token 字串，不涉及 HTTP 概念。
 *
 * 支援兩種格式：
 *   1. Raw JSON: {"userId":"u1","orgId":"ORG_ENERGIA_001","role":"ORG_MANAGER"}
 *   2. JWT-style: header.payload.signature (payload 為 Base64 編碼的 JSON)
 *
 * 驗證失敗時拋出 { statusCode, message }。
 */
export function verifyTenantToken(token: string): TenantContext;

/**
 * 執行 RBAC 角色檢查。
 * SOLFACIL_ADMIN 繞過所有角色檢查。
 * 權限不足時拋出 { statusCode: 403, message: "Forbidden" }。
 */
export function requireRole(ctx: TenantContext, allowedRoles: Role[]): void;
```

**與 `shared/db.ts` 的整合**:
- `queryWithOrg(sql, params, orgId)` 使用 `TenantContext.orgId`（orgId 為 null 時使用 service pool 繞過 RLS）
- 確保所有啟用 RLS 的查詢都經過租戶上下文過濾

---

## 4. `shared/db.ts` — Dual Pool Factory

> Dual Pool Factory 架構。`queryWithOrg` 簽名於 v5.20 前後改為自動選擇連線池（不再需要傳入 pool 參數）。

```typescript
// 連線池
export function getAppPool(): Pool;         // 應用程式連線池（RLS 啟用）
export function getServicePool(): Pool;     // 服務連線池（無 RLS，用於 cron / migration）

/** @deprecated Use getAppPool() instead. */
export function getPool(): Pool;

// 租戶範圍查詢 — orgId 為 null 時使用 service pool (BYPASSRLS)
export async function queryWithOrg<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
  orgId: string | null,
): Promise<{ rows: T[] }>;

// 交易輔助
export function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T>;

// 優雅關閉
export function closeAllPools(): Promise<void>;

/** @deprecated Use closeAllPools() instead. */
export function closePool(): Promise<void>;
```

---

## 5. `shared/tarifa.ts` — UNCHANGED since v5.14

> Tarifa Branca 函式庫維持不變，完整匯出清單見 v5.14 文件 §5。

```typescript
// 常數
export const TARIFA_BRANCA_DEFAULTS = { ... };

// 型別
export type TarifaPeriod = "ponta" | "intermediaria" | "fora_ponta";
export interface TariffSchedule { ... };
export interface HourlyEnergyRow { ... };
export interface BestTouInput { ... };
export interface BestTouResult { ... };

// 函式 — 保留 (3)
export function classifyHour(hour: number): TarifaPeriod;
export function getRateForHour(hour: number, schedule: TariffSchedule | null): number;
export function calculateSelfConsumption(pvGenerationKwh: number, gridExportKwh: number): number | null;

// 函式 — v5.14 新增 (4)
export function calculateBaselineCost(hourlyLoads: ..., schedule: TariffSchedule): number;
export function calculateActualCost(hourlyGridImports: ..., schedule: TariffSchedule): number;
export function calculateBestTouCost(params: BestTouInput): BestTouResult;
export function calculateSelfSufficiency(totalLoadKwh: number, totalGridImportKwh: number): number | null;
```

---

## 6. `shared/types/api.ts` + `shared/types/auth.ts` — UNCHANGED

| 檔案 | 匯出 | 狀態 |
|------|------|------|
| `shared/types/api.ts` | `ok<T>(data: T)`, `fail(message: string)` 回應信封；`ApiResponse<T>` 介面；`Organization`, `Asset` 領域實體；`DeviceParserRule`, `VppStrategy`, 請求/回應型別；`ParserRule`, `ParserRuleMapping` (M1 Dynamic Parser)；`AssetRecord` (v5.3 HEMS)；`DashboardMetrics` (v5.5) | 無變更 |
| `shared/types/auth.ts` | `Role` 列舉、`TenantContext` 介面 | 無變更 |

---

## 7. 代碼變更清單（v5.14 → v5.22）

| 檔案 | 動作 | 版本 | 說明 |
|------|------|------|------|
| `shared/types/solfacil-protocol.ts` | **ADD** | v5.18 | Solfacil Protocol v1.1 型別：SolfacilMessage, SolfacilDevice, SolfacilListItem, GatewayRecord, FragmentType, GatewayFragments, AssetType, mapProductType |
| `shared/types/telemetry.ts` | **MODIFY** | v5.16 | +do0Active, +do1Active (數位輸出繼電器狀態) |
| `shared/types/telemetry.ts` | **MODIFY** | v5.18 | +inverterTemp?, +pvTotalEnergyKwh?, +pv1Voltage?, +pv1Current?, +pv1Power?, +pv2Voltage?, +pv2Current?, +pv2Power?, +telemetryExtra? (all optional) |
| `shared/middleware/tenant-context.ts` | **ADD** | ~v5.19 | 純函式 verifyTenantToken + requireRole（零框架依賴） |
| `shared/db.ts` | **MODIFIED** | ~v5.20 | queryWithOrg 簽名改為 (sql, params, orgId\|null)；新增 deprecated getPool/closePool 別名 |
| `shared/tarifa.ts` | **unchanged** | — | Tarifa Branca 函式庫維持不變 |
| `shared/types/api.ts` | **unchanged** | — | ok/fail 信封維持不變 |
| `shared/types/auth.ts` | **unchanged** | — | Role 列舉 + TenantContext 介面維持不變 |

---

## 8. 依賴關係

```
shared/types/solfacil-protocol.ts   <-- M1 IoT Hub (gateway-handler, device-registration)
  SolfacilMessage                    <-- M1 mqtt-subscriber (Solfacil topic)
  SolfacilDevice                     <-- M1 device-registration
  SolfacilListItem                   <-- M1 telemetry parser
  GatewayRecord                      <-- M1, M5 BFF (gateway CRUD)
  FragmentType / GatewayFragments    <-- M1 fragment assembler
  AssetType / mapProductType         <-- M1 device auto-registration

shared/types/telemetry.ts           <-- M1 XuhengAdapter.ts
  ParsedTelemetry                    <-- M1 mqtt-subscriber, message-buffer, writer
  XuhengRawMessage                   <-- M1 mqtt-subscriber
  XuhengMessageType                  <-- M1 mqtt-subscriber

shared/middleware/tenant-context.ts  <-- M5 BFF (via bff/middleware/auth.ts), M4, M8
  verifyTenantToken                  <-- token 驗證（純函式）
  requireRole                        <-- RBAC 角色檢查（純函式）

shared/types/auth.ts                 <-- tenant-context.ts, M5 BFF, M8
  Role                               <-- 角色列舉
  TenantContext                      <-- 租戶上下文介面

shared/tarifa.ts                     <-- M4 daily-billing-job.ts
  calculateBaselineCost              <-- M4
  calculateActualCost                <-- M4
  calculateBestTouCost               <-- M4
  calculateSelfSufficiency           <-- M4
  calculateSelfConsumption           <-- M4

shared/db.ts                         <-- 所有模組 (M1–M8)
  getAppPool / getServicePool        <-- 各模組依使用情境選擇連線池
  queryWithOrg                       <-- RLS 查詢（自動選擇連線池）
  withTransaction                    <-- 交易操作
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：公共型別、EventBus、Cognito JWT middleware |
| v5.3 | 2026-02-27 | HEMS 單戶控制型別 |
| v5.4 | 2026-02-27 | PostgreSQL 全面取代 DynamoDB 型別 |
| v5.5 | 2026-02-28 | 雙層 KPI 型別 |
| v5.10 | 2026-03-05 | RLS Scope Formalization |
| v5.11 | 2026-03-05 | Dual Pool Factory |
| v5.13 | 2026-03-05 | XuhengRawMessage + ParsedTelemetry types; Tarifa Branca pure functions (classifyHour, calculateDailySavings, calculateOptimizationAlpha, calculateSelfConsumption) |
| v5.14 | 2026-03-06 | Formula Overhaul: delete calculateDailySavings + calculateOptimizationAlpha; add calculateBaselineCost + calculateActualCost + calculateBestTouCost(DP) + calculateSelfSufficiency; add BestTouInput/BestTouResult interfaces; expand ParsedTelemetry +9 fields; expand XuhengRawMessage.batList.properties +9 fields; DP O(480K ops), 1.6KB memory, millisecond execution |
| **v5.22** | **2026-03-13** | **新增 solfacil-protocol.ts（完整介面對齊原始碼）；ParsedTelemetry 擴充至 34 欄位（v5.18 欄位均為 optional）；tenant-context.ts 為純函式（verifyTenantToken + requireRole，零框架依賴）；db.ts queryWithOrg 簽名更正；api.ts 錯誤函式名更正為 fail；auth.ts 新增 TenantContext 介面** |
