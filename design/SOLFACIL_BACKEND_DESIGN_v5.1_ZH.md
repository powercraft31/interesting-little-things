# SOLFACIL VPP — 统一后端架构设计

> **版本：** 5.1 | **日期：** 2026-02-21
> **作者：** 云架构团队
> **状态：** 生效 — 大一统融合架构
> **替代：** `SOLFACIL_BACKEND_DESIGN.md` v1.1、`SOLFACIL_AUTH_TENANT_DESIGN.md` v2.0

**本文档是 SOLFACIL VPP 后端架构的唯一权威来源（Single Source of Truth）。**

---

## 文档历史

| 版本 | 日期 | 摘要 |
|---------|------|---------|
| **v1.0** | 2026-02-15 | 初始 5 模块后端设计：IoT Hub、优化引擎、DR 调度器、市场与计费、BFF。基于 EventBridge 的异步通信。AWS CDK TypeScript 作为 IaC。 |
| **v1.1** | 2026-02-20 | 新增 Device Shadow 同步流程（ScheduleGenerated → M1）、SQS 延迟队列超时机制（DR Dispatcher）、边界情况事件负载、扩展成本估算。 |
| **v2.0 (Auth)** | 2026-02-20 | 独立文档：通过 Cognito 实现多租户（混合自定义属性 + 组）、RBAC（4 种角色）、RLS、org_id 覆盖所有数据存储、企业级 SSO（SAML/OIDC）、强制 TOTP MFA、M2M OAuth 2.0 Client Credentials、WAF、基于事件驱动的 Webhook 与 HMAC-SHA256 签名。 |
| **v3.0** | 2026-02-20 | **统一融合。** 从 5 个扩展到 7 个限界上下文（新增 M6：身份与租户 IAM、M7：开放 API 与集成）。org_id 成为每个数据存储中的一等公民。合并 CDK 部署为 7 个连贯阶段。更新包含认证/Webhook 行项目的成本估算。唯一权威来源。 |
| **v4.0** | 2026-02-20 | **DDD 架构升级。** 新增 §19 数据策略与防腐层：(1) M4 可扩展元数据 — PostgreSQL JSONB `metadata` 列 + GIN 索引（assets/organizations 表），实现零迁移业务属性扩展；(2) M1 双通道接入与 ACL — `StandardTelemetry` 规范契约、`TelemetryAdapter` 接口、`HuaweiAdapter`（devSn→deviceId，W÷1000→kW）+ `NativeAdapter`、`AdapterRegistry` 优先级链；M2 算法引擎与厂商特定格式永久隔离。 |
| **v4.1 (草案)** | 2026-02-21 | **Admin Control Plane 草案。** 新增 M8：管理控制面（配置驱动、无代码运营）。定义 device_parser_rules + vpp_strategies 模式和 REST API 端点。M1–M7 不变。完整融合推迟至 v5.0。 |
| **v5.0** | 2026-02-21 | **大一统融合。** M8 确认为全局控制面。M1-M7 确认为数据面。引入控制面与数据面分离法则、大一统融合矩阵（8 模块依赖图）以及配置同步架构（EventBridge ConfigUpdated + ElastiCache Redis）。在所有模块中强制执行禁止硬编码规则。 |
| **v5.1** | 2026-02-21 | **云原生升级。** §0.2 将 ElastiCache Redis + EventBridge 广播（反模式）替换为 AWS AppConfig + Lambda Extension（sidecar 模式）。消除 Redis 运维成本、TTL 管理代码和 config-refresh Lambda。为 M8 配置发布增加金丝雀部署 + 自动回滚安全保障。新增 AppConfig JSON Schema 验证器（左移验证）实现零爆炸半径的配置保护。新增 §0.3 可观测性与分布式追踪：AWS X-Ray 主动追踪、vpp-{UUID} trace_id 跨 M1→M2→M3 传播、结构化 JSON 日志规范，以及 CloudWatch Alarm 与 AppConfig 自动回滚集成。 |

---

## 目录

0. [架构法则：控制面与数据面](#0-architectural-law-control-plane-vs-data-plane-全局法则)
   - 0.1 [大一统融合矩阵 — 8 模块配置依赖](#01-grand-fusion-matrix--8-module-configuration-dependency八大模块全面融合矩阵)
   - 0.2 [配置分发架构 — AWS AppConfig + Lambda Extension](#02-configuration-distribution-architecture--aws-appconfig--lambda-extension)
   - 0.3 [可观测性与分布式追踪 — AWS X-Ray + 结构化日志](#03-observability--distributed-tracing--aws-x-ray--structured-logging)
1. [执行摘要与设计原则](#1-executive-summary--design-principles)
2. [架构概述](#2-architecture-overview)
3. [全局数据隔离策略](#3-global-data-isolation-strategy)
4. [M1：IoT 与遥测中心](#4-module-1-iot--telemetry-hub)
5. [M2：算法引擎](#5-module-2-algorithm-engine)
6. [M3：DR 调度器](#6-module-3-dr-dispatcher)
7. [M4：市场与计费](#7-module-4-market--billing)
8. [M5：前端 BFF](#8-module-5-frontend-bff)
9. [M6：身份与租户管理 (IAM)](#9-module-6-identity--tenant-management-iam)
10. [M7：开放 API 与集成](#10-module-7-open-api--integration)
11. [核心事件流程示例](#11-core-event-flow-examples)
12. [统一 CDK 部署计划](#12-unified-cdk-deployment-plan)
13. [后端目录结构](#13-backend-directory-structure)
14. [可观测性](#14-observability)
15. [成本估算](#15-cost-estimation)
16. [安全态势总结](#16-security-posture-summary)
17. [附录：事件目录](#17-appendix-event-catalog)
18. [附录：Cognito CLI 与测试用户](#18-appendix-cognito-cli--test-users)
19. [数据策略与防腐层](#19-data-strategy--anti-corruption-layer-数据策略与防腐层)
20. [M8：管理控制面（草案）](#20-module-8-admin-control-plane-admin-运营中台--draft)

---

## 0. 架构法则：控制面与数据面（全局法则）

> **ADR 状态：** 已接受 | **决策日期：** 2026-02-21
> **范围：** 适用于全部 8 个模块的系统级架构法则
> **驱动因素：** 运营敏捷性、零停机配置更新、消除硬编码业务规则

### 0.0 最高原则

从 v5.0 起，SOLFACIL VPP 系统正式采用**控制面与数据面分离**作为其最高架构法则：

**控制面（Control Plane）— M8（管理控制面）**
- 系统的**配置唯一权威来源**
- 职责：动态配置、业务规则、阈值、权限矩阵、功能开关、API 配额
- **所有业务规则变更必须且只能从 M8 发起**
- 拥有 PostgreSQL 配置表；通过 REST API 暴露 CRUD 操作
- 通过 EventBridge 发布 `ConfigUpdated` 事件通知数据面模块

**数据面（Data Plane）— M1-M7**
- 职责：数据接入、计算、调度、下发、计费、API 服务
- **铁律：任何可变的业务规则或阈值不得在 M1-M7 中硬编码（禁止硬编码规则）**
- M1-M7 的配置必须在启动时（Lambda 冷启动）或收到 `ConfigUpdated` 事件后从 M8 动态加载
- 数据面模块是配置的消费者，绝不是生产者

**违反此法则的代码不得合并到主分支（Merge Blocked）。**

---

### 0.1 大一统融合矩阵 — 8 模块配置依赖（八大模块全面融合矩阵）

以下矩阵定义了 M8（控制面）与 M1-M7（数据面）之间的完整配置依赖关系：

| 模块 | 配置类型 | M8 表 | 读取时机 | 缓存 TTL | Redis 键模式 |
|--------|-------------------|----------|-------------|-----------|-------------------|
| **M1** IoT Hub | 设备解析规则（字段映射、单位转换） | `device_parser_rules` | Lambda 冷启动 + `ConfigUpdated{module:'M1'}` | 5 分钟 | `parser_rules:{org_id}` |
| **M2** Algorithm Engine | 套利策略阈值（SoC 限制、利润率） | `vpp_strategies` | 每次 EventBridge 定时触发前 + `ConfigUpdated{module:'M2'}` | 1 分钟 | `vpp_strategy:{org_id}` |
| **M3** DR Dispatcher | 调度策略（重试、并发、超时） | `dispatch_policies` | Lambda 冷启动 + `ConfigUpdated{module:'M3'}` | 10 分钟 | `dispatch_policy:{org_id}` |
| **M4** Market & Billing | 计费规则（违约乘数、电价时段、度电成本） | `billing_rules` | 每次计费计算（高频，Redis 缓存） | 60 分钟 | `billing_rules:{org_id}` |
| **M5** Frontend BFF | 功能开关（UI 切换、金丝雀发布） | `feature_flags` | 每次 API 请求（BFF 中间件层缓存） | 5 分钟 | `feature_flags:{org_id}` |
| **M6** Identity & Tenant | 动态 RBAC 权限矩阵 | `rbac_policies` | Cognito Lambda Trigger（令牌签发）+ JWT 验证 | 30 分钟 | `rbac:{role}` |
| **M7** Open API | API 配额 + Webhook 退避策略 | `api_quotas` / `webhook_policies` | API Gateway Lambda Authorizer（每次请求） | 1 分钟 | `api_quota:{partner_id}` / `webhook_policy:{org_id}` |

---

#### M1 (IoT Hub) — 动态解析规则

**来源表：** `device_parser_rules` (M8)

M1 的遥测接入 Lambda 从 M8 的 `device_parser_rules` 表中读取厂商特定的 `field_mapping` 和 `unit_conversions`，取代了之前硬编码的 `HuaweiAdapter` / `NativeAdapter` 模式。

- **读取时机：** Lambda 冷启动 + 收到 `ConfigUpdated{module: 'M1'}` 事件时
- **缓存：** ElastiCache Redis，TTL=5 分钟，键：`parser_rules:{org_id}`
- **融合效果：** 添加新厂商（如 SMA、ABB）只需在 M8 管理后台创建新的解析规则即可 — **零代码部署**。M1 Lambda 在运行时根据规则的 `field_mapping` JSON 动态构建适配器。

#### M2 (Algorithm Engine) — 套利策略与阈值

**来源表：** `vpp_strategies` (M8)

M2 的优化 Lambda 从 M8 的 `vpp_strategies` 表中读取 `min_soc`、`max_soc`、`emergency_soc`、`profit_margin` 和 `active_hours`，取代了之前硬编码的阈值常量。

- **读取时机：** 每次 EventBridge 定时触发前 + 收到 `ConfigUpdated{module: 'M2'}` 事件时
- **缓存：** ElastiCache Redis，TTL=1 分钟（策略变更必须快速生效），键：`vpp_strategy:{org_id}`
- **融合效果：** 在夏季用电高峰期，运营人员可直接在 M8 管理后台将 `min_soc=10`（更激进的放电策略）— **无需代码变更**。下一个优化周期自动使用更新后的阈值。

#### M3 (DR Dispatcher) — 调度策略

**来源表：** `dispatch_policies`（M8，新增）

M3 的调度 Lambda 从 M8 的 `dispatch_policies` 表中读取操作参数：

| 参数 | 默认值 | 描述 |
|-----------|---------|-------------|
| `max_retry_count` | 3 | 失败设备命令的最大重试次数 |
| `retry_backoff_seconds` | 60 | 重试间的退避间隔 |
| `max_concurrent_dispatches` | 10 | 每个组织的最大并发调度操作数 |
| `timeout_minutes` | 15 | SQS 延迟队列超时时间（当前为硬编码！） |

- **读取时机：** Lambda 冷启动 + `ConfigUpdated{module: 'M3'}`
- **缓存：** ElastiCache Redis，TTL=10 分钟，键：`dispatch_policy:{org_id}`
- **融合效果：** 在紧急情况下，运营人员可在 M8 管理后台临时将 `timeout_minutes` 从 15 改为 5 — **立即生效**于下一个调度周期。无需重新部署。

#### M4 (Market & Billing) — 计费规则与电价矩阵

**来源表：** `billing_rules`（M8，新增）

M4 的计费 Lambda 从 M8 的 `billing_rules` 表中读取定价和成本参数：

| 参数 | 默认值 | 描述 |
|-----------|---------|-------------|
| `tariff_penalty_multiplier` | 1.5x | 违约的惩罚乘数 |
| `tariff_effective_period` | `'monthly'` | 电价有效期（`'monthly'` / `'quarterly'` / `'annually'`） |
| `operating_cost_per_kwh` | _（必填）_ | 每千瓦时运营成本（当前在 M4 中为硬编码常量！） |

- **读取时机：** 每次计费计算（高频读取 — Redis 缓存为必需）
- **缓存：** ElastiCache Redis，TTL=60 分钟（电价费率变动不频繁），键：`billing_rules:{org_id}`
- **融合效果：** 当巴西政府更新 Tarifa Branca 费率时，运营人员更新 M8 管理后台即可 — **无需重新部署**。下一个计费周期自动使用新费率。

#### M5 (Frontend BFF) — 租户功能开关与 UI 配置

**来源表：** `feature_flags`（M8，新增）

M5 的 BFF 中间件从 M8 的 `feature_flags` 表中读取功能开关：

| 参数 | 类型 | 描述 |
|-----------|------|-------------|
| `flag_name` | TEXT | 功能标识符（如 `'show_analytics_modal'`、`'enable_dr_test_button'`、`'show_shadow_benchmark'`） |
| `is_enabled` | BOOLEAN | 该功能是否启用 |
| `target_org_ids` | JSONB | `null` = 全部租户，或指定组织列表 `["ORG_001", "ORG_002"]` |
| `valid_from` / `valid_until` | TIMESTAMPTZ | 功能开关的有效时间窗口 |

- **读取时机：** 每次 API 请求（在 BFF 中间件层缓存）
- **缓存：** ElastiCache Redis，TTL=5 分钟，键：`feature_flags:{org_id}`
- **融合效果：** 新功能可先在 M8 管理后台仅对 `SOLFACIL_ADMIN` 启用，验证后逐步推广到 `ORG_MANAGER` 及更多角色 — 实现**灰度发布**，无需代码变更。

#### M6 (Identity & Tenant) — 动态 RBAC 权限矩阵

**来源表：** `rbac_policies`（M8，未来）

M6 的 Cognito Pre-Token-Generation Lambda 从 M8 的 `rbac_policies` 表中读取权限定义：

| 参数 | 类型 | 描述 |
|-----------|------|-------------|
| `role` | TEXT | `'SOLFACIL_ADMIN'` / `'ORG_MANAGER'` / `'ORG_OPERATOR'` / `'ORG_VIEWER'` |
| `resource` | TEXT | `'assets'`、`'dispatch'`、`'billing'`、`'parser_rules'`、`'strategies'` 等 |
| `actions` | JSONB | `['read', 'write', 'delete']` 的子集 |
| `org_scope` | TEXT | `'all'`（跨组织）或 `'own'`（仅本组织） |

- **读取时机：** Cognito Lambda Trigger（令牌签发）+ JWT 验证
- **缓存：** ElastiCache Redis，TTL=30 分钟（权限变更需要相对快速传播），键：`rbac:{role}`
- **融合效果：** 添加新权限（如 `ORG_OPERATOR` 可查看 DR 调度但不能修改策略）只需在 M8 管理后台更新即可 — Cognito 在下一次令牌签发时自动注入更新后的 claims。

#### M7 (Open API) — API 配额与 Webhook 退避策略

**来源表：** `api_quotas` + `webhook_policies`（M8，新增）

M7 的 API Gateway Lambda Authorizer 从两个 M8 表中读取速率限制和 Webhook 重试策略：

**表：`api_quotas`**

| 参数 | 默认值 | 描述 |
|-----------|---------|-------------|
| `calls_per_minute` | 60 | 每合作伙伴每分钟速率限制 |
| `calls_per_day` | 10,000 | 每合作伙伴每日配额 |
| `burst_limit` | 100 | 最大突发容量 |

**表：`webhook_policies`**

| 参数 | 默认值 | 描述 |
|-----------|---------|-------------|
| `max_retry_count` | 3 | Webhook 投递的最大重试次数 |
| `backoff_strategy` | `'exponential'` | `'linear'` 或 `'exponential'` 退避策略 |
| `initial_delay_ms` | 1000 | 初始重试延迟（毫秒） |
| `max_delay_ms` | 300000 | 最大重试延迟（5 分钟） |
| `dead_letter_email` | _（可选）_ | DLQ 触发时的告警邮件 |

- **读取时机：** API Gateway Lambda Authorizer（每次请求，Redis 缓存为性能必需）
- **缓存：** ElastiCache Redis，TTL=1 分钟（配额变更必须快速生效），键：`api_quota:{partner_id}` / `webhook_policy:{org_id}`
- **融合效果：** 当某合作伙伴的 API 流量意外激增时，运营人员可立即在 M8 管理后台降低其配额 — WAF/Authorizer 层在下一次请求时即执行新的限制，**无需代码变更**。

---

### 0.2 配置分发架构 — AWS AppConfig + Lambda Extension

**架构决策记录（ADR）**

**废弃方案：ElastiCache Redis + EventBridge 广播（反模式）**

废弃原因：
- ElastiCache Redis 是常驻服务，在 Serverless 架构中产生固定成本（~$15-30/月/节点），且需要 VPC 子网和安全组管理
- 自行管理 TTL、缓存失效、config-refresh Lambda，代码复杂度高且容易出错
- EventBridge 广播 ConfigUpdated 事件到 7 个 config-refresh Lambda，是典型的反模式：用事件驱动架构解决本地缓存问题，过度工程化
- Lambda 内存缓存无法跨实例共享，且生命周期不可控

**采用方案：AWS AppConfig + Lambda Extension（云原生 Sidecar 模式）**

AppConfig 是 AWS 为 Serverless 配置管理量身打造的服务，完全消除上述所有问题。

---

**架构设计：M8 → AppConfig → Lambda Extension → M1-M7**

配置更新流程：

1. 运营人员在 M8 后台（Admin Control Plane）修改配置（如调整某 org 的 vpp_strategy 阈值）

2. M8 的 Lambda 执行两个操作（事务）：
   - 写入 PostgreSQL（M8 的 Source of Truth，RLS 保护）
   - 调用 AppConfig StartDeployment API，将新配置版本发布到对应的 AppConfig Configuration Profile

3. AWS AppConfig 处理配置发布（关键能力）：
   - 渐进式部署（Canary Deployment）：可设定「先让 10% 的 Lambda 实例应用新配置，观察 10 分钟，无异常再全量推送」
   - 自动回滚（Auto-Rollback）：若 CloudWatch Alarm 检测到 Error Rate 异常上升，AppConfig 自动回滚到前一个稳定版本
   - 这对 VPP 系统至关重要：若运营人员误将 min_soc=20 改为 200，系统不会瞬间全崩，而是在 Canary 阶段被拦截

4. Lambda Extension（Sidecar 模式）：
   - M1-M7 的所有 Lambda 在部署时挂载 AWS AppConfig Lambda Extension Layer
   - Extension 作为后台进程（PID 1 之外）在 Lambda 执行环境中运行
   - Extension 异步、定期（默认每 45 秒）从 AppConfig 拉取最新配置，缓存在本地内存
   - M1-M7 的业务代码通过本地 HTTP 调用（http://localhost:2772/applications/...）读取配置
   - 本地 localhost 调用延迟 < 1ms，真正的零网络延迟

5. M1-M7 代码读取配置（业务代码无需任何缓存逻辑）：
   ```
   // M1 ingest-telemetry.ts 读取解析规则（伪代码，v5.0 实现目标）
   const config = await fetch(
     'http://localhost:2772/applications/solfacil-vpp/environments/prod/configurations/parser-rules'
   ).then(r => r.json());
   const rules = config[orgId]; // 直接用，Extension 保证是最新的
   ```

---

**AppConfig 资源规划（CDK AdminControlPlaneStack 的一部分）**

AppConfig Application：solfacil-vpp

Configuration Profiles（每个模块的配置独立管理）：
- parser-rules（M1）：各厂商的 field_mapping + unit_conversions，按 org_id 分层
- vpp-strategies（M2）：min_soc、max_soc、emergency_soc、profit_margin，按 org_id 分层
- dispatch-policies（M3）：max_retry_count、timeout_minutes，按 org_id 分层
- billing-rules（M4）：tariff_penalty_multiplier、operating_cost_per_kwh，按 org_id 分层
- feature-flags（M5）：flag_name → is_enabled、target_org_ids（全局，无 org 分层）
- rbac-policies（M6）：role → resource → actions 矩阵（全局）
- api-quotas（M7）：partner_id → calls_per_minute、burst_limit（按 partner 分层）

**AppConfig JSON Schema 验证器（左移验证 Shift-Left Validation）**

每个 Configuration Profile 在创建时必须绑定对应的 JSON Schema 验证器。这实现了「Shift-Left Validation」——配置错误在按下发布的「第 0 秒」被拦截，连 Canary 金丝雀阶段都进不去。

验证触发时机：M8 Admin Lambda 调用 `AppConfig:StartDeployment` → AppConfig 自动对 Content 执行 JSON Schema 验证 → 验证失败 → 立即抛出 `BadRequestException`，Deployment 直接 Rejected，PostgreSQL 回写失败状态。

核心 Schema 示例（vpp-strategies profile）：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "patternProperties": {
    "^ORG_[A-Z0-9_]+$": {
      "type": "object",
      "required": ["min_soc", "max_soc", "emergency_soc", "profit_margin"],
      "properties": {
        "min_soc": { "type": "number", "minimum": 10, "maximum": 50 },
        "max_soc": { "type": "number", "minimum": 70, "maximum": 100 },
        "emergency_soc": { "type": "number", "minimum": 5, "maximum": 20 },
        "profit_margin": { "type": "number", "minimum": 0.01, "maximum": 0.5 }
      },
      "additionalProperties": true
    }
  }
}
```

防爆效果：若 M8 操作员误输入 `min_soc: 200`，AppConfig 在 Schema 验证阶段立即拒绝（`minimum: 10, maximum: 50`），错误配置不会进入 Canary 阶段，实现真正的「零爆炸半径（Zero Blast Radius）」。

各 Profile 对应的核心约束：
- parser-rules：field_mapping 必须是 object，unit_conversions 的 factor 必须是正数（minimum: 0.0001）
- vpp-strategies：min_soc < max_soc（使用 if/then 依赖校验），emergency_soc < min_soc
- dispatch-policies：max_retry_count 最大值 5，timeout_minutes 范围 5-60
- billing-rules：operating_cost_per_kwh 必须是正数（minimum: 0.001）
- feature-flags：is_enabled 必须是 boolean，不允许 string "true"
- api-quotas：calls_per_minute 最大值 10000，burst_limit 不得超过 calls_per_minute × 2

---

部署策略（Deployment Strategy）：
- 生产环境：Canary 10% → 10 分钟观察期 → 90% 全量（共 20 分钟）
- 回滚触发条件：CloudWatch Alarm（Lambda Error Rate > 1%）
- 开发环境：Linear 100%（立即全量，方便本地测试）

---

**对比总结（AppConfig vs Redis）**

| 维度 | ElastiCache Redis（废弃） | AWS AppConfig + Extension（采用） |
|------|--------------------------|----------------------------------|
| 运维成本 | ~$15-30/月/节点，常驻服务 | 按配置部署次数计费，接近零成本 |
| 代码复杂度 | TTL 管理 + 缓存失效 + config-refresh Lambda | 业务代码零缓存逻辑，Extension 全包 |
| 配置读取延迟 | ~1-5ms（Redis 网络 RTT） | < 1ms（localhost 调用） |
| 配置更新安全性 | 无保护，错误配置瞬间全量生效 | Canary 部署 + 自动回滚，防爆设计 |
| VPC 依赖 | 必须在 VPC 内，增加子网复杂度 | Lambda Extension 无需额外 VPC 资源 |
| 灾难恢复 | 需要 Redis 备份与快照策略 | AppConfig 内建版本历史，一键回滚 |

---

**v5.1 系统部署顺序（更新）**

SharedStack → AuthStack → AdminControlPlaneStack（M8 + AppConfig Profiles）→ IotHubStack（M1 + Extension）→ AlgorithmStack（M2 + Extension）→ DrDispatcherStack（M3 + Extension）→ MarketBillingStack（M4 + Extension）→ BffStack（M5 + Extension）→ OpenApiStack（M7 + Extension）

注意：移除 ConfigSyncStack（不再需要 ElastiCache Redis 和 config-refresh Lambda）


---

### 0.3 可观测性与分布式追踪 — AWS X-Ray + 结构化日志

**设计原则：每个请求都有完整故事（Every Request Has a Story）**

在 VPP 系统中，一条电池充电指令的生命周期横跨 M1→M2→M3，涉及多个异步 EventBridge 事件和 Lambda 调用。如果没有分布式追踪，当客户问「为什么我的电池昨晚 3 点没有按策略充电？」，工程师只能在 CloudWatch Logs 的茫茫记录中大海捞针。

X-Ray 让每一次跨模块的异步调用，都能在 AWS Console 的可视化瀑布图（Service Map）中精准重现。

---

**全局 X-Ray 启用规范**

所有 Lambda 函数在 CDK 定义时必须启用 X-Ray active tracing：

```typescript
// 所有 Lambda 定义的强制规范（CDK）
const fn = new lambda.Function(this, 'MyFunction', {
  tracing: lambda.Tracing.ACTIVE,  // 必填，不得省略
  // ... 其他配置
});
```

所有 API Gateway 路由必须启用 X-Ray tracing：

```typescript
const api = new apigateway.RestApi(this, 'VppApi', {
  deployOptions: {
    tracingEnabled: true,  // 必填
    dataTraceEnabled: true,
  },
});
```

---

**trace_id 生命周期与跨模块传播规范**

trace_id 是本系统分布式追踪的灵魂。以下是它的完整传播路径：

**步骤 1：M1 生成 trace_id（所有异步链的起点）**

M1 的 `ingest-telemetry.ts` Lambda 在接收到 MQTT 消息后，若判断需要触发策略计算，必须生成唯一的 trace_id 并附加到所有下游调用：

```typescript
// M1 ingest-telemetry.ts（伪代码，v5.x 实现目标）
import { randomUUID } from 'crypto';

const traceId = `vpp-${randomUUID()}`; // 格式：vpp-{UUID}

// 写入 Timestream 同时记录 trace_id
await writeToTimestream({ ...telemetry, traceId });

// 发布 EventBridge 事件时必须包含 trace_id
await eventBridge.putEvents({
  Entries: [{
    EventBusName: 'VppEventBus',
    Source: 'vpp.m1.iot-hub',
    DetailType: 'TelemetryIngested',
    Detail: JSON.stringify({
      deviceId,
      orgId,
      stateOfCharge,
      traceId,  // ← 必须传递，不得省略
      timestamp: new Date().toISOString(),
    }),
  }],
});
```

**步骤 2：M2 接收并继承 trace_id**

M2 的 `run-optimization.ts` Lambda 从 EventBridge event.detail 中提取 traceId，并在生成 DR 指令时继续传递：

```typescript
// M2 run-optimization.ts（伪代码）
const { deviceId, orgId, stateOfCharge, traceId } = event.detail;

// 记录 trace 节点
console.log(JSON.stringify({ level: 'INFO', traceId, module: 'M2', action: 'optimization_result', decision }));

// 发布 DRCommandIssued 时继续携带 traceId
await eventBridge.putEvents({
  Entries: [{
    DetailType: 'DRCommandIssued',
    Detail: JSON.stringify({
      commandId,
      deviceId,
      orgId,
      action: decision,
      traceId,  // ← 继承并传递，不得省略
    }),
  }],
});
```

**步骤 3：M3 接收并完成追踪链**

M3 的 `dispatch-command.ts` Lambda 接收 traceId，写入 DynamoDB 命令记录，并在广播 MQTT 指令时记录最终节点：

```typescript
// M3 dispatch-command.ts（伪代码）
const { commandId, deviceId, traceId } = event.detail;

// 写入 DynamoDB 时带入 traceId，供后续审计
await dynamoDB.put({
  TableName: 'DRCommands',
  Item: { commandId, deviceId, traceId, status: 'DISPATCHED', ... }
});

// 完成追踪链
console.log(JSON.stringify({ level: 'INFO', traceId, module: 'M3', action: 'command_dispatched', commandId }));
```

---

**结构化日志格式规范（全系统统一）**

所有 Lambda 的 console.log 必须输出 JSON 格式，包含以下必填字段：

```json
{
  "level": "INFO | WARN | ERROR",
  "traceId": "vpp-{UUID}",
  "module": "M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8",
  "action": "动作描述（如 telemetry_ingested、optimization_result、command_dispatched）",
  "orgId": "ORG_ENERGIA_001",
  "durationMs": 42,
  "timestamp": "2026-02-21T05:23:00.000Z"
}
```

CloudWatch Logs Insights 查询示例（追踪单一 trace_id 的完整链路）：

```
fields @timestamp, module, action, durationMs
| filter traceId = "vpp-550e8400-e29b-41d4-a716-446655440000"
| sort @timestamp asc
```

---

**X-Ray Service Map 可视化效果**

启用后，AWS Console → X-Ray → Service Map 中可看到：

```
[API Gateway] → [M5 BFF Lambda] → [M1 IoT Lambda]
                                        ↓ EventBridge
                               [M2 Algorithm Lambda]
                                        ↓ EventBridge
                               [M3 Dispatcher Lambda]
                                        ↓ IoT Core / DynamoDB
```

每个节点显示：P50/P95/P99 延迟、Error Rate、吞吐量。当任何节点出现异常，工程师在 30 秒内定位到问题模块，无需翻阅数千行 log。

---

**可观测性三支柱整合（Metrics + Logs + Traces）**

| 支柱 | 工具 | 关键指标 |
|------|------|----------|
| Metrics | CloudWatch Metrics | Lambda Duration P95、Error Rate、Throttles |
| Logs | CloudWatch Logs Insights | 结构化 JSON + traceId 快速查询 |
| Traces | AWS X-Ray | 跨模块瀑布图，端到端延迟分解 |

CloudWatch Alarm 触发条件（与 AppConfig 自动回滚集成）：
- M1 Error Rate > 1% → 触发 AppConfig parser-rules 版本回滚
- M2 Duration P95 > 5000ms → 告警，人工审查 vpp-strategies 复杂度
- M3 DLQ MessageCount > 0 → 立即告警，DR 指令可能未达设备

---

## 1. 执行摘要与设计原则

### 目标

SOLFACIL 正在构建一个 **B2B SaaS 虚拟电厂 (VPP)** 平台，聚合巴西各地分布式电池储能系统 (BESS)。该平台支持：

- **Tarifa Branca 套利** — 在低谷时段充电，高峰时段放电，以最大化 R$ 0.57/kWh 的价差
- **需求响应 (DR)** — 协调调度 50,000+ 电池资产，用于电网平衡事件
- **多租户管理** — 多个企业客户（能源公司、投资基金、聚合商）各自管理自有车队，实现严格的数据隔离
- **外部集成** — 面向 ERP 系统、交易平台和聚合商的机器对机器 API 访问；基于事件驱动的 Webhook 通知，用于实时下游处理

### 核心设计原则

| # | 原则 | 理由 |
|---|-----------|-----------|
| 1 | **多租户优先设计** | `org_id` 是每个数据存储、事件负载、MQTT 主题和 API 响应中的必要维度。租户隔离在基础设施（RLS、IoT 策略）、中间件（extractTenantContext）和应用层均有强制执行。 |
| 2 | **事件驱动解耦** | 所有模块间通信通过单一的 Amazon EventBridge 总线（`solfacil-vpp-events`）流转。模块发布领域事件并订阅所需事件。禁止 Lambda 直接调用 Lambda。 |
| 3 | **限界上下文** | 7 个模块各自拥有独立数据存储。不共享数据库。跨模块数据访问通过事件或 BFF 聚合层中介。 |
| 4 | **Serverless 优先** | 零服务器管理。Lambda 用于计算，DynamoDB/Timestream/RDS Serverless 用于存储，API Gateway 用于入口。按调用付费定价模型。 |
| 5 | **API 优先** | BFF（M5）为仪表盘暴露简洁的 REST API。Open API Gateway（M7）为外部集成暴露独立的限流 API。两者独立文档化和版本化。 |
| 6 | **零信任安全** | 每个请求都经过认证（Cognito JWT 或 M2M OAuth 令牌）。每个数据查询都限定租户范围。每个写操作都检查角色权限。每个 MQTT 主题都通过设备证书策略限制。 |
| 7 | **不可变性** | 所有状态变更产生事件。EventBridge 事件日志（含 Archive）是审计的权威来源。Lambda 处理函数返回新对象，绝不原地修改。 |

### 技术栈

| 层级 | 技术 | 版本 |
|-------|-----------|---------|
| IaC | AWS CDK (TypeScript) | v2.x |
| 计算 | AWS Lambda | Node.js 20 / Python 3.12（仅 M2） |
| API | API Gateway v2 (HTTP API) | — |
| 认证 | Amazon Cognito | User Pool + Identity Providers |
| 消息传递 | Amazon EventBridge | 自定义总线 |
| IoT | AWS IoT Core | MQTT v4.1.1 over TLS |
| 时序数据 | Amazon Timestream | — |
| 关系型 | Amazon RDS PostgreSQL 16 (Serverless v2) | — |
| 键值存储 | Amazon DynamoDB | 按需模式 |
| 队列 | Amazon SQS | Standard + Delay |
| 安全 | AWS WAF v2、Secrets Manager | — |
| 可观测性 | Lambda Powertools、X-Ray、CloudWatch | — |

---

## 2. 架构概述

### 7 模块限界上下文图

```
                    ┌──────────────────────────────────────────────────────────────────┐
                    │                      Frontend (Existing)                         │
                    │              Vanilla JS Dashboard + Chart.js                     │
                    └──────────────────────┬───────────────────────────────────────────┘
                                           │ HTTPS (Bearer JWT)
                    ┌──────────────────────▼───────────────────────────────────────────┐
                    │           Module 5: BFF (API Gateway + Lambda)                    │
                    │           Cognito Authorizer │ REST API (read/write)              │
                    └──┬──────────┬──────────┬──────────┬─────────────────────────────┘
                       │          │          │          │
                  EventBridge EventBridge EventBridge Direct Query
                       │          │          │          │
          ┌────────────▼──┐  ┌───▼────────┐ │  ┌───────▼──────────────────┐
          │  Module 1:     │  │ Module 2:   │ │  │  Module 4:               │
          │  IoT &         │  │ Algorithm   │ │  │  Market & Billing        │
          │  Telemetry Hub │  │ Engine      │ │  │  (RDS PostgreSQL + RLS)  │
          │  (IoT Core +   │  │ (EventBridge│ │  │                          │
          │   Timestream)  │  │  + Lambda)  │ │  └──────────────────────────┘
          └───────┬────────┘  └──────┬──────┘ │
                  │                  │        ┌▼──────────────────────────┐
                  │  ScheduleGenerated        │  Module 3:                │
                  │◄─────────────────┤        │  DR Dispatcher            │
                  │  (→Device Shadow)│        │  (Lambda + IoT Core       │
                  │       EventBridge│        │   MQTT publish +          │
                  │                  │        │   SQS Timeout Queue)      │
                  │                  └───────►│                           │
                  │◄──────────────────────────┘
                  │
          ┌───────▼────────────────────────────┐
          │         Edge Devices (Inverters)     │
          │     MQTT over TLS  │  Device Shadow  │
          └─────────────────────────────────────┘

  ┌─────────────────────────────────────┐   ┌────────────────────────────────────┐
  │  Module 6: Identity & Tenant (IAM)  │   │  Module 7: Open API & Integration  │
  │  ┌─────────────────────────────┐    │   │  ┌──────────────────────────────┐  │
  │  │ Cognito User Pool           │    │   │  │ API Gateway (M2M)            │  │
  │  │  ├─ SSO: SAML 2.0 / OIDC   │    │   │  │  ├─ OAuth 2.0 Client Creds   │  │
  │  │  ├─ MFA: TOTP mandatory     │    │   │  │  ├─ API Keys + Usage Plans   │  │
  │  │  └─ Groups: RBAC            │    │   │  │  └─ WAF WebACL               │  │
  │  │  └─ Pre-Token Lambda        │    │   │  ├──────────────────────────────┤  │
  │  ├─────────────────────────────┤    │   │  │ Webhook Subscriptions        │  │
  │  │ Organization Provisioning   │    │   │  │  ├─ EventBridge API Dest.    │  │
  │  │  ├─ POST /admin/orgs        │    │   │  │  ├─ HMAC-SHA256 signing     │  │
  │  │  └─ organizations table     │    │   │  │  └─ DynamoDB subscriptions   │  │
  │  └─────────────────────────────┘    │   │  └──────────────────────────────┘  │
  └─────────────────────────────────────┘   └────────────────────────────────────┘
```

### 模块职责矩阵

| 平面 | 模块 | 名称 | 职责 | 主要数据存储 |
|-------|--------|------|----------------|--------------------|
| **控制面** | M8 | 管理控制面 | 动态配置、业务规则、功能开关、API 配额 | RDS PostgreSQL + ElastiCache Redis |
| 数据面 | M1 | IoT 与遥测中心 | MQTT 接入、Device Shadow、遥测存储 | Amazon Timestream |
| 数据面 | M2 | 算法引擎 | 调度优化、预测、Tarifa Branca 套利 | SSM Parameter Store |
| 数据面 | M3 | DR 调度器 | 需求响应命令、SQS 超时、状态跟踪 | DynamoDB |
| 数据面 | M4 | 市场与计费 | Tarifa Branca 规则、利润计算、开票 | RDS PostgreSQL |
| 数据面 | M5 | 前端 BFF | 仪表盘 REST API（Cognito 保护、租户限定） | 从 M1-M4 聚合 |
| 数据面 | M6 | 身份与租户 (IAM) | Cognito User Pool、SSO/SAML、组织配置、RBAC | Cognito + DynamoDB |
| 数据面 | M7 | 开放 API 与集成 | M2M API Gateway、WAF、限流、Webhook 订阅 | DynamoDB + Secrets Manager |

### 模块间通信

所有异步通信通过共享的 EventBridge 总线 `solfacil-vpp-events` 流转：

```
M1 (IoT Hub)          ──publishes──►  TelemetryReceived, DeviceStatusChanged
M2 (Algorithm Engine)  ──publishes──►  ScheduleGenerated, ForecastUpdated
M3 (DR Dispatcher)     ──publishes──►  DRDispatchCompleted, AssetModeChanged
M4 (Market & Billing)  ──publishes──►  ProfitCalculated, InvoiceGenerated, TariffUpdated
M5 (BFF)               ──publishes──►  DRCommandIssued (user-initiated dispatch)
M6 (IAM)               ──publishes──►  OrgProvisioned, UserCreated
M7 (Open API)          ──consumes ──►  DRDispatchCompleted, InvoiceGenerated → webhook delivery
```

**规则：禁止 Lambda 直接调用 Lambda。** 模块之间仅通过 EventBridge 事件或 BFF 聚合层的读查询进行交互。

### 端到端数据流

```
Edge Device (Inverter)
    │ MQTT publish: solfacil/{org_id}/{region}/{asset_id}/telemetry
    ▼
M1: IoT Hub
    │ Ingest → Timestream; publish TelemetryReceived
    ▼
EventBridge ─────────────────────────────────────────────────────────
    │                    │                    │                    │
    ▼                    ▼                    ▼                    ▼
M2: Algorithm        M3: DR Dispatcher   M4: Market & Billing  M7: Open API
    │ Optimize            │ Dispatch          │ Calculate profit     │ Webhook
    │ Publish             │ Track status      │ Generate invoice     │ delivery
    │ ScheduleGenerated   │                   │                      │
    ▼                     │                   │                      │
M1: Device Shadow         │                   │                      │
    │ Push to device      │                   │                      │
    ▼                     ▼                   ▼                      ▼
M5: BFF (Dashboard) ◄──── Aggregates read data from M1-M4 ────────►  Frontend
```

---

## 3. 全局数据隔离策略

### 首要原则：`org_id` 是一等公民

SOLFACIL VPP 平台中每一条数据记录都包含 `org_id` 字段。这是**第一架构不变量** — 任何数据的存储、传输或查询都不能缺少租户上下文。

```
org_id = Organization ID (e.g., "ORG_ENERGIA_001")
         Assigned at user creation time (Cognito custom:org_id)
         Immutable per user
         Mandatory in every:
           ├─ PostgreSQL row (RLS-enforced)
           ├─ DynamoDB item (GSI partition key)
           ├─ Timestream record (dimension)
           ├─ MQTT topic path segment
           ├─ EventBridge event detail
           └─ Lambda handler context (TenantContext)
```

### 3.1 PostgreSQL（M4：市场与计费）

#### Organizations 表

```sql
CREATE TABLE organizations (
    id          VARCHAR(50) PRIMARY KEY,     -- 如 "ORG_ENERGIA_001"
    name        VARCHAR(200) NOT NULL,       -- 如 "Energia Corp S.A."
    cnpj        VARCHAR(18) UNIQUE NOT NULL, -- 巴西税务 ID (CNPJ)
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    plan_tier   VARCHAR(20) NOT NULL DEFAULT 'standard',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### Schema 变更（所有表添加 org_id）

```sql
ALTER TABLE assets           ADD COLUMN org_id VARCHAR(50) NOT NULL;
ALTER TABLE tariff_schedules ADD COLUMN org_id VARCHAR(50) NOT NULL;
ALTER TABLE trades           ADD COLUMN org_id VARCHAR(50) NOT NULL;
ALTER TABLE daily_revenue    ADD COLUMN org_id VARCHAR(50) NOT NULL;

-- 外键
ALTER TABLE assets           ADD CONSTRAINT fk_assets_org    FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE tariff_schedules ADD CONSTRAINT fk_tariff_org    FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE trades           ADD CONSTRAINT fk_trades_org    FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE daily_revenue    ADD CONSTRAINT fk_revenue_org   FOREIGN KEY (org_id) REFERENCES organizations(id);

-- 租户范围查询的索引
CREATE INDEX idx_assets_org         ON assets(org_id);
CREATE INDEX idx_trades_org         ON trades(org_id, trade_date);
CREATE INDEX idx_daily_revenue_org  ON daily_revenue(org_id, report_date);
CREATE INDEX idx_tariff_org         ON tariff_schedules(org_id, valid_from);
```

#### 行级安全 (RLS) — 纵深防御

```sql
ALTER TABLE assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades           ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_revenue    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_schedules ENABLE ROW LEVEL SECURITY;

-- Lambda 中间件设置：SET app.current_org_id = 'ORG_ENERGIA_001'
CREATE POLICY tenant_isolation_assets ON assets
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_trades ON trades
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_daily_revenue ON daily_revenue
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_tariff ON tariff_schedules
  USING (org_id = current_setting('app.current_org_id', true));

-- SOLFACIL_ADMIN 绕过：具有 BYPASSRLS 权限的超级用户角色
```

### 3.2 DynamoDB（M3：DR 调度器）

```
Table: dispatch_tracker
PK: dispatch_id (ULID)
SK: asset_id
Attributes:
  + org_id (String)             ← 必填
  - command_type, target_mode, status, requested_power_kw,
    actual_power_kw, response_latency_sec, accuracy_pct,
    timestamp, error_reason

GSI: org-dispatch-index
  PK: org_id
  SK: dispatch_id
  Purpose: "列出组织 X 的所有调度"（仪表盘查询）
```

### 3.3 Timestream（M1：IoT 中心）

```
Database: solfacil_vpp
Table: device_telemetry

Dimensions:
  + org_id      ← 必填（新增首要维度）
    asset_id
    device_id
    region

Measures: soc, power_kw, voltage, temperature, operation_mode
Retention: Memory=24h, Magnetic=90d
```

所有 Timestream 查询都包含 `WHERE org_id = '{org_id}'`。由于 Timestream 按维度分区，`org_id` 在不增加额外成本的情况下提升查询性能。

### 3.4 IoT Core（M1 和 M3）— MQTT 主题命名空间

```
Updated topic structure (org_id inserted):

  solfacil/{org_id}/{region}/{asset_id}/telemetry
  solfacil/{org_id}/{region}/{asset_id}/command/mode-change
  solfacil/{org_id}/{region}/{asset_id}/response/mode-change

IoT Policy (per device certificate):
  {
    "Effect": "Allow",
    "Action": ["iot:Publish", "iot:Subscribe", "iot:Receive"],
    "Resource": "arn:aws:iot:*:*:topic/solfacil/${iot:Connection.Thing.Attributes[org_id]}/*"
  }

IoT Rule SQL (updated topic position indices):
  SELECT *, topic(2) AS org_id, topic(3) AS region, topic(4) AS asset_id
  FROM 'solfacil/+/+/+/telemetry'
```

### 3.5 EventBridge 事件 — 所有负载中 org_id 为必填

```typescript
/** 基础事件信封 — 所有事件必须包含 org_id */
export interface VppEvent<T> {
  readonly source: string;
  readonly detailType: string;
  readonly detail: T & { readonly org_id: string };
  readonly timestamp: string;
}
```

示例负载：
```json
{
  "source": "solfacil.vpp.dr-dispatcher",
  "detail-type": "DRDispatchCompleted",
  "detail": {
    "org_id": "ORG_ENERGIA_001",
    "dispatch_id": "01HWXYZ...",
    "results": [...]
  }
}
```

### 3.6 Lambda — extractTenantContext() 工具函数

所有模块的每个 Lambda 处理函数在执行业务逻辑之前都会提取租户上下文。此共享工具函数位于 `src/shared/middleware/tenant-context.ts`：

```typescript
export interface TenantContext {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly email: string;
  readonly isPlatformAdmin: boolean;
}

export type Role = 'SOLFACIL_ADMIN' | 'ORG_MANAGER' | 'ORG_OPERATOR' | 'ORG_VIEWER';
```

租户范围规则（在中间件层强制执行，而非在处理函数中）：
```
IF user.role == SOLFACIL_ADMIN:
    query_filter = {}                    // 管理员可查看一切
ELSE:
    query_filter = { org_id: user.orgId } // 严格的组织过滤
```

---

## 4. 模块 1：IoT 与遥测中心

### CDK 栈：`IotHubStack`

| 资源 | AWS 服务 | 用途 |
|----------|-------------|---------|
| MQTT 代理 | IoT Core | 通过 TLS 上的 MQTT 接受设备连接 |
| 设备注册表 | IoT Core Registry | 管理设备证书和 Thing 组 |
| 设备影子 | IoT Core Shadow | 存储每个设备的最后已知状态 |
| 遥测存储 | Amazon Timestream | 高频时间序列数据 |
| 数据摄入 Lambda | Lambda (Node.js 20) | IoT 规则动作 → 解析 → 批量写入 Timestream |
| 影子同步 Lambda | Lambda (Node.js 20) | ScheduleGenerated → Device Shadow 更新 |

### IAM 授权

```
IotHubStack Lambda functions:
  ├─ timestream:WriteRecords  → solfacil_vpp/device_telemetry
  ├─ iot:UpdateThingShadow    → arn:aws:iot:*:*:thing/*
  ├─ events:PutEvents         → solfacil-vpp-events bus
  └─ ssm:GetParameter         → /solfacil/iot/* parameters
```

### EventBridge 集成

| 方向 | 事件 | 来源/目标 |
|-----------|-------|---------------|
| **发布** | `TelemetryReceived` | → M2（预测更新）、M5（未来 WebSocket） |
| **发布** | `DeviceStatusChanged` | → M4（资产状态）、M5（仪表盘） |
| **消费** | `ScheduleGenerated` | ← M2（24 小时调度计划 → Device Shadow） |

### org_id 集成

- Timestream 每条遥测记录均包含 `org_id` 维度
- IoT 规则 SQL 从主题位置 2 提取 `org_id`
- Device Shadow 命名空间：`solfacil/{org_id}/{region}/{asset_id}`
- IoT 策略范围限定为设备证书的 `org_id` 属性

### Lambda 处理函数

```
src/iot-hub/
├── handlers/
│   ├── ingest-telemetry.ts       # IoT 规则 → Lambda：解析 MQTT，写入 Timestream（含 org_id 维度）
│   ├── device-shadow-sync.ts     # Device Shadow 更新处理函数
│   ├── schedule-to-shadow.ts     # EventBridge ScheduleGenerated → Device Shadow（期望状态）
│   └── device-registry.ts        # 设备配置与注册
├── services/
│   ├── timestream-writer.ts      # Timestream 批量写入逻辑
│   └── shadow-manager.ts         # Device Shadow 获取/更新
└── __tests__/
    ├── ingest-telemetry.test.ts
    └── timestream-writer.test.ts
```

### 设备影子调度同步

当模块 2 发布 `ScheduleGenerated` 事件时，`schedule-to-shadow` 处理函数会将 24 小时充放电调度计划写入每个设备的 Device Shadow（期望状态）：

```
M2（算法引擎）──ScheduleGenerated──► EventBridge ──► M1（schedule-to-shadow Lambda）
                                                                     │
                                                                     ├── 对每个资产：
                                                                     │   更新 Device Shadow（期望状态）
                                                                     │   { "schedule": [...], "schedule_id": "...", "valid_from": "..." }
                                                                     │
                                                                     ├── 设备在线：Delta → 立即推送
                                                                     └── 设备离线：Shadow 存储状态；重连后 → 自动推送
```

**为什么使用 Device Shadow？** 边缘设备（逆变器）可能会暂时失去连接。Delta 机制保证设备重新连接时自动接收最新调度计划——确保在中断期间不会丢失任何调度指令。

### Timestream 表结构

```
Database: solfacil_vpp
Table: device_telemetry

Dimensions: org_id, asset_id, device_id, region
Measures:
  - soc (DOUBLE, %)
  - power_kw (DOUBLE, kW)
  - voltage (DOUBLE, V)
  - temperature (DOUBLE, C)
  - operation_mode (VARCHAR)

Retention: Memory=24h, Magnetic=90d
```

---

## 5. 模块 2：算法引擎

### CDK 栈：`AlgorithmStack`

| 资源 | AWS 服务 | 用途 |
|----------|-------------|---------|
| 调度器 | EventBridge Scheduler | 每 15 分钟触发一次调度计划生成 |
| 优化器 Lambda | Lambda (Python 3.12) | 运行优化算法 |
| 预测模型 | SageMaker Endpoint（未来） | 负载与光伏发电预测 |
| 配置存储 | SSM Parameter Store | 算法参数、阈值 |

### IAM 授权

```
AlgorithmStack Lambda functions:
  ├─ timestream:Select         → solfacil_vpp/device_telemetry（读取 SoC 数据）
  ├─ events:PutEvents          → solfacil-vpp-events bus
  └─ ssm:GetParameter          → /solfacil/algorithm/* parameters
```

### EventBridge 集成

| 方向 | 事件 | 来源/目标 |
|-----------|-------|---------------|
| **发布** | `ScheduleGenerated` | → M1（Device Shadow）、M3（即时调度）、M4（预期收入） |
| **发布** | `ForecastUpdated` | → M5（仪表盘展示） |
| **消费** | `TelemetryReceived` | ← M1（更新预测模型） |
| **消费** | `TariffUpdated` | ← M4（使用新费率重新计算调度） |

### org_id 集成

- 所有发布的事件在 detail 中包含 `org_id`
- 调度计划生成使用 `WHERE org_id = ?` 查询 Timestream
- 优化运行按组织隔离（一个组织的资产绝不会影响另一个组织的调度）

### 算法逻辑（Tarifa Branca 套利）

```
Tarifa Branca 时段划分（巴西 ANEEL）：
  谷时：      00:00-06:00, 22:00-24:00  →  R$ 0.25/kWh
  平时：  06:00-17:00, 20:00-22:00  →  R$ 0.45/kWh
  峰时：          17:00-20:00               →  R$ 0.82/kWh

策略：
  1. 谷时充电（最低成本）
  2. 平时持有（等待峰时）
  3. 峰时放电（最大价差：R$ 0.57/kWh）
  4. 优化 Alpha = 实际收入 / 理论最大值 * 100
```

### Lambda 处理函数

```
src/optimization-engine/
├── handlers/
│   ├── run-schedule.ts           # EventBridge 定时触发 → 生成调度计划
│   ├── evaluate-forecast.ts      # TelemetryReceived → 更新预测
│   └── compute-alpha.ts          # 按需计算优化 Alpha
├── services/
│   ├── tariff-optimizer.ts       # 峰谷套利逻辑
│   ├── forecast-engine.ts        # 负载与光伏预测（MAPE 跟踪）
│   └── baseline-calculator.ts    # 影子基准（简单基线）
└── __tests__/
    ├── tariff-optimizer.test.ts
    └── baseline-calculator.test.ts
```

---

## 6. 模块 3：DR 调度器

### CDK 栈：`DrDispatcherStack`

| 资源 | AWS 服务 | 用途 |
|----------|-------------|---------|
| 命令处理器 | Lambda (Node.js 20) | 处理调度命令 |
| MQTT 发布器 | IoT Core (iotdata) | 向设备主题发布命令 |
| 状态跟踪器 | DynamoDB | 跟踪每个资产的调度状态和延迟 |
| 响应收集器 | Lambda (Node.js 20) | IoT 规则监听响应主题 → 聚合 |
| 超时队列 | SQS（延迟队列） | 15 分钟延迟消息，用于离线设备超时 |
| 超时检查器 | Lambda (Node.js 20) | 将超时设备标记为 FAILED |

### IAM 授权

```
DrDispatcherStack Lambda functions:
  ├─ iot:Publish               → solfacil/*/command/mode-change topics
  ├─ dynamodb:PutItem/Query    → dispatch_tracker table
  ├─ sqs:SendMessage           → timeout delay queue
  ├─ events:PutEvents          → solfacil-vpp-events bus
  └─ ssm:GetParameter          → /solfacil/dr/* parameters
```

### EventBridge 集成

| 方向 | 事件 | 来源/目标 |
|-----------|-------|---------------|
| **发布** | `DRDispatchCompleted` | → M4（财务结算）、M5（仪表盘）、M7（Webhook） |
| **发布** | `AssetModeChanged` | → M4（记录模式变更） |
| **消费** | `DRCommandIssued` | ← M5（用户发起的调度） |
| **消费** | `ScheduleGenerated` | ← M2（执行即时模式变更） |

### org_id 集成

- `dispatch_tracker` 表每条记录包含 `org_id`
- GSI `org-dispatch-index`（PK=org_id, SK=dispatch_id）用于租户范围查询
- MQTT 主题包含 org_id：`solfacil/{org_id}/{region}/{asset_id}/command/mode-change`
- 所有发布的事件在 detail 中包含 `org_id`

### DynamoDB 表

```
Table: dispatch_tracker
PK: dispatch_id (ULID)
SK: asset_id
Attributes:
  - org_id (String, required)
  - command_type (BATCH_DISPATCH | DR_TEST)
  - target_mode (self_consumption | peak_valley_arbitrage | peak_shaving)
  - status (PENDING | EXECUTING | SUCCESS | FAILED)
  - requested_power_kw
  - actual_power_kw
  - response_latency_sec
  - accuracy_pct
  - timestamp
  - error_reason (null | "DEVICE_ERROR" | "TIMEOUT" | "MQTT_DELIVERY_FAILED")

GSI: status-index    (PK=dispatch_id, SK=status)
GSI: org-dispatch-index (PK=org_id, SK=dispatch_id)
```

### 设备超时机制（SQS 延迟队列）

```
DR Dispatcher Lambda                       SQS（延迟队列）
(dispatch-command)                         delay = 15 分钟
      │                                          │
      ├── 1. 向 DynamoDB 写入 PENDING 状态         │
      ├── 2. 向设备发布 MQTT 命令                   │
      ├── 3. 更新状态 → EXECUTING                  │
      └── 4. 发送延迟消息到 SQS ────────────────────┤
                                                  │
           ┌──────────── 15 分钟后 ────────────────┘
           ▼
  超时检查 Lambda
      ├── 查询 DynamoDB 中的 dispatch_id
      ├── 查找仍处于 EXECUTING 状态的记录
      ├── 标记为 FAILED（原因："TIMEOUT"）
      └── 如果所有资产已处理完毕：
           └── 向 EventBridge 发布 "DRDispatchCompleted"
               （状态：PARTIAL_SUCCESS 或 FAILED）
```

**关键不变量：** 超时处理后**必须**发布 `DRDispatchCompleted` 事件，确保 M4 即使在设备部分不可达时也能进行财务结算。

### Lambda 处理函数

```
src/dr-dispatcher/
├── handlers/
│   ├── dispatch-command.ts       # EventBridge DRCommandIssued → IoT Core MQTT + SQS 延迟
│   ├── collect-response.ts       # IoT 规则 → 聚合设备响应
│   ├── dr-test-orchestrator.ts   # DR 测试：选择全部 → 调度 → 报告
│   └── timeout-checker.ts        # SQS 触发：检查并标记超时
├── services/
│   ├── mqtt-publisher.ts         # IoT Core MQTT 发布（批量扇出）
│   ├── response-aggregator.ts    # 收集确认，计算延迟和准确率
│   ├── dispatch-tracker.ts       # DynamoDB：按资产跟踪调度状态
│   └── timeout-queue.ts          # SQS 延迟消息入队辅助工具
└── __tests__/
    ├── dispatch-command.test.ts
    └── response-aggregator.test.ts
```

---

## 7. 模块 4：市场与计费

### CDK 栈：`MarketBillingStack`

| 资源 | AWS 服务 | 用途 |
|----------|-------------|---------|
| 数据库 | RDS PostgreSQL 16（Serverless v2） | 费率规则、资产财务、交易历史 |
| 查询 Lambda | Lambda (Node.js 20) | 通过 RDS Data API 执行 SQL |
| 账单生成器 | Lambda (Node.js 20) | 月度计费计算 |
| 缓存 | ElastiCache Redis（可选） | 缓存费率查询 |

### IAM 授权

```
MarketBillingStack Lambda functions:
  ├─ rds-data:ExecuteStatement    → solfacil-vpp RDS cluster
  ├─ secretsmanager:GetSecret     → RDS credentials
  ├─ events:PutEvents             → solfacil-vpp-events bus
  └─ ssm:GetParameter             → /solfacil/billing/* parameters
```

### EventBridge 集成

| 方向 | 事件 | 来源/目标 |
|-----------|-------|---------------|
| **发布** | `ProfitCalculated` | → M5（仪表盘） |
| **发布** | `InvoiceGenerated` | → M5（仪表盘）、M7（Webhook） |
| **发布** | `TariffUpdated` | → M2（重新计算调度）、M3（调度感知） |
| **消费** | `AssetModeChanged` | ← M3（记录模式变更的财务影响） |
| **消费** | `ScheduleGenerated` | ← M2（记录预期收入） |
| **消费** | `DRDispatchCompleted` | ← M3（财务结算） |

### org_id 集成

- 所有 PostgreSQL 表均包含 `org_id` 列，外键关联 `organizations`
- 通过 `current_setting('app.current_org_id')` 强制执行行级安全策略
- Lambda 处理函数在执行任何查询前设置 RLS 会话变量
- SOLFACIL_ADMIN 通过超级用户数据库角色绕过 RLS

### PostgreSQL 数据库结构

```sql
CREATE TABLE tariff_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    name             VARCHAR(100) NOT NULL,
    valid_from       DATE NOT NULL,
    valid_to         DATE,
    peak_rate        NUMERIC(8,4) NOT NULL,
    intermediate_rate NUMERIC(8,4) NOT NULL,
    off_peak_rate    NUMERIC(8,4) NOT NULL,
    peak_start       TIME NOT NULL,
    peak_end         TIME NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE assets (
    id               VARCHAR(20) PRIMARY KEY,
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    name             VARCHAR(200) NOT NULL,
    region           VARCHAR(5) NOT NULL,
    investment_brl   NUMERIC(12,2) NOT NULL,
    capacity_mwh     NUMERIC(8,2) NOT NULL,
    unit_count       INTEGER NOT NULL,
    operation_mode   VARCHAR(30) NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trades (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    asset_id         VARCHAR(20) REFERENCES assets(id),
    trade_date       DATE NOT NULL,
    time_block       VARCHAR(20) NOT NULL,
    tariff_type      VARCHAR(20) NOT NULL,
    operation        VARCHAR(20) NOT NULL,
    price_per_kwh    NUMERIC(8,4) NOT NULL,
    volume_kwh       NUMERIC(10,2),
    result_brl       NUMERIC(12,2) NOT NULL,
    status           VARCHAR(20) NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_revenue (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           VARCHAR(50) NOT NULL REFERENCES organizations(id),
    asset_id         VARCHAR(20) REFERENCES assets(id),
    report_date      DATE NOT NULL,
    revenue_brl      NUMERIC(12,2) NOT NULL,
    cost_brl         NUMERIC(12,2) NOT NULL,
    profit_brl       NUMERIC(12,2) NOT NULL,
    roi_pct          NUMERIC(6,2),
    UNIQUE(org_id, asset_id, report_date)
);
```

### Lambda 处理函数

```
src/market-billing/
├── handlers/
│   ├── get-tariff-schedule.ts    # 查询当前 Tarifa Branca 费率
│   ├── calculate-profit.ts       # 每个资产每日的收入/成本/利润
│   ├── generate-invoice.ts       # 月度计费报告
│   └── update-tariff-rules.ts    # 管理员：更新费率配置
├── services/
│   ├── tariff-engine.ts          # Tarifa Branca 费率查询（峰时/平时/谷时）
│   ├── revenue-calculator.ts     # 收入 = sum(电量 * 单价) - 成本
│   └── roi-calculator.ts         # ROI 与回收期计算
├── migrations/
│   ├── 001_create_organizations.ts
│   ├── 002_create_tariffs.ts
│   ├── 003_create_assets.ts
│   ├── 004_create_trades.ts
│   └── 005_create_daily_revenue.ts
└── __tests__/
    ├── tariff-engine.test.ts
    └── revenue-calculator.test.ts
```

---

## 8. 模块 5：前端 BFF

### CDK 栈：`BffStack`

| 资源 | AWS 服务 | 用途 |
|----------|-------------|---------|
| API 网关 | API Gateway v2 (HTTP API) | 为仪表盘提供 REST 端点 |
| 授权器 | Cognito User Pool（来自 M6） | 基于 JWT 的认证 |
| Lambda 处理函数 | Lambda (Node.js 20) | 每个路由一个处理函数 |
| WebSocket（未来） | API Gateway WebSocket | 实时调度进度 |

### IAM 授权

```
BffStack Lambda functions:
  ├─ rds-data:ExecuteStatement    → solfacil-vpp RDS cluster（只读）
  ├─ dynamodb:Query               → dispatch_tracker（通过 org-dispatch-index GSI）
  ├─ timestream:Select            → solfacil_vpp/device_telemetry
  ├─ events:PutEvents             → solfacil-vpp-events bus
  └─ cognito-idp:ListUsers        → 用户管理（仅限 ORG_MANAGER）
```

### EventBridge 集成

| 方向 | 事件 | 来源/目标 |
|-----------|-------|---------------|
| **发布** | `DRCommandIssued` | → M3（调度执行） |
| **消费** | `DRDispatchCompleted` | ← M3（未来：WebSocket 推送） |
| **消费** | `ProfitCalculated` | ← M4（未来：WebSocket 推送） |

### org_id 集成

- Cognito 授权器验证 JWT 并将声明传递给 Lambda
- `extractTenantContext()` 中间件从 JWT 声明中提取 `org_id` 和 `role`
- 所有查询均按 `org_id` 过滤（SOLFACIL_ADMIN 不过滤）
- 单资源端点进行资源所有权检查（返回 404 而非 403）

### API 路由

| 方法 | 路径 | 最低角色 | 租户范围限定 |
|--------|------|----------|----------------|
| `GET` | `/dashboard` | ORG_VIEWER | 限定为 `org_id` |
| `GET` | `/assets` | ORG_VIEWER | 限定为 `org_id` |
| `GET` | `/assets/{id}` | ORG_VIEWER | 验证资产属于 `org_id` |
| `GET` | `/assets/{id}/analytics` | ORG_VIEWER | 验证资产属于 `org_id` |
| `GET` | `/trades` | ORG_VIEWER | 限定为 `org_id` |
| `GET` | `/revenue/trend` | ORG_VIEWER | 限定为 `org_id` |
| `GET` | `/revenue/breakdown` | ORG_VIEWER | 限定为 `org_id` |
| `POST` | `/dispatch` | ORG_OPERATOR | 验证所有 `assetIds` 属于 `org_id`；升级认证 |
| `POST` | `/dr-test` | ORG_OPERATOR | 限定为 `org_id` 资产；升级认证 |
| `GET` | `/dispatch/{id}` | ORG_OPERATOR | 验证调度记录属于 `org_id` |
| `GET` | `/algorithm/kpis` | ORG_VIEWER | 限定为 `org_id` |
| `GET` | `/tariffs/current` | ORG_VIEWER | 限定为 `org_id` |
| `PUT` | `/tariffs/{id}` | ORG_MANAGER | 验证费率属于 `org_id` |
| `GET` | `/organizations` | SOLFACIL_ADMIN | 不限定范围（仅管理员） |
| `POST` | `/organizations` | SOLFACIL_ADMIN | 不限定范围（仅管理员） |
| `GET` | `/users` | ORG_MANAGER | 限定为 `org_id` |
| `POST` | `/users` | ORG_MANAGER | 用户创建在调用者的 `org_id` 下 |

### 中间件链

```
请求流程：
┌──────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ API GW   │───►│ Cognito      │───►│ Middy         │───►│ Handler      │
│ 接收     │    │ Authorizer   │    │ 中间件        │    │（业务        │
│ 请求     │    │（JWT 验证）  │    │ 链            │    │  逻辑）      │
└──────────┘    └──────────────┘    └───────────────┘    └──────────────┘
                 验证 JWT            1. extractTenant()   接收
                 拒绝无效            2. requireRole()     TenantContext
                 令牌                3. requireRecentAuth()（写操作用）
                                     4. logRequest()
                                     5. errorHandler()
```

### Lambda 处理函数

```
src/bff/
├── handlers/
│   ├── get-dashboard.ts          # GET /dashboard — 聚合 KPI 数据
│   ├── get-assets.ts             # GET /assets — 列出所有资产
│   ├── get-asset-detail.ts       # GET /assets/:id — 单个资产 + 分析
│   ├── get-trades.ts             # GET /trades — 今日交易计划
│   ├── post-dispatch.ts          # POST /dispatch — 触发批量模式变更
│   ├── post-dr-test.ts           # POST /dr-test — 触发 DR 测试
│   ├── get-dispatch-status.ts    # GET /dispatch/:id — 轮询调度进度
│   └── get-revenue-trend.ts      # GET /revenue/trend — 7 天收入图表
├── middleware/
│   ├── tenant-context.ts         # JWT → TenantContext 提取
│   ├── cors.ts                   # CORS 头
│   └── rate-limit.ts             # API 限流
└── __tests__/
    ├── get-dashboard.test.ts
    └── post-dispatch.test.ts
```

---

## 9. 模块 6：身份与租户管理（IAM）

### CDK 栈：`AuthStack`

| 资源 | AWS 服务 | 用途 |
|----------|-------------|---------|
| 用户池 | Cognito User Pool | 用户认证、密码策略、MFA |
| 用户池组 | Cognito Groups | RBAC 角色分配（4 个角色） |
| 应用客户端（仪表盘） | Cognito App Client | 基于浏览器的认证（授权码授权） |
| SAML 提供商 | Cognito Identity Provider (SAML 2.0) | Azure AD / Microsoft Entra 联合认证 |
| OIDC 提供商 | Cognito Identity Provider (OIDC) | Okta / Google Workspace 联合认证 |
| 令牌前置 Lambda | Lambda (Node.js 20) | 为联合用户的 JWT 注入 `org_id` |
| 联合映射 | DynamoDB | 将联合用户映射到 org_id + 角色 |
| HTTP 授权器 | API GW v2 Authorizer | BFF 路由的 Cognito JWT 验证 |

### IAM 授权

```
AuthStack resources:
  ├─ Pre-Token Lambda:
  │   ├─ dynamodb:GetItem          → federated_user_mappings table
  │   └─ logs:CreateLogGroup       → CloudWatch Logs
  ├─ Cognito User Pool:
  │   └─ lambda:InvokeFunction     → Pre-Token Lambda trigger
  └─ AuthStack outputs:
      ├─ userPool, userPoolClient  → 供 BffStack、OpenApiStack 使用
      └─ authorizer                → 供 BffStack 使用
```

### EventBridge 集成

| 方向 | 事件 | 来源/目标 |
|-----------|-------|---------------|
| **发布** | `OrgProvisioned` | → M4（在 PostgreSQL 中创建组织种子数据）、M1（创建 IoT Thing 组） |
| **发布** | `UserCreated` | → 审计日志 |

### org_id 集成

- `custom:org_id` 是 Cognito 自定义属性（用户创建后不可变）
- 令牌前置生成 Lambda 为联合 SSO 用户注入 `org_id`
- `federated_user_mappings` DynamoDB 表将外部 IdP 邮箱映射到 org_id + 角色

### 角色层级（RBAC）

```
┌─────────────────────────────────────────────────────────────┐
│                     SOLFACIL_ADMIN                          │
│  平台级超级用户。可查看所有组织。                              │
│  custom:org_id = "SOLFACIL"                                │
│  适用于：SOLFACIL 内部运营团队                                │
├─────────────────────────────────────────────────────────────┤
│                     ORG_MANAGER                             │
│  组织级管理员。对本组织拥有完全控制权。                         │
│  适用于：企业客户的能源管理人员                                │
├─────────────────────────────────────────────────────────────┤
│                     ORG_OPERATOR                            │
│  可在本组织内发送调度命令并进行监控。                           │
│  适用于：现场技术人员、调度操作员                              │
├─────────────────────────────────────────────────────────────┤
│                     ORG_VIEWER                              │
│  对本组织的仪表盘和报告拥有只读访问权限。                       │
│  适用于：管理层、审计人员、只读利益相关方                       │
└─────────────────────────────────────────────────────────────┘
```

### 权限矩阵

| 权限 | SOLFACIL_ADMIN | ORG_MANAGER | ORG_OPERATOR | ORG_VIEWER |
|------------|:-:|:-:|:-:|:-:|
| 查看仪表盘（本组织） | 所有组织 | 本组织 | 本组织 | 本组织 |
| 查看资产 | 所有组织 | 本组织 | 本组织 | 本组织 |
| 查看交易与收入 | 所有组织 | 本组织 | 本组织 | 本组织 |
| 调度模式变更 | 所有组织 | 本组织 | 本组织 | - |
| 触发 DR 测试 | 所有组织 | 本组织 | 本组织 | - |
| 管理费率配置 | 所有组织 | 本组织 | - | - |
| 管理组织内用户 | 所有组织 | 本组织 | - | - |
| 创建/删除组织 | 是 | - | - | - |
| 查看审计日志（跨组织） | 是 | - | - | - |

### Cognito 用户池 CDK 定义

```typescript
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly authorizer: HttpUserPoolAuthorizer;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // ── Cognito 用户池 ────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'VppUserPool', {
      userPoolName: resourceName(props.stage, 'UserPool'),
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      customAttributes: {
        org_id: new cognito.StringAttribute({
          mutable: false,
          minLen: 3,
          maxLen: 50,
        }),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Cognito 高级安全 ─────────────────────────────────────
    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.userPoolAddOns = { advancedSecurityMode: 'ENFORCED' };

    // ── 角色组 ───────────────────────────────────────────────
    const roles = ['SOLFACIL_ADMIN', 'ORG_MANAGER', 'ORG_OPERATOR', 'ORG_VIEWER'];
    for (const role of roles) {
      new cognito.CfnUserPoolGroup(this, `Group${role}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: role,
        description: `${role} role group`,
      });
    }

    // ── 应用客户端（仪表盘） ────────────────────────────────────
    this.userPoolClient = this.userPool.addClient('DashboardClient', {
      userPoolClientName: resourceName(props.stage, 'DashboardClient'),
      authFlows: { userPassword: true, userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:3000/callback', 'https://vpp.solfacil.com.br/callback'],
        logoutUrls: ['http://localhost:3000/', 'https://vpp.solfacil.com.br/'],
      },
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ── HTTP API 授权器 ───────────────────────────────────────
    this.authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', this.userPool, {
      userPoolClients: [this.userPoolClient],
      identitySource: '$request.header.Authorization',
    });

    // ── 令牌前置生成 Lambda 触发器 ───────────────────────
    const preTokenFn = new lambda.Function(this, 'PreTokenGeneration', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'pre-token-generation.handler',
      code: lambda.Code.fromAsset('src/auth/triggers'),
    });
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenFn,
    );
  }
}
```

### 企业 SSO 联合认证

#### SAML 2.0（Azure AD / Microsoft Entra ID）

```typescript
const azureAdProvider = new cognito.UserPoolIdentityProviderSaml(
  this, 'AzureAdSamlProvider', {
    userPool: this.userPool,
    name: 'AzureAD',
    metadata: cognito.UserPoolIdentityProviderSamlMetadata.url(
      'https://login.microsoftonline.com/<tenant-id>/federationmetadata/2007-06/federationmetadata.xml'
    ),
    attributeMapping: {
      email: cognito.ProviderAttribute.other(
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
      ),
      custom: {
        'custom:idp_sub': cognito.ProviderAttribute.other(
          'http://schemas.microsoft.com/identity/claims/objectidentifier'
        ),
      },
    },
    idpSignout: true,
  }
);
```

#### OIDC（Okta / Google Workspace）

```typescript
const oktaProvider = new cognito.UserPoolIdentityProviderOidc(
  this, 'OktaOidcProvider', {
    userPool: this.userPool,
    name: 'Okta',
    clientId: ssm.StringParameter.valueForStringParameter(this, '/solfacil/auth/okta/client-id'),
    clientSecret: ssm.StringParameter.valueForStringParameter(this, '/solfacil/auth/okta/client-secret'),
    issuerUrl: 'https://your-domain.okta.com/oauth2/default',
    scopes: ['openid', 'email', 'profile', 'groups'],
    attributeMapping: {
      email: cognito.ProviderAttribute.other('email'),
      custom: { 'custom:idp_sub': cognito.ProviderAttribute.other('sub') },
    },
    attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
  }
);
```

#### 联合用户映射（令牌前置生成 Lambda）

对于联合用户，`custom:org_id` 在登录时未设置。令牌前置生成触发器从 DynamoDB 映射表中注入 org_id 和角色：

```typescript
export const handler = async (event: CognitoUserPoolTriggerEvent) => {
  const email = event.request.userAttributes.email;
  const mapping = await dynamodb.get({
    TableName: 'federated_user_mappings',
    Key: { email },
  }).promise();

  if (mapping.Item) {
    event.response.claimsOverrideDetails = {
      claimsToAddOrOverride: { 'custom:org_id': mapping.Item.org_id },
      groupOverrideDetails: { groupsToOverride: [mapping.Item.role] },
    };
  }
  return event;
};
```

**DynamoDB：`federated_user_mappings`**

| PK (email) | org_id | role | idp_name | provisioned_at |
|------------|--------|------|----------|----------------|
| joao@energiacorp.com.br | ORG_ENERGIA_001 | ORG_MANAGER | AzureAD | 2026-02-20 |
| maria@solarbr.com.br | ORG_SOLARBR_002 | ORG_OPERATOR | Okta | 2026-02-20 |

#### SSO 回退策略

1. **检测：** Cognito 返回 `SAML_PROVIDER_ERROR` 或 OIDC 令牌交换失败
2. **回退：** 用户被重定向到标准 Cognito 登录页面
3. **紧急凭证：** ORG_MANAGER 用户拥有本地 Cognito 密码作为紧急备用
4. **监控：** CloudWatch 告警监测 `FederationErrors` 指标 → SNS 通知

```typescript
new cloudwatch.Alarm(this, 'SsoFailureAlarm', {
  metric: this.userPool.metric('FederationErrors', {
    period: cdk.Duration.minutes(5),
    statistic: 'Sum',
  }),
  threshold: 5,
  evaluationPeriods: 1,
  alarmDescription: 'SSO 联合认证错误超过阈值',
  alarmActions: [snsAlertTopic],
});
```

### 多因素认证（MFA）

| 角色 | MFA 要求 | 方式 | 理由 |
|------|----------------|--------|-----------|
| SOLFACIL_ADMIN | **强制** | TOTP | 平台级访问权限；最高特权 |
| ORG_MANAGER | **强制** | TOTP | 可进行调度和用户管理 |
| ORG_OPERATOR | **强制** | TOTP | 可向物理资产发送模式变更指令 |
| ORG_VIEWER | 可选 | TOTP | 只读权限；被攻击影响较低 |

**TOTP 优于 SMS：** TOTP 可离线使用（无 SIM 卡劫持风险）、免费、无需蜂窝信号，且符合 NIST SP 800-63B 2 级标准。

### 升级认证（敏感操作）

```typescript
/**
 * Middy 中间件：要求调度和管理操作必须进行近期 MFA 认证。
 * 如果 auth_time 早于 maxAge，返回 401 及升级认证质询。
 */
export function requireRecentAuth(
  maxAgeSeconds: number = 900 // 15 分钟
): middy.MiddlewareObj<APIGatewayProxyEventV2> {
  return {
    before: async (request) => {
      const claims = request.event.requestContext?.authorizer?.jwt?.claims;
      const authTime = Number(claims?.auth_time ?? 0);
      const now = Math.floor(Date.now() / 1000);
      if (now - authTime > maxAgeSeconds) {
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: 'step_up_required',
            message: 'This operation requires recent authentication. Please re-authenticate.',
          }),
        };
      }
    },
  };
}
```

### Lambda 处理函数

```
src/auth/
├── triggers/
│   └── pre-token-generation.ts   # Cognito 触发器：为联合用户注入 org_id
├── handlers/
│   ├── provision-org.ts          # POST /admin/organizations — 创建新组织
│   ├── create-user.ts            # POST /users — 在调用者的组织中创建用户
│   └── list-users.ts             # GET /users — 列出组织用户
└── __tests__/
    ├── pre-token-generation.test.ts
    └── provision-org.test.ts
```

---

## 10. 模块 7：开放 API 与集成

### CDK 栈：`OpenApiStack`

| 资源 | AWS 服务 | 用途 |
|----------|-------------|---------|
| API 网关（M2M） | API Gateway v2 (HTTP API) | **独立**于 BFF——用于外部集成 |
| 资源服务器 | Cognito Resource Server | OAuth 2.0 作用域：`solfacil/read`、`solfacil/dispatch`、`solfacil/billing` |
| 机器客户端 | Cognito App Client | 客户端凭证流程（无需用户登录） |
| 使用计划 | API Gateway Usage Plans | 按客户端的速率限制和配额 |
| WAF WebACL | AWS WAF v2 | OWASP 核心规则集、SQLi 防护、IP 速率限制 |
| Webhook 订阅 | DynamoDB | 自助式 Webhook 注册 |
| Webhook 连接 | EventBridge Connection | 出站 Webhook 的认证凭证 |
| API 目标 | EventBridge API Destination | 目标 URL + 出站 Webhook 的速率限制 |
| 签名代理 | Lambda (Node.js 20) | HMAC-SHA256 Webhook 载荷签名 |
| Webhook DLQ | SQS Queue | 失败的 Webhook 投递（14 天保留期） |

### IAM 授权

```
OpenApiStack resources:
  ├─ M2M Lambda functions:
  │   ├─ rds-data:ExecuteStatement  → 只读查询
  │   ├─ dynamodb:Query             → dispatch_tracker, webhook_subscriptions
  │   └─ timestream:Select          → device_telemetry
  ├─ Signing Proxy Lambda:
  │   └─ secretsmanager:GetSecret   → webhook HMAC 密钥
  ├─ Webhook CRUD Lambda:
  │   ├─ dynamodb:PutItem/Query/Delete → webhook_subscriptions
  │   ├─ events:PutRule/PutTargets     → 动态 EventBridge 规则
  │   └─ secretsmanager:CreateSecret   → 每个 Webhook 的 HMAC 密钥
  └─ WAF WebACL:
      └─ 关联到 M2M API Gateway 阶段
```

### EventBridge 集成

| 方向 | 事件 | 来源/目标 |
|-----------|-------|---------------|
| **消费** | `DRDispatchCompleted` | ← M3 → 向外部系统投递 Webhook |
| **消费** | `InvoiceGenerated` | ← M4 → 向计费系统投递 Webhook |
| **消费** | `AssetModeChanged` | ← M3 → 向监控系统投递 Webhook |
| **消费** | `TariffUpdated` | ← M4 → 向交易平台投递 Webhook |
| **消费** | `AlertTriggered` | ← M1 → 向值班系统投递 Webhook |

### org_id 集成

- M2M 令牌没有 `custom:org_id`；org_id 从 `m2m_client_config` DynamoDB 表解析
- `validateM2MScope()` 中间件将 client_id 映射到 org_id + 作用域
- Webhook EventBridge 规则按租户范围限定：`detail.org_id = [tenantContext.orgId]`
- Webhook 订阅表使用 `org_id` 作为分区键

### M2M 认证——两种方案

#### 方案 A：API Keys + 使用计划（低安全性集成）

```typescript
const usagePlan = api.addUsagePlan('ExternalPartnerPlan', {
  name: 'external-partner-plan',
  throttle: { rateLimit: 50, burstLimit: 100 },
  quota: { limit: 10_000, period: apigateway.Period.DAY },
});
const partnerKey = api.addApiKey('EnergiaCorpApiKey', {
  apiKeyName: 'energia-corp-erp',
});
usagePlan.addApiKey(partnerKey);
```

#### 方案 B：OAuth 2.0 客户端凭证（企业标准）

```typescript
// 带作用域访问的资源服务器
const resourceServer = this.userPool.addResourceServer('VppApi', {
  identifier: 'solfacil',
  userPoolResourceServerName: 'Solfacil VPP API',
  scopes: [
    new cognito.ResourceServerScope({ scopeName: 'read',     scopeDescription: 'Read assets, telemetry, trades' }),
    new cognito.ResourceServerScope({ scopeName: 'dispatch',  scopeDescription: 'Dispatch mode changes and DR' }),
    new cognito.ResourceServerScope({ scopeName: 'billing',   scopeDescription: 'Billing, revenue, tariff data' }),
  ],
});

// 机器客户端（客户端凭证流程）
const machineClient = this.userPool.addClient('EnergiaCorp-ERP', {
  userPoolClientName: 'energia-corp-erp-m2m',
  generateSecret: true,
  oAuth: {
    flows: { clientCredentials: true },
    scopes: [
      cognito.OAuthScope.custom('solfacil/read'),
      cognito.OAuthScope.custom('solfacil/billing'),
    ],
  },
  accessTokenValidity: cdk.Duration.hours(1),
});
```

#### 推荐矩阵

| 使用场景 | 推荐方案 | 理由 |
|----------|-------------|-----------|
| Solfacil 内部 ERP | 客户端凭证 | 敏感的计费数据；需要范围化访问 |
| 外部能源聚合商 | 客户端凭证 | 第三方信任边界；可撤销令牌 |
| 能源交易平台 | 客户端凭证 | 金融交易；需要审计跟踪 |
| 监控/健康检查 | API Key | 低敏感度只读；设置更简单 |

### 速率限制与配额层级

| 层级 | 速率限制 | 突发 | 每日配额 | 每月配额 |
|------|-----------|-------|-------------|---------------|
| 标准版 | 50 rps | 100 | 10,000 | 300,000 |
| 专业版 | 200 rps | 400 | 100,000 | 3,000,000 |
| 企业版 | 500 rps | 1,000 | 无限制 | 无限制 |

### WAF WebACL

```typescript
const webAcl = new wafv2.CfnWebACL(this, 'VppApiWaf', {
  name: resourceName(props.stage, 'VppApiWaf'),
  scope: 'REGIONAL',
  defaultAction: { allow: {} },
  visibilityConfig: {
    sampledRequestsEnabled: true,
    cloudWatchMetricsEnabled: true,
    metricName: 'VppApiWaf',
  },
  rules: [
    {
      name: 'AWS-AWSManagedRulesCommonRuleSet',
      priority: 1,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
      },
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'CommonRuleSet' },
    },
    {
      name: 'AWS-AWSManagedRulesSQLiRuleSet',
      priority: 2,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesSQLiRuleSet' },
      },
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'SQLiRuleSet' },
    },
    {
      name: 'RateLimit',
      priority: 3,
      action: { block: {} },
      statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'RateLimit' },
    },
  ],
});
```

### 事件驱动 Webhook

#### 架构

```
内部事件 ──► EventBridge ──► 规则（组织范围限定）──► 签名代理 Lambda ──► API Destination ──► 外部系统
                                                                                         │
                                                                                  （最多重试 185 次 / 24 小时）
                                                                                         │
                                                                                  ──► SQS DLQ（重试耗尽后）
```

#### 支持 Webhook 的事件

| 事件 | 典型订阅者 |
|-------|-------------------|
| `DRDispatchCompleted` | 计费系统、电网运营商仪表盘 |
| `DRDispatchFailed` | 监控/告警平台 |
| `InvoiceGenerated` | 客户 ERP、会计系统 |
| `AssetModeChanged` | 监控仪表盘、聚合商平台 |
| `AlertTriggered` | 值班通知系统 |
| `TariffUpdated` | 交易平台、客户门户 |

#### HMAC-SHA256 Webhook 签名

每个出站 Webhook 包含两个自定义头：

| 头字段 | 值 | 用途 |
|--------|-------|---------|
| `X-Solfacil-Signature` | `sha256=<hex-digest>` | 原始请求体的 HMAC-SHA256 |
| `X-Solfacil-Timestamp` | Unix 时间戳 | 防止重放攻击 |

签名计算方式：
```
signature = HMAC-SHA256(key=webhook_secret, message=timestamp + "." + raw_body)
```

接收方应拒绝时间戳超过 5 分钟的 Webhook。

```typescript
async function signWebhookPayload(
  payload: Record<string, unknown>,
  secretArn: string,
): Promise<SignedWebhookResult> {
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  const webhookSecret = secretResponse.SecretString!;
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Solfacil-Signature': `sha256=${signature}`,
      'X-Solfacil-Timestamp': timestamp,
    },
    body,
  };
}
```

#### DynamoDB：`webhook_subscriptions`

```
Table: webhook_subscriptions
PK: org_id (String)          — 分区键（租户隔离）
SK: webhook_id (String)      — 排序键（ULID — "WH_01HWXYZ..."）
Attributes:
  url           (String)     — Webhook POST 的目标 URL
  events        (StringSet)  — 订阅的事件类型
  secret_arn    (String)     — Secrets Manager 中 HMAC 密钥的 ARN
  rule_name     (String)     — 动态创建的 EventBridge 规则名称
  status        (String)     — "active" | "paused" | "failed"
  created_at    (String)     — ISO 8601
  updated_at    (String)     — ISO 8601
```

#### Webhook 管理 API

| 方法 | 路径 | 认证 | 描述 |
|--------|------|------|-------------|
| `POST` | `/webhooks` | ORG_MANAGER | 注册新的 Webhook 订阅 |
| `GET` | `/webhooks` | ORG_MANAGER | 列出组织的 Webhook 订阅 |
| `GET` | `/webhooks/{id}` | ORG_MANAGER | 获取特定 Webhook |
| `DELETE` | `/webhooks/{id}` | ORG_MANAGER | 删除 Webhook 订阅 |

#### 重试策略与死信队列

| 重试阶段 | 尝试次数 | 间隔 | 总持续时间 |
|-------------|----------|----------|---------------|
| 即时 | 1-5 | 1-30 秒 | 约 2 分钟 |
| 短退避 | 6-50 | 30 秒-5 分钟 | 约 3 小时 |
| 长退避 | 51-185 | 5 分钟-30 分钟 | 约 24 小时 |

经过 185 次重试（24 小时）后，失败的事件进入 SQS 死信队列（14 天保留期）。

### Lambda 处理函数

```
src/open-api/
├── handlers/
│   ├── m2m-get-assets.ts         # M2M：GET /v1/assets
│   ├── m2m-get-telemetry.ts      # M2M：GET /v1/telemetry
│   ├── m2m-get-dispatches.ts     # M2M：GET /v1/dispatches
│   ├── webhook-create.ts         # POST /webhooks
│   ├── webhook-list.ts           # GET /webhooks
│   ├── webhook-delete.ts         # DELETE /webhooks/{id}
│   └── webhook-signing-proxy.ts  # EventBridge → 签名 → API Destination
├── middleware/
│   └── m2m-scope.ts              # validateM2MScope() + client→org_id 解析
└── __tests__/
    ├── m2m-scope.test.ts
    └── webhook-create.test.ts
```

---

## 11. 核心事件流程示例

### 11.1 DR 测试命令流程（前端 → 边缘设备）

```
步骤  组件                     操作
----- ---------------------- -------------------------------------------------
 1    前端（仪表盘）           POST /dr-test { targetMode: "peak_valley_arbitrage" }
                             Headers: Authorization: Bearer <Cognito JWT>

 2    API Gateway (M5)       Cognito Authorizer 验证 JWT → role=ORG_OPERATOR
                             extractTenantContext() → org_id=ORG_ENERGIA_001
                             requireRecentAuth() → auth_time 在 15 分钟内
                             路由 → Lambda: post-dr-test

 3    BFF Lambda             验证请求负载
      (post-dr-test)         查询 assets WHERE org_id = 'ORG_ENERGIA_001'
                             创建 dispatch_id (ULID)
                             发布事件到 EventBridge:
                             {
                               source: "solfacil.bff",
                               detail-type: "DRCommandIssued",
                               detail: {
                                 org_id: "ORG_ENERGIA_001",
                                 dispatch_id: "01HWXYZ...",
                                 command_type: "DR_TEST",
                                 target_mode: "peak_valley_arbitrage",
                                 asset_ids: ["ASSET_SP_001", "ASSET_RJ_002", ...],
                                 requested_by: "operador@energiacorp.com.br",
                               }
                             }
                             返回: { dispatch_id, status: "ACCEPTED" }

 4    EventBridge            规则: detail-type = "DRCommandIssued"
                             目标: M3 Lambda (dispatch-command)

 5    DR Dispatcher          对每个 asset_id 并行执行:
                               a. 将 PENDING 写入 DynamoDB（包含 org_id）
                               b. MQTT 发布: solfacil/ORG_ENERGIA_001/SP/ASSET_SP_001/command/mode-change
                               c. 更新状态 → EXECUTING
                               d. 将延迟消息加入 SQS 队列（15 分钟超时）

 6    IoT Core MQTT          投递到边缘设备（QoS 1，约 50-200ms）

 7    边缘设备               执行模式切换，发布响应到响应主题

 8    IoT Core Rule          SELECT * FROM 'solfacil/+/+/+/response/mode-change'
                             → M3 Lambda (collect-response)

 9    DR Dispatcher          更新 DynamoDB: status → SUCCESS，记录指标
      (collect-response)     当所有资产完成 → 发布 DRDispatchCompleted

10    EventBridge            扇出 DRDispatchCompleted:
                             → M4（财务结算）
                             → M5（未来：WebSocket 推送）
                             → M7（Webhook 投递到外部系统）

11    前端                   每 2 秒轮询 GET /dispatch/{id}
                             渲染每个资产的进度条、延迟、准确率
```

### 11.2 遥测数据采集流程

```
边缘设备 → MQTT publish (solfacil/{org_id}/{region}/{asset_id}/telemetry)
    → IoT Core Rule（从主题中提取 org_id, region, asset_id）
    → M1 Lambda (ingest-telemetry)
        → 批量写入 Timestream（包含 org_id 维度）
        → 发布 EventBridge: "TelemetryReceived"（包含 org_id）
            → M2 Lambda (evaluate-forecast): 更新 MAPE
            → M5（未来：通过 WebSocket 推送）
```

### 11.3 定时优化流程

```
EventBridge Schedule（每 15 分钟）
    → M2 Lambda (run-schedule)
        → 查询 Timestream 获取最新 SoC（按组织）
        → 查询 M4 获取当前电价（按组织）
        → 计算最优调度方案（按组织）
        → 发布 "ScheduleGenerated"（包含 org_id）
            → M1 Lambda (schedule-to-shadow): 将调度方案写入 Device Shadow
            → M3 Lambda (dispatch-command): 执行即时模式切换
            → M4 Lambda: 记录预期收益
```

### 11.4 Webhook 投递流程

```
M3 发布 DRDispatchCompleted (org_id=ORG_ENERGIA_001)
    → EventBridge 规则: webhook-ORG_ENERGIA_001-WH_01HWXYZ
        匹配: source=solfacil.vpp.*, detail.org_id=ORG_ENERGIA_001
    → M7 Lambda (webhook-signing-proxy)
        → 从 Secrets Manager 获取 HMAC 密钥
        → 使用 HMAC-SHA256 签名负载
        → 附加 X-Solfacil-Signature + X-Solfacil-Timestamp 请求头
    → API Destination: POST https://billing.partner.com/webhooks/solfacil
        → 200 OK → 完成
        → 5xx   → 重试（最多 185 次 / 24 小时）
        → 重试耗尽 → SQS DLQ → CloudWatch 告警 → 值班通知
```

---

## 12. 统一 CDK 部署计划

### 7 个阶段

```
阶段 0: SharedStack ──► 阶段 1: AuthStack ──► 阶段 2: IotHub + Algorithm
                                                         │
                                                         ▼
                                              阶段 3: DrDispatcher + MarketBilling
                                                         │
                                                         ▼
                                              阶段 4: BffStack (Cognito authorizer)
                                                         │
                                                         ▼
                                              阶段 5: OpenApiStack (M2M + Webhooks)
                                                         │
                                                         ▼
                                              阶段 6: 业务逻辑实现
```

### 阶段 0: SharedStack

**用途：** 所有模块共享的基础资源。

```typescript
export class SharedStack extends cdk.Stack {
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: SharedStackProps) {
    super(scope, id, props);

    this.eventBus = new events.EventBus(this, 'VppEventBus', {
      eventBusName: 'solfacil-vpp-events',
    });

    // EventBridge 归档（30 天重放，用于调试）
    new events.Archive(this, 'VppEventArchive', {
      sourceEventBus: this.eventBus,
      eventPattern: { source: [{ prefix: 'solfacil' }] },
      retention: cdk.Duration.days(30),
    });

    // SSM 参数用于跨堆栈配置
    new ssm.StringParameter(this, 'EventBusArn', {
      parameterName: '/solfacil/shared/event-bus-arn',
      stringValue: this.eventBus.eventBusArn,
    });
  }
}
```

**关键资源：** EventBridge 总线、归档、SSM 参数。

### 阶段 1: AuthStack (M6 — 身份与租户)

**用途：** Cognito User Pool、组、SSO 提供商、MFA、Pre-Token Lambda。

**关键资源：** Cognito User Pool、App Client、SAML/OIDC 提供商、Pre-Token-Generation Lambda 触发器、`federated_user_mappings` DynamoDB 表。

**为何优先部署：** 所有处理 API 请求的后续堆栈都需要 Cognito authorizer。优先部署认证层确保从第一天起每个端点都受到保护。

**输出被以下堆栈消费：** BffStack（authorizer）、OpenApiStack（Resource Server、Machine Clients）。

### 阶段 2: IotHubStack (M1) + AlgorithmStack (M2)

**用途：** 设备连接与优化智能。

**关键资源：**
- M1: IoT Core 规则、Timestream 数据库/表、采集 Lambda、shadow-sync Lambda
- M2: EventBridge Scheduler、优化器 Lambda、SSM 配置参数

**依赖：** SharedStack（EventBridge 总线）。

### 阶段 3: DrDispatcherStack (M3) + MarketBillingStack (M4)

**用途：** 命令调度与财务数据。

**关键资源：**
- M3: DynamoDB `dispatch_tracker`（含 `org-dispatch-index` GSI）、调度 Lambda、SQS 超时队列
- M4: RDS Serverless v2 PostgreSQL、`organizations` 表、所有包含 `org_id` 的 schema 迁移

**依赖：** SharedStack（EventBridge）、IoT Core（M1 用于 MQTT 发布）。

### 阶段 4: BffStack (M5)

**用途：** 带有 Cognito 授权的仪表盘 REST API。

**关键资源：** API Gateway v2 (HTTP API)、Cognito Authorizer（来自 AuthStack）、包含 `extractTenantContext()` 中间件的 Lambda 处理函数。

**依赖：** AuthStack（authorizer）、所有数据层堆栈（M1-M4 用于读取查询）。

### 阶段 5: OpenApiStack (M7)

**用途：** 外部 API 访问与 Webhook 投递。

**关键资源：** 独立的 API Gateway（M2M）、Cognito Resource Server + Machine Clients、WAF WebACL、DynamoDB `webhook_subscriptions`、EventBridge API Destinations、签名代理 Lambda、Webhook DLQ。

**依赖：** AuthStack（Cognito User Pool 用于 Resource Server）、SharedStack（EventBridge 用于 Webhook 规则）。

### 阶段 6: 业务逻辑实现

**用途：** 在每个模块的 Lambda 处理函数中实现实际业务逻辑（在所有 IaC 验证通过后，按模块逐步实现）。

**实现顺序：**
1. M4 处理函数（电价引擎、收益计算器）— 支撑仪表盘财务数据
2. M5 处理函数（BFF）— 将前端连接到真实 API
3. M1 处理函数（遥测数据采集）— 真实设备数据流
4. M2 处理函数（优化算法）— 调度方案生成
5. M3 处理函数（调度、响应收集）— 真实 DR 命令
6. M6 处理函数（组织配置、用户管理）— 管理操作
7. M7 处理函数（M2M 端点、Webhook CRUD）— 外部集成

### CDK 入口文件 (`bin/app.ts`)

```typescript
const app = new cdk.App();
const stage = app.node.tryGetContext('stage') ?? 'dev';

// 阶段 0: 共享
const shared = new SharedStack(app, `SolfacilVpp-${stage}-Shared`, { stage });

// 阶段 1: 认证 (M6)
const auth = new AuthStack(app, `SolfacilVpp-${stage}-Auth`, { stage });

// 阶段 2: IoT + 算法 (M1, M2)
const iotHub = new IotHubStack(app, `SolfacilVpp-${stage}-IotHub`, {
  stage, eventBus: shared.eventBus,
});
const algorithm = new AlgorithmStack(app, `SolfacilVpp-${stage}-Algorithm`, {
  stage, eventBus: shared.eventBus,
});

// 阶段 3: DR + 计费 (M3, M4)
const drDispatcher = new DrDispatcherStack(app, `SolfacilVpp-${stage}-DrDispatcher`, {
  stage, eventBus: shared.eventBus,
});
const marketBilling = new MarketBillingStack(app, `SolfacilVpp-${stage}-MarketBilling`, {
  stage, eventBus: shared.eventBus,
});

// 阶段 4: BFF (M5)
const bff = new BffStack(app, `SolfacilVpp-${stage}-Bff`, {
  stage, eventBus: shared.eventBus,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  authorizer: auth.authorizer,
});

// 阶段 5: Open API (M7)
const openApi = new OpenApiStack(app, `SolfacilVpp-${stage}-OpenApi`, {
  stage, eventBus: shared.eventBus,
  userPool: auth.userPool,
});
```

---

## 13. 后端目录结构

```
backend/
├── README.md
├── package.json                          # Monorepo 根目录（npm workspaces）
├── tsconfig.base.json                    # 共享 TypeScript 配置
├── cdk.json                              # CDK 应用入口
├── jest.config.ts                        # 根测试配置
│
├── bin/
│   └── app.ts                            # CDK App: 实例化全部 8 个堆栈
│
├── lib/                                  # CDK Stack 定义（7 个阶段）
│   ├── shared/
│   │   ├── event-bus.ts                  # 共享 EventBridge 总线构造
│   │   ├── event-schemas.ts              # 事件类型定义（含 org_id 的 VppEvent<T>）
│   │   └── constants.ts                  # 账户、区域、命名规范
│   │
│   ├── shared-stack.ts                   # 阶段 0: SharedStack
│   ├── auth-stack.ts                     # 阶段 1: M6 — Cognito、SSO、MFA
│   ├── iot-hub-stack.ts                  # 阶段 2: M1 — IoT Core + Timestream
│   ├── algorithm-stack.ts               # 阶段 2: M2 — Scheduler + 算法
│   ├── dr-dispatcher-stack.ts           # 阶段 3: M3 — Dispatch + SQS + DynamoDB
│   ├── market-billing-stack.ts          # 阶段 3: M4 — RDS + 计费
│   ├── bff-stack.ts                     # 阶段 4: M5 — API GW + Cognito authorizer
│   └── open-api-stack.ts               # 阶段 5: M7 — M2M API + WAF + Webhooks
│
├── src/                                  # Lambda 处理函数源代码
│   ├── shared/                           # 横切关注点
│   │   ├── event-bridge-client.ts
│   │   ├── logger.ts                     # 结构化日志（Powertools）
│   │   ├── middleware.ts                 # Middy 中间件链
│   │   ├── errors.ts                     # 自定义错误类
│   │   └── types/
│   │       ├── asset.ts
│   │       ├── tariff.ts
│   │       ├── telemetry.ts
│   │       ├── events.ts                 # 事件负载接口（含 org_id）
│   │       └── auth.ts                   # TenantContext、Role 类型
│   │
│   ├── iot-hub/                          # 模块 1
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   └── __tests__/ ...
│   │
│   ├── optimization-engine/              # 模块 2
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   └── __tests__/ ...
│   │
│   ├── dr-dispatcher/                    # 模块 3
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   └── __tests__/ ...
│   │
│   ├── market-billing/                   # 模块 4
│   │   ├── handlers/ ...
│   │   ├── services/ ...
│   │   ├── migrations/ ...
│   │   └── __tests__/ ...
│   │
│   ├── bff/                              # 模块 5
│   │   ├── handlers/ ...
│   │   ├── middleware/
│   │   │   ├── tenant-context.ts         # extractTenantContext()、requireRole()
│   │   │   ├── cors.ts
│   │   │   └── rate-limit.ts
│   │   └── __tests__/ ...
│   │
│   ├── auth/                             # 模块 6
│   │   ├── triggers/
│   │   │   └── pre-token-generation.ts
│   │   ├── handlers/ ...
│   │   └── __tests__/ ...
│   │
│   └── open-api/                         # 模块 7
│       ├── handlers/ ...
│       ├── middleware/
│       │   └── m2m-scope.ts              # validateM2MScope()
│       └── __tests__/ ...
│
├── test/                                 # CDK 基础设施测试
│   ├── shared-stack.test.ts
│   ├── auth-stack.test.ts
│   ├── iot-hub-stack.test.ts
│   ├── dr-dispatcher-stack.test.ts
│   ├── bff-stack.test.ts
│   ├── open-api-stack.test.ts
│   └── event-routing.test.ts
│
└── scripts/
    ├── seed-tariffs.ts                   # 向 RDS 填充 Tarifa Branca 数据
    ├── seed-users.ts                     # 向 Cognito 填充测试用户
    ├── simulate-telemetry.ts             # 用于开发的本地 MQTT 模拟器
    └── deploy.sh                         # 多堆栈部署脚本
```

---

## 14. 可观测性

| 层级 | 工具 | 用途 |
|------|------|------|
| 结构化日志 | AWS Lambda Powertools (TS) | 关联 ID、JSON 日志、`dispatch_id` + `org_id` 追踪 |
| 指标 | CloudWatch Embedded Metrics | 每个模块的延迟、错误率、调用次数 |
| 链路追踪 | AWS X-Ray | 跨 Lambda + EventBridge 的端到端请求追踪 |
| 仪表盘 | CloudWatch Dashboards | 按限界上下文划分的运维仪表盘 |
| 告警 | CloudWatch Alarms + SNS | DR 调度失败率 > 10%、Lambda 错误、SSO 故障、Webhook DLQ |
| 事件审计 | EventBridge Archive | 重放事件用于调试（30 天保留） |
| 安全审计 | CloudWatch Logs Insights | 所有写操作的结构化审计日志 |

### 关键指标

| 指标 | 来源 | 告警阈值 |
|------|------|----------|
| DR 调度响应延迟 P95 | M3 | > 5s |
| DR 调度准确率 % | M3 | < 90% |
| 优化 Alpha 趋势 | M2 | < 70% |
| 预测 MAPE 趋势 | M2 | > 15% |
| 每资产每日收益 | M4 | —（仅仪表盘展示） |
| MQTT 投递成功率 | M1 | < 99% |
| SSO 联合认证错误（5 分钟） | M6 | > 5 次错误 |
| API 限流率（5 分钟） | M7 | > 100 次拒绝 |
| WAF 拦截请求数（5 分钟） | M7 | > 50 次拦截 |
| Webhook DLQ 深度 | M7 | > 0 条消息 |

### 审计日志格式

所有写操作（调度、电价更新、用户管理、Webhook CRUD）均输出结构化审计日志：

```json
{
  "timestamp": "2026-02-20T14:30:00Z",
  "action": "DISPATCH_MODE_CHANGE",
  "actor": {
    "userId": "sub-uuid",
    "email": "operador@energiacorp.com.br",
    "orgId": "ORG_ENERGIA_001",
    "role": "ORG_OPERATOR"
  },
  "resource": { "type": "dispatch", "id": "01HWXYZ..." },
  "details": { "assetIds": ["ASSET_SP_001", "ASSET_RJ_002"], "targetMode": "peak_valley_arbitrage" }
}
```

---

## 15. 成本估算

### 试点规模（4 个资产，约 3,000 台设备，约 100 万遥测数据点/天）

| 服务 | 类别 | 月成本（美元） |
|------|------|----------------|
| IoT Core (MQTT 消息) | M1 | 约 $15 |
| Timestream（100 万写入/天，90 天保留） | M1 | 约 $40 |
| Lambda（所有模块，约 50 万次调用） | 全部 | 约 $5 |
| API Gateway (HTTP API，约 10 万次请求) | M5 | 约 $1 |
| EventBridge（自定义事件） | 共享 | 约 $2 |
| DynamoDB (dispatch_tracker + webhook_subscriptions，按需模式) | M3/M7 | 约 $5 |
| RDS Serverless v2（最小 0.5 ACU） | M4 | 约 $45 |
| Cognito（100 用户，TOTP MFA） | M6 | 免费套餐 |
| Cognito Advanced Security（100 MAU） | M6 | 约 $5 |
| WAF WebACL（3 个托管规则，约 10 万次请求） | M7 | 约 $11 |
| EventBridge API Destinations（Webhooks） | M7 | 约 $1 |
| Secrets Manager（Webhook 密钥） | M7 | 约 $2 |
| CloudWatch / X-Ray | 可观测性 | 约 $10 |
| **合计（试点）** | | **约 $142/月** |

### 增长规模预测

| 规模 | 设备数 | 月估算（美元） |
|------|--------|----------------|
| 试点 | 3,000 | 约 $142 |
| 增长期（1K 资产） | 10,000 | 约 $450-600 |
| 生产环境（10K 资产） | 50,000 | 约 $2,500-3,500 |

| 规模化成本驱动因素 | 说明 |
|---------------------|------|
| Timestream 写入 | 最大成本驱动因素；考虑对旧数据仅保留磁性存储 |
| IoT Core MQTT | 随设备数 × 消息频率线性增长 |
| RDS ACU 伸缩 | Serverless v2 自动伸缩；监控 ACU 使用量 |
| Cognito MAU | 前 50K MAU 为 $0.0055/MAU；超过 50K 为 $0.0046/MAU |
| WAF 请求量 | 基础费用之外 $0.60/百万次请求 |
| EventBridge API Destinations | $0.20/百万次调用（Webhook 投递） |

### 成本优化策略

1. **Timestream：** 如果实时查询不需要完整一天的数据，将内存存储保留期从 24 小时缩短到 6 小时
2. **Lambda：** 对计算密集型处理函数（M2）使用 ARM64 (Graviton2) 可降低 20% 计算成本
3. **DynamoDB：** 已使用按需模式；不存在过度预配风险
4. **Cognito：** 50K MAU 以下保持免费套餐；超出后 $0.0055/MAU 相比 Auth0 具有成本优势
5. **WAF：** 核心规则集每月 $1/规则组，费用极低；避免自定义规则过度膨胀

---

## 16. 安全态势总结

### 零信任检查清单

| 层级 | 控制措施 | 状态 |
|------|----------|------|
| **前端 → API Gateway** | Cognito JWT (ID token) | 在所有 BFF 路由上强制执行 |
| **M2M → API Gateway** | OAuth 2.0 Client Credentials 或 API Key | 在所有 M2M 路由上强制执行 |
| **API Gateway → WAF** | OWASP Core Rule Set + SQLi + IP 速率限制 | 已部署在 M7 API 上 |
| **Lambda → AWS 服务** | IAM Roles（每个模块最小权限） | 无共享 IAM 角色 |
| **PostgreSQL** | Row-Level Security (RLS) | 在所有租户表上纵深防御 |
| **DynamoDB** | org_id 作为 GSI 分区键 | 所有查询均限定租户范围 |
| **Timestream** | org_id 作为必填维度 | 所有查询包含 WHERE org_id |
| **IoT Core → 边缘设备** | 每设备 X.509 客户端证书 | 主题策略限定在组织范围内 |
| **MQTT 主题** | 主题路径中包含 org_id | IoT 策略限定到组织命名空间 |
| **EventBridge** | 基于资源的策略（按总线） | 仅声明的来源可发布 |
| **密钥管理** | Secrets Manager 30 天轮换 | RDS 凭据、API 密钥、Webhook 密钥 |
| **MFA** | 对具有调度权限的角色强制 TOTP | Cognito User Pool: MFA REQUIRED |
| **增强认证** | 敏感操作需在 15 分钟内重新认证 | requireRecentAuth() 中间件 |
| **审计日志** | 所有写操作的结构化 JSON 日志 | CloudWatch Logs Insights |
| **Webhook 安全** | HMAC-SHA256 签名 + 时间戳防重放 | X-Solfacil-Signature 请求头 |

### 威胁模型

| 威胁 | 缓解措施 |
|------|----------|
| 水平权限提升 | 中间件 `org_id` 过滤 + PostgreSQL RLS + DynamoDB GSI 范围限定 |
| 垂直权限提升 | `requireRole()` 中间件 + Cognito 组强制执行 |
| JWT 篡改 | API Gateway Cognito authorizer 通过 JWKS 端点验证 |
| 通过 XSS 窃取令牌 | 令牌存储在内存中（非 localStorage）；1 小时 TTL；刷新令牌使用 HttpOnly cookies |
| CSRF | 请求头中使用 Bearer token（非 cookies）；CSRF 不适用 |
| 不安全的直接对象引用 | 所有权检查对跨组织资源返回 404（而非 403） |
| 管理员账户被盗用 | MFA 强制；Cognito Advanced Security（基于风险的阻止） |
| 跨租户 MQTT 流量 | IoT Core 策略将设备证书限制在组织的主题命名空间内 |
| API 滥用 / DDoS | WAF 基于速率的规则 + API Gateway 限流 + Usage Plan 配额 |
| Webhook 重放攻击 | HMAC-SHA256 包含时间戳；接收方拒绝超过 5 分钟的旧消息 |
| Webhook 密钥泄露 | Secrets Manager 90 天轮换；7 天双密钥重叠期 |

### ISO 27001 对齐说明

| ISO 27001 控制项 | VPP 实现 |
|------------------|----------|
| A.9 访问控制 | Cognito RBAC（4 个角色）、MFA、增强认证 |
| A.10 密码学 | TLS 1.3 (MQTT, HTTPS)、HMAC-SHA256 (Webhooks)、静态加密 (RDS, DynamoDB, Timestream) |
| A.12 运营安全 | CloudWatch 告警、结构化审计日志、EventBridge Archive |
| A.13 通信安全 | IoT Core mTLS、RDS 访问使用 VPC、外部 API 使用 WAF |
| A.14 系统采购 | CDK IaC（版本控制、同行评审的基础设施） |
| A.18 合规性 | 通过租户隔离 + 审计追踪实现 LGPD 合规 |

### LGPD（巴西通用数据保护法）合规说明

巴西的 LGPD（相当于 GDPR）要求：

1. **数据隔离** — 通过所有数据存储中的 `org_id` + RLS + IoT 策略确保
2. **数据最小化** — Timestream 保留策略：24 小时内存 + 90 天磁性存储；EventBridge Archive：30 天
3. **删除权** — 组织删除工作流可按 `org_id` 清除所有数据（PostgreSQL CASCADE、DynamoDB 批量删除、Timestream：记录自然过期）
4. **知情同意与目的** — 登录时采集同意；审计日志记录所有数据访问
5. **数据可携带性** — BFF API + M2M API 提供对所有组织数据的标准 JSON 访问
6. **数据泄露通知** — CloudWatch 告警 + SNS 升级链支持 72 小时泄露通知 SLA
7. **DPO 访问** — SOLFACIL_ADMIN 角色为数据保护官提供跨组织审计能力

---

## 17. 附录：事件目录

通过共享 EventBridge 总线（`solfacil-vpp-events`）流转的所有事件：

| 事件 | 来源 | 详情类型 | 消费者 | 频率 |
|------|------|----------|--------|------|
| `TelemetryReceived` | `solfacil.iot-hub` | TelemetryReceived | M2 | 约 100 万/天 |
| `DeviceStatusChanged` | `solfacil.iot-hub` | DeviceStatusChanged | M4, M5, M7 | 状态变更时 |
| `ScheduleGenerated` | `solfacil.optimization` | ScheduleGenerated | M1, M3, M4 | 每 15 分钟 |
| `ForecastUpdated` | `solfacil.optimization` | ForecastUpdated | M5 | 每小时 |
| `DRCommandIssued` | `solfacil.bff` | DRCommandIssued | M3 | 按需 |
| `DRDispatchCompleted` | `solfacil.dr-dispatcher` | DRDispatchCompleted | M4, M5, M7 | 按需 |
| `AssetModeChanged` | `solfacil.dr-dispatcher` | AssetModeChanged | M4, M7 | 按需 |
| `ProfitCalculated` | `solfacil.market-billing` | ProfitCalculated | M5 | 每日 |
| `InvoiceGenerated` | `solfacil.market-billing` | InvoiceGenerated | M5, M7 | 每月 |
| `TariffUpdated` | `solfacil.market-billing` | TariffUpdated | M2, M3, M7 | 管理员变更时 |
| `OrgProvisioned` | `solfacil.auth` | OrgProvisioned | M4, M1 | 管理员操作时 |
| `UserCreated` | `solfacil.auth` | UserCreated | 审计 | 管理员操作时 |
| `AlertTriggered` | `solfacil.iot-hub` | AlertTriggered | M7 | 异常时 |
| `ConfigUpdated` | `solfacil.admin-control-plane` | ConfigUpdated | M1-M7（config-refresh Lambdas） | 管理员配置变更时 |

### 强制事件信封

每个事件**必须**在其 detail 负载中包含 `org_id`：

```typescript
interface VppEventDetail {
  readonly org_id: string;  // 必填 — 永远不可省略
  readonly timestamp: string;
  // ...事件特定字段
}
```

### 边界情况：含超时的 DRDispatchCompleted

| 场景 | `aggregate.status` | 描述 |
|------|-------------------|------|
| 所有设备响应 | `SUCCESS` | 正常路径 |
| 部分设备响应，部分超时 | `PARTIAL_SUCCESS` | 混合结果；`failed_count > 0`，单个设备 `error_reason: "TIMEOUT"` |
| 所有设备超时 | `FAILED` | 完全失败；15 分钟内无设备响应 |

示例负载：
```json
{
  "source": "solfacil.dr-dispatcher",
  "detail-type": "DRDispatchCompleted",
  "detail": {
    "org_id": "ORG_ENERGIA_001",
    "dispatch_id": "01HWXYZ...",
    "command_type": "DR_TEST",
    "resolution": "TIMEOUT",
    "results": [
      { "asset_id": "ASSET_SP_001", "status": "SUCCESS", "latency": 1.73, "accuracy": 96.4 },
      { "asset_id": "ASSET_MG_003", "status": "FAILED", "error_reason": "TIMEOUT" }
    ],
    "aggregate": {
      "success_count": 2, "failed_count": 2, "timeout_count": 2,
      "avg_latency": 1.94, "total_power": 9.64, "avg_accuracy": 95.1,
      "status": "PARTIAL_SUCCESS"
    }
  }
}
```

---

## 18. 附录：Cognito CLI 与测试用户

### CLI 快速参考

```bash
# 创建用户（管理员配置）
aws cognito-idp admin-create-user \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --user-attributes \
    Name=email,Value=joao@energiacorp.com.br \
    Name=email_verified,Value=true \
    Name=custom:org_id,Value=ORG_ENERGIA_001 \
  --temporary-password "TempPass123!"

# 将用户添加到角色组
aws cognito-idp admin-add-user-to-group \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --group-name ORG_MANAGER

# 列出某组织的用户
aws cognito-idp list-users \
  --user-pool-id sa-east-1_XXXXXXX \
  --filter 'custom:org_id = "ORG_ENERGIA_001"'

# 列出某角色组中的用户
aws cognito-idp list-users-in-group \
  --user-pool-id sa-east-1_XXXXXXX \
  --group-name SOLFACIL_ADMIN
```

### 测试用户种子数据

| 邮箱 | 组织 | 角色 | 用途 |
|------|------|------|------|
| `admin@solfacil.com.br` | SOLFACIL | SOLFACIL_ADMIN | 平台管理员（全组织） |
| `gerente@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_MANAGER | 组织管理者（Energia Corp） |
| `operador@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_OPERATOR | 调度操作员 |
| `auditor@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_VIEWER | 只读查看者 |
| `gerente@solarbr.com.br` | ORG_SOLARBR_002 | ORG_MANAGER | 组织管理者（Solar BR） |
| `operador@solarbr.com.br` | ORG_SOLARBR_002 | ORG_OPERATOR | 调度操作员 |

---

## 19. 数据策略与防腐层

> **ADR 状态：** ACCEPTED | **决策日期：** 2026-02-20
> **范围：** 影响 M1（IoT Hub）和 M4（Market & Billing）的跨领域架构决策
> **驱动因素：** 业务可扩展性、厂商中立性、零停机 schema 演进

本章定义了两项基础架构决策，用于保护 VPP 核心免受外部变化的冲击：一套用于资产数据（M4）的可扩展元数据策略，以及一套用于遥测数据（M1）的双通道摄入防腐层。两项决策均遵循**将变化部分与稳定部分隔离**的原则。

---

### 19.1 Module 4 — 可扩展元数据设计

#### 背景与业务痛点

VPP 资产属性随着业务发展不断增长。新增属性包括设备型号、安装站点坐标、保修到期日、特定硬件规格（如 Huawei LUNA2000 与 BYD HVS）、固件版本，以及 ANEEL 要求的监管合规字段。

传统方法 — 为每个新属性执行 `ALTER TABLE assets ADD COLUMN ...` — 会造成日益严重的问题：

1. **迁移开销：** 每个新属性都需要一个编号的迁移文件（当前为 `001_` 至 `005_`）、代码审查和分阶段发布
2. **数据表锁定：** 在 PostgreSQL 中，对大型表执行带 `DEFAULT` 的 `ALTER TABLE ADD COLUMN` 会获取 `ACCESS EXCLUSIVE` 锁，可能在遥测高峰时段阻塞并发的 RLS 作用域查询
3. **字段膨胀：** 随着设备规模扩展至 50,000+ 资产、涵盖数十个硬件厂商，`assets` 表的 schema 变得越来越臃肿且厂商相关
4. **跨组织差异：** 不同组织（如 ORG_ENERGIA_001 与 ORG_SOLARBR_002）可能需要不适用于全局的组织特定属性

#### 架构决策

**M4 PostgreSQL 核心实体采用"半刚性 + 半弹性"设计原则。**

**刚性字段** — 对关系查询、RBAC 权限过滤和 RLS 策略匹配至关重要的列。这些列必须具有强类型约束、外键和索引：

| 列名 | 类型 | 用途 |
|--------|------|---------|
| `asset_id` | `UUID PRIMARY KEY` | 标识、关联 |
| `org_id` | `UUID NOT NULL REFERENCES organizations(org_id)` | RLS 租户隔离 |
| `device_type` | `TEXT NOT NULL` | 分类、过滤 |
| `rated_power_kw` | `NUMERIC(10,2) NOT NULL` | 算法输入（M2） |
| `status` | `TEXT NOT NULL` | 运行状态、调度资格 |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | 审计追踪 |

**弹性字段** — 单个 `JSONB` 列，作为高弹性业务扩展槽，存储非核心的、持续演化的属性：

| 列名 | 类型 | 用途 |
|--------|------|---------|
| `metadata` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | 厂商规格、站点信息、合规字段 |

#### Schema 升级示例（schema.sql 升级范例）

```sql
-- 迁移：006_add_assets_metadata.sql
-- 零停机：在 PG 11+ 上带 DEFAULT '{}' 的 ADD COLUMN 仅修改元数据
-- （无表重写、空默认值不会获取 ACCESS EXCLUSIVE 锁）

ALTER TABLE assets
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN assets.metadata IS
    'Semi-flexible extension slot for vendor-specific and org-specific attributes. '
    'Schema validated at application layer. Indexed via GIN for @> containment queries.';

-- GIN 索引：支持 @>（包含）、?（键存在）、?&（所有键存在）
CREATE INDEX idx_assets_metadata_gin ON assets USING GIN (metadata);

-- 部分索引示例：快速查找含保修信息的 Huawei 设备
CREATE INDEX idx_assets_metadata_warranty ON assets ((metadata->>'warranty_expires'))
    WHERE metadata ? 'warranty_expires';
```

**按厂商分类的 metadata 载荷示例：**

```json
// Huawei LUNA2000 (ORG_ENERGIA_001)
{
  "vendor": "huawei",
  "model": "LUNA2000-15-S0",
  "firmware_version": "V100R001C10SPC200",
  "warranty_expires": "2031-06-15",
  "installation_site": { "lat": -23.5505, "lng": -46.6333, "city": "São Paulo" },
  "aneel_registration": "DG-SP-2025-00847"
}

// BYD HVS (ORG_SOLARBR_002)
{
  "vendor": "byd",
  "model": "HVS-12.8",
  "firmware_version": "BMU-3.28",
  "warranty_expires": "2032-01-20",
  "installation_site": { "lat": -19.9167, "lng": -43.9345, "city": "Belo Horizonte" },
  "cycles_to_date": 487
}
```

**应用层验证（TypeScript）：**

```typescript
// src/market-billing/services/metadata-validator.ts
import { z } from 'zod';

const InstallationSiteSchema = z.object({
  lat: z.number().min(-33.75).max(5.27),   // 巴西纬度范围
  lng: z.number().min(-73.99).max(-34.79),  // 巴西经度范围
  city: z.string().min(1),
});

export const AssetMetadataSchema = z.object({
  vendor: z.string().min(1),
  model: z.string().min(1),
  firmware_version: z.string().optional(),
  warranty_expires: z.string().date().optional(),
  installation_site: InstallationSiteSchema.optional(),
  aneel_registration: z.string().optional(),
}).passthrough();  // 允许组织特定的额外字段
```

**利用 GIN 索引的查询示例：**

```sql
-- 查找 ORG_ENERGIA_001 中所有 Huawei 设备
SELECT asset_id, device_type, rated_power_kw, metadata
FROM assets
WHERE metadata @> '{"vendor": "huawei"}'::jsonb;

-- 查找保修在 2030 年前到期的设备
SELECT asset_id, metadata->>'model' AS model, metadata->>'warranty_expires' AS warranty
FROM assets
WHERE (metadata->>'warranty_expires')::date < '2030-01-01';

-- 查找特定站点的设备（GIN 支持嵌套包含查询）
SELECT asset_id FROM assets
WHERE metadata @> '{"installation_site": {"city": "São Paulo"}}'::jsonb;
```

#### 决策后果与权衡

| | 影响 |
|---|--------|
| ✅ | **零停机可扩展性：** 新增业务属性无需迁移 — 只需写入新的 JSON 键。PG 11+ 上的 `ADD COLUMN ... DEFAULT '{}'` 仅修改元数据（无表重写） |
| ✅ | **GIN 索引性能：** JSONB 上配合 GIN 索引的 `@>` 包含运算符，在预期的 50K 资产规模下提供可接受的查询性能 |
| ✅ | **RLS 兼容性：** Row-Level Security 策略依赖刚性列 `org_id`。`metadata` JSONB 列完全不影响 RLS 评估 |
| ✅ | **向后兼容：** 对刚性列（`asset_id`、`org_id`、`status`、`rated_power_kw`）的现有查询继续正常工作，无需更改 |
| ⚠️ | **无数据库级 schema 强制：** JSONB 没有列级类型约束 — 可能写入格式错误的 metadata。**缓解措施：** `AssetMetadataSchema`（Zod）在每次写入前于应用层进行验证 |
| ⚠️ | **深层嵌套性能：** 复杂的嵌套 JSONB 查询（如 3+ 层深度）比刚性列查询慢。**缓解措施：** 保持 metadata 扁平或仅 1 层嵌套；为频繁查询的路径创建部分索引 |
| ⚠️ | **JSONB 字段无外键：** metadata 内的引用（如 `vendor_id`）无法设置外键约束。**缓解措施：** 在应用层验证引用完整性 |

---

### 19.2 Module 1 — 双通道摄入与防腐层

#### 背景与业务痛点

VPP 遥测数据来源于多种不兼容的源：

1. **直连设备** — 通过 AWS IoT Core MQTT 连接的 BESS 单元和逆变器，发布至 `solfacil/{org_id}/{region}/telemetry`。这些设备发送 `ingest-telemetry.ts` 中已定义的原生 `TelemetryEvent` 格式：
   ```typescript
   interface TelemetryEvent {
     orgId: string;
     deviceId: string;
     timestamp: string;  // ISO 8601
     metrics: { power: number; voltage: number; current: number; soc?: number; };
   }
   ```

2. **第三方云平台** — 厂商监控门户（如 Huawei FusionSolar、Sungrow iSolarCloud 和 GoodWe SEMS）通过 REST API Webhook 以专有格式传递数据：
   - **Huawei FusionSolar：** 以瓦特发送功率值（×1000 缩放比例），使用 Unix 纪元时间戳（秒），将指标嵌套在 `dataItemMap` 下
   - **Sungrow iSolarCloud：** 在某些 API 版本中使用中文字段名，将 SoC 打包为整数 0–100（非小数）
   - **GoodWe SEMS：** 将多个逆变器批量打包在单个载荷中，使用 `pac` 表示功率（瓦特）

如果允许这些异构载荷直接到达 M2（Algorithm Engine），优化算法将被厂商特定的解析逻辑所污染 — 在核心大脑层面造成**厂商锁定**。

#### 架构决策

**M1 作为所有遥测数据的唯一入口，不论数据来源。**

**双通道摄入设计：**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Module 1: IoT & Telemetry Hub                      │
│                                                                             │
│  通道 A: MQTT (IoT Core)              通道 B: REST API (API Gateway)        │
│  ┌──────────────────────┐            ┌──────────────────────────────────┐   │
│  │  直连设备              │            │  第三方云 Webhook                  │   │
│  │  (BESS, 逆变器)       │            │  (FusionSolar, iSolarCloud, ...)│   │
│  │                       │            │                                  │   │
│  │  MQTT Topic:          │            │  POST /v1/webhook/telemetry      │   │
│  │  solfacil/{org_id}/   │            │  Authorization: HMAC-SHA256      │   │
│  │    {region}/telemetry │            │  X-Vendor: huawei | sungrow | …  │   │
│  └──────────┬───────────┘            └───────────────┬──────────────────┘   │
│             │                                         │                      │
│             │  IoT Rule Action                        │  Lambda Handler       │
│             ▼                                         ▼                      │
│  ┌──────────────────────┐            ┌──────────────────────────────────┐   │
│  │  ingest-telemetry.ts  │            │  webhook-telemetry-ingest.ts     │   │
│  │  (现有 handler)       │            │  (新增 handler)                   │   │
│  └──────────┬───────────┘            └───────────────┬──────────────────┘   │
│             │                                         │                      │
│             │  已为                                    │  厂商特定             │
│             │  StandardTelemetry                      │  原始载荷             │
│             │                                         ▼                      │
│             │                          ┌──────────────────────────────────┐  │
│             │                          │  防腐层 (ACL)                     │  │
│             │                          │  ┌────────────┐ ┌────────────┐  │  │
│             │                          │  │ HuaweiAdptr│ │SungrowAdptr│  │  │
│             │                          │  └─────┬──────┘ └─────┬──────┘  │  │
│             │                          │        └──────┬───────┘         │  │
│             │                          │               ▼                 │  │
│             │                          │    StandardTelemetry 输出       │  │
│             │                          └───────────────┬────────────────┘  │
│             │                                          │                    │
│             └────────────────┬─────────────────────────┘                    │
│                              ▼                                              │
│                   ┌──────────────────────┐                                  │
│                   │  Timestream Write     │                                  │
│                   │  + EventBridge Emit   │                                  │
│                   │  (TelemetryReceived)  │                                  │
│                   └──────────────────────┘                                  │
│                              │                                              │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               ▼
                  M2 Algorithm Engine（消费 StandardTelemetry）
```

- **通道 A：MQTT（IoT Core）** — 直连设备，低延迟。现有的 `ingest-telemetry.ts` handler 已生成与 `StandardTelemetry` 兼容的输出
- **通道 B：REST API（API Gateway）** — 第三方云 Webhook。新增的 `webhook-telemetry-ingest.ts` handler 接收厂商载荷，通过 ACL 路由，输出 `StandardTelemetry`

#### StandardTelemetry 内部标准契约

这是所有下游模块（M2、M4、M5）消费的**规范格式**。除 M1 外，没有任何模块会接触到厂商特定格式：

```typescript
// src/iot-hub/contracts/standard-telemetry.ts

export interface StandardTelemetry {
  /** 租户标识符 — RLS 和 EventBridge 路由必需 */
  readonly orgId: string;

  /** 组织内唯一设备标识符 */
  readonly deviceId: string;

  /** 测量的 ISO 8601 UTC 时间戳 */
  readonly timestamp: string;

  /** 产生此记录的摄入通道 */
  readonly source: 'mqtt' | 'webhook';

  /** SI 一致单位的标准化指标 */
  readonly metrics: {
    readonly power_kw: number;     // 千瓦（始终为 kW，从不为 W）
    readonly voltage_v: number;    // 伏特
    readonly current_a: number;    // 安培
    readonly soc_pct?: number;     // 0.0–100.0 百分比（可选）
  };

  /** 保留原始厂商载荷用于审计和调试 */
  readonly rawPayload?: Record<string, unknown>;
}
```

**关键设计选择：**
- `source` 字段区分摄入通道，用于可观测性和调试
- 指标字段名包含单位（`_kw`、`_v`、`_a`、`_pct`），消除歧义
- `rawPayload` 保留原始厂商数据用于监管审计（ANEEL）和调试，不会污染标准化结构
- 所有字段均为 `readonly` — 设计上不可变（符合核心设计原则 #7）

#### 适配器模式实现

```typescript
// src/iot-hub/adapters/telemetry-adapter.ts

export interface TelemetryAdapter {
  /** 与 X-Vendor 头匹配的厂商标识符 */
  readonly vendorId: string;

  /** 将厂商特定载荷转换为 StandardTelemetry */
  normalize(
    orgId: string,
    rawPayload: Record<string, unknown>
  ): StandardTelemetry;
}
```

```typescript
// src/iot-hub/adapters/huawei-adapter.ts

import type { TelemetryAdapter } from './telemetry-adapter';
import type { StandardTelemetry } from '../contracts/standard-telemetry';

export const HuaweiFusionSolarAdapter: TelemetryAdapter = {
  vendorId: 'huawei',

  normalize(orgId, raw): StandardTelemetry {
    // FusionSolar 发送：{ devId, collectTime (epoch s), dataItemMap: { ... } }
    const dataItems = raw.dataItemMap as Record<string, number>;

    return {
      orgId,
      deviceId: String(raw.devId),
      timestamp: new Date((raw.collectTime as number) * 1000).toISOString(),
      source: 'webhook',
      metrics: {
        power_kw: (dataItems.active_power ?? 0) / 1000,  // W → kW
        voltage_v: dataItems.mppt_voltage ?? 0,
        current_a: dataItems.mppt_current ?? 0,
        soc_pct: dataItems.battery_soc,                   // 已为 0–100
      },
      rawPayload: raw,
    };
  },
};
```

```typescript
// src/iot-hub/adapters/sungrow-adapter.ts

import type { TelemetryAdapter } from './telemetry-adapter';
import type { StandardTelemetry } from '../contracts/standard-telemetry';

export const SungrowAdapter: TelemetryAdapter = {
  vendorId: 'sungrow',

  normalize(orgId, raw): StandardTelemetry {
    // iSolarCloud 发送：{ sn, timestamp (ISO), p_ac (kW), v_grid, i_grid, soc (int) }
    return {
      orgId,
      deviceId: String(raw.sn),
      timestamp: String(raw.timestamp),
      source: 'webhook',
      metrics: {
        power_kw: Number(raw.p_ac),       // 已为 kW
        voltage_v: Number(raw.v_grid),
        current_a: Number(raw.i_grid),
        soc_pct: Number(raw.soc),          // 整数 0–100，符合我们的 0.0–100.0 范围
      },
      rawPayload: raw,
    };
  },
};
```

```typescript
// src/iot-hub/adapters/adapter-registry.ts

import type { TelemetryAdapter } from './telemetry-adapter';
import { HuaweiFusionSolarAdapter } from './huawei-adapter';
import { SungrowAdapter } from './sungrow-adapter';

const adapters = new Map<string, TelemetryAdapter>([
  [HuaweiFusionSolarAdapter.vendorId, HuaweiFusionSolarAdapter],
  [SungrowAdapter.vendorId, SungrowAdapter],
]);

export function getAdapter(vendorId: string): TelemetryAdapter {
  const adapter = adapters.get(vendorId);
  if (!adapter) {
    throw new Error(
      `Unsupported vendor: "${vendorId}". ` +
      `Supported: ${[...adapters.keys()].join(', ')}`
    );
  }
  return adapter;
}
```

#### 防腐层数据流

```
                          第三方 Webhook 请求
                                    │
                                    ▼
                   ┌────────────────────────────────┐
                   │  API Gateway (POST /v1/webhook) │
                   │  HMAC-SHA256 签名验证            │
                   └────────────────┬───────────────┘
                                    │
                                    ▼
                   ┌────────────────────────────────┐
                   │  webhook-telemetry-ingest.ts    │
                   │                                 │
                   │  1. 提取 X-Vendor 头             │
                   │  2. 从 path/JWT 提取 org_id      │
                   │  3. getAdapter(vendorId)         │
                   │  4. adapter.normalize(orgId,raw) │
                   │  5. 验证 StandardTelemetry        │
                   └────────────────┬───────────────┘
                                    │
                          StandardTelemetry
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌──────────────────┐           ┌──────────────────────┐
        │  Timestream Write │           │  EventBridge Publish  │
        │  （与 MQTT 摄入    │           │  TelemetryReceived    │
        │   路径相同）       │           │  { source: "webhook" }│
        └──────────────────┘           └──────────────────────┘
```

**数据通过 ACL 后，无论摄入通道如何，下游流程完全相同。** M2 Algorithm Engine、M4 Market & Billing 和 M5 BFF 均消费 `StandardTelemetry` — 它们无需知道数据是来自直连 MQTT 设备还是 Huawei FusionSolar Webhook。

#### 新增文件与目录结构

```
src/iot-hub/
├── handlers/
│   ├── ingest-telemetry.ts           # （现有）通道 A — MQTT
│   ├── webhook-telemetry-ingest.ts   # （新增）通道 B — REST webhook
│   ├── schedule-to-shadow.ts         # （现有）
│   └── device-registry.ts           # （现有）
├── contracts/
│   └── standard-telemetry.ts         # （新增）StandardTelemetry 接口
├── adapters/
│   ├── telemetry-adapter.ts          # （新增）Adapter 接口
│   ├── adapter-registry.ts           # （新增）厂商 → Adapter 查找
│   ├── huawei-adapter.ts             # （新增）Huawei FusionSolar
│   └── sungrow-adapter.ts            # （新增）Sungrow iSolarCloud
├── services/
│   ├── timestream-writer.ts          # （现有）
│   └── shadow-manager.ts             # （现有）
└── __tests__/
    ├── ingest-telemetry.test.ts      # （现有）
    ├── timestream-writer.test.ts     # （现有）
    ├── huawei-adapter.test.ts        # （新增）厂商格式标准化测试
    ├── sungrow-adapter.test.ts       # （新增）厂商格式标准化测试
    └── adapter-registry.test.ts      # （新增）注册表查找 + 未知厂商错误
```

#### 决策后果与权衡

| | 影响 |
|---|--------|
| ✅ | **核心算法隔离：** M2 仅消费 `StandardTelemetry` — 完全隔离于厂商格式变更。厂商格式可以变更而无需触及 M2/M3/M4/M5 |
| ✅ | **开放封闭原则：** 添加新厂商（如 GoodWe）仅需实现新的 `TelemetryAdapter` 并在 `adapter-registry.ts` 中注册 — 无需更改现有 handler 或下游模块 |
| ✅ | **审计追踪：** `rawPayload` 保留原始厂商数据，用于 ANEEL 监管合规和事后调试 |
| ✅ | **统一可观测性：** 两个通道汇聚到相同的 Timestream 写入路径和 EventBridge 发射，因此 CloudWatch 仪表板和 X-Ray 追踪对 MQTT 和 Webhook 数据的工作方式完全相同 |
| ⚠️ | **适配器开发成本：** 每个新厂商都需要研究其专有 API 格式并实现专用适配器。**缓解措施：** 适配器接口很小（约 20 行）；大部分工作量在于理解厂商文档 |
| ⚠️ | **适配器测试覆盖：** 每个适配器的 `normalize()` 逻辑必须使用真实厂商载荷样本进行单元测试。**缓解措施：** 在厂商对接时索取载荷样本；作为测试固件存储在 `__tests__/fixtures/` 中 |
| ⚠️ | **Webhook 认证：** REST 通道 B 必须按厂商验证 HMAC-SHA256 签名。M7 现有的 HMAC 验证模式（`webhook-delivery.ts`）可复用于入站验证 |

---

### 19.3 架构演进路线图

| 阶段 | 里程碑 | 模块 | 关键交付物 |
|-------|---------------------|---------|------------------|
| **已完成（当前）** | 7 个模块，69 个健壮测试；`StandardTelemetry` 契约已定义 | M1–M7 | 所有 handler、CDK 堆栈、EventBridge 规则、RLS 策略已测试 |
| **Phase 2** | 双通道摄入与可扩展元数据 | M1、M4 | `HuaweiAdapter` + `SungrowAdapter` 实现；`schema.sql` 添加 JSONB `metadata` 列；`AssetMetadataSchema` Zod 验证器；12+ 个新单元测试 |
| **Phase 3** | 身份认证栈生产部署 | M6、M5 | Cognito User Pool 部署至 `sa-east-1`；用真实 Cognito 令牌替换硬编码测试 JWT；启用 MFA 强制 |
| **Phase 4** | 全面云端激活 | 全部 | `cdk deploy --all` — 全部 7 个堆栈在 AWS 上线；端到端遥测流程（设备 → Timestream → M2 → Device Shadow）验证完成 |
| **Phase 5** | Open API 加固与合作伙伴对接 | M7 | WAF 速率限制（每 API Key 1000 请求/分钟）；合作伙伴 Webhook 订阅；HMAC-SHA256 投递验证；API 文档发布 |
| **Phase 6** | 多厂商设备规模化扩展 | M1 | GoodWe SEMS 适配器；Growatt 适配器；适配器性能基准测试；Webhook 载荷重放/重试机制 |

#### Phase 2 细部拆解

```
Phase 2 双通道摄入与可扩展元数据
├── M4：可扩展元数据
│   ├── 006_add_assets_metadata.sql 迁移
│   ├── metadata 列 GIN 索引
│   ├── AssetMetadataSchema（Zod）验证器
│   ├── 更新 calculate-profit.ts 在响应中暴露 metadata
│   └── 4 个新测试（验证、GIN 查询、RLS 兼容性、畸形数据拒绝）
│
├── M1：防腐层
│   ├── StandardTelemetry 契约（contracts/standard-telemetry.ts）
│   ├── TelemetryAdapter 接口
│   ├── HuaweiFusionSolarAdapter
│   ├── SungrowAdapter
│   ├── AdapterRegistry
│   ├── webhook-telemetry-ingest.ts handler
│   └── 8 个新测试（每个适配器 2 个、注册表、Webhook handler 集成）
│
└── CDK：IotHubStack 更新
    ├── API Gateway 路由：POST /v1/webhook/telemetry
    ├── Webhook handler Lambda 函数
    └── Timestream + EventBridge IAM 授权
```

---

## 数据模型映射（前端 → 后端）

| 前端数据 | 当前来源 | 后端来源 | AWS 服务 |
|---------------|---------------|---------------|-------------|
| `assets[]`（id、name、region、SoC、mode） | `data.js` 硬编码 | M4（RDS `assets`）+ M1（Timestream 实时 SoC） | RDS + Timestream |
| `trades[]`（time、tariff、operation、price） | `data.js` 硬编码 | M4（RDS `trades`） | RDS PostgreSQL |
| `revenueTrend`（7 天数组） | `data.js` 硬编码 | M4（RDS `daily_revenue`） | RDS PostgreSQL |
| `revenueBreakdown` | `data.js` 硬编码 | M4（由 `trades` 计算） | RDS PostgreSQL |
| 市场状况（tariff、price、margin） | `market.js`（基于时间） | M4（`tariff_schedules`）+ ANEEL 数据 | RDS + 外部 API |
| 算法 KPI（Alpha、MAPE） | `data.js`（随机） | M2（Timestream + 预测） | Lambda + Timestream |
| 站点分析（PV、负载、电池） | `data.js`（生成） | M1（Timestream 24 小时查询） | Timestream |
| 调度进度 | `batch-ops.js`（模拟） | M3（DynamoDB `dispatch_tracker`） | DynamoDB |
| 组织上下文 | 无（新增） | M6（Cognito `custom:org_id`） | Cognito |
| Webhook 订阅 | 无（新增） | M7（DynamoDB `webhook_subscriptions`） | DynamoDB |

---

---

## 20. Module 8：Admin Control Plane — 全局控制面

> **状态：** ACTIVE — 在 v5.0 中确认为系统的全局控制面。
> **角色：** 所有 M1-M7（数据面）消费的配置的唯一事实来源。
> **另见：** [§0 架构法则](#0-architectural-law-control-plane-vs-data-plane-全局法則) 了解最高隔离原则。

### 20.1 核心职责与设计哲学

**Configuration-Driven（配置驱动）：** M8 是整个 VPP 系统的"大脑设置面板"。M1 的设备解析规则、M2 的套利决策阈值，未来将不再硬编码在 Lambda 里，而是由 M8 动态管理、即时生效。

**No-Code Operations（无代码运营）：** 非技术运营人员（如客户成功团队、商业分析师）可通过前端后台界面，直接管理设备对接规则与 VPP 策略，无需重新部署代码。

**隔离性（v4.1 原则）：** M8 在 v4.1 中完全独立，不与 M1-M7 产生任何代码耦合。M8 的 API 在 v5.0 才会被 M1/M2 主动调用。

---

### 20.2 M8 核心数据表设计（PostgreSQL，与 M4 同一 VPC）

#### 20.2.1 device_parser_rules — 设备解析规则表

```sql
-- ============================================================
-- 表：device_parser_rules
-- 用途：存储厂商特定的遥测解析规则。
--       在 v5.0 集成中替代 M1 中硬编码的适配器。
-- ============================================================

CREATE TABLE device_parser_rules (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          TEXT            NOT NULL REFERENCES organizations(org_id),
    rule_name       TEXT            NOT NULL,           -- 人类可读，例如 'Huawei FusionSolar V3'
    manufacturer    TEXT            NOT NULL,           -- 'huawei' | 'sungrow' | 'generic'
    version         TEXT            NOT NULL DEFAULT '1.0',
    field_mapping   JSONB           NOT NULL DEFAULT '{}',
    unit_conversions JSONB          NOT NULL DEFAULT '{}',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by      TEXT            NOT NULL,           -- userId
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_org_rule_name UNIQUE (org_id, rule_name)
);

-- Row-Level Security：多租户隔离
ALTER TABLE device_parser_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_parser_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_parser_rules
    ON device_parser_rules
    USING (org_id = current_setting('app.current_org_id'));

-- 索引
CREATE INDEX idx_parser_rules_manufacturer ON device_parser_rules(manufacturer);
CREATE INDEX idx_parser_rules_org          ON device_parser_rules(org_id);
CREATE INDEX idx_parser_rules_metadata     ON device_parser_rules USING GIN(field_mapping);
```

**`field_mapping` JSONB Schema 示例：**

```json
{
  "deviceId": "devSn",
  "timestamp": {
    "field": "collectTime",
    "type": "unix_ms"
  },
  "power": {
    "field": "dataItemMap.active_power",
    "unit": "W",
    "targetUnit": "kW",
    "divisor": 1000
  },
  "soc": {
    "field": "dataItemMap.battery_soc",
    "unit": "percent"
  }
}
```

**`unit_conversions` JSONB Schema 示例：**

```json
{
  "power": { "from": "W", "to": "kW", "divisor": 1000 },
  "energy": { "from": "Wh", "to": "kWh", "divisor": 1000 },
  "temperature": { "from": "C", "to": "C", "offset": 0 }
}
```

#### 20.2.2 vpp_strategies — VPP 套利策略表

```sql
-- ============================================================
-- 表：vpp_strategies
-- 用途：存储每个组织的 VPP 套利策略参数。
--       在 v5.0 集成中替代 M2 中硬编码的阈值。
-- ============================================================

CREATE TABLE vpp_strategies (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          TEXT            NOT NULL REFERENCES organizations(org_id),
    strategy_name   TEXT            NOT NULL,           -- 例如 'Conservative'、'Aggressive'、'Summer Peak'
    description     TEXT,
    min_soc         NUMERIC(5,2)    NOT NULL DEFAULT 20.0,   -- % 最小放电 SOC 下限
    max_soc         NUMERIC(5,2)    NOT NULL DEFAULT 90.0,   -- % 最大充电 SOC 上限
    profit_margin   NUMERIC(8,4)    NOT NULL DEFAULT 0.0,    -- BRL/kWh 最低利润阈值
    active_hours    JSONB           NOT NULL DEFAULT '{"start": "00:00", "end": "23:59"}',
    active_weekdays JSONB           NOT NULL DEFAULT '[0,1,2,3,4,5,6]',  -- 0=周日
    emergency_soc   NUMERIC(5,2)    NOT NULL DEFAULT 10.0,   -- % 紧急储备
    is_active       BOOLEAN         NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN         NOT NULL DEFAULT FALSE,  -- 每个组织仅一个默认策略
    created_by      TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_org_strategy_name UNIQUE (org_id, strategy_name),
    CONSTRAINT chk_soc_range        CHECK (min_soc < max_soc AND emergency_soc < min_soc),
    CONSTRAINT chk_profit_positive  CHECK (profit_margin >= 0)
);

-- Row-Level Security：多租户隔离
ALTER TABLE vpp_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpp_strategies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_vpp_strategies
    ON vpp_strategies
    USING (org_id = current_setting('app.current_org_id'));

-- 部分唯一索引：强制每个组织最多一个默认策略
CREATE UNIQUE INDEX idx_strategies_default
    ON vpp_strategies(org_id) WHERE is_default = TRUE;

-- 复合索引：用于活跃策略查询
CREATE INDEX idx_strategies_org_active
    ON vpp_strategies(org_id, is_active);
```

#### 20.2.3 dispatch_policies — 派发策略表（M3 消费者）

```sql
-- ============================================================
-- 表：dispatch_policies
-- 用途：存储每个组织的 DR 派发操作参数。
--       在 v5.0 中替代 M3 中硬编码的超时/重试值。
-- 消费者：M3（DR Dispatcher）
-- ============================================================

CREATE TABLE dispatch_policies (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      TEXT            NOT NULL REFERENCES organizations(org_id),
    max_retry_count             INT             NOT NULL DEFAULT 3,
    retry_backoff_seconds       INT             NOT NULL DEFAULT 60,
    max_concurrent_dispatches   INT             NOT NULL DEFAULT 10,
    timeout_minutes             INT             NOT NULL DEFAULT 15,
    created_by                  TEXT            NOT NULL,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_dispatch_policy_org UNIQUE (org_id),
    CONSTRAINT chk_retry_positive     CHECK (max_retry_count > 0),
    CONSTRAINT chk_timeout_positive   CHECK (timeout_minutes > 0),
    CONSTRAINT chk_concurrent_positive CHECK (max_concurrent_dispatches > 0)
);

-- Row-Level Security：多租户隔离
ALTER TABLE dispatch_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dispatch_policies
    ON dispatch_policies
    USING (org_id = current_setting('app.current_org_id'));

-- 索引
CREATE INDEX idx_dispatch_policies_org ON dispatch_policies(org_id);
```

#### 20.2.4 billing_rules — 计费规则表（M4 消费者）

```sql
-- ============================================================
-- 表：billing_rules
-- 用途：存储每个组织的计费和电价参数。
--       在 v5.0 中替代 M4 中硬编码的成本常量。
-- 消费者：M4（Market & Billing）
-- ============================================================

CREATE TABLE billing_rules (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      TEXT            NOT NULL REFERENCES organizations(org_id),
    tariff_penalty_multiplier   NUMERIC(4,2)    NOT NULL DEFAULT 1.5,
    tariff_effective_period     TEXT            NOT NULL DEFAULT 'monthly',
    operating_cost_per_kwh      NUMERIC(8,4)    NOT NULL,
    created_by                  TEXT            NOT NULL,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_billing_rules_org      UNIQUE (org_id),
    CONSTRAINT chk_penalty_positive      CHECK (tariff_penalty_multiplier > 0),
    CONSTRAINT chk_cost_positive         CHECK (operating_cost_per_kwh >= 0),
    CONSTRAINT chk_effective_period      CHECK (tariff_effective_period IN ('monthly', 'quarterly', 'annually'))
);

-- Row-Level Security：多租户隔离
ALTER TABLE billing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_rules
    ON billing_rules
    USING (org_id = current_setting('app.current_org_id'));

-- 索引
CREATE INDEX idx_billing_rules_org ON billing_rules(org_id);
```

#### 20.2.5 feature_flags — 功能开关表（M5 消费者）

```sql
-- ============================================================
-- 表：feature_flags
-- 用途：存储用于金丝雀发布和 A/B 测试的功能开关。
--       支持无需代码部署的渐进式功能上线。
-- 消费者：M5（Frontend BFF）
-- 注意：无 RLS — 由 SOLFACIL_ADMIN 专属管理
-- ============================================================

CREATE TABLE feature_flags (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_name       TEXT            NOT NULL,
    is_enabled      BOOLEAN         NOT NULL DEFAULT FALSE,
    target_org_ids  JSONB           DEFAULT 'null'::jsonb,  -- null=所有租户，或 ["ORG_001","ORG_002"]
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    description     TEXT,
    created_by      TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_feature_flag_name  UNIQUE (flag_name),
    CONSTRAINT chk_valid_window      CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until)
);

-- 无 RLS：feature_flags 由 SOLFACIL_ADMIN 专属管理
-- 访问控制在应用层通过 RBAC 中间件执行

-- 索引
CREATE INDEX idx_feature_flags_name     ON feature_flags(flag_name);
CREATE INDEX idx_feature_flags_enabled  ON feature_flags(is_enabled) WHERE is_enabled = TRUE;
CREATE INDEX idx_feature_flags_targets  ON feature_flags USING GIN(target_org_ids);
```

#### 20.2.6 api_quotas — API 配额表（M7 消费者）

```sql
-- ============================================================
-- 表：api_quotas
-- 用途：存储每个合作伙伴的 API 速率限制和配额。
--       以动态控制替代静态 API Gateway Usage Plans。
-- 消费者：M7（Open API & Integration）
-- ============================================================

CREATE TABLE api_quotas (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id      TEXT            NOT NULL,
    org_id          TEXT            NOT NULL REFERENCES organizations(org_id),
    calls_per_minute INT           NOT NULL DEFAULT 60,
    calls_per_day   INT             NOT NULL DEFAULT 10000,
    burst_limit     INT             NOT NULL DEFAULT 100,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by      TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_api_quota_partner  UNIQUE (partner_id),
    CONSTRAINT chk_rpm_positive      CHECK (calls_per_minute > 0),
    CONSTRAINT chk_rpd_positive      CHECK (calls_per_day > 0),
    CONSTRAINT chk_burst_positive    CHECK (burst_limit > 0)
);

-- Row-Level Security：多租户隔离
ALTER TABLE api_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_quotas FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_api_quotas
    ON api_quotas
    USING (org_id = current_setting('app.current_org_id'));

-- 索引
CREATE INDEX idx_api_quotas_partner ON api_quotas(partner_id);
CREATE INDEX idx_api_quotas_org     ON api_quotas(org_id);
CREATE INDEX idx_api_quotas_active  ON api_quotas(is_active) WHERE is_active = TRUE;
```

---

### 20.3 M8 REST API 端点设计

> 所有端点均需通过 M5 BFF 的 RBAC 中间件进行认证。
> 最低角色：`ORG_MANAGER`。删除操作需要 `SOLFACIL_ADMIN`。

#### Device Parser Rules API

| 方法 | 端点 | 描述 | 最低角色 |
|--------|----------|-------------|----------|
| `GET` | `/admin/parsers` | 列出组织的所有解析规则 | `ORG_MANAGER` |
| `POST` | `/admin/parsers` | 创建新的解析规则 | `ORG_MANAGER` |
| `GET` | `/admin/parsers/:id` | 获取单条规则详情 | `ORG_MANAGER` |
| `PUT` | `/admin/parsers/:id` | 完整更新规则 | `ORG_MANAGER` |
| `PATCH` | `/admin/parsers/:id/activate` | 切换规则启用/停用状态 | `ORG_MANAGER` |
| `DELETE` | `/admin/parsers/:id` | 删除规则（`is_active=true` 时失败） | `SOLFACIL_ADMIN` |

#### VPP Strategy API

| 方法 | 端点 | 描述 | 最低角色 |
|--------|----------|-------------|----------|
| `GET` | `/admin/strategies` | 列出组织的所有策略 | `ORG_MANAGER` |
| `POST` | `/admin/strategies` | 创建新策略 | `ORG_MANAGER` |
| `GET` | `/admin/strategies/:id` | 获取策略详情 | `ORG_MANAGER` |
| `PUT` | `/admin/strategies/:id` | 更新策略参数 | `ORG_MANAGER` |
| `POST` | `/admin/strategies/:id/activate` | 激活策略（自动停用其他策略） | `ORG_MANAGER` |
| `DELETE` | `/admin/strategies/:id` | 删除非活跃策略 | `SOLFACIL_ADMIN` |

#### Dispatch Policies API（v5.0）

| 方法 | 端点 | 描述 | 最低角色 |
|--------|----------|-------------|----------|
| `GET` | `/admin/dispatch-policies` | 获取组织的派发策略 | `ORG_MANAGER` |
| `PUT` | `/admin/dispatch-policies` | 创建或更新派发策略 | `ORG_MANAGER` |

#### Billing Rules API（v5.0）

| 方法 | 端点 | 描述 | 最低角色 |
|--------|----------|-------------|----------|
| `GET` | `/admin/billing-rules` | 获取组织的计费规则 | `ORG_MANAGER` |
| `PUT` | `/admin/billing-rules` | 创建或更新计费规则 | `ORG_MANAGER` |

#### Feature Flags API（v5.0）

| 方法 | 端点 | 描述 | 最低角色 |
|--------|----------|-------------|----------|
| `GET` | `/admin/feature-flags` | 列出所有功能开关 | `SOLFACIL_ADMIN` |
| `POST` | `/admin/feature-flags` | 创建新功能开关 | `SOLFACIL_ADMIN` |
| `PUT` | `/admin/feature-flags/:id` | 更新功能开关 | `SOLFACIL_ADMIN` |
| `PATCH` | `/admin/feature-flags/:id/toggle` | 切换开关启用/禁用状态 | `SOLFACIL_ADMIN` |
| `DELETE` | `/admin/feature-flags/:id` | 删除功能开关 | `SOLFACIL_ADMIN` |

#### API Quotas API（v5.0）

| 方法 | 端点 | 描述 | 最低角色 |
|--------|----------|-------------|----------|
| `GET` | `/admin/api-quotas` | 列出组织的所有 API 配额 | `ORG_MANAGER` |
| `POST` | `/admin/api-quotas` | 为合作伙伴创建新配额 | `ORG_MANAGER` |
| `PUT` | `/admin/api-quotas/:id` | 更新合作伙伴配额 | `ORG_MANAGER` |
| `PATCH` | `/admin/api-quotas/:id/toggle` | 激活/停用配额 | `ORG_MANAGER` |
| `DELETE` | `/admin/api-quotas/:id` | 删除配额条目 | `SOLFACIL_ADMIN` |

---

### 20.4 v5.0 融合预告（未来集成点）

> **注意：** 以下描述的是 v5.0 设计意图。v4.1 中均未实现。

#### M1 融合点 — Dynamic Adapter Resolution

`ingest-telemetry.ts` 的 `resolveAdapter()` 将在 Lambda 冷启动时从 M8 的 `device_parser_rules` 加载规则，动态构建 Adapter（取代现有的硬编码 `HuaweiAdapter` / `NativeAdapter`）。规则更新后无需重新部署 Lambda。

```
┌─────────────┐    冷启动       ┌──────────────────────┐
│  M1 Lambda  │ ──────────────▶  │  M8: parser_rules    │
│  (IoT Hub)  │  GET /parsers    │  (PostgreSQL)        │
│             │ ◀────────────── │                      │
│  从规则      │   rules[]       │                      │
│  构建       │                 └──────────────────────┘
│  适配器     │
└─────────────┘
```

#### M2 融合点 — Dynamic Strategy Loading

`run-optimization.ts` 的 3 条套利规则阈值（`min_soc=20`、`max_soc=90`）将替换为从 M8 的 `vpp_strategies` 动态读取，支持每个组织设置不同策略。

```
┌─────────────┐    每次调用        ┌──────────────────────┐
│  M2 Lambda  │ ──────────────────▶  │  M8: vpp_strategies  │
│  (Algo Eng) │  GET 活跃策略       │  (PostgreSQL)        │
│             │ ◀────────────────── │                      │
│  应用       │   {min_soc, max_soc, │                      │
│  阈值       │    profit_margin}    └──────────────────────┘
└─────────────┘
```

#### 缓存策略（v5.0 缓存策略）

M8 规则的读取频率高（每次遥测都需要），建议在 v5.0 引入 **ElastiCache Redis** with `TTL=5min`，避免每次都查 PostgreSQL。

```
M1/M2 Lambda ──▶ Redis Cache (TTL=5min) ──miss──▶ M8 PostgreSQL
                       │ hit
                       ▼
                  使用缓存规则
```

---

### 20.5 CDK Stack 规划（v5.0 实现）

> **注意：** v5.0 实现的基础设施即代码详情。v4.1 中未构建。

**AdminControlPlaneStack** 将包含：

| 资源 | 用途 |
|----------|---------|
| `AdminParsersLambda` | `device_parser_rules` 的 CRUD 操作 |
| `AdminStrategiesLambda` | `vpp_strategies` 的 CRUD 操作 |
| M4 VPC + RDS 复用 | 与 Market & Billing 相同的 `PRIVATE_ISOLATED` 子网 |
| M4 Secrets Manager VPC Endpoint 复用 | 共享数据库凭证访问 |
| API Gateway 路由：`/admin/*` | 在现有 API Gateway 下新增路由组 |
| RBAC 执行 | 所有端点最低角色为 `ORG_MANAGER` |

**部署阶段：** Phase 8（在 M7 之后），独立于 M1-M7 部署。

---

*本文档是 SOLFACIL VPP 后端架构的唯一事实来源。它取代了原始后端设计（v1.1）和认证/租户设计（v2.0）。所有后续修改应在本文档中进行。*
