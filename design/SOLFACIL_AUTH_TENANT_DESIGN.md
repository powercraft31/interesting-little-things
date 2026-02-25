# SOLFACIL VPP — Authentication & Multi-tenancy Design

> **Version:** 2.0 | **Date:** 2026-02-20
> **Author:** Cloud Architecture Team
> **Status:** DRAFT — Pending Architecture Review
> **Depends on:** `SOLFACIL_BACKEND_DESIGN.md` v1.1

---

## v2.0 Changelog

| Change | Section | Summary |
|--------|---------|---------|
| **Advanced Authentication & Security** | §13 | Enterprise SSO (SAML 2.0 / OIDC) federation with Azure AD, Okta, Google Workspace; mandatory TOTP MFA for dispatch-authority roles; adaptive step-up auth for sensitive operations |
| **M2M Integration & Open API** | §14 | Machine-to-Machine API access via API Keys + Usage Plans and OAuth 2.0 Client Credentials; per-client rate limiting and quota defense; WAF integration for OWASP top 10 protection |
| **Event-Driven Webhooks** | §15 | Outbound webhook notifications via EventBridge API Destinations; HMAC-SHA256 signature validation; self-service webhook management CRUD API with DynamoDB-backed subscriptions |

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Multi-tenancy Strategy (AWS Cognito)](#2-multi-tenancy-strategy-aws-cognito)
3. [Role & Permission Model (RBAC)](#3-role--permission-model-rbac)
4. [JWT Token Structure](#4-jwt-token-structure)
5. [CDK Infrastructure: Auth Stack](#5-cdk-infrastructure-auth-stack)
6. [Tenant-Aware Data Isolation](#6-tenant-aware-data-isolation)
7. [Lambda Middleware Layer](#7-lambda-middleware-layer)
8. [API Authorization Matrix](#8-api-authorization-matrix)
9. [Frontend Integration](#9-frontend-integration)
10. [Migration Plan for Existing Schemas](#10-migration-plan-for-existing-schemas)
11. [Security Considerations](#11-security-considerations)
12. [Implementation Phases](#12-implementation-phases)
13. [Advanced Authentication & Security](#13-advanced-authentication--security)
14. [M2M Integration & Open API](#14-m2m-integration--open-api)
15. [Event-Driven Webhooks (Outbound Notifications)](#15-event-driven-webhooks-outbound-notifications)

---

## 1. Problem Statement

### Current State

The VPP backend has **4 deployed CDK stack skeletons** (IoT Hub, DR Dispatcher, Market & Billing, BFF) with:
- **No Cognito User Pool** — the BFF stack has a comment "Later phases: Cognito authorizer"
- **No `org_id` column** in any PostgreSQL table, DynamoDB table, or Timestream dimension
- **No authorization middleware** — all Lambda handlers accept unauthenticated requests
- **No tenant isolation** — hardcoded mock assets are visible to all callers
- **Single-role model** — the backend design doc mentions `admin/operator/viewer` groups but no multi-tenant scoping

### Target State

SOLFACIL is a **B2B SaaS platform**. Multiple enterprise clients (Organizations) will each manage their own fleet of battery assets. The system must guarantee:

1. **Data isolation** — Org A must never see Org B's assets, trades, revenue, or telemetry
2. **Role-based access control** — Different permission levels within and across organizations
3. **Super-admin capability** — SOLFACIL platform operators can see all orgs for support/auditing
4. **Scalable tenant model** — Adding a new org requires no infrastructure changes

### Why Now

All 4 module IaC skeletons exist but contain **zero business logic**. Adding `org_id` to every data layer now costs almost nothing. Adding it later — after tables, queries, event schemas, and handlers are built — would require a painful migration of every module.

---

## 2. Multi-tenancy Strategy (AWS Cognito)

### Option Analysis

#### Option A: Cognito Custom Attributes Only

Store both `org_id` and `role` as custom attributes on the Cognito user record.

```
User record:
  email: "joao@energiacorp.com.br"
  custom:org_id: "ORG_ENERGIA_001"
  custom:role: "ORG_MANAGER"
```

| Aspect | Assessment |
|--------|-----------|
| **Pros** | Simple setup; attributes embedded in JWT automatically; no group management API calls; each user carries all context in their token |
| **Cons** | Custom attributes are **immutable after user pool creation** (cannot add new ones without recreating the pool); role changes require `AdminUpdateUserAttributes` API call; no built-in group membership listing; harder to query "all users in org X" |
| **VPP Fit** | Adequate for org_id (rarely changes), awkward for roles (may need to change when a user is promoted) |

#### Option B: Cognito Groups Only

Create groups for both org membership and role assignment.

```
Groups:
  org:ORG_ENERGIA_001          (org membership)
  org:ORG_SOLARBR_002          (org membership)
  role:SOLFACIL_ADMIN          (platform admin)
  role:ORG_MANAGER             (org manager)
  role:ORG_OPERATOR            (org operator)
  role:ORG_VIEWER              (org viewer)
```

| Aspect | Assessment |
|--------|-----------|
| **Pros** | Groups appear in JWT `cognito:groups` claim automatically; easy to list group members via SDK; role changes are instant (`AdminAddUserToGroup`/`AdminRemoveUserFromGroup`); natural fit for RBAC |
| **Cons** | A user can belong to multiple groups — requires convention to enforce "exactly one org group"; org_id must be parsed from group name (e.g., strip `org:` prefix); group proliferation at scale (100 orgs = 100+ groups); **Cognito limit: 10,000 groups per user pool** (sufficient for this scale but not unlimited) |
| **VPP Fit** | Good for roles (natural group concept), awkward for org_id (convention-based parsing, risk of multi-org assignment) |

#### Option C: Hybrid (Recommended)

Use **Custom Attributes for tenant identity** (`custom:org_id`) and **Cognito Groups for roles**.

```
User record:
  email: "joao@energiacorp.com.br"
  custom:org_id: "ORG_ENERGIA_001"
  Groups: ["ORG_MANAGER"]

User record:
  email: "admin@solfacil.com.br"
  custom:org_id: "SOLFACIL"
  Groups: ["SOLFACIL_ADMIN"]
```

| Aspect | Assessment |
|--------|-----------|
| **Pros** | Each concept uses the Cognito primitive best suited to it; `org_id` is a scalar value (one user = one org), naturally fits a custom attribute; roles are categorical and may change, naturally fit groups; JWT contains both `custom:org_id` claim AND `cognito:groups` claim; no group-name parsing needed for tenant isolation; "all users in a role" is a native Cognito query |
| **Cons** | Two mechanisms to manage (slightly more admin complexity); custom attributes cannot be added to an existing user pool post-creation (must plan ahead) |
| **VPP Fit** | Best fit — org_id is stable, roles change; this separation matches the domain model exactly |

### Final Recommendation: **Option C — Hybrid**

**Justification:**

1. **Domain alignment** — An organization is a **tenant boundary** (1 user : 1 org). A role is a **permission level** (may change). These are semantically different concepts and should use different mechanisms.

2. **JWT efficiency** — With the hybrid approach, the Lambda authorizer can extract `org_id` from `custom:org_id` (a simple string) and roles from `cognito:groups` (an array) without any parsing or convention. This makes the middleware layer simpler and less error-prone.

3. **Query patterns** — "Show me all users in ORG_ENERGIA_001" → filter by custom attribute. "Show me all admins" → list group members of `SOLFACIL_ADMIN`. Both are first-class Cognito operations.

4. **Scale headroom** — Custom attributes have no count limit on values. Groups are limited to 10,000 per pool. Since we only need ~5 role groups (not per-org groups), we stay well within limits.

5. **Immutability risk mitigation** — We define custom attributes at user pool creation time. The required attributes are stable (`org_id` won't change shape). If new tenant metadata is needed in the future, it can go into a DynamoDB `organizations` table rather than adding more custom attributes.

---

## 3. Role & Permission Model (RBAC)

### Role Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     SOLFACIL_ADMIN                          │
│  Platform-level superuser. Can see ALL organizations.      │
│  custom:org_id = "SOLFACIL"                                │
│  Intended for: SOLFACIL internal operations team           │
├─────────────────────────────────────────────────────────────┤
│                     ORG_MANAGER                             │
│  Organization-level admin. Full control over their own org.│
│  custom:org_id = "ORG_ENERGIA_001"                         │
│  Intended for: Enterprise client's energy manager          │
├─────────────────────────────────────────────────────────────┤
│                     ORG_OPERATOR                            │
│  Can dispatch commands and monitor assets within their org.│
│  custom:org_id = "ORG_ENERGIA_001"                         │
│  Intended for: Field technicians, dispatch operators       │
├─────────────────────────────────────────────────────────────┤
│                     ORG_VIEWER                              │
│  Read-only access to dashboards and reports within org.    │
│  custom:org_id = "ORG_ENERGIA_001"                         │
│  Intended for: Executives, auditors, read-only stakeholders│
└─────────────────────────────────────────────────────────────┘
```

### Permission Matrix

| Permission | SOLFACIL_ADMIN | ORG_MANAGER | ORG_OPERATOR | ORG_VIEWER |
|-----------|:-:|:-:|:-:|:-:|
| View dashboard (own org) | all orgs | own org | own org | own org |
| View assets | all orgs | own org | own org | own org |
| View trades & revenue | all orgs | own org | own org | own org |
| View telemetry / analytics | all orgs | own org | own org | own org |
| Dispatch mode change | all orgs | own org | own org | - |
| Trigger DR test | all orgs | own org | own org | - |
| Manage tariff config | all orgs | own org | - | - |
| Manage users in org | all orgs | own org | - | - |
| Create / delete organizations | yes | - | - | - |
| View audit logs (cross-org) | yes | - | - | - |

### Tenant Scoping Rule

```
IF user.role == SOLFACIL_ADMIN:
    # No org filter — sees everything
    # Can optionally filter by ?org_id= query parameter
    query_filter = {}  # or { org_id: request.query.org_id }

ELSE:
    # Strict org filter — sees only own org
    query_filter = { org_id: user.custom:org_id }
    # Any attempt to access another org's data → 403 Forbidden
```

This rule is enforced at the **middleware layer** (Section 7), not in individual handlers. Handlers receive a pre-validated `TenantContext` object and use it for all data queries.

---

## 4. JWT Token Structure

After Cognito authentication, the ID token (used for API authorization) contains:

```json
{
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "joao@energiacorp.com.br",
  "custom:org_id": "ORG_ENERGIA_001",
  "cognito:groups": ["ORG_MANAGER"],
  "cognito:username": "joao@energiacorp.com.br",
  "iss": "https://cognito-idp.sa-east-1.amazonaws.com/sa-east-1_XXXXXXX",
  "aud": "app-client-id",
  "token_use": "id",
  "auth_time": 1740000000,
  "exp": 1740003600,
  "iat": 1740000000
}
```

### Extracted Claims → TenantContext

The middleware extracts these claims into a typed `TenantContext` object:

```typescript
/** Extracted from Cognito JWT — available in every authenticated handler */
export interface TenantContext {
  /** Cognito user sub (UUID) */
  readonly userId: string;

  /** Organization ID — e.g., "ORG_ENERGIA_001" or "SOLFACIL" */
  readonly orgId: string;

  /** User's role — exactly one from the groups array */
  readonly role: Role;

  /** User's email address */
  readonly email: string;

  /** Whether this user is a SOLFACIL platform admin */
  readonly isPlatformAdmin: boolean;
}

export type Role =
  | 'SOLFACIL_ADMIN'
  | 'ORG_MANAGER'
  | 'ORG_OPERATOR'
  | 'ORG_VIEWER';
```

---

## 5. CDK Infrastructure: Auth Stack

### New Stack: `AuthStack`

A new CDK stack that creates the Cognito User Pool, App Client, and integrates with the BFF API Gateway as an authorizer.

```
backend/
├── lib/
│   ├── auth-stack.ts              ← NEW: Cognito User Pool + Authorizer
│   ├── bff-stack.ts               ← MODIFIED: accepts authorizer, attaches to routes
│   ├── iot-hub-stack.ts           (no change)
│   ├── dr-dispatcher-stack.ts     (no change)
│   ├── market-billing-stack.ts    (no change)
│   └── shared/
│       ├── constants.ts           (no change)
│       ├── event-bus.ts           (no change)
│       └── event-schemas.ts       (no change)
├── src/
│   ├── shared/
│   │   └── types/
│   │       ├── api.ts             (no change)
│   │       └── auth.ts            ← NEW: TenantContext, Role types
│   ├── bff/
│   │   ├── middleware/
│   │   │   └── tenant-context.ts  ← NEW: JWT → TenantContext extraction
│   │   └── handlers/              (existing handlers modified to use TenantContext)
│   └── ...
└── bin/
    └── app.ts                     ← MODIFIED: instantiate AuthStack, wire to BFF
```

### AuthStack CDK Definition (Pseudocode)

```typescript
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly authorizer: apigatewayv2auth.HttpUserPoolAuthorizer;

  constructor(scope, id, props) {
    // ── Cognito User Pool ────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'VppUserPool', {
      userPoolName: resourceName(stage, 'UserPool'),
      selfSignUpEnabled: false,               // Admin-created accounts only
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      customAttributes: {
        org_id: new cognito.StringAttribute({
          mutable: false,   // Set once at user creation, never changes
          minLen: 3,
          maxLen: 50,
        }),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,  // Never delete user pool
    });

    // ── Cognito Groups (Roles) ───────────────────────────────────
    const roles = ['SOLFACIL_ADMIN', 'ORG_MANAGER', 'ORG_OPERATOR', 'ORG_VIEWER'];
    for (const role of roles) {
      new cognito.CfnUserPoolGroup(this, `Group${role}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: role,
        description: `${role} role group`,
      });
    }

    // ── App Client ───────────────────────────────────────────────
    this.userPoolClient = this.userPool.addClient('DashboardClient', {
      userPoolClientName: resourceName(stage, 'DashboardClient'),
      authFlows: {
        userPassword: true,       // For programmatic login (demo/testing)
        userSrp: true,            // For browser-based login (production)
      },
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

    // ── HTTP API Authorizer ──────────────────────────────────────
    this.authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', this.userPool, {
      userPoolClients: [this.userPoolClient],
      identitySource: '$request.header.Authorization',
    });
  }
}
```

### Modified `app.ts` (Entry Point)

```typescript
// ── Auth Stack ──────────────────────────────────────────────
const authStack = new AuthStack(app, `SolfacilVpp-${stage}-Auth`, {
  stage: DEFAULT_STAGE,
  description: 'Cognito User Pool, Groups, and API Authorizer',
});

// ── Module 5: BFF (now receives authorizer) ──────────────────
new BffStack(app, `SolfacilVpp-${stage}-Bff`, {
  stage: DEFAULT_STAGE,
  eventBus: eventBus.bus,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  authorizer: authStack.authorizer,
  description: 'Module 5: REST API Gateway for the React dashboard',
});
```

### Modified `BffStack` (Attach Authorizer to Routes)

The BFF stack's `addRoute` method will attach the Cognito authorizer to all routes:

```typescript
api.addRoutes({
  path: routePath,
  methods: [httpMethod],
  integration: new HttpLambdaIntegration(...),
  authorizer: props.authorizer,               // ← NEW
  authorizationScopes: [],                     // No OAuth scopes (use JWT claims)
});
```

---

## 6. Tenant-Aware Data Isolation

### Principle: org_id Is a Mandatory Column in Every Data Store

Every table, index, and query must include `org_id` as a filter dimension. This is the **single enforcement point** for tenant isolation at the data layer.

### 6.1 PostgreSQL (Module 4: Market & Billing)

#### Schema Changes

```sql
-- Add org_id to ALL existing tables

ALTER TABLE assets
  ADD COLUMN org_id VARCHAR(50) NOT NULL;

-- Move from single PK to compound unique
-- (asset IDs are globally unique, but org_id enables RLS)

ALTER TABLE tariff_schedules
  ADD COLUMN org_id VARCHAR(50) NOT NULL;

ALTER TABLE trades
  ADD COLUMN org_id VARCHAR(50) NOT NULL;

ALTER TABLE daily_revenue
  ADD COLUMN org_id VARCHAR(50) NOT NULL;

-- Organizations table (new)
CREATE TABLE organizations (
    id          VARCHAR(50) PRIMARY KEY,     -- e.g., "ORG_ENERGIA_001"
    name        VARCHAR(200) NOT NULL,       -- e.g., "Energia Corp S.A."
    cnpj        VARCHAR(18) UNIQUE NOT NULL, -- Brazilian tax ID
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    plan_tier   VARCHAR(20) NOT NULL DEFAULT 'standard',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign keys
ALTER TABLE assets ADD CONSTRAINT fk_assets_org
  FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE tariff_schedules ADD CONSTRAINT fk_tariff_org
  FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE trades ADD CONSTRAINT fk_trades_org
  FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE daily_revenue ADD CONSTRAINT fk_daily_revenue_org
  FOREIGN KEY (org_id) REFERENCES organizations(id);

-- Indexes for tenant-scoped queries
CREATE INDEX idx_assets_org ON assets(org_id);
CREATE INDEX idx_trades_org ON trades(org_id, trade_date);
CREATE INDEX idx_daily_revenue_org ON daily_revenue(org_id, report_date);
CREATE INDEX idx_tariff_org ON tariff_schedules(org_id, valid_from);
```

#### Row-Level Security (RLS) — Defense in Depth

PostgreSQL RLS provides a second layer of isolation beyond application-level filtering. Even if a Lambda handler has a bug and omits the `WHERE org_id = ...` clause, RLS prevents data leakage.

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_schedules ENABLE ROW LEVEL SECURITY;

-- Policy: Lambda sets session variable, RLS enforces it
-- The application-level middleware sets: SET app.current_org_id = 'ORG_ENERGIA_001'
CREATE POLICY tenant_isolation_assets ON assets
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_trades ON trades
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_daily_revenue ON daily_revenue
  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_tariff ON tariff_schedules
  USING (org_id = current_setting('app.current_org_id', true));

-- SOLFACIL_ADMIN bypass: use a superuser role that bypasses RLS
-- The Lambda DB connection for admin users uses a different role
-- that has BYPASSRLS privilege
```

### 6.2 DynamoDB (Module 3: DR Dispatcher)

#### dispatch_tracker Table Changes

```
Table: dispatch_tracker
PK: dispatch_id (ULID)
SK: asset_id
Attributes:
  + org_id (String)     ← NEW: required on every item
  ... (existing attributes unchanged)

New GSI: org-dispatch-index
  PK: org_id
  SK: dispatch_id
  Purpose: "List all dispatches for org X" (dashboard query)
```

All DynamoDB queries from the BFF must include a `FilterExpression` or use the `org-dispatch-index` GSI to scope results to the requesting user's `org_id`.

### 6.3 Timestream (Module 1: IoT Hub)

#### Dimension Changes

```
Database: solfacil_vpp
Table: device_telemetry

Dimensions:
  + org_id      ← NEW: required on every telemetry record
    asset_id
    device_id
    region

Measures: (unchanged)
```

All Timestream queries must include `WHERE org_id = '{org_id}'` in the SQL. Since Timestream uses columnar storage and partitions by dimensions, adding `org_id` as a dimension is cost-free and improves query performance.

### 6.4 IoT Core (Modules 1 & 3)

#### MQTT Topic Namespace

Current topic structure:
```
solfacil/{region}/{asset_id}/telemetry
solfacil/{region}/{asset_id}/command/mode-change
solfacil/{region}/{asset_id}/response/mode-change
```

Updated topic structure (insert org_id):
```
solfacil/{org_id}/{region}/{asset_id}/telemetry
solfacil/{org_id}/{region}/{asset_id}/command/mode-change
solfacil/{org_id}/{region}/{asset_id}/response/mode-change
```

**Why:** IoT Core policies can restrict a device certificate to topics matching its org, preventing cross-tenant MQTT traffic:

```json
{
  "Effect": "Allow",
  "Action": ["iot:Publish", "iot:Subscribe", "iot:Receive"],
  "Resource": "arn:aws:iot:*:*:topic/solfacil/${iot:Connection.Thing.Attributes[org_id]}/*"
}
```

#### IoT Rule SQL Update

```sql
-- Before:
SELECT *, topic(2) AS device_id, topic(3) AS asset_type
FROM 'solfacil/+/+/telemetry'

-- After:
SELECT *, topic(2) AS org_id, topic(3) AS region, topic(4) AS asset_id
FROM 'solfacil/+/+/+/telemetry'
```

### 6.5 EventBridge Events

All inter-module events must include `org_id` in the event detail:

```json
{
  "source": "solfacil.vpp.dr-dispatcher",
  "detail-type": "DRDispatchCompleted",
  "detail": {
    "org_id": "ORG_ENERGIA_001",
    "dispatch_id": "01HWXYZ...",
    ...
  }
}
```

Update the `event-schemas.ts` base event envelope:

```typescript
/** Base event envelope — ALL events must include org_id */
export interface VppEvent<T> {
  source: string;
  detailType: string;
  detail: T & { org_id: string };  // org_id is mandatory
  timestamp: string;
}
```

---

## 7. Lambda Middleware Layer

### Architecture: Middy Middleware Chain

Using [Middy](https://middy.js.org/) (already planned in the backend design doc), each BFF Lambda handler is wrapped with a middleware chain that extracts and validates the tenant context before the handler runs.

```
Request Flow:
┌──────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ API GW   │───►│ Cognito      │───►│ Middy         │───►│ Handler      │
│ receives │    │ Authorizer   │    │ Middleware     │    │ (business    │
│ request  │    │ (JWT verify) │    │ Chain          │    │  logic)      │
└──────────┘    └──────────────┘    └───────────────┘    └──────────────┘
                 validates JWT       1. extractTenant()   receives
                 rejects invalid     2. requireRole()     TenantContext
                 tokens              3. logRequest()      in event
                                     4. errorHandler()
```

### Middleware Implementation

#### `tenant-context.ts` — Extract TenantContext from JWT

```typescript
import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { TenantContext, Role } from '../../shared/types/auth';

const VALID_ROLES: readonly Role[] = [
  'SOLFACIL_ADMIN',
  'ORG_MANAGER',
  'ORG_OPERATOR',
  'ORG_VIEWER',
] as const;

/**
 * Middy middleware: extracts TenantContext from the Cognito JWT claims
 * injected by API Gateway's built-in authorizer.
 *
 * After this middleware runs, `event.tenantContext` is available to the handler.
 */
export function extractTenantContext(): middy.MiddlewareObj<APIGatewayProxyEventV2> {
  return {
    before: async (request) => {
      const claims = request.event.requestContext?.authorizer?.jwt?.claims;

      if (!claims) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: 'Missing authentication claims' }),
        };
      }

      const orgId = claims['custom:org_id'] as string;
      const groups = (claims['cognito:groups'] as string[] | string) ?? [];
      const groupsArray = Array.isArray(groups) ? groups : [groups];

      // Find the first valid role in the user's groups
      const role = groupsArray.find((g): g is Role =>
        VALID_ROLES.includes(g as Role)
      );

      if (!orgId || !role) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'User missing org_id or valid role' }),
        };
      }

      const tenantContext: TenantContext = {
        userId: claims.sub as string,
        orgId,
        role,
        email: claims.email as string,
        isPlatformAdmin: role === 'SOLFACIL_ADMIN',
      };

      // Attach to event for handler access
      (request.event as any).tenantContext = tenantContext;
    },
  };
}

/**
 * Middy middleware: requires the user to have one of the specified roles.
 * Returns 403 if the user's role is not in the allowed list.
 */
export function requireRole(
  ...allowedRoles: readonly Role[]
): middy.MiddlewareObj<APIGatewayProxyEventV2> {
  return {
    before: async (request) => {
      const ctx = (request.event as any).tenantContext as TenantContext;

      if (!ctx) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'TenantContext not initialized' }),
        };
      }

      if (!allowedRoles.includes(ctx.role)) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: `Role '${ctx.role}' is not authorized for this operation`,
          }),
        };
      }
    },
  };
}
```

#### Handler Usage Pattern

```typescript
import middy from '@middy/core';
import { extractTenantContext, requireRole } from '../middleware/tenant-context';
import type { TenantContext } from '../../shared/types/auth';

const baseHandler = async (event: APIGatewayProxyEventV2 & { tenantContext: TenantContext }) => {
  const { orgId, isPlatformAdmin } = event.tenantContext;

  // Build tenant-scoped query
  const queryFilter = isPlatformAdmin
    ? {}                              // Admin sees all
    : { org_id: orgId };             // Scoped to user's org

  const assets = await assetRepository.findAll(queryFilter);

  return {
    statusCode: 200,
    body: JSON.stringify(ok(assets)),
  };
};

// Wrap with middleware chain
export const handler = middy(baseHandler)
  .use(extractTenantContext())
  .use(requireRole('SOLFACIL_ADMIN', 'ORG_MANAGER', 'ORG_OPERATOR', 'ORG_VIEWER'));
```

---

## 8. API Authorization Matrix

Every BFF route is annotated with its required role(s) and tenant scoping behavior:

| Method | Path | Min Role | Tenant Scoping | Notes |
|--------|------|----------|----------------|-------|
| `GET` | `/dashboard` | ORG_VIEWER | Scoped to `org_id` (admin: all or filtered) | Aggregated KPIs |
| `GET` | `/assets` | ORG_VIEWER | Scoped to `org_id` | Asset list |
| `GET` | `/assets/{id}` | ORG_VIEWER | Verify asset belongs to `org_id` | Single asset |
| `GET` | `/trades` | ORG_VIEWER | Scoped to `org_id` | Today's trades |
| `GET` | `/revenue/trend` | ORG_VIEWER | Scoped to `org_id` | 7-day trend |
| `GET` | `/revenue/breakdown` | ORG_VIEWER | Scoped to `org_id` | Revenue sources |
| `POST` | `/dispatch` | ORG_OPERATOR | Verify all `assetIds` belong to `org_id` | Mode change |
| `POST` | `/dr-test` | ORG_OPERATOR | Scoped to `org_id` assets only | DR test |
| `GET` | `/dispatch/{id}` | ORG_OPERATOR | Verify dispatch belongs to `org_id` | Poll progress |
| `GET` | `/algorithm/kpis` | ORG_VIEWER | Scoped to `org_id` | Alpha, MAPE |
| `GET` | `/tariffs/current` | ORG_VIEWER | Scoped to `org_id` | Tariff rates |
| `PUT` | `/tariffs/{id}` | ORG_MANAGER | Verify tariff belongs to `org_id` | Update tariff |
| `GET` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) | List all orgs |
| `POST` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) | Create org |
| `GET` | `/users` | ORG_MANAGER | Scoped to `org_id` | List org users |
| `POST` | `/users` | ORG_MANAGER | User created in caller's `org_id` | Create user |

### Cross-Org Access Prevention

For endpoints that take an `{id}` parameter (e.g., `/assets/{id}`, `/dispatch/{id}`), the middleware performs an **ownership check**:

```typescript
// After fetching the resource
if (!tenantContext.isPlatformAdmin && resource.org_id !== tenantContext.orgId) {
  return { statusCode: 404 };  // Return 404, not 403 (don't reveal existence)
}
```

Returning `404` instead of `403` prevents information leakage — an attacker cannot enumerate which resource IDs exist in other orgs.

---

## 9. Frontend Integration

### Authentication Flow

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Login Page  │───►│ Cognito Hosted UI │───►│ Dashboard       │
│  (or custom) │    │ (or custom form)  │    │ (authenticated) │
└──────────────┘    └──────────────────┘    └─────────────────┘
     │                      │                        │
     │  1. User enters      │  2. Returns JWT        │  3. All API calls
     │     email/password   │     (ID + Access +     │     include header:
     │                      │      Refresh tokens)   │     Authorization:
     │                      │                        │     Bearer <id_token>
```

### Frontend Changes Required

1. **Auth module** (`js/modules/auth.js`) — New module for:
   - Login/logout flow (Cognito Hosted UI or `amazon-cognito-identity-js`)
   - Token storage (in-memory, not localStorage — XSS protection)
   - Token refresh (using refresh token before expiry)
   - Attach `Authorization: Bearer <id_token>` to all API calls

2. **API client update** — All `fetch()` calls must include the auth header:
   ```javascript
   const response = await fetch(`${API_BASE}/assets`, {
     headers: {
       'Authorization': `Bearer ${getIdToken()}`,
       'Content-Type': 'application/json',
     },
   });
   ```

3. **Role-based UI** — Hide/disable UI elements based on user role:
   - ORG_VIEWER: Hide dispatch buttons, DR test button
   - ORG_OPERATOR: Show dispatch, hide tariff config
   - ORG_MANAGER: Show all within org scope
   - SOLFACIL_ADMIN: Show org switcher dropdown

4. **Org context display** — Show current org name in the header/nav

---

## 10. Migration Plan for Existing Schemas

Since all stacks are **skeleton-only with mock data**, migration is minimal. The goal is to add `org_id` to every data interface before real data is written.

### Migration Checklist

| Component | File(s) | Change Required |
|-----------|---------|----------------|
| PostgreSQL schema | `src/market-billing/migrations/` | Add `org_id` column + `organizations` table to migration scripts (not yet executed) |
| DynamoDB table | `lib/dr-dispatcher-stack.ts` | Add `org-dispatch-index` GSI with `org_id` PK |
| Timestream schema | `lib/iot-hub-stack.ts` | No CDK change needed (dimensions are set at write time); update `ingest-telemetry.ts` to include `org_id` dimension |
| IoT Topic Rules | `lib/iot-hub-stack.ts`, `lib/dr-dispatcher-stack.ts` | Update SQL to parse `org_id` from new topic position |
| Event schemas | `lib/shared/event-schemas.ts` | Add `org_id` to `VppEvent` base type |
| API types | `src/shared/types/api.ts` | Add `TenantContext` import/export |
| Mock data | `src/bff/handlers/*.ts` | Add `org_id` to every mock asset, trade, revenue record |
| BFF routes | `lib/bff-stack.ts` | Attach Cognito authorizer to all routes |
| MQTT topics | IoT Rule SQL | Shift topic position indices by +1 for new `org_id` segment |

### No-Downtime Strategy

Since no production data exists yet, all changes can be applied in a single deployment cycle. No backward-compatible migration path is needed.

---

## 11. Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| **Horizontal privilege escalation** (User A accesses User B's org data) | Middleware enforces `org_id` filter on every query; PostgreSQL RLS as defense-in-depth; DynamoDB queries scoped by `org_id` GSI |
| **Vertical privilege escalation** (ORG_VIEWER performs dispatch) | `requireRole()` middleware checks role before handler executes |
| **JWT tampering** | API Gateway Cognito authorizer verifies JWT signature against Cognito JWKS endpoint |
| **Token theft via XSS** | Store tokens in memory (not localStorage); set short ID token TTL (1h); use `HttpOnly` cookies for refresh token if using custom auth domain |
| **CSRF** | API Gateway HTTP API does not use cookies for auth (Bearer token in header); CSRF not applicable |
| **Insecure direct object reference** | Resource ownership check: return 404 (not 403) for resources belonging to other orgs |
| **Admin account compromise** | MFA enabled for SOLFACIL_ADMIN users (enforced via Cognito MFA settings); audit logging for all admin operations |
| **Cross-tenant MQTT traffic** | IoT Core policies restrict device certificates to their org's topic namespace |

### Audit Logging

All write operations (dispatch, tariff update, user management) must log:

```json
{
  "timestamp": "2026-02-20T14:30:00Z",
  "action": "DISPATCH_MODE_CHANGE",
  "actor": {
    "userId": "sub-uuid",
    "email": "joao@energiacorp.com.br",
    "orgId": "ORG_ENERGIA_001",
    "role": "ORG_OPERATOR"
  },
  "resource": {
    "type": "dispatch",
    "id": "01HWXYZ..."
  },
  "details": {
    "assetIds": ["ASSET_SP_001", "ASSET_RJ_002"],
    "targetMode": "peak_valley_arbitrage"
  }
}
```

This is logged via AWS Lambda Powertools structured logging and indexed in CloudWatch Logs Insights for audit queries.

---

## 12. Implementation Phases

### Phase A: Foundation (Auth Stack + Types) — Estimated: 1 sprint

1. Create `lib/auth-stack.ts` with Cognito User Pool, Groups, App Client
2. Create `src/shared/types/auth.ts` with `TenantContext`, `Role` types
3. Create `src/bff/middleware/tenant-context.ts` with `extractTenantContext()` and `requireRole()`
4. Modify `bin/app.ts` to instantiate `AuthStack` and wire to `BffStack`
5. Modify `lib/bff-stack.ts` to accept and attach the Cognito authorizer
6. Add `middy` and `@middy/core` to `package.json`
7. Seed test users in Cognito for each role (via script or CLI)

### Phase B: Data Layer Tenant Isolation — Estimated: 1 sprint

1. Add `org_id` to PostgreSQL migration scripts; create `organizations` table
2. Add `org-dispatch-index` GSI to DynamoDB `dispatch_tracker`
3. Update Timestream ingestion to include `org_id` dimension
4. Update IoT Rule SQL for new topic structure
5. Update `event-schemas.ts` to include `org_id` in base event type
6. Update all mock data in BFF handlers to include `org_id`

### Phase C: Handler Integration — Estimated: 1 sprint

1. Wrap all BFF handlers with Middy middleware chain
2. Implement tenant-scoped queries in each handler
3. Add ownership checks for single-resource endpoints
4. Add PostgreSQL RLS policies
5. Add admin-only endpoints (`/organizations`, `/users`)

### Phase D: Frontend Auth — Estimated: 1 sprint

1. Implement `js/modules/auth.js` (Cognito auth flow)
2. Update API client to attach Bearer token
3. Add role-based UI rendering
4. Add org context display
5. Add login/logout pages

### Phase E: Advanced Auth — SSO & MFA — Estimated: 2 sprints

1. Configure Cognito SAML 2.0 provider for Azure AD federation
2. Configure Cognito OIDC provider for Okta/Google Workspace
3. Implement Pre-Token-Generation Lambda trigger for federated user mapping
4. Create `federated_user_mappings` DynamoDB table and admin tooling
5. Upgrade MFA policy to `REQUIRED` with TOTP
6. Enable Cognito Advanced Security (`ENFORCED` mode)
7. Implement `requireRecentAuth()` step-up middleware for dispatch operations
8. Add SSO fallback monitoring (CloudWatch alarms for federation errors)
9. Test SSO failover with local Cognito credentials

### Phase F: M2M Integration & API Security — Estimated: 2 sprints

1. Create Cognito Resource Server with `solfacil/read`, `solfacil/dispatch`, `solfacil/billing` scopes
2. Register first M2M client (`UserPoolClient` with `clientCredentials` flow)
3. Implement `validateM2MScope()` Middy middleware
4. Create M2M client configuration DynamoDB table
5. Deploy API Gateway Usage Plans with Standard/Professional/Enterprise tiers
6. Deploy WAF Web ACL with OWASP Core Rule Set, SQLi protection, and rate-based rules
7. Configure CloudWatch alarms for throttling and WAF block events
8. Partner onboarding runbook and API key rotation automation

### Phase G: Event-Driven Webhooks — Estimated: 2 sprints

1. Create EventBridge Connection and API Destination resources
2. Implement webhook signing proxy Lambda (HMAC-SHA256)
3. Create EventBridge rules for `DRDispatchCompleted` and `InvoiceGenerated`
4. Deploy webhook DLQ with monitoring alarms
5. Create `webhook_subscriptions` DynamoDB table
6. Implement webhook CRUD API (`POST/GET/DELETE /webhooks`)
7. Implement dynamic EventBridge rule creation via SDK
8. Secrets Manager integration for webhook secret generation and rotation
9. Publish partner integration guide with receiver validation example

### Dependencies

```
Phase A ──► Phase B ──► Phase C ──► Phase D
(Auth)      (Data)      (Handlers)  (Frontend)
                │
                ├──► Phase E (SSO / MFA — requires Auth Stack from Phase A)
                │
                ├──► Phase F (M2M / WAF — requires Auth Stack + BFF routes)
                │
                └──► Phase G (Webhooks — requires EventBridge from Phase B)
```

Phases B and D are independent of each other and could run in parallel if two developers are available. However, Phase C depends on both A and B. Phases E, F, and G can begin once Phase A and B are complete, and may run in parallel with independent teams.

---

## 13. Advanced Authentication & Security

### 13.1 Enterprise SSO (SAML 2.0 / OIDC)

Enterprise clients — particularly investment funds and large energy conglomerates — often mandate that all user authentication flow through their own identity provider (IdP). Rather than creating local Cognito passwords for these users, we federate authentication to their existing IdP while still issuing Cognito-managed JWTs with our `custom:org_id` and `cognito:groups` claims.

#### Supported Federation Protocols

| Protocol | Typical IdP | When to Use |
|----------|------------|-------------|
| **SAML 2.0** | Azure AD / Microsoft Entra ID, ADFS | Enterprise clients with Microsoft-centric infrastructure |
| **OIDC** | Google Workspace, Okta, Auth0, Keycloak | Clients with modern cloud-native IdPs |

#### 13.1.1 Azure AD / Microsoft Entra ID via SAML 2.0

**Step-by-step Cognito setup:**

1. **Azure AD side** — Register a new Enterprise Application
   - Set the Identifier (Entity ID) to `urn:amazon:cognito:sp:<userPoolId>`
   - Set the Reply URL (ACS URL) to `https://<cognito-domain>.auth.sa-east-1.amazoncognito.com/saml2/idpresponse`
   - Configure SAML Claims:
     - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` → user.mail
     - `http://schemas.microsoft.com/identity/claims/objectidentifier` → user.objectId
     - `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` → user.groups
   - Download the Federation Metadata XML

2. **Cognito side** — Add SAML Identity Provider
   - Upload the Federation Metadata XML
   - Configure attribute mapping (see table below)
   - Enable the IdP on the User Pool App Client

3. **Attribute mapping** — Azure AD claims → Cognito attributes

| Azure AD Claim | Cognito Attribute | Notes |
|---------------|-------------------|-------|
| `emailaddress` | `email` | Standard mapping |
| `objectidentifier` | `custom:org_id` | Mapped via Pre-Token-Generation Lambda (see below) |
| `groups` | `cognito:groups` | Azure AD group → Cognito group via Lambda trigger |

**Critical design note:** Azure AD's `objectId` identifies the user, not the organization. The `org_id` mapping cannot be a direct 1:1 attribute map. Instead, we use a **Pre-Token-Generation Lambda trigger** that looks up the federated user's organization assignment in our `organizations` DynamoDB table and injects `custom:org_id` into the JWT claims.

```typescript
/**
 * Pre-Token-Generation Lambda Trigger
 *
 * For federated users, Cognito custom attributes are not set at login time.
 * This trigger injects org_id and role claims into the JWT based on
 * a mapping stored in DynamoDB.
 */
export const handler = async (event: CognitoUserPoolTriggerEvent) => {
  const email = event.request.userAttributes.email;

  // Look up org assignment for this federated user
  const mapping = await dynamodb.get({
    TableName: 'federated_user_mappings',
    Key: { email },
  }).promise();

  if (mapping.Item) {
    event.response.claimsOverrideDetails = {
      claimsToAddOrOverride: {
        'custom:org_id': mapping.Item.org_id,
      },
      groupOverrideDetails: {
        groupsToOverride: [mapping.Item.role],
      },
    };
  }

  return event;
};
```

**CDK snippet — Adding SAML Identity Provider to AuthStack:**

```typescript
// ── SAML 2.0 Federation (Azure AD) ─────────────────────────────
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

// Attach to App Client
this.userPoolClient = this.userPool.addClient('DashboardClient', {
  // ...existing config...
  supportedIdentityProviders: [
    cognito.UserPoolClientIdentityProvider.COGNITO,    // Local credentials
    cognito.UserPoolClientIdentityProvider.custom(azureAdProvider.providerName),
  ],
});

// Pre-Token-Generation trigger for org_id injection
const preTokenFn = new lambda.Function(this, 'PreTokenGeneration', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'pre-token-generation.handler',
  code: lambda.Code.fromAsset('src/auth/triggers'),
});
this.userPool.addTrigger(
  cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
  preTokenFn,
);
```

#### 13.1.2 Generic OIDC (Google Workspace, Okta, Auth0)

For IdPs that support OpenID Connect, the setup is simpler since OIDC provides standardized claim formats.

**CDK snippet — Adding OIDC Identity Provider:**

```typescript
// ── OIDC Federation (Okta example) ──────────────────────────────
const oktaProvider = new cognito.UserPoolIdentityProviderOidc(
  this, 'OktaOidcProvider', {
    userPool: this.userPool,
    name: 'Okta',
    clientId: ssm.StringParameter.valueForStringParameter(
      this, '/solfacil/auth/okta/client-id'
    ),
    clientSecret: ssm.StringParameter.valueForStringParameter(
      this, '/solfacil/auth/okta/client-secret'
    ),
    issuerUrl: 'https://your-domain.okta.com/oauth2/default',
    scopes: ['openid', 'email', 'profile', 'groups'],
    attributeMapping: {
      email: cognito.ProviderAttribute.other('email'),
      custom: {
        'custom:idp_sub': cognito.ProviderAttribute.other('sub'),
      },
    },
    attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
  }
);
```

#### 13.1.3 Attribute Mapping Strategy

Regardless of the federation protocol, the core mapping strategy is:

```
External IdP User ──► Pre-Token-Generation Lambda ──► Internal Claims
                      ┌─────────────────────────┐
  IdP email     ──►   │ Lookup in DynamoDB:       │ ──► custom:org_id
  IdP groups    ──►   │ federated_user_mappings   │ ──► cognito:groups
  IdP sub       ──►   │ (email → org_id, role)    │ ──► custom:idp_sub
                      └─────────────────────────┘
```

**DynamoDB table: `federated_user_mappings`**

| PK (email) | org_id | role | idp_name | provisioned_at |
|------------|--------|------|----------|----------------|
| joao@energiacorp.com.br | ORG_ENERGIA_001 | ORG_MANAGER | AzureAD | 2026-02-20 |
| maria@solarbr.com.br | ORG_SOLARBR_002 | ORG_OPERATOR | Okta | 2026-02-20 |

This decouples external IdP claims from internal tenant identity. The Pre-Token-Generation trigger is the single source of truth for mapping federated users to organizations and roles.

#### 13.1.4 SSO Fallback Strategy

When an external IdP is unavailable (outage, misconfiguration, certificate expiry):

1. **Detection** — Cognito returns `SAML_PROVIDER_ERROR` or OIDC token exchange failure
2. **Fallback flow** — Users are redirected to the standard Cognito login page
3. **Emergency local credentials** — ORG_MANAGER users for each org should have a local Cognito password as a break-glass mechanism
4. **Monitoring** — CloudWatch alarm on `FederationErrors` metric → SNS notification to on-call

```typescript
// CloudWatch alarm for SSO failures
new cloudwatch.Alarm(this, 'SsoFailureAlarm', {
  metric: this.userPool.metric('FederationErrors', {
    period: cdk.Duration.minutes(5),
    statistic: 'Sum',
  }),
  threshold: 5,
  evaluationPeriods: 1,
  alarmDescription: 'SSO federation errors exceeding threshold — check IdP connectivity',
  actionsEnabled: true,
  alarmActions: [snsAlertTopic],
});
```

**Estimated dev effort:** 2 sprints (1 sprint for SAML/OIDC integration + Pre-Token trigger; 1 sprint for per-client IdP onboarding automation and fallback testing)

---

### 13.2 Multi-Factor Authentication (MFA)

Operations personnel who can dispatch mode changes to battery assets hold significant authority. A compromised ORG_OPERATOR account could trigger unintended grid responses. MFA provides a second verification layer.

#### MFA Policy by Role

| Role | MFA Requirement | Method | Rationale |
|------|----------------|--------|-----------|
| **SOLFACIL_ADMIN** | **Mandatory** | TOTP (Google/Microsoft Authenticator) | Platform-wide access; highest privilege |
| **ORG_MANAGER** | **Mandatory** | TOTP (Google/Microsoft Authenticator) | Can dispatch commands and manage users |
| **ORG_OPERATOR** | **Mandatory** | TOTP (Google/Microsoft Authenticator) | Can dispatch mode changes to physical assets |
| **ORG_VIEWER** | Optional | SMS or TOTP (user's choice) | Read-only; lower risk of compromise impact |

#### CDK Configuration

The existing AuthStack (Section 5) sets `mfa: cognito.Mfa.OPTIONAL`. For enterprise readiness, we upgrade the MFA configuration:

```typescript
// ── Updated User Pool MFA Configuration ─────────────────────────
this.userPool = new cognito.UserPool(this, 'VppUserPool', {
  // ...existing config from Section 5...

  // CHANGED: MFA is required for all users
  mfa: cognito.Mfa.REQUIRED,
  mfaSecondFactor: {
    otp: true,    // TOTP — Google Authenticator, Microsoft Authenticator
    sms: false,   // Disabled by default (SMS is less secure, SIM-swap risk)
  },
});
```

**Why TOTP over SMS?**

| Factor | TOTP | SMS |
|--------|------|-----|
| Security | Offline, no SIM-swap risk | Vulnerable to SIM-swap and SS7 attacks |
| Cost | Free | ~$0.05/message (adds up at scale) |
| Reliability | Works without cell signal | Depends on carrier delivery |
| Compliance | NIST SP 800-63B Level 2 | NIST deprecated for high-security contexts |

#### Adaptive MFA — Step-Up Authentication for Sensitive Operations

Cognito Advanced Security Features enable **risk-based adaptive authentication**. For standard read operations, the existing TOTP MFA at login is sufficient. For high-risk operations (DR dispatch, tariff configuration, user management), we implement step-up authentication.

```
Standard Login Flow:
  Email + Password + TOTP ──► Standard JWT (1h TTL)
  ↓
  Can perform: dashboard views, asset listing, trade viewing

Step-Up Flow (Sensitive Operations):
  Standard JWT + Re-authentication Challenge ──► Elevated JWT (15min TTL)
  ↓
  Can perform: DR dispatch, tariff update, user management
```

**How Cognito Advanced Security triggers step-up auth:**

1. **Enable Advanced Security** on the User Pool:

```typescript
// ── Cognito Advanced Security ───────────────────────────────────
const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
cfnUserPool.userPoolAddOns = {
  advancedSecurityMode: 'ENFORCED',
};
```

2. **Risk-based triggers** — Cognito evaluates each auth attempt and can:
   - Allow (low risk — recognized device, known IP)
   - Require MFA (medium risk — new device, unusual time)
   - Block (high risk — impossible travel, compromised credentials detected)

3. **Application-level step-up** — For dispatch and management operations, the BFF middleware checks the JWT's `auth_time` claim and requires re-authentication if the last MFA challenge was more than 15 minutes ago:

```typescript
/**
 * Middy middleware: requires recent MFA for sensitive operations.
 * If auth_time is older than maxAge, returns 401 with step-up challenge.
 */
export function requireRecentAuth(
  maxAgeSeconds: number = 900 // 15 minutes
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

// Usage in dispatch handler:
export const handler = middy(dispatchHandler)
  .use(extractTenantContext())
  .use(requireRole('SOLFACIL_ADMIN', 'ORG_MANAGER', 'ORG_OPERATOR'))
  .use(requireRecentAuth(900)); // Must have authenticated within last 15 min
```

**Estimated dev effort:** 1 sprint (MFA enforcement is mostly config; step-up auth middleware and frontend re-auth flow require integration work)

---

## 14. M2M Integration & Open API

### 14.1 Machine-to-Machine (M2M) API Access

The VPP platform must support unattended, server-to-server integrations for:

- **Solfacil internal ERP** — automated billing reconciliation and asset provisioning
- **External energy aggregators** — real-time dispatch coordination across multiple VPPs
- **Energy trading platforms** — automated bid/offer placement based on VPP capacity
- **Monitoring systems** — pull asset health and telemetry data on a schedule

These systems have no human user to log in via browser. They need programmatic API access with appropriate scoping and rate control.

#### Option A: API Keys + Usage Plans (Simpler)

API Gateway natively supports API Keys associated with Usage Plans that define throttling and quotas.

**When to use:** Internal Solfacil services, low-security integrations, monitoring/health-check endpoints.

**Architecture:**

```
External System ──► API Gateway (x-api-key header) ──► Usage Plan Validation ──► Lambda
                    Checks API key matches a plan       Enforces rate/quota
```

**Configuration:**

```typescript
// ── API Key + Usage Plan (CDK) ──────────────────────────────────

// Create a usage plan with throttling and quota
const usagePlan = api.addUsagePlan('ExternalPartnerPlan', {
  name: 'external-partner-plan',
  description: 'Rate-limited access for external partner integrations',
  throttle: {
    rateLimit: 50,     // requests per second
    burstLimit: 100,   // burst capacity
  },
  quota: {
    limit: 10_000,     // requests per day
    period: apigateway.Period.DAY,
  },
});

// Create an API key for a specific partner
const partnerKey = api.addApiKey('EnergiaCorpApiKey', {
  apiKeyName: 'energia-corp-erp',
  description: 'API key for Energia Corp ERP integration',
});

// Associate the key with the usage plan
usagePlan.addApiKey(partnerKey);

// Attach usage plan to the API stage
usagePlan.addApiStage({
  stage: api.deploymentStage,
});
```

**Key rotation strategy:**

1. Generate a new API key via CDK or SDK
2. Notify the partner of the new key (via secure channel)
3. Allow a 7-day overlap period where both old and new keys are active
4. Deactivate the old key after the overlap period
5. CloudWatch alarm if old key is used after deactivation deadline

#### Option B: OAuth 2.0 Client Credentials (Enterprise Standard)

For enterprise-grade M2M access, Cognito supports the OAuth 2.0 Client Credentials flow. This provides scoped, time-limited access tokens without any user login.

**When to use:** External aggregators, energy trading platforms, any partner requiring enterprise-standard API authentication.

**Architecture:**

```
External System                         Cognito                    API Gateway
     │                                    │                            │
     │ POST /oauth2/token                 │                            │
     │ grant_type=client_credentials      │                            │
     │ client_id=xxx                      │                            │
     │ client_secret=yyy                  │                            │
     │ scope=solfacil/read                │                            │
     │──────────────────────────────────►│                            │
     │                                    │ Validates credentials      │
     │                                    │ Issues access token        │
     │◄──────────────────────────────────│                            │
     │ { access_token, expires_in }       │                            │
     │                                    │                            │
     │ GET /assets                        │                            │
     │ Authorization: Bearer <token>      │                            │
     │───────────────────────────────────────────────────────────────►│
     │                                    │   Validates JWT + scopes   │
     │◄──────────────────────────────────────────────────────────────│
     │ { data: [...] }                    │                            │
```

**Step 1: Define Resource Server and Scopes**

```typescript
// ── Resource Server (OAuth 2.0 Scopes) ──────────────────────────
const resourceServer = this.userPool.addResourceServer('VppApi', {
  identifier: 'solfacil',
  userPoolResourceServerName: 'Solfacil VPP API',
  scopes: [
    new cognito.ResourceServerScope({
      scopeName: 'read',
      scopeDescription: 'Read access to assets, telemetry, and trades',
    }),
    new cognito.ResourceServerScope({
      scopeName: 'dispatch',
      scopeDescription: 'Dispatch mode changes and DR commands',
    }),
    new cognito.ResourceServerScope({
      scopeName: 'billing',
      scopeDescription: 'Access billing, revenue, and tariff data',
    }),
  ],
});
```

**Step 2: Register Machine Client**

```typescript
// ── Machine Client (Client Credentials flow) ───────────────────
const machineClient = this.userPool.addClient('EnergiaCorp-ERP', {
  userPoolClientName: 'energia-corp-erp-m2m',
  generateSecret: true,  // Required for Client Credentials
  oAuth: {
    flows: {
      clientCredentials: true,   // M2M flow — no user login
    },
    scopes: [
      cognito.OAuthScope.custom('solfacil/read'),
      cognito.OAuthScope.custom('solfacil/billing'),
      // NOTE: dispatch scope deliberately NOT granted to this client
    ],
  },
  accessTokenValidity: cdk.Duration.hours(1),
  // No ID token or refresh token for Client Credentials
});

// Output the client ID (secret is retrieved via AWS Console or SDK)
new cdk.CfnOutput(this, 'MachineClientId', {
  value: machineClient.userPoolClientId,
  description: 'Client ID for Energia Corp ERP M2M access',
});
```

**Step 3: How the External System Gets a Token**

```bash
# External system requests an access token
curl -X POST "https://<cognito-domain>.auth.sa-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=<machine-client-id>" \
  -d "client_secret=<machine-client-secret>" \
  -d "scope=solfacil/read solfacil/billing"

# Response:
# {
#   "access_token": "eyJraWQiOi...",
#   "expires_in": 3600,
#   "token_type": "Bearer"
# }
```

**Step 4: Lambda Validation — Verify Scope, Not Just org_id**

For M2M tokens, there is no `custom:org_id` claim (no user context). Instead, the Lambda validates the OAuth scope to determine what the machine client is allowed to do. The org_id for the machine client is stored in a configuration table.

```typescript
/**
 * Middy middleware: validates OAuth 2.0 scopes for M2M access.
 * M2M tokens contain scopes instead of custom:org_id / cognito:groups.
 */
export function validateM2MScope(
  ...requiredScopes: readonly string[]
): middy.MiddlewareObj<APIGatewayProxyEventV2> {
  return {
    before: async (request) => {
      const claims = request.event.requestContext?.authorizer?.jwt?.claims;
      const tokenUse = claims?.token_use;

      // Only applies to access tokens (M2M), not ID tokens (user)
      if (tokenUse !== 'access') return;

      const scopeStr = claims?.scope as string ?? '';
      const tokenScopes = scopeStr.split(' ');

      const hasAllScopes = requiredScopes.every(
        (s) => tokenScopes.includes(s)
      );

      if (!hasAllScopes) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: 'insufficient_scope',
            required: requiredScopes,
            granted: tokenScopes,
          }),
        };
      }

      // Look up org_id for this machine client
      const clientId = claims?.client_id as string;
      const clientConfig = await getM2MClientConfig(clientId);

      const tenantContext: TenantContext = {
        userId: `m2m:${clientId}`,
        orgId: clientConfig.org_id,
        role: 'ORG_OPERATOR',  // Effective role for the machine client
        email: `m2m-${clientConfig.name}@solfacil.internal`,
        isPlatformAdmin: false,
      };

      (request.event as any).tenantContext = tenantContext;
    },
  };
}
```

#### Recommendation: Which Option for Which Use Case

| Use Case | Recommended Option | Rationale |
|----------|-------------------|-----------|
| Internal Solfacil ERP | **Option B** (Client Credentials) | Sensitive billing data; needs scoped access; enterprise standard |
| External energy aggregator | **Option B** (Client Credentials) | Third-party trust boundary; must have revocable, scoped tokens |
| Energy trading platform | **Option B** (Client Credentials) | Financial transactions; requires audit trail and scope enforcement |
| Monitoring / health-check | **Option A** (API Key) | Low-sensitivity read-only; simpler to set up; no OAuth overhead |
| Customer-facing public API | **Option B** (Client Credentials) | Standard OAuth developer experience; aligns with industry norms |

**General rule:** Use API Keys for internal, low-risk, read-only integrations. Use Client Credentials for anything involving write operations, financial data, or external partners.

**Estimated dev effort:** 2 sprints (1 sprint for Cognito Resource Server + Client Credentials setup; 1 sprint for M2M middleware, client config table, and partner onboarding automation)

---

### 14.2 Rate Limiting & Quota Defense

External API access introduces the risk of abuse — accidental or intentional. The VPP platform must enforce rate limits at multiple layers.

#### 14.2.1 API Gateway Default Throttling

All API Gateway routes share a baseline throttle:

```typescript
// ── API Gateway Stage Throttling ────────────────────────────────
const api = new apigatewayv2.HttpApi(this, 'BffApi', {
  apiName: resourceName(stage, 'BffApi'),
  defaultDomainMapping: undefined,
});

const stage = api.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
stage.defaultRouteSettings = {
  throttlingBurstLimit: 200,    // Max concurrent requests
  throttlingRateLimit: 100,     // Sustained requests per second
};
```

#### 14.2.2 Per-Client Quotas via Usage Plans

Each M2M client has its own quota tier:

| Tier | Rate Limit | Burst | Daily Quota | Monthly Quota | Intended For |
|------|-----------|-------|-------------|---------------|-------------|
| **Standard** | 50 rps | 100 | 10,000 | 300,000 | Small partners, monitoring |
| **Professional** | 200 rps | 400 | 100,000 | 3,000,000 | Mid-size aggregators |
| **Enterprise** | 500 rps | 1,000 | Unlimited | Unlimited | Large energy trading platforms |

#### 14.2.3 WAF Integration — OWASP Top 10 Protection

AWS WAF (Web Application Firewall) is attached to the API Gateway to block common web attacks before they reach Lambda handlers.

```typescript
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

// ── WAF Web ACL ─────────────────────────────────────────────────
const webAcl = new wafv2.CfnWebACL(this, 'VppApiWaf', {
  name: resourceName(stage, 'VppApiWaf'),
  scope: 'REGIONAL',  // For API Gateway (not CloudFront)
  defaultAction: { allow: {} },
  visibilityConfig: {
    sampledRequestsEnabled: true,
    cloudWatchMetricsEnabled: true,
    metricName: 'VppApiWaf',
  },
  rules: [
    // Rule 1: AWS Managed — Core Rule Set (OWASP Top 10)
    {
      name: 'AWS-AWSManagedRulesCommonRuleSet',
      priority: 1,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'CommonRuleSet',
      },
    },
    // Rule 2: AWS Managed — SQL Injection protection
    {
      name: 'AWS-AWSManagedRulesSQLiRuleSet',
      priority: 2,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesSQLiRuleSet',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'SQLiRuleSet',
      },
    },
    // Rule 3: Rate-based rule — block IPs exceeding 2000 req/5min
    {
      name: 'RateLimit',
      priority: 3,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit: 2000,
          aggregateKeyType: 'IP',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'RateLimit',
      },
    },
  ],
});

// ── Associate WAF with API Gateway ──────────────────────────────
new wafv2.CfnWebACLAssociation(this, 'WafApiAssociation', {
  resourceArn: api.apiEndpoint,  // API Gateway stage ARN
  webAclArn: webAcl.attrArn,
});
```

#### 14.2.4 Alert Strategy

Proactive alerting prevents quota exhaustion from becoming an outage:

```typescript
// ── CloudWatch Alarm: Quota approaching limit ──────────────────
new cloudwatch.Alarm(this, 'ApiQuotaAlarm', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/ApiGateway',
    metricName: '4XXError',
    dimensionsMap: {
      ApiId: api.apiId,
    },
    period: cdk.Duration.minutes(5),
    statistic: 'Sum',
  }),
  threshold: 100,  // More than 100 throttled requests in 5 minutes
  evaluationPeriods: 2,
  alarmDescription: 'API throttling is rejecting significant traffic — check for abuse or increase limits',
  alarmActions: [snsOnCallTopic],
});

// ── CloudWatch Alarm: WAF blocking spike ────────────────────────
new cloudwatch.Alarm(this, 'WafBlockAlarm', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/WAFV2',
    metricName: 'BlockedRequests',
    dimensionsMap: {
      WebACL: 'VppApiWaf',
      Rule: 'ALL',
    },
    period: cdk.Duration.minutes(5),
    statistic: 'Sum',
  }),
  threshold: 50,
  evaluationPeriods: 1,
  alarmDescription: 'WAF blocking requests — potential attack or misconfigured client',
  alarmActions: [snsOnCallTopic],
});
```

**Alert escalation path:**

```
CloudWatch Alarm ──► SNS Topic ──► Email (on-call engineer)
                                ──► Slack webhook (#vpp-alerts channel)
                                ──► PagerDuty (critical alarms only)
```

**Estimated dev effort:** 1 sprint (WAF rules are declarative CDK; alarm setup is straightforward; main effort is tuning thresholds post-deployment)

---

## 15. Event-Driven Webhooks (Outbound Notifications)

### 15.1 EventBridge API Destinations

When important events occur in the VPP platform, external systems need to be notified in real time. Rather than requiring partners to poll our API, we proactively push event notifications via webhooks.

#### Webhook-Eligible Events

| Event | Source | Typical Subscribers |
|-------|--------|-------------------|
| `DRDispatchCompleted` | DR Dispatcher | Billing systems, grid operator dashboards |
| `DRDispatchFailed` | DR Dispatcher | Monitoring/alerting platforms |
| `InvoiceGenerated` | Market & Billing | Customer ERP, accounting systems |
| `AssetModeChanged` | IoT Hub | Monitoring dashboards, aggregator platforms |
| `AlertTriggered` | IoT Hub | On-call notification systems, customer portals |
| `TariffUpdated` | Market & Billing | Trading platforms, customer portals |

#### Architecture

```
Internal Event                       EventBridge                    External System
     │                                    │                            │
     │  solfacil.vpp.dr-dispatcher        │                            │
     │  DRDispatchCompleted               │                            │
     │──────────────────────────────────►│                            │
     │                                    │  Rule matches pattern      │
     │                                    │  ↓                         │
     │                                    │  API Destination           │
     │                                    │  ↓                         │
     │                                    │  HTTP POST + Auth          │
     │                                    │──────────────────────────►│
     │                                    │                            │ 200 OK
     │                                    │◄──────────────────────────│
     │                                    │                            │
     │                         (If failed: retry up to 185 times)      │
     │                         (After 24h: → SQS Dead Letter Queue)    │
```

#### CDK Resources

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';

// ── Connection: Auth credentials for outbound webhook ───────────
const billingWebhookConnection = new events.Connection(
  this, 'BillingWebhookConnection', {
    authorization: events.Authorization.apiKey(
      'x-api-key',
      cdk.SecretValue.secretsManager('solfacil/webhooks/billing-api-key')
    ),
    description: 'Auth for outbound webhooks to billing system',
  }
);

// ── API Destination: Target URL and rate limit ──────────────────
const billingDestination = new events.ApiDestination(
  this, 'BillingWebhookDestination', {
    connection: billingWebhookConnection,
    endpoint: 'https://billing.partner.com/webhooks/solfacil',
    httpMethod: events.HttpMethod.POST,
    rateLimitPerSecond: 10,  // Don't overwhelm the partner's endpoint
    description: 'Billing system webhook endpoint',
  }
);

// ── Dead Letter Queue: Failed webhook delivery ──────────────────
const webhookDLQ = new sqs.Queue(this, 'WebhookDLQ', {
  queueName: resourceName(stage, 'webhook-dlq'),
  retentionPeriod: cdk.Duration.days(14),
  encryption: sqs.QueueEncryption.SQS_MANAGED,
});

// ── EventBridge Rule: DRDispatchCompleted → Billing Webhook ─────
new events.Rule(this, 'DispatchCompletedToBilling', {
  ruleName: resourceName(stage, 'dispatch-completed-to-billing'),
  eventBus: sharedEventBus,
  eventPattern: {
    source: ['solfacil.vpp.dr-dispatcher'],
    detailType: ['DRDispatchCompleted'],
  },
  targets: [
    new targets.ApiDestination(billingDestination, {
      deadLetterQueue: webhookDLQ,
      retryAttempts: 185,  // EventBridge default: retry over 24 hours
      maxEventAge: cdk.Duration.hours(24),
      // Input Transformer: reshape event to partner-expected format
      event: events.RuleTargetInput.fromObject({
        webhook_type: 'dr_dispatch_completed',
        timestamp: events.EventField.time,
        org_id: events.EventField.fromPath('$.detail.org_id'),
        dispatch_id: events.EventField.fromPath('$.detail.dispatch_id'),
        assets_count: events.EventField.fromPath('$.detail.assets_count'),
        total_energy_kwh: events.EventField.fromPath('$.detail.total_energy_kwh'),
        revenue_brl: events.EventField.fromPath('$.detail.revenue_brl'),
      }),
    }),
  ],
});
```

#### Retry Policy and Dead Letter Queue

EventBridge API Destinations use an exponential backoff retry policy:

| Retry Phase | Attempts | Interval | Total Duration |
|-------------|----------|----------|---------------|
| Immediate | 1–5 | 1–30 seconds | ~2 minutes |
| Short backoff | 6–50 | 30s–5min | ~3 hours |
| Long backoff | 51–185 | 5min–30min | ~24 hours |

After 185 retries (24 hours), failed events are sent to the SQS Dead Letter Queue.

**DLQ monitoring:**

```typescript
new cloudwatch.Alarm(this, 'WebhookDLQAlarm', {
  metric: webhookDLQ.metricApproximateNumberOfMessagesVisible({
    period: cdk.Duration.minutes(5),
  }),
  threshold: 1,  // Any message in DLQ = delivery failure
  evaluationPeriods: 1,
  alarmDescription: 'Webhook delivery failed after 24h of retries — investigate and replay',
  alarmActions: [snsOnCallTopic],
});
```

---

### 15.2 Webhook Security

Outbound webhooks must be tamper-proof. The receiving system needs a way to verify that a webhook payload genuinely originated from Solfacil and was not modified in transit.

#### HMAC-SHA256 Signature Scheme

Every outbound webhook includes two custom headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Solfacil-Signature` | `sha256=<hex-digest>` | HMAC-SHA256 of the raw payload body |
| `X-Solfacil-Timestamp` | `1740000000` | Unix timestamp of signature generation |

The signature is computed as:

```
signature = HMAC-SHA256(
  key = webhook_secret,
  message = timestamp + "." + raw_body
)
```

Including the timestamp in the signed message prevents replay attacks. Receivers should reject webhooks where the timestamp is older than 5 minutes.

#### TypeScript: How Solfacil Signs the Payload

This signing logic runs in a Lambda function invoked by EventBridge before the API Destination call. The Lambda acts as a "signing proxy":

```typescript
import { createHmac } from 'crypto';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

interface SignedWebhookResult {
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Sign a webhook payload with HMAC-SHA256.
 * The secret is retrieved from AWS Secrets Manager.
 */
async function signWebhookPayload(
  payload: Record<string, unknown>,
  secretArn: string,
): Promise<SignedWebhookResult> {
  // Retrieve webhook secret from Secrets Manager
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  const webhookSecret = secretResponse.SecretString!;

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signatureMessage = `${timestamp}.${body}`;

  const signature = createHmac('sha256', webhookSecret)
    .update(signatureMessage)
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

#### TypeScript: How a Node.js Receiver Validates the Webhook

Partners receiving Solfacil webhooks should implement the following validation:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a Solfacil webhook signature.
 * Returns true if the signature is valid and the timestamp is recent.
 */
function verifySolfacilWebhook(
  rawBody: string,
  signatureHeader: string,    // "sha256=<hex>"
  timestampHeader: string,    // Unix timestamp string
  webhookSecret: string,
  maxAgeSeconds: number = 300, // 5 minutes
): boolean {
  // 1. Check timestamp freshness (prevent replay attacks)
  const timestamp = parseInt(timestampHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > maxAgeSeconds) {
    console.error('Webhook timestamp too old or in the future');
    return false;
  }

  // 2. Compute expected signature
  const signatureMessage = `${timestampHeader}.${rawBody}`;
  const expectedSignature = createHmac('sha256', webhookSecret)
    .update(signatureMessage)
    .digest('hex');

  // 3. Extract received signature (strip "sha256=" prefix)
  const receivedSignature = signatureHeader.replace('sha256=', '');

  // 4. Constant-time comparison (prevent timing attacks)
  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(receivedSignature, 'hex');

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

// Express.js middleware example:
app.post('/webhooks/solfacil', express.raw({ type: 'application/json' }), (req, res) => {
  const isValid = verifySolfacilWebhook(
    req.body.toString(),
    req.headers['x-solfacil-signature'] as string,
    req.headers['x-solfacil-timestamp'] as string,
    process.env.SOLFACIL_WEBHOOK_SECRET!,
  );

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Process the webhook...
  const event = JSON.parse(req.body.toString());
  console.log('Received valid webhook:', event.webhook_type);

  res.status(200).json({ received: true });
});
```

#### Secret Rotation Strategy

Webhook secrets are stored in AWS Secrets Manager with automatic rotation:

1. **Secrets Manager** stores the HMAC key with a 90-day rotation schedule
2. **Rotation Lambda** generates a new secret, updates the EventBridge Connection, and notifies the partner
3. **Dual-secret window** — During rotation, both old and new secrets are valid for 7 days. The signing proxy tries the new secret; the receiver should attempt verification with both secrets during the overlap period.
4. **Rotation complete** — After 7 days, the old secret is removed from Secrets Manager's version stages

```typescript
// ── Secrets Manager: Webhook secret with rotation ───────────────
const webhookSecret = new secretsmanager.Secret(this, 'WebhookSecret', {
  secretName: '/solfacil/webhooks/billing/hmac-secret',
  generateSecretString: {
    excludePunctuation: true,
    passwordLength: 64,  // 256-bit secret
  },
  description: 'HMAC-SHA256 secret for billing webhook signatures',
});

// Automatic rotation every 90 days
webhookSecret.addRotationSchedule('RotateEvery90Days', {
  automaticallyAfter: cdk.Duration.days(90),
  rotationLambda: webhookSecretRotationFn,
});
```

---

### 15.3 Webhook Management API

Partners and internal systems should be able to self-service their webhook subscriptions without manual CDK deployments. This requires a CRUD API for webhook registration backed by DynamoDB and dynamic EventBridge rule creation.

#### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/webhooks` | ORG_MANAGER, SOLFACIL_ADMIN | Register a new webhook subscription |
| `GET` | `/webhooks` | ORG_MANAGER, SOLFACIL_ADMIN | List webhook subscriptions for the caller's org |
| `GET` | `/webhooks/{id}` | ORG_MANAGER, SOLFACIL_ADMIN | Get a specific webhook subscription |
| `DELETE` | `/webhooks/{id}` | ORG_MANAGER, SOLFACIL_ADMIN | Delete a webhook subscription |

#### DynamoDB Table: `webhook_subscriptions`

```
Table: webhook_subscriptions

PK: org_id (String)          — Partition key (tenant isolation)
SK: webhook_id (String)      — Sort key (ULID — e.g., "WH_01HWXYZ...")
Attributes:
  url           (String)     — Target URL for the webhook POST
  events        (StringSet)  — Subscribed event types (e.g., ["DRDispatchCompleted", "InvoiceGenerated"])
  secret_arn    (String)     — ARN of the HMAC secret in Secrets Manager
  rule_name     (String)     — Name of the dynamically created EventBridge rule
  status        (String)     — "active" | "paused" | "failed"
  created_at    (String)     — ISO 8601 timestamp
  updated_at    (String)     — ISO 8601 timestamp

GSI: none needed (all queries are by org_id)
```

#### CDK Definition

```typescript
// ── DynamoDB: Webhook subscriptions ─────────────────────────────
const webhookSubscriptionsTable = new dynamodb.Table(
  this, 'WebhookSubscriptions', {
    tableName: resourceName(stage, 'webhook-subscriptions'),
    partitionKey: { name: 'org_id', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'webhook_id', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    pointInTimeRecoveryEnabled: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  }
);
```

#### Dynamic EventBridge Rule Creation

When a new webhook is registered via `POST /webhooks`, the handler Lambda creates the EventBridge resources dynamically using the AWS SDK:

```typescript
import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
  DeleteRuleCommand,
  RemoveTargetsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SecretsManagerClient,
  CreateSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { ulid } from 'ulid';

const ebClient = new EventBridgeClient({});
const smClient = new SecretsManagerClient({});

interface CreateWebhookInput {
  readonly url: string;
  readonly events: readonly string[];
}

interface WebhookSubscription {
  readonly org_id: string;
  readonly webhook_id: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly secret_arn: string;
  readonly rule_name: string;
  readonly status: string;
  readonly created_at: string;
}

/**
 * POST /webhooks handler — registers a new webhook subscription.
 *
 * 1. Generates an HMAC secret and stores it in Secrets Manager
 * 2. Creates an EventBridge rule matching the subscribed events
 * 3. Saves the subscription to DynamoDB
 * 4. Returns the webhook_id and secret (shown once only)
 */
async function createWebhookSubscription(
  tenantContext: TenantContext,
  input: CreateWebhookInput,
): Promise<WebhookSubscription> {
  const webhookId = `WH_${ulid()}`;
  const ruleName = `webhook-${tenantContext.orgId}-${webhookId}`;
  const now = new Date().toISOString();

  // 1. Create HMAC secret in Secrets Manager
  const secretName = `/solfacil/webhooks/${tenantContext.orgId}/${webhookId}`;
  const secretResult = await smClient.send(new CreateSecretCommand({
    Name: secretName,
    GenerateSecretString: {
      ExcludePunctuation: true,
      PasswordLength: 64,
    },
    Description: `Webhook HMAC secret for ${tenantContext.orgId} → ${input.url}`,
  }));

  // 2. Create EventBridge rule for the subscribed events
  await ebClient.send(new PutRuleCommand({
    Name: ruleName,
    EventBusName: 'solfacil-vpp-events',
    EventPattern: JSON.stringify({
      source: [{ prefix: 'solfacil.vpp' }],
      'detail-type': input.events,
      detail: {
        org_id: [tenantContext.orgId],  // Tenant-scoped: only this org's events
      },
    }),
    State: 'ENABLED',
    Description: `Webhook delivery for ${tenantContext.orgId} to ${input.url}`,
  }));

  // 3. Add API Destination target (via Connection ARN)
  await ebClient.send(new PutTargetsCommand({
    Rule: ruleName,
    EventBusName: 'solfacil-vpp-events',
    Targets: [{
      Id: `target-${webhookId}`,
      Arn: process.env.API_DESTINATION_ARN!,
      RoleArn: process.env.EVENTBRIDGE_ROLE_ARN!,
      DeadLetterConfig: {
        Arn: process.env.WEBHOOK_DLQ_ARN!,
      },
      RetryPolicy: {
        MaximumRetryAttempts: 185,
        MaximumEventAgeInSeconds: 86400,  // 24 hours
      },
    }],
  }));

  // 4. Save to DynamoDB
  const subscription: WebhookSubscription = {
    org_id: tenantContext.orgId,
    webhook_id: webhookId,
    url: input.url,
    events: input.events,
    secret_arn: secretResult.ARN!,
    rule_name: ruleName,
    status: 'active',
    created_at: now,
  };

  await dynamodb.put({
    TableName: process.env.WEBHOOK_TABLE!,
    Item: subscription,
  }).promise();

  return subscription;
}
```

#### Webhook Deletion Flow

When `DELETE /webhooks/{id}` is called:

1. Fetch the subscription from DynamoDB (verify it belongs to the caller's `org_id`)
2. Remove the EventBridge rule target via `RemoveTargetsCommand`
3. Delete the EventBridge rule via `DeleteRuleCommand`
4. Schedule the Secrets Manager secret for deletion (7-day recovery window)
5. Delete the DynamoDB item

```typescript
async function deleteWebhookSubscription(
  tenantContext: TenantContext,
  webhookId: string,
): Promise<void> {
  // Fetch and verify ownership
  const sub = await dynamodb.get({
    TableName: process.env.WEBHOOK_TABLE!,
    Key: { org_id: tenantContext.orgId, webhook_id: webhookId },
  }).promise();

  if (!sub.Item) {
    throw new NotFoundError('Webhook subscription not found');
  }

  const { rule_name, secret_arn } = sub.Item;

  // Remove EventBridge target and rule
  await ebClient.send(new RemoveTargetsCommand({
    Rule: rule_name,
    EventBusName: 'solfacil-vpp-events',
    Ids: [`target-${webhookId}`],
  }));

  await ebClient.send(new DeleteRuleCommand({
    Name: rule_name,
    EventBusName: 'solfacil-vpp-events',
  }));

  // Schedule secret deletion (7-day recovery window)
  await smClient.send(new DeleteSecretCommand({
    SecretId: secret_arn,
    RecoveryWindowInDays: 7,
  }));

  // Delete DynamoDB record
  await dynamodb.delete({
    TableName: process.env.WEBHOOK_TABLE!,
    Key: { org_id: tenantContext.orgId, webhook_id: webhookId },
  }).promise();
}
```

**Estimated dev effort:** 2 sprints (1 sprint for EventBridge API Destinations + signing proxy; 1 sprint for webhook CRUD API, DynamoDB table, and dynamic rule creation)

---

## Appendix A: Cognito CLI Quick Reference

```bash
# Create a user (admin provisioning)
aws cognito-idp admin-create-user \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --user-attributes \
    Name=email,Value=joao@energiacorp.com.br \
    Name=email_verified,Value=true \
    Name=custom:org_id,Value=ORG_ENERGIA_001 \
  --temporary-password "TempPass123!"

# Add user to role group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id sa-east-1_XXXXXXX \
  --username "joao@energiacorp.com.br" \
  --group-name ORG_MANAGER

# List users in an org (filter by custom attribute)
aws cognito-idp list-users \
  --user-pool-id sa-east-1_XXXXXXX \
  --filter 'custom:org_id = "ORG_ENERGIA_001"'

# List users in a role group
aws cognito-idp list-users-in-group \
  --user-pool-id sa-east-1_XXXXXXX \
  --group-name SOLFACIL_ADMIN
```

## Appendix B: Test User Seed Data

| Email | Org | Role | Purpose |
|-------|-----|------|---------|
| `admin@solfacil.com.br` | SOLFACIL | SOLFACIL_ADMIN | Platform admin (all orgs) |
| `gerente@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_MANAGER | Org manager (Energia Corp) |
| `operador@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_OPERATOR | Dispatch operator |
| `auditor@energiacorp.com.br` | ORG_ENERGIA_001 | ORG_VIEWER | Read-only viewer |
| `gerente@solarbr.com.br` | ORG_SOLARBR_002 | ORG_MANAGER | Org manager (Solar BR) |
| `operador@solarbr.com.br` | ORG_SOLARBR_002 | ORG_OPERATOR | Dispatch operator |

---

*This document is subject to revision based on domain expert review and security audit.*
