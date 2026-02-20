# SOLFACIL VPP — Authentication & Multi-tenancy Design

> **Version:** 1.0 | **Date:** 2026-02-20
> **Author:** Cloud Architecture Team
> **Status:** DRAFT — Pending Review
> **Depends on:** `SOLFACIL_BACKEND_DESIGN.md` v1.1

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

### Dependencies

```
Phase A ──► Phase B ──► Phase C ──► Phase D
(Auth)      (Data)      (Handlers)  (Frontend)
```

Phases B and D are independent of each other and could run in parallel if two developers are available. However, Phase C depends on both A and B.

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
