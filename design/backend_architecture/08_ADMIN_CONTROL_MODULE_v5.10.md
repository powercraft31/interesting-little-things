# Module 8: Admin Control Plane — Global Control Plane (全局控制面)

> **模組版本**: v5.10
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.10.md](./00_MASTER_ARCHITECTURE_v5.10.md)
> **最後更新**: 2026-03-05
> **說明**: 全局控制面 — Data Dictionary、配置 CRUD、AppConfig CDK、Canary 部署、Control Plane UI、VPP 策略、**v5.10: 架構邊界修復**

---

## § v5.10 架構邊界修復

### 問題陳述

M8 Admin Control 模組的 4 個 handler 文件跨界 import 了 M5 BFF 的 middleware：

```typescript
// ❌ v5.9: 跨界依賴（Architecture Boundary Breach）
import { extractTenantContext, requireRole, apiError } from '../../bff/middleware/tenant-context';
```

此 import 違反限界上下文原則：M8 作為 Control Plane，不應依賴 Data Plane 模組（M5 BFF）的內部實作。

### 修正

將所有 4 個文件的 import 路徑改為 Shared Layer（v5.10 新增的 `src/shared/middleware/tenant-context.ts`）：

```typescript
// ✅ v5.10: 從 Shared Layer import
import { extractTenantContext, requireRole, apiError } from '../../shared/middleware/tenant-context';
```

### 影響範圍

| 文件 | 修改內容 |
|------|---------|
| `src/admin-control-plane/handlers/get-parser-rules.ts` | import 路徑變更 |
| `src/admin-control-plane/handlers/create-parser-rule.ts` | import 路徑變更 |
| `src/admin-control-plane/handlers/get-vpp-strategies.ts` | import 路徑變更 |
| `src/admin-control-plane/handlers/update-vpp-strategy.ts` | import 路徑變更 |

**無業務邏輯變更。** 函數簽名、參數、回傳值完全不變。僅修改 import 來源。

---

## 1. Architectural Law: Control Plane vs. Data Plane (全局法則)

（與 v5.3 相同，不重複。）

---

## 2. 核心職責與設計哲學

（與 v5.3 相同，不重複。）

---

## 7. M8 REST API Endpoints

（與 v5.3 相同，不重複。）

---

## 10. CDK Stack

（與 v5.3 相同，不重複。）

---

## Lambda Handlers (v5.10 更新)

```
src/admin-control-plane/
├── handlers/
│   ├── get-parser-rules.ts        # GET /admin/parsers — v5.10: import from shared/middleware
│   ├── create-parser-rule.ts      # POST /admin/parsers — v5.10: import from shared/middleware
│   ├── get-vpp-strategies.ts      # GET /admin/strategies — v5.10: import from shared/middleware
│   ├── update-vpp-strategy.ts     # PUT /admin/strategies/:id — v5.10: import from shared/middleware
│   ├── get-data-dictionary.ts     # GET /admin/data-dictionary
│   ├── create-data-dictionary.ts  # POST /admin/data-dictionary
│   ├── get-feature-flags.ts       # GET /admin/feature-flags
│   └── update-feature-flag.ts     # PUT /admin/feature-flags/:id
└── __tests__/
    ├── parser-rules.test.ts
    └── vpp-strategies.test.ts
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：Data Dictionary、AppConfig、8 module configuration dependency |
| v5.3 | 2026-02-27 | Data Dictionary seed records、HEMS 對齊 |
| **v5.10** | **2026-03-05** | **架構邊界修復：4 個 handler 文件 import 路徑從 `../../bff/middleware/tenant-context` 改為 `../../shared/middleware/tenant-context`。無業務邏輯變更。** |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | Shared Layer | **v5.10: import `shared/middleware/tenant-context`（原依賴 BFF，已修正）** |
| **依賴** | M4 (Market & Billing) | 共享 RDS PostgreSQL VPC |
| **被依賴** | M1 (IoT Hub) | AppConfig `vpp-m1-parser-rules` |
| **被依賴** | M2 (Optimization Engine) | AppConfig `vpp-strategies` |
| **被依賴** | M3 (DR Dispatcher) | AppConfig `dispatch-policies` |
| **被依賴** | M4 (Market & Billing) | AppConfig `billing-rules` |
| **被依賴** | M5 (BFF) | AppConfig `feature-flags` |
| **被依賴** | M6 (Identity) | AppConfig `rbac-policies` |
| **被依賴** | M7 (Open API) | AppConfig `api-quotas` |
