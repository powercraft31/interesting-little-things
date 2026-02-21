# SOLFACIL VPP — Control Plane UI 设计文件

> **Version:** 1.0 | **Date:** 2026-02-21
> **Author:** 前端架构团队
> **Status:** DRAFT — 待审阅
> **Depends on:** `SOLFACIL_BACKEND_DESIGN_v5.1.md` (§0 架构法则, §20 Module 8)
> **Integrates:** `VPP批量模式更改功能设计方案.md` (Batch Ops → §4.2 M2 UI)

---

## 文件历史

| 版本 | 日期 | 摘要 |
|------|------|------|
| **v1.0** | 2026-02-21 | 初版。完整定义 Control Plane Admin UI：产品定位、技术选型、全局布局、M1~M7 七大模块 UI 交互设计、统一发布流程、设计规范、里程碑计划。整合批量模式更改方案至 M2 UI。 |

---

## 目录

1. [§1 产品定位 (Product Vision)](#1-产品定位-product-vision)
2. [§2 技术选型与目录架构 (Tech Stack)](#2-技术选型与目录架构-tech-stack)
3. [§3 全局布局 (Layout)](#3-全局布局-layout)
4. [§4 核心模块 UI 交互设计](#4-核心模块-ui-交互设计)
   - 4.1 [M1 IoT Hub — Parser Rules Editor](#41-m1-iot-hub--parser-rules-editor)
   - 4.2 [M2 Algorithm Engine — VPP Strategies + Batch Ops](#42-m2-algorithm-engine--vpp-strategies--batch-ops)
   - 4.3 [M3 DR Dispatcher — Dispatch Policies](#43-m3-dr-dispatcher--dispatch-policies)
   - 4.4 [M4 Market & Billing — Billing Rules](#44-m4-market--billing--billing-rules)
   - 4.5 [M5 Frontend BFF — Feature Flags](#45-m5-frontend-bff--feature-flags)
   - 4.6 [M6 Identity & Tenant — RBAC Policies](#46-m6-identity--tenant--rbac-policies)
   - 4.7 [M7 Open API — API Quotas & Webhook Policies](#47-m7-open-api--api-quotas--webhook-policies)
5. [§5 统一发布流程 (Unified Deployment Flow)](#5-统一发布流程-unified-deployment-flow)
6. [§6 UI 设计规范 (Design System)](#6-ui-设计规范-design-system)
7. [§7 里程碑计划 (Milestones)](#7-里程碑计划-milestones)

---

## 1. 产品定位 (Product Vision)

### 1.1 定位声明

SOLFACIL VPP Control Plane UI 是一个**纯内部运营工具**，用于可视化并控制 v5.1 后端架构中 M1~M7 全部七个 Data Plane 模块的动态配置。

它是 M8 Admin Control Plane（v5.1 §20）的**唯一人机界面**，实现 v5.0 Grand Fusion Architecture 的「No-Code Operations」愿景：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Control Plane UI（本文件）                     │
│                     admin.html / admin.js / admin.css            │
│                                                                   │
│  运营人员在此修改配置 → 本地 JSON Schema 验证 → 预览 Diff          │
│  → 调用 M8 REST API → AppConfig Canary 部署 → M1-M7 自动生效    │
└───────────────────────────────┬───────────────────────────────────┘
                                │ REST API (Bearer JWT)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              M8 Admin Control Plane（后端）                        │
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
│              Data Plane（M1~M7 Lambda Functions）                  │
│              http://localhost:2772 读取配置，零延迟               │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 目标用户

| 角色 | Cognito Group | 使用场景 | 权限层级 |
|------|--------------|----------|----------|
| **平台工程师** | `SOLFACIL_GLOBAL_ADMIN` | 全模块配置管理、Feature Flag 控制、RBAC 矩阵审查 | 完全访问 |
| **Tier 2 技术支持** | `SOLFACIL_GLOBAL_ADMIN` | 协助客户调整 VPP 策略、排查 Parser 规则、调整 Dispatch 超时 | 完全访问 |
| **Tier 3 高级工程师** | `SOLFACIL_GLOBAL_ADMIN` | 紧急配置回滚、API Quota 调整、计费规则修正 | 完全访问 |

> **访问控制规则：** 本 Admin UI **仅限** `SOLFACIL_GLOBAL_ADMIN` 用户组成员访问。
> 任何非此用户组的 JWT Token 在前端 Route Guard 即被拦截，不会到达 M8 API。

### 1.3 设计哲学

| 原则 | 说明 | 体现方式 |
|------|------|----------|
| **High Density** | 单一屏幕展示最大信息量，减少页面跳转 | 三栏布局：导航 + 编辑区 + 审计日志 |
| **High Efficiency** | 3 步完成任意配置修改（选模块 → 编辑 → 发布） | 统一发布流程，快捷键支持 |
| **Zero-Friction** | 不需要额外培训即可使用 | 表单验证即时反馈、JSON Schema 提示、Diff 预览 |
| **Safety First** | 错误配置不会到达生产环境 | 本地 Schema 验证 → AppConfig Schema 验证 → Canary 部署 |
| **Dark Theme** | 降低长时间使用的视觉疲劳 | 深色背景 + 高对比度状态颜色 |

### 1.4 与现有前端的关系

```
现有 Frontend（面向客户）          Admin UI（内部运营）
┌──────────────────────┐        ┌──────────────────────┐
│ index.html           │        │ admin.html           │ ← 本文件设计
│ app.js               │        │ admin.js             │
│ style.css            │        │ admin.css            │
│                      │        │                      │
│ 对象：所有租户用户    │        │ 对象：SOLFACIL 内部  │
│ 功能：Dashboard/报表  │        │ 功能：M1-M7 配置管理 │
│ 认证：任何有效 JWT    │        │ 认证：GLOBAL_ADMIN   │
│ API：M5 BFF          │        │ API：M8 Admin API    │
└──────────────────────┘        └──────────────────────┘
         ↑ 不共用任何代码 ↑              ↑ 完全独立 ↑
```

**完全独立**：admin.html 不引用 app.js、style.css，也不共用 DOM 结构。
两者共用的唯一基础设施是 Cognito User Pool（认证）和 API Gateway（不同路由）。

---

## 2. 技术选型与目录架构 (Tech Stack)

### 2.1 技术选型决策

| 维度 | 选择 | 理由 |
|------|------|------|
| **框架** | Vanilla JS（原生） | 与现有 app.js 保持架构一致性；Admin UI 为内部工具，无需 React/Vue 的生态复杂度 |
| **CSS** | 原生 CSS + CSS Custom Properties | 深色主题通过 CSS Variables 统一管理；无需 Tailwind/Sass 构建步骤 |
| **HTTP Client** | fetch() API | 浏览器原生支持，搭配统一的 adminApi() 封装 |
| **JSON Editor** | textarea + 语法高亮（手动） | M1 Parser Rules 需要全屏 JSON 编辑；不引入外部 JSON Editor 库 |
| **Schema 验证** | Ajv（CDN 引入） | 与 AppConfig 使用相同的 JSON Schema draft-07；本地验证提供即时反馈 |
| **Diff 预览** | 自制简易 Diff（行级比对） | 发布前显示变更差异；不引入 diff2html 等重型库 |
| **图标** | Material Icons（CDN） | 与现有 Dashboard 一致 |
| **字体** | JetBrains Mono（CDN） | Monospace 字体，适合配置数据展示 |

### 2.2 外部依赖（仅 CDN）

```html
<!-- admin.html <head> 区块 -->

<!-- Material Icons（与现有 Dashboard 共用） -->
<link href="https://fonts.googleapis.com/icon?family=Material+Icons"
      rel="stylesheet">

<!-- JetBrains Mono（Monospace 字体） -->
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
      rel="stylesheet">

<!-- Ajv JSON Schema Validator（v8, draft-07 兼容） -->
<script src="https://cdn.jsdelivr.net/npm/ajv@8/dist/ajv.bundle.min.js"></script>
```

**零构建步骤**：所有依赖通过 CDN 加载，开发人员可直接用浏览器打开 admin.html。

### 2.3 目录架构

```
SOLFACIL_VPP_Demo/
├── index.html              # 客户 Dashboard（现有，不修改）
├── app.js                  # Dashboard 逻辑（现有，不修改）
├── style.css               # Dashboard 样式（现有，不修改）
│
├── admin.html              # ★ Admin Control Plane UI（新增）
├── admin.js                # ★ Admin 业务逻辑（新增，预估 ~2000 行）
├── admin.css               # ★ Admin 深色主题样式（新增，预估 ~1200 行）
│
├── schemas/                # ★ JSON Schema 验证文件（新增目录）
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

### 2.4 admin.js 模块结构

```
================================================================
admin.js — SOLFACIL VPP Control Plane UI
模块结构总览（按定义顺序）
================================================================

SECTION 0: Constants & Configuration (~80 行)
 - API_BASE_URL, APPCONFIG_POLL_INTERVAL
 - MODULE_REGISTRY: M1~M7 模块元数据
 - DEPLOYMENT_STATUS_MAP: 部署状态映射
 - JSON_SCHEMAS: 各模块 Schema 引用

SECTION 1: Auth & Route Guard (~120 行)
 - parseJwt(): 解析 JWT Token
 - checkAdminAccess(): 验证 SOLFACIL_GLOBAL_ADMIN
 - redirectToLogin(): 未授权时重定向
 - initAuth(): DOMContentLoaded 时执行

SECTION 2: API Client (~150 行)
 - adminApi(method, path, body): 统一 HTTP 封装
 - handleApiError(response): 错误处理
 - loadModuleConfig(module): 加载指定模块配置
 - saveModuleConfig(module, data): 保存配置
 - deployConfig(module): 触发 AppConfig 部署
 - getDeploymentStatus(deploymentId): 查询部署状态

SECTION 3: Navigation & Layout (~100 行)
 - initNavigation(): 左侧导航初始化
 - switchModule(moduleId): 切换模块视图
 - renderBreadcrumb(module): 更新面包屑
 - toggleAuditPanel(): 展开/收起右侧审计面板

SECTION 4: Module Renderers (~800 行，核心)
 - renderM1ParserRules(data): JSON Textarea 编辑器
 - renderM2VppStrategies(data): 策略表单 + 批量模式
 - renderM3DispatchPolicies(data): Timeout/Retry 表单
 - renderM4BillingRules(data): 惩罚倍率表单
 - renderM5FeatureFlags(data): Feature Flag Toggle 列表
 - renderM6RbacPolicies(data): 只读权限矩阵
 - renderM7ApiQuotas(data): Webhook Timeout 表单

SECTION 5: Batch Operations（M2 专属，~300 行）
 - initBatchToolbar(): 批量操作工具栏
 - batchState: 选中状态管理
 - executeBatchDispatch(): 批量下发流程
 - simulateAssetModeChange(): 模拟模式切换
 （整合自 VPP批量模式更改功能设计方案.md）

SECTION 6: Unified Deployment Flow (~200 行)
 - validateConfig(module, data): JSON Schema 本地验证
 - showDiffPreview(oldData, newData): Diff 预览
 - triggerDeploy(module): 调用 M8 API + 轮询状态
 - pollDeploymentStatus(deploymentId): 每 5 秒轮询
 - showDeploymentResult(status): 结果展示

SECTION 7: Audit Log Panel (~100 行)
 - loadAuditLog(): 加载操作日志
 - appendAuditEntry(entry): 新增日志条目
 - renderAuditTimeline(): 时间轴渲染

SECTION 8: Utilities (~150 行)
 - formatTimestamp(iso): 时间格式化
 - deepClone(obj): 深拷贝
 - jsonDiff(a, b): 简易行级 Diff
 - debounce(fn, ms): 防抖
 - showToast(message, type): 通知提示
 - showModal(content): Modal 管理

SECTION 9: Initialization (~50 行)
 - document.addEventListener('DOMContentLoaded', init)
 - init(): 认证 → 导航 → 加载默认模块
```

### 2.5 M6 Cognito Route Guard 设计

Admin UI 的访问控制在**前端 Route Guard + 后端 RBAC Middleware** 双层实施：

```
用户打开 admin.html
        │
        ▼
  ┌──────────────┐
  │ localStorage  │──── 有 JWT Token? ────► 否 ──► 重定向 Cognito Login
  │ 读取 JWT     │                                   │
  └──────┬───────┘                                   │
         │ 是                                        │
         ▼                                           │
  ┌──────────────────────────────┐                   │
  │ 解析 JWT Claims              │                   │
  │ custom:group 字段            │                   │
  └──────┬───────────────────────┘                   │
         │                                           │
         ▼                                           │
  custom:group 包含                                   │
  'SOLFACIL_GLOBAL_ADMIN'?                            │
         │                                           │
    ┌────┴────┐                                      │
    │ 是      │ 否                                   │
    ▼         ▼                                      │
  加载 UI   显示 403 页面 ◄──────────────────────────┘
             「您没有 Admin 权限」
```

**前端 Route Guard 伪代码：**

```javascript
function checkAdminAccess() {
  const token = localStorage.getItem('vpp_admin_token');
  if (!token) return redirectToLogin();

  const claims = parseJwt(token);

  // 检查 Token 是否过期
  if (claims.exp * 1000 < Date.now()) {
    localStorage.removeItem('vpp_admin_token');
    return redirectToLogin();
  }

  // 检查是否为 GLOBAL_ADMIN
  if (claims['custom:group'] !== 'SOLFACIL_GLOBAL_ADMIN') {
    return showForbiddenPage();
  }

  // 通过 — 初始化 UI
  return initAdminUI(claims);
}
```

> **注意：** 前端 Route Guard 仅为 UX 层面的防护。
> 真正的安全性由 M8 REST API 的 Cognito Authorizer + RBAC Middleware 保障。

---

## 3. 全局布局 (Layout)

### 3.1 三栏式布局架构

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ┌─ Top Bar (48px) ──────────────────────────────────────────────────────┐ │
│  │  ☰ SOLFACIL Control Plane    [env: PROD ▾]    eng@solfacil     [⚙]  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ Left Nav ─┐  ┌─ Main Editor Area ──────────────────┐  ┌─ Audit ────┐ │
│  │ (240px)    │  │ (flex: 1, min 600px)                 │  │ (320px)    │ │
│  │            │  │                                       │  │            │ │
│  │ ┌────────┐ │  │ ┌─ Breadcrumb ─────────────────────┐ │  │ 操作       │ │
│  │ │ M1 IoT │ │  │ │ M2 > VPP Strategies > ORG_001   │ │  │ 审计日志   │ │
│  │ │ Hub    │ │  │ └───────────────────────────────────┘ │  │            │ │
│  │ ├────────┤ │  │                                       │  │ ┌────────┐ │ │
│  │ │★M2 Alg│ │  │ ┌─ Module Content ─────────────────┐ │  │ │ 16:23  │ │ │
│  │ │ Engine │ │  │ │                                   │ │  │ │ Deploy │ │ │
│  │ ├────────┤ │  │ │  （模块特定 UI 在此渲染 —          │ │  │ │ M2 ✓  │ │ │
│  │ │ M3 DR  │ │  │ │   表单、JSON 编辑器、             │ │  │ ├────────┤ │ │
│  │ │Dispatch│ │  │ │   表格、Toggle 等）                │ │  │ │ 16:21  │ │ │
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

### 3.2 布局尺寸规范

| 区域 | 宽度 | 高度 | 背景色 | 说明 |
|------|------|------|--------|------|
| **Top Bar** | 100% | 48px | `#0f0f23` | Logo + 环境选择器 + 用户信息 |
| **Left Nav** | 240px（固定） | calc(100vh - 48px) | `#1a1a2e` | M1~M7 模块导航 + 系统功能 |
| **Main Editor** | flex: 1 (min 600px) | calc(100vh - 48px) | `#16162a` | 模块配置编辑区 |
| **Audit Panel** | 320px（可收起） | calc(100vh - 48px) | `#1a1a2e` | 操作审计时间轴 |
| **Action Bar** | 100%（Editor 内） | 56px | `#1e1e3a` | 验证/预览/发布按钮 |
| **Status Bar** | 100%（Editor 内） | 32px | `#0f0f23` | AppConfig 部署状态 |

### 3.3 Left Nav 详细结构

左侧导航直接映射 v5.1 Grand Fusion Matrix（§0.1），每个 Tab 对应一个 AppConfig Configuration Profile：

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

**导航与 Grand Fusion Matrix 的对应关系：**

| 导航项 | AppConfig Profile | M8 PostgreSQL Table | Cache TTL | 消费模块 |
|--------|-------------------|---------------------|-----------|----------|
| M1 IoT Hub | `parser-rules` | `device_parser_rules` | 5 min | M1 Lambda |
| M2 Algorithm | `vpp-strategies` | `vpp_strategies` | 1 min | M2 Lambda |
| M3 DR Dispatcher | `dispatch-policies` | `dispatch_policies` | 10 min | M3 Lambda |
| M4 Market & Billing | `billing-rules` | `billing_rules` | 60 min | M4 Lambda |
| M5 BFF | `feature-flags` | `feature_flags` | 5 min | M5 Middleware |
| M6 Identity | `rbac-policies` | `rbac_policies` | 30 min | M6 Cognito Lambda |
| M7 Open API | `api-quotas` | `api_quotas` | 1 min | M7 Authorizer |

### 3.4 响应式行为

| 屏幕宽度 | 布局调整 |
|----------|----------|
| >= 1440px | 三栏完整展示（Left Nav + Editor + Audit） |
| 1200-1439px | Audit Panel 默认收起，点击展开覆盖 |
| 1024-1199px | Left Nav 收起为仅图标模式（60px），Audit Panel 收起 |
| < 1024px | 不支持。显示「请使用桌面浏览器」提示 |

> **设计决策：** Admin UI 是内部运营工具，目标用户均使用桌面环境。
> 不投入移动设备适配的工程资源。

### 3.5 Top Bar 设计

```
┌────────────────────────────────────────────────────────────────────────┐
│  ☰  ⚡ SOLFACIL Control Plane          [ENV: PROD ▾]  User Info   ⚙   │
└────────────────────────────────────────────────────────────────────────┘
  │                                         │             │        │
  │  Hamburger: 展开/收起 Left Nav           │             │        └─ Settings
  │                                         │             └─ 用户: Email + 退出登录
  │                                         └─ 环境选择器
  │                                            DEV (green) / STG (yellow) / PRD (red)
```

### 3.6 Action Bar 设计

```
┌────────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────────────┐  │
│  │ Validate │   │ Preview Diff │   │  Deploy to AppConfig          │  │
│  │ (Ctrl+E) │   │ (Ctrl+D)     │   │  (Ctrl+Shift+Enter)          │  │
│  └──────────┘   └──────────────┘   └──────────────────────────────┘  │
│                                                                        │
│  状态指示：                                                            │
│  ● 未修改 (No changes)           ● 验证通过 (Validated)               │
│  ● 已修改未验证 (Modified)        ● 部署中 (Deploying... Canary 10%)  │
│  ● 验证失败 (Errors: 3)          ● 部署完成 (Deployed)               │
└────────────────────────────────────────────────────────────────────────┘
```

**按钮状态机：**

```
[页面加载] → 所有按钮 disabled
      │
      ▼ 用户修改配置
[Modified] → Validate: enabled
      │
      ▼ 点击 Validate
[Valid?]
  ├─ Yes → Diff: enabled, Deploy: enabled
  └─ No  → 显示错误，Deploy: disabled
      │
      ▼ 点击 Deploy
[Deploying] → 所有按钮 disabled, 显示进度
      │
      ├─ Success → Toast 通知, Audit Log 更新
      └─ Failure → 显示错误, 提供 Rollback 按钮
```

---

## 4. 核心模块 UI 交互设计

本章逐一描述 M1~M7 每个模块在 Main Editor Area 中的 UI 设计。
每个模块 UI 遵循统一的三段结构：**Header（模块信息）→ Body（编辑区）→ Action Bar（操作）**。

### 4.1 M1 IoT Hub — Parser Rules Editor

**AppConfig Profile:** `parser-rules`
**M8 Table:** `device_parser_rules`
**M8 API:** `GET/POST/PUT/DELETE /admin/parsers`

#### 4.1.1 设计理念

M1 的 `field_mapping` 和 `unit_conversions` 是深度嵌套的 JSONB 结构，无法用简单表单表达。
因此采用**全屏 JSON Textarea 编辑器**，搭配即时 Schema 验证和语法错误提示。

#### 4.1.2 布局

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

#### 4.1.3 交互流程

1. **选择 Organization** — 下拉选单加载该 org 的所有 parser rules
2. **选择 Rule** — 左侧列表选中某条规则，右侧加载其 JSON
3. **编辑 JSON** — Textarea 中直接编辑 field_mapping 或 unit_conversions
4. **即时验证** — 每次输入暂停 500ms 后自动触发 JSON 格式检查 + Schema 验证
5. **Tab 切换** — field_mapping / unit_conversions / Raw JSON 三种视图
6. **保存 → 部署** — 点击 Deploy 后走统一发布流程（§5）

#### 4.1.4 JSON Schema 验证规则

依据 v5.1 §0.2 定义的 Schema 约束：

| 字段 | 约束 | 验证错误提示 |
|------|------|-------------|
| `field_mapping` | 必须是 object | "field_mapping must be a JSON object" |
| `unit_conversions.*.factor` | minimum: 0.0001 | "Conversion factor must be positive (min 0.0001)" |
| `manufacturer` | enum: 已知厂商列表 | "Unknown manufacturer. Known: huawei, sungrow, generic" |

---

### 4.2 M2 Algorithm Engine — VPP Strategies + Batch Ops

**AppConfig Profile:** `vpp-strategies`
**M8 Table:** `vpp_strategies`
**M8 API:** `GET/POST/PUT/DELETE /admin/strategies`

> **本章节为最高优先级**，整合了 `VPP批量模式更改功能设计方案.md` 的完整设计。

#### 4.2.1 设计理念

M2 是整个 VPP 系统的「决策大脑」。其配置直接影响套利决策和收益。
UI 设计分为两个区域：

- **上半部分：策略参数表单** — 管理 per-org 的 SoC 阈值、profit margin 等
- **下半部分：批量模式操作（Batch Ops）** — 对多站点同时下发运行模式变更

#### 4.2.2 策略参数表单布局

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

  红色区域: 0% ~ emergency_soc  （紧急保留区）
  橙色区域: emergency_soc ~ min_soc  （低电量警告区）
  绿色区域: min_soc ~ max_soc  （正常操作区）
  灰色区域: max_soc ~ 100%  （过充保护区）
```

**Schema 验证（v5.1 §0.2）：**
- min_soc: 10-50, max_soc: 70-100, emergency_soc: 5-20
- 约束：emergency_soc < min_soc < max_soc
- 违反时即时显示红色边框 + 错误信息

#### 4.2.4 批量模式操作 (Batch Ops)

> 完整整合自 `VPP批量模式更改功能设计方案.md`

批量模式操作允许运营人员同时对多个站点下发运行模式变更指令。
此功能嵌入在 M2 页面的下半部分。

**三种运行模式定义：**

| 模式 | Key | Icon | 颜色 | 策略逻辑 |
|------|-----|------|------|----------|
| **自发自用** | `self_consumption` | `home` | `#059669`（绿） | 储能优先供给本地负载，余电上网 |
| **峰谷套利** | `peak_valley_arbitrage` | `swap_vert` | `#3730a3`（蓝） | 谷时满充，峰时全放，最大化价差收益 |
| **削峰模式** | `peak_shaving` | `compress` | `#d97706`（橙） | 限制峰值功率，避免需量电费罚款 |

**批量操作区布局：**

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

#### 4.2.5 批量下发流程

**确认弹窗：**

```
┌─────────────────────────────────────────────────┐
│  确认批量模式变更                                  │
│                                                   │
│  您即将为以下站点变更运行模式：                      │
│                                                   │
│  Sao Paulo - Casa Verde                           │
│     峰谷套利 → 自发自用                              │
│  Curitiba - Batel                                 │
│     削峰模式 → 自发自用                              │
│                                                   │
│  ⚠ 模式变更将在下一个调度周期生效                     │
│  影响范围: 2 个站点 / 1,231 台设备                   │
│  （1 个站点已处于目标模式 — 已跳过）                  │
│                                                   │
│  [确认下发]  [取消]                                 │
└─────────────────────────────────────────────────┘
```

**执行进度弹窗：**

```
┌─────────────────────────────────────────────────┐
│  批量模式下发中...                                 │
│                                                   │
│  总进度: ████████████░░░░ 1/2                     │
│                                                   │
│  ✅ Sao Paulo          → 自发自用  完成             │
│     948 台设备已切换                                │
│                                                   │
│  ⏳ Curitiba           → 自发自用  65%              │
│     ░░░░░░░░░░░░░░ 65%                            │
│                                                   │
│  [关闭]（完成后可用）                                │
│  [重试失败项]（有失败时显示）                         │
└─────────────────────────────────────────────────┘
```

#### 4.2.6 批量操作状态管理

```javascript
const batchState = {
  selectedAssets: new Set(),   // 选中的资产 ID
  targetMode: null,            // 'self_consumption' | 'peak_valley_arbitrage' | 'peak_shaving'
  isDispatching: false,        // 是否正在下发
  dispatchResults: [],         // { assetId, success, error, fromMode, toMode }
};
```

**状态流转：**

```
[Idle] ──选择资产──► [Has Selection]
                                │
                          选择模式
                                │
                                ▼
                          [Ready to Dispatch]
                                │
                          点击 Dispatch
                                │
                                ▼
                          [Confirm Modal]
                             ┌──┴──┐
                        确认   取消
                             │      └──► [Has Selection]
                             ▼
                       [Dispatching]
                          ┌──┴──┐
                    全部成功    部分失败
                       │           │
                       ▼           ▼
                  [Complete]  [Complete + Retry]
                       │           │
                       └─── 重置 ──┘──► [Idle]
```

#### 4.2.7 与后端的对接（M8 API）

```
Admin UI（批量下发）
    │
    ▼ PUT /admin/strategies/:id/batch-mode
    │ Body: { assetIds: [...], targetMode: 'self_consumption' }
    │
M8 Admin Lambda
    │
    ├─ 1. 验证 targetMode 合法性
    ├─ 2. 更新 vpp_strategies 表
    ├─ 3. 调用 AppConfig StartDeployment
    ├─ 4. 发布 EventBridge: ConfigUpdated { module: 'M2' }
    └─ 5. 返回 { deploymentId, status: 'IN_PROGRESS' }
           │
           ▼
M2 Lambda Extension（45 秒内拉取新配置）
    │
    ▼ 下次 optimization cycle 使用新策略
```

---

### 4.3 M3 DR Dispatcher — Dispatch Policies

**AppConfig Profile:** `dispatch-policies`
**M8 Table:** `dispatch_policies`
**M8 API:** `GET/PUT /admin/dispatch-policies`

#### 4.3.1 布局

```
┌─────────────────────────────────────────────────────────────┐
│  M3 DR Dispatcher > Dispatch Policies                        │
│  AppConfig Profile: dispatch-policies | TTL: 10min           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Org: [ORG_ENERGIA_001 ▾]                                    │
│                                                               │
│  ── 重试配置 ──────────────────────────────────────────     │
│                                                               │
│  最大重试次数                    重试退避间隔（秒）              │
│  [      3      ]              [      60     ]                 │
│  范围: 1-5                    范围: 10-300                    │
│                                                               │
│  ── 并发与超时 ─────────────────────────────────────────     │
│                                                               │
│  最大并发下发数                  超时时间（分钟）                │
│  [      10     ]              [      15     ]                 │
│  范围: 1-50                   范围: 5-60                      │
│                                                               │
│  ── 影响预览 ────────────────────────────────────────────    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 当前配置下：                                            │  │
│  │ • 最多 10 台设备同时下发                                 │  │
│  │ • 失败命令最多重试 3 次，间隔 60 秒                       │  │
│  │ • 命令在 15 分钟后超时                                   │  │
│  │ • 最坏情况单次下发耗时：18 分钟                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy dispatch-policies]      │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3.2 影响预览自动计算

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

#### 4.4.1 布局

```
┌─────────────────────────────────────────────────────────────┐
│  M4 Market & Billing > Billing Rules                         │
│  AppConfig Profile: billing-rules | TTL: 60min               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Org: [ORG_ENERGIA_001 ▾]                                    │
│                                                               │
│  ── 电价配置 ────────────────────────────────────────────    │
│                                                               │
│  惩罚倍率                        生效周期                      │
│  [    1.50x    ]              [月度           ▾]              │
│  范围: 0.1-10.0x              月度 / 季度 / 年度              │
│                                                               │
│  ── 成本参数 ─────────────────────────────────────────────   │
│                                                               │
│  运营成本 (BRL/kWh)                                           │
│  [   0.1250    ]                                              │
│  范围: 0.001+                                                 │
│  ⚠ 此值直接影响利润计算                                        │
│                                                               │
│  ── 收益影响预览 ────────────────────────────────────────    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ penalty_multiplier = 1.50x 时：                         │  │
│  │ • 合同违约：基础电价的 150%                               │  │
│  │ • 示例: R$0.82/kWh 峰时 → R$1.23/kWh 罚金               │  │
│  │                                                          │  │
│  │ operating_cost = R$0.125/kWh 时：                        │  │
│  │ • 净利润: R$0.82 - R$0.25 - R$0.125 = R$0.445/kWh       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy billing-rules]          │
└─────────────────────────────────────────────────────────────┘
```

#### 4.4.2 安全警告

operating_cost_per_kwh 直接影响所有利润计算。修改此值时显示额外确认：

```
┌─────────────────────────────────────────────┐
│  ⚠ 检测到高影响变更                           │
│                                               │
│  正在修改 operating_cost_per_kwh              │
│  从 R$ 0.1200 改为 R$ 0.1250                 │
│                                               │
│  此变更影响 ORG_001 下的所有资产。              │
│  预估年度影响: -R$ 12,500                      │
│                                               │
│  [继续] [取消]                                 │
└─────────────────────────────────────────────┘
```

---

### 4.5 M5 Frontend BFF — Feature Flags

**AppConfig Profile:** `feature-flags`
**M8 Table:** `feature_flags`
**M8 API:** `GET/POST/PUT/DELETE /admin/feature-flags`

#### 4.5.1 布局

```
┌─────────────────────────────────────────────────────────────┐
│  M5 Frontend BFF > Feature Flags                             │
│  AppConfig Profile: feature-flags | TTL: 5min                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [全部] [已启用 ●] [已禁用 ○]  搜索: [________]              │
│  [+ 创建新 Flag]                                              │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  show_analytics_modal                    [● ON  ]       │ │
│  │  在 Dashboard 上显示分析弹窗                               │ │
│  │  目标: 所有租户 | 有效期: 2026-02-01 ~ 永久               │ │
│  │  ▸ 展开                                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  enable_dr_test_button                   [○ OFF ]       │ │
│  │  为运营人员显示 DR 测试下发按钮                             │ │
│  │  目标: ORG_001, ORG_002 | 有效期: ~ 2026-03-01           │ │
│  │  ▸ 展开                                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  show_shadow_benchmark                   [● ON  ]       │ │
│  │  启用 Device Shadow 基准测试显示                           │ │
│  │  目标: 仅 SOLFACIL_ADMIN | 有效期: 永久                   │ │
│  │  ▾ 详情已展开:                                            │ │
│  │  ┌───────────────────────────────────────────────────┐  │ │
│  │  │ Flag 名称:    show_shadow_benchmark                │  │ │
│  │  │ 描述:        [启用 Device Shadow 基准...         ] │  │ │
│  │  │ 是否启用:     [● ON ]                              │  │ │
│  │  │ 目标组织:     [null = 全部 ▾]                       │  │ │
│  │  │ 生效时间:     [2026-02-01T00:00 ]                  │  │ │
│  │  │ 失效时间:     [          ]（留空 = 永久）            │  │ │
│  │  │ [保存] [删除]                                      │  │ │
│  │  └───────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy feature-flags]          │
└─────────────────────────────────────────────────────────────┘
```

#### 4.5.2 Toggle 交互

Toggle 开关点击后**不会立即生效**。它只修改本地状态。
用户必须通过 Action Bar 的 Deploy 按钮才能推送到 AppConfig。

---

### 4.6 M6 Identity & Tenant — RBAC Policies

**AppConfig Profile:** `rbac-policies`
**M8 Table:** `rbac_policies`
**M8 API:** 只读（v5.1 §0.1 标记为 "future"）

#### 4.6.1 布局

```
┌─────────────────────────────────────────────────────────────┐
│  M6 Identity & Tenant > RBAC Policies                        │
│  AppConfig Profile: rbac-policies | TTL: 30min               │
│  ⚠ 只读 — v1.0 版本暂不支持编辑                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─ 权限矩阵 ────────────────────────────────────────────┐  │
│  │                                                          │  │
│  │  资源 \ 角色      │ SOLFACIL │ ORG    │ ORG     │ ORG  │  │
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
│  │  图例: R=读取  W=写入  D=删除  —=无权限                   │  │
│  │  作用域: SOLFACIL_ADMIN=全部(跨组织), 其他=仅本组织        │  │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  提示: RBAC 编辑功能将在未来版本中提供。                         │
│  参见 SOLFACIL_BACKEND_DESIGN_v5.1.md §0.1 M6。              │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate: 已禁用] [Diff: 已禁用] [Deploy: 已禁用]          │
│  只读模块 — 无部署操作可用                                     │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.7 M7 Open API — API Quotas & Webhook Policies

**AppConfig Profile:** `api-quotas`
**M8 Tables:** `api_quotas` + `webhook_policies`
**M8 API:** `GET/POST/PUT/DELETE /admin/api-quotas`

#### 4.7.1 布局

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
│  合作伙伴 ID   │ 次/分钟 │ 次/天    │ 突发  │ 是否启用          │
│  ──────────────┼─────────┼─────────┼───────┼────────          │
│  PARTNER_001   │    60   │  10,000 │  100  │ ● 是             │
│  PARTNER_002   │   120   │  50,000 │  200  │ ● 是             │
│  PARTNER_003   │    30   │   5,000 │   50  │ ○ 否             │
│                                                               │
│  [+ 添加合作伙伴配额]                                          │
│                                                               │
│  已选择: PARTNER_001                                          │
│  次/分钟: [60]  次/天: [10000]  突发: [100]                    │
│  约束: burst <= calls_per_minute × 2                          │
│                                                               │
│  === Tab 2: Webhook Policies ===                              │
│                                                               │
│  Org: [ORG_ENERGIA_001 ▾]                                    │
│                                                               │
│  最大重试次数                退避策略                            │
│  [      3      ]          [exponential ▾]                     │
│                                                               │
│  初始延迟 (ms)              最大延迟 (ms)                       │
│  [    1,000    ]          [  300,000    ]                     │
│                                                               │
│  死信通知邮箱: [alerts@energia-corp.com.br]                    │
│                                                               │
│  ── 重试时间线预览 ──────────────────────────────────────    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 重试 1: 1.0 秒后                                       │  │
│  │ 重试 2: 2.0 秒后  (1000 × 2^1)                         │  │
│  │ 重试 3: 4.0 秒后  (1000 × 2^2)                         │  │
│  │ → 进入死信队列，共耗时 7.0 秒                             │  │
│  │ → 通知: alerts@energia-corp.com.br                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
├─ Action Bar ────────────────────────────────────────────────┤
│  [Validate]  [Preview Diff]  [Deploy api-quotas]             │
└─────────────────────────────────────────────────────────────┘
```

#### 4.7.2 重试时间线预览

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

## 5. 统一发布流程 (Unified Deployment Flow)

### 5.1 流程总览

所有 M1~M7 模块的配置变更都经过相同的发布流程：

```
┌───────────┐    ┌───────────────┐    ┌───────────┐    ┌──────────────┐
│  1. 编辑  │───►│  2. 验证      │───►│ 3. Diff   │───►│ 4. 部署      │
│  （本地）  │    │  (JSON Schema)│    │ （预览）    │    │ (M8 API)     │
└───────────┘    └───────┬───────┘    └───────────┘    └──────┬───────┘
                         │                                     │
                    ┌────┴────┐                                │
                    │ 通过?   │                                 │
                    ├─ 是 ──►                                   │
                    └─ 否: 报错                                 │
                                                               │
                  ┌────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ 5. AppConfig     │───►│ 6. Canary (10%) │───►│ 7. 全量 (100%)   │
│ Schema 验证      │    │ 10 分钟观察      │    │ 部署完成 ✓       │
└────────┬─────────┘    └────────┬─────────┘    └──────────────────┘
         │                       │
    ┌────┴────┐             ┌────┴────┐
    │ 通过?   │             │CW 告警  │
    ├─ 是 ──►│              │错误>1%  │
    └─ 否: 拒绝              ├─ 否: 继续
                            └─ 是: 自动回滚
```

### 5.2 步骤详情

**步骤 1: 编辑** — 用户在模块 UI 中修改配置，仅存在于浏览器内存

**步骤 2: 验证** — 按 Ctrl+E，触发本地 Ajv JSON Schema 验证

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

**步骤 3: Diff 预览** — 按 Ctrl+D，显示行级差异比对

```
┌─────────────────────────────────────────────────────────────┐
│  Diff 预览 — vpp-strategies (ORG_001)                        │
│                                                               │
│  当前值（AppConfig）               新值（本地编辑）              │
│                                                               │
│  "min_soc": 20.00,           "min_soc": 15.00,   ← 已变更   │
│  "max_soc": 90.00,           "max_soc": 90.00,              │
│  "emergency_soc": 10.00,     "emergency_soc": 8.00, 已变更  │
│  "profit_margin": 0.05,      "profit_margin": 0.05,         │
│                               "active_hours": {    ← 新增    │
│                                 "start": "06:00",            │
│                                 "end": "22:00"               │
│                               },                             │
│                                                               │
│  汇总: 2 项变更, 1 项新增, 0 项删除                             │
│  [继续部署]  [返回编辑器]                                       │
└─────────────────────────────────────────────────────────────┘
```

**步骤 4-7: 部署** — 按 Ctrl+Shift+Enter，触发部署

```javascript
async function triggerDeploy(moduleId) {
  const profile = MODULE_REGISTRY[moduleId].appConfigProfile;
  const saveResult = await adminApi('PUT', `/admin/${profile}`, editedData);
  if (!saveResult.success) return showToast(`保存失败`, 'error');

  // M8 返回 deploymentId，开始轮询
  pollDeploymentStatus(saveResult.data.deploymentId, moduleId);
}
```

### 5.3 部署状态轮询

每 5 秒轮询 AppConfig 部署状态：

```javascript
async function pollDeploymentStatus(deploymentId, moduleId) {
  const poll = setInterval(async () => {
    const status = await adminApi('GET',
      `/admin/deployments/${deploymentId}/status`);

    switch (status.data.state) {
      case 'VALIDATING':
        updateStatusBar('正在验证 JSON Schema...', 'yellow');
        break;
      case 'DEPLOYING':
        updateStatusBar(`Canary 部署中... ${status.data.percentComplete}%`, 'yellow');
        break;
      case 'BAKED':
        updateStatusBar('部署成功', 'green');
        appendAuditEntry({ action: 'DEPLOY', module: moduleId, status: 'SUCCESS' });
        clearInterval(poll);
        break;
      case 'ROLLED_BACK':
        updateStatusBar('已自动回滚', 'red');
        appendAuditEntry({ action: 'ROLLBACK', module: moduleId, status: 'AUTO' });
        clearInterval(poll);
        break;
    }
  }, 5000);
}
```

**Status Bar 状态：**

| 状态 | 颜色 | 文字 |
|------|------|------|
| VALIDATING | 黄色 | "正在验证 JSON Schema..." |
| DEPLOYING | 黄色脉冲 | "Canary 部署中... 10%" |
| BAKED | 绿色 | "部署成功" |
| ROLLED_BACK | 红色 | "已自动回滚 — 请检查 CloudWatch" |

### 5.4 审计日志自动更新

每次部署操作自动写入右侧 Audit Panel：

```
┌─ 审计日志 ─────────────────────────┐
│                                     │
│  16:45  DEPLOY  M2 ✓               │
│  vpp-strategies → BAKED             │
│  操作人: eng@solfacil.com.br       │
│  ─────────────────────────────────  │
│  16:42  EDIT  M2                    │
│  变更: min_soc 20→15               │
│  ─────────────────────────────────  │
│  16:38  ROLLBACK  M4               │
│  billing-rules → 自动回滚           │
│  触发条件: CW 告警 (Error>1%)       │
│  ─────────────────────────────────  │
│  16:30  LOGIN                       │
│  eng@solfacil.com.br               │
│                                     │
└─────────────────────────────────────┘
```

---

## 6. UI 设计规范 (Design System)

### 6.1 色彩系统

#### 6.1.1 深色主题基底

```css
:root {
  /* 背景层级（最深 → 最浅） */
  --bg-base:       #0f0f23;   /* Top bar, Status bar */
  --bg-surface:    #16162a;   /* 主编辑区 */
  --bg-elevated:   #1a1a2e;   /* 左侧导航, 审计面板, 卡片 */
  --bg-overlay:    #1e1e3a;   /* Action bar, 弹窗 */
  --bg-input:      #252547;   /* 输入框, 文本域 */
  --bg-hover:      #2a2a4a;   /* 悬停状态 */

  /* 文字 */
  --text-primary:  #e2e8f0;   /* 主要内容 */
  --text-secondary:#94a3b8;   /* 次要内容, 标签 */
  --text-muted:    #64748b;   /* 弱化, 占位符 */

  /* 边框 */
  --border-subtle: #2d2d5e;   /* 细微分隔线 */
  --border-default:#3d3d6e;   /* 默认边框 */
  --border-strong: #5555a0;   /* 激活态, 聚焦态边框 */
}
```

#### 6.1.2 状态颜色

```css
:root {
  --status-success:    #10b981;  /* 绿 — 成功、已部署、Active */
  --status-warning:    #f59e0b;  /* 黄 — Canary 中、警告 */
  --status-error:      #ef4444;  /* 红 — 错误、失败、已回滚 */
  --status-info:       #3b82f6;  /* 蓝 — 信息、连接中 */
  --status-neutral:    #6b7280;  /* 灰 — 未修改、Inactive */

  /* 模块主题色（用于导航徽标） */
  --accent-m1:  #06b6d4;  /* Cyan — IoT */
  --accent-m2:  #8b5cf6;  /* Purple — Algorithm */
  --accent-m3:  #f97316;  /* Orange — Dispatch */
  --accent-m4:  #10b981;  /* Green — Billing */
  --accent-m5:  #ec4899;  /* Pink — Feature Flags */
  --accent-m6:  #6366f1;  /* Indigo — Identity */
  --accent-m7:  #14b8a6;  /* Teal — API */
}
```

#### 6.1.3 VPP 运行模式颜色

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

### 6.2 字体系统

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

**规则：**
- 所有配置数据、JSON 编辑器：`--font-mono`
- 导航、标题、按钮：`--font-sans`
- 输入框中的值：`--font-mono`

### 6.3 栅格系统 (8px Grid)

```css
:root {
  --space-1:  0.25rem;  /*  4px */
  --space-2:  0.5rem;   /*  8px — 基本单位 */
  --space-3:  0.75rem;  /* 12px */
  --space-4:  1rem;     /* 16px */
  --space-6:  1.5rem;   /* 24px */
  --space-8:  2rem;     /* 32px */
  --space-12: 3rem;     /* 48px — Top bar 高度 */

  --radius-sm:  4px;
  --radius-md:  8px;
  --radius-lg:  12px;
}
```

### 6.4 组件规范

**主按钮** (Deploy):
- Background: linear-gradient(135deg, #6366f1, #4f46e5)
- Text: white, semibold
- Hover: brightness(1.1), translateY(-1px)
- Disabled: opacity 0.5

**次要按钮** (Validate, Diff):
- Background: transparent
- Border: 1px solid --border-default
- Hover: border --border-strong

**危险按钮** (Delete, Rollback):
- Border: 1px solid --status-error
- Hover: bg --status-error, text white

**输入框：**
- Background: --bg-input
- Border: 1px solid --border-subtle
- Font: --font-mono
- Focus: border --border-strong, 蓝色发光

**Toggle 开关：**
- Width: 48px, Height: 24px
- OFF: --bg-input 背景, --border-default 边框
- ON: --status-success 背景
- Transition: 0.2s ease

**Toast 通知：**
- 位置: 右上角, 距边缘 24px
- 持续时间: 5 秒自动消失
- 成功: 绿色左边框
- 错误: 红色左边框

### 6.5 快捷键

| 快捷键 | 动作 | 可用时机 |
|--------|------|----------|
| `Ctrl+E` | 验证当前配置 | 有修改时 |
| `Ctrl+D` | 预览 Diff | 验证通过后 |
| `Ctrl+Shift+Enter` | 部署到 AppConfig | 验证通过后 |
| `Ctrl+S` | 保存草稿到 localStorage | 随时 |
| `Ctrl+Z` | 撤销上次编辑 | 编辑中 |
| `Escape` | 关闭弹窗 | 弹窗打开时 |
| `1`~`7` | 切换到 M1~M7 | 输入框无焦点时 |
| `Ctrl+[` | 切换审计面板 | 随时 |

---

## 7. 里程碑计划 (Milestones)

### 7.1 阶段总览

```
Phase 1              Phase 2              Phase 3              Phase 4
骨架 + 静态展示      M2 批量模式          全模块接通            真实 API + Cognito
────────────────    ────────────────    ────────────────    ────────────────
 admin.html          Batch Ops UI         M1 JSON Editor       M8 REST API
 admin.css           Site Cards           M3 Dispatch 表单      Cognito Guard
 admin.js 脚手架      模式选择             M4 Billing 表单       AppConfig 部署
 Left Nav            确认弹窗             M5 Feature Flags     轮询
 三栏布局             进度弹窗             M6 RBAC 矩阵          审计日志（真实）
 Mock 数据            模拟下发             M7 API Quotas        错误处理
```

### 7.2 Phase 1: 骨架 + 静态展示

**产出物：**
- admin.html — HTML 结构
- admin.css — 深色主题
- admin.js — Constants + Navigation + Init

**验收条件：**
- [ ] 完整三栏布局
- [ ] M1~M7 七个 Tab 可切换
- [ ] 深色主题正确
- [ ] 响应式行为正常

### 7.3 Phase 2: M2 批量模式（最高优先）

**产出物：**
- 策略参数表单 + SoC Visual Gauge
- 批量操作工具栏 + Site Cards
- 确认/进度/结果弹窗

**验收条件：**
- [ ] 策略参数表单功能正常
- [ ] SoC Gauge 即时反映
- [ ] 批量操作完整流程
- [ ] 90% 成功 / 10% 随机失败
- [ ] 失败后可重试
- [ ] 模式标签即时更新

### 7.4 Phase 3: 全模块接通

**产出物：**
- M1/M3/M4/M5/M6/M7 渲染器
- 7 个 JSON Schema 文件
- 统一发布流程（模拟）

**验收条件：**
- [ ] M1: JSON Editor 可编辑
- [ ] M3: Dispatch 表单 + 影响预览
- [ ] M4: Billing 表单 + 收益影响
- [ ] M5: Feature Flags Toggle 列表
- [ ] M6: RBAC 只读矩阵
- [ ] M7: API Quotas + Webhook 时间线
- [ ] Validate → Diff → Deploy 模拟

### 7.5 Phase 4: 真实 M8 API + Cognito 对接

**产出物：**
- Auth & Route Guard（真实 Cognito JWT）
- API Client（对接 M8 REST API）
- AppConfig 部署轮询
- 审计日志（后端加载）

**验收条件：**
- [ ] 非 ADMIN 看到 403
- [ ] 配置持久化到 PostgreSQL
- [ ] AppConfig 部署状态即时反映
- [ ] 自动回滚红色警告
- [ ] 审计日志记录所有操作
- [ ] 全 7 模块 CRUD 正常

### 7.6 依赖关系

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
（无依赖）    （Phase 1）    （Phase 2）    （Phase 3 + M8 后端）
```

Phase 4 需要后端提供：M8 REST API 端点、AppConfig Profiles、Cognito group、Deployment status API。

### 7.7 预估工程量

| 阶段 | 新增代码量 | 重点 |
|------|-----------|------|
| Phase 1 | HTML ~200, CSS ~600, JS ~300 | 布局、主题 |
| Phase 2 | JS ~400, CSS ~300 | M2 + Batch Ops |
| Phase 3 | JS ~500, JSON ~700 | 其余模块 |
| Phase 4 | JS ~400 | Auth + API + Deploy |
| **合计** | **~3400 行** | admin.html + admin.js + admin.css + schemas |

---

## 附录 A: 模块注册表

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

## 附录 B: API 客户端

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
    showToast('权限不足。需要 SOLFACIL_GLOBAL_ADMIN 权限。', 'error');
    return { success: false, error: 'FORBIDDEN' };
  }
  const data = await response.json();
  if (!response.ok) {
    showToast(`API 错误: ${data.error || response.statusText}`, 'error');
    return { success: false, error: data.error };
  }
  return data;
}
```

---

## 附录 C: 部署状态机

```
                              ┌──────────┐
                              │   IDLE   │
                              └────┬─────┘
                                   │ 点击 Deploy
                                   ▼
                              ┌──────────┐
                     ┌───────│  SAVING  │
                     │        └────┬─────┘
                  错误             │ 200 OK
                     │             ▼
                     │        ┌──────────────┐
                     │        │ VALIDATING   │
                     │        └────┬────┬────┘
                     │          通过  未通过
                     │             │    │
                     │             ▼    ▼
                     │       ┌────────┐ ┌──────────┐
                     │       │DEPLOYING│ │REJECTED  │
                     │       └────┬───┘ └──────────┘
                     │            │
                     │       Canary 10% → 10min → 90%
                     │            │
                     │       ┌────┴────────┐
                     │  CW OK│             │CW 告警
                     │       ▼             ▼
                     │  ┌────────┐   ┌─────────────┐
                     └─►│ BAKED  │   │ ROLLED_BACK │
                        └────────┘   └─────────────┘
```

---

*本文件是 SOLFACIL VPP Control Plane UI 设计的唯一权威来源。*
*所有实现工作应参考本文件。*

*— 文件结束 —*
