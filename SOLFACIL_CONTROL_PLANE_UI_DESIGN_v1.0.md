# SOLFACIL VPP — Control Plane UI 設計文件

> **Version:** 1.0 | **Date:** 2026-02-21
> **Author:** Frontend Architecture Team
> **Status:** DRAFT — 等待審閱
> **Depends on:** `SOLFACIL_BACKEND_DESIGN_v5.1.md` (§0 Architectural Law, §20 Module 8)
> **Integrates:** `VPP批量模式更改功能设计方案.md` (Batch Ops → §4.2 M2 UI)

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| **v1.0** | 2026-02-21 | 初版。完整定義 Control Plane Admin UI：產品定位、技術選型、全局佈局、M1~M7 七大模塊 UI 互動設計、統一發佈流程、設計規範、里程碑計劃。整合批量模式更改方案至 M2 UI。 |

---

## Table of Contents

1. [§1 產品定位 (Product Vision)](#1-產品定位-product-vision)
2. [§2 技術選型與目錄架構 (Tech Stack)](#2-技術選型與目錄架構-tech-stack)
3. [§3 全局佈局 (Layout)](#3-全局佈局-layout)
4. [§4 核心模塊 UI 互動設計](#4-核心模塊-ui-互動設計)
   - 4.1 [M1 IoT Hub — Parser Rules Editor](#41-m1-iot-hub--parser-rules-editor)
   - 4.2 [M2 Algorithm Engine — VPP Strategies + Batch Ops](#42-m2-algorithm-engine--vpp-strategies--batch-ops)
   - 4.3 [M3 DR Dispatcher — Dispatch Policies](#43-m3-dr-dispatcher--dispatch-policies)
   - 4.4 [M4 Market & Billing — Billing Rules](#44-m4-market--billing--billing-rules)
   - 4.5 [M5 Frontend BFF — Feature Flags](#45-m5-frontend-bff--feature-flags)
   - 4.6 [M6 Identity & Tenant — RBAC Policies](#46-m6-identity--tenant--rbac-policies)
   - 4.7 [M7 Open API — API Quotas & Webhook Policies](#47-m7-open-api--api-quotas--webhook-policies)
5. [§5 統一發佈流程 (Unified Deployment Flow)](#5-統一發佈流程-unified-deployment-flow)
6. [§6 UI 設計規範 (Design System)](#6-ui-設計規範-design-system)
7. [§7 里程碑計劃 (Milestones)](#7-里程碑計劃-milestones)

---

## 1. 產品定位 (Product Vision)

### 1.1 定位聲明

SOLFACIL VPP Control Plane UI 是一個**純內部營運工具**，用於視覺化並控制 v5.1 後端架構中 M1~M7 全部七個 Data Plane 模塊的動態配置。

它是 M8 Admin Control Plane（v5.1 §20）的**唯一人機介面**，實現 v5.0 Grand Fusion Architecture 的「No-Code Operations」願景：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Control Plane UI (本文件)                     │
│                     admin.html / admin.js / admin.css            │
│                                                                   │
│  營運人員在此修改配置 → 本地 JSON Schema 驗證 → 預覽 Diff          │
│  → 呼叫 M8 REST API → AppConfig Canary 部署 → M1-M7 自動生效    │
└───────────────────────────────┬───────────────────────────────────┘
                                │ REST API (Bearer JWT)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              M8 Admin Control Plane (Backend)                     │
│              PostgreSQL + AppConfig + Lambda                      │
│                                                                   │
│  ┌─────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────┐       │
│  │ M1  │ │   M2     │ │   M3     │ │   M4    │ │  M5  │ ...   │
│  │parse│ │strategies│ │ dispatch │ │ billing │ │flags │       │
│  │rules│ │          │ │ policies │ │  rules  │ │      │       │
│  └─────┘ └──────────┘ └──────────┘ └─────────┘ └──────┘       │
└─────────────────────────────────────────────────────────────────┘
                                │ AppConfig Lambda Extension
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              Data Plane (M1~M7 Lambda Functions)                  │
│              http://localhost:2772 讀取配置，零延遲               │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 目標使用者

| 角色 | Cognito Group | 使用場景 | 權限層級 |
|------|--------------|----------|----------|
| **平台工程師** | `SOLFACIL_GLOBAL_ADMIN` | 全模塊配置管理、Feature Flag 控制、RBAC 矩陣審查 | 完全存取 |
| **Tier 2 技術支援** | `SOLFACIL_GLOBAL_ADMIN` | 協助客戶調整 VPP 策略、排查 Parser 規則、調整 Dispatch 超時 | 完全存取 |
| **Tier 3 高級工程師** | `SOLFACIL_GLOBAL_ADMIN` | 緊急配置回滾、API Quota 調整、計費規則修正 | 完全存取 |

> **存取控制規則：** 本 Admin UI **僅限** `SOLFACIL_GLOBAL_ADMIN` 群組成員存取。
> 任何非此群組的 JWT Token 在前端 Route Guard 即被攔截，不會到達 M8 API。

### 1.3 設計哲學

| 原則 | 說明 | 體現方式 |
|------|------|----------|
| **High Density** | 單一螢幕展示最大資訊量，減少頁面跳轉 | 三欄佈局：導航 + 編輯區 + 稽核日誌 |
| **High Efficiency** | 3 步完成任意配置修改（選模塊 → 編輯 → 發佈） | 統一發佈流程，快捷鍵支援 |
| **Zero-Friction** | 不需要額外培訓即可使用 | 表單驗證即時反饋、JSON Schema 提示、Diff 預覽 |
| **Safety First** | 錯誤配置不會到達生產環境 | 本地 Schema 驗證 → AppConfig Schema 驗證 → Canary 部署 |
| **Dark Theme** | 降低長時間使用的視覺疲勞 | 深色背景 + 高對比度狀態顏色 |

### 1.4 與現有前端的關係

```
現有 Frontend（客戶面向）          Admin UI（內部營運）
┌──────────────────────┐        ┌──────────────────────┐
│ index.html           │        │ admin.html           │ ← 本文件設計
│ app.js               │        │ admin.js             │
│ style.css            │        │ admin.css            │
│                      │        │                      │
│ 對象：所有租戶用戶    │        │ 對象：SOLFACIL 內部  │
│ 功能：Dashboard/報表  │        │ 功能：M1-M7 配置管理 │
│ 認證：任何有效 JWT    │        │ 認證：GLOBAL_ADMIN   │
│ API：M5 BFF          │        │ API：M8 Admin API    │
└──────────────────────┘        └──────────────────────┘
         ↑ 不共用任何代碼 ↑              ↑ 完全獨立 ↑
```

**完全獨立**：admin.html 不引用 app.js、style.css，也不共用 DOM 結構。
兩者共用的唯一基礎設施是 Cognito User Pool（認證）和 API Gateway（不同路由）。

---

## 2. 技術選型與目錄架構 (Tech Stack)

### 2.1 技術選型決策

| 維度 | 選擇 | 理由 |
|------|------|------|
| **框架** | Vanilla JS（原生） | 與現有 app.js 保持架構一致性；Admin UI 為內部工具，無需 React/Vue 的生態複雜度 |
| **CSS** | 原生 CSS + CSS Custom Properties | 深色主題透過 CSS Variables 統一管理；無需 Tailwind/Sass 建構步驟 |
| **HTTP Client** | fetch() API | 瀏覽器原生支援，搭配統一的 adminApi() 封裝 |
| **JSON Editor** | textarea + 語法高亮（手動） | M1 Parser Rules 需要全螢幕 JSON 編輯；不引入外部 JSON Editor 庫 |
| **Schema 驗證** | Ajv（CDN 引入） | 與 AppConfig 使用相同的 JSON Schema draft-07；本地驗證提供即時反饋 |
| **Diff 預覽** | 自製簡易 Diff（行級比對） | 發佈前顯示變更差異；不引入 diff2html 等重型庫 |
| **圖示** | Material Icons（CDN） | 與現有 Dashboard 一致 |
| **字體** | JetBrains Mono（CDN） | Monospace 字體，適合配置數據展示 |

### 2.2 外部依賴（僅 CDN）

```html
<!-- admin.html <head> 區塊 -->

<!-- Material Icons（與現有 Dashboard 共用） -->
<link href="https://fonts.googleapis.com/icon?family=Material+Icons"
      rel="stylesheet">

<!-- JetBrains Mono（Monospace 字體） -->
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
      rel="stylesheet">

<!-- Ajv JSON Schema Validator（v8, draft-07 相容） -->
<script src="https://cdn.jsdelivr.net/npm/ajv@8/dist/ajv.bundle.min.js"></script>
```

**零建構步驟**：所有依賴透過 CDN 載入，開發人員可直接用瀏覽器開啟 admin.html。

### 2.3 目錄架構

```
SOLFACIL_VPP_Demo/
├── index.html              # 客戶 Dashboard（現有，不修改）
├── app.js                  # Dashboard 邏輯（現有，不修改）
├── style.css               # Dashboard 樣式（現有，不修改）
│
├── admin.html              # ★ Admin Control Plane UI（新增）
├── admin.js                # ★ Admin 業務邏輯（新增，預估 ~2000 行）
├── admin.css               # ★ Admin 深色主題樣式（新增，預估 ~1200 行）
│
├── schemas/                # ★ JSON Schema 驗證檔（新增目錄）
│   ├── parser-rules.schema.json
│   ├── vpp-strategies.schema.json
│   ├── dispatch-policies.schema.json
│   ├── billing-rules.schema.json
│   ├── feature-flags.schema.json
│   ├── rbac-policies.schema.json
│   └── api-quotas.schema.json
│
├── SOLFACIL_BACKEND_DESIGN_v5.1.md
├── SOLFACIL_CONTROL_PLANE_UI_DESIGN_v1.0.md  # ← 本文件
└── VPP批量模式更改功能设计方案.md
```

### 2.4 admin.js 模塊結構

```
================================================================
admin.js — SOLFACIL VPP Control Plane UI
模塊結構總覽（按定義順序）
================================================================

SECTION 0: Constants & Configuration (~80 行)
 - API_BASE_URL, APPCONFIG_POLL_INTERVAL
 - MODULE_REGISTRY: M1~M7 模塊元數據
 - DEPLOYMENT_STATUS_MAP: 部署狀態映射
 - JSON_SCHEMAS: 各模塊 Schema 引用

SECTION 1: Auth & Route Guard (~120 行)
 - parseJwt(): 解析 JWT Token
 - checkAdminAccess(): 驗證 SOLFACIL_GLOBAL_ADMIN
 - redirectToLogin(): 未授權時重導向
 - initAuth(): DOMContentLoaded 時執行

SECTION 2: API Client (~150 行)
 - adminApi(method, path, body): 統一 HTTP 封裝
 - handleApiError(response): 錯誤處理
 - loadModuleConfig(module): 載入指定模塊配置
 - saveModuleConfig(module, data): 儲存配置
 - deployConfig(module): 觸發 AppConfig 部署
 - getDeploymentStatus(deploymentId): 查詢部署狀態

SECTION 3: Navigation & Layout (~100 行)
 - initNavigation(): 左側導航初始化
 - switchModule(moduleId): 切換模塊視圖
 - renderBreadcrumb(module): 更新麵包屑
 - toggleAuditPanel(): 展開/收合右側稽核面板

SECTION 4: Module Renderers (~800 行，核心)
 - renderM1ParserRules(data): JSON Textarea 編輯器
 - renderM2VppStrategies(data): 策略表單 + 批量模式
 - renderM3DispatchPolicies(data): Timeout/Retry 表單
 - renderM4BillingRules(data): 懲罰倍率表單
 - renderM5FeatureFlags(data): Feature Flag Toggle 列表
 - renderM6RbacPolicies(data): 唯讀權限矩陣
 - renderM7ApiQuotas(data): Webhook Timeout 表單

SECTION 5: Batch Operations (M2 專屬，~300 行)
 - initBatchToolbar(): 批量操作工具欄
 - batchState: 選中狀態管理
 - executeBatchDispatch(): 批量下發流程
 - simulateAssetModeChange(): 模擬模式切換
 （整合自 VPP批量模式更改功能设计方案.md）

SECTION 6: Unified Deployment Flow (~200 行)
 - validateConfig(module, data): JSON Schema 本地驗證
 - showDiffPreview(oldData, newData): Diff 預覽
 - triggerDeploy(module): 呼叫 M8 API + 輪詢狀態
 - pollDeploymentStatus(deploymentId): 每 5 秒輪詢
 - showDeploymentResult(status): 結果展示

SECTION 7: Audit Log Panel (~100 行)
 - loadAuditLog(): 載入操作日誌
 - appendAuditEntry(entry): 新增日誌條目
 - renderAuditTimeline(): 時間軸渲染

SECTION 8: Utilities (~150 行)
 - formatTimestamp(iso): 時間格式化
 - deepClone(obj): 深拷貝
 - jsonDiff(a, b): 簡易行級 Diff
 - debounce(fn, ms): 防抖
 - showToast(message, type): 通知提示
 - showModal(content): Modal 管理

SECTION 9: Initialization (~50 行)
 - document.addEventListener('DOMContentLoaded', init)
 - init(): 認證 → 導航 → 載入預設模塊
```

### 2.5 M6 Cognito Route Guard 設計

Admin UI 的存取控制在**前端 Route Guard + 後端 RBAC Middleware** 雙層實施：

```
使用者開啟 admin.html
        │
        ▼
  ┌──────────────┐
  │ localStorage  │──── 有 JWT Token? ────► 否 ──► 重導向 Cognito Login
  │ 讀取 JWT     │                                   │
  └──────┬───────┘                                   │
         │ 是                                        │
         ▼                                           │
  ┌──────────────────────────────┐                   │
  │ 解析 JWT Claims              │                   │
  │ custom:group 欄位            │                   │
  └──────┬───────────────────────┘                   │
         │                                           │
         ▼                                           │
  custom:group 包含                                   │
  'SOLFACIL_GLOBAL_ADMIN'?                            │
         │                                           │
    ┌────┴────┐                                      │
    │ 是      │ 否                                   │
    ▼         ▼                                      │
  載入 UI   顯示 403 頁面 ◄──────────────────────────┘
             「您沒有 Admin 權限」
```

**前端 Route Guard 偽代碼：**

```javascript
function checkAdminAccess() {
  const token = localStorage.getItem('vpp_admin_token');
  if (!token) return redirectToLogin();

  const claims = parseJwt(token);

  // 檢查 Token 是否過期
  if (claims.exp * 1000 < Date.now()) {
    localStorage.removeItem('vpp_admin_token');
    return redirectToLogin();
  }

  // 檢查是否為 GLOBAL_ADMIN
  if (claims['custom:group'] !== 'SOLFACIL_GLOBAL_ADMIN') {
    return showForbiddenPage();
  }

  // 通過 — 初始化 UI
  return initAdminUI(claims);
}
```

> **注意：** 前端 Route Guard 僅為 UX 層面的防護。
> 真正的安全性由 M8 REST API 的 Cognito Authorizer + RBAC Middleware 保障。

---

## 3. 全局佈局 (Layout)

### 3.1 三欄式佈局架構

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ┌─ Top Bar (48px) ──────────────────────────────────────────────────────┐ │
│  │  ☰ SOLFACIL Control Plane    [env: PROD ▾]    eng@solfacil     [⚙]  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ Left Nav ─┐  ┌─ Main Editor Area ──────────────────┐  ┌─ Audit ────┐ │
│  │ (240px)    │  │ (flex: 1, min 600px)                 │  │ (320px)    │ │
│  │            │  │                                       │  │            │ │
│  │ ┌────────┐ │  │ ┌─ Breadcrumb ─────────────────────┐ │  │ Operation  │ │
│  │ │ M1 IoT │ │  │ │ M2 > VPP Strategies > ORG_001   │ │  │ Audit Log  │ │
│  │ │ Hub    │ │  │ └───────────────────────────────────┘ │  │            │ │
│  │ ├────────┤ │  │                                       │  │ ┌────────┐ │ │
│  │ │★M2 Alg│ │  │ ┌─ Module Content ─────────────────┐ │  │ │ 16:23  │ │ │
│  │ │ Engine │ │  │ │                                   │ │  │ │ Deploy │ │ │
│  │ ├────────┤ │  │ │  (Module-specific UI rendered     │ │  │ │ M2 ✓  │ │ │
│  │ │ M3 DR  │ │  │ │   here — forms, JSON editors,    │ │  │ ├────────┤ │ │
│  │ │Dispatch│ │  │ │   tables, toggles, etc.)          │ │  │ │ 16:21  │ │ │
│  │ ├────────┤ │  │ │                                   │ │  │ │ Edit   │ │ │
│  │ │ M4 Mkt │ │  │ │                                   │ │  │ │ M1     │ │ │
│  │ │Billing │ │  │ │                                   │ │  │ ├────────┤ │ │
│  │ ├────────┤ │  │ │                                   │ │  │ │ 16:18  │ │ │
│  │ │ M5 BFF │ │  │ │                                   │ │  │ │ Rollbk │ │ │
│  │ │ Flags  │ │  │ │                                   │ │  │ │ M4     │ │ │
│  │ ├────────┤ │  │ │                                   │ │  │ └────────┘ │ │
│  │ │ M6 IAM │ │  │ │                                   │ │  │            │ │
│  │ │ RBAC   │ │  │ └───────────────────────────────────┘ │  │            │ │
│  │ ├────────┤ │  │                                       │  │            │ │
│  │ │ M7 API │ │  │ ┌─ Action Bar ─────────────────────┐ │  │            │ │
│  │ │ Quotas │ │  │ │ [Validate] [Preview Diff] [Deploy]│ │  │            │ │
│  │ └────────┘ │  │ └───────────────────────────────────┘ │  │            │ │
│  │            │  │                                       │  │            │ │
│  │ ── SYSTEM  │  │ ┌─ Status Bar (32px) ──────────────┐ │  │            │ │
│  │ Deploy Sts │  │ │ AppConfig: ● BAKED  Last: 16:23  │ │  │            │ │
│  │ Audit Log  │  │ └───────────────────────────────────┘ │  │            │ │
│  └────────────┘  └───────────────────────────────────────┘  └────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 佈局尺寸規範

| 區域 | 寬度 | 高度 | 背景色 | 說明 |
|------|------|------|--------|------|
| **Top Bar** | 100% | 48px | `#0f0f23` | Logo + 環境選擇器 + 使用者資訊 |
| **Left Nav** | 240px (固定) | calc(100vh - 48px) | `#1a1a2e` | M1~M7 模塊導航 + 系統功能 |
| **Main Editor** | flex: 1 (min 600px) | calc(100vh - 48px) | `#16162a` | 模塊配置編輯區 |
| **Audit Panel** | 320px (可收合) | calc(100vh - 48px) | `#1a1a2e` | 操作稽核時間軸 |
| **Action Bar** | 100% (Editor 內) | 56px | `#1e1e3a` | 驗證/預覽/發佈按鈕 |
| **Status Bar** | 100% (Editor 內) | 32px | `#0f0f23` | AppConfig 部署狀態 |

### 3.3 Left Nav 詳細結構

左側導航直接映射 v5.1 Grand Fusion Matrix（§0.1），每個 Tab 對應一個 AppConfig Configuration Profile：

```
┌──────────────────────────┐
│  ⚡ SOLFACIL              │
│  Control Plane            │
│                           │
│  ── DATA PLANE ────────── │
│                           │
│  ┌──────────────────────┐ │
│  │  M1 IoT Hub          │ │  ← parser-rules profile
│  │  Parser Rules         │ │
│  └──────────────────────┘ │
│  ┌──────────────────────┐ │
│  │  M2 Algorithm         │ │  ← vpp-strategies profile
│  │  VPP Strategies       │ │
│  └──────────────────────┘ │
│  ┌──────────────────────┐ │
│  │  M3 DR Dispatcher     │ │  ← dispatch-policies profile
│  │  Dispatch Policies    │ │
│  └──────────────────────┘ │
│  ┌──────────────────────┐ │
│  │  M4 Market & Billing  │ │  ← billing-rules profile
│  │  Billing Rules        │ │
│  └──────────────────────┘ │
│  ┌──────────────────────┐ │
│  │  M5 BFF               │ │  ← feature-flags profile
│  │  Feature Flags        │ │
│  └──────────────────────┘ │
│  ┌──────────────────────┐ │
│  │  M6 Identity          │ │  ← rbac-policies profile
│  │  RBAC Policies        │ │
│  └──────────────────────┘ │
│  ┌──────────────────────┐ │
│  │  M7 Open API          │ │  ← api-quotas profile
│  │  API Quotas           │ │
│  └──────────────────────┘ │
│                           │
│  ── SYSTEM ────────────── │
│  Deploy Status            │
│  Audit Log                │
│                           │
│  v1.0 | Backend v5.1     │
│  AppConfig: ● Connected  │
└──────────────────────────┘
```

**導航與 Grand Fusion Matrix 的對應關係：**

| Nav Item | AppConfig Profile | M8 PostgreSQL Table | Cache TTL | 消費模塊 |
|----------|-------------------|---------------------|-----------|----------|
| M1 IoT Hub | `parser-rules` | `device_parser_rules` | 5 min | M1 Lambda |
| M2 Algorithm | `vpp-strategies` | `vpp_strategies` | 1 min | M2 Lambda |
| M3 DR Dispatcher | `dispatch-policies` | `dispatch_policies` | 10 min | M3 Lambda |
| M4 Market & Billing | `billing-rules` | `billing_rules` | 60 min | M4 Lambda |
| M5 BFF | `feature-flags` | `feature_flags` | 5 min | M5 Middleware |
| M6 Identity | `rbac-policies` | `rbac_policies` | 30 min | M6 Cognito Lambda |
| M7 Open API | `api-quotas` | `api_quotas` | 1 min | M7 Authorizer |

### 3.4 響應式行為

| 螢幕寬度 | 佈局調整 |
|----------|----------|
| >= 1440px | 三欄完整展示（Left Nav + Editor + Audit） |
| 1200-1439px | Audit Panel 預設收合，點擊展開覆蓋 |
| 1024-1199px | Left Nav 收合為 Icon-only（60px），Audit Panel 收合 |
| < 1024px | 不支援。顯示「請使用桌面瀏覽器」提示 |

> **設計決策：** Admin UI 是內部營運工具，目標使用者均使用桌面環境。
> 不投入行動裝置適配的工程資源。

### 3.5 Top Bar 設計

```
┌────────────────────────────────────────────────────────────────────────┐
│  ☰  ⚡ SOLFACIL Control Plane          [ENV: PROD ▾]  User Info   ⚙   │
└────────────────────────────────────────────────────────────────────────┘
  │                                         │             │        │
  │  Hamburger: 展開/收合 Left Nav           │             │        └─ Settings
  │                                         │             └─ User: Email + Logout
  │                                         └─ Environment Selector
  │                                            DEV (green) / STG (yellow) / PRD (red)
```

### 3.6 Action Bar 設計

```
┌────────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────────────┐  │
│  │ Validate │   │ Preview Diff │   │  Deploy to AppConfig          │  │
│  │ (Ctrl+E) │   │ (Ctrl+D)     │   │  (Ctrl+Shift+Enter)          │  │
│  └──────────┘   └──────────────┘   └──────────────────────────────┘  │
│                                                                        │
│  狀態指示：                                                            │
│  ● 未修改 (No changes)           ● 驗證通過 (Validated)               │
│  ● 已修改未驗證 (Modified)        ● 部署中 (Deploying... Canary 10%)  │
│  ● 驗證失敗 (Errors: 3)          ● 部署完成 (Deployed)               │
└────────────────────────────────────────────────────────────────────────┘
```

**按鈕狀態機：**

```
[頁面載入] → 所有按鈕 disabled
      │
      ▼ 使用者修改配置
[Modified] → Validate: enabled
      │
      ▼ 點擊 Validate
[Valid?]
  ├─ Yes → Diff: enabled, Deploy: enabled
  └─ No  → 顯示錯誤，Deploy: disabled
      │
      ▼ 點擊 Deploy
[Deploying] → 所有按鈕 disabled, 顯示進度
      │
      ├─ Success → Toast 通知, Audit Log 更新
      └─ Failure → 顯示錯誤, 提供 Rollback 按鈕
```

---

## 4. 核心模塊 UI 互動設計

本章逐一描述 M1~M7 每個模塊在 Main Editor Area 中的 UI 設計。
每個模塊 UI 遵循統一的三段結構：**Header（模塊資訊）→ Body（編輯區）→ Action Bar（操作）**。

### 4.1 M1 IoT Hub — Parser Rules Editor

**AppConfig Profile:** `parser-rules`
**M8 Table:** `device_parser_rules`
**M8 API:** `GET/POST/PUT/DELETE /admin/parsers`

#### 4.1.1 設計理念

M1 的 `field_mapping` 和 `unit_conversions` 是深度嵌套的 JSONB 結構，無法用簡單表單表達。
因此採用**全螢幕 JSON Textarea 編輯器**，搭配即時 Schema 驗證和語法錯誤提示。

#### 4.1.2 佈局

```
┌─────────────────────────────────────────────────────────────┐
│  M1 IoT Hub > Parser Rules                                   │
│  AppConfig Profile: parser-rules | TTL: 5min                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─ Org Selector ──────────────────────────────────────────┐ │
│  │  Organization: [ORG_ENERGIA_001 ▾]  Rules: 3 active     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─ Rule List (30%) ───────┐  ┌─ JSON Editor (70%) ───────┐ │
│  │                          │  │                             │ │
│  │  ● Huawei FusionV3      │  │  {                          │ │
│  │    huawei | v3.0         │  │    "deviceId": "devSn",    │ │
│  │    Active                │  │    "timestamp": {           │ │
│  │                          │  │      "field": "collectT..", │ │
│  │  ○ Sungrow Default      │  │      "type": "unix_ms"     │ │
│  │    sungrow | v1.0        │  │    },                       │ │
│  │    Inactive              │  │    "power": {               │ │
│  │                          │  │      "field": "dataItem..", │ │
│  │  ○ Generic Native       │  │      "unit": "W",           │ │
│  │    generic | v1.0        │  │      "targetUnit": "kW",   │ │
│  │    Active                │  │      "divisor": 1000       │ │
│  │                          │  │    },                       │ │
│  │  [+ Add Rule]            │  │    "soc": { ... }           │ │
│  │                          │  │  }                           │ │
│  └──────────────────────────┘  │                             │ │
│                                 │  ── Validation ────────    │ │
│                                 │  ✓ Valid JSON               │ │
│                                 │  ✓ Schema: parser-rules OK  │ │
│                                 └─────────────────────────────┘ │
│                                                               │
│  ┌─ Tabs ──────────────────────────────────────────────────┐ │
│  │  [field_mapping]  [unit_conversions]  [Raw JSON]         │ │
│  └─────────────────────────────────────────────────────────┘ │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy parser-rules]           │
└─────────────────────────────────────────────────────────────┘
```

#### 4.1.3 互動流程

1. **選擇 Organization** — 下拉選單載入該 org 的所有 parser rules
2. **選擇 Rule** — 左側列表選中某條規則，右側載入其 JSON
3. **編輯 JSON** — Textarea 中直接編輯 field_mapping 或 unit_conversions
4. **即時驗證** — 每次輸入暫停 500ms 後自動觸發 JSON 格式檢查 + Schema 驗證
5. **Tab 切換** — field_mapping / unit_conversions / Raw JSON 三種視圖
6. **儲存 → 部署** — 點擊 Deploy 後走統一發佈流程（§5）

#### 4.1.4 JSON Schema 驗證規則

依據 v5.1 §0.2 定義的 Schema 約束：

| 欄位 | 約束 | 驗證錯誤提示 |
|------|------|-------------|
| `field_mapping` | 必須是 object | "field_mapping must be a JSON object" |
| `unit_conversions.*.factor` | minimum: 0.0001 | "Conversion factor must be positive (min 0.0001)" |
| `manufacturer` | enum: 已知廠商列表 | "Unknown manufacturer. Known: huawei, sungrow, generic" |

---

### 4.2 M2 Algorithm Engine — VPP Strategies + Batch Ops

**AppConfig Profile:** `vpp-strategies`
**M8 Table:** `vpp_strategies`
**M8 API:** `GET/POST/PUT/DELETE /admin/strategies`

> **本章節為最高優先級**，整合了 `VPP批量模式更改功能设计方案.md` 的完整設計。

#### 4.2.1 設計理念

M2 是整個 VPP 系統的「決策大腦」。其配置直接影響套利決策和收益。
UI 設計分為兩個區域：

- **上半部：策略參數表單** — 管理 per-org 的 SoC 閾值、profit margin 等
- **下半部：批量模式操作（Batch Ops）** — 對多站點同時下發運行模式變更

#### 4.2.2 策略參數表單佈局

```
┌─────────────────────────────────────────────────────────────┐
│  M2 Algorithm Engine > VPP Strategies                        │
│  AppConfig Profile: vpp-strategies | TTL: 1min               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Org: [ORG_ENERGIA_001 ▾]  Active Strategy: Conservative ●  │
│                                                               │
│  Strategy: ● Conservative  ○ Aggressive  ○ Summer Peak       │
│  [+ New Strategy]                                             │
│                                                               │
│  ┌─ Strategy Parameters ───────────────────────────────────┐ │
│  │                                                           │ │
│  │  Strategy Name: [Conservative          ]                  │ │
│  │                                                           │ │
│  │  ── SoC Thresholds ──────────────────────────────────    │ │
│  │                                                           │ │
│  │  Min SoC (%)        Max SoC (%)       Emergency SoC (%)  │ │
│  │  [    20.00    ]    [    90.00    ]   [    10.00    ]     │ │
│  │  Range: 10-50        Range: 70-100     Range: 5-20       │ │
│  │                                                           │ │
│  │  ┌─ SoC Visual Gauge ────────────────────────────────┐  │ │
│  │  │  0%  ░░░░█████████████████████████████████░░░░ 100% │  │ │
│  │  │       ↑ Emer(10)   ↑ Min(20)        Max(90) ↑       │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                           │ │
│  │  ── Profit & Timing ─────────────────────────────────    │ │
│  │                                                           │ │
│  │  Profit Margin (BRL/kWh)    Active Hours                  │ │
│  │  [    0.05     ]            [00:00] ~ [23:59]             │ │
│  │                                                           │ │
│  │  Active Weekdays                                          │ │
│  │  [Mon ✓] [Tue ✓] [Wed ✓] [Thu ✓] [Fri ✓] [Sat] [Sun]    │ │
│  │                                                           │ │
│  │  Is Active: [● ON ]    Is Default: [○ OFF]                │ │
│  └──────────────────────────────────────────────────────────┘ │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy vpp-strategies]         │
└─────────────────────────────────────────────────────────────┘
```

#### 4.2.3 SoC Visual Gauge 交互

```
  0%                                                          100%
  ├────┤████████████████████████████████████████████████├─────┤
       ↑                 ↑                              ↑
   Emergency(10)      Min(20)                       Max(90)

  紅色區域: 0% ~ emergency_soc  (緊急保留區)
  橙色區域: emergency_soc ~ min_soc  (低電量警告區)
  綠色區域: min_soc ~ max_soc  (正常操作區)
  灰色區域: max_soc ~ 100%  (過充保護區)
```

**Schema 驗證（v5.1 §0.2）：**
- min_soc: 10-50, max_soc: 70-100, emergency_soc: 5-20
- 約束：emergency_soc < min_soc < max_soc
- 違反時即時顯示紅色邊框 + 錯誤訊息

#### 4.2.4 批量模式操作 (Batch Ops)

> 完整整合自 `VPP批量模式更改功能设计方案.md`

批量模式操作允許營運人員同時對多個站點下發運行模式變更指令。
此功能嵌入在 M2 頁面的下半部分。

**三種運行模式定義：**

| 模式 | Key | Icon | 顏色 | 策略邏輯 |
|------|-----|------|------|----------|
| **自發自用** | `self_consumption` | `home` | `#059669` (綠) | 儲能優先供給本地負載，餘電上網 |
| **峰谷套利** | `peak_valley_arbitrage` | `swap_vert` | `#3730a3` (藍) | 谷時滿充，峰時全放，最大化價差收益 |
| **削峰模式** | `peak_shaving` | `compress` | `#d97706` (橙) | 限制峰值功率，避免需量電費罰款 |

**批量操作區佈局：**

```
┌─────────────────────────────────────────────────────────────┐
│  ── BATCH MODE OPERATIONS ──────────────────────────────    │
│                                                               │
│  ╔═══════════════════════════════════════════════════════╗   │
│  ║  Batch Toolbar                                         ║   │
│  ║                                                         ║   │
│  ║  ☑ Select All   |   Selected: 3/4 sites                ║   │
│  ║                                                         ║   │
│  ║  Target Mode:                                           ║   │
│  ║  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   ║   │
│  ║  │ Self-        │ │ Peak-Valley  │ │ Peak         │   ║   │
│  ║  │ Consumption  │ │ Arb. ★      │ │ Shaving      │   ║   │
│  ║  └──────────────┘ └──────────────┘ └──────────────┘   ║   │
│  ║                                                         ║   │
│  ║  [Batch Dispatch]  [Reset]                              ║   │
│  ╚═══════════════════════════════════════════════════════╝   │
│                                                               │
│  ┌─ Site Cards Grid ───────────────────────────────────────┐ │
│  │  ┌───────────────────┐  ┌───────────────────┐           │ │
│  │  │ ☑ Sao Paulo       │  │ ☑ Rio de Janeiro  │           │ │
│  │  │ [Peak-Valley]     │  │ [Self-Consump]    │           │ │
│  │  │ 948 devices       │  │ 623 devices       │           │ │
│  │  │ SoC: 65%          │  │ SoC: 72%          │           │ │
│  │  └───────────────────┘  └───────────────────┘           │ │
│  │  ┌───────────────────┐  ┌───────────────────┐           │ │
│  │  │ ☐ Belo Horizonte  │  │ ☑ Curitiba        │           │ │
│  │  │ [Peak-Valley]     │  │ [Peak Shaving]    │           │ │
│  │  │ 415 devices       │  │ 283 devices       │           │ │
│  │  │ SoC: 58%          │  │ SoC: 81%          │           │ │
│  │  └───────────────────┘  └───────────────────┘           │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 4.2.5 批量下發流程

**確認彈窗：**

```
┌─────────────────────────────────────────────────┐
│  Confirm Batch Mode Change                        │
│                                                   │
│  You are about to change operating mode for:      │
│                                                   │
│  Sao Paulo - Casa Verde                           │
│     Peak-Valley Arb. → Self-Consumption           │
│  Curitiba - Batel                                 │
│     Peak Shaving → Self-Consumption               │
│                                                   │
│  ⚠ Mode change takes effect next scheduling cycle │
│  Impact: 2 sites / 1,231 devices                  │
│  (1 site already in target mode — skipped)        │
│                                                   │
│  [Confirm Dispatch]  [Cancel]                     │
└─────────────────────────────────────────────────┘
```

**執行進度彈窗：**

```
┌─────────────────────────────────────────────────┐
│  Batch Mode Dispatching...                        │
│                                                   │
│  Overall: ████████████░░░░ 1/2                    │
│                                                   │
│  ✅ Sao Paulo          → Self-Consumption  OK     │
│     948 devices switched                          │
│                                                   │
│  ⏳ Curitiba           → Self-Consumption  65%    │
│     ░░░░░░░░░░░░░░ 65%                           │
│                                                   │
│  [Close] (enabled after completion)               │
│  [Retry Failed] (shown if any failures)           │
└─────────────────────────────────────────────────┘
```

#### 4.2.6 批量操作狀態管理

```javascript
const batchState = {
  selectedAssets: new Set(),   // 選中的資產 ID
  targetMode: null,            // 'self_consumption' | 'peak_valley_arbitrage' | 'peak_shaving'
  isDispatching: false,        // 是否正在下發
  dispatchResults: [],         // { assetId, success, error, fromMode, toMode }
};
```

**狀態流轉：**

```
[Idle] ──select assets──► [Has Selection]
                                │
                          select mode
                                │
                                ▼
                          [Ready to Dispatch]
                                │
                          click Dispatch
                                │
                                ▼
                          [Confirm Modal]
                             ┌──┴──┐
                        Confirm   Cancel
                             │      └──► [Has Selection]
                             ▼
                       [Dispatching]
                          ┌──┴──┐
                    All OK    Partial Fail
                       │           │
                       ▼           ▼
                  [Complete]  [Complete + Retry]
                       │           │
                       └─── Reset ─┘──► [Idle]
```

#### 4.2.7 與後端的對接（M8 API）

```
Admin UI (Batch Dispatch)
    │
    ▼ PUT /admin/strategies/:id/batch-mode
    │ Body: { assetIds: [...], targetMode: 'self_consumption' }
    │
M8 Admin Lambda
    │
    ├─ 1. 驗證 targetMode 合法性
    ├─ 2. 更新 vpp_strategies 表
    ├─ 3. 呼叫 AppConfig StartDeployment
    ├─ 4. 發佈 EventBridge: ConfigUpdated { module: 'M2' }
    └─ 5. 回傳 { deploymentId, status: 'IN_PROGRESS' }
           │
           ▼
M2 Lambda Extension（45 秒內拉取新配置）
    │
    ▼ 下次 optimization cycle 使用新策略
```

---

### 4.3 M3 DR Dispatcher — Dispatch Policies

**AppConfig Profile:** `dispatch-policies`
**M8 Table:** `dispatch_policies`
**M8 API:** `GET/PUT /admin/dispatch-policies`

#### 4.3.1 佈局

```
┌─────────────────────────────────────────────────────────────┐
│  M3 DR Dispatcher > Dispatch Policies                        │
│  AppConfig Profile: dispatch-policies | TTL: 10min           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Org: [ORG_ENERGIA_001 ▾]                                    │
│                                                               │
│  ── Retry Configuration ────────────────────────────────     │
│                                                               │
│  Max Retry Count              Retry Backoff (seconds)         │
│  [      3      ]              [      60     ]                 │
│  Range: 1-5                    Range: 10-300                  │
│                                                               │
│  ── Concurrency & Timeout ──────────────────────────────     │
│                                                               │
│  Max Concurrent Dispatches     Timeout (minutes)              │
│  [      10     ]              [      15     ]                 │
│  Range: 1-50                   Range: 5-60                    │
│                                                               │
│  ── Impact Preview ──────────────────────────────────────    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ With current settings:                                  │  │
│  │ • Max 10 devices dispatched simultaneously              │  │
│  │ • Failed commands retried up to 3x with 60s gap         │  │
│  │ • Commands timeout after 15 minutes                     │  │
│  │ • Worst-case single dispatch: 18 minutes total          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy dispatch-policies]      │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3.2 Impact Preview 自動計算

```javascript
function calculateM3Impact(params) {
  const worstCaseMinutes = params.timeout_minutes
    + (params.max_retry_count * params.retry_backoff_seconds / 60);
  return {
    worstCaseMinutes,
    throughput: params.max_concurrent_dispatches,
  };
}
```

---

### 4.4 M4 Market & Billing — Billing Rules

**AppConfig Profile:** `billing-rules`
**M8 Table:** `billing_rules`
**M8 API:** `GET/PUT /admin/billing-rules`

#### 4.4.1 佈局

```
┌─────────────────────────────────────────────────────────────┐
│  M4 Market & Billing > Billing Rules                         │
│  AppConfig Profile: billing-rules | TTL: 60min               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Org: [ORG_ENERGIA_001 ▾]                                    │
│                                                               │
│  ── Tariff Configuration ────────────────────────────────    │
│                                                               │
│  Penalty Multiplier            Effective Period               │
│  [    1.50x    ]              [Monthly           ▾]          │
│  Range: 0.1-10.0x              Monthly / Quarterly / Annual  │
│                                                               │
│  ── Cost Parameters ─────────────────────────────────────    │
│                                                               │
│  Operating Cost (BRL/kWh)                                     │
│  [   0.1250    ]                                              │
│  Range: 0.001+                                                │
│  ⚠ This value directly affects profit calculations            │
│                                                               │
│  ── Revenue Impact Preview ──────────────────────────────    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ With penalty_multiplier = 1.50x:                        │  │
│  │ • Contract violation: 150% of base tariff               │  │
│  │ • Example: R$0.82/kWh peak → R$1.23/kWh penalty        │  │
│  │                                                          │  │
│  │ With operating_cost = R$0.125/kWh:                      │  │
│  │ • Net margin: R$0.82 - R$0.25 - R$0.125 = R$0.445/kWh  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy billing-rules]          │
└─────────────────────────────────────────────────────────────┘
```

#### 4.4.2 安全警告

operating_cost_per_kwh 直接影響所有利潤計算。修改此值時顯示額外確認：

```
┌─────────────────────────────────────────────┐
│  ⚠ High-Impact Change Detected               │
│                                               │
│  Changing operating_cost_per_kwh              │
│  from R$ 0.1200 to R$ 0.1250                 │
│                                               │
│  This affects ALL assets under ORG_001.       │
│  Estimated annual impact: -R$ 12,500          │
│                                               │
│  [Proceed] [Cancel]                           │
└─────────────────────────────────────────────┘
```

---

### 4.5 M5 Frontend BFF — Feature Flags

**AppConfig Profile:** `feature-flags`
**M8 Table:** `feature_flags`
**M8 API:** `GET/POST/PUT/DELETE /admin/feature-flags`

#### 4.5.1 佈局

```
┌─────────────────────────────────────────────────────────────┐
│  M5 Frontend BFF > Feature Flags                             │
│  AppConfig Profile: feature-flags | TTL: 5min                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [All] [Enabled ●] [Disabled ○]  Search: [________]          │
│  [+ Create New Flag]                                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  show_analytics_modal                    [● ON  ]       │ │
│  │  Display analytics modal on dashboard                   │ │
│  │  Target: All tenants | Valid: 2026-02-01 ~ forever      │ │
│  │  ▸ Expand                                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  enable_dr_test_button                   [○ OFF ]       │ │
│  │  Show DR test dispatch button for operators             │ │
│  │  Target: ORG_001, ORG_002 | Valid: ~ 2026-03-01        │ │
│  │  ▸ Expand                                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  show_shadow_benchmark                   [● ON  ]       │ │
│  │  Enable Device Shadow benchmark display                 │ │
│  │  Target: SOLFACIL_ADMIN only | Valid: always            │ │
│  │  ▾ Details expanded:                                    │ │
│  │  ┌───────────────────────────────────────────────────┐  │ │
│  │  │ Flag Name:    show_shadow_benchmark                │  │ │
│  │  │ Description:  [Enable Device Shadow bench...     ] │  │ │
│  │  │ Is Enabled:   [● ON ]                              │  │ │
│  │  │ Target Orgs:  [null = All ▾]                       │  │ │
│  │  │ Valid From:   [2026-02-01T00:00 ]                  │  │ │
│  │  │ Valid Until:  [          ] (empty = forever)        │  │ │
│  │  │ [Save] [Delete]                                    │  │ │
│  │  └───────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy feature-flags]          │
└─────────────────────────────────────────────────────────────┘
```

#### 4.5.2 Toggle 交互

Toggle 開關點擊後**不會立即生效**。它只修改本地狀態。
使用者必須透過 Action Bar 的 Deploy 按鈕才能推送到 AppConfig。

---

### 4.6 M6 Identity & Tenant — RBAC Policies

**AppConfig Profile:** `rbac-policies`
**M8 Table:** `rbac_policies`
**M8 API:** 唯讀（v5.1 §0.1 標記為 "future"）

#### 4.6.1 佈局

```
┌─────────────────────────────────────────────────────────────┐
│  M6 Identity & Tenant > RBAC Policies                        │
│  AppConfig Profile: rbac-policies | TTL: 30min               │
│  ⚠ READ-ONLY — Editing not available in v1.0                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─ Permission Matrix ────────────────────────────────────┐  │
│  │                                                          │  │
│  │  Resource \ Role  │ SOLFACIL │ ORG    │ ORG     │ ORG  │  │
│  │                    │ ADMIN    │ MANAGER│ OPERATOR│VIEWER│  │
│  │  ─────────────────┼──────────┼────────┼─────────┼──────│  │
│  │  assets            │ R W D    │ R W    │ R       │ R    │  │
│  │  dispatch          │ R W D    │ R W    │ R W     │ R    │  │
│  │  billing           │ R W D    │ R      │ —       │ —    │  │
│  │  parser_rules      │ R W D    │ R W    │ R       │ —    │  │
│  │  strategies        │ R W D    │ R W    │ R       │ R    │  │
│  │  feature_flags     │ R W D    │ —      │ —       │ —    │  │
│  │  api_quotas        │ R W D    │ R W    │ R       │ —    │  │
│  │  users             │ R W D    │ R W    │ R       │ R    │  │
│  │  organizations     │ R W D    │ R      │ —       │ —    │  │
│  │                                                          │  │
│  │  Legend: R=Read  W=Write  D=Delete  —=No Access          │  │
│  │  Scope: SOLFACIL_ADMIN=all(cross-org), Others=own        │  │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  Info: RBAC editing will be available in a future release.   │
│  See SOLFACIL_BACKEND_DESIGN_v5.1.md §0.1 M6.               │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate: disabled] [Diff: disabled] [Deploy: disabled]    │
│  Read-only module — no deployment actions available           │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.7 M7 Open API — API Quotas & Webhook Policies

**AppConfig Profile:** `api-quotas`
**M8 Tables:** `api_quotas` + `webhook_policies`
**M8 API:** `GET/POST/PUT/DELETE /admin/api-quotas`

#### 4.7.1 佈局

```
┌─────────────────────────────────────────────────────────────┐
│  M7 Open API > API Quotas & Webhook Policies                 │
│  AppConfig Profile: api-quotas | TTL: 1min                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [★ API Quotas]  [Webhook Policies]                          │
│                                                               │
│  === Tab 1: API Quotas ===                                    │
│                                                               │
│  Partner ID    │ Calls/min │ Calls/day │ Burst │ Active       │
│  ──────────────┼───────────┼───────────┼───────┼────────      │
│  PARTNER_001   │    60     │  10,000   │  100  │ ● Yes        │
│  PARTNER_002   │   120     │  50,000   │  200  │ ● Yes        │
│  PARTNER_003   │    30     │   5,000   │   50  │ ○ No         │
│                                                               │
│  [+ Add Partner Quota]                                        │
│                                                               │
│  Selected: PARTNER_001                                        │
│  Calls/min: [60]  Calls/day: [10000]  Burst: [100]           │
│  Constraint: burst <= calls_per_minute × 2                    │
│                                                               │
│  === Tab 2: Webhook Policies ===                              │
│                                                               │
│  Org: [ORG_ENERGIA_001 ▾]                                    │
│                                                               │
│  Max Retry Count          Backoff Strategy                     │
│  [      3      ]          [exponential ▾]                     │
│                                                               │
│  Initial Delay (ms)       Max Delay (ms)                      │
│  [    1,000    ]          [  300,000    ]                     │
│                                                               │
│  Dead Letter Email: [alerts@energia-corp.com.br]              │
│                                                               │
│  ── Retry Timeline Preview ──────────────────────────────    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Retry 1: after 1.0s                                    │  │
│  │ Retry 2: after 2.0s  (1000 × 2^1)                     │  │
│  │ Retry 3: after 4.0s  (1000 × 2^2)                     │  │
│  │ → DLQ after 7.0s total                                 │  │
│  │ → Alert: alerts@energia-corp.com.br                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy api-quotas]             │
└─────────────────────────────────────────────────────────────┘
```

#### 4.7.2 Retry Timeline Preview

```javascript
function calculateRetryTimeline(params) {
  const timeline = [];
  let totalDelay = 0;
  for (let i = 0; i < params.max_retry_count; i++) {
    let delay;
    if (params.backoff_strategy === 'exponential') {
      delay = Math.min(params.initial_delay_ms * Math.pow(2, i), params.max_delay_ms);
    } else {
      delay = Math.min(params.initial_delay_ms * (i + 1), params.max_delay_ms);
    }
    totalDelay += delay;
    timeline.push({ retry: i + 1, delay, totalDelay });
  }
  return timeline;
}
```

---

## 5. 統一發佈流程 (Unified Deployment Flow)

### 5.1 流程總覽

所有 M1~M7 模塊的配置變更都經過相同的發佈流程：

```
┌───────────┐    ┌───────────────┐    ┌───────────┐    ┌──────────────┐
│  1. Edit  │───►│  2. Validate  │───►│ 3. Diff   │───►│ 4. Deploy    │
│  (Local)  │    │  (JSON Schema)│    │ (Preview)  │    │ (M8 API)     │
└───────────┘    └───────┬───────┘    └───────────┘    └──────┬───────┘
                         │                                     │
                    ┌────┴────┐                                │
                    │ Valid?  │                                 │
                    ├─ Yes ──►                                  │
                    └─ No: Error                                │
                                                               │
                  ┌────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ 5. AppConfig     │───►│ 6. Canary (10%) │───►│ 7. Full (100%)   │
│ Schema Validate  │    │ 10 min observe   │    │ Deployed ✓       │
└────────┬─────────┘    └────────┬─────────┘    └──────────────────┘
         │                       │
    ┌────┴────┐             ┌────┴────┐
    │ Valid?  │             │CW Alarm │
    ├─ Yes ──►│             │Error>1% │
    └─ No: Rejected         ├─ No: Continue
                            └─ Yes: Auto-Rollback
```

### 5.2 Steps Detail

**Step 1: Edit** — 使用者在模塊 UI 中修改配置，僅存在於瀏覽器記憶體

**Step 2: Validate** — 按 Ctrl+E，觸發本地 Ajv JSON Schema 驗證

```javascript
async function validateConfig(moduleId, data) {
  const schemaUrl = `schemas/${MODULE_REGISTRY[moduleId].schemaFile}`;
  const schema = await fetch(schemaUrl).then(r => r.json());
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    return { valid: false, errors: validate.errors };
  }
  return { valid: true, errors: [] };
}
```

**Step 3: Preview Diff** — 按 Ctrl+D，顯示行級差異比對

```
┌─────────────────────────────────────────────────────────────┐
│  Diff Preview — vpp-strategies (ORG_001)                     │
│                                                               │
│  Current (AppConfig)          New (Local Edit)                │
│                                                               │
│  "min_soc": 20.00,           "min_soc": 15.00,   ← CHANGED  │
│  "max_soc": 90.00,           "max_soc": 90.00,              │
│  "emergency_soc": 10.00,     "emergency_soc": 8.00, CHANGED │
│  "profit_margin": 0.05,      "profit_margin": 0.05,         │
│                               "active_hours": {    ← ADDED   │
│                                 "start": "06:00",            │
│                                 "end": "22:00"               │
│                               },                             │
│                                                               │
│  Summary: 2 changed, 1 added, 0 removed                     │
│  [Proceed to Deploy]  [Back to Editor]                       │
└─────────────────────────────────────────────────────────────┘
```

**Step 4-7: Deploy** — 按 Ctrl+Shift+Enter，觸發部署

```javascript
async function triggerDeploy(moduleId) {
  const profile = MODULE_REGISTRY[moduleId].appConfigProfile;
  const saveResult = await adminApi('PUT', `/admin/${profile}`, editedData);
  if (!saveResult.success) return showToast(`Save failed`, 'error');

  // M8 returns deploymentId, start polling
  pollDeploymentStatus(saveResult.data.deploymentId, moduleId);
}
```

### 5.3 Deployment Status Polling

每 5 秒輪詢 AppConfig 部署狀態：

```javascript
async function pollDeploymentStatus(deploymentId, moduleId) {
  const poll = setInterval(async () => {
    const status = await adminApi('GET',
      `/admin/deployments/${deploymentId}/status`);

    switch (status.data.state) {
      case 'VALIDATING':
        updateStatusBar('Validating JSON Schema...', 'yellow');
        break;
      case 'DEPLOYING':
        updateStatusBar(`Canary deploying... ${status.data.percentComplete}%`, 'yellow');
        break;
      case 'BAKED':
        updateStatusBar('Deployed successfully', 'green');
        appendAuditEntry({ action: 'DEPLOY', module: moduleId, status: 'SUCCESS' });
        clearInterval(poll);
        break;
      case 'ROLLED_BACK':
        updateStatusBar('Auto-rolled back', 'red');
        appendAuditEntry({ action: 'ROLLBACK', module: moduleId, status: 'AUTO' });
        clearInterval(poll);
        break;
    }
  }, 5000);
}
```

**Status Bar 狀態：**

| 狀態 | 顏色 | 文字 |
|------|------|------|
| VALIDATING | 黃色 | "Validating JSON Schema..." |
| DEPLOYING | 黃色脈衝 | "Canary deploying... 10%" |
| BAKED | 綠色 | "Deployed successfully" |
| ROLLED_BACK | 紅色 | "Auto-rolled back — check CloudWatch" |

### 5.4 Audit Log 自動更新

每次部署操作自動寫入右側 Audit Panel：

```
┌─ Audit Log ────────────────────────┐
│                                     │
│  16:45  DEPLOY  M2 ✓               │
│  vpp-strategies → BAKED             │
│  by: eng@solfacil.com.br           │
│  ─────────────────────────────────  │
│  16:42  EDIT  M2                    │
│  Changed: min_soc 20→15            │
│  ─────────────────────────────────  │
│  16:38  ROLLBACK  M4               │
│  billing-rules → AUTO ROLLBACK     │
│  Trigger: CW Alarm (Error>1%)      │
│  ─────────────────────────────────  │
│  16:30  LOGIN                       │
│  eng@solfacil.com.br               │
│                                     │
└─────────────────────────────────────┘
```

---

## 6. UI 設計規範 (Design System)

### 6.1 色彩系統

#### 6.1.1 深色主題基底

```css
:root {
  /* Background layers (darkest → lightest) */
  --bg-base:       #0f0f23;   /* Top bar, Status bar */
  --bg-surface:    #16162a;   /* Main editor area */
  --bg-elevated:   #1a1a2e;   /* Left nav, Audit panel, cards */
  --bg-overlay:    #1e1e3a;   /* Action bar, modals */
  --bg-input:      #252547;   /* Input fields, textareas */
  --bg-hover:      #2a2a4a;   /* Hover states */

  /* Text */
  --text-primary:  #e2e8f0;   /* Primary content */
  --text-secondary:#94a3b8;   /* Secondary, labels */
  --text-muted:    #64748b;   /* Muted, placeholders */

  /* Borders */
  --border-subtle: #2d2d5e;   /* Subtle dividers */
  --border-default:#3d3d6e;   /* Default borders */
  --border-strong: #5555a0;   /* Active, focused borders */
}
```

#### 6.1.2 狀態顏色

```css
:root {
  --status-success:    #10b981;  /* 綠 — 成功、已部署、Active */
  --status-warning:    #f59e0b;  /* 黃 — Canary 中、警告 */
  --status-error:      #ef4444;  /* 紅 — 錯誤、失敗、Rolled Back */
  --status-info:       #3b82f6;  /* 藍 — 資訊、連線中 */
  --status-neutral:    #6b7280;  /* 灰 — 未修改、Inactive */

  /* Module accent colors (for nav badges) */
  --accent-m1:  #06b6d4;  /* Cyan — IoT */
  --accent-m2:  #8b5cf6;  /* Purple — Algorithm */
  --accent-m3:  #f97316;  /* Orange — Dispatch */
  --accent-m4:  #10b981;  /* Green — Billing */
  --accent-m5:  #ec4899;  /* Pink — Feature Flags */
  --accent-m6:  #6366f1;  /* Indigo — Identity */
  --accent-m7:  #14b8a6;  /* Teal — API */
}
```

#### 6.1.3 VPP 運行模式顏色

```css
:root {
  --mode-self-consumption:   #059669;
  --mode-self-bg:            #ecfdf5;
  --mode-self-border:        #a7f3d0;

  --mode-peak-valley:        #3730a3;
  --mode-peak-valley-bg:     #eef2ff;
  --mode-peak-valley-border: #c7d2fe;

  --mode-peak-shaving:       #d97706;
  --mode-peak-shaving-bg:    #fffbeb;
  --mode-peak-shaving-border:#fde68a;
}
```

### 6.2 字體系統

```css
:root {
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  --text-xs:   0.75rem;   /* 12px */
  --text-sm:   0.875rem;  /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg:   1.125rem;  /* 18px */
  --text-xl:   1.5rem;    /* 24px */
}
```

**規則：**
- 所有配置數據、JSON 編輯器：`--font-mono`
- 導航、標題、按鈕：`--font-sans`
- Input fields 中的值：`--font-mono`

### 6.3 格柵系統 (8px Grid)

```css
:root {
  --space-1:  0.25rem;  /*  4px */
  --space-2:  0.5rem;   /*  8px — 基本單位 */
  --space-3:  0.75rem;  /* 12px */
  --space-4:  1rem;     /* 16px */
  --space-6:  1.5rem;   /* 24px */
  --space-8:  2rem;     /* 32px */
  --space-12: 3rem;     /* 48px — Top bar height */

  --radius-sm:  4px;
  --radius-md:  8px;
  --radius-lg:  12px;
}
```

### 6.4 元件規範

**Primary Button** (Deploy):
- Background: linear-gradient(135deg, #6366f1, #4f46e5)
- Text: white, semibold
- Hover: brightness(1.1), translateY(-1px)
- Disabled: opacity 0.5

**Secondary Button** (Validate, Diff):
- Background: transparent
- Border: 1px solid --border-default
- Hover: border --border-strong

**Danger Button** (Delete, Rollback):
- Border: 1px solid --status-error
- Hover: bg --status-error, text white

**Input Fields:**
- Background: --bg-input
- Border: 1px solid --border-subtle
- Font: --font-mono
- Focus: border --border-strong, blue glow

**Toggle Switch:**
- Width: 48px, Height: 24px
- OFF: --bg-input bg, --border-default border
- ON: --status-success bg
- Transition: 0.2s ease

**Toast Notifications:**
- Position: top-right, 24px from edges
- Duration: 5s auto-dismiss
- Success: green left-border
- Error: red left-border

### 6.5 快捷鍵

| 快捷鍵 | 動作 | 可用時機 |
|--------|------|----------|
| `Ctrl+E` | Validate current config | 有修改時 |
| `Ctrl+D` | Preview Diff | 驗證通過後 |
| `Ctrl+Shift+Enter` | Deploy to AppConfig | 驗證通過後 |
| `Ctrl+S` | Save draft to localStorage | 隨時 |
| `Ctrl+Z` | Undo last edit | 編輯中 |
| `Escape` | Close modal | 彈窗開啟時 |
| `1`~`7` | Switch to M1~M7 | 無焦點在 input |
| `Ctrl+[` | Toggle Audit Panel | 隨時 |

---

## 7. 里程碑計劃 (Milestones)

### 7.1 Phase Overview

```
Phase 1              Phase 2              Phase 3              Phase 4
骨架 + 靜態展示      M2 批量模式          全模塊接通            真實 API + Cognito
────────────────    ────────────────    ────────────────    ────────────────
 admin.html          Batch Ops UI         M1 JSON Editor       M8 REST API
 admin.css           Site Cards           M3 Dispatch Form     Cognito Guard
 admin.js scaffold   Mode Selection       M4 Billing Form      AppConfig Deploy
 Left Nav            Confirm Modal        M5 Feature Flags     Polling
 3-column layout     Progress Modal       M6 RBAC Matrix       Audit Log (real)
 Mock data           Simulate dispatch    M7 API Quotas        Error handling
```

### 7.2 Phase 1: 骨架 + 靜態展示

**產出物：**
- admin.html — HTML 結構
- admin.css — 深色主題
- admin.js — Constants + Navigation + Init

**驗收條件：**
- [ ] 完整三欄佈局
- [ ] M1~M7 七個 Tab 可切換
- [ ] 深色主題正確
- [ ] 響應式行為正常

### 7.3 Phase 2: M2 批量模式（最高優先）

**產出物：**
- 策略參數表單 + SoC Visual Gauge
- 批量操作工具欄 + Site Cards
- 確認/進度/結果彈窗

**驗收條件：**
- [ ] 策略參數表單功能正常
- [ ] SoC Gauge 即時反映
- [ ] 批量操作完整流程
- [ ] 90% 成功 / 10% 隨機失敗
- [ ] 失敗後可重試
- [ ] 模式標籤即時更新

### 7.4 Phase 3: 全模塊接通

**產出物：**
- M1/M3/M4/M5/M6/M7 渲染器
- 7 個 JSON Schema 檔案
- 統一發佈流程（模擬）

**驗收條件：**
- [ ] M1: JSON Editor 可編輯
- [ ] M3: Dispatch 表單 + Impact Preview
- [ ] M4: Billing 表單 + Revenue Impact
- [ ] M5: Feature flags toggle list
- [ ] M6: RBAC 唯讀矩陣
- [ ] M7: API quotas + Webhook timeline
- [ ] Validate → Diff → Deploy mock

### 7.5 Phase 4: 真實 M8 API + Cognito 串接

**產出物：**
- Auth & Route Guard（真實 Cognito JWT）
- API Client（串接 M8 REST API）
- AppConfig deployment polling
- Audit Log（後端載入）

**驗收條件：**
- [ ] 非 ADMIN 看到 403
- [ ] 配置持久化到 PostgreSQL
- [ ] AppConfig 部署狀態即時反映
- [ ] Auto-rollback 紅色警告
- [ ] Audit Log 記錄所有操作
- [ ] 全 7 模塊 CRUD 正常

### 7.6 依賴關係

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
(無依賴)    (Phase 1)    (Phase 2)    (Phase 3 + M8 Backend)
```

Phase 4 需要後端提供：M8 REST API 端點、AppConfig Profiles、Cognito group、Deployment status API。

### 7.7 預估工程量

| Phase | 新增代碼量 | 重點 |
|-------|-----------|------|
| Phase 1 | HTML ~200, CSS ~600, JS ~300 | 佈局、主題 |
| Phase 2 | JS ~400, CSS ~300 | M2 + Batch Ops |
| Phase 3 | JS ~500, JSON ~700 | 其餘模塊 |
| Phase 4 | JS ~400 | Auth + API + Deploy |
| **Total** | **~3400 行** | admin.html + admin.js + admin.css + schemas |

---

## Appendix A: Module Registry

```javascript
const MODULE_REGISTRY = {
  m1: {
    id: 'm1', name: 'IoT Hub', subtitle: 'Parser Rules',
    icon: 'sensors', accent: '#06b6d4',
    appConfigProfile: 'parser-rules', m8Table: 'device_parser_rules',
    apiPath: '/admin/parsers', schemaFile: 'parser-rules.schema.json',
    cacheTTL: '5 min', editable: true, renderer: 'renderM1ParserRules',
  },
  m2: {
    id: 'm2', name: 'Algorithm Engine', subtitle: 'VPP Strategies',
    icon: 'psychology', accent: '#8b5cf6',
    appConfigProfile: 'vpp-strategies', m8Table: 'vpp_strategies',
    apiPath: '/admin/strategies', schemaFile: 'vpp-strategies.schema.json',
    cacheTTL: '1 min', editable: true, renderer: 'renderM2VppStrategies',
    hasBatchOps: true,
  },
  m3: {
    id: 'm3', name: 'DR Dispatcher', subtitle: 'Dispatch Policies',
    icon: 'send', accent: '#f97316',
    appConfigProfile: 'dispatch-policies', m8Table: 'dispatch_policies',
    apiPath: '/admin/dispatch-policies', schemaFile: 'dispatch-policies.schema.json',
    cacheTTL: '10 min', editable: true, renderer: 'renderM3DispatchPolicies',
  },
  m4: {
    id: 'm4', name: 'Market & Billing', subtitle: 'Billing Rules',
    icon: 'payments', accent: '#10b981',
    appConfigProfile: 'billing-rules', m8Table: 'billing_rules',
    apiPath: '/admin/billing-rules', schemaFile: 'billing-rules.schema.json',
    cacheTTL: '60 min', editable: true, renderer: 'renderM4BillingRules',
  },
  m5: {
    id: 'm5', name: 'Frontend BFF', subtitle: 'Feature Flags',
    icon: 'flag', accent: '#ec4899',
    appConfigProfile: 'feature-flags', m8Table: 'feature_flags',
    apiPath: '/admin/feature-flags', schemaFile: 'feature-flags.schema.json',
    cacheTTL: '5 min', editable: true, renderer: 'renderM5FeatureFlags',
  },
  m6: {
    id: 'm6', name: 'Identity & Tenant', subtitle: 'RBAC Policies',
    icon: 'admin_panel_settings', accent: '#6366f1',
    appConfigProfile: 'rbac-policies', m8Table: 'rbac_policies',
    apiPath: '/admin/rbac-policies', schemaFile: 'rbac-policies.schema.json',
    cacheTTL: '30 min', editable: false, renderer: 'renderM6RbacPolicies',
  },
  m7: {
    id: 'm7', name: 'Open API', subtitle: 'API Quotas',
    icon: 'api', accent: '#14b8a6',
    appConfigProfile: 'api-quotas', m8Table: 'api_quotas',
    apiPath: '/admin/api-quotas', schemaFile: 'api-quotas.schema.json',
    cacheTTL: '1 min', editable: true, renderer: 'renderM7ApiQuotas',
  },
};
```

---

## Appendix B: API Client

```javascript
const API_BASE_URL = '/api/v1';

async function adminApi(method, path, body = null) {
  const token = localStorage.getItem('vpp_admin_token');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  const options = { method, headers };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (response.status === 401) {
    localStorage.removeItem('vpp_admin_token');
    return redirectToLogin();
  }
  if (response.status === 403) {
    showToast('Permission denied. SOLFACIL_GLOBAL_ADMIN required.', 'error');
    return { success: false, error: 'FORBIDDEN' };
  }
  const data = await response.json();
  if (!response.ok) {
    showToast(`API Error: ${data.error || response.statusText}`, 'error');
    return { success: false, error: data.error };
  }
  return data;
}
```

---

## Appendix C: Deployment State Machine

```
                              ┌──────────┐
                              │   IDLE   │
                              └────┬─────┘
                                   │ Deploy clicked
                                   ▼
                              ┌──────────┐
                     ┌───────│  SAVING  │
                     │        └────┬─────┘
                  Error            │ 200 OK
                     │             ▼
                     │        ┌──────────────┐
                     │        │ VALIDATING   │
                     │        └────┬────┬────┘
                     │          Valid  Invalid
                     │             │    │
                     │             ▼    ▼
                     │       ┌────────┐ ┌──────────┐
                     │       │DEPLOYING│ │REJECTED  │
                     │       └────┬───┘ └──────────┘
                     │            │
                     │       Canary 10% → 10min → 90%
                     │            │
                     │       ┌────┴────────┐
                     │  CW OK│             │CW Alarm
                     │       ▼             ▼
                     │  ┌────────┐   ┌─────────────┐
                     └─►│ BAKED  │   │ ROLLED_BACK │
                        └────────┘   └─────────────┘
```

---

*This document is the Single Source of Truth for the SOLFACIL VPP Control Plane UI design.*
*All implementation work should reference this document.*

*— End of Document —*
